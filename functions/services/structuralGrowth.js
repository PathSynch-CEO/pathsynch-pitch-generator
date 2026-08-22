'use strict';

/**
 * structuralGrowth.js — orchestrator for the Structural Growth research section (all policy-mapped verticals).
 *
 * Composes: NAICS policy gate (which subs may render) → county resolution (countyResolver) → QCEW fetch
 * (industryEconomicsService). Returns a `reportData.structuralGrowth` object; the Evidence Ledger turns its
 * metrics into sibling `external`/`withheld` entries. Deterministic: typed numeric values from BLS plus
 * template-generated provenance strings — NO model-generated prose (safe to build post-sanitizer).
 *
 * Vertical gating (all-verticals expansion, decision 2026-08-22): a vertical listed in
 * STRUCTURAL_GROWTH_POLICY renders the section (per-sub allow/deny below); a vertical NOT listed
 * returns null — no section, no withheld noise — because most of its sub-industries carry no
 * taxonomy NAICS code yet (that backfill is a separate taxonomy effort). Within a listed vertical,
 * an unlisted or `allow:false` sub is WITHHELD with cause, preserving the Gate-1 allowlist posture:
 * a sub renders employment data only after its NAICS mapping has been judged faithful.
 */

const { resolveCountyFips } = require('./countyResolver');
const { getStructuralGrowth } = require('../utils/industryEconomicsService');

// Per-vertical, per-sub NAICS policy. Only listed subs may render employment; `allow:false` subs are
// withheld `low_confidence_naics` with the judgment recorded. A disclosure string, when present, is
// surfaced in the section note (e.g. the junk-removal classification).
const STRUCTURAL_GROWTH_POLICY = {
    // Gate 1 §2 decisions (PR-D) — unchanged.
    home_services: {
        plumbing_hvac: { allow: true },
        electrical: { allow: true },
        roofing: { allow: true },
        landscaping: { allow: true },
        cleaning: { allow: true },
        general_contractor_home: { allow: true, disclosure: 'Residential Remodelers (NAICS 236118) — general-contractor scope narrowed to residential remodeling.' },
        junk_removal: { allow: true, disclosure: 'junk/bulky-item hauling, NAICS 562119 Other Waste Collection.' },
        dumpster_rental: { allow: true, disclosure: 'roll-off container collection basis, NAICS 562111 Solid Waste Collection.' },
        moving_storage: { allow: false, reason: 'Moving and storage span different NAICS series (484210 moving vs 531130 self-storage); a single code would misrepresent the sub-industry. Withheld pending a taxonomy split.' }
    },
    // All-verticals expansion (2026-08-22) — every taxonomy sub that carries a naicsCode, judged
    // individually. The two allow:false entries are mappings whose county series would misrepresent
    // the sub-industry; they need a taxonomy remap, not a policy flip.
    automotive: {
        auto_repair: { allow: true },                                     // 811111 General Automotive Repair (exact)
        body_shop: { allow: true },                                       // 811121 Body/Paint/Interior (exact)
        car_dealership: { allow: true },                                  // 4411 Automobile Dealers (natural 4-digit class)
        detailing_wash: { allow: true, disclosure: 'car wash and auto detailing basis, NAICS 811192 Car Washes.' },
        tire_alignment: { allow: false, reason: 'Mapped code 441330 covers automotive parts and accessories RETAILERS; tire and alignment service shops live under Tire Dealers (441340) and automotive repair (8111). The county series would misrepresent service shops. Withheld pending a taxonomy remap.' }
    },
    health_wellness: {
        dental_practice: { allow: true }                                  // 621210 Offices of Dentists (exact)
    },
    professional_services: {
        business_brokers: { allow: false, reason: 'Mapped code 541990 is the "All Other Professional, Scientific, and Technical Services" catch-all; its county employment blends unrelated professions and does not describe the business-broker market. Withheld pending a faithful code.' }
    },
    retail: {
        general_merchandise: { allow: true },                             // 455 (3-digit walk; the Aug-19 mockup example)
        clothing_boutique: { allow: true },                               // 4581 Clothing and Clothing Accessories Retailers
        electronics_retail: { allow: true },                              // 449210 Electronics and Appliance Retailers (exact)
        specialty_food_gifts: { allow: true, disclosure: 'gift and novelty retail basis, NAICS 459420; specialty food retail is a separate NAICS series and is not included.' },
        home_goods_decor: { allow: true },                                // 4491 Furniture and Home Furnishings Retailers
        sporting_outdoor: { allow: true }                                 // 459110 Sporting Goods Retailers (exact)
    },
    transportation_logistics: {
        truck_stops: { allow: true, disclosure: 'fuel-station basis, NAICS 457120 Other Gasoline Stations (truck stops are included in this class).' }
    }
};

