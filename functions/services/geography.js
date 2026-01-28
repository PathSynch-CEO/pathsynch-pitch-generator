/**
 * Geography Service
 *
 * Provides FIPS code lookups and geographic resolution for Census queries
 */

/**
 * State FIPS codes mapping (name and abbreviation to FIPS)
 */
const STATE_FIPS = {
    // Full names
    'Alabama': '01', 'Alaska': '02', 'Arizona': '04', 'Arkansas': '05',
    'California': '06', 'Colorado': '08', 'Connecticut': '09', 'Delaware': '10',
    'District of Columbia': '11', 'Florida': '12', 'Georgia': '13', 'Hawaii': '15',
    'Idaho': '16', 'Illinois': '17', 'Indiana': '18', 'Iowa': '19',
    'Kansas': '20', 'Kentucky': '21', 'Louisiana': '22', 'Maine': '23',
    'Maryland': '24', 'Massachusetts': '25', 'Michigan': '26', 'Minnesota': '27',
    'Mississippi': '28', 'Missouri': '29', 'Montana': '30', 'Nebraska': '31',
    'Nevada': '32', 'New Hampshire': '33', 'New Jersey': '34', 'New Mexico': '35',
    'New York': '36', 'North Carolina': '37', 'North Dakota': '38', 'Ohio': '39',
    'Oklahoma': '40', 'Oregon': '41', 'Pennsylvania': '42', 'Rhode Island': '44',
    'South Carolina': '45', 'South Dakota': '46', 'Tennessee': '47', 'Texas': '48',
    'Utah': '49', 'Vermont': '50', 'Virginia': '51', 'Washington': '53',
    'West Virginia': '54', 'Wisconsin': '55', 'Wyoming': '56',
    // Abbreviations
    'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06', 'CO': '08',
    'CT': '09', 'DE': '10', 'DC': '11', 'FL': '12', 'GA': '13', 'HI': '15',
    'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19', 'KS': '20', 'KY': '21',
    'LA': '22', 'ME': '23', 'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27',
    'MS': '28', 'MO': '29', 'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33',
    'NJ': '34', 'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39',
    'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45', 'SD': '46',
    'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50', 'VA': '51', 'WA': '53',
    'WV': '54', 'WI': '55', 'WY': '56'
};

/**
 * State abbreviation to full name mapping
 */
const STATE_ABBR_TO_NAME = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
    'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
    'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
    'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
    'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
};

/**
 * Major cities lookup table with county and place FIPS codes
 * Format: 'city,state' -> { countyFips, placeFips, cbsaCode }
 * Note: County FIPS is 3-digit (within state), Place FIPS is 5-digit
 */
