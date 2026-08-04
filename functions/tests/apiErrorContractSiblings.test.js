'use strict';

/**
 * Regression harness for the deferred NON-AUTH mis-ordered ApiError constructions in
 * the sibling route files (follow-up to PR #75 / PR #78).
 *
 * ApiError's real signature is (code, message, details) and it derives the HTTP status
 * from ErrorStatus[code]. The routes constructed it in the WRONG order —
 *   new ApiError('Human message', 404, ErrorCodes.NOT_FOUND)
 * — so a human message landed in the `code` slot, ErrorStatus['Human message'] is
 * undefined, and the intended 400/403/404/429 collapsed to 500.
 *
 * These tests exercise the corrected sites through the real router + real errorHandler
 * and assert the INTENDED status. Each fails against the pre-fix source for the right
 * reason (it returned 500). Verified by stashing only the source edits, running, and
 * observing the 500s, then restoring.
 *
 * Uses a STRICT firebase-admin mock (.doc(falsy) THROWS like the real Admin SDK) — NOT
 * the permissive shared __mocks__ — modelled on tests/precallFormRoutes.test.js and
 * tests/investorUpdatesNullUserId.test.js.
 */

const mockStore = { users: {}, pitches: {}, precallBriefs: {}, websiteVisitors: {}, __sizes: {} };

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') {
        throw new Error('Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.');
    }
    return {
        id,
        get: async () => ({
            exists: !!(mockStore[col] && id in mockStore[col]),
            data: () => (mockStore[col] || {})[id],
        }),
        set: async () => {}, update: async () => {}, delete: async () => {},
        collection: (sub) => mockCollection(`${col}/${id}/${sub}`),
    };
}
function mockCollection(name) {
    const q = {
        where() { return q; }, orderBy() { return q; }, limit() { return q; },
        get: async () => {
            const size = mockStore.__sizes[name] || 0;
            return { size, docs: [], empty: size === 0, forEach() {} };
        },
    };
    return Object.assign(q, { doc: (id) => mockDoc(name, id), add: async () => ({ id: 'x' }) });
}

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(() => ({ collection: (n) => mockCollection(n) }), {
        FieldValue: { serverTimestamp: () => new Date(), increment: (n) => ({ _increment: n }) },
        Timestamp: { fromDate: (d) => d, now: () => new Date() },
    }),
}));

// Isolate the route files from their heavy service dependencies.
jest.mock('../services/salesIntelligence', () => ({
    getDashboard: jest.fn(),
    analyzeProspect: jest.fn(),
    intentHunter: {
        recordSignal: jest.fn(),
        bulkImportSignals: jest.fn(),
        getProspectTimeline: jest.fn(async () => null),
    },
    icpRefiner: {
        recordDealOutcome: jest.fn(),
        getIcpDefinition: jest.fn(async () => ({})),
        saveIcpDefinition: jest.fn(async () => ({ success: false, error: 'downstream write failed' })),
    },
    linkedInScorer: { scoreProfile: jest.fn(), scoreProfiles: jest.fn() },
}));
jest.mock('../services/modelRouter', () => ({}));
jest.mock('../services/contactEnricher', () => ({}));
jest.mock('../services/googlePlaces', () => ({}));
jest.mock('../services/geminiClientV2', () => ({}));
jest.mock('../services/briefPdfGenerator', () => ({ generateBriefPdf: jest.fn() }));
jest.mock('../services/agentClient', () => ({ invokeAgentsParallel: jest.fn() }));
jest.mock('../services/linkedinResearchAgent', () => ({ researchContact: jest.fn(), isConfigured: () => false }));
jest.mock('../services/newsIntelligenceAgent', () => ({ researchNews: jest.fn() }));
jest.mock('../intelligence', () => ({ generateIntelligentBrief: jest.fn() }));
jest.mock('../utils/visitorConfidence', () => ({ buildConfidenceFields: jest.fn(), isKnownISP: jest.fn() }));
jest.mock('../middleware/planGate', () => ({ getUserPlan: jest.fn(async () => 'starter') }));
jest.mock('../services/workspaceService', () => ({ getWorkspaceForUser: jest.fn(async () => null) }));
jest.mock('axios', () => ({}));

