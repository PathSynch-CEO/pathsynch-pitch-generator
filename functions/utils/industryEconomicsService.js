'use strict';

/**
 * Industry & Labor Economics Service
 *
 * Provides county-level industry employment, wages, and establishment data
 * from BLS QCEW (Quarterly Census of Employment and Wages).
 *
 * Data source: BLS QCEW annual CSV files (free, no API key required)
 * URL pattern: https://data.bls.gov/cew/data/api/{year}/a/area/{FIPS5}.csv
 *
 * Data includes over-the-year (OTY) change fields in each row, so one
 * year's CSV contains both current and prior-year comparison data.
 *
 * Cache: Firestore `industryEconomicsCache/{fips}_{naics}` — 90-day TTL
 * County lookup: city+state → 5-digit FIPS via CITY_TO_FIPS map
 * NAICS mapping: category text → 4-digit NAICS code via regex rules
 *
 * Graceful degradation: returns null for unknown counties or suppressed data.
 */

const admin = require('firebase-admin');

const CACHE_COLLECTION = 'industryEconomicsCache';
const CACHE_TTL_MS     = 90 * 24 * 60 * 60 * 1000; // 90 days

// ─── City → County FIPS (5-digit) ─────────────────────────────────────────
// Covers major US metros. Extend as new markets are added.
const CITY_TO_FIPS = {
    // Georgia — Atlanta MSA
    'atlanta,ga':         '13121', 'buckhead,ga':       '13121',
    'midtown,ga':         '13121', 'sandy springs,ga':  '13121',
    'dunwoody,ga':        '13121', 'alpharetta,ga':     '13121',
    'johns creek,ga':     '13121', 'roswell,ga':        '13121',
    'brookhaven,ga':      '13089', 'decatur,ga':        '13089',
    'stone mountain,ga':  '13089', 'tucker,ga':         '13089',
    'marietta,ga':        '13067', 'smyrna,ga':         '13067',
    'kennesaw,ga':        '13067', 'acworth,ga':        '13067',
    'lawrenceville,ga':   '13135', 'duluth,ga':         '13135',
    'norcross,ga':        '13135', 'suwanee,ga':        '13135',
    'cumming,ga':         '13117', 'canton,ga':         '13057',
    'peachtree city,ga':  '13113', 'newnan,ga':         '13097',
    'stockbridge,ga':     '13151', 'mcdonough,ga':      '13151',
    'college park,ga':    '13063', 'jonesboro,ga':      '13063',
    'conyers,ga':         '13247', 'gainesville,ga':    '13139',
    'rome,ga':            '13295', 'columbus,ga':       '13215',
    'savannah,ga':        '13051', 'macon,ga':          '13021',
    'augusta,ga':         '13245', 'warner robins,ga':  '13153',
    'athens,ga':          '13195', 'valdosta,ga':       '13185',
    // Texas
    'houston,tx':         '48201', 'dallas,tx':         '48113',
    'austin,tx':          '48453', 'san antonio,tx':    '48029',
    'fort worth,tx':      '48439', 'plano,tx':          '48085',
    'frisco,tx':          '48085', 'mckinney,tx':       '48085',
    'arlington,tx':       '48439', 'irving,tx':         '48113',
    'garland,tx':         '48113', 'el paso,tx':        '48141',
    // Florida
    'miami,fl':           '12086', 'orlando,fl':        '12095',
    'tampa,fl':           '12057', 'jacksonville,fl':   '12031',
    'ft lauderdale,fl':   '12011', 'fort lauderdale,fl':'12011',
    'boca raton,fl':      '12099', 'palm beach,fl':     '12099',
    'clearwater,fl':      '12103', 'st petersburg,fl':  '12103',
    // California
    'los angeles,ca':     '06037', 'san diego,ca':      '06073',
    'san francisco,ca':   '06075', 'san jose,ca':       '06085',
    'sacramento,ca':      '06067', 'fresno,ca':         '06019',
    'irvine,ca':          '06059', 'anaheim,ca':        '06059',
    'long beach,ca':      '06037', 'riverside,ca':      '06065',
    // New York
    'new york,ny':        '36061', 'brooklyn,ny':       '36047',
    'queens,ny':          '36081', 'bronx,ny':          '36005',
    'staten island,ny':   '36085', 'buffalo,ny':        '36029',
    // Illinois
    'chicago,il':         '17031', 'naperville,il':     '17043',
    'aurora,il':          '17089', 'joliet,il':         '17197',
    // North Carolina
    'charlotte,nc':       '37119', 'raleigh,nc':        '37183',
    'durham,nc':          '37063', 'greensboro,nc':     '37081',
    // Arizona
    'phoenix,az':         '04013', 'scottsdale,az':     '04013',
    'tempe,az':           '04013', 'mesa,az':           '04013',
    'chandler,az':        '04013', 'gilbert,az':        '04013',
    'tucson,az':          '04019',
    // Colorado
    'denver,co':          '08031', 'aurora,co':         '08005',
    'boulder,co':         '08013', 'lakewood,co':       '08059',
    // Washington
    'seattle,wa':         '53033', 'bellevue,wa':       '53033',
    'tacoma,wa':          '53053', 'spokane,wa':        '53063',
    // Tennessee
    'nashville,tn':       '47037', 'memphis,tn':        '47157',
    'knoxville,tn':       '47093', 'chattanooga,tn':    '47065',
    // Virginia
    'virginia beach,va':  '51810', 'richmond,va':       '51760',
    'arlington,va':       '51013', 'alexandria,va':     '51510',
    // Ohio
    'columbus,oh':        '39049', 'cleveland,oh':      '39035',
    'cincinnati,oh':      '39061', 'dayton,oh':         '39113',
    // Pennsylvania
    'philadelphia,pa':    '42101', 'pittsburgh,pa':     '42003',
    // Michigan
    'detroit,mi':         '26163', 'grand rapids,mi':   '26081',
    // Massachusetts
    'boston,ma':          '25025',
    // Maryland/DC Metro
    'baltimore,md':       '24510', 'bethesda,md':       '24031',
    'silver spring,md':   '24031',
    // Nevada
    'las vegas,nv':       '32003', 'henderson,nv':      '32003',
    // Minnesota
    'minneapolis,mn':     '27053',
    // Missouri
    'st louis,mo':        '29189',
    // Oregon
    'portland,or':        '41051',
    // Indiana
    'indianapolis,in':    '18097',
    // Wisconsin
    'milwaukee,wi':       '55079',
};

