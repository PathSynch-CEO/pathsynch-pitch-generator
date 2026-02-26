/**
 * Pre-Call Brief Routes
 *
 * API endpoints for generating AI-powered pre-call research briefs.
 * Uses contact enrichment and company data to create seller-facing
 * meeting prep documents.
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');
const contactEnricher = require('../services/contactEnricher');
const modelRouter = require('../services/modelRouter');
const googlePlaces = require('../services/googlePlaces');

const router = createRouter();
const db = admin.firestore();

// Brief limits by tier
const BRIEF_LIMITS = {
    free: 3,
    starter: 3,
    growth: 15,
    scale: -1, // Unlimited
    enterprise: -1
};

// Contact enrichment by tier
const CONTACT_ENRICHMENT_TIERS = ['growth', 'scale', 'enterprise'];

/**
 * Get user's tier and check brief limits
 */
async function getUserTierAndCheckLimit(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const tier = (userData.tier || userData.plan || 'starter').toLowerCase();

    // Get current month's brief count
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const briefsSnapshot = await db.collection('precallBriefs')
        .where('userId', '==', userId)
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
        .get();

    const briefsThisMonth = briefsSnapshot.size;
    const limit = BRIEF_LIMITS[tier] || BRIEF_LIMITS.starter;
    const canEnrichContact = CONTACT_ENRICHMENT_TIERS.includes(tier);

    return {
        tier,
        briefsThisMonth,
        limit,
        canEnrichContact,
        hasCustomLibrary: tier === 'scale' || tier === 'enterprise',
        atLimit: limit !== -1 && briefsThisMonth >= limit
    };
}

/**
 * Build the AI prompt for brief generation
 */
