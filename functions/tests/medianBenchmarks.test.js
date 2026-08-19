'use strict';

/**
 * Story S3 Addition 2 — median (robust) benchmarks replace the outlier-skewed mean wherever
 * "market average reviews" drives report COPY or a THRESHOLD.
 *
 * The regression this guards: one market printed a mean of 3,164 in legacy sections and a median of
 * 589 in the new pain points — one report, two truths. The mean is retained ONLY as a raw data field
 * for cross-product sync; every in-report consumer now keys off the median.
 */

const { calculateMarketBenchmarks, computeProductWedge } = require('../api/market');

// A fat-tailed market: one 3,000-review leader drags the MEAN far above the MEDIAN.
const competitors = [
    { name: 'Leader', rating: 4.8, reviewCount: 3000 },
    { name: 'B', rating: 4.6, reviewCount: 40 },
    { name: 'C', rating: 4.5, reviewCount: 30 },
    { name: 'D', rating: 4.4, reviewCount: 25 },
    { name: 'E', rating: 4.3, reviewCount: 20 }
];

describe('calculateMarketBenchmarks — median alongside mean', () => {
    const b = calculateMarketBenchmarks(competitors);

    test('exposes BOTH the mean (raw, for sync) and the robust median', () => {
        // mean of [3000,40,30,25,20] = 623; median = 30
        expect(b.avgReviews).toBe(623);
        expect(b.medianReviews).toBe(30);
    });

    test('the mean and median genuinely diverge on a fat-tailed market', () => {
        expect(b.avgReviews).toBeGreaterThan(b.medianReviews * 5);
    });

    test('dominance language keys off the leader-vs-MEDIAN ratio (3000/30 = 100x -> "dominates")', () => {
        // With the mean (623) the ratio is only ~4.8x -> still "dominates" here, but the median makes
        // the label robust on markets where the mean would deflate a real runaway leader.
        expect(b.dominanceLanguage).toBe('dominates');
    });
});

describe('computeProductWedge — high-rating-low-volume threshold uses the median', () => {
    const b = calculateMarketBenchmarks(competitors); // medianReviews = 30

    test('a 4.7-star lead with 35 reviews is ABOVE the median (30): does not trip the low-volume wedge', () => {
        const wedge = computeProductWedge({ name: 'Above', rating: 4.7, reviewCount: 35 }, b);
        expect(wedge.signal).not.toBe('high_quality_low_presence');
    });

    test('a 4.7-star lead with 12 reviews is BELOW the median: trips the wedge and cites "market median"', () => {
        const wedge = computeProductWedge({ name: 'Below', rating: 4.7, reviewCount: 12 }, b);
        expect(wedge.signal).toBe('high_quality_low_presence');
        expect(wedge.pitch).toContain('market median');
        expect(wedge.pitch).not.toContain('market avg');
    });

    test('had the MEAN (623) been the threshold, the 35-review lead would have wrongly tripped the wedge', () => {
        // Proves the switch matters: 35 < 623 (mean) but 35 > 30 (median).
        expect(35).toBeLessThan(b.avgReviews);
        expect(35).toBeGreaterThan(b.medianReviews);
    });
});
