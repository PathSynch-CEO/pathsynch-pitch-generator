'use strict';

/**
 * NAICS backfill — batch 4, the FINAL batch. Completes agriculture, commercial_real_estate,
 * education_training, energy_utilities, finance_banking, manufacturing, nonprofit_associations and
 * the rest of transportation_logistics: 29 mapped, 3 withheld.
 *
 * After this, every vertical that CAN be mapped is mapped. The two that remain — government_public_sector
 * and "other" — are excluded by construction, not by omission, and the policy contract asserts that.
 *
 * WHAT BATCH 4 ADDS TO THE METHOD: the first sub-industries whose problem is not classification but
 * COVERAGE. QCEW measures unemployment-insurance-covered PRIVATE employment. For most industries that
 * is the whole market; for agriculture it is roughly half of it, for higher education it excludes every
 * public university, and for water utilities it excludes nearly every municipal system. Those subs still
 * render — the series is real and useful — but each one says what it is missing, because a reader who
 * assumes "employment in this industry" would otherwise be badly wrong about the size of the market.
 */

const taxonomy = require('../config/industryTaxonomy.json');
const { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY } = require('../services/structuralGrowth');

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (indId, subId) => (industryById(indId)?.subIndustries || []).find((s) => s.id === subId);

const BATCH4 = [
    ['agriculture', 'crop_farming', '111', 'Crop Production'],
    ['agriculture', 'livestock', '112', 'Animal Production and Aquaculture'],
    ['agriculture', 'forestry', '113', 'Forestry and Logging'],
    ['commercial_real_estate', 'commercial_property', '531210', 'Offices of Real Estate Agents and Brokers'],
    ['commercial_real_estate', 'property_management', '5313', 'Activities Related to Real Estate'],
    ['education_training', 'higher_education', '6113', 'Colleges, Universities, and Professional Schools'],
    ['education_training', 'corporate_training', '611430', 'Professional and Management Development Training'],
    ['education_training', 'specialty_training', '6115', 'Technical and Trade Schools'],
    ['energy_utilities', 'power_generation', '2211', 'Electric Power Generation, Transmission and Distribution'],
    ['energy_utilities', 'utility_construction', '2371', 'Utility System Construction'],
    ['energy_utilities', 'water_utilities', '221310', 'Water Supply and Irrigation Systems'],
    ['finance_banking', 'commercial_banking', '522110', 'Commercial Banking'],
    ['finance_banking', 'credit_union', '522130', 'Credit Unions'],
    ['finance_banking', 'investment_banking', '523150', 'Investment Banking and Securities Intermediation'],
    ['finance_banking', 'financial_advisory', '523940', 'Portfolio Management and Investment Advice'],
    ['finance_banking', 'payment_processing', '522320', 'Financial Transactions Processing, Reserve, and Clearinghouse Activities'],
    ['manufacturing', 'machine_shop', '332710', 'Machine Shops'],
    ['manufacturing', 'industrial_equipment', '333', 'Machinery Manufacturing'],
    ['manufacturing', 'food_manufacturing_sub', '311', 'Food Manufacturing'],
    ['nonprofit_associations', 'community_social_services', '624', 'Social Assistance'],
    ['nonprofit_associations', 'trade_association', '813910', 'Business Associations'],
    ['nonprofit_associations', 'health_human_services', '624', 'Social Assistance'],
    ['nonprofit_associations', 'environmental_nonprofit', '813312', 'Environment, Conservation and Wildlife Organizations'],
    ['nonprofit_associations', 'advocacy_civic', '813', 'Religious, Grantmaking, Civic, Professional, and Similar Organizations'],
    ['transportation_logistics', 'commercial_aviation', '481111', 'Scheduled Passenger Air Transportation'],
    ['transportation_logistics', 'charter_aviation', '481211', 'Nonscheduled Chartered Passenger Air Transportation'],
    ['transportation_logistics', 'aviation_services', '4881', 'Support Activities for Air Transportation'],
    ['transportation_logistics', 'freight_trucking', '484', 'Truck Transportation'],
    ['transportation_logistics', 'warehousing', '493', 'Warehousing and Storage']
];

