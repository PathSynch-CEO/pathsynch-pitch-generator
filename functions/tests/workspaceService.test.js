'use strict';

/**
 * Unit tests for services/workspaceService.js
 *
 * Tests cover:
 * - createWorkspace: creates workspace + owner member doc, idempotent
 * - getWorkspaceForUser: owner lookup, member lookup, solo user → null
 * - getWorkspaceById: exists, not found
 * - getWorkspaceMembers: active only, excludes removed
 * - getMembership / getMemberRole: found, not found, removed
 * - addMember: creates member + mirrors, seat limit, reactivation, duplicate
 * - removeMember: marks removed + mirrors, cannot remove owner
 * - updateMemberRole: valid, invalid, cannot change owner
 */

jest.mock('firebase-admin');
jest.mock('../middleware/planGate', () => ({
    getUserPlan: jest.fn().mockResolvedValue('growth'),
}));

const admin = require('firebase-admin');
const {
    createWorkspace,
    getWorkspaceForUser,
    getWorkspaceById,
    getWorkspaceMembers,
    getMembership,
    getMemberRole,
    addMember,
    removeMember,
    updateMemberRole,
    VALID_ROLES,
} = require('../services/workspaceService');

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedWorkspace(workspaceId, ownerId, memberIds = [ownerId]) {
    admin._setMockCollection('workspaces', {
        [workspaceId]: {
            ownerId,
            entitlementOwnerUid: ownerId,
            name: "Test Workspace",
            memberIds,
            memberCount: memberIds.length,
            seatLimit: 3,
            createdAt: { _serverTimestamp: true },
            updatedAt: { _serverTimestamp: true },
        },
    });
}

function seedMember(workspaceId, uid, overrides = {}) {
    const docId = `${workspaceId}_${uid}`;
    const existing = admin._mockData.collections['workspaceMembers'] || {};
    admin._setMockCollection('workspaceMembers', {
        ...existing,
        [docId]: {
            workspaceId,
            uid,
            email: `${uid}@test.com`,
            displayName: uid,
            displayNameSnapshot: uid,
            role: 'contributor',
            isWorkspaceOwner: false,
            status: 'active',
            joinedAt: { _serverTimestamp: true },
            invitedBy: null,
            removedAt: null,
            reactivatedAt: null,
            updatedAt: { _serverTimestamp: true },
            ...overrides,
        },
    });
}

function seedTeam(ownerUid, memberUids = []) {
    const existing = admin._mockData.collections['teams'] || {};
    admin._setMockCollection('teams', {
        ...existing,
        [ownerUid]: {
            ownerUid,
            ownerEmail: `${ownerUid}@test.com`,
            ownerDisplayName: ownerUid,
            members: memberUids.map(uid => ({ uid, email: `${uid}@test.com`, role: 'contributor', status: 'active' })),
            memberUids: memberUids,
            createdAt: { _serverTimestamp: true },
            updatedAt: { _serverTimestamp: true },
        },
    });
}

// ── createWorkspace ─────────────────────────────────────────────────────────

describe('createWorkspace', () => {
    test('creates workspace + owner member doc', async () => {
        admin._setMockCollection('users', {
            owner1: { displayName: 'Owner One', email: 'owner1@test.com' },
        });

        const result = await createWorkspace('owner1', {
            ownerEmail: 'owner1@test.com',
            ownerDisplayName: 'Owner One',
        });

        expect(result).toBeDefined();
        expect(result.ownerId).toBe('owner1');
        expect(result.entitlementOwnerUid).toBe('owner1');
        expect(result.memberIds).toEqual(['owner1']);
        expect(result.memberCount).toBe(1);

        // Verify workspace doc was created
        const workspaces = admin._mockData.collections['workspaces'] || {};
        const workspaceIds = Object.keys(workspaces);
        expect(workspaceIds.length).toBe(1);

        // Verify owner member doc was created
        const members = admin._mockData.collections['workspaceMembers'] || {};
        const memberDocs = Object.values(members);
        expect(memberDocs.length).toBe(1);
        expect(memberDocs[0].uid).toBe('owner1');
        expect(memberDocs[0].isWorkspaceOwner).toBe(true);
        expect(memberDocs[0].role).toBe('admin');
        expect(memberDocs[0].status).toBe('active');
    });

    test('returns existing workspace on duplicate call (idempotent)', async () => {
        seedWorkspace('ws1', 'owner1');
        seedMember('ws1', 'owner1', { isWorkspaceOwner: true, role: 'admin' });

        const result = await createWorkspace('owner1', {
            ownerEmail: 'owner1@test.com',
            ownerDisplayName: 'Owner One',
        });

        expect(result.id).toBe('ws1');
        expect(result.ownerId).toBe('owner1');
    });

    test('uses deterministic ID when provided', async () => {
        const result = await createWorkspace('owner1', {
            workspaceId: 'ws_deterministic',
            ownerEmail: 'owner1@test.com',
            ownerDisplayName: 'Owner One',
        });

        expect(result.id).toBe('ws_deterministic');
    });

    test('seat limit derived from plan', async () => {
        // growth plan has teamMembers: 3
        const result = await createWorkspace('owner1', {
            ownerEmail: 'owner1@test.com',
        });

        expect(result.seatLimit).toBe(3);
    });
});

