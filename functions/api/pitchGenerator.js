/**
 * PathSynch Pitch Generator
 * Version: 3.2.0
 * Last Updated: January 27, 2026
 *
 * Changes in 3.2.0:
 * - Added booking integration (Calendly/Cal.com) support
 * - Level 2 & 3: CTA buttons now link to booking URL if provided
 * - Added white-label support (hideBranding option)
 * - Added custom branding colors support
 *
 * Changes in 3.1.0:
 * - Level 2: Fixed shareable link display size, added top bar, added PathSynch products section
 * - Level 3 Slide 2: Yellow line stretches across page
 * - Level 3 Slide 7: Added "Recommended" before "90-Day Rollout"
 * - Level 3 Slide 8: Renamed to "PathSynch Package for {Business Name}", brand color box
 * - Level 3 Slide 9: Restored to previous version layout
 * - Level 3 Slide 10: Removed telephone number
 */

const admin = require('firebase-admin');
const reviewAnalytics = require('../services/reviewAnalytics');
const { calculatePitchROI, formatCurrency, safeNumber } = require('../utils/roiCalculator');
const { getIndustryIntelligence } = require('../config/industryIntelligence');
const naics = require('../config/naics');
const precallFormService = require('../services/precallForm');

// Extracted modules
const { PITCH_LIMITS, checkPitchLimit, incrementPitchCount } = require('./pitch/validators');
const { buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData } = require('./pitch/dataEnricher');
const { adjustColor, truncateText, CONTENT_LIMITS } = require('./pitch/htmlBuilder');
const { generateLevel1 } = require('./pitch/level1Generator');
const { generateLevel2 } = require('./pitch/level2Generator');
const { generateLevel3 } = require('./pitch/level3Generator');

// Get Firestore reference
function getDb() {
    return admin.firestore();
}

// Generate unique IDs
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Use shared ROI calculator
const calculateROI = calculatePitchROI;

// Note: PITCH_LIMITS, checkPitchLimit, incrementPitchCount imported from ./pitch/validators.js
// Note: buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData imported from ./pitch/dataEnricher.js
// Note: adjustColor, truncateText, CONTENT_LIMITS imported from ./pitch/htmlBuilder.js
// Note: generateLevel1 imported from ./pitch/level1Generator.js
// Note: generateLevel2 imported from ./pitch/level2Generator.js
// Note: generateLevel3 imported from ./pitch/level3Generator.js

// ============================================
// API HANDLERS (for index.js)
// ============================================

/**
 * Generate a new pitch - handles POST /generate-pitch
 */
