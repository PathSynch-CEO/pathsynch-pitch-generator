'use strict';

/**
 * countyResolver.js — PR-D county resolution for the Structural Growth (BLS QCEW) section.
 *
 * Concept (Gate 1 §3): the QCEW geography represents THE MARKET the report characterizes, operationalized
 * as the single PRINCIPAL COUNTY of the report's city — one county, never silently broadened to the MSA.
 *
 * Resolution order (Gate 1 decision 4):
 *   1. geocoded `administrative_area_level_2` (extracted from an EXISTING geocode response — no new API
 *      call) → normalized county name → COUNTY_NAME_TO_FIPS (covers every county referenced by the merged
 *      city→county table).
 *   2. fallback to Table A `geo.fullCountyFips` (services/geography.js).
 *   3. else WITHHELD `no_county_fips`.
 * The deleted service's state-level fallback is NOT carried over: a county-labeled metric must never be
 * satisfied by state data.
 *
 * County-equivalents (counties, parishes, boroughs, independent cities) are normalized DETERMINISTICALLY —
 * no fuzzy geography matching. Independent cities keep their identity: "Baltimore city" (24510) is a
 * distinct county-equivalent from "Baltimore County" (24005) and must not be collapsed.
 */

// (stateAbbr):(normalized county-equivalent name) → 5-digit county FIPS.
// Covers the distinct counties referenced by the merged city→county table (geography.js MAJOR_CITIES +
// the retired CITY_TO_FIPS). Values are authoritative 2020-vintage county FIPS.
const COUNTY_NAME_TO_FIPS = {
    // Texas
    'tx:travis': '48453', 'tx:harris': '48201', 'tx:dallas': '48113', 'tx:bexar': '48029',
    'tx:tarrant': '48439', 'tx:collin': '48085', 'tx:el paso': '48141',
    // California
    'ca:los angeles': '06037', 'ca:san diego': '06073', 'ca:santa clara': '06085',
    'ca:san francisco': '06075', 'ca:fresno': '06019', 'ca:sacramento': '06067',
    'ca:alameda': '06001', 'ca:orange': '06059', 'ca:riverside': '06065',
    // New York
    'ny:new york': '36061', 'ny:kings': '36047', 'ny:queens': '36081', 'ny:bronx': '36005',
    'ny:richmond': '36085', 'ny:erie': '36029', 'ny:monroe': '36055', 'ny:albany': '36001',
    // Florida
    'fl:miami dade': '12086', 'fl:miami-dade': '12086', 'fl:orange': '12095', 'fl:hillsborough': '12057',
    'fl:duval': '12031', 'fl:pinellas': '12103', 'fl:broward': '12011', 'fl:palm beach': '12099',
    // Illinois
    'il:cook': '17031', 'il:dupage': '17043', 'il:kane': '17089', 'il:will': '17197',
    // Pennsylvania
    'pa:philadelphia': '42101', 'pa:allegheny': '42003',
    // Arizona
    'az:maricopa': '04013', 'az:pima': '04019',
    // Ohio
    'oh:franklin': '39049', 'oh:cuyahoga': '39035', 'oh:hamilton': '39061', 'oh:montgomery': '39113',
    // Georgia
    'ga:fulton': '13121', 'ga:dekalb': '13089', 'ga:cobb': '13067', 'ga:gwinnett': '13135',
    'ga:forsyth': '13117', 'ga:cherokee': '13057', 'ga:fayette': '13113', 'ga:coweta': '13097',
    'ga:henry': '13151', 'ga:clayton': '13063', 'ga:rockdale': '13247', 'ga:hall': '13139',
    'ga:floyd': '13295', 'ga:muscogee': '13215', 'ga:chatham': '13051', 'ga:bibb': '13021',
    'ga:richmond': '13245', 'ga:houston': '13153', 'ga:clarke': '13059', 'ga:lowndes': '13185',
    // North Carolina
    'nc:mecklenburg': '37119', 'nc:wake': '37183', 'nc:durham': '37063', 'nc:guilford': '37081',
    // Michigan
    'mi:wayne': '26163', 'mi:kent': '26081',
    // Washington
    'wa:king': '53033', 'wa:pierce': '53053', 'wa:spokane': '53063',
    // Massachusetts
    'ma:suffolk': '25025', 'ma:middlesex': '25017',
    // Colorado
    'co:denver': '08031', 'co:el paso': '08041', 'co:arapahoe': '08005', 'co:boulder': '08013',
    'co:jefferson': '08059',
    // Tennessee
    'tn:davidson': '47037', 'tn:shelby': '47157', 'tn:knox': '47093', 'tn:hamilton': '47065',
    // Minnesota
    'mn:hennepin': '27053', 'mn:ramsey': '27123',
    // Nevada
    'nv:clark': '32003',
    // Oregon
    'or:multnomah': '41051',
    // Indiana
    'in:marion': '18097',
    // Wisconsin
    'wi:milwaukee': '55079', 'wi:dane': '55025',
    // Louisiana
    'la:orleans': '22071',
    // Maryland — Montgomery County + Baltimore independent city (distinct from Baltimore County 24005)
    'md:montgomery': '24031', 'md:baltimore city': '24510', 'md:baltimore': '24510',
    // Missouri — Jackson County + St. Louis independent city (distinct from St. Louis County 29189)
    'mo:jackson': '29095', 'mo:st louis city': '29510',
    // Virginia — Arlington County + independent cities (Richmond/Virginia Beach/Alexandria)
    'va:arlington': '51013', 'va:richmond city': '51760', 'va:richmond': '51760',
    'va:virginia beach': '51810', 'va:virginia beach city': '51810',
    'va:alexandria': '51510', 'va:alexandria city': '51510'
};