// ── getWorkspaceForUser ─────────────────────────────────────────────────────

describe('getWorkspaceForUser', () => {
    test('returns workspace when user is owner', async () => {
        seedWorkspace('ws1', 'owner1');

        const result = await getWorkspaceForUser('owner1');
        expect(result).toBeDefined();
        expect(result.id).toBe('ws1');
        expect(result.ownerId).toBe('owner1');
    });

    test('returns workspace when user is active member', async () => {
        seedWorkspace('ws1', 'owner1', ['owner1', 'member1']);
        seedMember('ws1', 'member1');

        const result = await getWorkspaceForUser('member1');
        expect(result).toBeDefined();
        expect(result.id).toBe('ws1');
    });

    test('returns null for removed member', async () => {
        seedWorkspace('ws1', 'owner1');
        seedMember('ws1', 'member1', { status: 'removed' });

        const result = await getWorkspaceForUser('member1');
        expect(result).toBeNull();
    });

    test('returns null for solo user (no workspace)', async () => {
        const result = await getWorkspaceForUser('solo1');
        expect(result).toBeNull();
    });
});

// ── getWorkspaceById ────────────────────────────────────────────────────────

describe('getWorkspaceById', () => {
    test('returns workspace when exists', async () => {
        seedWorkspace('ws1', 'owner1');

        const result = await getWorkspaceById('ws1');
        expect(result).toBeDefined();
        expect(result.id).toBe('ws1');
    });

    test('returns null when not found', async () => {
        const result = await getWorkspaceById('nonexistent');
        expect(result).toBeNull();
    });
});

// ── getWorkspaceMembers ─────────────────────────────────────────────────────

describe('getWorkspaceMembers', () => {
    test('returns only active members', async () => {
        seedMember('ws1', 'owner1', { isWorkspaceOwner: true, role: 'admin' });
        seedMember('ws1', 'member1', { status: 'active' });
        seedMember('ws1', 'member2', { status: 'removed' });

        const members = await getWorkspaceMembers('ws1');
        expect(members.length).toBe(2);
        const uids = members.map(m => m.uid);
        expect(uids).toContain('owner1');
        expect(uids).toContain('member1');
        expect(uids).not.toContain('member2');
    });
});

// ── getMembership / getMemberRole ────────────────────────────────────────────

describe('getMembership', () => {
    test('returns membership when exists', async () => {
        seedMember('ws1', 'member1', { role: 'manager' });

        const result = await getMembership('ws1', 'member1');
        expect(result).toBeDefined();
        expect(result.role).toBe('manager');
    });

    test('returns null when not found', async () => {
        const result = await getMembership('ws1', 'nonexistent');
        expect(result).toBeNull();
    });
});

describe('getMemberRole', () => {
    test('returns role for active member', async () => {
        seedMember('ws1', 'member1', { role: 'admin', status: 'active' });

        const role = await getMemberRole('ws1', 'member1');
        expect(role).toBe('admin');
    });

    test('returns null for removed member', async () => {
        seedMember('ws1', 'member1', { role: 'admin', status: 'removed' });

        const role = await getMemberRole('ws1', 'member1');
        expect(role).toBeNull();
    });

    test('returns null for non-member', async () => {
        const role = await getMemberRole('ws1', 'stranger');
        expect(role).toBeNull();
    });
});

// ── addMember ───────────────────────────────────────────────────────────────

