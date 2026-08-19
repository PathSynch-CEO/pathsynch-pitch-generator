'use strict';

/**
 * Story S3 (PR-C) — question packs, the evidence gate, the Evidence Ledger, deterministic
 * Competitive Weaknesses (Addition 1), and median benchmarks (Addition 2).
 *
 * The load-bearing test here is the BYTE-IDENTICAL REGRESSION: a sub-industry without a pack must
 * produce output determined solely by computed values and platform defaults, unaffected by the
 * existence of packs for other sub-industries.
 */

const { resolveQuestionPack, resolvePainThresholds, PACKS } = require('../services/questionPacks');
const {
    buildWeaknessThemes,
    DEFAULT_PAIN_THRESHOLDS,
    resolveMarketSeoScore
} = require('../services/competitiveWeaknesses');
const { buildEvidenceLedger, gate, STATE } = require('../services/evidenceLedger');
const { findHedgingViolations, HEDGING_PHRASES } = require('../utils/bannedLanguage');

// A market with a runaway leader, a plurality with no website, a low-response field, weak SEO, and
// stalled velocity — enough that every weakness candidate has data to fire or withhold.
function richReport() {
    return {
        data: {
            seoLandscape: { avgSEOScore: 42 },
            competitors: [
                { name: 'Leader Co', reviewCount: 1200, website: 'a.com', responseRate: 12, daysSinceLastReview: 200, rating: 4.9 },
                { name: 'B Shop', reviewCount: 22, responseRate: 5, daysSinceLastReview: 120, rating: 4.8 },
                { name: 'C Shop', reviewCount: 14, responseRate: 0, daysSinceLastReview: 30, rating: 4.7 },
                { name: 'D Shop', reviewCount: 10, rating: 4.6 },
                { name: 'E Shop', reviewCount: 8, rating: 4.5 }
            ],
            leads: []
        },
        aiVisibilityIntelligence: { mentionRate: 0.3 }
    };
}

describe('resolveQuestionPack — sub -> industry -> none cascade (mirrors resolveReviewCeilings)', () => {
    test('sub-industry pack wins when present', () => {
        const p = resolveQuestionPack('general_merchandise', 'retail');
        expect(p).toBeTruthy();
        expect(p.version).toBe('gm-v1');
    });

    test('falls back to the industry pack when the sub has none', () => {
        const p = resolveQuestionPack('some_uncovered_retail_sub', 'retail');
        expect(p).toBeTruthy();
        expect(p.version).toBe('retail-v1');
    });

    test('returns null when neither tier has a pack (the byte-identical path)', () => {
        expect(resolveQuestionPack('thai_restaurant', 'food_beverage')).toBeNull();
    });

    test('null / custom sub-industry id resolves via industry, or null', () => {
        expect(resolveQuestionPack(null, 'automotive')).toBeTruthy();
        expect(resolveQuestionPack(null, 'food_beverage')).toBeNull();
        expect(resolveQuestionPack(null, null)).toBeNull();
    });

    test('the four active-GTM verticals all resolve', () => {
        expect(resolveQuestionPack('general_merchandise', 'retail')).toBeTruthy();
        expect(resolveQuestionPack('junk_removal', 'home_services')).toBeTruthy();
        expect(resolveQuestionPack('dental_practice', 'health_wellness')).toBeTruthy();
        expect(resolveQuestionPack('auto_repair', 'automotive')).toBeTruthy();
    });
});

describe('resolvePainThresholds', () => {
    test('null pack yields exactly the defaults', () => {
        expect(resolvePainThresholds(null, DEFAULT_PAIN_THRESHOLDS)).toEqual(DEFAULT_PAIN_THRESHOLDS);
    });

    test('pack overrides only the knobs it sets; a 0 override is honored (not treated as absent)', () => {
        const pack = { painThresholds: { noWebsitePct: 55, avgSeoScore: 0 } };
        const t = resolvePainThresholds(pack, DEFAULT_PAIN_THRESHOLDS);
        expect(t.noWebsitePct).toBe(55);
        expect(t.avgSeoScore).toBe(0);
        expect(t.belowReviewThresholdPct).toBe(DEFAULT_PAIN_THRESHOLDS.belowReviewThresholdPct);
    });
});