async function generatePitch(req, res) {
    try {
        const db = getDb();
        const body = req.body;
        const userId = req.userId || 'anonymous';

        // Check pitch limit before generating
        if (userId !== 'anonymous') {
            const limitCheck = await checkPitchLimit(userId);
            if (!limitCheck.allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'PITCH_LIMIT_REACHED',
                    message: `You've reached your monthly limit of ${limitCheck.limit} pitches. Upgrade your plan for more.`,
                    used: limitCheck.used,
                    limit: limitCheck.limit,
                    tier: limitCheck.tier
                });
            }
        }

        // Extract trigger event data (news article, social post, etc.)
        const triggerEvent = body.triggerEvent || null;

        // Map request body to inputs format
        let inputs = {
            businessName: body.businessName,
            contactName: body.contactName || 'Business Owner',
            address: body.address,
            websiteUrl: body.websiteUrl,
            googleRating: body.googleRating,
            numReviews: body.numReviews,
            industry: body.industry,
            subIndustry: body.subIndustry,
            statedProblem: body.statedProblem || 'increasing customer engagement and visibility',
            monthlyVisits: body.monthlyVisits,
            avgTransaction: body.avgTransaction,
            avgTicket: body.avgTransaction || body.avgTicket,
            repeatRate: body.repeatRate || 0.4,
            // Trigger event for personalized opening
            triggerEvent: triggerEvent
        };

        // Market intelligence data (from market report integration)
        const marketData = body.marketData || null;

        // Get NAICS code for industry-specific defaults and growth rates
        let naicsCode = null;
        if (marketData && marketData.industry && marketData.industry.naicsCode) {
            // Use NAICS code from market intel
            naicsCode = marketData.industry.naicsCode;
        } else if (body.subIndustry || body.industry) {
            // Look up NAICS code from industry/subIndustry
            const naicsCodes = naics.getNaicsByDisplay(body.subIndustry || body.industry);
            naicsCode = naicsCodes[0] || null;
        }

        // Get industry defaults for ROI calculation
        const industryDefaults = naicsCode ? naics.getIndustryDefaults(naicsCode) : null;

        // Override defaults with market intel data if available
        if (marketData && marketData.industry) {
            // Use dynamic avgTransaction from market intel (e.g., $450 for auto repair)
            if (marketData.industry.avgTransaction) {
                inputs.avgTransaction = marketData.industry.avgTransaction;
                inputs.avgTicket = marketData.industry.avgTransaction;
            }
            // Use dynamic monthlyCustomers from market intel (e.g., 200 for local auto shop)
            if (marketData.industry.monthlyCustomers) {
                inputs.monthlyVisits = marketData.industry.monthlyCustomers;
            }
        } else if (industryDefaults) {
            // No market data - use industry defaults from NAICS config
            if (!inputs.avgTransaction && !inputs.avgTicket) {
                inputs.avgTransaction = industryDefaults.avgTransaction;
                inputs.avgTicket = industryDefaults.avgTransaction;
            }
            if (!inputs.monthlyVisits) {
                inputs.monthlyVisits = industryDefaults.monthlyCustomers;
            }
        }

        // Pre-call form enhancement (Enterprise feature)
        let precallFormData = null;
        const precallFormId = body.precallFormId || null;

        if (precallFormId && userId !== 'anonymous') {
            precallFormData = await getPrecallFormEnhancement(precallFormId, userId);
            if (precallFormData) {
                console.log('Enhancing pitch with pre-call form data:', precallFormId);
                inputs = enhanceInputsWithPrecallData(inputs, precallFormData);
            }
        }

        const level = parseInt(body.pitchLevel) || 3;

        // Analyze reviews using the enhanced review analytics service
        let reviewData = {
            sentiment: { positive: 65, neutral: 25, negative: 10 },
            topThemes: ['Quality products', 'Excellent service', 'Great atmosphere', 'Good value'],
            staffMentions: [],
            differentiators: ['Unique offerings', 'Personal touch', 'Community focus'],
            analytics: null,
            pitchMetrics: null
        };

        if (body.googleReviews && body.googleReviews.length > 50) {
            // Use enhanced review analytics
            const analytics = reviewAnalytics.analyzeReviews(
                body.googleReviews,
                parseFloat(body.googleRating) || null,
                parseInt(body.numReviews) || null
            );

            reviewData.analytics = analytics;
            reviewData.pitchMetrics = reviewAnalytics.getPitchMetrics(analytics);

            // Simple theme extraction from review text
            const reviewText = body.googleReviews.toLowerCase();
            const themes = [];

            if (reviewText.includes('friendly') || reviewText.includes('helpful')) themes.push('Friendly and helpful staff');
            if (reviewText.includes('quick') || reviewText.includes('fast')) themes.push('Quick service');
            if (reviewText.includes('clean') || reviewText.includes('neat')) themes.push('Clean environment');
            if (reviewText.includes('quality') || reviewText.includes('great')) themes.push('Quality products/service');
            if (reviewText.includes('price') || reviewText.includes('value')) themes.push('Good value for money');
            if (reviewText.includes('recommend')) themes.push('Highly recommended by customers');

            if (themes.length > 0) {
                reviewData.topThemes = themes.slice(0, 4);
            }

            // Use analytics-derived sentiment based on quality data
            if (analytics.quality && analytics.quality.distributionPct) {
                const pct = analytics.quality.distributionPct;
                reviewData.sentiment = {
                    positive: (pct[5] || 0) + (pct[4] || 0),
                    neutral: pct[3] || 0,
                    negative: (pct[2] || 0) + (pct[1] || 0)
                };
            } else {
                // Fallback: Adjust sentiment based on rating
                const rating = parseFloat(body.googleRating) || 4.0;
                if (rating >= 4.5) {
                    reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
                } else if (rating >= 4.0) {
                    reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
                } else if (rating >= 3.5) {
                    reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
                }
            }
        } else {
            // No review text provided - adjust sentiment based on rating only
            const rating = parseFloat(body.googleRating) || 4.0;
            if (rating >= 4.5) {
                reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
            } else if (rating >= 4.0) {
                reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
            } else if (rating >= 3.5) {
                reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
            }
        }

        // Calculate ROI with industry-specific growth rate
        const roiData = calculateROI(inputs, naicsCode);
        console.log(`ROI calculated with ${roiData.growthRate}% growth rate for ${roiData.industryName || 'default industry'}`);

        // userId already declared above for pre-call form enhancement

        // Get user data for creator info and seller profile
        let creatorInfo = {
            userId: userId,
            email: null,
            displayName: null
        };
        let sellerProfile = body.sellerProfile || null;

        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    creatorInfo.email = userData.email || null;
                    creatorInfo.displayName = userData.profile?.displayName || userData.displayName || null;

                    // Get seller profile from user document if not provided in request
                    if (!sellerProfile && userData.sellerProfile) {
                        sellerProfile = userData.sellerProfile;
                    }
                }
            } catch (e) {
                console.log('Could not fetch user data:', e.message);
            }
        }

        // Build seller context (uses defaults if no seller profile)
        // Pass icpId for multi-ICP support - allows selecting specific ICP persona
        const icpId = body.icpId || null;
        const sellerContext = buildSellerContext(sellerProfile, icpId);

        // Extract booking/branding options - prefer seller profile values
        const options = {
            bookingUrl: body.bookingUrl || null,
            hideBranding: body.hideBranding || false,
            primaryColor: body.primaryColor || sellerContext.primaryColor || '#3A6746',
            accentColor: body.accentColor || sellerContext.accentColor || '#D4A847',
            companyName: body.companyName || sellerContext.companyName || 'PathSynch',
            contactEmail: body.contactEmail || 'hello@pathsynch.com',
            logoUrl: body.logoUrl || sellerContext.logoUrl || null,
            // Pass full seller context for dynamic content
            sellerContext: sellerContext
        };

        // Generate IDs first (needed for tracking in generated HTML)
        const pitchId = generateId();
        const shareId = generateId();

        // Generate HTML based on level (with optional market data and pitchId for tracking)
        let html;
        switch (level) {
            case 1:
                html = generateLevel1(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 2:
                html = generateLevel2(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
            case 3:
            default:
                html = generateLevel3(inputs, reviewData, roiData, options, marketData, pitchId);
                break;
        }

        // Create pitch document
        const pitchData = {
            pitchId,
            shareId,
            userId,

            // Creator attribution (for team analytics)
            creatorInfo,

            // Business info
            businessName: inputs.businessName,
            contactName: inputs.contactName,
            address: inputs.address,
            websiteUrl: inputs.websiteUrl,

            // Google data
            googleRating: inputs.googleRating,
            numReviews: inputs.numReviews,

            // Classification
            industry: inputs.industry,
            subIndustry: inputs.subIndustry,
            pitchLevel: level,

            // Generated content
            html,
            roiData,
            reviewAnalysis: reviewData,
            reviewAnalytics: reviewData.analytics || null,
            reviewPitchMetrics: reviewData.pitchMetrics || null,

            // Market intelligence data (if from market report)
            marketData: marketData || null,
            source: body.source || 'manual',
            marketReportId: body.marketReportId || null,

            // Pre-call form data (Enterprise feature)
            precallFormId: precallFormId || null,
            precallFormData: precallFormData ? {
                prospectName: precallFormData.prospectName,
                prospectEmail: precallFormData.prospectEmail,
                completedAt: precallFormData.completedAt,
                enhancement: precallFormData.enhancement,
                prospectChallenge: precallFormData.prospectChallenge,
                usedProspectWords: !!precallFormData.prospectChallenge
            } : null,

            // Trigger event data (news article, social post, etc.)
            triggerEvent: triggerEvent ? {
                headline: triggerEvent.headline,
                summary: triggerEvent.summary,
                source: triggerEvent.source,
                url: triggerEvent.url,
                eventType: triggerEvent.eventType,
                usage: triggerEvent.usage
            } : null,

            // Form data (for re-generation)
            formData: body,

            // Status
            status: 'ready',
            shared: true,  // Enable public sharing by default

            // Analytics
            analytics: {
                views: 0,
                uniqueViewers: 0,
                lastViewedAt: null
            },

            // Timestamps
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await db.collection('pitches').doc(pitchId).set(pitchData);

        // Increment user's pitch count
        if (userId !== 'anonymous') {
            await incrementPitchCount(userId);
        }

        console.log(`Created pitch ${pitchId} for user ${userId} (Level ${level})`);

        return res.status(200).json({
            success: true,
            pitchId,
            shareId,
            level,
            businessName: inputs.businessName
        });

    } catch (error) {
        console.error('Error generating pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate pitch',
            error: error.message
        });
    }
}

