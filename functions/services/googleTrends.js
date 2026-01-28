/**
 * Google Trends Service
 *
 * Provides demand signal data via Google Trends
 * Falls back to static industry defaults when Trends API is unavailable
 */

/**
 * Industry keyword mappings for Google Trends searches
 */
const NAICS_TO_TRENDS_KEYWORDS = {
    '722511': ['restaurant near me', 'best restaurants', 'dinner reservations'],
    '722513': ['fast food near me', 'drive thru', 'quick lunch'],
    '722515': ['coffee shop near me', 'cafe', 'coffee'],
    '722410': ['bar near me', 'happy hour', 'nightlife'],
    '811111': ['auto repair near me', 'car mechanic', 'oil change'],
    '811121': ['auto body shop', 'car paint', 'collision repair'],
    '441110': ['car dealership', 'buy car', 'new car'],
    '713940': ['gym near me', 'fitness classes', 'personal trainer'],
    '621111': ['doctor near me', 'medical clinic', 'primary care'],
    '621210': ['dentist near me', 'dental clinic', 'teeth cleaning'],
    '621310': ['chiropractor near me', 'back pain', 'chiropractic'],
    '812199': ['spa near me', 'massage', 'wellness'],
    '238220': ['plumber near me', 'hvac repair', 'ac repair'],
    '238210': ['electrician near me', 'electrical repair'],
    '238160': ['roofing contractor', 'roof repair', 'roofer'],
    '561730': ['lawn care', 'landscaping near me', 'lawn service'],
    '541110': ['lawyer near me', 'attorney', 'legal help'],
    '541211': ['accountant near me', 'tax preparation', 'cpa'],
    '531210': ['real estate agent', 'homes for sale', 'realtor'],
    '524210': ['insurance agent', 'car insurance', 'home insurance'],
    '812111': ['hair salon near me', 'haircut', 'barber'],
    '812112': ['beauty salon', 'salon near me'],
    '812113': ['nail salon near me', 'manicure', 'pedicure'],
    '452319': ['store near me', 'shopping'],
    '448140': ['clothing store', 'fashion'],
    '443142': ['electronics store', 'tech store']
};

/**
 * Static demand signal defaults by industry
 * Based on typical seasonal patterns and growth rates
 */
const DEFAULT_DEMAND_SIGNALS = {
    '722511': {
        currentInterest: 75,
        yoyChange: 5,
        trendDirection: 'rising',
        momentumScore: 65,
        seasonality: 'holiday_peak',
        peakMonths: [11, 12, 2] // Nov, Dec, Feb
    },
    '722513': {
        currentInterest: 80,
        yoyChange: 3,
        trendDirection: 'stable',
        momentumScore: 55,
        seasonality: 'stable',
        peakMonths: []
    },
    '722515': {
        currentInterest: 70,
        yoyChange: 8,
        trendDirection: 'rising',
        momentumScore: 70,
        seasonality: 'morning_peak',
        peakMonths: [1, 9] // New Year, Back to school
    },
    '713940': {
        currentInterest: 65,
        yoyChange: 12,
        trendDirection: 'rising',
        momentumScore: 75,
        seasonality: 'january_peak',
        peakMonths: [1, 5] // New Year resolutions, summer prep
    },
    '811111': {
        currentInterest: 60,
        yoyChange: 2,
        trendDirection: 'stable',
        momentumScore: 52,
        seasonality: 'stable',
        peakMonths: []
    },
    '621111': {
        currentInterest: 70,
        yoyChange: 6,
        trendDirection: 'rising',
        momentumScore: 62,
        seasonality: 'flu_season',
        peakMonths: [1, 2, 10, 11]
    },
    '621210': {
        currentInterest: 55,
        yoyChange: 4,
        trendDirection: 'stable',
        momentumScore: 55,
        seasonality: 'back_to_school',
        peakMonths: [8, 9, 1]
    },
    '238220': {
        currentInterest: 65,
        yoyChange: 7,
        trendDirection: 'rising',
        momentumScore: 63,
        seasonality: 'summer_peak',
        peakMonths: [6, 7, 8]
    },
    '561730': {
        currentInterest: 60,
        yoyChange: 10,
        trendDirection: 'rising',
        momentumScore: 68,
        seasonality: 'spring_summer',
        peakMonths: [3, 4, 5, 6]
    },
    '541110': {
        currentInterest: 50,
        yoyChange: 2,
        trendDirection: 'stable',
        momentumScore: 50,
        seasonality: 'stable',
        peakMonths: []
    },
    '541211': {
        currentInterest: 55,
        yoyChange: 3,
        trendDirection: 'stable',
        momentumScore: 52,
        seasonality: 'tax_season',
        peakMonths: [1, 2, 3, 4]
    },
    '531210': {
        currentInterest: 60,
        yoyChange: -5,
        trendDirection: 'declining',
        momentumScore: 42,
        seasonality: 'spring_summer',
        peakMonths: [4, 5, 6, 7]
    },
    '812111': {
        currentInterest: 65,
        yoyChange: 4,
        trendDirection: 'stable',
        momentumScore: 55,
        seasonality: 'holiday_peak',
        peakMonths: [11, 12, 5] // Holidays, Mother's Day
    },
    '812113': {
        currentInterest: 60,
        yoyChange: 6,
        trendDirection: 'rising',
        momentumScore: 60,
        seasonality: 'summer_holiday',
        peakMonths: [5, 6, 7, 12]
    },
    'default': {
        currentInterest: 50,
        yoyChange: 0,
        trendDirection: 'stable',
        momentumScore: 50,
        seasonality: 'stable',
        peakMonths: []
    }
};

