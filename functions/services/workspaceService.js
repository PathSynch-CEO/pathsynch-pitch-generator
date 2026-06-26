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
const { getPlanLimits } = require('../config/stripe');

const VALID_ROLES = ['contributor', 'manager', 'admin'];
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

    // Resolve seat limit from owner's plan
    const { getUserPlan } = require('../middleware/planGate');
    const plan = await getUserPlan(ownerUid);
    const limits = getPlanLimits(plan);
    const seatLimit = limits.teamMembers === -1 ? -1 : (limits.teamMembers || 1);

    const now = admin.firestore.FieldValue.serverTimestamp();

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
    const db = admin.firestore();

    // Check as owner first (O(1) indexed query)
    const ownerSnap = await db.collection('workspaces')
        .where('ownerId', '==', userId)
        .limit(1)
        .get();

    if (!ownerSnap.empty) {
        const doc = ownerSnap.docs[0];
        return { id: doc.id, ...doc.data() };
    }

    // Check as member via workspaceMembers
    const memberSnap = await db.collection('workspaceMembers')
        .where('uid', '==', userId)
        .where('status', 'in', ACTIVE_STATUSES)
        .limit(1)
        .get();

    if (memberSnap.empty) return null;

    const membership = memberSnap.docs[0].data();
    const workspaceDoc = await db.collection('workspaces').doc(membership.workspaceId).get();

    if (!workspaceDoc.exists) return null;

    return { id: workspaceDoc.id, ...workspaceDoc.data() };
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
    return { id: doc.id, ...doc.data() };
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

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    return { id: doc.id, ...doc.data() };
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
    const db = admin.firestore();

    if (!VALID_ROLES.includes(memberData.role)) {
        throw new Error(`Invalid role: ${memberData.role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Check seat limit
    if (workspace.seatLimit !== -1 && workspace.memberCount >= workspace.seatLimit) {
        throw new Error('Workspace seat limit reached');
    }

    // Check for existing membership (reactivation case)
    const existingMembership = await getMembership(workspaceId, memberData.uid);
    if (existingMembership && existingMembership.status === 'active') {
        return existingMembership; // Already active — idempotent
    }
    if (existingMembership && existingMembership.status === 'removed') {
        return await reactivateMember(workspaceId, memberData.uid, memberData.role);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const memberDocId = `${workspaceId}_${memberData.uid}`;

    const memberDoc = {
        workspaceId,
        uid:                  memberData.uid,
        email:                (memberData.email || '').toLowerCase(),
        displayName:          memberData.displayName || '',
        displayNameSnapshot:  memberData.displayName || '',
        role:                 memberData.role,
        isWorkspaceOwner:     false,
        status:               'active',
        joinedAt:             now,
        invitedBy:            memberData.invitedBy || null,
        removedAt:            null,
        reactivatedAt:        null,
        updatedAt:            now,
    };

    const batch = db.batch();

    // 1. Create workspaceMembers doc
    batch.set(db.collection('workspaceMembers').doc(memberDocId), memberDoc);

    // 2. Mirror to workspace.memberIds[] + increment memberCount
    batch.update(db.collection('workspaces').doc(workspaceId), {
        memberIds:   admin.firestore.FieldValue.arrayUnion(memberData.uid),
        memberCount: admin.firestore.FieldValue.increment(1),
        updatedAt:   now,
    });

    // 3. Mirror to teams/{ownerUid} — memberUids[] + members[] in same batch
    const teamsRef = db.collection('teams').doc(workspace.ownerId);
    const teamsDoc = await teamsRef.get();
    if (teamsDoc.exists) {
        const teamsUpdate = {
            memberUids: admin.firestore.FieldValue.arrayUnion(memberData.uid),
            updatedAt:  now,
        };
        if (memberData.teamMemberEntry) {
            teamsUpdate.members = admin.firestore.FieldValue.arrayUnion(memberData.teamMemberEntry);
        }
        batch.update(teamsRef, teamsUpdate);
    }

    await batch.commit();

    return { id: memberDocId, ...memberDoc };
}

/**
 * Reactivate a previously removed member.
 *
 * @param {string} workspaceId
 * @param {string} uid
 * @param {string} [newRole] - Optional new role; keeps existing if not provided
 * @returns {Promise<object>}
 */
async function reactivateMember(workspaceId, uid, newRole) {
    const db = admin.firestore();
    const memberDocId = `${workspaceId}_${uid}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    // Check seat limit
    if (workspace.seatLimit !== -1 && workspace.memberCount >= workspace.seatLimit) {
        throw new Error('Workspace seat limit reached');
    }

    const updateData = {
        status:        'active',
        reactivatedAt: now,
        removedAt:     null,
        updatedAt:     now,
    };
    if (newRole && VALID_ROLES.includes(newRole)) {
        updateData.role = newRole;
    }

    const batch = db.batch();

    batch.update(db.collection('workspaceMembers').doc(memberDocId), updateData);

    batch.update(db.collection('workspaces').doc(workspaceId), {
        memberIds:   admin.firestore.FieldValue.arrayUnion(uid),
        memberCount: admin.firestore.FieldValue.increment(1),
        updatedAt:   now,
    });

    const teamsRef = db.collection('teams').doc(workspace.ownerId);
    const teamsDoc = await teamsRef.get();
    if (teamsDoc.exists) {
        batch.update(teamsRef, {
            memberUids: admin.firestore.FieldValue.arrayUnion(uid),
            updatedAt:  now,
        });
    }

    await batch.commit();

    const updated = await getMembership(workspaceId, uid);
    return updated;
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
    const now = admin.firestore.FieldValue.serverTimestamp();

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
        memberIds:   admin.firestore.FieldValue.arrayRemove(uid),
        memberCount: admin.firestore.FieldValue.increment(-1),
        updatedAt:   now,
    });

    const teamsRef = db.collection('teams').doc(workspace.ownerId);
    const teamsDoc = await teamsRef.get();
    if (teamsDoc.exists) {
        const teamsUpdate = {
            memberUids: admin.firestore.FieldValue.arrayRemove(uid),
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

    // 1. Workspaces this user owns
    const ownerSnap = await db.collection('workspaces')
        .where('ownerId', '==', userId)
        .get();

    const ownerWorkspaces = ownerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 2. Workspaces this user is an active member of (but not owner)
    const memberSnap = await db.collection('workspaceMembers')
        .where('uid', '==', userId)
        .where('status', 'in', ACTIVE_STATUSES)
        .get();

    // Collect workspace IDs from memberships that aren't already in owner list
    const ownerWsIds = new Set(ownerWorkspaces.map(ws => ws.id));
    const memberWsIds = [];
    for (const doc of memberSnap.docs) {
        const wsId = doc.data().workspaceId;
        if (!ownerWsIds.has(wsId)) {
            memberWsIds.push(wsId);
        }
    }

    // 3. Fetch full workspace docs for member-only workspaces
    const memberWorkspaces = [];
    for (const wsId of memberWsIds) {
        const wsDoc = await db.collection('workspaces').doc(wsId).get();
        if (wsDoc.exists) {
            memberWorkspaces.push({ id: wsDoc.id, ...wsDoc.data() });
        }
    }

    return [...ownerWorkspaces, ...memberWorkspaces];
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