/**
 * Get pitch by ID - handles GET /pitch/:pitchId
 */
async function getPitch(req, res) {
    try {
        const db = getDb();
        const pitchId = req.params.pitchId;

        if (!pitchId) {
            return res.status(400).json({
                success: false,
                message: 'Pitch ID is required'
            });
        }

        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Pitch not found'
            });
        }

        const pitchData = pitchDoc.data();

        return res.status(200).json({
            success: true,
            data: {
                id: pitchId,
                ...pitchData
            }
        });

    } catch (error) {
        console.error('Error getting pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get pitch',
            error: error.message
        });
    }
}

/**
 * Get pitch by share ID - handles GET /pitch/share/:shareId
 */
async function getSharedPitch(req, res) {
    try {
        const db = getDb();
        const shareId = req.params.shareId;

        if (!shareId) {
            return res.status(400).json({
                success: false,
                message: 'Share ID is required'
            });
        }

        const pitchQuery = await db.collection('pitches')
            .where('shareId', '==', shareId)
            .limit(1)
            .get();

        if (pitchQuery.empty) {
            return res.status(404).json({
                success: false,
                message: 'Shared pitch not found'
            });
        }

        const pitchDoc = pitchQuery.docs[0];
        const pitchData = pitchDoc.data();

        return res.status(200).json({
            success: true,
            data: {
                id: pitchDoc.id,
                ...pitchData
            }
        });

    } catch (error) {
        console.error('Error getting shared pitch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get shared pitch',
            error: error.message
        });
    }
}

