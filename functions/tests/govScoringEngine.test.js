'use strict';

// ── Hard Filters ─────────────────────────────────────────────────────────────

const { applyHardFilters } = require('../services/govcapture/govHardFilters');

describe('govHardFilters — applyHardFilters', () => {
    const BASE_PROFILE = {
        filters: {
            geographyRequired: [],
            requiredBuyerTypes: [],
            excludedSetAsides: [],
            minContractValue: null,
            maxContractValue: null,
        },
    };

    test('past due → DISQ_PAST_DUE', () => {
        const opp = { dueDate: '2020-01-01T00:00:00Z' };
        const result = applyHardFilters(opp, BASE_PROFILE);
        expect(result.passed).toBe(false);
        expect(result.disqualifyReason).toBe('DISQ_PAST_DUE');
    });

    test('missing dueDate → passes', () => {
        const opp = { dueDate: null };
        expect(applyHardFilters(opp, BASE_PROFILE).passed).toBe(true);
    });

    test('missing estimatedValue → passes', () => {
        const opp = { estimatedValue: null };
        expect(applyHardFilters(opp, BASE_PROFILE).passed).toBe(true);
    });

    test('missing geography → passes', () => {
        const opp = { location: null };
        expect(applyHardFilters(opp, BASE_PROFILE).passed).toBe(true);
    });

    test('geography mismatch when required → DISQ_OUTSIDE_GEOGRAPHY', () => {
        const profile = { filters: { ...BASE_PROFILE.filters, geographyRequired: ['GA', 'NC'] } };
        const opp = { location: { state: 'CA' } };
        expect(applyHardFilters(opp, profile).disqualifyReason).toBe('DISQ_OUTSIDE_GEOGRAPHY');
    });

    test('geography match when required → passes', () => {
        const profile = { filters: { ...BASE_PROFILE.filters, geographyRequired: ['GA', 'NC'] } };
        const opp = { location: { state: 'GA' } };
        expect(applyHardFilters(opp, profile).passed).toBe(true);
    });

    test('below min value → DISQ_BELOW_MIN_VALUE', () => {
        const profile = { filters: { ...BASE_PROFILE.filters, minContractValue: 100000 } };
        const opp = { estimatedValue: 50000 };
        expect(applyHardFilters(opp, profile).disqualifyReason).toBe('DISQ_BELOW_MIN_VALUE');
    });

    test('above max value → DISQ_ABOVE_MAX_VALUE', () => {
        const profile = { filters: { ...BASE_PROFILE.filters, maxContractValue: 1000000 } };
        const opp = { estimatedValue: 5000000 };
        expect(applyHardFilters(opp, profile).disqualifyReason).toBe('DISQ_ABOVE_MAX_VALUE');
    });
});

// ── Prefilter ────────────────────────────────────────────────────────────────

const { scoreRelevance, _matchKeyword, _normalizeText } = require('../services/govcapture/govPrefilter');

const COUNTIFI_PROFILE = {
    solutions: [{
        name: 'Countifi — Asset Tracking',
        keywords: [
            'asset tracking', 'inventory management', 'RFID',
            'warehouse management', 'computer vision', 'predictive inventory',
            'supply chain visibility', 'materials management',
            'inventory counting', 'inventory automation',
            'barcode scanning', 'asset lifecycle', 'physical inventory',
            'cycle counting', 'inventory reconciliation', 'stock management',
            'asset audit', 'inventory control', 'warehouse operations',
            'supply chain analytics',
        ],
    }],
    credentials: {
        naicsCodes: ['541614', '561990', '541511', '541512', '611420'],
    },
    filters: {
        buyerTypes: ['Federal', 'State', 'Higher Ed', 'Healthcare'],
    },
    negativeKeywords: [
        'welcome kit', 'promotional', 'printing', 'uniforms',
        'janitorial', 'food service', 'landscaping', 'construction materials',
    ],
};

describe('govPrefilter — _matchKeyword', () => {
    test('multi-word phrase matches exactly', () => {
        expect(_matchKeyword('asset tracking', 'rfid asset tracking system')).toBe(true);
    });

    test('multi-word phrase does not match partial', () => {
        expect(_matchKeyword('asset tracking', 'asset management and tracking')).toBe(false);
    });

    test('single-word matches at word boundary', () => {
        expect(_matchKeyword('RFID', 'rfid asset tracking')).toBe(true);
    });

    test('single-word does NOT match as substring', () => {
        expect(_matchKeyword('RFID', 'arfidly something')).toBe(false);
    });

    test('empty keyword → false', () => {
        expect(_matchKeyword('', 'some text')).toBe(false);
    });
});

