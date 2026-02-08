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

/**
 * Helper: Fetch geolocation from IP using ip-api.com (free tier: 45 req/min)
 */
async function getGeolocation(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { city: null, country: null };
    }

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,country`);
        const data = await response.json();

        if (data.status === 'success') {
            return {
                city: data.city || null,
                country: data.country || null
            };
        }
    } catch (error) {
        console.error('Geolocation lookup failed:', error.message);
    }

    return { city: null, country: null };
}

/**
 * Helper: Get client IP from request
 */
function getClientIP(req) {
    // Check various headers for the real IP
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || req.connection?.remoteAddress || null;
}

/**
 * Helper: Get today's date key (YYYY-MM-DD)
 */
function getDateKey(date = new Date()) {
    return date.toISOString().split('T')[0];
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
 * POST /analytics/track-view
 * Track a detailed view event with device, referrer, and geolocation
 * This endpoint is public (no auth required) for tracking shared pitches
 */
router.post('/analytics/track-view', async (req, res) => {
    try {
        const {
            pitchId,
            fingerprint,
            deviceType,
            referrer,
            referrerCategory,
            utmSource,
            utmMedium,
            utmCampaign
        } = req.body;

        // Validate required fields
        if (!pitchId) {
            return res.status(400).json({ success: false, message: 'pitchId required' });
        }

        if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length !== 64) {
            return res.status(400).json({ success: false, message: 'Invalid fingerprint' });
        }

        // Validate device type
        const validDevices = ['mobile', 'desktop', 'tablet'];
        const device = validDevices.includes(deviceType) ? deviceType : 'desktop';

        // Validate referrer category
        const validCategories = ['direct', 'email', 'social', 'search', 'other'];
        const refCategory = validCategories.includes(referrerCategory) ? referrerCategory : 'other';

        // Get geolocation from IP
        const clientIP = getClientIP(req);
        const geo = await getGeolocation(clientIP);

        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        const viewEventsRef = analyticsRef.collection('viewEvents');
        const dateKey = getDateKey();

        // Check if this is a returning viewer (same fingerprint seen before)
        const existingViews = await viewEventsRef
            .where('viewerFingerprint', '==', fingerprint)
            .limit(1)
            .get();
        const isReturningViewer = !existingViews.empty;

        // Create view event document
        const viewEvent = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            viewerFingerprint: fingerprint,
            isReturningViewer: isReturningViewer,
            deviceType: device,
            referrer: referrer || null,
            referrerCategory: refCategory,
            utmSource: utmSource || null,
            utmMedium: utmMedium || null,
            utmCampaign: utmCampaign || null,
            city: geo.city,
            country: geo.country,
            duration: 0,          // Will be updated by track-exit
            scrollDepth: 0,       // Will be updated by track-exit
            engagementBucket: 'ignored'  // Will be updated by track-exit
        };

        // Add view event to subcollection
        const viewEventDoc = await viewEventsRef.add(viewEvent);

        // Update aggregate analytics
        const updateData = {
            views: admin.firestore.FieldValue.increment(1),
            [`viewsByDay.${dateKey}`]: admin.firestore.FieldValue.increment(1),
            [`deviceBreakdown.${device}`]: admin.firestore.FieldValue.increment(1),
            [`referrerBreakdown.${refCategory}`]: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Increment unique views only for new fingerprints
        if (!isReturningViewer) {
            updateData.uniqueViews = admin.firestore.FieldValue.increment(1);
        }

        // Check if firstViewedAt needs to be set
        const doc = await analyticsRef.get();
        if (!doc.exists || !doc.data()?.firstViewedAt) {
            updateData.firstViewedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await analyticsRef.set(updateData, { merge: true });

        // Get pitch owner for activity feed
        try {
            const pitchDoc = await db.collection('pitches').doc(pitchId).get();
            if (pitchDoc.exists) {
                const pitch = pitchDoc.data();
                const userId = pitch.userId;
                const prospectBusiness = pitch.businessName || 'Unknown';

                // Add to user's activity feed
                await db.collection('users').doc(userId).collection('activityFeed').add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'view',
                    pitchId: pitchId,
                    prospectBusiness: prospectBusiness,
                    deviceType: device,
                    city: geo.city,
                    country: geo.country,
                    dateKey: dateKey,
                    isRead: false,
                    viewEventId: viewEventDoc.id
                });

                // Increment unread notification count
                await db.collection('users').doc(userId).set({
                    'notifications.unreadCount': admin.firestore.FieldValue.increment(1)
                }, { merge: true });
            }
        } catch (activityError) {
            console.error('Failed to create activity feed entry:', activityError.message);
            // Don't fail the request if activity feed fails
        }

        return res.status(200).json({
            success: true,
            viewEventId: viewEventDoc.id
        });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/track-view');
    }
});

/**
 * POST /analytics/track-exit
 * Update a view event with duration and scroll depth
 */
router.post('/analytics/track-exit', async (req, res) => {
    try {
        const { pitchId, fingerprint, duration, scrollDepth, engagementBucket } = req.body;

        if (!pitchId || !fingerprint) {
            return res.status(400).json({ success: false, message: 'pitchId and fingerprint required' });
        }

        // Validate duration and scroll depth
        const validDuration = typeof duration === 'number' && duration >= 0 ? Math.min(duration, 7200) : 0;
        const validScrollDepth = typeof scrollDepth === 'number' && scrollDepth >= 0 ? Math.min(scrollDepth, 100) : 0;

        // Calculate engagement bucket
        const bucket = engagementBucket || getTimeBucket(validDuration);

        const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
        const viewEventsRef = analyticsRef.collection('viewEvents');

        // Find the most recent view event for this fingerprint
        const recentViews = await viewEventsRef
            .where('viewerFingerprint', '==', fingerprint)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        if (!recentViews.empty) {
            const viewDoc = recentViews.docs[0];

            // Update the view event with exit data
            await viewDoc.ref.update({
                duration: validDuration,
                scrollDepth: validScrollDepth,
                engagementBucket: bucket
            });
        }

        // Update aggregate analytics with duration data
        const updateData = {
            totalTimeSeconds: admin.firestore.FieldValue.increment(validDuration),
            timeSessionCount: admin.firestore.FieldValue.increment(1),
            [`engagementBuckets.${bucket}`]: admin.firestore.FieldValue.increment(1),
            totalScrollDepth: admin.firestore.FieldValue.increment(validScrollDepth),
            scrollSessionCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await analyticsRef.set(updateData, { merge: true });

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/track-exit');
    }
});

/**
 * GET /analytics/pitch/:pitchId/view-events
 * Get detailed view events for a pitch (owner only)
 */
router.get('/analytics/pitch/:pitchId/view-events', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = req.query.offset || null;

        // Verify ownership
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();
        if (!pitchDoc.exists || pitchDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        let query = db.collection('pitchAnalytics').doc(pitchId)
            .collection('viewEvents')
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (offset) {
            const offsetDoc = await db.collection('pitchAnalytics').doc(pitchId)
                .collection('viewEvents').doc(offset).get();
            if (offsetDoc.exists) {
                query = query.startAfter(offsetDoc);
            }
        }

        const snapshot = await query.get();
        const events = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null
        }));

        return res.status(200).json({
            success: true,
            data: events,
            hasMore: events.length === limit
        });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/pitch/:pitchId/view-events');
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

        // Calculate computed fields
        const data = analyticsDoc.data();
        const computed = {
            avgDuration: data.timeSessionCount > 0
                ? Math.round(data.totalTimeSeconds / data.timeSessionCount)
                : 0,
            avgScrollDepth: data.scrollSessionCount > 0
                ? Math.round(data.totalScrollDepth / data.scrollSessionCount)
                : 0
        };

        return res.status(200).json({
            success: true,
            data: { ...data, ...computed }
        });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/pitch/:pitchId');
    }
});

/**
 * GET /analytics/activity-feed
 * Get the user's activity feed with pagination
 */
router.get('/analytics/activity-feed', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const limit = parseInt(req.query.limit) || 20;
        const unreadOnly = req.query.unreadOnly === 'true';

        let query = db.collection('users').doc(req.userId)
            .collection('activityFeed')
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (unreadOnly) {
            query = query.where('isRead', '==', false);
        }

        const snapshot = await query.get();
        const activities = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null
        }));

        // Get unread count
        const userDoc = await db.collection('users').doc(req.userId).get();
        const unreadCount = userDoc.data()?.notifications?.unreadCount || 0;

        return res.status(200).json({
            success: true,
            data: activities,
            unreadCount: unreadCount,
            hasMore: activities.length === limit
        });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/activity-feed');
    }
});

/**
 * POST /analytics/activity-feed/mark-read
 * Mark activity items as read
 */
router.post('/analytics/activity-feed/mark-read', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { activityIds, markAll } = req.body;

        const userRef = db.collection('users').doc(req.userId);
        const activityFeedRef = userRef.collection('activityFeed');

        if (markAll) {
            // Mark all unread as read
            const unreadSnapshot = await activityFeedRef
                .where('isRead', '==', false)
                .get();

            const batch = db.batch();
            let count = 0;
            unreadSnapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    isRead: true,
                    readAt: admin.firestore.FieldValue.serverTimestamp()
                });
                count++;
            });

            // Reset unread count
            batch.update(userRef, { 'notifications.unreadCount': 0 });
            await batch.commit();

            return res.status(200).json({ success: true, markedCount: count });
        }

        if (!activityIds || !Array.isArray(activityIds) || activityIds.length === 0) {
            return res.status(400).json({ success: false, message: 'activityIds required' });
        }

        // Mark specific items as read
        const batch = db.batch();
        let count = 0;

        for (const activityId of activityIds.slice(0, 50)) { // Limit to 50 per request
            const docRef = activityFeedRef.doc(activityId);
            batch.update(docRef, {
                isRead: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });
            count++;
        }

        // Decrement unread count
        batch.update(userRef, {
            'notifications.unreadCount': admin.firestore.FieldValue.increment(-count)
        });

        await batch.commit();

        return res.status(200).json({ success: true, markedCount: count });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/activity-feed/mark-read');
    }
});

/**
 * GET /analytics/notification-settings
 * Get user's notification settings
 */
router.get('/analytics/notification-settings', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userDoc = await db.collection('users').doc(req.userId).get();
        const data = userDoc.data() || {};

        return res.status(200).json({
            success: true,
            data: {
                inApp: data.notificationSettings?.inApp !== false,
                emailDigest: data.notificationSettings?.emailDigest || 'off',
                mutedPitches: data.notificationSettings?.mutedPitches || []
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/notification-settings');
    }
});

/**
 * PUT /analytics/notification-settings
 * Update user's notification settings
 */
router.put('/analytics/notification-settings', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { inApp, emailDigest, mutedPitches } = req.body;
        const updateData = {};

        if (typeof inApp === 'boolean') {
            updateData['notificationSettings.inApp'] = inApp;
        }

        if (['off', 'daily', 'weekly'].includes(emailDigest)) {
            updateData['notificationSettings.emailDigest'] = emailDigest;
        }

        if (Array.isArray(mutedPitches)) {
            updateData['notificationSettings.mutedPitches'] = mutedPitches;
        }

        if (Object.keys(updateData).length > 0) {
            await db.collection('users').doc(req.userId).set(updateData, { merge: true });
        }

        // Return updated settings
        const userDoc = await db.collection('users').doc(req.userId).get();
        const data = userDoc.data() || {};

        return res.status(200).json({
            success: true,
            data: {
                inApp: data.notificationSettings?.inApp !== false,
                emailDigest: data.notificationSettings?.emailDigest || 'off',
                mutedPitches: data.notificationSettings?.mutedPitches || []
            }
        });
    } catch (error) {
        return handleError(error, res, 'PUT /analytics/notification-settings');
    }
});

/**
 * POST /analytics/notification-settings/mute
 * Mute notifications for a specific pitch
 */
router.post('/analytics/notification-settings/mute', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.body;

        if (!pitchId) {
            return res.status(400).json({ success: false, message: 'pitchId required' });
        }

        await db.collection('users').doc(req.userId).set({
            'notificationSettings.mutedPitches': admin.firestore.FieldValue.arrayUnion(pitchId)
        }, { merge: true });

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/notification-settings/mute');
    }
});

/**
 * POST /analytics/notification-settings/unmute
 * Unmute notifications for a specific pitch
 */
router.post('/analytics/notification-settings/unmute', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { pitchId } = req.body;

        if (!pitchId) {
            return res.status(400).json({ success: false, message: 'pitchId required' });
        }

        await db.collection('users').doc(req.userId).set({
            'notificationSettings.mutedPitches': admin.firestore.FieldValue.arrayRemove(pitchId)
        }, { merge: true });

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /analytics/notification-settings/unmute');
    }
});

/**
 * GET /analytics/enhanced
 * Get enhanced analytics data (aggregated across all user's pitches)
 */
router.get('/analytics/enhanced', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Get all user's pitches
        const pitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', req.userId)
            .get();

        const pitchIds = pitchesSnapshot.docs.map(doc => doc.id);

        // Aggregate analytics from all pitches
        const aggregated = {
            viewsByDay: {},
            deviceBreakdown: { desktop: 0, mobile: 0, tablet: 0 },
            referrerBreakdown: { direct: 0, email: 0, social: 0, search: 0, other: 0 },
            uniqueViews: 0,
            totalViews: 0,
            avgDuration: 0,
            avgScrollDepth: 0,
            totalTimeSeconds: 0,
            timeSessionCount: 0,
            totalScrollDepth: 0,
            scrollSessionCount: 0
        };

        // Fetch analytics for each pitch and aggregate
        for (const pitchId of pitchIds) {
            const analyticsDoc = await db.collection('pitchAnalytics').doc(pitchId).get();
            if (!analyticsDoc.exists) continue;

            const data = analyticsDoc.data();

            // Aggregate views by day
            if (data.viewsByDay) {
                Object.entries(data.viewsByDay).forEach(([day, count]) => {
                    aggregated.viewsByDay[day] = (aggregated.viewsByDay[day] || 0) + count;
                });
            }

            // Aggregate device breakdown
            if (data.deviceBreakdown) {
                Object.entries(data.deviceBreakdown).forEach(([device, count]) => {
                    if (aggregated.deviceBreakdown[device] !== undefined) {
                        aggregated.deviceBreakdown[device] += count;
                    }
                });
            }

            // Aggregate referrer breakdown
            if (data.referrerBreakdown) {
                Object.entries(data.referrerBreakdown).forEach(([ref, count]) => {
                    if (aggregated.referrerBreakdown[ref] !== undefined) {
                        aggregated.referrerBreakdown[ref] += count;
                    }
                });
            }

            // Aggregate totals
            aggregated.uniqueViews += data.uniqueViews || 0;
            aggregated.totalViews += data.views || 0;
            aggregated.totalTimeSeconds += data.totalTimeSeconds || 0;
            aggregated.timeSessionCount += data.timeSessionCount || 0;
            aggregated.totalScrollDepth += data.totalScrollDepth || 0;
            aggregated.scrollSessionCount += data.scrollSessionCount || 0;
        }

        // Calculate averages
        aggregated.avgDuration = aggregated.timeSessionCount > 0
            ? Math.round(aggregated.totalTimeSeconds / aggregated.timeSessionCount)
            : 0;
        aggregated.avgScrollDepth = aggregated.scrollSessionCount > 0
            ? Math.round(aggregated.totalScrollDepth / aggregated.scrollSessionCount)
            : 0;

        return res.status(200).json({
            success: true,
            data: aggregated
        });
    } catch (error) {
        return handleError(error, res, 'GET /analytics/enhanced');
    }
});

module.exports = router;
