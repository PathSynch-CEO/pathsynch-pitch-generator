'use strict';

/**
 * Velocity rounding guard — follow-up to Gate 1 / PR #93 (cold-read finding (b)).
 *
 * The velocity block runs AFTER snapshot reconciliation, so the first post-#93 regeneration per market
 * compares this report's reconciled Places-EXACT current count against the prior report's stored
 * Serper-ROUNDED count (e.g. 1188 exact vs 1200 rounded → reviewsAdded = -12). Real-world review counts
 * essentially never decrease, so a negative delta within rounding-noise scale is noise, not decline.
 *
 * Rule under test: tolerance = max(10, round(1% of prior count)). Negative delta within tolerance →
 * 'stable' + displayed delta clamped to 0. Negative delta beyond tolerance → 'declining' (real delta
 * preserved). Zero and positive paths unchanged.
 */

const { calculateVelocityTrend, generateIntelSignal } = require('../services/opportunityScorer');

// calculateVelocityTrend matches leads by this normalized key (see opportunityScorer.js).
const key = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DAYS = 30; // >= 14 (the minimum the function requires) and monthsFactor = 1

describe('velocity rounding guard — negative-within-tolerance → stable, delta 0', () => {
    test('#93 motivating case: prior 1200 (Serper rounded) vs current 1188 (Places exact) → stable', () => {
        const prev = [{ name: 'JUST JUNK Atlanta', reviewCount: 1200 }];
        const curr = [{ name: 'JUST JUNK Atlanta', reviewCount: 1188 }];
        // tolerance = max(10, round(0.01 * 1200)) = 12; |1188 - 1200| = 12 <= 12 → within tolerance
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('JUST JUNK Atlanta'));
        expect(vt.classification).toBe('stable');
        expect(vt.reviewsAdded).toBe(0);        // displayed delta clamped
        expect(vt.monthlyVelocity).toBe(0);
        expect(vt.label).toBe('Stable');
        // real underlying counts are still carried for reference
        expect(vt.prevCount).toBe(1200);
        expect(vt.currCount).toBe(1188);
    });

    test('low count within the fixed floor: prior 500 vs current 495 (delta -5, tol 10) → stable', () => {
        const prev = [{ name: 'Acme Co', reviewCount: 500 }];
        const curr = [{ name: 'Acme Co', reviewCount: 495 }];
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Acme Co'));
        expect(vt.classification).toBe('stable');
        expect(vt.reviewsAdded).toBe(0);
    });

    test('boundary: |delta| exactly == tolerance → stable', () => {
        const prev = [{ name: 'Edge Co', reviewCount: 1200 }]; // tol 12
        const curr = [{ name: 'Edge Co', reviewCount: 1188 }]; // delta -12
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Edge Co'));
        expect(vt.classification).toBe('stable');
    });

    test('a stable lead emits NO "Declining" intel-signal line', () => {
        const vt = calculateVelocityTrend(
            [{ name: 'JUST JUNK Atlanta', reviewCount: 1188 }],
            [{ name: 'JUST JUNK Atlanta', reviewCount: 1200 }],
            DAYS
        ).get(key('JUST JUNK Atlanta'));
        const signal = generateIntelSignal({ reviewCount: 1188, rating: 5.0, velocityTrend: vt }, { avgRating: 4.5 });
        expect(signal).not.toMatch(/Declining/i);
    });
});

describe('velocity rounding guard — negative-beyond-tolerance → declining preserved', () => {
    test('genuine large drop: prior 1200 vs current 1000 (delta -200 > tol 12) → declining', () => {
        const prev = [{ name: 'Falling Co', reviewCount: 1200 }];
        const curr = [{ name: 'Falling Co', reviewCount: 1000 }];
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Falling Co'));
        expect(vt.classification).toBe('declining');
        expect(vt.reviewsAdded).toBe(-200);     // real negative delta preserved, NOT clamped
        expect(vt.label).toBe('Declining');
    });

    test('boundary: |delta| == tolerance + 1 → declining', () => {
        const prev = [{ name: 'Edge2 Co', reviewCount: 1200 }]; // tol 12
        const curr = [{ name: 'Edge2 Co', reviewCount: 1187 }]; // delta -13
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Edge2 Co'));
        expect(vt.classification).toBe('declining');
        expect(vt.reviewsAdded).toBe(-13);
    });
});

describe('velocity rounding guard — zero/positive paths unchanged', () => {
    test('zero delta → stalling (unchanged), delta 0', () => {
        const prev = [{ name: 'Flat Co', reviewCount: 100 }];
        const curr = [{ name: 'Flat Co', reviewCount: 100 }];
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Flat Co'));
        expect(vt.classification).toBe('stalling');
        expect(vt.reviewsAdded).toBe(0);
    });

    test('small positive (2/mo) → below_pace, real delta preserved', () => {
        const prev = [{ name: 'Slow Co', reviewCount: 100 }];
        const curr = [{ name: 'Slow Co', reviewCount: 102 }]; // monthlyVelocity 2 → below_pace
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Slow Co'));
        expect(vt.classification).toBe('below_pace');
        expect(vt.reviewsAdded).toBe(2);
    });

    test('strong positive (100/mo) → on_pace, real delta preserved', () => {
        const prev = [{ name: 'Growing Co', reviewCount: 100 }];
        const curr = [{ name: 'Growing Co', reviewCount: 200 }];
        const vt = calculateVelocityTrend(curr, prev, DAYS).get(key('Growing Co'));
        expect(vt.classification).toBe('on_pace');
        expect(vt.reviewsAdded).toBe(100);
    });
});
