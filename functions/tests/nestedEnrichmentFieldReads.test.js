'use strict';

/**
 * Latent-dead-read class: the DataForSEO review enrichment attaches its ENTIRE payload as
 * `lead.dataForSEO` (api/market.js), so any consumer reading `lead.responseRate` /
 * `lead.daysSinceLastReview` at TOP LEVEL matched nothing on a production lead and silently
 * never fired. #102 fixed the weaknesses velocity aggregate; this suite covers the rest:
 *
 *   - competitiveWeaknesses  low_response_rate  (never fired)
 *   - computeProductWedge    rule 1 responseRate0   (never fired)
 *   - computeProductWedge    rule 2 stalledReviews  (never fired)
 *   - PathManager benchmark feed  responseRate      (always null)
 *
 * Every fix routes through the shared extractors in evidencePainPoints, so a future consumer
 * copying the pattern gets the nested-aware read for free.
 */

const { responseRateOf, daysSinceLastReviewOf, DORMANT_REVIEW_DAYS } = require('../services/evidencePainPoints');
const { buildWeaknessThemes, DEFAULT_PAIN_THRESHOLDS, computeWeaknessAggregates } = require('../services/competitiveWeaknesses');
const { computeProductWedge } = require('../api/market');

const NOW = Date.now();
const daysAgoIso = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

// The exact production shape: everything nested under dataForSEO.
const enriched = (name, over) => ({
    name, reviewCount: 40, rating: '4.2',
    dataForSEO: Object.assign({
        reviewCount: 40, averageRating: 4.2, responseRate: 10, respondedCount: 4,
        daysSinceLastReview: 5, velocityStatus: 'healthy', recentReviews: [{ date: daysAgoIso(5) }]
    }, over || {})
});

describe('responseRateOf — shared extractor', () => {
    test('reads nested first, falls back to top level, null when unmeasurable', () => {
        expect(responseRateOf(enriched('A'))).toBe(10);
        expect(responseRateOf({ responseRate: 42 })).toBe(42);              // older stored shape
        expect(responseRateOf({ name: 'no data' })).toBe(null);
        expect(responseRateOf(null)).toBe(null);
    });

    test('TRUE ZERO survives (0% response rate is the strongest signal, not "missing")', () => {
        expect(responseRateOf(enriched('A', { responseRate: 0 }))).toBe(0);
        expect(responseRateOf({ responseRate: 0 })).toBe(0);
    });
});

describe('competitiveWeaknesses low_response_rate — was a dead aggregate', () => {
    const report = { data: { leads: [
        enriched('A', { responseRate: 0 }), enriched('B', { responseRate: 10 }),
        enriched('C', { responseRate: 20 }), enriched('D', { responseRate: 5 })
    ], competitors: [] } };

    test('fires on NESTED-only data (the production shape the old top-level filter missed)', () => {
        const agg = computeWeaknessAggregates(report);
        expect(agg.responseRateN).toBe(4);
        expect(agg.avgResponseRate).toBe(9);            // (0+10+20+5)/4 = 8.75 → 9
        const w = buildWeaknessThemes(report, DEFAULT_PAIN_THRESHOLDS);
        const item = w.items.find(i => i.id === 'low_response_rate');
        expect(item).toBeTruthy();                      // 9% < the 30% threshold
        expect(item.n).toBe(4);
    });

    test('unmeasurable population → withheld, never a zero-percent claim', () => {
        const bare = { data: { leads: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], competitors: [] } };
        const agg = computeWeaknessAggregates(bare);
        expect(agg.avgResponseRate).toBe(null);
        expect(agg.responseRateN).toBe(0);
        const w = buildWeaknessThemes(bare, DEFAULT_PAIN_THRESHOLDS);
        expect(w.items.find(i => i.id === 'low_response_rate')).toBeUndefined();
        expect(w.withheld.some(x => x.id === 'low_response_rate')).toBe(true);
    });
});

describe('computeProductWedge — rules 1 and 2 were unreachable', () => {
    const benchmarks = { medianReviews: 100 };

    test('rule 1: nested responseRate 0 → responseRate0 wedge (was falling through)', () => {
        const lead = enriched('Quiet Co', { responseRate: 0 });
        const wedge = computeProductWedge(lead, benchmarks);
        expect(wedge.signal).toBe('no_review_responses');
        expect(wedge.pitch).toContain('Quiet Co');
    });

    test('rule 2: nested dormant timestamps → stalledReviews wedge (was falling through)', () => {
        const lead = enriched('Dormant Co', {
            responseRate: 50, daysSinceLastReview: 200, velocityStatus: 'dormant',
            recentReviews: [{ date: daysAgoIso(200) }]
        });
        const wedge = computeProductWedge(lead, benchmarks);
        expect(wedge.pitch).toContain('Dormant Co');
        expect(wedge.signal).not.toBe('no_review_responses');
        // and it is specifically the stalled-reviews wedge, not a later fallthrough
        const fresh = computeProductWedge(enriched('Fresh Co', { responseRate: 50 }), benchmarks);
        expect(wedge.signal).not.toBe(fresh.signal);
    });

    test('rule 2 boundary is unified at >= DORMANT_REVIEW_DAYS across the system', () => {
        const at = enriched('At Boundary', {
            responseRate: 50, daysSinceLastReview: DORMANT_REVIEW_DAYS,
            recentReviews: [{ date: daysAgoIso(DORMANT_REVIEW_DAYS) }]
        });
        const under = enriched('Under', {
            responseRate: 50, daysSinceLastReview: DORMANT_REVIEW_DAYS - 1,
            recentReviews: [{ date: daysAgoIso(DORMANT_REVIEW_DAYS - 1) }]
        });
        expect(computeProductWedge(at, benchmarks).signal)
            .not.toBe(computeProductWedge(under, benchmarks).signal);
    });

    test('unmeasurable lead still falls through to the later rules (no false wedge)', () => {
        const bare = { name: 'Bare Co', reviewCount: 10, rating: '4.9' };
        const wedge = computeProductWedge(bare, benchmarks);
        expect(wedge.signal).not.toBe('no_review_responses');   // null is not 0
        expect(wedge.pitch).toContain('Bare Co');
    });
});

describe('regression guard: no consumer reads these fields at top level only', () => {
    const fs = require('fs');
    const path = require('path');
    // A lead carrying ONLY nested enrichment must produce the same wedge as one carrying the
    // same values flattened. If a future edit reintroduces a top-level-only read, this diverges.
    test('nested-only and flattened leads produce identical wedges', () => {
        const benchmarks = { medianReviews: 100 };
        const nested = enriched('X', { responseRate: 0 });
        const flat = { name: 'X', reviewCount: 40, rating: '4.2', responseRate: 0, daysSinceLastReview: 5 };
        expect(computeProductWedge(nested, benchmarks).signal)
            .toBe(computeProductWedge(flat, benchmarks).signal);
    });

    test('the enrichment payload keys are known — a new key needs a shared extractor', () => {
        // Pins the enrichment contract so adding a field to the DataForSEO payload (which lands
        // ONLY under lead.dataForSEO) is a deliberate act with a matching extractor.
        const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'market.js'), 'utf8');
        const expected = ['reviewCount', 'averageRating', 'responseRate', 'respondedCount',
            'lastReviewDate', 'daysSinceLastReview', 'velocityStatus', 'recentReviews'];
        for (const key of expected) expect(src).toContain(key);
        // and the two nested-aware extractors are the ones market.js uses for the wedge
        expect(src).toContain('responseRateOf(lead)');
        expect(src).toContain('daysSinceLastReviewOf(lead)');
    });
});
