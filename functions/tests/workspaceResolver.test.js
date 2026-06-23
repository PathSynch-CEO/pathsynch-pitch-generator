'use strict';

/**
 * Unit tests for middleware/workspaceResolver.js (Phase 3B hardened)
 *
 * Tests cover:
 * - Solo user (no workspace) → null fields
 * - Anonymous user → null fields
 * - Single-workspace owner auto-resolves
 * - Single-workspace member auto-resolves
 * - Removed member → solo fallback (no active membership)
 * - Resolution failure → WorkspaceResolutionError (fail-closed)
 * - Explicit x-workspace-id header: valid, invalid, foreign
 * - Multiple active workspaces + no candidate → reject (400)
 * - Explicit candidate with no active workspaces → reject (403)
 * - Membership inconsistency → fail-closed (500)
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const { resolveWorkspace, WorkspaceResolutionError } = require('../middleware/workspaceResolver');

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
});

function seedWorkspaceAndMember(workspaceId, ownerId, memberUid, memberRole = 'contributor', memberStatus = 'active') {
    admin._setMockCollection('workspaces', {
        [workspaceId]: {
            ownerId,
            entitlementOwnerUid: ownerId,
            name: "Test Workspace",
            memberIds: [ownerId, memberUid].filter(Boolean),
            memberCount: memberUid ? 2 : 1,
            seatLimit: 5,
        },
    });

    const members = {};
    members[`${workspaceId}_${ownerId}`] = {
        workspaceId,
        uid: ownerId,
        role: 'admin',
        isWorkspaceOwner: true,
        status: 'active',
    };
    if (memberUid) {
        members[`${workspaceId}_${memberUid}`] = {
            workspaceId,
            uid: memberUid,
            role: memberRole,
            isWorkspaceOwner: false,
            status: memberStatus,
        };
    }
    admin._setMockCollection('workspaceMembers', members);
}

function seedMultipleWorkspaces(userId) {
    admin._setMockCollection('workspaces', {
        'ws_alpha': {
            ownerId: 'other_owner_a',
            entitlementOwnerUid: 'other_owner_a',
            name: "Alpha Workspace",
            memberIds: ['other_owner_a', userId],
            memberCount: 2,
            seatLimit: 5,
        },
        'ws_beta': {
            ownerId: 'other_owner_b',
            entitlementOwnerUid: 'other_owner_b',
            name: "Beta Workspace",
            memberIds: ['other_owner_b', userId],
            memberCount: 2,
            seatLimit: 5,
        },
    });

    admin._setMockCollection('workspaceMembers', {
        'ws_alpha_other_owner_a': { workspaceId: 'ws_alpha', uid: 'other_owner_a', role: 'admin', isWorkspaceOwner: true, status: 'active' },
        [`ws_alpha_${userId}`]: { workspaceId: 'ws_alpha', uid: userId, role: 'contributor', isWorkspaceOwner: false, status: 'active' },
        'ws_beta_other_owner_b': { workspaceId: 'ws_beta', uid: 'other_owner_b', role: 'admin', isWorkspaceOwner: true, status: 'active' },
        [`ws_beta_${userId}`]: { workspaceId: 'ws_beta', uid: userId, role: 'manager', isWorkspaceOwner: false, status: 'active' },
    });
}

function makeReq(userId, headers = {}) {
    return { userId, userEmail: userId ? `${userId}@test.com` : null, headers };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveWorkspace (hardened)', () => {
    test('anonymous user gets null workspace fields', async () => {
        const req = makeReq('anonymous');
        await resolveWorkspace(req);

        expect(req.workspaceId).toBeNull();
        expect(req.workspaceRole).toBeNull();
        expect(req.workspaceMembership).toBeNull();
        expect(req.entitlementOwnerUid).toBeNull();
    });

    test('unauthenticated (no userId) gets null workspace fields', async () => {
        const req = { userId: null, userEmail: null, headers: {} };
        await resolveWorkspace(req);

        expect(req.workspaceId).toBeNull();
        expect(req.entitlementOwnerUid).toBeNull();
    });

    test('solo user (no workspace) gets null workspace, self as entitlement owner', async () => {
        const req = makeReq('solo_user');
        await resolveWorkspace(req);

        expect(req.workspaceId).toBeNull();
        expect(req.workspaceRole).toBeNull();
        expect(req.workspaceMembership).toBeNull();
        expect(req.entitlementOwnerUid).toBe('solo_user');
    });

    test('single-workspace owner auto-resolves full context', async () => {
        seedWorkspaceAndMember('ws1', 'owner1', null);

        const req = makeReq('owner1');
        await resolveWorkspace(req);

        expect(req.workspaceId).toBe('ws1');
        expect(req.workspaceRole).toBe('admin');
        expect(req.workspaceMembership).toBeDefined();
        expect(req.workspaceMembership.isWorkspaceOwner).toBe(true);
        expect(req.entitlementOwnerUid).toBe('owner1');
    });

    test('single-workspace member auto-resolves with correct role', async () => {
        seedWorkspaceAndMember('ws1', 'owner1', 'member1', 'manager');

        const req = makeReq('member1');
        await resolveWorkspace(req);

        expect(req.workspaceId).toBe('ws1');
        expect(req.workspaceRole).toBe('manager');
        expect(req.workspaceMembership).toBeDefined();
        expect(req.workspaceMembership.isWorkspaceOwner).toBe(false);
        expect(req.entitlementOwnerUid).toBe('owner1');
    });

    test('removed member gets solo fallback (zero active memberships)', async () => {
        seedWorkspaceAndMember('ws1', 'owner1', 'removed1', 'contributor', 'removed');

        const req = makeReq('removed1');
        await resolveWorkspace(req);

        expect(req.workspaceId).toBeNull();
        expect(req.workspaceRole).toBeNull();
        expect(req.workspaceMembership).toBeNull();
        expect(req.entitlementOwnerUid).toBe('removed1');
    });

    // ── Fail-closed on error ──

    test('Firestore enumeration failure → WorkspaceResolutionError 500', async () => {
        const originalCollection = admin._mockFirestore.collection;
        admin._mockFirestore.collection = jest.fn(() => {
            throw new Error('Firestore unavailable');
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const req = makeReq('user1');

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('WORKSPACE_RESOLUTION_FAILED');
        }

        consoleSpy.mockRestore();
        admin._mockFirestore.collection = originalCollection;
    });

    // ── x-workspace-id header ──

    test('explicit valid x-workspace-id header resolves that workspace', async () => {
        seedWorkspaceAndMember('ws1', 'owner1', 'member1', 'contributor');

        const req = makeReq('member1', { 'x-workspace-id': 'ws1' });
        await resolveWorkspace(req);

        expect(req.workspaceId).toBe('ws1');
        expect(req.workspaceRole).toBe('contributor');
    });

    test('explicit invalid x-workspace-id → 403 WORKSPACE_MEMBERSHIP_REQUIRED', async () => {
        seedWorkspaceAndMember('ws1', 'owner1', 'member1', 'contributor');

        const req = makeReq('member1', { 'x-workspace-id': 'ws_nonexistent' });

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe('WORKSPACE_MEMBERSHIP_REQUIRED');
        }
    });

    test('x-workspace-id with no active memberships at all → 403 WORKSPACE_NOT_FOUND', async () => {
        // solo_user has no workspace at all
        const req = makeReq('solo_user', { 'x-workspace-id': 'ws_whatever' });

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe('WORKSPACE_NOT_FOUND');
        }
    });

    // ── Multiple workspaces ──

    test('multiple active workspaces + no candidate → 400 WORKSPACE_AMBIGUOUS', async () => {
        seedMultipleWorkspaces('multi_user');

        const req = makeReq('multi_user');

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe('WORKSPACE_AMBIGUOUS');
        }
    });

    test('multiple active workspaces + valid candidate → resolves that workspace', async () => {
        seedMultipleWorkspaces('multi_user');

        const req = makeReq('multi_user', { 'x-workspace-id': 'ws_beta' });
        await resolveWorkspace(req);

        expect(req.workspaceId).toBe('ws_beta');
        expect(req.workspaceRole).toBe('manager');
    });

    test('multiple active workspaces + invalid candidate → 403', async () => {
        seedMultipleWorkspaces('multi_user');

        const req = makeReq('multi_user', { 'x-workspace-id': 'ws_nonexistent' });

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe('WORKSPACE_MEMBERSHIP_REQUIRED');
        }
    });

    // ── Membership inconsistency ──

    test('workspace found in enumeration but membership doc missing → 500', async () => {
        // Seed workspace that claims user is a member via ownerId, but no membership doc exists
        admin._setMockCollection('workspaces', {
            'ws_broken': {
                ownerId: 'ghost_user',
                entitlementOwnerUid: 'ghost_user',
                name: "Broken Workspace",
                memberIds: ['ghost_user'],
                memberCount: 1,
                seatLimit: 5,
            },
        });
        // No workspaceMembers doc for ghost_user
        admin._setMockCollection('workspaceMembers', {});

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const req = makeReq('ghost_user');

        await expect(resolveWorkspace(req)).rejects.toThrow(WorkspaceResolutionError);
        try { await resolveWorkspace(req); } catch (err) {
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('WORKSPACE_MEMBERSHIP_INCONSISTENT');
        }

        consoleSpy.mockRestore();
    });
});
