/**
 * County Business Patterns (CBP) Service
 *
 * Wrapper for Census Bureau's CBP API for establishment counts,
 * employment data, and payroll by NAICS code and geography
 */

const axios = require('axios');

const CBP_BASE_URL = 'https://api.census.gov/data';
const CBP_YEAR = 2021; // Most recent complete CBP data

/**
 * Employee size class codes
 */
const SIZE_CLASSES = {
    '210': '1-4 employees',
    '220': '5-9 employees',
    '230': '10-19 employees',
    '241': '20-49 employees',
    '242': '50-99 employees',
    '251': '100-249 employees',
    '252': '250-499 employees',
    '254': '500-999 employees',
    '260': '1000+ employees'
};

/**
 * Get establishment count and employment data for a NAICS code in a county
 *
 * @param {string} naicsCode - 2-6 digit NAICS code
 * @param {string} countyFips - 3-digit county FIPS (within state)
 * @param {string} stateFips - 2-digit state FIPS code
 * @returns {Promise<Object>} Establishment data
 */
async function getEstablishmentCount(naicsCode, countyFips, stateFips) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey) {
        console.warn('Census API key not configured, returning mock CBP data');
        return getMockEstablishmentData(naicsCode);
    }

    if (!naicsCode || !stateFips) {
        return getMockEstablishmentData(naicsCode);
    }

    try {
        // CBP uses NAICS2017 variable names
        const variables = 'NAME,NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN';

        // Build geography clause
        let geoClause;
        if (countyFips) {
            geoClause = `for=county:${countyFips}&in=state:${stateFips}`;
        } else {
            geoClause = `for=state:${stateFips}`;
        }

        const url = `${CBP_BASE_URL}/${CBP_YEAR}/cbp?get=${variables}&${geoClause}&NAICS2017=${naicsCode}&key=${apiKey}`;

        const response = await axios.get(url, { timeout: 10000 });

        if (!response.data || response.data.length < 2) {
            // Try at state level if county returns no data
            if (countyFips) {
                return getEstablishmentCount(naicsCode, null, stateFips);
            }
            return getMockEstablishmentData(naicsCode);
        }

        const headers = response.data[0];
        const values = response.data[1];

        const getValue = (name) => {
            const index = headers.indexOf(name);
            if (index < 0) return null;
            const val = values[index];
            // CBP often uses 'D' for suppressed data
            if (val === 'D' || val === 'S' || val === 'N') return null;
            return parseInt(val) || null;
        };

        const establishments = getValue('ESTAB');
        const employees = getValue('EMP');
        const payroll = getValue('PAYANN'); // In thousands

        return {
            success: true,
            data: {
                naicsCode,
                naicsTitle: values[headers.indexOf('NAICS2017_LABEL')] || null,
                establishmentCount: establishments,
                employeeCount: employees,
                annualPayroll: payroll ? payroll * 1000 : null, // Convert to actual dollars
                avgEmployeesPerEstab: establishments && employees
                    ? Math.round(employees / establishments * 10) / 10
                    : null,
                avgWagePerEmployee: employees && payroll
                    ? Math.round((payroll * 1000) / employees)
                    : null,
                geography: values[headers.indexOf('NAME')],
                geoLevel: countyFips ? 'county' : 'state',
                source: 'US Census Bureau County Business Patterns',
                year: CBP_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching CBP data:', error.message);

        // Try state-level fallback
        if (countyFips) {
            try {
                return await getEstablishmentCount(naicsCode, null, stateFips);
            } catch (fallbackError) {
                console.error('State-level CBP fallback failed:', fallbackError.message);
            }
        }

        return getMockEstablishmentData(naicsCode);
    }
}

/**
 * Get establishment size distribution for a NAICS code in a county
 *
 * @param {string} naicsCode - 2-6 digit NAICS code
 * @param {string} countyFips - 3-digit county FIPS
 * @param {string} stateFips - 2-digit state FIPS code
 * @returns {Promise<Object>} Size distribution data
 */
async function getEstablishmentsBySize(naicsCode, countyFips, stateFips) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !naicsCode || !stateFips) {
        return getMockSizeDistribution();
    }

    try {
        const variables = 'ESTAB,EMPSZES,EMPSZES_LABEL';

        let geoClause;
        if (countyFips) {
            geoClause = `for=county:${countyFips}&in=state:${stateFips}`;
        } else {
            geoClause = `for=state:${stateFips}`;
        }

        const url = `${CBP_BASE_URL}/${CBP_YEAR}/cbp?get=${variables}&${geoClause}&NAICS2017=${naicsCode}&key=${apiKey}`;

        const response = await axios.get(url, { timeout: 10000 });

        if (!response.data || response.data.length < 2) {
            return getMockSizeDistribution();
        }

        const headers = response.data[0];
        const estabIndex = headers.indexOf('ESTAB');
        const sizeCodeIndex = headers.indexOf('EMPSZES');
        const sizeLabelIndex = headers.indexOf('EMPSZES_LABEL');

        const sizeDistribution = {};
        let totalEstablishments = 0;

        for (let i = 1; i < response.data.length; i++) {
            const row = response.data[i];
            const sizeCode = row[sizeCodeIndex];
            const estab = parseInt(row[estabIndex]) || 0;

            if (SIZE_CLASSES[sizeCode]) {
                sizeDistribution[sizeCode] = {
                    label: SIZE_CLASSES[sizeCode],
                    count: estab
                };
                totalEstablishments += estab;
            }
        }

        // Calculate percentages
        for (const code of Object.keys(sizeDistribution)) {
            sizeDistribution[code].percentage = totalEstablishments > 0
                ? Math.round((sizeDistribution[code].count / totalEstablishments) * 1000) / 10
                : 0;
        }

        // Calculate small business percentage (< 20 employees)
        const smallBusiness = (sizeDistribution['210']?.count || 0) +
                             (sizeDistribution['220']?.count || 0) +
                             (sizeDistribution['230']?.count || 0);
        const smallBusinessPct = totalEstablishments > 0
            ? Math.round((smallBusiness / totalEstablishments) * 100)
            : 0;

        return {
            success: true,
            data: {
                naicsCode,
                totalEstablishments,
                sizeDistribution,
                smallBusinessCount: smallBusiness,
                smallBusinessPct,
                insight: smallBusinessPct > 80
                    ? 'Market dominated by small businesses'
                    : smallBusinessPct > 60
                    ? 'Mix of small and mid-size businesses'
                    : 'Significant presence of larger establishments',
                source: 'US Census Bureau County Business Patterns',
                year: CBP_YEAR
            }
        };
    } catch (error) {
        console.error('Error fetching CBP size data:', error.message);
        return getMockSizeDistribution();
    }
}

