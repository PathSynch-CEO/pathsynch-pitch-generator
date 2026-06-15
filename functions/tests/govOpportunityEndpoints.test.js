'use strict';

// ── Firebase Admin Mock ──────────────────────────────────────────────────────

let mockDocData = null;
let mockDocExists = true;
let mockQueryDocs = [];

const mockGet = jest.fn(async () => ({
    exists: mockDocExists,
    id: 'doc-123',
    data: () => mockDocData,
    docs: mockQueryDocs,
    empty: mockQueryDocs.length === 0,
}));
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({
    get: mockGet,
    update: mockUpdate,
    set: mockSet,
}));
const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockStartAfter = jest.fn().mockReturnThis();
const mockCollection = jest.fn(() => ({
    doc: mockDoc,
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    startAfter: mockStartAfter,
    get: mockGet,
}));

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: mockCollection,
    }), {
        FieldValue: {
            serverTimestamp: () => new Date(),
            increment: (n) => ({ _increment: n }),
        },
    }),
    initializeApp: jest.fn(),
}));

const govcaptureRoutes = require('../routes/govcaptureRoutes');

// ── Mock Request/Response ────────────────────────────────────────────────────

function mockReq(overrides = {}) {
    return {
        method: 'GET',
        path:   '/govcapture/opportunities',
        userId: 'user-123',
        body:   {},
        params: {},
        query:  {},
        headers: {},
        ...overrides,
    };
}

function mockRes() {
    const res = {
        _status: 200,
        _body: null,
        status: jest.fn(function(c) { res._status = c; return res; }),
        json: jest.fn(function(b) { res._body = b; return res; }),
    };
    return res;
}

// ── Setup ────────────────────────────────────────────────────────────────────

const origEnv = process.env.GOVCAPTURE_ENABLED;

beforeEach(() => {
    process.env.GOVCAPTURE_ENABLED = 'true';
    jest.clearAllMocks();
    mockDocData = null;
    mockDocExists = true;
    mockQueryDocs = [];
});

afterEach(() => {
    if (origEnv !== undefined) process.env.GOVCAPTURE_ENABLED = origEnv;
    else delete process.env.GOVCAPTURE_ENABLED;
});

// ── Opportunity List ─────────────────────────────────────────────────────────

describe('GET /api/govcapture/opportunities', () => {
    test('missing profileId → 400', async () => {
        const req = mockReq({ query: {} });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(400);
        expect(res._body.error).toContain('profileId');
    });

    test('non-existent profile → 404', async () => {
        mockDocExists = false;
        const req = mockReq({ query: { profileId: 'nonexistent' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(404);
    });

    test('non-owner profile → 403', async () => {
        mockDocData = { userId: 'other-user', status: 'active' };
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });

    test('archived profile → 409', async () => {
        mockDocData = { userId: 'user-123', status: 'archived' };
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(409);
    });

    test('empty results → success with empty array', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) }) // profile
            .mockResolvedValueOnce({ docs: [], empty: true }); // opportunities
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(res._body.opportunities).toEqual([]);
        expect(res._body.hasMore).toBe(false);
        expect(res._body.nextCursor).toBeNull();
    });

    test('returns opportunities with id on each', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({
                docs: [
                    { id: 'opp-1', data: () => ({ title: 'RFID Tracking', fit: { score: 85 }, createdAt: new Date() }) },
                    { id: 'opp-2', data: () => ({ title: 'Supply Chain', fit: { score: 60 }, createdAt: new Date() }) },
                ],
            });
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(res._body.opportunities).toHaveLength(2);
        expect(res._body.opportunities[0].id).toBe('opp-1');
        expect(res._body.opportunities[1].id).toBe('opp-2');
    });

    test('in-memory fitLabel filter works', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({
                docs: [
                    { id: 'opp-1', data: () => ({ fit: { label: 'Strong Fit' }, createdAt: new Date() }) },
                    { id: 'opp-2', data: () => ({ fit: { label: 'Poor Fit' }, createdAt: new Date() }) },
                ],
            });
        const req = mockReq({ query: { profileId: 'p1', fitLabel: 'Strong Fit' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.opportunities).toHaveLength(1);
        expect(res._body.opportunities[0].id).toBe('opp-1');
    });

    test('in-memory pursuitStatus filter works', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({
                docs: [
                    { id: 'opp-1', data: () => ({ pursuitStatus: 'pursuing', createdAt: new Date() }) },
                    { id: 'opp-2', data: () => ({ pursuitStatus: 'new', createdAt: new Date() }) },
                ],
            });
        const req = mockReq({ query: { profileId: 'p1', pursuitStatus: 'pursuing' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.opportunities).toHaveLength(1);
    });

    test('archived=true returns only archived', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ docs: [] });
        const req = mockReq({ query: { profileId: 'p1', archived: 'true' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        // Verify the where clause was called with archived=true
        expect(mockWhere).toHaveBeenCalledWith('archived', '==', true);
    });

    test('archived omitted defaults to false', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ docs: [] });
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(mockWhere).toHaveBeenCalledWith('archived', '==', false);
    });

    test('pagination: hasMore true when extra doc exists', async () => {
        const docs = Array.from({ length: 26 }, (_, i) => ({
            id: `opp-${i}`, data: () => ({ createdAt: new Date(), title: `Opp ${i}` }),
        }));
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ docs });
        const req = mockReq({ query: { profileId: 'p1', limit: '25' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.hasMore).toBe(true);
        expect(res._body.opportunities).toHaveLength(25);
        expect(res._body.nextCursor).not.toBeNull();
    });

    test('stable cursor contains createdAt + docId', async () => {
        const now = new Date();
        const docs = Array.from({ length: 26 }, (_, i) => ({
            id: `opp-${i}`, data: () => ({ createdAt: now, title: `Opp ${i}` }),
        }));
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ docs });
        const req = mockReq({ query: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        const cursor = JSON.parse(res._body.nextCursor);
        expect(cursor).toHaveProperty('createdAt');
        expect(cursor).toHaveProperty('docId');
    });
});

