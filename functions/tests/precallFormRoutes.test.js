'use strict';

/**
 * Regression harness for the production 500s on the pre-call form GET routes:
 *   GET /precall-forms?limit=50   → was 500, should be 200 for an Enterprise user
 *   GET /precall-forms/defaults   → was 500, should be 200 for an Enterprise user
 *
 * Two compounding defects lived in requireEnterprise() in precallFormRoutes.js:
 *
 *   1. TRIGGER — it resolved the plan from userData.tier ONLY. `tier` is set to a
 *      default at account creation and never updated by Stripe (which writes the real
 *      plan to subscription.plan), so a genuine Enterprise user failed the gate and
 *      entered the error path. The canonical planGate.getUserPlan() chain fixes this.
 *
 *   2. ERROR-MAPPING — the thrown ApiError used the reversed argument order
 *      (message, status, code). ApiError is (code, message, details) and derives its
 *      HTTP status from ErrorStatus[code]; a human message is not a key, so the intended
 *      403 collapsed to 500.
 *
 * These tests fail against the pre-fix implementation for the RIGHT reasons:
 *   - the two GETs returned 500 (both defects), and
 *   - the genuine non-Enterprise rejection returned 500 instead of 403 (defect #2).
 */

// Minimal firestore mock — the only reads on these paths are users/{uid} gets
// (requireEnterprise's own read + planGate.getUserPlan's read).
const mockStore = { users: {} };

function mockDoc(col, id) {
    return {
        id,
        get: async () => ({
            exists: !!(mockStore[col] && id in mockStore[col]),
            data: () => (mockStore[col] || {})[id],
        }),
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
        Timestamp: { fromDate: (d) => d, now: () => new Date() },
    }),
}));

// Isolate the route from the real service + email deps.
jest.mock('../services/precallForm', () => ({
    getDefaultQuestions: jest.fn(() => [{ id: 'q1', label: 'Default question' }]),
    listForms: jest.fn(async () => [{ id: 'form1', prospectName: 'Acme' }]),
    createForm: jest.fn(async () => ({ id: 'form1' })),
    getForm: jest.fn(async () => null),
    updateFormQuestions: jest.fn(async () => {}),
    markFormSent: jest.fn(async () => {}),
    getFormByShareId: jest.fn(async () => null),
    submitResponses: jest.fn(async () => ({})),
    mapResponsesToPitchData: jest.fn(() => ({})),
}));
jest.mock('../services/email', () => ({}));

const precallFormRoutes = require('../routes/precallFormRoutes');
const precallForm = require('../services/precallForm');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        setHeader() { return res; }, send() { res.headersSent = true; return res; },
    };
    return res;
}
const req = (path, userId, query = {}) => ({
    method: 'GET', normalizedPath: path, path, userId, query, params: {}, body: {},
});

beforeEach(() => { mockStore.users = {}; });

describe('GET /precall-forms — the reported production 500s', () => {
    test('GET /precall-forms?limit=50 → 200 for an Enterprise user (plan in subscription.plan, tier stale)', async () => {
        // The exact production shape: Stripe wrote enterprise to subscription.plan, but the
        // account-creation `tier` field is stale. Pre-fix this returned 500.
        mockStore.users['u1'] = { tier: 'free', subscription: { plan: 'enterprise' } };
        const res = mockRes();
        const handled = await precallFormRoutes.handle(req('/precall-forms', 'u1', { limit: '50' }), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        expect(res._body.success).toBe(true);
        expect(Array.isArray(res._body.data)).toBe(true);
        // Confirm the query limit flowed through (parseInt('50')).
        expect(precallForm.listForms).toHaveBeenCalledWith('u1', expect.objectContaining({ limit: 50 }));
    });

    test('GET /precall-forms/defaults → 200 for an Enterprise user', async () => {
        mockStore.users['u1'] = { tier: 'free', subscription: { plan: 'enterprise' } };
        const res = mockRes();
        const handled = await precallFormRoutes.handle(req('/precall-forms/defaults', 'u1'), res);

        expect(handled).toBe(true);
        expect(res._status).toBe(200);
        expect(res._body.success).toBe(true);
        expect(res._body.data.questions).toEqual([{ id: 'q1', label: 'Default question' }]);
    });

    test('Enterprise resolved via the top-level plan field also succeeds', async () => {
        mockStore.users['u2'] = { tier: 'starter', plan: 'enterprise' };
        const res = mockRes();
        await precallFormRoutes.handle(req('/precall-forms', 'u2', { limit: '50' }), res);
        expect(res._status).toBe(200);
    });
});

describe('The actual failure condition returns its intended status, not 500', () => {
    test('non-Enterprise user → 403 (was 500 pre-fix) with a proper error body', async () => {
        mockStore.users['u3'] = { tier: 'starter', plan: 'starter', subscription: { plan: 'growth' } };
        const res = mockRes();
        await precallFormRoutes.handle(req('/precall-forms', 'u3', { limit: '50' }), res);

        expect(res._status).toBe(403);
        expect(res._body.success).toBe(false);
        expect(res._body.code).toBe('AUTHORIZATION_ERROR');
        expect(res._body.error).toBe('Pre-Call Forms require Enterprise plan');
    });

    test('non-Enterprise user hitting /defaults → 403 (shared requireEnterprise path)', async () => {
        mockStore.users['u3'] = { tier: 'starter' };
        const res = mockRes();
        await precallFormRoutes.handle(req('/precall-forms/defaults', 'u3'), res);
        expect(res._status).toBe(403);
    });

    test('unauthenticated request → clean 401', async () => {
        const res = mockRes();
        await precallFormRoutes.handle(req('/precall-forms', null, { limit: '50' }), res);
        expect(res._status).toBe(401);
    });
});

// Root-cause contract guard: ApiError is (code, message, details); status derives from the code.
describe('ApiError argument-order contract (root cause of the precall-forms 500)', () => {
    const { ApiError, ErrorCodes } = require('../middleware/errorHandler');

    test('correct order (code first) yields the intended HTTP status', () => {
        expect(new ApiError(ErrorCodes.AUTHORIZATION_ERROR, 'Pre-Call Forms require Enterprise plan').status).toBe(403);
        expect(new ApiError(ErrorCodes.VALIDATION_ERROR, 'bad').status).toBe(400);
        expect(new ApiError(ErrorCodes.NOT_FOUND, 'gone').status).toBe(404);
        // EXPIRED (410) was added so the public expired-form route can express its intent
        // instead of an undefined code collapsing to 500.
        expect(new ApiError(ErrorCodes.EXPIRED, 'expired').status).toBe(410);
    });

    test('the OLD mis-ordered form (message first) collapses to 500 — the exact bug', () => {
        expect(new ApiError('Pre-Call Forms require Enterprise plan', 403, ErrorCodes.FORBIDDEN).status).toBe(500);
        expect(new ApiError('This form has expired', 410, ErrorCodes.EXPIRED).status).toBe(500);
    });
});
