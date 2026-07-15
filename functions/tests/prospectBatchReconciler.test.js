'use strict';

/**
 * Tests for reconcileStuckBatches() — F-201 stuck-batch reconciler
 * (functions/scheduled/prospectBatchReconciler.js).
 *
 * Proves: stale queued/processing batches age to 'failed'; fresh in-flight batches are
 * NOT touched; completed/failed batches are ignored; the active-batch cap frees after
 * reconciliation; a per-doc write failure does not abort the sweep; the threshold is
 * env-configurable and boundary-exclusive.
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const {
    reconcileStuckBatches,
    _toMillis,
    _stalenessAnchorMs,
} = require('../scheduled/prospectBatchReconciler');

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW  = 1_700_000_000_000; // fixed "now" in epoch ms
const HOUR = 60 * 60 * 1000;

/** Firestore-style timestamp for a point `msAgo` before NOW. */
function ts(msAgo) {
    return admin.firestore.Timestamp.fromDate(new Date(NOW - msAgo));
}

function setBatches(map) {
    admin._setMockCollection('prospectIntel', map);
}

function getBatch(id) {
    return (admin._mockData.collections['prospectIntel'] || {})[id];
}

/** Mirrors the cap query in routes/prospectIntelRoutes.js. */
async function activeCount(userId) {
    const snap = await admin.firestore().collection('prospectIntel')
        .where('userId', '==', userId)
        .where('status', 'in', ['queued', 'processing'])
        .get();
    return snap.size;
}

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
    delete process.env.PROSPECT_BATCH_STALE_HOURS;
});

// ── Core behavior ───────────────────────────────────────────────────────────────

test('stale processing batch is reconciled to failed with correct fields', async () => {
    setBatches({
        b_stale: {
            userId: 'u1', status: 'processing',
            totalProspects: 10, completedCount: 2, failedCount: 0,
            createdAt: ts(6 * HOUR), processingStartedAt: ts(5.5 * HOUR), updatedAt: ts(5 * HOUR),
        },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.reconciled).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.reconciledIds).toContain('b_stale');

    const b = getBatch('b_stale');
    expect(b.status).toBe('failed');
    expect(b.failureReason).toBe('auto_reconciled_stale');
    expect(b.clearedBy).toBe('auto_reconciler');
    expect(b.reconciledAt).toBeDefined();
});

test('stale queued batch (only createdAt) is reconciled — trigger never fired', async () => {
    setBatches({
        b_q: { userId: 'u1', status: 'queued', createdAt: ts(4 * HOUR) },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.reconciled).toBe(1);
    expect(getBatch('b_q').status).toBe('failed');
});

test('fresh in-flight batch is NOT touched — recent updatedAt resets the clock', async () => {
    setBatches({
        b_fresh: {
            userId: 'u1', status: 'processing',
            totalProspects: 500, completedCount: 40,
            createdAt: ts(2 * HOUR),          // created 2h ago...
            updatedAt: ts(10 * 60 * 1000),    // ...but progressed 10m ago
        },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.reconciled).toBe(0);
    expect(r.skipped).toBe(1);
    expect(getBatch('b_fresh').status).toBe('processing');
});

test('completed and failed batches are ignored (excluded by the status filter)', async () => {
    setBatches({
        b_done:   { userId: 'u1', status: 'completed', createdAt: ts(10 * HOUR) },
        b_failed: { userId: 'u1', status: 'failed',    createdAt: ts(10 * HOUR) },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.scanned).toBe(0);
    expect(r.reconciled).toBe(0);
    expect(getBatch('b_done').status).toBe('completed');
    expect(getBatch('b_failed').status).toBe('failed');
});

test('active-batch cap frees after reconciliation', async () => {
    const batches = {};
    for (let i = 0; i < 5; i++) {
        batches[`b${i}`] = {
            userId: 'u1', status: 'processing',
            createdAt: ts(5 * HOUR), updatedAt: ts(5 * HOUR),
        };
    }
    setBatches(batches);

    expect(await activeCount('u1')).toBe(5); // hard-blocked at the cap

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.reconciled).toBe(5);
    expect(await activeCount('u1')).toBe(0); // slots self-healed
});

test('one per-doc write failure does not abort the sweep', async () => {
    setBatches({
        b_bad:  { userId: 'u1', status: 'processing', createdAt: ts(5 * HOUR) },
        b_good: { userId: 'u1', status: 'processing', createdAt: ts(5 * HOUR) },
    });

    // Force update() to reject only for b_bad.
    const docRef = admin.firestore().collection('prospectIntel').doc('probe');
    const proto  = Object.getPrototypeOf(docRef);
    const origUpdate = proto.update;
    proto.update = function (data) {
        if (this.id === 'b_bad') return Promise.reject(new Error('boom'));
        return origUpdate.call(this, data);
    };

    try {
        const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });
        expect(r.failed).toBe(1);
        expect(r.reconciled).toBe(1);
        expect(getBatch('b_good').status).toBe('failed');
        expect(getBatch('b_bad').status).toBe('processing'); // update rejected → untouched
    } finally {
        proto.update = origUpdate;
    }
});

