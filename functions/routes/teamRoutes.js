/**
 * Team Routes — Approach B
 *
 * Schema:
 *   teams/{ownerUid}          — single doc per team owner; members embedded as array
 *   teamInvitations/{autoId}  — one doc per pending invitation
 *
 * All Firestore writes go through Admin SDK (bypasses client rules).
 * memberUids is a flat string array kept in sync with members[] for
 * efficient array-contains queries when looking up a member's team.
 */

'use strict';

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const {
    handleError, ApiError, ErrorCodes,
    badRequest, notFound, unauthorized, forbidden, conflict
} = require('../middleware/errorHandler');
const { sendTeamInviteEmail, sendWorkspaceInviteEmail } = require('../services/email');

const {
    createWorkspace, getWorkspaceForUser, removeMember
} = require('../services/workspaceService');

const {
    createInvite: createWorkspaceInvite,
    acceptInvite: acceptWorkspaceInvite,
} = require('../services/workspaceInviteService');

const router = createRouter();
const db     = admin.firestore();

const VALID_ROLES     = ['admin', 'contributor', 'viewer'];
const INVITE_TTL_DAYS = 7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Resolve the calling user's team context.
 *
 * Owner case  — teams/{userId} exists → isOwner = true, userRole = 'owner'
 * Member case — teams where memberUids array-contains userId
 *
 * Returns { teamRef, teamData, isOwner, userRole } or null.
 */