// Canonical 5-digit FIPS → ONE authoritative display label (PR-D presentation follow-up). This is the
// single source of truth for the human-readable county/county-equivalent name in provenance, used
// UNIFORMLY regardless of whether the FIPS came from the geocoder or the Table-A city_table fallback.
// It is NOT a reverse of the alias-heavy COUNTY_NAME_TO_FIPS (that map holds multiple aliases per FIPS
// and is insertion-order sensitive) — each label here is verified and county-equivalent-correct:
// parishes/boroughs/independent cities keep their terminology, and an independent city is NEVER labeled
// as its like-named county (e.g. 24510 is "Baltimore city", not "Baltimore County"; 29510 is
// "St. Louis city", never "St. Louis County" which is the distinct 29189).
const FIPS_TO_COUNTY_LABEL = {
    // Texas
    '48453': 'Travis County', '48201': 'Harris County', '48113': 'Dallas County', '48029': 'Bexar County',
    '48439': 'Tarrant County', '48085': 'Collin County', '48141': 'El Paso County',
    // California
    '06037': 'Los Angeles County', '06073': 'San Diego County', '06085': 'Santa Clara County',
    '06075': 'San Francisco County', '06019': 'Fresno County', '06067': 'Sacramento County',
    '06001': 'Alameda County', '06059': 'Orange County', '06065': 'Riverside County',
    // New York
    '36061': 'New York County', '36047': 'Kings County', '36081': 'Queens County', '36005': 'Bronx County',
    '36085': 'Richmond County', '36029': 'Erie County', '36055': 'Monroe County', '36001': 'Albany County',
    // Florida
    '12086': 'Miami-Dade County', '12095': 'Orange County', '12057': 'Hillsborough County',
    '12031': 'Duval County', '12103': 'Pinellas County', '12011': 'Broward County', '12099': 'Palm Beach County',
    // Illinois
    '17031': 'Cook County', '17043': 'DuPage County', '17089': 'Kane County', '17197': 'Will County',
    // Pennsylvania
    '42101': 'Philadelphia County', '42003': 'Allegheny County',
    // Arizona
    '04013': 'Maricopa County', '04019': 'Pima County',
    // Ohio
    '39049': 'Franklin County', '39035': 'Cuyahoga County', '39061': 'Hamilton County', '39113': 'Montgomery County',
    // Georgia
    '13121': 'Fulton County', '13089': 'DeKalb County', '13067': 'Cobb County', '13135': 'Gwinnett County',
    '13117': 'Forsyth County', '13057': 'Cherokee County', '13113': 'Fayette County', '13097': 'Douglas County',
    '13151': 'Henry County', '13063': 'Clayton County', '13247': 'Rockdale County', '13139': 'Hall County',
    '13295': 'Walker County', '13215': 'Muscogee County', '13051': 'Chatham County', '13021': 'Bibb County',
    '13245': 'Richmond County', '13153': 'Houston County', '13059': 'Clarke County', '13185': 'Lowndes County',
    '13077': 'Coweta County', '13115': 'Floyd County', // #97: corrected FIPS for Newnan / Rome
    // North Carolina
    '37119': 'Mecklenburg County', '37183': 'Wake County', '37063': 'Durham County', '37081': 'Guilford County',
    // Michigan
    '26163': 'Wayne County', '26081': 'Kent County',
    // Washington
    '53033': 'King County', '53053': 'Pierce County', '53063': 'Spokane County',
    // Massachusetts
    '25025': 'Suffolk County', '25017': 'Middlesex County',
    // Colorado
    '08031': 'Denver County', '08041': 'El Paso County', '08005': 'Arapahoe County', '08013': 'Boulder County',
    '08059': 'Jefferson County',
    // Tennessee
    '47037': 'Davidson County', '47157': 'Shelby County', '47093': 'Knox County', '47065': 'Hamilton County',
    // Minnesota
    '27053': 'Hennepin County', '27123': 'Ramsey County',
    // Nevada
    '32003': 'Clark County',
    // Oregon
    '41051': 'Multnomah County',
    // Indiana
    '18097': 'Marion County',
    // Wisconsin
    '55079': 'Milwaukee County', '55025': 'Dane County',
    // Louisiana — parish terminology preserved
    '22071': 'Orleans Parish',
    // Maryland — Montgomery County + Baltimore INDEPENDENT CITY (24005 = Baltimore County, distinct)
    '24031': 'Montgomery County', '24510': 'Baltimore city',
    // Missouri — Jackson County + St. Louis INDEPENDENT CITY (29189 = St. Louis County, distinct)
    '29095': 'Jackson County', '29510': 'St. Louis city', '29189': 'St. Louis County',
    // Virginia — Arlington County + independent cities (city terminology preserved)
    '51013': 'Arlington County', '51760': 'Richmond city', '51810': 'Virginia Beach city', '51510': 'Alexandria city'
};