// ── Threshold semantics ─────────────────────────────────────────────────────────

test('batch exactly at the threshold is NOT reaped (boundary is exclusive)', async () => {
    setBatches({
        b_edge: { userId: 'u1', status: 'processing', createdAt: ts(3 * HOUR), updatedAt: ts(3 * HOUR) },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.reconciled).toBe(0);
    expect(r.skipped).toBe(1);
});

test('threshold comes from PROSPECT_BATCH_STALE_HOURS env when no option given', async () => {
    process.env.PROSPECT_BATCH_STALE_HOURS = '1';
    setBatches({
        b: { userId: 'u1', status: 'processing', createdAt: ts(2 * HOUR), updatedAt: ts(2 * HOUR) },
    });

    const r = await reconcileStuckBatches({ now: NOW }); // 2h old > 1h env threshold

    expect(r.staleHours).toBe(1);
    expect(r.reconciled).toBe(1);
});

test('default threshold is 3h when env is unset — a 2h-old batch is left alone', async () => {
    setBatches({
        b: { userId: 'u1', status: 'processing', createdAt: ts(2 * HOUR), updatedAt: ts(2 * HOUR) },
    });

    const r = await reconcileStuckBatches({ now: NOW }); // no staleHours, no env

    expect(r.staleHours).toBe(3);
    expect(r.reconciled).toBe(0);
});

test('batch with no datable timestamp is skipped, never reaped', async () => {
    setBatches({
        b_nodate: { userId: 'u1', status: 'processing' },
    });

    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });

    expect(r.skipped).toBe(1);
    expect(r.reconciled).toBe(0);
    expect(getBatch('b_nodate').status).toBe('processing');
});

test('empty collection returns a clean zero summary (no throw)', async () => {
    const r = await reconcileStuckBatches({ now: NOW, staleHours: 3 });
    expect(r).toMatchObject({ scanned: 0, reconciled: 0, skipped: 0, failed: 0 });
});

// ── Helper unit tests ───────────────────────────────────────────────────────────

test('_toMillis handles Firestore timestamp, Date, number, and null', () => {
    const d = new Date(NOW);
    expect(_toMillis(admin.firestore.Timestamp.fromDate(d))).toBe(NOW);
    expect(_toMillis(d)).toBe(NOW);
    expect(_toMillis(NOW)).toBe(NOW);
    expect(_toMillis({ toMillis: () => NOW })).toBe(NOW);
    expect(_toMillis({ _seconds: NOW / 1000 })).toBe(NOW);
    expect(_toMillis(null)).toBeNull();
    expect(_toMillis(undefined)).toBeNull();
    expect(_toMillis({})).toBeNull();
});

test('_stalenessAnchorMs picks the most recent available timestamp', () => {
    const anchor = _stalenessAnchorMs({
        createdAt:           ts(6 * HOUR),
        processingStartedAt: ts(5 * HOUR),
        updatedAt:           ts(1 * HOUR), // most recent
    });
    expect(anchor).toBe(NOW - 1 * HOUR);

    expect(_stalenessAnchorMs({ createdAt: ts(4 * HOUR) })).toBe(NOW - 4 * HOUR);
    expect(_stalenessAnchorMs({})).toBeNull();
});

test('reconcileStuckBatches is exported as a function', () => {
    const mod = require('../scheduled/prospectBatchReconciler');
    expect(typeof mod.reconcileStuckBatches).toBe('function');
});
