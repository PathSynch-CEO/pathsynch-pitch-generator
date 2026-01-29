/**
 * Team Routes
 *
 * Handles team management, invitations, and member roles
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { createRouter } = require('../utils/router');
const { handleError } = require('../middleware/errorHandler');
const { validateBody } = require('../middleware/validation');
const emailService = require('../services/email');

const router = createRouter();
const db = admin.firestore();

// ============================================
// ROUTES
// ============================================

/**
 * GET /team
 * Get team info for current user
 */
router.get('/team', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Check if user is part of a team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const teamId = userData.teamId;

        if (!teamId) {
            // User doesn't have a team yet - return solo mode
            return res.status(200).json({
                success: true,
                data: {
                    hasTeam: false,
                    role: 'owner',
                    members: [{
                        id: req.userId,
                        email: req.userEmail,
                        role: 'owner',
                        name: userData.displayName || req.userEmail?.split('@')[0] || 'Owner',
                        joinedAt: userData.createdAt || new Date()
                    }]
                }
            });
        }

        // Get team data
        const teamDoc = await db.collection('teams').doc(teamId).get();
        if (!teamDoc.exists) {
            return res.status(404).json({ success: false, message: 'Team not found' });
        }

        const team = teamDoc.data();

        // Get all team members
        const membersSnapshot = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .get();

        const members = membersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Get pending invites
        const invitesSnapshot = await db.collection('teamInvites')
            .where('teamId', '==', teamId)
            .where('status', '==', 'pending')
            .get();

        const pendingInvites = invitesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json({
            success: true,
            data: {
                hasTeam: true,
                teamId,
                teamName: team.name,
                ownerId: team.ownerId,
                plan: team.plan,
                maxMembers: team.maxMembers,
                members,
                pendingInvites,
                userRole: members.find(m => m.userId === req.userId)?.role || 'member'
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /team');
    }
});

/**
 * POST /team
 * Create a new team
 */
router.post('/team', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { name } = req.body;

        // Check if user already has a team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        if (userData.teamId) {
            return res.status(409).json({ success: false, message: 'You already have a team' });
        }

        // Get user's plan to determine max members
        const plan = userData.plan || 'starter';
        const stripeConfig = require('../config/stripe');
        const planLimits = stripeConfig.getPlanLimits(plan);
        const maxMembers = planLimits.teamMembers || 1;

        // Create team
        const teamRef = await db.collection('teams').add({
            name: name || `${req.userEmail?.split('@')[0]}'s Team`,
            ownerId: req.userId,
            plan,
            maxMembers,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Add owner as first member
        await db.collection('teamMembers').add({
            teamId: teamRef.id,
            userId: req.userId,
            email: req.userEmail,
            name: userData.displayName || req.userEmail?.split('@')[0],
            role: 'owner',
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update user with team ID
        await db.collection('users').doc(req.userId).set({
            teamId: teamRef.id
        }, { merge: true });

        return res.status(201).json({
            success: true,
            message: 'Team created',
            data: { teamId: teamRef.id }
        });
    } catch (error) {
        return handleError(error, res, 'POST /team');
    }
});

/**
 * POST /team/invite
 * Invite a new team member
 */
router.post('/team/invite', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Validation done in index.js
        const { email, role } = req.body;

        // Get user's team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const teamId = userData.teamId;

        if (!teamId) {
            return res.status(400).json({ success: false, message: 'Create a team first' });
        }

        // Get team
        const teamDoc = await db.collection('teams').doc(teamId).get();
        const team = teamDoc.data();

        // Check if user can invite (owner or admin)
        const memberSnapshot = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .where('userId', '==', req.userId)
            .limit(1)
            .get();

        const userMembership = memberSnapshot.docs[0]?.data();
        if (!userMembership || !['owner', 'admin'].includes(userMembership.role)) {
            return res.status(403).json({ success: false, message: 'Only owners and admins can invite members' });
        }

        // Check team member limit
        const currentMembersSnapshot = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .get();

        const pendingInvitesSnapshot = await db.collection('teamInvites')
            .where('teamId', '==', teamId)
            .where('status', '==', 'pending')
            .get();

        const totalCount = currentMembersSnapshot.size + pendingInvitesSnapshot.size;
        if (totalCount >= team.maxMembers) {
            return res.status(400).json({
                success: false,
                message: `Team limit reached (${team.maxMembers} members). Upgrade to add more.`
            });
        }

        // Check if already invited or member
        const existingInvite = await db.collection('teamInvites')
            .where('teamId', '==', teamId)
            .where('email', '==', email.toLowerCase())
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (!existingInvite.empty) {
            return res.status(409).json({ success: false, message: 'Invite already sent to this email' });
        }

        const existingMember = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (!existingMember.empty) {
            return res.status(409).json({ success: false, message: 'This user is already a team member' });
        }

        // Create invite
        const inviteCode = crypto.randomBytes(16).toString('hex');
        const inviteRef = await db.collection('teamInvites').add({
            teamId,
            teamName: team.name,
            email: email.toLowerCase(),
            role: role || 'member',
            invitedBy: req.userId,
            inviterEmail: req.userEmail,
            inviteCode,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        // Send invite email
        const inviteUrl = `https://pathsynch-pitch-creation.web.app/join-team.html?code=${inviteCode}`;
        try {
            await emailService.sendTeamInviteEmail(email, {
                teamName: team.name,
                inviterName: userData.displayName || null,
                inviterEmail: req.userEmail,
                role: role || 'member',
                inviteUrl,
                inviteCode
            });
        } catch (emailError) {
            console.error('Failed to send invite email:', emailError);
        }

        return res.status(201).json({
            success: true,
            message: `Invite sent to ${email}`,
            data: {
                inviteId: inviteRef.id,
                inviteCode,
                inviteUrl
            }
        });
    } catch (error) {
        return handleError(error, res, 'POST /team/invite');
    }
});

/**
 * GET /team/invite-details
 * Get invite details (public - no auth required)
 */
router.get('/team/invite-details', async (req, res) => {
    try {
        const inviteCode = req.query.code;

        if (!inviteCode) {
            return res.status(400).json({ success: false, message: 'Invite code required' });
        }

        const inviteSnapshot = await db.collection('teamInvites')
            .where('inviteCode', '==', inviteCode)
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (inviteSnapshot.empty) {
            return res.status(404).json({ success: false, message: 'Invalid or expired invite' });
        }

        const invite = inviteSnapshot.docs[0].data();

        // Check if expired
        if (invite.expiresAt && new Date(invite.expiresAt.toDate()) < new Date()) {
            return res.status(410).json({ success: false, message: 'This invite has expired' });
        }

        return res.status(200).json({
            success: true,
            data: {
                teamName: invite.teamName,
                inviterEmail: invite.inviterEmail,
                role: invite.role,
                expiresAt: invite.expiresAt
            }
        });
    } catch (error) {
        return handleError(error, res, 'GET /team/invite-details');
    }
});

/**
 * POST /team/accept-invite
 * Accept a team invitation
 */
router.post('/team/accept-invite', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { inviteCode } = req.body;

        if (!inviteCode) {
            return res.status(400).json({ success: false, message: 'Invite code required' });
        }

        // Find invite
        const inviteSnapshot = await db.collection('teamInvites')
            .where('inviteCode', '==', inviteCode)
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (inviteSnapshot.empty) {
            return res.status(404).json({ success: false, message: 'Invalid or expired invite' });
        }

        const inviteDoc = inviteSnapshot.docs[0];
        const invite = inviteDoc.data();

        // Check if invite expired
        if (invite.expiresAt && new Date(invite.expiresAt.toDate()) < new Date()) {
            await inviteDoc.ref.update({ status: 'expired' });
            return res.status(400).json({ success: false, message: 'Invite has expired' });
        }

        // Check if user is already in another team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        if (userData.teamId && userData.teamId !== invite.teamId) {
            return res.status(400).json({ success: false, message: 'You are already part of another team' });
        }

        // Add user to team
        await db.collection('teamMembers').add({
            teamId: invite.teamId,
            userId: req.userId,
            email: req.userEmail,
            name: userData.displayName || req.userEmail?.split('@')[0],
            role: invite.role,
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update user with team ID
        await db.collection('users').doc(req.userId).set({
            teamId: invite.teamId
        }, { merge: true });

        // Mark invite as accepted
        await inviteDoc.ref.update({
            status: 'accepted',
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            acceptedBy: req.userId
        });

        return res.status(200).json({
            success: true,
            message: `You've joined ${invite.teamName}!`,
            data: { teamId: invite.teamId }
        });
    } catch (error) {
        return handleError(error, res, 'POST /team/accept-invite');
    }
});

/**
 * PUT /team/members/:memberId/role
 * Update team member role
 */
router.put('/team/members/:memberId/role', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { memberId } = req.params;
        const { role } = req.body;
        const validRoles = ['admin', 'manager', 'member'];

        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        // Get user's team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const teamId = userDoc.data()?.teamId;

        if (!teamId) {
            return res.status(400).json({ success: false, message: 'No team found' });
        }

        // Check if user is owner or admin
        const callerMemberSnapshot = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .where('userId', '==', req.userId)
            .limit(1)
            .get();

        const callerRole = callerMemberSnapshot.docs[0]?.data()?.role;
        if (!['owner', 'admin'].includes(callerRole)) {
            return res.status(403).json({ success: false, message: 'Only owners and admins can change roles' });
        }

        // Get target member
        const memberDoc = await db.collection('teamMembers').doc(memberId).get();
        if (!memberDoc.exists || memberDoc.data().teamId !== teamId) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        // Cannot change owner's role
        if (memberDoc.data().role === 'owner') {
            return res.status(400).json({ success: false, message: 'Cannot change owner role' });
        }

        // Update role
        await memberDoc.ref.update({ role });

        return res.status(200).json({
            success: true,
            message: 'Role updated'
        });
    } catch (error) {
        return handleError(error, res, 'PUT /team/members/:memberId/role');
    }
});

