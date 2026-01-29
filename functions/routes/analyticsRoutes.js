/**
 * Analytics Routes
 *
 * Handles analytics tracking and reporting endpoints
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// ============================================
// ROUTES
// ============================================

/**
 * POST /analytics/track
 * Track an analytics event
 */
router.post('/analytics/track', async (req, res) => {
    try {
        // Validation done in index.js
        const { pitchId, event, data } = req.body;

        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);

        await analyticsRef.collection('events').add({
            type: event,
            data: data || {},
            viewerId: req.userId || 'anonymous',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const incrementField = {
            'cta_click': 'ctaClicks',
            'share': 'shares',
            'download': 'downloads'
        }[event];

        if (incrementField) {
            await analyticsRef.set({
                [incrementField]: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/track');
    }
});

/**
 * GET /analytics/pitch/:pitchId
 * Get analytics for a specific pitch
 */
router.get('/analytics/pitch/:pitchId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;
        const analyticsDoc = await db.collection('pitchAnalytics').doc(pitchId).get();

        if (!analyticsDoc.exists) {
            return res.status(200).json({
                success: true,
                data: { pitchId, views: 0, shares: 0, ctaClicks: 0 }
            });
        }

        return res.status(200).json({ success: true, data: analyticsDoc.data() });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/pitch/:pitchId');
    }
});

module.exports = router;
