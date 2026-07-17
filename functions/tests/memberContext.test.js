'use strict';

/**
 * Member Workspace-Context Resolution — Gate Tests
 *
 * Covers the fix for the workspace member-identity bug:
 *   - acceptInviteByVerifiedEmail: constrained verified-email accept
 *     (email must match, pending, unexpired; shares the acceptInvite transaction)
 *   - resolveWorkspaceContext: server-side plan/tier/subscription/sellerProfile
 *     resolution + verified-email auto-accept self-heal
 *
 * These prove that a never-accepted invitee resolves correctly (the class of
 * failure behind the mariadeth/Daniyal/support incidents) and that the
 * verified-email path enforces its guards.
 */

jest.mock('firebase-admin');
jest.mock('../services/email', () => ({
    sendTeamInviteEmail: jest.fn().mockResolvedValue({ success: true }),
    sendWorkspaceInviteEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const admin = require('firebase-admin');
const {
    acceptInviteByVerifiedEmail,
} = require('../services/workspaceInviteService');
const { resolveWorkspaceContext } = require('../services/memberContextService');

const OWNER_UID = 'owner_mc';
const MEMBER_UID = 'member_mc';
const OUTSIDER_UID = 'outsider_mc';
const WORKSPACE_ID = 'ws_mc_test';
const OWNER_EMAIL = 'owner@test.com';
const MEMBER_EMAIL = 'member@test.com';

const OWNER_SELLER_PROFILE = { companyProfile: { companyName: 'Owner Co' }, profileCompleteness: 95 };

function futureTimestamp(days = 5) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return admin.firestore.Timestamp.fromDate(d);
}
function pastTimestamp(days = 5) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return admin.firestore.Timestamp.fromDate(d);
}

function seedPendingInvite(id, { email = MEMBER_EMAIL, expiresAt = futureTimestamp(), status = 'pending' } = {}) {
    const invitations = admin._mockData.collections['teamInvitations'] || {};
    invitations[id] = {
        teamOwnerUid: OWNER_UID,
        inviteeEmail: email,
        role: 'contributor',
        status,
        createdAt: pastTimestamp(1),
        expiresAt,
        acceptedAt: null,
        acceptedByUid: null,
        tokenHash: 'hash_' + id,
        workspaceId: WORKSPACE_ID,
        inviterUid: OWNER_UID,
    };
    admin._setMockCollection('teamInvitations', invitations);
}

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    admin._setMockCollection('workspaces', {
        [WORKSPACE_ID]: {
            ownerId: OWNER_UID,
            entitlementOwnerUid: OWNER_UID,
            name: "Owner's Workspace",
            memberIds: [OWNER_UID],
            memberCount: 1,
            seatLimit: 5,
        },
    });

    admin._setMockCollection('workspaceMembers', {
        [`${WORKSPACE_ID}_${OWNER_UID}`]: {
            workspaceId: WORKSPACE_ID,
            uid: OWNER_UID,
            email: OWNER_EMAIL,
            displayName: 'Owner User',
            role: 'admin',
            isWorkspaceOwner: true,
            status: 'active',
        },
    });

    admin._setMockCollection('teams', {
        [OWNER_UID]: {
            ownerUid: OWNER_UID,
            ownerEmail: OWNER_EMAIL,
            ownerDisplayName: 'Owner User',
            members: [],
            memberUids: [OWNER_UID],
        },
    });

    admin._setMockCollection('users', {
        [OWNER_UID]: {
            email: OWNER_EMAIL,
            displayName: 'Owner User',
            plan: 'enterprise',
            tier: 'enterprise',
            subscription: { plan: 'enterprise', tier: 'enterprise' },
            sellerProfile: OWNER_SELLER_PROFILE,
        },
        [MEMBER_UID]: { email: MEMBER_EMAIL, displayName: 'Member User', tier: 'FREE' },
        [OUTSIDER_UID]: { email: 'outsider@test.com', tier: 'FREE' },
    });

    admin._setMockCollection('teamInvitations', {});
});

// ── acceptInviteByVerifiedEmail ────────────────────────────────────────

