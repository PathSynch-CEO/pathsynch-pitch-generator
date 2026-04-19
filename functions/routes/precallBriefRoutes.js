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
const geminiClientV2 = require('../services/geminiClientV2');
const { generateBriefPdf } = require('../services/briefPdfGenerator');

// AI Research Agents (Sales Intelligence Trifecta)
const { invokeAgentsParallel } = require('../services/agentClient');
const { researchContact, isConfigured: isLinkedInConfigured } = require('../services/linkedinResearchAgent');
const { researchNews } = require('../services/newsIntelligenceAgent');

// Feature flag for using AI research agents
const USE_AI_RESEARCH_AGENTS = true;

// Intelligence Engine (Phase 1: Two-Pass Generation)
const { generateIntelligentBrief } = require('../intelligence');

// Feature flag for using new intelligence pipeline
const USE_INTELLIGENCE_PIPELINE = true;

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
 * Convert new LinkedIn agent output to legacy contactEnriched format
 * for backward compatibility with existing prompt and storage logic
 */
function convertToLegacyContactFormat(agentResult) {
    if (!agentResult || !agentResult.profile) {
        return {
            summary: null,
            careerHistory: null,
            education: null,
            recentActivity: null,
            communicationStyle: 'Professional',
            personalInsights: null,
            enrichmentLevel: agentResult?.enrichmentLevel || 'none',
            enrichmentSources: ['ai_agent'],
        };
    }

    const profile = agentResult.profile;

    // Convert career history to array of strings
    let careerHistory = null;
    if (profile.careerHistory && profile.careerHistory.length > 0) {
        careerHistory = profile.careerHistory.map(job =>
            `${job.title} at ${job.company}${job.period ? ` (${job.period})` : ''}`
        );
    }

    // Convert education to string
    let education = null;
    if (profile.education && profile.education.length > 0) {
        education = profile.education.map(edu =>
            `${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution}`
        ).join('; ');
    }

    return {
        summary: profile.summary || profile.headline,
        careerHistory,
        education,
        recentActivity: profile.recentActivity,
        communicationStyle: profile.communicationStyle || 'Professional',
        personalInsights: profile.personalInsights ? profile.personalInsights.join('; ') : null,
        styleEvidence: profile.styleEvidence,
        conversationStarters: agentResult.conversationStarters,
        doNotMention: agentResult.doNotMention,
        linkedInUrl: profile.linkedInUrl,
        enrichmentLevel: agentResult.enrichmentLevel || 'partial',
        enrichmentSources: ['ai_agent', ...(agentResult.sources?.map(s => s.type) || [])],
    };
}

/**
 * Format news signals for the AI prompt
 */
