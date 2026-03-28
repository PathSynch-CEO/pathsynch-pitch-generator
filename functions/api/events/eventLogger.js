/**
 * Behavioral Event Logger
 * POST /events/log
 *
 * Writes user behavior events to Firestore for analytics.
 * CRITICAL: Never throws. Always returns 200. Logging must never block the user.
 */

const admin = require('firebase-admin');

function parseDevice(ua) {
    if (!ua) return 'unknown';
    if (/mobile/i.test(ua)) return 'mobile';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'desktop';
}

function getTimeOfDay(date) {
    const hour = date.getUTCHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
}

async function getUserPlan(userId) {
    try {
        const doc = await admin.firestore()
            .collection('users').doc(userId).get();
        return doc.exists ?
            (doc.data().tier || doc.data().plan || 'free') : 'free';
    } catch (e) {
        return 'unknown';
    }
}

async function logEvent(req, res) {
    try {
        const { eventType, properties = {}, sessionId } = req.body || {};

        if (!eventType) {
            return res.status(400).json({ success: false, error: 'eventType is required' });
        }

        const userId = req.userId;
        const planTier = await getUserPlan(userId);

        await admin.firestore()
            .collection('userEvents')
            .doc(userId)
            .collection('events')
            .add({
                eventType,
                properties,
                sessionId: sessionId || null,
                userId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                device: parseDevice(req.headers['user-agent']),
                timeOfDay: getTimeOfDay(new Date()),
                planTier
            });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[EventLogger] Error logging event:', error.message);
        // Never fail — return 200 even on error
        return res.status(200).json({ success: true });
    }
}

module.exports = { logEvent };
