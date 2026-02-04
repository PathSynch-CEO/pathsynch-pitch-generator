/**
 * CoreSignal API Service
 *
 * B2B competitor discovery using CoreSignal's company database.
 * Returns the same shape as googlePlaces.findCompetitors() so callers
 * can treat results identically.
 *
 * Two-step flow: search for company IDs, then collect full records.
 */

const coresignalConfig = require('../config/coresignal');
const marketCache = require('./marketCache');

const { CORESIGNAL_CONFIG } = coresignalConfig;

/**
 * Find B2B competitors via CoreSignal API
 *
 * @param {Object} params
 * @param {string} params.naicsCode - NAICS industry code
 * @param {string} params.city - City name
 * @param {string} params.state - State name or abbreviation
 * @param {string} [params.industry] - Display industry name (for logging)
 * @param {number} [params.radius] - Search radius (unused by CoreSignal but kept for interface parity)
 * @returns {Promise<Object>} { success, competitors, totalFound, source }
 */
async function findCompetitors({ naicsCode, city, state, industry, radius }) {
    if (!coresignalConfig.isEnabled()) {
        return {
            success: false,
            error: 'CoreSignal integration is disabled',
            competitors: [],
            totalFound: 0,
            source: 'coresignal'
        };
    }

    const apiKey = coresignalConfig.getApiKey();
    if (!apiKey) {
        console.warn('CoreSignal API key not configured');
        return {
            success: false,
            error: 'CoreSignal API key not configured',
            competitors: [],
            totalFound: 0,
            source: 'coresignal'
        };
    }

    // Check cache first
    const cacheParams = {
        naicsCode,
        city: (city || '').toLowerCase().trim(),
        state: (state || '').toLowerCase().trim()
    };

    try {
        const cached = await marketCache.getCached('coresignal_competitors', cacheParams);
        if (cached) {
            console.log('CoreSignal cache hit:', cacheParams.city, cacheParams.state, naicsCode);
            return {
                ...cached.data,
                fromCache: true,
                cachedAt: cached.cachedAt
            };
        }
    } catch (cacheError) {
        console.warn('CoreSignal cache read error:', cacheError.message);
    }

    try {
        // Step 1: Search for company IDs
        const searchBody = coresignalConfig.buildSearchQuery(naicsCode, city, state);
        const searchResponse = await callCoresignalApi(
            '/linkedin/company/search/filter',
            'POST',
            searchBody,
            apiKey
        );

        if (!searchResponse || !Array.isArray(searchResponse)) {
            console.log('CoreSignal search returned no results for', naicsCode, city, state);
            const emptyResult = {
                success: true,
                competitors: [],
                totalFound: 0,
                source: 'coresignal'
            };
            await cacheResult(cacheParams, emptyResult);
            return emptyResult;
        }

        const companyIds = searchResponse.slice(0, CORESIGNAL_CONFIG.maxResultsPerSearch);

        // Step 2: Collect full records for each ID
        const companyPromises = companyIds.map(id => collectCompany(id, apiKey));
        const companyResults = await Promise.allSettled(companyPromises);

        const competitors = [];
        for (const result of companyResults) {
            if (result.status === 'fulfilled' && result.value) {
                const mapped = mapToCompetitor(result.value);
                if (mapped) {
                    competitors.push(mapped);
                }
            }
        }

        const finalResult = {
            success: true,
            competitors,
            totalFound: competitors.length,
            source: 'coresignal'
        };

        // Cache result
        await cacheResult(cacheParams, finalResult);

        console.log(`CoreSignal found ${competitors.length} competitors for ${industry || naicsCode} in ${city}, ${state}`);
        return finalResult;

    } catch (error) {
        console.error('CoreSignal findCompetitors error:', error.message);
        return {
            success: false,
            error: error.message,
            competitors: [],
            totalFound: 0,
            source: 'coresignal'
        };
    }
}

/**
 * Fetch a single company record by ID
 *
 * @param {number|string} id - CoreSignal company ID
 * @param {string} apiKey - API key
 * @returns {Promise<Object|null>} Company record or null
 */