async function getUserTeam(userId) {
    // O(1) owner check first
    const ownerRef = db.collection('teams').doc(userId);
    const ownerDoc = await ownerRef.get();
    if (ownerDoc.exists) {
        return { teamRef: ownerRef, teamData: ownerDoc.data(), isOwner: true, userRole: 'owner' };
    }

    // Member check via flat memberUids index
    const snap = await db.collection('teams')
        .where('memberUids', 'array-contains', userId)
        .limit(1)
        .get();

    if (snap.empty) return null;

    const teamDoc  = snap.docs[0];
    const teamData = teamDoc.data();
    const member   = (teamData.members || []).find(m => m.uid === userId);

    return {
        teamRef:  teamDoc.ref,
        teamData,
        isOwner:  false,
        userRole: member ? member.role : 'viewer'
    };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /team
 * Returns the current user's team (as owner or member).
 * Returns { data: null } if the user has no team yet.
 */
router.get('/team', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const result = await getUserTeam(req.userId);

        if (!result) {
            return res.status(200).json({ success: true, data: null });
        }

        const { teamData, isOwner, userRole } = result;

        // Fetch pending invitations for this team
        const invitesSnap = await db.collection('teamInvitations')
            .where('teamOwnerUid', '==', teamData.ownerUid)
            .where('status', '==', 'pending')
            .get();

        const now = new Date();
        const pendingInvitations = invitesSnap.docs
            .filter(doc => {
                const exp = doc.data().expiresAt;
                return !exp || exp.toDate() > now;
            })
            .map(doc => ({
                id:        doc.id,
                email:     doc.data().inviteeEmail,
                role:      doc.data().role,
                createdAt: doc.data().createdAt,
                expiresAt: doc.data().expiresAt
            }));

        return res.status(200).json({
            success: true,
            data: {
                ownerUid:          teamData.ownerUid,
                ownerEmail:        teamData.ownerEmail,
                ownerDisplayName:  teamData.ownerDisplayName,
                members:           teamData.members || [],
                pendingInvitations,
                currentUserRole:   userRole,
                isOwner,
                createdAt:         teamData.createdAt
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /team');
    }
});

/**
 * POST /team/invite
 * Invite a user by email. Owner only (admin invite support deferred).
 * Body: { email: string, role: 'admin' | 'contributor' | 'viewer' }
 *
 * Lazy-initializes teams/{ownerUid} on the first invitation.
 * Email delivery skipped until SendGrid key is corrected — returns
 * invitationId so the frontend can display a manual share link.
 */
router.post('/team/invite', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { email, role } = req.body;

        if (!email || !isValidEmail(email)) {
            throw badRequest('Valid email address required');
        }
        if (!role || !VALID_ROLES.includes(role)) {
            throw badRequest(`role must be one of: ${VALID_ROLES.join(', ')}`);
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedEmail === (req.userEmail || '').toLowerCase()) {
            throw badRequest('You cannot invite yourself');
        }

        // ── Authorization ──────────────────────────────────────────────────
        // Owner = teams/{req.userId} exists or will be lazy-inited.
        // Admin-invite deferred: admins cannot yet invite on behalf of owner.
        const teamRef = db.collection('teams').doc(req.userId);
        const teamDoc = await teamRef.get();
        const callerIsOwner = teamDoc.exists;

        if (!callerIsOwner) {
            // Check whether caller is a member on someone else's team
            const callerTeam    = await getUserTeam(req.userId);
            const callerIsAdmin = callerTeam && !callerTeam.isOwner && callerTeam.userRole === 'admin';
            if (callerIsAdmin) {
                throw forbidden('Admins cannot send invitations on behalf of the team owner');
            }
            throw forbidden('Only the team owner can send invitations');
        }

        // ── Duplicate checks ───────────────────────────────────────────────
        if (teamDoc.exists) {
            const members = teamDoc.data().members || [];
            if (members.some(m => m.email === normalizedEmail)) {
                throw conflict('This person is already a team member');
            }

            const existingInvite = await db.collection('teamInvitations')
                .where('teamOwnerUid', '==', req.userId)
                .where('inviteeEmail', '==', normalizedEmail)
                .where('status', '==', 'pending')
                .limit(1)
                .get();

            if (!existingInvite.empty) {
                // A date-expired invite can still carry status 'pending' (nothing
                // flips the field until something touches the doc). Blocking on it
                // makes re-inviting impossible — mark it expired and continue,
                // mirroring createInvite's own duplicate handling.
                const staleDoc = existingInvite.docs[0];
                const staleExp = staleDoc.data().expiresAt;
                const staleExpDate = staleExp?.toDate ? staleExp.toDate() : null;
                if (staleExpDate && staleExpDate < new Date()) {
                    await staleDoc.ref.update({ status: 'expired' });
                } else {
                    throw conflict('A pending invitation already exists for this email');
                }
            }
        }

        // ── Lazy-init team doc ──────────────────────────────────────────────
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (!teamDoc.exists) {
            const ownerUserDoc = await db.collection('users').doc(req.userId).get();
            const ownerData    = ownerUserDoc.exists ? ownerUserDoc.data() : {};

            await teamRef.set({
                ownerUid:         req.userId,
                ownerEmail:       req.userEmail || '',
                ownerDisplayName: ownerData.displayName || req.userEmail?.split('@')[0] || '',
                members:          [],
                memberUids:       [],
                createdAt:        now,
                updatedAt:        now
            });
        }

        // ── Lazy-init workspace (mirrors team) ─────────────────────────────
        // NOT fire-and-forget — workspace must exist before members can be added.
        // Failure here propagates to handleError (returns 500 to client).
        let workspace = await getWorkspaceForUser(req.userId);
        if (!workspace) {
            const ownerUserDoc2 = await db.collection('users').doc(req.userId).get();
            const ownerData2 = ownerUserDoc2.exists ? ownerUserDoc2.data() : {};
            workspace = await createWorkspace(req.userId, {
                ownerEmail: req.userEmail || '',
                ownerDisplayName: ownerData2.displayName || req.userEmail?.split('@')[0] || '',
            });
            // Backlink teams doc
            await teamRef.update({ workspaceId: workspace.id });
        }

        // ── Create invitation via workspaceInviteService (Phase 3A) ───
        const ownerDisplayName = teamDoc.exists
            ? (teamDoc.data().ownerDisplayName || req.userEmail?.split('@')[0] || 'Your colleague')
            : (req.userEmail?.split('@')[0] || 'Your colleague');

        const { invitationId, plainToken } = await createWorkspaceInvite(
            workspace.id,
            req.userId,
            normalizedEmail,
            role,
            {
                inviterEmail: req.userEmail || '',
                inviterDisplayName: ownerDisplayName,
                workspaceName: workspace.name || `${ownerDisplayName}'s Workspace`,
            }
        );

        await teamRef.update({ updatedAt: now });

        // ── Send invite email (non-blocking) ──────────────────────────
        try {
            await sendWorkspaceInviteEmail(normalizedEmail, {
                workspaceName:      workspace.name || `${ownerDisplayName}'s Workspace`,
                inviterDisplayName: ownerDisplayName,
                inviterEmail:       req.userEmail || '',
                role,
                inviteToken:        plainToken,
                invitationId,
            });
        } catch (emailError) {
            console.warn('[TeamRoutes] Workspace invite email failed (non-blocking):', emailError.message);
        }

        return res.status(201).json({
            success: true,
            data: {
                invitationId,
                plainToken,
                email:        normalizedEmail,
                role
            }
        });
    } catch (error) {
        return handleError(error, res, 'POST /team/invite');
    }
});

