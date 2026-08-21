'use strict';

/**
 * PR-D — Structural Growth (BLS QCEW) gate matrix + invariants.
 * Service + orchestrator + county resolver, all with injected fetch/deps (no network, no Firestore reads
 * beyond the auto-mocked firebase-admin).
 */

const svc = require('../utils/industryEconomicsService');
const { computeStructuralGrowth, HOME_SERVICES_POLICY } = require('../services/structuralGrowth');
const { resolveCountyFips, normalizeCountyName, extractAdminAreaLevel2 } = require('../services/countyResolver');
const { buildEvidenceLedger } = require('../services/evidenceLedger');
const { REPORT_SCHEMA_VERSION } = require('../services/evidencePainPoints');

const COLS = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs', 'oty_annual_avg_emplvl_pct_chg', 'oty_annual_avg_estabs_pct_chg'];
function csv(rows) {
    const header = COLS.join(',');
    const body = rows.map(r => COLS.map(c => (r[c] != null ? r[c] : '')).join(',')).join('\n');
    return header + '\n' + body + '\n' + 'x'.repeat(100); // pad body length (irrelevant to parser)
}
// junk_removal: 562119 → 5621 → 562
const JUNK = { fips5: '13121', county: 'Fulton County', state: 'GA', naicsCode: '562119', naicsLabel: 'Other Waste Collection' };
const inject = (fetchResult) => ({ fetchLatestAnnualArea: async () => fetchResult, now: new Date('2026-06-15T00:00:00Z') });
const okFetch = (rows, dataYear = 2024) => inject({ text: csv(rows), dataYear });

describe('gate matrix — service level (getStructuralGrowth)', () => {
    test('1. valid NAICS + county + fresh → all three metrics rendered (external)', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '85', oty_annual_avg_emplvl_pct_chg: '3.5', oty_annual_avg_estabs_pct_chg: '2.0' }
        ]));
        expect(r.status).toBe('ok');
        expect(r.metrics.employment.state).toBe('external');
        expect(r.metrics.employment.value).toBe(1200);
        expect(r.metrics.employment.effectiveNaics).toBe('562119');
        expect(r.metrics.yoy.state).toBe('external');
        expect(r.metrics.yoy.value).toBe(3.5);
        expect(r.metrics.establishments.value).toBe(85);
        expect(r.dataYear).toBe(2024);
        expect(r.comparisonYear).toBe(2023);
    });

    test('5. API/transport error → all withheld source_error (never absence, never widened)', async () => {
        const r = await svc.getStructuralGrowth(JUNK, inject({ error: 'source_error', detail: 'transport' }));
        expect(r.status).toBe('withheld');
        for (const k of ['employment', 'yoy', 'establishments']) {
            expect(r.metrics[k].state).toBe('withheld');
            expect(r.metrics[k].withholdCause).toBe('source_error');
        }
    });

    test('5b. parse failure (malformed CSV / missing column) → source_error, not no_data', async () => {
        const bad = inject({ text: 'wrong,header\n1,2\n' + 'x'.repeat(100), dataYear: 2024 });
        const r = await svc.getStructuralGrowth(JUNK, bad);
        expect(r.status).toBe('withheld');
        expect(r.metrics.employment.withholdCause).toBe('source_error');
    });

    test('6. stale period → withheld stale_period', async () => {
        const r = await svc.getStructuralGrowth(JUNK, inject({ error: 'stale_period', latestYear: 2022 }));
        expect(r.metrics.employment.withholdCause).toBe('stale_period');
    });

    test('7. suppressed through 6→4→3 → bls_suppressed (distinct; never 0 / never "no growth")', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
            { own_code: '5', industry_code: '5621', disclosure_code: 'N' },
            { own_code: '5', industry_code: '562', disclosure_code: 'N' }
        ]));
        expect(r.metrics.employment.state).toBe('withheld');
        expect(r.metrics.employment.withholdCause).toBe('bls_suppressed');
        expect(r.metrics.employment.value).toBeUndefined();
    });

    test('10. true-zero employment is an OBSERVATION, distinguished from missing', async () => {
        const zero = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '0', annual_avg_estabs: '0', oty_annual_avg_emplvl_pct_chg: '0.0' }
        ]));
        expect(zero.metrics.employment.state).toBe('external');
        expect(zero.metrics.employment.value).toBe(0);

        const missing = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '999999', disclosure_code: '', annual_avg_emplvl: '5' } // unrelated row only
        ]));
        expect(missing.metrics.employment.state).toBe('withheld');
        expect(missing.metrics.employment.withholdCause).toBe('no_data');
    });

    test('12. mixed: employment present, YoY cell blank → employment external, YoY withheld (metric-level)', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '85', oty_annual_avg_emplvl_pct_chg: '' }
        ]));
        expect(r.metrics.employment.state).toBe('external');
        expect(r.metrics.yoy.state).toBe('withheld');
        expect(r.metrics.yoy.withholdCause).toBe('no_data');
        expect(r.metrics.establishments.state).toBe('external');
    });

    test('13. 6-digit suppressed but 4-digit disclosed → widened landing, disclosed in provenance', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
            { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '4000', annual_avg_estabs: '250', oty_annual_avg_emplvl_pct_chg: '1.2' }
        ]));
        expect(r.metrics.employment.state).toBe('external');
        expect(r.metrics.employment.effectiveNaics).toBe('5621');
        expect(r.metrics.employment.widened).toBe(true);
        expect(r.metrics.employment.provenance).toContain('county data at NAICS 562119 not disclosed');
        expect(r.metrics.employment.provenance).toContain('NAICS 5621 Waste Collection');
    });

    test('per-metric effective levels MAY differ (decision 3): emp at 562119, estabs widened to 5621', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '', oty_annual_avg_emplvl_pct_chg: '3.0' },
            { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '4000', annual_avg_estabs: '250', oty_annual_avg_emplvl_pct_chg: '1.2' }
        ]));
        expect(r.metrics.employment.effectiveNaics).toBe('562119');
        expect(r.metrics.establishments.effectiveNaics).toBe('5621');
        expect(r.metrics.establishments.provenance).toContain('not disclosed');
    });

    test('own_code != 5 (government) is ignored — only private rows are read', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '3', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '9999' },
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '85', oty_annual_avg_emplvl_pct_chg: '3.0' }
        ]));
        expect(r.metrics.employment.value).toBe(1200);
    });
});

