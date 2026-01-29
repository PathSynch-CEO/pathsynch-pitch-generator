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

/**
 * Helper: Calculate engagement bucket from seconds
 */
function getTimeBucket(seconds) {
    if (seconds < 30) return 'ignored';
    if (seconds <= 120) return 'skimmed';
    return 'engaged';
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /analytics/track
 * Track an analytics event with enhanced CTA and time bucket tracking
 */
router.post('/analytics/track', async (req, res) => {
    try {
        // Validation done in index.js
        const { pitchId, event, data } = req.body;

        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);

        // Log individual event
        await analyticsRef.collection('events').add({
            type: event,
            data: data || {},
            viewerId: req.userId || 'anonymous',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Build update object based on event type
        const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (event === 'cta_click') {
            // Increment overall CTA clicks
            updateData.ctaClicks = admin.firestore.FieldValue.increment(1);

            // Increment CTA clicks by type if ctaType is provided
            if (data?.ctaType) {
                updateData[`ctaClicksByType.${data.ctaType}`] = admin.firestore.FieldValue.increment(1);
            }
        } else if (event === 'share') {
            updateData.shares = admin.firestore.FieldValue.increment(1);
        } else if (event === 'download') {
            updateData.downloads = admin.firestore.FieldValue.increment(1);
        } else if (event === 'time_on_page') {
            // Handle time on page tracking
            const seconds = data?.seconds || 0;
            const bucket = data?.bucket || getTimeBucket(seconds);

            // Increment the appropriate engagement bucket
            updateData[`engagementBuckets.${bucket}`] = admin.firestore.FieldValue.increment(1);

            // Track total time and session count for averaging
            updateData.totalTimeSeconds = admin.firestore.FieldValue.increment(seconds);
            updateData.timeSessionCount = admin.firestore.FieldValue.increment(1);
        } else if (event === 'view') {
            // Track views and set firstViewedAt if not already set
            updateData.views = admin.firestore.FieldValue.increment(1);

            // Check if firstViewedAt needs to be set
            const doc = await analyticsRef.get();
            if (!doc.exists || !doc.data()?.firstViewedAt) {
                updateData.firstViewedAt = admin.firestore.FieldValue.serverTimestamp();
            }
        }

        // Apply updates if there are any fields to update
        if (Object.keys(updateData).length > 1) {
            await analyticsRef.set(updateData, { merge: true });
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
