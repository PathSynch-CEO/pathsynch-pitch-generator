/**
 * NewsData.io Search Tool
 *
 * Searches 85,000+ news sources. Free tier: 200 credits/day.
 * Commercial use allowed (unlike NewsAPI.org which is non-commercial only).
 * Already indexes NYT, Guardian, Reuters, Bloomberg — no need for
 * separate dedicated APIs for those outlets.
 */

const axios = require('axios');

/**
 * Search NewsData.io for recent news articles
 *
 * @param {Object} params
 * @param {string} params.query - Search query (2-5 words work best)
 * @param {string} params.country - Optional 2-letter country code (e.g., "us")
 * @param {string} params.category - Optional category filter
 * @param {string} params.timeframe - Optional time filter (e.g., "24h", "7d", "30d", "90d")
 * @returns {Promise<Object>} Search results
 */
async function newsdataSearch({ query, country, category, timeframe }) {
    const apiKey = process.env.NEWSDATA_API_KEY;
    if (!apiKey) {
        console.warn('[NewsData] API key not configured');
        return { error: 'NEWSDATA_API_KEY not configured', articles: [] };
    }

    try {
        const params = {
            apikey: apiKey,
            q: query,
            language: 'en',
        };
        if (country) params.country = country;
        if (category) params.category = category;
        if (timeframe) params.timeframe = timeframe;

        console.log(`[NewsData] Searching: "${query}" (country=${country || 'any'}, category=${category || 'any'})`);

        const response = await axios.get('https://newsdata.io/api/1/latest', {
            params,
            timeout: 10000,
        });

        const articles = (response.data.results || []).slice(0, 15).map(article => ({
            title: article.title,
            description: article.description?.substring(0, 300),
            source: article.source_name || article.source_id,
            url: article.link,
            publishedAt: article.pubDate,
            category: article.category?.[0],
            country: article.country?.[0],
            imageUrl: article.image_url,
            keywords: article.keywords?.slice(0, 5),
        }));

        console.log(`[NewsData] Found ${articles.length} articles for "${query}"`);

        return {
            totalResults: response.data.totalResults || articles.length,
            articles,
            creditsUsed: 1,
            query,
        };
    } catch (error) {
        console.error('[NewsData] Search failed:', error.message);

        // Handle specific error codes
        if (error.response?.status === 401) {
            return { error: 'Invalid API key', articles: [] };
        }
        if (error.response?.status === 429) {
            return { error: 'Rate limit exceeded (200 credits/day)', articles: [] };
        }

        return { error: error.message, articles: [] };
    }
}

module.exports = { newsdataSearch };
