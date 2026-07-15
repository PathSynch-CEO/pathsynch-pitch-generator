'use strict';

/**
 * PR-C1 — solution-relevance gate, scoringVersion, FIAT decomposition, rank
 * injection, and MVP-identity when the flag is off (v2.2 §4.4).
 *
 * Semantic relevance is controlled via the generateStructured mock; the profile
 * + opportunity are built so every dimension is deterministic (see math in the
 * design note strategy-review-govcapture-c1.md).
 */

jest.mock('../services/structuredGeneration', () => ({
    generateStructured: jest.fn(),
}));

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), update: jest.fn() })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
    }), { FieldValue: { serverTimestamp: () => new Date() } }),
    initializeApp: jest.fn(),
}));

const { generateStructured } = require('../services/structuredGeneration');
const { scoreOpportunity, rescoreWithAwardContext } = require('../services/govcapture/govScoringEngine');
const { gateCap, fitLabel, inboxTab, GATE_CAP, UNAVAILABLE_CAP } = require('../services/govcapture/govScoreConstants');
const { validateProfileInput } = require('../services/govcapture/schemas');

// ── Deterministic controlled fixtures ────────────────────────────────────────
// prefilter = NAICS exact (+3) + 3 keyword hits (+3) + priority buyer (+1) = 7
// → deterministic solution = round(7/9*30) = 23. NAICS 15, buyer 15, geo 0,
//   deadline 10 (>30d), cert 10 (no set-aside).

const STRONG_PROFILE = {
    id: 'c1-test',
    solutions: [{ name: 'Asset Tracking', keywords: ['asset tracking', 'rfid inventory', 'barcode scanning'], naicsCodes: ['541614'] }],
    credentials: { naicsCodes: ['541614'], certifications: [] },
    filters: { buyerTypes: ['Defense'] },
    negativeKeywords: [],
};

function strongOpp() {
    return {
        title:       'Asset Tracking and RFID Inventory System',
        description: 'Barcode scanning asset tracking rfid inventory for the agency',
        naicsCodes:  ['541614'],
        buyerName:   'Defense Logistics Agency',
        setAside:    null,
        location:    { state: 'VA' },
        dueDate:     new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    };
}

function mockRelevance(R) {
    generateStructured.mockResolvedValue({
        result: { relevanceScore: R, reasoning: 'test' },
        usageMetadata: { inputTokens: 10, outputTokens: 5, modelName: 'gemini-2.5-flash' },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOVCAPTURE_RANK_FIELDS_ENABLED;
});

// ── Gate — flag ON ───────────────────────────────────────────────────────────

describe('PR-C1 gate — flag ON', () => {
    beforeEach(() => { process.env.GOVCAPTURE_RANK_FIELDS_ENABLED = 'true'; });

    test('low semantic relevance (R≤3) caps composite at 39 + gate reason code', async () => {
        mockRelevance(2);
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.score).toBeLessThanOrEqual(GATE_CAP);
        expect(r.reasonCodes).toContain('GATE_LOW_SOLUTION_RELEVANCE');
        expect(r.scoringVersion).toBe(2);
        expect(inboxTab(r.score, r.hardDisqualified)).toBe('Review');
    });

    test('rule-float closed: same opp is Warm+ ungated but capped to Review gated', async () => {
        mockRelevance(1);
        process.env.GOVCAPTURE_RANK_FIELDS_ENABLED = 'false';
        const ungated = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        process.env.GOVCAPTURE_RANK_FIELDS_ENABLED = 'true';
        const gated = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });

        expect(ungated.score).toBeGreaterThanOrEqual(45); // would sit in Warm+
        expect(gated.score).toBeLessThanOrEqual(GATE_CAP); // gate drops it to Review
        expect(gated.reasonCodes).toContain('GATE_LOW_SOLUTION_RELEVANCE');
    });

    test('strong semantic (R=8) is NOT gated → Hot band', async () => {
        mockRelevance(8);
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.reasonCodes).not.toContain('GATE_LOW_SOLUTION_RELEVANCE');
        expect(r.reasonCodes).not.toContain('SEMANTIC_UNAVAILABLE');
        expect(r.score).toBeGreaterThanOrEqual(70);
        expect(inboxTab(r.score, r.hardDisqualified)).toBe('Hot');
    });

    test('semantic unavailable (Gemini throws) → cap 44 + SEMANTIC_UNAVAILABLE, stays Review', async () => {
        generateStructured.mockRejectedValue(new Error('boom'));
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.score).toBeLessThanOrEqual(UNAVAILABLE_CAP);
        expect(r.reasonCodes).toContain('SEMANTIC_UNAVAILABLE');
        expect(inboxTab(r.score, r.hardDisqualified)).toBe('Review');
    });

    test('rule-vs-semantic disagreement flagged when they diverge materially', async () => {
        mockRelevance(1); // semantic solution 3 vs deterministic 23 → composites differ ≥20
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.riskCodes).toContain('RISK_RULE_SEMANTIC_DISAGREEMENT');
    });

    test('Pass 2 bypass closed: gated Pass 1 stays capped after award enrichment', async () => {
        mockRelevance(2); // gated in Pass 1
        const award = { similarAwardsFound: true, incumbentVendors: ['X'], pastPerformanceRelevant: true }; // +10 raw
        const r = await rescoreWithAwardContext(strongOpp(), STRONG_PROFILE, award);
        expect(r.pass).toBe(2);
        expect(r.score).toBeLessThanOrEqual(GATE_CAP); // award did NOT lift it past the cap
    });

    test('rank fields inject into the semantic prompt (explicit SIMPLE model)', async () => {
        mockRelevance(8);
        const profile = { ...STRONG_PROFILE, rankAvoid: 'skip physical logistics and staffing' };
        await scoreOpportunity(strongOpp(), profile, { allowSemantic: true });
        const call = generateStructured.mock.calls[0][0];
        expect(call.systemInstruction).toContain('skip physical logistics and staffing');
        expect(call.model).toBe('gemini-2.5-flash');
    });

    test('FIAT decomposition present on the fit object', async () => {
        mockRelevance(8);
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.fiat).toEqual(expect.objectContaining({
            fit: expect.any(Number), intent: expect.any(Number),
            access: expect.any(Number), timing: expect.any(Number),
        }));
    });
});