/**
 * DELETE /team/members/:memberId
 * Remove team member
 */
router.delete('/team/members/:memberId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { memberId } = req.params;

        // Get user's team
        const userDoc = await db.collection('users').doc(req.userId).get();
        const teamId = userDoc.data()?.teamId;

        if (!teamId) {
            return res.status(400).json({ success: false, message: 'No team found' });
        }

        // Check if user is owner or admin
        const callerMemberSnapshot = await db.collection('teamMembers')
            .where('teamId', '==', teamId)
            .where('userId', '==', req.userId)
            .limit(1)
            .get();

        const callerRole = callerMemberSnapshot.docs[0]?.data()?.role;
        if (!['owner', 'admin'].includes(callerRole)) {
            return res.status(403).json({ success: false, message: 'Only owners and admins can remove members' });
        }

        // Get target member
        const memberDoc = await db.collection('teamMembers').doc(memberId).get();
        if (!memberDoc.exists || memberDoc.data().teamId !== teamId) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        // Cannot remove owner
        if (memberDoc.data().role === 'owner') {
            return res.status(400).json({ success: false, message: 'Cannot remove team owner' });
        }

        const removedUserId = memberDoc.data().userId;

        // Remove member
        await memberDoc.ref.delete();

        // Remove team ID from user
        if (removedUserId) {
            await db.collection('users').doc(removedUserId).update({
                teamId: admin.firestore.FieldValue.delete()
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Member removed'
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /team/members/:memberId');
    }
});

/**
 * DELETE /team/invites/:inviteId
 * Cancel pending invite
 */
router.delete('/team/invites/:inviteId', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { inviteId } = req.params;

        const inviteDoc = await db.collection('teamInvites').doc(inviteId).get();
        if (!inviteDoc.exists) {
            return res.status(404).json({ success: false, message: 'Invite not found' });
        }

        const invite = inviteDoc.data();

        // Verify user has permission
        const userDoc = await db.collection('users').doc(req.userId).get();
        if (userDoc.data()?.teamId !== invite.teamId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        await inviteDoc.ref.delete();

        return res.status(200).json({
            success: true,
            message: 'Invite cancelled'
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /team/invites/:inviteId');
    }
});

module.exports = router;
