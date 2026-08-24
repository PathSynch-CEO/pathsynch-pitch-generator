'use strict';

/**
 * NAICS backfill — batch 2: professional_services, construction_trades, hospitality_lodging.
 *
 * The researched record for this batch: which NAICS 2022 class each sub-industry was mapped to, which
 * mappings had to disclose a broader class, and which three were withheld because no class describes
 * them. Structural invariants (taxonomy ↔ policy agreement, widening-label coverage, the coverage
 * inventory) live in tests/structuralGrowthPolicyContract.test.js and run over every batch.
 *
 * Batch 2 is where the taxonomy's own blur shows up. Several subs are not single NAICS industries at
 * all — `hr_staffing` spans employment services AND HR consulting, `it_consulting_msp` spans three
 * 6-digit computer-services classes, `legal_accounting_financial` spans three unrelated subsectors.
 * The rule applied throughout: map to the narrowest class that CONTAINS the sub-industry and disclose
 * what else that class counts; where no such class exists, withhold. Never split the difference with
 * a catch-all.
 */

const taxonomy = require('../config/industryTaxonomy.json');
const { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY } = require('../services/structuralGrowth');

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (indId, subId) => (industryById(indId)?.subIndustries || []).find((s) => s.id === subId);

const BATCH2 = [
    ['professional_services', 'legal', '541110', 'Offices of Lawyers'],
    ['professional_services', 'accounting', '5412', 'Accounting, Tax Preparation, Bookkeeping, and Payroll Services'],
    ['professional_services', 'accounting_tax', '5412', 'Accounting, Tax Preparation, Bookkeeping, and Payroll Services'],
    ['professional_services', 'real_estate', '531210', 'Offices of Real Estate Agents and Brokers'],
    ['professional_services', 'insurance', '524210', 'Insurance Agencies and Brokerages'],
    ['professional_services', 'business_consulting', '541611', 'Administrative Management and General Management Consulting Services'],
    ['professional_services', 'financial_advisory_ps', '523940', 'Portfolio Management and Investment Advice'],
    ['professional_services', 'architecture_engineering', '5413', 'Architectural, Engineering, and Related Services'],
    ['professional_services', 'it_consulting_msp', '5415', 'Computer Systems Design and Related Services'],
    ['professional_services', 'hr_staffing', '5613', 'Employment Services'],
    ['professional_services', 'hr_staffing_payroll', '5613', 'Employment Services'],
    ['professional_services', 'property_management_ps', '5313', 'Activities Related to Real Estate'],
    ['professional_services', 'executive_coaching', '611430', 'Professional and Management Development Training'],
    ['construction_trades', 'general_contractor', '236', 'Construction of Buildings'],
    ['construction_trades', 'specialty_contractor', '238', 'Specialty Trade Contractors'],
    ['construction_trades', 'remodeling_renovation', '236118', 'Residential Remodelers'],
    ['construction_trades', 'commercial_construction', '2362', 'Nonresidential Building Construction'],
    ['construction_trades', 'electrical_contractor', '238210', 'Electrical Contractors and Other Wiring Installation Contractors'],
    ['construction_trades', 'plumbing_contractor', '238220', 'Plumbing, Heating, and Air-Conditioning Contractors'],
    ['hospitality_lodging', 'hotel_full_service', '721110', 'Hotels (except Casino Hotels) and Motels'],
    ['hospitality_lodging', 'resort', '721110', 'Hotels (except Casino Hotels) and Motels'],
    ['hospitality_lodging', 'hostel_budget_lodging', '721110', 'Hotels (except Casino Hotels) and Motels'],
    ['hospitality_lodging', 'boutique_hotel_bnb', '721191', 'Bed-and-Breakfast Inns']
];

// The phrase each broadened mapping must keep — the specific thing a reader would otherwise be
// misled about. Dropping it turns an honest disclosure into a bare number.
const REQUIRED_DISCLOSURES = {
    'professional_services/it_consulting_msp': '541511',        // the class also counts custom programming shops
    'professional_services/hr_staffing': '541612',              // HR consulting is elsewhere
    'professional_services/hr_staffing_payroll': '541214',      // payroll is elsewhere — half this sub is unmeasured
    'professional_services/property_management_ps': '531320',   // appraisers ride along
    'professional_services/executive_coaching': '541611',       // an advisory-led coaching practice counts there instead
    'construction_trades/plumbing_contractor': 'HVAC',          // NAICS does not split plumbing from heating and cooling
    'hospitality_lodging/hotel_full_service': '721120',         // casino hotels are excluded
    'hospitality_lodging/resort': 'no resort class',            // the honest statement of why this equals the hotel number
    'hospitality_lodging/hostel_budget_lodging': '721310',      // hostels are counted elsewhere
    'hospitality_lodging/boutique_hotel_bnb': '721110'          // a boutique hotel counts there, not here
};

