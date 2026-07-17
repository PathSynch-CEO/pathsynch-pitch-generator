'use strict';

/**
 * Route-level regression tests:
 *
 * 1. POST /team/invite — expiry-aware duplicate pre-check.
 *    A date-expired invite whose status field is still 'pending' must NOT
 *    409-block re-inviting (that stranded daniyal@); it gets marked 'expired'
 *    and the new invite is created. A genuinely valid pending invite still 409s.
 *
 * 2. /analytics/icp/* — server-side ICP analytics (icpAnalytics has no client
 *    rules; direct client access is default-denied). Track stores the FLAT doc
 *    shape the client aggregation expects, with server-set userId/timestamp;
 *    events returns only the caller's docs from the last 30 days.
 */

jest.mock('firebase-admin');
jest.mock('../services/email', () => ({
    sendTeamInviteEmail: jest.fn().mockResolvedValue({ success: true }),
    sendWorkspaceInviteEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const admin = require('firebase-admin');
const teamRoutes = require('../routes/teamRoutes');
const analyticsRoutes = require('../routes/analyticsRoutes');

const OWNER_UID = 'owner_rt';
const OWNER_EMAIL = 'owner@test.com';
const WS_ID = 'ws_rt';
const INVITEE = 'newmember@test.com';

function mockRes() {
    return {
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

function postReq(path, body, userId = OWNER_UID) {
    return { method: 'POST', normalizedPath: path, body, userId, userEmail: OWNER_EMAIL, headers: {} };
}
function getReq(path, userId = OWNER_UID) {
    return { method: 'GET', normalizedPath: path, body: {}, userId, userEmail: OWNER_EMAIL, headers: {} };
}

function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return admin.firestore.Timestamp.fromDate(d);
}

function seedInvite(id, { email = INVITEE, expiresDays = 5, status = 'pending' } = {}) {
    const coll = admin._mockData.collections['teamInvitations'] || {};
    coll[id] = {
        teamOwnerUid: OWNER_UID,
        inviteeEmail: email,
        role: 'contributor',
        status,
        createdAt: daysFromNow(-10),
        expiresAt: daysFromNow(expiresDays),
        acceptedAt: null,
        acceptedByUid: null,
        tokenHash: 'h_' + id,
        workspaceId: WS_ID,
        inviterUid: OWNER_UID,
    };
    admin._setMockCollection('teamInvitations', coll);
}

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    admin._setMockCollection('teams', {
        [OWNER_UID]: {
            ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL, ownerDisplayName: 'Owner',
            members: [], memberUids: [OWNER_UID], workspaceId: WS_ID,
        },
    });
    admin._setMockCollection('workspaces', {
        [WS_ID]: {
            ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID, name: 'RT Workspace',
            memberIds: [OWNER_UID], memberCount: 1, seatLimit: 5,
        },
    });
    admin._setMockCollection('users', {
        [OWNER_UID]: { email: OWNER_EMAIL, displayName: 'Owner', tier: 'enterprise' },
    });
    admin._setMockCollection('teamInvitations', {});
    admin._setMockCollection('icpAnalytics', {});
});

// ── 1. POST /team/invite expiry-aware pre-check ────────────────────────

describe('POST /team/invite — expiry-aware duplicate pre-check', () => {
    test('date-expired pending invite does NOT block; it is marked expired and a new invite is created', async () => {
        seedInvite('stale1', { expiresDays: -5 }); // expired 5 days ago, status still 'pending'

        const res = mockRes();
        const handled = await teamRoutes.handle(postReq('/team/invite', { email: INVITEE, role: 'contributor' }), res);

        expect(handled).toBe(true);
        expect(res.status).toHaveBeenCalledWith(201);

        const invites = admin._mockData.collections['teamInvitations'];
        expect(invites['stale1'].status).toBe('expired');
        // A brand-new pending invite exists alongside the expired one
        const pending = Object.values(invites).filter(i => i.status === 'pending' && i.inviteeEmail === INVITEE);
        expect(pending).toHaveLength(1);
    });

    test('valid (unexpired) pending invite still returns 409 conflict', async () => {
        seedInvite('fresh1', { expiresDays: 5 });

        const res = mockRes();
        await teamRoutes.handle(postReq('/team/invite', { email: INVITEE, role: 'contributor' }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(admin._mockData.collections['teamInvitations']['fresh1'].status).toBe('pending');
    });
});

// ── 2. /analytics/icp/* server-side endpoints ──────────────────────────

describe('POST /analytics/icp/track', () => {
    test('stores flat doc with server-set userId; ignores client-supplied userId', async () => {
        const res = mockRes();
        const handled = await analyticsRoutes.handle(
            postReq('/analytics/icp/track', { type: 'template_selected', templateId: 't1', userId: 'spoofed' }),
            res
        );

        expect(handled).toBe(true);
        expect(res.status).toHaveBeenCalledWith(200);

        const docs = Object.values(admin._mockData.collections['icpAnalytics']);
        expect(docs).toHaveLength(1);
        expect(docs[0].type).toBe('template_selected');
        expect(docs[0].templateId).toBe('t1');   // flat, as the client aggregation expects
        expect(docs[0].userId).toBe(OWNER_UID);  // server-set, spoof ignored
    });

    test('missing type returns 400 and writes nothing', async () => {
        const res = mockRes();
        await analyticsRoutes.handle(postReq('/analytics/icp/track', { templateId: 't1' }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(Object.keys(admin._mockData.collections['icpAnalytics'])).toHaveLength(0);
    });

    test('anonymous caller gets 401', async () => {
        const res = mockRes();
        await analyticsRoutes.handle(postReq('/analytics/icp/track', { type: 'x' }, 'anonymous'), res);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('GET /analytics/icp/events', () => {
    test('returns only the caller\'s events from the last 30 days', async () => {
        admin._setMockCollection('icpAnalytics', {
            recent1: { userId: OWNER_UID, type: 'icp_created', timestamp: daysFromNow(-2) },
            recent2: { userId: OWNER_UID, type: 'template_selected', templateId: 't9', timestamp: daysFromNow(-10) },
            tooOld:  { userId: OWNER_UID, type: 'icp_created', timestamp: daysFromNow(-45) },
            otherUser: { userId: 'someone_else', type: 'icp_created', timestamp: daysFromNow(-2) },
        });

        const res = mockRes();
        await analyticsRoutes.handle(getReq('/analytics/icp/events'), res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.success).toBe(true);
        const types = payload.data.map(e => e.type).sort();
        expect(payload.data).toHaveLength(2);
        expect(types).toEqual(['icp_created', 'template_selected']);
        // Flat shape preserved for the client aggregation
        expect(payload.data.find(e => e.templateId)).toBeTruthy();
    });

    test('anonymous caller gets 401', async () => {
        const res = mockRes();
        await analyticsRoutes.handle(getReq('/analytics/icp/events', 'anonymous'), res);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
