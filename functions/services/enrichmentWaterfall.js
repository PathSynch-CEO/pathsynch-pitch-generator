/**
 * enrichmentWaterfall.js
 *
 * Data contracts and TODO hooks for future enrichment providers.
 * Sprint 3 creates the interface only. No live API calls.
 *
 * Waterfall order:
 * 1. Google Places / DataForSEO / Serper (EXISTING)
 * 2. Gemini decision maker extraction (EXISTING)
 * 3. Apollo (TODO)
 * 4. People Data Labs (TODO)
 * 5. Clay (TODO)
 * 6. Manual fallback / CSV export (EXISTING)
 * 7. USAspending.gov — government federal funding (Tier 1, implemented)
 * 8. ProPublica Nonprofit Explorer — 990 financials (Tier 1, implemented)
 * 9. IRS BMF Firestore cache — EIN lookup (Tier 1, implemented)
 *
 * Rules:
 * - Store source + confidence for every enriched field
 * - Never overwrite higher-confidence human-confirmed data
 * - Never fail report generation if enrichment fails
 * - Respect credit/cost limits
 * - Do not add API calls without env vars and feature flags
 */
'use strict';

const ENRICHMENT_FIELDS = {
  headcount: { type: 'number', sources: ['apollo', 'pdl'], confidence: null },
  revenueEstimate: { type: 'string', sources: ['apollo', 'pdl'], confidence: null },
  hiringSignals: { type: 'array', sources: ['apollo'], confidence: null },
  openRoles: { type: 'array', sources: ['apollo'], confidence: null },
  decisionMakerEmail: { type: 'string', sources: ['apollo', 'pdl'], confidence: null },
  decisionMakerLinkedin: { type: 'string', sources: ['apollo', 'pdl'], confidence: null },
  decisionMakerTitle: { type: 'string', sources: ['apollo', 'pdl', 'gemini'], confidence: null },
  companyLinkedIn: { type: 'string', sources: ['apollo', 'pdl'], confidence: null },
  targetCustomer: { type: 'string', sources: ['gemini'], confidence: null },
  differentiators: { type: 'array', sources: ['gemini'], confidence: null },
  technologyStack: { type: 'array', sources: ['pdl'], confidence: null }
};

/** TODO: Apollo enrichment. Env: APOLLO_API_KEY */
async function enrichFromApollo(companyName, domain) {
  if (!process.env.APOLLO_API_KEY) return null;
  // TODO: POST https://api.apollo.io/v1/organizations/enrich
  return null;
}

/** TODO: People Data Labs enrichment. Env: PDL_API_KEY */
async function enrichFromPDL(companyName, domain) {
  if (!process.env.PDL_API_KEY) return null;
  // TODO: GET https://api.peopledatalabs.com/v5/company/enrich
  return null;
}

/** TODO: Clay workflow push. Env: CLAY_API_KEY, CLAY_TABLE_ID */
async function pushToClay(leadData) {
  if (!process.env.CLAY_API_KEY) return null;
  // TODO: POST Clay HTTP API
  return null;
}

/** TODO: HubSpot CRM push. Env: HUBSPOT_ACCESS_TOKEN */
async function pushToHubSpot(leadData) {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return null;
  // TODO: POST /crm/v3/objects/contacts + /companies
  return null;
}

// Tier 1 Public Data Enrichment — re-export for convenience
var enrichmentService = require('./publicDataEnrichmentService');
module.exports = Object.assign({}, { ENRICHMENT_FIELDS, enrichFromApollo, enrichFromPDL, pushToClay, pushToHubSpot }, { enrichReport: enrichmentService.enrichReport });
