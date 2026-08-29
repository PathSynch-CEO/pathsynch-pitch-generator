'use strict';

/**
 * Workspace-aware plan resolution — routes/precallFormRoutes.js (audit V-1).
 *
 * requireEnterprise() resolved the caller's own plan, so a workspace MEMBER whose
 * users/{uid} doc carries the stale signup tier 'FREE' was 403'd out of an
 * Enterprise workspace's Pre-Call Forms. The fix threads req and resolves the
 * workspace OWNER's plan via getUserPlan(userId, { workspaceId }).
 *
 * This test FAILS against the pre-fix code: without the workspaceId, the member
 * resolves to 'free' and requireEnterprise throws 403 → status !== 200.
 */

const mockStore = { users: {}, workspaces: {} };

function ensure(col) { mockStore[col] = mockStore[col] || {}; return mockStore[col]; }
function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') {
        throw new Error('Value for argument "documentPath" is not a valid resource path.');
    }
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

jest.mock('../services/precallForm', () => ({ getDefaultQuestions: () => [] }));
jest.mock('../services/email', () => ({}));

const precallFormRoutes = require('../routes/precallFormRoutes');

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

describe('V-1 precallFormRoutes: Enterprise gate resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace passes the gate (200)', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };                 // stale signup tier
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const req = {
            method: 'GET', normalizedPath: '/precall-forms/defaults', path: '/precall-forms/defaults',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {}, body: {},
        };
        const res = mockRes();
        const handled = await precallFormRoutes.handle(req, res);

        expect(handled).toBe(true);
        // pre-fix: getUserPlan('wsMember') → 'free' → requireEnterprise throws 403.
        expect(res._status).toBe(200);
        expect(res._body.success).toBe(true);
    });

    test('fail-soft: stale-FREE member with NO workspace context stays denied', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };
        const req = {
            method: 'GET', normalizedPath: '/precall-forms/defaults', path: '/precall-forms/defaults',
            userId: 'wsMember', query: {}, params: {}, body: {},   // no workspaceId
        };
        const res = mockRes();
        await precallFormRoutes.handle(req, res);
        expect(res._status).not.toBe(200);   // resolver did not run → caller's own plan
    });
});
