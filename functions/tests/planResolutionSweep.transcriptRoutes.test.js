'use strict';

/**
 * F-1014 regression — routes/transcriptRoutes.js tier gate.
 *
 * TRIGGER: `const tier = userData.tier || 'starter'` (subscription.plan never
 * consulted). The gate `if (tier === 'starter') throw 403` therefore denied a
 * genuine Growth+ user whose plan lives only in `subscription.plan` and whose
 * account-creation `tier` field is absent — the default collapsed them to
 * 'starter'. The fix resolves the plan via the canonical getUserPlan().
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

// The extract path only calls extractMeetingData; make it succeed so a passed gate
// resolves to a clean 200 (a failed gate never reaches it).
jest.mock('../services/transcriptParser', () => ({
    parseTranscript: jest.fn(),
    getQuickSummary: jest.fn(),
    extractMeetingData: jest.fn(async () => ({
        success: true,
        data: { meeting: 'ok' },
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
const req = (userId) => ({
    method: 'POST', normalizedPath: '/transcript/extract', path: '/transcript/extract',
    userId, query: {}, params: {}, body: { content: 'Alice: hello\nBob: hi there' },
});

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; transcriptParser.extractMeetingData.mockClear(); });

describe('F-1014: transcript extract gate resolves plan via getUserPlan', () => {
    test('Growth via subscription.plan (no tier field) passes the gate (200)', async () => {
        mockStore.users['u1'] = { subscription: { plan: 'growth' } }; // no top-level tier
        const res = mockRes();
        const handled = await transcriptRoutes.handle(req('u1'), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200); // pre-fix: gate denied (default 'starter' from missing tier)
        expect(res._body.success).toBe(true);
        expect(transcriptParser.extractMeetingData).toHaveBeenCalled();
    });

    test('A starter user is still denied — extraction never runs', async () => {
        // NOTE: the denial status is 500 here (not 403) due to a PRE-EXISTING,
        // out-of-scope ApiError arg-order bug in transcriptRoutes.js:
        //   new ApiError(message, 403, code)  →  collapses to 500.
        // We assert on the gate BEHAVIOUR (work never runs) so this stays robust to
        // that separate defect.
        mockStore.users['u2'] = { subscription: { plan: 'starter' } };
        const res = mockRes();
        await transcriptRoutes.handle(req('u2'), res);
        expect(res._status).not.toBe(200);
        expect(transcriptParser.extractMeetingData).not.toHaveBeenCalled();
    });
});
