'use strict';

/**
 * Repro harness for the #72 null-userId regression on /investor/updates.
 * Uses a STRICT firebase-admin mock whose .doc(falsy) THROWS exactly like the real
 * Admin SDK ("documentPath is not a valid resource path") — the shared __mocks__ mock
 * silently returns an auto-id for .doc(null), which is precisely why the class of bug
 * escapes the normal test suite.
 */

const mockStore = { users: {}, investorUpdates: {} };

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') {
        throw new Error('Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.');
    }
    return {
        id,
        get: async () => ({ exists: mockStore[col] && id in mockStore[col], data: () => (mockStore[col] || {})[id] }),
        set: async () => {}, update: async () => {},
        collection: (sub) => mockCollection(`${col}/${id}/${sub}`),
    };
}
function mockCollection(name) {
    const col = name;
    const q = {
        where() { return q; }, orderBy() { return q; }, limit() { return q; },
        get: async () => ({ docs: [], empty: true, size: 0, forEach() {} }),
    };
    return Object.assign(q, { doc: (id) => mockDoc(col, id), add: async () => ({ id: 'x' }) });
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
    getCurrentPeriod: () => '2026-07',
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

beforeEach(() => { mockStore.users = {}; mockStore.investorUpdates = {}; });

describe('REPRO: GET /investor/updates under the #72 null sentinel', () => {
    test('unauthenticated (userId=null) → clean 401, never touches .doc(null)', async () => {
        const res = mockRes();
        const handled = await investorRoutes.handle(req(null), res);
        expect(handled).toBe(true);
        expect(res._status).toBe(401);
    });

    test('authenticated enterprise user → 200 (guarded path reaches the service)', async () => {
        mockStore.users['u1'] = { plan: 'enterprise', tier: 'enterprise' };
        const r = req('u1');
        const res = mockRes();
        await investorRoutes.handle(r, res);
        expect(res._status).toBe(200);
    });
});

// Root-cause contract: ApiError is (code, message, details) and derives status from the code.
// The investor routes had args in the WRONG order (message, status, code) — so the intended 401
// resolved to 500. This guards the class against regressing again.
describe('ApiError argument-order contract (root cause of the #72 500)', () => {
    const { ApiError, ErrorCodes } = require('../middleware/errorHandler');

    test('correct order (code first) yields the intended HTTP status', () => {
        expect(new ApiError(ErrorCodes.UNAUTHORIZED, 'Authentication required').status).toBe(401);
        expect(new ApiError(ErrorCodes.AUTHORIZATION_ERROR, 'nope').status).toBe(403);
        expect(new ApiError(ErrorCodes.NOT_FOUND, 'nope').status).toBe(404);
    });

    test('the OLD mis-ordered form (message first) collapses to 500 — the exact bug', () => {
        // A human message is not a key in ErrorStatus, so status falls back to 500.
        expect(new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED).status).toBe(500);
    });
});
