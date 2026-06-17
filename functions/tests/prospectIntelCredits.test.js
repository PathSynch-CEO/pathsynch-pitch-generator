'use strict';

/**
 * Tests for chargeProspectEnrichmentCreditOnce() — atomic, idempotent
 * per-prospect credit deduction in prospectIntelService.js.
 *
 * Also tests preflight credit check (402) in prospectIntelRoutes.js pattern.
 */

// ── Mock hoisting ─────────────────────────────────────────────────────────────

jest.mock('firebase-admin');
jest.mock('google-auth-library', () => ({ GoogleAuth: jest.fn() }));
jest.mock('../services/googlePlaces', () => ({ lookupProspectPlace: jest.fn() }));
jest.mock('../config/industryTaxonomy', () => ({
    findIndustry: jest.fn(),
    findSubIndustry: jest.fn(),
}));
jest.mock('../config/reportProfiles', () => ({ getReportProfile: jest.fn() }));
jest.mock('../services/tools/techStackDetector', () => ({ detectTechStack: jest.fn() }));
jest.mock('../services/tools/gbpGrader', () => ({ gradeGBP: jest.fn() }));
jest.mock('../services/enrichmentCache', () => ({
    getPlacesLookup: jest.fn(),
    setPlacesLookup: jest.fn(),
}));
jest.mock('../services/marketContextResolver', () => ({ matchProspectToReport: jest.fn() }));
jest.mock('../services/reviewHealthEnqueue', () => ({ enqueueReviewHealthTask: jest.fn() }));

// ── Imports ───────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const { chargeProspectEnrichmentCreditOnce } = require('../services/prospectIntelService');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
    // Default: use the built-in MockTransaction from the firebase-admin mock
    // (supports tx.get, tx.set, tx.update with _commit)
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setUser(uid, data) {
    admin._setMockCollection('users', {
        ...(admin._mockData.collections['users'] || {}),
        [uid]: data,
    });
}

function getUser(uid) {
    return (admin._mockData.collections['users'] || {})[uid];
}

function getLedgerDoc(key) {
    return (admin._mockData.collections['creditLedger'] || {})[key];
}

// ── Test 1: Successful charge — deducts credits + creates ledger ─────────────

test('successful charge: deducts 15 credits and creates ledger doc', async () => {
    setUser('user_a', { credits: 100 });

    const result = await chargeProspectEnrichmentCreditOnce('user_a', 'batch_1', 'prospect_1');

    expect(result.charged).toBe(true);
    expect(result.reason).toBe('charged');

    // Balance decremented
    expect(getUser('user_a').credits).toBe(85);

    // Ledger doc created with correct fields
    const ledger = getLedgerDoc('prospect_enrich:prospect_1');
    expect(ledger).toBeDefined();
    expect(ledger.userId).toBe('user_a');
    expect(ledger.amount).toBe(-15);
    expect(ledger.reason).toBe('prospect_enrichment');
    expect(ledger.service).toBe('prospect_intel');
    expect(ledger.batchId).toBe('batch_1');
    expect(ledger.prospectId).toBe('prospect_1');
    expect(ledger.idempotencyKey).toBe('prospect_enrich:prospect_1');
    expect(ledger.chargedOn).toBe('success');
});

// ── Test 2: Idempotency — second call for same prospect skips charge ─────────

test('idempotency: second call for same prospect returns already_charged', async () => {
    setUser('user_b', { credits: 100 });

    const r1 = await chargeProspectEnrichmentCreditOnce('user_b', 'batch_1', 'prospect_2');
    expect(r1.charged).toBe(true);
    expect(getUser('user_b').credits).toBe(85);

    const r2 = await chargeProspectEnrichmentCreditOnce('user_b', 'batch_1', 'prospect_2');
    expect(r2.charged).toBe(false);
    expect(r2.reason).toBe('already_charged');

    // Balance unchanged after second call
    expect(getUser('user_b').credits).toBe(85);
});

// ── Test 3: Insufficient credits — no deduction, no ledger ───────────────────

test('insufficient credits: returns insufficient_credits, no deduction', async () => {
    setUser('user_c', { credits: 10 });

    const result = await chargeProspectEnrichmentCreditOnce('user_c', 'batch_1', 'prospect_3');

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('insufficient_credits');
    expect(result.available).toBe(10);

    // Balance unchanged
    expect(getUser('user_c').credits).toBe(10);

    // No ledger doc
    expect(getLedgerDoc('prospect_enrich:prospect_3')).toBeUndefined();
});

// ── Test 4: Zero credits — insufficient ──────────────────────────────────────

test('zero credits: returns insufficient_credits', async () => {
    setUser('user_d', { credits: 0 });

    const result = await chargeProspectEnrichmentCreditOnce('user_d', 'batch_1', 'prospect_4');

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('insufficient_credits');
    expect(result.available).toBe(0);
});

// ── Test 5: Exact credits — charges successfully ─────────────────────────────

test('exact credits: 15 credits deducted to 0', async () => {
    setUser('user_e', { credits: 15 });

    const result = await chargeProspectEnrichmentCreditOnce('user_e', 'batch_1', 'prospect_5');

    expect(result.charged).toBe(true);
    expect(getUser('user_e').credits).toBe(0);
});

