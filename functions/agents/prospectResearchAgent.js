/**
 * Deep Prospect Research Agent
 *
 * Model: gemini-2.0-flash via agentRunner.js
 * Pattern: Vertex AI Agent Garden "Deep Search" blueprint
 * Architecture: Plan → Execute → Synthesize
 *
 * Takes a local business and produces structured intelligence
 * a salesperson needs to pitch them on PathSynch products.
 *
 * Tools:
 *   1. google_places_lookup — Business profile + ratings + reviews
 *   2. competitor_scan — Top 5 competitors within 3 miles
 *   3. website_scrape — Owner name, social links, announcements
 *   4. news_search — Google News + Custom Search for trigger events
 *   5. gbp_completeness_check — GBP score 0-100
 */

const { runAgentAndParseJson } = require('../services/agentRunner');
const googlePlaces = require('../services/googlePlaces');
const { websiteScrape } = require('../services/tools/websiteScrape');
const { googleSearch } = require('../services/tools/googleSearch');
const { Client } = require('@googlemaps/google-maps-services-js');
const axios = require('axios');

const mapsClient = new Client({});

// ============================================================
// SYSTEM PROMPT
// ============================================================

const PROSPECT_RESEARCH_SYSTEM_PROMPT = `You are a Prospect Research Agent for SynchIntro, a sales intelligence platform for local businesses. Your job is to research a specific local business and produce intelligence a salesperson needs to pitch them on PathSynch products.

You have access to these tools:
- google_places_lookup: Find the business, get ratings, review count, address, phone, hours, photos count, price level
- competitor_scan: Find top 5 competitors within 3 miles, get their ratings and review counts
- website_scrape: Scrape the business website for owner name, social links, recent announcements, contact info
- news_search: Search Google News for recent mentions of the business, owner, or industry trends in their city
- gbp_completeness_check: Score GBP completeness 0-100 based on: photos (max 20pts), hours set (10pts), description (10pts), categories (10pts), website linked (10pts), Q&A present (10pts), services listed (10pts), attributes (10pts), posts in last 30 days (10pts)

RESEARCH STRATEGY:
1. google_places_lookup → get base business data
2. competitor_scan → understand their competitive position
3. website_scrape → find decision-maker signals
4. news_search → find trigger events and recent activity
5. gbp_completeness_check → score their online presence gap

OUTPUT FORMAT (JSON):
{
  "businessProfile": {
    "name": "string",
    "rating": "number",
    "reviewCount": "number",
    "address": "string",
    "priceLevel": "string",
    "photosCount": "number",
    "website": "string",
    "phone": "string"
  },
  "competitivePosition": {
    "competitorCount": "number",
    "avgCompetitorRating": "number",
    "ratingGap": "number",
    "topCompetitor": { "name": "string", "rating": "number", "reviewCount": "number" },
    "lowestCompetitor": { "name": "string", "rating": "number", "reviewCount": "number" }
  },
  "ownerIntelligence": {
    "decisionMakerName": "string or null",
    "recentActivity": "string",
    "socialPresence": "string",
    "triggerEvent": "string or null"
  },
  "gbpScore": {
    "total": "number 0-100",
    "breakdown": {},
    "topGap": "string",
    "estimatedRankingLift": "string"
  },
  "pitchHooks": [
    "string — data-backed reason 1",
    "string — data-backed reason 2",
    "string — data-backed reason 3"
  ],
  "recommendedProduct": "string",
  "urgencySignal": "string"
}

RULES:
- Always call google_places_lookup first to get base data
- Use competitor_scan to find competitive gaps
- Be specific with numbers in pitchHooks — use actual ratings, review counts, competitor names
- NEVER fabricate data. If a tool returns nothing, say "not available"
- recommendedProduct should be one of: PathConnect, LocalSynch, Forms, QRSynch, SynchMate, PathManager
- Return ONLY valid JSON. No markdown, no explanation.`;

// ============================================================
// TOOL DEFINITIONS (Gemini function declarations)
// ============================================================

