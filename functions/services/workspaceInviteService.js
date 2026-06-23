'use strict';

/**
 * workspaceInviteService.js — Phase 3A
 *
 * Crypto-token invite system for workspace member onboarding.
 *
 * Flow:
 *   1. createInvite() — generates crypto token, stores SHA-256 hash in teamInvitations
 *   2. acceptInvite() — atomic Firestore transaction: hash lookup, seat limit check,
 *      workspaceMembers creation, teams mirror sync, invitation status update
 *
 * Token design:
 *   - 32-byte random token → hex string (64 chars)
 *   - SHA-256 hash stored in Firestore (never store plaintext)
 *   - Plaintext returned to caller for email link; never persisted server-side
 *   - Accept endpoint receives plaintext, hashes it, queries by hash
 *
 * Seat enforcement:
 *   - Checked inside a Firestore transaction at accept time
 *   - Two simultaneous accepts against the last seat → one succeeds, one fails
 *   - No seat reservation at invite time (R1 simplification)
 *
 * Reactivation:
 *   - If accepting user already has a REMOVED workspaceMembers doc,
 *     reactivateMember() is called instead of creating a new doc
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

const INVITE_TTL_DAYS = 7;

// ── Token helpers ─────────────────────────────────────────────────────────

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashToken(plainToken) {
    return crypto.createHash('sha256').update(plainToken).digest('hex');
}

// ── Create Invite ─────────────────────────────────────────────────────────

/**
 * Create a workspace invite with a crypto token.
 *
 * @param {string} workspaceId - Target workspace
 * @param {string} inviterUid - UID of the inviting user (must be owner/admin)
 * @param {string} inviteeEmail - Email to invite (normalized lowercase)
 * @param {string} role - 'contributor' | 'manager' | 'admin'
 * @param {object} [options]
 * @param {string} [options.inviterEmail] - For email display
 * @param {string} [options.inviterDisplayName] - For email display
 * @param {string} [options.workspaceName] - For email display
 * @returns {Promise<{ invitationId: string, plainToken: string }>}
 */
async function createInvite(workspaceId, inviterUid, inviteeEmail, role, options = {}) {
    const db = admin.firestore();

    // Validate workspace exists
    const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsDoc.exists) {
        throw new Error('Workspace not found');
    }
    const workspace = wsDoc.data();

    // Check for existing pending invite for this email + workspace
    const existingSnap = await db.collection('teamInvitations')
        .where('workspaceId', '==', workspaceId)
        .where('inviteeEmail', '==', inviteeEmail)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

    if (!existingSnap.empty) {
        // Check if it's expired
        const existingInvite = existingSnap.docs[0].data();
        const expiresAt = existingInvite.expiresAt?.toDate ? existingInvite.expiresAt.toDate() : null;
        if (expiresAt && expiresAt > new Date()) {
            throw new Error('A pending invitation already exists for this email');
        }
        // Expired — mark it and continue
        await existingSnap.docs[0].ref.update({ status: 'expired' });
    }

    // Check if already an active member
    const memberDocId = `${workspaceId}_${inviteeEmail}`;
    // We can't use email as doc ID — look up by email query
    const activeMemberSnap = await db.collection('workspaceMembers')
        .where('workspaceId', '==', workspaceId)
        .where('email', '==', inviteeEmail)
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (!activeMemberSnap.empty) {
        throw new Error('This person is already an active workspace member');
    }

    // Generate crypto token
    const plainToken = generateToken();
    const tokenHash = hashToken(plainToken);

    // Build expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

    const now = admin.firestore.FieldValue.serverTimestamp();

    const inviteData = {
        // Legacy fields (backward compat with existing teamInvitations queries)
        teamOwnerUid:  workspace.ownerId,
        inviteeEmail,
        role,
        status:        'pending',
        createdAt:     now,
        expiresAt:     admin.firestore.Timestamp.fromDate(expiresAt),
        acceptedAt:    null,
        acceptedByUid: null,
        // Phase 3A fields
        tokenHash,
        workspaceId,
        inviterUid,
    };

    const inviteRef = await db.collection('teamInvitations').add(inviteData);

    return {
        invitationId: inviteRef.id,
        plainToken,
    };
}

// ── Accept Invite ─────────────────────────────────────────────────────────

/**
 * Accept a workspace invite using the plaintext token.
 *
 * Runs inside a Firestore transaction to enforce seat limits atomically.
 * Binds by token+UID — the accepting user's email does NOT need to match
 * the invited email (standard invite-link pattern).
 *
 * @param {string} plainToken - The plaintext token from the invite link
 * @param {string} acceptingUid - Firebase UID of the accepting user
 * @param {string} acceptingEmail - Email of the accepting user
 * @param {string} acceptingDisplayName - Display name of the accepting user
 * @returns {Promise<{ workspaceId: string, role: string, membership: object }>}
 */
