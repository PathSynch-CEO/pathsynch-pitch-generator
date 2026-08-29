'use strict';

/**
 * Workspace-aware plan resolution — routes/merchantConfigRoutes.js (audit V-11).
 *
 * POST /merchant-config resolved the caller's own plan and PERSISTED it to
 * merchantConfig/{uid}.planTier, so a stale-FREE member on a paid workspace wrote a
 * wrong tier that outlived the request. The fix threads req → getUserPlan(userId,{workspaceId}).
 *
 * FAILS pre-fix: member resolves 'free' → persisted planTier 'free', not the owner's
 * 'enterprise'.
 */

const mockStore = { users: {}, workspaces: {}, merchantConfig: {} };

function ensure(col) { mockStore[col] = mockStore[col] || {}; return mockStore[col]; }
function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') throw new Error('invalid documentPath');
    return {
        id,
        get: async () => ({ exists: !!(mockStore[col] && id in mockStore[col]), data: () => (mockStore[col] || {})[id] }),
        set: async (v, opts) => { const s = ensure(col); s[id] = opts && opts.merge ? { ...(s[id] || {}), ...v } : v; },
        update: async (v) => { const s = ensure(col); s[id] = { ...(s[id] || {}), ...v }; },
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

jest.mock('../utils/urlHeuristics', () => ({ classifyUrls: jest.fn() }));
jest.mock('../utils/generateMerchantConfig', () => ({ writeMerchantConfig: jest.fn() }));

const merchantConfigRoutes = require('../routes/merchantConfigRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; mockStore.merchantConfig = {}; });

describe('V-11 merchantConfigRoutes: persisted planTier resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace persists the owner tier', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };
        // Pre-create the config doc so the update branch runs (returns the persisted planTier).
        mockStore.merchantConfig['wsMember'] = { merchantId: 'wsMember', planTier: 'free' };

        const req = {
            method: 'POST', normalizedPath: '/merchant-config', path: '/merchant-config',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {}, body: {},
        };
        const res = mockRes();
        const handled = await merchantConfigRoutes.handle(req, res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        // pre-fix: member resolves 'free' → persisted planTier 'free'.
        expect(res._body.data.planTier).toBe('enterprise');
        expect(mockStore.merchantConfig['wsMember'].planTier).toBe('enterprise');
    });
});
