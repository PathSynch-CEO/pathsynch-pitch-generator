'use strict';

const { analyzeReviewHealth, _computeGrade, _hasOwnerResponse, _parseDate } = require('../services/tools/reviewHealthAnalyzer');

// ── Helpers ──────────────────────────────────────────────────────────────────

function _makeReviews(count, opts = {}) {
    const {
        startDaysAgo = 180,
        endDaysAgo   = 0,
        responseRate = 0.5,
    } = opts;

    const now     = new Date();
    const reviews = [];
    const spanMs  = (startDaysAgo - endDaysAgo) * 24 * 60 * 60 * 1000;

    for (let i = 0; i < count; i++) {
        const frac    = count > 1 ? i / (count - 1) : 0;
        const dateMs  = now.getTime() - startDaysAgo * 86400000 + frac * spanMs;
        const hasResp = i / count < responseRate;

        reviews.push({
            date: new Date(dateMs).toISOString(),
            ...(hasResp ? { ownerResponse: 'Thank you for your review!' } : {}),
        });
    }
    return reviews;
}

const NOW = new Date('2026-06-13T12:00:00Z');

// ── _parseDate ───────────────────────────────────────────────────────────────

describe('reviewHealthAnalyzer — _parseDate', () => {
    test('parses ISO string', () => {
        const d = _parseDate('2026-01-15T10:00:00Z');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2026);
    });

    test('returns null for null/undefined/empty', () => {
        expect(_parseDate(null)).toBeNull();
        expect(_parseDate(undefined)).toBeNull();
        expect(_parseDate('')).toBeNull();
    });

    test('returns null for invalid date string', () => {
        expect(_parseDate('not-a-date')).toBeNull();
    });

    test('handles Date object', () => {
        const d = _parseDate(new Date('2026-03-01'));
        expect(d).toBeInstanceOf(Date);
    });
});

// ── _hasOwnerResponse ────────────────────────────────────────────────────────

describe('reviewHealthAnalyzer — _hasOwnerResponse', () => {
    test('detects ownerResponse', () => {
        expect(_hasOwnerResponse({ ownerResponse: 'Thanks!' })).toBe(true);
    });

    test('detects owner_response', () => {
        expect(_hasOwnerResponse({ owner_response: 'Thanks!' })).toBe(true);
    });

    test('detects response_text', () => {
        expect(_hasOwnerResponse({ response_text: 'Thanks!' })).toBe(true);
    });

    test('detects owner_answer', () => {
        expect(_hasOwnerResponse({ owner_answer: 'Thanks!' })).toBe(true);
    });

    test('detects hasOwnerResponse boolean', () => {
        expect(_hasOwnerResponse({ hasOwnerResponse: true })).toBe(true);
    });

    test('returns false for no response', () => {
        expect(_hasOwnerResponse({})).toBe(false);
    });
});

// ── _computeGrade ────────────────────────────────────────────────────────────

describe('reviewHealthAnalyzer — _computeGrade', () => {
    test('high response + high velocity + recent = A', () => {
        // responseRate=0.9 → 90*0.4=36, velocity=8 → 80*0.3=24, days=5 → 97.2*0.3=29.2 ≈ 89.2
        expect(_computeGrade(0.9, 8, 5)).toBe('A');
    });

    test('moderate everything = C', () => {
        // responseRate=0.4 → 40*0.4=16, velocity=3 → 30*0.3=9, days=90 → 50*0.3=15 = 40
        expect(_computeGrade(0.4, 3, 90)).toBe('C');
    });

    test('zero response + zero velocity + stale = F', () => {
        expect(_computeGrade(0, 0, 200)).toBe('F');
    });

    test('perfect = A', () => {
        expect(_computeGrade(1.0, 10, 0)).toBe('A');
    });
});

// ── analyzeReviewHealth — insufficient_data ──────────────────────────────────

describe('reviewHealthAnalyzer — insufficient_data', () => {
    test('null/undefined input', () => {
        expect(analyzeReviewHealth(null, NOW).status).toBe('insufficient_data');
        expect(analyzeReviewHealth(undefined, NOW).status).toBe('insufficient_data');
    });

    test('empty array', () => {
        expect(analyzeReviewHealth([], NOW).status).toBe('insufficient_data');
    });

    test('fewer than 5 reviews', () => {
        const reviews = _makeReviews(4, { startDaysAgo: 180 });
        expect(analyzeReviewHealth(reviews, NOW).status).toBe('insufficient_data');
    });

    test('exactly 5 reviews but < 90 day span', () => {
        const reviews = _makeReviews(5, { startDaysAgo: 50, endDaysAgo: 0 });
        expect(analyzeReviewHealth(reviews, NOW).status).toBe('insufficient_data');
    });

    test('reviews with invalid dates filtered below 5', () => {
        const reviews = [
            { date: 'bad-date' },
            { date: 'also-bad' },
            { date: 'nope' },
            { date: '2026-01-01' },
            { date: '2025-09-01' },
        ];
        // Only 2 valid dates → insufficient
        expect(analyzeReviewHealth(reviews, NOW).status).toBe('insufficient_data');
    });
});

