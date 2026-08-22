'use strict';

/**
 * PR #98 — semantic cache contract + publication-window freshness.
 * The cache stores BLS-derived SEMANTIC facts only; all presentation (county label, provenance, source URL,
 * widening wording) is rebuilt by current code after the read, so a formatter change is never masked by a
 * cached string. Old finished-result docs self-invalidate as misses. Freshness uses publication windows +
 * a short retry so a re-landed older/preliminary observation never re-acquires a normal 90-day TTL.
 */

const svc = require('../utils/industryEconomicsService');

const JUNK = { fips5: '13121', county: 'Fulton County', state: 'GA', naicsCode: '562119', naicsLabel: 'Other Waste Collection' };
const day = (d) => d.toISOString().slice(0, 10);

// In-memory cache backed by the REAL validity gate (readSemanticFromCacheDoc), so version/expiry/floor logic
// is exercised exactly as in production — no Firestore, no cross-test pollution.
function makeCache(seed) {
    const store = new Map();
    if (seed) for (const [k, v] of Object.entries(seed)) store.set(k, v);
    return {
        store,
        checkCache: async (key, now) => svc.readSemanticFromCacheDoc(store.get(key), now),
        writeCache: async (key, economics, expiresAt) => { store.set(key, { economics, expiresAt, cacheKey: key }); }
    };
}
function spyFetch(result) { const s = { n: 0 }; s.fn = async () => { s.n++; return result; }; return s; }

const COLS = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs', 'oty_annual_avg_emplvl_pct_chg'];
const csv = (rows) => COLS.join(',') + '\n' + rows.map(r => COLS.map(c => (r[c] != null ? r[c] : '')).join(',')).join('\n') + '\n' + 'x'.repeat(100);
const WIDEN_ROWS = [
    { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
    { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1' }
];
const semanticDoc = (metrics, dataYear = 2025, expiresAt = new Date('2030-01-01')) => ({
    economics: { cacheContractVersion: svc.CACHE_CONTRACT_VERSION, dataYear, metrics }, expiresAt
});
const EXT = (v, code) => ({ state: 'external', value: v, effectiveNaics: code });
const SEM_5621 = { employment: EXT(1180, '5621'), yoy: EXT(8.1, '5621'), establishments: EXT(68, '5621') };

describe('1. OLD CACHE SHAPE → treated as a MISS (self-healing migration)', () => {
    test('a pre-#98 finished-result doc (no cacheContractVersion) is rejected; BLS is re-fetched and re-cached as semantic', async () => {
        // Pre-#98 finished object with FROZEN stale provenance (bare FIPS, no Source URL).
        const oldDoc = { economics: { status: 'ok', county: '13121', fips5: '13121', dataYear: 2025,
            metrics: { employment: { state: 'external', value: 1180, effectiveNaics: '5621',
                provenance: 'BLS QCEW annual averages, 2025, 13121, GA — private ownership, NAICS 5621 Waste Collection' } } },
            expiresAt: new Date('2030-01-01') };
        const cache = makeCache({ '13121_562119': oldDoc });
        const fetch = spyFetch({ text: csv(WIDEN_ROWS), dataYear: 2025 });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: fetch.fn, now: new Date('2026-08-21') });
        expect(fetch.n).toBe(1);                                             // MISS → refetched (pre-#98: returned verbatim, fetch NOT called)
        expect(r.metrics.employment.provenance).toContain('Fulton County');  // rebuilt by current code
        expect(r.metrics.employment.provenance).toContain('Source: https://data.bls.gov/cew/data/api/2025/a/area/13121.csv');
        expect(r.metrics.employment.provenance).not.toContain(', 13121, GA'); // no bare-FIPS
        const rewritten = cache.store.get('13121_562119').economics;
        expect(rewritten.cacheContractVersion).toBe(svc.CACHE_CONTRACT_VERSION);                      // now semantic shape
        expect(rewritten.metrics.employment.provenance).toBeUndefined();     // no presentation stored
    });

    test('readSemanticFromCacheDoc unit: old shape / wrong version / floor / expiry all → null', () => {
        const now = new Date('2026-08-21');
        expect(svc.readSemanticFromCacheDoc({ economics: { status: 'ok', metrics: {} }, expiresAt: new Date('2030-01-01') }, now)).toBeNull(); // no version
        expect(svc.readSemanticFromCacheDoc({ economics: { cacheContractVersion: 1, dataYear: 2025 }, expiresAt: new Date('2030-01-01') }, now)).toBeNull(); // wrong version
        expect(svc.readSemanticFromCacheDoc(semanticDoc(SEM_5621, 2023), now)).toBeNull(); // floor: 2023 < 2024
        expect(svc.readSemanticFromCacheDoc(semanticDoc(SEM_5621, 2025, new Date('2026-01-01')), now)).toBeNull(); // expired
        expect(svc.readSemanticFromCacheDoc(semanticDoc(SEM_5621, 2025), now)).toBeTruthy(); // valid
    });
});