// ── Test 6: Transaction failure — returns transaction_failed ─────────────────

test('transaction failure: returns charged:false with transaction_failed', async () => {
    setUser('user_f', { credits: 500 });

    admin._mockFirestore.runTransaction.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await chargeProspectEnrichmentCreditOnce('user_f', 'batch_1', 'prospect_6');

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('transaction_failed');

    // Balance unchanged
    expect(getUser('user_f').credits).toBe(500);
});

// ── Test 7: Non-existent user doc — insufficient_credits (not crash) ─────────

test('non-existent user: returns insufficient_credits gracefully', async () => {
    // user_g never created — no doc in users collection

    const result = await chargeProspectEnrichmentCreditOnce('user_g', 'batch_1', 'prospect_7');

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('insufficient_credits');
    expect(result.available).toBe(0);
});

// ── Test 8: Custom creditsPerProspect via options ────────────────────────────

test('custom creditsPerProspect: charges specified amount', async () => {
    setUser('user_h', { credits: 100 });

    const result = await chargeProspectEnrichmentCreditOnce('user_h', 'batch_1', 'prospect_8', {
        creditsPerProspect: 25,
    });

    expect(result.charged).toBe(true);
    expect(getUser('user_h').credits).toBe(75);

    const ledger = getLedgerDoc('prospect_enrich:prospect_8');
    expect(ledger.amount).toBe(-25);
    expect(ledger.creditsPerProspect).toBe(25);
});

// ── Test 9: Concurrent charges — serialized by transaction ───────────────────

test('concurrent charges for different prospects: both succeed if balance allows', async () => {
    setUser('user_i', { credits: 50 });

    // Run two charges in parallel for different prospects
    const [r1, r2] = await Promise.all([
        chargeProspectEnrichmentCreditOnce('user_i', 'batch_1', 'prospect_9a'),
        chargeProspectEnrichmentCreditOnce('user_i', 'batch_1', 'prospect_9b'),
    ]);

    // Both should charge (50 >= 15+15=30)
    expect(r1.charged).toBe(true);
    expect(r2.charged).toBe(true);
    expect(getUser('user_i').credits).toBe(20);
});

// ── Test 10: Concurrent charges exhaust balance ──────────────────────────────

test('concurrent charges: one fails when balance is exhausted', async () => {
    setUser('user_j', { credits: 20 });

    // Serialize transactions (like the billing.test.js concurrent test)
    let queue = Promise.resolve();
    admin._mockFirestore.runTransaction.mockImplementation((callback) => {
        const txPromise = queue.then(async () => {
            const pendingWrites = [];
            const tx = {
                get: async (ref) => {
                    const coll = admin._mockData.collections[ref.collectionName] || {};
                    const data = coll[ref.id];
                    return { exists: data !== undefined, data: () => data, id: ref.id };
                },
                update: (ref, updates) => {
                    pendingWrites.push({ type: 'update', ref, updates });
                    return tx;
                },
                set: (ref, data) => {
                    pendingWrites.push({ type: 'set', ref, data });
                    return tx;
                },
            };
            const result = await callback(tx);
            // Commit writes
            for (const w of pendingWrites) {
                if (!admin._mockData.collections[w.ref.collectionName]) {
                    admin._mockData.collections[w.ref.collectionName] = {};
                }
                if (w.type === 'set') {
                    admin._mockData.collections[w.ref.collectionName][w.ref.id] = w.data;
                } else if (w.type === 'update') {
                    const curr = admin._mockData.collections[w.ref.collectionName][w.ref.id] || {};
                    const newData = { ...curr };
                    for (const [k, v] of Object.entries(w.updates)) {
                        if (v && v._increment !== undefined) {
                            newData[k] = (curr[k] || 0) + v._increment;
                        } else {
                            newData[k] = v;
                        }
                    }
                    admin._mockData.collections[w.ref.collectionName][w.ref.id] = newData;
                }
            }
            return result;
        });
        queue = txPromise.catch(() => {});
        return txPromise;
    });

    const [r1, r2] = await Promise.all([
        chargeProspectEnrichmentCreditOnce('user_j', 'batch_1', 'prospect_10a'),
        chargeProspectEnrichmentCreditOnce('user_j', 'batch_1', 'prospect_10b'),
    ]);

    const results = [r1, r2];
    const charged = results.filter(r => r.charged);
    const skipped = results.filter(r => !r.charged);

    // Exactly one should charge (20 >= 15 but 20 < 30)
    expect(charged).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('insufficient_credits');

    // Final balance should be 5
    expect(getUser('user_j').credits).toBe(5);
});

// ── Test 11: Preflight 402 pattern (route-level) ─────────────────────────────

test('preflight pattern: checkCredits returns allowed:false for insufficient balance', async () => {
    const { checkCredits } = require('../api/billing');
    setUser('user_k', { credits: 20 });

    // 3 prospects × 15 = 45 required
    const result = await checkCredits('user_k', 45);

    expect(result.allowed).toBe(false);
    expect(result.available).toBe(20);
});

// ── Test 12: Export verification ─────────────────────────────────────────────

test('chargeProspectEnrichmentCreditOnce is exported from prospectIntelService', () => {
    const svc = require('../services/prospectIntelService');
    expect(typeof svc.chargeProspectEnrichmentCreditOnce).toBe('function');
});
