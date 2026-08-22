'use strict';

/**
 * v3 metrics — Avg Weekly Wage (with same-level OTY%) + Location Quotient in the Structural Growth
 * pipeline. Same walk, same disclosure/widening rules as employment/yoy/establishments; the two new
 * QCEW columns are OPTIONAL in the header contract (an area file without them degrades per-metric to
 * withheld no_data — never source_error, never blocking the original three metrics).
 */

const svc = require('../utils/industryEconomicsService');
const { computeStructuralGrowth } = require('../services/structuralGrowth');
const { buildEvidenceLedger } = require('../services/evidenceLedger');

const JUNK = { fips5: '13121', county: 'Fulton County', state: 'GA', naicsCode: '562119', naicsLabel: 'Other Waste Collection' };
const NOW = new Date('2026-08-22T12:00:00Z');

// Extended column set including the v3 cells. Existing suites use the pre-v3 column set — those
// fixtures now double as the "old-style CSV degrades per-metric" proof.
const COLS = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs',
    'oty_annual_avg_emplvl_pct_chg', 'annual_avg_wkly_wage', 'oty_annual_avg_wkly_wage_pct_chg', 'lq_annual_avg_emplvl'];
const csv = (rows) => COLS.join(',') + '\n'
    + rows.map(r => COLS.map(c => (r[c] != null ? r[c] : '')).join(',')).join('\n')
    + '\n' + 'x'.repeat(100);

const fetchOk = (rows, dataYear = 2025) => async () => ({
    text: csv(rows), dataYear, sourceUrl: svc.buildSourceUrl(dataYear, JUNK.fips5)
});

const run = (rows, deps = {}) => svc.getStructuralGrowth(JUNK, { now: NOW, fetchLatestAnnualArea: fetchOk(rows), ...deps });

// ── 1. Full disclosure at the 6-digit level ───────────────────────────────────
test('wage + lq land at the finest level; wage carries same-level otyPct + comparisonYear', async () => {
    const sg = await run([{
        own_code: '5', industry_code: '562119', disclosure_code: '',
        annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1',
        annual_avg_wkly_wage: '1245', oty_annual_avg_wkly_wage_pct_chg: '3.2', lq_annual_avg_emplvl: '1.23'
    }]);
    expect(sg.status).toBe('ok');
    expect(sg.metrics.wage.state).toBe('external');
    expect(sg.metrics.wage.value).toBe(1245);
    expect(sg.metrics.wage.effectiveNaics).toBe('562119');
    expect(sg.metrics.wage.widened).toBe(false);
    expect(sg.metrics.wage.otyPct).toBe(3.2);
    expect(sg.metrics.wage.comparisonYear).toBe(2024);
    expect(sg.metrics.wage.provenance).toContain('over-the-year vs 2024');
    expect(sg.metrics.lq.state).toBe('external');
    expect(sg.metrics.lq.value).toBe(1.23);
    expect(sg.metrics.lq.otyPct).toBeUndefined();          // LQ never grows a comparison
    expect(sg.metrics.lq.comparisonYear).toBeUndefined();
    // the original three are untouched by the new columns
    expect(sg.metrics.employment.value).toBe(1180);
    expect(sg.metrics.yoy.value).toBe(8.1);
    expect(sg.metrics.establishments.value).toBe(68);
});

