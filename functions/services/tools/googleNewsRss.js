/**
 * Google News RSS Tool
 *
 * Searches Google News via RSS feed. Free, unlimited, no API key needed.
 * Especially strong for hyper-local coverage: BizJournals, local TV
 * stations, community newspapers, chamber of commerce announcements.
 */

const Parser = require('rss-parser');
const parser = new Parser({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});

/**
 * Extract source name from Google News RSS title
 * Google News titles often end with " - Source Name"
 */
function extractSourceFromTitle(title) {
    const match = title?.match(/ - ([^-]+)$/);
    return match ? match[1].trim() : 'Unknown';
}

/**
 * Search Google News RSS feed
 *
 * @param {Object} params
 * @param {string} params.query - Search query (company name + city works well for local)
 * @param {number} params.maxResults - Maximum articles to return (default: 10, max: 20)
 * @returns {Promise<Object>} Search results
 */
async function googleNewsRss({ query, maxResults = 10 }) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;

        console.log(`[GoogleNewsRSS] Searching: "${query}"`);

        const feed = await parser.parseURL(feedUrl);

        const articles = (feed.items || []).slice(0, Math.min(maxResults, 20)).map(item => {
            // Clean up the title (remove source suffix for cleaner display)
            const fullTitle = item.title || '';
            const source = extractSourceFromTitle(fullTitle);
            const cleanTitle = fullTitle.replace(/ - [^-]+$/, '').trim();

            return {
                title: cleanTitle,
                fullTitle: fullTitle,
                source: item.creator || source,
                url: item.link,
                publishedAt: item.pubDate || item.isoDate,
                snippet: item.contentSnippet?.substring(0, 200),
                guid: item.guid,
            };
        });

        console.log(`[GoogleNewsRSS] Found ${articles.length} articles for "${query}"`);

        return {
            articles,
            feedTitle: feed.title,
            query,
            totalResults: articles.length,
        };
    } catch (error) {
        console.error('[GoogleNewsRSS] Failed:', error.message);
        return { error: error.message, articles: [], query };
    }
}

module.exports = { googleNewsRss };
