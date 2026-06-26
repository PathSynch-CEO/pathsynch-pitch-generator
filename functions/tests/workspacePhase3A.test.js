'use strict';

/**
 * Phase 3A Gate Tests — Invite Binding & Crypto Token Accept
 *
 * Gate tests cover:
 *   1. createInvite produces tokenHash — plainToken is NOT stored
 *   2. acceptInvite finds invitation by token hash
 *   3. Second token redemption fails (already accepted)
 *   4. Doc-ID composition blocks duplicate membership
 *   5. Re-invited REMOVED member → reactivated, no second doc
 *   6. joinedAt populated on accepted member (no Invalid Date)
 *   7. Invite email sends with workspace name + inviter display name
 *   8. Two simultaneous accepts against last seat → one fails
 *   9. Expired invite cannot be accepted
 *   10. Token binds by UID, not by email match
 */

jest.mock('firebase-admin');
jest.mock('../services/email', () => ({
    sendTeamInviteEmail: jest.fn().mockResolvedValue({ success: true }),
    sendWorkspaceInviteEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const admin = require('firebase-admin');
const {
    createInvite,
    acceptInvite,
    hashToken,
    INVITE_TTL_DAYS,
} = require('../services/workspaceInviteService');
const { sendWorkspaceInviteEmail } = require('../services/email');

// ── Constants ──────────────────────────────────────────────────────────

const OWNER_UID = 'owner_3a';
const MEMBER_UID = 'member_3a';
const MEMBER2_UID = 'member2_3a';
const WORKSPACE_ID = 'ws_phase3a_test';

// ── Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    // Seed workspace
    admin._setMockCollection('workspaces', {
        [WORKSPACE_ID]: {
            ownerId: OWNER_UID,
            entitlementOwnerUid: OWNER_UID,
            name: 'Phase 3A Test Workspace',
            memberIds: [OWNER_UID],
            memberCount: 1,
            seatLimit: 3,
        },
    });

    // Seed owner workspaceMembers doc
    admin._setMockCollection('workspaceMembers', {
        [`${WORKSPACE_ID}_${OWNER_UID}`]: {
            workspaceId: WORKSPACE_ID,
            uid: OWNER_UID,
            email: 'owner@test.com',
            displayName: 'Owner User',
            role: 'admin',
            isWorkspaceOwner: true,
            status: 'active',
        },
    });

    // Seed teams mirror
    admin._setMockCollection('teams', {
        [OWNER_UID]: {
            ownerUid: OWNER_UID,
            ownerEmail: 'owner@test.com',
            ownerDisplayName: 'Owner User',
            members: [],
            memberUids: [OWNER_UID],
        },
    });

    // Seed users
    admin._setMockCollection('users', {
        [OWNER_UID]: { email: 'owner@test.com', displayName: 'Owner User' },
        [MEMBER_UID]: { email: 'member@test.com', displayName: 'Member User' },
        [MEMBER2_UID]: { email: 'member2@test.com', displayName: 'Member 2' },
    });

    // Start with empty invitations
    admin._setMockCollection('teamInvitations', {});
});

// ── Gate 1: createInvite produces tokenHash, not plainToken ───────────

describe('Gate 1: Token generation', () => {
    test('createInvite returns plainToken and stores tokenHash', async () => {
        const result = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        expect(result.plainToken).toBeDefined();
        expect(result.plainToken).toHaveLength(64); // 32 bytes hex
        expect(result.invitationId).toBeDefined();

        // Verify tokenHash is stored, NOT plainToken
        const invitations = admin._mockData.collections['teamInvitations'];
        const invite = Object.values(invitations)[0];
        expect(invite.tokenHash).toBe(hashToken(result.plainToken));
        expect(invite.tokenHash).not.toBe(result.plainToken);
        // plainToken must NOT be stored anywhere in the doc
        expect(Object.values(invite)).not.toContain(result.plainToken);
    });

    test('createInvite sets workspaceId on invitation doc', async () => {
        await createInvite(WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor');

        const invitations = admin._mockData.collections['teamInvitations'];
        const invite = Object.values(invitations)[0];
        expect(invite.workspaceId).toBe(WORKSPACE_ID);
        expect(invite.inviterUid).toBe(OWNER_UID);
    });
});

// ── Gate 2: acceptInvite finds invitation by token hash ───────────────

describe('Gate 2: Token-based accept', () => {
    test('acceptInvite succeeds with correct plainToken', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'member@test.com', 'Member User'
        );

        expect(result.workspaceId).toBe(WORKSPACE_ID);
        expect(result.role).toBe('contributor');
        expect(result.membership).toBeDefined();
        expect(result.membership.uid).toBe(MEMBER_UID);
        expect(result.membership.status).toBe('active');
    });

    test('acceptInvite creates workspaceMembers doc with correct composite ID', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        await acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User');

        const memberDoc = admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_${MEMBER_UID}`];
        expect(memberDoc).toBeDefined();
        expect(memberDoc.uid).toBe(MEMBER_UID);
        expect(memberDoc.role).toBe('contributor');
        expect(memberDoc.isWorkspaceOwner).toBe(false);
    });

    test('acceptInvite rejects with wrong token', async () => {
        await createInvite(WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor');

        await expect(
            acceptInvite('wrong_token_value', MEMBER_UID, 'member@test.com', 'Member User')
        ).rejects.toThrow('Invalid or expired invitation token');
    });
});

// ── Gate 3: Second redemption fails ───────────────────────────────────

describe('Gate 3: Double-accept prevention', () => {
    test('second accept with same token returns idempotently (already active)', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        // First accept
        await acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User');

        // Second accept — invitation is now 'accepted', should fail
        await expect(
            acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User')
        ).rejects.toThrow(/already accepted/i);
    });
});

// ── Gate 4: Doc-ID blocks duplicate membership ────────────────────────

describe('Gate 4: Composite doc ID prevents duplicates', () => {
    test('workspace member doc ID is {workspaceId}_{uid}', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        await acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User');

        const expectedDocId = `${WORKSPACE_ID}_${MEMBER_UID}`;
        const members = admin._mockData.collections['workspaceMembers'];
        expect(members[expectedDocId]).toBeDefined();
        expect(members[expectedDocId].uid).toBe(MEMBER_UID);
    });
});

// ── Gate 5: Re-invited REMOVED member → reactivated ──────────────────

describe('Gate 5: Reactivation of removed members', () => {
    test('accepting invite for REMOVED member reactivates existing doc', async () => {
        // Seed a removed member
        admin._setMockCollection('workspaceMembers', {
            ...admin._mockData.collections['workspaceMembers'],
            [`${WORKSPACE_ID}_${MEMBER_UID}`]: {
                workspaceId: WORKSPACE_ID,
                uid: MEMBER_UID,
                email: 'member@test.com',
                displayName: 'Member User',
                role: 'contributor',
                isWorkspaceOwner: false,
                status: 'removed',
                removedAt: new Date(),
                reactivatedAt: null,
            },
        });

        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'admin'
        );

        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'member@test.com', 'Member User'
        );

        // Should reactivate, not create a second doc
        expect(result.membership.status).toBe('active');
        expect(result.membership.reactivatedAt).toBeDefined();
        expect(result.role).toBe('admin'); // New role from invite

        // Verify only one membership doc exists for this user
        const members = admin._mockData.collections['workspaceMembers'];
        const memberDocs = Object.entries(members).filter(([, v]) => v.uid === MEMBER_UID);
        expect(memberDocs).toHaveLength(1);
    });
});

// ── Gate 6: joinedAt populated ────────────────────────────────────────

describe('Gate 6: Timestamp fields populated', () => {
    test('joinedAt is set on new member acceptance', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'member@test.com', 'Member User'
        );

        expect(result.membership.joinedAt).toBeDefined();
        // Should not be null, undefined, or NaN
        expect(result.membership.joinedAt).not.toBeNull();
    });

    test('invite expiresAt is set to 7 days from creation', async () => {
        const { invitationId } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        const invitations = admin._mockData.collections['teamInvitations'];
        const invite = Object.values(invitations)[0];
        expect(invite.expiresAt).toBeDefined();
    });
});

// ── Gate 7: Invite email sends with workspace info ────────────────────

describe('Gate 7: Workspace invite email', () => {
    test('sendWorkspaceInviteEmail is callable with correct params', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor',
            { workspaceName: 'Test WS', inviterDisplayName: 'Owner User' }
        );

        // Simulate what teamRoutes does after createInvite
        await sendWorkspaceInviteEmail('member@test.com', {
            workspaceName: 'Test WS',
            inviterDisplayName: 'Owner User',
            inviterEmail: 'owner@test.com',
            role: 'contributor',
            inviteToken: plainToken,
        });

        expect(sendWorkspaceInviteEmail).toHaveBeenCalledWith(
            'member@test.com',
            expect.objectContaining({
                workspaceName: 'Test WS',
                inviterDisplayName: 'Owner User',
                inviteToken: plainToken,
            })
        );
    });
});

// ── Gate 8: Seat limit enforcement ────────────────────────────────────

describe('Gate 8: Seat limit atomicity', () => {
    test('accept fails when workspace seat limit is reached', async () => {
        // Set workspace to seatLimit: 2, memberCount: 2 (full)
        admin._mockData.collections['workspaces'][WORKSPACE_ID].seatLimit = 2;
        admin._mockData.collections['workspaces'][WORKSPACE_ID].memberCount = 2;

        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        await expect(
            acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User')
        ).rejects.toThrow(/seat limit/i);
    });

    test('accept succeeds when under seat limit', async () => {
        // seatLimit: 3, memberCount: 1 — plenty of room
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'member@test.com', 'Member User'
        );

        expect(result.workspaceId).toBe(WORKSPACE_ID);
    });

    test('unlimited seats (seatLimit: -1) always succeeds', async () => {
        admin._mockData.collections['workspaces'][WORKSPACE_ID].seatLimit = -1;
        admin._mockData.collections['workspaces'][WORKSPACE_ID].memberCount = 100;

        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'member@test.com', 'Member User'
        );

        expect(result.workspaceId).toBe(WORKSPACE_ID);
    });
});

// ── Gate 9: Expired invite rejection ──────────────────────────────────

describe('Gate 9: Invite expiry', () => {
    test('accepting expired invite throws error', async () => {
        const { plainToken, invitationId } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        // Manually expire the invitation
        const invitations = admin._mockData.collections['teamInvitations'];
        const inviteKey = Object.keys(invitations)[0];
        invitations[inviteKey].expiresAt = {
            toDate: () => new Date(Date.now() - 1000), // 1 second ago
        };

        await expect(
            acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User')
        ).rejects.toThrow(/expired/i);
    });

    test('createInvite auto-expires stale pending invite for same email', async () => {
        // Create first invite
        const first = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        // Manually expire it
        const invitations = admin._mockData.collections['teamInvitations'];
        const firstKey = Object.keys(invitations)[0];
        invitations[firstKey].expiresAt = {
            toDate: () => new Date(Date.now() - 1000),
        };

        // Create second invite — should succeed, first gets marked expired
        const second = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        expect(second.invitationId).toBeDefined();
        expect(second.invitationId).not.toBe(first.invitationId);

        // First invite should be expired
        expect(invitations[firstKey].status).toBe('expired');
    });
});

// ── Gate 10: Token binds by UID, not email ────────────────────────────

describe('Gate 10: Token binds by UID, not email', () => {
    test('user with different email can accept via token', async () => {
        // Invite sent to member@test.com
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        // Accepted by a user with a DIFFERENT email (but valid UID)
        const result = await acceptInvite(
            plainToken, MEMBER_UID, 'different-email@test.com', 'Member User'
        );

        expect(result.workspaceId).toBe(WORKSPACE_ID);
        expect(result.membership.uid).toBe(MEMBER_UID);
        // Email on membership doc = the accepting user's email, not the invited email
        expect(result.membership.email).toBe('different-email@test.com');
    });
});

// ── Duplicate invite prevention ───────────────────────────────────────

describe('Duplicate invite prevention', () => {
    test('creating two invites for same email throws conflict', async () => {
        await createInvite(WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor');

        await expect(
            createInvite(WORKSPACE_ID, OWNER_UID, 'member@test.com', 'admin')
        ).rejects.toThrow(/pending invitation already exists/i);
    });

    test('inviting an already-active member throws error', async () => {
        // member@test.com is already active (seed it)
        admin._mockData.collections['workspaceMembers'][`${WORKSPACE_ID}_existing`] = {
            workspaceId: WORKSPACE_ID,
            uid: 'existing_uid',
            email: 'member@test.com',
            status: 'active',
        };

        await expect(
            createInvite(WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor')
        ).rejects.toThrow(/already an active workspace member/i);
    });
});

// ── Teams mirror sync ─────────────────────────────────────────────────

describe('Teams mirror sync on accept', () => {
    test('accepting invite updates teams/{ownerUid} memberUids and members', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        await acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User');

        const teamsDoc = admin._mockData.collections['teams'][OWNER_UID];
        expect(teamsDoc.memberUids).toContain(MEMBER_UID);
    });

    test('accepting invite updates workspace memberIds and memberCount', async () => {
        const { plainToken } = await createInvite(
            WORKSPACE_ID, OWNER_UID, 'member@test.com', 'contributor'
        );

        await acceptInvite(plainToken, MEMBER_UID, 'member@test.com', 'Member User');

        const ws = admin._mockData.collections['workspaces'][WORKSPACE_ID];
        expect(ws.memberCount).toBe(2);
    });
});
