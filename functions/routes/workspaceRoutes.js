'use strict';

/**
 * workspaceRoutes.js — Workspace management endpoints (Phase 2+).
 *
 * All routes require authentication (req.userId from verifyAuth middleware).
 * Workspace context (req.workspaceId, req.workspaceRole) set by workspaceResolver.
 *
 * Phase 2 endpoints:
 *   PUT  /workspace/branding       — Update workspace branding (Admin only)
 *   GET  /workspace/branding       — Get current branding + latest version
 *   GET  /workspace/branding/history — List branding versions
 */

const express = require('express');
const admin = require('firebase-admin');
const { getMemberRole } = require('../services/workspaceService');
const { createBrandingVersion, getLatestBrandingVersion, listBrandingVersions } = require('../services/workspaceBrandingService');
const { logAction } = require('../services/workspaceAuditService');
const { resolveBrand, invalidateCache } = require('../services/brandResolver');
const { initiateOffboarding, processOffboardingBatch, completeOffboarding } = require('../services/workspaceOffboardingService');
const { requireRole } = require('../middleware/workspaceRoleGuard');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function unauthorized(msg) {
    const err = new Error(msg || 'Unauthorized');
    err.status = 401;
    return err;
}

function forbidden(msg) {
    const err = new Error(msg || 'Forbidden');
    err.status = 403;
    return err;
}

function handleError(error, res, context) {
    const status = error.status || 500;
    console.error(`[WorkspaceRoutes] ${context}:`, error.message);
    return res.status(status).json({
        success: false,
        error: error.message,
    });
}

// ── PUT /workspace/branding ─────────────────────────────────────────────────
/**
 * Update workspace branding. Admin only.
 *
 * Flow:
 *   1. Verify caller is workspace Admin (from live workspaceMembers doc)
 *   2. Update the owner's agencyBrandOverrides (the branding source)
 *   3. Create immutable branding version snapshot
 *   4. Write audit record
 *   5. Invalidate brand cache for workspace owner
 *
 * Body fields (all optional — only provided fields are updated):
 *   companyName, logoUrl, logoStoragePath, logoMimeType, logoWidth,
 *   accentColor, secondaryColor, footerText, contactEmail, contactPhone,
 *   websiteUrl, showPoweredByPathSynch, useCustomBranding
 */
router.put('/workspace/branding', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const workspaceId = req.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({
                success: false,
                error: 'No workspace context — branding update requires workspace membership',
            });
        }

        // 1. Verify role from live workspaceMembers doc (not cached req.workspaceRole)
        const liveRole = await getMemberRole(workspaceId, req.userId);
        if (liveRole !== 'admin') {
            throw forbidden('Only workspace Admins can update branding');
        }

        // 2. Get workspace doc to find the branding owner
        const db = admin.firestore();
        const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
        if (!wsDoc.exists) {
            return res.status(404).json({ success: false, error: 'Workspace not found' });
        }
        const workspace = wsDoc.data();
        const brandOwnerId = workspace.entitlementOwnerUid || workspace.ownerId;

        // 3. Update workspaceBranding/{workspaceId} — the server-only workspace branding source
        // This doc is write:false in firestore.rules. Only this Admin SDK handler can write it.
        // agencyBrandOverrides/{ownerUid} is the SOLO branding source — not touched here.
        const allowedFields = [
            'companyName', 'logoUrl', 'logoStoragePath', 'logoMimeType', 'logoWidth',
            'accentColor', 'secondaryColor', 'footerText', 'contactEmail', 'contactPhone',
            'websiteUrl', 'showPoweredByPathSynch', 'useCustomBranding', 'agencyName',
        ];
        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'No branding fields provided' });
        }

        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const wsBrandRef = db.collection('workspaceBranding').doc(workspaceId);
        await wsBrandRef.set(updateData, { merge: true });

        // 4. Resolve the brand to create an accurate snapshot
        invalidateCache(brandOwnerId);
        invalidateCache(`${brandOwnerId}:ws:${workspaceId}`);
        const resolvedBrand = await resolveBrand(brandOwnerId, { workspaceId });

        // 5. Create immutable branding version
        const version = await createBrandingVersion(
            workspaceId,
            resolvedBrand,
            req.userId,
            req.body.changeNote || null
        );

        // 6. Audit log (fire-and-forget)
        logAction(workspaceId, req.userId, 'BRANDING_UPDATED', {
            details: {
                versionId: version.id,
                versionNumber: version.version,
                fieldsChanged: Object.keys(updateData).filter(k => k !== 'updatedAt'),
            },
        });

        return res.status(200).json({
            success: true,
            data: {
                brandingVersionId: version.id,
                versionNumber: version.version,
                resolvedBrand,
            },
        });
    } catch (error) {
        return handleError(error, res, 'PUT /workspace/branding');
    }
});

