'use strict';

/**
 * Shared helpers for public pitch sharing (token hashing + safe field projection).
 *
 * Extracted so the share endpoints (routes/shareRoutes.js) and the owner-or-token
 * GET /pitch/:pitchId path (routes/pitchRoutes.js, F-1004) apply the SAME token-hash
 * comparison and the SAME public field allowlist — a token-bearer must never receive the
 * full pitch document, only the sanitized projection.
 */

const crypto = require('crypto');

/**
 * Hash a plaintext share token using SHA-256.
 * Raw tokens are NEVER persisted — only the hash is stored in Firestore.
 */
function hashToken(plainToken) {
    return crypto.createHash('sha256').update(plainToken).digest('hex');
}

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

module.exports = { hashToken, PUBLIC_ALLOWLIST, projectPublicFields };