/**
 * State abbreviation to DMA code mapping for Google Trends
 */
const STATE_TO_DMA = {
    'TX': { code: 'US-TX', dmas: { 'Austin': '635', 'Dallas': '623', 'Houston': '618', 'San Antonio': '641' } },
    'CA': { code: 'US-CA', dmas: { 'Los Angeles': '803', 'San Francisco': '807', 'San Diego': '825' } },
    'NY': { code: 'US-NY', dmas: { 'New York': '501', 'Buffalo': '514' } },
    'FL': { code: 'US-FL', dmas: { 'Miami': '528', 'Tampa': '539', 'Orlando': '534' } },
    'IL': { code: 'US-IL', dmas: { 'Chicago': '602' } },
    'PA': { code: 'US-PA', dmas: { 'Philadelphia': '504', 'Pittsburgh': '508' } },
    'OH': { code: 'US-OH', dmas: { 'Columbus': '535', 'Cleveland': '510', 'Cincinnati': '515' } },
    'GA': { code: 'US-GA', dmas: { 'Atlanta': '524' } },
    'NC': { code: 'US-NC', dmas: { 'Charlotte': '517', 'Raleigh': '560' } },
    'MI': { code: 'US-MI', dmas: { 'Detroit': '505' } },
    'AZ': { code: 'US-AZ', dmas: { 'Phoenix': '753' } },
    'WA': { code: 'US-WA', dmas: { 'Seattle': '819' } },
    'MA': { code: 'US-MA', dmas: { 'Boston': '506' } },
    'CO': { code: 'US-CO', dmas: { 'Denver': '751' } },
    'TN': { code: 'US-TN', dmas: { 'Nashville': '659', 'Memphis': '640' } },
    'MN': { code: 'US-MN', dmas: { 'Minneapolis': '613' } },
    'MO': { code: 'US-MO', dmas: { 'St. Louis': '609', 'Kansas City': '616' } },
    'IN': { code: 'US-IN', dmas: { 'Indianapolis': '527' } },
    'WI': { code: 'US-WI', dmas: { 'Milwaukee': '617' } },
    'NV': { code: 'US-NV', dmas: { 'Las Vegas': '839' } },
    'OR': { code: 'US-OR', dmas: { 'Portland': '820' } }
};

/**
 * Get demand signals for an industry in a location
 *
 * Uses static defaults since Google Trends has no official API.
 * For production, consider integrating SerpAPI or pytrends via a Python microservice.
 *
 * @param {string} naicsCode - NAICS code for the industry
 * @param {string} state - State abbreviation
 * @param {string} city - City name (optional, for DMA targeting)
 * @returns {Promise<Object>} Demand signal data
 */