// One canonical display label for a resolved FIPS. Prefers the verified FIPS→label map; else a real name
// already supplied by the resolution source (the geocoder's own county name — not a guess); else the FIPS
// itself. Never manufactures or suffixes a name.
function countyLabelForFips(fips5, suppliedName) {
    if (FIPS_TO_COUNTY_LABEL[fips5]) return FIPS_TO_COUNTY_LABEL[fips5];
    if (suppliedName && String(suppliedName).trim()) return String(suppliedName).trim();
    return fips5;
}

// Normalize a county-equivalent name deterministically. Strips punctuation and the type suffix
// (County / Parish / Borough / Census Area / Municipality) but KEEPS a trailing "city" so independent
// cities are not collapsed into their like-named surrounding county.
function normalizeCountyName(raw) {
    if (!raw) return '';
    let s = String(raw).toLowerCase().replace(/\./g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+(county|parish|borough|census area|municipality|municipio)$/,'').trim();
    return s;
}

// Extract the administrative_area_level_2 (county) name from an EXISTING Google geocode result.
// Accepts either a single geocode result or a full geocode response ({ results: [...] }). No API call.
function extractAdminAreaLevel2(geocodeResult) {
    if (!geocodeResult) return null;
    const comps = geocodeResult.address_components
        || (geocodeResult.results && geocodeResult.results[0] && geocodeResult.results[0].address_components);
    if (!Array.isArray(comps)) return null;
    const c = comps.find(x => Array.isArray(x.types) && x.types.includes('administrative_area_level_2'));
    if (!c) return null;
    return c.long_name || c.short_name || null;
}

function isFips5(v) { return typeof v === 'string' && /^[0-9]{5}$/.test(v); }

/**
 * Resolve the principal county FIPS for the market.
 * @param {object} args
 * @param {string} [args.geocodeCountyName] - admin_area_level_2 name from an existing geocode (primary)
 * @param {string} args.state - 2-letter state (or full name; only the abbreviation is used as the map key)
 * @param {object} [args.geo] - services/geography.getCensusGeography() result (fallback via fullCountyFips)
 * @returns {{fips5, county, source} | {withhold:true, withholdCause:'no_county_fips', reason:string}}
 */
function resolveCountyFips({ geocodeCountyName, state, geo }) {
    const abbr = String(state || '').trim().toLowerCase().slice(0, 2);

    // 1 — geocoded county name (primary, no new API call). Display label is the canonical FIPS→label
    // (falling back to the geocoder's own name, then FIPS) so it is authoritative regardless of source.
    if (geocodeCountyName && abbr) {
        const norm = normalizeCountyName(geocodeCountyName);
        const fips5 = COUNTY_NAME_TO_FIPS[`${abbr}:${norm}`];
        if (isFips5(fips5)) {
            return { fips5, county: geocodeCountyName, countyLabel: countyLabelForFips(fips5, geocodeCountyName), source: 'geocode' };
        }
    }

    // 2 — Table A city→county fallback (services/geography.js fullCountyFips, already 5-digit). No name is
    // carried by the city table, so the canonical FIPS→label supplies the human-readable county here.
    if (geo && isFips5(geo.fullCountyFips)) {
        return { fips5: geo.fullCountyFips, county: geo.countyLabel || null, countyLabel: countyLabelForFips(geo.fullCountyFips, geo.countyLabel || null), source: 'city_table' };
    }

    // 3 — withhold; never fall back to state-level for a county metric
    return {
        withhold: true,
        withholdCause: 'no_county_fips',
        reason: 'County could not be resolved for this market, so county employment data is withheld.'
    };
}

module.exports = {
    COUNTY_NAME_TO_FIPS,
    FIPS_TO_COUNTY_LABEL,
    countyLabelForFips,
    normalizeCountyName,
    extractAdminAreaLevel2,
    resolveCountyFips
};
