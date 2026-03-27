/**
 * Gemini Data Visualization Generator
 *
 * Uses Gemini to generate data visualization chart images
 * for Smart Mode analysis cards. Each card type maps to a
 * specific chart/infographic prompt.
 *
 * Graceful degradation: returns null on any failure.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const CARD_VIZ_PROMPTS = {
    card1: 'A professional infographic showing a competitor positioning map. Price vs quality quadrant with 4 labeled data points. Colors: teal #0D9488 and white on dark background.',
    card2: 'A clean bar chart comparing this business review rating (4.5 stars) vs neighborhood average (3.8 stars) and industry best (4.8 stars). Horizontal bars. Teal/amber/green palette.',
    card3: 'A pie chart showing market opportunity breakdown: captured vs uncaptured local market share. With a TAM callout number. Professional flat design.',
    card4: 'A professional business metrics dashboard showing growth potential: revenue bars, customer count, ROI percentage. Minimal flat design.',
    card5: 'A simple ROI infographic: current referrals vs potential referrals with arrow showing growth. Annual revenue uplift callout. Clean minimal design.',
    card6: 'A radar chart showing GBP completeness across 9 dimensions: photos, hours, description, categories, website, Q&A, services, attributes, posts. Score shown as filled area. Teal color.',
    standard: 'A professional business metrics dashboard showing growth potential: revenue bars, customer count, ROI percentage. Minimal flat design.'
};

/**
 * Generate a data visualization image for a card type
 *
 * @param {Object} params
 * @param {string} params.cardType - card1-card6 or standard
 * @param {string} params.businessName
 * @param {string} params.industry
 * @param {string} params.primaryColor
 * @param {string} params.accentColor
 * @param {Object} params.enrichmentData
 * @returns {Promise<string|null>} data:image/png;base64,... or null
 */
async function generateDataViz(params) {
    const { cardType, businessName, industry, primaryColor, accentColor, enrichmentData } = params;

    if (!GEMINI_API_KEY) {
        console.warn('[GeminiVisuals] GEMINI_API_KEY not set — skipping');
        return null;
    }

    const chartDescription = CARD_VIZ_PROMPTS[cardType] || CARD_VIZ_PROMPTS.standard;

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

    const prompt = `Generate a data visualization for a business pitch. Type: ${chartDescription} Data context: ${dataContext}. Style: professional, flat design, ${primaryColor || '#0D9488'} and ${accentColor || '#F59E0B'} palette, white background, no text except labels, suitable for embedding in a sales presentation. 512x512px.`;

    try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE']
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
        const candidates = data.candidates || [];
        if (candidates.length === 0) {
            console.warn('[GeminiVisuals] No candidates returned');
            return null;
        }

        // Look for inline image data in parts
        const parts = candidates[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.inlineData?.mimeType?.startsWith('image/')) {
                const base64 = part.inlineData.data;
                if (base64) {
                    console.log(`[GeminiVisuals] Generated data viz for ${cardType} (${(base64.length / 1024).toFixed(0)}KB)`);
                    return `data:${part.inlineData.mimeType};base64,${base64}`;
                }
            }
        }

        console.warn('[GeminiVisuals] No image data in response parts');
        return null;
    } catch (error) {
        console.error('[GeminiVisuals] Failed:', error.message);
        return null;
    }
}

module.exports = { generateDataViz };
