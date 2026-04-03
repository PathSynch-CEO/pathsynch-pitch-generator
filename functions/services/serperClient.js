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
 * Search for business news and signals — multi-query with categorization and date filtering
 */
async function searchBusinessNews(businessName, city, industry, state = '') {
    try {
        const geo = state ? `${city} ${state}` : city;

        // Query 1: Local business news for this market
        const localQuery = `${industry} business ${geo} 2025 2026 -weather -legislation -federal -congress -senate`;

        // Query 2: Consumer sentiment signals
        const sentimentQuery = `${geo} ${industry} customers reviews complaints 2025 2026`;

        const [localData, sentimentData] = await Promise.allSettled([
            serperSearch(localQuery, 'news', { num: 6 }),
            serperSearch(sentimentQuery, 'news', { num: 4 })
        ]);

        const localNews = localData.status === 'fulfilled'
            ? (localData.value?.news || []) : [];
        const sentimentNews = sentimentData.status === 'fulfilled'
            ? (sentimentData.value?.news || []) : [];

        // Filter: remove items older than 90 days
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        function parseSerperDate(dateStr) {
            if (!dateStr) return new Date();
            if (dateStr.includes('ago')) return new Date();
            return new Date(dateStr);
        }

        function isRecent(item) {
            const d = parseSerperDate(item.date);
            return d >= ninetyDaysAgo;
        }

        const mapItem = (n, category) => ({
            title: n.title,
            snippet: n.snippet,
            date: n.date,
            source: n.source,
            url: n.link,
            category
        });

        // Categorize news
        const categorized = {
            localBusiness: localNews.filter(isRecent).slice(0, 4).map(n => mapItem(n, 'Local Business')),
            consumerSignals: sentimentNews.filter(isRecent).slice(0, 3).map(n => mapItem(n, 'Consumer Signals')),
            industryTrends: []
        };

        // Query 3: Industry trends — include geographic terms to keep results relevant
        const trendsQuery = `${industry} industry trends market ${geo} 2025 2026`;
        try {
            const trendsData = await serperSearch(trendsQuery, 'news', { num: 5 });
            const skipWords = ['weather', 'hurricane', 'tornado', 'congress', 'senate',
                'election', 'federal', 'ICE', 'immigration', 'shooting', 'crime', 'arrest'];
            categorized.industryTrends = (trendsData?.news || [])
                .filter(isRecent)
                .filter(n => {
                    const text = ((n.title || '') + (n.snippet || '')).toLowerCase();
                    return !skipWords.some(s => text.includes(s.toLowerCase()));
                })
                .filter(n => isGeographicallyRelevant(n, city, state))
                .slice(0, 3)
                .map(n => mapItem(n, 'Industry Trends'));
        } catch (e) { /* non-critical */ }

        // Flatten with categories
        return [
            ...categorized.localBusiness,
            ...categorized.consumerSignals,
            ...categorized.industryTrends
        ];

    } catch (e) {
        console.warn('[Serper] News search failed:', e.message);
        return [];
    }
}

/**
 * Geographic relevance filter — checks if a news item mentions the target city/state
 */
