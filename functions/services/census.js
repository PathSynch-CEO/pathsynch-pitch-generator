/**
 * Census Bureau API Service
 *
 * Wrapper for US Census Bureau data for demographics
 * Supports ACS 5-year estimates at state, county, and place levels
 */

const axios = require('axios');
const geography = require('./geography');

const CENSUS_BASE_URL = 'https://api.census.gov/data';
const CENSUS_YEAR = 2022; // Most recent complete ACS 5-year data
const DATASET = 'acs/acs5';

/**
 * ACS Variable Codes for demographic queries
 */
const ACS_VARIABLES = {
    // Basic Demographics
    TOTAL_POPULATION: 'B01003_001E',
    MEDIAN_AGE: 'B01002_001E',

    // Household & Housing
    TOTAL_HOUSEHOLDS: 'B25001_001E',
    TOTAL_HOUSING_UNITS: 'B25003_001E',
    OWNER_OCCUPIED: 'B25003_002E',
    RENTER_OCCUPIED: 'B25003_003E',
    MEDIAN_HOME_VALUE: 'B25077_001E',
    MEDIAN_RENT: 'B25064_001E',

    // Income
    MEDIAN_HOUSEHOLD_INCOME: 'B19013_001E',
    MEAN_HOUSEHOLD_INCOME: 'B19025_001E',
    PER_CAPITA_INCOME: 'B19301_001E',

    // Employment
    LABOR_FORCE: 'B23025_002E',
    EMPLOYED: 'B23025_004E',
    UNEMPLOYED: 'B23025_005E',

    // Age Distribution (Males and Females)
    POP_UNDER_5_M: 'B01001_003E',
    POP_5_9_M: 'B01001_004E',
    POP_10_14_M: 'B01001_005E',
    POP_15_17_M: 'B01001_006E',
    POP_18_19_M: 'B01001_007E',
    POP_20_M: 'B01001_008E',
    POP_21_M: 'B01001_009E',
    POP_22_24_M: 'B01001_010E',
    POP_25_29_M: 'B01001_011E',
    POP_30_34_M: 'B01001_012E',
    POP_35_39_M: 'B01001_013E',
    POP_40_44_M: 'B01001_014E',
    POP_45_49_M: 'B01001_015E',
    POP_50_54_M: 'B01001_016E',
    POP_55_59_M: 'B01001_017E',
    POP_60_61_M: 'B01001_018E',
    POP_62_64_M: 'B01001_019E',
    POP_65_66_M: 'B01001_020E',
    POP_67_69_M: 'B01001_021E',
    POP_70_74_M: 'B01001_022E',
    POP_75_79_M: 'B01001_023E',
    POP_80_84_M: 'B01001_024E',
    POP_85_PLUS_M: 'B01001_025E',
    // Female equivalents (add 24 to male index)
    POP_UNDER_5_F: 'B01001_027E',
    POP_25_29_F: 'B01001_035E',
    POP_30_34_F: 'B01001_036E',
    POP_35_39_F: 'B01001_037E',
    POP_40_44_F: 'B01001_038E',
    POP_45_49_F: 'B01001_039E',
    POP_50_54_F: 'B01001_040E',
    POP_55_59_F: 'B01001_041E',
    POP_65_66_F: 'B01001_044E',
    POP_67_69_F: 'B01001_045E',
    POP_70_74_F: 'B01001_046E',
    POP_75_79_F: 'B01001_047E',
    POP_80_84_F: 'B01001_048E',
    POP_85_PLUS_F: 'B01001_049E',

    // Education (Population 25+)
    POP_25_PLUS: 'B15003_001E',
    EDU_LESS_THAN_9TH: 'B15003_002E',
    EDU_9TH_12TH_NO_DIPLOMA: 'B15003_003E',
    EDU_HIGH_SCHOOL: 'B15003_017E',
    EDU_GED: 'B15003_018E',
    EDU_SOME_COLLEGE_LESS_1YR: 'B15003_019E',
    EDU_SOME_COLLEGE_1YR_PLUS: 'B15003_020E',
    EDU_ASSOCIATES: 'B15003_021E',
    EDU_BACHELORS: 'B15003_022E',
    EDU_MASTERS: 'B15003_023E',
    EDU_PROFESSIONAL: 'B15003_024E',
    EDU_DOCTORATE: 'B15003_025E',

    // Commute Mode (Workers 16+)
    WORKERS_16_PLUS: 'B08301_001E',
    COMMUTE_DRIVE_ALONE: 'B08301_003E',
    COMMUTE_CARPOOL: 'B08301_004E',
    COMMUTE_PUBLIC_TRANSIT: 'B08301_010E',
    COMMUTE_WALK: 'B08301_019E',
    COMMUTE_BIKE: 'B08301_018E',
    COMMUTE_WFH: 'B08301_021E',
    COMMUTE_OTHER: 'B08301_020E',

    // Commute Time
    COMMUTE_LESS_10MIN: 'B08303_002E',
    COMMUTE_10_14MIN: 'B08303_003E',
    COMMUTE_15_19MIN: 'B08303_004E',
    COMMUTE_20_24MIN: 'B08303_005E',
    COMMUTE_25_29MIN: 'B08303_006E',
    COMMUTE_30_34MIN: 'B08303_007E',
    COMMUTE_35_44MIN: 'B08303_008E',
    COMMUTE_45_59MIN: 'B08303_009E',
    COMMUTE_60_89MIN: 'B08303_010E',
    COMMUTE_90_PLUS_MIN: 'B08303_011E',
    MEAN_COMMUTE_TIME: 'B08135_001E',

    // Income Distribution
    INCOME_LESS_10K: 'B19001_002E',
    INCOME_10K_15K: 'B19001_003E',
    INCOME_15K_20K: 'B19001_004E',
    INCOME_20K_25K: 'B19001_005E',
    INCOME_25K_30K: 'B19001_006E',
    INCOME_30K_35K: 'B19001_007E',
    INCOME_35K_40K: 'B19001_008E',
    INCOME_40K_45K: 'B19001_009E',
    INCOME_45K_50K: 'B19001_010E',
    INCOME_50K_60K: 'B19001_011E',
    INCOME_60K_75K: 'B19001_012E',
    INCOME_75K_100K: 'B19001_013E',
    INCOME_100K_125K: 'B19001_014E',
    INCOME_125K_150K: 'B19001_015E',
    INCOME_150K_200K: 'B19001_016E',
    INCOME_200K_PLUS: 'B19001_017E'
};

