'use strict';

/**
 * workspaceResolver.js — Express-style middleware that resolves workspace
 * context for the authenticated user.
 *
 * After running:
 *   req.workspaceId         — workspace ID (or null for solo users)
 *   req.workspaceRole       — 'contributor' | 'manager' | 'admin' | null
 *   req.workspaceMembership — full workspaceMembers doc data | null
 *   req.entitlementOwnerUid — UID whose plan/credits to charge (owner UID, or self)
 *
 * CROSS-CUTTING INVARIANT (Phase 3B hardening):
 *   Active workspace membership means workspace authorization is MANDATORY, never optional.
 *
 *   - Single active membership + no candidate → auto-assign that workspace.
 *   - Multiple active memberships + no candidate → reject (400).
 *   - Explicit candidate that user does not actively belong to → reject (403).
 *   - Resolver failure (Firestore error, missing mirror data) → reject (500). Never fall through.
 *   - Solo fallback (null workspace fields) is ONLY for users with zero active memberships.
 *
 * Workspace candidate is provided via the `x-workspace-id` request header.
 *
 * @param {object} req
 * @returns {Promise<void>}
 * @throws {WorkspaceResolutionError} — caught by the caller and returned as HTTP error
 */

const { getActiveWorkspacesForUser, getMembership } = require('../services/workspaceService');
const { normalizeRole } = require('./workspaceRoleGuard');

/**
 * Structured error for workspace resolution failures.
 * The caller (index.js middleware chain) can inspect `.statusCode` and `.code`
 * to return the appropriate HTTP response.
 */
class WorkspaceResolutionError extends Error {
    /**
     * @param {string} message
     * @param {number} statusCode
     * @param {string} code
     */
    constructor(message, statusCode, code) {
        super(message);
        this.name = 'WorkspaceResolutionError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

/**
 * Resolve workspace context onto the request.
 * Call after verifyAuth has set req.userId.
 *
 * @param {object} req
 * @returns {Promise<void>}
 * @throws {WorkspaceResolutionError}
 */
async function resolveWorkspace(req) {
    // Defaults — solo mode
    req.workspaceId = null;
    req.workspaceRole = null;
    req.workspaceMembership = null;
    req.entitlementOwnerUid = req.userId !== 'anonymous' ? req.userId : null;

    if (!req.userId || req.userId === 'anonymous') return;

    // Read explicit workspace candidate from header
    const rawCandidate = req.headers && req.headers['x-workspace-id']
        ? String(req.headers['x-workspace-id']).trim()
        : '';
    const candidateId = rawCandidate || null; // empty-after-trim → null

    let workspaces;
    try {
        workspaces = await getActiveWorkspacesForUser(req.userId);
    } catch (err) {
        // Firestore error during workspace enumeration — FAIL CLOSED
        console.error('[WorkspaceResolver] Failed to enumerate workspaces (fail-closed):', err.message);
        throw new WorkspaceResolutionError(
            'Workspace resolution failed. Please try again.',
            500,
            'WORKSPACE_RESOLUTION_FAILED'
        );
    }

    // No active workspaces → legitimate solo user
    if (!workspaces || workspaces.length === 0) {
        // If the client explicitly asked for a workspace they don't belong to, reject
        if (candidateId) {
            throw new WorkspaceResolutionError(
                'You do not belong to any active workspace.',
                403,
                'WORKSPACE_NOT_FOUND'
            );
        }
        return; // Solo mode — legitimate
    }

    // ── Resolve target workspace ─────────────────────────────────────────────

    let targetWorkspace;

    if (candidateId) {
        // Client provided an explicit workspace candidate — validate it
        targetWorkspace = workspaces.find(ws => ws.id === candidateId);
        if (!targetWorkspace) {
            throw new WorkspaceResolutionError(
                'You are not an active member of the requested workspace.',
                403,
                'WORKSPACE_MEMBERSHIP_REQUIRED'
            );
        }
    } else if (workspaces.length === 1) {
        // Single active workspace — auto-assign
        targetWorkspace = workspaces[0];
    } else {
        // Multiple active workspaces and no candidate — ambiguous, reject
        throw new WorkspaceResolutionError(
            `You belong to ${workspaces.length} workspaces. Provide x-workspace-id header to select one.`,
            400,
            'WORKSPACE_AMBIGUOUS'
        );
    }

    // ── Validate active membership ───────────────────────────────────────────

    let membership;
    try {
        membership = await getMembership(targetWorkspace.id, req.userId);
    } catch (err) {
        // Membership lookup failure — FAIL CLOSED
        console.error('[WorkspaceResolver] Membership lookup failed (fail-closed):', err.message);
        throw new WorkspaceResolutionError(
            'Workspace membership verification failed. Please try again.',
            500,
            'WORKSPACE_RESOLUTION_FAILED'
        );
    }

    if (!membership || membership.status !== 'active') {
        // Membership doc missing or not active despite workspace enumeration
        // returning this workspace — inconsistent mirror data. FAIL CLOSED.
        console.error(
            `[WorkspaceResolver] Inconsistent state: user ${req.userId} found in workspace ` +
            `${targetWorkspace.id} enumeration but membership is ${membership ? membership.status : 'missing'}`
        );
        throw new WorkspaceResolutionError(
            'Workspace membership data is inconsistent. Please contact support.',
            500,
            'WORKSPACE_MEMBERSHIP_INCONSISTENT'
        );
    }

    // ── Set workspace context ────────────────────────────────────────────────

    req.workspaceId = targetWorkspace.id;
    // Canonicalize the stored role once, here, so every downstream reader
    // (requireRole, canAccessResource, feature routes) sees a valid vocabulary
    // value and a legacy/miscased role never fails closed.
    req.workspaceRole = normalizeRole(membership.role);
    req.workspaceMembership = membership;
    req.entitlementOwnerUid = targetWorkspace.entitlementOwnerUid || targetWorkspace.ownerId;
}

module.exports = { resolveWorkspace, WorkspaceResolutionError };