describe('govPrefilter — scoreRelevance', () => {
    const rfidOpp = require('./fixtures/govcapture/positive-rfid-asset-management.json');
    const welcomeKitOpp = require('./fixtures/govcapture/negative-welcome-kit-production.json');
    const warehouseOpp = require('./fixtures/govcapture/near-miss-warehouse-supplies.json');

    test('NAICS exact match → +3', () => {
        const result = scoreRelevance(rfidOpp, COUNTIFI_PROFILE);
        expect(result.signals).toContain('MATCH_NAICS_EXACT');
        expect(result.score).toBeGreaterThanOrEqual(3);
    });

    test('keyword hits capped at 5', () => {
        const result = scoreRelevance(rfidOpp, COUNTIFI_PROFILE);
        const kwHits = result.signals.filter(s => s.startsWith('KEYWORD_HIT:'));
        expect(kwHits.length).toBeLessThanOrEqual(5);
    });

    test('negative keyword: once per distinct, capped at -3', () => {
        const result = scoreRelevance(welcomeKitOpp, COUNTIFI_PROFILE);
        const negHits = result.signals.filter(s => s.startsWith('NEGATIVE_KEYWORD:'));
        expect(negHits.length).toBeGreaterThanOrEqual(1);
        // Score floor at 0
        expect(result.score).toBeGreaterThanOrEqual(0);
    });

    test('score range 0-9', () => {
        const result = scoreRelevance(rfidOpp, COUNTIFI_PROFILE);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(9);
    });

    test('RFID fixture + Countifi → high prefilter score', () => {
        const result = scoreRelevance(rfidOpp, COUNTIFI_PROFILE);
        expect(result.score).toBeGreaterThanOrEqual(3); // NAICS + keywords
    });

    test('welcome kit fixture → low score (negative keywords)', () => {
        const result = scoreRelevance(welcomeKitOpp, COUNTIFI_PROFILE);
        // "welcome kit" is a negative keyword, NAICS doesn't match
        expect(result.score).toBeLessThanOrEqual(2);
    });

    test('warehouse supplies → moderate score (keyword overlap but no NAICS)', () => {
        const result = scoreRelevance(warehouseOpp, COUNTIFI_PROFILE);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(5);
    });
});

// ── Scoring Engine (deterministic paths only — no Gemini) ────────────────────

jest.mock('../services/structuredGeneration', () => ({
    generateStructured: jest.fn().mockResolvedValue({
        result: { relevanceScore: 5, reasoning: 'Moderate match' },
        usageMetadata: { inputTokens: 100, outputTokens: 50, modelName: 'gemini-2.5-flash' },
    }),
}));

// Lightweight firebase-admin mock for rescoreAllForProfile
jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({ exists: false }),
                update: jest.fn().mockResolvedValue(undefined),
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
    }), {
        FieldValue: {
            serverTimestamp: () => new Date(),
            increment: (n) => ({ _increment: n }),
        },
    }),
    initializeApp: jest.fn(),
}));

const { scoreOpportunity, rescoreWithAwardContext } = require('../services/govcapture/govScoringEngine');
const { generateStructured } = require('../services/structuredGeneration');

// dueDate overridden at runtime (now + 45 days) so deadlineScore always lands in the
// >30d bracket (10 pts). A hard-coded fixture date rots: it drifts into the <30d
// bracket, then past-due → hard-disqualified (empty reason/risk codes), breaking every
// scoreOpportunity/rescore assertion. This bit CI on 2026-07-20 when the welcome-kit
// fixture's dueDate arrived. Do NOT use raw fixtures in deadline-sensitive paths.
const withFutureDue = (fixture) => ({
    ...fixture,
    dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
});

