'use strict';

/**
 * Workspace-aware plan resolution — services/pitchMetrics.js checkAndUpdateUsage (audit V-9).
 *
 * checkAndUpdateUsage() selected the pitch quota LIMIT from the caller's own plan, so a
 * stale-FREE member on a paid workspace hit a 429 at the free cap. The fix threads req
 * → getUserPlan(userId, { workspaceId }); the per-period usage counter stays per-member.
 *
 * FAILS pre-fix: member resolves 'free' → limit 5, and with 10 pitches used → allowed
 * false. Post-fix: owner 'enterprise' → unlimited → allowed true, limit -1.
 */

const { getCurrentPeriod } = require('../lib/shared');

const mockStore = { users: {}, workspaces: {}, usage: {} };

function ensure(col) { mockStore[col] = mockStore[col] || {}; return mockStore[col]; }
function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') throw new Error('invalid documentPath');
    return {
        id,
        get: async () => ({ exists: !!(mockStore[col] && id in mockStore[col]), data: () => (mockStore[col] || {})[id] }),
        set: async (v, opts) => { const s = ensure(col); s[id] = opts && opts.merge ? { ...(s[id] || {}), ...v } : v; },
        update: async (v) => { const s = ensure(col); s[id] = { ...(s[id] || {}), ...v }; },
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

const { checkAndUpdateUsage } = require('../services/pitchMetrics');

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; mockStore.usage = {}; });

describe('V-9 pitchMetrics.checkAndUpdateUsage: quota limit resolves the workspace owner plan', () => {
    test('stale-FREE member over the free cap on an Enterprise workspace is allowed', async () => {
        const period = getCurrentPeriod();
        mockStore.users['wsMember'] = { tier: 'FREE' };
        mockStore.usage[`wsMember_${period}`] = { pitchesGenerated: 10 };  // per-member counter over free cap of 5
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const result = await checkAndUpdateUsage('wsMember', { workspaceId: 'wsPaid' });

        // pre-fix: limit 5, used 10 → allowed false.
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(-1);
    });
});
