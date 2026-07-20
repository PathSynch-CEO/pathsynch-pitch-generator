/**
 * Behavioral Event Logger
 * POST /events/log
 *
 * Writes user behavior events to Firestore for analytics.
 * CRITICAL: Never throws. Always returns 200. Logging must never block the user.
 */

const admin = require('firebase-admin');
const { getUserPlanForRequest } = require('../../middleware/planGate');

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

async function logEvent(req, res) {
    try {
        const { eventType, properties = {}, sessionId } = req.body || {};

        if (!eventType) {
            return res.status(400).json({ success: false, error: 'eventType is required' });
        }

        const userId = req.userId;
        // Effective plan via the canonical resolver (planGate is the single source
        // of truth): honors subscription.plan before the stale account-creation
        // tier field, lowercases, and is workspace-aware — a member's events stamp
        // the plan tier they actually experience, not their personal free tier.
        // getUserPlanForRequest never throws (falls back to 'starter'), so the
        // never-block contract of this endpoint is preserved.
        const planTier = await getUserPlanForRequest(req);

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