/**
 * Generate a pitch directly (for bulk upload, no HTTP response)
 * Returns { success: boolean, pitchId?: string, error?: string }
 */
async function generatePitchDirect(data, userId) {
    try {
        const db = getDb();

        const inputs = {
            businessName: data.businessName,
            contactName: data.contactName || 'Business Owner',
            address: data.address,
            websiteUrl: data.websiteUrl || '',
            googleRating: data.googleRating,
            numReviews: data.numReviews,
            industry: data.industry,
            subIndustry: data.subIndustry || '',
            statedProblem: data.customMessage || 'increasing customer engagement and visibility',
            monthlyVisits: data.monthlyVisits,
            avgTransaction: data.avgTransaction,
            avgTicket: data.avgTransaction || data.avgTicket,
            repeatRate: data.repeatRate || 0.4
        };

        // Get NAICS code for industry-specific defaults
        const naicsCodes = naics.getNaicsByDisplay(data.subIndustry || data.industry);
        const naicsCode = naicsCodes[0] || null;
        const industryDefaults = naicsCode ? naics.getIndustryDefaults(naicsCode) : null;

        // Apply industry defaults if not provided
        if (!inputs.monthlyVisits && industryDefaults) {
            inputs.monthlyVisits = industryDefaults.monthlyCustomers;
        } else if (!inputs.monthlyVisits) {
            inputs.monthlyVisits = 200; // Conservative fallback
        }

        if (!inputs.avgTransaction && !inputs.avgTicket && industryDefaults) {
            inputs.avgTransaction = industryDefaults.avgTransaction;
            inputs.avgTicket = industryDefaults.avgTransaction;
        } else if (!inputs.avgTransaction && !inputs.avgTicket) {
            inputs.avgTransaction = 50; // Conservative fallback
            inputs.avgTicket = 50;
        }

        const level = parseInt(data.pitchLevel) || 2;

        // Basic review data
        const reviewData = {
            sentiment: { positive: 65, neutral: 25, negative: 10 },
            topThemes: ['Quality products', 'Excellent service', 'Great atmosphere', 'Good value'],
            staffMentions: [],
            differentiators: ['Unique offerings', 'Personal touch', 'Community focus']
        };

        // Adjust sentiment based on rating
        const rating = parseFloat(data.googleRating) || 4.0;
        if (rating >= 4.5) {
            reviewData.sentiment = { positive: 85, neutral: 12, negative: 3 };
        } else if (rating >= 4.0) {
            reviewData.sentiment = { positive: 75, neutral: 18, negative: 7 };
        } else if (rating >= 3.5) {
            reviewData.sentiment = { positive: 60, neutral: 25, negative: 15 };
        }

        // Calculate ROI with industry-specific growth rate
        const roiData = calculateROI(inputs, naicsCode);

        // Fetch seller profile if userId provided
        let sellerProfile = null;
        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    sellerProfile = userData.sellerProfile || null;
                }
            } catch (e) {
                console.log('Could not fetch seller profile:', e.message);
            }
        }

        // Build seller context (uses defaults if no seller profile)
        // Pass icpId for multi-ICP support - allows selecting specific ICP persona
        const icpId = data.icpId || null;
        const sellerContext = buildSellerContext(sellerProfile, icpId);

        // Options - prefer seller profile values
        const options = {
            bookingUrl: data.bookingUrl || null,
            hideBranding: data.hideBranding || false,
            primaryColor: data.primaryColor || sellerContext.primaryColor || '#3A6746',
            accentColor: data.accentColor || sellerContext.accentColor || '#D4A847',
            companyName: data.companyName || sellerContext.companyName || 'PathSynch',
            contactEmail: data.contactEmail || 'hello@pathsynch.com',
            logoUrl: data.logoUrl || sellerContext.logoUrl || null,
            sellerContext: sellerContext
        };

        // Generate IDs first (needed for tracking in generated HTML)
        const pitchId = generateId();
        const shareId = generateId();

        // Generate HTML based on level
        let html;
        switch (level) {
            case 1:
                html = generateLevel1(inputs, reviewData, roiData, options, null, pitchId);
                break;
            case 2:
                html = generateLevel2(inputs, reviewData, roiData, options, null, pitchId);
                break;
            case 3:
            default:
                html = generateLevel3(inputs, reviewData, roiData, options, null, pitchId);
                break;
        }

        // Get user data for creator info
        let creatorInfo = {
            userId: userId,
            email: null,
            displayName: null
        };

        if (userId && userId !== 'anonymous') {
            try {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    creatorInfo.email = userData.email || null;
                    creatorInfo.displayName = userData.profile?.displayName || userData.displayName || null;
                }
            } catch (e) {
                console.log('Could not fetch user data for creatorInfo:', e.message);
            }
        }

        // Create pitch document
        const pitchData = {
            pitchId,
            shareId,
            userId,
            creatorInfo,
            businessName: inputs.businessName,
            contactName: inputs.contactName,
            address: inputs.address,
            websiteUrl: inputs.websiteUrl,
            googleRating: inputs.googleRating,
            numReviews: inputs.numReviews,
            industry: inputs.industry,
            subIndustry: inputs.subIndustry,
            pitchLevel: level,
            html,
            roiData,
            reviewAnalysis: reviewData,
            formData: data,
            status: 'ready',
            shared: true,  // Enable public sharing by default
            source: data.source || 'bulk_upload',
            bulkJobId: data.bulkJobId || null,
            analytics: {
                views: 0,
                uniqueViewers: 0,
                lastViewedAt: null
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await db.collection('pitches').doc(pitchId).set(pitchData);

        console.log(`Created pitch ${pitchId} for user ${userId} (Level ${level}) via bulk upload`);

        return { success: true, pitchId, shareId };

    } catch (error) {
        console.error('Error generating pitch directly:', error);
        return { success: false, error: error.message };
    }
}

// Export for Firebase Functions
module.exports = {
    generatePitch,
    generatePitchDirect,
    getPitch,
    getSharedPitch,
    generateLevel1,
    generateLevel2,
    generateLevel3,
    calculateROI
};