describe('2/3. SEMANTIC HIT rebuilds current presentation without refetch', () => {
    test('hit: county label + provenance + Source URL reconstructed; BLS NOT fetched', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc(SEM_5621) });
        const fetch = spyFetch({ text: 'SHOULD_NOT_BE_USED' });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: fetch.fn, now: new Date('2026-08-21') });
        expect(fetch.n).toBe(0);                                             // pure cache hit
        expect(r.metrics.employment.value).toBe(1180);
        expect(r.metrics.employment.provenance).toContain('Fulton County');  // ← the live bug, now fixed on hit
        expect(r.metrics.employment.provenance).toContain('Source: https://data.bls.gov/cew/data/api/2025/a/area/13121.csv');
        expect(r.metrics.employment.provenance).toContain('reported at NAICS 5621'); // widening disclosure rebuilt
    });

    test('PRESENTATION CHANGE: the seeded semantic doc carries NO provenance, yet the hit output equals the CURRENT formatter (buildResult) byte-for-byte', async () => {
        const sem = semanticDoc(SEM_5621).economics;
        const cache = makeCache({ '13121_562119': { economics: sem, expiresAt: new Date('2030-01-01') } });
        const fetch = spyFetch({ text: 'SHOULD_NOT_BE_USED' });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: fetch.fn, now: new Date('2026-08-21') });
        expect(fetch.n).toBe(0);
        const expected = svc.buildResult(JUNK, sem);                         // rebuild from the SAME semantics
        expect(r.metrics.employment.provenance).toBe(expected.metrics.employment.provenance);
        expect(r.metrics.yoy.provenance).toBe(expected.metrics.yoy.provenance);
        expect(r.sourceUrl).toBe(expected.sourceUrl);
    });

    test('COUNTY LABEL on hit comes from the FRESH request arg (city_table path shows Fulton County, never bare 13121)', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc(SEM_5621) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-08-21') });
        expect(r.county).toBe('Fulton County');
        expect(r.metrics.establishments.provenance).toMatch(/2025, Fulton County, GA/);
        expect(r.metrics.establishments.provenance).not.toContain('2025, 13121, GA');
    });
});

describe('4/13. sourceUrl BYTE-EQUALITY through the cache', () => {
    test('hit reconstructs buildSourceUrl(landedYear, fips5)', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc(SEM_5621, 2025) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-08-21') });
        expect(r.sourceUrl).toBe(svc.buildSourceUrl(2025, '13121'));
    });
    test('a semantic entry for a fallback year reconstructs that year\'s URL', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc(SEM_5621, 2024) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-05-10') });
        expect(r.sourceUrl).toBe('https://data.bls.gov/cew/data/api/2024/a/area/13121.csv');
    });
});

describe('8/9/11. semantic round-trip preserves BLS distinctions', () => {
    test('8. true zero survives as an observation (value 0, external)', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc({ employment: EXT(0, '562119'), yoy: EXT(0, '562119'), establishments: EXT(0, '562119') }) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-08-21') });
        expect(r.metrics.employment.state).toBe('external');
        expect(r.metrics.employment.value).toBe(0);
    });
    test('9. suppression survives as withheld/bls_suppressed, never zero; reason rebuilt', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc({
            employment: { state: 'withheld', withholdCause: 'bls_suppressed' }, yoy: { state: 'withheld', withholdCause: 'bls_suppressed' }, establishments: { state: 'withheld', withholdCause: 'bls_suppressed' } }) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-08-21') });
        expect(r.metrics.employment.state).toBe('withheld');
        expect(r.metrics.employment.withholdCause).toBe('bls_suppressed');
        expect(r.metrics.employment.value).toBeUndefined();
        expect(r.metrics.employment.reason).toContain('non-disclosure');
    });
    test('11. metrics reconstruct from THEIR OWN landed level (employment 562119, establishments widened 5621)', async () => {
        const cache = makeCache({ '13121_562119': semanticDoc({ employment: EXT(1200, '562119'), yoy: EXT(3.0, '562119'), establishments: EXT(250, '5621') }) });
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: spyFetch({}).fn, now: new Date('2026-08-21') });
        expect(r.metrics.employment.effectiveNaics).toBe('562119');
        expect(r.metrics.employment.widened).toBe(false);
        expect(r.metrics.establishments.effectiveNaics).toBe('5621');
        expect(r.metrics.establishments.widened).toBe(true);
        expect(r.metrics.establishments.provenance).toContain('not disclosed');
    });
});