const TOOL_DEFINITIONS = [
    {
        name: 'google_places_lookup',
        description: 'Find a business in Google Places and get its profile: rating, review count, address, phone, website, hours, photos count, price level. Always call this first.',
        parameters: {
            type: 'object',
            properties: {
                businessName: {
                    type: 'string',
                    description: 'The business name to search for',
                },
                city: {
                    type: 'string',
                    description: 'City where the business is located',
                },
                state: {
                    type: 'string',
                    description: 'State abbreviation (e.g., "WA", "CA")',
                },
            },
            required: ['businessName'],
        },
    },
    {
        name: 'competitor_scan',
        description: 'Find top competitors near the business location. Returns up to 5 competitors with their ratings and review counts, sorted by rating descending.',
        parameters: {
            type: 'object',
            properties: {
                latitude: {
                    type: 'number',
                    description: 'Latitude of the business location (from google_places_lookup)',
                },
                longitude: {
                    type: 'number',
                    description: 'Longitude of the business location (from google_places_lookup)',
                },
                industry: {
                    type: 'string',
                    description: 'Industry/type for competitor search (e.g., "restaurant", "salon", "plumber")',
                },
                radiusMeters: {
                    type: 'number',
                    description: 'Search radius in meters (default: 4828 = 3 miles)',
                },
            },
            required: ['latitude', 'longitude', 'industry'],
        },
    },
    {
        name: 'website_scrape',
        description: "Scrape the business website homepage for owner name, social media links, recent announcements, contact info, and meta description. Returns raw text truncated to 2000 chars.",
        parameters: {
            type: 'object',
            properties: {
                websiteUrl: {
                    type: 'string',
                    description: 'The business website URL',
                },
            },
            required: ['websiteUrl'],
        },
    },
    {
        name: 'news_search',
        description: 'Search Google for recent news about the business, owner, or industry trends in their city. Returns top 3 results with title, snippet, and URL.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query, e.g., "Joe\'s Pizza Seattle" or "restaurant industry Seattle news"',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'gbp_completeness_check',
        description: 'Score Google Business Profile completeness 0-100. Requires the placeId from google_places_lookup. Checks photos, hours, description, categories, website, Q&A, services, attributes, posts.',
        parameters: {
            type: 'object',
            properties: {
                placeId: {
                    type: 'string',
                    description: 'Google Places ID (from google_places_lookup result)',
                },
            },
            required: ['placeId'],
        },
    },
];

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

/**
 * google_places_lookup — Find business and get profile data
 */
async function googlePlacesLookup({ businessName, city, state }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return { error: 'Google Places API not configured' };

    const query = [businessName, city, state].filter(Boolean).join(' ');
    console.log(`[ProspectAgent] Places lookup: "${query}"`);

    try {
        // Text Search to find the business
        const searchResponse = await mapsClient.textSearch({
            params: { query, key: apiKey },
        });

        if (!searchResponse.data.results?.length) {
            return { error: 'Business not found', query };
        }

        const place = searchResponse.data.results[0];

        // Get detailed info
        const detailsResponse = await mapsClient.placeDetails({
            params: {
                place_id: place.place_id,
                fields: [
                    'name', 'formatted_address', 'formatted_phone_number',
                    'website', 'rating', 'user_ratings_total', 'reviews',
                    'opening_hours', 'price_level', 'types', 'photos',
                    'url', 'business_status',
                ],
                key: apiKey,
            },
        });

        const d = detailsResponse.data.result;

        return {
            name: d.name,
            rating: d.rating || null,
            reviewCount: d.user_ratings_total || 0,
            address: d.formatted_address,
            phone: d.formatted_phone_number || null,
            website: d.website || null,
            priceLevel: d.price_level != null ? '$'.repeat(d.price_level) : null,
            photosCount: d.photos?.length || 0,
            types: d.types || [],
            openingHours: d.opening_hours?.weekday_text || null,
            hoursSet: !!d.opening_hours,
            businessStatus: d.business_status,
            placeId: place.place_id,
            location: place.geometry?.location || null,
            topReviews: (d.reviews || []).slice(0, 3).map(r => ({
                rating: r.rating,
                text: (r.text || '').substring(0, 200),
            })),
        };
    } catch (error) {
        console.error('[ProspectAgent] Places lookup failed:', error.message);
        return { error: error.message };
    }
}

/**
 * competitor_scan — Find nearby competitors
 */
