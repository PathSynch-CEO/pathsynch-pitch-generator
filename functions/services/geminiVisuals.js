/**
 * Gemini SVG Data Visualization Generator
 *
 * Uses Gemini text generation to produce SVG chart code
 * for Smart Mode analysis cards. Each card type maps to a
 * specific SVG chart prompt.
 *
 * Returns data:image/svg+xml;base64,... URLs.
 * Graceful degradation: returns null on any failure.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SVG_SYSTEM_PROMPT = 'You are an SVG code generator. You output ONLY raw SVG code. No markdown fences, no backticks, no explanation text, no JSON. Start your response with <svg and end with </svg>. Nothing else.';

const CARD_SVG_PROMPTS = {
    card1: "Generate an SVG competitor positioning chart. Draw a 2x2 quadrant with X-axis labeled 'Price' (Low left, High right) and Y-axis labeled 'Quality' (Low bottom, High top). Plot exactly 4 circles: one teal #0D9488 circle labeled 'Us' in top-right quadrant, three gray circles labeled 'Competitor 1', 'Competitor 2', 'Competitor 3' in other positions. Add quadrant labels. viewBox='0 0 400 400'. White background. Output ONLY the SVG, starting with <svg and ending with </svg>.",
    card2: "Generate a minimal SVG horizontal bar chart comparing 3 ratings: This business 4.5★, Neighborhood avg 3.8★, Best in class 4.8★. SVG only. viewBox='0 0 400 200'. Teal/amber/green.",
    card3: "Generate a minimal SVG pie chart showing market opportunity: 35% captured, 65% uncaptured. SVG only. viewBox='0 0 300 300'. Teal and light gray.",
    card4: "Generate a minimal SVG bar chart showing 3 revenue bars growing left to right. SVG only. viewBox='0 0 400 250'. Teal color.",
    card5: "Generate a minimal SVG showing referral growth: current 8/month arrow pointing to potential 20/month. Simple arrow diagram. SVG only. viewBox='0 0 400 200'.",
    card6: "Generate a minimal SVG radar/spider chart with 9 axes for GBP completeness. Fill 60% area in teal. SVG only. viewBox='0 0 300 300'.",
    standard: "Generate a minimal SVG bar chart showing 3 revenue bars growing left to right. SVG only. viewBox='0 0 400 250'. Teal color."
};

/**
 * Generate an SVG data visualization for a card type
 *
 * @param {Object} params
 * @param {string} params.cardType - card1-card6 or standard
 * @param {string} params.businessName
 * @param {string} params.industry
 * @param {string} params.primaryColor
 * @param {string} params.accentColor
 * @param {Object} params.enrichmentData
 * @returns {Promise<string|null>} data:image/svg+xml;base64,... or null
 */
async function generateDataViz(params) {
    const { cardType, businessName, industry, primaryColor, accentColor, enrichmentData } = params;

    console.log('[GeminiVisuals] generateDataViz called, cardType:', cardType);

    if (!GEMINI_API_KEY) {
        console.warn('[GeminiVisuals] GEMINI_API_KEY not set — skipping');
        return null;
    }

    const chartPrompt = CARD_SVG_PROMPTS[cardType] || CARD_SVG_PROMPTS.standard;

    // Build context from enrichment data
    let dataContext = `Business: ${businessName || 'Local Business'}, Industry: ${industry || 'Local Services'}`;
    if (enrichmentData?.prospectData?.businessProfile) {
        const bp = enrichmentData.prospectData.businessProfile;
        dataContext += `, Rating: ${bp.rating || 'N/A'}, Reviews: ${bp.reviewCount || 0}`;
    }
    if (enrichmentData?.prospectData?.competitivePosition) {
        const cp = enrichmentData.prospectData.competitivePosition;
        dataContext += `, Competitors: ${cp.competitorCount || 0}, Avg Rating: ${cp.avgCompetitorRating?.toFixed(1) || 'N/A'}`;
    }

    const userPrompt = `${chartPrompt} Data context: ${dataContext}. Primary color: ${primaryColor || '#0D9488'}, accent: ${accentColor || '#F59E0B'}. White background.`;

    try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: SVG_SYSTEM_PROMPT }] },
                contents: [{
                    parts: [{ text: userPrompt }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 4096
                }
            }),
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.warn(`[GeminiVisuals] API error ${response.status}: ${errText.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        console.log('[GeminiVisuals] response received, parsing SVG...');
        const candidates = data.candidates || [];
        if (candidates.length === 0) {
            console.warn('[GeminiVisuals] No candidates returned');
            return null;
        }

        // Extract text response containing SVG
        const parts = candidates[0]?.content?.parts || [];
        const text = parts.map(p => p.text || '').join('');

        // Parse SVG from response
        const svgMatch = text.match(/<svg[\s\S]*<\/svg>/);
        if (!svgMatch) {
            console.warn('[GeminiVisuals] No valid SVG in response');
            return null;
        }

        let svgString = svgMatch[0];

        // Fix camelCase SVG attributes Gemini sometimes outputs (JSX style)
        svgString = svgString
            .replace(/strokeWidth=/g, 'stroke-width=')
            .replace(/textAnchor=/g, 'text-anchor=')
            .replace(/fontSize=/g, 'font-size=')
            .replace(/strokeDasharray=/g, 'stroke-dasharray=')
            .replace(/fillOpacity=/g, 'fill-opacity=')
            .replace(/strokeOpacity=/g, 'stroke-opacity=');

        const base64 = Buffer.from(svgString).toString('base64');

        console.log(`[GeminiVisuals] Generated SVG data viz for ${cardType} (${svgString.length} chars)`);
        return `data:image/svg+xml;base64,${base64}`;
    } catch (error) {
        console.error('[GeminiVisuals] Failed:', error.message);
        return null;
    }
}

module.exports = { generateDataViz };
