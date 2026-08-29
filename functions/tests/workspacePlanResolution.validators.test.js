'use strict';

/**
 * Workspace-aware plan resolution — api/pitch/validators.js checkPitchLimit (audit V-8).
 *
 * checkPitchLimit() selected the monthly pitch LIMIT from the caller's own plan, so a
 * stale-FREE member on a paid workspace was capped (and the returned .tier — which also
 * feeds the pitch-style / LinkedIn-post content gate — was wrong). The fix threads req
 * → getUserPlan(userId, { workspaceId }) for the limit/tier; usage stays per-member.
 *
 * FAILS pre-fix: member resolves 'free' → limit 5, tier 'free', allowed false (used 10).
 * Post-fix: owner 'enterprise' → limit -1 (unlimited), tier 'enterprise', allowed true.
 */

const mockStore = { users: {}, workspaces: {} };

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') throw new Error('invalid documentPath');
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

const { checkPitchLimit } = require('../api/pitch/validators');

function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

beforeEach(() => { mockStore.users = {}; mockStore.workspaces = {}; });

describe('V-8 validators.checkPitchLimit: limit + tier resolve the workspace owner plan', () => {
    test('stale-FREE member over the free cap on an Enterprise workspace is allowed', async () => {
        // Member is over the free cap of 5 for this month (per-member usage counter).
        mockStore.users['wsMember'] = { tier: 'FREE', pitchCountMonth: currentMonth(), pitchesThisMonth: 10 };
        mockStore.workspaces['wsPaid'] = { entitlementOwnerUid: 'wsOwner' };
        mockStore.users['wsOwner'] = { subscription: { plan: 'enterprise' } };

        const result = await checkPitchLimit('wsMember', { workspaceId: 'wsPaid' });

        // pre-fix: tier 'free', limit 5, allowed false (10 >= 5).
        expect(result.tier).toBe('enterprise');
        expect(result.limit).toBe(-1);
        expect(result.allowed).toBe(true);
    });
});
