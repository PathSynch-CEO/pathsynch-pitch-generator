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
                throw conflict('A pending invitation already exists for this email');
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

        // ── Create invitation ───────────────────────────────────────────────
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

        const inviteRef = await db.collection('teamInvitations').add({
            teamOwnerUid:  req.userId,
            inviteeEmail:  normalizedEmail,
            role,
            status:        'pending',
            createdAt:     now,
            expiresAt:     admin.firestore.Timestamp.fromDate(expiresAt),
            acceptedAt:    null,
            acceptedByUid: null
        });

        await teamRef.update({ updatedAt: now });

        // ── Email skipped — SENDGRID_API_KEY not yet corrected to SG. prefix ─
        try {
            // TODO: emailService.sendTeamInviteEmail(normalizedEmail, { invitationId: inviteRef.id, role })
        } catch (emailError) {
            console.warn('[TeamRoutes] Invite email skipped:', emailError.message);
        }

        return res.status(201).json({
            success: true,
            data: {
                invitationId: inviteRef.id,
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
 * Body: { invitationId: string }
 * The invitation's inviteeEmail must match the authenticated user's email.
 */
router.post('/team/accept', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') throw unauthorized();

        const { invitationId } = req.body;
        if (!invitationId || typeof invitationId !== 'string') {
            throw badRequest('invitationId required');
        }

        const inviteRef = db.collection('teamInvitations').doc(invitationId);
        const inviteDoc = await inviteRef.get();

        if (!inviteDoc.exists) {
            throw notFound('Invitation not found');
        }

        const invite = inviteDoc.data();

        if (invite.status !== 'pending') {
            throw badRequest(`Invitation is already ${invite.status}`);
        }

        const expiresAt = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : null;
        if (expiresAt && expiresAt < new Date()) {
            await inviteRef.update({ status: 'expired' });
            throw badRequest('This invitation has expired');
        }

        // inviteeEmail must match the authenticated user
        if (invite.inviteeEmail !== (req.userEmail || '').toLowerCase()) {
            throw forbidden('This invitation was sent to a different email address');
        }

        const teamRef = db.collection('teams').doc(invite.teamOwnerUid);
        const teamDoc = await teamRef.get();

        if (!teamDoc.exists) {
            throw notFound('Team no longer exists');
        }

        const members = teamDoc.data().members || [];

        // Idempotent: already a member — mark accepted and return
        if (members.some(m => m.uid === req.userId)) {
            await inviteRef.update({
                status:        'accepted',
                acceptedAt:    admin.firestore.FieldValue.serverTimestamp(),
                acceptedByUid: req.userId
            });
            return res.status(200).json({
                success: true,
                data: { teamOwnerUid: invite.teamOwnerUid, role: invite.role }
            });
        }

        // Get accepting user's display info
        const acceptingUserDoc  = await db.collection('users').doc(req.userId).get();
        const acceptingUserData = acceptingUserDoc.exists ? acceptingUserDoc.data() : {};

        const newMember = {
            uid:         req.userId,
            email:       (req.userEmail || '').toLowerCase(),
            displayName: acceptingUserData.displayName || req.userEmail?.split('@')[0] || '',
            role:        invite.role,
            joinedAt:    admin.firestore.Timestamp.now(),
            status:      'active'
        };

        const now = admin.firestore.FieldValue.serverTimestamp();

        await teamRef.update({
            members:    admin.firestore.FieldValue.arrayUnion(newMember),
            memberUids: admin.firestore.FieldValue.arrayUnion(req.userId),
            updatedAt:  now
        });

        await inviteRef.update({
            status:        'accepted',
            acceptedAt:    now,
            acceptedByUid: req.userId
        });

        return res.status(200).json({
            success: true,
            data: { teamOwnerUid: invite.teamOwnerUid, role: invite.role }
        });
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

        await teamRef.update({
            members:    updatedMembers,
            memberUids: admin.firestore.FieldValue.arrayRemove(memberUid),
            updatedAt:  admin.firestore.FieldValue.serverTimestamp()
        });

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
