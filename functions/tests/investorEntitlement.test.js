'use strict';

/**
 * Investor Updates entitlement resolution — workspace-aware plan gating.
 *
 * TRIGGER: `requireEnterprise` in routes/investorRoutes.js called
 * getUserPlan(userId) with no workspace context, so a member of an Enterprise
 * workspace was resolved against their OWN users/{uid} doc — which carries the
 * stale signup tier — and 403'd out of Investor Updates. Because
 * `checkIntegration` consumes the tier `requireEnterprise` returns, the same
 * mis-resolution also denied Stripe/Shopify/QuickBooks/GA4 integration access.
 *
 * SYSTEM_BIBLE law 13: plan gates resolve the workspace OWNER's plan via the
 * server-verified req.workspaceId. This file mirrors tests/visitorEntitlement.test.js.
 *
 * These lock in: a contributor whose own doc is stale FREE inherits the owner's
 * Enterprise plan (feature AND integration gates); a solo Starter user is still
 * denied; owners behave exactly as before; and a workspace-less request keeps the
 * pre-fix (caller's own plan) behaviour.
 */

const mockStore = { users: {}, workspaces: {} };

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') {
        throw new Error('Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.');
    }
    return {
        id,
        get: async () => ({ exists: !!(mockStore[col] && id in mockStore[col]), data: () => (mockStore[col] || {})[id] }),
        set: async () => {}, update: async () => {},
        collection: (sub) => mockCollection(`${col}/${id}/${sub}`),
    };
}
function mockCollection(name) {
    const q = {
        where() { return q; }, orderBy() { return q; }, limit() { return q; },
        get: async () => ({ docs: [], empty: true, size: 0, forEach() {} }),
    };
    return Object.assign(q, { doc: (id) => mockDoc(name, id), add: async () => ({ id: 'x' }) });
}

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(() => ({ collection: (n) => mockCollection(n) }), {
        FieldValue: { serverTimestamp: () => new Date(), increment: (n) => ({ _increment: n }) },
    }),
}));

// Isolate the route from heavy service deps.
jest.mock('../services/investorUpdates', () => ({
    listInvestorUpdates: jest.fn(async () => []),
    getCurrentPeriod: () => '2026-08',
    getMetricsSnapshots: jest.fn(async () => []),
    getInvestorUpdate: jest.fn(async () => null),
    updateInvestorUpdate: jest.fn(async () => {}),
    publishInvestorUpdate: jest.fn(async () => {}),
    deleteInvestorUpdate: jest.fn(async () => {}),
    disconnectProvider: jest.fn(async () => {}),
    REPORT_TEMPLATES: {},
}));
jest.mock('../services/integrationConnector', () => ({
    connectStripe: jest.fn(async () => ({ connected: true })),
}));
jest.mock('../services/metricsAggregator', () => ({ getPreviousPeriod: () => 'p', fetchAllMetrics: jest.fn(), getMetricsComparison: jest.fn() }));
jest.mock('../services/investorReportGenerator', () => ({ generateReport: jest.fn(), regenerateReport: jest.fn() }));

const investorRoutes = require('../routes/investorRoutes');
const { requireEnterprise } = investorRoutes;

const OWNER_UID = 'owner_inv';         // Enterprise account owner
const MEMBER_UID = 'member_inv';       // invited contributor — own doc is stale FREE
const STARTER_SOLO = 'starter_solo_inv';
const ENTERPRISE_SOLO = 'ent_solo_inv';

const ENT_WS = 'ws_ent_inv';

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}
const listReq = (userId, workspaceId = null) => ({
    method: 'GET', normalizedPath: '/investor/updates', path: '/investor/updates',
    userId, workspaceId, query: { limit: 20 }, params: {}, body: {},
});
const connectStripeReq = (userId, workspaceId = null) => ({
    method: 'POST', normalizedPath: '/investor/integrations/connect/stripe', path: '/investor/integrations/connect/stripe',
    userId, workspaceId, query: {}, params: {}, body: { secretKey: 'sk_test_x' },
});

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.users = {
        // Owner doc carries the real (paid) plan via the Stripe subscription.
        [OWNER_UID]: { subscription: { plan: 'enterprise' }, tier: 'enterprise' },
        // The invited contributor's OWN doc is stale FREE — this is the trap.
        [MEMBER_UID]: { tier: 'FREE' },
        [STARTER_SOLO]: { subscription: { plan: 'starter' }, tier: 'FREE' },
        [ENTERPRISE_SOLO]: { tier: 'free', subscription: { plan: 'enterprise' } },
    };
    mockStore.workspaces = {
        [ENT_WS]: { ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID },
    };
});

describe('Investor Updates entitlement — workspace members inherit the owner plan', () => {
    test('contributor with a stale FREE doc on an Enterprise workspace → allowed (200)', async () => {
        const res = mockRes();
        const handled = await investorRoutes.handle(listReq(MEMBER_UID, ENT_WS), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200); // pre-fix: 403 (own stale FREE doc)
        expect(res._body.success).toBe(true);
    });

    test('contributor resolves to the OWNER\'s enterprise tier, never their own free', async () => {
        const { tier } = await requireEnterprise(MEMBER_UID, { userId: MEMBER_UID, workspaceId: ENT_WS });
        expect(tier).toBe('enterprise');
        expect(tier).not.toBe('free');
    });

    test('integration gating follows the inherited tier — contributor can connect Stripe (200)', async () => {
        const integrationConnector = require('../services/integrationConnector');
        const res = mockRes();
        await investorRoutes.handle(connectStripeReq(MEMBER_UID, ENT_WS), res);

        expect(res._status).toBe(200); // pre-fix: 403 from checkIntegration on the stale tier
        expect(integrationConnector.connectStripe).toHaveBeenCalledWith(MEMBER_UID, 'sk_test_x');
    });

    test('owner on their own Enterprise workspace → unchanged (200, enterprise)', async () => {
        const res = mockRes();
        await investorRoutes.handle(listReq(OWNER_UID, ENT_WS), res);
        expect(res._status).toBe(200);

        const { tier } = await requireEnterprise(OWNER_UID, { userId: OWNER_UID, workspaceId: ENT_WS });
        expect(tier).toBe('enterprise');
    });
});

describe('Investor Updates entitlement — solo users keep their own plan', () => {
    test('solo Starter user (no workspace) → still DENIED (403)', async () => {
        const res = mockRes();
        await investorRoutes.handle(listReq(STARTER_SOLO, null), res);
        expect(res._status).toBe(403);
    });

    test('solo Enterprise user via subscription.plan with a stale tier → allowed (200), F-1014 chain intact', async () => {
        const res = mockRes();
        await investorRoutes.handle(listReq(ENTERPRISE_SOLO, null), res);
        expect(res._status).toBe(200);
    });

    test('contributor with NO workspace context → own (free) plan, denied', async () => {
        // Fail-soft: if workspaceResolver did not run there is no owner to inherit from.
        const res = mockRes();
        await investorRoutes.handle(listReq(MEMBER_UID, null), res);
        expect(res._status).toBe(403);
    });

    test('unauthenticated request → 401', async () => {
        const res = mockRes();
        await investorRoutes.handle(listReq(null, ENT_WS), res);
        expect(res._status).toBe(401);
    });
});