describe('addMember', () => {
    test('creates member doc + mirrors', async () => {
        seedWorkspace('ws1', 'owner1');
        seedTeam('owner1');

        const result = await addMember('ws1', {
            uid: 'member1',
            email: 'member1@test.com',
            displayName: 'Member One',
            role: 'contributor',
            invitedBy: 'owner1',
        });

        expect(result).toBeDefined();
        expect(result.uid).toBe('member1');
        expect(result.role).toBe('contributor');
        expect(result.status).toBe('active');

        // Verify workspace memberIds updated
        const ws = admin._mockData.collections['workspaces']['ws1'];
        expect(ws.memberIds).toContain('member1');

        // Verify teams mirror updated
        const team = admin._mockData.collections['teams']['owner1'];
        expect(team.memberUids).toContain('member1');
    });

    test('returns existing active member (idempotent)', async () => {
        seedWorkspace('ws1', 'owner1', ['owner1', 'member1']);
        seedMember('ws1', 'member1', { status: 'active' });

        const result = await addMember('ws1', {
            uid: 'member1',
            email: 'member1@test.com',
            displayName: 'Member One',
            role: 'contributor',
        });

        expect(result.status).toBe('active');
    });

    test('reactivates removed member', async () => {
        seedWorkspace('ws1', 'owner1');
        seedMember('ws1', 'member1', { status: 'removed' });
        seedTeam('owner1');

        const result = await addMember('ws1', {
            uid: 'member1',
            email: 'member1@test.com',
            displayName: 'Member One',
            role: 'manager',
        });

        const membership = admin._mockData.collections['workspaceMembers']['ws1_member1'];
        expect(membership.status).toBe('active');
        expect(membership.reactivatedAt).toBeDefined();
    });

    test('throws on seat limit exceeded', async () => {
        seedWorkspace('ws1', 'owner1');
        // Set memberCount to seatLimit (3)
        admin._mockData.collections['workspaces']['ws1'].memberCount = 3;

        await expect(addMember('ws1', {
            uid: 'member99',
            email: 'member99@test.com',
            displayName: 'Over Limit',
            role: 'contributor',
        })).rejects.toThrow('seat limit');
    });

    test('throws on invalid role', async () => {
        seedWorkspace('ws1', 'owner1');

        await expect(addMember('ws1', {
            uid: 'member1',
            email: 'member1@test.com',
            displayName: 'Member One',
            role: 'superadmin',
        })).rejects.toThrow('Invalid role');
    });

    test('throws on nonexistent workspace', async () => {
        await expect(addMember('nonexistent', {
            uid: 'member1',
            email: 'member1@test.com',
            displayName: 'Member One',
            role: 'contributor',
        })).rejects.toThrow('not found');
    });
});

// ── removeMember ────────────────────────────────────────────────────────────

describe('removeMember', () => {
    test('marks member as removed + mirrors', async () => {
        seedWorkspace('ws1', 'owner1', ['owner1', 'member1']);
        seedMember('ws1', 'member1');
        seedTeam('owner1', ['member1']);

        await removeMember('ws1', 'member1');

        const membership = admin._mockData.collections['workspaceMembers']['ws1_member1'];
        expect(membership.status).toBe('removed');
        expect(membership.removedAt).toBeDefined();

        // Verify workspace memberIds updated
        const ws = admin._mockData.collections['workspaces']['ws1'];
        expect(ws.memberIds).not.toContain('member1');

        // Verify teams mirror updated
        const team = admin._mockData.collections['teams']['owner1'];
        expect(team.memberUids).not.toContain('member1');
    });

    test('throws when removing owner', async () => {
        seedWorkspace('ws1', 'owner1');
        seedMember('ws1', 'owner1', { isWorkspaceOwner: true, role: 'admin' });

        await expect(removeMember('ws1', 'owner1')).rejects.toThrow('Cannot remove workspace owner');
    });

    test('throws when member not found', async () => {
        seedWorkspace('ws1', 'owner1');

        await expect(removeMember('ws1', 'nonexistent')).rejects.toThrow('Member not found');
    });
});

// ── updateMemberRole ────────────────────────────────────────────────────────

describe('updateMemberRole', () => {
    test('updates role', async () => {
        seedMember('ws1', 'member1', { role: 'contributor' });

        await updateMemberRole('ws1', 'member1', 'manager');

        const membership = admin._mockData.collections['workspaceMembers']['ws1_member1'];
        expect(membership.role).toBe('manager');
    });

    test('throws on invalid role', async () => {
        seedMember('ws1', 'member1');

        await expect(updateMemberRole('ws1', 'member1', 'superadmin'))
            .rejects.toThrow('Invalid role');
    });

    test('throws when changing owner role', async () => {
        seedMember('ws1', 'owner1', { isWorkspaceOwner: true, role: 'admin' });

        await expect(updateMemberRole('ws1', 'owner1', 'contributor'))
            .rejects.toThrow('Cannot change workspace owner role');
    });
});

// ── VALID_ROLES ─────────────────────────────────────────────────────────────

describe('VALID_ROLES', () => {
    test('includes contributor, manager, admin', () => {
        expect(VALID_ROLES).toEqual(['contributor', 'manager', 'admin']);
    });

    test('does not include viewer (legacy)', () => {
        expect(VALID_ROLES).not.toContain('viewer');
    });
});