describe('COMPARABLE YoY invariant (condition 2)', () => {
    test('YoY is the landed row\'s own OTY cell — same effective NAICS as that row, stamped with both years', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '85', oty_annual_avg_emplvl_pct_chg: '3.5' }
        ], 2024));
        // The OTY cell compares annual-avg 2024 vs 2023 at THIS row's own level → like-for-like by construction.
        expect(r.metrics.yoy.effectiveNaics).toBe('562119');
        expect(r.metrics.yoy.dataYear).toBe(2024);
        expect(r.metrics.yoy.comparisonYear).toBe(2023);
        expect(r.metrics.yoy.provenance).toContain('over-the-year vs 2023, same NAICS level');
    });

    test('YoY never divides / never crosses levels: a widened YoY stamps its OWN level, not employment\'s', async () => {
        const r = await svc.getStructuralGrowth(JUNK, okFetch([
            // employment disclosed at 6-digit; YoY suppressed at 6-digit, disclosed at 4-digit
            { own_code: '5', industry_code: '562119', disclosure_code: '', annual_avg_emplvl: '1200', annual_avg_estabs: '85', oty_annual_avg_emplvl_pct_chg: 'N' },
            { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '4000', annual_avg_estabs: '250', oty_annual_avg_emplvl_pct_chg: '1.1' }
        ]));
        // 'N' in the numeric cell is non-numeric → treated as not-disclosed at 6-digit → widen for YoY only.
        expect(r.metrics.employment.effectiveNaics).toBe('562119');
        expect(r.metrics.yoy.effectiveNaics).toBe('5621');   // YoY stamped at ITS level
        expect(Number.isFinite(r.metrics.yoy.value)).toBe(true);
        expect(r.metrics.yoy.value).toBe(1.1);
    });
});