const MAJOR_CITIES = {
    // Texas
    'austin,texas': { countyFips: '453', placeFips: '05000', cbsaCode: '12420' },
    'austin,tx': { countyFips: '453', placeFips: '05000', cbsaCode: '12420' },
    'houston,texas': { countyFips: '201', placeFips: '35000', cbsaCode: '26420' },
    'houston,tx': { countyFips: '201', placeFips: '35000', cbsaCode: '26420' },
    'dallas,texas': { countyFips: '113', placeFips: '19000', cbsaCode: '19100' },
    'dallas,tx': { countyFips: '113', placeFips: '19000', cbsaCode: '19100' },
    'san antonio,texas': { countyFips: '029', placeFips: '65000', cbsaCode: '41700' },
    'san antonio,tx': { countyFips: '029', placeFips: '65000', cbsaCode: '41700' },
    'fort worth,texas': { countyFips: '439', placeFips: '27000', cbsaCode: '19100' },
    'fort worth,tx': { countyFips: '439', placeFips: '27000', cbsaCode: '19100' },
    'el paso,texas': { countyFips: '141', placeFips: '24000', cbsaCode: '21340' },
    'el paso,tx': { countyFips: '141', placeFips: '24000', cbsaCode: '21340' },
    'arlington,texas': { countyFips: '439', placeFips: '04000', cbsaCode: '19100' },
    'arlington,tx': { countyFips: '439', placeFips: '04000', cbsaCode: '19100' },
    'plano,texas': { countyFips: '085', placeFips: '58016', cbsaCode: '19100' },
    'plano,tx': { countyFips: '085', placeFips: '58016', cbsaCode: '19100' },

    // California
    'los angeles,california': { countyFips: '037', placeFips: '44000', cbsaCode: '31080' },
    'los angeles,ca': { countyFips: '037', placeFips: '44000', cbsaCode: '31080' },
    'san diego,california': { countyFips: '073', placeFips: '66000', cbsaCode: '41740' },
    'san diego,ca': { countyFips: '073', placeFips: '66000', cbsaCode: '41740' },
    'san jose,california': { countyFips: '085', placeFips: '68000', cbsaCode: '41940' },
    'san jose,ca': { countyFips: '085', placeFips: '68000', cbsaCode: '41940' },
    'san francisco,california': { countyFips: '075', placeFips: '67000', cbsaCode: '41860' },
    'san francisco,ca': { countyFips: '075', placeFips: '67000', cbsaCode: '41860' },
    'fresno,california': { countyFips: '019', placeFips: '27000', cbsaCode: '23420' },
    'fresno,ca': { countyFips: '019', placeFips: '27000', cbsaCode: '23420' },
    'sacramento,california': { countyFips: '067', placeFips: '64000', cbsaCode: '40900' },
    'sacramento,ca': { countyFips: '067', placeFips: '64000', cbsaCode: '40900' },
    'oakland,california': { countyFips: '001', placeFips: '53000', cbsaCode: '41860' },
    'oakland,ca': { countyFips: '001', placeFips: '53000', cbsaCode: '41860' },
    'long beach,california': { countyFips: '037', placeFips: '43000', cbsaCode: '31080' },
    'long beach,ca': { countyFips: '037', placeFips: '43000', cbsaCode: '31080' },

    // New York
    'new york,new york': { countyFips: '061', placeFips: '51000', cbsaCode: '35620' },
    'new york,ny': { countyFips: '061', placeFips: '51000', cbsaCode: '35620' },
    'new york city,new york': { countyFips: '061', placeFips: '51000', cbsaCode: '35620' },
    'new york city,ny': { countyFips: '061', placeFips: '51000', cbsaCode: '35620' },
    'buffalo,new york': { countyFips: '029', placeFips: '11000', cbsaCode: '15380' },
    'buffalo,ny': { countyFips: '029', placeFips: '11000', cbsaCode: '15380' },
    'rochester,new york': { countyFips: '055', placeFips: '63000', cbsaCode: '40380' },
    'rochester,ny': { countyFips: '055', placeFips: '63000', cbsaCode: '40380' },
    'albany,new york': { countyFips: '001', placeFips: '01000', cbsaCode: '10580' },
    'albany,ny': { countyFips: '001', placeFips: '01000', cbsaCode: '10580' },

    // Florida
    'miami,florida': { countyFips: '086', placeFips: '45000', cbsaCode: '33100' },
    'miami,fl': { countyFips: '086', placeFips: '45000', cbsaCode: '33100' },
    'tampa,florida': { countyFips: '057', placeFips: '71000', cbsaCode: '45300' },
    'tampa,fl': { countyFips: '057', placeFips: '71000', cbsaCode: '45300' },
    'orlando,florida': { countyFips: '095', placeFips: '53000', cbsaCode: '36740' },
    'orlando,fl': { countyFips: '095', placeFips: '53000', cbsaCode: '36740' },
    'jacksonville,florida': { countyFips: '031', placeFips: '35000', cbsaCode: '27260' },
    'jacksonville,fl': { countyFips: '031', placeFips: '35000', cbsaCode: '27260' },
    'st petersburg,florida': { countyFips: '103', placeFips: '63000', cbsaCode: '45300' },
    'st petersburg,fl': { countyFips: '103', placeFips: '63000', cbsaCode: '45300' },
    'fort lauderdale,florida': { countyFips: '011', placeFips: '24000', cbsaCode: '33100' },
    'fort lauderdale,fl': { countyFips: '011', placeFips: '24000', cbsaCode: '33100' },

    // Illinois
    'chicago,illinois': { countyFips: '031', placeFips: '14000', cbsaCode: '16980' },
    'chicago,il': { countyFips: '031', placeFips: '14000', cbsaCode: '16980' },
    'aurora,illinois': { countyFips: '089', placeFips: '03012', cbsaCode: '16980' },
    'aurora,il': { countyFips: '089', placeFips: '03012', cbsaCode: '16980' },

    // Pennsylvania
    'philadelphia,pennsylvania': { countyFips: '101', placeFips: '60000', cbsaCode: '37980' },
    'philadelphia,pa': { countyFips: '101', placeFips: '60000', cbsaCode: '37980' },
    'pittsburgh,pennsylvania': { countyFips: '003', placeFips: '61000', cbsaCode: '38300' },
    'pittsburgh,pa': { countyFips: '003', placeFips: '61000', cbsaCode: '38300' },

    // Arizona
    'phoenix,arizona': { countyFips: '013', placeFips: '55000', cbsaCode: '38060' },
    'phoenix,az': { countyFips: '013', placeFips: '55000', cbsaCode: '38060' },
    'tucson,arizona': { countyFips: '019', placeFips: '77000', cbsaCode: '46060' },
    'tucson,az': { countyFips: '019', placeFips: '77000', cbsaCode: '46060' },
    'mesa,arizona': { countyFips: '013', placeFips: '46000', cbsaCode: '38060' },
    'mesa,az': { countyFips: '013', placeFips: '46000', cbsaCode: '38060' },
    'scottsdale,arizona': { countyFips: '013', placeFips: '65000', cbsaCode: '38060' },
    'scottsdale,az': { countyFips: '013', placeFips: '65000', cbsaCode: '38060' },

    // Ohio
    'columbus,ohio': { countyFips: '049', placeFips: '18000', cbsaCode: '18140' },
    'columbus,oh': { countyFips: '049', placeFips: '18000', cbsaCode: '18140' },
    'cleveland,ohio': { countyFips: '035', placeFips: '16000', cbsaCode: '17460' },
    'cleveland,oh': { countyFips: '035', placeFips: '16000', cbsaCode: '17460' },
    'cincinnati,ohio': { countyFips: '061', placeFips: '15000', cbsaCode: '17140' },
    'cincinnati,oh': { countyFips: '061', placeFips: '15000', cbsaCode: '17140' },

    // Georgia
    'atlanta,georgia': { countyFips: '121', placeFips: '04000', cbsaCode: '12060' },
    'atlanta,ga': { countyFips: '121', placeFips: '04000', cbsaCode: '12060' },
    'savannah,georgia': { countyFips: '051', placeFips: '69000', cbsaCode: '42340' },
    'savannah,ga': { countyFips: '051', placeFips: '69000', cbsaCode: '42340' },

    // North Carolina
    'charlotte,north carolina': { countyFips: '119', placeFips: '12000', cbsaCode: '16740' },
    'charlotte,nc': { countyFips: '119', placeFips: '12000', cbsaCode: '16740' },
    'raleigh,north carolina': { countyFips: '183', placeFips: '55000', cbsaCode: '39580' },
    'raleigh,nc': { countyFips: '183', placeFips: '55000', cbsaCode: '39580' },
    'durham,north carolina': { countyFips: '063', placeFips: '19000', cbsaCode: '20500' },
    'durham,nc': { countyFips: '063', placeFips: '19000', cbsaCode: '20500' },

    // Michigan
    'detroit,michigan': { countyFips: '163', placeFips: '22000', cbsaCode: '19820' },
    'detroit,mi': { countyFips: '163', placeFips: '22000', cbsaCode: '19820' },
    'grand rapids,michigan': { countyFips: '081', placeFips: '34000', cbsaCode: '24340' },
    'grand rapids,mi': { countyFips: '081', placeFips: '34000', cbsaCode: '24340' },

    // Washington
    'seattle,washington': { countyFips: '033', placeFips: '63000', cbsaCode: '42660' },
    'seattle,wa': { countyFips: '033', placeFips: '63000', cbsaCode: '42660' },
    'tacoma,washington': { countyFips: '053', placeFips: '70000', cbsaCode: '42660' },
    'tacoma,wa': { countyFips: '053', placeFips: '70000', cbsaCode: '42660' },

    // Massachusetts
    'boston,massachusetts': { countyFips: '025', placeFips: '07000', cbsaCode: '14460' },
    'boston,ma': { countyFips: '025', placeFips: '07000', cbsaCode: '14460' },
    'cambridge,massachusetts': { countyFips: '017', placeFips: '11000', cbsaCode: '14460' },
    'cambridge,ma': { countyFips: '017', placeFips: '11000', cbsaCode: '14460' },

    // Colorado
    'denver,colorado': { countyFips: '031', placeFips: '20000', cbsaCode: '19740' },
    'denver,co': { countyFips: '031', placeFips: '20000', cbsaCode: '19740' },
    'colorado springs,colorado': { countyFips: '041', placeFips: '16000', cbsaCode: '17820' },
    'colorado springs,co': { countyFips: '041', placeFips: '16000', cbsaCode: '17820' },

    // Tennessee
    'nashville,tennessee': { countyFips: '037', placeFips: '52006', cbsaCode: '34980' },
    'nashville,tn': { countyFips: '037', placeFips: '52006', cbsaCode: '34980' },
    'memphis,tennessee': { countyFips: '157', placeFips: '48000', cbsaCode: '32820' },
    'memphis,tn': { countyFips: '157', placeFips: '48000', cbsaCode: '32820' },

    // Maryland
    'baltimore,maryland': { countyFips: '510', placeFips: '04000', cbsaCode: '12580' },
    'baltimore,md': { countyFips: '510', placeFips: '04000', cbsaCode: '12580' },

    // Minnesota
    'minneapolis,minnesota': { countyFips: '053', placeFips: '43000', cbsaCode: '33460' },
    'minneapolis,mn': { countyFips: '053', placeFips: '43000', cbsaCode: '33460' },
    'st paul,minnesota': { countyFips: '123', placeFips: '58000', cbsaCode: '33460' },
    'st paul,mn': { countyFips: '123', placeFips: '58000', cbsaCode: '33460' },

    // Nevada
    'las vegas,nevada': { countyFips: '003', placeFips: '40000', cbsaCode: '29820' },
    'las vegas,nv': { countyFips: '003', placeFips: '40000', cbsaCode: '29820' },

    // Oregon
    'portland,oregon': { countyFips: '051', placeFips: '59000', cbsaCode: '38900' },
    'portland,or': { countyFips: '051', placeFips: '59000', cbsaCode: '38900' },

    // Missouri
    'kansas city,missouri': { countyFips: '095', placeFips: '38000', cbsaCode: '28140' },
    'kansas city,mo': { countyFips: '095', placeFips: '38000', cbsaCode: '28140' },
    'st louis,missouri': { countyFips: '510', placeFips: '65000', cbsaCode: '41180' },
    'st louis,mo': { countyFips: '510', placeFips: '65000', cbsaCode: '41180' },

    // Indiana
    'indianapolis,indiana': { countyFips: '097', placeFips: '36003', cbsaCode: '26900' },
    'indianapolis,in': { countyFips: '097', placeFips: '36003', cbsaCode: '26900' },

    // Wisconsin
    'milwaukee,wisconsin': { countyFips: '079', placeFips: '53000', cbsaCode: '33340' },
    'milwaukee,wi': { countyFips: '079', placeFips: '53000', cbsaCode: '33340' },
    'madison,wisconsin': { countyFips: '025', placeFips: '48000', cbsaCode: '31540' },
    'madison,wi': { countyFips: '025', placeFips: '48000', cbsaCode: '31540' },

    // Louisiana
    'new orleans,louisiana': { countyFips: '071', placeFips: '55000', cbsaCode: '35380' },
    'new orleans,la': { countyFips: '071', placeFips: '55000', cbsaCode: '35380' }
};

