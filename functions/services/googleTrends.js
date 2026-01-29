/**
 * Google Trends Service
 *
 * Provides demand signal data via Google Trends using SerpApi
 * Falls back to static industry defaults when API is unavailable
 * Includes company size-based seasonality adjustments
 */

const https = require('https');
const marketCache = require('./marketCache');

/**
 * Company size definitions and their seasonality sensitivity
 * Larger companies are less affected by seasonal fluctuations due to diversification
 */
const COMPANY_SIZE_CONFIG = {
    'small': {
        label: 'Small (1-10 employees)',
        employeeRange: [1, 10],
        seasonalSensitivity: 1.25,    // 25% more affected by seasonality
        peakAmplification: 1.3,        // Peaks hit harder
        offPeakReduction: 0.85,        // Off-peak hits harder
        marketReach: 'local',
        planningHorizon: '1-3 months'
    },
    'medium': {
        label: 'Medium (11-50 employees)',
        employeeRange: [11, 50],
        seasonalSensitivity: 1.0,     // Baseline seasonality
        peakAmplification: 1.15,
        offPeakReduction: 0.92,
        marketReach: 'regional',
        planningHorizon: '3-6 months'
    },
    'large': {
        label: 'Large (51-500 employees)',
        employeeRange: [51, 500],
        seasonalSensitivity: 0.7,     // 30% less affected
        peakAmplification: 1.08,
        offPeakReduction: 0.96,
        marketReach: 'multi-regional',
        planningHorizon: '6-12 months'
    },
    'national': {
        label: 'National (500+ employees)',
        employeeRange: [500, Infinity],
        seasonalSensitivity: 0.4,     // 60% less affected - diversified
        peakAmplification: 1.04,
        offPeakReduction: 0.98,
        marketReach: 'national',
        planningHorizon: '12+ months'
    }
};

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
 * Fetch real Google Trends data via SerpApi
 *
 * @param {string} keyword - Search keyword
 * @param {string} geo - Geographic location code (e.g., 'US-TX')
 * @returns {Promise<Object|null>} Trends data or null if unavailable
 */
async function fetchSerpApiTrends(keyword, geo = 'US') {
    const apiKey = process.env.SERPAPI_KEY;

    if (!apiKey) {
        console.log('SerpApi key not configured, using defaults');
        return null;
    }

    // Check cache first (cache for 24 hours)
    const cacheParams = { keyword, geo };
    try {
        const cached = await marketCache.getCached('trends', cacheParams);
        if (cached) {
            console.log('Cache hit for trends:', keyword, geo);
            return cached.data;
        }
    } catch (e) {
        // Cache error, continue to API
    }

    return new Promise((resolve) => {
        const params = new URLSearchParams({
            engine: 'google_trends',
            q: keyword,
            data_type: 'TIMESERIES',
            date: 'today 12-m',
            geo: geo,
            api_key: apiKey
        });

        const url = `https://serpapi.com/search.json?${params.toString()}`;

        const req = https.get(url, { timeout: 10000 }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', async () => {
                try {
                    const result = JSON.parse(data);

                    if (result.error) {
                        console.warn('SerpApi error:', result.error);
                        resolve(null);
                        return;
                    }

                    // Parse the timeline data
                    const timelineData = result.interest_over_time?.timeline_data || [];

                    if (timelineData.length === 0) {
                        resolve(null);
                        return;
                    }

                    // Get current interest (most recent data point)
                    const recentData = timelineData.slice(-4); // Last 4 weeks
                    const currentInterest = recentData.length > 0
                        ? Math.round(recentData.reduce((sum, d) => sum + (d.values?.[0]?.extracted_value || 0), 0) / recentData.length)
                        : 50;

                    // Calculate YoY change
                    const oneYearAgo = timelineData.slice(0, 4);
                    const yearAgoInterest = oneYearAgo.length > 0
                        ? Math.round(oneYearAgo.reduce((sum, d) => sum + (d.values?.[0]?.extracted_value || 0), 0) / oneYearAgo.length)
                        : currentInterest;

                    const yoyChange = yearAgoInterest > 0
                        ? Math.round(((currentInterest - yearAgoInterest) / yearAgoInterest) * 100)
                        : 0;

                    // Determine trend direction
                    let trendDirection = 'stable';
                    if (yoyChange > 10) trendDirection = 'rising';
                    else if (yoyChange > 3) trendDirection = 'growing';
                    else if (yoyChange < -10) trendDirection = 'declining';
                    else if (yoyChange < -3) trendDirection = 'falling';

                    // Find peak months
                    const monthlyData = {};
                    timelineData.forEach(d => {
                        if (d.date) {
                            const month = new Date(d.date).getMonth() + 1;
                            if (!monthlyData[month]) monthlyData[month] = [];
                            monthlyData[month].push(d.values?.[0]?.extracted_value || 0);
                        }
                    });

                    const monthAverages = Object.entries(monthlyData).map(([month, values]) => ({
                        month: parseInt(month),
                        avg: values.reduce((a, b) => a + b, 0) / values.length
                    }));

                    const overallAvg = monthAverages.reduce((sum, m) => sum + m.avg, 0) / monthAverages.length;
                    const peakMonths = monthAverages
                        .filter(m => m.avg > overallAvg * 1.1)
                        .map(m => m.month)
                        .sort((a, b) => a - b);

                    const trendsResult = {
                        currentInterest,
                        yoyChange,
                        trendDirection,
                        momentumScore: calculateMomentumScore(yoyChange),
                        peakMonths,
                        source: 'SerpApi Google Trends',
                        dataQuality: 'live'
                    };

                    // Cache the result
                    try {
                        await marketCache.setCache('trends', cacheParams, trendsResult, 24 * 60 * 60 * 1000);
                    } catch (e) {
                        // Cache error, continue
                    }

                    resolve(trendsResult);
                } catch (parseError) {
                    console.error('Error parsing SerpApi response:', parseError);
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            console.warn('SerpApi request error:', error.message);
            resolve(null);
        });

        req.on('timeout', () => {
            console.warn('SerpApi request timeout');
            req.destroy();
            resolve(null);
        });
    });
}

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
 * Uses SerpApi for live Google Trends data, falls back to static defaults
 *
 * @param {string} naicsCode - NAICS code for the industry
 * @param {string} state - State abbreviation
 * @param {string} city - City name (optional, for DMA targeting)
 * @param {string} companySize - Company size: 'small', 'medium', 'large', 'national'
 * @returns {Promise<Object>} Demand signal data
 */
