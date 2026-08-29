/**
 * F-914 / issue #129 — workspace-owner entitlement in the rate limiter.
 *
 * These tests drive `exports.api` itself, so the full deployed chain runs:
 * cors → verifyAuth → ensureUserExists → resolveWorkspace → rateLimiter → dispatch.
 * That is deliberate. The suite added in PR #128 calls route handlers directly with a
 * hand-built `req`, which is exactly why it could not see this bug: the defect lives in
 * the middleware chain that a direct call skips.
 *
 * The four affected paths' downstream handlers are stubbed — the assertion is about what
 * the limiter does, not what a market report contains.
 */

jest.mock('firebase-admin');

jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (opts, handler) => (handler || opts),
    onCall: (opts, handler) => (handler || opts)
}));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (o, h) => (h || o) }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (o, h) => (h || o) }));
jest.mock('firebase-functions/v2', () => ({ setGlobalOptions: () => {} }));

const reached = (req, res) => res.status(200).json({ success: true, reached: true });
jest.mock('../api/market', () => ({
    generateReport: jest.fn(reached),
    saveCustomSubIndustry: jest.fn(reached),
    listReports: jest.fn(reached)
}));
jest.mock('../api/bulk', () => ({ uploadCSV: jest.fn(reached) }));
jest.mock('../api/leads', () => ({ generateMiniReport: jest.fn(reached) }));

jest.mock('../middleware/planGate', () => {
    const actual = jest.requireActual('../middleware/planGate');
    return { ...actual, getUserPlanForRequest: jest.fn(actual.getUserPlanForRequest) };
});

const admin = require('firebase-admin');
const { getUserPlanForRequest } = require('../middleware/planGate');
const { api } = require('../index');

const SCALE_MEMBER = 'scaleMemberStaleDoc';
const SCALE_OWNER = 'scaleOwner';
const SCALE_WS = 'ws_scale';
const GROWTH_MEMBER = 'growthMember';
const GROWTH_OWNER = 'growthOwner';
const GROWTH_WS = 'ws_growth';
const SOLO_STARTER = 'soloStarter';
const SOLO_SUBSCRIPTION_SCALE = 'soloSubscriptionScale';

const ENTITLEMENT_PATHS = [
    '/market/report',
    '/market/sub-industry',
    '/leads/mini-report',
    '/bulk/upload'
];

function seed() {
    admin._resetMockData();
    admin._setMockCollection('users', {
        // Stale personal tier — the whole point of the bug: the member's own doc says starter.
        [SCALE_MEMBER]: { email: 'member@test.com', plan: 'starter' },
        [SCALE_OWNER]: { email: 'owner@test.com', subscription: { plan: 'scale' } },
        [GROWTH_MEMBER]: { email: 'gmember@test.com', plan: 'starter' },
        [GROWTH_OWNER]: { email: 'gowner@test.com', subscription: { plan: 'growth' } },
        [SOLO_STARTER]: { email: 'solo@test.com', plan: 'starter' },
        // Paid solo customer whose tier lives where the canonical chain looks first and the old
        // hand-rolled `userData.plan` read did not look at all.
        [SOLO_SUBSCRIPTION_SCALE]: { email: 'sub@test.com', subscription: { plan: 'Scale' } }
    });
    admin._setMockCollection('workspaces', {
        [SCALE_WS]: { ownerId: SCALE_OWNER, entitlementOwnerUid: SCALE_OWNER, name: 'Scale Co' },
        [GROWTH_WS]: { ownerId: GROWTH_OWNER, entitlementOwnerUid: GROWTH_OWNER, name: 'Growth Co' }
    });
    admin._setMockCollection('workspaceMembers', {
        [`${SCALE_WS}_${SCALE_MEMBER}`]: {
            workspaceId: SCALE_WS, uid: SCALE_MEMBER, status: 'active', role: 'contributor'
        },
        [`${GROWTH_WS}_${GROWTH_MEMBER}`]: {
            workspaceId: GROWTH_WS, uid: GROWTH_MEMBER, status: 'active', role: 'contributor'
        }
    });
}

