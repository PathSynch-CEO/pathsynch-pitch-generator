'use strict';

/**
 * F-1014 regression — routes/investorRoutes.js `requireEnterprise`.
 *
 * TRIGGER: the gate resolved the plan from `userData.tier || userData.plan`.
 * `tier` is set at account creation and never updated by Stripe (which writes the
 * real plan to `subscription.plan`), so a genuine Enterprise user whose plan lives
 * only in `subscription.plan` was misclassified as free/starter and 403'd out of
 * Investor Updates. The fix routes the gate through the canonical getUserPlan().
 *
 * This test asserts the exact production shape (stale `tier`, real plan in
 * `subscription.plan`) reaches the guarded 200 path. Against pre-fix source it fails
 * for the RIGHT reason: the stale-tier read yields 'free' -> hasFeature('free',
 * 'investorUpdates') === false -> 403.
 *
 * STRICT firebase-admin mock (models tests/investorUpdatesNullUserId.test.js): a
 * .doc(falsy) THROWS like the real SDK, so getUserPlan is exercised honestly and the
 * permissive shared __mocks__ auto-id behaviour cannot mask a bug.
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
jest.mock('../services/integrationConnector', () => ({}));
jest.mock('../services/metricsAggregator', () => ({ getPreviousPeriod: () => 'p', fetchAllMetrics: jest.fn(), getMetricsComparison: jest.fn() }));
jest.mock('../services/investorReportGenerator', () => ({ generateReport: jest.fn(), regenerateReport: jest.fn() }));

const investorRoutes = require('../routes/investorRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}
const req = (userId) => ({ method: 'GET', normalizedPath: '/investor/updates', path: '/investor/updates', userId, query: { limit: 20 }, params: {}, body: {} });

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; });

describe('F-1014: investor requireEnterprise resolves plan via getUserPlan', () => {
    test('Enterprise via subscription.plan with a stale tier passes the gate (200)', async () => {
        // Production shape: Stripe wrote enterprise to subscription.plan; account-creation tier is stale.
        mockStore.users['u1'] = { tier: 'free', subscription: { plan: 'enterprise' } };
        const res = mockRes();
        const handled = await investorRoutes.handle(req('u1'), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200); // pre-fix: 403 (stale 'free' read)
        expect(res._body.success).toBe(true);
    });

    test('A genuine non-Enterprise user is still denied (403)', async () => {
        // Growth in subscription.plan is below Enterprise — the gate must still reject.
        mockStore.users['u2'] = { tier: 'free', subscription: { plan: 'growth' } };
        const res = mockRes();
        await investorRoutes.handle(req('u2'), res);
        expect(res._status).toBe(403);
    });

    test('Unauthenticated request → 401', async () => {
        const res = mockRes();
        await investorRoutes.handle(req(null), res);
        expect(res._status).toBe(401);
    });
});
