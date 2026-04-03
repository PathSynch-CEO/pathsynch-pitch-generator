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
 * Canonical functional departments and their alias variants.
 * Airlines, logistics companies, and enterprises use wildly different
 * naming conventions for the same function — this normalizes them.
 */
const DEPARTMENT_ALIASES = {
    operations: [
        'operations', 'ops', 'fleet operations', 'ground operations',
        'network operations', 'operational excellence', 'service delivery',
        'supply chain', 'logistics', 'fulfillment', 'distribution'
    ],
    finance: [
        'finance', 'accounting', 'treasury', 'financial planning',
        'fp&a', 'controller', 'comptroller', 'fiscal', 'budget'
    ],
    technology: [
        'technology', 'it', 'information technology', 'engineering',
        'digital', 'innovation', 'cto', 'cio', 'tech ops', 'infrastructure',
        'information systems', 'mis'
    ],
    procurement: [
        'procurement', 'purchasing', 'sourcing', 'vendor management',
        'supply management', 'strategic sourcing', 'contracts', 'acquisitions'
    ],
    marketing: [
        'marketing', 'brand', 'communications', 'digital marketing',
        'growth', 'demand generation', 'customer acquisition', 'cmo'
    ],
    sales: [
        'sales', 'business development', 'revenue', 'commercial',
        'partnerships', 'channel', 'account management', 'cro'
    ],
    hr: [
        'human resources', 'hr', 'people', 'people operations',
        'talent', 'workforce', 'employee experience', 'chro'
    ]
};

/**
 * Normalize a job title string to one of the canonical department keys,
 * or return null if no alias matches.
 * @param {string} title
 * @returns {string|null}
 */
function matchDepartment(title) {
    if (!title) return null;
    const lower = title.toLowerCase();
    for (const [dept, aliases] of Object.entries(DEPARTMENT_ALIASES)) {
        if (aliases.some(alias => lower.includes(alias.toLowerCase()))) {
            return dept;
        }
    }
    return null;
}

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
 * Extract a person name + title from search result snippets via Gemini.
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
 * Extract a buyer/budget-holder name + title from search results, with
 * functional department normalization. Instead of matching exact title
 * strings, Gemini maps the person to one of the canonical functional areas.
 * @param {Array} results - Serper organic results
 * @param {string} businessName
 * @returns {Object|null} { name, title, department } or null
 */
async function extractBuyer(results, businessName) {
    if (!results || results.length === 0) return null;
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 150,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const snippets = results.map(r => `${r.title || ''}: ${r.snippet || ''}`).join('\n');
        const prompt = `From these search results about "${businessName}", identify the most senior person whose role maps to one of these functional areas: operations, finance, technology, procurement.

Search results:
${snippets}

Return JSON only. No preamble. Format:
{"name": "First Last", "title": "their exact title", "department": "operations|finance|technology|procurement"}

If no such person is clearly identifiable, return: {"name": null, "title": null, "department": null}`;

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

    // Run both Gemini extractions in parallel — buyer uses functional-area extraction
    const [ownerExtracted, buyerExtracted] = await Promise.all([
        ownerResults.length
            ? extractPerson(ownerResults, businessName, 'owner, founder, or general manager')
            : Promise.resolve(null),
        buyerResults.length
            ? extractBuyer(buyerResults, businessName)
            : Promise.resolve(null)
    ]);

    if (ownerExtracted || buyerExtracted) {
        const buyerTitle = buyerExtracted?.title || null;
        // Use Gemini's returned department first; fall back to alias matching on the title
        const buyerDepartment = buyerExtracted?.department || matchDepartment(buyerTitle);
        return {
            name: ownerExtracted?.name || null,
            title: ownerExtracted?.title || null,
            buyer: buyerExtracted?.name || null,
            buyerTitle,
            buyerDepartment,
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
                        buyerDepartment: null,
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
            const orgBuyerTitle = buyer?.title || null;
            return {
                name: owner.name,
                title: owner.title || 'Owner',
                buyer: buyer?.name || null,
                buyerTitle: orgBuyerTitle,
                buyerDepartment: matchDepartment(orgBuyerTitle),
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

module.exports = { enrichDecisionMaker, matchDepartment };