function makeRes() {
    let settle;
    const res = {
        // exports.api hands an async callback to cors(), which does not await it, so the call
        // returns before the chain finishes. Resolve on the response instead.
        sent: new Promise((resolve) => { settle = resolve; }),
        _settle: (...a) => settle(...a),
        statusCode: 200,
        body: null,
        headers: {},
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; this._settle(); return this; },
        send(payload) { this.body = payload; this.headersSent = true; this._settle(); return this; },
        set(k, v) {
            if (typeof k === 'object') { Object.assign(this.headers, k); } else { this.headers[k] = v; }
            return this;
        },
        setHeader(k, v) { this.headers[k] = v; },
        getHeader(k) { return this.headers[k]; },
        removeHeader(k) { delete this.headers[k]; },
        end() { this.headersSent = true; this._settle(); return this; }
    };
    return res;
}

async function call(uid, path, method = 'POST') {
    const req = {
        method,
        path,
        url: path,
        originalUrl: path,
        headers: uid ? { authorization: `Bearer valid_${uid}` } : {},
        body: {},
        query: {},
        ip: '203.0.113.7',
        get(name) { return this.headers[String(name).toLowerCase()]; }
    };
    const res = makeRes();
    api(req, res);
    await Promise.race([
        res.sent,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`no response for ${method} ${path}`)), 5000))
    ]);
    return res;
}

describe('rate limiter entitlement resolves against the workspace owner (#129)', () => {
    beforeEach(() => {
        seed();
        getUserPlanForRequest.mockClear();
    });

    it.each(ENTITLEMENT_PATHS)(
        'lets a Scale workspace member with a stale starter doc through %s',
        async (path) => {
            const res = await call(SCALE_MEMBER, path);
            expect(res.statusCode).toBe(200);
            expect(res.body).toMatchObject({ reached: true });
        }
    );

    it.each(ENTITLEMENT_PATHS)('still denies a genuine solo starter on %s', async (path) => {
        const res = await call(SOLO_STARTER, path);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('This feature is not available on your current plan');
        expect(res.body.details.plan).toBe('starter');
    });

    it('keys the endpoint counter to the member, not the workspace owner', async () => {
        await call(SCALE_MEMBER, '/market/report');

        const rateLimits = admin._mockData.collections.rateLimits || {};
        const endpointDocs = Object.keys(rateLimits).filter(k => k.endsWith('_endpoint_marketReport'));

        expect(endpointDocs).toEqual([`${SCALE_MEMBER}_endpoint_marketReport`]);
        expect(rateLimits[`${SCALE_MEMBER}_endpoint_marketReport`].identifier).toBe(SCALE_MEMBER);
    });

    it("grants the owner's per-endpoint allowance per seat, then throttles (not 403s)", async () => {
        // growth marketReport = 10/hr. The 11th call must be a 429 against the member's own
        // counter — proof the allowance came from the owner while the count stayed per-seat.
        for (let i = 0; i < 10; i++) {
            const ok = await call(GROWTH_MEMBER, '/market/report');
            expect(ok.statusCode).toBe(200);
        }

        const throttled = await call(GROWTH_MEMBER, '/market/report');
        expect(throttled.statusCode).toBe(429);

        expect(admin._mockData.collections.rateLimits[`${GROWTH_MEMBER}_endpoint_marketReport`].count)
            .toBe(10);
    });

    it('reads a solo caller\'s plan through the canonical chain, not userData.plan alone', async () => {
        const res = await call(SOLO_SUBSCRIPTION_SCALE, '/market/report');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ reached: true });
        // No workspace, so the pass came from the caller's own plan being resolved correctly.
        expect(getUserPlanForRequest).not.toHaveBeenCalled();
    });

    it('does not look up the workspace on a request the caller\'s own plan allows', async () => {
        const res = await call(SCALE_MEMBER, '/health', 'GET');

        expect(res.statusCode).toBe(200);
        expect(getUserPlanForRequest).not.toHaveBeenCalled();
    });

    it('treats a missing workspaceId as no workspace rather than assuming the property', async () => {
        const res = await call(null, '/market/report');

        // Anonymous: never reaches resolveWorkspace, so req.workspaceId is undefined.
        expect([401, 403]).toContain(res.statusCode);
        expect(getUserPlanForRequest).not.toHaveBeenCalled();
    });
});
