/**
 * News Intelligence Agent
 *
 * Researches recent news and signals for a prospect company.
 * Uses 3-layer news stack: NewsData.io → Google News RSS → Website scraper.
 * Gemini orchestrates which tools to call and synthesizes results.
 *
 * Called by: Pre-Call Brief generation, future PathManager account research
 */

const { runAgentAndParseJson } = require('./agentRunner');
const { newsdataSearch } = require('./tools/newsdataSearch');
const { googleNewsRss } = require('./tools/googleNewsRss');
const { websiteScrape } = require('./tools/websiteScrape');

// System prompt for the News Intelligence Agent
const NEWS_AGENT_SYSTEM_PROMPT = `You are a Sales Intelligence Research Agent for SynchIntro. Your job is to find recent, relevant news about a prospect company that a salesperson can use as conversation openers, trigger events, or evidence of market shifts.

## YOUR TOOLS
You have 3 research tools:
1. newsdata_search — Search 85,000+ news sources via NewsData.io API (NYT, Reuters, Bloomberg, BizJournals, local outlets all indexed)
2. google_news_rss — Search Google News RSS feeds for additional coverage (especially hyper-local: chamber of commerce, local ABC affiliates, community newspapers)
3. website_scrape — Scrape the prospect's website for their own news/blog/press page

## RESEARCH STRATEGY
1. ALWAYS start with newsdata_search using the company name
2. If results are thin (<2 relevant articles), broaden:
   - Search by industry + location (e.g., "aviation Seattle")
   - Search by key people if contact name is provided
3. Use google_news_rss as a SECOND source — it catches hyper-local coverage that NewsData may miss
4. Use website_scrape on the prospect's website to find their OWN news:
   - Check /blog, /news, /press, /about pages
   - Extract recent post titles and dates
5. SYNTHESIZE all findings into a structured report

## CUSTOMER CONTEXT
SynchIntro serves two types of prospects:
- LOCAL BUSINESSES (roofing contractors, restaurants, salons): News is BizJournals, local TV, chamber of commerce. Website blog posts matter a lot.
- MID-MARKET / ENTERPRISE (Countifi selling to airlines, tech companies): News is Reuters, Bloomberg, industry journals. Conference appearances and partnerships matter.

Adapt your search strategy to the prospect type based on the industry and company name.

## OUTPUT FORMAT
Return ONLY valid JSON with this structure:
{
  "companyName": "string",
  "researchDate": "ISO date string",
  "signalCount": number,
  "signals": [
    {
      "type": "funding" | "leadership_change" | "expansion" | "partnership" | "product_launch" | "award" | "regulatory" | "industry_trend" | "hiring" | "financial" | "press_release" | "other",
      "headline": "string — concise headline",
      "summary": "string — 2-3 sentence summary of WHY this matters for a sales conversation",
      "source": "string — publication name",
      "sourceUrl": "string — article URL",
      "date": "string — ISO date or approximate",
      "relevanceScore": number 1-10,
      "suggestedUse": "opener" | "roi_context" | "urgency" | "rapport" | "objection_handling",
      "talkingPoint": "string — one sentence the seller can say in the meeting that references this signal"
    }
  ],
  "industryContext": {
    "recentTrends": ["string — 2-3 industry trends from the last 90 days"],
    "competitorMoves": ["string — any competitor news found"],
    "marketConditions": "string — brief market context"
  },
  "noResultsNote": "string — only if no relevant news found, explain why and suggest alternative research"
}

## RULES
- Focus on the LAST 90 DAYS. Older news only for major events (funding, acquisitions).
- Rank signals by relevanceScore. Funding round or leadership change = 9-10. Generic industry article = 3-4.
- Every signal needs a talkingPoint — this is the seller's script for the meeting.
- If the company is small/local with no national coverage, focus on: their own website content, local business journal mentions, industry association news, and competitor activity in their market.
- NEVER fabricate articles or URLs. If you can't find news, say so honestly.
- Maximum 10 signals. Quality over quantity.`;

