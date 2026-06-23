'use strict';

/**
 * shareRoutes.js — Server-side share-token endpoints for pitches.
 *
 * Phase 3C: Replaces the direct Firestore read path (P0 leak) with
 * a server-side endpoint that returns only allowlisted fields.
 *
 * Endpoints:
 *   GET  /share/:shareToken        — Public read (no auth), allowlisted projection
 *   POST /pitches/:pitchId/share   — Auth required, generate crypto share token
 *   POST /pitches/:pitchId/revoke  — Auth required, revoke share token
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { canAccessResource } = require('../middleware/workspaceRoleGuard');

const router = createRouter();
const db = admin.firestore();

/**
 * Fields allowed in the public share response.
 * Everything else is stripped — especially userId, formData, salesLibrary,
 * pitchMetadata, triggerEvent, precallFormData, workspaceId, createdByUid.
 */
const PUBLIC_ALLOWLIST = new Set([
    'businessName',
    'contactName',
    'industry',
    'subIndustry',
    'address',
    'websiteUrl',
    'googleRating',
    'numReviews',
    'pitchLevel',
    'style',
    'html',
    'roiData',
    'reviewAnalysis',
    'reviewAnalytics',
    'reviewPitchMetrics',
    'createdAt',
    'updatedAt',
    'status',
    'linkedInPosts',
    'visuals',
]);

/**
 * Project only allowlisted fields from a pitch document.
 * Adds `id` and a sanitized `brand` (logo + colors only).
 */
function projectPublicFields(pitchId, pitchData) {
    const projected = { id: pitchId };

    for (const key of PUBLIC_ALLOWLIST) {
        if (pitchData[key] !== undefined) {
            projected[key] = pitchData[key];
        }
    }

    // Include only safe brand fields (logo + colors, not internal config)
    if (pitchData.resolvedBrand) {
        projected.brand = {};
        const safeBrandFields = [
            'companyName', 'agencyName', 'logoUrl',
            'accentColor', 'secondaryColor', 'footerText',
        ];
        for (const f of safeBrandFields) {
            if (pitchData.resolvedBrand[f] !== undefined) {
                projected.brand[f] = pitchData.resolvedBrand[f];
            }
        }
    }

    // Include view counts only (not viewer details)
    if (pitchData.analytics) {
        projected.analytics = {
            views: pitchData.analytics.views || 0,
            uniqueViewers: pitchData.analytics.uniqueViewers || 0,
        };
    }

    return projected;
}

/**
 * GET /share/:shareToken
 * Public endpoint — no auth required.
 * Returns only allowlisted fields via server-side projection.
 */
router.get('/share/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;

        if (!shareToken || shareToken.length < 32) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN' } });
        }

        // Query by sharing.shareToken (Phase 3C crypto token)
        const snap = await db.collection('pitches')
            .where('sharing.shareToken', '==', shareToken)
            .limit(1)
            .get();

        if (snap.empty) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        const doc = snap.docs[0];
        const data = doc.data();

        // Check for revocation
        if (data.sharing && data.sharing.revokedAt) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        // Track view (fire-and-forget)
        doc.ref.update({
            'analytics.views': admin.firestore.FieldValue.increment(1),
            'analytics.lastViewedAt': admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {}); // non-blocking

        return res.json({ success: true, data: projectPublicFields(doc.id, data) });
    } catch (err) {
        console.error('[ShareRoutes] GET /share/:shareToken failed:', err);
        return res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
    }
});

/**
 * POST /pitches/:pitchId/share
 * Auth required. Generates a crypto-random share token for the pitch.
 * Writes sharing.shareToken + sharing.sharedAt to the pitch document.
 *
 * If a token already exists and is not revoked, returns the existing token.
 */
router.post('/pitches/:pitchId/share', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED' } });
        }

        const { pitchId } = req.params;
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        const pitchData = pitchDoc.data();

        // Workspace access check
        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Pitch does not belong to your workspace' } });
            }
            if (!canAccessResource(req, pitchData.createdByUid || pitchData.userId)) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Contributors can only share their own pitches' } });
            }
        } else {
            // Solo mode: userId ownership check
            if (pitchData.userId !== req.userId) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
            }
        }

        // If a valid (non-revoked) token already exists, return it
        if (pitchData.sharing && pitchData.sharing.shareToken && !pitchData.sharing.revokedAt) {
            return res.json({
                success: true,
                shareToken: pitchData.sharing.shareToken,
                alreadyExisted: true,
            });
        }

        // Generate a new crypto-random token
        const shareToken = crypto.randomBytes(32).toString('hex');

        await pitchDoc.ref.update({
            'sharing.shareToken': shareToken,
            'sharing.sharedAt': admin.firestore.FieldValue.serverTimestamp(),
            'sharing.revokedAt': admin.firestore.FieldValue.delete(),
        });

        return res.status(201).json({
            success: true,
            shareToken,
            alreadyExisted: false,
        });
    } catch (err) {
        console.error('[ShareRoutes] POST /pitches/:pitchId/share failed:', err);
        return res.status(500).json({ success: false, error: { code: 'SHARE_FAILED', message: err.message } });
    }
});

/**
 * POST /pitches/:pitchId/revoke
 * Auth required. Revokes the active share token.
 */
router.post('/pitches/:pitchId/revoke', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED' } });
        }

        const { pitchId } = req.params;
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        const pitchData = pitchDoc.data();

        // Workspace access check
        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
            }
            if (!canAccessResource(req, pitchData.createdByUid || pitchData.userId)) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
            }
        } else {
            if (pitchData.userId !== req.userId) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
            }
        }

        await pitchDoc.ref.update({
            'sharing.revokedAt': admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true });
    } catch (err) {
        console.error('[ShareRoutes] POST /pitches/:pitchId/revoke failed:', err);
        return res.status(500).json({ success: false, error: { code: 'REVOKE_FAILED', message: err.message } });
    }
});

module.exports = router;
