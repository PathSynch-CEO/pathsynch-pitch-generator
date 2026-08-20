'use strict';

/**
 * fix/market-intel-precision-leak-and-discovery-zeroing — review point (2)
 *
 * The leak fix stops FUSING precisionContext into the industry label, but the precision steering
 * must still reach lead analysis on the NON-ZERO path. In market.js the precision text is now
 * threaded through `profileGuidance` (the silent, non-echoed channel) into every narrative
 * generator. This proves the sub-type actually reaches the model that selects the wedge and
 * prioritizes leads — i.e. it is present in the prompt sent to Gemini for salesIntel (entryWedge)
 * and High-Impact Moves.
 *
 * We capture the exact prompt strings passed to generateContent and assert the precision sub-type
 * survives inside the REPORT GUIDANCE block (applied silently, not echoed into output).
 */

const capturedPrompts = [];

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: () => ({
            generateContent: jest.fn().mockImplementation((prompt) => {
                capturedPrompts.push(prompt);
                // Return schema-valid output per generator: salesIntel expects a JSON OBJECT,
                // High-Impact Moves expects a JSON ARRAY (parser reads `[` … `]`).
                const isArrayCall = /JSON array/i.test(String(prompt));
                const text = isArrayCall
                    ? JSON.stringify([
                        { title: 'Target the gap', context: 'c', action: 'Call Delerme CPA', timing: 'This week', expectedOutcome: '2 demos' },
                        { title: 'Follow the wedge', context: 'c', action: 'Email Beta LLC', timing: 'Next week', expectedOutcome: '1 demo' }
                    ])
                    : JSON.stringify({
                        topPainPoints: ['a', 'b', 'c'],
                        objectionResponses: [{ objection: 'x', response: 'y' }],
                        entryWedge: 'Open with the 4.4-star market average.',
                        bestTimeToCall: 'Tuesday mornings',
                        competitorVulnerability: 'Acme is slow to respond',
                        talkingPoints: ['p1', 'p2', 'p3']
                    });
                return Promise.resolve({ response: { text: () => text } });
            })
        })
    }))
}));

const { generateSalesIntel, generateHighImpactMoves } = require('../services/salesIntelGenerator');
const fx = require('./fixtures/atlantaJunkReport');

// The precision steering as market.js now assembles it into profileGuidance.
const PRECISION_GUIDANCE =
    '\nPRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses ' +
    'within the Home Services vertical. Prioritize businesses matching this sub-type.\n' +
    "\nUser's approach preference: All Atlanta Metro Area.\n";

beforeEach(() => { capturedPrompts.length = 0; });

describe('precision steering reaches lead analysis on the non-zero path (via profileGuidance)', () => {
    test('salesIntel (wedge selection) prompt carries the precision sub-type inside REPORT GUIDANCE', async () => {
        const result = await generateSalesIntel(
            'Atlanta', 'Home Services', fx.competitors, fx.qualifiedLeads, null,
            fx.benchmarks, [], null, PRECISION_GUIDANCE
        );
        expect(result).toBeTruthy();
        expect(capturedPrompts).toHaveLength(1);
        const prompt = capturedPrompts[0];
        // The steering is present so the model can bias the wedge toward the sub-type...
        expect(prompt).toContain('REPORT GUIDANCE (apply silently');
        expect(prompt).toContain('Residential Cleanouts');
        expect(prompt).toContain('Prioritize businesses matching this sub-type');
        // ...but it is confined to the silent guidance block, not the industry label.
        expect(prompt).toContain('PathSynch to Home Services businesses in Atlanta');
    });

    test('High-Impact Moves prompt also carries the precision sub-type (ranking of moves)', async () => {
        const moves = await generateHighImpactMoves(
            'Atlanta', 'Home Services', fx.competitors, fx.qualifiedLeads,
            fx.benchmarks, [], null, PRECISION_GUIDANCE
        );
        expect(Array.isArray(moves)).toBe(true);
        const prompt = capturedPrompts[0];
        expect(prompt).toContain('REPORT GUIDANCE (apply silently');
        expect(prompt).toContain('Residential Cleanouts');
    });

    test('with NO precision answer, the guidance block is absent (no empty scaffolding)', async () => {
        await generateSalesIntel(
            'Atlanta', 'Home Services', fx.competitors, fx.qualifiedLeads, null,
            fx.benchmarks, [], null, ''
        );
        const prompt = capturedPrompts[0];
        expect(prompt).not.toContain('REPORT GUIDANCE');
        expect(prompt).not.toContain('Residential Cleanouts');
    });
});