const salesIntelligenceRoutes = require('../routes/salesIntelligenceRoutes');
const landingPageRoutes = require('../routes/landingPageRoutes');
const precallBriefRoutes = require('../routes/precallBriefRoutes');
const visitorRoutes = require('../routes/visitorRoutes');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}
const req = (method, path, { userId = 'u1', query = {}, params = {}, body = {} } = {}) => ({
    method, normalizedPath: path, path, userId, query, params, body,
});

beforeEach(() => {
    mockStore.users = {};
    mockStore.pitches = {};
    mockStore.precallBriefs = {};
    mockStore.websiteVisitors = {};
    mockStore.__sizes = {};
});

describe('salesIntelligenceRoutes — non-auth ApiError intended status (was 500)', () => {
    test('POST /sales-intelligence/analyze with no company/email → 400 VALIDATION_ERROR', async () => {
        const res = mockRes();
        const handled = await salesIntelligenceRoutes.handle(
            req('POST', '/sales-intelligence/analyze', { body: {} }), res);
        expect(handled).toBe(true);
        expect(res._status).toBe(400);
        expect(res._body.code).toBe('VALIDATION_ERROR');
    });

    test('GET intent timeline for unknown prospect → 404 NOT_FOUND', async () => {
        const res = mockRes();
        await salesIntelligenceRoutes.handle(
            req('GET', '/sales-intelligence/intent/prospect/p1/timeline', { params: { prospectId: 'p1' } }), res);
        expect(res._status).toBe(404);
        expect(res._body.code).toBe('NOT_FOUND');
    });

    test('PUT /sales-intelligence/icp/definition save failure → 500 with proper INTERNAL_ERROR body (not the raw message in the code slot)', async () => {
        const res = mockRes();
        await salesIntelligenceRoutes.handle(
            req('PUT', '/sales-intelligence/icp/definition', { body: { some: 'icp' } }), res);
        expect(res._status).toBe(500);
        // Pre-fix, the human string sat in the code slot → body.code was the message and
        // body.error was "500". The corrected (code, message) form fixes the body shape.
        expect(res._body.code).toBe('INTERNAL_ERROR');
        expect(res._body.error).toBe('downstream write failed');
    });
});

describe('landingPageRoutes — non-auth ApiError intended status (was 500)', () => {
    test('POST /landing-pages/generate with no pitchId → 400 VALIDATION_ERROR', async () => {
        const res = mockRes();
        await landingPageRoutes.handle(req('POST', '/landing-pages/generate', { body: {} }), res);
        expect(res._status).toBe(400);
        expect(res._body.code).toBe('VALIDATION_ERROR');
    });

    test('pitch not found → 404 NOT_FOUND', async () => {
        const res = mockRes();
        await landingPageRoutes.handle(
            req('POST', '/landing-pages/generate', { body: { pitchId: 'missing' } }), res);
        expect(res._status).toBe(404);
        expect(res._body.code).toBe('NOT_FOUND');
    });

    test('pitch owned by another user → 403 AUTHORIZATION_ERROR', async () => {
        mockStore.pitches['p1'] = { userId: 'someone-else' };
        const res = mockRes();
        await landingPageRoutes.handle(
            req('POST', '/landing-pages/generate', { userId: 'u1', body: { pitchId: 'p1' } }), res);
        expect(res._status).toBe(403);
        expect(res._body.code).toBe('AUTHORIZATION_ERROR');
    });

    test('at monthly/total limit → 429 RATE_LIMIT (was RATE_LIMITED → undefined → 500)', async () => {
        mockStore.users['u1'] = { tier: 'free' };
        mockStore.pitches['p1'] = { userId: 'u1' };
        mockStore.__sizes['landingPages'] = 99999; // >> free limit (2)
        const res = mockRes();
        await landingPageRoutes.handle(
            req('POST', '/landing-pages/generate', { userId: 'u1', body: { pitchId: 'p1' } }), res);
        expect(res._status).toBe(429);
        expect(res._body.code).toBe('RATE_LIMIT');
    });
});

