'use strict';

/**
 * onepagerShareRoutes.js — Public server-side share endpoint for one-pagers.
 *
 * Phase 1 server-boundary cutover: replaces the P0 unauthenticated client-side
 * Firestore read (firestore.rules: "allow read: if resource.data.shareId != null").
 *
 * Endpoint:
 *   GET /onepager/share/:shareId  — Public, no auth required.
 *                                   Returns denylist-projected fields only.
 *
 * DO NOT deploy firestore.rules removing the shareId public-read rule until
 * this endpoint is live AND onepager/index.html has been redeployed to use it.
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');

const router = createRouter();
const db = admin.firestore();

/**
 * Fields that must never be returned to an unauthenticated caller.
 * Onepager schema is open (created with ...onepagerData spread), so we
 * use a denylist rather than an allowlist.
 */
const PRIVATE_FIELDS = new Set([
    'userId',
    'workspaceId',
    'createdByUid',
    'createdBy',
]);

/**
 * Strip private fields and sanitize the analytics sub-object.
 */
function projectPublicFields(onepagerId, data) {
    const projected = { id: onepagerId };
    for (const [key, value] of Object.entries(data)) {
        if (!PRIVATE_FIELDS.has(key)) {
            projected[key] = value;
        }
    }
    // Only expose aggregate counters from analytics, not viewer details
    if (data.analytics) {
        projected.analytics = {
            views:     data.analytics.views     || 0,
            downloads: data.analytics.downloads || 0,
        };
    }
    return projected;
}

/**
 * GET /onepager/share/:shareId
 *
 * Public endpoint — no auth required (matches the GET /share/:shareToken pattern
 * in shareRoutes.js). Anonymous requests reach this handler because:
 *   1. verifyAuth() returns null on missing Authorization header (lib/shared.js:56-58)
 *   2. req.userId is set to 'anonymous' (index.js:224)
 *   3. resolveWorkspace is gated on req.userId !== 'anonymous' (index.js:230)
 *   4. Dispatch to this router is unconditional (no auth check before handle())
 *   5. This handler has no req.userId check — same pattern as GET /share/:shareToken
 */
router.get('/onepager/share/:shareId', async (req, res) => {
    try {
        const { shareId } = req.params;

        // shareIds are always exactly 8 chars (generateShareId in api.js)
        if (!shareId || shareId.length < 8) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_ID' } });
        }

        const snap = await db.collection('onepagers')
            .where('shareId', '==', shareId)
            .limit(1)
            .get();

        if (snap.empty) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        const doc = snap.docs[0];
        const data = doc.data();

        // isPublic !== false gate:
        //   true  → readable (created with isPublic: true by default)
        //   absent → readable (legacy docs without the field)
        //   false → revoked
        if (data.isPublic === false) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        // Server-side view tracking (fire-and-forget, never blocks response)
        doc.ref.update({
            'analytics.views':        admin.firestore.FieldValue.increment(1),
            'analytics.lastViewedAt': admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        return res.json({ success: true, data: projectPublicFields(doc.id, data) });

    } catch (err) {
        console.error('[OnepagerShareRoutes] GET /onepager/share/:shareId failed:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'FETCH_FAILED', message: err.message },
        });
    }
});

module.exports = router;