async function getDemandSignals(naicsCode, state, city = null, companySize = 'small') {
    // Get base industry signals (used as fallback and for seasonality pattern)
    const baseSignals = DEFAULT_DEMAND_SIGNALS[naicsCode] || DEFAULT_DEMAND_SIGNALS.default;

    // Get company size configuration
    const sizeConfig = COMPANY_SIZE_CONFIG[companySize] || COMPANY_SIZE_CONFIG.small;

    // Try to get live data from SerpApi
    const keywords = NAICS_TO_TRENDS_KEYWORDS[naicsCode] || [];
    const geoCode = getTrendsGeoCode(state, city);
    const primaryKeyword = keywords[0] || naicsCode;

    let liveData = null;
    try {
        liveData = await fetchSerpApiTrends(primaryKeyword, geoCode);
        if (liveData) {
            console.log(`Got live trends data for "${primaryKeyword}" in ${geoCode}`);
        }
    } catch (error) {
        console.warn('Error fetching live trends:', error.message);
    }

    // Merge live data with base signals
    const signals = liveData ? {
        currentInterest: liveData.currentInterest,
        yoyChange: liveData.yoyChange,
        trendDirection: liveData.trendDirection,
        momentumScore: liveData.momentumScore,
        peakMonths: liveData.peakMonths.length > 0 ? liveData.peakMonths : baseSignals.peakMonths,
        seasonality: baseSignals.seasonality,
        source: liveData.source,
        dataQuality: liveData.dataQuality
    } : {
        currentInterest: baseSignals.currentInterest,
        yoyChange: baseSignals.yoyChange,
        trendDirection: baseSignals.trendDirection,
        momentumScore: baseSignals.momentumScore,
        peakMonths: baseSignals.peakMonths,
        seasonality: baseSignals.seasonality,
        source: 'Industry average estimates',
        dataQuality: 'estimated'
    };

    // Apply seasonal adjustment based on current month and company size
    const currentMonth = new Date().getMonth() + 1;
    const isInPeakSeason = signals.peakMonths.includes(currentMonth);

    let seasonalMultiplier = 1.0;
    if (isInPeakSeason) {
        // Peak season boost, modulated by company size
        const basePeakBoost = 0.15;
        seasonalMultiplier = 1 + (basePeakBoost * sizeConfig.seasonalSensitivity);
    } else if (signals.seasonality !== 'stable') {
        // Off-peak reduction, modulated by company size
        const baseOffPeakReduction = 0.10;
        seasonalMultiplier = 1 - (baseOffPeakReduction * sizeConfig.seasonalSensitivity);
    }

    // Apply regional adjustment (some markets are inherently more active)
    let regionalMultiplier = 1.0;
    const highGrowthStates = ['TX', 'FL', 'AZ', 'NC', 'GA', 'TN', 'CO'];
    const stateAbbr = state?.length === 2 ? state.toUpperCase() : null;

    if (stateAbbr && highGrowthStates.includes(stateAbbr)) {
        regionalMultiplier = 1.10;
    }

    // Calculate adjusted metrics
    const adjustedInterest = Math.round(signals.currentInterest * seasonalMultiplier * regionalMultiplier);
    const adjustedMomentum = Math.round(signals.momentumScore * regionalMultiplier);

    // Calculate seasonality impact score (how much this business is affected)
    const seasonalityImpact = Math.round(sizeConfig.seasonalSensitivity * 100);

    // Generate size-specific recommendations
    const sizeRecommendations = generateSizeBasedRecommendations(companySize, isInPeakSeason, signals);

    return {
        success: true,
        data: {
            naicsCode,
            keywords,
            currentInterest: Math.min(100, adjustedInterest),
            yoyChange: signals.yoyChange,
            trendDirection: signals.trendDirection,
            momentumScore: Math.min(100, adjustedMomentum),
            seasonality: {
                pattern: signals.seasonality,
                isInPeakSeason,
                peakMonths: signals.peakMonths,
                impactScore: seasonalityImpact,
                sensitivity: sizeConfig.seasonalSensitivity
            },
            companySize: {
                size: companySize,
                label: sizeConfig.label,
                marketReach: sizeConfig.marketReach,
                planningHorizon: sizeConfig.planningHorizon,
                seasonalSensitivity: sizeConfig.seasonalSensitivity
            },
            region: {
                state: stateAbbr,
                city,
                isHighGrowthRegion: highGrowthStates.includes(stateAbbr)
            },
            recommendations: sizeRecommendations,
            source: signals.source,
            dataQuality: signals.dataQuality
        }
    };
}