function buildBriefPrompt(data) {
    const {
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        contactEnriched,
        meetingContext,
        companyData,
        customLibraryContext
    } = data;

    let prompt = `Generate a comprehensive pre-call brief for a sales meeting.

## PROSPECT COMPANY
- Company: ${prospectCompany}
${prospectWebsite ? `- Website: ${prospectWebsite}` : ''}
${prospectIndustry ? `- Industry: ${prospectIndustry}` : ''}
${prospectLocation ? `- Location: ${prospectLocation}` : ''}
`;

    // Add company enrichment data if available
    if (companyData) {
        prompt += `
## COMPANY INTELLIGENCE
${companyData.rating ? `- Google Rating: ${companyData.rating}/5 (${companyData.reviewCount || 0} reviews)` : ''}
${companyData.priceLevel ? `- Price Level: ${companyData.priceLevel}/4` : ''}
${companyData.types ? `- Business Type: ${companyData.types.slice(0, 3).join(', ')}` : ''}
${companyData.competitors && companyData.competitors.length > 0 ? `- Nearby Competitors: ${companyData.competitors.slice(0, 5).map(c => c.name).join(', ')}` : ''}
`;
    }

    // Add contact information
    if (contactName) {
        prompt += `
## CONTACT PERSON
- Name: ${contactName}
${contactTitle ? `- Title: ${contactTitle}` : ''}
`;

        if (contactEnriched && contactEnricher.hasContactEnrichment(contactEnriched)) {
            prompt += `
### CONTACT INTELLIGENCE
${contactEnriched.summary ? `- Professional Summary: ${contactEnriched.summary}` : ''}
${contactEnriched.careerHistory && contactEnriched.careerHistory.length > 0 ? `- Career History: ${contactEnriched.careerHistory.slice(0, 3).join('; ')}` : ''}
${contactEnriched.education ? `- Education: ${contactEnriched.education}` : ''}
${contactEnriched.communicationStyle ? `- Communication Style: ${contactEnriched.communicationStyle}` : ''}
${contactEnriched.personalInsights ? `- Personal Insights: ${contactEnriched.personalInsights}` : ''}
`;
        }
    }

    // Meeting context
    if (meetingContext) {
        const contextDescriptions = {
            discovery: 'This is a DISCOVERY call - focus on understanding their challenges and qualifying the opportunity.',
            demo: 'This is a DEMO call - they want to see the product. Focus on their specific use cases.',
            follow_up: 'This is a FOLLOW-UP call - they have already seen information. Focus on addressing concerns.',
            proposal: 'This is a PROPOSAL call - they are evaluating options. Focus on differentiation and ROI.',
            negotiation: 'This is a NEGOTIATION call - they are ready to buy. Focus on value and closing.'
        };
        prompt += `
## MEETING CONTEXT
${contextDescriptions[meetingContext] || `Meeting type: ${meetingContext}`}
`;
    }

    // Custom library context
    if (customLibraryContext) {
        prompt += `
## SELLER'S RESOURCES
${customLibraryContext.roiFramework ? `- ROI Framework: ${customLibraryContext.roiFramework}` : ''}
${customLibraryContext.caseStudies && customLibraryContext.caseStudies.length > 0 ? `- Relevant Case Studies: ${customLibraryContext.caseStudies.join('; ')}` : ''}
${customLibraryContext.qualificationCriteria ? `- Qualification Criteria: ${customLibraryContext.qualificationCriteria}` : ''}
`;
    }

    prompt += `

## REQUIRED OUTPUT (JSON format)
Generate a JSON object with the following structure:
{
    "companySnapshot": "2-3 sentence overview of the company, their business model, and market position",
    "contactSnapshot": "2-3 sentence overview of the contact person, their role, and likely priorities (if contact data available, otherwise 'No contact data provided')",
    "whyTheyTookMeeting": "1-2 sentences hypothesizing why they agreed to meet based on available data",
    "suggestedOpener": "A specific, personalized opening line referencing something about THEM (not generic)",
    "talkingPoints": ["3-5 key talking points tailored to this prospect and contact"],
    "discoveryQuestions": ["5-7 discovery questions appropriate for the contact's title and the meeting context"],
    "objectionPrep": [
        {"objection": "Likely objection 1", "response": "Suggested response"},
        {"objection": "Likely objection 2", "response": "Suggested response"},
        {"objection": "Likely objection 3", "response": "Suggested response"}
    ],
    "competitorWatch": ["2-3 competitors they might be considering or comparing against"],
    "recommendedNextSteps": "What should the next step be after this meeting",
    "doNotMention": ["Topics or references to avoid based on any negative signals"]
}

IMPORTANT INSTRUCTIONS:
- Be SPECIFIC to this prospect. Do not use generic language.
- If contact data is enriched, personalize heavily to their background.
- Discovery questions should match the contact's authority level (executive vs. manager).
- For the opener, reference specific details about the company or person.
- Do NOT mention Google review ratings in the opener - use more sophisticated insights.
- Return ONLY the JSON object, no additional text.`;

    return prompt;
}

/**
 * Fetch company data from Google Places
 */
async function fetchCompanyData(prospectCompany, prospectLocation) {
    try {
        if (!prospectLocation) {
            return null;
        }

        const result = await googlePlaces.findCompetitors(prospectLocation, prospectCompany, 2000);

        if (result.success && result.competitors && result.competitors.length > 0) {
            // Find the closest match to our prospect company
            const prospect = result.competitors.find(c =>
                c.name.toLowerCase().includes(prospectCompany.toLowerCase()) ||
                prospectCompany.toLowerCase().includes(c.name.toLowerCase())
            );

            return {
                rating: prospect?.rating || null,
                reviewCount: prospect?.reviewCount || null,
                priceLevel: prospect?.priceLevel || null,
                types: prospect?.types || null,
                competitors: result.competitors.filter(c => c.name !== prospect?.name).slice(0, 5)
            };
        }

        return null;
    } catch (error) {
        console.warn('Company data fetch failed:', error.message);
        return null;
    }
}