async function getDemandSignals(naicsCode, state, city = null) {
    // Get base industry signals
    const baseSignals = DEFAULT_DEMAND_SIGNALS[naicsCode] || DEFAULT_DEMAND_SIGNALS.default;

    // Apply seasonal adjustment based on current month
    const currentMonth = new Date().getMonth() + 1;
    const isInPeakSeason = baseSignals.peakMonths.includes(currentMonth);

    let seasonalMultiplier = 1.0;
    if (isInPeakSeason) {
        seasonalMultiplier = 1.15; // 15% boost during peak
    } else if (baseSignals.seasonality !== 'stable') {
        seasonalMultiplier = 0.90; // 10% reduction off-peak
    }

    // Apply regional adjustment (some markets are inherently more active)
    let regionalMultiplier = 1.0;
    const highGrowthStates = ['TX', 'FL', 'AZ', 'NC', 'GA', 'TN', 'CO'];
    const stateAbbr = state?.length === 2 ? state.toUpperCase() : null;

    if (stateAbbr && highGrowthStates.includes(stateAbbr)) {
        regionalMultiplier = 1.10;
    }

    // Calculate adjusted metrics
    const adjustedInterest = Math.round(baseSignals.currentInterest * seasonalMultiplier * regionalMultiplier);
    const adjustedMomentum = Math.round(baseSignals.momentumScore * regionalMultiplier);

    return {
        success: true,
        data: {
            naicsCode,
            keywords: NAICS_TO_TRENDS_KEYWORDS[naicsCode] || [],
            currentInterest: Math.min(100, adjustedInterest),
            yoyChange: baseSignals.yoyChange,
            trendDirection: baseSignals.trendDirection,
            momentumScore: Math.min(100, adjustedMomentum),
            seasonality: {
                pattern: baseSignals.seasonality,
                isInPeakSeason,
                peakMonths: baseSignals.peakMonths
            },
            region: {
                state: stateAbbr,
                city,
                isHighGrowthRegion: highGrowthStates.includes(stateAbbr)
            },
            source: 'Industry average estimates',
            note: 'Based on historical patterns. Live Google Trends integration available upon request.',
            dataQuality: 'estimated'
        }
    };
}

/**
 * Get search keywords for an industry
 *
 * @param {string} naicsCode - NAICS code
 * @returns {string[]} Array of relevant search keywords
 */
function getSearchKeywords(naicsCode) {
    return NAICS_TO_TRENDS_KEYWORDS[naicsCode] || [];
}

/**
 * Get geo code for Google Trends query
 *
 * @param {string} state - State abbreviation
 * @param {string} city - City name (optional)
 * @returns {string|null} Geo code for Trends API
 */
function getTrendsGeoCode(state, city = null) {
    const stateData = STATE_TO_DMA[state?.toUpperCase()];
    if (!stateData) return 'US';

    // Try DMA-level if city provided
    if (city && stateData.dmas) {
        const normalizedCity = city.toLowerCase().replace(/\s+/g, ' ').trim();
        for (const [cityName, dmaCode] of Object.entries(stateData.dmas)) {
            if (cityName.toLowerCase() === normalizedCity) {
                return `${stateData.code}-${dmaCode}`;
            }
        }
    }

    return stateData.code;
}

/**
 * Calculate momentum score from YoY change
 *
 * @param {number} yoyChange - Year-over-year percentage change
 * @returns {number} Momentum score (0-100)
 */
function calculateMomentumScore(yoyChange) {
    if (yoyChange > 20) return Math.min(100, 70 + yoyChange / 2);
    if (yoyChange > 0) return 50 + yoyChange;
    if (yoyChange > -20) return 50 + yoyChange;
    return Math.max(0, 30 + yoyChange);
}

/**
 * Get seasonal forecast for an industry
 *
 * @param {string} naicsCode - NAICS code
 * @returns {Object} Seasonal forecast data
 */
function getSeasonalForecast(naicsCode) {
    const signals = DEFAULT_DEMAND_SIGNALS[naicsCode] || DEFAULT_DEMAND_SIGNALS.default;
    const currentMonth = new Date().getMonth() + 1;

    // Find next peak month
    const futureMonths = [...signals.peakMonths].filter(m => m > currentMonth);
    const nextPeak = futureMonths.length > 0
        ? futureMonths[0]
        : signals.peakMonths[0] || null;

    // Calculate months until peak
    let monthsUntilPeak = null;
    if (nextPeak) {
        monthsUntilPeak = nextPeak > currentMonth
            ? nextPeak - currentMonth
            : (12 - currentMonth) + nextPeak;
    }

    return {
        pattern: signals.seasonality,
        currentMonth,
        isInPeakSeason: signals.peakMonths.includes(currentMonth),
        peakMonths: signals.peakMonths,
        nextPeakMonth: nextPeak,
        monthsUntilPeak,
        recommendation: signals.peakMonths.includes(currentMonth)
            ? 'Currently in peak season - maximize marketing efforts'
            : monthsUntilPeak && monthsUntilPeak <= 2
            ? 'Peak season approaching - prepare for increased demand'
            : 'Off-peak period - focus on building capacity and brand'
    };
}

module.exports = {
    getDemandSignals,
    getSearchKeywords,
    getTrendsGeoCode,
    calculateMomentumScore,
    getSeasonalForecast,
    NAICS_TO_TRENDS_KEYWORDS,
    DEFAULT_DEMAND_SIGNALS,
    STATE_TO_DMA
};