async function collectCompany(id, apiKey) {
    try {
        const data = await callCoresignalApi(
            `/linkedin/company/collect/${id}`,
            'GET',
            null,
            apiKey
        );
        return data;
    } catch (error) {
        console.warn(`CoreSignal collectCompany failed for ID ${id}:`, error.message);
        return null;
    }
}

/**
 * Map a CoreSignal company record to the standard competitor shape
 *
 * @param {Object} company - Raw CoreSignal company data
 * @returns {Object|null} Normalized competitor object or null
 */
function mapToCompetitor(company) {
    if (!company || !company.name) {
        return null;
    }

    const employeeCount = parseEmployeeCount(company.size);

    return {
        name: company.name,
        address: company.location || null,
        rating: null,
        reviewCount: null,
        priceLevel: null,
        placeId: null,
        coresignalId: company.id || null,
        types: [],
        openNow: null,
        location: null,
        source: 'coresignal',
        firmographics: {
            employeeCount,
            sizeCategory: company.size || null,
            founded: company.founded || null,
            funding: company.last_funding_round_money_raised || null,
            website: company.website || null,
            industry: company.industry || null,
            description: company.description
                ? company.description.substring(0, 200)
                : null
        }
    };
}

/**
 * Parse CoreSignal employee size string to a midpoint number
 *
 * Handles formats like "51-200", "1-10", "10001+", "Self-employed"
 *
 * @param {string} sizeStr - Employee size range string
 * @returns {number|null} Midpoint employee count or null
 */
function parseEmployeeCount(sizeStr) {
    if (!sizeStr || typeof sizeStr !== 'string') {
        return null;
    }

    const trimmed = sizeStr.trim();

    // "Self-employed" or "1"
    if (trimmed.toLowerCase() === 'self-employed' || trimmed === '1') {
        return 1;
    }

    // "10001+" style
    const plusMatch = trimmed.match(/^(\d+)\+$/);
    if (plusMatch) {
        return parseInt(plusMatch[1], 10);
    }

    // "51-200" range style
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
        const low = parseInt(rangeMatch[1], 10);
        const high = parseInt(rangeMatch[2], 10);
        return Math.round((low + high) / 2);
    }

    // Plain number
    const num = parseInt(trimmed, 10);
    if (!isNaN(num)) {
        return num;
    }

    return null;
}

/**
 * Make an HTTP request to the CoreSignal API
 *
 * @param {string} path - API endpoint path
 * @param {string} method - HTTP method
 * @param {Object|null} body - Request body (for POST)
 * @param {string} apiKey - API key
 * @param {number} [attempt=1] - Current retry attempt
 * @returns {Promise<Object>} Response data
 */
async function callCoresignalApi(path, method, body, apiKey, attempt = 1) {
    const url = `${CORESIGNAL_CONFIG.baseUrl}${path}`;

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    const options = {
        method,
        headers,
        timeout: CORESIGNAL_CONFIG.timeout
    };

    if (body && method === 'POST') {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);

        if (response.status === 429) {
            // Rate limited - retry after delay if attempts remain
            if (attempt <= CORESIGNAL_CONFIG.maxRetries) {
                const retryAfter = parseInt(response.headers.get('retry-after'), 10) || 2;
                await sleep(retryAfter * 1000);
                return callCoresignalApi(path, method, body, apiKey, attempt + 1);
            }
            throw new Error('CoreSignal API rate limit exceeded');
        }

        if (response.status === 402) {
            console.error('CoreSignal API: Insufficient credits');
            throw new Error('CoreSignal API credits exhausted');
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`CoreSignal API error ${response.status}: ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
            if (attempt <= CORESIGNAL_CONFIG.maxRetries) {
                await sleep(1000 * attempt);
                return callCoresignalApi(path, method, body, apiKey, attempt + 1);
            }
            throw new Error('CoreSignal API request timed out');
        }
        throw error;
    }
}

/**
 * Cache CoreSignal results
 */
async function cacheResult(cacheParams, result) {
    try {
        await marketCache.setCache('coresignal_competitors', cacheParams, result);
        console.log('Cached CoreSignal results for:', cacheParams.city, cacheParams.state);
    } catch (cacheError) {
        console.warn('CoreSignal cache write error:', cacheError.message);
    }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    findCompetitors,
    collectCompany,
    mapToCompetitor,
    parseEmployeeCount
};
