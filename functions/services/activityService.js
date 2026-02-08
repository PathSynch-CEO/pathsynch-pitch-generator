/**
 * Activity Service
 *
 * Handles activity feed population, notifications, and aggregation.
 * Works with Cloud Functions triggers to update activity feeds.
 */

const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Activity types and their display configuration
 */
const ACTIVITY_TYPES = {
    view: {
        title: 'Pitch Viewed',
        icon: 'eye',
        color: '#3b82f6'
    },
    share: {
        title: 'Pitch Shared',
        icon: 'share',
        color: '#8b5cf6'
    },
    cta_click: {
        title: 'CTA Clicked',
        icon: 'cursor-click',
        color: '#10b981'
    }
};

/**
 * Create an activity feed entry for a user
 *
 * @param {string} userId - User ID to add activity for
 * @param {Object} activity - Activity data
 * @param {string} activity.type - Activity type (view, share, cta_click)
 * @param {string} activity.pitchId - Related pitch ID
 * @param {string} activity.prospectBusiness - Prospect business name
 * @param {Object} [activity.metadata] - Additional metadata
 */
async function createActivity(userId, activity) {
    if (!userId || !activity.type || !activity.pitchId) {
        console.error('Invalid activity data:', { userId, activity });
        return null;
    }

    const dateKey = new Date().toISOString().split('T')[0];

    const activityDoc = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        type: activity.type,
        pitchId: activity.pitchId,
        prospectBusiness: activity.prospectBusiness || 'Unknown',
        deviceType: activity.deviceType || null,
        city: activity.city || null,
        country: activity.country || null,
        referrerCategory: activity.referrerCategory || null,
        dateKey: dateKey,
        isRead: false,
        metadata: activity.metadata || {}
    };

    try {
        const docRef = await db.collection('users').doc(userId)
            .collection('activityFeed').add(activityDoc);

        // Increment unread count
        await db.collection('users').doc(userId).set({
            'notifications.unreadCount': admin.firestore.FieldValue.increment(1)
        }, { merge: true });

        return docRef.id;
    } catch (error) {
        console.error('Failed to create activity:', error);
        return null;
    }
}

/**
 * Get activity feed for a user
 *
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @param {number} [options.limit=20] - Number of items to return
 * @param {boolean} [options.unreadOnly=false] - Only return unread items
 * @param {string} [options.type] - Filter by activity type
 * @param {string} [options.startAfter] - Pagination cursor
 */
async function getActivityFeed(userId, options = {}) {
    const { limit = 20, unreadOnly = false, type, startAfter } = options;

    let query = db.collection('users').doc(userId)
        .collection('activityFeed')
        .orderBy('timestamp', 'desc')
        .limit(limit);

    if (unreadOnly) {
        query = query.where('isRead', '==', false);
    }

    if (type) {
        query = query.where('type', '==', type);
    }

    if (startAfter) {
        const startDoc = await db.collection('users').doc(userId)
            .collection('activityFeed').doc(startAfter).get();
        if (startDoc.exists) {
            query = query.startAfter(startDoc);
        }
    }

    const snapshot = await query.get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null
    }));
}

/**
 * Mark activities as read
 *
 * @param {string} userId - User ID
 * @param {string[]} activityIds - Activity IDs to mark as read
 */
async function markAsRead(userId, activityIds) {
    if (!activityIds || activityIds.length === 0) return 0;

    const batch = db.batch();
    const userRef = db.collection('users').doc(userId);
    const activityFeedRef = userRef.collection('activityFeed');

    let count = 0;
    for (const activityId of activityIds.slice(0, 50)) {
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
    return count;
}

/**
 * Mark all activities as read
 *
 * @param {string} userId - User ID
 */
async function markAllAsRead(userId) {
    const userRef = db.collection('users').doc(userId);
    const activityFeedRef = userRef.collection('activityFeed');

    const unreadSnapshot = await activityFeedRef
        .where('isRead', '==', false)
        .get();

    if (unreadSnapshot.empty) return 0;

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
    return count;
}

/**
 * Get unread count for a user
 *
 * @param {string} userId - User ID
 */
async function getUnreadCount(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    return userDoc.data()?.notifications?.unreadCount || 0;
}

/**
 * Get user notification settings
 *
 * @param {string} userId - User ID
 */
async function getNotificationSettings(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const data = userDoc.data() || {};

    return {
        inApp: data.notificationSettings?.inApp !== false, // Default true
        emailDigest: data.notificationSettings?.emailDigest || 'off',
        mutedPitches: data.notificationSettings?.mutedPitches || []
    };
}

/**
 * Update user notification settings
 *
 * @param {string} userId - User ID
 * @param {Object} settings - Settings to update
 */
async function updateNotificationSettings(userId, settings) {
    const updateData = {};

    if (typeof settings.inApp === 'boolean') {
        updateData['notificationSettings.inApp'] = settings.inApp;
    }

    if (['off', 'daily', 'weekly'].includes(settings.emailDigest)) {
        updateData['notificationSettings.emailDigest'] = settings.emailDigest;
    }

    if (Array.isArray(settings.mutedPitches)) {
        updateData['notificationSettings.mutedPitches'] = settings.mutedPitches;
    }

    if (Object.keys(updateData).length > 0) {
        await db.collection('users').doc(userId).set(updateData, { merge: true });
    }

    return getNotificationSettings(userId);
}

/**
 * Mute notifications for a specific pitch
 *
 * @param {string} userId - User ID
 * @param {string} pitchId - Pitch ID to mute
 */
async function mutePitch(userId, pitchId) {
    await db.collection('users').doc(userId).set({
        'notificationSettings.mutedPitches': admin.firestore.FieldValue.arrayUnion(pitchId)
    }, { merge: true });
}

/**
 * Unmute notifications for a specific pitch
 *
 * @param {string} userId - User ID
 * @param {string} pitchId - Pitch ID to unmute
 */
async function unmutePitch(userId, pitchId) {
    await db.collection('users').doc(userId).set({
        'notificationSettings.mutedPitches': admin.firestore.FieldValue.arrayRemove(pitchId)
    }, { merge: true });
}

/**
 * Clean up old activity feed entries (30-day retention)
 *
 * @param {string} userId - User ID
 */
async function cleanupOldActivities(userId) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const oldActivities = await db.collection('users').doc(userId)
        .collection('activityFeed')
        .where('timestamp', '<', cutoffDate)
        .limit(100)
        .get();

    if (oldActivities.empty) return 0;

    const batch = db.batch();
    oldActivities.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    return oldActivities.size;
}