/**
 * Get state FIPS code from state name or abbreviation
 * @param {string} state - State name or 2-letter abbreviation
 * @returns {string|null} 2-digit state FIPS code
 */
function getStateFips(state) {
    if (!state) return null;

    // Direct lookup (works for both name and abbreviation)
    if (STATE_FIPS[state]) {
        return STATE_FIPS[state];
    }

    // Try uppercase abbreviation
    const upperState = state.toUpperCase();
    if (STATE_FIPS[upperState]) {
        return STATE_FIPS[upperState];
    }

    // Try title case for full names
    const titleCase = state.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    if (STATE_FIPS[titleCase]) {
        return STATE_FIPS[titleCase];
    }

    return null;
}

/**
 * Get county FIPS code for a city
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @returns {string|null} 3-digit county FIPS code (or 5-digit for independent cities)
 */
function getCountyFips(city, state) {
    if (!city || !state) return null;

    const key = normalizeLocationKey(city, state);
    const cityData = MAJOR_CITIES[key];

    return cityData ? cityData.countyFips : null;
}

/**
 * Get Census Place FIPS code for a city
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @returns {string|null} 5-digit place FIPS code
 */
function getPlaceFips(city, state) {
    if (!city || !state) return null;

    const key = normalizeLocationKey(city, state);
    const cityData = MAJOR_CITIES[key];

    return cityData ? cityData.placeFips : null;
}

