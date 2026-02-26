/**
 * Contact Enrichment Service
 *
 * Enriches contact data from LinkedIn URLs or name+company searches.
 * Three input levels:
 * 1. LinkedIn URL provided → fetch public profile page
 * 2. Name + Title + Company → Google search for LinkedIn profile + public mentions
 * 3. Company only → company-level brief, skip contact personalization
 */

const axios = require('axios');

// Simple in-memory cache for search results (avoids repeated searches)
const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

/**
 * Extract text content from HTML, removing scripts and styles
 */
function extractTextFromHtml(html) {
    if (!html) return '';

    // Remove scripts and styles
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

/**
 * Fetch LinkedIn public profile page and extract data
 * Note: LinkedIn blocks most scraping, so this works best with public profiles
 * and may return limited data
 */
async function fetchLinkedInProfile(linkedinUrl) {
    if (!linkedinUrl) return null;

    // Validate LinkedIn URL
    if (!linkedinUrl.includes('linkedin.com/in/')) {
        console.warn('Invalid LinkedIn URL format:', linkedinUrl);
        return null;
    }

    try {
        // Try to fetch the public profile page
        const response = await axios.get(linkedinUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            timeout: 10000,
            maxRedirects: 3
        });

        const html = response.data;
        const text = extractTextFromHtml(html);

        // Extract key information from the page
        const result = {
            summary: extractSummaryFromLinkedIn(html, text),
            headline: extractHeadlineFromLinkedIn(html),
            careerHistory: extractCareerFromLinkedIn(html, text),
            education: extractEducationFromLinkedIn(html, text),
            source: 'linkedin_direct'
        };

        return result;
    } catch (error) {
        console.warn('LinkedIn fetch failed:', error.message);
        // LinkedIn often blocks direct access - return null to trigger fallback
        return null;
    }
}

/**
 * Extract headline/title from LinkedIn HTML
 */
function extractHeadlineFromLinkedIn(html) {
    // Try to find the headline in meta tags or structured data
    const headlineMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                          html.match(/<title>([^<]+)<\/title>/i);

    if (headlineMatch) {
        const text = headlineMatch[1];
        // Extract the professional part (usually before " | LinkedIn")
        const parts = text.split('|');
        if (parts.length > 0) {
            return parts[0].trim().substring(0, 200);
        }
    }

    return null;
}

/**
 * Extract summary/about from LinkedIn HTML
 */
function extractSummaryFromLinkedIn(html, text) {
    // Look for about section patterns in the text
    const aboutIndex = text.toLowerCase().indexOf('about');
    if (aboutIndex > -1) {
        const afterAbout = text.substring(aboutIndex, aboutIndex + 500);
        // Clean up and return first meaningful paragraph
        const sentences = afterAbout.split(/[.!?]/).slice(0, 3);
        return sentences.join('. ').trim() || null;
    }
    return null;
}

/**
 * Extract career history from LinkedIn HTML
 */
function extractCareerFromLinkedIn(html, text) {
    const careers = [];

    // Look for experience section patterns
    const expIndex = text.toLowerCase().indexOf('experience');
    if (expIndex > -1) {
        const afterExp = text.substring(expIndex, expIndex + 1000);
        // Extract company names and titles (simplified)
        const lines = afterExp.split(/\s{2,}/).slice(0, 10);
        for (const line of lines) {
            if (line.length > 10 && line.length < 200 && !line.includes('experience')) {
                careers.push(line.trim());
            }
            if (careers.length >= 5) break;
        }
    }

    return careers.length > 0 ? careers : null;
}

/**
 * Extract education from LinkedIn HTML
 */
function extractEducationFromLinkedIn(html, text) {
    const eduIndex = text.toLowerCase().indexOf('education');
    if (eduIndex > -1) {
        const afterEdu = text.substring(eduIndex, eduIndex + 300);
        // Return first meaningful chunk
        return afterEdu.substring(0, 150).trim() || null;
    }
    return null;
}

/**
 * Search Google for contact information
 * Uses a public search approach - results may be limited
 */
async function searchGoogleForContact(name, company, title = null) {
    const cacheKey = `${name}|${company}|${title || ''}`.toLowerCase();

    // Check cache
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        // Build search query
        const queries = [
            `"${name}" "${company}" site:linkedin.com`,
            `"${name}" "${company}" ${title ? `"${title}"` : ''} interview OR podcast OR conference`,
            `"${name}" "${company}" announcement OR press release`
        ];

        const results = {
            linkedInFound: false,
            linkedInUrl: null,
            recentActivity: [],
            pressReferences: [],
            source: 'google_search'
        };

        // Note: This would require a Google Custom Search API key for production
        // For now, we'll return structured data that can be enhanced later
        // When Google Custom Search is enabled:
        // const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
        // const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

        // Cache the result
        searchCache.set(cacheKey, { data: results, timestamp: Date.now() });

        return results;
    } catch (error) {
        console.warn('Google search failed:', error.message);
        return null;
    }
}

/**
 * Infer communication style based on available data
 */