async function competitorScan({ latitude, longitude, industry, radiusMeters }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return { error: 'Google Places API not configured' };

    const radius = radiusMeters || 4828; // 3 miles
    console.log(`[ProspectAgent] Competitor scan: ${industry} at ${latitude},${longitude} r=${radius}m`);

    try {
        const response = await mapsClient.placesNearby({
            params: {
                location: { lat: latitude, lng: longitude },
                radius,
                keyword: industry,
                key: apiKey,
            },
        });

        const competitors = (response.data.results || [])
            .slice(0, 5)
            .map(p => ({
                name: p.name,
                rating: p.rating || null,
                reviewCount: p.user_ratings_total || 0,
                address: p.vicinity,
                priceLevel: p.price_level != null ? '$'.repeat(p.price_level) : null,
            }))
            .sort((a, b) => (b.rating || 0) - (a.rating || 0));

        return {
            competitorCount: competitors.length,
            competitors,
            totalInArea: response.data.results?.length || 0,
        };
    } catch (error) {
        console.error('[ProspectAgent] Competitor scan failed:', error.message);
        return { error: error.message };
    }
}

/**
 * website_scrape — Scrape homepage for decision-maker signals
 */
async function websiteScrapeProxy({ websiteUrl }) {
    if (!websiteUrl) return { error: 'No website URL provided' };

    try {
        // Use the existing websiteScrape tool for structured extraction
        const result = await websiteScrape({ websiteUrl, pages: ['/', '/about', '/contact'] });

        // Also do a raw fetch for owner name extraction
        let rawText = '';
        try {
            let url = websiteUrl.replace(/\/$/, '');
            if (!url.startsWith('http')) url = 'https://' + url;

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html',
                },
                timeout: 8000,
                maxRedirects: 3,
                validateStatus: s => s < 400,
            });

            const html = response.data;

            // Extract social links
            const socialLinks = {};
            const fbMatch = html.match(/href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/i);
            const igMatch = html.match(/href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i);
            const liMatch = html.match(/href="(https?:\/\/(?:www\.)?linkedin\.com\/[^"]+)"/i);
            const twMatch = html.match(/href="(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"]+)"/i);
            if (fbMatch) socialLinks.facebook = fbMatch[1];
            if (igMatch) socialLinks.instagram = igMatch[1];
            if (liMatch) socialLinks.linkedin = liMatch[1];
            if (twMatch) socialLinks.twitter = twMatch[1];

            // Extract meta description
            const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
            const metaDesc = metaMatch ? metaMatch[1] : null;

            // Strip HTML to raw text (truncated)
            rawText = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 2000);

            return {
                websiteUrl,
                metaDescription: metaDesc,
                socialLinks,
                rawText,
                structuredData: result,
            };
        } catch (fetchError) {
            return {
                websiteUrl,
                error: fetchError.message,
                structuredData: result,
            };
        }
    } catch (error) {
        console.error('[ProspectAgent] Website scrape failed:', error.message);
        return { error: error.message };
    }
}

/**
 * news_search — Search Google for recent news
 */
async function newsSearch({ query }) {
    if (!query) return { error: 'No query provided' };

    // Gracefully skip if not configured
    if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_CX) {
        console.warn('[ProspectAgent] GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not configured — skipping news_search');
        return { results: [], note: 'Google Custom Search not configured' };
    }

    try {
        const result = await googleSearch({ query, maxResults: 3 });
        return {
            results: (result.results || []).map(r => ({
                title: r.title,
                snippet: r.snippet,
                url: r.url,
            })),
            totalResults: result.totalResults,
        };
    } catch (error) {
        console.error('[ProspectAgent] News search failed:', error.message);
        return { error: error.message, results: [] };
    }
}

/**
 * gbp_completeness_check — Score GBP profile 0-100
 */