// Subs withheld by design: no code invented, and the reason has to name what was rejected.
const WITHHELD = {
    'professional_services/legal_accounting_financial': ['5411', '5412', '54'],
    'hospitality_lodging/vacation_rental': ['721199', '531311', 'non-employer'],
    'hospitality_lodging/event_venue_banquet': ['722320', '531120']
};

describe('batch 2 — the researched codes are pinned, not re-derivable by guess', () => {
    test.each(BATCH2)('%s/%s → %s %s', (vertical, sub, code, label) => {
        const s = subById(vertical, sub);
        expect(s).toBeTruthy();
        expect(s.naicsCode).toBe(code);
        expect(s.naicsLabel).toBe(label);
    });

    test('construction_trades is fully mapped', () => {
        expect(industryById('construction_trades').subIndustries.filter((s) => !s.naicsCode)).toEqual([]);
    });

    test('professional_services is mapped except legal_accounting_financial', () => {
        const missing = industryById('professional_services').subIndustries.filter((s) => !s.naicsCode);
        expect(missing.map((s) => s.id)).toEqual(['legal_accounting_financial']);
    });

    test('hospitality_lodging is mapped except vacation_rental and event_venue_banquet', () => {
        const missing = industryById('hospitality_lodging').subIndustries.filter((s) => !s.naicsCode);
        expect(missing.map((s) => s.id).sort()).toEqual(['event_venue_banquet', 'vacation_rental']);
    });

    test('financial_advisory_ps uses the 2022 code, not the retired 523920/523930 pair', () => {
        // NAICS 2017 merged portfolio management and investment advice into 523940. A code from the
        // pre-2017 structure would not exist in the QCEW series at all.
        const code = subById('professional_services', 'financial_advisory_ps').naicsCode;
        expect(code).toBe('523940');
        expect(['523920', '523930']).not.toContain(code);
    });

    test('remodeling_renovation and home_services/general_contractor_home share 236118 deliberately', () => {
        // Two taxonomy subs, one NAICS class. That is a fact about NAICS, not a copy-paste error:
        // "remodeling general contractors" is the literal wording of the 236118 definition.
        expect(subById('construction_trades', 'remodeling_renovation').naicsCode).toBe('236118');
        expect(subById('home_services', 'general_contractor_home').naicsCode).toBe('236118');
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
        expect(sg.metrics.employment.state).toBe('withheld');
        expect(sg.metrics.employment.withholdCause).toBe('low_confidence_naics');
        expect(sg.metrics.employment.value).toBeUndefined();
    });

    test('vacation_rental records the QCEW coverage problem, not just the NAICS ambiguity', () => {
        // The decisive fact is not that two codes compete — it is that most short-term-rental hosts
        // are non-employers and are absent from the private-ownership series entirely, so ANY number
        // here would understate the market by construction.
        const r = STRUCTURAL_GROWTH_POLICY.hospitality_lodging.vacation_rental.reason;
        expect(r).toMatch(/non-employer/);
        expect(r).toMatch(/QCEW|private-ownership/);
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

describe('behaviour: each batch-2 sub renders, carrying the code the taxonomy holds', () => {
    test.each(BATCH2)('%s/%s renders on %s', async (vertical, sub, code) => {
        const sg = await run(vertical, sub);
        expect(sg.status).toBe('ok');
        expect(sg.vertical).toBe(vertical);
        expect(sg.requestedNaics.code).toBe(code);
        expect(sg.metrics.employment.state).toBe('external');
    });

    test('business_brokers is untouched by this batch and still withheld', async () => {
        const sg = await run('professional_services', 'business_brokers');
        expect(sg.status).toBe('withheld');
        expect(sg.metrics.employment.reason).toContain('561499');
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
        const exact = BATCH2
            .map(([v, s]) => `${v}/${s}`)
            .filter((k) => !REQUIRED_DISCLOSURES[k]);
        for (const key of exact) {
            const [v, s] = key.split('/');
            expect({ [key]: (await run(v, s)).disclosure }).toEqual({ [key]: null });
        }
        expect(exact.length).toBe(13);
    });

    test('the three lodging subs that share 721110 each explain WHY their number is identical', async () => {
        // Three sub-industries, one NAICS class. Without a disclosure a reader compares three equal
        // numbers and concludes the data is broken; with one, they learn NAICS has no service tier.
        const disclosures = await Promise.all(
            ['hotel_full_service', 'resort', 'hostel_budget_lodging'].map((s) => run('hospitality_lodging', s).then((r) => r.disclosure))
        );
        for (const d of disclosures) expect(d).toContain('721110');
        expect(new Set(disclosures).size).toBe(3);   // each says something different about its own case
    });
});
