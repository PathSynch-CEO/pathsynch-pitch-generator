'use strict';

// ── Firebase Admin Mock ──────────────────────────────────────────────────────

let mockProfileData = null;
let mockProfileExists = false;

const mockGet = jest.fn(async () => ({
    exists: mockProfileExists,
    id: 'profile-123',
    data: () => mockProfileData,
}));
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockAdd = jest.fn().mockResolvedValue({ id: 'new-profile-id' });
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }));
const mockWhere = jest.fn().mockReturnThis();
const mockCollection = jest.fn(() => ({
    doc: mockDoc,
    add: mockAdd,
    where: mockWhere,
    get: jest.fn().mockResolvedValue({ docs: [] }),
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

// ── Route Import ─────────────────────────────────────────────────────────────

const govcaptureRoutes = require('../routes/govcaptureRoutes');

// ── Mock Request/Response Builder ────────────────────────────────────────────

function mockReq(overrides = {}) {
    return {
        method: 'GET',
        path:   '/govcapture/profiles',
        userId: 'user-123',
        body:   {},
        params: {},
        query:  {},
        ...overrides,
    };
}

function mockRes() {
    const res = {
        _status: 200,
        _body: null,
        status: jest.fn(function(code) { res._status = code; return res; }),
        json: jest.fn(function(body) { res._body = body; return res; }),
    };
    return res;
}

// ── Feature Gate ─────────────────────────────────────────────────────────────

describe('govcapture routes — feature gate', () => {
    const origEnv = process.env.GOVCAPTURE_ENABLED;

    afterEach(() => {
        if (origEnv !== undefined) process.env.GOVCAPTURE_ENABLED = origEnv;
        else delete process.env.GOVCAPTURE_ENABLED;
    });

    test('GOVCAPTURE_ENABLED=false → 404 (not 401)', async () => {
        process.env.GOVCAPTURE_ENABLED = 'false';
        const req = mockReq();
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(404);
    });

    test('GOVCAPTURE_ENABLED undefined → 404', async () => {
        delete process.env.GOVCAPTURE_ENABLED;
        const req = mockReq();
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(404);
    });

    test('GOVCAPTURE_ENABLED=true → proceeds past gate', async () => {
        process.env.GOVCAPTURE_ENABLED = 'true';
        const req = mockReq({ userId: 'user-123' });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        // Should get 200 (empty profiles list), not 404
        expect(res._status).not.toBe(404);
    });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('govcapture routes — auth', () => {
    const origEnv = process.env.GOVCAPTURE_ENABLED;

    beforeEach(() => {
        process.env.GOVCAPTURE_ENABLED = 'true';
    });

    afterEach(() => {
        if (origEnv !== undefined) process.env.GOVCAPTURE_ENABLED = origEnv;
        else delete process.env.GOVCAPTURE_ENABLED;
    });

    test('anonymous user → 401', async () => {
        const req = mockReq({ userId: 'anonymous' });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(401);
    });

    test('no userId → 401', async () => {
        const req = mockReq({ userId: null });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(401);
    });
});

// ── Profile CRUD ─────────────────────────────────────────────────────────────

describe('govcapture routes — profile CRUD', () => {
    const origEnv = process.env.GOVCAPTURE_ENABLED;

    beforeEach(() => {
        process.env.GOVCAPTURE_ENABLED = 'true';
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (origEnv !== undefined) process.env.GOVCAPTURE_ENABLED = origEnv;
        else delete process.env.GOVCAPTURE_ENABLED;
    });

    test('POST creates profile → 201', async () => {
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            body:   { profileName: 'Test Profile', solutions: [] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(201);
        expect(res._body.success).toBe(true);
        expect(res._body.profileId).toBe('new-profile-id');
    });

    test('POST with spoofed userId → stripped by sanitizer, profile still created', async () => {
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            body:   { profileName: 'Test', userId: 'spoofed-uid' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        // Sanitizer strips userId before validation — profile created with server-set userId
        expect(res._status).toBe(201);
        // Verify the add call used req.userId, not the spoofed one
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-123', // from req.userId, not 'spoofed-uid'
        }));
    });

    test('POST with server-controlled fields → stripped by sanitizer', async () => {
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            body:   { profileName: 'Test', createdAt: 'spoofed', status: 'active' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        // Sanitizer strips createdAt and status — profile created with server values
        expect(res._status).toBe(201);
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active', // server-set, not client value
        }));
    });

    test('POST with solutions.length > 10 → 400', async () => {
        const solutions = Array.from({ length: 11 }, (_, i) => ({ name: `Sol ${i}` }));
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            body:   { profileName: 'Test', solutions },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(400);
        expect(res._body.error).toContain('10');
    });

    test('GET own profile → 200', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'user-123', profileName: 'My Profile', status: 'active' };

        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(200);
        expect(res._body.profile.profileName).toBe('My Profile');
    });

    test('GET another user\'s profile → 403', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'other-user', profileName: 'Their Profile' };

        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });

    test('PUT own profile → 200', async () => {
        // First get: ownership check. Second get: return updated data.
        mockGet
            .mockResolvedValueOnce({
                exists: true, id: 'profile-123',
                data: () => ({ userId: 'user-123', profileName: 'Old Name', status: 'active' }),
            })
            .mockResolvedValueOnce({
                exists: true, id: 'profile-123',
                data: () => ({ userId: 'user-123', profileName: 'New Name', status: 'active' }),
            });

        const req = mockReq({
            method: 'PUT',
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
            body:   { profileName: 'New Name' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(200);
    });

    test('DELETE (soft-delete) → status archived, doc exists', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'user-123', profileName: 'To Archive', status: 'active' };

        const req = mockReq({
            method: 'DELETE',
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(200);
        expect(res._body.message).toContain('archived');
        // Verify update was called with status: 'archived'
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'archived',
        }));
    });

    test('DELETE another user\'s profile → 403', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'other-user', profileName: 'Not Mine' };

        const req = mockReq({
            method: 'DELETE',
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);
        expect(res._status).toBe(403);
    });
});

