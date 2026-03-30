/**
 * Decision Maker Enricher
 * Uses Serper search + Gemini extraction to find owner/founder/key decision maker for a business.
 * Higher accuracy than regex-only approach (~60-70% hit rate).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE = 'https://google.serper.dev';

async function serperQuickSearch(query, num = 3) {
    if (!SERPER_API_KEY) return [];
    try {
        const resp = await fetch(`${SERPER_BASE}/search`, {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, num, gl: 'us', hl: 'en' })
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data?.organic || [];
    } catch (e) {
        return [];
    }
}

async function extractPersonFromSnippets(snippets, businessName) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 100,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const prompt = `Extract the owner, founder, or key decision maker name from these search results about "${businessName}".

Search results:
${snippets}

Return JSON only. No preamble. Format:
{"name": "First Last", "title": "Owner|Founder|President|General Manager"}

If no person name is clearly identifiable as the owner/founder, return: {"name": null, "title": null}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        if (start === -1 || end <= start) return null;
        const parsed = JSON.parse(text.substring(start, end));
        if (parsed.name && parsed.name !== 'null' && parsed.name !== 'null null') return parsed;
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Enrich a lead with decision maker info via Serper + Gemini
 * @param {string} leadName - Business name
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string|null} website - Business website URL
 * @returns {Object|null} { name, title, source, confidence } or null
 */
async function enrichDecisionMaker(leadName, city, state, website) {
    // Source 1: Direct search for owner/founder
    try {
        const query = `"${leadName}" ${city} ${state} owner OR founder OR president`;
        const results = await serperQuickSearch(query, 3);

        if (results.length > 0) {
            const snippets = results.map(r => `${r.title}: ${r.snippet}`).join('\n');
            const extracted = await extractPersonFromSnippets(snippets, leadName);
            if (extracted) {
                return {
                    name: extracted.name,
                    title: extracted.title || 'Owner',
                    source: 'search',
                    confidence: 'high'
                };
            }
        }
    } catch (e) {
        console.warn(`[DecisionMaker] Search failed for ${leadName}:`, e.message);
    }

    // Source 2: Website about page search
    if (website) {
        try {
            const domain = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            const aboutResults = await serperQuickSearch(`site:${domain} about team founder owner`, 2);
            if (aboutResults.length > 0) {
                const snippets = aboutResults.map(r => `${r.title}: ${r.snippet}`).join('\n');
                const extracted = await extractPersonFromSnippets(snippets, leadName);
                if (extracted) {
                    return {
                        name: extracted.name,
                        title: extracted.title || 'Owner',
                        source: 'website',
                        confidence: 'medium'
                    };
                }
            }
        } catch (e) {
            console.warn(`[DecisionMaker] Website enrichment failed for ${leadName}:`, e.message);
        }
    }

    return null;
}

module.exports = { enrichDecisionMaker };
