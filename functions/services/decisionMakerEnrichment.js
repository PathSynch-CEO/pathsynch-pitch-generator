/**
 * Decision Maker Enrichment (v2)
 *
 * Finds TWO decision-maker roles per business lead:
 *   1. Entry point contact — owner, founder, GM, operations manager
 *   2. Buyer / check writer — VP Operations, VP Finance, Procurement (businesses with 50+ reviews)
 *
 * Uses Serper search + Gemini extraction in parallel.
 * Designed for concurrent execution across up to 10 leads — total latency bounded by 3s timeout
 * applied in the market.js caller via Promise.race.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { serperSearch } = require('./serperClient');
const { getOrgChart } = require('./theOrgClient');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Lightweight Serper search — returns organic results array, never throws
 */
async function quickSearch(query, num = 3) {
    try {
        const data = await serperSearch(query, 'search', { num });
        return data?.organic || [];
    } catch { return []; }
}

/**
 * Extract a person name + title from search result snippets via Gemini
 * @param {Array} results - Serper organic results
 * @param {string} businessName
 * @param {string} roleHint - Description of the role to look for
 * @returns {Object|null} { name, title } or null
 */
async function extractPerson(results, businessName, roleHint) {
    if (!results || results.length === 0) return null;
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 100,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const snippets = results.map(r => `${r.title || ''}: ${r.snippet || ''}`).join('\n');
        const prompt = `Extract the ${roleHint} name from these search results about "${businessName}".

Search results:
${snippets}

Return JSON only. No preamble. Format:
{"name": "First Last", "title": "Owner|Founder|General Manager|VP Operations|VP Finance|Procurement Director"}

If no person name is clearly identifiable as ${roleHint}, return: {"name": null, "title": null}`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text();
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}') + 1;
        if (start === -1 || end <= start) return null;
        const parsed = JSON.parse(raw.substring(start, end));
        if (parsed.name && parsed.name !== 'null' && parsed.name !== 'null null') return parsed;
        return null;
    } catch { return null; }
}

/**
 * Enrich a lead with two decision-maker roles.
 *
 * @param {Object} lead          - { name, website, reviewCount }
 * @param {Object} location      - { city, state }
 * @returns {Object|null}
 *   { name, title, buyer, buyerTitle, source, confidence, linkedIn?, recentHire?, reportsTo?, orgChart? }
 */
async function enrichDecisionMaker(lead, location) {
    const { name: businessName, website, reviewCount = 0 } = lead;
    const { city = '', state = '' } = location || {};

    const needsBuyer = reviewCount >= 50;

    // ── Source 1: Direct Serper search ──────────────────────────────────────
    const ownerQuery = `"${businessName}" ${city} ${state} owner OR founder OR "general manager"`;
    const buyerQuery = needsBuyer
        ? `"${businessName}" ${city} "VP operations" OR "VP finance" OR director OR procurement`
        : null;

    // Run both Serper calls in parallel
    const [ownerResults, buyerResults] = await Promise.all([
        quickSearch(ownerQuery, 3),
        buyerQuery ? quickSearch(buyerQuery, 3) : Promise.resolve([])
    ]);

    // Run both Gemini extractions in parallel
    const [ownerExtracted, buyerExtracted] = await Promise.all([
        ownerResults.length
            ? extractPerson(ownerResults, businessName, 'owner, founder, or general manager')
            : Promise.resolve(null),
        buyerResults.length
            ? extractPerson(buyerResults, businessName, 'VP Operations, VP Finance, or Procurement decision maker')
            : Promise.resolve(null)
    ]);

    if (ownerExtracted || buyerExtracted) {
        return {
            name: ownerExtracted?.name || null,
            title: ownerExtracted?.title || null,
            buyer: buyerExtracted?.name || null,
            buyerTitle: buyerExtracted?.title || null,
            source: 'search',
            confidence: ownerExtracted ? 'high' : 'medium'
        };
    }

    // ── Source 2: Website about page ────────────────────────────────────────
    if (website) {
        try {
            const domain = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            const aboutResults = await quickSearch(`site:${domain} about team founder owner`, 2);
            if (aboutResults.length) {
                const extracted = await extractPerson(aboutResults, businessName, 'owner, founder, or key decision maker');
                if (extracted) {
                    return {
                        name: extracted.name,
                        title: extracted.title || 'Owner',
                        buyer: null,
                        buyerTitle: null,
                        source: 'website',
                        confidence: 'medium'
                    };
                }
            }
        } catch { /* non-critical */ }
    }

    // ── Source 3: TheOrg fallback ────────────────────────────────────────────
    try {
        const orgData = await getOrgChart(businessName, city);
        if (orgData?.decisionMakers?.length > 0) {
            const owner = orgData.decisionMakers[0];
            // Look for a separate buyer role in the org chart
            const buyer = orgData.decisionMakers.find(dm => {
                if (dm.name === owner.name) return false;
                const t = (dm.title || '').toLowerCase();
                return t.includes('vp') || t.includes('finance') ||
                       t.includes('procurement') || t.includes('operations') ||
                       t.includes('purchasing');
            });
            return {
                name: owner.name,
                title: owner.title || 'Owner',
                buyer: buyer?.name || null,
                buyerTitle: buyer?.title || null,
                source: 'theorg',
                confidence: 'medium',
                linkedIn: owner.linkedIn || null,
                recentHire: owner.recentHire || false,
                reportsTo: owner.reportsTo || null,
                orgChart: orgData
            };
        }
    } catch { /* non-critical */ }

    return null;
}

module.exports = { enrichDecisionMaker };