/**
 * Get demographic data for a location
 */
async function getDemographics(state, city = null, zipCode = null) {
    const apiKey = process.env.CENSUS_API_KEY;

    // If no API key, return mock data
    if (!apiKey) {
        console.warn('Census API key not configured, returning estimates');
        return getMockDemographics(state, city);
    }

    try {
        // State FIPS codes
        const stateFips = getStateFips(state);

        if (!stateFips) {
            return getMockDemographics(state, city);
        }

        // Get population and income data from ACS 5-year estimates
        const year = 2022; // Most recent complete data
        const dataset = 'acs/acs5';

        // Variables we want:
        // B01003_001E = Total Population
        // B19013_001E = Median Household Income
        // B25003_001E = Total Housing Units
        // B25003_002E = Owner Occupied Housing Units
        // B23025_002E = Labor Force Population

        const variables = [
            'B01003_001E', // Population
            'B19013_001E', // Median Income
            'B25003_001E', // Total Housing
            'B25003_002E', // Owner Occupied
            'B23025_002E'  // Labor Force
        ].join(',');

        // Query at state level (county/place level requires more complex geocoding)
        const url = `${CENSUS_BASE_URL}/${year}/${dataset}?get=NAME,${variables}&for=state:${stateFips}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return getMockDemographics(state, city);
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varName) => {
            const index = headers.indexOf(varName);
            return index >= 0 ? parseInt(values[index]) || null : null;
        };

        const population = getValue('B01003_001E');
        const medianIncome = getValue('B19013_001E');
        const totalHousing = getValue('B25003_001E');
        const ownerOccupied = getValue('B25003_002E');
        const laborForce = getValue('B23025_002E');

        const homeOwnership = totalHousing && ownerOccupied
            ? Math.round((ownerOccupied / totalHousing) * 100)
            : null;

        return {
            success: true,
            data: {
                population: population,
                medianIncome: medianIncome,
                homeOwnershipRate: homeOwnership,
                laborForce: laborForce,
                totalHousingUnits: totalHousing,
                ownerOccupiedUnits: ownerOccupied,
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: year,
                geography: values[0] // State name
            }
        };

    } catch (error) {
        console.error('Error fetching census data:', error.message);
        return getMockDemographics(state, city);
    }
}

/**
 * Get estimated market size for an industry in a location
 */
function estimateMarketSize(demographics, industry, competitorCount = 0) {
    const population = demographics.population || 100000;
    const medianIncome = demographics.medianIncome || 55000;

    // Industry spending estimates (% of income)
    const industrySpendingRates = {
        'Food & Bev': 0.06,
        'Food & Beverage': 0.06,
        'Restaurant': 0.06,
        'Automotive': 0.08,
        'Health & Wellness': 0.02,
        'Home Services': 0.03,
        'Professional Services': 0.02,
        'Retail': 0.10,
        'Lawn Care': 0.01,
        'Salon': 0.01,
        'Real Estate': 0.05
    };

    const spendingRate = industrySpendingRates[industry] || 0.03;

    // Estimate number of households (assume 2.5 people per household)
    const households = Math.round(population / 2.5);

    // Total addressable market
    const totalMarket = Math.round(households * medianIncome * spendingRate);

    // Market per business (if competitors known)
    const marketPerBusiness = competitorCount > 0
        ? Math.round(totalMarket / (competitorCount + 1))
        : null;

    return {
        totalAddressableMarket: totalMarket,
        estimatedHouseholds: households,
        industrySpendingRate: spendingRate * 100, // As percentage
        marketPerBusiness: marketPerBusiness,
        competitorCount: competitorCount
    };
}

/**
 * Calculate market growth rate estimate
 */
function estimateGrowthRate(industry, demographics) {
    // Base growth rates by industry (national averages)
    const industryGrowthRates = {
        'Food & Bev': 3.5,
        'Food & Beverage': 3.5,
        'Restaurant': 3.5,
        'Automotive': 2.0,
        'Health & Wellness': 5.5,
        'Home Services': 4.0,
        'Professional Services': 3.0,
        'Retail': 2.5,
        'Lawn Care': 4.5,
        'Salon': 3.0,
        'Real Estate': 2.5
    };

    let growthRate = industryGrowthRates[industry] || 3.0;

    // Adjust based on demographics
    if (demographics.medianIncome) {
        if (demographics.medianIncome > 80000) {
            growthRate += 1.0; // Higher income areas grow faster
        } else if (demographics.medianIncome < 40000) {
            growthRate -= 0.5;
        }
    }

    return {
        annualGrowthRate: Math.round(growthRate * 10) / 10,
        projectedGrowth5Year: Math.round(Math.pow(1 + growthRate / 100, 5) * 100 - 100),
        confidence: 'moderate',
        note: 'Based on industry averages and local demographics'
    };
}

/**
 * Get mock demographics when API is unavailable
 */
function getMockDemographics(state, city) {
    // State-level population estimates
    const statePopulations = {
        'California': 39500000, 'Texas': 29500000, 'Florida': 22200000,
        'New York': 19800000, 'Pennsylvania': 13000000, 'Illinois': 12600000,
        'Ohio': 11800000, 'Georgia': 10800000, 'North Carolina': 10700000,
        'Michigan': 10000000
    };

    // State-level median incomes
    const stateIncomes = {
        'California': 84000, 'Texas': 67000, 'Florida': 61000,
        'New York': 75000, 'Pennsylvania': 68000, 'Illinois': 72000,
        'Ohio': 60000, 'Georgia': 65000, 'North Carolina': 60000,
        'Michigan': 63000
    };

    const population = statePopulations[state] || 5000000;
    const income = stateIncomes[state] || 55000;

    // Scale down for city-level estimate
    const cityPopulation = city ? Math.round(population * 0.01) : population;

    return {
        success: true,
        data: {
            population: cityPopulation,
            medianIncome: income,
            homeOwnershipRate: 65,
            laborForce: Math.round(cityPopulation * 0.48),
            totalHousingUnits: Math.round(cityPopulation / 2.5),
            ownerOccupiedUnits: Math.round(cityPopulation / 2.5 * 0.65),
            source: 'Estimated based on state averages',
            year: 2023,
            geography: city ? `${city}, ${state}` : state
        }
    };
}

/**
 * Get state FIPS code (deprecated - use geography.getStateFips)
 */
function getStateFips(state) {
    return geography.getStateFips(state);
}

/**
 * Get demographics at Census Place level (city-level granularity)
 * @param {string} placeFips - 5-digit place FIPS code
 * @param {string} stateFips - 2-digit state FIPS code
 * @returns {Promise<Object>} Demographics data
 */
async function getDemographicsAtPlace(placeFips, stateFips) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !placeFips || !stateFips) {
        return null;
    }

    try {
        const variables = [
            ACS_VARIABLES.TOTAL_POPULATION,
            ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME,
            ACS_VARIABLES.TOTAL_HOUSEHOLDS,
            ACS_VARIABLES.TOTAL_HOUSING_UNITS,
            ACS_VARIABLES.OWNER_OCCUPIED,
            ACS_VARIABLES.LABOR_FORCE,
            ACS_VARIABLES.MEDIAN_AGE,
            ACS_VARIABLES.MEDIAN_HOME_VALUE
        ].join(',');

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=NAME,${variables}&for=place:${placeFips}&in=state:${stateFips}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return null;
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || null : null;
        };

        const totalHousing = getValue(ACS_VARIABLES.TOTAL_HOUSING_UNITS);
        const ownerOccupied = getValue(ACS_VARIABLES.OWNER_OCCUPIED);

        return {
            success: true,
            data: {
                population: getValue(ACS_VARIABLES.TOTAL_POPULATION),
                medianIncome: getValue(ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME),
                households: getValue(ACS_VARIABLES.TOTAL_HOUSEHOLDS),
                totalHousingUnits: totalHousing,
                ownerOccupiedUnits: ownerOccupied,
                homeOwnershipRate: totalHousing && ownerOccupied
                    ? Math.round((ownerOccupied / totalHousing) * 100)
                    : null,
                laborForce: getValue(ACS_VARIABLES.LABOR_FORCE),
                medianAge: getValue(ACS_VARIABLES.MEDIAN_AGE),
                medianHomeValue: getValue(ACS_VARIABLES.MEDIAN_HOME_VALUE),
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR,
                geoLevel: 'place',
                geography: values[0]
            }
        };
    } catch (error) {
        console.error('Error fetching place-level census data:', error.message);
        return null;
    }
}

/**
 * Get demographics at County level
 * @param {string} countyFips - 3-digit county FIPS code
 * @param {string} stateFips - 2-digit state FIPS code
 * @returns {Promise<Object>} Demographics data
 */
async function getDemographicsAtCounty(countyFips, stateFips) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !countyFips || !stateFips) {
        return null;
    }

    try {
        const variables = [
            ACS_VARIABLES.TOTAL_POPULATION,
            ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME,
            ACS_VARIABLES.TOTAL_HOUSEHOLDS,
            ACS_VARIABLES.TOTAL_HOUSING_UNITS,
            ACS_VARIABLES.OWNER_OCCUPIED,
            ACS_VARIABLES.LABOR_FORCE,
            ACS_VARIABLES.MEDIAN_AGE,
            ACS_VARIABLES.MEDIAN_HOME_VALUE
        ].join(',');

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=NAME,${variables}&for=county:${countyFips}&in=state:${stateFips}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return null;
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || null : null;
        };

        const totalHousing = getValue(ACS_VARIABLES.TOTAL_HOUSING_UNITS);
        const ownerOccupied = getValue(ACS_VARIABLES.OWNER_OCCUPIED);

        return {
            success: true,
            data: {
                population: getValue(ACS_VARIABLES.TOTAL_POPULATION),
                medianIncome: getValue(ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME),
                households: getValue(ACS_VARIABLES.TOTAL_HOUSEHOLDS),
                totalHousingUnits: totalHousing,
                ownerOccupiedUnits: ownerOccupied,
                homeOwnershipRate: totalHousing && ownerOccupied
                    ? Math.round((ownerOccupied / totalHousing) * 100)
                    : null,
                laborForce: getValue(ACS_VARIABLES.LABOR_FORCE),
                medianAge: getValue(ACS_VARIABLES.MEDIAN_AGE),
                medianHomeValue: getValue(ACS_VARIABLES.MEDIAN_HOME_VALUE),
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR,
                geoLevel: 'county',
                geography: values[0]
            }
        };
    } catch (error) {
        console.error('Error fetching county-level census data:', error.message);
        return null;
    }
}

/**
 * Get age distribution for a geographic area
 * @param {Object} geo - Geography object from getCensusGeography
 * @returns {Promise<Object>} Age distribution data
 */
async function getAgeDistribution(geo) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !geo.stateFips) {
        return getDefaultAgeDistribution();
    }

    try {
        // Age group variables (sum male + female for each group)
        const variables = [
            'B01001_003E', 'B01001_004E', 'B01001_005E', 'B01001_006E', // Under 18 (M)
            'B01001_027E', 'B01001_028E', 'B01001_029E', 'B01001_030E', // Under 18 (F)
            'B01001_007E', 'B01001_008E', 'B01001_009E', 'B01001_010E', // 18-24 (M)
            'B01001_031E', 'B01001_032E', 'B01001_033E', 'B01001_034E', // 18-24 (F)
            'B01001_011E', 'B01001_012E', // 25-34 (M)
            'B01001_035E', 'B01001_036E', // 25-34 (F)
            'B01001_013E', 'B01001_014E', // 35-44 (M)
            'B01001_037E', 'B01001_038E', // 35-44 (F)
            'B01001_015E', 'B01001_016E', // 45-54 (M)
            'B01001_039E', 'B01001_040E', // 45-54 (F)
            'B01001_017E', 'B01001_018E', 'B01001_019E', // 55-64 (M)
            'B01001_041E', 'B01001_042E', 'B01001_043E', // 55-64 (F)
            'B01001_020E', 'B01001_021E', 'B01001_022E', 'B01001_023E', 'B01001_024E', 'B01001_025E', // 65+ (M)
            'B01001_044E', 'B01001_045E', 'B01001_046E', 'B01001_047E', 'B01001_048E', 'B01001_049E', // 65+ (F)
            ACS_VARIABLES.TOTAL_POPULATION
        ].join(',');

        // Build geography clause
        let geoClause;
        if (geo.placeFips) {
            geoClause = `for=place:${geo.placeFips}&in=state:${geo.stateFips}`;
        } else if (geo.countyFips) {
            geoClause = `for=county:${geo.countyFips}&in=state:${geo.stateFips}`;
        } else {
            geoClause = `for=state:${geo.stateFips}`;
        }

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=${variables}&${geoClause}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return getDefaultAgeDistribution();
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || 0 : 0;
        };

        const totalPop = getValue(ACS_VARIABLES.TOTAL_POPULATION);

        // Calculate age groups
        const under18 = getValue('B01001_003E') + getValue('B01001_004E') + getValue('B01001_005E') + getValue('B01001_006E') +
                       getValue('B01001_027E') + getValue('B01001_028E') + getValue('B01001_029E') + getValue('B01001_030E');

        const age18to24 = getValue('B01001_007E') + getValue('B01001_008E') + getValue('B01001_009E') + getValue('B01001_010E') +
                         getValue('B01001_031E') + getValue('B01001_032E') + getValue('B01001_033E') + getValue('B01001_034E');

        const age25to34 = getValue('B01001_011E') + getValue('B01001_012E') +
                         getValue('B01001_035E') + getValue('B01001_036E');

        const age35to44 = getValue('B01001_013E') + getValue('B01001_014E') +
                         getValue('B01001_037E') + getValue('B01001_038E');

        const age45to54 = getValue('B01001_015E') + getValue('B01001_016E') +
                         getValue('B01001_039E') + getValue('B01001_040E');

        const age55to64 = getValue('B01001_017E') + getValue('B01001_018E') + getValue('B01001_019E') +
                         getValue('B01001_041E') + getValue('B01001_042E') + getValue('B01001_043E');

        const age65plus = getValue('B01001_020E') + getValue('B01001_021E') + getValue('B01001_022E') +
                         getValue('B01001_023E') + getValue('B01001_024E') + getValue('B01001_025E') +
                         getValue('B01001_044E') + getValue('B01001_045E') + getValue('B01001_046E') +
                         getValue('B01001_047E') + getValue('B01001_048E') + getValue('B01001_049E');

        const calcPct = (val) => totalPop > 0 ? Math.round((val / totalPop) * 1000) / 10 : 0;

        return {
            success: true,
            data: {
                totalPopulation: totalPop,
                ageGroups: {
                    under18: { count: under18, percentage: calcPct(under18) },
                    age18to24: { count: age18to24, percentage: calcPct(age18to24) },
                    age25to34: { count: age25to34, percentage: calcPct(age25to34) },
                    age35to44: { count: age35to44, percentage: calcPct(age35to44) },
                    age45to54: { count: age45to54, percentage: calcPct(age45to54) },
                    age55to64: { count: age55to64, percentage: calcPct(age55to64) },
                    age65plus: { count: age65plus, percentage: calcPct(age65plus) }
                },
                workingAge: age25to34 + age35to44 + age45to54,
                workingAgePct: calcPct(age25to34 + age35to44 + age45to54),
                youngProfessionals: age25to34,
                youngProfessionalsPct: calcPct(age25to34),
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching age distribution:', error.message);
        return getDefaultAgeDistribution();
    }
}

/**
 * Get education profile for a geographic area
 * @param {Object} geo - Geography object from getCensusGeography
 * @returns {Promise<Object>} Education data
 */
async function getEducationProfile(geo) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !geo.stateFips) {
        return getDefaultEducationProfile();
    }

    try {
        const variables = [
            ACS_VARIABLES.POP_25_PLUS,
            ACS_VARIABLES.EDU_HIGH_SCHOOL,
            ACS_VARIABLES.EDU_GED,
            ACS_VARIABLES.EDU_SOME_COLLEGE_LESS_1YR,
            ACS_VARIABLES.EDU_SOME_COLLEGE_1YR_PLUS,
            ACS_VARIABLES.EDU_ASSOCIATES,
            ACS_VARIABLES.EDU_BACHELORS,
            ACS_VARIABLES.EDU_MASTERS,
            ACS_VARIABLES.EDU_PROFESSIONAL,
            ACS_VARIABLES.EDU_DOCTORATE
        ].join(',');

        let geoClause;
        if (geo.placeFips) {
            geoClause = `for=place:${geo.placeFips}&in=state:${geo.stateFips}`;
        } else if (geo.countyFips) {
            geoClause = `for=county:${geo.countyFips}&in=state:${geo.stateFips}`;
        } else {
            geoClause = `for=state:${geo.stateFips}`;
        }

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=${variables}&${geoClause}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return getDefaultEducationProfile();
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || 0 : 0;
        };

        const pop25plus = getValue(ACS_VARIABLES.POP_25_PLUS);
        const highSchool = getValue(ACS_VARIABLES.EDU_HIGH_SCHOOL) + getValue(ACS_VARIABLES.EDU_GED);
        const someCollege = getValue(ACS_VARIABLES.EDU_SOME_COLLEGE_LESS_1YR) +
                           getValue(ACS_VARIABLES.EDU_SOME_COLLEGE_1YR_PLUS) +
                           getValue(ACS_VARIABLES.EDU_ASSOCIATES);
        const bachelors = getValue(ACS_VARIABLES.EDU_BACHELORS);
        const graduate = getValue(ACS_VARIABLES.EDU_MASTERS) +
                        getValue(ACS_VARIABLES.EDU_PROFESSIONAL) +
                        getValue(ACS_VARIABLES.EDU_DOCTORATE);

        const calcPct = (val) => pop25plus > 0 ? Math.round((val / pop25plus) * 1000) / 10 : 0;

        const bachelorsPlusPct = calcPct(bachelors + graduate);

        return {
            success: true,
            data: {
                population25Plus: pop25plus,
                levels: {
                    highSchool: { count: highSchool, percentage: calcPct(highSchool) },
                    someCollege: { count: someCollege, percentage: calcPct(someCollege) },
                    bachelors: { count: bachelors, percentage: calcPct(bachelors) },
                    graduate: { count: graduate, percentage: calcPct(graduate) }
                },
                bachelorsPlusCount: bachelors + graduate,
                bachelorsPlusPct: bachelorsPlusPct,
                educationIndex: Math.round(bachelorsPlusPct / 32.9 * 100), // vs national avg ~32.9%
                insight: bachelorsPlusPct > 40
                    ? 'Highly educated population - strong market for professional services'
                    : bachelorsPlusPct > 30
                    ? 'Education level near national average'
                    : 'Education levels below national average',
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching education profile:', error.message);
        return getDefaultEducationProfile();
    }
}

/**
 * Get commute patterns for a geographic area
 * @param {Object} geo - Geography object from getCensusGeography
 * @returns {Promise<Object>} Commute data
 */
async function getCommutePatterns(geo) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !geo.stateFips) {
        return getDefaultCommutePatterns();
    }

    try {
        const variables = [
            ACS_VARIABLES.WORKERS_16_PLUS,
            ACS_VARIABLES.COMMUTE_DRIVE_ALONE,
            ACS_VARIABLES.COMMUTE_CARPOOL,
            ACS_VARIABLES.COMMUTE_PUBLIC_TRANSIT,
            ACS_VARIABLES.COMMUTE_WALK,
            ACS_VARIABLES.COMMUTE_BIKE,
            ACS_VARIABLES.COMMUTE_WFH,
            'B08303_002E', 'B08303_003E', 'B08303_004E', 'B08303_005E', // Commute time buckets
            'B08303_006E', 'B08303_007E', 'B08303_008E', 'B08303_009E', 'B08303_010E', 'B08303_011E'
        ].join(',');

        let geoClause;
        if (geo.placeFips) {
            geoClause = `for=place:${geo.placeFips}&in=state:${geo.stateFips}`;
        } else if (geo.countyFips) {
            geoClause = `for=county:${geo.countyFips}&in=state:${geo.stateFips}`;
        } else {
            geoClause = `for=state:${geo.stateFips}`;
        }

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=${variables}&${geoClause}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return getDefaultCommutePatterns();
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || 0 : 0;
        };

        const totalWorkers = getValue(ACS_VARIABLES.WORKERS_16_PLUS);
        const driveAlone = getValue(ACS_VARIABLES.COMMUTE_DRIVE_ALONE);
        const carpool = getValue(ACS_VARIABLES.COMMUTE_CARPOOL);
        const transit = getValue(ACS_VARIABLES.COMMUTE_PUBLIC_TRANSIT);
        const walk = getValue(ACS_VARIABLES.COMMUTE_WALK);
        const bike = getValue(ACS_VARIABLES.COMMUTE_BIKE);
        const wfh = getValue(ACS_VARIABLES.COMMUTE_WFH);

        const calcPct = (val) => totalWorkers > 0 ? Math.round((val / totalWorkers) * 1000) / 10 : 0;

        // Commute time calculation
        const under15 = getValue('B08303_002E') + getValue('B08303_003E');
        const min15to29 = getValue('B08303_004E') + getValue('B08303_005E') + getValue('B08303_006E');
        const min30to44 = getValue('B08303_007E') + getValue('B08303_008E');
        const min45plus = getValue('B08303_009E') + getValue('B08303_010E') + getValue('B08303_011E');

        // Calculate walkability score (0-100)
        const walkabilityScore = totalWorkers > 0
            ? Math.min(100, Math.round(((walk / totalWorkers * 50) + (transit / totalWorkers * 30) + (bike / totalWorkers * 20)) * 100))
            : 0;

        return {
            success: true,
            data: {
                totalWorkers,
                modes: {
                    driveAlone: { count: driveAlone, percentage: calcPct(driveAlone) },
                    carpool: { count: carpool, percentage: calcPct(carpool) },
                    publicTransit: { count: transit, percentage: calcPct(transit) },
                    walk: { count: walk, percentage: calcPct(walk) },
                    bike: { count: bike, percentage: calcPct(bike) },
                    workFromHome: { count: wfh, percentage: calcPct(wfh) }
                },
                commuteTimes: {
                    under15min: { count: under15, percentage: calcPct(under15) },
                    min15to29: { count: min15to29, percentage: calcPct(min15to29) },
                    min30to44: { count: min30to44, percentage: calcPct(min30to44) },
                    min45plus: { count: min45plus, percentage: calcPct(min45plus) }
                },
                walkabilityScore,
                walkabilityLevel: walkabilityScore >= 70 ? 'high' : walkabilityScore >= 40 ? 'medium' : 'low',
                carDependency: calcPct(driveAlone + carpool),
                wfhRate: calcPct(wfh),
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching commute patterns:', error.message);
        return getDefaultCommutePatterns();
    }
}

/**
 * Get income distribution for a geographic area
 * @param {Object} geo - Geography object from getCensusGeography
 * @returns {Promise<Object>} Income distribution data
 */
async function getIncomeDistribution(geo) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !geo.stateFips) {
        return null;
    }

    try {
        const variables = [
            ACS_VARIABLES.TOTAL_HOUSEHOLDS,
            ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME,
            ACS_VARIABLES.INCOME_LESS_10K,
            ACS_VARIABLES.INCOME_10K_15K,
            ACS_VARIABLES.INCOME_15K_20K,
            ACS_VARIABLES.INCOME_20K_25K,
            ACS_VARIABLES.INCOME_25K_30K,
            ACS_VARIABLES.INCOME_30K_35K,
            ACS_VARIABLES.INCOME_35K_40K,
            ACS_VARIABLES.INCOME_40K_45K,
            ACS_VARIABLES.INCOME_45K_50K,
            ACS_VARIABLES.INCOME_50K_60K,
            ACS_VARIABLES.INCOME_60K_75K,
            ACS_VARIABLES.INCOME_75K_100K,
            ACS_VARIABLES.INCOME_100K_125K,
            ACS_VARIABLES.INCOME_125K_150K,
            ACS_VARIABLES.INCOME_150K_200K,
            ACS_VARIABLES.INCOME_200K_PLUS
        ].join(',');

        let geoClause;
        if (geo.placeFips) {
            geoClause = `for=place:${geo.placeFips}&in=state:${geo.stateFips}`;
        } else if (geo.countyFips) {
            geoClause = `for=county:${geo.countyFips}&in=state:${geo.stateFips}`;
        } else {
            geoClause = `for=state:${geo.stateFips}`;
        }

        const url = `${CENSUS_BASE_URL}/${CENSUS_YEAR}/${DATASET}?get=${variables}&${geoClause}&key=${apiKey}`;

        const response = await axios.get(url);

        if (!response.data || response.data.length < 2) {
            return null;
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (varCode) => {
            const index = headers.indexOf(varCode);
            return index >= 0 ? parseInt(values[index]) || 0 : 0;
        };

        const totalHouseholds = getValue(ACS_VARIABLES.TOTAL_HOUSEHOLDS);
        const calcPct = (val) => totalHouseholds > 0 ? Math.round((val / totalHouseholds) * 1000) / 10 : 0;

        // Aggregate into brackets
        const under35k = getValue(ACS_VARIABLES.INCOME_LESS_10K) + getValue(ACS_VARIABLES.INCOME_10K_15K) +
                        getValue(ACS_VARIABLES.INCOME_15K_20K) + getValue(ACS_VARIABLES.INCOME_20K_25K) +
                        getValue(ACS_VARIABLES.INCOME_25K_30K) + getValue(ACS_VARIABLES.INCOME_30K_35K);

        const range35kto75k = getValue(ACS_VARIABLES.INCOME_35K_40K) + getValue(ACS_VARIABLES.INCOME_40K_45K) +
                             getValue(ACS_VARIABLES.INCOME_45K_50K) + getValue(ACS_VARIABLES.INCOME_50K_60K) +
                             getValue(ACS_VARIABLES.INCOME_60K_75K);

        const range75kto150k = getValue(ACS_VARIABLES.INCOME_75K_100K) + getValue(ACS_VARIABLES.INCOME_100K_125K) +
                              getValue(ACS_VARIABLES.INCOME_125K_150K);

        const over150k = getValue(ACS_VARIABLES.INCOME_150K_200K) + getValue(ACS_VARIABLES.INCOME_200K_PLUS);

        return {
            success: true,
            data: {
                totalHouseholds,
                medianIncome: getValue(ACS_VARIABLES.MEDIAN_HOUSEHOLD_INCOME),
                brackets: {
                    under35k: { count: under35k, percentage: calcPct(under35k) },
                    range35kto75k: { count: range35kto75k, percentage: calcPct(range35kto75k) },
                    range75kto150k: { count: range75kto150k, percentage: calcPct(range75kto150k) },
                    over150k: { count: over150k, percentage: calcPct(over150k) }
                },
                affluenceIndex: Math.round(calcPct(range75kto150k + over150k) / 40 * 100), // vs ~40% national
                source: 'US Census Bureau ACS 5-Year Estimates',
                year: CENSUS_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching income distribution:', error.message);
        return null;
    }
}

/**
 * Default fallbacks for when API is unavailable
 */
function getDefaultAgeDistribution() {
    return {
        success: true,
        data: {
            totalPopulation: null,
            ageGroups: {
                under18: { count: null, percentage: 22.0 },
                age18to24: { count: null, percentage: 9.5 },
                age25to34: { count: null, percentage: 13.5 },
                age35to44: { count: null, percentage: 12.5 },
                age45to54: { count: null, percentage: 12.5 },
                age55to64: { count: null, percentage: 13.0 },
                age65plus: { count: null, percentage: 17.0 }
            },
            source: 'National average estimates',
            year: CENSUS_YEAR
        }
    };
}

function getDefaultEducationProfile() {
    return {
        success: true,
        data: {
            population25Plus: null,
            levels: {
                highSchool: { count: null, percentage: 27.0 },
                someCollege: { count: null, percentage: 28.0 },
                bachelors: { count: null, percentage: 22.0 },
                graduate: { count: null, percentage: 13.0 }
            },
            bachelorsPlusPct: 35.0,
            educationIndex: 100,
            source: 'National average estimates',
            year: CENSUS_YEAR
        }
    };
}

function getDefaultCommutePatterns() {
    return {
        success: true,
        data: {
            totalWorkers: null,
            modes: {
                driveAlone: { count: null, percentage: 76.0 },
                carpool: { count: null, percentage: 9.0 },
                publicTransit: { count: null, percentage: 5.0 },
                walk: { count: null, percentage: 2.5 },
                bike: { count: null, percentage: 0.5 },
                workFromHome: { count: null, percentage: 6.0 }
            },
            walkabilityScore: 25,
            walkabilityLevel: 'low',
            carDependency: 85.0,
            source: 'National average estimates',
            year: CENSUS_YEAR
        }
    };
}

module.exports = {
    getDemographics,
    getDemographicsAtPlace,
    getDemographicsAtCounty,
    getAgeDistribution,
    getEducationProfile,
    getCommutePatterns,
    getIncomeDistribution,
    estimateMarketSize,
    estimateGrowthRate,
    ACS_VARIABLES
};
