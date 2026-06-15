'use strict';

// ── Pure Generator Tests ─────────────────────────────────────────────────────

jest.mock('../services/structuredGeneration', () => ({
    generateStructured: jest.fn().mockResolvedValue({
        result: {
            summary: 'Strong opportunity for asset tracking capabilities.',
            fitSummary: 'NAICS match with direct solution alignment.',
            whyItFits: ['NAICS 541614 exact match', 'RFID expertise directly applicable'],
            whyItMayNotFit: ['Geographic distance from LA to GA headquarters'],
            keyRequirements: ['CAC-enabled system', 'RFID technology', 'Barcode fallback'],
            requiredDocuments: ['SF-330', 'Past performance references'],
            submissionInstructions: 'Submit via SAM.gov by 08/15/2026',
            deadlineRisk: 'Low — 60+ days remaining',
            eligibilityRisks: ['Small business set-aside verification needed'],
            suggestedNextSteps: ['Review full solicitation', 'Prepare past performance package'],
            bidRecommendation: 'pursue',
            confidence: 'high',
            checklistAnswers: {
                q1: { answer: '$750,000 estimated', confidence: 'medium' },
                q2: { answer: 'Not found in source document', confidence: 'low' },
                q3: { answer: 'Barksdale AFB, Louisiana', confidence: 'high' },
                q4: { answer: 'Not found in source document', confidence: 'low' },
                q5: { answer: 'Submit via SAM.gov portal', confidence: 'medium' },
            },
        },
        usageMetadata: { inputTokens: 1200, outputTokens: 800, modelName: 'gemini-2.5-flash' },
    }),
}));

const {
    generateBidBrief,
    PROMPT_VERSION,
    HUMAN_REVIEW_WARNING,
    BID_RECOMMENDATIONS,
    CONFIDENCE_LEVELS,
    _buildSystemPrompt,
    _buildUserPrompt,
    _constrainEnum,
    _sanitizeChecklistAnswers,
    _estimateCost,
} = require('../services/govcapture/briefGenerator');

const { generateStructured } = require('../services/structuredGeneration');

const COUNTIFI_PROFILE = {
    id: 'countifi-test',
    profileName: 'Countifi',
    solutions: [{ name: 'Asset Tracking', keywords: ['RFID', 'inventory management', 'asset tracking'] }],
    credentials: {
        naicsCodes: ['541614'],
        pastPerformance: [
            { client: 'Emirates', description: 'Asset tracking deployment' },
            { client: 'Duke Health', description: 'Healthcare asset tracking' },
        ],
        capStatementText: null,
    },
};

const RFID_OPP = require('./fixtures/govcapture/positive-rfid-asset-management.json');

// ── Constants ────────────────────────────────────────────────────────────────

