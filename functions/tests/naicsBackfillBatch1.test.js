'use strict';

/**
 * NAICS backfill — batch 1: salon_beauty, food_beverage, and the five unmapped health_wellness subs.
 *
 * WHY THIS FILE EXISTS. This is the researched record for batch 1: which NAICS 2022 class each
 * sub-industry was mapped to, which mappings had to disclose a broader class, and which one was
 * withheld because no class describes it. The batch-agnostic structural invariants (taxonomy ↔
 * policy agreement, widening-label coverage, the coverage inventory) live in
 * tests/structuralGrowthPolicyContract.test.js and run over every batch.
 *
 * Why pin the codes at all? PR #115 remapped tire_alignment off 441330 — a code that
 * "obviously" fit the name (Automotive Parts, Accessories, and Tire RETAILERS) and was wrong, because
 * the sub-industry is a tire dealer that also aligns. Every code below was read against its NAICS 2022
 * definition before it was written down. Pinning them here means a future edit cannot re-guess one
 * without saying so out loud.
 */

const taxonomy = require('../config/industryTaxonomy.json');
const { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY } = require('../services/structuralGrowth');
const { buildWalk } = require('../utils/industryEconomicsService');

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (indId, subId) => (industryById(indId)?.subIndustries || []).find((s) => s.id === subId);

// The researched batch-1 mappings: [vertical, sub, code, label].
const BATCH1 = [
    ['salon_beauty', 'hair_salon', '812112', 'Beauty Salons'],
    ['salon_beauty', 'beauty_salon', '812112', 'Beauty Salons'],
    ['salon_beauty', 'nail_salon', '812113', 'Nail Salons'],
    ['food_beverage', 'full_service_restaurant', '722511', 'Full-Service Restaurants'],
    ['food_beverage', 'fast_casual', '722513', 'Limited-Service Restaurants'],
    ['food_beverage', 'coffee_cafe', '722515', 'Snack and Nonalcoholic Beverage Bars'],
    ['food_beverage', 'bar_nightlife', '722410', 'Drinking Places (Alcoholic Beverages)'],
    ['food_beverage', 'restaurant_catering', '722320', 'Caterers'],
    ['food_beverage', 'craft_beverage', '312120', 'Breweries'],
    ['food_beverage', 'bakery_artisan', '311811', 'Retail Bakeries'],
    ['food_beverage', 'food_manufacturing', '311', 'Food Manufacturing'],
    ['health_wellness', 'gym_fitness', '713940', 'Fitness and Recreational Sports Centers'],
    ['health_wellness', 'medical_practice', '621111', 'Offices of Physicians (except Mental Health Specialists)'],
    ['health_wellness', 'chiropractic', '621310', 'Offices of Chiropractors'],
    ['health_wellness', 'spa_massage', '812199', 'Other Personal Care Services']
];

// Subs whose county series is BROADER than the sub-industry, and must say so. Each value is a
// phrase the disclosure has to keep — the specific thing a reader would otherwise be misled about.
const REQUIRED_DISCLOSURES = {
    'salon_beauty/hair_salon': '812111',                    // barber shops are a separate class
    'food_beverage/coffee_cafe': 'snack bars',              // 722515 also counts ice cream / doughnut shops
    'food_beverage/craft_beverage': '312130',               // cideries and wineries are elsewhere
    'food_beverage/bakery_artisan': '311812',               // commercial bakeries are elsewhere
    'health_wellness/medical_practice': '621112',           // mental health specialists are elsewhere
    'health_wellness/gym_fitness': 'recreational sports',   // 713940 also counts pools and rinks
    'health_wellness/spa_massage': 'tattoo'                 // 812199 also counts tanning / tattoo / piercing
};

