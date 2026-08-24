'use strict';

/**
 * NAICS backfill — batch 3: agencies_marketing_services, media_entertainment, technology_saas.
 *
 * The researched record for this batch. Structural invariants (taxonomy ↔ policy agreement,
 * widening-label coverage, retired-code guard, coverage inventory) live in
 * tests/structuralGrowthPolicyContract.test.js and run over every batch.
 *
 * WHAT MAKES BATCH 3 DIFFERENT: it runs straight through sector 51, the part of the classification
 * NAICS 2022 restructured wholesale. Software publishing moved 511210 → 513210 and the whole 515
 * Broadcasting subsector became 516. A code remembered from NAICS 2017 does not merely mis-describe
 * the market here — it does not exist in the QCEW series at all, and the widening walk carries it into
 * a DIFFERENT industry (511 in 2022 means newspapers and books). That is how the stale technology_saas
 * parent code was found, and it is why every code below is pinned as a 2022 code specifically.
 *
 * The other theme: NAICS splits marketing agencies on whether they PLACE MEDIA, not on channel. There
 * is no digital, social, SEO or experiential class. Each of those subs therefore renders with a
 * disclosure saying so, rather than implying a channel-specific number exists.
 */

const taxonomy = require('../config/industryTaxonomy.json');
const { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY } = require('../services/structuralGrowth');

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (indId, subId) => (industryById(indId)?.subIndustries || []).find((s) => s.id === subId);

const BATCH3 = [
    ['agencies_marketing_services', 'creative_full_service_agency', '541810', 'Advertising Agencies'],
    ['agencies_marketing_services', 'digital_marketing_agency', '541810', 'Advertising Agencies'],
    ['agencies_marketing_services', 'social_media_agency', '541810', 'Advertising Agencies'],
    ['agencies_marketing_services', 'seo_content_agency', '541613', 'Marketing Consulting Services'],
    ['agencies_marketing_services', 'pr_communications_firm', '541820', 'Public Relations Agencies'],
    ['agencies_marketing_services', 'branding_design_studio', '541430', 'Graphic Design Services'],
    ['agencies_marketing_services', 'media_buying_agency', '541830', 'Media Buying Agencies'],
    ['agencies_marketing_services', 'web_development_agency', '541511', 'Custom Computer Programming Services'],
    ['agencies_marketing_services', 'video_production_marketing', '512110', 'Motion Picture and Video Production'],
    ['agencies_marketing_services', 'experiential_event_marketing', '5418', 'Advertising, Public Relations, and Related Services'],
    ['agencies_marketing_services', 'staffing_recruiting_agency', '5613', 'Employment Services'],
    ['media_entertainment', 'film_video_production', '512110', 'Motion Picture and Video Production'],
    ['media_entertainment', 'photography_studio', '541921', 'Photography Studios, Portrait'],
    ['media_entertainment', 'performing_arts_theater', '7111', 'Performing Arts Companies'],
    ['media_entertainment', 'music_venue', '711310', 'Promoters of Performing Arts, Sports, and Similar Events with Facilities'],
    ['media_entertainment', 'broadcasting_media', '5161', 'Radio and Television Broadcasting Stations'],
    ['technology_saas', 'software_development', '541511', 'Custom Computer Programming Services'],
    ['technology_saas', 'it_services', '5415', 'Computer Systems Design and Related Services'],
    ['technology_saas', 'cloud_hosting', '518210', 'Computing Infrastructure Providers, Data Processing, Web Hosting, and Related Services'],
    ['technology_saas', 'saas_products', '513210', 'Software Publishers'],
    ['technology_saas', 'tech_consulting', '541512', 'Computer Systems Design Services']
];

const REQUIRED_DISCLOSURES = {
    'agencies_marketing_services/digital_marketing_agency': 'no digital or performance-marketing class',
    'agencies_marketing_services/social_media_agency': 'no social-media class',
    'agencies_marketing_services/seo_content_agency': '541810',            // a media-placing SEO shop counts there instead
    'agencies_marketing_services/web_development_agency': '541430',        // purely visual web design counts as graphic design
    'agencies_marketing_services/video_production_marketing': 'film and television',
    'agencies_marketing_services/experiential_event_marketing': '561920',  // trade-show organizers sit outside the group
    'agencies_marketing_services/staffing_recruiting_agency': '711410',    // talent agents are elsewhere
    'media_entertainment/photography_studio': '541922',                    // commercial photography is elsewhere
    'media_entertainment/performing_arts_theater': '611610',               // dance SCHOOLS are elsewhere
    'media_entertainment/music_venue': '711320',                           // promoters without a facility are elsewhere
    'media_entertainment/broadcasting_media': 'podcast',                   // podcasting is not broadcasting
    'technology_saas/it_services': '541511'                                // custom programming shops ride along
};

const WITHHELD = {
    'media_entertainment/event_production_av': ['532490', '561920', '512199'],
    'media_entertainment/gaming_esports': ['513210', '711211', '713120']
};

