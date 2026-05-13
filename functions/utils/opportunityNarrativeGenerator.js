/**
 * Executive Opportunity Narrative Generator
 *
 * Single Gemini call that generates all narrative outputs for the Executive Opportunity Score:
 * - primaryPain: the prospect's single biggest problem PathSynch can solve
 * - executiveSummary: internal overview for the sales team
 * - bestReachOutReason: specific advice on when and how to reach out
 * - recommendedFirstMessage: ready-to-use opening message for a call/email/door knock
 * - recommendedOffer: specific product stack, price, and 30-day quick win
 * - bestProductFit: top 1-3 product names from the catalog
 *
 * Uses generateStructured() — no indexOf('{') extraction.
 * Model: gemini-3-flash-preview (PRIMARY per GEMINI MODEL RULES).
 * On failure: throws. Callers should wrap in try/catch with timeout.
 */

'use strict';

const { generateStructured } = require('../services/structuredGeneration');

const NARRATIVE_SCHEMA = {
    type: 'object',
    properties: {
        primaryPain: { type: 'string' },
        executiveSummary: { type: 'string' },
        bestReachOutReason: { type: 'string' },
        recommendedFirstMessage: { type: 'string' },
        recommendedOffer: { type: 'string' },
        bestProductFit: {
            type: 'array',
            items: { type: 'string' }
        }
    },
    required: ['primaryPain', 'executiveSummary', 'bestReachOutReason', 'recommendedFirstMessage', 'recommendedOffer', 'bestProductFit']
};

/**
 * Generate executive narrative + reach-out reason + recommended offer.
 *
 * @param {Object} scoreResult - Output from calculateOpportunityScore()
 * @param {Object} prospectData - { businessName, category, city, state, rating, reviewCount }
 * @returns {Promise<Object>} Parsed narrative object matching NARRATIVE_SCHEMA
 * @throws {Error} On Gemini failure — callers must wrap in try/catch
 */
async function generateExecutiveNarrative(scoreResult, prospectData) {
    const allSignals = [];
    const allGaps = [];
    for (const [key, sub] of Object.entries(scoreResult.subScores)) {
        if (sub.signals) allSignals.push(...sub.signals.map(s => `[${key}] ${s}`));
        if (sub.gaps) allGaps.push(...sub.gaps.map(g => `[${key}] ${g}`));
    }

    const triggerDetails = scoreResult.triggers.triggers
        .map(t => `• ${t.label}: ${t.detail}`)
        .join('\n');

    const productFitDetails = scoreResult.productFit.products
        .filter(p => p.fitLevel !== 'Low')
        .map(p => `• ${p.product} (${p.fitLevel}): ${p.reason} — $${p.monthlyPrice}/mo`)
        .join('\n');

    const recommendedProducts = scoreResult.productFit.recommendedProducts
        .map(p => `${p.product} ($${p.monthlyPrice}/mo)`)
        .join(' + ');

    const systemInstruction = `You are a B2B sales intelligence analyst writing for a field sales representative who sells local marketing and reputation management software to small and medium businesses.

Be specific. Reference real data points from this prospect. Do not write generic content that could apply to any business. Every sentence must earn its place by including a concrete detail from the data provided.`;

    const userPrompt = `PROSPECT:
Name: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Location: ${prospectData.city}, ${prospectData.state}
Rating: ${prospectData.rating || 'N/A'} (${prospectData.reviewCount || 0} reviews)

OPPORTUNITY SCORES:
Overall: ${scoreResult.overallScore}/100 (${scoreResult.urgency})
Demand: ${scoreResult.subScores.demand.score}/100
Visibility Gap: ${scoreResult.subScores.visibilityGap.score}/100
Reputation Gap: ${scoreResult.subScores.reputationGap.score}/100
Competitive Pressure: ${scoreResult.subScores.competitivePressure.score}/100
PathSynch Fit: ${scoreResult.subScores.pathSynchFit.score}/100

KEY SIGNALS:
${allSignals.slice(0, 12).join('\n') || 'None'}

KEY GAPS (opportunities):
${allGaps.slice(0, 8).join('\n') || 'None'}

OUTREACH TRIGGERS DETECTED:
${triggerDetails || 'None detected'}

PRODUCT FIT ANALYSIS:
${productFitDetails || 'No strong fits detected'}
Recommended stack: ${recommendedProducts || 'N/A'}

PATHSYNCH PRODUCT CATALOG:
- PathConnect ($99/mo): NFC-based review capture cards and QR codes
- LocalSynch ($149/mo): Google Business Profile optimization
- ReferralSynch ($149/mo): Referral marketing automation
- PathManager ($199/mo): Reputation management dashboard
- PathSynch Neighbors ($249/mo): Shared EDDM direct mail postcards
- SynchIntro Managed Outbound ($499/mo): AI-powered outbound campaigns

INSTRUCTIONS:
Generate all six fields. Every field MUST reference a specific data point from this prospect — no generic templates allowed.

primaryPain: 1 sentence — the single biggest problem this business has that PathSynch can solve. Must name the business and reference a specific number.

executiveSummary: 2-3 sentences — internal overview of the opportunity for the sales team. Quantify the gap and explain why now is the right time.

bestReachOutReason: 2-3 sentences — the single best reason to reach out RIGHT NOW, grounded in the strongest trigger. Tell the rep exactly what angle to lead with AND what not to say. Make this feel like advice from a senior sales strategist who has closed 500 SMB deals.

recommendedFirstMessage: 2-3 sentences — an actual opening statement a sales rep could use in a cold email, door knock, or phone call. Must reference a specific data point (a number, a competitor name, or an observed gap). Must NOT sound like a template. No "I noticed your business" intros.

recommendedOffer: 2-3 sentences — the specific PathSynch product combination to pitch, the monthly price, and what the 30-day quick win looks like for this specific business. Be concrete.

bestProductFit: array of 1-3 product names (exact names from the catalog above) that are the strongest fits for this prospect.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: NARRATIVE_SCHEMA,
        model: 'gemini-3-flash-preview',
        temperature: 0.7,
        maxOutputTokens: 2048
    });
}

module.exports = { generateExecutiveNarrative };
