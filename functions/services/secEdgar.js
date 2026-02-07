/**
 * SEC EDGAR API Service
 *
 * Fetches public company data from SEC EDGAR for competitor intelligence
 * Free API with 10 requests/second rate limit
 *
 * Data sources:
 * - Company submissions: https://data.sec.gov/submissions/CIK{cik}.json
 * - Company facts (XBRL): https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 */

const https = require('https');
const marketCache = require('./marketCache');

// User agent required by SEC - must include contact info
const USER_AGENT = 'PathSynch/1.0 (contact@pathsynch.com)';

// Common company name to ticker mappings for faster lookup
const KNOWN_TICKERS = {
    // Airlines
    'alaska airlines': 'ALK',
    'alaska air group': 'ALK',
    'alaska air': 'ALK',
    'delta air lines': 'DAL',
    'delta airlines': 'DAL',
    'delta': 'DAL',
    'united airlines': 'UAL',
    'united air lines': 'UAL',
    'united airlines holdings': 'UAL',
    'american airlines': 'AAL',
    'american airlines group': 'AAL',
    'southwest airlines': 'LUV',
    'southwest': 'LUV',
    'jetblue': 'JBLU',
    'jetblue airways': 'JBLU',
    'spirit airlines': 'SAVE',
    'frontier airlines': 'ULCC',
    'frontier group': 'ULCC',
    'hawaiian airlines': 'HA',
    'hawaiian holdings': 'HA',
    'sun country airlines': 'SNCY',
    'sun country': 'SNCY',
    'allegiant travel': 'ALGT',
    'allegiant air': 'ALGT',
    'skywest': 'SKYW',
    'skywest airlines': 'SKYW',
    'republic airways': 'RJET',
    // Cargo/Logistics
    'fedex corporation': 'FDX',
    'amazon': 'AMZN',
    'apple': 'AAPL',
    'microsoft': 'MSFT',
    'google': 'GOOGL',
    'alphabet': 'GOOGL',
    'meta': 'META',
    'facebook': 'META',
    'tesla': 'TSLA',
    'walmart': 'WMT',
    'target': 'TGT',
    'costco': 'COST',
    'home depot': 'HD',
    'lowes': 'LOW',
    'starbucks': 'SBUX',
    'mcdonalds': 'MCD',
    'nike': 'NKE',
    'coca-cola': 'KO',
    'pepsi': 'PEP',
    'pepsico': 'PEP',
    'johnson & johnson': 'JNJ',
    'procter & gamble': 'PG',
    'exxon': 'XOM',
    'exxonmobil': 'XOM',
    'chevron': 'CVX',
    'bank of america': 'BAC',
    'jpmorgan': 'JPM',
    'jp morgan': 'JPM',
    'wells fargo': 'WFC',
    'goldman sachs': 'GS',
    'morgan stanley': 'MS',
    'ups': 'UPS',
    'united parcel service': 'UPS',
    'fedex': 'FDX',
    'boeing': 'BA',
    'lockheed martin': 'LMT',
    'raytheon': 'RTX',
    'general electric': 'GE',
    'general motors': 'GM',
    'ford': 'F',
    'ford motor': 'F'
};

// Ticker to CIK mapping (CIK is zero-padded to 10 digits)
const TICKER_TO_CIK = {};