/**
 * Get establishment trend over multiple years
 *
 * @param {string} naicsCode - 2-6 digit NAICS code
 * @param {string} countyFips - 3-digit county FIPS
 * @param {string} stateFips - 2-digit state FIPS code
 * @param {number[]} years - Array of years to query (default: last 3 available)
 * @returns {Promise<Object>} Trend data
 */
async function getEstablishmentTrend(naicsCode, countyFips, stateFips, years = [2019, 2020, 2021]) {
    const apiKey = process.env.CENSUS_API_KEY;

    if (!apiKey || !naicsCode || !stateFips) {
        return getMockTrendData();
    }

    try {
        const yearlyData = [];

        for (const year of years) {
            try {
                const variables = 'ESTAB,EMP';

                let geoClause;
                if (countyFips) {
                    geoClause = `for=county:${countyFips}&in=state:${stateFips}`;
                } else {
                    geoClause = `for=state:${stateFips}`;
                }

                const url = `${CBP_BASE_URL}/${year}/cbp?get=${variables}&${geoClause}&NAICS2017=${naicsCode}&key=${apiKey}`;

                const response = await axios.get(url, { timeout: 10000 });

                if (response.data && response.data.length >= 2) {
                    const headers = response.data[0];
                    const values = response.data[1];

                    const estab = parseInt(values[headers.indexOf('ESTAB')]) || null;
                    const emp = parseInt(values[headers.indexOf('EMP')]) || null;

                    if (estab !== null) {
                        yearlyData.push({
                            year,
                            establishmentCount: estab,
                            employeeCount: emp
                        });
                    }
                }
            } catch (yearError) {
                console.warn(`CBP data not available for year ${year}:`, yearError.message);
            }
        }

        if (yearlyData.length < 2) {
            return getMockTrendData();
        }

        // Sort by year
        yearlyData.sort((a, b) => a.year - b.year);

        const latest = yearlyData[yearlyData.length - 1];
        const previous = yearlyData[yearlyData.length - 2];
        const oldest = yearlyData[0];

        // Calculate year-over-year change
        const yoyChange = latest.establishmentCount - previous.establishmentCount;
        const yoyGrowthRate = previous.establishmentCount > 0
            ? Math.round(((yoyChange / previous.establishmentCount) * 100) * 10) / 10
            : 0;

        // Calculate CAGR if 3+ years
        let cagr = null;
        if (yearlyData.length >= 3 && oldest.establishmentCount > 0) {
            const yearsSpan = latest.year - oldest.year;
            cagr = Math.round(
                (Math.pow(latest.establishmentCount / oldest.establishmentCount, 1 / yearsSpan) - 1) * 1000
            ) / 10;
        }

        // Trend classification
        let trendLabel;
        if (yoyGrowthRate > 5) trendLabel = 'Rapidly Growing';
        else if (yoyGrowthRate > 2) trendLabel = 'Growing';
        else if (yoyGrowthRate > -2) trendLabel = 'Stable';
        else if (yoyGrowthRate > -5) trendLabel = 'Declining';
        else trendLabel = 'Rapidly Declining';

        return {
            success: true,
            data: {
                naicsCode,
                yearlyData,
                currentCount: latest.establishmentCount,
                previousCount: previous.establishmentCount,
                netChange: yoyChange,
                yoyGrowthRate,
                cagr,
                trendLabel,
                trendDirection: yoyGrowthRate > 0 ? 'up' : yoyGrowthRate < 0 ? 'down' : 'flat',
                dataYears: yearlyData.map(d => d.year),
                interpretation: getTrendInterpretation(trendLabel, yoyChange),
                source: 'US Census Bureau County Business Patterns',
                years: `${oldest.year}-${latest.year}`
            }
        };
    } catch (error) {
        console.error('Error fetching CBP trend data:', error.message);
        return getMockTrendData();
    }
}

