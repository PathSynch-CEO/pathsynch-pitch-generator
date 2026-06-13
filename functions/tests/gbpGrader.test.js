'use strict';

const { gradeGBP, _letterGrade, _extractDaysSinceLastReview } = require('../services/tools/gbpGrader');

// ── Letter Grade Thresholds ──────────────────────────────────────────────────

describe('gbpGrader — _letterGrade', () => {
    test('A for ≥85', () => {
        expect(_letterGrade(85)).toBe('A');
        expect(_letterGrade(100)).toBe('A');
    });

    test('B for ≥70', () => {
        expect(_letterGrade(70)).toBe('B');
        expect(_letterGrade(84)).toBe('B');
    });

    test('C for ≥55', () => {
        expect(_letterGrade(55)).toBe('C');
        expect(_letterGrade(69)).toBe('C');
    });

    test('D for ≥40', () => {
        expect(_letterGrade(40)).toBe('D');
        expect(_letterGrade(54)).toBe('D');
    });

    test('F for <40', () => {
        expect(_letterGrade(0)).toBe('F');
        expect(_letterGrade(39)).toBe('F');
    });
});

// ── Recency Extraction ───────────────────────────────────────────────────────

describe('gbpGrader — _extractDaysSinceLastReview', () => {
    test('reads pre-computed field', () => {
        expect(_extractDaysSinceLastReview({ daysSinceLastReview: 15 })).toBe(15);
    });

    test('reads dataForSEO field', () => {
        expect(_extractDaysSinceLastReview({
            dataForSEO: { daysSinceLastReview: 42 },
        })).toBe(42);
    });

    test('returns null when no data', () => {
        expect(_extractDaysSinceLastReview({})).toBeNull();
    });
});

// ── Full Grading ─────────────────────────────────────────────────────────────

describe('gbpGrader — gradeGBP', () => {
    test('null input returns F with empty dimensions', () => {
        const result = gradeGBP(null);
        expect(result.grade).toBe('F');
        expect(result.score).toBe(0);
        expect(result.dimensions).toHaveLength(5);
        expect(result.gradeBasis).toBe('No GBP data available');
    });

    test('empty object returns F', () => {
        const result = gradeGBP({});
        expect(result.grade).toBe('F');
        expect(result.score).toBe(0);
    });

    test('perfect profile gets grade A', () => {
        const result = gradeGBP({
            googleRating: 4.8,
            totalReviews: 150,
            photoCount: 25,
            websiteUrl: 'https://example.com',
            phone: '555-1234',
            address: { city: 'Atlanta' },
            hours: 'Mon-Fri 9-5',
            daysSinceLastReview: 3,
        });
        expect(result.grade).toBe('A');
        expect(result.score).toBe(100);
        expect(result.dimensions).toHaveLength(5);
        expect(result.dimensions.every(d => d.score === 20)).toBe(true);
    });

    test('moderate profile gets grade C', () => {
        const result = gradeGBP({
            googleRating: 4.0,
            totalReviews: 30,
            photoCount: 8,
            websiteUrl: 'https://example.com',
            phone: '555-1234',
            address: { city: 'Atlanta' },
            daysSinceLastReview: 45,
        });
        // Rating(16) + Reviews(12) + Photos(12) + Info(15) + Recency(12) = 67 → C
        expect(result.grade).toBe('C');
        expect(result.score).toBeGreaterThanOrEqual(55);
        expect(result.score).toBeLessThan(70);
    });

    test('5 dimensions always returned', () => {
        const result = gradeGBP({ googleRating: 4.0 });
        expect(result.dimensions).toHaveLength(5);
        expect(result.dimensions.map(d => d.name)).toEqual([
            'Rating', 'Reviews', 'Photos', 'Info Completeness', 'Recency',
        ]);
    });

    test('each dimension has maxScore of 20', () => {
        const result = gradeGBP({ googleRating: 4.0 });
        result.dimensions.forEach(d => {
            expect(d.maxScore).toBe(20);
        });
    });

    test('gradeBasis lists data sources', () => {
        const result = gradeGBP({
            googleRating: 4.5,
            totalReviews: 50,
        });
        expect(result.gradeBasis).toContain('rating');
        expect(result.gradeBasis).toContain('reviews');
    });

    test('photos scoring scales correctly', () => {
        const r1 = gradeGBP({ photoCount: 3 });
        const r2 = gradeGBP({ photoCount: 10 });
        const r3 = gradeGBP({ photoCount: 25 });
        const photoDim1 = r1.dimensions.find(d => d.name === 'Photos');
        const photoDim2 = r2.dimensions.find(d => d.name === 'Photos');
        const photoDim3 = r3.dimensions.find(d => d.name === 'Photos');
        expect(photoDim1.score).toBe(8);
        expect(photoDim2.score).toBe(16);
        expect(photoDim3.score).toBe(20);
    });

    test('info completeness sums 5 per field', () => {
        const result = gradeGBP({
            websiteUrl: 'https://example.com',
            phone: '555-1234',
        });
        const infoDim = result.dimensions.find(d => d.name === 'Info Completeness');
        expect(infoDim.score).toBe(10);
    });

    test('recency scoring scales by days', () => {
        const fresh = gradeGBP({ daysSinceLastReview: 5 });
        const stale = gradeGBP({ daysSinceLastReview: 120 });
        const freshDim = fresh.dimensions.find(d => d.name === 'Recency');
        const staleDim = stale.dimensions.find(d => d.name === 'Recency');
        expect(freshDim.score).toBe(20);
        expect(staleDim.score).toBe(4);
    });

    test('address as string accepted', () => {
        const result = gradeGBP({ address: '123 Main St, Atlanta, GA' });
        const infoDim = result.dimensions.find(d => d.name === 'Info Completeness');
        expect(infoDim.score).toBe(5);
        expect(infoDim.detail).toContain('address');
    });
});