function inferCommunicationStyle(data) {
    const styles = [];

    if (!data) return 'Professional (default)';

    const text = [
        data.summary || '',
        data.headline || '',
        ...(data.careerHistory || []),
        ...(data.recentActivity || [])
    ].join(' ').toLowerCase();

    // Data-driven indicators
    if (text.includes('analytics') || text.includes('data') || text.includes('metrics') ||
        text.includes('roi') || text.includes('performance')) {
        styles.push('Data-driven');
    }

    // Relationship-first indicators
    if (text.includes('team') || text.includes('people') || text.includes('culture') ||
        text.includes('collaboration') || text.includes('partner')) {
        styles.push('Relationship-first');
    }

    // Direct/Results indicators
    if (text.includes('growth') || text.includes('revenue') || text.includes('scale') ||
        text.includes('results') || text.includes('achievement')) {
        styles.push('Results-oriented');
    }

    // Innovation indicators
    if (text.includes('innovation') || text.includes('transform') || text.includes('disrupt') ||
        text.includes('startup') || text.includes('entrepreneur')) {
        styles.push('Innovation-focused');
    }

    return styles.length > 0 ? styles.join(', ') : 'Professional';
}

/**
 * Extract personal insights from enriched data
 */
function extractPersonalInsights(data) {
    const insights = [];

    if (!data) return null;

    const text = [
        data.summary || '',
        ...(data.careerHistory || []),
        data.education || ''
    ].join(' ').toLowerCase();

    // Board/advisory positions
    if (text.includes('board') || text.includes('advisor')) {
        insights.push('Has board or advisory experience');
    }

    // Nonprofit/causes
    if (text.includes('nonprofit') || text.includes('volunteer') || text.includes('foundation')) {
        insights.push('Involved in nonprofit or volunteer work');
    }

    // Speaking/thought leadership
    if (text.includes('speaker') || text.includes('keynote') || text.includes('author')) {
        insights.push('Active speaker or thought leader');
    }

    // Entrepreneurial background
    if (text.includes('founder') || text.includes('co-founder') || text.includes('entrepreneur')) {
        insights.push('Entrepreneurial background');
    }

    return insights.length > 0 ? insights.join('; ') : null;
}

/**
 * Main enrichment function
 * @param {Object} params - Contact parameters
 * @param {string} params.contactLinkedIn - LinkedIn URL (optional)
 * @param {string} params.contactName - Contact name (optional)
 * @param {string} params.contactTitle - Contact title (optional)
 * @param {string} params.prospectCompany - Company name (required for search fallback)
 * @returns {Object} Enriched contact data
 */
async function enrichContact(params) {
    const { contactLinkedIn, contactName, contactTitle, prospectCompany } = params;

    let enrichedData = {
        summary: null,
        careerHistory: null,
        education: null,
        recentActivity: null,
        communicationStyle: null,
        personalInsights: null,
        enrichmentLevel: 'none',
        enrichmentSources: []
    };

    // Level 1: LinkedIn URL provided
    if (contactLinkedIn) {
        console.log('Enrichment Level 1: LinkedIn URL provided');
        const linkedInData = await fetchLinkedInProfile(contactLinkedIn);

        if (linkedInData) {
            enrichedData = {
                ...enrichedData,
                summary: linkedInData.summary || linkedInData.headline,
                careerHistory: linkedInData.careerHistory,
                education: linkedInData.education,
                enrichmentLevel: 'linkedin_direct',
                enrichmentSources: ['linkedin']
            };
        }
    }

    // Level 2: Name + Company (search if no LinkedIn data)
    if (contactName && prospectCompany && enrichedData.enrichmentLevel === 'none') {
        console.log('Enrichment Level 2: Name + Company search');
        const searchData = await searchGoogleForContact(contactName, prospectCompany, contactTitle);

        if (searchData) {
            enrichedData = {
                ...enrichedData,
                recentActivity: searchData.recentActivity,
                enrichmentLevel: 'search',
                enrichmentSources: ['google_search']
            };

            // If LinkedIn URL found in search, try to fetch it
            if (searchData.linkedInUrl) {
                const linkedInData = await fetchLinkedInProfile(searchData.linkedInUrl);
                if (linkedInData) {
                    enrichedData.summary = linkedInData.summary || linkedInData.headline;
                    enrichedData.careerHistory = linkedInData.careerHistory;
                    enrichedData.education = linkedInData.education;
                    enrichedData.enrichmentSources.push('linkedin');
                }
            }
        }
    }

    // Level 3: Company only - minimal enrichment
    if (enrichedData.enrichmentLevel === 'none' && prospectCompany) {
        console.log('Enrichment Level 3: Company only');
        enrichedData.enrichmentLevel = 'company_only';
    }

    // Infer communication style and personal insights from available data
    enrichedData.communicationStyle = inferCommunicationStyle(enrichedData);
    enrichedData.personalInsights = extractPersonalInsights(enrichedData);

    return enrichedData;
}

/**
 * Check if contact enrichment returned meaningful data
 */
function hasContactEnrichment(enrichedData) {
    if (!enrichedData) return false;

    return enrichedData.summary ||
           (enrichedData.careerHistory && enrichedData.careerHistory.length > 0) ||
           enrichedData.education ||
           (enrichedData.recentActivity && enrichedData.recentActivity.length > 0);
}

module.exports = {
    enrichContact,
    hasContactEnrichment,
    fetchLinkedInProfile,
    searchGoogleForContact,
    inferCommunicationStyle,
    extractPersonalInsights
};
