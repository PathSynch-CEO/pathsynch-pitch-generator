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

    // 1 — geocoded county name (primary, no new API call)
    if (geocodeCountyName && abbr) {
        const norm = normalizeCountyName(geocodeCountyName);
        const fips5 = COUNTY_NAME_TO_FIPS[`${abbr}:${norm}`];
        if (isFips5(fips5)) return { fips5, county: geocodeCountyName, source: 'geocode' };
    }

    // 2 — Table A city→county fallback (services/geography.js fullCountyFips, already 5-digit)
    if (geo && isFips5(geo.fullCountyFips)) {
        return { fips5: geo.fullCountyFips, county: geo.countyLabel || null, source: 'city_table' };
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
    normalizeCountyName,
    extractAdminAreaLevel2,
    resolveCountyFips
};
