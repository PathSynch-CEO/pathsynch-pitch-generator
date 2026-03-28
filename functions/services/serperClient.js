/**
 * Serper API Client
 *
 * Provides web search, news search, and places search via Serper.dev
 * Used by Market Intel 2.0 for competitor discovery, news signals, and lead scoring.
 *
 * Env: SERPER_API_KEY (required)
 */

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE = 'https://google.serper.dev';

/**
 * Core Serper search — all search types route through here
 */
async function serperSearch(query, type = 'search', options = {}) {
    if (!SERPER_API_KEY) {
        console.warn('[Serper] SERPER_API_KEY not configured — skipping');
        return null;
    }

    const response = await fetch(`${SERPER_BASE}/${type}`, {
        method: 'POST',
        headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            q: query,
            num: options.num || 10,
            gl: options.country || 'us',
            hl: options.language || 'en',
            ...options
        })
    });

    if (!response.ok) {
        throw new Error(`Serper ${type} failed: ${response.status}`);
    }
    return response.json();
}

/**
 * Search for business news and signals
 */
async function searchBusinessNews(businessName, city, industry) {
    try {
        const query = `${businessName || ''} ${city} ${industry} news 2025 2026`.trim();
        const data = await serperSearch(query, 'news', { num: 5 });
        if (!data) return [];

        return (data.news || []).map(item => ({
            title: item.title,
            snippet: item.snippet,
            date: item.date,
            source: item.source,
            url: item.link
        }));
    } catch (e) {
        console.warn('[Serper] News search failed:', e.message);
        return [];
    }
}

/**
 * Search for owner/contact info
 */
async function searchOwnerInfo(businessName, city) {
    try {
        const query = `"${businessName}" ${city} owner founder CEO contact`;
        const data = await serperSearch(query, 'search', { num: 5 });
        if (!data) return { ownerName: null, source: null };

        const results = data.organic || [];
        const ownerPattern = /(?:owner|founder|ceo|president|operated by)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i;
        for (const r of results) {
            const match = (r.snippet || '').match(ownerPattern);
            if (match) return { ownerName: match[1], source: r.link };
        }
        return { ownerName: null, source: null };
    } catch (e) {
        console.warn('[Serper] Owner search failed:', e.message);
        return { ownerName: null, source: null };
    }
}

/**
 * Search for industry competitors in a city via Serper Places
 */
async function searchCompetitors(industry, city, limit = 20) {
    try {
        const query = `best ${industry} in ${city}`;
        const data = await serperSearch(query, 'places', { num: limit });
        if (!data) return [];

        return (data.places || []).map(place => ({
            name: place.title,
            address: place.address,
            rating: place.rating,
            reviewCount: place.ratingCount,
            phone: place.phoneNumber,
            website: place.website,
            category: place.category
        }));
    } catch (e) {
        console.warn('[Serper] Places search failed:', e.message);
        return [];
    }
}

/**
 * Generate a pitch hook for a specific business
 */
function generatePitchHook(business, topCompetitor) {
    const ratingGap = topCompetitor?.rating && business.rating
        ? (topCompetitor.rating - business.rating).toFixed(1)
        : null;

    if (ratingGap && parseFloat(ratingGap) > 0) {
        return `With ${business.reviewCount || 0} reviews but only ` +
            `${business.rating}\u2605, ${business.name} is ${ratingGap} ` +
            `stars behind ${topCompetitor.name} \u2014 a gap PathSynch closes.`;
    }
    return `${business.name} has ${business.reviewCount || 0} reviews ` +
        `\u2014 PathSynch can help accelerate their review velocity.`;
}

/**
 * Score a business by opportunity (lower rating + more reviews = more opportunity)
 */
function calculateLeadOpportunityScore(business) {
    let score = 50;

    if (business.rating) {
        if (business.rating < 3.5) score += 30;
        else if (business.rating < 4.0) score += 20;
        else if (business.rating < 4.3) score += 10;
        else score -= 10;
    }

    if (business.reviewCount > 500) score += 15;
    else if (business.reviewCount > 100) score += 10;
    else if (business.reviewCount > 50) score += 5;
    else if (business.reviewCount < 10) score -= 10;

    if (business.website) score += 5;

    return Math.min(100, Math.max(0, score));
}

/**
 * Build scored and ranked leads from competitor data
 */
function buildLeads(competitors, industry, city) {
    const topCompetitor = competitors.find(c => c.rating && c.rating >= 4.5)
        || competitors[0];

    const leads = competitors.slice(0, 20).map((biz, index) => {
        const opportunityScore = calculateLeadOpportunityScore(biz);
        const pitchHook = generatePitchHook(biz, topCompetitor);

        return {
            rank: index + 1,
            name: biz.name,
            address: biz.address || '',
            rating: biz.rating || null,
            reviewCount: biz.reviewCount || 0,
            phone: biz.phone || null,
            website: biz.website || null,
            opportunityScore,
            pitchHook,
            industry,
            city
        };
    });

    // Sort by opportunity score descending, re-rank
    leads.sort((a, b) => b.opportunityScore - a.opportunityScore);
    leads.forEach((lead, i) => { lead.rank = i + 1; });

    return leads;
}

module.exports = {
    serperSearch,
    searchBusinessNews,
    searchOwnerInfo,
    searchCompetitors,
    generatePitchHook,
    calculateLeadOpportunityScore,
    buildLeads
};