// State → state-level FIPS (fallback when county unknown)
const STATE_FIPS = {
    'AL':'01000','AK':'02000','AZ':'04000','AR':'05000','CA':'06000',
    'CO':'08000','CT':'09000','DE':'10000','FL':'12000','GA':'13000',
    'HI':'15000','ID':'16000','IL':'17000','IN':'18000','IA':'19000',
    'KS':'20000','KY':'21000','LA':'22000','ME':'23000','MD':'24000',
    'MA':'25000','MI':'26000','MN':'27000','MS':'28000','MO':'29000',
    'MT':'30000','NE':'31000','NV':'32000','NH':'33000','NJ':'34000',
    'NM':'35000','NY':'36000','NC':'37000','ND':'38000','OH':'39000',
    'OK':'40000','OR':'41000','PA':'42000','RI':'44000','SC':'45000',
    'SD':'46000','TN':'47000','TX':'48000','UT':'49000','VT':'50000',
    'VA':'51000','WA':'53000','WV':'54000','WI':'55000','WY':'56000',
    'DC':'11000'
};

// ─── NAICS Mapping ─────────────────────────────────────────────────────────
// Returns { code, label, agglvlCode } for the closest NAICS match.
// agglvlCode: 75 = 4-digit, 74 = 3-digit, 71 = county total private
function mapToNAICS(category) {
    const c = (category || '').toLowerCase();

    if (/restaurant|dining|food service|pizza|burger|sushi|bbq|taco|sandwich|diner|bistro|eatery|catering/.test(c))
        return { code: '7225', label: 'Restaurants and Eating Places',        agglvlCode: '75' };
    if (/cafe|coffee|espresso|juice bar|smoothie/.test(c))
        return { code: '7225', label: 'Restaurants and Eating Places',        agglvlCode: '75' };
    if (/bar|pub|brewery|winery|tavern|nightclub|cocktail/.test(c))
        return { code: '7224', label: 'Drinking Places',                      agglvlCode: '75' };
    if (/bakery|donut|dessert|pastry/.test(c))
        return { code: '3118', label: 'Bakeries',                             agglvlCode: '75' };
    if (/hvac|heat|cool|air condition|furnace|boiler/.test(c))
        return { code: '2382', label: 'Building Equipment Contractors',        agglvlCode: '75' };
    if (/plumb/.test(c))
        return { code: '2382', label: 'Building Equipment Contractors',        agglvlCode: '75' };
    if (/electric(?!al appliance)/.test(c))
        return { code: '2382', label: 'Building Equipment Contractors',        agglvlCode: '75' };
    if (/roof/.test(c))
        return { code: '2381', label: 'Foundation and Exterior Contractors',   agglvlCode: '75' };
    if (/paint(?! store)/.test(c))
        return { code: '2383', label: 'Building Finishing Contractors',        agglvlCode: '75' };
    if (/landscap|lawn|garden|tree service|irrigation/.test(c))
        return { code: '5617', label: 'Services to Buildings and Dwellings',   agglvlCode: '75' };
    if (/clean|janitorial|maid|housekeep|pressure wash/.test(c))
        return { code: '5617', label: 'Services to Buildings and Dwellings',   agglvlCode: '75' };
    if (/pest|extermin/.test(c))
        return { code: '5617', label: 'Services to Buildings and Dwellings',   agglvlCode: '75' };
    if (/dentist|dental|orthodont|periodont|endodont/.test(c))
        return { code: '6212', label: 'Offices of Dentists',                   agglvlCode: '75' };
    if (/physician|doctor|md |medical center|urgent care|family practice/.test(c))
        return { code: '6211', label: 'Offices of Physicians',                 agglvlCode: '75' };
    if (/chiropract|physical therap|pt |optometrist|eye care|acupuncture|dermatolog/.test(c))
        return { code: '6213', label: 'Other Health Practitioners',            agglvlCode: '75' };
    if (/salon|barber|hair|nail|spa|beauty|wax|threading|lash/.test(c))
        return { code: '8121', label: 'Personal Care Services',                agglvlCode: '75' };
    if (/gym|fitness|yoga|pilates|crossfit|martial art|boxing|cycling|boot camp/.test(c))
        return { code: '7139', label: 'Fitness and Recreational Sports',       agglvlCode: '75' };
    if (/auto|car |vehicle|tire|brake|transmiss|detailing|oil change|collision/.test(c))
        return { code: '8111', label: 'Automotive Repair and Maintenance',     agglvlCode: '75' };
    if (/car dealer|auto dealer|car sales/.test(c))
        return { code: '4411', label: 'Automobile Dealers',                    agglvlCode: '75' };
    if (/law firm|attorney|legal/.test(c))
        return { code: '5411', label: 'Legal Services',                        agglvlCode: '75' };
    if (/account|bookkeep|cpa|tax preparer/.test(c))
        return { code: '5412', label: 'Accounting Services',                   agglvlCode: '75' };
    if (/real estate|realtor|property management/.test(c))
        return { code: '5312', label: 'Real Estate',                           agglvlCode: '75' };
    if (/hotel|motel|inn|lodging|bed and breakfast/.test(c))
        return { code: '7211', label: 'Hotels and Motels',                     agglvlCode: '75' };
    if (/childcare|daycare|preschool|nursery/.test(c))
        return { code: '6244', label: 'Child Day Care Services',               agglvlCode: '75' };
    if (/grocery|supermarket|food store/.test(c))
        return { code: '4451', label: 'Grocery Stores',                        agglvlCode: '75' };
    if (/pharmacy|drug store/.test(c))
        return { code: '4461', label: 'Health and Personal Care Stores',       agglvlCode: '75' };
    if (/retail|boutique|clothing|apparel|shoe/.test(c))
        return { code: '44',   label: 'Retail Trade',                          agglvlCode: '73' };

    // Default: county total private employment
    return { code: '10',  label: 'Total All Industries',                       agglvlCode: '71' };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Get industry economics data for a prospect location and category.
 *
 * @param {Object} location  - { city, state, county? }
 * @param {string} category  - Business category/industry string
 * @param {Object} reportData - Full report data (for zip demographics county fallback)
 * @returns {Promise<Object|null>}
 */
async function getIndustryEconomics(location, category, reportData) {
    const city  = (location.city  || '').toLowerCase().trim();
    const state = (location.state || '').toUpperCase().trim();

    // Determine county FIPS — try multiple sources
    let fips       = null;
    let countyLabel = '';
    let isStateFallback = false;

    // 1. Try county from ZIP demographics (if Prompt 2 enrichment ran)
    const zipCounty = reportData?.zipDemographics?.county || reportData?.data?.zipDemographics?.county;
    if (zipCounty && state) {
        const lookupKey = `${zipCounty.toLowerCase()},${state}`;
        fips = CITY_TO_FIPS[lookupKey];
        if (fips) countyLabel = zipCounty;
    }

    // 2. Try city → county lookup
    if (!fips && city && state) {
        const key = `${city},${state}`;
        fips = CITY_TO_FIPS[key];
        if (fips) {
            // Derive a county label from the FIPS
            countyLabel = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
    }

    // 3. Fall back to state-level data
    if (!fips && state) {
        fips = STATE_FIPS[state];
        isStateFallback = true;
        countyLabel = state;
        console.log(`[IndustryEcon] No county FIPS for ${city},${state} — using state-level FIPS ${fips}`);
    }

    if (!fips) {
        console.warn(`[IndustryEcon] No FIPS mapping available — skipping`);
        return null;
    }

    const naicsInfo = mapToNAICS(category);
    const cacheKey  = `${fips}_${naicsInfo.code}`;

    // Cache check
    const cached = await checkCache(cacheKey);
    if (cached) {
        console.log(`[IndustryEcon] Cache hit: ${cacheKey}`);
        return cached;
    }

    // Fetch QCEW data
    const economicsData = await fetchQCEWData(fips, naicsInfo, isStateFallback, countyLabel, state);
    if (!economicsData) return null;

    // Write to cache
    await writeCache(cacheKey, economicsData);

    return economicsData;
}

// ─── BLS QCEW CSV Fetch ─────────────────────────────────────────────────────

async function fetchQCEWData(fips, naicsInfo, isStateFallback, countyLabel, state) {
    // Try most recent available year (BLS has ~9-month lag)
    const currentYear = new Date().getFullYear();
    const yearsToTry  = [currentYear - 1, currentYear - 2, currentYear - 3];

    for (const year of yearsToTry) {
        try {
            const url = `https://data.bls.gov/cew/data/api/${year}/a/area/${fips}.csv`;
            console.log(`[IndustryEcon] Fetching QCEW CSV: ${url}`);

            const res = await Promise.race([
                fetch(url, {
                    headers: {
                        'Accept': 'text/csv',
                        'User-Agent': 'SynchIntro-MarketIntel/1.0'
                    }
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))
            ]);

            if (!res.ok) {
                console.warn(`[IndustryEcon] BLS returned ${res.status} for year ${year}`);
                continue;
            }

            const csvText = await res.text();
            if (!csvText || csvText.length < 100) {
                console.warn(`[IndustryEcon] Empty CSV for year ${year}`);
                continue;
            }

            const result = parseQCEWCSV(csvText, naicsInfo, year, isStateFallback, countyLabel, state);
            if (result) {
                console.log(`[IndustryEcon] Parsed ${year} data: ${naicsInfo.code} / ${naicsInfo.label} — ${result.metrics.localEmployment} jobs`);
                return result;
            }

            // No matching rows found — don't try earlier years for the same data
            console.warn(`[IndustryEcon] No matching rows for NAICS ${naicsInfo.code} in ${year} data`);
            return null;

        } catch (err) {
            console.warn(`[IndustryEcon] Year ${year} fetch failed: ${err.message}`);
            continue;
        }
    }

    return null;
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────

function parseQCEWCSV(csvText, naicsInfo, year, isStateFallback, countyLabel, state) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // Required columns
    const required = ['industry_code', 'own_code', 'agglvl_code', 'disclosure_code',
        'annual_avg_estabs', 'annual_avg_emplvl', 'annual_avg_wkly_wage',
        'oty_annual_avg_emplvl_pct_chg', 'oty_annual_avg_wkly_wage_pct_chg',
        'oty_annual_avg_estabs_pct_chg'];

    for (const col of required) {
        if (colIdx[col] === undefined) {
            console.warn(`[IndustryEcon] Missing CSV column: ${col}`);
            return null;
        }
    }

    const getVal = (row, col) => {
        const v = (row[colIdx[col]] || '').trim().replace(/^"|"$/g, '');
        return v;
    };

    // Parse all rows into objects for filtering
    const rows = lines.slice(1).map(line => {
        const parts = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        return {
            industry_code:                parts[colIdx['industry_code']]  || '',
            own_code:                     parts[colIdx['own_code']]        || '',
            agglvl_code:                  parts[colIdx['agglvl_code']]     || '',
            disclosure_code:              parts[colIdx['disclosure_code']] || '',
            annual_avg_estabs:            parts[colIdx['annual_avg_estabs']]            || '',
            annual_avg_emplvl:            parts[colIdx['annual_avg_emplvl']]            || '',
            annual_avg_wkly_wage:         parts[colIdx['annual_avg_wkly_wage']]         || '',
            oty_annual_avg_emplvl_pct_chg:  parts[colIdx['oty_annual_avg_emplvl_pct_chg']]  || '',
            oty_annual_avg_wkly_wage_pct_chg: parts[colIdx['oty_annual_avg_wkly_wage_pct_chg']] || '',
            oty_annual_avg_estabs_pct_chg:  parts[colIdx['oty_annual_avg_estabs_pct_chg']]  || '',
            lq_annual_avg_emplvl:         parts[colIdx['lq_annual_avg_emplvl'] || -1]   || ''
        };
    });

    // Find the target row: own_code=5 (private), matching NAICS + agglvl
    let targetRow = findRow(rows, naicsInfo.code, naicsInfo.agglvlCode, '5');

    // If 4-digit NAICS is suppressed or not found, try the parent 3-digit
    if (!targetRow && naicsInfo.agglvlCode === '75') {
        const parent3 = naicsInfo.code.slice(0, 3);
        targetRow = findRow(rows, parent3, '74', '5');
        if (targetRow) console.log(`[IndustryEcon] Fell back to 3-digit NAICS ${parent3}`);
    }

    // Still not found — try county total private (agglvl=71, industry=10)
    if (!targetRow) {
        targetRow = findRow(rows, '10', '71', '5');
        if (targetRow) console.log('[IndustryEcon] Fell back to county total private');
    }

    if (!targetRow) return null;

    // Extract and parse metrics
    const estabs  = parseInt(targetRow.annual_avg_estabs)  || 0;
    const emplvl  = parseInt(targetRow.annual_avg_emplvl)  || 0;
    const wage    = parseInt(targetRow.annual_avg_wkly_wage) || 0;

    const emplPct   = parseFloat(targetRow.oty_annual_avg_emplvl_pct_chg)   || null;
    const wagePct   = parseFloat(targetRow.oty_annual_avg_wkly_wage_pct_chg) || null;
    const estabsPct = parseFloat(targetRow.oty_annual_avg_estabs_pct_chg)   || null;

    // Location quotient for employment (LQ > 1 = above-average concentration)
    const lqEmpl = parseFloat(targetRow.lq_annual_avg_emplvl) || null;

    // Trend classification
    const emplTrend   = classifyTrend(emplPct);
    const wageTrend   = classifyWageTrend(wagePct);
    const estabsTrend = classifyTrend(estabsPct);

    // Annual pay
    const annualPay = wage ? wage * 52 : 0;

    return {
        status:      'complete',
        dataYear:    year,
        naicsCode:   naicsInfo.code,
        naicsLabel:  naicsInfo.label,
        county:      countyLabel,
        state,
        isStateFallback,
        metrics: {
            localEmployment:          emplvl  > 0 ? emplvl  : null,
            employmentTrend:          emplTrend,
            employmentChangePct:      emplPct,
            averageWeeklyWage:        wage    > 0 ? wage    : null,
            annualPay:                annualPay > 0 ? annualPay : null,
            wageTrend,
            wageChangePct:            wagePct,
            establishments:           estabs  > 0 ? estabs  : null,
            establishmentTrend:       estabsTrend,
            establishmentChangePct:   estabsPct,
            locationQuotient:         lqEmpl
        },
        narratives: null  // filled by industryEconomicsNarrative.js
    };
}

function findRow(rows, industryCode, agglvlCode, ownCode) {
    const match = rows.find(r =>
        r.industry_code === industryCode &&
        r.agglvl_code   === agglvlCode   &&
        r.own_code      === ownCode       &&
        r.disclosure_code !== 'N'        // skip suppressed data
    );
    return match || null;
}

// ─── Trend Classifiers ─────────────────────────────────────────────────────

function classifyTrend(pctChange) {
    if (pctChange === null || pctChange === undefined || isNaN(pctChange)) return 'unknown';
    if (pctChange >  2) return 'growing';
    if (pctChange < -2) return 'declining';
    return 'flat';
}

function classifyWageTrend(pctChange) {
    if (pctChange === null || pctChange === undefined || isNaN(pctChange)) return 'unknown';
    if (pctChange >  3) return 'rising fast';
    if (pctChange >  1) return 'rising';
    if (pctChange < -1) return 'falling';
    return 'stable';
}

// ─── Cache Helpers ─────────────────────────────────────────────────────────

async function checkCache(cacheKey) {
    try {
        const db  = admin.firestore();
        const doc = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
        if (!doc.exists) return null;

        const data    = doc.data();
        const expires = data.expiresAt?.toDate?.();
        if (expires && expires < new Date()) return null;

        return data.economics || null;
    } catch (err) {
        console.warn('[IndustryEcon] Cache read failed:', err.message);
        return null;
    }
}

async function writeCache(cacheKey, economics) {
    try {
        const db = admin.firestore();
        await db.collection(CACHE_COLLECTION).doc(cacheKey).set({
            economics,
            cacheKey,
            cachedAt:  admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + CACHE_TTL_MS))
        });
    } catch (err) {
        console.warn('[IndustryEcon] Cache write failed:', err.message);
    }
}

module.exports = { getIndustryEconomics };