/**
 * Get CBSA (metro area) code for a city
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @returns {string|null} 5-digit CBSA code
 */
function getCbsaCode(city, state) {
    if (!city || !state) return null;

    const key = normalizeLocationKey(city, state);
    const cityData = MAJOR_CITIES[key];

    return cityData ? cityData.cbsaCode : null;
}

/**
 * Get full geography resolution for Census queries
 * Determines the most granular level available for a location
 *
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @param {string} zipCode - Optional ZIP code
 * @returns {Object} Geography info: { stateFips, countyFips, placeFips, geoLevel, fullCountyFips }
 */
function getCensusGeography(city, state, zipCode = null) {
    const stateFips = getStateFips(state);

    if (!stateFips) {
        return {
            stateFips: null,
            countyFips: null,
            placeFips: null,
            geoLevel: null,
            error: 'Invalid state'
        };
    }

    // Try to get city-level FIPS
    const placeFips = getPlaceFips(city, state);
    const countyFips = getCountyFips(city, state);

    // Determine geographic level for queries
    let geoLevel;
    if (placeFips) {
        geoLevel = 'place';
    } else if (countyFips) {
        geoLevel = 'county';
    } else {
        geoLevel = 'state';
    }

    // Build full county FIPS (state + county)
    const fullCountyFips = countyFips ? `${stateFips}${countyFips}` : null;

    return {
        stateFips,
        countyFips,
        placeFips,
        fullCountyFips,
        geoLevel,
        // For CBP queries (county level)
        cbpCountyFips: countyFips ? countyFips.replace(/^0+/, '') : null,
        // For CBSA/metro queries
        cbsaCode: getCbsaCode(city, state)
    };
}