describe('batch 3 — the researched codes are pinned, not re-derivable by guess', () => {
    test.each(BATCH3)('%s/%s → %s %s', (vertical, sub, code, label) => {
        const s = subById(vertical, sub);
        expect(s).toBeTruthy();
        expect(s.naicsCode).toBe(code);
        expect(s.naicsLabel).toBe(label);
    });

    test('agencies_marketing_services and technology_saas are fully mapped', () => {
        for (const v of ['agencies_marketing_services', 'technology_saas']) {
            const missing = industryById(v).subIndustries.filter((s) => !s.naicsCode);
            expect({ [v]: missing.map((s) => s.id) }).toEqual({ [v]: [] });
        }
    });

    test('media_entertainment is mapped except event_production_av and gaming_esports', () => {
        const missing = industryById('media_entertainment').subIndustries.filter((s) => !s.naicsCode);
        expect(missing.map((s) => s.id).sort()).toEqual(['event_production_av', 'gaming_esports']);
    });
});

describe('sector 51: NAICS 2022 codes, not the 2017 ones they replaced', () => {
    // A 2017 code here is not a near-miss. It is absent from the QCEW series, and the widening walk
    // carries it into an unrelated industry — 511210 widens to 511, which in 2022 is newspapers and books.
    test('saas_products uses 513210, never the retired 511210', () => {
        expect(subById('technology_saas', 'saas_products').naicsCode).toBe('513210');
    });

    test('the technology_saas PARENT code was corrected too — it lands in every stored report', () => {
        // api/market.js stamps `subIndustryConfig?.naicsCode || industryConfig?.naicsCode` into
        // report.industry.naicsCode, so a stale parent reaches reports even with no sub selected.
        expect(industryById('technology_saas').naicsCode).toBe('513210');
        expect(industryById('technology_saas').naicsCode).not.toBe('511210');
        expect(industryById('technology_saas').naicsLabel).toBe('Software Publishers');
    });

    test('broadcasting_media uses the 516 subsector, never the retired 515', () => {
        const code = subById('media_entertainment', 'broadcasting_media').naicsCode;
        expect(code).toBe('5161');
        expect(code.startsWith('515')).toBe(false);
    });

    test('cloud_hosting uses the 2022 Computing Infrastructure Providers title', () => {
        const s = subById('technology_saas', 'cloud_hosting');
        expect(s.naicsCode).toBe('518210');
        // The 2017 title was "Data Processing, Hosting, and Related Services"; 2022 widened its scope
        // and renamed it. Carrying the old title forward would misdescribe what the series counts.
        expect(s.naicsLabel).toMatch(/^Computing Infrastructure Providers/);
    });
});

describe('marketing agencies: NAICS splits on media placement, not on channel', () => {
    const codeOf = (id) => subById('agencies_marketing_services', id).naicsCode;

    test('agencies that create AND place media all land on 541810, whatever the channel', () => {
        expect(codeOf('creative_full_service_agency')).toBe('541810');
        expect(codeOf('digital_marketing_agency')).toBe('541810');
        expect(codeOf('social_media_agency')).toBe('541810');
    });

    test('an agency that advises without placing media lands on 541613 instead', () => {
        expect(codeOf('seo_content_agency')).toBe('541613');
    });

    test('the three 541810 subs each explain WHY their number is identical', async () => {
        // Same shape as the 721110 lodging trio in batch 2: without a disclosure a reader sees three
        // equal numbers and concludes the data is broken.
        const [creative, digital, social] = await Promise.all(
            ['creative_full_service_agency', 'digital_marketing_agency', 'social_media_agency']
                .map((s) => run('agencies_marketing_services', s).then((r) => r.disclosure))
        );
        expect(creative).toBeNull();                    // 541810 IS the full-service agency definition
        expect(digital).toContain('advertising agency');
        expect(social).toContain('advertising agency');
        expect(digital).not.toBe(social);               // each names its own missing class
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

    test('gaming_esports records that its three candidates share no common class', () => {
        // The decisive fact is not that a code is hard to pick — it is that no class contains more
        // than one third of the sub-industry, so every candidate is wrong for most of it.
        const r = STRUCTURAL_GROWTH_POLICY.media_entertainment.gaming_esports.reason;
        expect(r).toMatch(/three unrelated sectors/i);
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

describe('behaviour: each batch-3 sub renders, carrying the code the taxonomy holds', () => {
    test.each(BATCH3)('%s/%s renders on %s', async (vertical, sub, code) => {
        const sg = await run(vertical, sub);
        expect(sg.status).toBe('ok');
        expect(sg.vertical).toBe(vertical);
        expect(sg.requestedNaics.code).toBe(code);
        expect(sg.metrics.employment.state).toBe('external');
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
        const exact = BATCH3.map(([v, s]) => `${v}/${s}`).filter((k) => !REQUIRED_DISCLOSURES[k]);
        for (const key of exact) {
            const [v, s] = key.split('/');
            expect({ [key]: (await run(v, s)).disclosure }).toEqual({ [key]: null });
        }
        expect(exact.length).toBe(9);
    });
});
