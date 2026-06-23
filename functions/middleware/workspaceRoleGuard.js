'use strict';

/**
 * workspaceRoleGuard.js — Phase 3B
 *
 * Middleware factory that enforces workspace role requirements.
 * Reads from the live workspaceMembers doc (via req.workspaceRole set by
 * workspaceResolver), NOT from any client-supplied claim.
 *
 * Role hierarchy: contributor < manager < admin
 *
 * Usage in route handlers:
 *   const { requireRole } = require('../middleware/workspaceRoleGuard');
 *
 *   // Inline check (no middleware chain — works with our custom router)
 *   if (!requireRole(req, 'manager')) {
 *       return res.status(403).json({ success: false, error: 'Requires manager or admin role' });
 *   }
 */

const ROLE_RANK = {
    contributor: 0,
    manager:     1,
    admin:       2,
};

/**
 * Check whether the caller's workspace role meets the minimum required.
 *
 * Returns true if:
 *   1. The caller IS in a workspace context (req.workspaceId is set), AND
 *   2. The caller's role (req.workspaceRole) is >= the required role
 *
 * Returns false otherwise (solo user, or role insufficient).
 *
 * @param {object} req — Express request (with workspaceResolver fields)
 * @param {string} minimumRole — 'contributor' | 'manager' | 'admin'
 * @returns {boolean}
 */
function requireRole(req, minimumRole) {
    if (!req.workspaceId) return false;
    const callerRank = ROLE_RANK[req.workspaceRole];
    const requiredRank = ROLE_RANK[minimumRole];
    if (callerRank === undefined || requiredRank === undefined) return false;
    return callerRank >= requiredRank;
}

/**
 * Check whether a workspace-mode caller can access a specific resource.
 *
 * Workspace scoping rules:
 *   - Contributor: can only access resources where createdByUid === req.userId
 *   - Manager / Admin: can access all resources in the workspace
 *
 * @param {object} req — Express request
 * @param {string} resourceCreatedByUid — the UID that created the resource
 * @returns {boolean} — true if access is allowed
 */
function canAccessResource(req, resourceCreatedByUid) {
    if (!req.workspaceId) return false;

    // Manager and admin see everything in the workspace
    if (requireRole(req, 'manager')) return true;

    // Contributor sees only own resources
    return resourceCreatedByUid === req.userId;
}

/**
 * Build a Firestore query scoped to the workspace + caller's role.
 *
 * For manager/admin: returns all docs where workspaceId matches.
 * For contributor: returns only docs where workspaceId matches AND
 *                  createdByUid === req.userId.
 *
 * IMPORTANT: Firestore equality filters naturally exclude documents where
 * the queried field is absent (null/undefined). This means legacy docs
 * without workspaceId are automatically excluded — no extra filter needed.
 *
 * @param {FirebaseFirestore.Query} baseQuery — e.g. db.collection('pitches')
 * @param {object} req — Express request with workspace context
 * @param {object} [options]
 * @param {string} [options.workspaceIdField='workspaceId'] — field name on the doc
 * @param {string} [options.creatorField='createdByUid'] — field name for the creator UID
 * @returns {FirebaseFirestore.Query}
 */
function scopeQueryToWorkspace(baseQuery, req, options = {}) {
    const wsField = options.workspaceIdField || 'workspaceId';
    const creatorField = options.creatorField || 'createdByUid';

    let query = baseQuery.where(wsField, '==', req.workspaceId);

    // Contributor: further restrict to own resources
    if (!requireRole(req, 'manager')) {
        query = query.where(creatorField, '==', req.userId);
    }

    return query;
}

module.exports = {
    ROLE_RANK,
    requireRole,
    canAccessResource,
    scopeQueryToWorkspace,
};