/**
 * Get daily activity summary for a user (for email digests)
 *
 * @param {string} userId - User ID
 * @param {string} dateKey - Date key (YYYY-MM-DD)
 */
async function getDailySummary(userId, dateKey) {
    const activities = await db.collection('users').doc(userId)
        .collection('activityFeed')
        .where('dateKey', '==', dateKey)
        .get();

    const summary = {
        totalViews: 0,
        totalShares: 0,
        totalClicks: 0,
        topPitches: {},
        activities: []
    };

    activities.docs.forEach(doc => {
        const data = doc.data();
        summary.activities.push({
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate?.()?.toISOString() || null
        });

        // Count by type
        if (data.type === 'view') summary.totalViews++;
        else if (data.type === 'share') summary.totalShares++;
        else if (data.type === 'cta_click') summary.totalClicks++;

        // Track top pitches
        if (!summary.topPitches[data.pitchId]) {
            summary.topPitches[data.pitchId] = {
                pitchId: data.pitchId,
                prospectBusiness: data.prospectBusiness,
                views: 0,
                shares: 0,
                clicks: 0
            };
        }

        if (data.type === 'view') summary.topPitches[data.pitchId].views++;
        else if (data.type === 'share') summary.topPitches[data.pitchId].shares++;
        else if (data.type === 'cta_click') summary.topPitches[data.pitchId].clicks++;
    });

    // Convert to sorted array
    summary.topPitchesArray = Object.values(summary.topPitches)
        .sort((a, b) => (b.views + b.shares + b.clicks) - (a.views + a.shares + a.clicks))
        .slice(0, 5);

    return summary;
}

/**
 * Get weekly activity summary for a user (for email digests)
 *
 * @param {string} userId - User ID
 */
async function getWeeklySummary(userId) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const activities = await db.collection('users').doc(userId)
        .collection('activityFeed')
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .get();

    const summary = {
        period: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
        },
        totalViews: 0,
        totalShares: 0,
        totalClicks: 0,
        dailyBreakdown: {},
        topPitches: {}
    };

    activities.docs.forEach(doc => {
        const data = doc.data();
        const dateKey = data.dateKey;

        // Daily breakdown
        if (!summary.dailyBreakdown[dateKey]) {
            summary.dailyBreakdown[dateKey] = { views: 0, shares: 0, clicks: 0 };
        }

        // Count by type
        if (data.type === 'view') {
            summary.totalViews++;
            summary.dailyBreakdown[dateKey].views++;
        } else if (data.type === 'share') {
            summary.totalShares++;
            summary.dailyBreakdown[dateKey].shares++;
        } else if (data.type === 'cta_click') {
            summary.totalClicks++;
            summary.dailyBreakdown[dateKey].clicks++;
        }

        // Track top pitches
        if (!summary.topPitches[data.pitchId]) {
            summary.topPitches[data.pitchId] = {
                pitchId: data.pitchId,
                prospectBusiness: data.prospectBusiness,
                views: 0,
                shares: 0,
                clicks: 0
            };
        }

        if (data.type === 'view') summary.topPitches[data.pitchId].views++;
        else if (data.type === 'share') summary.topPitches[data.pitchId].shares++;
        else if (data.type === 'cta_click') summary.topPitches[data.pitchId].clicks++;
    });

    // Convert to sorted array
    summary.topPitchesArray = Object.values(summary.topPitches)
        .sort((a, b) => (b.views + b.shares + b.clicks) - (a.views + a.shares + a.clicks))
        .slice(0, 10);

    return summary;
}

module.exports = {
    ACTIVITY_TYPES,
    createActivity,
    getActivityFeed,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    getNotificationSettings,
    updateNotificationSettings,
    mutePitch,
    unmutePitch,
    cleanupOldActivities,
    getDailySummary,
    getWeeklySummary
};