function isGeographicallyRelevant(item, city, state) {
    if (!city) return true;
    const text = ((item.title || '') + ' ' + (item.snippet || '') + ' ' + (item.source || '')).toLowerCase();
    const cityLower = city.toLowerCase();
    const stateLower = (state || '').toLowerCase();
    // Accept if city name, state name, or state abbreviation appears
    if (text.includes(cityLower)) return true;
    if (stateLower && text.includes(stateLower)) return true;
    // Accept industry-wide articles that don't mention a different city
    const otherCities = ['new york', 'los angeles', 'chicago', 'houston', 'phoenix',
        'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
        'columbus', 'charlotte', 'indianapolis', 'san francisco', 'seattle', 'denver',
        'washington', 'nashville', 'oklahoma city', 'boston', 'portland', 'las vegas',
        'memphis', 'louisville', 'baltimore', 'milwaukee', 'albuquerque', 'tucson',
        'fresno', 'sacramento', 'mesa', 'atlanta', 'omaha', 'raleigh', 'miami',
        'cleveland', 'tampa', 'minneapolis', 'pittsburgh', 'st. louis', 'detroit'];
    const filteredCities = otherCities.filter(c => c !== cityLower);
    const mentionsOtherCity = filteredCities.some(c => text.includes(c));
    // If it doesn't mention any specific city, it's likely a general industry article — keep it
    return !mentionsOtherCity;
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

/**
 * Search for fastest growing communities/neighborhoods near a city
 */
async function searchFastestGrowingCommunities(city, state, industry) {
    try {
        const queries = [
            `${city} ${state} fastest growing neighborhoods suburbs 2024 2025`,
            `${city} ${state} population growth zip code 2024 2025`,
            `${city} ${state} ${industry} demand growth emerging areas`
        ];

        const results = await Promise.allSettled(
            queries.map(q => serperSearch(q, 'search', { num: 5 }))
        );

        const communities = new Map();

        results.forEach(r => {
            if (r.status !== 'fulfilled') return;
            const organic = r.value?.organic || [];
            organic.forEach(item => {
                const text = item.title + ' ' + item.snippet;
                const matches = text.match(/\b([A-Z][a-z]+ ?(?:[A-Z][a-z]+)?)\b/g) || [];
                matches.forEach(m => {
                    const name = m.trim();
                    if (name.length > 3 && name.length < 30 &&
                        !['The', 'This', 'That', 'These', 'According', city].includes(name)) {
                        communities.set(name, (communities.get(name) || 0) + 1);
                    }
                });
            });
        });

        const topCommunities = Array.from(communities.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8)
            .map(([name, mentions]) => ({ name, mentions }));

        const growthSignals = await Promise.allSettled(
            topCommunities.slice(0, 3).map(async c => {
                const q = `${c.name} ${state} population growth development 2024 2025`;
                const data = await serperSearch(q, 'search', { num: 3 });
                const snippet = data?.organic?.[0]?.snippet || '';
                return {
                    ...c,
                    signal: snippet.substring(0, 150)
                };
            })
        );

        return {
            topCommunities: topCommunities.slice(0, 5),
            growthSignals: growthSignals
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value),
            searchedAt: new Date().toISOString()
        };
    } catch (e) {
        console.warn('[Serper] Demographics failed:', e.message);
        return null;
    }
}

/**
 * Search for area income data
 */
async function searchAreaIncome(city, state) {
    try {
        const q = `${city} ${state} median household income zip code 2023 2024 census`;
        const data = await serperSearch(q, 'search', { num: 5 });
        return (data?.organic || []).slice(0, 3).map(r => ({
            title: r.title,
            snippet: r.snippet,
            source: r.link
        }));
    } catch (e) {
        return [];
    }
}

/**
 * Enrich a lead with owner/founder information
 */
async function enrichLeadOwner(businessName, city) {
    try {
        const queries = [
            `"${businessName}" ${city} owner`,
            `"${businessName}" ${city} founder operator`,
            `site:linkedin.com "${businessName}" ${city}`
        ];

        let ownerName = null;
        let linkedInUrl = null;
        let ownerTitle = null;

        for (const query of queries) {
            try {
                const data = await serperSearch(query, 'search', { num: 3 });
                const results = data?.organic || [];

                for (const r of results) {
                    const text = r.title + ' ' + r.snippet;

                    if (r.link?.includes('linkedin.com/in/') && !linkedInUrl) {
                        linkedInUrl = r.link;
                    }

                    const patterns = [
                        /(?:owner|founder|ceo|president|operator|proprietor)[,:]?\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
                        /([A-Z][a-z]+ [A-Z][a-z]+),?\s+(?:owner|founder|ceo|president)/i,
                        /owned by ([A-Z][a-z]+ [A-Z][a-z]+)/i
                    ];

                    for (const pattern of patterns) {
                        const match = text.match(pattern);
                        if (match && !ownerName) {
                            ownerName = match[1].trim();
                            ownerTitle = text.match(/owner|founder|ceo|president|operator/i)?.[0] || 'Owner';
                            break;
                        }
                    }

                    if (ownerName && linkedInUrl) break;
                }

                if (ownerName) break;
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                continue;
            }
        }

        return { ownerName, ownerTitle, linkedInUrl };
    } catch (e) {
        console.warn('[Serper] Owner enrichment failed:', businessName, e.message);
        return { ownerName: null, ownerTitle: null, linkedInUrl: null };
    }
}

/**
 * Search for market trends and signals across multiple dimensions
 */