async function acceptInvite(plainToken, acceptingUid, acceptingEmail, acceptingDisplayName) {
    const db = admin.firestore();
    const tokenHash = hashToken(plainToken);

    // Find the invitation by token hash
    const inviteSnap = await db.collection('teamInvitations')
        .where('tokenHash', '==', tokenHash)
        .limit(1)
        .get();

    if (inviteSnap.empty) {
        throw new Error('Invalid or expired invitation token');
    }

    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data();

    // Pre-transaction validation (non-transactional reads are fine for these)
    if (invite.status !== 'pending') {
        throw new Error(`Invitation is already ${invite.status}`);
    }

    const expiresAt = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : null;
    if (expiresAt && expiresAt < new Date()) {
        await inviteDoc.ref.update({ status: 'expired' });
        throw new Error('This invitation has expired');
    }

    const workspaceId = invite.workspaceId;
    if (!workspaceId) {
        throw new Error('Invitation is missing workspaceId — may be a legacy invite');
    }

    // Run acceptance in a transaction for seat-limit atomicity.
    // Firestore requires ALL reads before ANY writes in a transaction.
    const result = await db.runTransaction(async (tx) => {
        // ── Phase 1: ALL READS ──────────────────────────────────────────
        const wsRef = db.collection('workspaces').doc(workspaceId);
        const memberDocId = `${workspaceId}_${acceptingUid}`;
        const memberRef = db.collection('workspaceMembers').doc(memberDocId);

        const [wsSnap, inviteSnapTx, existingMember] = await Promise.all([
            tx.get(wsRef),
            tx.get(inviteDoc.ref),
            tx.get(memberRef),
        ]);

        if (!wsSnap.exists) {
            throw new Error('Workspace no longer exists');
        }
        const workspace = wsSnap.data();

        // Read teams doc (needed for mirror write later)
        const teamsRef = db.collection('teams').doc(workspace.ownerId);
        const teamsSnap = await tx.get(teamsRef);

        // ── Phase 2: VALIDATION ─────────────────────────────────────────
        if (workspace.seatLimit !== -1 && workspace.memberCount >= workspace.seatLimit) {
            throw new Error('Workspace seat limit reached');
        }

        if (inviteSnapTx.data().status !== 'pending') {
            throw new Error('Invitation was already accepted');
        }

        // ── Phase 3: ALL WRITES ─────────────────────────────────────────
        const now = admin.firestore.Timestamp.now();
        let membership;

        if (existingMember.exists) {
            const existingData = existingMember.data();
            if (existingData.status === 'active') {
                // Already active — idempotent accept
                tx.update(inviteDoc.ref, {
                    status: 'accepted',
                    acceptedAt: now,
                    acceptedByUid: acceptingUid,
                });
                return { workspaceId, role: existingData.role, membership: existingData };
            }

            if (existingData.status === 'removed') {
                // Reactivate
                const reactivateData = {
                    status: 'active',
                    role: invite.role,
                    reactivatedAt: now,
                    removedAt: null,
                    updatedAt: now,
                };
                tx.update(memberRef, reactivateData);

                tx.update(wsRef, {
                    memberIds: admin.firestore.FieldValue.arrayUnion(acceptingUid),
                    memberCount: admin.firestore.FieldValue.increment(1),
                    updatedAt: now,
                });

                membership = { ...existingData, ...reactivateData };
            }
        }

        if (!membership) {
            // New member — create workspaceMembers doc
            const memberData = {
                workspaceId,
                uid: acceptingUid,
                email: (acceptingEmail || '').toLowerCase(),
                displayName: acceptingDisplayName || '',
                displayNameSnapshot: acceptingDisplayName || '',
                role: invite.role,
                isWorkspaceOwner: false,
                status: 'active',
                joinedAt: now,
                invitedBy: invite.inviterUid || invite.teamOwnerUid,
                removedAt: null,
                reactivatedAt: null,
                updatedAt: now,
            };
            tx.set(memberRef, memberData);

            tx.update(wsRef, {
                memberIds: admin.firestore.FieldValue.arrayUnion(acceptingUid),
                memberCount: admin.firestore.FieldValue.increment(1),
                updatedAt: now,
            });

            membership = memberData;
        }

        // Mirror to teams/{ownerUid}
        if (teamsSnap.exists) {
            const teamMemberEntry = {
                uid: acceptingUid,
                email: (acceptingEmail || '').toLowerCase(),
                displayName: acceptingDisplayName || '',
                role: invite.role,
                joinedAt: now,
                status: 'active',
            };
            tx.update(teamsRef, {
                memberUids: admin.firestore.FieldValue.arrayUnion(acceptingUid),
                members: admin.firestore.FieldValue.arrayUnion(teamMemberEntry),
                updatedAt: now,
            });
        }

        // Mark invitation accepted
        tx.update(inviteDoc.ref, {
            status: 'accepted',
            acceptedAt: now,
            acceptedByUid: acceptingUid,
        });

        return { workspaceId, role: invite.role, membership };
    });

    return result;
}

// ── Lookup by invitation ID (legacy compat) ───────────────────────────────

/**
 * Look up an invitation by its Firestore doc ID.
 * Used for legacy /team/accept flow that passes invitationId instead of token.
 *
 * @param {string} invitationId
 * @returns {Promise<object|null>}
 */
async function getInviteById(invitationId) {
    const db = admin.firestore();
    const doc = await db.collection('teamInvitations').doc(invitationId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

module.exports = {
    generateToken,
    hashToken,
    createInvite,
    acceptInvite,
    getInviteById,
    INVITE_TTL_DAYS,
};
