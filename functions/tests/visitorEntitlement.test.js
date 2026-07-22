'use strict';

/**
 * Visitor Intel entitlement resolution — role × plan-tier matrix.
 *
 * Regression for the P0: the /visitors + /visitors/snippet gate resolved the
 * CALLER's own user doc (a member's own doc carries stale `tier:'FREE'`) instead
 * of the workspace OWNER's plan, so a Contributor on an Enterprise workspace got
 * "Website Visitor Intel is not available on your current plan" (403). This route
 * was missed by the July 16 getUserPlanForRequest workspace-aware sweep.
 *
 * These lock in: every non-owner role (contributor/manager/admin member) inherits
 * the workspace owner's plan; a legitimately-free SOLO user is still denied.
 */

jest.mock('firebase-admin');
// visitorRoutes destructures getWorkspaceForUser at load time — mock the module so
// the (rare) public-track path is deterministic without wiring membership queries.
jest.mock('../services/workspaceService', () => ({
    getWorkspaceForUser: jest.fn(),
}));

const admin = require('firebase-admin');
const { getWorkspaceForUser } = require('../services/workspaceService');
const { getUserTierAndCheckLimit } = require('../routes/visitorRoutes');

const OWNER_UID = 'owner_vis';        // Enterprise account owner (workspace admin)
const MEMBER_UID = 'member_vis';      // invited member — own doc is FREE
const GROWTH_OWNER = 'growthowner_vis';
const STARTER_SOLO = 'starter_solo_vis';
const FREE_SOLO = 'free_solo_vis';

const ENT_WS = 'ws_ent_vis';
const GROWTH_WS = 'ws_growth_vis';

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    admin._setMockCollection('workspaces', {
        [ENT_WS]: { ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID, memberCount: 3, seatLimit: -1 },
        [GROWTH_WS]: { ownerId: GROWTH_OWNER, entitlementOwnerUid: GROWTH_OWNER, memberCount: 2, seatLimit: 3 },
    });

    admin._setMockCollection('users', {
        // Owner docs carry the real (paid) plan via the Stripe subscription.
        [OWNER_UID]: { subscription: { plan: 'enterprise', tier: 'enterprise' }, tier: 'enterprise' },
        [GROWTH_OWNER]: { subscription: { plan: 'growth' }, tier: 'growth' },
        // The invited member's OWN doc is stale FREE — this is the trap.
        [MEMBER_UID]: { tier: 'FREE' },
        [STARTER_SOLO]: { subscription: { plan: 'starter' }, tier: 'FREE' },
        [FREE_SOLO]: { tier: 'FREE' },
    });

    // No visitors tracked this month → count is 0 for everyone.
    admin._setMockCollection('websiteVisitors', {});
});

describe('Visitor Intel entitlement — workspace members inherit the owner plan', () => {
    test('contributor member on an Enterprise workspace → access, unlimited (NOT their own FREE)', async () => {
        const req = { userId: MEMBER_UID, workspaceId: ENT_WS };
        const status = await getUserTierAndCheckLimit(MEMBER_UID, req);
        expect(status.tier).toBe('enterprise');
        expect(status.hasAccess).toBe(true);
        expect(status.limit).toBe(-1);
        expect(status.atLimit).toBe(false);
    });

    test('member on a Growth workspace → access, 500/mo limit', async () => {
        const req = { userId: MEMBER_UID, workspaceId: GROWTH_WS };
        const status = await getUserTierAndCheckLimit(MEMBER_UID, req);
        expect(status.tier).toBe('growth');
        expect(status.hasAccess).toBe(true);
        expect(status.limit).toBe(500);
    });

    test('owner (admin) on their Enterprise workspace → access, unlimited', async () => {
        const req = { userId: OWNER_UID, workspaceId: ENT_WS };
        const status = await getUserTierAndCheckLimit(OWNER_UID, req);
        expect(status.tier).toBe('enterprise');
        expect(status.hasAccess).toBe(true);
        expect(status.limit).toBe(-1);
    });
});

describe('Visitor Intel entitlement — solo users keep their own plan', () => {
    test('solo Starter user (no workspace) → access, 50/mo limit', async () => {
        const req = { userId: STARTER_SOLO, workspaceId: null };
        const status = await getUserTierAndCheckLimit(STARTER_SOLO, req);
        expect(status.tier).toBe('starter');
        expect(status.hasAccess).toBe(true);
        expect(status.limit).toBe(50);
    });

    test('solo Free user (no workspace) → correctly DENIED', async () => {
        const req = { userId: FREE_SOLO, workspaceId: null };
        const status = await getUserTierAndCheckLimit(FREE_SOLO, req);
        expect(status.tier).toBe('free');
        expect(status.hasAccess).toBe(false);
        expect(status.limit).toBe(0);
    });
});

describe('Visitor Intel entitlement — regression guard', () => {
    test('member is NEVER resolved to their own stale FREE when a workspace is present', async () => {
        const req = { userId: MEMBER_UID, workspaceId: ENT_WS };
        const status = await getUserTierAndCheckLimit(MEMBER_UID, req);
        // The pre-fix bug produced tier:'free' / hasAccess:false here.
        expect(status.tier).not.toBe('free');
        expect(status.hasAccess).toBe(true);
    });

    test('public track path (no req) resolves the snippet OWNER\'s workspace plan', async () => {
        // Snippet owned by a member — track path resolves their workspace server-side.
        getWorkspaceForUser.mockResolvedValue({ id: ENT_WS });
        const status = await getUserTierAndCheckLimit(MEMBER_UID);
        expect(getWorkspaceForUser).toHaveBeenCalledWith(MEMBER_UID);
        expect(status.tier).toBe('enterprise');
        expect(status.hasAccess).toBe(true);
    });
});