describe('real fetchLatestAnnualArea — freshness + year-fallback + source_error (no network mocked via global.fetch)', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    test('8. latest year 404s, prior in-window year resolves → uses prior year (explicitly defined)', async () => {
        const now = new Date('2026-06-15T00:00:00Z'); // cy=2026, window >= 2024
        global.fetch = async (url) => url.includes('/2025/')
            ? { ok: false, status: 404 }
            : { ok: true, status: 200, text: async () => 'a'.repeat(200) };
        const out = await svc.fetchLatestAnnualArea('13121', now);
        expect(out.dataYear).toBe(2024);            // cy-2, within window
        expect(out.text).toBeTruthy();
    });

    test('comparison-year is NOT independently stale: 2024 passes, YoY compares 2023, no stale_period', async () => {
        const now = new Date('2026-06-15T00:00:00Z');
        global.fetch = async (url) => url.includes('/2025/')
            ? { ok: false, status: 404 }
            : { ok: true, status: 200, text: async () => 'a'.repeat(200) };
        const out = await svc.fetchLatestAnnualArea('13121', now);
        expect(out.error).toBeUndefined();
        expect(out.dataYear).toBe(2024);
        // dataYear-1 (2023) is used only for the YoY label; freshness gates the latest year (2024) only.
    });

    test('only cy-3 available → stale_period', async () => {
        const now = new Date('2026-06-15T00:00:00Z'); // window >= 2024
        global.fetch = async (url) => url.includes('/2023/')
            ? { ok: true, status: 200, text: async () => 'a'.repeat(200) }
            : { ok: false, status: 404 };
        const out = await svc.fetchLatestAnnualArea('13121', now);
        expect(out.error).toBe('stale_period');
        expect(out.latestYear).toBe(2023);
    });

    test('transport throw → source_error, terminates (does not fall through to older years)', async () => {
        global.fetch = async () => { throw new Error('ECONNRESET'); };
        const out = await svc.fetchLatestAnnualArea('13121', new Date('2026-06-15T00:00:00Z'));
        expect(out.error).toBe('source_error');
    });

    test('non-404 HTTP (500) → source_error (not treated as availability)', async () => {
        global.fetch = async () => ({ ok: false, status: 500 });
        const out = await svc.fetchLatestAnnualArea('13121', new Date('2026-06-15T00:00:00Z'));
        expect(out.error).toBe('source_error');
    });
});

describe('orchestrator (computeStructuralGrowth) — vertical + policy gates', () => {
    const HS = { id: 'home_services' };
    const fakeOk = { getStructuralGrowth: async (a) => ({ status: 'ok', county: a.county, state: a.state, fips5: a.fips5, dataYear: 2024, comparisonYear: 2023, requestedNaics: { code: a.naicsCode, label: a.naicsLabel }, metrics: { employment: { state: 'external', value: 1200, effectiveNaics: a.naicsCode }, yoy: { state: 'external', value: 3 }, establishments: { state: 'external', value: 85 } } }) };
    const county = { resolveCountyFips: () => ({ fips5: '13121', county: 'Fulton County', source: 'geocode' }) };

    test('non-Home-Services vertical → null (fence)', async () => {
        const out = await computeStructuralGrowth({ industryConfig: { id: 'automotive' }, subIndustryConfig: { id: 'auto_repair' }, state: 'GA' });
        expect(out).toBeNull();
    });

    test('2. moving_storage → withheld low_confidence_naics (matrix case 2)', async () => {
        const out = await computeStructuralGrowth({
            industryConfig: HS, subIndustryConfig: { id: 'moving_storage', naicsCode: '484210', naicsLabel: 'Used Household and Office Goods Moving' },
            state: 'GA', geo: { fullCountyFips: '13121' }
        }, { ...fakeOk, ...county });
        expect(out.status).toBe('withheld');
        expect(out.metrics.employment.withholdCause).toBe('low_confidence_naics');
    });

    test('3. sub with no policy / no code → no_naics', async () => {
        const out = await computeStructuralGrowth({
            industryConfig: HS, subIndustryConfig: { id: 'not_a_real_sub' }, state: 'GA', geo: { fullCountyFips: '13121' }
        }, { ...fakeOk, ...county });
        expect(out.metrics.employment.withholdCause).toBe('no_naics');
    });

    test('4. county unresolved → no_county_fips (never state-level)', async () => {
        const out = await computeStructuralGrowth({
            industryConfig: HS, subIndustryConfig: { id: 'roofing', naicsCode: '238160', naicsLabel: 'Roofing Contractors' },
            state: 'GA', geo: {} // no fullCountyFips, no geocode county
        }, { ...fakeOk, resolveCountyFips: () => ({ withhold: true, withholdCause: 'no_county_fips', reason: 'x' }) });
        expect(out.metrics.employment.withholdCause).toBe('no_county_fips');
    });

    test('verified sub renders; disclosure absent for a plain verified sub', async () => {
        const out = await computeStructuralGrowth({
            industryConfig: HS, subIndustryConfig: { id: 'roofing', naicsCode: '238160', naicsLabel: 'Roofing Contractors' },
            state: 'GA', geo: { fullCountyFips: '13121' }
        }, { ...fakeOk, ...county });
        expect(out.status).toBe('ok');
        expect(out.metrics.employment.state).toBe('external');
        expect(out.disclosure).toBeNull();
    });

    test('#6 junk_removal PROMOTED with disclosed classification string', async () => {
        const out = await computeStructuralGrowth({
            industryConfig: HS, subIndustryConfig: { id: 'junk_removal', naicsCode: '562119', naicsLabel: 'Other Waste Collection' },
            state: 'GA', geo: { fullCountyFips: '13121' }
        }, { ...fakeOk, ...county });
        expect(out.status).toBe('ok');
        expect(out.disclosure).toContain('562119 Other Waste Collection');
        expect(HOME_SERVICES_POLICY.junk_removal.allow).toBe(true);
    });
});