/**
 * Make an HTTPS request to SEC EDGAR
 * Respects rate limits and includes required User-Agent
 */
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        };

        https.get(url, options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse SEC response: ${e.message}`));
                    }
                } else if (res.statusCode === 404) {
                    resolve(null); // Company not found
                } else {
                    reject(new Error(`SEC API returned ${res.statusCode}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Lookup CIK (Central Index Key) for a company by ticker symbol
 */
async function getCikByTicker(ticker) {
    // Check cache first
    if (TICKER_TO_CIK[ticker]) {
        return TICKER_TO_CIK[ticker];
    }

    try {
        // Fetch the SEC's ticker-to-CIK mapping file
        const url = 'https://www.sec.gov/files/company_tickers.json';
        const data = await makeRequest(url);

        if (data) {
            // Build the mapping
            for (const key in data) {
                const company = data[key];
                const t = company.ticker?.toUpperCase();
                const cik = String(company.cik_str).padStart(10, '0');
                if (t) {
                    TICKER_TO_CIK[t] = cik;
                }
            }

            return TICKER_TO_CIK[ticker.toUpperCase()] || null;
        }
    } catch (error) {
        console.warn('Error fetching SEC ticker mapping:', error.message);
    }

    return null;
}

/**
 * Try to find a ticker for a company name
 */
function findTickerByName(companyName) {
    if (!companyName) return null;

    const normalized = companyName.toLowerCase().trim();

    // Direct match
    if (KNOWN_TICKERS[normalized]) {
        return KNOWN_TICKERS[normalized];
    }

    // Partial match
    for (const [name, ticker] of Object.entries(KNOWN_TICKERS)) {
        if (normalized.includes(name) || name.includes(normalized)) {
            return ticker;
        }
    }

    return null;
}

/**
 * Fetch company submissions (filings list and basic info)
 */
async function getCompanySubmissions(cik) {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

    try {
        return await makeRequest(url);
    } catch (error) {
        console.warn(`Error fetching submissions for CIK ${cik}:`, error.message);
        return null;
    }
}

/**
 * Fetch company facts (XBRL extracted financial data)
 */
async function getCompanyFacts(cik) {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

    try {
        return await makeRequest(url);
    } catch (error) {
        console.warn(`Error fetching facts for CIK ${cik}:`, error.message);
        return null;
    }
}

/**
 * Extract the most recent value for a given XBRL concept
 */
function extractRecentValue(facts, namespace, concept, form = '10-K') {
    try {
        const conceptData = facts?.facts?.[namespace]?.[concept];
        if (!conceptData) return null;

        // Get USD values (most financial data is in USD)
        const units = conceptData.units?.USD || conceptData.units?.shares || conceptData.units?.pure;
        if (!units || units.length === 0) return null;

        // Filter for the specified form and get the most recent
        const relevant = units
            .filter(u => !form || u.form === form)
            .sort((a, b) => new Date(b.end || b.filed) - new Date(a.end || a.filed));

        if (relevant.length === 0) return null;

        return {
            value: relevant[0].val,
            period: relevant[0].end || relevant[0].filed,
            form: relevant[0].form
        };
    } catch (error) {
        return null;
    }
}

/**
 * Calculate year-over-year growth from historical values
 */
function calculateYoYGrowth(facts, namespace, concept) {
    try {
        const conceptData = facts?.facts?.[namespace]?.[concept];
        if (!conceptData) return null;

        const units = conceptData.units?.USD;
        if (!units || units.length < 2) return null;

        // Get annual (10-K) values sorted by date
        const annual = units
            .filter(u => u.form === '10-K' && u.end)
            .sort((a, b) => new Date(b.end) - new Date(a.end));

        if (annual.length < 2) return null;

        const current = annual[0].val;
        const previous = annual[1].val;

        if (!previous || previous === 0) return null;

        const growth = ((current - previous) / Math.abs(previous)) * 100;
        return {
            current,
            previous,
            growth: Math.round(growth * 10) / 10,
            currentPeriod: annual[0].end,
            previousPeriod: annual[1].end
        };
    } catch (error) {
        return null;
    }
}

/**
 * Get comprehensive company intelligence from SEC filings
 */
async function getCompanyIntelligence(companyName) {
    // Check cache first (24 hour TTL)
    const cacheKey = { companyName: companyName.toLowerCase().trim() };
    try {
        const cached = await marketCache.getCached('sec_company', cacheKey);
        if (cached) {
            console.log('SEC cache hit for:', companyName);
            return { ...cached.data, fromCache: true };
        }
    } catch (e) {
        // Cache miss, continue
    }

    // Find ticker
    const ticker = findTickerByName(companyName);
    if (!ticker) {
        return {
            success: false,
            isPublic: false,
            reason: 'Company not found in public company database'
        };
    }

    // Get CIK
    const cik = await getCikByTicker(ticker);
    if (!cik) {
        return {
            success: false,
            isPublic: false,
            ticker,
            reason: 'Could not find SEC CIK for ticker'
        };
    }

    // Fetch submissions and facts in parallel
    const [submissions, facts] = await Promise.all([
        getCompanySubmissions(cik),
        getCompanyFacts(cik)
    ]);

    if (!submissions) {
        return {
            success: false,
            isPublic: true,
            ticker,
            cik,
            reason: 'Could not fetch SEC filings'
        };
    }

    // Extract basic company info
    const companyInfo = {
        name: submissions.name,
        ticker,
        cik,
        sic: submissions.sic,
        sicDescription: submissions.sicDescription,
        stateOfIncorporation: submissions.stateOfIncorporation,
        fiscalYearEnd: submissions.fiscalYearEnd,
        businessAddress: submissions.addresses?.business,
        website: submissions.website
    };

    // Extract financials from XBRL facts
    const financials = {};

    if (facts) {
        // Revenue (try multiple common concepts)
        const revenueConceptOrder = [
            'RevenueFromContractWithCustomerExcludingAssessedTax',
            'Revenues',
            'SalesRevenueNet',
            'RevenueFromContractWithCustomerIncludingAssessedTax'
        ];

        for (const concept of revenueConceptOrder) {
            const revenue = extractRecentValue(facts, 'us-gaap', concept);
            if (revenue) {
                financials.revenue = revenue.value;
                financials.revenuePeriod = revenue.period;

                // Calculate YoY growth
                const growth = calculateYoYGrowth(facts, 'us-gaap', concept);
                if (growth) {
                    financials.revenueGrowth = growth.growth;
                    financials.revenuePrevious = growth.previous;
                }
                break;
            }
        }

        // Net Income
        const netIncome = extractRecentValue(facts, 'us-gaap', 'NetIncomeLoss');
        if (netIncome) {
            financials.netIncome = netIncome.value;
            financials.netIncomePeriod = netIncome.period;

            if (financials.revenue && financials.revenue > 0) {
                financials.netMargin = Math.round((netIncome.value / financials.revenue) * 1000) / 10;
            }
        }

        // Total Assets
        const assets = extractRecentValue(facts, 'us-gaap', 'Assets');
        if (assets) {
            financials.totalAssets = assets.value;
        }

        // Total Liabilities
        const liabilities = extractRecentValue(facts, 'us-gaap', 'Liabilities');
        if (liabilities) {
            financials.totalLiabilities = liabilities.value;
        }

        // Stockholders Equity
        const equity = extractRecentValue(facts, 'us-gaap', 'StockholdersEquity');
        if (equity) {
            financials.stockholdersEquity = equity.value;
        }

        // Operating Income
        const operatingIncome = extractRecentValue(facts, 'us-gaap', 'OperatingIncomeLoss');
        if (operatingIncome) {
            financials.operatingIncome = operatingIncome.value;

            if (financials.revenue && financials.revenue > 0) {
                financials.operatingMargin = Math.round((operatingIncome.value / financials.revenue) * 1000) / 10;
            }
        }

        // Employee count (from DEI namespace)
        const employees = extractRecentValue(facts, 'dei', 'EntityNumberOfEmployees');
        if (employees) {
            financials.employees = employees.value;
        }
    }

    // Get recent filings
    const recentFilings = [];
    if (submissions.filings?.recent) {
        const recent = submissions.filings.recent;
        const count = Math.min(10, recent.form?.length || 0);

        for (let i = 0; i < count; i++) {
            if (['10-K', '10-Q', '8-K'].includes(recent.form[i])) {
                recentFilings.push({
                    form: recent.form[i],
                    filingDate: recent.filingDate[i],
                    description: recent.primaryDocDescription?.[i] || recent.form[i],
                    accessionNumber: recent.accessionNumber[i]
                });
            }
        }
    }

    // Find most recent 10-K for risk factors link
    const latest10K = recentFilings.find(f => f.form === '10-K');

    const result = {
        success: true,
        isPublic: true,
        company: companyInfo,
        financials,
        recentFilings: recentFilings.slice(0, 5),
        latest10K: latest10K ? {
            filingDate: latest10K.filingDate,
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=1`
        } : null,
        fetchedAt: new Date().toISOString()
    };

    // Cache the result
    try {
        await marketCache.setCache('sec_company', cacheKey, result, 24 * 60 * 60 * 1000); // 24 hours
        console.log('Cached SEC data for:', companyName);
    } catch (e) {
        console.warn('Failed to cache SEC data:', e.message);
    }

    return result;
}

/**
 * Format financial value for display (e.g., 10400000000 -> "$10.4B")
 */
function formatFinancialValue(value) {
    if (value === null || value === undefined) return null;

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1e12) {
        return `${sign}$${(absValue / 1e12).toFixed(1)}T`;
    } else if (absValue >= 1e9) {
        return `${sign}$${(absValue / 1e9).toFixed(1)}B`;
    } else if (absValue >= 1e6) {
        return `${sign}$${(absValue / 1e6).toFixed(1)}M`;
    } else if (absValue >= 1e3) {
        return `${sign}$${(absValue / 1e3).toFixed(0)}K`;
    } else {
        return `${sign}$${absValue.toFixed(0)}`;
    }
}

/**
 * Get a summary object suitable for display in competitor cards
 */
function getCompetitorSummary(secData) {
    if (!secData?.success || !secData?.isPublic) {
        return null;
    }

    const { company, financials } = secData;

    return {
        isPublic: true,
        ticker: company.ticker,
        name: company.name,
        industry: company.sicDescription,
        website: company.website || null,

        // Formatted financials
        revenue: formatFinancialValue(financials.revenue),
        revenueRaw: financials.revenue,
        revenueGrowth: financials.revenueGrowth ? `${financials.revenueGrowth > 0 ? '+' : ''}${financials.revenueGrowth}%` : null,
        revenueGrowthRaw: financials.revenueGrowth,

        netIncome: formatFinancialValue(financials.netIncome),
        netMargin: financials.netMargin ? `${financials.netMargin}%` : null,
        operatingMargin: financials.operatingMargin ? `${financials.operatingMargin}%` : null,

        employees: financials.employees ? financials.employees.toLocaleString() : null,
        employeesRaw: financials.employees,

        totalAssets: formatFinancialValue(financials.totalAssets),

        // Metadata
        fiscalYearEnd: company.fiscalYearEnd,
        latestFilingDate: secData.latest10K?.filingDate,
        secUrl: secData.latest10K?.url,

        fetchedAt: secData.fetchedAt
    };
}

/**
 * Enrich an array of competitors with SEC data for public companies
 * Returns enriched competitors with secData field for public companies
 */
async function enrichCompetitorsWithSec(competitors, maxEnrich = 5) {
    if (!competitors || competitors.length === 0) {
        return competitors;
    }

    const enriched = [];
    let enrichCount = 0;

    for (const competitor of competitors) {
        const enrichedCompetitor = { ...competitor };

        // Only try to enrich up to maxEnrich competitors (to manage API calls)
        if (enrichCount < maxEnrich) {
            // Check if this might be a public company
            const ticker = findTickerByName(competitor.name);

            if (ticker) {
                try {
                    const secData = await getCompanyIntelligence(competitor.name);
                    if (secData.success && secData.isPublic) {
                        enrichedCompetitor.secData = getCompetitorSummary(secData);
                        enrichCount++;
                    }
                } catch (error) {
                    console.warn(`Failed to enrich ${competitor.name} with SEC data:`, error.message);
                }
            }
        }

        enriched.push(enrichedCompetitor);
    }

    return enriched;
}

module.exports = {
    getCompanyIntelligence,
    getCompetitorSummary,
    enrichCompetitorsWithSec,
    findTickerByName,
    formatFinancialValue,
    KNOWN_TICKERS
};