/**
 * Normalize city/state to lookup key
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @returns {string} Normalized key like "austin,texas"
 */
function normalizeLocationKey(city, state) {
    const normalizedCity = city.toLowerCase().trim();
    let normalizedState = state.toLowerCase().trim();

    // Convert abbreviation to full name for consistent lookup
    const upperState = state.toUpperCase();
    if (STATE_ABBR_TO_NAME[upperState]) {
        normalizedState = STATE_ABBR_TO_NAME[upperState].toLowerCase();
    }

    return `${normalizedCity},${normalizedState}`;
}

/**
 * Get state name from FIPS code
 * @param {string} fips - 2-digit state FIPS code
 * @returns {string|null} State name
 */
function getStateNameFromFips(fips) {
    for (const [name, code] of Object.entries(STATE_FIPS)) {
        if (code === fips && name.length > 2) {
            return name;
        }
    }
    return null;
}

/**
 * Check if a city is in our major cities database
 * @param {string} city - City name
 * @param {string} state - State name or abbreviation
 * @returns {boolean} True if city is in database
 */
function isMajorCity(city, state) {
    if (!city || !state) return false;
    const key = normalizeLocationKey(city, state);
    return MAJOR_CITIES.hasOwnProperty(key);
}

module.exports = {
    STATE_FIPS,
    STATE_ABBR_TO_NAME,
    MAJOR_CITIES,
    getStateFips,
    getCountyFips,
    getPlaceFips,
    getCbsaCode,
    getCensusGeography,
    getStateNameFromFips,
    isMajorCity,
    normalizeLocationKey
};