describe('acceptInviteByVerifiedEmail', () => {
    test('accepts a pending invite when the verified email matches', async () => {
        seedPendingInvite('inv1');

        const result = await acceptInviteByVerifiedEmail('inv1', MEMBER_UID, MEMBER_EMAIL, 'Member User');

        expect(result.workspaceId).toBe(WORKSPACE_ID);
        expect(result.role).toBe('contributor');

        const memberDoc = admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_${MEMBER_UID}`];
        expect(memberDoc).toBeDefined();
        expect(memberDoc.status).toBe('active');
        expect(memberDoc.joinMethod).toBe('verified-email');

        const invite = admin._mockData.collections['teamInvitations']['inv1'];
        expect(invite.status).toBe('accepted');
        expect(invite.acceptedVia).toBe('verified-email');
        expect(invite.acceptedByUid).toBe(MEMBER_UID);
    });

    test('is case-insensitive on the email match', async () => {
        seedPendingInvite('inv1', { email: MEMBER_EMAIL });
        const result = await acceptInviteByVerifiedEmail('inv1', MEMBER_UID, 'Member@Test.com', 'Member User');
        expect(result.workspaceId).toBe(WORKSPACE_ID);
    });

    test('rejects when the verified email does not match the invited email', async () => {
        seedPendingInvite('inv1', { email: MEMBER_EMAIL });
        await expect(
            acceptInviteByVerifiedEmail('inv1', OUTSIDER_UID, 'outsider@test.com', 'Outsider')
        ).rejects.toThrow(/does not match/i);

        // No membership created
        expect(admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_${OUTSIDER_UID}`]).toBeUndefined();
    });

    test('rejects an expired invite and marks it expired', async () => {
        seedPendingInvite('inv1', { expiresAt: pastTimestamp(1) });
        await expect(
            acceptInviteByVerifiedEmail('inv1', MEMBER_UID, MEMBER_EMAIL, 'Member User')
        ).rejects.toThrow(/expired/i);
        expect(admin._mockData.collections['teamInvitations']['inv1'].status).toBe('expired');
    });

    test('rejects an already-accepted invite', async () => {
        seedPendingInvite('inv1', { status: 'accepted' });
        await expect(
            acceptInviteByVerifiedEmail('inv1', MEMBER_UID, MEMBER_EMAIL, 'Member User')
        ).rejects.toThrow(/already/i);
    });

    test('rejects when the invitation does not exist', async () => {
        await expect(
            acceptInviteByVerifiedEmail('nope', MEMBER_UID, MEMBER_EMAIL, 'Member User')
        ).rejects.toThrow(/not found/i);
    });
});

// ── resolveWorkspaceContext ────────────────────────────────────────────

describe('resolveWorkspaceContext', () => {
    test('owner resolves as owner with their own plan', async () => {
        const ctx = await resolveWorkspaceContext(OWNER_UID, { email: OWNER_EMAIL, emailVerified: true });
        expect(ctx.isOwner).toBe(true);
        expect(ctx.isWorkspaceMember).toBe(false);
        expect(ctx.plan).toBe('enterprise');
        expect(ctx.workspaceId).toBe(WORKSPACE_ID);
    });

    test('active member inherits owner plan, tier, subscription, and seller profile', async () => {
        // Make MEMBER an active member directly
        const members = admin._mockData.collections['workspaceMembers'];
        members[`${WORKSPACE_ID}_${MEMBER_UID}`] = {
            workspaceId: WORKSPACE_ID, uid: MEMBER_UID, email: MEMBER_EMAIL,
            role: 'contributor', isWorkspaceOwner: false, status: 'active',
        };
        admin._setMockCollection('workspaceMembers', members);

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });

        expect(ctx.isWorkspaceMember).toBe(true);
        expect(ctx.isOwner).toBe(false);
        expect(ctx.ownerUid).toBe(OWNER_UID);
        expect(ctx.role).toBe('contributor');
        expect(ctx.plan).toBe('enterprise');
        expect(ctx.tier).toBe('enterprise');
        expect(ctx.subscription).toEqual({ plan: 'enterprise', tier: 'enterprise' });
        expect(ctx.sellerProfile).toEqual(OWNER_SELLER_PROFILE);
        expect(ctx.autoAccepted).toBe(false);
    });

    test('non-member with no invite returns empty context (keeps own plan)', async () => {
        const ctx = await resolveWorkspaceContext(OUTSIDER_UID, { email: 'outsider@test.com', emailVerified: true });
        expect(ctx.isWorkspaceMember).toBe(false);
        expect(ctx.isOwner).toBe(false);
        expect(ctx.plan).toBeNull();
        expect(ctx.sellerProfile).toBeNull();
        expect(ctx.autoAccepted).toBe(false);
    });

    test('verified-email invitee is auto-accepted and inherits the owner plan', async () => {
        seedPendingInvite('inv1', { email: MEMBER_EMAIL });

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });

        expect(ctx.autoAccepted).toBe(true);
        expect(ctx.isWorkspaceMember).toBe(true);
        expect(ctx.plan).toBe('enterprise');
        expect(ctx.sellerProfile).toEqual(OWNER_SELLER_PROFILE);

        // Membership actually written
        expect(admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_${MEMBER_UID}`].status).toBe('active');
    });

    test('does NOT auto-accept when email is unverified', async () => {
        seedPendingInvite('inv1', { email: MEMBER_EMAIL });

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: false });

        expect(ctx.autoAccepted).toBe(false);
        expect(ctx.isWorkspaceMember).toBe(false);
        expect(ctx.plan).toBeNull();
        expect(admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_${MEMBER_UID}`]).toBeUndefined();
    });

    test('does NOT auto-accept an expired invite (needs a fresh invite)', async () => {
        seedPendingInvite('inv1', { email: MEMBER_EMAIL, expiresAt: pastTimestamp(1) });

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });

        expect(ctx.autoAccepted).toBe(false);
        expect(ctx.isWorkspaceMember).toBe(false);
        expect(ctx.plan).toBeNull();
    });
});
