'use strict';

/**
 * PR-D presentation follow-up — linkable provenance (exact BLS source URL) + authoritative county label.
 * Presentation/provenance-only: metric value, evidence state, effective NAICS, area FIPS, dataYear,
 * widening, and withhold behavior must be BYTE-IDENTICAL to pre-change; only provenance/link/display text
 * may differ. The regression fence is asserted here, not just claimed.
 */

const svc = require('../utils/industryEconomicsService');
const { computeStructuralGrowth } = require('../services/structuralGrowth');
const { resolveCountyFips, countyLabelForFips, FIPS_TO_COUNTY_LABEL } = require('../services/countyResolver');

const COLS = ['own_code', 'industry_code', 'disclosure_code', 'annual_avg_emplvl', 'annual_avg_estabs', 'oty_annual_avg_emplvl_pct_chg', 'oty_annual_avg_estabs_pct_chg'];
function csv(rows) {
    return COLS.join(',') + '\n' + rows.map(r => COLS.map(c => (r[c] != null ? r[c] : '')).join(',')).join('\n') + '\n' + 'x'.repeat(100);
}
const JUNK = { fips5: '13121', county: 'Fulton County', state: 'GA', naicsCode: '562119', naicsLabel: 'Other Waste Collection' };
// injected fetch WITH the propagated sourceUrl (production shape)
const injUrl = (rows, dataYear = 2025) => ({ fetchLatestAnnualArea: async () => ({ text: csv(rows), dataYear, sourceUrl: svc.buildSourceUrl(dataYear, '13121') }), now: new Date('2026-06-15') });
// injected fetch WITHOUT sourceUrl (forces the reconstruct-from-landed-year fallback)
const injNoUrl = (rows, dataYear = 2025) => ({ fetchLatestAnnualArea: async () => ({ text: csv(rows), dataYear }), now: new Date('2026-06-15') });
// canonical junk fixture: 562119 suppressed → walk lands at 5621 (the live-smoke scenario)
const WIDEN_ROWS = [
    { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
    { own_code: '5', industry_code: '5621', disclosure_code: '', annual_avg_emplvl: '1180', annual_avg_estabs: '68', oty_annual_avg_emplvl_pct_chg: '8.1' }
];

describe('linkable provenance — exact BLS source URL', () => {
    test('buildSourceUrl is the exact annual county CSV endpoint (year + area FIPS)', () => {
        expect(svc.buildSourceUrl(2025, '13121')).toBe('https://data.bls.gov/cew/data/api/2025/a/area/13121.csv');
    });

    test('all three external metrics carry the exact source URL (correct area + landed year)', async () => {
        const r = await svc.getStructuralGrowth(JUNK, injUrl(WIDEN_ROWS, 2025));
        const url = 'https://data.bls.gov/cew/data/api/2025/a/area/13121.csv';
        expect(r.sourceUrl).toBe(url);
        for (const k of ['employment', 'yoy', 'establishments']) {
            expect(r.metrics[k].provenance).toContain('Source: ' + url);
            expect(r.metrics[k].provenance).toContain('/2025/a/area/13121.csv'); // year + area FIPS
        }
    });

    test('PRIMACY: a propagated URL (distinguishable from the reconstructed value) survives unchanged', async () => {
        // Sentinel propagated URL that reconstruction would NEVER produce — proves propagation is primary,
        // not that the two happen to coincide.
        const SENTINEL = 'https://data.bls.gov/cew/data/api/2099/a/area/99999.csv';
        const inj = { fetchLatestAnnualArea: async () => ({ text: csv(WIDEN_ROWS), dataYear: 2025, sourceUrl: SENTINEL }), now: new Date('2026-06-15') };
        const r = await svc.getStructuralGrowth(JUNK, inj);
        expect(r.sourceUrl).toBe(SENTINEL);                                  // propagated value survives
        expect(r.metrics.employment.provenance).toContain('Source: ' + SENTINEL);
        // and NOT the value reconstruction would have produced from landed year(2025)+FIPS(13121)
        expect(r.metrics.employment.provenance).not.toContain('/2025/a/area/13121.csv');
        expect(r.sourceUrl).not.toBe(svc.buildSourceUrl(2025, '13121'));
    });

    test('RECONSTRUCT: when the service omits the URL, it is rebuilt from the LANDED year + area FIPS', async () => {
        // Landed year 2024 (a fallback year) with no propagated URL → reconstruct 2024 endpoint, not 2025.
        const r = await svc.getStructuralGrowth(JUNK, injNoUrl(WIDEN_ROWS, 2024));
        expect(r.sourceUrl).toBe('https://data.bls.gov/cew/data/api/2024/a/area/13121.csv');
        expect(r.metrics.employment.provenance).toContain('/2024/a/area/13121.csv');
        expect(r.metrics.employment.provenance).not.toContain('/2025/');
    });

    test('year-fallback: the URL links the FALLBACK year that actually returned data, not the attempted year', async () => {
        const realFetch = global.fetch;
        try {
            // cy=2026: 2025 → 404, 2024 → 200. Landed year is 2024; URL must be the 2024 endpoint.
            global.fetch = async (u) => u.includes('/2025/') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => 'a'.repeat(200) };
            const out = await svc.fetchLatestAnnualArea('13121', new Date('2026-06-15'));
            expect(out.dataYear).toBe(2024);
            expect(out.sourceUrl).toBe('https://data.bls.gov/cew/data/api/2024/a/area/13121.csv');
            expect(out.sourceUrl).not.toContain('/2025/');
        } finally { global.fetch = realFetch; }
    });

    test('a WITHHELD metric carries no fabricated source link (source only rides real observations)', async () => {
        const r = await svc.getStructuralGrowth(JUNK, injUrl([
            { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
            { own_code: '5', industry_code: '5621', disclosure_code: 'N' },
            { own_code: '5', industry_code: '562', disclosure_code: 'N' }
        ]));
        expect(r.metrics.employment.state).toBe('withheld');
        expect(r.metrics.employment.reason || '').not.toContain('Source: http');
    });
});

describe('authoritative county display label', () => {
    test('geocoder path → canonical FIPS→label (not the raw geocoder string when the map is authoritative)', () => {
        const r = resolveCountyFips({ geocodeCountyName: 'Fulton County', state: 'GA', geo: {} });
        expect(r.fips5).toBe('13121');
        expect(r.countyLabel).toBe('Fulton County');
        expect(r.source).toBe('geocode');
    });

    test('Table-A city_table path → human-readable label from FIPS, NOT the bare FIPS (the live bug)', () => {
        const r = resolveCountyFips({ state: 'GA', geo: { fullCountyFips: '13121' } });
        expect(r.fips5).toBe('13121');
        expect(r.countyLabel).toBe('Fulton County'); // was '13121' pre-fix
        expect(r.source).toBe('city_table');
    });

    test('the label flows into the section provenance regardless of source (city_table)', async () => {
        // real resolveCountyFips + real orchestrator; fake fetch that echoes the county it was given.
        const echo = { getStructuralGrowth: async (a) => ({ status: 'ok', county: a.county, state: a.state, fips5: a.fips5, dataYear: 2025, comparisonYear: 2024, metrics: { employment: { state: 'external', value: 1, provenance: 'BLS QCEW annual averages, 2025, ' + a.county + ', GA — ...' }, yoy: { state: 'external', value: 1 }, establishments: { state: 'external', value: 1 } } }) };
        const sg = await computeStructuralGrowth({
            industryConfig: { id: 'home_services' },
            subIndustryConfig: { id: 'junk_removal', naicsCode: '562119', naicsLabel: 'Other Waste Collection' },
            state: 'GA', geo: { fullCountyFips: '13121' } // city_table path, no geocode
        }, echo);
        expect(sg.county).toBe('Fulton County');
        expect(sg.countySource).toBe('city_table');
        expect(sg.metrics.employment.provenance).toContain('Fulton County');
        expect(sg.metrics.employment.provenance).not.toContain('13121,'); // FIPS not used as the label
    });

    test('county-equivalent + alias scenario (St. Louis): independent city stays a CITY, never a County', () => {
        // The #95 forward map represents St. Louis city as one of several MO aliases; presentation must not
        // reverse it. 29510 (city) ≠ 29189 (county); we never manufacture "St. Louis County" for the city.
        expect(FIPS_TO_COUNTY_LABEL['29510']).toBe('St. Louis city');
        expect(FIPS_TO_COUNTY_LABEL['29510']).not.toBe('St. Louis County');
        expect(FIPS_TO_COUNTY_LABEL['29189']).toBe('St. Louis County');
        // resolve via Table A (Table A maps st louis,mo → 29510 city)
        const r = resolveCountyFips({ state: 'MO', geo: { fullCountyFips: '29510' } });
        expect(r.countyLabel).toBe('St. Louis city');
        // parish + other independent cities keep their terminology
        expect(FIPS_TO_COUNTY_LABEL['22071']).toBe('Orleans Parish');
        expect(FIPS_TO_COUNTY_LABEL['24510']).toBe('Baltimore city');
        expect(FIPS_TO_COUNTY_LABEL['51760']).toBe('Richmond city');
    });

    test('labels are the authoritative county for their FIPS (regression guard for the 13097/13295 mislabels)', () => {
        // Review-round finding: FIPS 13097 is Douglas County (not Coweta = 13077); FIPS 13295 is Walker
        // County (not Floyd = 13115). The label MUST name the county the FIPS actually is.
        expect(FIPS_TO_COUNTY_LABEL['13097']).toBe('Douglas County');
        expect(FIPS_TO_COUNTY_LABEL['13097']).not.toBe('Coweta County');
        expect(FIPS_TO_COUNTY_LABEL['13295']).toBe('Walker County');
        expect(FIPS_TO_COUNTY_LABEL['13295']).not.toBe('Floyd County');
    });

    test('unresolved FIPS (not in the verified map, no supplied name) → retain FIPS, never guess', () => {
        expect(countyLabelForFips('99999', null)).toBe('99999');
        expect(countyLabelForFips('99999', '')).toBe('99999');
        // a real geocoder-supplied name is used only as a fallback for an unmapped FIPS (not a guess)
        expect(countyLabelForFips('99999', 'Somewhere County')).toBe('Somewhere County');
        // a mapped FIPS always wins over a supplied name (one canonical label per FIPS)
        expect(countyLabelForFips('13121', 'Fulton')).toBe('Fulton County');
    });

    test('no label map entry is an independent city mislabeled as a County (spot invariants)', () => {
        for (const [fips, label] of Object.entries(FIPS_TO_COUNTY_LABEL)) {
            if (label.endsWith(' city')) {
                // independent-city FIPS must not also appear as "... County"
                expect(label).not.toMatch(/County$/);
            }
        }
    });
});

describe('REGRESSION FENCE — only presentation changed; values/gating/FIPS/year/widening identical', () => {
    // Frozen non-presentation subset expected for the canonical widened junk fixture (unchanged by this PR).
    const NONPRESENTATION = (m) => ({
        state: m.state, value: m.value, effectiveNaics: m.effectiveNaics, effectiveNaicsLabel: m.effectiveNaicsLabel,
        dataYear: m.dataYear, widened: m.widened, comparisonYear: m.comparisonYear, withholdCause: m.withholdCause
    });

    test('widened employment/YoY/establishments: value, state, effective NAICS, year, widening UNCHANGED', async () => {
        const r = await svc.getStructuralGrowth(JUNK, injUrl(WIDEN_ROWS, 2025));
        expect(r.status).toBe('ok');
        expect(r.fips5).toBe('13121');           // area FIPS unchanged
        expect(r.dataYear).toBe(2025);
        expect(NONPRESENTATION(r.metrics.employment)).toEqual({ state: 'external', value: 1180, effectiveNaics: '5621', effectiveNaicsLabel: 'Waste Collection', dataYear: 2025, widened: true, comparisonYear: undefined, withholdCause: undefined });
        expect(NONPRESENTATION(r.metrics.yoy)).toEqual({ state: 'external', value: 8.1, effectiveNaics: '5621', effectiveNaicsLabel: 'Waste Collection', dataYear: 2025, widened: true, comparisonYear: 2024, withholdCause: undefined });
        expect(NONPRESENTATION(r.metrics.establishments)).toEqual({ state: 'external', value: 68, effectiveNaics: '5621', effectiveNaicsLabel: 'Waste Collection', dataYear: 2025, widened: true, comparisonYear: undefined, withholdCause: undefined });
    });

    test('withhold behavior UNCHANGED: suppressed-through-3-digit still bls_suppressed, no value', async () => {
        const r = await svc.getStructuralGrowth(JUNK, injUrl([
            { own_code: '5', industry_code: '562119', disclosure_code: 'N' },
            { own_code: '5', industry_code: '5621', disclosure_code: 'N' },
            { own_code: '5', industry_code: '562', disclosure_code: 'N' }
        ]));
        expect(r.metrics.employment.state).toBe('withheld');
        expect(r.metrics.employment.withholdCause).toBe('bls_suppressed');
        expect(r.metrics.employment.value).toBeUndefined();
    });

    test('the ONLY additive change on a rendered metric is presentation: provenance gained a Source URL', async () => {
        const r = await svc.getStructuralGrowth(JUNK, injUrl(WIDEN_ROWS, 2025));
        // presentation keys present; value-bearing keys unchanged (checked above)
        expect(typeof r.metrics.employment.provenance).toBe('string');
        expect(r.metrics.employment.provenance).toContain('Source: https://data.bls.gov');
        // widening disclosure (a #95 behavior) still intact — not disturbed by the URL append
        expect(r.metrics.employment.provenance).toContain('county data at NAICS 562119 not disclosed');
    });
});