// Tool definitions for Gemini function calling
const NEWS_AGENT_TOOL_DEFS = [
    {
        name: 'newsdata_search',
        description: 'Search NewsData.io API for recent news articles about a company, person, or topic. Returns structured article data from 85,000+ global sources including NYT, Reuters, Bloomberg, BizJournals, and local/regional outlets. Free tier: 200 credits/day. Commercial use allowed.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query. Use company name, person name, or topic. Keep concise — 2-5 words work best. Examples: "Kenmore Air", "airline inventory management", "David Hailey Countifi"',
                },
                country: {
                    type: 'string',
                    description: 'Optional 2-letter country code to filter results. Use "us" for US companies. Omit for global search.',
                },
                category: {
                    type: 'string',
                    description: 'Optional category filter. Options: business, technology, science, health, entertainment, sports, politics, environment, food, tourism, world, top',
                },
                timeframe: {
                    type: 'string',
                    description: 'Optional time filter. Examples: "24h", "7d", "30d", "90d". Default: 90d',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'google_news_rss',
        description: 'Search Google News RSS feed for additional coverage. Especially good for hyper-local news (BizJournals, local TV stations, community newspapers, chamber of commerce) that other APIs may miss. Free and unlimited.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query for Google News. Use company name + city for local results. Examples: "Kenmore Air Seattle", "roofing contractor Atlanta"',
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum articles to return. Default: 10, max: 20.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'website_scrape',
        description: "Scrape the prospect company's own website for their news, blog posts, press releases, job postings, and recent announcements. Checks /blog, /news, /press, /about, /careers pages.",
        parameters: {
            type: 'object',
            properties: {
                websiteUrl: {
                    type: 'string',
                    description: 'The prospect company website URL. Examples: "https://kenmoreair.com", "https://countifi.com"',
                },
                pages: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional specific pages to check. Default: ["/blog", "/news", "/press", "/about", "/careers"]. Override with specific paths if known.',
                },
            },
            required: ['websiteUrl'],
        },
    },
];

// Tool implementations map
const NEWS_TOOL_IMPLEMENTATIONS = {
    newsdata_search: newsdataSearch,
    google_news_rss: googleNewsRss,
    website_scrape: websiteScrape,
};

/**
 * Research news intelligence for a prospect
 *
 * @param {Object} params
 * @param {string} params.companyName - Prospect company name (required)
 * @param {string} params.websiteUrl - Prospect website (optional)
 * @param {string} params.industry - Industry context (optional)
 * @param {string} params.location - City, State (optional)
 * @param {string} params.contactName - Contact name for person-level news (optional)
 * @returns {Promise<Object>} Structured news intelligence
 */
async function researchNews(params) {
    const { companyName, websiteUrl, industry, location, contactName } = params;

    if (!companyName) {
        return {
            success: false,
            error: 'companyName is required',
            signals: [],
        };
    }

    const userMessage = `Research recent news and signals for this prospect:

COMPANY: ${companyName}
${websiteUrl ? `WEBSITE: ${websiteUrl}` : ''}
${industry ? `INDUSTRY: ${industry}` : ''}
${location ? `LOCATION: ${location}` : ''}
${contactName ? `KEY CONTACT: ${contactName}` : ''}

Find the most relevant recent news, press releases, funding announcements, leadership changes, expansions, partnerships, and industry developments from the last 90 days. Focus on information that would help a salesperson start a meaningful conversation.`;

    console.log(`[NewsAgent] Starting research for ${companyName}`);

    try {
        const result = await runAgentAndParseJson(
            NEWS_AGENT_SYSTEM_PROMPT,
            userMessage,
            NEWS_AGENT_TOOL_DEFS,
            NEWS_TOOL_IMPLEMENTATIONS,
            { maxIterations: 5, verbose: true }
        );

        if (result.success && result.parsed) {
            console.log(`[NewsAgent] Found ${result.parsed.signalCount || 0} signals for ${companyName}`);
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

        // Fallback if no JSON parsed
        console.warn('[NewsAgent] No structured response, returning raw');
        return {
            success: false,
            raw: result.response,
            signals: [],
            companyName,
            noResultsNote: 'Agent did not return structured data',
        };

    } catch (error) {
        console.error('[NewsAgent] Failed:', error.message);
        return {
            success: false,
            error: error.message,
            signals: [],
            companyName,
        };
    }
}

module.exports = {
    researchNews,
    NEWS_AGENT_SYSTEM_PROMPT,
    NEWS_AGENT_TOOL_DEFS,
};