describe('precallBriefRoutes — non-auth ApiError intended status (was 500)', () => {
    test('GET /precall-briefs/:id not found → 404 NOT_FOUND', async () => {
        const res = mockRes();
        await precallBriefRoutes.handle(
            req('GET', '/precall-briefs/b1', { params: { id: 'b1' } }), res);
        expect(res._status).toBe(404);
        expect(res._body.code).toBe('NOT_FOUND');
    });

    test('GET /precall-briefs/:id owned by another user → 403 AUTHORIZATION_ERROR', async () => {
        mockStore.precallBriefs['b1'] = { userId: 'someone-else' };
        const res = mockRes();
        await precallBriefRoutes.handle(
            req('GET', '/precall-briefs/b1', { userId: 'u1', params: { id: 'b1' } }), res);
        expect(res._status).toBe(403);
        expect(res._body.code).toBe('AUTHORIZATION_ERROR');
    });

    test('POST /precall-briefs/generate at limit → 429 RATE_LIMIT (was RATE_LIMITED → undefined → 500)', async () => {
        mockStore.users['u1'] = { tier: 'starter' };
        mockStore.__sizes['precallBriefs'] = 99999; // >> starter limit (3)
        const res = mockRes();
        await precallBriefRoutes.handle(
            req('POST', '/precall-briefs/generate', { userId: 'u1', body: { prospectCompany: 'Acme' } }), res);
        expect(res._status).toBe(429);
        expect(res._body.code).toBe('RATE_LIMIT');
    });
});

describe('visitorRoutes — non-auth ApiError intended status (was 500)', () => {
    test('PUT /visitors/:id not found → 404 NOT_FOUND', async () => {
        const res = mockRes();
        await visitorRoutes.handle(
            req('PUT', '/visitors/v1', { params: { id: 'v1' }, body: { status: 'x' } }), res);
        expect(res._status).toBe(404);
        expect(res._body.code).toBe('NOT_FOUND');
    });

    test('PUT /visitors/:id owned by another user → 403 AUTHORIZATION_ERROR', async () => {
        mockStore.websiteVisitors['v1'] = { userId: 'someone-else' };
        const res = mockRes();
        await visitorRoutes.handle(
            req('PUT', '/visitors/v1', { userId: 'u1', params: { id: 'v1' }, body: { status: 'x' } }), res);
        expect(res._status).toBe(403);
        expect(res._body.code).toBe('AUTHORIZATION_ERROR');
    });
});

// Root-cause contract guard: ApiError is (code, message, details); status derives from the code.
describe('ApiError argument-order contract (root cause of the sibling 500s)', () => {
    const { ApiError, ErrorCodes } = require('../middleware/errorHandler');

    test('correct order (code first) yields the intended HTTP status', () => {
        expect(new ApiError(ErrorCodes.VALIDATION_ERROR, 'bad').status).toBe(400);
        expect(new ApiError(ErrorCodes.AUTHORIZATION_ERROR, 'nope').status).toBe(403);
        expect(new ApiError(ErrorCodes.NOT_FOUND, 'gone').status).toBe(404);
        expect(new ApiError(ErrorCodes.RATE_LIMIT, 'slow down').status).toBe(429);
        expect(new ApiError(ErrorCodes.INTERNAL_ERROR, 'boom').status).toBe(500);
    });

    test('the OLD mis-ordered forms (message first) collapse to 500 — the exact bug', () => {
        expect(new ApiError('Pitch not found', 404, ErrorCodes.NOT_FOUND).status).toBe(500);
        expect(new ApiError('Access denied', 403, ErrorCodes.FORBIDDEN).status).toBe(500);
        expect(new ApiError('You have reached your monthly limit', 403, ErrorCodes.RATE_LIMITED).status).toBe(500);
    });

    test('the invalid codes the reversed calls referenced do not exist', () => {
        expect(ErrorCodes.FORBIDDEN).toBeUndefined();
        expect(ErrorCodes.RATE_LIMITED).toBeUndefined();
    });
});
