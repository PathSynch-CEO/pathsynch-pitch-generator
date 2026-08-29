'use strict';

/**
 * Version-history retention — workspace-aware plan resolution.
 *
 * TRIGGER: scheduleCleanup in services/versionHistory.js resolved
 * getUserPlan(userId) with no workspace context, where `userId` is the user who
 * made the edit (index.js passes decodedToken.uid). A workspace member whose own
 * users/{uid} doc carries a stale free/starter tier therefore pruned a PAID
 * workspace's pitch down to the 3-version free cap — and unlike a mis-resolved
 * gate, this path DELETES, so the loss is not undone by fixing resolution later.
 *
 * SYSTEM_BIBLE law 13: resolve the workspace OWNER's plan. Retention follows the
 * pitch's workspace (pitches/{id}.workspaceId), falling back to the caller's
 * server-verified req.workspaceId.
 */

const mockStore = { users: {}, workspaces: {}, pitchVersions: [] };
let mockDeletedIds = [];

function mockDoc(col, id) {
    if (id === null || id === undefined || id === '') {
        throw new Error('Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.');
    }
    return {
        id,
        get: async () => ({ exists: !!(mockStore[col] && id in mockStore[col]), data: () => (mockStore[col] || {})[id] }),
        set: async () => {}, update: async () => {},
    };
}

function versionQuery(state = { pitchId: null, dir: 'asc', max: Infinity }) {
    const q = {
        where(field, _op, value) { return versionQuery({ ...state, [field]: value }); },
        orderBy(_field, dir = 'asc') { return versionQuery({ ...state, dir }); },
        limit(n) { return versionQuery({ ...state, max: n }); },
        _resolve() {
            const rows = mockStore.pitchVersions
                .filter(v => !state.pitchId || v.pitchId === state.pitchId)
                .sort((a, b) => (state.dir === 'desc' ? b.versionNumber - a.versionNumber : a.versionNumber - b.versionNumber))
                .slice(0, state.max === Infinity ? undefined : state.max);
            return rows.map(v => ({ id: v.id, data: () => v, ref: { id: v.id } }));
        },
        count() { return { get: async () => ({ data: () => ({ count: q._resolve().length }) }) }; },
        get: async () => {
            const docs = q._resolve();
            return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
        },
    };
    return q;
}

function mockCollection(name) {
    if (name === 'pitchVersions') {
        return Object.assign(versionQuery(), { doc: (id) => ({ id: id || 'new_version' }) });
    }
    const q = {
        where() { return q; }, orderBy() { return q; }, limit() { return q; },
        get: async () => ({ docs: [], empty: true, size: 0, forEach() {} }),
    };
    return Object.assign(q, { doc: (id) => mockDoc(name, id) });
}

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(() => ({
        collection: (n) => mockCollection(n),
        batch: () => ({
            delete: (ref) => { mockDeletedIds.push(ref.id); },
            commit: async () => {},
        }),
        runTransaction: async (fn) => fn({
            get: async (query) => query.get(),
            set: () => {},
        }),
    }), {
        FieldValue: { serverTimestamp: () => new Date(), increment: (n) => ({ _increment: n }) },
    }),
}));

const versionHistory = require('../services/versionHistory');
const { scheduleCleanup, createVersion, VERSION_LIMITS } = versionHistory;

const OWNER_UID = 'owner_vh';        // pays for the workspace (Scale)
const GROWTH_OWNER = 'growth_owner_vh';
const MEMBER_UID = 'member_vh';      // own doc is stale FREE — the trap
const STARTER_SOLO = 'starter_solo_vh';

const SCALE_WS = 'ws_scale_vh';
const GROWTH_WS = 'ws_growth_vh';
const PITCH_ID = 'pitch_vh';

