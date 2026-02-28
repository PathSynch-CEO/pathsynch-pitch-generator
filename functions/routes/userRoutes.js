/**
 * User Routes
 *
 * Handles user profile, settings, and usage endpoints
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// LinkedIn Agent for profile management
const linkedinAgent = require('../services/linkedinAgent');

// ============================================
// HELPER FUNCTIONS
// ============================================

function getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /user
 * Get current user profile
 */
router.get('/user', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userDoc = await db.collection('users').doc(req.userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({ success: true, data: userDoc.data() });
    } catch (error) {
        return handleError(error, res, 'GET /user');
    }
});

/**
 * PUT /user/settings
 * Update user settings
 */
router.put('/user/settings', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const updates = req.body;
        const userRef = db.collection('users').doc(req.userId);

        await userRef.set({
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({ success: true, message: 'Settings updated' });
    } catch (error) {
        return handleError(error, res, 'PUT /user/settings');
    }
});

/**
 * GET /usage
 * Get current user's usage for the period
 */
router.get('/usage', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const period = getCurrentPeriod();
        const usageId = `${req.userId}_${period}`;
        const usageDoc = await db.collection('usage').doc(usageId).get();

        if (!usageDoc.exists) {
            return res.status(200).json({
                success: true,
                data: { period, pitchesGenerated: 0, limits: { pitches: 5 } }
            });
        }

        return res.status(200).json({ success: true, data: usageDoc.data() });
    } catch (error) {
        return handleError(error, res, 'GET /usage');
    }
});

/**
 * GET /templates
 * Get available templates for user
 */
router.get('/templates', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const systemTemplates = await db.collection('templates')
            .where('isSystem', '==', true)
            .get();

        const userTemplates = await db.collection('templates')
            .where('userId', '==', req.userId)
            .get();

        const templates = [
            ...systemTemplates.docs.map(d => ({ id: d.id, ...d.data() })),
            ...userTemplates.docs.map(d => ({ id: d.id, ...d.data() }))
        ];

        return res.status(200).json({ success: true, data: templates });
    } catch (error) {
        return handleError(error, res, 'GET /templates');
    }
});

/**
 * GET /subscription
 * Get user's subscription status
 */
router.get('/subscription', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const stripeApi = require('../api/stripe');
        return await stripeApi.getSubscription(req, res);
    } catch (error) {
        return handleError(error, res, 'GET /subscription');
    }
});

/**
 * GET /pricing-plans
 * Get available pricing plans (public)
 */
router.get('/pricing-plans', async (req, res) => {
    try {
        const { PLANS } = require('../config/stripe');
        return res.status(200).json({
            success: true,
            data: PLANS
        });
    } catch (error) {
        return handleError(error, res, 'GET /pricing-plans');
    }
});

/**
 * GET /rate-limit-status
 * Get current rate limit status for authenticated user
 */
router.get('/rate-limit-status', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { getRateLimitStatus } = require('../middleware/rateLimiter');
        const userPlan = req.user?.plan || 'starter';
        const status = await getRateLimitStatus(req.userId, userPlan);

        return res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        return handleError(error, res, 'GET /rate-limit-status');
    }
});

/**
 * GET /user/linkedin-profile
 * Get user's LinkedIn profile data for comparison
 */
router.get('/user/linkedin-profile', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const profile = await linkedinAgent.getSellerProfile(req.userId);

        if (!profile) {
            return res.status(200).json({
                success: true,
                data: null,
                message: 'No LinkedIn profile data found. Add your LinkedIn info in Settings to enable profile comparison.',
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                linkedinUrl: profile.linkedinUrl,
                headline: profile.headline,
                location: profile.location,
                education: profile.education,
                careerHistory: profile.careerHistory,
                skills: profile.skills,
                interests: profile.interests,
                completeness: profile.completeness,
                hasLinkedInData: profile.hasLinkedInData,
            },
        });
    } catch (error) {
        return handleError(error, res, 'GET /user/linkedin-profile');
    }
});

/**
 * PUT /user/linkedin-profile
 * Update user's LinkedIn profile data
 */
router.put('/user/linkedin-profile', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const profileData = req.body;

        // Validate required structure
        const allowedFields = [
            'linkedinUrl', 'headline', 'location', 'education',
            'careerHistory', 'skills', 'interests', 'causes', 'certifications'
        ];

        const filteredData = {};
        for (const field of allowedFields) {
            if (profileData[field] !== undefined) {
                filteredData[field] = profileData[field];
            }
        }

        const success = await linkedinAgent.updateSellerProfile(req.userId, filteredData);

        if (!success) {
            return res.status(500).json({ success: false, message: 'Failed to update profile' });
        }

        // Return updated profile
        const updatedProfile = await linkedinAgent.getSellerProfile(req.userId);

        return res.status(200).json({
            success: true,
            message: 'LinkedIn profile updated',
            data: {
                completeness: updatedProfile?.completeness || 0,
                hasLinkedInData: updatedProfile?.hasLinkedInData || false,
            },
        });
    } catch (error) {
        return handleError(error, res, 'PUT /user/linkedin-profile');
    }
});

/**
 * POST /user/linkedin-profile/parse
 * Parse LinkedIn URL and extract profile data
 */
router.post('/user/linkedin-profile/parse', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { linkedinUrl } = req.body;

        if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                message: 'Valid LinkedIn profile URL required (e.g., https://linkedin.com/in/username)',
            });
        }

        const result = await linkedinAgent.parseSellerLinkedIn(linkedinUrl);

        if (!result.success) {
            return res.status(422).json({
                success: false,
                message: result.error || 'Could not parse LinkedIn profile. You can enter your details manually.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'LinkedIn profile parsed successfully',
            data: result.data,
        });
    } catch (error) {
        return handleError(error, res, 'POST /user/linkedin-profile/parse');
    }
});

module.exports = router;
