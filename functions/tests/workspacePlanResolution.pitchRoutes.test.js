'use strict';

/**
 * Workspace-aware plan resolution — routes/pitchRoutes.js GET /pitch/styles (audit V-13).
 *
 * The tier-gated style list resolved the caller's own plan, so a stale-FREE member on
 * a paid workspace saw Growth+/Scale styles and the custom library as locked. The fix
 * threads req → getUserPlan(req.userId, { workspaceId }) → owner's plan.
 *
 * (This is also the LIVE handler for /pitch/styles: pitchRoutes.handle() at index.js:424
 * serves it and early-returns, so the old inline duplicate at index.js was dead code and
 * is removed in this PR — audit V-14.)
 *
 * FAILS pre-fix: member resolves 'free' → customLibrary.available false; owner is
 * Enterprise → available true.
 */

const mockStore = { users: {}, workspaces: {} };

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') throw new Error('invalid documentPath');
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

// pitchRoutes pulls in the generator + guards at load; only getAvailableStyles
// (from validators, left real) is used by the styles handler.
jest.mock('../api/pitchGenerator', () => ({}));
jest.mock('../middleware/validation', () => ({ validateBody: () => (req, res, next) => next && next() }));
jest.mock('../middleware/workspaceRoleGuard', () => ({
    requireRole: () => (req, res, next) => next && next(),
    canAccessResource: jest.fn(), scopeQueryToWorkspace: jest.fn(),
}));
jest.mock('../utils/pitchShare', () => ({ hashToken: jest.fn(), projectPublicFields: jest.fn() }));

const pitchRoutes = require('../routes/pitchRoutes');

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

describe('V-13 pitchRoutes: /pitch/styles resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace sees the owner tier + unlocked custom library', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const req = {
            method: 'GET', normalizedPath: '/pitch/styles', path: '/pitch/styles',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {},
        };
        const res = mockRes();
        const handled = await pitchRoutes.handle(req, res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        // pre-fix: member resolves 'free' → userTier 'free', customLibrary.available false.
        expect(res._body.data.userTier).toBe('enterprise');
        expect(res._body.data.customLibrary.available).toBe(true);
    });
});
