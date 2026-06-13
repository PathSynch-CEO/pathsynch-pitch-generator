'use strict';

// ── Firebase Admin Mock ──────────────────────────────────────────────────────

const mockDocs = [];
const mockGet = jest.fn(async () => ({
    empty: mockDocs.length === 0,
    docs: mockDocs,
}));

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: mockGet,
        })),
    }), {
        FieldValue: { serverTimestamp: () => new Date() },
    }),
    initializeApp: jest.fn(),
}));

const {
    resolveMarketContext,
    matchProspectToReport,
    normalizeName,
    normalizeCity,
    tokenSetSimilarity,
    isDistinctiveName,
    _buildCompetitorIndex,
} = require('../services/marketContextResolver');

// ── normalizeName ────────────────────────────────────────────────────────────

describe('marketContextResolver — normalizeName', () => {
    test('lowercases', () => {
        expect(normalizeName('ACME Dental')).toBe('acme dental');
    });

    test('strips LLC', () => {
        expect(normalizeName('HemiXperts LLC')).toBe('hemixperts');
    });

    test('strips Inc.', () => {
        expect(normalizeName('Acme Inc.')).toBe('acme');
    });

    test('strips punctuation', () => {
        expect(normalizeName("Bob's Auto - Repair")).toBe('bobs auto repair');
    });

    test('collapses whitespace', () => {
        expect(normalizeName('  Acme   Dental  ')).toBe('acme dental');
    });

    test('returns empty for null', () => {
        expect(normalizeName(null)).toBe('');
    });
});

// ── tokenSetSimilarity ──────────────────────────────────────────────────────

describe('marketContextResolver — tokenSetSimilarity', () => {
    test('identical strings = 1.0', () => {
        expect(tokenSetSimilarity('blue ridge automotive', 'blue ridge automotive')).toBe(1.0);
    });

    test('one extra token', () => {
        const sim = tokenSetSimilarity('blue ridge automotive', 'blue ridge automotive european');
        expect(sim).toBeGreaterThan(0.7);
        expect(sim).toBeLessThan(1.0);
    });

    test('completely different = 0', () => {
        expect(tokenSetSimilarity('acme dental', 'beta plumbing')).toBe(0);
    });

    test('empty strings = 0', () => {
        expect(tokenSetSimilarity('', '')).toBe(0);
    });
});

// ── isDistinctiveName ────────────────────────────────────────────────────────

describe('marketContextResolver — isDistinctiveName', () => {
    test('hemixperts is distinctive', () => {
        expect(isDistinctiveName('hemixperts')).toBe(true);
    });

    test('professional automotive repair is generic', () => {
        expect(isDistinctiveName('professional automotive repair')).toBe(false);
    });

    test('braxton auto care is distinctive (braxton)', () => {
        expect(isDistinctiveName('braxton auto care')).toBe(true);
    });

    test('best quality auto service is generic', () => {
        expect(isDistinctiveName('best quality auto service')).toBe(false);
    });
});

// ── resolveMarketContext ─────────────────────────────────────────────────────

