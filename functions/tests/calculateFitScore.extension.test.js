'use strict';

// Lightweight firebase-admin mock for prospectIntelService import
const mockGet = jest.fn().mockResolvedValue({ exists: false });
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ get: mockGet, set: mockSet, update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockRunTransaction = jest.fn(async (fn) => fn({ get: mockGet, update: mockUpdate, set: mockSet }));

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }), {
        FieldValue: {
            serverTimestamp: () => new Date(),
            increment: (n) => ({ _increment: n }),
            arrayUnion: (...args) => ({ _arrayUnion: args }),
            arrayRemove: (...args) => ({ _arrayRemove: args }),
        },
        Timestamp: {
            fromDate: (d) => d,
            now: () => new Date(),
        },
    }),
    auth: () => ({ verifyIdToken: jest.fn() }),
    initializeApp: jest.fn(),
}));

const { calculateFitScore } = require('../services/prospectIntelService');

// ── Frozen Fixture — Legacy Score Regression ─────────────────────────────────
// These fixtures prove that existing scores are byte-identical when no techStack
// data is present. The 3 new signals are null-excluded from the denominator.

const LEGACY_FIXTURES = [
    {
        name: 'Low rating + low reviews prospect',
        agentData: { googleRating: 3.5, totalReviews: 20, industry: 'restaurant' },
        csvData: { contactTitle: 'Owner' },
        // low_rating(25) + low_reviews(20) + incomplete_gbp(15) + outdated_website(15) + owner_title(10) + industry_match(10) = 95
        // no_review_response: reviews=20, NOT < 20, so does NOT fire
        expectedScore: 95,
    },
    {
        name: 'Disqualified — high rating',
        agentData: { googleRating: 4.9, totalReviews: 600 },
        csvData: {},
        expectedScore: 0,
        expectedDisqualified: true,
    },
    {
        name: 'Disqualified — too large',
        agentData: { googleRating: 4.0, totalReviews: 300 },
        csvData: {},
        expectedScore: 0,
        expectedDisqualified: true,
    },
    {
        name: 'Good prospect — no website, incomplete GBP',
        agentData: { googleRating: 0, totalReviews: 0 },
        csvData: { contactTitle: 'Manager' },
        // low_reviews(20) + incomplete_gbp(15) + outdated_website(15) + no_review_response(15: reviews<20 && rating===0) + owner_title(10) + industry_match(10) = 85
        expectedScore: 85,
    },
    {
        name: 'Moderate prospect — has website and GBP',
        agentData: {
            googleRating: 4.5,
            totalReviews: 80,
            websiteUrl: 'https://example.com',
            address: { city: 'Atlanta' },
            industry: 'dental',
        },
        csvData: { contactTitle: 'Director' },
        // owner_title(10) + industry_match(10) = 20
        expectedScore: 20,
    },
];

describe('calculateFitScore — frozen legacy regression', () => {
    LEGACY_FIXTURES.forEach(fixture => {
        test(fixture.name, () => {
            const result = calculateFitScore(fixture.agentData, fixture.csvData, null);

            if (fixture.expectedDisqualified) {
                expect(result.disqualified).toBe(true);
                expect(result.fitScore).toBe(0);
            } else {
                expect(result.disqualified).toBe(false);
                expect(result.fitScore).toBe(fixture.expectedScore);
            }
        });
    });

    test('legacy scores unchanged when techStack is absent', () => {
        // Without techStack, the 3 new signals are excluded from denominator
        // fitScore = Math.min(100, sum_of_hit_weights)
        // This is identical to pre-PR#19 behavior
        const result = calculateFitScore(
            { googleRating: 3.5, totalReviews: 20, industry: 'restaurant' },
            { contactTitle: 'Owner' },
            null
        );
        // low_rating(25) + low_reviews(20) + incomplete_gbp(15) + outdated_website(15) + owner_title(10) + industry_match(10) = 95
        expect(result.fitScore).toBe(95);
    });
});

// ── Tech Stack Signals ───────────────────────────────────────────────────────