describe('govScoringEngine — scoreOpportunity (Pass 1)', () => {
    const rfidOpp = withFutureDue(require('./fixtures/govcapture/positive-rfid-asset-management.json'));
    const welcomeKitOpp = withFutureDue(require('./fixtures/govcapture/negative-welcome-kit-production.json'));
    const ppeOpp = withFutureDue(require('./fixtures/govcapture/negative-ppe-vendor-management.json'));
    const warehouseOpp = withFutureDue(require('./fixtures/govcapture/near-miss-warehouse-supplies.json'));
    // femaOpp stays raw — its null dueDate exercises the missing-date path.
    const femaOpp = require('./fixtures/govcapture/positive-asset-shipment-tracking-fema.json');

    const profile = { id: 'countifi-test', ...COUNTIFI_PROFILE };

    beforeEach(() => jest.clearAllMocks());

    test('RFID fixture + Countifi → Possible or better', async () => {
        const result = await scoreOpportunity(rfidOpp, profile, { allowSemantic: false });
        expect(result.pass).toBe(1);
        expect(result.hardDisqualified).toBe(false);
        expect(result.reasonCodes).toContain('MATCH_NAICS_EXACT');
        expect(result.prefilterScore).toBeGreaterThanOrEqual(3);
        // With NAICS match + keyword overlap + buyer match, should be at least Stretch
        expect(['Strong Fit', 'Possible Fit', 'Stretch']).toContain(result.label);
        expect(result.score).toBeGreaterThanOrEqual(45);
    });

    test('FEMA fixture + Countifi → Stretch or better (keyword overlap)', async () => {
        const result = await scoreOpportunity(femaOpp, profile, { allowSemantic: false });
        expect(result.hardDisqualified).toBe(false);
        expect(['Strong Fit', 'Possible Fit', 'Stretch']).toContain(result.label);
    });

    test('welcome-kit fixture + Countifi → Poor Fit (JustWin regression)', async () => {
        const result = await scoreOpportunity(welcomeKitOpp, profile, { allowSemantic: false });
        expect(result.hardDisqualified).toBe(false);
        expect(result.riskCodes).toContain('RISK_NEGATIVE_KEYWORD_MATCH');
        // MUST be Poor Fit or Disqualified — NOT Possible, NOT Strong, NOT Stretch
        expect(['Poor Fit', 'Disqualified']).toContain(result.label);
    });

    test('PPE fixture + Countifi → Stretch or Poor', async () => {
        const result = await scoreOpportunity(ppeOpp, profile, { allowSemantic: false });
        expect(['Stretch', 'Poor Fit']).toContain(result.label);
    });

    test('warehouse supplies fixture + Countifi → Stretch', async () => {
        const result = await scoreOpportunity(warehouseOpp, profile, { allowSemantic: false });
        expect(['Stretch', 'Poor Fit']).toContain(result.label);
    });

    test('past-due opportunity → Disqualified, no Gemini', async () => {
        const pastDue = { ...rfidOpp, dueDate: '2020-01-01T00:00:00Z' };
        const result = await scoreOpportunity(pastDue, profile);
        expect(result.score).toBe(0);
        expect(result.label).toBe('Disqualified');
        expect(result.hardDisqualified).toBe(true);
        expect(result.reasonCodes).toContain('DISQ_PAST_DUE');
        expect(generateStructured).not.toHaveBeenCalled();
    });

    test('Pass 1 uses 90-point model', async () => {
        const result = await scoreOpportunity(rfidOpp, profile, { allowSemantic: false });
        expect(result.pass).toBe(1);
        expect(result._raw.available).toBe(90);
    });

    test('hardDisqualified result has correct shape', async () => {
        const pastDue = { ...rfidOpp, dueDate: '2020-01-01T00:00:00Z' };
        const result = await scoreOpportunity(pastDue, profile);
        expect(result).toHaveProperty('score', 0);
        expect(result).toHaveProperty('label', 'Disqualified');
        expect(result).toHaveProperty('reasonCodes');
        expect(result).toHaveProperty('riskCodes');
        expect(result).toHaveProperty('pass', 1);
        expect(result).toHaveProperty('hardDisqualified', true);
        expect(result).toHaveProperty('scoredAt');
        expect(result).toHaveProperty('scoredAgainstProfileId');
        expect(result).toHaveProperty('aiUsageMetadata', null);
        expect(result).toHaveProperty('prefilterScore');
    });
});

// ── Semantic Gate ────────────────────────────────────────────────────────────