// ── analyzeReviewHealth — boundary cases ─────────────────────────────────────

describe('reviewHealthAnalyzer — boundary', () => {
    test('exactly 5 reviews spanning exactly 90 days', () => {
        const base = new Date(NOW.getTime() - 90 * 86400000);
        const reviews = [];
        for (let i = 0; i < 5; i++) {
            reviews.push({
                date: new Date(base.getTime() + i * (90 / 4) * 86400000).toISOString(),
                ownerResponse: i < 3 ? 'Thanks' : undefined,
            });
        }
        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.status).toBe('complete');
        expect(result.dataSpanDays).toBe(90);
        expect(result.totalReviewsAnalyzed).toBe(5);
    });
});

// ── analyzeReviewHealth — normal payloads ────────────────────────────────────

describe('reviewHealthAnalyzer — normal analysis', () => {
    test('healthy Outscraper payload → correct metrics', () => {
        const reviews = _makeReviews(50, {
            startDaysAgo: 180,
            endDaysAgo:   2,
            responseRate: 0.8,
        });

        const result = analyzeReviewHealth(reviews, NOW);

        expect(result.status).toBe('complete');
        expect(result.totalReviewsAnalyzed).toBe(50);
        expect(result.responseRate).toBeGreaterThan(0);
        expect(result.responseRate).toBeLessThanOrEqual(1);
        expect(result.velocity).toBeGreaterThan(0);
        expect(result.daysSinceLastReview).toBeGreaterThanOrEqual(0);
        expect(result.reviewsInLast90Days).toBeGreaterThan(0);
        expect(result.dataSpanDays).toBeGreaterThanOrEqual(90);
        expect(result.lastReviewDate).toBeTruthy();
        expect(['A', 'B', 'C', 'D', 'F']).toContain(result.reviewHealthGrade);
    });

    test('high response rate → grade A path', () => {
        const reviews = _makeReviews(100, {
            startDaysAgo: 180,
            endDaysAgo:   1,
            responseRate: 0.95,
        });

        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.status).toBe('complete');
        expect(result.reviewHealthGrade).toBe('A');
        expect(result.responseRate).toBeGreaterThanOrEqual(0.9);
    });

    test('zero response rate + old reviews → grade F path', () => {
        // Span: 365 to 250 days ago = 115 days (≥90d gate passes)
        const reviews = _makeReviews(10, {
            startDaysAgo: 365,
            endDaysAgo:   250,
            responseRate: 0,
        });

        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.status).toBe('complete');
        expect(result.reviewHealthGrade).toBe('F');
        expect(result.responseRate).toBe(0);
        expect(result.daysSinceLastReview).toBeGreaterThanOrEqual(249);
    });

    test('old latest review → high daysSinceLastReview', () => {
        // Span: 400 to 200 days ago = 200 days (≥90d gate passes)
        const reviews = _makeReviews(20, {
            startDaysAgo: 400,
            endDaysAgo:   200,
            responseRate: 0.3,
        });

        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.status).toBe('complete');
        expect(result.daysSinceLastReview).toBeGreaterThanOrEqual(199);
    });

    test('return shape matches PRD §6 exactly', () => {
        const reviews = _makeReviews(30, { startDaysAgo: 180, responseRate: 0.5 });
        const result = analyzeReviewHealth(reviews, NOW);

        expect(result).toHaveProperty('status', 'complete');
        expect(result).toHaveProperty('responseRate');
        expect(result).toHaveProperty('velocity');
        expect(result).toHaveProperty('lastReviewDate');
        expect(result).toHaveProperty('daysSinceLastReview');
        expect(result).toHaveProperty('reviewHealthGrade');
        expect(result).toHaveProperty('totalReviewsAnalyzed');
        expect(result).toHaveProperty('reviewsWithResponse');
        expect(result).toHaveProperty('reviewsInLast90Days');
        expect(result).toHaveProperty('dataSpanDays');

        // No extra fields beyond status + the 9 PRD fields
        expect(Object.keys(result)).toHaveLength(10);
    });

    test('velocity is reviews per month', () => {
        // 60 reviews over 180 days ≈ 6 months → ~10/month
        const reviews = _makeReviews(60, {
            startDaysAgo: 180,
            endDaysAgo:   0,
            responseRate: 0.5,
        });
        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.velocity).toBeGreaterThan(8);
        expect(result.velocity).toBeLessThan(12);
    });

    test('reviewsWithResponse counted correctly', () => {
        const reviews = [
            { date: '2025-12-01', ownerResponse: 'Thanks!' },
            { date: '2025-12-15', owner_response: 'Thanks!' },
            { date: '2026-01-01' },
            { date: '2026-02-01' },
            { date: '2026-03-01' },
            { date: '2026-04-01' },
        ];
        const result = analyzeReviewHealth(reviews, NOW);
        expect(result.status).toBe('complete');
        expect(result.reviewsWithResponse).toBe(2);
        expect(result.totalReviewsAnalyzed).toBe(6);
    });
});