describe('calculateFitScore — tech stack extension', () => {
    test('no_reputation_tool fires when no reputation tools and fetchStatus ok', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [],
                    analytics: [],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'no_reputation_tool');
        expect(signal).toBeTruthy();
        expect(signal.weight).toBe(10);
    });

    test('no_reputation_tool does NOT fire when reputation tool exists', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [{ name: 'Birdeye', type: 'reputation' }],
                    formBuilders: [],
                    analytics: [],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'no_reputation_tool');
        expect(signal).toBeUndefined();
    });

    test('displaceable_form_tool fires for cost-type form builders', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [{ name: 'JotForm', type: 'cost' }],
                    analytics: [],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'displaceable_form_tool');
        expect(signal).toBeTruthy();
        expect(signal.weight).toBe(8);
    });

    test('displaceable_form_tool fires for workflow-type form builders', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [{ name: 'Gravity Forms', type: 'workflow' }],
                    analytics: [],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'displaceable_form_tool');
        expect(signal).toBeTruthy();
    });

    test('displaceable_form_tool does NOT fire for basic forms', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [{ name: 'Google Forms', type: 'basic' }],
                    analytics: [],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'displaceable_form_tool');
        expect(signal).toBeUndefined();
    });

    test('analytics_upsell fires for Facebook Pixel', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [],
                    analytics: [{ name: 'Facebook Pixel' }],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'analytics_upsell');
        expect(signal).toBeTruthy();
        expect(signal.weight).toBe(5);
    });

    test('analytics_upsell fires for CallRail', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [],
                    analytics: [{ name: 'CallRail' }],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'analytics_upsell');
        expect(signal).toBeTruthy();
    });

    test('analytics_upsell does NOT fire for Google Analytics only', () => {
        const result = calculateFitScore(
            {
                googleRating: 3.5,
                totalReviews: 20,
                techStack: {
                    reputationTools: [],
                    formBuilders: [],
                    analytics: [{ name: 'Google Analytics' }],
                    fetchStatus: 'ok',
                },
            },
            {},
            null
        );
        const signal = result.signalHits.find(s => s.key === 'analytics_upsell');
        expect(signal).toBeUndefined();
    });
});

// ── Null-Exclusion from Denominator ──────────────────────────────────────────

describe('calculateFitScore — null-exclusion', () => {
    test('techStack absent → signals excluded from denominator', () => {
        // Without techStack, only original 7 signals participate
        // With low_rating(25) hit → score = 25, which matches pre-PR#19
        const withoutTech = calculateFitScore(
            { googleRating: 3.5, totalReviews: 80, websiteUrl: 'https://ex.com', address: { city: 'ATL' } },
            {},
            null
        );

        // With techStack but fetchStatus error → no tech signals fire
        const withTechError = calculateFitScore(
            {
                googleRating: 3.5, totalReviews: 80, websiteUrl: 'https://ex.com', address: { city: 'ATL' },
                techStack: { reputationTools: [], formBuilders: [], analytics: [], fetchStatus: 'fetch_error' },
            },
            {},
            null
        );

        // Both should yield the same score since tech signals are excluded
        expect(withoutTech.fitScore).toBe(withTechError.fitScore);
    });

    test('techStack present increases score (additive only)', () => {
        const base = calculateFitScore(
            { googleRating: 3.5, totalReviews: 20, industry: 'dental' },
            { contactTitle: 'Owner' },
            null
        );

        const withTech = calculateFitScore(
            {
                googleRating: 3.5, totalReviews: 20, industry: 'dental',
                techStack: {
                    reputationTools: [],
                    formBuilders: [{ name: 'JotForm', type: 'cost' }],
                    analytics: [{ name: 'Facebook Pixel' }],
                    fetchStatus: 'ok',
                },
            },
            { contactTitle: 'Owner' },
            null
        );

        // With tech stack, score can only go up (additive signals)
        expect(withTech.fitScore).toBeGreaterThanOrEqual(base.fitScore);
        expect(withTech.signalHits.length).toBeGreaterThan(base.signalHits.length);
    });
});

// ── Additive-Only Invariant ──────────────────────────────────────────────────

describe('calculateFitScore — additive-only invariant', () => {
    const INVARIANT_FIXTURES = [
        { googleRating: 3.0, totalReviews: 10 },
        { googleRating: 4.2, totalReviews: 45 },
        { googleRating: 4.5, totalReviews: 80, websiteUrl: 'https://ex.com' },
        { googleRating: 0, totalReviews: 0 },
        { googleRating: 3.8, totalReviews: 30, address: { city: 'ATL' } },
    ];

    INVARIANT_FIXTURES.forEach((agent, i) => {
        test(`fixture ${i + 1}: score(with tech) ≥ score(without tech)`, () => {
            const without = calculateFitScore(agent, {}, null);

            const withTech = calculateFitScore(
                {
                    ...agent,
                    techStack: {
                        reputationTools: [],
                        formBuilders: [{ name: 'JotForm', type: 'cost' }],
                        analytics: [{ name: 'CallRail' }],
                        fetchStatus: 'ok',
                    },
                },
                {},
                null
            );

            expect(withTech.fitScore).toBeGreaterThanOrEqual(without.fitScore);
        });
    });
});
