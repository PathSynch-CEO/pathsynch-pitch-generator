'use strict';

/**
 * eventLogger planTier stamping — regression tests.
 *
 * The logger previously used its own local getUserPlan that (a) read the stale
 * account-creation `tier` field BEFORE `plan` and never consulted
 * `subscription.plan` (the canonical priority), (b) returned raw casing
 * ('FREE'), and (c) was workspace-blind. Events for Stripe-paying users with a
 * stale tier, and for workspace members, were mis-stamped.
 *
 * Now stamps via getUserPlanForRequest(req): canonical chain, lowercase,
 * workspace-aware, never throws.
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const { logEvent } = require('../api/events/eventLogger');

const OWNER_UID = 'owner_ev';
const MEMBER_UID = 'member_ev';
const SOLO_UID = 'solo_ev';
const WS_ID = 'ws_ev';

function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function mockReq(userId, { workspaceId, eventType = 'page_view' } = {}) {
    return {
        userId,
        workspaceId,
        body: { eventType, properties: { page: '/dashboard' }, sessionId: 's1' },
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' },
    };
}

function stampedEvent(userId) {
    const coll = admin._mockData.collections[`userEvents/${userId}/events`] || {};
    const docs = Object.values(coll);
    return docs.length ? docs[0] : null;
}

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();

    admin._setMockCollection('workspaces', {
        [WS_ID]: { ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID, memberCount: 2, seatLimit: -1 },
    });

    admin._setMockCollection('users', {
        // Stale-tier paying user: account-creation tier never updated by Stripe.
        // Old logger stamped 'FREE'; canonical chain must yield 'scale'.
        [SOLO_UID]: { tier: 'FREE', subscription: { plan: 'scale' } },
        [OWNER_UID]: { subscription: { plan: 'enterprise' }, tier: 'enterprise' },
        // Member's own doc is free — must not be what gets stamped in workspace context.
        [MEMBER_UID]: { tier: 'FREE' },
    });
});

describe('eventLogger planTier stamping', () => {
    test('stale-tier paying user stamps subscription.plan, not the stale tier field', async () => {
        const res = mockRes();
        await logEvent(mockReq(SOLO_UID), res);

        expect(res.status).toHaveBeenCalledWith(200);
        const ev = stampedEvent(SOLO_UID);
        expect(ev).not.toBeNull();
        expect(ev.planTier).toBe('scale'); // old code: 'FREE'
    });

    test('workspace member stamps the OWNER effective plan, lowercased', async () => {
        const res = mockRes();
        await logEvent(mockReq(MEMBER_UID, { workspaceId: WS_ID }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        const ev = stampedEvent(MEMBER_UID);
        expect(ev.planTier).toBe('enterprise'); // old code: 'FREE'
    });

    test('member WITHOUT workspace context stamps own plan (fail-soft, lowercase)', async () => {
        const res = mockRes();
        await logEvent(mockReq(MEMBER_UID), res);

        const ev = stampedEvent(MEMBER_UID);
        expect(ev.planTier).toBe('free'); // lowercased, old code returned raw 'FREE'
    });

    test('unknown user stamps starter and still returns 200 (never blocks)', async () => {
        const res = mockRes();
        await logEvent(mockReq('ghost_ev'), res);

        expect(res.status).toHaveBeenCalledWith(200);
        const ev = stampedEvent('ghost_ev');
        expect(ev.planTier).toBe('starter');
    });

    test('missing eventType returns 400 and writes nothing', async () => {
        const res = mockRes();
        await logEvent(mockReq(SOLO_UID, { eventType: null }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(stampedEvent(SOLO_UID)).toBeNull();
    });

    test('event carries the standard fields alongside planTier', async () => {
        const res = mockRes();
        await logEvent(mockReq(SOLO_UID), res);

        const ev = stampedEvent(SOLO_UID);
        expect(ev.eventType).toBe('page_view');
        expect(ev.userId).toBe(SOLO_UID);
        expect(ev.sessionId).toBe('s1');
        expect(ev.device).toBe('desktop');
    });
});
