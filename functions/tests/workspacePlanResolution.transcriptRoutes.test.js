'use strict';

/**
 * Workspace-aware plan resolution — routes/transcriptRoutes.js (audit V-4/V-5).
 *
 * The extract/leave-behind gates resolved the caller's own plan and 403 when
 * tier === 'starter'. A workspace MEMBER on the starter tier was denied even when
 * the workspace OWNER is Growth+. The fix threads req → getUserPlan(userId,{workspaceId}).
 *
 * NOTE: this gate keys specifically on 'starter'. A stale 'FREE' value resolves to
 * 'free' (≠ 'starter') and is NOT blocked by this gate, so 'starter' is the
 * entitlement-relevant low tier here; the member is modeled at starter with a Growth
 * owner. FAILS pre-fix: member resolves 'starter' → 403; post-fix resolves 'growth' → 200.
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

jest.mock('../services/transcriptParser', () => ({
    parseTranscript: jest.fn(),
    getQuickSummary: jest.fn(),
    extractMeetingData: jest.fn(async () => ({
        success: true, data: { meeting: 'ok' },
        metadata: { format: 'zoom', speakerCount: 2, entryCount: 10, tokensUsed: 100 },
    })),
}));

const transcriptRoutes = require('../routes/transcriptRoutes');
const transcriptParser = require('../services/transcriptParser');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; transcriptParser.extractMeetingData.mockClear(); });

describe('V-4 transcriptRoutes: extract gate resolves the workspace owner plan', () => {
    test('starter member on a Growth workspace passes the gate (200)', async () => {
        mockStore.users['wsMember'] = { subscription: { plan: 'starter' } };   // member's own tier
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'growth' } };

        const req = {
            method: 'POST', normalizedPath: '/transcript/extract', path: '/transcript/extract',
            userId: 'wsMember', workspaceId: 'wsPaid', query: {}, params: {},
            body: { content: 'Alice: hello\nBob: hi there' },
        };
        const res = mockRes();
        const handled = await transcriptRoutes.handle(req, res);

        expect(handled).toBe(true);
        // pre-fix: member resolves 'starter' → gate throws → extraction never runs.
        expect(res._status).toBe(200);
        expect(transcriptParser.extractMeetingData).toHaveBeenCalled();
    });
});