describe('evidence ledger — three sibling metric entries + presence gating (case 11)', () => {
    const sgOk = {
        metrics: {
            employment: { state: 'external', value: 1200, effectiveNaics: '562119', provenance: 'prov-emp' },
            yoy: { state: 'external', value: 3.5, effectiveNaics: '562119', provenance: 'prov-yoy' },
            establishments: { state: 'withheld', withholdCause: 'bls_suppressed', reason: 'suppressed' }
        }
    };

    test('emits exactly three structural_growth entries with per-metric state + cause', () => {
        const led = buildEvidenceLedger({ data: { leads: [], competitors: [] } }, { structuralGrowth: sgOk });
        const ids = led.entries.filter(e => e.id.startsWith('structural_growth_')).map(e => e.id);
        expect(ids.sort()).toEqual(['structural_growth_employment', 'structural_growth_establishments', 'structural_growth_yoy'].sort());
        const emp = led.entries.find(e => e.id === 'structural_growth_employment');
        const est = led.entries.find(e => e.id === 'structural_growth_establishments');
        expect(emp.state).toBe('external');
        expect(emp.provenance).toBe('prov-emp');
        expect(est.state).toBe('withheld');
        expect(est.withholdCause).toBe('bls_suppressed');
    });

    test('11. pre-PR-D report (no structuralGrowth in ctx) → NO structural entries; ledger otherwise intact', () => {
        const led = buildEvidenceLedger({ data: { leads: [{ name: 'A' }], competitors: [] } }, {});
        expect(led.entries.some(e => e.id.startsWith('structural_growth_'))).toBe(false);
        expect(led.entries.some(e => e.id === 'competitive_landscape')).toBe(true);
    });

    test('11b. schema constant is v4; the existing >= 3 median reader is unaffected (4 >= 3)', () => {
        expect(REPORT_SCHEMA_VERSION).toBe(4);
        expect(REPORT_SCHEMA_VERSION >= 3).toBe(true);
    });
});

describe('county resolver', () => {
    test('geocode admin_area_level_2 → FIPS (primary)', () => {
        const geo = extractAdminAreaLevel2({ address_components: [
            { long_name: 'Fulton County', short_name: 'Fulton County', types: ['administrative_area_level_2', 'political'] }
        ] });
        expect(geo).toBe('Fulton County');
        const r = resolveCountyFips({ geocodeCountyName: geo, state: 'GA', geo: {} });
        expect(r.fips5).toBe('13121');
        expect(r.source).toBe('geocode');
    });

    test('independent city is not collapsed into the like-named county (Baltimore city ≠ Baltimore County)', () => {
        expect(resolveCountyFips({ geocodeCountyName: 'Baltimore city', state: 'MD', geo: {} }).fips5).toBe('24510');
    });

    test('fallback to Table A fullCountyFips when no geocode county', () => {
        const r = resolveCountyFips({ state: 'GA', geo: { fullCountyFips: '13089' } });
        expect(r.fips5).toBe('13089');
        expect(r.source).toBe('city_table');
    });

    test('no geocode + no city-table → withhold no_county_fips (NEVER a state-level FIPS)', () => {
        const r = resolveCountyFips({ state: 'GA', geo: {} });
        expect(r.withhold).toBe(true);
        expect(r.withholdCause).toBe('no_county_fips');
        expect(r.fips5).toBeUndefined();
    });

    test('normalizeCountyName strips type suffix, keeps independent-city identity', () => {
        expect(normalizeCountyName('Fulton County')).toBe('fulton');
        expect(normalizeCountyName('St. Louis city')).toBe('st louis city');
        expect(normalizeCountyName('East Baton Rouge Parish')).toBe('east baton rouge');
    });
});