/**
 * POST /team/accept
 * Accept a pending invitation.
 *
 * Body: { inviteToken: string }
 * Binds by token+UID. Email match NOT required.
 *
 * Post-Phase 3A cutover: Legacy ID-based acceptance (invitationId) is
 * fully blocked. All acceptance requires the cryptographic plaintext token.
 */
router.post('/team/accept', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { inviteToken, invitationId } = req.body;

        // ── Token-based accept (Phase 3A) ─────────────────────────────
        if (inviteToken && typeof inviteToken === 'string') {
            const acceptingUserDoc = await db.collection('users').doc(req.userId).get();
            const acceptingUserData = acceptingUserDoc.exists ? acceptingUserDoc.data() : {};

            const result = await acceptWorkspaceInvite(
                inviteToken,
                req.userId,
                (req.userEmail || '').toLowerCase(),
                acceptingUserData.displayName || req.userEmail?.split('@')[0] || ''
            );

            return res.status(200).json({
                success: true,
                data: {
                    workspaceId: result.workspaceId,
                    role:        result.role,
                }
            });
        }

        // ── Legacy ID-based accept — FULLY BLOCKED ───────────────────
        // Post-Phase 3A cutover: invitation ID alone is never sufficient
        // to create or reactivate membership. All acceptance requires the
        // cryptographic plaintext token via inviteToken parameter.
        // Old links should direct the user to request a new token-based invite.
        if (invitationId && typeof invitationId === 'string') {
            throw badRequest(
                'ID-based invitation acceptance is no longer supported. ' +
                'Please request a new invitation link from the workspace owner.'
            );
        }

        throw badRequest('inviteToken is required to accept an invitation');
    } catch (error) {
        return handleError(error, res, 'POST /team/accept');
    }
});

/**
 * POST /team/remove
 * Remove a member from the team. Owner only.
 * Body: { memberUid: string }
 */