function seedVersions(count) {
    mockStore.pitchVersions = Array.from({ length: count }, (_, i) => ({
        id: `v${i + 1}`, pitchId: PITCH_ID, versionNumber: i + 1, snapshot: {},
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDeletedIds = [];
    mockStore.users = {
        [OWNER_UID]: { subscription: { plan: 'scale' }, tier: 'scale' },
        [GROWTH_OWNER]: { subscription: { plan: 'growth' }, tier: 'FREE' },
        [MEMBER_UID]: { tier: 'FREE' },
        [STARTER_SOLO]: { subscription: { plan: 'starter' }, tier: 'FREE' },
    };
    mockStore.workspaces = {
        [SCALE_WS]: { ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID },
        [GROWTH_WS]: { ownerId: GROWTH_OWNER, entitlementOwnerUid: GROWTH_OWNER },
    };
});

describe('version retention — members inherit the workspace owner limit', () => {
    test('member with a stale FREE doc on a Scale workspace deletes NOTHING at 10 versions', async () => {
        seedVersions(10);
        await scheduleCleanup(PITCH_ID, MEMBER_UID, SCALE_WS);

        // Pre-fix: resolved FREE (limit 3) and destroyed versions 1–7.
        expect(mockDeletedIds).toEqual([]);
        expect(VERSION_LIMITS.scale).toBe(100);
    });

    test('member on a Growth workspace prunes to 30, not to the free cap of 3', async () => {
        seedVersions(35);
        await scheduleCleanup(PITCH_ID, MEMBER_UID, GROWTH_WS);

        expect(mockDeletedIds).toHaveLength(35 - VERSION_LIMITS.growth); // 5
        expect(mockDeletedIds).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);  // oldest only
    });

    test('the owner behaves exactly as before', async () => {
        seedVersions(10);
        await scheduleCleanup(PITCH_ID, OWNER_UID, SCALE_WS);
        expect(mockDeletedIds).toEqual([]);
    });

    test('owner whose paid plan lives only in subscription.plan keeps the F-1014 chain', async () => {
        seedVersions(35);
        await scheduleCleanup(PITCH_ID, GROWTH_OWNER, GROWTH_WS);
        expect(mockDeletedIds).toHaveLength(5); // growth (30), not the stale FREE tier
    });
});

describe('version retention — solo users are unchanged', () => {
    test('solo Starter user still prunes to 3', async () => {
        seedVersions(10);
        await scheduleCleanup(PITCH_ID, STARTER_SOLO, null);

        expect(mockDeletedIds).toHaveLength(10 - VERSION_LIMITS.starter); // 7
        expect(mockDeletedIds).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    });

    test('member with NO workspace context falls back to their own plan', async () => {
        // Fail-soft: without a resolved workspace there is no owner to inherit from.
        seedVersions(10);
        await scheduleCleanup(PITCH_ID, MEMBER_UID, null);
        expect(mockDeletedIds).toHaveLength(7);
    });

    test('an unknown plan tier still falls back to the starter limit', async () => {
        mockStore.users[MEMBER_UID] = { subscription: { plan: 'not_a_tier' } };
        seedVersions(10);
        await scheduleCleanup(PITCH_ID, MEMBER_UID, null);
        expect(mockDeletedIds).toHaveLength(7);
    });
});

describe('createVersion threads the retention scope', () => {
    test("uses the PITCH's workspaceId even when the caller has no workspace context", async () => {
        seedVersions(10);
        await createVersion(PITCH_ID, { workspaceId: SCALE_WS, businessName: 'Acme' }, MEMBER_UID, 'Member', { businessName: 'Acme 2' });
        await new Promise(setImmediate); // cleanup is fire-and-forget

        expect(mockDeletedIds).toEqual([]);
    });

    test("falls back to the caller's req.workspaceId when the pitch carries none", async () => {
        seedVersions(10);
        await createVersion(PITCH_ID, { businessName: 'Acme' }, MEMBER_UID, 'Member', { businessName: 'Acme 2' }, undefined, { userId: MEMBER_UID, workspaceId: SCALE_WS });
        await new Promise(setImmediate);

        expect(mockDeletedIds).toEqual([]);
    });

    test('a solo edit with neither still prunes at the caller plan', async () => {
        seedVersions(10);
        await createVersion(PITCH_ID, { businessName: 'Acme' }, STARTER_SOLO, 'Solo', { businessName: 'Acme 2' });
        await new Promise(setImmediate);

        expect(mockDeletedIds).toHaveLength(7);
    });
});
