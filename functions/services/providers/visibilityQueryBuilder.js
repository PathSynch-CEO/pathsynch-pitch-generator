'use strict';

/**
 * visibilityQueryBuilder.js
 * Builds search queries from industry taxonomy — NOT hardcoded per-vertical lists.
 * Also exports audience language resolver used by providers and pitch companion.
 */

/**
 * Build visibility search queries from industry taxonomy.
 * Uses industryConfig labels and subIndustry aliases.
 *
 * @param {Object} industryConfig - from industryTaxonomy.json (.label, .googlePlaceQueries, etc.)
 * @param {string} subIndustry - sub-industry label (e.g. "Dental Practice", "Italian Restaurant")
 * @param {string} city
 * @param {string} state
 * @param {string} queryType - "local" (Map Pack / Ad Spend) or "ai" (AI Visibility)
 * @returns {string[]} array of 3-5 search queries
 */
function buildVisibilityQueries(industryConfig, subIndustry, city, state, queryType) {
  queryType = queryType || 'local';
  const seed = subIndustry || (industryConfig && industryConfig.label) || 'business';
  const reportProfile = (industryConfig && industryConfig.reportProfile) || 'default_local_business';

  if (reportProfile === 'government_public_sector') {
    return [
      seed + ' ' + city + ' ' + state,
      'government services ' + city + ' ' + state,
      'public agencies ' + city,
      seed + ' office ' + city + ' ' + state,
      city + ' ' + state + ' government directory'
    ];
  }

  if (reportProfile === 'nonprofit_association') {
    return [
      seed + ' ' + city + ' ' + state,
      'nonprofit organizations ' + city,
      'community organizations ' + city + ' ' + state,
      seed + ' near ' + city,
      city + ' ' + state + ' ' + seed + ' directory'
    ];
  }

  if (queryType === 'ai') {
    return [
      'best ' + seed + ' in ' + city + ' ' + state,
      'recommend a ' + seed + ' near ' + city,
      'top rated ' + seed + ' ' + city + ' ' + state
    ];
  }

  // Local SERP queries (Map Pack + Ad Spend)
  return [
    seed + ' near me',
    seed + ' ' + city,
    'best ' + seed + ' ' + city,
    seed + ' ' + city + ' ' + state,
    'top ' + seed + ' near me'
  ];
}

// ── Audience language resolver ─────────────────────────────────────────────

const AUDIENCE_LANGUAGE = {
  default_local_business: { audience: 'customers', entity: 'businesses', searchContext: 'local searches' },
  b2b_services:           { audience: 'qualified prospects', entity: 'firms', searchContext: 'industry searches' },
  government_public_sector: { audience: 'citizens, constituents', entity: 'agencies, offices', searchContext: 'government services' },
  nonprofit_association:  { audience: 'donors, members, and community', entity: 'organizations', searchContext: 'community services' },
  healthcare:             { audience: 'patients', entity: 'practices', searchContext: 'healthcare searches' },
  hospitality:            { audience: 'guests, travelers', entity: 'properties', searchContext: 'travel and booking searches' },
  fitness_wellness:       { audience: 'members, clients', entity: 'studios, gyms', searchContext: 'fitness searches' }
};

function getAudienceLanguage(reportProfile) {
  return AUDIENCE_LANGUAGE[reportProfile] || AUDIENCE_LANGUAGE.default_local_business;
}

module.exports = { buildVisibilityQueries, getAudienceLanguage, AUDIENCE_LANGUAGE };
