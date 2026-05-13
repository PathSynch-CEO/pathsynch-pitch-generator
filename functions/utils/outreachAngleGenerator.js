'use strict';

/**
 * AI-Written Outreach Angle Generator
 *
 * Consumes Executive Opportunity Score data from Prompt 1A and generates:
 * 1. Cold email (subject + body)
 * 2. LinkedIn message (under 300 chars)
 * 3. Call opener (under 60 words)
 * 4. "What I Would Do If I Owned This Business" — 5-step action plan
 *
 * Single Gemini call. Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE tasks per GEMINI MODEL RULES).
 * On failure: throws. Callers must wrap in try/catch with timeout.
 */

const { generateStructured } = require('../services/structuredGeneration');

const OUTREACH_SCHEMA = {
    type: 'object',
    properties: {
        coldEmail: {
            type: 'object',
            properties: {
                subjectLine: { type: 'string' },
                body: { type: 'string' }
            },
            required: ['subjectLine', 'body']
        },
        linkedInMessage: { type: 'string' },
        callOpener: { type: 'string' },
        actionPlan: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    step: { type: 'integer' },
                    action: { type: 'string' },
                    metric: { type: 'string' },
                    mapsTo: { type: 'string' }
                },
                required: ['step', 'action', 'metric', 'mapsTo']
            }
        }
    },
    required: ['coldEmail', 'linkedInMessage', 'callOpener', 'actionPlan']
};

/**
 * @param {Object} executiveScore - Output from calculateOpportunityScore() + narrative fields
 * @param {Object} prospectData - { businessName, ownerName, category, city, state, rating, reviewCount, website }
 * @returns {Promise<Object>} Parsed object matching OUTREACH_SCHEMA
 * @throws {Error} On Gemini failure
 */
async function generateOutreachAngles(executiveScore, prospectData) {
    const topTriggers = (executiveScore.triggers?.topTriggers || []).slice(0, 3);
    const recommendedProducts = (executiveScore.productFit?.products || [])
        .filter(p => p.fitLevel === 'High' || p.fitLevel === 'Medium')
        .slice(0, 3);

    const triggerContext = topTriggers.length
        ? topTriggers.map(t => `• ${t.name || t.id}: ${t.description || ''}`).join('\n')
        : 'None detected';

    const productContext = recommendedProducts.length
        ? recommendedProducts.map(p => `• ${p.name} (${p.fitLevel}): ${(p.reasons || []).join('; ')} — ${p.price}`).join('\n')
        : 'No strong fits';

    const systemInstruction = `You are a senior B2B sales strategist writing outreach copy for a field sales rep who sells local marketing and reputation management software to small businesses.

Every output MUST reference at least one specific data point (a number, competitor name, or observed gap) from the prospect data provided. If you cannot reference a specific number from the data provided, do not write that sentence. No generic language. No em dashes. Use contractions naturally. Short sentences. Direct tone. Never badmouth the prospect — frame everything as opportunity, not criticism.`;

    const userPrompt = `PROSPECT DATA:
Business: ${prospectData.businessName}
Owner/Contact: ${prospectData.ownerName || '[Owner]'}
Category: ${prospectData.category || 'Local business'}
City: ${prospectData.city}, ${prospectData.state}
Rating: ${prospectData.rating || 'N/A'} stars (${prospectData.reviewCount || 0} reviews)
Website: ${prospectData.website || 'None found'}

OPPORTUNITY CONTEXT:
Overall Score: ${executiveScore.overallScore}/100 (${executiveScore.urgency})
Primary Pain: ${executiveScore.primaryPain || 'N/A'}
Best Reach Out Reason: ${executiveScore.bestReachOutReason || 'N/A'}
Recommended Offer: ${executiveScore.productFit?.recommendedOffer || executiveScore.recommendedOffer || 'N/A'}

KEY TRIGGERS:
${triggerContext}

PRODUCT FIT:
${productContext}

COMPETITIVE CONTEXT:
${executiveScore.executiveSummary || 'No competitive data available'}

PATHSYNCH CAPABILITIES (for action plan framing — do not name these as products in customer-facing copy):
- NFC tap cards that send customers directly to Google review page
- QR code campaigns linked to landing pages and offers
- Google Business Profile optimization (photos, posts, services, hours)
- Automated review response and reputation monitoring dashboard
- Referral marketing automation (customers refer friends for rewards)
- Shared direct mail postcards to nearby households (EDDM)
- AI-powered outbound email and cold outreach campaigns

INSTRUCTIONS:

coldEmail.subjectLine: Under 60 characters. No business name. No "Partnership" or "Opportunity". Questions or local observations work best.

coldEmail.body: 3 short paragraphs. First paragraph: one specific observation with a data point (review count gap, rating vs competitor, GBP missing fields, etc.). Second paragraph: one or two sentences on what you do. Third paragraph: CTA — offer a 2-minute competitive snapshot or quick breakdown. Sign with just a first name placeholder "[Rep]". Total: under 120 words. No HTML formatting. Plain text only.

linkedInMessage: Under 300 characters. Reference one specific data point. End with a soft offer to share insights. No "Dear" or "Hello". Casual and direct.

callOpener: Under 60 words. Start with: "Hi [Owner], this is [Rep] with PathSynch. The reason I am calling is..." then one specific data point observation, then end with a question that invites conversation. No warmup ("How are you doing today?").

actionPlan: Exactly 5 steps, sequenced from quickest win to most advanced. Each step is framed as business advice, not a product pitch. The rep connects it to products in the conversation — do not name products in the action text. Each step must include a specific metric or data point from the enrichment data above.

Return all five actionPlan steps in order (step 1 through 5).`;

    const result = await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: OUTREACH_SCHEMA,
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxOutputTokens: 2048
    });

    // Validate and trim
    if (result.linkedInMessage && result.linkedInMessage.length > 300) {
        result.linkedInMessage = result.linkedInMessage.slice(0, 297) + '...';
    }
    if (!Array.isArray(result.actionPlan) || result.actionPlan.length !== 5) {
        console.warn('[OutreachAngles] Action plan has', result.actionPlan?.length, 'steps (expected 5)');
    }

    return result;
}

module.exports = { generateOutreachAngles };
