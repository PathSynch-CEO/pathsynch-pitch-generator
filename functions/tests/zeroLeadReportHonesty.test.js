'use strict';

/**
 * fix/zero-lead-report-honesty
 *
 * Regression coverage for the zero-qualified-lead prose defect observed in the live
 * 2026-08-04 Atlanta "Junk Removal & Hauling" Market Intel report (0 qualified leads):
 *
 *   "0 qualified leads identified — review counts ranging from 0 to 0, well below the market
 *    leader's 3418, signalling strong quality with room to grow"
 *   "Start with Unknown — 0★, 0 reviews, opportunity score 0 — highest-scoring lead in this market"
 *
 * The #73-derived executive-summary generator (generateAIExecutiveSummary) unconditionally
 * asks the model for four sentences — thesis, gap (derived review RANGE), populated-quadrant,
 * and a "Start with <top lead>" action — so at n=0 it emits claims whose subject does not exist.
 *
 * The mock below reproduces the ACTUAL incident: Gemini SUCCEEDS and returns dishonest copy
 * (it is NOT a Gemini failure). These tests therefore FAIL against pre-fix source — pre-fix the
 * function returns the model's dishonest string verbatim — and pass once the n=0 honesty guard
 * short-circuits before the model call.
 */

// Faithful reproduction of the production dishonest output for the n=0 case.
const MOCK_DISHONEST_SUMMARY =
    "College Hunks dominates Atlanta Junk Removal & Hauling with 3418 reviews — 5x the market average of 647. " +
    "0 qualified leads identified — review counts ranging from 0 to 0, well below the market leader's 3418, " +
    "signalling strong quality with room to grow digital presence. " +
    "The high-reputation, low-presence quadrant is populated. " +
    "Start with Unknown — 0★, 0 reviews, opportunity score 0 — highest-scoring lead in this market.";

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: () => ({
            generateContent: jest.fn().mockResolvedValue({
                response: { text: () => MOCK_DISHONEST_SUMMARY }
            })
        }),
    })),
}));

const { generateAIExecutiveSummary } = require('../services/narrativeGenerator');
const fx = require('./fixtures/atlantaJunkReport');

const FORBIDDEN = [
    'ranging from',
    '0 to 0',
    'start with',
    'highest-scoring lead',
    'quadrant is populated',
    'room to grow'
];

function assertNoForbiddenClaims(summary) {
    const lower = String(summary).toLowerCase();
    for (const phrase of FORBIDDEN) {
        expect(lower).not.toContain(phrase);
    }
}

describe('zero-lead executive summary honesty', () => {
    test('n=0 emits NONE of the derived claims whose subject does not exist', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 22 }
        );
        expect(summary).toBeTruthy();
        assertNoForbiddenClaims(summary);
        // States the zero-lead outcome plainly.
        expect(summary.toLowerCase()).toContain('no qualified leads');
        // Never names a non-existent "Unknown" top lead.
        expect(summary).not.toContain('Unknown');
    });

    test('n=0 WITH candidates flags a filtering outcome and surfaces the count', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 22 }
        );
        expect(summary.toLowerCase()).toContain('filtering outcome');
        expect(summary).toContain('22');
        assertNoForbiddenClaims(summary);
    });

    test('n=0 with NO candidates states an empty market plainly (no filtering claim)', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 0 }
        );
        expect(summary.toLowerCase()).toContain('no qualified leads');
        expect(summary.toLowerCase()).not.toContain('filtering outcome');
        assertNoForbiddenClaims(summary);
    });

    test('n=0 is honest even when the candidate count is unknown (no options)', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, [], [], fx.benchmarks
        );
        expect(summary.toLowerCase()).toContain('no qualified leads');
        assertNoForbiddenClaims(summary);
    });

    test('n>0 is unaffected — the model path still runs (guard does not short-circuit)', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, fx.qualifiedLeads, [], fx.benchmarks,
            '', { leadCandidateCount: fx.qualifiedLeads.length }
        );
        // With leads present the function returns the model output (mocked here), proving the
        // n=0 guard did not fire for a populated lead set.
        expect(summary).toBe(MOCK_DISHONEST_SUMMARY);
    });
});