// Back-compat alias — the original Home-Services-only export (kept for tests and external readers).
const HOME_SERVICES_POLICY = STRUCTURAL_GROWTH_POLICY.home_services;

function allWithheld(cause, reason, base) {
    const m = { state: 'withheld', withholdCause: cause, reason };
    return Object.assign({
        status: 'withheld',
        metrics: { employment: { ...m }, yoy: { ...m }, establishments: { ...m }, wage: { ...m }, lq: { ...m } }
    }, base);
}

/**
 * @param {object} args
 *   - industryConfig, subIndustryConfig  (taxonomy objects)
 *   - state, city
 *   - geo                                 (services/geography.getCensusGeography result — Table A fallback)
 *   - geocodeCountyName                   (optional admin_area_level_2 from an existing geocode)
 * @param {object} [deps] - { getStructuralGrowth, resolveCountyFips, now } for tests
 * @returns {Promise<object|null>} reportData.structuralGrowth, or null when not applicable (unmapped vertical)
 */
async function computeStructuralGrowth(args, deps = {}) {
    const { industryConfig, subIndustryConfig, state, geo, geocodeCountyName } = args || {};
    const vertical = industryConfig && industryConfig.id;
    const verticalPolicy = vertical ? STRUCTURAL_GROWTH_POLICY[vertical] : null;
    if (!verticalPolicy) return null; // unmapped vertical — no section (NAICS backfill is a separate effort)

    const _resolve = deps.resolveCountyFips || resolveCountyFips;
    const _fetch = deps.getStructuralGrowth || getStructuralGrowth;

    const subId = subIndustryConfig && subIndustryConfig.id;
    const naicsCode = subIndustryConfig && subIndustryConfig.naicsCode;
    const naicsLabel = subIndustryConfig && subIndustryConfig.naicsLabel;
    const base = {
        vertical, subIndustryId: subId || null,
        requestedNaics: { code: naicsCode || null, label: naicsLabel || null }
    };

    // Policy gate — which subs of this vertical may show employment at all.
    const policy = subId ? verticalPolicy[subId] : null;
    if (!policy) {
        return allWithheld('no_naics', 'This sub-industry is not enabled for county employment data.', base);
    }
    if (policy.allow === false) {
        return allWithheld('low_confidence_naics', policy.reason || 'NAICS classification is low-confidence; withheld.', base);
    }
    if (!naicsCode) {
        return allWithheld('no_naics', 'This sub-industry is not mapped to a NAICS employment series.', base);
    }

    // County resolution — geocode primary, city-table fallback, else withhold.
    const county = _resolve({ geocodeCountyName, state, geo });
    if (county.withhold) {
        return allWithheld('no_county_fips', county.reason, base);
    }

    // Presentation: stamp the authoritative human-readable county label (canonical FIPS→label from the
    // resolver) into provenance, regardless of resolution source. Falls back to the raw name then FIPS.
    const sg = await _fetch({
        fips5: county.fips5, county: county.countyLabel || county.county || county.fips5, state, naicsCode, naicsLabel
    }, { now: deps.now });

    return Object.assign({}, base, {
        status: sg.status,
        county: sg.county, state: sg.state, fips5: sg.fips5,
        // Propagate the structured BLS source URL the service already computed (industryEconomicsService
        // .buildResult reconstructs it from the LANDED dataYear + fips5). Single source-of-truth URL path —
        // never rebuilt here, never parsed out of provenance. `null` on withheld sections (no evidence, no
        // URL to expose) — the same absence convention as `disclosure` below.
        sourceUrl: sg.sourceUrl || null,
        countySource: county.source,
        dataYear: sg.dataYear, comparisonYear: sg.comparisonYear,
        disclosure: policy.disclosure || null,
        metrics: sg.metrics
    });
}

module.exports = { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY, HOME_SERVICES_POLICY };