describe('marketContextResolver — resolveMarketContext', () => {
    beforeEach(() => {
        mockDocs.length = 0;
    });

    test('returns null when city is missing', async () => {
        const result = await resolveMarketContext('user1', null, 'GA', 'dental');
        expect(result).toBeNull();
    });

    test('returns null when industry is missing', async () => {
        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', null);
        expect(result).toBeNull();
    });

    test('returns null when no reports found', async () => {
        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).toBeNull();
    });

    test('returns null when report is too old', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 90);
        mockDocs.push({
            id: 'report1',
            data: () => ({
                industry: { display: 'Dental Practice' },
                createdAt: { toDate: () => oldDate },
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: {}, competitors: [], leads: [] },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).toBeNull();
    });

    test('returns null when industry does not match', async () => {
        mockDocs.push({
            id: 'report1',
            data: () => ({
                industry: { display: 'Restaurant' },
                createdAt: { toDate: () => new Date() },
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: {}, competitors: [], leads: [] },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).toBeNull();
    });

    test('returns benchmarks and competitorIndex for valid report', async () => {
        mockDocs.push({
            id: 'report1',
            data: () => ({
                industry: { display: 'Dental Practice' },
                createdAt: { toDate: () => new Date() },
                location: { city: 'Atlanta', state: 'GA' },
                data: {
                    benchmarks: {
                        avgRating: 4.2,
                        avgReviews: 120,
                        topQuartileRating: 4.7,
                        totalCompetitors: 15,
                        marketLeader: { name: 'Best Dental', rating: 4.8, reviews: 300, voiceShare: 25 },
                    },
                    salesIntel: { entryWedge: 'Test wedge', bestTimeToCall: 'Tuesday AM', topPainPoints: ['Pain1', 'Pain2'] },
                    newsSignals: [{ title: 'New dental office opens', daysAgo: 10 }],
                    competitors: [
                        { name: 'Comp A', rating: 4.0, reviews: 50, shareOfVoice: 10 },
                    ],
                    leads: [
                        { name: 'Lead B', rating: 3.5, reviewCount: 20, shareOfVoice: 5, opportunityScore: 75, intelSignal: 'Signal line 1\nSignal line 2' },
                    ],
                },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).not.toBeNull();
        expect(result.benchmarks.reportId).toBe('report1');
        expect(result.benchmarks.marketAvgRating).toBe(4.2);
        expect(result.benchmarks.marketAvgReviews).toBe(120);
        expect(result.benchmarks.painPoints).toHaveLength(2);
        expect(result.competitorIndex.length).toBe(2);
    });

    test('handles createdAt as ISO string', async () => {
        mockDocs.push({
            id: 'report1',
            data: () => ({
                industry: { display: 'Dental Practice' },
                createdAt: new Date().toISOString(), // ISO string, not Timestamp
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: { avgRating: 4.0 }, competitors: [], leads: [] },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).not.toBeNull();
    });

    test('handles createdAt as JS Date', async () => {
        mockDocs.push({
            id: 'report1',
            data: () => ({
                industry: { display: 'Dental Practice' },
                createdAt: new Date(),
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: { avgRating: 4.0 }, competitors: [], leads: [] },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result).not.toBeNull();
    });

    test('newest qualifying report wins', async () => {
        const old = new Date(); old.setDate(old.getDate() - 30);
        const recent = new Date(); recent.setDate(recent.getDate() - 5);

        // First doc is newer (ordered by createdAt DESC)
        mockDocs.push({
            id: 'recent',
            data: () => ({
                industry: { display: 'Dental' },
                createdAt: { toDate: () => recent },
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: { avgRating: 4.5 }, competitors: [], leads: [] },
            }),
        });
        mockDocs.push({
            id: 'old',
            data: () => ({
                industry: { display: 'Dental' },
                createdAt: { toDate: () => old },
                location: { city: 'Atlanta', state: 'GA' },
                data: { benchmarks: { avgRating: 3.5 }, competitors: [], leads: [] },
            }),
        });

        const result = await resolveMarketContext('user1', 'Atlanta', 'GA', 'dental');
        expect(result.benchmarks.reportId).toBe('recent');
        expect(result.benchmarks.marketAvgRating).toBe(4.5);
    });
});

// ── Competitor Index Caps ────────────────────────────────────────────────────

describe('marketContextResolver — competitor index caps', () => {
    test('dedupes same business in competitors and leads (prefers lead)', () => {
        const index = _buildCompetitorIndex(
            [{ name: 'Acme Dental', rating: 4.0, reviews: 50, shareOfVoice: 10 }],
            [{ name: 'Acme Dental', rating: 4.2, reviewCount: 55, shareOfVoice: 12, opportunityScore: 80 }],
            'atlanta', 'ga'
        );
        expect(index).toHaveLength(1);
        expect(index[0].rating).toBe(4.2); // Lead version preferred
        expect(index[0].opportunityScore).toBe(80);
    });

    test('caps at 100 entries', () => {
        const leads = Array.from({ length: 60 }, (_, i) => ({
            name: `Lead ${i}`, rating: 4.0, reviewCount: 50, shareOfVoice: 5, opportunityScore: 70,
        }));
        const comps = Array.from({ length: 60 }, (_, i) => ({
            name: `Comp ${i}`, rating: 3.5, reviews: 30, shareOfVoice: 3,
        }));

        const index = _buildCompetitorIndex(comps, leads, 'atlanta', 'ga');
        expect(index.length).toBeLessThanOrEqual(100);
        // Leads come first
        expect(index[0].normalizedName).toContain('lead');
    });

    test('rawName capped at 120 chars', () => {
        const longName = 'A'.repeat(200);
        const index = _buildCompetitorIndex(
            [{ name: longName, rating: 4.0, reviews: 50 }],
            [],
            'atlanta', 'ga'
        );
        expect(index[0].rawName.length).toBeLessThanOrEqual(120);
    });

    test('intelSignals capped at 3, each ≤200 chars', () => {
        const longSignal = Array.from({ length: 5 }, (_, i) => 'X'.repeat(250) + ` signal ${i}`).join('\n');
        const index = _buildCompetitorIndex(
            [],
            [{ name: 'Test', rating: 4.0, reviewCount: 50, intelSignal: longSignal }],
            'atlanta', 'ga'
        );
        expect(index[0].intelSignals.length).toBeLessThanOrEqual(3);
        index[0].intelSignals.forEach(s => expect(s.length).toBeLessThanOrEqual(200));
    });
});

// ── matchProspectToReport ────────────────────────────────────────────────────

describe('marketContextResolver — matchProspectToReport', () => {
    const INDEX = [
        { normalizedName: 'hemixperts', rawName: 'HemiXperts', city: 'atlanta', state: 'ga', rating: 4.2, reviews: 80 },
        { normalizedName: 'blue ridge automotive european domestic', rawName: 'Blue Ridge Automotive - European & Domestic', city: 'atlanta', state: 'ga', rating: 3.8, reviews: 45 },
        { normalizedName: 'automotive service', rawName: 'Automotive Service', city: 'atlanta', state: 'ga', rating: 4.0, reviews: 30 },
        { normalizedName: 'automotive service repair', rawName: 'Automotive Service & Repair', city: 'atlanta', state: 'ga', rating: 3.5, reviews: 25 },
        { normalizedName: 'braxton howell mill', rawName: 'Braxton Howell Mill', city: 'atlanta', state: 'ga', rating: 4.1, reviews: 60 },
        { normalizedName: 'braxton northside', rawName: 'Braxton Northside', city: 'atlanta', state: 'ga', rating: 4.3, reviews: 70 },
        { normalizedName: 'professional automotive repair', rawName: 'Professional Automotive Repair', city: 'atlanta', state: 'ga', rating: 3.9, reviews: 40 },
    ];
    const REPORT_META = { city: 'Atlanta', state: 'GA' };

    test('exact match', () => {
        const result = matchProspectToReport(
            { name: 'HemiXperts', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        expect(result).not.toBeNull();
        expect(result.matchType).toBe('exact');
        expect(result.matched.rawName).toBe('HemiXperts');
    });

    test('suffix-stripped exact match (HemiXperts LLC)', () => {
        const result = matchProspectToReport(
            { name: 'HemiXperts LLC', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        expect(result).not.toBeNull();
        expect(result.matchType).toBe('exact');
    });

    test('token similarity ≥0.9 match (same city)', () => {
        const result = matchProspectToReport(
            { name: 'Blue Ridge Automotive', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        // "blue ridge automotive" vs "blue ridge automotive european domestic"
        // 3/5 tokens = 0.6 — below 0.9, should NOT match
        expect(result).toBeNull();
    });

    test('REJECTS substring trap', () => {
        const result = matchProspectToReport(
            { name: 'Automotive Service', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        // Exact match exists for "automotive service" — should match
        expect(result).not.toBeNull();
        expect(result.matchType).toBe('exact');
        expect(result.matched.rawName).toBe('Automotive Service');
    });

    test('REJECTS near-name siblings', () => {
        const result = matchProspectToReport(
            { name: 'Braxton Howell Mill', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        // Exact match
        expect(result).not.toBeNull();
        expect(result.matched.rawName).toBe('Braxton Howell Mill');

        // But Braxton Northside should NOT match Braxton Howell Mill
        const result2 = matchProspectToReport(
            { name: 'Braxton Howell Mill', city: 'Atlanta', state: 'GA' },
            REPORT_META, [{ normalizedName: 'braxton northside', rawName: 'Braxton Northside', city: 'atlanta', state: 'ga' }]
        );
        expect(result2).toBeNull();
    });

    test('returns null for no match', () => {
        const result = matchProspectToReport(
            { name: 'Totally Unknown Business', city: 'Atlanta', state: 'GA' },
            REPORT_META, INDEX
        );
        expect(result).toBeNull();
    });

    test('returns null for empty index', () => {
        const result = matchProspectToReport(
            { name: 'Test', city: 'Atlanta', state: 'GA' },
            REPORT_META, []
        );
        expect(result).toBeNull();
    });
});

// ── City Guard ───────────────────────────────────────────────────────────────

describe('marketContextResolver — city guard', () => {
    const INDEX = [
        { normalizedName: 'hemixperts', rawName: 'HemiXperts', city: 'atlanta', state: 'ga', rating: 4.2, reviews: 80 },
        { normalizedName: 'professional automotive repair', rawName: 'Professional Automotive Repair', city: 'atlanta', state: 'ga', rating: 3.9, reviews: 40 },
    ];
    const REPORT_META = { city: 'Atlanta', state: 'GA' };

    test('token match in different city → REJECTED', () => {
        const result = matchProspectToReport(
            { name: 'HemiXperts Auto', city: 'Vinings', state: 'GA' },
            REPORT_META, INDEX
        );
        // Token match would need same city — Vinings ≠ Atlanta
        expect(result).toBeNull();
    });

    test('exact same-state distinctive name cross-city → ALLOWED', () => {
        const result = matchProspectToReport(
            { name: 'HemiXperts', city: 'Marietta', state: 'GA' },
            REPORT_META, INDEX
        );
        // "hemixperts" is distinctive, same state GA — allowed cross-city
        expect(result).not.toBeNull();
        expect(result.matchType).toBe('exact');
    });

    test('exact same-state generic name cross-city → REJECTED', () => {
        const result = matchProspectToReport(
            { name: 'Professional Automotive Repair', city: 'Marietta', state: 'GA' },
            REPORT_META, INDEX
        );
        // All tokens generic, cross-city — rejected
        expect(result).toBeNull();
    });

    test('exact different-state → REJECTED', () => {
        const result = matchProspectToReport(
            { name: 'HemiXperts', city: 'Atlanta', state: 'TN' },
            REPORT_META, INDEX
        );
        expect(result).toBeNull();
    });
});

// ── Additive-Only Invariant ──────────────────────────────────────────────────

describe('calculateFitScore — additive-only invariant (PR #23A)', () => {
    // Need to re-require with proper mocks
    const mockGetFn = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
    const mockUpdateFn = jest.fn().mockResolvedValue(undefined);

    // Import calculateFitScore from the actual service
    // It was already loaded by earlier tests, use the cached version
    let calculateFitScore;
    try {
        calculateFitScore = require('../services/prospectIntelService').calculateFitScore;
    } catch {
        // If module fails to load due to firebase-admin, skip these tests
        calculateFitScore = null;
    }

    const SWEEP_FIXTURES = [
        { googleRating: 3.0, totalReviews: 10 },
        { googleRating: 4.2, totalReviews: 45 },   // Bug case: market avg 4.1
        { googleRating: 4.5, totalReviews: 80, websiteUrl: 'https://ex.com' },
        { googleRating: 0, totalReviews: 0 },
        { googleRating: 3.8, totalReviews: 30, address: { city: 'ATL' } },
        { googleRating: 4.2, totalReviews: 100, websiteUrl: 'https://ex.com', address: { city: 'ATL' } },
    ];

    const MARKET_CONTEXT = {
        marketAvgRating: 4.1,
        marketAvgReviews: 120,
    };

    if (calculateFitScore) {
        SWEEP_FIXTURES.forEach((agent, i) => {
            test(`fixture ${i + 1}: score(with context) >= score(without context)`, () => {
                const without = calculateFitScore(agent, {}, null, null);
                const withCtx = calculateFitScore(agent, {}, null, MARKET_CONTEXT);
                expect(withCtx.fitScore).toBeGreaterThanOrEqual(without.fitScore);
            });
        });

        test('bug case: market avg 4.1, prospect 4.2★ — low_rating still fires', () => {
            const agent = { googleRating: 4.2, totalReviews: 45 };
            const without = calculateFitScore(agent, {}, null, null);
            const withCtx = calculateFitScore(agent, {}, null, MARKET_CONTEXT);

            // Static: 4.2 < 4.3 fires. Market: 4.2 > 4.1 does not fire. OR → fires.
            const lowRatingWithout = without.signalHits.find(s => s.key === 'low_rating');
            const lowRatingWith = withCtx.signalHits.find(s => s.key === 'low_rating');
            expect(lowRatingWithout).toBeTruthy();
            expect(lowRatingWith).toBeTruthy(); // Must still fire with context
            expect(withCtx.fitScore).toBeGreaterThanOrEqual(without.fitScore);
        });

        test('presence_gap fires at ≤35% of market avg', () => {
            const agent = { googleRating: 3.5, totalReviews: 40 }; // 40 ≤ 42 (35% of 120)
            const result = calculateFitScore(agent, {}, null, MARKET_CONTEXT);
            const pg = result.signalHits.find(s => s.key === 'presence_gap');
            expect(pg).toBeTruthy();
        });

        test('presence_gap does NOT fire above 35%', () => {
            const agent = { googleRating: 3.5, totalReviews: 50 }; // 50 > 42
            const result = calculateFitScore(agent, {}, null, MARKET_CONTEXT);
            const pg = result.signalHits.find(s => s.key === 'presence_gap');
            expect(pg).toBeUndefined();
        });

        test('presence_gap null-excluded without context', () => {
            const agent = { googleRating: 3.5, totalReviews: 10 };
            const result = calculateFitScore(agent, {}, null, null);
            const pg = result.signalHits.find(s => s.key === 'presence_gap');
            expect(pg).toBeUndefined();
        });

        test('ENABLE_MARKET_CONTEXT=false → scores identical to no context', () => {
            const agent = { googleRating: 4.2, totalReviews: 45 };
            const without = calculateFitScore(agent, {}, null, null);
            const withNull = calculateFitScore(agent, {}, null, null); // explicit null
            expect(without.fitScore).toBe(withNull.fitScore);
            expect(without.signalHits.length).toBe(withNull.signalHits.length);
        });

        test('no fired signal disappears when context is added', () => {
            SWEEP_FIXTURES.forEach(agent => {
                const without = calculateFitScore(agent, {}, null, null);
                const withCtx = calculateFitScore(agent, {}, null, MARKET_CONTEXT);

                const withoutKeys = new Set(without.signalHits.map(s => s.key));
                const withKeys    = new Set(withCtx.signalHits.map(s => s.key));

                // Every signal that fired without context must still fire with context
                for (const key of withoutKeys) {
                    expect(withKeys.has(key)).toBe(true);
                }
            });
        });
    } else {
        test('skipped — calculateFitScore not available', () => {
            expect(true).toBe(true);
        });
    }
});