// ── Opportunity Single Fetch ─────────────────────────────────────────────────

describe('GET /api/govcapture/opportunities/:oppId', () => {
    test('returns full doc with id', async () => {
        mockDocData = { userId: 'user-123', title: 'RFID System' };
        const req = mockReq({ path: '/govcapture/opportunities/opp-1', params: { oppId: 'opp-1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(res._body.opportunity.id).toBe('doc-123');
        expect(res._body.opportunity.title).toBe('RFID System');
    });

    test('non-owner → 403', async () => {
        mockDocData = { userId: 'other-user' };
        const req = mockReq({ path: '/govcapture/opportunities/opp-1', params: { oppId: 'opp-1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });

    test('not found → 404', async () => {
        mockDocExists = false;
        const req = mockReq({ path: '/govcapture/opportunities/opp-1', params: { oppId: 'opp-1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(404);
    });
});

// ── Status Update ────────────────────────────────────────────────────────────

describe('PUT /api/govcapture/opportunities/:oppId/status', () => {
    test('valid status → updates', async () => {
        mockDocData = { userId: 'user-123', pursuitStatus: 'new' };
        mockGet
            .mockResolvedValueOnce({ exists: true, id: 'opp-1', data: () => mockDocData })
            .mockResolvedValueOnce({ exists: true, id: 'opp-1', data: () => ({ ...mockDocData, pursuitStatus: 'pursuing' }) });

        const req = mockReq({
            method: 'PUT', path: '/govcapture/opportunities/opp-1/status',
            params: { oppId: 'opp-1' }, body: { pursuitStatus: 'pursuing' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ pursuitStatus: 'pursuing' }));
    });

    test('invalid status → 400', async () => {
        mockDocData = { userId: 'user-123' };
        const req = mockReq({
            method: 'PUT', path: '/govcapture/opportunities/opp-1/status',
            params: { oppId: 'opp-1' }, body: { pursuitStatus: 'invalid_status' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(400);
    });

    test('non-owner → 403', async () => {
        mockDocData = { userId: 'other-user' };
        const req = mockReq({
            method: 'PUT', path: '/govcapture/opportunities/opp-1/status',
            params: { oppId: 'opp-1' }, body: { pursuitStatus: 'pursuing' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });
});

// ── Archive ──────────────────────────────────────────────────────────────────

describe('POST /api/govcapture/opportunities/:oppId/archive', () => {
    test('sets archived + archivedAt + archivedReason', async () => {
        mockDocData = { userId: 'user-123', archived: false };
        const req = mockReq({
            method: 'POST', path: '/govcapture/opportunities/opp-1/archive',
            params: { oppId: 'opp-1' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            archived: true, archivedReason: 'manual',
        }));
    });

    test('already archived → 200 (idempotent)', async () => {
        mockDocData = { userId: 'user-123', archived: true };
        const req = mockReq({
            method: 'POST', path: '/govcapture/opportunities/opp-1/archive',
            params: { oppId: 'opp-1' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(200);
    });

    test('non-owner → 403', async () => {
        mockDocData = { userId: 'other-user' };
        const req = mockReq({
            method: 'POST', path: '/govcapture/opportunities/opp-1/archive',
            params: { oppId: 'opp-1' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });
});

// ── Checklist GET ────────────────────────────────────────────────────────────

describe('GET /api/govcapture/checklist/:profileId', () => {
    test('returns default questions when no doc exists', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) }) // profile
            .mockResolvedValueOnce({ exists: false }); // checklist
        const req = mockReq({ path: '/govcapture/checklist/p1', params: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        expect(res._body.checklist.questions).toHaveLength(5);
        expect(res._body.checklist.questions[0].type).toBe('default');
        expect(res._body.checklist.questions[0].active).toBe(true);
    });

    test('returns stored questions when doc exists', async () => {
        const storedQuestions = [{ id: 'q1', text: 'Budget?', type: 'default', active: true }];
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ exists: true, id: 'p1', data: () => ({ questions: storedQuestions }) });
        const req = mockReq({ path: '/govcapture/checklist/p1', params: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.checklist.questions).toEqual(storedQuestions);
    });

    test('non-owner → 403', async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'other-user' }) });
        const req = mockReq({ path: '/govcapture/checklist/p1', params: { profileId: 'p1' } });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });
});

// ── Checklist PUT ────────────────────────────────────────────────────────────

describe('PUT /api/govcapture/checklist/:profileId', () => {
    test('preserves default questions when only custom sent', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) }) // profile
            .mockResolvedValueOnce({ exists: false }); // checklist (new)
        const req = mockReq({
            method: 'PUT', path: '/govcapture/checklist/p1',
            params: { profileId: 'p1' },
            body: { questions: [{ id: 'custom1', text: 'Custom question?', type: 'custom', active: true }] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._body.success).toBe(true);
        // Should have 5 defaults + 1 custom = 6
        expect(res._body.checklist.questions).toHaveLength(6);
        const defaults = res._body.checklist.questions.filter(q => q.type === 'default');
        expect(defaults).toHaveLength(5);
    });

    test('default questions can be deactivated but not deleted', async () => {
        mockGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) })
            .mockResolvedValueOnce({ exists: true }); // existing checklist
        const req = mockReq({
            method: 'PUT', path: '/govcapture/checklist/p1',
            params: { profileId: 'p1' },
            body: { questions: [{ id: 'q1', text: 'Budget?', type: 'default', active: false }] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        const q1 = res._body.checklist.questions.find(q => q.id === 'q1');
        expect(q1).toBeTruthy();
        expect(q1.active).toBe(false);
        // All 5 defaults still present
        const defaults = res._body.checklist.questions.filter(q => q.type === 'default');
        expect(defaults).toHaveLength(5);
    });

    test('max 20 questions → 400', async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) });
        const questions = Array.from({ length: 16 }, (_, i) => ({
            id: `custom${i}`, text: `Q${i}`, type: 'custom', active: true,
        }));
        // 5 defaults restored + 16 custom = 21 > 20
        const req = mockReq({
            method: 'PUT', path: '/govcapture/checklist/p1',
            params: { profileId: 'p1' },
            body: { questions },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(400);
        expect(res._body.error).toContain('20');
    });

    test('text > 500 chars → 400', async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-123', status: 'active' }) });
        const req = mockReq({
            method: 'PUT', path: '/govcapture/checklist/p1',
            params: { profileId: 'p1' },
            body: { questions: [{ id: 'c1', text: 'X'.repeat(501), type: 'custom' }] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(400);
    });

    test('non-owner → 403', async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'other-user' }) });
        const req = mockReq({
            method: 'PUT', path: '/govcapture/checklist/p1',
            params: { profileId: 'p1' },
            body: { questions: [] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });
});

// ── Route Presence ───────────────────────────────────────────────────────────

describe('govcapture — all 6 new endpoints present', () => {
    test('endpoint routes exist in file', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain("'/govcapture/opportunities'");
        expect(content).toContain("'/govcapture/opportunities/:oppId'");
        expect(content).toContain("'/govcapture/opportunities/:oppId/status'");
        expect(content).toContain("'/govcapture/opportunities/:oppId/archive'");
        expect(content).toContain("'/govcapture/checklist/:profileId'");
    });
});