describe('buildWeaknessThemes — Addition 1 (deterministic, gate first consumer)', () => {
    test('fires the expected weaknesses with CONTIGUOUS ranks 1..n (numbering-gap fix)', () => {
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        expect(w.items.length).toBeGreaterThanOrEqual(4);
        const ranks = w.items.map(i => i.rank);
        expect(ranks).toEqual(ranks.map((_, i) => i + 1)); // 1,2,3,... no gaps, ever
    });

    test('a dropped middle candidate never leaves a numbering hole', () => {
        // Healthy SEO (85) means the weak_seo candidate does NOT fire; ranks must still be contiguous.
        const r = richReport();
        r.data.seoLandscape.avgSEOScore = 85;
        const w = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        expect(w.items.some(i => i.id === 'weak_seo')).toBe(false);
        const ranks = w.items.map(i => i.rank);
        expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    });

    test('SEO weakness reads data.seoLandscape (the SAME source the SEO Landscape prints), not a null field', () => {
        const r = richReport();
        r.data.seoLandscape.avgSEOScore = 42;
        const w = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        const seo = w.items.find(i => i.id === 'weak_seo');
        expect(seo).toBeTruthy();
        expect(seo.theme).toContain('42');
        // and the resolver agrees with what SEO Landscape would print
        expect(resolveMarketSeoScore(r)).toBe(42);
    });

    test('withholds the SEO weakness (never asserts "unknown") when SEO did not resolve', () => {
        const r = richReport();
        delete r.data.seoLandscape;
        const w = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        expect(w.items.some(i => i.id === 'weak_seo')).toBe(false);
        expect(w.withheld.some(x => x.id === 'weak_seo')).toBe(true);
    });

    test('no output string contains any banned hedging phrase, nor "likely struggle"', () => {
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        const blob = JSON.stringify(w.items);
        expect(findHedgingViolations(blob)).toEqual([]);
        expect(/likely\s+struggle/i.test(blob)).toBe(false);
        // and the module never emits the words "satisfaction"/"satisfied" (no review-count conflation)
        expect(/satisf/i.test(blob)).toBe(false);
    });

    test('every fired item states its n via a provenance line', () => {
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        for (const it of w.items) {
            if (it.id === 'weak_seo') continue; // aggregate, provenance is the SEO Landscape
            expect(it.provenance).toMatch(/Computed from \d+ businesses/);
        }
    });

    test('below MIN_N population withholds percentage claims rather than asserting them', () => {
        const r = { data: { competitors: [{ name: 'Solo', reviewCount: 3, rating: 4.5 }], leads: [] } };
        const w = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        expect(w.items.length).toBe(0);
        expect(w.withheld.length).toBeGreaterThan(0);
    });

    test('leader dominance uses the MEDIAN (Addition 2), not the mean', () => {
        // reviews: [8,10,14,22,1200] -> median 14, max 1200 -> ratio ~85x (fires). Mean would be 250.
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        const dom = w.items.find(i => i.id === 'leader_dominance');
        expect(dom).toBeTruthy();
        expect(dom.theme).toContain('median of 14');
    });

    test('empty market renders nothing and withholds every candidate', () => {
        const w = buildWeaknessThemes({ data: { competitors: [], leads: [] } }, DEFAULT_PAIN_THRESHOLDS);
        expect(w.items).toEqual([]);
        expect(w.n).toBe(0);
    });
});

describe('evidence gate primitive', () => {
    test('resolve() returning null -> withheld with the given reason', () => {
        const e = gate({ id: 'x', label: 'X', state: STATE.COMPUTED, resolve: () => null, withheldReason: 'no data' });
        expect(e.state).toBe(STATE.WITHHELD);
        expect(e.reason).toBe('no data');
    });

    test('resolve() throwing is treated as withheld (never crashes the ledger)', () => {
        const e = gate({ id: 'x', label: 'X', state: STATE.COMPUTED, resolve: () => { throw new Error('boom'); }, withheldReason: 'fallback' });
        expect(e.state).toBe(STATE.WITHHELD);
    });

    test('resolve() returning detail admits the entry at its state', () => {
        const e = gate({ id: 'x', label: 'X', state: STATE.COMPUTED, resolve: () => ({ detail: 'ok', n: 5 }) });
        expect(e.state).toBe(STATE.COMPUTED);
        expect(e.n).toBe(5);
    });
});

