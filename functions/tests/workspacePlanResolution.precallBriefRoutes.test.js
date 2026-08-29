'use strict';

/**
 * Workspace-aware plan resolution — routes/precallBriefRoutes.js (audit V-3).
 *
 * getUserTierAndCheckLimit() resolved the caller's own plan, so a stale-FREE member
 * on a paid workspace lost brief quota (and contact enrichment / custom library) on
 * their own tier. The fix threads req → getUserPlan(userId, { workspaceId }).
 *
 * FAILS pre-fix: member resolves 'free' → BRIEF_LIMITS.free = 3, not the owner's
 * Enterprise -1 (unlimited).
 */

const mockStore = { users: {}, workspaces: {}, precallBriefs: {} };

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
        where() { return q; }, orderBy() { return q; }, limit() { return q; }, offset() { return q; },
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

// Heavy generation deps are only used by the generate path, never the list path.
jest.mock('../services/contactEnricher', () => ({}));
jest.mock('../services/modelRouter', () => ({}));
jest.mock('../services/googlePlaces', () => ({}));
jest.mock('../services/geminiClientV2', () => ({}));
jest.mock('../services/briefPdfGenerator', () => ({ generateBriefPdf: jest.fn() }));
jest.mock('../services/agentClient', () => ({ invokeAgentsParallel: jest.fn() }));
jest.mock('../services/linkedinResearchAgent', () => ({ researchContact: jest.fn(), isConfigured: () => false }));
jest.mock('../services/newsIntelligenceAgent', () => ({ researchNews: jest.fn() }));
jest.mock('../intelligence', () => ({ generateIntelligentBrief: jest.fn() }));

const precallBriefRoutes = require('../routes/precallBriefRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; mockStore.precallBriefs = {}; });

describe('V-3 precallBriefRoutes: brief quota resolves the workspace owner plan', () => {
    test('stale-FREE member on an Enterprise workspace gets the owner unlimited limit (-1)', async () => {
        mockStore.users['wsMember'] = { tier: 'FREE' };
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const req = {
            method: 'GET', normalizedPath: '/precall-briefs', path: '/precall-briefs',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {},
        };
        const res = mockRes();
        const handled = await precallBriefRoutes.handle(req, res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        // pre-fix: member resolves 'free' → BRIEF_LIMITS.free = 3.
        expect(res._body.limits.limit).toBe(-1);
    });
});