async function gbpCompletenessCheck({ placeId }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return { error: 'Google Places API not configured' };

    try {
        const response = await mapsClient.placeDetails({
            params: {
                place_id: placeId,
                fields: [
                    'name', 'photos', 'opening_hours', 'editorial_summary',
                    'types', 'website', 'reviews', 'formatted_phone_number',
                    'url', 'business_status',
                ],
                key: apiKey,
            },
        });

        const d = response.data.result;

        // Scoring rubric
        const breakdown = {
            photos: Math.min(20, (d.photos?.length || 0) * 2),          // max 20pts, 2pts per photo up to 10
            hoursSet: d.opening_hours ? 10 : 0,                          // 10pts
            description: d.editorial_summary ? 10 : 0,                   // 10pts
            categories: (d.types?.length || 0) >= 2 ? 10 : (d.types?.length === 1 ? 5 : 0), // 10pts
            websiteLinked: d.website ? 10 : 0,                           // 10pts
            qaPresent: (d.reviews?.length || 0) >= 3 ? 10 : (d.reviews?.length >= 1 ? 5 : 0), // proxy for Q&A
            servicesListed: (d.types?.length || 0) >= 3 ? 10 : 5,       // proxy
            attributes: d.formatted_phone_number ? 10 : 0,               // proxy for attributes
            recentPosts: 0, // Can't determine from Places API, default 0
        };

        const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

        // Find top gap
        const gaps = Object.entries(breakdown)
            .filter(([, v]) => v < 10)
            .sort((a, b) => a[1] - b[1]);
        const topGap = gaps.length > 0
            ? gaps[0][0].replace(/([A-Z])/g, ' $1').trim()
            : 'none';

        // Estimate ranking lift
        const missingPoints = 100 - total;
        const estimatedLift = missingPoints > 30
            ? `estimated ${Math.round(missingPoints * 0.5)}% more search visibility if gaps are closed`
            : missingPoints > 10
                ? `estimated ${Math.round(missingPoints * 0.4)}% more search visibility with improvements`
                : 'profile is well-optimized';

        return {
            total,
            breakdown,
            topGap,
            estimatedRankingLift: estimatedLift,
        };
    } catch (error) {
        console.error('[ProspectAgent] GBP check failed:', error.message);
        return { error: error.message, total: 0 };
    }
}

// Tool implementations map
const TOOL_IMPLEMENTATIONS = {
    google_places_lookup: googlePlacesLookup,
    competitor_scan: competitorScan,
    website_scrape: websiteScrapeProxy,
    news_search: newsSearch,
    gbp_completeness_check: gbpCompletenessCheck,
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Run the Deep Prospect Research Agent
 *
 * @param {Object} params
 * @param {string} params.businessName - Business name (required)
 * @param {string} params.city - City (optional)
 * @param {string} params.state - State abbreviation (optional)
 * @param {string} params.industry - Industry (optional)
 * @param {string} params.icpType - ICP type context (optional)
 * @returns {Promise<Object>} Structured prospect intelligence
 */
async function research(params) {
    const { businessName, city, state, industry, icpType } = params;

    if (!businessName) {
        return { success: false, error: 'businessName is required' };
    }

    const userMessage = `Research this local business for a sales pitch:

BUSINESS: ${businessName}
${city ? `CITY: ${city}` : ''}
${state ? `STATE: ${state}` : ''}
${industry ? `INDUSTRY: ${industry}` : ''}
${icpType ? `ICP TYPE: ${icpType}` : ''}

Execute the full 5-step research strategy:
1. google_places_lookup to get base data
2. competitor_scan with the location from step 1
3. website_scrape if a website was found
4. news_search for trigger events
5. gbp_completeness_check with the placeId from step 1

Then synthesize everything into the JSON output format.`;

    console.log(`[ProspectResearchAgent] Starting research for ${businessName}`);

    try {
        const result = await runAgentAndParseJson(
            PROSPECT_RESEARCH_SYSTEM_PROMPT,
            userMessage,
            TOOL_DEFINITIONS,
            TOOL_IMPLEMENTATIONS,
            { maxIterations: 6, verbose: true }
        );

        if (result.success && result.parsed) {
            console.log(`[ProspectResearchAgent] Research complete for ${businessName}`);
            return {
                success: true,
                ...result.parsed,
                _meta: {
                    toolCalls: result.toolCalls?.length || 0,
                    iterations: result.iterations,
                    elapsed: result.elapsed,
                },
            };
        }

        console.warn('[ProspectResearchAgent] No structured response, returning raw');
        return {
            success: false,
            raw: result.response,
            businessProfile: null,
        };
    } catch (error) {
        console.error('[ProspectResearchAgent] Failed:', error.message);
        return {
            success: false,
            error: error.message,
            businessProfile: null,
        };
    }
}

module.exports = {
    research,
    PROSPECT_RESEARCH_SYSTEM_PROMPT,
    TOOL_DEFINITIONS,
};
