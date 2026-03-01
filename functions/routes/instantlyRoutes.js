/**
 * Instantly Routes
 *
 * API endpoints for Instantly.ai integration.
 * Allows users to push pre-call brief intelligence into Instantly campaigns.
 *
 * @see https://developer.instantly.ai/
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError, badRequest, unauthorized, notFound } = require('../middleware/errorHandler');
const instantlyService = require('../services/instantlyService');

const router = createRouter();
const db = admin.firestore();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get user's Instantly API key from Firestore
 */
async function getInstantlyApiKey(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return null;

    const userData = userDoc.data();
    return userData?.integrations?.instantly?.apiKey || null;
}

/**
 * Extract intelligence from brief into Instantly custom variables
 */
function extractBriefIntelligence(brief) {
    const content = brief.briefContent || {};
    const marketContext = brief.marketContext || {};
    const contactIntel = brief.contactIntelligence || {};

    // Helper to truncate text
    const truncate = (text, maxLen) => {
        if (!text) return '';
        return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
    };

    // Helper to extract first N sentences
    const firstSentences = (text, n = 2) => {
        if (!text) return '';
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        return sentences.slice(0, n).join(' ').trim();
    };

    // Helper to parse talking point (format: "Pain → Solution" or just text)
    const parseTalkingPoint = (point, part) => {
        if (!point) return '';
        if (typeof point === 'object') {
            return part === 'pain' ? (point.pain || point.challenge || '') : (point.solution || point.response || '');
        }
        const parts = point.split('→');
        if (parts.length === 2) {
            return part === 'pain' ? parts[0].trim() : parts[1].trim();
        }
        return part === 'pain' ? point : '';
    };

    const talkingPoints = content.talkingPoints || [];

    // Build market position summary
    let marketPosition = '';
    if (marketContext.competitorCount || marketContext.opportunityScore) {
        const parts = [];
        if (marketContext.competitorCount) parts.push(`${marketContext.competitorCount} competitors`);
        if (marketContext.avgRating) parts.push(`avg ${marketContext.avgRating}★`);
        if (marketContext.opportunityScore) parts.push(`opportunity ${marketContext.opportunityScore}/100`);
        marketPosition = parts.join(', ');
    }

    return {
        synchintro_opener: truncate(content.suggestedOpener, 500),
        synchintro_company_context: firstSentences(content.companySnapshot, 2),
        synchintro_trigger: truncate(content.whyTheyTookMeeting, 300),
        synchintro_pain1: truncate(parseTalkingPoint(talkingPoints[0], 'pain'), 200),
        synchintro_pain2: truncate(parseTalkingPoint(talkingPoints[1], 'pain'), 200),
        synchintro_solution1: truncate(parseTalkingPoint(talkingPoints[0], 'solution'), 200),
        synchintro_solution2: truncate(parseTalkingPoint(talkingPoints[1], 'solution'), 200),
        synchintro_market_position: marketPosition,
        synchintro_comm_style: contactIntel?.profile?.communicationStyle || '',
        synchintro_brief_id: brief.id || ''
    };
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /instantly/connect
 * Save and test user's Instantly API key
 */
router.post('/instantly/connect', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const { apiKey } = req.body;
        if (!apiKey) {
            throw badRequest('API key is required');
        }

        // Test the API key
        const testResult = await instantlyService.testConnection(apiKey);
        if (!testResult.success) {
            return res.status(401).json({
                success: false,
                error: testResult.error || 'Invalid API key'
            });
        }

        // Save to user document
        // TODO (V2): Encrypt API key with AES-256 before storing
        await db.collection('users').doc(userId).set({
            integrations: {
                instantly: {
                    apiKey: apiKey,
                    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'active'
                }
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[Instantly] User ${userId} connected Instantly account`);

        return res.status(200).json({
            success: true,
            message: 'Instantly connected successfully'
        });

    } catch (error) {
        return handleError(error, res, 'POST /instantly/connect');
    }
});

/**
 * GET /instantly/status
 * Check user's Instantly connection status
 */
router.get('/instantly/status', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const instantlyData = userData?.integrations?.instantly;

        if (!instantlyData || !instantlyData.apiKey) {
            return res.status(200).json({
                success: true,
                data: {
                    connected: false,
                    status: 'disconnected'
                }
            });
        }

        // Mask API key (show last 4 characters)
        const maskedKey = '••••••••••••' + instantlyData.apiKey.slice(-4);

        return res.status(200).json({
            success: true,
            data: {
                connected: true,
                status: instantlyData.status || 'active',
                connectedAt: instantlyData.connectedAt?.toDate?.() || null,
                maskedKey
            }
        });

    } catch (error) {
        return handleError(error, res, 'GET /instantly/status');
    }
});

/**
 * DELETE /instantly/disconnect
 * Remove user's Instantly API key
 */
router.delete('/instantly/disconnect', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        await db.collection('users').doc(userId).update({
            'integrations.instantly': admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Instantly] User ${userId} disconnected Instantly account`);

        return res.status(200).json({
            success: true,
            message: 'Instantly disconnected'
        });

    } catch (error) {
        return handleError(error, res, 'DELETE /instantly/disconnect');
    }
});

/**
 * GET /instantly/campaigns
 * List user's Instantly campaigns
 */
router.get('/instantly/campaigns', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const apiKey = await getInstantlyApiKey(userId);
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        const result = await instantlyService.listCampaigns(apiKey);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            data: result.data
        });

    } catch (error) {
        return handleError(error, res, 'GET /instantly/campaigns');
    }
});