/**
 * Generate recommendations based on company size and seasonality
 *
 * @param {string} companySize - Company size category
 * @param {boolean} isInPeakSeason - Whether currently in peak season
 * @param {Object} signals - Base demand signals
 * @returns {Object} Size-specific recommendations
 */
function generateSizeBasedRecommendations(companySize, isInPeakSeason, signals) {
    const recommendations = {
        timing: '',
        strategy: '',
        budgetAllocation: '',
        riskFactors: []
    };

    switch (companySize) {
        case 'small':
            if (isInPeakSeason) {
                recommendations.timing = 'Maximize current peak season - allocate 70% of marketing budget now';
                recommendations.strategy = 'Focus on local visibility, reviews, and word-of-mouth during high-traffic period';
                recommendations.budgetAllocation = 'Heavy investment in peak (70/30 split)';
            } else {
                recommendations.timing = 'Build capacity and brand awareness for upcoming peak season';
                recommendations.strategy = 'Focus on cost-effective brand building, loyalty programs, and operational improvements';
                recommendations.budgetAllocation = 'Conservative spend, save for peak (30/70 split)';
            }
            recommendations.riskFactors = [
                'High seasonal revenue volatility',
                'Cash flow challenges during off-peak',
                'Weather and local events significantly impact traffic'
            ];
            break;

        case 'medium':
            if (isInPeakSeason) {
                recommendations.timing = 'Capitalize on peak while maintaining year-round presence';
                recommendations.strategy = 'Balance acquisition campaigns with retention programs';
                recommendations.budgetAllocation = 'Moderate peak emphasis (60/40 split)';
            } else {
                recommendations.timing = 'Invest in systems and processes for scalable growth';
                recommendations.strategy = 'Expand service area, test new channels, build email/SMS lists';
                recommendations.budgetAllocation = 'Steady investment with slight off-peak reduction (45/55 split)';
            }
            recommendations.riskFactors = [
                'Moderate seasonal impact on revenue',
                'Competition from both local and regional players',
                'Need to balance growth investment with profitability'
            ];
            break;

        case 'large':
            if (isInPeakSeason) {
                recommendations.timing = 'Optimize campaign performance and market share capture';
                recommendations.strategy = 'Multi-channel campaigns, competitive positioning, upsell/cross-sell';
                recommendations.budgetAllocation = 'Slight peak emphasis (55/45 split)';
            } else {
                recommendations.timing = 'Focus on efficiency, retention, and market expansion';
                recommendations.strategy = 'Geographic expansion, B2B partnerships, brand campaigns';
                recommendations.budgetAllocation = 'Consistent year-round investment (50/50 split)';
            }
            recommendations.riskFactors = [
                'Low seasonal volatility but competitive pressure',
                'Brand reputation management at scale',
                'Operational complexity across locations'
            ];
            break;

        case 'national':
            recommendations.timing = 'Regional seasonal variations average out - focus on strategic initiatives';
            recommendations.strategy = 'National brand campaigns, market share growth, operational excellence';
            recommendations.budgetAllocation = 'Consistent investment with regional adjustments (50/50 base)';
            if (isInPeakSeason) {
                recommendations.strategy += '. Current period favors certain regions - optimize regional mix.';
            }
            recommendations.riskFactors = [
                'Minimal seasonal impact due to geographic diversification',
                'Regulatory and compliance complexity',
                'Brand consistency across markets'
            ];
            break;
    }

    return recommendations;
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
 * @param {string} companySize - Company size: 'small', 'medium', 'large', 'national'
 * @returns {Object} Seasonal forecast data
 */
function getSeasonalForecast(naicsCode, companySize = 'small') {
    const signals = DEFAULT_DEMAND_SIGNALS[naicsCode] || DEFAULT_DEMAND_SIGNALS.default;
    const sizeConfig = COMPANY_SIZE_CONFIG[companySize] || COMPANY_SIZE_CONFIG.small;
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

    // Generate size-adjusted recommendation
    const isInPeakSeason = signals.peakMonths.includes(currentMonth);
    let recommendation;

    if (companySize === 'national') {
        recommendation = 'Geographic diversification smooths seasonal variation - maintain consistent strategy with regional optimizations';
    } else if (isInPeakSeason) {
        const intensity = companySize === 'small' ? 'aggressively' : 'strategically';
        recommendation = `Currently in peak season - ${intensity} maximize marketing efforts`;
    } else if (monthsUntilPeak && monthsUntilPeak <= 2) {
        const prep = companySize === 'small' ? 'ramp up campaigns and ensure capacity' : 'optimize campaigns and prepare resources';
        recommendation = `Peak season approaching - ${prep}`;
    } else {
        const focus = companySize === 'small'
            ? 'conserve budget, build brand, and prepare for peak'
            : 'invest in systems, expansion, and brand building';
        recommendation = `Off-peak period - ${focus}`;
    }

    // Calculate expected revenue impact from seasonality
    const expectedImpact = isInPeakSeason
        ? Math.round((sizeConfig.peakAmplification - 1) * 100)
        : signals.seasonality !== 'stable'
            ? Math.round((1 - sizeConfig.offPeakReduction) * 100 * -1)
            : 0;

    return {
        pattern: signals.seasonality,
        currentMonth,
        isInPeakSeason,
        peakMonths: signals.peakMonths,
        nextPeakMonth: nextPeak,
        monthsUntilPeak,
        recommendation,
        companySize: {
            size: companySize,
            label: sizeConfig.label,
            sensitivity: sizeConfig.seasonalSensitivity,
            planningHorizon: sizeConfig.planningHorizon
        },
        expectedRevenueImpact: `${expectedImpact >= 0 ? '+' : ''}${expectedImpact}%`,
        prepTime: sizeConfig.planningHorizon
    };
}

/**
 * Get company size configuration
 *
 * @param {string} size - Company size key
 * @returns {Object} Size configuration
 */
function getCompanySizeConfig(size = 'small') {
    return COMPANY_SIZE_CONFIG[size] || COMPANY_SIZE_CONFIG.small;
}

/**
 * Get all company size options for UI dropdowns
 *
 * @returns {Array} Array of size options with value and label
 */
function getCompanySizeOptions() {
    return Object.entries(COMPANY_SIZE_CONFIG).map(([key, config]) => ({
        value: key,
        label: config.label,
        marketReach: config.marketReach
    }));
}

module.exports = {
    getDemandSignals,
    getSearchKeywords,
    getTrendsGeoCode,
    calculateMomentumScore,
    getSeasonalForecast,
    getCompanySizeConfig,
    getCompanySizeOptions,
    generateSizeBasedRecommendations,
    NAICS_TO_TRENDS_KEYWORDS,
    DEFAULT_DEMAND_SIGNALS,
    STATE_TO_DMA,
    COMPANY_SIZE_CONFIG
};
