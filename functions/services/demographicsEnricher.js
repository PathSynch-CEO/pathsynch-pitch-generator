/**
 * Demographics Enricher
 * Fetches city-level Census data and parses growth metrics from Serper snippets.
 */

const fetch = require('node-fetch');

const STATE_FIPS = {
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
    'CO': '08', 'CT': '09', 'DE': '10', 'FL': '12', 'GA': '13',
    'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19',
    'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23', 'MD': '24',
    'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29',
    'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33', 'NJ': '34',
    'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45',
    'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
    'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56',
    'DC': '11'
};

/**
 * Fetch city-level demographics from Census ACS 5-year estimates.
 * Free API, no key required for basic queries.
 */
async function fetchCensusData(city, state) {
    try {
        const fips = STATE_FIPS[(state || '').toUpperCase()];
        if (!fips) return null;

        const url = `https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B19013_001E,B25077_001E&for=place:*&in=state:${fips}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) return null;
        const data = await response.json();

        // data[0] is headers: ["NAME","B01003_001E","B19013_001E","B25077_001E","state","place"]
        const cityLower = (city || '').toLowerCase().trim();
        if (!cityLower) return null;

        const match = data.slice(1).find(row => {
            const name = (row[0] || '').toLowerCase();
            // Census names are like "Nashville-Davidson metropolitan government (balance), Tennessee"
            const placeName = name.split(',')[0].trim();
            return placeName.includes(cityLower) || cityLower.includes(placeName.split('(')[0].trim());
        });

        if (!match) return null;

        return {
            name: match[0],
            population: parseInt(match[1]) || null,
            medianIncome: parseInt(match[2]) || null,
            medianHomeValue: parseInt(match[3]) || null,
            source: 'census_acs_2023'
        };
    } catch (e) {
        console.warn(`[DemographicsEnricher] Census API failed for ${city}, ${state}:`, e.message);
        return null;
    }
}

/**
 * Parse growth data from Serper community snippets.
 * Extracts percentage growth, population numbers, and timeframes.
 */
function parseGrowthFromSnippets(growthSignals) {
    if (!growthSignals || !Array.isArray(growthSignals)) return [];

    return growthSignals.map(signal => {
        const text = signal.signal || signal.snippet || '';
        const name = signal.name || signal.community || '';

        // Extract percentage growth (e.g., "grew by 8%", "20% growth rate")
        const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:growth|increase|gain|grew|rise)/i)
                      || text.match(/(?:grew|increase|gain|rose)\s*(?:by\s*)?(?:about\s*)?(\d+(?:\.\d+)?)\s*%/i);
        const growthPct = pctMatch ? parseFloat(pctMatch[1]) : null;

        // Extract population gain (e.g., "added 64,400 residents")
        const popMatch = text.match(/(?:added|gained|grew\s+by)\s+([\d,]+)\s*(?:residents|people|persons)/i);
        const popGain = popMatch ? parseInt(popMatch[1].replace(/,/g, '')) : null;

        // Extract total population
        const totalPopMatch = text.match(/(?:population|total)\s*(?:of|to|reached|is)?\s*([\d,]+)/i);
        const totalPop = totalPopMatch ? parseInt(totalPopMatch[1].replace(/,/g, '')) : null;

        // Extract timeframe
        const yearMatch = text.match(/20\d{2}\s*(?:[-–]|to|and)\s*20\d{2}/);
        const timeframe = yearMatch ? yearMatch[0] : null;

        return {
            name,
            mentions: signal.mentions || 1,
            snippet: text.substring(0, 200),
            growthPct,
            populationGain: popGain,
            totalPopulation: totalPop,
            timeframe,
            hasStructuredData: !!(growthPct || popGain)
        };
    });
}

/**
 * Build full demographics enrichment for a market report.
 * @param {string} city
 * @param {string} state - 2-letter state code
 * @param {Array} existingCommunities - topCommunities from Serper
 * @param {Array} existingGrowthSignals - growthSignals from Serper
 * @returns {Object} { cityDemographics, communities, source }
 */
async function enrichDemographics(city, state, existingCommunities, existingGrowthSignals) {
    const result = {
        cityDemographics: null,
        communities: [],
        source: 'serper_editorial'
    };

    // 1. Fetch city-level Census data
    try {
        result.cityDemographics = await fetchCensusData(city, state);
        if (result.cityDemographics) {
            result.source = 'census_acs_2023';
        }
    } catch (e) {
        console.warn('[DemographicsEnricher] Census enrichment failed:', e.message);
    }

    // 2. Parse growth data from existing Serper community signals
    if (existingGrowthSignals && existingGrowthSignals.length > 0) {
        result.communities = parseGrowthFromSnippets(existingGrowthSignals);
    } else if (existingCommunities && existingCommunities.length > 0) {
        // Convert plain community mentions to structured format
        result.communities = existingCommunities.map(c => ({
            name: c.name,
            mentions: c.mentions || 1,
            snippet: '',
            growthPct: null,
            populationGain: null,
            totalPopulation: null,
            timeframe: null,
            hasStructuredData: false
        }));
    }

    return result;
}

module.exports = { enrichDemographics, fetchCensusData, parseGrowthFromSnippets, STATE_FIPS };