/**
 * POST /instantly/push-lead
 * Push a pre-call brief's intelligence to Instantly as an enriched lead
 */
router.post('/instantly/push-lead', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw unauthorized();
        }

        const { briefId, prospectEmail, campaignId } = req.body;

        if (!briefId) {
            throw badRequest('briefId is required');
        }
        if (!prospectEmail) {
            throw badRequest('prospectEmail is required');
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(prospectEmail)) {
            throw badRequest('Invalid email format');
        }

        // Get user's API key
        const apiKey = await getInstantlyApiKey(userId);
        if (!apiKey) {
            throw badRequest('Instantly API key not configured. Go to Settings → Integrations.');
        }

        // Fetch the brief
        const briefDoc = await db.collection('precallBriefs').doc(briefId).get();
        if (!briefDoc.exists) {
            throw notFound('Brief not found');
        }

        const brief = { id: briefDoc.id, ...briefDoc.data() };

        // Verify ownership
        if (brief.userId !== userId) {
            throw unauthorized('You do not have access to this brief');
        }

        // Extract intelligence into custom variables
        const customVariables = extractBriefIntelligence(brief);

        // Build lead data
        const leadData = {
            email: prospectEmail,
            companyName: brief.prospectCompany || '',
            firstName: brief.contactName?.split(' ')[0] || '',
            lastName: brief.contactName?.split(' ').slice(1).join(' ') || '',
            campaignId: campaignId || null,
            customVariables
        };

        // Push to Instantly
        const result = await instantlyService.pushLead(apiKey, leadData);

        // Log the push attempt
        await db.collection('instantlyPushLogs').add({
            userId,
            briefId,
            prospectEmail,
            campaignId: campaignId || null,
            customVariables,
            instantlyResponse: result.data || null,
            status: result.success ? 'success' : 'failed',
            error: result.error || null,
            pushedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        // Update brief with push status
        await db.collection('precallBriefs').doc(briefId).update({
            'instantly.pushed': true,
            'instantly.pushedAt': admin.firestore.FieldValue.serverTimestamp(),
            'instantly.prospectEmail': prospectEmail,
            'instantly.campaignId': campaignId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Instantly] User ${userId} pushed brief ${briefId} to Instantly`);

        return res.status(200).json({
            success: true,
            message: 'Lead pushed to Instantly successfully',
            data: {
                briefId,
                prospectEmail,
                campaignId: campaignId || null,
                variablesPushed: Object.keys(customVariables).length
            }
        });

    } catch (error) {
        return handleError(error, res, 'POST /instantly/push-lead');
    }
});

module.exports = router;