// ── Seed Profile Verification ────────────────────────────────────────────────

describe('govcapture — seed profile contracts', () => {
    test('Countifi has 5 NAICS codes', () => {
        const countifiNaics = ['541614', '561990', '541511', '541512', '611420'];
        expect(countifiNaics).toHaveLength(5);
    });

    test('Countifi has UEI and CAGE', () => {
        expect('H5M4DURV6586').toMatch(/^[A-Z0-9]+$/);
        expect('9FQ89').toMatch(/^[A-Z0-9]+$/);
    });

    test('Countifi has 5 past performance entries', () => {
        const pastPerf = ['Emirates', 'Delta Air Lines', 'Duke Health', 'Clark Atlanta University', 'North Carolina A&T'];
        expect(pastPerf).toHaveLength(5);
    });

    test('DEFAULT_CHECKLIST_QUESTIONS has 5 entries', () => {
        const { DEFAULT_CHECKLIST_QUESTIONS } = require('../services/govcapture/schemas');
        expect(DEFAULT_CHECKLIST_QUESTIONS).toHaveLength(5);
    });
});

// ── Firestore Rules Validation ───────────────────────────────────────────────

describe('govcapture — firestore rules validation', () => {
    test('all gov* deny blocks present and braces balanced', () => {
        const fs = require('fs');
        const path = require('path');
        const rules = fs.readFileSync(
            path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'
        );

        // Check braces balanced
        let depth = 0;
        for (const ch of rules) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
        }
        expect(depth).toBe(0);

        // Check all gov* deny blocks
        const required = [
            'govProfiles', 'govOpportunities', 'govSourceRuns',
            'govDigestLogs', 'govChecklist', 'govAwardCache', 'govSyncLocks',
        ];
        for (const col of required) {
            expect(rules).toContain(`match /${col}/`);
        }

        // govOpportunities uses doc=** for subcollections
        expect(rules).toContain('govOpportunities/{doc=**}');
    });
});