const REQUIRED_DISCLOSURES = {
    'agriculture/crop_farming': '300,000',
    'agriculture/livestock': '300,000',
    'agriculture/forestry': '300,000',
    'commercial_real_estate/commercial_property': 'residential agents',
    'commercial_real_estate/property_management': '531320',
    'education_training/higher_education': 'Public universities',
    'energy_utilities/power_generation': 'investor-owned',
    'energy_utilities/water_utilities': 'municipally owned',
    'finance_banking/investment_banking': '523120',
    'nonprofit_associations/health_human_services': '813212',
    'nonprofit_associations/advocacy_civic': '813410',
    'transportation_logistics/freight_trucking': '4885'
};

const WITHHELD = {
    'manufacturing/general_manufacturing': ['31-33', '313'],
    'nonprofit_associations/arts_culture_religious': ['813110', '7111', '712110'],
    'nonprofit_associations/education_nonprofit': ['611691', '813211']
};

describe('batch 4 — the researched codes are pinned, not re-derivable by guess', () => {
    test.each(BATCH4)('%s/%s → %s %s', (vertical, sub, code, label) => {
        const s = subById(vertical, sub);
        expect(s).toBeTruthy();
        expect(s.naicsCode).toBe(code);
        expect(s.naicsLabel).toBe(label);
    });

    test('six verticals are now fully mapped', () => {
        for (const v of ['agriculture', 'commercial_real_estate', 'education_training',
            'energy_utilities', 'finance_banking', 'transportation_logistics']) {
            const missing = industryById(v).subIndustries.filter((s) => !s.naicsCode);
            expect({ [v]: missing.map((s) => s.id) }).toEqual({ [v]: [] });
        }
    });

    test('manufacturing and nonprofit_associations are mapped except their withheld subs', () => {
        expect(industryById('manufacturing').subIndustries.filter((s) => !s.naicsCode).map((s) => s.id))
            .toEqual(['general_manufacturing']);
        expect(industryById('nonprofit_associations').subIndustries.filter((s) => !s.naicsCode).map((s) => s.id).sort())
            .toEqual(['arts_culture_religious', 'education_nonprofit']);
    });
});

describe('sector 52: NAICS 2022 codes, not the 2017 ones they collapsed', () => {
    // Sector 52 was restructured in 2022 the same way sector 51 was (batch 3). 523110 Investment
    // Banking and Securities Dealing and 523120 Securities Brokerage were merged into 523150; a
    // remembered 523110 would not exist in the QCEW series at all.
    test('investment_banking uses 523150, never the collapsed 523110/523120', () => {
        const code = subById('finance_banking', 'investment_banking').naicsCode;
        expect(code).toBe('523150');
        expect(['523110', '523120']).not.toContain(code);
    });

    test('the merge is DISCLOSED — the code alone does not reveal that brokerages are counted', () => {
        expect(STRUCTURAL_GROWTH_POLICY.finance_banking.investment_banking.disclosure).toContain('523120');
    });

    test('commercial_banking and credit_union survived 2022 unchanged', () => {
        expect(subById('finance_banking', 'commercial_banking').naicsCode).toBe('522110');
        expect(subById('finance_banking', 'credit_union').naicsCode).toBe('522130');
    });
});

describe('coverage, not classification: subs where QCEW measures less than the whole market', () => {
    // These render, because the series is real and useful. Each says what it is missing, because a
    // reader who takes the tile as "employment in this industry" would otherwise be badly wrong.
    test('all three agriculture subs share ONE coverage disclosure, so they cannot drift apart', async () => {
        const [crop, live, forest] = await Promise.all(
            ['crop_farming', 'livestock', 'forestry'].map((s) => run('agriculture', s).then((r) => r.disclosure))
        );
        for (const d of [crop, live, forest]) {
            expect(d).toContain('unemployment-insurance-covered');
            expect(d).toContain('300,000');
            expect(d).toContain('not total farm labour');
        }
        // Same caveat, different lead-in naming each sub's own class.
        expect(crop).toContain('111 Crop Production');
        expect(live).toContain('112 Animal Production');
        expect(forest).toContain('113 Forestry and Logging');
        expect(new Set([crop, live, forest]).size).toBe(3);
    });

    test('higher_education says the public institutions are absent, not merely that it is private data', async () => {
        const d = (await run('education_training', 'higher_education')).disclosure;
        expect(d).toContain('PRIVATE ownership only');
        expect(d).toContain('Public universities and community colleges');
    });

    test('water_utilities warns the number will READ SMALL, not just that it is partial', async () => {
        // The strongest form of this disclosure: it tells the reader which direction the error runs.
        const d = (await run('energy_utilities', 'water_utilities')).disclosure;
        expect(d).toContain('municipally owned');
        expect(d).toMatch(/read far smaller than the market/);
    });
});

