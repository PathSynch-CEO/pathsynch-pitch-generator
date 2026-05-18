const {
    calculateDeterministicOutcomes,
    calculateReviewsLast90Days,
    selectVelocityBand,
    computeVelocityTrend,
    parseRelativeDateLabel
} = require('../../services/deterministicOutcomes');

describe('deterministicOutcomes', () => {

    describe('parseRelativeDateLabel', () => {
        test('parses hours ago', () => {
            expect(parseRelativeDateLabel('23 hours ago')).toBe(0);
            expect(parseRelativeDateLabel('1 hour ago')).toBe(0);
        });

        test('parses days ago', () => {
            expect(parseRelativeDateLabel('a day ago')).toBe(1);
            expect(parseRelativeDateLabel('5 days ago')).toBe(5);
        });

        test('parses weeks ago', () => {
            expect(parseRelativeDateLabel('a week ago')).toBe(7);
            expect(parseRelativeDateLabel('3 weeks ago')).toBe(21);
        });

        test('parses months ago up to 2', () => {
            expect(parseRelativeDateLabel('a month ago')).toBe(30);
            expect(parseRelativeDateLabel('2 months ago')).toBe(60);
        });

        test('excludes 3 months ago (imprecise)', () => {
            expect(parseRelativeDateLabel('3 months ago')).toBeNull();
        });

        test('excludes old dates', () => {
            expect(parseRelativeDateLabel('4 months ago')).toBeNull();
            expect(parseRelativeDateLabel('a year ago')).toBeNull();
        });

        test('handles "New" label', () => {
            expect(parseRelativeDateLabel('New')).toBe(0);
        });

        test('handles "Edited" prefix', () => {
            expect(parseRelativeDateLabel('Edited 2 weeks ago')).toBe(14);
        });

        test('returns null for garbage', () => {
            expect(parseRelativeDateLabel(null)).toBeNull();
            expect(parseRelativeDateLabel('')).toBeNull();
            expect(parseRelativeDateLabel('yesterday maybe')).toBeNull();
        });
    });

    describe('calculateReviewsLast90Days', () => {
        test('counts reviews with relative labels', () => {
            const reviews = [
                { relativeDateLabel: 'a day ago' },
                { relativeDateLabel: 'a week ago' },
                { relativeDateLabel: '2 months ago' },
                { relativeDateLabel: '3 months ago' },
                { relativeDateLabel: 'a year ago' }
            ];
            const result = calculateReviewsLast90Days(reviews);
            expect(result.count).toBe(3);
            expect(result.excludedImpreciseThreeMonthReviews).toBe(true);
            expect(result.confidence).toBe('medium');
        });

        test('counts reviews with exact timestamps', () => {
            const now = new Date();
            const reviews = [
                { createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() },
                { createdAt: new Date(now - 80 * 24 * 60 * 60 * 1000).toISOString() },
                { createdAt: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString() }
            ];
            const result = calculateReviewsLast90Days(reviews);
            expect(result.count).toBe(2);
            expect(result.usedExactTimestamps).toBe(true);
            expect(result.confidence).toBe('high');
        });

        test('returns 0 for empty array', () => {
            const result = calculateReviewsLast90Days([]);
            expect(result.count).toBe(0);
            expect(result.confidence).toBe('low');
        });
    });

    describe('selectVelocityBand', () => {
        test('growth band with competitor data', () => {
            const result = selectVelocityBand(15, 20, 30, null, null);
            expect(result.multiplier).toBe(2.0);
            expect(result.band).toBe('growth');
        });

        test('maintain band when above P75', () => {
            const result = selectVelocityBand(35, 20, 30, null, null);
            expect(result.multiplier).toBe(1.2);
            expect(result.band).toBe('maintain');
        });

        test('catch_up band', () => {
            const result = selectVelocityBand(9, 20, 30, null, null);
            expect(result.multiplier).toBe(2.5);
            expect(result.band).toBe('catch_up');
        });

        test('aggressive sprint band', () => {
            const result = selectVelocityBand(3, 20, 30, null, null);
            expect(result.multiplier).toBe(3.0);
            expect(result.band).toBe('aggressive_sprint');
        });

        test('fallback banding without competitor data', () => {
            // currentMonthly = 14.3, so reviewsLast90 = 42.9 -> >= 20 -> 2.0
            const result = selectVelocityBand(14.3, null, null, null, null);
            expect(result.multiplier).toBe(2.0);
            expect(result.band).toBe('fallback');
        });

        test('high negative rate caps multiplier', () => {
            const result = selectVelocityBand(3, 20, 30, 0.22, null);
            expect(result.multiplier).toBe(2.0);
        });

        test('manual override', () => {
            const result = selectVelocityBand(10, 20, 30, null, 1.8);
            expect(result.multiplier).toBe(1.8);
            expect(result.band).toBe('manual_override');
        });
    });

    describe('computeVelocityTrend', () => {
        test('returns stable for insufficient data', () => {
            expect(computeVelocityTrend([])).toBe('stable');
            expect(computeVelocityTrend([{ relativeDateLabel: 'a day ago' }])).toBe('stable');
        });

        test('detects accelerating trend', () => {
            const reviews = [
                // Recent half: 8 reviews
                ...Array(8).fill({ relativeDateLabel: 'a week ago' }),
                // Older half: 3 reviews
                ...Array(3).fill({ relativeDateLabel: '2 months ago' })
            ];
            expect(computeVelocityTrend(reviews)).toBe('accelerating');
        });

        test('detects decelerating trend', () => {
            const reviews = [
                // Recent half: 3 reviews
                ...Array(3).fill({ relativeDateLabel: 'a week ago' }),
                // Older half: 8 reviews
                ...Array(8).fill({ relativeDateLabel: '2 months ago' })
            ];
            expect(computeVelocityTrend(reviews)).toBe('decelerating');
        });
    });

    describe('calculateDeterministicOutcomes — Smith\'s Olde Bar', () => {
        test('produces correct output for Smith\'s Olde Bar', () => {
            // Build 43 reviews within 90 days using relative labels
            const reviews = [
                ...Array(8).fill({ relativeDateLabel: 'a day ago' }),
                ...Array(7).fill({ relativeDateLabel: 'a week ago' }),
                ...Array(10).fill({ relativeDateLabel: '2 weeks ago' }),
                ...Array(8).fill({ relativeDateLabel: 'a month ago' }),
                ...Array(10).fill({ relativeDateLabel: '2 months ago' }),
                ...Array(5).fill({ relativeDateLabel: '3 months ago' }), // excluded
                ...Array(3).fill({ relativeDateLabel: 'a year ago' }) // excluded
            ];

            const result = calculateDeterministicOutcomes({
                currentReviewCount: 2018,
                currentRating: 4.5,
                currentDisplayedRating: 4.5,
                reviews
            });

            expect(result.reviewsLast90Days).toBe(43);
            expect(result.min90DayTarget).toBe(52);
            expect(result.max90DayTarget).toBe(129);
            expect(result.selectedMultiplier).toBe(2.0);
            expect(result.selected90DayReviewTarget).toBe(86);
            expect(result.displayReviewTarget).toBe(90);
            expect(result.projectedRating).toBeCloseTo(4.521, 2);
            expect(result.ratingTargetLabel).toBe('4.5 Protected');
            expect(result.reviewsNeededForNextRating).toBe(225);
            expect(result.excludedImpreciseThreeMonthReviews).toBe(true);
            expect(result.reviewVelocityTrend).toBe('accelerating');
        });

        test('shows 4.6 Rating Target when math supports it', () => {
            // 113 reviews in 90 days with 2.0x = 226 target, rounded to 230
            const reviews = Array(113).fill({ relativeDateLabel: 'a week ago' });

            const result = calculateDeterministicOutcomes({
                currentReviewCount: 2018,
                currentRating: 4.5,
                currentDisplayedRating: 4.5,
                reviews
            });

            expect(result.displayReviewTarget).toBeGreaterThanOrEqual(225);
            expect(result.projectedRating).toBeGreaterThanOrEqual(4.55);
            expect(result.ratingTargetLabel).toBe('4.6 Rating Target');
        });
    });

    describe('calculateDeterministicOutcomes — insufficient data fallback', () => {
        test('returns conservative defaults with low confidence', () => {
            const result = calculateDeterministicOutcomes({
                currentReviewCount: 50,
                currentRating: 4.2,
                currentDisplayedRating: 4.2,
                reviews: []
            });

            expect(result.reviewTargetConfidence).toBe('low');
            expect(result.selectedBand).toBe('insufficient_data');
            expect(result.displayReviewTarget).toBeGreaterThan(0);
        });
    });
});
