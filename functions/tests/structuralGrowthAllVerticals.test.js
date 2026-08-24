'use strict';

/**
 * All-verticals Structural Growth expansion (decision 2026-08-22).
 *
 * Gating contract:
 *  - A vertical NOT in STRUCTURAL_GROWTH_POLICY → null (no section, no withheld noise): most of its
 *    subs carry no taxonomy NAICS code yet; that backfill is a separate taxonomy effort.
 *  - A vertical IN the policy: listed allow:true subs render; allow:false subs are withheld
 *    low_confidence_naics WITH the recorded judgment; unlisted subs are withheld no_naics.
 *  - Home Services behavior is bit-for-bit the Gate-1 policy (regression-pinned).
 */

const { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY, HOME_SERVICES_POLICY } = require('../services/structuralGrowth');

const county = { resolveCountyFips: () => ({ fips5: '13121', county: 'Fulton County', countyLabel: 'Fulton County', source: 'geocode' }) };
const fakeOk = {
    getStructuralGrowth: async (a) => ({
        status: 'ok', county: a.county, state: a.state, fips5: a.fips5, dataYear: 2025, comparisonYear: 2024,
        sourceUrl: `https://data.bls.gov/cew/data/api/2025/a/area/${a.fips5}.csv`,
        requestedNaics: { code: a.naicsCode, label: a.naicsLabel },
        metrics: {
            employment: { state: 'external', value: 1200, effectiveNaics: a.naicsCode },
            yoy: { state: 'external', value: 3 }, establishments: { state: 'external', value: 85 },
            wage: { state: 'external', value: 1100, otyPct: 2.0 }, lq: { state: 'external', value: 1.1 }
        }
    })
};
const deps = { ...fakeOk, ...county };
const run = (verticalId, sub) => computeStructuralGrowth({
    industryConfig: { id: verticalId }, subIndustryConfig: sub, state: 'GA', city: 'Atlanta',
    geo: { fullCountyFips: '13121' }, geocodeCountyName: 'Fulton County'
}, deps);

test('retail / general_merchandise (3-digit walk, the mockup example) → renders with vertical stamped', async () => {
    const sg = await run('retail', { id: 'general_merchandise', naicsCode: '455', naicsLabel: 'General Merchandise Retailers' });
    expect(sg.status).toBe('ok');
    expect(sg.vertical).toBe('retail');
    expect(sg.metrics.employment.value).toBe(1200);
    expect(sg.metrics.wage.value).toBe(1100);
    expect(sg.disclosure).toBe(null);
});

test('automotive / auto_repair → renders; detailing_wash carries its disclosure', async () => {
    const repair = await run('automotive', { id: 'auto_repair', naicsCode: '811111', naicsLabel: 'General Automotive Repair' });
    expect(repair.status).toBe('ok');
    expect(repair.vertical).toBe('automotive');
    const wash = await run('automotive', { id: 'detailing_wash', naicsCode: '811192', naicsLabel: 'Car Washes' });
    expect(wash.status).toBe('ok');
    expect(wash.disclosure).toContain('Car Washes');
});

test('tire_alignment renders after the 441340 Tire Dealers remap (2026-08-23)', async () => {
    // The NAICS 2022 definition of 441340 IS this sub-industry: retailing tires in combination
    // with automotive repair services, with mounting, balancing and aligning as the listed
    // complementary services. The old 441330 mapping (parts/accessories retailers) is gone.
    const tire = await run('automotive', { id: 'tire_alignment', naicsCode: '441340', naicsLabel: 'Tire Dealers' });
    expect(tire.status).toBe('ok');
    expect(tire.vertical).toBe('automotive');
});

test('business_brokers stays withheld BY DESIGN with the investigated judgment recorded', async () => {
    const brokers = await run('professional_services', { id: 'business_brokers', naicsCode: '541990', naicsLabel: 'All Other Professional, Scientific, and Technical Services' });
    expect(brokers.status).toBe('withheld');
    expect(brokers.metrics.employment.withholdCause).toBe('low_confidence_naics');
    // The reason must record that the 561499 alternative was investigated and rejected as an
    // equally unfaithful catch-all - this is a settled judgment, not a pending remap.
    expect(brokers.metrics.employment.reason).toContain('561499');
    expect(brokers.metrics.employment.reason).toContain('by design');
});

test('the taxonomy carries the verified 441340 mapping (remap is in the shipped JSON, not only tests)', () => {
    const { findSubIndustry } = require('../config/industryTaxonomy');
    const sub = findSubIndustry('Automotive', 'Tire & Alignment');
    expect(sub.naicsCode).toBe('441340');
    expect(sub.naicsLabel).toBe('Tire Dealers');
});

test('vertical in the policy, sub NOT listed → withheld no_naics (allowlist posture)', async () => {
    const sg = await run('retail', { id: 'future_new_sub', naicsCode: '999999', naicsLabel: 'Nope' });
    expect(sg.status).toBe('withheld');
    expect(sg.metrics.employment.withholdCause).toBe('no_naics');
});

test('unmapped vertical → null, even when the sub carries a NAICS code', async () => {
    // Synthetic vertical ids on purpose: the NAICS backfill maps real verticals batch by batch, so
    // naming one here makes this test collateral damage of an unrelated taxonomy change.
    expect(await run('not_a_mapped_vertical', { id: 'restaurant', naicsCode: '722511', naicsLabel: 'Full-Service Restaurants' })).toBeNull();
    expect(await run('another_unmapped_vertical', { id: 'saas', naicsCode: '513210' })).toBeNull();
    expect(await computeStructuralGrowth({ industryConfig: null, subIndustryConfig: null }, deps)).toBeNull();
});

test('Home Services regression pin: policy object unchanged and aliased; junk_removal disclosure intact', async () => {
    expect(HOME_SERVICES_POLICY).toBe(STRUCTURAL_GROWTH_POLICY.home_services);
    expect(Object.keys(HOME_SERVICES_POLICY).sort()).toEqual([
        'cleaning', 'dumpster_rental', 'electrical', 'general_contractor_home',
        'junk_removal', 'landscaping', 'moving_storage', 'plumbing_hvac', 'roofing'
    ]);
    const junk = await run('home_services', { id: 'junk_removal', naicsCode: '562119', naicsLabel: 'Other Waste Collection' });
    expect(junk.status).toBe('ok');
    expect(junk.vertical).toBe('home_services');
    expect(junk.disclosure).toBe('junk/bulky-item hauling, NAICS 562119 Other Waste Collection.');
    const moving = await run('home_services', { id: 'moving_storage', naicsCode: '484210' });
    expect(moving.status).toBe('withheld');
    expect(moving.metrics.employment.withholdCause).toBe('low_confidence_naics');
});

test('policy table only enables subs that exist with a naicsCode in the taxonomy', () => {
    const taxonomy = require('../config/industryTaxonomy.json');
    const inds = taxonomy.industries || taxonomy;
    const byVertical = {};
    for (const ind of (Array.isArray(inds) ? inds : Object.values(inds))) {
        byVertical[ind.id] = new Map((ind.subIndustries || []).map(s => [s.id, s.naicsCode || null]));
    }
    for (const [verticalId, subs] of Object.entries(STRUCTURAL_GROWTH_POLICY)) {
        expect(byVertical[verticalId]).toBeTruthy();
        for (const [subId, policy] of Object.entries(subs)) {
            expect(byVertical[verticalId].has(subId)).toBe(true);
            if (policy.allow) {
                // an allow:true sub MUST have a taxonomy NAICS code, or it could never render anyway
                expect(byVertical[verticalId].get(subId)).toBeTruthy();
            }
        }
    }
});
