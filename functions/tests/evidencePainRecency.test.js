'use strict';

/**
 * Review RECENCY (dormancy) pain point + shared recency extractor (decision 2026-08-22).
 * "Recency of last review is a sharper pain point than volume, because it is undeniable and
 * time-bound." — computed from the Places/DataForSEO review timestamps the report already persists.
 *
 * Rules under test:
 *  - dormant_reviews fires ONLY over the measurable subset (businesses with a resolvable
 *    last-review date), MIN_N-gated on that subset; insufficient coverage → NO claim (withheld
 *    posture per the Aug-19 mockup — never a guess).
 *  - The extractor mirrors opportunityScorer's semantics (freshest valid recentReviews date,
 *    future dates guarded) and is SHARED with the Competitive Weaknesses builder, whose old
 *    inline filter read a top-level field production never sets (latent dead aggregate).
 *  - The velocity TREND stays out (D3): recency is an observation, not a trend.
 */

const {
    buildEvidencePainPoints,
    daysSinceLastReviewOf,
    DORMANT_REVIEW_DAYS,
    MIN_N
} = require('../services/evidencePainPoints');
const { buildWeaknessThemes, DEFAULT_PAIN_THRESHOLDS } = require('../services/competitiveWeaknesses');

const NOW = new Date('2026-08-22T12:00:00Z');
const daysAgoIso = (d) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

// A business whose ONLY recency evidence is nested review timestamps (the production shape).
const bizWithReviewDates = (name, daysAgo, extra) => Object.assign({
    name, reviewCount: 50,
    dataForSEO: { recentReviews: [{ date: daysAgoIso(daysAgo), rating: 5, text: 'x' }] }
}, extra || {});

describe('daysSinceLastReviewOf — shared extractor', () => {
    test('freshest valid recentReviews date wins; invalid and future dates are skipped', () => {
        const b = {
            dataForSEO: {
                recentReviews: [
                    { date: 'not-a-date' },
                    { date: daysAgoIso(-3) },       // future — guarded (days >= 0)
                    { date: daysAgoIso(200) },
                    { date: daysAgoIso(40) }        // freshest valid
                ],
                daysSinceLastReview: 999            // must NOT override actual timestamps
            }
        };
        expect(daysSinceLastReviewOf(b, NOW.getTime())).toBe(40);
    });

    test('falls back to nested daysSinceLastReview, then top-level; null when unmeasurable', () => {
        expect(daysSinceLastReviewOf({ dataForSEO: { daysSinceLastReview: 120 } }, NOW.getTime())).toBe(120);
        expect(daysSinceLastReviewOf({ daysSinceLastReview: 95 }, NOW.getTime())).toBe(95);
        expect(daysSinceLastReviewOf({ name: 'no data' }, NOW.getTime())).toBe(null);
        expect(daysSinceLastReviewOf({ dataForSEO: { recentReviews: [{ date: 'junk' }] } }, NOW.getTime())).toBe(null);
        expect(daysSinceLastReviewOf(null, NOW.getTime())).toBe(null);
    });
});

describe('dormant_reviews pain point', () => {
    test('fires over the measurable subset with the honest denominator (unmeasured businesses excluded)', () => {
        const report = { data: { leads: [
            bizWithReviewDates('A', 120),
            bizWithReviewDates('B', 200),
            bizWithReviewDates('C', 95),
            bizWithReviewDates('D', 5),             // active
            { name: 'E no dates', reviewCount: 10 },    // unmeasurable — excluded from denominator
            { name: 'F no dates', reviewCount: 20 }
        ], competitors: [] } };
        const r = buildEvidencePainPoints(report, NOW);
        const item = r.items.find(i => i.id === 'dormant_reviews');
        expect(item).toBeTruthy();
        expect(item.value).toBe(75);                 // 3 of 4 measurable
        expect(item.n).toBe(4);                      // measurable subset, not population (6)
        expect(item.claim).toContain('3 of 4 businesses with measurable review dates');
        expect(item.claim).toContain(`${DORMANT_REVIEW_DAYS}+ days`);
        expect(item.claim).not.toContain('—');       // suite rule: no em dashes
        expect(item.provenance).toBe('Computed from 4 businesses with review-date data');
    });

    test(`insufficient timestamp coverage (< MIN_N=${MIN_N} measurable) → NO claim, even when all dormant`, () => {
        const report = { data: { leads: [
            bizWithReviewDates('A', 300),
            bizWithReviewDates('B', 400),
            { name: 'C', reviewCount: 5 }, { name: 'D', reviewCount: 5 }, { name: 'E', reviewCount: 5 }
        ], competitors: [] } };
        const r = buildEvidencePainPoints(report, NOW);
        expect(r.items.find(i => i.id === 'dormant_reviews')).toBeUndefined();
    });

    test('below the 40% threshold → no claim; boundary day (exactly 90) counts as dormant', () => {
        const quiet = { data: { leads: [
            bizWithReviewDates('A', 120), bizWithReviewDates('B', 5),
            bizWithReviewDates('C', 10), bizWithReviewDates('D', 15)
        ], competitors: [] } };                       // 25% dormant
        expect(buildEvidencePainPoints(quiet, NOW).items.find(i => i.id === 'dormant_reviews')).toBeUndefined();

        const boundary = { data: { leads: [
            bizWithReviewDates('A', DORMANT_REVIEW_DAYS),   // exactly 90 → dormant (>= boundary)
            bizWithReviewDates('B', DORMANT_REVIEW_DAYS),
            bizWithReviewDates('C', 5)
        ], competitors: [] } };
        const item = buildEvidencePainPoints(boundary, NOW).items.find(i => i.id === 'dormant_reviews');
        expect(item).toBeTruthy();
        expect(item.value).toBe(67);
    });

    test('deterministic for a fixed now (stored-report reproducibility)', () => {
        const report = { data: { leads: [
            bizWithReviewDates('A', 120), bizWithReviewDates('B', 200), bizWithReviewDates('C', 5)
        ], competitors: [] } };
        expect(buildEvidencePainPoints(report, NOW)).toEqual(buildEvidencePainPoints(report, NOW));
    });
});

describe('competitiveWeaknesses velocity_stalled — latent dead aggregate fixed', () => {
    test('fires on NESTED-only timestamp data (the production shape the old inline filter missed)', () => {
        const report = { data: { leads: [
            bizWithReviewDates('A', 120), bizWithReviewDates('B', 200),
            bizWithReviewDates('C', 95), bizWithReviewDates('D', 5)
        ], competitors: [] } };
        const w = buildWeaknessThemes(report, DEFAULT_PAIN_THRESHOLDS);
        const stalled = w.items.find(i => i.id === 'velocity_stalled');
        expect(stalled).toBeTruthy();
        expect(stalled.value).toBe(75);
        expect(stalled.n).toBe(4);
    });
});