describe('buildEvidenceLedger', () => {
    test('produces computed / merchant / withheld entries for the current sections', () => {
        const r = richReport();
        const w = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        const led = buildEvidenceLedger(r, {
            pack: resolveQuestionPack('general_merchandise', 'retail'),
            weaknessThemes: { items: w.items, withheld: w.withheld, n: w.n },
            evidencePainPoints: { items: [{}], computedCount: 5 }
        });
        const byId = Object.fromEntries(led.entries.map(e => [e.id, e]));
        expect(byId.competitive_landscape.state).toBe(STATE.COMPUTED);
        expect(byId.competitive_landscape.n).toBe(5);
        expect(byId.review_velocity.state).toBe(STATE.WITHHELD);   // D3
        expect(byId.unit_economics.state).toBe(STATE.MERCHANT);    // Gate 1 non-goal
        expect(byId.digital_authority.state).toBe(STATE.COMPUTED);
    });

    test('withholds cost_of_pain and competitive_landscape on an empty market', () => {
        const led = buildEvidenceLedger({ data: { competitors: [], leads: [] } }, {
            pack: null,
            weaknessThemes: { items: [], withheld: [], n: 0 },
            evidencePainPoints: null
        });
        const byId = Object.fromEntries(led.entries.map(e => [e.id, e]));
        expect(byId.competitive_landscape.state).toBe(STATE.WITHHELD);
        expect(byId.cost_of_pain.state).toBe(STATE.WITHHELD);
    });

    test('emits NO curated (demand-driver / segment) entries for PR-C packs (authored in PR-E)', () => {
        const led = buildEvidenceLedger(richReport(), {
            pack: resolveQuestionPack('general_merchandise', 'retail'),
            weaknessThemes: { items: [], withheld: [], n: 5 },
            evidencePainPoints: null
        });
        expect(led.entries.some(e => e.state === STATE.CURATED)).toBe(false);
    });

    test('emits curated entries ONLY when a pack actually carries the content', () => {
        const led = buildEvidenceLedger(richReport(), {
            pack: { label: 'GM', version: 'gm-v1', demandDrivers: [{ title: 'x' }], segments: [{ name: 'y' }] },
            weaknessThemes: { items: [], withheld: [], n: 5 },
            evidencePainPoints: null
        });
        const curated = led.entries.filter(e => e.state === STATE.CURATED).map(e => e.id);
        expect(curated).toEqual(expect.arrayContaining(['demand_drivers', 'segments']));
    });
});

describe('BYTE-IDENTICAL REGRESSION — a pack-less sub-industry is unaffected by other packs', () => {
    test('resolveQuestionPack is null for an uncovered sub AND uncovered industry', () => {
        expect(resolveQuestionPack('thai_restaurant', 'food_beverage')).toBeNull();
    });

    test('a null pack yields exactly the platform defaults', () => {
        expect(resolvePainThresholds(null, DEFAULT_PAIN_THRESHOLDS)).toEqual(DEFAULT_PAIN_THRESHOLDS);
    });

    test('weakness output for a pack-less sub == baseline computed with defaults, regardless of PACKS contents', () => {
        const r = richReport();
        const packLess = resolveQuestionPack('thai_restaurant', 'food_beverage'); // null
        const withResolver = buildWeaknessThemes(r, resolvePainThresholds(packLess, DEFAULT_PAIN_THRESHOLDS));
        const baseline = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS);
        // packVersion differs only in that a resolved pack would stamp one; here both are null.
        expect(withResolver).toEqual(baseline);
        expect(withResolver.packVersion).toBeNull();
    });

    test('the ledger for a pack-less sub carries no curated rows and no pack version', () => {
        const r = richReport();
        const led = buildEvidenceLedger(r, {
            pack: resolveQuestionPack('thai_restaurant', 'food_beverage'),
            weaknessThemes: { items: [], withheld: [], n: 5 },
            evidencePainPoints: null
        });
        expect(led.packVersion).toBeNull();
        expect(led.entries.some(e => e.state === STATE.CURATED)).toBe(false);
    });

    test('PACKS contains only backend keys and never leaks into the byte-identical path', () => {
        // Sanity: the registry has the 4 GTM verticals and no accidental catch-all under "*".
        expect(Object.keys(PACKS.subIndustries)).toEqual(
            expect.arrayContaining(['general_merchandise', 'junk_removal', 'dental_practice', 'auto_repair'])
        );
        expect(PACKS.subIndustries['*']).toBeUndefined();
    });
});

describe('hedging guard still lists only the intended phrases (weaknesses are hedge-free by construction)', () => {
    test('HEDGING_PHRASES is non-empty and lowercase', () => {
        expect(HEDGING_PHRASES.length).toBeGreaterThan(0);
        for (const p of HEDGING_PHRASES) expect(p).toBe(p.toLowerCase());
    });
});