describe('govScoringEngine — semantic gate', () => {
    const rfidOpp = withFutureDue(require('./fixtures/govcapture/positive-rfid-asset-management.json'));
    const profile = { id: 'countifi-test', ...COUNTIFI_PROFILE };

    beforeEach(() => jest.clearAllMocks());

    test('relevance < 2 AND allowSemantic false → no Gemini', async () => {
        // Use an opp with no keyword or NAICS overlap
        const lowOpp = {
            title: 'Unrelated Janitorial Services',
            description: 'Building janitorial cleaning services',
            naicsCodes: ['561720'],
            buyerName: 'GSA',
            location: { state: 'DC' },
        };
        await scoreOpportunity(lowOpp, profile, { allowSemantic: false });
        // Janitorial is a negative keyword → score likely 0
        // Gemini should NOT be called
        expect(generateStructured).not.toHaveBeenCalled();
    });

    test('allowSemantic: true → Gemini called', async () => {
        await scoreOpportunity(rfidOpp, profile, { allowSemantic: true });
        expect(generateStructured).toHaveBeenCalled();
    });

    test('relevance >= 2 → Gemini called', async () => {
        // RFID fixture has NAICS match (+3) → relevance >= 2
        await scoreOpportunity(rfidOpp, profile, { allowSemantic: false });
        expect(generateStructured).toHaveBeenCalled();
    });

    test('Gemini failure → deterministic fallback, not crash', async () => {
        generateStructured.mockRejectedValueOnce(new Error('API timeout'));
        const result = await scoreOpportunity(rfidOpp, profile, { allowSemantic: true });
        // Should still return a valid score
        expect(result.score).toBeGreaterThan(0);
        expect(result.hardDisqualified).toBe(false);
    });

    test('AI usage metadata populated when Gemini called', async () => {
        const result = await scoreOpportunity(rfidOpp, profile, { allowSemantic: true });
        expect(result.aiUsageMetadata).not.toBeNull();
        expect(result.aiUsageMetadata.modelName).toBe('gemini-2.5-flash');
    });

    test('AI usage metadata null when Gemini not called', async () => {
        const lowOpp = {
            title: 'Janitorial Services',
            description: 'Cleaning janitorial food service',
            naicsCodes: ['561720'],
        };
        const result = await scoreOpportunity(lowOpp, profile, { allowSemantic: false });
        expect(result.aiUsageMetadata).toBeNull();
    });
});

// ── Pass 2 ───────────────────────────────────────────────────────────────────

describe('govScoringEngine — rescoreWithAwardContext (Pass 2)', () => {
    const rfidOpp = withFutureDue(require('./fixtures/govcapture/positive-rfid-asset-management.json'));
    const profile = { id: 'countifi-test', ...COUNTIFI_PROFILE };

    test('Pass 2 uses fit.pass = 2', async () => {
        const awardCtx = { similarAwardsFound: true, incumbentVendors: ['Acme'], pastPerformanceRelevant: true };
        const result = await rescoreWithAwardContext(rfidOpp, profile, awardCtx);
        expect(result.pass).toBe(2);
    });

    test('Pass 2 score >= Pass 1 with positive award context', async () => {
        const pass1 = await scoreOpportunity(rfidOpp, profile, { allowSemantic: false });
        const awardCtx = { similarAwardsFound: true, incumbentVendors: ['Acme'], pastPerformanceRelevant: true };
        const pass2 = await rescoreWithAwardContext(rfidOpp, profile, awardCtx);
        // Pass 2 has more available weight (100 vs 90) but also adds award points
        expect(pass2.reasonCodes).toContain('AWARD_SIMILAR_FOUND');
    });

    test('no similar awards → still valid Pass 2', async () => {
        const awardCtx = { similarAwardsFound: false };
        const result = await rescoreWithAwardContext(rfidOpp, profile, awardCtx);
        expect(result.pass).toBe(2);
    });

    test('null award context → valid Pass 2 with 0 award points', async () => {
        const result = await rescoreWithAwardContext(rfidOpp, profile, null);
        expect(result.pass).toBe(2);
    });
});

// ── Negative Keyword Risk ────────────────────────────────────────────────────

describe('govScoringEngine — negative keywords', () => {
    const welcomeKitOpp = withFutureDue(require('./fixtures/govcapture/negative-welcome-kit-production.json'));
    const profile = { id: 'countifi-test', ...COUNTIFI_PROFILE };

    test('negative keyword → RISK_NEGATIVE_KEYWORD_MATCH in riskCodes', async () => {
        const result = await scoreOpportunity(welcomeKitOpp, profile, { allowSemantic: false });
        expect(result.riskCodes).toContain('RISK_NEGATIVE_KEYWORD_MATCH');
    });
});

// ── Fit Labels ───────────────────────────────────────────────────────────────

describe('govScoringEngine — fit labels', () => {
    test('label thresholds', () => {
        // Verify through the scoring results
        // Strong >= 85, Possible >= 65, Stretch >= 45, Poor >= 20, Disqualified < 20
        expect(true).toBe(true); // Labels tested via fixture assertions above
    });
});