function formatNewsSignalsForPrompt(newsIntelligence) {
    if (!newsIntelligence || !newsIntelligence.signals || newsIntelligence.signals.length === 0) {
        return null;
    }

    const signals = newsIntelligence.signals
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 5); // Top 5 most relevant

    let promptSection = `\n## RECENT NEWS & TRIGGERS`;

    for (const signal of signals) {
        promptSection += `\n### ${signal.type.toUpperCase()}: ${signal.headline}`;
        promptSection += `\n- ${signal.summary}`;
        promptSection += `\n- Source: ${signal.source} (${signal.date || 'Recent'})`;
        promptSection += `\n- Suggested use: ${signal.suggestedUse}`;
        if (signal.talkingPoint) {
            promptSection += `\n- Talking point: "${signal.talkingPoint}"`;
        }
    }

    if (newsIntelligence.industryContext) {
        const ctx = newsIntelligence.industryContext;
        if (ctx.recentTrends && ctx.recentTrends.length > 0) {
            promptSection += `\n\n### INDUSTRY TRENDS`;
            ctx.recentTrends.forEach(trend => {
                promptSection += `\n- ${trend}`;
            });
        }
        if (ctx.competitorMoves && ctx.competitorMoves.length > 0) {
            promptSection += `\n\n### COMPETITOR ACTIVITY`;
            ctx.competitorMoves.forEach(move => {
                promptSection += `\n- ${move}`;
            });
        }
    }

    return promptSection;
}

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
        customLibraryContext,
        newsIntelligence,    // AI Agent news signals
        visitorContext,      // Visitor Intel website activity (URL param fallback)
        account360View,      // Account360 outbound_view (preferred over visitorContext)
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

    // Add news intelligence from AI research agent
    const newsSection = formatNewsSignalsForPrompt(newsIntelligence);
    if (newsSection) {
        prompt += newsSection;
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

    // Add Website Activity section — prefer Account360 outbound_view over raw visitorContext
    if (account360View) {
        const av = account360View;
        const contact = av.identity?.identifiedContacts?.[0];
        const highIntentList = (av.intentSignals?.highIntentPages || [])
            .map(p => p.tag || p.url || p).filter(Boolean).join(', ');
        prompt += `

## WEBSITE ACTIVITY (from Visitor Intel — Account360 intelligence)
- Company: ${av.companyName?.value || 'Unknown'} (${av.identity?.tier || 'unknown'} match, ${av.identity?.confidence ?? 0}/100 confidence)
- Intent Status: ${av.intentSignals?.status || 'unknown'} — Score: ${av.intentSignals?.currentScore?.value ?? 0}
${highIntentList ? `- High-intent pages: ${highIntentList}` : ''}
${av.intentSignals?.scoreExplanation?.[0] ? `- Why now: ${av.intentSignals.scoreExplanation[0]}` : ''}
${contact ? `- Identified contact: ${contact.name || ''} <${contact.email}>`.trim() : ''}
${av.recommendedNextAction?.value ? `- Recommended angle: ${av.recommendedNextAction.value}` : ''}

IMPORTANT: Include a "Website Activity" section in the brief showing this prospect's digital intent signals. Reference their browsing behavior, intent score, and high-intent pages visited. Use this intelligence to inform your discovery questions and meeting strategy.`;
    } else if (visitorContext) {
        prompt += `

## WEBSITE ACTIVITY (from Visitor Intel — visitor journey)
- Company: ${visitorContext.companyName || 'Unknown'} (${visitorContext.confidenceTier || 'unknown'} match, ${visitorContext.confidenceScore ?? 0}/100 confidence)
- Pages visited: ${(visitorContext.pagesVisited || []).join(', ') || 'none'}
- Visit count: ${visitorContext.visitCount || 1}
- Last seen: ${visitorContext.lastSeen || 'unknown'}
- Identity source: ${visitorContext.identitySource || 'unknown'}
${visitorContext.identifiedContact ? `- Identified contact: ${visitorContext.identifiedContact.name} <${visitorContext.identifiedContact.email}>` : ''}

IMPORTANT: Include a "Website Activity" section in the brief showing the visitor's journey timeline. Reference which pages they visited and how many times. Use their browsing behavior to inform your discovery questions and meeting strategy.`;
    }

    return prompt;
}

/**
 * Fetch company data from Google Places
 * First tries to find the company directly by name, then gets competitors if location available
 */
