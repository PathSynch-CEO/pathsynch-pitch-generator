'use strict';

/**
 * workspaceAuditService.js — Append-only audit log for workspace actions.
 *
 * Collection: `workspaceAuditLog/{logId}`
 *
 * All writes via Admin SDK (firestore.rules: write: false).
 * logAction() is fire-and-forget — failure never throws to caller.
 *
 * Actions:
 *   MEMBER_INVITED | MEMBER_ACCEPTED | ROLE_CHANGED |
 *   MEMBER_OFFBOARDED | BRANDING_UPDATED | LEAD_EXPORTED |
 *   COMPANY_CONTEXT_EDITED | FORCE_REFRESH | OWNERSHIP_TRANSFER
 */

const admin = require('firebase-admin');

const COLLECTION = 'workspaceAuditLog';

/**
 * Log an action to the workspace audit log. Fire-and-forget.
 *
 * @param {string} workspaceId
 * @param {string} actorUid - UID of the user performing the action
 * @param {string} action   - Action constant (e.g. 'BRANDING_UPDATED')
 * @param {object} [options]
 * @param {string|null} [options.targetUid] - UID of the affected user (if any)
 * @param {object}      [options.details]   - Action-specific payload
 */
async function logAction(workspaceId, actorUid, action, options = {}) {
    try {
        const db = admin.firestore();

        await db.collection(COLLECTION).add({
            workspaceId,
            actorUid,
            action,
            targetUid: options.targetUid || null,
            details:   options.details   || {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        // Fire-and-forget — never throw to caller
        console.warn('[WorkspaceAudit] Failed to log action (non-blocking):', action, err.message);
    }
}

/**
 * Retrieve audit log entries for a workspace (newest first).
 *
 * @param {string} workspaceId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @returns {Promise<object[]>}
 */
async function getAuditLog(workspaceId, options = {}) {
    const db = admin.firestore();
    const limit = options.limit || 50;

    const snap = await db.collection(COLLECTION)
        .where('workspaceId', '==', workspaceId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
    logAction,
    getAuditLog,
};