// ── 2. Widening applies to the new metrics with disclosure ────────────────────
test('suppressed 6-digit widens wage + lq to 5621; wage otyPct comes from the LANDED row', async () => {
    const sg = await run([
        { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
        {
            own_code: '5', industry_code: '5621', disclosure_code: '',
            annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1',
            annual_avg_wkly_wage: '1310', oty_annual_avg_wkly_wage_pct_chg: '-1.4', lq_annual_avg_emplvl: '0.97'
        }
    ]);
    expect(sg.metrics.wage.effectiveNaics).toBe('5621');
    expect(sg.metrics.wage.widened).toBe(true);
    expect(sg.metrics.wage.value).toBe(1310);
    expect(sg.metrics.wage.otyPct).toBe(-1.4);
    expect(sg.metrics.wage.provenance).toContain('not disclosed');
    expect(sg.metrics.lq.effectiveNaics).toBe('5621');
    expect(sg.metrics.lq.value).toBe(0.97);
});

// ── 3. Per-metric degradation, never section failure ──────────────────────────
test('blank wage/lq cells at every level → those metrics withheld no_data; employment still external', async () => {
    const sg = await run([{
        own_code: '5', industry_code: '562119', disclosure_code: '',
        annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1'
        // wage / wage-oty / lq cells blank
    }]);
    expect(sg.status).toBe('ok');
    expect(sg.metrics.employment.state).toBe('external');
    expect(sg.metrics.wage.state).toBe('withheld');
    expect(sg.metrics.wage.withholdCause).toBe('no_data');
    expect(sg.metrics.lq.state).toBe('withheld');
    expect(sg.metrics.lq.withholdCause).toBe('no_data');
});

test('OLD-STYLE CSV (columns absent entirely) → per-metric no_data, NOT source_error', async () => {
    const OLD_COLS = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs', 'oty_annual_avg_emplvl_pct_chg'];
    const text = OLD_COLS.join(',') + '\n' + ['5', '562119', '', '1180', '68', '8.1'].join(',') + '\n' + 'x'.repeat(100);
    const sg = await svc.getStructuralGrowth(JUNK, {
        now: NOW, fetchLatestAnnualArea: async () => ({ text, dataYear: 2025, sourceUrl: svc.buildSourceUrl(2025, JUNK.fips5) })
    });
    expect(sg.status).toBe('ok');                              // the section survives
    expect(sg.metrics.employment.value).toBe(1180);
    expect(sg.metrics.wage.state).toBe('withheld');
    expect(sg.metrics.lq.state).toBe('withheld');
});

// ── 4. Wage without its OTY cell → external wage, no fabricated comparison ────
test('wage present but OTY cell blank → external wage WITHOUT otyPct/comparisonYear/vs-wording', async () => {
    const sg = await run([{
        own_code: '5', industry_code: '562119', disclosure_code: '',
        annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1',
        annual_avg_wkly_wage: '1245', lq_annual_avg_emplvl: '1.23'
    }]);
    expect(sg.metrics.wage.state).toBe('external');
    expect(sg.metrics.wage.value).toBe(1245);
    expect(sg.metrics.wage.otyPct).toBeUndefined();
    expect(sg.metrics.wage.comparisonYear).toBeUndefined();
    expect(sg.metrics.wage.provenance).not.toContain('over-the-year vs');
});

// ── 5. True zero survives for the new metrics ─────────────────────────────────
test('LQ true zero survives as an external observation (never suppressed by truthiness)', async () => {
    const sg = await run([{
        own_code: '5', industry_code: '562119', disclosure_code: '',
        annual_avg_emplvl: '0', annual_avg_estabs: '0', oty_annual_avg_emplvl_pct_chg: '0',
        annual_avg_wkly_wage: '0', oty_annual_avg_wkly_wage_pct_chg: '0', lq_annual_avg_emplvl: '0'
    }]);
    expect(sg.metrics.lq).toMatchObject({ state: 'external', value: 0 });
    expect(sg.metrics.wage).toMatchObject({ state: 'external', value: 0, otyPct: 0 });
});

// ── 6. Cache contract v3 ──────────────────────────────────────────────────────
test('a v2 semantic doc is rejected as a MISS (self-healing); rewrite is v3 and carries wage/lq', async () => {
    const store = new Map();
    store.set(`${JUNK.fips5}_${JUNK.naicsCode}`, {
        economics: {
            cacheContractVersion: 2, dataYear: 2025,
            metrics: { employment: { state: 'external', value: 1180, effectiveNaics: '5621' } }
        },
        expiresAt: new Date('2030-01-01')
    });
    const deps = {
        now: NOW,
        checkCache: async (key, now) => svc.readSemanticFromCacheDoc(store.get(key), now),
        writeCache: async (key, economics, expiresAt) => { store.set(key, { economics, expiresAt }); },
        fetchLatestAnnualArea: fetchOk([{
            own_code: '5', industry_code: '562119', disclosure_code: '',
            annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1',
            annual_avg_wkly_wage: '1245', oty_annual_avg_wkly_wage_pct_chg: '3.2', lq_annual_avg_emplvl: '1.23'
        }])
    };
    const sg = await svc.getStructuralGrowth(JUNK, deps);
    expect(sg.metrics.wage.value).toBe(1245);                  // fetched, not served from the v2 doc
    const rewritten = store.get(`${JUNK.fips5}_${JUNK.naicsCode}`).economics;
    expect(rewritten.cacheContractVersion).toBe(svc.CACHE_CONTRACT_VERSION);
    expect(rewritten.metrics.wage).toMatchObject({ state: 'external', value: 1245, otyPct: 3.2 });
    expect(rewritten.metrics.lq).toMatchObject({ state: 'external', value: 1.23 });

    // and a HIT on the v3 doc rebuilds wage/lq presentation without refetching
    let fetches = 0;
    const sg2 = await svc.getStructuralGrowth(JUNK, {
        ...deps, fetchLatestAnnualArea: async () => { fetches++; throw new Error('must not fetch'); }
    });
    expect(fetches).toBe(0);
    expect(sg2.metrics.wage).toMatchObject({ value: 1245, otyPct: 3.2, comparisonYear: 2024 });
    expect(sg2.metrics.lq).toMatchObject({ value: 1.23 });
});

// ── 7. Policy layer + ledger integration ──────────────────────────────────────
test('policy-withheld sections carry wage/lq withheld entries (shape parity)', async () => {
    const sg = await computeStructuralGrowth({
        industryConfig: { id: 'home_services' },
        subIndustryConfig: { id: 'moving_storage', naicsCode: '484210' },
        state: 'GA', city: 'Atlanta', geo: null, geocodeCountyName: null
    });
    expect(sg.status).toBe('withheld');
    expect(sg.metrics.wage.state).toBe('withheld');
    expect(sg.metrics.lq.state).toBe('withheld');
});

test('evidence ledger emits wage + lq entries with template details (no model prose)', async () => {
    const sg = await run([{
        own_code: '5', industry_code: '562119', disclosure_code: '',
        annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1',
        annual_avg_wkly_wage: '1245', oty_annual_avg_wkly_wage_pct_chg: '3.2', lq_annual_avg_emplvl: '1.23'
    }]);
    const led = buildEvidenceLedger({ data: { leads: [], competitors: [] } }, { structuralGrowth: sg });
    const wage = led.entries.find(e => e.id === 'structural_growth_wage');
    const lq = led.entries.find(e => e.id === 'structural_growth_lq');
    expect(wage.state).toBe('external');
    expect(wage.detail).toBe('$1245 avg weekly wage (+3.2% over the year) at NAICS 562119');
    expect(wage.provenance).toContain('BLS QCEW');
    expect(lq.state).toBe('external');
    expect(lq.detail).toBe('1.23 location quotient (employment concentration vs national) at NAICS 562119');
});
