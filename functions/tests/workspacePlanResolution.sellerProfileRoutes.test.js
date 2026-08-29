'use strict';

/**
 * Workspace-aware plan resolution — routes/sellerProfileRoutes.js (audit V-6/V-7).
 *
 * GET/POST seller-profiles resolved the caller's own plan for the profile seat
 * limit, so a stale-FREE member on a paid workspace was under-provisioned. The fix
 * threads req → getUserPlan(userId, { workspaceId }) → owner's plan.
 *
 * FAILS pre-fix: member resolves 'free' → PROFILE_LIMITS['free'] undefined → limit 1
 * and tier 'free', not the owner's Enterprise (tier 'enterprise', limit 4).
 */

const mockStore = { users: {}, workspaces: {} };

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

jest.mock('../services/ragService', () => ({ ingestDocument: jest.fn() }));

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

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; });

describe('V-6 sellerProfileRoutes: profile seat limit resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace reports the owner tier + limit', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE', sellerProfiles: [] };  // sellerProfiles set → no legacy migration path
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const req = {
            method: 'GET', normalizedPath: '/seller-profiles', path: '/seller-profiles',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {},
        };
        const res = mockRes();
        const handled = await sellerProfileRoutes.handle(req, res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        // pre-fix: member resolves 'free' → tier 'free', limit 1.
        expect(res._body.data.tier).toBe('enterprise');
        expect(res._body.data.limit).toBe(4);
    });
});