router.post('/team/remove', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { memberUid } = req.body;
        if (!memberUid || typeof memberUid !== 'string') {
            throw badRequest('memberUid required');
        }
        if (memberUid === req.userId) {
            throw badRequest('You cannot remove yourself');
        }

        // Owner only — team doc is always at teams/{req.userId}
        const teamRef = db.collection('teams').doc(req.userId);
        const teamDoc = await teamRef.get();

        if (!teamDoc.exists) {
            throw notFound('No team found — you are not a team owner');
        }

        const members      = teamDoc.data().members || [];
        const targetMember = members.find(m => m.uid === memberUid);

        if (!targetMember) {
            throw notFound('Member not found in your team');
        }

        const updatedMembers = members.filter(m => m.uid !== memberUid);

        // ── Single atomic write: workspaceMembers + workspace + teams ──
        const ownerWorkspace = await getWorkspaceForUser(req.userId);
        if (ownerWorkspace) {
            // removeMember batch commits: workspaceMembers status→removed
            // + workspace.memberIds arrayRemove + teams.memberUids arrayRemove
            // + teams.members[] replacement — all in ONE batch.commit()
            await removeMember(ownerWorkspace.id, memberUid, {
                updatedTeamMembers: updatedMembers,
            });
        } else {
            // No workspace — fall back to team-only update (pre-workspace legacy path)
            await teamRef.update({
                members:    updatedMembers,
                memberUids: admin.firestore.FieldValue.arrayRemove(memberUid),
                updatedAt:  admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /team/remove');
    }
});

/**
 * POST /team/update-role
 * Change a member's role. Owner only.
 * Body: { memberUid: string, newRole: 'admin' | 'contributor' | 'viewer' }
 *
 * Firestore has no atomic array-element update, so this is a
 * read-modify-write on the members array.
 */
router.post('/team/update-role', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { memberUid, newRole } = req.body;

        if (!memberUid || typeof memberUid !== 'string') {
            throw badRequest('memberUid required');
        }
        if (!newRole || !VALID_ROLES.includes(newRole)) {
            throw badRequest(`newRole must be one of: ${VALID_ROLES.join(', ')}`);
        }
        if (memberUid === req.userId) {
            throw badRequest('Cannot change your own role');
        }

        // Owner only
        const teamRef = db.collection('teams').doc(req.userId);
        const teamDoc = await teamRef.get();

        if (!teamDoc.exists) {
            throw notFound('No team found — you are not a team owner');
        }

        const members     = teamDoc.data().members || [];
        const targetIndex = members.findIndex(m => m.uid === memberUid);

        if (targetIndex === -1) {
            throw notFound('Member not found in your team');
        }

        const updatedMembers = members.map(m =>
            m.uid === memberUid ? { ...m, role: newRole } : m
        );

        await teamRef.update({
            members:   updatedMembers,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /team/update-role');
    }
});

/**
 * POST /team/revoke-invite
 * Revoke a pending team invitation. Owner only.
 * Body: { invitationId: string } OR { inviteeEmail: string }
 */
router.post('/team/revoke-invite', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { invitationId, inviteeEmail } = req.body;

        if (!invitationId && !inviteeEmail) {
            throw badRequest('invitationId or inviteeEmail required');
        }

        // Owner only — team doc is always at teams/{req.userId}
        const teamDoc = await db.collection('teams').doc(req.userId).get();
        if (!teamDoc.exists) {
            throw notFound('No team found — you are not a team owner');
        }

        let snap;
        if (invitationId) {
            // Direct doc lookup, scoped to caller's ownership
            const doc = await db.collection('teamInvitations').doc(invitationId).get();
            if (doc.exists && doc.data().teamOwnerUid === req.userId && doc.data().status === 'pending') {
                snap = [doc];
            } else {
                snap = [];
            }
        } else {
            const result = await db.collection('teamInvitations')
                .where('teamOwnerUid', '==', req.userId)
                .where('inviteeEmail', '==', inviteeEmail.trim().toLowerCase())
                .where('status', '==', 'pending')
                .limit(1)
                .get();
            snap = result.docs;
        }

        if (snap.length === 0) {
            throw notFound('Invitation not found');
        }

        await snap[0].ref.update({
            status:    'revoked',
            revokedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return handleError(error, res, 'POST /team/revoke-invite');
    }
});

/**
 * GET /team/invitations
 * Returns non-expired pending invitations for the current user's email.
 * Used to show "you've been invited" banner after login.
 */
router.get('/team/invitations', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        if (!req.userEmail) {
            return res.status(200).json({ success: true, data: [] });
        }

        const snap = await db.collection('teamInvitations')
            .where('inviteeEmail', '==', req.userEmail.toLowerCase())
            .where('status', '==', 'pending')
            .get();

        const now = new Date();

        // Filter expired in-process (avoids needing a composite index on expiresAt)
        const valid = snap.docs.filter(doc => {
            const exp = doc.data().expiresAt;
            return !exp || exp.toDate() > now;
        });

        // Enrich each invitation with the team owner's display info
        const enriched = await Promise.all(valid.map(async doc => {
            const data    = doc.data();
            const teamDoc = await db.collection('teams').doc(data.teamOwnerUid).get();
            const team    = teamDoc.exists ? teamDoc.data() : {};
            return {
                id:               doc.id,
                teamOwnerUid:     data.teamOwnerUid,
                ownerEmail:       team.ownerEmail       || '',
                ownerDisplayName: team.ownerDisplayName || '',
                role:             data.role,
                createdAt:        data.createdAt,
                expiresAt:        data.expiresAt
            };
        }));

        return res.status(200).json({ success: true, data: enriched });
    } catch (error) {
        return handleError(error, res, 'GET /team/invitations');
    }
});

/**
 * GET /team/activity
 * Returns the 50 most recent userActivityLog entries across all team members.
 * Reads via Admin SDK — bypasses Firestore client rules on userActivityLog.
 * Returns [] if the caller has no team.
 */
router.get('/team/activity', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const team = await getUserTeam(req.userId);

        if (!team) {
            return res.status(200).json({ success: true, data: [] });
        }

        const { teamData } = team;
        const ownerUid   = teamData.ownerUid;
        const memberUids = teamData.memberUids || [];

        // Deduplicate + cap at 10 (Firestore 'in' operator limit)
        const allUids = [...new Set([ownerUid, ...memberUids])].slice(0, 10);

        const snap = await db.collection('userActivityLog')
            .where('userId', 'in', allUids)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const activity = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return res.status(200).json({ success: true, data: activity });
    } catch (error) {
        return handleError(error, res, 'GET /team/activity');
    }
});

module.exports = router;
