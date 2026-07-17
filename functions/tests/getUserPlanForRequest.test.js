'use strict';

/**
 * getUserPlanForRequest — workspace-aware plan resolution for request-path gates.
 *
 * Follow-up to the member identity fix: backend plan gates resolved the caller's
 * own free-tier doc instead of the workspace owner's plan, so a member saw
 * enterprise in the UI but got 403/starter treatment on server-enforced routes.
 *
 * These lock in: member -> owner plan; solo/owner -> own plan; resolver-not-run
 * (no req.workspaceId) -> own plan (fail-soft, pre-fix behavior).
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const { getUserPlan, getUserPlanForRequest } = require('../middleware/planGate');

const OWNER_UID = 'owner_gup';
const MEMBER_UID = 'member_gup';
const SOLO_UID = 'solo_gup';
const ENT_WS = 'ws_ent_gup';
const GROWTH_WS = 'ws_growth_gup';

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    admin._setMockCollection('workspaces', {
        [ENT_WS]: { ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID, memberCount: 2, seatLimit: -1 },
        [GROWTH_WS]: { ownerId: 'growthowner_gup', entitlementOwnerUid: 'growthowner_gup', memberCount: 2, seatLimit: 3 },
    });

    admin._setMockCollection('users', {
        [OWNER_UID]: { subscription: { plan: 'enterprise', tier: 'enterprise' }, tier: 'enterprise' },
        ['growthowner_gup']: { subscription: { plan: 'growth' }, tier: 'growth' },
        [MEMBER_UID]: { tier: 'FREE' },
        [SOLO_UID]: { subscription: { plan: 'scale' }, tier: 'scale' },
    });
});

describe('getUserPlanForRequest', () => {
    test('member inherits the workspace OWNER plan (enterprise), not their own FREE', async () => {
        const req = { userId: MEMBER_UID, workspaceId: ENT_WS };
        await expect(getUserPlanForRequest(req)).resolves.toBe('enterprise');
    });

    test('member of a growth workspace resolves growth', async () => {
        const req = { userId: MEMBER_UID, workspaceId: GROWTH_WS };
        await expect(getUserPlanForRequest(req)).resolves.toBe('growth');
    });

    test('owner resolves their own plan via their own workspace', async () => {
        const req = { userId: OWNER_UID, workspaceId: ENT_WS };
        await expect(getUserPlanForRequest(req)).resolves.toBe('enterprise');
    });

    test('solo user (workspaceId null) resolves their own plan', async () => {
        const req = { userId: SOLO_UID, workspaceId: null };
        await expect(getUserPlanForRequest(req)).resolves.toBe('scale');
    });

    test('resolver did not run (workspaceId undefined) -> own plan, no throw (fail-soft)', async () => {
        const req = { userId: SOLO_UID }; // no workspaceId field at all
        await expect(getUserPlanForRequest(req)).resolves.toBe('scale');
    });

    test('member with workspaceId undefined falls back to own FREE (would be pre-fix behavior)', async () => {
        const req = { userId: MEMBER_UID }; // resolver did not attach a workspace
        // FREE is not a recognized paid tier -> getUserPlan lowercases to 'free'
        await expect(getUserPlanForRequest(req)).resolves.toBe('free');
    });

    test('is a thin wrapper — identical to getUserPlan(uid,{workspaceId})', async () => {
        const req = { userId: MEMBER_UID, workspaceId: ENT_WS };
        const viaWrapper = await getUserPlanForRequest(req);
        const viaDirect = await getUserPlan(MEMBER_UID, { workspaceId: ENT_WS });
        expect(viaWrapper).toBe(viaDirect);
    });
});
