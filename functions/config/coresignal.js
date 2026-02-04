/**
 * CoreSignal API Configuration
 *
 * B2B competitor data source for industries where Google Places
 * returns no results (Technology, Finance, Manufacturing, Aviation, etc.)
 *
 * Feature flag ENABLE_CORESIGNAL defaults to OFF.
 * When off, behavior is identical to existing Google Places flow.
 */

/**
 * CoreSignal API settings
 */
const CORESIGNAL_CONFIG = {
    baseUrl: 'https://api.coresignal.com/cdapi/v1',
    timeout: 15000,
    maxRetries: 2,
    maxResultsPerSearch: 20,
    creditWarningThreshold: parseInt(process.env.CORESIGNAL_CREDIT_WARNING, 10) || 50
};

/**
 * Check if CoreSignal integration is enabled
 * @returns {boolean}
 */
function isEnabled() {
    return process.env.ENABLE_CORESIGNAL === 'true';
}

/**
 * Get CoreSignal API key
 * @returns {string|null}
 */
function getApiKey() {
    return process.env.CORESIGNAL_API_KEY || null;
}

/**
 * NAICS code to CoreSignal industry mapping
 *
 * Maps NAICS codes to CoreSignal's LinkedIn-style industry strings
 * and additional search keywords for Elasticsearch queries.
 */
const NAICS_TO_CORESIGNAL = {
    // Technology & SaaS
    '541511': { industry: 'computer software', keywords: ['software development', 'custom programming'] },
    '541512': { industry: 'information technology and services', keywords: ['IT services', 'computer systems'] },
    '518210': { industry: 'internet', keywords: ['cloud computing', 'data hosting', 'SaaS'] },
    '541519': { industry: 'computer software', keywords: ['SaaS', 'software as a service'] },
    '541690': { industry: 'management consulting', keywords: ['technology consulting', 'IT consulting'] },

    // Finance & Banking
    '522110': { industry: 'banking', keywords: ['commercial banking', 'financial services'] },
    '522130': { industry: 'banking', keywords: ['credit union', 'member banking'] },
    '523110': { industry: 'investment banking', keywords: ['securities', 'investment banking'] },
    '523930': { industry: 'financial services', keywords: ['investment advice', 'financial advisory', 'wealth management'] },
    '522320': { industry: 'financial services', keywords: ['payment processing', 'fintech'] },

    // Manufacturing
    '332710': { industry: 'machinery', keywords: ['machine shop', 'precision machining'] },
    '333249': { industry: 'industrial automation', keywords: ['industrial machinery', 'industrial equipment'] },
    '311999': { industry: 'food production', keywords: ['food manufacturing', 'food processing'] },
    '339999': { industry: 'manufacturing', keywords: ['general manufacturing'] },

    // Transportation & Logistics
    '481111': { industry: 'airlines/aviation', keywords: ['commercial aviation', 'airline'] },
    '481211': { industry: 'airlines/aviation', keywords: ['charter aviation', 'private aviation'] },
    '488190': { industry: 'airlines/aviation', keywords: ['aviation services', 'airport services'] },
    '484110': { industry: 'logistics and supply chain', keywords: ['freight', 'trucking', 'shipping'] },
    '493110': { industry: 'logistics and supply chain', keywords: ['warehousing', 'storage', 'fulfillment'] },

    // Energy & Utilities
    '221111': { industry: 'utilities', keywords: ['power generation', 'electricity'] },
    '237130': { industry: 'construction', keywords: ['utility construction', 'power line'] },
    '221310': { industry: 'utilities', keywords: ['water supply', 'water utility'] },

    // Agriculture
    '111998': { industry: 'farming', keywords: ['crop farming', 'agriculture'] },
    '112990': { industry: 'farming', keywords: ['livestock', 'animal production'] },
    '115310': { industry: 'farming', keywords: ['forestry', 'forestry services'] },

    // Commercial Real Estate
    '531120': { industry: 'commercial real estate', keywords: ['commercial property', 'nonresidential'] },
    '531311': { industry: 'real estate', keywords: ['property management', 'residential management'] },

    // Education & Training
    '611310': { industry: 'higher education', keywords: ['university', 'college'] },
    '611430': { industry: 'professional training & coaching', keywords: ['corporate training', 'management training'] },
    '611699': { industry: 'education management', keywords: ['specialty training', 'vocational'] }
};

/**
 * Build an Elasticsearch DSL query for CoreSignal company search
 *
 * @param {string} naicsCode - NAICS code to look up industry mapping
 * @param {string} city - City name for location filtering
 * @param {string} state - State name or abbreviation for location filtering
 * @returns {Object} Elasticsearch query body
 */
function buildSearchQuery(naicsCode, city, state) {
    const mapping = NAICS_TO_CORESIGNAL[naicsCode];

    // Build industry + keyword terms
    const industryTerm = mapping ? mapping.industry : 'business';
    const keywords = mapping ? mapping.keywords : [];

    // Combine location parts
    const locationParts = [];
    if (city) locationParts.push(city);
    if (state) locationParts.push(state);
    const locationString = locationParts.join(', ');

    // Build the query
    const must = [];
    const should = [];

    // Industry filter
    if (industryTerm) {
        must.push({
            term: {
                industry: industryTerm
            }
        });
    }

    // Location filter
    if (locationString) {
        must.push({
            match: {
                location: {
                    query: locationString,
                    operator: 'and'
                }
            }
        });
    }

    // Keyword boosting (optional matches improve ranking)
    for (const keyword of keywords) {
        should.push({
            match: {
                description: {
                    query: keyword,
                    boost: 1.5
                }
            }
        });
        should.push({
            match: {
                name: {
                    query: keyword,
                    boost: 2.0
                }
            }
        });
    }

    return {
        query: {
            bool: {
                must,
                should,
                minimum_should_match: 0
            }
        },
        sort: [
            { _score: 'desc' }
        ],
        size: CORESIGNAL_CONFIG.maxResultsPerSearch
    };
}

/**
 * Get the CoreSignal industry mapping for a NAICS code
 * @param {string} naicsCode
 * @returns {Object|null} { industry, keywords } or null
 */
function getIndustryMapping(naicsCode) {
    return NAICS_TO_CORESIGNAL[naicsCode] || null;
}

module.exports = {
    CORESIGNAL_CONFIG,
    NAICS_TO_CORESIGNAL,
    isEnabled,
    getApiKey,
    buildSearchQuery,
    getIndustryMapping
};
