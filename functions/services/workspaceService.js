'use strict';

/**
 * workspaceService.js — Core workspace CRUD for multi-user workspaces.
 *
 * Collections:
 *   workspaces/{workspaceId}                — workspace metadata + memberIds mirror
 *   workspaceMembers/{workspaceId}_{uid}    — per-member doc (source of truth for role/status)
 *   teams/{ownerUid}                        — plan-inheritance mirror (kept in sync)
 *
 * Design decisions (Phase 0 sign-off):
 *   - Auto-generated workspace ID (not ws_{ownerUid})
 *   - workspaceMembers doc collection + memberIds[] array mirror
 *   - Roles stored as lowercase strings: 'contributor', 'manager', 'admin'
 *   - Owner is a flag (isWorkspaceOwner: true), not a 4th role
 *   - Admin SDK for all writes (firestore.rules: write: false)
 *   - Credit pooling deferred to R2 — owner balance used for R1
 */

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getPlanLimits } = require('../config/stripe');

const VALID_ROLES = Object.keys(require('../middleware/workspaceRoleGuard').ROLE_RANK);
const ACTIVE_STATUSES = ['active'];

// ── Workspace CRUD ──────────────────────────────────────────────────────────

/**
 * Create a new workspace for a user.
 *
 * @param {string} ownerUid - Firebase UID of the workspace owner
 * @param {object} options
 * @param {string} [options.name] - Workspace display name
 * @param {string} [options.ownerEmail] - Owner email (denormalized)
 * @param {string} [options.ownerDisplayName] - Owner display name
 * @param {string} [options.workspaceId] - Deterministic ID for bootstrap (optional)
 * @returns {Promise<object>} Created workspace document data + id
 */
async function createWorkspace(ownerUid, options = {}) {
    const db = admin.firestore();

    // Check if owner already has a workspace
    const existing = await getWorkspaceForUser(ownerUid);
    if (existing) {
        return existing;
    }

    // Legacy workspace fields are display mirrors only. Creating membership does
    // not attest a paid plan; new admissions require a protected assignment.
    const seatLimit = null;

    const now = FieldValue.serverTimestamp();

    const workspaceData = {
        ownerId:             ownerUid,
        entitlementOwnerUid: ownerUid,
        name:                options.name || `${options.ownerDisplayName || 'My'}'s Workspace`,
        memberIds:           [ownerUid],
        memberCount:         1,
        seatLimit,
        createdAt:           now,
        updatedAt:           now,
    };

    // Use deterministic ID if provided (bootstrap), otherwise auto-generate
    let workspaceRef;
    if (options.workspaceId) {
        workspaceRef = db.collection('workspaces').doc(options.workspaceId);
        await workspaceRef.set(workspaceData);
    } else {
        workspaceRef = await db.collection('workspaces').add(workspaceData);
    }

    const workspaceId = workspaceRef.id;

    // Seed workspaceBranding/{wsId} from owner's agencyBrandOverrides (if any).
    // This eliminates the B2 risk window: resolveBrand() in workspace context reads
    // ONLY from workspaceBranding/{wsId} (write:false in rules). Without this seed,
    // it would fall back to the client-writable agencyBrandOverrides/{ownerUid}.
    try {
        const brandSnap = await db.collection('agencyBrandOverrides').doc(ownerUid).get();
        if (brandSnap.exists) {
            await db.collection('workspaceBranding').doc(workspaceId).set({
                ...brandSnap.data(),
                _seededFromUid: ownerUid,
                _seededAt: now,
            });
        }
        // No agencyBrandOverrides → workspaceBranding stays absent → resolveBrand returns defaults
    } catch (brandErr) {
        // Non-blocking — workspace is usable with default branding
        console.warn(`[WorkspaceService] Failed to seed workspaceBranding/${workspaceId}:`, brandErr.message);
    }

    // Create owner's workspaceMembers doc
    const memberDocId = `${workspaceId}_${ownerUid}`;
    await db.collection('workspaceMembers').doc(memberDocId).set({
        workspaceId,
        uid:                  ownerUid,
        email:                (options.ownerEmail || '').toLowerCase(),
        displayName:          options.ownerDisplayName || '',
        displayNameSnapshot:  options.ownerDisplayName || '',
        role:                 'admin',
        isWorkspaceOwner:     true,
        status:               'active',
        joinedAt:             now,
        invitedBy:            null,
        removedAt:            null,
        reactivatedAt:        null,
        updatedAt:            now,
    });

    return { id: workspaceId, ...workspaceData };
}

/**
 * Get the workspace for a given user (as owner or active member).
 *
 * @param {string} userId
 * @returns {Promise<object|null>} Workspace data + id, or null
 */
