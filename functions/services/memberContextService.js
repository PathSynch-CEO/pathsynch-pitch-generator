'use strict';

/**
 * memberContextService.js — workspace-context resolution for the client.
 *
 * Backs GET /me/workspace-context. Resolves, server-side (Admin SDK, so it is
 * not subject to the client Firestore rules that block a member's array-contains
 * team lookup), the calling user's effective workspace plan, tier, subscription,
 * and the workspace Seller Profile.
 *
 * Why this exists: the client `getCurrentUser()` cannot resolve workspace
 * membership directly. The hardened `teams` rules reject a member's
 * array-contains list query, and the `users` read rule blocks reading the
 * owner's doc until the member is already in memberUids. Both are only
 * satisfiable server-side. This service is the sanctioned resolution path.
 *
 * Plan resolution goes through getUserPlan() — the single source of truth —
 * never re-derived here.
 *
 * If the caller has no active membership but has a pending, unexpired invite
 * addressed to their VERIFIED email, we self-heal by accepting it (constrained
 * verified-email accept). See acceptInviteByVerifiedEmail for the security
 * rationale. Expired invites are never resurrected — those need a fresh invite.
 */

const admin = require('firebase-admin');
const { getWorkspaceForUser } = require('./workspaceService');
const { acceptInviteByVerifiedEmail } = require('./workspaceInviteService');
const { getUserPlan } = require('../middleware/planGate');

const db = admin.firestore();

const ACTIVE_STATUSES = ['active'];

/**
 * Empty (non-member, non-owner) context — the caller keeps their own plan.
 */
function emptyContext() {
    return {
        isOwner: false,
        isWorkspaceMember: false,
        workspaceId: null,
        ownerUid: null,
        role: null,
        plan: null,
        tier: null,
        subscription: null,
        sellerProfile: null,
        autoAccepted: false,
    };
}

/**
 * Find a pending, unexpired invitation addressed to the given email.
 *
 * @param {string} email - Lowercased email
 * @returns {Promise<{id: string, data: object}|null>}
 */
async function _findPendingInvite(email) {
    const snap = await db.collection('teamInvitations')
        .where('inviteeEmail', '==', email)
        .where('status', '==', 'pending')
        .get();

    if (snap.empty) return null;

    const now = new Date();
    for (const doc of snap.docs) {
        const data = doc.data();
        const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
        // Skip expired invites — they are never auto-accepted.
        if (expiresAt && expiresAt < now) continue;
        if (!data.workspaceId) continue;
        return { id: doc.id, data };
    }
    return null;
}

/**
 * Resolve the calling user's role in a workspace.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @returns {Promise<string|null>}
 */
async function _resolveRole(workspaceId, uid) {
    const snap = await db.collection('workspaceMembers')
        .where('workspaceId', '==', workspaceId)
        .where('uid', '==', uid)
        .where('status', 'in', ACTIVE_STATUSES)
        .limit(1)
        .get();
    if (snap.empty) return null;
    return snap.docs[0].data().role || 'viewer';
}

/**
 * Resolve the full workspace context for a user.
 *
 * @param {string} uid - Firebase UID of the caller
 * @param {object} [opts]
 * @param {string} [opts.email] - Caller's email (from the auth token)
 * @param {boolean} [opts.emailVerified] - Whether the auth token's email is verified
 * @returns {Promise<object>} context (see emptyContext for shape)
 */
async function resolveWorkspaceContext(uid, opts = {}) {
    const email = (opts.email || '').toLowerCase();
    const emailVerified = opts.emailVerified === true;

    let workspace = await getWorkspaceForUser(uid);
    let autoAccepted = false;

    // Self-heal: verified-email auto-accept of a pending, unexpired invite.
    // Only attempted when the caller is not already a member/owner AND the auth
    // token's email is verified (proves control of the invited mailbox).
    if (!workspace && email && emailVerified) {
        const invite = await _findPendingInvite(email);
        if (invite) {
            try {
                const displayName = await _resolveDisplayName(uid);
                await acceptInviteByVerifiedEmail(invite.id, uid, email, displayName);
                autoAccepted = true;
                workspace = await getWorkspaceForUser(uid);

                // Fire-and-forget audit trail — never blocks resolution.
                _auditAutoAccept(invite.data.workspaceId, uid, invite.id, email);
            } catch (err) {
                // Non-fatal: fall through to empty context. The user simply keeps
                // their own plan; a later load or explicit accept can retry.
                console.warn('[memberContext] verified-email auto-accept failed:', err.message);
            }
        }
    }

    if (!workspace) {
        return emptyContext();
    }

    const ownerUid = workspace.entitlementOwnerUid || workspace.ownerId;
    const isOwner = ownerUid === uid;

    // Effective plan via the single source of truth. For members this resolves
    // the workspace OWNER's plan; for owners, their own.
    const plan = await getUserPlan(uid, { workspaceId: workspace.id });

    // Owner doc supplies the raw subscription object and the workspace Seller
    // Profile that members inherit.
    const ownerDoc = await db.collection('users').doc(ownerUid).get();
    const ownerData = ownerDoc.exists ? ownerDoc.data() : {};

    const role = isOwner ? 'owner' : (await _resolveRole(workspace.id, uid));

    return {
        isOwner,
        isWorkspaceMember: !isOwner,
        workspaceId: workspace.id,
        ownerUid,
        role,
        plan,
        // tier mirrors the resolved plan so client gates that check either field
        // behave identically. subscription is the owner's raw object.
        tier: plan,
        subscription: ownerData.subscription || null,
        sellerProfile: ownerData.sellerProfile || null,
        autoAccepted,
    };
}

/**
 * Read a display name for the accepting user (best-effort).
 */
async function _resolveDisplayName(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            const d = doc.data();
            return d.displayName || d.name || '';
        }
    } catch (_) { /* best-effort */ }
    return '';
}

/**
 * Fire-and-forget audit entry for a verified-email auto-accept.
 */
function _auditAutoAccept(workspaceId, uid, invitationId, email) {
    try {
        const { logAction } = require('./workspaceAuditService');
        // logAction is fire-and-forget and never throws; do not await.
        logAction(workspaceId, uid, 'member.auto_accept_verified_email', {
            targetUid: uid,
            details: { invitationId, email },
        });
    } catch (e) {
        console.warn('[memberContext] audit log unavailable:', e.message);
    }
}

module.exports = {
    resolveWorkspaceContext,
    // exported for tests
    _findPendingInvite,
};