describe('A–F. publication-window freshness (deterministic, no probe)', () => {
    test('expectedLatestAnnualYear step function (Jun–Dec ⇒ C-1, Jan–May ⇒ C-2)', () => {
        expect(svc.expectedLatestAnnualYear(new Date('2026-01-15'))).toBe(2024);
        expect(svc.expectedLatestAnnualYear(new Date('2026-05-31'))).toBe(2024);
        expect(svc.expectedLatestAnnualYear(new Date('2026-06-01'))).toBe(2025);
        expect(svc.expectedLatestAnnualYear(new Date('2026-08-21'))).toBe(2025);
    });

    test('A. quiet pre-release write → normal 90d, capped before the next window', () => {
        expect(day(svc.computeExpiry(new Date('2026-01-15'), 2024))).toBe('2026-04-15'); // min(90d, →Jun 1)
    });
    test('C. lagging (older year re-landed inside/at the new-year window) → SHORT retry (14d), NOT 90d', () => {
        expect(day(svc.computeExpiry(new Date('2026-06-15'), 2024))).toBe('2026-06-29');
    });
    test('C-real. the live 2026-08-21/2025 write is capped at the Sep revision boundary, not +90d', () => {
        expect(day(svc.computeExpiry(new Date('2026-08-21'), 2025))).toBe('2026-09-01');
    });
    test('D. newer year lands in quiet July → normal, capped at the Sep revision window', () => {
        expect(day(svc.computeExpiry(new Date('2026-07-05'), 2025))).toBe('2026-09-01');
    });
    test('E-window. a write DURING the revision window (September) gets SHORT retry so a revision is picked up', () => {
        expect(day(svc.computeExpiry(new Date('2026-09-10'), 2025))).toBe('2026-09-24');
    });
    test('B. an old-year entry cannot survive into the new-year window (expiry forces a MISS/refetch)', () => {
        // Entry from case A (expiresAt 2026-04-15, dataYear 2024) read at 2026-06-15 → null → miss.
        const doc = semanticDoc(SEM_5621, 2024, new Date('2026-04-15'));
        expect(svc.readSemanticFromCacheDoc(doc, new Date('2026-06-15'))).toBeNull();
    });
    test('E. a preliminary-year entry cannot survive across the finalization window', () => {
        const doc = semanticDoc(SEM_5621, 2025, new Date('2026-09-01'));
        expect(svc.readSemanticFromCacheDoc(doc, new Date('2026-09-10'))).toBeNull();
    });

    test('F. widened old period does not mask newly-disclosed specific data after rollover', async () => {
        const cache = makeCache();
        // (i) 2024: 562119 suppressed → lands 5621; cached widened, expiry capped at the Jun window.
        const r1 = await svc.getStructuralGrowth(JUNK, { ...cache,
            fetchLatestAnnualArea: async () => ({ text: csv([
                { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
                { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '4000', annual_avg_estabs: '250', oty_annual_avg_emplvl_pct_chg: '1.2' }
            ]), dataYear: 2024 }), now: new Date('2026-01-15') });
        expect(r1.metrics.employment.effectiveNaics).toBe('5621');
        expect(r1.metrics.employment.widened).toBe(true);
        // (ii) after the June rollover the entry has expired; a refetch of the newer year now discloses 562119.
        const r2 = await svc.getStructuralGrowth(JUNK, { ...cache,
            fetchLatestAnnualArea: async () => ({ text: csv([
                { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1300', annual_avg_estabs: '90', oty_annual_avg_emplvl_pct_chg: '5.0' }
            ]), dataYear: 2025 }), now: new Date('2026-07-05') });
        expect(r2.metrics.employment.effectiveNaics).toBe('562119'); // rediscovered — not masked by the prior widened entry
        expect(r2.metrics.employment.widened).toBe(false);
        expect(r2.dataYear).toBe(2025);
    });
});

describe('14. no behavior regression: source_error never cached, never widens', () => {
    test('a source_error result is returned withheld and NOT written to cache', async () => {
        const cache = makeCache();
        const r = await svc.getStructuralGrowth(JUNK, { ...cache, fetchLatestAnnualArea: async () => ({ error: 'source_error', detail: 'transport' }), now: new Date('2026-08-21') });
        expect(r.status).toBe('withheld');
        expect(r.metrics.employment.withholdCause).toBe('source_error');
        expect(cache.store.size).toBe(0); // nothing cached
    });
});