async function getWorkspaceForUser(userId) {
    return (await getActiveWorkspacesForUser(userId))[0] || null;
}

/**
 * Get workspace by ID.
 *
 * @param {string} workspaceId
 * @returns {Promise<object|null>}
 */
async function getWorkspaceById(workspaceId) {
    const db = admin.firestore();
    const doc = await db.collection('workspaces').doc(workspaceId).get();
    if (!doc.exists) return null;
    const ownerUid = await require('./workspaceEntitlements').workspaceOwner(db, workspaceId);
    return { ...doc.data(), id: doc.id, ownerId: ownerUid, entitlementOwnerUid: ownerUid };
}

/**
 * Get all active members of a workspace.
 *
 * @param {string} workspaceId
 * @returns {Promise<object[]>}
 */
async function getWorkspaceMembers(workspaceId) {
    const db = admin.firestore();
    const snap = await db.collection('workspaceMembers')
        .where('workspaceId', '==', workspaceId)
        .where('status', 'in', ACTIVE_STATUSES)
        .get();

    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

/**
 * Get a specific member's membership doc.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
async function getMembership(workspaceId, uid) {
    const db = admin.firestore();
    const docId = `${workspaceId}_${uid}`;
    const doc = await db.collection('workspaceMembers').doc(docId).get();
    if (!doc.exists) return null;
    return { ...doc.data(), id: doc.id };
}

/**
 * Get a user's role in a workspace.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @returns {Promise<string|null>} Role string or null if not a member
 */
async function getMemberRole(workspaceId, uid) {
    const membership = await getMembership(workspaceId, uid);
    if (!membership || membership.status !== 'active') return null;
    return membership.role;
}

// ── Member Mutations ────────────────────────────────────────────────────────

/**
 * Add a member to a workspace. Creates workspaceMembers doc + mirrors to
 * workspace.memberIds[] and teams/{ownerUid}.memberUids[] + members[].
 * All writes are in ONE atomic batch.
 *
 * @param {string} workspaceId
 * @param {object} memberData
 * @param {string} memberData.uid
 * @param {string} memberData.email
 * @param {string} memberData.displayName
 * @param {string} memberData.role - 'contributor' | 'manager' | 'admin'
 * @param {string|null} [memberData.invitedBy]
 * @param {object|null} [memberData.teamMemberEntry] - Legacy teams.members[] object to add atomically
 * @returns {Promise<object>} Created membership doc data
 */
async function addMember(workspaceId, memberData) {
    if (!VALID_ROLES.includes(memberData.role)) throw new Error('Invalid role');
    const db = admin.firestore();
    const { workspaceState, enforceAdmission, writeSnapshot, failure } = require('./workspaceEntitlements');
    const identity = await admin.auth().getUser(memberData.uid);
    if (identity.disabled) throw failure('ACCOUNT_DISABLED', 'Disabled users cannot be admitted.', 403);
    return db.runTransaction(async tx => {
        const state = await workspaceState(db, tx, workspaceId);
        const admitted = enforceAdmission(state, memberData.uid);
        const existing = state.members.get(memberData.uid);
        if (!admitted) return existing;
        const teamRef = db.collection('teams').doc(state.ownerUid);
        const team = await tx.get(teamRef);
        const now = FieldValue.serverTimestamp();
        const member = { ...(existing || {}), workspaceId, uid: memberData.uid,
            email: (memberData.email || existing?.email || '').toLowerCase(),
            displayName: memberData.displayName || existing?.displayName || '',
            displayNameSnapshot: memberData.displayName || existing?.displayNameSnapshot || '',
            role: memberData.role, isWorkspaceOwner: false, status: 'active',
            joinedAt: existing?.joinedAt || now, invitedBy: memberData.invitedBy || existing?.invitedBy || null,
            removedAt: null, reactivatedAt: existing ? now : null, updatedAt: now };
        tx.set(db.collection('workspaceMembers').doc(workspaceId + '_' + memberData.uid), member);
        writeSnapshot(tx, state, true);
        tx.update(state.wsRef, { memberIds: FieldValue.arrayUnion(memberData.uid), memberCount: state.used + 1, updatedAt: now });
        if (team.exists) {
            const members = (team.data().members || []).filter(m => m.uid !== memberData.uid);
            members.push({ uid: memberData.uid, email: member.email, displayName: member.displayName, role: member.role, status: 'active', joinedAt: existing?.joinedAt || Timestamp.now() });
            tx.update(teamRef, { memberUids: FieldValue.arrayUnion(memberData.uid), members, updatedAt: now });
        }
        return member;
    });
}

async function reactivateMember(workspaceId, uid, newRole) {
    const existing = await getMembership(workspaceId, uid);
    if (!existing) throw new Error('Member not found');
    return addMember(workspaceId, { ...existing, uid, role: newRole || existing.role });
}

/**
 * Mark a member as removed. Updates workspaceMembers status + mirrors.
 * Does NOT hard-delete — preserves audit trail.
 * All writes are in ONE atomic batch.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @param {object} [options]
 * @param {object[]} [options.updatedTeamMembers] - Replacement teams.members[] array (filtered)
 * @returns {Promise<void>}
 */
async function removeMember(workspaceId, uid, options = {}) {
    const db = admin.firestore();
    const memberDocId = `${workspaceId}_${uid}`;
    const now = FieldValue.serverTimestamp();

    const membership = await getMembership(workspaceId, uid);
    if (!membership) throw new Error('Member not found');
    if (membership.isWorkspaceOwner) throw new Error('Cannot remove workspace owner');

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const batch = db.batch();

    batch.update(db.collection('workspaceMembers').doc(memberDocId), {
        status:    'removed',
        removedAt: now,
        updatedAt: now,
    });

    batch.update(db.collection('workspaces').doc(workspaceId), {
        memberIds:   FieldValue.arrayRemove(uid),
        memberCount: FieldValue.increment(-1),
        updatedAt:   now,
    });

    const teamsRef = db.collection('teams').doc(workspace.ownerId);
    const teamsDoc = await teamsRef.get();
    if (teamsDoc.exists) {
        const teamsUpdate = {
            memberUids: FieldValue.arrayRemove(uid),
            updatedAt:  now,
        };
        if (options.updatedTeamMembers) {
            teamsUpdate.members = options.updatedTeamMembers;
        }
        batch.update(teamsRef, teamsUpdate);
    }

    await batch.commit();
}

/**
 * Update a member's role.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @param {string} newRole
 * @returns {Promise<void>}
 */
async function updateMemberRole(workspaceId, uid, newRole) {
    if (!VALID_ROLES.includes(newRole)) {
        throw new Error(`Invalid role: ${newRole}`);
    }

    const db = admin.firestore();
    const memberDocId = `${workspaceId}_${uid}`;

    const membership = await getMembership(workspaceId, uid);
    if (!membership) throw new Error('Member not found');
    if (membership.isWorkspaceOwner) throw new Error('Cannot change workspace owner role');

    await db.collection('workspaceMembers').doc(memberDocId).update({
        role:      newRole,
        updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Update workspace seat limit (called when owner's plan changes).
 *
 * @param {string} workspaceId
 * @param {string} plan - Plan name
 * @returns {Promise<void>}
 */
async function updateSeatLimit(workspaceId, plan) {
    const db = admin.firestore();
    const limits = getPlanLimits(plan);
    const seatLimit = limits.teamMembers === -1 ? -1 : (limits.teamMembers || 1);

    await db.collection('workspaces').doc(workspaceId).update({
        seatLimit,
        updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Get ALL workspaces where a user is an active member (including as owner).
 * Unlike getWorkspaceForUser(), this does NOT use limit(1) — it returns every
 * active workspace the user belongs to, enabling the resolver to distinguish
 * "single workspace" from "multiple workspaces" and enforce the correct policy.
 *
 * @param {string} userId
 * @returns {Promise<object[]>} Array of { id, ...workspaceData } — may be empty
 */
async function getActiveWorkspacesForUser(userId) {
    const db = admin.firestore();
    const rows = await db.collection('workspaceMembers').where('uid', '==', userId).get();
    const memberships = rows.docs.filter(doc => {
        const m = doc.data();
        return m.status === 'active' && typeof m.workspaceId === 'string' && doc.id === m.workspaceId + '_' + userId;
    }).sort((a, b) => Number(b.data().isWorkspaceOwner === true) - Number(a.data().isWorkspaceOwner === true));
    const result = [], seen = new Set();
    for (const doc of memberships) {
        const workspaceId = doc.data().workspaceId;
        if (seen.has(workspaceId)) continue;
        seen.add(workspaceId);
        const workspace = await getWorkspaceById(workspaceId);
        if (workspace) result.push(workspace);
    }
    return result;
}

module.exports = {
    VALID_ROLES,
    createWorkspace,
    getWorkspaceForUser,
    getActiveWorkspacesForUser,
    getWorkspaceById,
    getWorkspaceMembers,
    getMembership,
    getMemberRole,
    addMember,
    reactivateMember,
    removeMember,
    updateMemberRole,
    updateSeatLimit,
};
