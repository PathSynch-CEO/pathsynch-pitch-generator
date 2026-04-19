/**
 * alertRoutes.js — Sprint 4 Threshold Alert System
 *
 * GET  /alerts                      — list unread alerts for authenticated user (desc by createdAt)
 * POST /alerts/:alertId/read        — mark alert as read
 * POST /alerts/:alertId/action      — mark alert as actioned
 * POST /alerts/:alertId/dismiss     — mark dismissed + write 30-day suppression
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { writeSuppression } = require('../services/alertService');

const router = createRouter();
const db = admin.firestore();

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    if (!req.userId || req.userId === 'anonymous') {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
    }
    next();
}

// ── GET /alerts ───────────────────────────────────────────────────────────────

router.get('/alerts', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const snapshot = await db
            .collection('notifications').doc(userId)
            .collection('alerts')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const alerts = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                alertId: doc.id,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                lastVisit: data.lastVisit?.toDate?.()?.toISOString() || null
            };
        });

        const unreadCount = alerts.filter(a => a.status === 'unread').length;

        return res.json({ success: true, alerts, unreadCount });
    } catch (err) {
        console.error('[AlertRoutes] GET /alerts error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /alerts/:alertId/read ────────────────────────────────────────────────

router.post('/alerts/:alertId/read', requireAuth, async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.userId;

        const alertRef = db
            .collection('notifications').doc(userId)
            .collection('alerts').doc(alertId);

        const doc = await alertRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Alert not found' });
        }

        await alertRef.update({ status: 'read', readAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.json({ success: true, alertId, status: 'read' });
    } catch (err) {
        console.error('[AlertRoutes] POST /alerts/:id/read error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /alerts/:alertId/action ──────────────────────────────────────────────

router.post('/alerts/:alertId/action', requireAuth, async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.userId;

        const alertRef = db
            .collection('notifications').doc(userId)
            .collection('alerts').doc(alertId);

        const doc = await alertRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Alert not found' });
        }

        await alertRef.update({
            status: 'actioned',
            actionedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.json({ success: true, alertId, status: 'actioned' });
    } catch (err) {
        console.error('[AlertRoutes] POST /alerts/:id/action error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /alerts/:alertId/dismiss ─────────────────────────────────────────────

router.post('/alerts/:alertId/dismiss', requireAuth, async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.userId;

        const alertRef = db
            .collection('notifications').doc(userId)
            .collection('alerts').doc(alertId);

        const doc = await alertRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Alert not found' });
        }

        const alertData = doc.data();

        // Mark alert as dismissed
        await alertRef.update({
            status: 'dismissed',
            dismissedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Write 30-day suppression record for this account
        if (alertData.accountKey) {
            await writeSuppression(userId, alertData.accountKey);
        }

        return res.json({ success: true, alertId, status: 'dismissed', suppressed: true });
    } catch (err) {
        console.error('[AlertRoutes] POST /alerts/:id/dismiss error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
