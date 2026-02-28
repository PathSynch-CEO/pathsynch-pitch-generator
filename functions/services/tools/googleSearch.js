/**
 * Google Custom Search Tool
 *
 * Searches the public web via Google Custom Search JSON API.
 * Free: 100 queries/day. $5 per 1000 queries after that.
 *
 * Setup:
 * 1. https://programmablesearchengine.google.com/ → Create engine (search entire web)
 * 2. Cloud Console → APIs → Custom Search JSON API → Enable + get key
 * 3. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX in environment
 */

const axios = require('axios');

/**
 * Search the web via Google Custom Search
 *
 * @param {Object} params
 * @param {string} params.query - Search query
 * @param {number} params.maxResults - Max results (default: 10, max: 10 per request)
 * @returns {Promise<Object>} Search results
 */
async function googleSearch({ query, maxResults = 10 }) {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    if (!apiKey || !cx) {
        console.warn('[GoogleSearch] API key or CX not configured');
        return {
            error: 'Google Custom Search not configured. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX.',
            results: [],
        };
    }

    try {
        console.log(`[GoogleSearch] Searching: "${query}"`);

        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: apiKey,
                cx: cx,
                q: query,
                num: Math.min(maxResults, 10),
            },
            timeout: 10000,
        });

        const results = (response.data.items || []).map(item => ({
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            displayUrl: item.displayLink,
            // Extract additional metadata if available
            pagemap: {
                metatags: item.pagemap?.metatags?.[0],
                person: item.pagemap?.person?.[0],
                organization: item.pagemap?.organization?.[0],
            },
        }));

        console.log(`[GoogleSearch] Found ${results.length} results for "${query}"`);

        return {
            results,
            totalResults: response.data.searchInformation?.totalResults,
            searchTime: response.data.searchInformation?.searchTime,
            query,
        };
    } catch (error) {
        console.error('[GoogleSearch] Failed:', error.message);

        // Handle specific error codes
        if (error.response?.status === 403) {
            return { error: 'API quota exceeded or invalid key', results: [] };
        }
        if (error.response?.status === 400) {
            return { error: 'Invalid request parameters', results: [] };
        }

        return { error: error.message, results: [] };
    }
}

module.exports = { googleSearch };
