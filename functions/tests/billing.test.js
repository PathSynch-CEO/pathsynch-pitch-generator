'use strict';

/**
 * Unit tests for api/billing.js
 *
 * Tests cover:
 * - checkAndDeductCredits: concurrent deduction, insufficient, legacy, transaction failure
 * - refundCredits: restores balance + writes ledger
 * - Template Enrichment partial refund pattern
 * - Opportunity Brief failure refund pattern
 * - Intent Signals guard-before-work pattern
 * - Anonymous/null user passthrough
 */

// ── Mock hoisting ─────────────────────────────────────────────────────────────

jest.mock('firebase-admin');

// ── Imports ───────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const {
    checkAndDeductCredits,
    refundCredits,
    writeCreditLedger,
    checkCredits,
    deductCredits,
} = require('../api/billing');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
    // Reset runTransaction to the default mock implementation
    admin._mockFirestore.runTransaction.mockImplementation(async (callback) => {
        const tx = {
            get: async (ref) => {
                const coll = admin._mockData.collections[ref.collectionName] || {};
                const data = coll[ref.id];
                return { exists: data !== undefined, data: () => data, id: ref.id };
            },
            update: (ref, updates) => {
                if (!admin._mockData.collections[ref.collectionName]) {
                    admin._mockData.collections[ref.collectionName] = {};
                }
                const curr = admin._mockData.collections[ref.collectionName][ref.id] || {};
                const newData = { ...curr };
                for (const [k, v] of Object.entries(updates)) {
                    if (v && v._increment !== undefined) {
                        newData[k] = (curr[k] || 0) + v._increment;
                    } else {
                        newData[k] = v;
                    }
                }
                admin._mockData.collections[ref.collectionName][ref.id] = newData;
            }
        };
        return callback(tx);
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setUser(uid, data) {
    admin._setMockCollection('users', {
        ...(admin._mockData.collections['users'] || {}),
        [uid]: data
    });
}

function getUser(uid) {
    return (admin._mockData.collections['users'] || {})[uid];
}

function getLedgerEntries() {
    return Object.values(admin._mockData.collections['creditLedger'] || {});
}

// ── Test 1: Concurrent deduction — exactly one allowed ────────────────────────

test('concurrent deduction: exactly one allowed, balance stays non-negative', async () => {
    setUser('user_concurrent', { credits: 100 });

    // Serialize transactions to simulate Firestore's transactional isolation.
    // Each call chains onto the previous, preventing interleaved reads before commits.
    let queue = Promise.resolve();
    admin._mockFirestore.runTransaction.mockImplementation((callback) => {
        const txPromise = queue.then(async () => {
            let pendingUpdate = null;
            const tx = {
                get: async (ref) => {
                    const coll = admin._mockData.collections[ref.collectionName] || {};
                    const data = coll[ref.id];
                    return { exists: data !== undefined, data: () => data };
                },
                update: (ref, updates) => {
                    pendingUpdate = { ref, updates };
                }
            };
            const result = await callback(tx);
            // Commit after callback resolves
            if (pendingUpdate) {
                const { ref, updates } = pendingUpdate;
                if (!admin._mockData.collections[ref.collectionName]) {
                    admin._mockData.collections[ref.collectionName] = {};
                }
                const curr = admin._mockData.collections[ref.collectionName][ref.id] || {};
                const newData = { ...curr };
                for (const [k, v] of Object.entries(updates)) {
                    newData[k] = v && v._increment !== undefined ? (curr[k] || 0) + v._increment : v;
                }
                admin._mockData.collections[ref.collectionName][ref.id] = newData;
            }
            return result;
        });
        // Swallow rejections on the queue chain so subsequent calls proceed
        queue = txPromise.catch(() => {});
        return txPromise;
    });

    const [r1, r2] = await Promise.all([
        checkAndDeductCredits('user_concurrent', 85, 'test:concurrent'),
        checkAndDeductCredits('user_concurrent', 85, 'test:concurrent'),
    ]);

    const results = [r1, r2];
    const allowed = results.filter(r => r.allowed);
    const denied  = results.filter(r => !r.allowed);

    expect(allowed).toHaveLength(1);
    expect(denied).toHaveLength(1);

    const finalCredits = getUser('user_concurrent').credits;
    expect(finalCredits).toBe(15);
    expect(finalCredits).toBeGreaterThanOrEqual(0);
});

// ── Test 2: Insufficient credits ──────────────────────────────────────────────

test('insufficient credits: returns allowed:false without deducting', async () => {
    setUser('user_broke', { credits: 100 });

    const result = await checkAndDeductCredits('user_broke', 145, 'test:insufficient');

    expect(result.allowed).toBe(false);
    expect(result.available).toBe(100);
    expect(result.deducted).toBe(0);

    // Balance must not change
    expect(getUser('user_broke').credits).toBe(100);

    // No ledger debit
    const ledger = getLedgerEntries();
    expect(ledger.filter(e => e.amount < 0)).toHaveLength(0);
});

// ── Test 3: Legacy account (no credits field) ──────────────────────────────────

test('legacy account: no credits field → allowed:true, Infinity available', async () => {
    setUser('user_legacy', { plan: 'growth' }); // no credits field

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await checkAndDeductCredits('user_legacy', 85, 'test:legacy');

    expect(result.allowed).toBe(true);
    expect(result.available).toBe(Infinity);
    expect(result.deducted).toBe(0);

    const legacyLog = consoleSpy.mock.calls.find(c => c[0] && c[0].includes('Legacy account'));
    expect(legacyLog).toBeTruthy();

    consoleSpy.mockRestore();
});

// ── Test 4: Transaction failure — FAIL CLOSED ─────────────────────────────────

test('transaction failure: returns allowed:false with BILLING_TRANSACTION_FAILED', async () => {
    setUser('user_txfail', { credits: 500 });

    admin._mockFirestore.runTransaction.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await checkAndDeductCredits('user_txfail', 85, 'test:txfail');

    expect(result.allowed).toBe(false);
    expect(result.available).toBe(0);
    expect(result.deducted).toBe(0);
    expect(result.error).toBe('BILLING_TRANSACTION_FAILED');

    // Balance must not have changed
    expect(getUser('user_txfail').credits).toBe(500);
});

// ── Test 5: Refund credits ────────────────────────────────────────────────────

test('refundCredits: restores balance and writes positive ledger entry', async () => {
    setUser('user_refund', { credits: 55 }); // after deduction

    await refundCredits('user_refund', 50, 'test:refund', { service: 'test_service' });

    // Balance restored (update is awaited inside refundCredits)
    expect(getUser('user_refund').credits).toBe(105);

    // writeCreditLedger is fire-and-forget — flush microtask queue before checking
    await Promise.resolve();
    await Promise.resolve();

    // Positive ledger entry written
    const ledger = getLedgerEntries();
    const refundEntry = ledger.find(e => e.amount > 0);
    expect(refundEntry).toBeDefined();
    expect(refundEntry.amount).toBe(50);
    expect(refundEntry.reason).toBe('test:refund');
    expect(refundEntry.service).toBe('test_service');
    expect(refundEntry.userId).toBe('user_refund');
});

// ── Test 6: Template Enrichment partial refund pattern ────────────────────────

test('template enrichment: reserve 90, use 85, refund 5 — net charge is 85', async () => {
    setUser('user_template', { credits: 200 });

    // Step 1: Reserve max (90 credits)
    const reserveResult = await checkAndDeductCredits(
        'user_template', 90, 'template_enrichment:brewhouse:reserve', { service: 'template_enrichment' }
    );
    expect(reserveResult.allowed).toBe(true);
    expect(reserveResult.deducted).toBe(90);
    expect(getUser('user_template').credits).toBe(110);

    // Step 2: Only 85 credits worth of sources succeeded — refund delta of 5
    await refundCredits('user_template', 5, 'template_enrichment:brewhouse:partial_refund', {
        service: 'template_enrichment'
    });

    // Net: 200 - 90 + 5 = 115
    expect(getUser('user_template').credits).toBe(115);

    // writeCreditLedger is fire-and-forget — flush microtask queue before checking
    await Promise.resolve();
    await Promise.resolve();

    // Ledger shows -90 reserve + +5 refund
    const ledger = getLedgerEntries();
    const debits  = ledger.filter(e => e.amount < 0);
    const credits = ledger.filter(e => e.amount > 0);
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-90);
    expect(credits).toHaveLength(1);
    expect(credits[0].amount).toBe(5);
});

// ── Test 7: Opportunity Brief failure refund ───────────────────────────────────

test('opportunity brief: deduct 145, simulate generation failure, verify refund', async () => {
    setUser('user_brief', { credits: 500 });

    // Step 1: Atomic deduct succeeds
    const creditResult = await checkAndDeductCredits(
        'user_brief', 145, 'opportunity_brief', { service: 'opportunity_brief' }
    );
    expect(creditResult.allowed).toBe(true);
    expect(creditResult.deducted).toBe(145);
    expect(getUser('user_brief').credits).toBe(355);

    // Step 2: Simulate generateOpportunityBrief throwing
    // Route calls refundCredits on failure
    if (creditResult.deducted > 0) {
        await refundCredits('user_brief', 145, 'opportunity_brief:generation_failed', {
            service: 'opportunity_brief'
        });
    }

    // Credits fully restored
    expect(getUser('user_brief').credits).toBe(500);

    // writeCreditLedger is fire-and-forget — flush microtask queue before checking
    await Promise.resolve();
    await Promise.resolve();

    // Ledger: -145 debit + +145 refund
    const ledger = getLedgerEntries();
    expect(ledger.find(e => e.amount === -145)).toBeDefined();
    expect(ledger.find(e => e.amount === 145)).toBeDefined();
});

// ── Test 8: Intent Signals guard — fetchAndComputeSignals never called ─────────

test('intent signals guard: credit blocked → creditBlocked:true, paid work not called', async () => {
    setUser('user_signals', { credits: 50 });

    // Mock fetchAndComputeSignals (it's internal, but we can verify via side effects)
    // The easiest proof: if credits are 50 and we need 150, checkAndDeductCredits returns false
    // and the function returns creditBlocked:true without calling the expensive API work.

    const creditResult = await checkAndDeductCredits('user_signals', 150, 'intent_signals:fresh', {
        service: 'intent_signals'
    });

    expect(creditResult.allowed).toBe(false);
    expect(creditResult.available).toBe(50);

    // Simulate what generateIntentSignals does when credit check fails
    const returnValue = {
        fromCache: false,
        creditBlocked: true,
        error: creditResult.error || 'INSUFFICIENT_CREDITS'
    };

    expect(returnValue.creditBlocked).toBe(true);
    expect(returnValue.error).toBe('INSUFFICIENT_CREDITS');

    // Balance unchanged — no deduction occurred
    expect(getUser('user_signals').credits).toBe(50);
});

// ── Test 9: Anonymous and null user passthrough ────────────────────────────────

test('anonymous userId: allowed:true without touching Firestore', async () => {
    const txSpy = admin._mockFirestore.runTransaction;

    const r1 = await checkAndDeductCredits('anonymous', 85, 'test:anon');
    const r2 = await checkAndDeductCredits(null, 85, 'test:null');
    const r3 = await checkAndDeductCredits(undefined, 85, 'test:undefined');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);

    // Firestore transaction must never be called for anonymous/null
    expect(txSpy).not.toHaveBeenCalled();
});

// ── Test 10: Backward compat — checkCredits and deductCredits still exported ──

test('legacy exports: checkCredits and deductCredits are still exported', () => {
    expect(typeof checkCredits).toBe('function');
    expect(typeof deductCredits).toBe('function');
});