describe('batch 1 — the researched codes are pinned, not re-derivable by guess', () => {
    test.each(BATCH1)('%s/%s → %s %s', (vertical, sub, code, label) => {
        const s = subById(vertical, sub);
        expect(s).toBeTruthy();
        expect(s.naicsCode).toBe(code);
        expect(s.naicsLabel).toBe(label);
    });

    test('salon_beauty and food_beverage are now fully mapped', () => {
        for (const v of ['salon_beauty', 'food_beverage']) {
            const missing = industryById(v).subIndustries.filter((s) => !s.naicsCode);
            expect({ [v]: missing.map((s) => s.id) }).toEqual({ [v]: [] });
        }
    });

    test('health_wellness is fully mapped EXCEPT med_spa_aesthetics, which has no faithful class', () => {
        const missing = industryById('health_wellness').subIndustries.filter((s) => !s.naicsCode);
        expect(missing.map((s) => s.id)).toEqual(['med_spa_aesthetics']);
    });
});

describe('med_spa_aesthetics stays withheld BY DESIGN (the business_brokers posture)', () => {
    const policy = STRUCTURAL_GROWTH_POLICY.health_wellness.med_spa_aesthetics;

    test('no taxonomy code was invented for it', () => {
        expect(subById('health_wellness', 'med_spa_aesthetics').naicsCode).toBeUndefined();
    });

    test('policy denies it and records WHY, naming both rejected candidates', () => {
        expect(policy.allow).toBe(false);
        expect(policy.reason).toContain('812199');
        expect(policy.reason).toContain('621498');
        expect(policy.reason).toMatch(/catch-all/i);
    });

    test('the section it produces is withheld with cause, never an approximate number', async () => {
        const sg = await run('health_wellness', 'med_spa_aesthetics');
        expect(sg.status).toBe('withheld');
        expect(sg.metrics.employment.state).toBe('withheld');
        expect(sg.metrics.employment.withholdCause).toBe('low_confidence_naics');
        expect(sg.metrics.employment.reason).toContain('621498');
    });
});

// ── behaviour: drive the REAL taxonomy config through the REAL policy ───────────────────────────
const deps = {
    resolveCountyFips: () => ({ fips5: '13121', county: 'Fulton County', countyLabel: 'Fulton County', source: 'geocode' }),
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

function run(vertical, subId) {
    return computeStructuralGrowth({
        industryConfig: industryById(vertical), subIndustryConfig: subById(vertical, subId),
        state: 'GA', city: 'Atlanta', geo: { fullCountyFips: '13121' }, geocodeCountyName: 'Fulton County'
    }, deps);
}

describe('behaviour: each batch-1 sub renders, carrying the code the taxonomy holds', () => {
    test.each(BATCH1)('%s/%s renders on %s', async (vertical, sub, code) => {
        const sg = await run(vertical, sub);
        expect(sg.status).toBe('ok');
        expect(sg.vertical).toBe(vertical);
        expect(sg.requestedNaics.code).toBe(code);
        expect(sg.metrics.employment.state).toBe('external');
    });

    test('batch 1 mapped three verticals that previously rendered no section at all', () => {
        // Which verticals are covered is stated once, in structuralGrowthPolicyContract.test.js.
        // Naming a still-unmapped vertical HERE is what broke this file when batch 3 mapped
        // media_entertainment — so this asserts only what batch 1 itself did.
        for (const v of ['salon_beauty', 'food_beverage', 'health_wellness']) {
            expect(STRUCTURAL_GROWTH_POLICY[v]).toBeTruthy();
        }
    });
});

describe('disclosure obligation: a broader county series must say what else it counts', () => {
    test.each(Object.entries(REQUIRED_DISCLOSURES))('%s discloses (contains %s)', async (key, mustContain) => {
        const [vertical, sub] = key.split('/');
        const sg = await run(vertical, sub);
        expect(typeof sg.disclosure).toBe('string');
        expect(sg.disclosure).toContain(mustContain);
    });

    test('an exact mapping carries NO disclosure (we do not hedge a code that fits)', async () => {
        for (const id of ['nail_salon', 'beauty_salon']) expect((await run('salon_beauty', id)).disclosure).toBe(null);
        for (const id of ['full_service_restaurant', 'bar_nightlife', 'restaurant_catering']) {
            expect((await run('food_beverage', id)).disclosure).toBe(null);
        }
        expect((await run('health_wellness', 'chiropractic')).disclosure).toBe(null);
    });
});