async function fetchCompanyData(prospectCompany, prospectWebsite, prospectLocation, prospectIndustry) {
    try {
        // First, try to find the company directly using Text Search
        // This works even without a location
        const companyResult = await googlePlaces.findCompanyLocation(prospectCompany, prospectWebsite);

        let companyData = null;

        if (companyResult.success) {
            console.log(`[GooglePlaces] Found company: ${companyResult.businessName} at ${companyResult.address}`);

            // Get detailed place info if we have a placeId
            if (companyResult.placeId) {
                const details = await googlePlaces.getPlaceDetails(companyResult.placeId);
                if (details.success && details.data) {
                    companyData = {
                        rating: details.data.rating || null,
                        reviewCount: details.data.reviewCount || null,
                        priceLevel: details.data.priceLevel || null,
                        types: details.data.types || null,
                        website: details.data.website || null,
                        address: details.data.address || companyResult.address,
                        phone: details.data.phone || null,
                        openingHours: details.data.openingHours || null,
                        competitors: [],
                    };
                }
            }

            // If we found the company's location, use it to find competitors
            const searchLocation = companyResult.location || prospectLocation;
            if (searchLocation && prospectIndustry) {
                const competitorResult = await googlePlaces.findCompetitors(
                    searchLocation,
                    prospectIndustry,
                    5000
                );

                if (competitorResult.success && competitorResult.competitors) {
                    // Filter out the prospect company from competitors list
                    const competitors = competitorResult.competitors
                        .filter(c =>
                            !c.name.toLowerCase().includes(prospectCompany.toLowerCase()) &&
                            !prospectCompany.toLowerCase().includes(c.name.toLowerCase())
                        )
                        .slice(0, 5);

                    if (companyData) {
                        companyData.competitors = competitors;
                    } else {
                        companyData = { competitors };
                    }
                }
            }
        } else if (prospectLocation) {
            // Fallback: use old method with location-based search
            console.log(`[GooglePlaces] Direct company search failed, trying location-based search`);
            const result = await googlePlaces.findCompetitors(prospectLocation, prospectIndustry || prospectCompany, 2000);

            if (result.success && result.competitors && result.competitors.length > 0) {
                // Find the closest match to our prospect company
                const prospect = result.competitors.find(c =>
                    c.name.toLowerCase().includes(prospectCompany.toLowerCase()) ||
                    prospectCompany.toLowerCase().includes(c.name.toLowerCase())
                );

                companyData = {
                    rating: prospect?.rating || null,
                    reviewCount: prospect?.reviewCount || null,
                    priceLevel: prospect?.priceLevel || null,
                    types: prospect?.types || null,
                    competitors: result.competitors.filter(c => c.name !== prospect?.name).slice(0, 5)
                };
            }
        }

        if (companyData) {
            console.log(`[GooglePlaces] Company data retrieved: rating=${companyData.rating}, competitors=${companyData.competitors?.length || 0}`);
        } else {
            console.log(`[GooglePlaces] No company data found for ${prospectCompany}`);
        }

        return companyData;
    } catch (error) {
        console.warn('[GooglePlaces] Company data fetch failed:', error.message);
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

/**
 * Fetch seller context from user's profile
 * This includes their company info, industry, and products/services
 */
/**
 * Fetch seller context from user profile or specific seller profile
 * @param {string} userId - User ID
 * @param {string|null} profileId - Optional profile ID for multi-profile support
 * @returns {object|null} Seller context
 */
async function fetchSellerContext(userId, profileId = null) {
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return null;

        const userData = userDoc.data();

        // Check for multi-profile setup
        const sellerProfiles = userData.sellerProfiles || [];

        // If profileId is specified, use that profile
        // Otherwise, use primary profile if available
        // Fall back to legacy data if no profiles
        let selectedProfile = null;

        if (sellerProfiles.length > 0) {
            if (profileId) {
                selectedProfile = sellerProfiles.find(p => p.id === profileId);
                if (!selectedProfile) {
                    console.warn(`[SellerContext] Profile ${profileId} not found, using primary`);
                }
            }
            if (!selectedProfile) {
                selectedProfile = sellerProfiles.find(p => p.isPrimary) || sellerProfiles[0];
            }
        }

        // If we have a selected profile, use it
        if (selectedProfile) {
            const sellerContext = {
                profileId: selectedProfile.id,
                profileName: selectedProfile.name,
                sellerCompany: selectedProfile.companyName,
                sellerIndustry: selectedProfile.industry || null,
                sellerWebsite: selectedProfile.website || null,
                yearsInBusiness: selectedProfile.yearsInBusiness || null,
                companySize: selectedProfile.companySize || null,
                sellerProducts: (selectedProfile.products || []).map(p => ({
                    name: p.name || p.productName,
                    description: p.description || p.productDescription || '',
                    pricing: p.pricing || null,
                    features: p.features || [],
                    useCases: p.useCases || [],
                    isPrimary: p.isPrimary || p.primary || false,
                })),
            };

            console.log(`[SellerContext] Using profile "${selectedProfile.name}" for user ${userId}: company=${sellerContext.sellerCompany}, products=${sellerContext.sellerProducts.length}`);
            return sellerContext;
        }

        // Fallback to legacy data structure
        // Debug: log available fields to help troubleshoot
        const availableFields = Object.keys(userData).filter(k => !['createdAt', 'updatedAt', 'lastLogin'].includes(k));
        console.log(`[SellerContext] No profiles found, using legacy data. Available fields:`, availableFields.join(', '));

        // Extract seller context from user profile
        // Support multiple data structures:
        // - SynchIntro onboarding: companyName, industry, website, products[]
        // - Settings page: company.name, company.industry, company.website
        // - Legacy: company (string), businessIndustry
        const sellerContext = {
            profileId: null,
            profileName: null,
            sellerCompany: userData.companyName ||
                           userData.company?.name ||
                           (typeof userData.company === 'string' ? userData.company : null),
            sellerIndustry: userData.industry ||
                            userData.businessIndustry ||
                            userData.company?.industry ||
                            null,
            sellerWebsite: userData.website ||
                           userData.websiteUrl ||
                           userData.company?.website ||
                           null,
            yearsInBusiness: userData.yearsInBusiness || userData.company?.yearsInBusiness || null,
            companySize: userData.companySize || userData.company?.companySize || null,
            sellerProducts: [],
        };

        // Check for products in user profile (from SynchIntro or settings)
        const productsArray = userData.products || [];
        if (Array.isArray(productsArray) && productsArray.length > 0) {
            sellerContext.sellerProducts = productsArray.map(p => ({
                name: p.name || p.productName,
                description: p.description || p.productDescription || '',
                pricing: p.pricing || null,
                features: p.features || [],
                useCases: p.useCases || [],
                isPrimary: p.isPrimary || p.primary || p.isMain || false,
            }));
        }

        // Also check for services (some users may define services instead of products)
        const servicesArray = userData.services || [];
        if (Array.isArray(servicesArray) && servicesArray.length > 0) {
            const services = servicesArray.map(s => ({
                name: s.name || s.serviceName,
                description: s.description || s.serviceDescription || '',
                pricing: s.pricing || null,
                features: s.features || [],
                useCases: s.useCases || [],
                isPrimary: s.isPrimary || s.primary || false,
            }));
            sellerContext.sellerProducts = [...sellerContext.sellerProducts, ...services];
        }

        console.log(`[SellerContext] Loaded legacy data for user ${userId}: company=${sellerContext.sellerCompany}, industry=${sellerContext.sellerIndustry}, products=${sellerContext.sellerProducts.length}`);

        return sellerContext;
    } catch (error) {
        console.warn('Seller context fetch failed:', error.message);
        return null;
    }
}

/**
 * Legacy brief generation (single-pass method)
 * Used as fallback when intelligence pipeline fails
 */
async function generateLegacyBrief(params) {
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
        customLibraryContext,
        newsIntelligence,
        visitorContext,
        account360View,
        userId,
    } = params;

    console.log('[Legacy] Using single-pass brief generation');

    // Build prompt using old method
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
        customLibraryContext,
        newsIntelligence,
        visitorContext,
        account360View,
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
        if (typeof aiResult.narrative === 'object' && aiResult.narrative !== null) {
            briefContent = aiResult.narrative;
        } else if (typeof aiResult.narrative === 'string') {
            const jsonMatch = aiResult.narrative.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                briefContent = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } else {
            throw new Error('Unexpected response format from AI');
        }
    } catch (parseError) {
        console.error('[Legacy] Failed to parse AI response:', parseError.message);
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

    return briefContent;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /precall-briefs/match-market-report
 * Find a matching market report based on industry and location
 * Uses fuzzy matching for industry (partial, case-insensitive) and location (city/state)
 */
router.get('/precall-briefs/match-market-report', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                matched: false,
                error: 'Authentication required'
            });
        }

        const { industry, location } = req.query;

        // Require at least one parameter
        if (!industry && !location) {
            return res.status(200).json({
                success: true,
                matched: false,
                report: null
            });
        }

        // Fetch user's market reports
        const reportsSnapshot = await db.collection('marketReports')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        if (reportsSnapshot.empty) {
            return res.status(200).json({
                success: true,
                matched: false,
                report: null
            });
        }

        const reports = reportsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Fuzzy matching logic
        const industryLower = (industry || '').toLowerCase().trim();
        const locationLower = (location || '').toLowerCase().trim();

        let bestMatch = null;

        for (const report of reports) {
            const reportIndustry = (report.industry?.display || '').toLowerCase();
            const reportCity = (report.location?.city || '').toLowerCase();
            const reportState = (report.location?.state || '').toLowerCase();

            // Industry match - partial, case-insensitive
            let industryMatches = false;
            if (industryLower) {
                industryMatches = reportIndustry.includes(industryLower) ||
                                  industryLower.includes(reportIndustry) ||
                                  reportIndustry.split(/\s+/).some(word => industryLower.includes(word)) ||
                                  industryLower.split(/\s+/).some(word => reportIndustry.includes(word));
            }

            // Location match - check city and state
            let locationMatches = false;
            if (locationLower) {
                locationMatches = locationLower.includes(reportCity) ||
                                  reportCity.includes(locationLower) ||
                                  locationLower.includes(reportState) ||
                                  reportState.includes(locationLower) ||
                                  // Handle "City, State" format
                                  locationLower.includes(reportCity + ',') ||
                                  locationLower.includes(reportCity + ' ');
            }

            // Match if both criteria are provided and match, or if only one is provided and matches
            const isMatch = (industryLower && locationLower)
                ? (industryMatches && locationMatches)
                : (industryMatches || locationMatches);

            if (isMatch) {
                bestMatch = report;
                break; // First match wins (already sorted by createdAt desc)
            }
        }

        if (!bestMatch) {
            return res.status(200).json({
                success: true,
                matched: false,
                report: null
            });
        }

        // Calculate average rating
        const competitors = bestMatch.data?.competitors || [];
        const ratedCompetitors = competitors.filter(c => c.rating && c.rating > 0);
        const avgRating = ratedCompetitors.length > 0
            ? (ratedCompetitors.reduce((sum, c) => sum + c.rating, 0) / ratedCompetitors.length).toFixed(1)
            : null;

        return res.status(200).json({
            success: true,
            matched: true,
            report: {
                id: bestMatch.id,
                industry: bestMatch.industry?.display || bestMatch.industry || null,
                location: `${bestMatch.location?.city || ''}${bestMatch.location?.state ? ', ' + bestMatch.location.state : ''}`,
                city: bestMatch.location?.city || null,
                state: bestMatch.location?.state || null,
                competitorCount: bestMatch.data?.competitorCount || competitors.length,
                avgRating: avgRating ? parseFloat(avgRating) : null,
                opportunityScore: bestMatch.data?.opportunityScore?.score || null,
                createdAt: bestMatch.createdAt
            }
        });
    } catch (error) {
        console.error('Match market report error:', error);
        return res.status(200).json({
            success: false,
            matched: false,
            report: null,
            error: 'Failed to match market report'
        });
    }
});

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
            useCustomLibrary,
            // Product selection - allows user to focus on a specific product/service
            selectedProductId,
            selectedProductName,
            // Seller profile selection - for agencies with multiple profiles
            sellerProfileId,
            // Market intelligence - optional market report to enrich the brief
            marketReportId,
            // Instantly.ai integration - imported lead source
            instantlySource,
            // Seller context from form (fallback if no profile loaded)
            sellerCompany,
            sellerIndustry: sellerIndustryFromForm,
            productDescription,
            callObjective,
            // Visitor Intel context (from visitor card navigation)
            visitorContext,
            // Account360 accountKey — used to fetch outbound_view for enrichment (Sprint 5)
            accountKey,
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
            sellerProfileId: sellerProfileId || null, // Multi-profile support for agencies
            marketReportId: marketReportId || null, // Market intelligence enrichment
            instantlySource: instantlySource || null, // Instantly.ai imported lead source
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

        // Research Phase: Run AI agents in parallel for contact and news intelligence
        let contactEnriched = null;
        let contactIntelligence = null;
        let newsIntelligence = null;

        if (USE_AI_RESEARCH_AGENTS) {
            console.log(`[AI Research] Starting research for ${prospectCompany} (tier: ${userStatus.tier}, canEnrichContact: ${userStatus.canEnrichContact})`);
            const researchStartTime = Date.now();

            // Build agent requests based on tier
            const agentRequests = [];

            // Contact research (LinkedIn agent) - Growth+ tiers only
            if (userStatus.canEnrichContact && (contactLinkedIn || contactName)) {
                agentRequests.push({
                    agent: 'linkedin-research',
                    input: {
                        contactName,
                        contactTitle,
                        contactLinkedIn,
                        prospectCompany,
                        industry: prospectIndustry,
                    },
                });
            }

            // News research (News Intelligence agent) - ALL tiers (public company data)
            agentRequests.push({
                agent: 'news-intelligence',
                input: {
                    companyName: prospectCompany,
                    websiteUrl: prospectWebsite,
                    industry: prospectIndustry,
                    location: prospectLocation,
                    contactName,
                },
            });

            if (agentRequests.length > 0) {
                const agentResults = await invokeAgentsParallel(agentRequests);
                console.log(`[AI Research] Research completed in ${agentResults.elapsed}ms (${agentResults.successfulAgents}/${agentResults.totalAgents} successful)`);

                // Extract contact intelligence (Growth+ only)
                if (agentResults.results['linkedin-research']?.success) {
                    contactIntelligence = agentResults.results['linkedin-research'].data;

                    // Convert to legacy contactEnriched format for backward compatibility
                    contactEnriched = convertToLegacyContactFormat(contactIntelligence);
                }

                // Extract news intelligence (all tiers)
                if (agentResults.results['news-intelligence']?.success) {
                    newsIntelligence = agentResults.results['news-intelligence'].data;
                    console.log(`[AI Research] News signals found: ${newsIntelligence.signalCount || newsIntelligence.signals?.length || 0}`);
                } else if (agentResults.results['news-intelligence']?.error) {
                    console.warn(`[AI Research] News agent failed: ${agentResults.results['news-intelligence'].error}`);
                }
            }
        }

        // Run all data fetches in parallel — each is independent of the others.
        // Promise.allSettled ensures one failure doesn't block the brief from generating.
        const needsContactFallback = !contactEnriched && userStatus.canEnrichContact && (contactLinkedIn || contactName);
        const needsLibrary = !!(useCustomLibrary && userStatus.hasCustomLibrary);

        console.log(`[Brief] Starting parallel data fetch (contactFallback=${needsContactFallback}, library=${needsLibrary}, marketReport=${!!marketReportId})`);
        const parallelStart = Date.now();

        // Wrap each parallel call with an 8s individual timeout so a hung external
        // call never blocks the entire brief generation.
        const withTimeout = (p, label) => Promise.race([
            p,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after 8s`)), 8000))
        ]);

        const [
            contactFallbackResult,
            companyDataResult,
            customLibraryResult,
            marketContextResult,
            sellerContextResult,
        ] = await Promise.allSettled([
            // 1. Contact enricher fallback (only if AI agents didn't populate it)
            needsContactFallback
                ? withTimeout(
                    (console.log('[AI Research] Using legacy contact enricher as fallback'),
                     contactEnricher.enrichContact({ contactLinkedIn, contactName, contactTitle, prospectCompany })),
                    'contactEnricher')
                : Promise.resolve(null),

            // 2. Company data from Google Places
            withTimeout(fetchCompanyData(prospectCompany, prospectWebsite, prospectLocation, prospectIndustry), 'fetchCompanyData'),

            // 3. Custom Sales Library context
            needsLibrary ? withTimeout(fetchCustomLibraryContext(userId), 'fetchCustomLibraryContext') : Promise.resolve(null),

            // 4. Market intelligence from attached report
            marketReportId ? withTimeout((async () => {
                const reportDoc = await db.collection('marketReports').doc(marketReportId).get();
                if (!reportDoc.exists) {
                    console.warn(`[Market Context] Market report ${marketReportId} not found`);
                    return null;
                }
                const report = reportDoc.data();
                const competitors = report.data?.competitors || [];
                const ratedCompetitors = competitors.filter(c => c.rating);
                const avgRating = ratedCompetitors.length > 0
                    ? (ratedCompetitors.reduce((sum, c) => sum + c.rating, 0) / ratedCompetitors.length).toFixed(1)
                    : null;
                const ctx = {
                    reportId: marketReportId,
                    location: report.location || null,
                    industry: report.industry || null,
                    competitorCount: report.data?.competitorCount || competitors.length,
                    avgRating: avgRating ? parseFloat(avgRating) : null,
                    topCompetitors: competitors.slice(0, 5).map(c => ({
                        name: c.name || null,
                        rating: c.rating || null,
                        reviews: c.reviews || null,
                        website: c.website || null
                    })),
                    opportunityScore: report.data?.opportunityScore?.score || null,
                    opportunityLevel: report.data?.opportunityScore?.level || null,
                    opportunityFactors: report.data?.opportunityScore?.topFactors || [],
                    saturation: report.data?.saturation || null,
                    saturationScore: report.data?.saturationScore || null,
                    growthRate: report.data?.growthRate || null,
                    demographics: {
                        population: report.data?.demographics?.population || null,
                        medianIncome: report.data?.demographics?.medianIncome || null,
                        households: report.data?.demographics?.households || null
                    },
                    demandSignals: report.data?.demandSignals || null,
                    executiveSummary: report.data?.executiveSummary || null
                };
                console.log(`[Market Context] Loaded market report: ${report.location?.city}, ${report.industry?.display} with ${ctx.competitorCount} competitors`);
                return ctx;
            })(), 'fetchMarketContext') : Promise.resolve(null),

            // 5. Seller context from user profile
            withTimeout(fetchSellerContext(userId, sellerProfileId), 'fetchSellerContext'),
        ]);

        console.log(`[Brief] Parallel data fetch completed in ${Date.now() - parallelStart}ms`);

        // Extract results with graceful degradation — a failed fetch never crashes the brief
        if (needsContactFallback && contactFallbackResult.status === 'fulfilled' && contactFallbackResult.value) {
            contactEnriched = contactFallbackResult.value;
        } else if (contactFallbackResult.status === 'rejected') {
            console.warn('[Brief] Contact enricher fallback failed:', contactFallbackResult.reason?.message);
        }

        const companyData = companyDataResult.status === 'fulfilled' ? companyDataResult.value : null;
        if (companyDataResult.status === 'rejected') {
            console.warn('[Brief] fetchCompanyData failed:', companyDataResult.reason?.message);
        }

        const customLibraryContext = customLibraryResult.status === 'fulfilled' ? customLibraryResult.value : null;
        if (customLibraryResult.status === 'rejected') {
            console.warn('[Brief] fetchCustomLibraryContext failed:', customLibraryResult.reason?.message);
        }

        let marketContext = marketContextResult.status === 'fulfilled' ? marketContextResult.value : null;
        if (marketContextResult.status === 'rejected') {
            console.error('[Brief] Market report fetch failed:', marketContextResult.reason?.message);
        }

        let sellerContext = sellerContextResult.status === 'fulfilled' ? sellerContextResult.value : null;
        if (sellerContextResult.status === 'rejected') {
            console.warn('[Brief] fetchSellerContext failed:', sellerContextResult.reason?.message);
        }

        // If no seller context or missing company, use form values as fallback
        if (!sellerContext || !sellerContext.sellerCompany) {
            console.log(`[SellerContext] No profile data, using form values: company=${sellerCompany}, industry=${sellerIndustryFromForm}`);
            sellerContext = {
                ...sellerContext,
                sellerCompany: sellerCompany || sellerContext?.sellerCompany || null,
                sellerIndustry: sellerIndustryFromForm || sellerContext?.sellerIndustry || null,
                sellerProducts: sellerContext?.sellerProducts || [],
            };
        }

        // If product description provided in form but no products in profile, create a temporary product
        if (productDescription && (!sellerContext.sellerProducts || sellerContext.sellerProducts.length === 0)) {
            console.log(`[SellerContext] Using form product description as fallback`);
            sellerContext.sellerProducts = [{
                name: 'Primary Product/Service',
                description: productDescription,
                isPrimary: true,
            }];
        }

        // Determine selected product (if user specified one)
        let selectedProduct = null;
        if (sellerContext && sellerContext.sellerProducts?.length > 0) {
            if (selectedProductId || selectedProductName) {
                // Find the specific product user wants to focus on
                selectedProduct = sellerContext.sellerProducts.find(p =>
                    p.name === selectedProductName ||
                    p.name?.toLowerCase() === selectedProductName?.toLowerCase()
                );
                if (selectedProduct) {
                    console.log(`[SellerContext] User selected product: ${selectedProduct.name}`);
                }
            }
            // If no specific selection, use primary product if one is marked
            if (!selectedProduct) {
                selectedProduct = sellerContext.sellerProducts.find(p => p.isPrimary) || null;
            }
        }

        // Account360 outbound_view enrichment — read when accountKey provided (Sprint 5)
        let account360View = null;
        if (accountKey) {
            try {
                const viewRef = db.collection('Account360').doc(accountKey)
                    .collection('agentViews').doc('outbound_view');
                const viewSnap = await viewRef.get();
                if (viewSnap.exists) {
                    const viewData = viewSnap.data();
                    const expiresAt = viewData.expiresAt?.toDate?.() || new Date(viewData.expiresAt);
                    if (expiresAt > new Date()) {
                        account360View = viewData;
                        console.log('[Account360] outbound_view hit for brief, accountKey', accountKey);
                    }
                }
            } catch (err) {
                console.warn('[Account360] outbound_view read failed (non-blocking):', err.message);
            }
        }

        // Generate brief using Intelligence Pipeline or fallback to old method
        let briefContent;
        let pipelineMetadata = null;

        if (USE_INTELLIGENCE_PIPELINE) {
            try {
                console.log(`[Intelligence Pipeline] Starting two-pass generation for ${prospectCompany}`);
                console.log(`[Intelligence Pipeline] Seller: ${sellerContext?.sellerCompany || 'Not provided'}, Industry: ${sellerContext?.sellerIndustry || 'Not provided'}`);
                console.log(`[Intelligence Pipeline] Products: ${sellerContext?.sellerProducts?.length || 0}, Selected: ${selectedProduct?.name || 'None'}`);
                if (productDescription) {
                    console.log(`[Intelligence Pipeline] Form product description: ${productDescription.substring(0, 100)}...`);
                }

                // Use the new intelligence pipeline
                const intelligentBrief = await generateIntelligentBrief({
                    userId, // For LinkedIn profile comparison
                    prospectCompany,
                    prospectWebsite,
                    prospectIndustry,
                    prospectLocation,
                    contactName,
                    contactTitle,
                    contactLinkedIn,
                    meetingType: meetingContext || 'discovery',
                    userTier: userStatus.tier,
                    customSalesLibrary: customLibraryContext,
                    // Seller context from user profile
                    sellerCompany: sellerContext?.sellerCompany,
                    sellerIndustry: sellerContext?.sellerIndustry,
                    sellerProducts: sellerContext?.sellerProducts || [],
                    selectedProduct: selectedProduct,
                    // Pass existing data sources
                    websiteAnalysis: null, // Could be populated from website scraper in future
                    companyIntelligence: companyData,
                    contactEnriched: contactEnriched,
                    // New AI agent intelligence (Sales Intelligence Trifecta)
                    contactIntelligence: contactIntelligence,
                    newsIntelligence: newsIntelligence,
                    // Market intelligence from attached report
                    marketContext: marketContext,
                }, geminiClientV2);

                // Extract pipeline metadata
                pipelineMetadata = {
                    version: intelligentBrief._pipeline?.version,
                    phase: intelligentBrief._pipeline?.phase,
                    totalLatencyMs: intelligentBrief._pipeline?.totalLatencyMs,
                    signalCount: intelligentBrief._insights?.signalCount,
                    qualityCheck: intelligentBrief._pipeline?.stages?.generation?.qualityCheck,
                };

                // Remove internal metadata from brief content
                const { _pipeline, _insights, _meta, ...cleanBrief } = intelligentBrief;
                briefContent = cleanBrief;

                console.log(`[Intelligence Pipeline] Completed in ${pipelineMetadata.totalLatencyMs}ms`);

            } catch (pipelineError) {
                console.error('[Intelligence Pipeline] Failed, falling back to legacy method:', pipelineError.message);

                // Fallback to old single-pass method
                briefContent = await generateLegacyBrief({
                    prospectCompany,
                    prospectWebsite,
                    prospectIndustry,
                    prospectLocation,
                    contactName,
                    contactTitle,
                    contactEnriched,
                    meetingContext,
                    companyData,
                    customLibraryContext,
                    newsIntelligence,
                    visitorContext,
                    account360View,
                    userId,
                });
                pipelineMetadata = { fallback: true, error: pipelineError.message };
            }
        } else {
            // Use old single-pass method
            briefContent = await generateLegacyBrief({
                prospectCompany,
                prospectWebsite,
                prospectIndustry,
                prospectLocation,
                contactName,
                contactTitle,
                contactEnriched,
                meetingContext,
                companyData,
                customLibraryContext,
                newsIntelligence,
                visitorContext,
                account360View,
                userId,
            });
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
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            // Intelligence pipeline metadata
            pipelineVersion: pipelineMetadata?.version || null,
            pipelinePhase: pipelineMetadata?.phase || null,
            generationLatencyMs: pipelineMetadata?.totalLatencyMs || null,
            signalCount: pipelineMetadata?.signalCount || 0,
            usedFallback: pipelineMetadata?.fallback || false,
            // AI Research Agent Intelligence (Sales Intelligence Trifecta)
            contactIntelligence: contactIntelligence ? {
                enrichmentLevel: contactIntelligence.enrichmentLevel,
                profile: contactIntelligence.profile || null,
                conversationStarters: contactIntelligence.conversationStarters || [],
                doNotMention: contactIntelligence.doNotMention || [],
                sources: contactIntelligence.sources || [],
                _meta: contactIntelligence._meta || null,
            } : null,
            newsIntelligence: newsIntelligence ? {
                signalCount: newsIntelligence.signalCount || 0,
                signals: (newsIntelligence.signals || []).slice(0, 10), // Top 10 signals
                industryContext: newsIntelligence.industryContext || null,
                researchDate: newsIntelligence.researchDate || new Date().toISOString(),
                _meta: newsIntelligence._meta || null,
            } : null,
            usedAIAgents: USE_AI_RESEARCH_AGENTS && (contactIntelligence || newsIntelligence),
            // Market intelligence from attached report
            marketContext: marketContext || null,
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
 * GET /precall-briefs/:id/pdf
 * Generate and download a PDF of the pre-call brief
 */
router.get('/precall-briefs/:id/pdf', async (req, res) => {
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

        if (brief.status !== 'ready') {
            throw new ApiError('Brief is still generating', 400, ErrorCodes.VALIDATION_ERROR);
        }

        console.log(`[PDF] Generating PDF for brief ${briefId} (${brief.prospectCompany})`);

        // Generate PDF
        const pdfBuffer = await generateBriefPdf({
            ...brief,
            meetingDate: brief.meetingDate?.toDate?.() || null,
        });

        // Create filename
        const safeCompanyName = (brief.prospectCompany || 'brief')
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 30);
        const filename = `PreCall_Brief_${safeCompanyName}_${new Date().toISOString().split('T')[0]}.pdf`;

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        return res.send(pdfBuffer);

    } catch (error) {
        return handleError(error, res, 'GET /precall-briefs/:id/pdf');
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