// ── GET /workspace/branding ─────────────────────────────────────────────────
/**
 * Get current workspace branding + latest version info.
 * Any active workspace member can read.
 */
router.get('/workspace/branding', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const workspaceId = req.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ success: false, error: 'No workspace context' });
        }

        // Resolve workspace owner branding
        const resolvedBrand = await resolveBrand(req.userId, { workspaceId });
        const latestVersion = await getLatestBrandingVersion(workspaceId);

        return res.status(200).json({
            success: true,
            data: {
                resolvedBrand,
                latestVersion: latestVersion || null,
            },
        });
    } catch (error) {
        return handleError(error, res, 'GET /workspace/branding');
    }
});

// ── GET /workspace/branding/history ─────────────────────────────────────────
/**
 * List branding version history. Any active workspace member can read.
 */
router.get('/workspace/branding/history', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const workspaceId = req.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ success: false, error: 'No workspace context' });
        }

        const limit = parseInt(req.query.limit) || 20;
        const versions = await listBrandingVersions(workspaceId, limit);

        return res.status(200).json({
            success: true,
            data: { versions },
        });
    } catch (error) {
        return handleError(error, res, 'GET /workspace/branding/history');
    }
});

// ── POST /workspace/members/:uid/offboard ──────────────────────────────────
/**
 * Initiate offboarding for a workspace member. Manager/Admin only.
 *
 * Three stages run sequentially:
 *   1. initiateOffboarding — marks OFFBOARDING, creates job
 *   2. processOffboardingBatch — reassigns assets to successor
 *   3. completeOffboarding — marks REMOVED, syncs mirrors
 *
 * Body: { successorUid? } — defaults to workspace owner if omitted.
 *
 * Guards:
 *   - Cannot offboard the workspace owner (last-owner protection)
 *   - Requires manager or admin role
 */
router.post('/workspace/members/:uid/offboard', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const workspaceId = req.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ success: false, error: 'No workspace context' });
        }

        // Require manager or admin role
        if (!requireRole(req, 'manager')) {
            throw forbidden('Only Managers and Admins can offboard members');
        }

        const targetUid = req.params.uid;
        const { successorUid } = req.body || {};

        // Stage 1: Initiate
        const { jobId } = await initiateOffboarding(workspaceId, targetUid, req.userId, { successorUid });

        // Stage 2: Reassign assets
        const batchResult = await processOffboardingBatch(jobId);

        // Stage 3: Complete — mark REMOVED, sync mirrors
        await completeOffboarding(jobId);

        return res.status(200).json({
            success: true,
            data: {
                jobId,
                targetUid,
                pitchesReassigned: batchResult.pitchesReassigned,
                reportsReassigned: batchResult.reportsReassigned,
            },
        });
    } catch (error) {
        return handleError(error, res, 'POST /workspace/members/:uid/offboard');
    }
});

// ── Router handle function ──────────────────────────────────────────────────
/**
 * Handle function for index.js dispatch.
 * Returns true if the request was handled, false otherwise.
 */
async function handle(req, res) {
    return new Promise((resolve) => {
        router(req, res, () => resolve(false));
        // If a route matches and sends a response, we resolve true
        const origEnd = res.end;
        res.end = function (...args) {
            resolve(true);
            return origEnd.apply(this, args);
        };
    });
}

module.exports = { router, handle };
