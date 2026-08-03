'use strict';

/**
 * Interim SynchGov workspace-scoping (feat/synchgov-effective-user).
 *
 * Verifies that gov data operations key on the workspace OWNER's uid
 * (req.govUserId = effectiveGovUserId(req)) so a workspace member and the
 * owner share one gov workspace, while owners, solo users, and cross-user
 * access are unaffected.
 */

// ── Firebase Admin Mock (mirrors govcaptureRoutes.test.js) ────────────────────

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
const mockListGet = jest.fn().mockResolvedValue({ docs: [] });
const mockCollection = jest.fn(() => ({
    doc: mockDoc,
    add: mockAdd,
    where: mockWhere,
    get: mockListGet,
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
const { effectiveGovUserId } = govcaptureRoutes;

function mockReq(overrides = {}) {
    return {
        method: 'GET',
        path:   '/govcapture/profiles',
        userId: 'member-uid',
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
        status: jest.fn(function (code) { res._status = code; return res; }),
        json: jest.fn(function (body) { res._body = body; return res; }),
    };
    return res;
}

// ── Unit: effectiveGovUserId resolver ─────────────────────────────────────────

describe('effectiveGovUserId — resolver logic', () => {
    test('active member → workspace owner uid', () => {
        expect(effectiveGovUserId({ userId: 'member-uid', entitlementOwnerUid: 'owner-uid' }))
            .toBe('owner-uid');
    });

    test('owner → own uid (entitlementOwnerUid resolves to self)', () => {
        expect(effectiveGovUserId({ userId: 'owner-uid', entitlementOwnerUid: 'owner-uid' }))
            .toBe('owner-uid');
    });

    test('solo user (no workspace) → own uid', () => {
        // Solo users get entitlementOwnerUid defaulted to self by workspaceResolver.
        expect(effectiveGovUserId({ userId: 'solo-uid', entitlementOwnerUid: 'solo-uid' }))
            .toBe('solo-uid');
    });

    test('fail-closed: member with unset entitlementOwnerUid → self, never throws', () => {
        expect(effectiveGovUserId({ userId: 'member-uid', entitlementOwnerUid: null }))
            .toBe('member-uid');
        expect(effectiveGovUserId({ userId: 'member-uid' }))
            .toBe('member-uid');
    });

    test('anonymous / no userId → null', () => {
        expect(effectiveGovUserId({ userId: null, entitlementOwnerUid: null })).toBe(null);
        expect(effectiveGovUserId({})).toBe(null);
    });
});

// ── Route behavior: member ↔ owner shared workspace ───────────────────────────

describe('govcapture — interim workspace scoping (route behavior)', () => {
    const origEnv = process.env.GOVCAPTURE_ENABLED;

    beforeEach(() => {
        process.env.GOVCAPTURE_ENABLED = 'true';
        jest.clearAllMocks();
        mockProfileData = null;
        mockProfileExists = false;
        mockGet.mockImplementation(async () => ({
            exists: mockProfileExists,
            id: 'profile-123',
            data: () => mockProfileData,
        }));
    });

    afterEach(() => {
        if (origEnv !== undefined) process.env.GOVCAPTURE_ENABLED = origEnv;
        else delete process.env.GOVCAPTURE_ENABLED;
    });

    test('member write lands on OWNER profile (stamped with owner uid, not member uid)', async () => {
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            userId: 'member-uid',
            entitlementOwnerUid: 'owner-uid',
            body:   { profileName: 'Countifi Gov Profile', solutions: [] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(201);
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-uid' }));
    });

    test('member read SEES the owner profile (200, not 403)', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'owner-uid', profileName: 'Owner Profile', status: 'active' };

        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
            userId: 'member-uid',
            entitlementOwnerUid: 'owner-uid',
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(200);
        expect(res._body.profile.profileName).toBe('Owner Profile');
    });

    test('member listing filters on OWNER uid', async () => {
        const req = mockReq({
            path:   '/govcapture/profiles',
            userId: 'member-uid',
            entitlementOwnerUid: 'owner-uid',
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'owner-uid');
    });

    test('solo user unchanged: write stamped with own uid', async () => {
        // Solo → entitlementOwnerUid defaulted to self.
        const req = mockReq({
            method: 'POST',
            path:   '/govcapture/profiles',
            userId: 'solo-uid',
            entitlementOwnerUid: 'solo-uid',
            body:   { profileName: 'Solo Profile', solutions: [] },
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(201);
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ userId: 'solo-uid' }));
    });

    test('owner unchanged: read of own profile → 200', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'owner-uid', profileName: 'Owner Own', status: 'active' };

        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
            userId: 'owner-uid',
            entitlementOwnerUid: 'owner-uid',
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(200);
    });

    test('regression: non-member cannot reach another user\'s profile → 403', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'victim-uid', profileName: 'Not Yours' };

        // Attacker is solo (entitlementOwnerUid resolves to self); NOT a member of victim's workspace.
        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
            userId: 'attacker-uid',
            entitlementOwnerUid: 'attacker-uid',
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(403);
    });

    test('regression: member of workspace A cannot reach workspace B owner profile → 403', async () => {
        mockProfileExists = true;
        mockProfileData = { userId: 'ownerB-uid', profileName: 'Workspace B' };

        // Member resolves to their own workspace owner (ownerA), not ownerB.
        const req = mockReq({
            path:   '/govcapture/profiles/profile-123',
            params: { profileId: 'profile-123' },
            userId: 'member-uid',
            entitlementOwnerUid: 'ownerA-uid',
        });
        const res = mockRes();
        await govcaptureRoutes.handle(req, res);

        expect(res._status).toBe(403);
    });
});
