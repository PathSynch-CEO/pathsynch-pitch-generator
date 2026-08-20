'use strict';

/**
 * PR-C2 race fix — the search-grounded decisionMaker must reach the generator's prompt.
 *
 * generateHighImpactMoves interpolates `lead.decisionMaker.name` into its prompt. market.js now
 * AWAITS dmEnrichmentPromise BEFORE the generator runs, so the name is present when the prompt is
 * built. This test proves the mechanism: when the enrichment field is populated, the name appears in
 * the prompt; when it is absent (the old lost-race state), it does not — which is exactly why the
 * ordering matters (an absent name is where Gemini used to fall back to training recall).
 */

const capturedPrompts = [];

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: () => ({
            generateContent: jest.fn().mockImplementation((prompt) => {
                capturedPrompts.push(prompt);
                return Promise.resolve({
                    response: {
                        text: () => JSON.stringify([
                            { title: 'Target the leader gap', context: 'c', action: 'Call the owner of Peachtree Junk Removal', timing: 'Week 1', expectedOutcome: '2 demos' },
                            { title: 'Second move', context: 'c', action: 'Pitch EZ Atlanta Junk Removal', timing: 'Week 2', expectedOutcome: '1 demo' }
                        ])
                    }
                });
            })
        })
    }))
}));

const { generateHighImpactMoves } = require('../services/salesIntelGenerator');

const COMPS = [{ name: 'College Hunks Hauling Junk and Moving Atlanta', rating: 4.9, reviewCount: 26802 }];
const BENCH = { avgRating: 4.96, avgReviews: 900, medianReviews: 734, marketLeader: 'College Hunks' };

beforeEach(() => { capturedPrompts.length = 0; });

describe('PR-C2 — decisionMaker reaches the HIM prompt (why awaiting before generation matters)', () => {
    test('populated decisionMaker.name appears in the prompt as "DM: <name>"', async () => {
        const leads = [
            { name: 'Peachtree Junk Removal', rating: 5.0, reviewCount: 734, opportunityScore: 52,
              decisionMaker: { name: 'Ryan Tabb', title: 'President', source: 'search', verifiedAt: '2026-08-20T15:00:00Z' } }
        ];
        await generateHighImpactMoves('Atlanta', 'Home Services', COMPS, leads, BENCH, [], null, '');
        expect(capturedPrompts).toHaveLength(1);
        expect(capturedPrompts[0]).toContain('DM: Ryan Tabb');
    });

    test('absent decisionMaker (the lost-race state) → no DM name in the prompt', async () => {
        const leads = [
            { name: 'Peachtree Junk Removal', rating: 5.0, reviewCount: 734, opportunityScore: 52 } // no decisionMaker
        ];
        await generateHighImpactMoves('Atlanta', 'Home Services', COMPS, leads, BENCH, [], null, '');
        expect(capturedPrompts[0]).not.toContain('DM:');
        expect(capturedPrompts[0]).not.toContain('Ryan Tabb');
    });
});
