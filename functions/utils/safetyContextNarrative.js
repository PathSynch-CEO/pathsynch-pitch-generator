'use strict';

/**
 * Safety & Local Operating Context Narrative Generator
 *
 * Converts raw ZIP-level and state-level safety data into a business-focused
 * narrative for the sales rep. Output is NEVER "crime report" framing —
 * always foot traffic, customer comfort, after-hours operations, staffing,
 * and trust signals.
 *
 * Gemini is NOT asked to compute confidence — confidence is calculated
 * server-side in safetyContextService.js (high/medium/low based on provider count).
 *
 * Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE task — short structured output).
 */

const { generateStructured } = require('../services/structuredGeneration');

const SAFETY_NARRATIVE_SCHEMA = {
    type: 'object',
    properties: {
        summary:   { type: 'string' },
        salesUse:  { type: 'string' },
        caution:   { type: 'string' }
    },
    required: ['summary', 'salesUse', 'caution']
};

/**
 * Generate a business-context narrative from safety data.
 *
 * @param {Object} safetyContext - Output from getSafetyContext() (after normalization)
 * @param {Object} prospectData  - { businessName, category, city, state }
 * @returns {Promise<Object>}    - { summary, salesUse, caution }
 */
async function generateSafetyContextNarrative(safetyContext, prospectData) {
    const { zipLevel, stateLevel, confidence } = safetyContext;

    // Build data description for prompt
    const zipText = zipLevel
        ? [
            zipLevel.grade            ? `ZIP safety grade: ${zipLevel.grade}`                        : null,
            zipLevel.safetyIndex      ? `Safety index: ${zipLevel.safetyIndex}`                       : null,
            zipLevel.totalCrimeRate   ? `Total crime rate: ${zipLevel.totalCrimeRate}`                 : null,
            zipLevel.violentCrimeRate ? `Violent crime rate: ${zipLevel.violentCrimeRate}`             : null,
            zipLevel.nationalComparison ? `National comparison: ${zipLevel.nationalComparison}`        : null,
            zipLevel.stateComparison  ? `State comparison: ${zipLevel.stateComparison}`                : null,
            zipLevel.county           ? `County: ${zipLevel.county}`                                   : null
          ].filter(Boolean).join('. ')
        : 'ZIP-level data unavailable';

    const fbiText = stateLevel
        ? `FBI UCR (${stateLevel.year}, ${stateLevel.state}): ${Object.entries(stateLevel.summary || {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(', ')}`
        : 'State-level FBI data unavailable';

    const systemInstruction = `You are a local market intelligence analyst writing for a B2B sales rep who visits small businesses in person. Your job is to help the rep understand the local operating environment of a prospect — not to evaluate the prospect or their neighborhood.

CRITICAL RULES:
- Never label any area, street, or ZIP code as "safe" or "unsafe"
- Never make predictions about individuals or business owners
- Never describe crime trends in alarming language
- Frame all data in terms of business operations: customer foot traffic patterns, comfort visiting after hours, staffing considerations, parking safety perception, and neighborhood trust signals
- Short sentences. No em dashes. No generic observations. No fear language.`;

    const userPrompt = `Business: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Location: ${prospectData.city}, ${prospectData.state} (ZIP ${safetyContext.zipCode})

ZIP-Level Data: ${zipText}

State-Level FBI UCR: ${fbiText}

Data confidence: ${confidence} (${safetyContext.providers.zyla.dataAvailable ? 'ZIP' : '—'} + ${safetyContext.providers.fbi.dataAvailable ? 'State' : '—'})

Generate all three fields using only the data above. Write as if briefing a field sales rep before a door knock.

summary: 2 sentences. Describe the local operating context of this ZIP code in neutral, business-operational terms. Reference foot traffic comfort, daytime vs. after-hours dynamics, or neighborhood character signals. Cite the safety grade or index if available.

salesUse: 1-2 sentences. How might this context affect a customer's decision to visit or engage with this business? What is the practical implication for the prospect's marketing or customer retention strategy? Be specific to the business category.

caution: 1 sentence. A neutral note about data limitations — e.g., data freshness, state vs. ZIP level, or what the rep should not infer from this data.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema:  SAFETY_NARRATIVE_SCHEMA,
        model:           'gemini-2.5-flash',
        temperature:     0.4,
        maxOutputTokens: 500
    });
}

module.exports = { generateSafetyContextNarrative };