async function searchMarketTrends(city, state, industry) {
    try {
        const searches = await Promise.allSettled([
            serperSearch(`${industry} ${city} ${state} demand growing 2024 2025`, 'search', { num: 4 }),
            serperSearch(`new ${industry} business opening ${city} ${state} 2025 2026`, 'news', { num: 5 }),
            serperSearch(`${industry} business closing ${city} ${state} 2025`, 'news', { num: 3 }),
            serperSearch(`${industry} hiring jobs ${city} ${state}`, 'search', { num: 3 }),
            serperSearch(`when is ${industry} busiest season ${city} ${state}`, 'search', { num: 3 })
        ]);

        function extractSignals(result, type) {
            if (result.status !== 'fulfilled') return [];
            const items = result.value?.organic || result.value?.news || [];
            return items.slice(0, 3).map(item => ({
                type,
                title: item.title,
                snippet: (item.snippet || '').substring(0, 200),
                source: item.link,
                date: item.date || null
            }));
        }

        return {
            demandTrend: extractSignals(searches[0], 'demand'),
            newOpenings: extractSignals(searches[1], 'opening'),
            closings: extractSignals(searches[2], 'closing'),
            hiringSignals: extractSignals(searches[3], 'hiring'),
            seasonalPatterns: extractSignals(searches[4], 'seasonal')
        };
    } catch (e) {
        console.warn('[Serper] Trends failed:', e.message);
        return null;
    }
}

/**
 * Fetch Google reviews for a business via Serper reviews search
 * Returns formatted review text for pasting into the reviews textarea
 */
async function fetchGoogleReviews(businessName, city = '') {
    try {
        const query = `${businessName} ${city}`.trim();
        // Use Serper places search to find the business and get reviews
        const placesResult = await serperSearch(query, 'places', { num: 1 });
        const place = placesResult?.places?.[0];
        if (!place) return { reviews: null, rating: null, count: 0 };

        // Also search for review text snippets via web search
        const reviewQuery = `"${businessName}" ${city} reviews`;
        const webResult = await serperSearch(reviewQuery, 'search', { num: 5 });

        const snippets = [];
        if (place.rating) snippets.push(`Overall Rating: ${place.rating}/5 (${place.reviews || 0} reviews)`);

        // Extract review-like snippets from organic results
        const organics = webResult?.organic || [];
        for (const result of organics.slice(0, 5)) {
            const snippet = result.snippet || '';
            if (snippet.length > 30) {
                snippets.push(snippet);
            }
        }

        // Also grab knowledge graph reviews if available
        const kg = webResult?.knowledgeGraph;
        if (kg?.description) snippets.push(kg.description);

        return {
            reviews: snippets.length > 1 ? snippets.join('\n\n') : null,
            rating: place.rating || null,
            count: place.reviews || 0
        };
    } catch (e) {
        console.warn('[Serper] fetchGoogleReviews failed:', e.message);
        return { reviews: null, rating: null, count: 0 };
    }
}

/**
 * Get website traffic tier for a lead based on indexed pages + brand mentions
 * @param {Object} lead - Lead object with .website and .name
 * @returns {Object} { tier, label, signal, indexedPages, brandMentions }
 */
async function getWebsiteTrafficTier(lead) {
    if (!lead.website) return { tier: 'no_website', label: 'No website', signal: true, indexedPages: 0, brandMentions: 0 };

    try {
        let domain;
        try {
            domain = new URL(lead.website.startsWith('http') ? lead.website : `https://${lead.website}`).hostname.replace('www.', '');
        } catch { return { tier: 'unknown', label: 'Invalid URL', signal: false, indexedPages: 0, brandMentions: 0 }; }

        // Check indexed pages
        const siteResults = await serperSearch(`site:${domain}`, 'search', { num: 1 });
        const indexedPages = parseInt(siteResults?.searchInformation?.totalResults || siteResults?.organic?.length || 0);

        // Check brand mentions beyond own site
        const brandResults = await serperSearch(`"${lead.name}" -site:${domain}`, 'search', { num: 5 });
        const brandMentions = brandResults?.organic?.length || 0;

        if (indexedPages === 0) return { tier: 'ghost', label: 'GBP-only', signal: true, indexedPages: 0, brandMentions };
        if (indexedPages <= 5) return { tier: 'minimal', label: 'Minimal web', signal: true, indexedPages, brandMentions };
        if (indexedPages <= 20) return { tier: 'low', label: 'Low traffic', signal: false, indexedPages, brandMentions };
        if (brandMentions >= 10) return { tier: 'strong', label: 'Strong web', signal: false, indexedPages, brandMentions };
        return { tier: 'moderate', label: 'Moderate web', signal: false, indexedPages, brandMentions };
    } catch (e) {
        console.warn(`[TrafficTier] Failed for ${lead.name}:`, e.message);
        return { tier: 'unknown', label: 'Unknown', signal: false, indexedPages: 0, brandMentions: 0 };
    }
}

module.exports = {
    serperSearch,
    searchBusinessNews,
    searchOwnerInfo,
    searchCompetitors,
    generatePitchHook,
    calculateLeadOpportunityScore,
    buildLeads,
    searchFastestGrowingCommunities,
    searchAreaIncome,
    enrichLeadOwner,
    searchMarketTrends,
    fetchGoogleReviews,
    getWebsiteTrafficTier
};
