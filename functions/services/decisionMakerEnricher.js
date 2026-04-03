/**
 * Decision Maker Enricher
 * Uses Serper search + Gemini extraction to find owner/founder/key decision maker for a business.
 * Higher accuracy than regex-only approach (~60-70% hit rate).
 * Source 3: theorg.com lookup (~25-35% hit rate for businesses with corporate presence).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { getOrgChart } = require('./theOrgClient');

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

    // Source 3: theorg.com lookup (third fallback — ~25-35% hit rate)
    try {
        const orgData = await getOrgChart(leadName, city);
        if (orgData?.decisionMakers?.length > 0) {
            const dm = orgData.decisionMakers[0];
            return {
                name: dm.name,
                title: dm.title || 'Owner',
                source: 'theorg',
                confidence: 'medium',
                linkedIn: dm.linkedIn || null,
                recentHire: dm.recentHire || false,
                reportsTo: dm.reportsTo || null,
                orgChart: orgData
            };
        }
    } catch (e) {
        console.warn(`[DecisionMaker] theOrg lookup failed for ${leadName}:`, e.message);
    }

    return null;
}

/**
 * Extract a LinkedIn profile URL from search results
 */
function extractLinkedInURL(results) {
    if (!results || !Array.isArray(results)) return null;
    for (const r of results) {
        const url = r.link || r.url || '';
        const match = url.match(/https:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-]+/);
        if (match) return match[0];
    }
    return null;
}

/**
 * Find LinkedIn URL for a business owner/decision maker
 * @param {string} ownerName - Person's name
 * @param {string} businessName - Business name for context
 * @param {string} city - City for disambiguation
 * @returns {Object|null} { url, confidence: 'high'|'medium' }
 */
async function findLinkedInURL(ownerName, businessName, city) {
    if (!ownerName || !SERPER_API_KEY) return null;
    try {
        // Query 1: name + business + linkedin (high confidence)
        const r1 = await serperQuickSearch(`site:linkedin.com/in "${ownerName}" "${businessName}"`, 3);
        const url1 = extractLinkedInURL(r1);
        if (url1) return { url: url1, confidence: 'high' };

        // Query 2: name + city + owner (medium confidence)
        const r2 = await serperQuickSearch(`site:linkedin.com/in "${ownerName}" ${city} owner`, 3);
        const url2 = extractLinkedInURL(r2);
        if (url2) return { url: url2, confidence: 'medium' };

        return null;
    } catch (e) {
        console.warn(`[LinkedIn] Search failed for ${ownerName}:`, e.message);
        return null;
    }
}

/**
 * Extract a founding year from search result text
 */
function extractFoundedYear(results) {
    if (!results || results.length === 0) return null;
    const text = results.map(r => `${r.title || ''} ${r.snippet || ''}`).join(' ');
    const matches = text.match(/(?:founded|established|since|opened|est\.?)\s*(?:in\s*)?(\d{4})/i);
    if (!matches) return null;
    const year = parseInt(matches[1]);
    return (year >= 1970 && year <= new Date().getFullYear()) ? year : null;
}

/**
 * Find how long a business has been operating
 * @param {string} leadName - Business name
 * @param {string} city - City
 * @param {string} state - State
 * @returns {Object|null} { years, foundedYear, source }
 */
async function findTimeInBusiness(leadName, city, state) {
    if (!leadName || !SERPER_API_KEY) return null;
    try {
        const query = `"${leadName}" ${city} ${state} founded OR established OR "since"`;
        const results = await serperQuickSearch(query, 3);
        const year = extractFoundedYear(results);
        if (year) {
            return { years: new Date().getFullYear() - year, foundedYear: year, source: 'search' };
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Classify review velocity relative to years in business
 * @param {number} reviewCount - Total review count
 * @param {number} yearsInBusiness - How many years open
 * @returns {Object|null} { label, color, signal }
 */
function classifyVelocity(reviewCount, yearsInBusiness) {
    if (!yearsInBusiness || yearsInBusiness <= 0) return null;
    const perYear = reviewCount / yearsInBusiness;
    if (perYear >= 30) return { label: 'High velocity', color: '#059669', signal: 'Strong review growth trajectory.' };
    if (perYear >= 10) return { label: 'Moderate', color: '#0d9488', signal: 'Steady review accumulation.' };
    if (perYear >= 5) return { label: 'Low velocity', color: '#d97706', signal: `${Math.round(perYear)} reviews/year \u2014 below market pace.` };
    return { label: 'Stalled', color: '#dc2626', signal: `${yearsInBusiness} years open, only ${reviewCount} reviews \u2014 review engine has stalled.` };
}

module.exports = { enrichDecisionMaker, findLinkedInURL, findTimeInBusiness, classifyVelocity };
