/**
 * attioRoutes.js — Sprint 6
 *
 * POST /attio/push-account
 *   Reads Account360 data and pushes to Attio as a Company + Person record.
 *   Updates outboundState.attioId on success.
 *   Actions matching unread/read alerts for the account.
 *   Fires Entity360 bridge event (fire-and-forget).
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { pushLeadToAttio } = require('../services/attioClient');
const entity360Bridge = require('../services/entity360Bridge');

const router = createRouter();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuth(req, res, next) {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
}

// ── POST /attio/push-account ──────────────────────────────────────────────────

router.post('/attio/push-account', requireAuth, async (req, res) => {
    try {
        const { accountKey } = req.body;
        const userId = req.userId;

        if (!accountKey) {
            return res.status(400).json({ success: false, error: 'accountKey is required' });
        }

        // 1. Read Account360 doc
        const account360Ref = db.collection('Account360').doc(accountKey);
        const account360Snap = await account360Ref.get();

        if (!account360Snap.exists) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        const account = account360Snap.data();

        // 2. Read outbound_view (prefer if fresh), fall back to Account360 doc
        let av = account;
        try {
            const viewRef = account360Ref.collection('agentViews').doc('outbound_view');
            const viewSnap = await viewRef.get();
            if (viewSnap.exists) {
                const viewData = viewSnap.data();
                const expiresAt = viewData.expiresAt?.toDate?.() || new Date(viewData.expiresAt);
                if (expiresAt > new Date()) {
                    av = { ...account, ...viewData };
                }
            }
        } catch (e) {
            console.warn('[AttioRoutes] outbound_view read failed, using Account360 doc:', e.message);
        }

        // 3. Extract Account360 fields
        const companyName = av.companyName?.value || account.companyName?.value || account.domain || 'Unknown';
        const domain = account.domain;
        const intentSignals = av.intentSignals || account.intentSignals || {};
        const contacts = av.identity?.identifiedContacts || account.identity?.identifiedContacts || [];
        const contact = contacts[0] || null;
        const highIntentPages = intentSignals.highIntentPages || [];
        const status = intentSignals.status || 'unknown';
        const score = intentSignals.currentScore?.value ?? 0;
        const whyNow = Array.isArray(intentSignals.scoreExplanation)
            ? intentSignals.scoreExplanation[0]
            : (intentSignals.scoreExplanation || null);

        // 4. Build Intel Signal string from visitor intel data
        const signalParts = [
            `Visitor Intel — Status: ${status} | Score: ${score}`,
            whyNow || null,
            highIntentPages.slice(0, 3).map(p => p.tag || p.url || p).filter(Boolean).join(', ') || null
        ].filter(Boolean);
        const intelSignal = signalParts.join('\n');

        // 5. Map Account360 → attioClient lead shape
        const lead = {
            name: companyName,
            website: domain ? (domain.startsWith('http') ? domain : `https://${domain}`) : null,
            decisionMaker: contact ? {
                name: contact.name || null,
                email: contact.email || null,
                title: contact.title || null
            } : null,
            email: contact?.email || null,
            intelSignal
        };

        const report = {
            city: null,
            state: null,
            industry: account.industry?.value || null,
            reportId: accountKey
        };

        // 6. Push to Attio
        const attioResult = await pushLeadToAttio(lead, report);
        const attioId = attioResult.companyId || attioResult.personId || `vi_${accountKey.substring(0, 8)}_${Date.now()}`;

        // 7. Update Account360 outboundState
        await account360Ref.update({
            'outboundState.attioId': attioId,
            'outboundState.lastOutboundAt': FieldValue.serverTimestamp()
        });

        // 8. Write signalHistory entry for push history
        const historyRef = account360Ref.collection('signalHistory').doc();
        await historyRef.set({
            eventType: 'CRM_PUSH',
            attioId,
            pushedBy: userId,
            companyName,
            domain,
            timestamp: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp()
        });

        // 9. Action matching alerts (fire-and-forget — non-blocking)
        _actionMatchingAlerts(db, userId, accountKey);

        // 10. Entity360 bridge (fire-and-forget)
        _fireEntity360CrmPush(db, account, attioId, domain, userId);

        return res.json({ success: true, attioId, companyName });

    } catch (err) {
        console.error('[AttioRoutes] push-account error:', err.message);
        // Return 200 with success:false per sprint spec (not a server error — Attio API down is expected in emulator)
        return res.json({ success: false, error: err.message });
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mark all unread/read alerts for this accountKey as actioned.
 * Non-blocking — errors are logged only.
 */
function _actionMatchingAlerts(db, userId, accountKey) {
    db.collection('notifications').doc(userId)
        .collection('alerts')
        .where('accountKey', '==', accountKey)
        .where('status', 'in', ['unread', 'read'])
        .get()
        .then(snap => {
            if (snap.empty) return;
            const batch = db.batch();
            snap.docs.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'actioned',
                    actionedAt: FieldValue.serverTimestamp()
                });
            });
            return batch.commit();
        })
        .catch(e => console.warn('[AttioRoutes] Alert actioning failed:', e.message));
}

/**
 * Read merchantConfig and fire entity360Bridge CRM_PUSH event.
 * Non-blocking — errors logged only, never throws.
 */
function _fireEntity360CrmPush(db, account, attioId, domain, userId) {
    const merchantId = account.workspaceId;
    if (!merchantId) return;

    db.collection('merchantConfig').doc(merchantId).get()
        .then(snap => {
            if (!snap.exists) return;
            const config = snap.data();
            if (!config.entity360MerchantId) return;
            entity360Bridge.fireEvent(config.entity360MerchantId, 'CRM_PUSH', 'INFO', {
                attioId,
                domain,
                pushedBy: userId
            });
        })
        .catch(e => console.warn('[AttioRoutes] Entity360 CRM_PUSH failed:', e.message));
}

module.exports = router;