describe('briefGenerator — constants', () => {
    test('PROMPT_VERSION is defined', () => {
        expect(PROMPT_VERSION).toBe('1.0');
    });

    test('HUMAN_REVIEW_WARNING is defined and not empty', () => {
        expect(HUMAN_REVIEW_WARNING.length).toBeGreaterThan(50);
    });

    test('BID_RECOMMENDATIONS has 4 values', () => {
        expect(BID_RECOMMENDATIONS).toEqual(['pursue', 'pass', 'investigate', 'watch']);
    });

    test('CONFIDENCE_LEVELS has 3 values', () => {
        expect(CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
    });
});

// ── Constraint Helpers ───────────────────────────────────────────────────────

describe('briefGenerator — _constrainEnum', () => {
    test('valid value passes through', () => {
        expect(_constrainEnum('pursue', BID_RECOMMENDATIONS, 'investigate')).toBe('pursue');
    });

    test('invalid value → fallback', () => {
        expect(_constrainEnum('go_for_it', BID_RECOMMENDATIONS, 'investigate')).toBe('investigate');
    });

    test('null → fallback', () => {
        expect(_constrainEnum(null, BID_RECOMMENDATIONS, 'investigate')).toBe('investigate');
    });
});

// ── Checklist Sanitization ───────────────────────────────────────────────────

describe('briefGenerator — _sanitizeChecklistAnswers', () => {
    test('"Not found" answer → confidence MUST be low', () => {
        const raw = { q1: { answer: 'Not found in source document', confidence: 'high' } };
        const result = _sanitizeChecklistAnswers(raw);
        expect(result.q1.confidence).toBe('low');
    });

    test('valid answer preserves confidence', () => {
        const raw = { q1: { answer: '$750,000', confidence: 'medium' } };
        const result = _sanitizeChecklistAnswers(raw);
        expect(result.q1.confidence).toBe('medium');
    });

    test('null input → empty object', () => {
        expect(_sanitizeChecklistAnswers(null)).toEqual({});
    });

    test('sourceEvidence preserved with quote cap at 240 chars', () => {
        const raw = {
            q1: {
                answer: 'Test',
                confidence: 'high',
                sourceEvidence: { quote: 'A'.repeat(300), field: 'description' },
            },
        };
        const result = _sanitizeChecklistAnswers(raw);
        expect(result.q1.sourceEvidence.quote.length).toBeLessThanOrEqual(240);
        expect(result.q1.sourceEvidence.field).toBe('description');
    });
});

// ── Cost Estimation ──────────────────────────────────────────────────────────

describe('briefGenerator — _estimateCost', () => {
    test('calculates cost from tokens', () => {
        const cost = _estimateCost({ inputTokens: 1000, outputTokens: 500 });
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeLessThan(0.01); // Very small for 1500 tokens
    });
});

// ── Prompt Builders ──────────────────────────────────────────────────────────

describe('briefGenerator — prompt construction', () => {
    test('system prompt includes profile name and solutions', () => {
        const prompt = _buildSystemPrompt(COUNTIFI_PROFILE);
        expect(prompt).toContain('Countifi');
        expect(prompt).toContain('Asset Tracking');
        expect(prompt).toContain('RFID');
    });

    test('system prompt includes hallucination guard', () => {
        const prompt = _buildSystemPrompt(COUNTIFI_PROFILE);
        expect(prompt).toContain('Never invent');
        expect(prompt).toContain('Not found in source document');
    });

    test('system prompt includes past performance', () => {
        const prompt = _buildSystemPrompt(COUNTIFI_PROFILE);
        expect(prompt).toContain('Emirates');
        expect(prompt).toContain('Duke Health');
    });

    test('system prompt with cap statement', () => {
        const profileWithCap = {
            ...COUNTIFI_PROFILE,
            credentials: { ...COUNTIFI_PROFILE.credentials, capStatementText: 'We are a leading provider...' },
        };
        const prompt = _buildSystemPrompt(profileWithCap);
        expect(prompt).toContain('Capability Statement');
        expect(prompt).toContain('leading provider');
    });

    test('user prompt includes opportunity details', () => {
        const prompt = _buildUserPrompt(RFID_OPP, COUNTIFI_PROFILE, null);
        expect(prompt).toContain('RFID Asset Management');
        expect(prompt).toContain('541614');
        expect(prompt).toContain('Air Force');
    });

    test('user prompt includes award context when present', () => {
        const oppWithAward = {
            ...RFID_OPP,
            awardContext: { similarAwardsFound: true, similarAwardCount: 5, incumbentVendors: ['Palantir'] },
        };
        const prompt = _buildUserPrompt(oppWithAward, COUNTIFI_PROFILE, null);
        expect(prompt).toContain('Award Context');
        expect(prompt).toContain('Palantir');
    });

    test('user prompt includes checklist questions', () => {
        const checklist = {
            questions: [
                { id: 'q1', question: 'What is the budget?' },
                { id: 'q2', question: 'Is there a pre-bid meeting?' },
            ],
        };
        const prompt = _buildUserPrompt(RFID_OPP, COUNTIFI_PROFILE, checklist);
        expect(prompt).toContain('What is the budget?');
        expect(prompt).toContain('Is there a pre-bid meeting?');
    });
});

// ── Full Generation ──────────────────────────────────────────────────────────

describe('briefGenerator — generateBidBrief', () => {
    beforeEach(() => jest.clearAllMocks());

    test('valid opportunity + profile → structured brief', async () => {
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(result.error).toBeNull();
        expect(result.brief).not.toBeNull();
        expect(result.brief.summary).toContain('asset tracking');
        expect(result.brief.bidRecommendation).toBe('pursue');
        expect(result.brief.confidence).toBe('high');
    });

    test('humanReviewRequired is ALWAYS true (hardcoded)', async () => {
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(result.brief.humanReviewRequired).toBe(true);
    });

    test('capStatementUsed: false when no cap statement', async () => {
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(result.brief.capStatementUsed).toBe(false);
    });

    test('capStatementUsed: true when cap statement present', async () => {
        const profileWithCap = {
            ...COUNTIFI_PROFILE,
            credentials: { ...COUNTIFI_PROFILE.credentials, capStatementText: 'We are experts...' },
        };
        const result = await generateBidBrief(RFID_OPP, profileWithCap);
        expect(result.brief.capStatementUsed).toBe(true);
    });

    test('aiUsageMetadata captured', async () => {
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(result.aiUsageMetadata).not.toBeNull();
        expect(result.aiUsageMetadata.modelName).toBe('gemini-2.5-flash');
        expect(result.aiUsageMetadata.promptVersion).toBe('1.0');
        expect(result.aiUsageMetadata.inputTokens).toBe(1200);
    });

    test('generateStructured failure → brief null, error returned', async () => {
        generateStructured.mockRejectedValueOnce(new Error('API timeout'));
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(result.brief).toBeNull();
        expect(result.error).toContain('API timeout');
    });

    test('bidRecommendation constrained to valid values', async () => {
        generateStructured.mockResolvedValueOnce({
            result: { summary: 'Test', bidRecommendation: 'GO_FOR_IT', confidence: 'VERY_HIGH' },
            usageMetadata: { inputTokens: 100, outputTokens: 50 },
        });
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        expect(BID_RECOMMENDATIONS).toContain(result.brief.bidRecommendation);
        expect(CONFIDENCE_LEVELS).toContain(result.brief.confidence);
    });

    test('checklist "Not found" answers have confidence low', async () => {
        const result = await generateBidBrief(RFID_OPP, COUNTIFI_PROFILE);
        const q2 = result.brief.checklistAnswers.q2;
        expect(q2.answer).toBe('Not found in source document');
        expect(q2.confidence).toBe('low');
    });
});

// ── Route Contracts ──────────────────────────────────────────────────────────

describe('govBriefs — route contracts', () => {
    test('generate-brief and briefs endpoints exist', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('/govcapture/opportunities/:oppId/generate-brief');
        expect(content).toContain('/govcapture/opportunities/:oppId/briefs');
    });

    test('generate-brief checks GOVCAPTURE_AI_BRIEFS_ENABLED', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('GOVCAPTURE_AI_BRIEFS_ENABLED');
    });

    test('briefs endpoint orders by generatedAt desc', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain("orderBy('generatedAt', 'desc')");
    });
});

// ── Persistence Wrapper Contracts ────────────────────────────────────────────

describe('govBriefs — briefService contracts', () => {
    test('module exports createBidBriefForOpportunity', () => {
        const mod = jest.requireActual('../services/govcapture/briefService');
        expect(typeof mod.createBidBriefForOpportunity).toBe('function');
    });
});