/**
 * Get interpretation text for trend
 */
function getTrendInterpretation(trendLabel, netChange) {
    if (trendLabel === 'Rapidly Growing') {
        return `Strong market expansion with ${netChange > 0 ? '+' : ''}${netChange} net new establishments`;
    } else if (trendLabel === 'Growing') {
        return `Healthy market growth indicating opportunity`;
    } else if (trendLabel === 'Stable') {
        return `Mature market with balanced competition`;
    } else if (trendLabel === 'Declining') {
        return `Market contraction - may indicate challenges or consolidation`;
    } else {
        return `Significant market contraction - high-risk environment`;
    }
}

/**
 * Mock data fallbacks
 */
function getMockEstablishmentData(naicsCode) {
    // Industry-specific mock estimates
    const industryEstimates = {
        '722511': { estab: 150, emp: 1200, payroll: 28000000 }, // Restaurants
        '722513': { estab: 200, emp: 1500, payroll: 22000000 }, // Fast food
        '811111': { estab: 80, emp: 320, payroll: 12000000 },   // Auto repair
        '713940': { estab: 25, emp: 200, payroll: 6000000 },    // Gyms
        '812111': { estab: 120, emp: 350, payroll: 8000000 },   // Salons
        '541110': { estab: 90, emp: 180, payroll: 25000000 },   // Lawyers
        '561730': { estab: 60, emp: 180, payroll: 5000000 }     // Landscaping
    };

    const estimate = industryEstimates[naicsCode] || { estab: 50, emp: 200, payroll: 8000000 };

    return {
        success: true,
        data: {
            naicsCode,
            establishmentCount: estimate.estab,
            employeeCount: estimate.emp,
            annualPayroll: estimate.payroll,
            avgEmployeesPerEstab: Math.round(estimate.emp / estimate.estab * 10) / 10,
            avgWagePerEmployee: Math.round(estimate.payroll / estimate.emp),
            source: 'Estimated based on industry averages',
            year: CBP_YEAR,
            isEstimate: true
        }
    };
}

function getMockSizeDistribution() {
    return {
        success: true,
        data: {
            totalEstablishments: 100,
            sizeDistribution: {
                '210': { label: '1-4 employees', count: 45, percentage: 45 },
                '220': { label: '5-9 employees', count: 25, percentage: 25 },
                '230': { label: '10-19 employees', count: 15, percentage: 15 },
                '241': { label: '20-49 employees', count: 10, percentage: 10 },
                '242': { label: '50-99 employees', count: 5, percentage: 5 }
            },
            smallBusinessCount: 85,
            smallBusinessPct: 85,
            source: 'Estimated based on typical distributions',
            year: CBP_YEAR,
            isEstimate: true
        }
    };
}

function getMockTrendData() {
    return {
        success: true,
        data: {
            yearlyData: [
                { year: 2019, establishmentCount: 95 },
                { year: 2020, establishmentCount: 92 },
                { year: 2021, establishmentCount: 100 }
            ],
            currentCount: 100,
            previousCount: 92,
            netChange: 8,
            yoyGrowthRate: 8.7,
            cagr: 2.6,
            trendLabel: 'Growing',
            trendDirection: 'up',
            interpretation: 'Healthy market growth indicating opportunity',
            source: 'Estimated based on typical patterns',
            years: '2019-2021',
            isEstimate: true
        }
    };
}

module.exports = {
    getEstablishmentCount,
    getEstablishmentsBySize,
    getEstablishmentTrend,
    SIZE_CLASSES,
    CBP_YEAR
};