/**
 * Fetch custom library context for the user
 */
async function fetchCustomLibraryContext(userId) {
    try {
        const configDoc = await db.collection('customerLibraryConfig').doc(userId).get();
        if (!configDoc.exists) return null;

        const config = configDoc.data();
        if (!config.libraryEnabled) return null;

        // Get recent case studies from sales documents
        const docsSnapshot = await db.collection('salesDocuments')
            .where('userId', '==', userId)
            .where('documentType', '==', 'case_study')
            .orderBy('uploadedAt', 'desc')
            .limit(3)
            .get();

        const caseStudies = docsSnapshot.docs.map(doc => doc.data().label || doc.data().originalName);

        return {
            roiFramework: config.roiFramework || null,
            caseStudies: caseStudies.length > 0 ? caseStudies : null,
            qualificationCriteria: config.qualificationCriteria || null
        };
    } catch (error) {
        console.warn('Custom library fetch failed:', error.message);
        return null;
    }
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /precall-briefs/generate
 * Generate a new pre-call brief
 */
router.post('/precall-briefs/generate', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const {
            prospectCompany,
            prospectWebsite,
            prospectIndustry,
            prospectLocation,
            contactName,
            contactTitle,
            contactLinkedIn,
            contactEmail,
            meetingDate,
            meetingContext,
            useCustomLibrary
        } = req.body;

        // Validate required fields
        if (!prospectCompany) {
            throw new ApiError('Prospect company is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        // Check user tier and limits
        const userStatus = await getUserTierAndCheckLimit(userId);

        if (userStatus.atLimit) {
            throw new ApiError(
                `You've reached your monthly limit of ${userStatus.limit} briefs. Upgrade to generate more.`,
                403,
                ErrorCodes.RATE_LIMITED
            );
        }

        console.log(`Generating pre-call brief for ${prospectCompany} (user: ${userId}, tier: ${userStatus.tier})`);

        // Start generating - create brief document with "generating" status
        const briefRef = db.collection('precallBriefs').doc();
        const briefId = briefRef.id;

        await briefRef.set({
            id: briefId,
            userId,
            prospectCompany,
            prospectWebsite: prospectWebsite || null,
            prospectIndustry: prospectIndustry || null,
            prospectLocation: prospectLocation || null,
            contactName: contactName || null,
            contactTitle: contactTitle || null,
            contactEmail: contactEmail || null,
            contactLinkedIn: contactLinkedIn || null,
            meetingDate: meetingDate ? admin.firestore.Timestamp.fromDate(new Date(meetingDate)) : null,
            meetingContext: meetingContext || null,
            status: 'generating',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Enrich contact if allowed
        let contactEnriched = null;
        if (userStatus.canEnrichContact && (contactLinkedIn || contactName)) {
            contactEnriched = await contactEnricher.enrichContact({
                contactLinkedIn,
                contactName,
                contactTitle,
                prospectCompany
            });
        }

        // Fetch company data from Google Places
        const companyData = await fetchCompanyData(prospectCompany, prospectLocation || prospectIndustry);

        // Fetch custom library context if enabled
        let customLibraryContext = null;
        if (useCustomLibrary && userStatus.hasCustomLibrary) {
            customLibraryContext = await fetchCustomLibraryContext(userId);
        }

        // Build prompt and generate brief
        const prompt = buildBriefPrompt({
            prospectCompany,
            prospectWebsite,
            prospectIndustry,
            prospectLocation,
            contactName,
            contactTitle,
            contactEnriched,
            meetingContext,
            companyData,
            customLibraryContext
        });

        // Call AI model
        const aiResult = await modelRouter.generateNarrative(
            prompt,
            { type: 'precall_brief', company: prospectCompany },
            { userId }
        );

        // Parse AI response
        let briefContent;
        try {
            // Extract JSON from response
            const jsonMatch = aiResult.narrative.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                briefContent = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse AI response:', parseError.message);
            briefContent = {
                companySnapshot: 'Brief generation encountered an error. Please try again.',
                contactSnapshot: contactName ? `Contact: ${contactName}${contactTitle ? `, ${contactTitle}` : ''}` : 'No contact provided',
                whyTheyTookMeeting: 'Unable to determine',
                suggestedOpener: `Hello${contactName ? ` ${contactName}` : ''}, thank you for taking the time to meet today.`,
                talkingPoints: ['Understand their current challenges', 'Present our solution', 'Discuss next steps'],
                discoveryQuestions: ['What challenges are you currently facing?', 'What solutions have you tried?', 'What does success look like for you?'],
                objectionPrep: [],
                competitorWatch: [],
                recommendedNextSteps: 'Schedule a follow-up call',
                doNotMention: []
            };
        }

        // Update brief with generated content
        await briefRef.update({
            contactEnriched: contactEnriched || null,
            briefContent,
            libraryEnhanced: customLibraryContext !== null,
            customROIPoints: customLibraryContext?.roiFramework ? [customLibraryContext.roiFramework] : [],
            relevantCaseStudies: customLibraryContext?.caseStudies || [],
            status: 'ready',
            generatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Fetch final document
        const finalDoc = await briefRef.get();

        return res.status(201).json({
            success: true,
            data: {
                id: briefId,
                ...finalDoc.data()
            }
        });

    } catch (error) {
        return handleError(error, res, 'POST /precall-briefs/generate');
    }
});

/**
 * GET /precall-briefs
 * List user's pre-call briefs
 */
router.get('/precall-briefs', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        let query = db.collection('precallBriefs')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (offset > 0) {
            // Get the document at the offset position for pagination
            const offsetSnapshot = await db.collection('precallBriefs')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(offset)
                .get();

            if (!offsetSnapshot.empty) {
                const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        const briefs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || null,
            meetingDate: doc.data().meetingDate?.toDate?.() || null
        }));

        // Get user limits
        const userStatus = await getUserTierAndCheckLimit(userId);

        return res.status(200).json({
            success: true,
            data: briefs,
            pagination: {
                limit,
                offset,
                total: briefs.length
            },
            limits: {
                used: userStatus.briefsThisMonth,
                limit: userStatus.limit,
                remaining: userStatus.limit === -1 ? -1 : Math.max(0, userStatus.limit - userStatus.briefsThisMonth)
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /precall-briefs');
    }
});

/**
 * GET /precall-briefs/:id
 * Get a specific pre-call brief
 */
router.get('/precall-briefs/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const briefId = req.params.id;
        const briefDoc = await db.collection('precallBriefs').doc(briefId).get();

        if (!briefDoc.exists) {
            throw new ApiError('Brief not found', 404, ErrorCodes.NOT_FOUND);
        }

        const brief = briefDoc.data();

        if (brief.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        return res.status(200).json({
            success: true,
            data: {
                id: briefDoc.id,
                ...brief,
                createdAt: brief.createdAt?.toDate?.() || null,
                meetingDate: brief.meetingDate?.toDate?.() || null
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /precall-briefs/:id');
    }
});

/**
 * DELETE /precall-briefs/:id
 * Delete a pre-call brief
 */
router.delete('/precall-briefs/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const briefId = req.params.id;
        const briefDoc = await db.collection('precallBriefs').doc(briefId).get();

        if (!briefDoc.exists) {
            throw new ApiError('Brief not found', 404, ErrorCodes.NOT_FOUND);
        }

        const brief = briefDoc.data();

        if (brief.userId !== userId) {
            throw new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN);
        }

        await db.collection('precallBriefs').doc(briefId).delete();

        return res.status(200).json({
            success: true,
            message: 'Brief deleted successfully'
        });

    } catch (error) {
        return handleError(error, res, 'DELETE /precall-briefs/:id');
    }
});

module.exports = router;