describe('withheld by design — no code invented, and the reason names what was rejected', () => {
    test.each(Object.entries(WITHHELD))('%s', (key, mustMention) => {
        const [vertical, sub] = key.split('/');
        expect(subById(vertical, sub).naicsCode).toBeUndefined();
        const rule = STRUCTURAL_GROWTH_POLICY[vertical][sub];
        expect(rule.allow).toBe(false);
        for (const token of mustMention) expect(rule.reason).toContain(token);
    });

    test.each(Object.keys(WITHHELD))('%s produces a withheld section, never an approximate number', async (key) => {
        const [vertical, sub] = key.split('/');
        const sg = await run(vertical, sub);
        expect(sg.status).toBe('withheld');
        expect(sg.metrics.employment.withholdCause).toBe('low_confidence_naics');
        expect(sg.metrics.employment.value).toBeUndefined();
    });
});

describe('the backfill is complete', () => {
    test('every taxonomy sub-industry either carries a code or is withheld with a reason', () => {
        const unaccounted = [];
        for (const ind of taxonomy.industries) {
            // The two verticals excluded by construction; the policy contract asserts WHY.
            if (ind.id === 'government_public_sector' || ind.id === 'other') continue;
            for (const sub of ind.subIndustries || []) {
                const rule = STRUCTURAL_GROWTH_POLICY[ind.id] && STRUCTURAL_GROWTH_POLICY[ind.id][sub.id];
                const decided = Boolean(sub.naicsCode) || (rule && rule.allow === false && rule.reason);
                if (!decided) unaccounted.push(`${ind.id}/${sub.id}`);
            }
        }
        expect(unaccounted).toEqual([]);
    });

    test('no sub-industry outside the two excluded verticals is missing a policy entry', () => {
        const unlisted = [];
        for (const ind of taxonomy.industries) {
            if (ind.id === 'government_public_sector' || ind.id === 'other') continue;
            for (const sub of ind.subIndustries || []) {
                if (!(STRUCTURAL_GROWTH_POLICY[ind.id] || {})[sub.id]) unlisted.push(`${ind.id}/${sub.id}`);
            }
        }
        expect(unlisted).toEqual([]);
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

describe('behaviour: each batch-4 sub renders, carrying the code the taxonomy holds', () => {
    test.each(BATCH4)('%s/%s renders on %s', async (vertical, sub, code) => {
        const sg = await run(vertical, sub);
        expect(sg.status).toBe('ok');
        expect(sg.vertical).toBe(vertical);
        expect(sg.requestedNaics.code).toBe(code);
        expect(sg.metrics.employment.state).toBe('external');
    });

    test('truck_stops, mapped long before this batch, is untouched by adding five siblings', async () => {
        const sg = await run('transportation_logistics', 'truck_stops');
        expect(sg.status).toBe('ok');
        expect(sg.requestedNaics.code).toBe('457120');
        expect(sg.disclosure).toContain('457120');
    });
});

describe('disclosure obligation: a broader or thinner county series must say so', () => {
    test.each(Object.entries(REQUIRED_DISCLOSURES))('%s discloses (contains %s)', async (key, mustContain) => {
        const [vertical, sub] = key.split('/');
        const sg = await run(vertical, sub);
        expect(typeof sg.disclosure).toBe('string');
        expect(sg.disclosure).toContain(mustContain);
    });

    test('an exact mapping carries NO disclosure (we do not hedge a code that fits)', async () => {
        const exact = BATCH4.map(([v, s]) => `${v}/${s}`).filter((k) => !REQUIRED_DISCLOSURES[k]);
        for (const key of exact) {
            const [v, s] = key.split('/');
            expect({ [key]: (await run(v, s)).disclosure }).toEqual({ [key]: null });
        }
        expect(exact.length).toBe(17);
    });
});
