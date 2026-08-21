'use strict';

/**
 * structuralGrowth.js — PR-D orchestrator for the Structural Growth research section (Home Services only).
 *
 * Composes: NAICS policy gate (which subs may render) → county resolution (countyResolver) → QCEW fetch
 * (industryEconomicsService). Returns a `reportData.structuralGrowth` object; the Evidence Ledger turns its
 * three metrics into three sibling `external`/`withheld` entries. Deterministic: typed numeric values from
 * BLS plus template-generated provenance strings — NO model-generated prose (safe to build post-sanitizer).
 */

const { resolveCountyFips } = require('./countyResolver');
const { getStructuralGrowth } = require('../utils/industryEconomicsService');

// Per-sub NAICS policy for Home Services (Gate 1 §2 decisions). Only listed subs may render employment;
// `allow:false` subs are withheld `low_confidence_naics`. A disclosure string, when present, is surfaced
// in the section note (e.g. the #6 junk-removal classification).
const HOME_SERVICES_POLICY = {
    plumbing_hvac: { allow: true },
    electrical: { allow: true },
    roofing: { allow: true },
    landscaping: { allow: true },
    cleaning: { allow: true },
    general_contractor_home: { allow: true, disclosure: 'Residential Remodelers (NAICS 236118) — general-contractor scope narrowed to residential remodeling.' },
    junk_removal: { allow: true, disclosure: 'junk/bulky-item hauling, NAICS 562119 Other Waste Collection.' },
    dumpster_rental: { allow: true, disclosure: 'roll-off container collection basis, NAICS 562111 Solid Waste Collection.' },
    moving_storage: { allow: false, reason: 'Moving and storage span different NAICS series (484210 moving vs 531130 self-storage); a single code would misrepresent the sub-industry. Withheld pending a taxonomy split.' }
};

function allWithheld(cause, reason, base) {
    const m = { state: 'withheld', withholdCause: cause, reason };
    return Object.assign({
        status: 'withheld',
        metrics: { employment: { ...m }, yoy: { ...m }, establishments: { ...m } }
    }, base);
}

/**
 * @param {object} args
 *   - industryConfig, subIndustryConfig  (taxonomy objects)
 *   - state, city
 *   - geo                                 (services/geography.getCensusGeography result — Table A fallback)
 *   - geocodeCountyName                   (optional admin_area_level_2 from an existing geocode)
 * @param {object} [deps] - { getStructuralGrowth, resolveCountyFips, now } for tests
 * @returns {Promise<object|null>} reportData.structuralGrowth, or null when not applicable (non-Home-Services)
 */
async function computeStructuralGrowth(args, deps = {}) {
    const { industryConfig, subIndustryConfig, state, geo, geocodeCountyName } = args || {};
    if (!industryConfig || industryConfig.id !== 'home_services') return null; // vertical fence

    const _resolve = deps.resolveCountyFips || resolveCountyFips;
    const _fetch = deps.getStructuralGrowth || getStructuralGrowth;

    const subId = subIndustryConfig && subIndustryConfig.id;
    const naicsCode = subIndustryConfig && subIndustryConfig.naicsCode;
    const naicsLabel = subIndustryConfig && subIndustryConfig.naicsLabel;
    const base = {
        vertical: 'home_services', subIndustryId: subId || null,
        requestedNaics: { code: naicsCode || null, label: naicsLabel || null }
    };

    // Policy gate — which Home Services subs may show employment at all.
    const policy = subId ? HOME_SERVICES_POLICY[subId] : null;
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
        countySource: county.source,
        dataYear: sg.dataYear, comparisonYear: sg.comparisonYear,
        disclosure: policy.disclosure || null,
        metrics: sg.metrics
    });
}

module.exports = { computeStructuralGrowth, HOME_SERVICES_POLICY };
