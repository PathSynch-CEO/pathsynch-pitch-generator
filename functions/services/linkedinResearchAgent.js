/**
 * LinkedIn Research Agent
 *
 * Researches contacts via public web sources for sales prep.
 * REPLACES: services/contactEnricher.js (Option C scraper)
 *
 * Key improvements over contactEnricher.js:
 * - Uses real Google Custom Search (contactEnricher had a placeholder)
 * - AI-orchestrated research (decides what to search, adapts based on results)
 * - Communication style inferred from evidence, not keyword matching
 * - Generates conversation starters and doNotMention flags
 *
 * Called by: Pre-Call Brief generation, FlashSynch contact enrichment
 */

const { runAgentAndParseJson } = require('./agentRunner');
const { googleSearch } = require('./tools/googleSearch');
const { websiteScrape } = require('./tools/websiteScrape');

// System prompt for the LinkedIn Research Agent
const LINKEDIN_AGENT_SYSTEM_PROMPT = `You are a Sales Contact Research Agent for SynchIntro. Your job is to research a person that a salesperson is about to meet, and build a comprehensive contact intelligence profile.

## YOUR TOOLS
1. google_search — Search the public web for information about a person
2. website_scrape — Scrape specific pages for detailed information

## RESEARCH STRATEGY
1. Start with google_search for "{contactName}" "{companyName}"
2. Look for: LinkedIn profile info in search results, conference talks, podcast appearances, press mentions, published articles, board positions
3. If a personal website or company bio page appears in results, use website_scrape to get full details
4. Search for "{contactName}" {industry} to find industry-specific mentions
5. If contact name is not provided, research the company's leadership team instead

## IMPORTANT PRIVACY RULES
- Only use PUBLICLY AVAILABLE information
- Do NOT attempt to access private LinkedIn data or bypass any access controls
- Focus on professional information relevant to a sales conversation
- Do NOT include personal addresses, phone numbers, or private social media

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "contactName": "string",
  "companyName": "string",
  "enrichmentLevel": "full" | "partial" | "company_only" | "none",
  "profile": {
    "headline": "string — professional headline/current role",
    "summary": "string — 2-3 sentence professional summary",
    "currentRole": {
      "title": "string",
      "company": "string",
      "duration": "string — approximate tenure if found"
    },
    "careerHistory": [
      {
        "title": "string",
        "company": "string",
        "period": "string"
      }
    ],
    "education": [
      {
        "institution": "string",
        "degree": "string",
        "field": "string"
      }
    ],
    "recentActivity": [
      "string — recent public posts, articles, conference appearances"
    ],
    "communicationStyle": "Data-driven" | "Relationship-first" | "Results-oriented" | "Innovation-focused" | "Professional",
    "styleEvidence": "string — brief explanation of why this style was inferred",
    "personalInsights": [
      "string — board seats, causes, speaking engagements, publications"
    ],
    "linkedInUrl": "string — if found in search results"
  },
  "conversationStarters": [
    "string — 3-5 specific conversation starters based on findings"
  ],
  "doNotMention": [
    "string — sensitive topics found (layoffs, lawsuits, negative press)"
  ],
  "sources": [
    {
      "url": "string",
      "type": "string — linkedin_result | company_bio | conference | article | press"
    }
  ]
}

## RULES
- Be thorough but not invasive. Professional information only.
- If limited info is available, clearly say so — don't fabricate details.
- Communication style must be INFERRED from evidence, not guessed. Default to "Professional" if insufficient data.
- conversationStarters should reference SPECIFIC things you found, not generic questions.
- doNotMention is critical — if you find negative news, flag it so the seller avoids the topic.
- enrichmentLevel should reflect actual data quality: "full" = comprehensive profile, "partial" = some data, "company_only" = only company info, "none" = no useful data found.`;

