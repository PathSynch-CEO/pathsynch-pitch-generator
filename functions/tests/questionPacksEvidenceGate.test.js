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
    resolveMarketSeoScore,
    computeWeaknessAggregates
} = require('../services/competitiveWeaknesses');
const { buildEvidenceLedger, gate, STATE } = require('../services/evidenceLedger');
const { canonicalReviewMedian, computePopulationAggregates } = require('../services/evidencePainPoints');
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

describe('N3/Q4 — one canonical review median across benchmarks, weaknesses, and pain points', () => {
    const reportData = {
        data: {
            leads: [{ name: 'L1', reviewCount: 5 }, { name: 'L2', reviewCount: 15 }],
            competitors: [{ name: 'C1', reviewCount: 100 }, { name: 'C2', reviewCount: 40 }, { name: 'C3', reviewCount: 0 }]
        }
    };

    test('weakness aggregate median == pain-points aggregate median == canonicalReviewMedian over the same population', () => {
        const canon = canonicalReviewMedian(reportData.data.leads, reportData.data.competitors);
        const weakAgg = computeWeaknessAggregates(reportData);
        const painAgg = computePopulationAggregates(require('../services/evidencePainPoints').collectPopulation(reportData));
        expect(weakAgg.medianReviews).toBe(canon);
        expect(painAgg.medianReviews).toBe(canon);
    });

    test('the canonical median includes zero-review businesses and dedupes overlapping lead/competitor names', () => {
        const leads = [{ name: 'Dup Co', reviewCount: 10 }];
        const competitors = [{ name: 'dup co', reviewCount: 10 }, { name: 'X', reviewCount: 0 }, { name: 'Y', reviewCount: 200 }];
        // deduped population [Dup Co:10, X:0, Y:200] -> sorted [0,10,200] -> median 10
        expect(canonicalReviewMedian(leads, competitors)).toBe(10);
    });
});

describe('B1 — gate distinguishes resolver_error from no_data and logs failures', () => {
    test('a throwing resolver: withholdCause resolver_error, customer-facing reason unchanged, logged with the resolver id + error', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const e = gate({ id: 'digital_authority', label: 'SEO', state: STATE.COMPUTED,
            resolve: () => { throw new Error('census 503'); }, withheldReason: 'SEO did not resolve this run.' });
        expect(e.state).toBe(STATE.WITHHELD);
        expect(e.withholdCause).toBe('resolver_error');
        expect(e.reason).toBe('SEO did not resolve this run.'); // copy the merchant reads is unchanged
        const logged = warn.mock.calls.map(c => c.join(' ')).join('\n');
        expect(logged).toContain('digital_authority'); // resolver id present in the log
        expect(logged).toContain('census 503');         // underlying error message present
        warn.mockRestore();
    });

    test('a legitimately-empty resolver: withholdCause no_data, same reason, no error logged', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const e = gate({ id: 'digital_authority', label: 'SEO', state: STATE.COMPUTED,
            resolve: () => null, withheldReason: 'SEO did not resolve this run.' });
        expect(e.withholdCause).toBe('no_data');
        expect(e.reason).toBe('SEO did not resolve this run.');
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test('an outage in a real ledger resolver surfaces as resolver_error, not a silent absence', () => {
        // reportData whose seoLandscape getter throws simulates a data-source access fault.
        const r = richReport();
        Object.defineProperty(r.data, 'seoLandscape', { get() { throw new Error('backend down'); } });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const led = buildEvidenceLedger(r, { pack: null, weaknessThemes: { items: [], withheld: [], n: 5 }, evidencePainPoints: null });
        const seoEntry = led.entries.find(e => e.id === 'digital_authority');
        expect(seoEntry.state).toBe(STATE.WITHHELD);
        expect(seoEntry.withholdCause).toBe('resolver_error');
        expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toContain('digital_authority');
        warn.mockRestore();
    });
});

describe('N4 — industry-fallback tier: a sub without its own pack inherits the industry pack (only packVersion differs)', () => {
    test('an uncovered retail sub resolves to the retail industry pack, not null', () => {
        const p = resolveQuestionPack('uncovered_retail_sub', 'retail');
        expect(p).toBeTruthy();
        expect(p.version).toBe('retail-v1');
    });

    test('weakness ITEMS match the truly-pack-less baseline; only packVersion differs (thresholds equal defaults today)', () => {
        const r = richReport();
        const inheritedPack = resolveQuestionPack('uncovered_retail_sub', 'retail'); // retail-v1 via fallback
        const th = resolvePainThresholds(inheritedPack, DEFAULT_PAIN_THRESHOLDS);
        th._packVersion = inheritedPack.version;
        const inherited = buildWeaknessThemes(r, th);
        const baseline = buildWeaknessThemes(r, DEFAULT_PAIN_THRESHOLDS); // null-pack path

        expect(inherited.items).toEqual(baseline.items);
        expect(inherited.withheld).toEqual(baseline.withheld);
        expect(inherited.packVersion).toBe('retail-v1'); // the ONLY difference
        expect(baseline.packVersion).toBeNull();
    });

    // Inheritance carries the pack's CONTENT faithfully. Two invariants, split when the retail pack
    // gained segment definitions (Workstream 5): a content-free pack must still add no curated rows,
    // and a content-carrying pack must add exactly the rows its content backs.
    test('inheriting a CONTENT-FREE pack differs from a pack-less sub only in packVersion (no curated rows)', () => {
        const r = richReport();
        const wt = { items: [], withheld: [], n: 5 };
        // automotive-v1 carries thresholds only — no segments, no demandDrivers.
        const inherited = buildEvidenceLedger(r, { pack: resolveQuestionPack('uncovered_auto_sub', 'automotive'), weaknessThemes: wt, evidencePainPoints: null });
        const packless = buildEvidenceLedger(r, { pack: resolveQuestionPack('thai_restaurant', 'food_beverage'), weaknessThemes: wt, evidencePainPoints: null });

        expect(inherited.packVersion).toBe('automotive-v1');
        expect(packless.packVersion).toBeNull();
        expect(inherited.entries.some(e => e.state === STATE.CURATED)).toBe(false);
        expect(packless.entries.some(e => e.state === STATE.CURATED)).toBe(false);
        const idState = l => l.entries.map(e => e.id + ':' + e.state).join('|');
        expect(idState(inherited)).toBe(idState(packless)); // identical structure, only provenance differs
    });

    test('inheriting a CONTENT-CARRYING pack adds exactly the curated rows its content backs', () => {
        const r = richReport();
        const wt = { items: [], withheld: [], n: 5 };
        const retail = buildEvidenceLedger(r, { pack: resolveQuestionPack('uncovered_retail_sub', 'retail'), weaknessThemes: wt, evidencePainPoints: null });
        const packless = buildEvidenceLedger(r, { pack: resolveQuestionPack('thai_restaurant', 'food_beverage'), weaknessThemes: wt, evidencePainPoints: null });

        expect(retail.packVersion).toBe('retail-v1');
        // retail-v1 defines segments (and no demand drivers) → exactly one curated row, `segments`.
        const curated = retail.entries.filter(e => e.state === STATE.CURATED).map(e => e.id);
        expect(curated).toEqual(['segments']);
        // and it is purely ADDITIVE: every pack-less entry still appears, unchanged in state.
        const idState = l => l.entries.filter(e => e.state !== STATE.CURATED).map(e => e.id + ':' + e.state).join('|');
        expect(idState(retail)).toBe(idState(packless));
    });
});