// ── Flag OFF — MVP-identical ─────────────────────────────────────────────────

describe('PR-C1 — flag OFF preserves MVP behavior', () => {
    test('no gate codes, scoringVersion 1, low semantic NOT capped', async () => {
        mockRelevance(1);
        const r = await scoreOpportunity(strongOpp(), STRONG_PROFILE, { allowSemantic: true });
        expect(r.reasonCodes).not.toContain('GATE_LOW_SOLUTION_RELEVANCE');
        expect(r.reasonCodes).not.toContain('SEMANTIC_UNAVAILABLE');
        expect(r.scoringVersion).toBe(1);
        expect(r.score).toBeGreaterThan(GATE_CAP); // ungated 59 → not capped
    });

    test('semantic prompt has no rank block when flag off', async () => {
        mockRelevance(8);
        const profile = { ...STRONG_PROFILE, rankAvoid: 'skip physical logistics' };
        await scoreOpportunity(strongOpp(), profile, { allowSemantic: true });
        const call = generateStructured.mock.calls[0][0];
        expect(call.systemInstruction).not.toContain('skip physical logistics');
    });
});

// ── Constants — pure functions ───────────────────────────────────────────────

describe('PR-C1 govScoreConstants', () => {
    test('gateCap: unavailable → 44 / SEMANTIC_UNAVAILABLE', () => {
        expect(gateCap(false, null)).toEqual({ cap: 44, reasonCode: 'SEMANTIC_UNAVAILABLE' });
    });
    test('gateCap: R≤3 → 39 / GATE_LOW_SOLUTION_RELEVANCE', () => {
        expect(gateCap(true, 3)).toEqual({ cap: 39, reasonCode: 'GATE_LOW_SOLUTION_RELEVANCE' });
        expect(gateCap(true, 0)).toEqual({ cap: 39, reasonCode: 'GATE_LOW_SOLUTION_RELEVANCE' });
    });
    test('gateCap: R>3 → no cap', () => {
        expect(gateCap(true, 4)).toEqual({ cap: null, reasonCode: null });
        expect(gateCap(true, 10)).toEqual({ cap: null, reasonCode: null });
    });
    test('fitLabel bands', () => {
        expect(fitLabel(90)).toBe('Strong Fit');
        expect(fitLabel(70)).toBe('Possible Fit');
        expect(fitLabel(45)).toBe('Stretch');
        expect(fitLabel(39)).toBe('Poor Fit');
        expect(fitLabel(10)).toBe('Disqualified');
    });
    test('inboxTab bands (gate caps land in Review)', () => {
        expect(inboxTab(70, false)).toBe('Hot');
        expect(inboxTab(45, false)).toBe('Warm');
        expect(inboxTab(44, false)).toBe('Review'); // UNAVAILABLE_CAP
        expect(inboxTab(39, false)).toBe('Review'); // GATE_CAP
        expect(inboxTab(90, true)).toBe('Review');  // hard-disqualified always Review
    });
});

// ── Rank-field validation ────────────────────────────────────────────────────

describe('PR-C1 rank-field validation', () => {
    test('accepts rank fields', () => {
        const r = validateProfileInput({ profileName: 'X', rankIdealSolutions: 'a', rankAvoid: 'b' });
        expect(r.valid).toBe(true);
    });
    test('rejects non-string rank field', () => {
        const r = validateProfileInput({ profileName: 'X', rankAvoid: 123 });
        expect(r.valid).toBe(false);
    });
    test('rejects over-long rank field', () => {
        const r = validateProfileInput({ profileName: 'X', rankIdealSolutions: 'z'.repeat(2001) });
        expect(r.valid).toBe(false);
    });
    test('rejects too many expandedKeywords on a solution', () => {
        const many = Array.from({ length: 61 }, (_, i) => `k${i}`);
        const r = validateProfileInput({ profileName: 'X', solutions: [{ name: 'S', expandedKeywords: many }] });
        expect(r.valid).toBe(false);
    });
});