// Tool definitions for Gemini function calling
const LINKEDIN_AGENT_TOOL_DEFS = [
    {
        name: 'google_search',
        description: 'Search the public web via Google Custom Search. Returns titles, snippets, and URLs. Use for finding professional information about people and companies. LinkedIn profile summaries often appear in search snippets without needing to scrape LinkedIn directly.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Google search query. For people: use "First Last" "Company" site:linkedin.com. For general: use "First Last" "Company" conference OR podcast OR interview.',
                },
                maxResults: {
                    type: 'number',
                    description: 'Max results to return. Default: 10.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'website_scrape',
        description: "Fetch and extract text from a specific URL. Use for company bio pages, conference speaker pages, or articles about the person. Do NOT use on LinkedIn URLs directly — LinkedIn blocks scraping.",
        parameters: {
            type: 'object',
            properties: {
                websiteUrl: {
                    type: 'string',
                    description: 'The full URL to scrape.',
                },
                pages: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional subpages to check.',
                },
            },
            required: ['websiteUrl'],
        },
    },
];

// Tool implementations map
const LINKEDIN_TOOL_IMPLEMENTATIONS = {
    google_search: googleSearch,
    website_scrape: websiteScrape,
};

/**
 * Research a contact for sales prep
 *
 * @param {Object} params
 * @param {string} params.contactName - Contact's full name (optional)
 * @param {string} params.contactTitle - Contact's title (optional)
 * @param {string} params.contactLinkedIn - LinkedIn URL (optional, used as search hint)
 * @param {string} params.prospectCompany - Company name (required)
 * @param {string} params.industry - Industry (optional)
 * @returns {Promise<Object>} Structured contact intelligence
 */
async function researchContact(params) {
    const { contactName, contactTitle, contactLinkedIn, prospectCompany, industry } = params;

    if (!prospectCompany) {
        return {
            success: false,
            error: 'prospectCompany is required',
            enrichmentLevel: 'none',
        };
    }

    const userMessage = `Research this contact for an upcoming sales meeting:

${contactName ? `NAME: ${contactName}` : 'NAME: Not provided — research company leadership instead'}
${contactTitle ? `TITLE: ${contactTitle}` : ''}
${contactLinkedIn ? `LINKEDIN: ${contactLinkedIn} (use as a search hint, do NOT scrape directly)` : ''}
COMPANY: ${prospectCompany}
${industry ? `INDUSTRY: ${industry}` : ''}

Build a comprehensive professional profile I can use to prepare for this meeting. Focus on finding:
1. Professional background and career history
2. Recent public activity (posts, articles, speaking engagements)
3. Communication style indicators
4. Conversation starters based on their background
5. Any sensitive topics to avoid`;

    console.log(`[LinkedInAgent] Starting research for ${contactName || 'leadership'} at ${prospectCompany}`);

    try {
        const result = await runAgentAndParseJson(
            LINKEDIN_AGENT_SYSTEM_PROMPT,
            userMessage,
            LINKEDIN_AGENT_TOOL_DEFS,
            LINKEDIN_TOOL_IMPLEMENTATIONS,
            { maxIterations: 5, verbose: true }
        );

        if (result.success && result.parsed) {
            console.log(`[LinkedInAgent] Enrichment level: ${result.parsed.enrichmentLevel} for ${contactName || prospectCompany}`);
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
        console.warn('[LinkedInAgent] No structured response, returning minimal profile');
        return {
            success: false,
            contactName: contactName || null,
            companyName: prospectCompany,
            enrichmentLevel: 'none',
            raw: result.response,
            profile: {
                headline: contactTitle || null,
                summary: null,
                communicationStyle: 'Professional',
                styleEvidence: 'Default - insufficient data for inference',
            },
            conversationStarters: [],
            doNotMention: [],
            sources: [],
        };

    } catch (error) {
        console.error('[LinkedInAgent] Failed:', error.message);
        return {
            success: false,
            error: error.message,
            contactName: contactName || null,
            companyName: prospectCompany,
            enrichmentLevel: 'none',
        };
    }
}

/**
 * Check if Google Search is configured
 * Used to determine if the agent can actually perform research
 */
function isConfigured() {
    return !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
}

module.exports = {
    researchContact,
    isConfigured,
    LINKEDIN_AGENT_SYSTEM_PROMPT,
    LINKEDIN_AGENT_TOOL_DEFS,
};
