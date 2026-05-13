'use strict';

/**
 * Industry & Labor Economics Narrative Generator
 *
 * Converts BLS QCEW employment/wage/establishment data into a B2B sales
 * narrative that helps the field rep understand the prospect's economic
 * operating environment.
 *
 * Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE task — short structured output).
 */

const { generateStructured } = require('../services/structuredGeneration');

const INDUSTRY_ECONOMICS_SCHEMA = {
    type: 'object',
    properties: {
        industryContext: { type: 'string' },
        salesInsight:    { type: 'string' },
        laborNote:       { type: 'string' }
    },
    required: ['industryContext', 'salesInsight', 'laborNote']
};

/**
 * @param {Object} economicsData - Output from getIndustryEconomics()
 * @param {Object} prospectData  - { businessName, category, city, state }
 * @returns {Promise<Object>} { industryContext, salesInsight, laborNote }
 */
async function generateIndustryEconomicsNarrative(economicsData, prospectData) {
    const { metrics, naicsLabel, county, state, dataYear, isStateFallback } = economicsData;
    const m = metrics;

    // Build data summary for prompt
    const location   = isStateFallback ? state : `${county}, ${state}`;
    const emplLine   = m.localEmployment   ? `${m.localEmployment.toLocaleString()} workers in this industry locally` : null;
    const wageLine   = m.averageWeeklyWage ? `avg weekly wage $${m.averageWeeklyWage.toLocaleString()} (annual ~$${(m.annualPay || 0).toLocaleString()})` : null;
    const estabsLine = m.establishments    ? `${m.establishments.toLocaleString()} establishments` : null;

    const trendLines = [
        m.employmentChangePct  != null ? `Employment: ${m.employmentChangePct > 0 ? '+' : ''}${m.employmentChangePct}% YoY (${m.employmentTrend})` : null,
        m.wageChangePct        != null ? `Wages: ${m.wageChangePct > 0 ? '+' : ''}${m.wageChangePct}% YoY (${m.wageTrend})` : null,
        m.establishmentChangePct != null ? `Establishments: ${m.establishmentChangePct > 0 ? '+' : ''}${m.establishmentChangePct}% YoY (${m.establishmentTrend})` : null
    ].filter(Boolean);

    const lqLine = m.locationQuotient != null
        ? `Location quotient: ${m.locationQuotient} (${m.locationQuotient > 1.2 ? 'industry is concentrated here' : m.locationQuotient < 0.8 ? 'industry is underrepresented here' : 'roughly average concentration'})`
        : null;

    const dataLines = [emplLine, wageLine, estabsLine, ...trendLines, lqLine].filter(Boolean);

    const systemInstruction = `You are a B2B market intelligence analyst writing for a sales rep who sells marketing and reputation software to small businesses. Your job is to translate labor economics data into practical sales intelligence. Be specific — cite numbers and trends. Short sentences. No em dashes. No generic filler.`;

    const userPrompt = `Business: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Industry: ${naicsLabel} (NAICS ${economicsData.naicsCode})
Location: ${location} — ${dataYear} BLS QCEW data

Industry Data:
${dataLines.map(l => `- ${l}`).join('\n')}

Generate all three fields:

industryContext: 2-3 sentences. Describe the state of this industry in ${location} — employment level, growth trajectory, competitive density (establishment count), and any wage pressure or labor dynamics. Reference specific numbers.

salesInsight: 1-2 sentences. What does this industry context mean for a sales rep pitching marketing/reputation software to this business? Is the market getting more competitive? Are rising labor costs making efficient customer acquisition more urgent? Be direct about the sales implication.

laborNote: 1 sentence. A specific observation about wages or labor dynamics (rising/falling wages, LQ, wage vs. national/state average if evident). If wage data is unavailable, write a general but plausible statement about labor costs in this industry in ${state}.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema:  INDUSTRY_ECONOMICS_SCHEMA,
        model:           'gemini-2.5-flash',
        temperature:     0.5,
        maxOutputTokens: 600
    });
}

module.exports = { generateIndustryEconomicsNarrative };
