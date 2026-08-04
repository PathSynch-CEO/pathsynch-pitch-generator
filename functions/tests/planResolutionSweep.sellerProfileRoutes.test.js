'use strict';

/**
 * F-1014 regression — routes/sellerProfileRoutes.js GET /seller-profiles limit.
 *
 * TRIGGER: `const tier = userData.plan || userData.tier || 'starter'`
 * (subscription.plan never consulted). A paying Scale user whose plan lives only in
 * `subscription.plan` was resolved as 'starter' and capped at 1 seller profile
 * (PROFILE_LIMITS.scale === 3). The fix routes tier through getUserPlan(), so the
 * returned `tier`/`limit` reflect the real plan.
 *
 * STRICT firebase-admin mock — .doc(falsy) THROWS like the real SDK.
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
        FieldValue: { serverTimestamp: () => new Date() },
    }),
}));

jest.mock('../services/ragService', () => ({ ingestDocument: jest.fn(async () => {}) }));

const sellerProfileRoutes = require('../routes/sellerProfileRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}
const req = (userId) => ({ method: 'GET', normalizedPath: '/seller-profiles', path: '/seller-profiles', userId, query: {}, params: {}, body: {} });

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; });

describe('F-1014: seller-profiles limit resolves plan via getUserPlan', () => {
    test('Scale via subscription.plan (no plan/tier field) yields the Scale limit (3)', async () => {
        mockStore.users['u1'] = { subscription: { plan: 'scale' } }; // no top-level plan/tier
        const res = mockRes();
        const handled = await sellerProfileRoutes.handle(req('u1'), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        expect(res._body.data.tier).toBe('scale'); // pre-fix: 'starter'
        expect(res._body.data.limit).toBe(3);      // pre-fix: 1 (PROFILE_LIMITS.starter)
    });

    test('A starter user still resolves the starter limit (1)', async () => {
        mockStore.users['u2'] = { subscription: { plan: 'starter' } };
        const res = mockRes();
        await sellerProfileRoutes.handle(req('u2'), res);
        expect(res._body.data.tier).toBe('starter');
        expect(res._body.data.limit).toBe(1);
    });
});
