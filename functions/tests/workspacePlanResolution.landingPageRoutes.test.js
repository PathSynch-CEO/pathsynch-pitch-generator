'use strict';

/**
 * Workspace-aware plan resolution — routes/landingPageRoutes.js (audit V-2).
 *
 * getUserTierAndCheckLimit() resolved the caller's own plan, so a stale-FREE
 * member on a paid workspace was quota-capped (and badge-gated) on their own tier.
 * The fix threads req → getUserPlan(userId, { workspaceId }) → owner's plan.
 *
 * FAILS pre-fix: without workspaceId the member resolves 'free' → limit 2, not the
 * owner's Enterprise -1 (unlimited).
 */

const mockStore = { users: {}, workspaces: {}, landingPages: {} };

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
        Timestamp: { fromDate: (d) => d, now: () => new Date() },
    }),
}));

const landingPageRoutes = require('../routes/landingPageRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; mockStore.landingPages = {}; });

describe('V-2 landingPageRoutes: page quota resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace gets the owner unlimited limit (-1)', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const req = {
            method: 'GET', normalizedPath: '/landing-pages', path: '/landing-pages',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {},
        };
        const res = mockRes();
        const handled = await landingPageRoutes.handle(req, res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        // pre-fix: member resolves 'free' → LANDING_PAGE_LIMITS.free = 2.
        expect(res._body.limits.limit).toBe(-1);
    });
});
