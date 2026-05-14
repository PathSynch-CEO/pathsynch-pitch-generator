# Market Intel Visibility Enrichment — Implementation Spec v2

> **Sprint**: Visibility Enrichment Layer
> **Owner**: Charles Berry
> **Executor**: Claude Code (dangerous mode)
> **Codebase**: `pathsynch-pitch-generator` (backend) + `synchintro-app` (frontend)
> **Pattern**: Non-blocking enrichment, feature-flagged, additive only — identical to `publicDataEnrichmentService.js` pattern
> **Priority**: Phase 1A (Map Pack) + Phase 1B (Ad Spend) → Phase 2 (Website Signals) → Phase 3 (AI Visibility)
> **Spec version**: 2.1 — incorporates all 15 review corrections

---

## Architecture Overview

All four features follow the enrichment pattern established by the Tier 1 Public Data Enrichment sprint. Each feature has its own feature flag and provider. Map Pack and Ad Spend are separate SERP surfaces (Google Maps vs Google Organic) and are independently enabled.

```
market.js (report generation)
    │
    ├── [existing] Google Places → competitors[]
    ├── [existing] Census → demographics{}
    ├── [existing] Gemini enhancement
    ├── [existing] publicDataEnrichmentService.js → publicSectorIntelligence / nonprofitFinancialIntelligence
    │
    ├── [NEW] visibilityEnrichmentService.js
    │       ├── enrichMapPack()          → mapPackIntelligence          (DataForSEO Google Maps SERP)
    │       ├── enrichAdSpend()          → adSpendIntelligence          (DataForSEO Google Organic SERP — paid items)
    │       ├── enrichWebsiteSignals()   → websiteConversionSignals     (Google PageSpeed Insights)
    │       └── enrichAiVisibility()     → aiVisibilityIntelligence     (Gemini grounded + Perplexity)
    │
    ▼
Firestore write (reportData includes new fields)
    │
    ▼
buildTieredResponse() includes new fields in API response
```

**Key principles:**

1. Each enrichment is wrapped in try/catch with `Promise.race` timeout. Failure does NOT block report generation.
2. Map Pack timeout: 12s. Ad Spend timeout: 12s. Website Signals timeout: 20s (PSI is slow). AI Visibility timeout: 15s.
3. All four features are independently feature-flagged. Enabling one does not require enabling others.
4. All language is vertical-agnostic. Industry-specific terminology comes from `industryTaxonomy.json` and `industryIntelligence.js`, not hardcoded strings.
5. **MANDATORY: Test script before provider implementation.** For each phase, write and run the test script FIRST. Confirm actual API response field names. Do not wire provider output into `market.js` until the test script confirms field names match the provider code. This prevents the `campaign_id` → `campaign` class of bugs.
6. **MANDATORY: Use report field resolvers everywhere.** Never access `report.mapPackIntelligence` directly. Always use resolver helpers (`getMapPackIntelligence(report)`, etc.) because report fields may live under `report.data`, `report.reportData`, or root depending on the code path.

---

## Language & Taxonomy Rules

All visibility enrichment output must use audience-appropriate language derived from the report's industry profile. Never hardcode vertical-specific terms.

### Audience language mapping

| Report Profile | Audience Term | Entity Term | Search Context |
|---|---|---|---|
| `default_local_business` | customers | businesses | local searches |
| `b2b_services` | qualified prospects | firms | industry searches |
| `government_public_sector` | citizens, constituents | agencies, offices | government services |
| `nonprofit_association` | donors, members, community | organizations | community services |
| `healthcare` (incl. dental) | patients | practices | healthcare searches |
| `hospitality` | guests, travelers | properties | travel/booking searches |

These mappings should be read from `config/industryIntelligence.js` or a new `config/audienceLanguage.js` utility. All `pitchImplication` strings, UI labels, and companion Markdown sections use these terms — never raw "patients" or "dentists."

---

## Shared Infrastructure

### New file: `functions/services/visibilityEnrichmentService.js`

Main orchestrator. Runs all enabled enrichments in parallel.

```javascript
// functions/services/visibilityEnrichmentService.js

const { enrichMapPack } = require('./providers/mapPackProvider');
const { enrichAdSpend } = require('./providers/adSpendProvider');
const { enrichWebsiteSignals } = require('./providers/websiteSignalsProvider');
const { enrichAiVisibility } = require('./providers/aiVisibilityProvider');

/**
 * Run all enabled visibility enrichments for a market report.
 * Non-blocking — failures are logged and skipped.
 *
 * @param {Object} reportData - The market report data (competitors[], qualifiedLeads[], etc.)
 * @param {Object} options - { city, state, industry, subIndustry, industryConfig, qualifiedLeads[] }
 * @returns {Object|null} - { mapPackIntelligence, adSpendIntelligence, websiteConversionSignals, aiVisibilityIntelligence }
 */
async function enrichVisibility(reportData, options) {
  const results = {};
  const { city, state, industry, subIndustry, industryConfig, qualifiedLeads = [] } = options;

  const enableMapPack = process.env.ENABLE_MAP_PACK_ENRICHMENT === 'true';
  const enableAdSpend = process.env.ENABLE_AD_SPEND_ENRICHMENT === 'true';
  const enableWebsite = process.env.ENABLE_WEBSITE_SIGNALS_ENRICHMENT === 'true';
  const enableAiVis = process.env.ENABLE_AI_VISIBILITY_ENRICHMENT === 'true';

  const tasks = [];

  // Phase 1A: Map Pack (Google Maps SERP)
  if (enableMapPack) {
    tasks.push(
      Promise.race([
        enrichMapPack(reportData, { city, state, industry, subIndustry, industryConfig })
          .then(r => { results.mapPackIntelligence = r; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Map Pack timeout')), 12000))
      ]).catch(err => {
        console.error('[VisibilityEnrichment] Map Pack error (non-blocking):', err.message);
      })
    );
  }

  // Phase 1B: Ad Spend (Google Organic SERP — paid items)
  if (enableAdSpend) {
    tasks.push(
      Promise.race([
        enrichAdSpend(reportData, { city, state, industry, subIndustry, industryConfig })
          .then(r => { results.adSpendIntelligence = r; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ad Spend timeout')), 12000))
      ]).catch(err => {
        console.error('[VisibilityEnrichment] Ad Spend error (non-blocking):', err.message);
      })
    );
  }

  // Phase 2: Website Conversion Signals (PageSpeed Insights — cap 3 leads, 20s timeout)
  if (enableWebsite) {
    tasks.push(
      Promise.race([
        enrichWebsiteSignals(qualifiedLeads.slice(0, 3))
          .then(r => { results.websiteConversionSignals = r; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Website signals timeout')), 20000))
      ]).catch(err => {
        console.error('[VisibilityEnrichment] Website signals error (non-blocking):', err.message);
      })
    );
  }

  // Phase 3: AI Visibility (Gemini grounded + Perplexity — 15s timeout)
  if (enableAiVis) {
    tasks.push(
      Promise.race([
        enrichAiVisibility(qualifiedLeads, { city, state, industry, subIndustry, industryConfig })
          .then(r => { results.aiVisibilityIntelligence = r; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI visibility timeout')), 15000))
      ]).catch(err => {
        console.error('[VisibilityEnrichment] AI visibility error (non-blocking):', err.message);
      })
    );
  }

  await Promise.allSettled(tasks);

  return Object.keys(results).length > 0 ? results : null;
}

module.exports = { enrichVisibility };
```

### New file: `functions/services/providers/visibilityCache.js`

Shared cache utility used by all four providers. Do NOT duplicate cache logic in individual provider files.

```javascript
// functions/services/providers/visibilityCache.js

const admin = require('firebase-admin');
const db = admin.firestore();

const COLLECTION = 'visibilityEnrichmentCache';

/**
 * Read from visibility enrichment cache.
 * @param {string} cacheKey
 * @returns {Object|null} cached data, or null if expired/missing
 */
async function readVisibilityCache(cacheKey) {
  try {
    const doc = await db.collection(COLLECTION).doc(cacheKey).get();
    if (!doc.exists) return null;

    const data = doc.data();
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      // Expired — delete async, return null
      db.collection(COLLECTION).doc(cacheKey).delete().catch(() => {});
      return null;
    }

    return data.data || null;
  } catch (err) {
    console.error('[VisibilityCache] Read error:', err.message);
    return null;
  }
}

/**
 * Write to visibility enrichment cache.
 * @param {string} cacheKey
 * @param {Object} data - the data to cache
 * @param {number} ttlHours - time-to-live in hours
 * @param {string} dataType - "map_pack" | "ad_spend" | "website_signals" | "ai_visibility"
 */
async function writeVisibilityCache(cacheKey, data, ttlHours, dataType) {
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await db.collection(COLLECTION).doc(cacheKey).set({
      dataType,
      data,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
    });
  } catch (err) {
    console.error('[VisibilityCache] Write error:', err.message);
  }
}

/**
 * Normalize a string into a safe Firestore document key.
 */
function normalizeCacheKey(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 100);
}

module.exports = { readVisibilityCache, writeVisibilityCache, normalizeCacheKey };
```

### New file: `functions/services/providers/visibilityQueryBuilder.js`

Builds search queries from taxonomy — NOT hardcoded per-vertical lists.

```javascript
// functions/services/providers/visibilityQueryBuilder.js

/**
 * Build visibility search queries from industry taxonomy.
 * Uses industryConfig labels and subIndustry aliases.
 * Never hardcodes vertical-specific query templates.
 *
 * @param {Object} industryConfig - from industryTaxonomy.json (has .label, .googlePlaceQueries, etc.)
 * @param {string} subIndustry - sub-industry label (e.g., "Dental Practice", "Italian Restaurant")
 * @param {string} city
 * @param {string} state
 * @param {string} queryType - "local" (Map Pack / Ad Spend) or "ai" (AI Visibility)
 * @returns {string[]} array of 3-5 search queries
 */
function buildVisibilityQueries(industryConfig, subIndustry, city, state, queryType = 'local') {
  const seed = subIndustry || industryConfig?.label || 'business';
  const reportProfile = industryConfig?.reportProfile || 'default_local_business';

  // Government and nonprofit profiles use different query patterns
  if (reportProfile === 'government_public_sector') {
    return [
      `${seed} ${city} ${state}`,
      `government services ${city} ${state}`,
      `public agencies ${city}`,
      `${seed} office ${city} ${state}`,
      `${city} ${state} government directory`
    ];
  }

  if (reportProfile === 'nonprofit_association') {
    return [
      `${seed} ${city} ${state}`,
      `nonprofit organizations ${city}`,
      `community organizations ${city} ${state}`,
      `${seed} near ${city}`,
      `${city} ${state} ${seed} directory`
    ];
  }

  // Default local business queries
  if (queryType === 'ai') {
    // AI queries use natural recommendation phrasing
    return [
      `best ${seed} in ${city} ${state}`,
      `recommend a ${seed} near ${city}`,
      `top rated ${seed} ${city} ${state}`
    ];
  }

  // Local SERP queries (Map Pack + Ad Spend)
  return [
    `${seed} near me`,
    `${seed} ${city}`,
    `best ${seed} ${city}`,
    `${seed} ${city} ${state}`,
    `top ${seed} near me`
  ];
}

module.exports = { buildVisibilityQueries };
```

### New file: `functions/services/providers/visibilityMatcher.js`

Robust business matching for SERP results → competitor mapping. Uses placeId first, domain second, fuzzy name third.

```javascript
// functions/services/providers/visibilityMatcher.js

/**
 * Match a SERP result to a known competitor/lead.
 * Priority: placeId > domain > fuzzy name match.
 *
 * @param {Object} serpItem - { title, placeId, domain, address }
 * @param {Array} knownBusinesses - competitors[] or qualifiedLeads[] from report
 * @returns {Object|null} matched business, or null
 */
function matchSerpToCompetitor(serpItem, knownBusinesses) {
  // 1. PlaceId match (strongest)
  if (serpItem.placeId) {
    const placeMatch = knownBusinesses.find(b =>
      (b.placeId || b.place_id) === serpItem.placeId
    );
    if (placeMatch) return { business: placeMatch, matchType: 'placeId', confidence: 'high' };
  }

  // 2. Domain match
  if (serpItem.domain) {
    const serpDomain = normalizeDomain(serpItem.domain);
    const domainMatch = knownBusinesses.find(b => {
      const bDomain = normalizeDomain(b.website || b.url || '');
      return bDomain && serpDomain && (bDomain === serpDomain || bDomain.includes(serpDomain) || serpDomain.includes(bDomain));
    });
    if (domainMatch) return { business: domainMatch, matchType: 'domain', confidence: 'high' };
  }

  // 3. Fuzzy name match (token overlap)
  if (serpItem.title) {
    const serpTokens = tokenize(serpItem.title);
    let bestMatch = null;
    let bestScore = 0;

    for (const business of knownBusinesses) {
      const bizName = business.name || business.businessName || '';
      const bizTokens = tokenize(bizName);

      if (bizTokens.length === 0 || serpTokens.length === 0) continue;

      // Count overlapping significant tokens
      const overlap = bizTokens.filter(t => serpTokens.includes(t)).length;
      const score = overlap / Math.max(bizTokens.length, 1);

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = business;
      }
    }

    if (bestMatch) {
      return {
        business: bestMatch,
        matchType: 'fuzzy_name',
        confidence: bestScore >= 0.8 ? 'high' : 'medium'
      };
    }
  }

  return null;
}

/**
 * Check if a business name appears in an AI-generated text response.
 * More tolerant than SERP matching — allows partial token overlap.
 */
function checkAiMention(responseText, businessName) {
  if (!responseText || !businessName) return false;

  const lower = responseText.toLowerCase();
  const tokens = tokenize(businessName);

  // Require at least 50% of significant tokens to appear
  const significantTokens = tokens.filter(t => t.length > 3);
  if (significantTokens.length === 0) return lower.includes(businessName.toLowerCase());

  const matchedTokens = significantTokens.filter(t => lower.includes(t));
  return (matchedTokens.length / significantTokens.length) >= 0.5;
}

function normalizeDomain(url) {
  return (url || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();
}

function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2) // Skip tiny words like "of", "the", "and"
    .filter(t => !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'inc', 'llc', 'ltd', 'corp', 'group', 'center',
  'services', 'solutions', 'company', 'associates', 'partners'
]);

module.exports = { matchSerpToCompetitor, checkAiMention, normalizeDomain };
```

### New env vars (add to `functions/.env`)

```
# Visibility Enrichment — Phase 1A
ENABLE_MAP_PACK_ENRICHMENT=false
DATAFORSEO_LOGIN=<login>
DATAFORSEO_PASSWORD=<password>

# Visibility Enrichment — Phase 1B (separate flag — different SERP surface)
ENABLE_AD_SPEND_ENRICHMENT=false
# Uses same DATAFORSEO_LOGIN/PASSWORD

# Visibility Enrichment — Phase 2
ENABLE_WEBSITE_SIGNALS_ENRICHMENT=false
# Uses existing GOOGLE_PLACES_API_KEY (same GCP project)

# Visibility Enrichment — Phase 3
ENABLE_AI_VISIBILITY_ENRICHMENT=false
# Uses existing GEMINI_API_KEY
# Uses existing PERPLEXITY_API_KEY (from LocalSynch — verify it is set)
```

### Firestore collection

```
visibilityEnrichmentCache/{cacheKey}
  - dataType: "map_pack" | "ad_spend" | "website_signals" | "ai_visibility"
  - data: object (cached result)
  - cachedAt: timestamp
  - expiresAt: timestamp
```

**Cache TTLs:**
- Map Pack: 72 hours
- Ad Spend: 72 hours
- Website Signals: 7 days (168 hours)
- AI Visibility: 24 hours (results are non-deterministic)

---

## TICKET 1A: Google Map Pack Analysis (Phase 1A)

**Priority**: P0
**Estimated effort**: 3-4 hours Claude Code
**API**: DataForSEO Google Maps SERP (`/v3/serp/google/maps/live/advanced`)
**Cost per report**: ~$0.01 (5 SERP calls × $0.002)
**Feature flag**: `ENABLE_MAP_PACK_ENRICHMENT`

### New file: `functions/services/providers/mapPackProvider.js`

```javascript
// functions/services/providers/mapPackProvider.js

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { matchSerpToCompetitor } = require('./visibilityMatcher');

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const CACHE_TTL_HOURS = 72;

/**
 * Get Map Pack (local 3-pack) rankings for key search terms.
 * Uses DataForSEO Google Maps SERP endpoint.
 */
async function enrichMapPack(reportData, options) {
  const { city, state, industry, subIndustry, industryConfig } = options;

  const queries = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'local');
  const competitors = reportData.competitors || reportData.data?.competitors || [];

  const queryAnalysis = [];

  for (const query of queries) {
    const cacheKey = `mappack_${normalizeCacheKey(query)}_${normalizeCacheKey(city)}_${normalizeCacheKey(state)}`;
    const cached = await readVisibilityCache(cacheKey);
    if (cached) {
      queryAnalysis.push(cached);
      continue;
    }

    try {
      const serpData = await callMapsSERP(query, city, state);
      const localResults = extractMapResults(serpData);

      // Match SERP results to known competitors using robust matcher
      const matchedResults = localResults.map(item => {
        const match = matchSerpToCompetitor(item, competitors);
        return {
          ...item,
          matchedCompetitor: match ? (match.business.name || match.business.businessName) : null,
          matchType: match?.matchType || null,
          matchConfidence: match?.confidence || null
        };
      });

      const result = {
        query,
        topThree: matchedResults.filter(r => r.inTopThree),
        allResults: matchedResults,
        totalResults: matchedResults.length,
        knownCompetitorsInPack: matchedResults.filter(r => r.matchedCompetitor && r.inTopThree).length
      };

      queryAnalysis.push(result);
      await writeVisibilityCache(cacheKey, result, CACHE_TTL_HOURS, 'map_pack');

    } catch (err) {
      console.error(`[MapPack] SERP call failed for "${query}":`, err.message);
    }
  }

  return buildMapPackIntelligence(queryAnalysis, competitors);
}

async function callMapsSERP(query, city, state) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DATAFORSEO credentials not set');

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const response = await fetch(`${DATAFORSEO_BASE}/serp/google/maps/live/advanced`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      keyword: query,
      location_name: `${city},${state},United States`,
      language_code: 'en',
      depth: 20
    }])
  });

  if (!response.ok) throw new Error(`DataForSEO Maps API: ${response.status}`);
  const data = await response.json();
  return data.tasks?.[0]?.result?.[0] || {};
}

function extractMapResults(serpData) {
  const items = serpData.items || [];
  return items
    .filter(i => i.type === 'maps_search')
    .slice(0, 10)
    .map((item, idx) => ({
      position: idx + 1,
      title: item.title || '',
      rating: item.rating?.value || null,
      reviewCount: item.rating?.votes_count || null,
      address: item.address || null,
      placeId: item.place_id || null,
      domain: item.domain || null,
      inTopThree: idx < 3
    }));
}

function buildMapPackIntelligence(queryAnalysis, competitors) {
  if (queryAnalysis.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  // Which competitor appears in the 3-pack most consistently?
  const packAppearances = {};
  for (const qa of queryAnalysis) {
    for (const r of (qa.topThree || [])) {
      const key = r.matchedCompetitor || r.title;
      packAppearances[key] = (packAppearances[key] || 0) + 1;
    }
  }

  const dominantPlayer = Object.entries(packAppearances)
    .sort((a, b) => b[1] - a[1])[0];

  const avgCompetitorsInPack = queryAnalysis.length > 0
    ? parseFloat((queryAnalysis.reduce((s, q) => s + (q.knownCompetitorsInPack || 0), 0) / queryAnalysis.length).toFixed(1))
    : 0;

  return {
    status: 'complete',
    queriesAnalyzed: queryAnalysis.length,
    queryAnalysis,
    summary: {
      avgCompetitorsInPack,
      dominantPlayer: dominantPlayer ? dominantPlayer[0] : null,
      dominantPlayerAppearances: dominantPlayer ? dominantPlayer[1] : 0,
      dominantPlayerConsistency: dominantPlayer
        ? Math.round((dominantPlayer[1] / queryAnalysis.length) * 100) + '%'
        : '0%'
    },
    enrichedAt: new Date().toISOString()
  };
}

module.exports = { enrichMapPack };
```

### Firestore schema: `mapPackIntelligence`

```json
{
  "status": "complete|unavailable",
  "queriesAnalyzed": 5,
  "queryAnalysis": [
    {
      "query": "dental practice near me",
      "topThree": [
        {
          "position": 1,
          "title": "Antoine Dental Center",
          "rating": 4.7,
          "reviewCount": 3206,
          "address": "...",
          "placeId": "ChIJ...",
          "domain": "antoinedental.com",
          "inTopThree": true,
          "matchedCompetitor": "Antoine Dental Center",
          "matchType": "placeId",
          "matchConfidence": "high"
        }
      ],
      "allResults": [],
      "totalResults": 10,
      "knownCompetitorsInPack": 2
    }
  ],
  "summary": {
    "avgCompetitorsInPack": 2.4,
    "dominantPlayer": "Antoine Dental Center",
    "dominantPlayerAppearances": 4,
    "dominantPlayerConsistency": "80%"
  },
  "enrichedAt": "2026-05-14T..."
}
```

---

## TICKET 1B: Ad Spend Intelligence (Phase 1B)

**Priority**: P0
**Estimated effort**: 2-3 hours Claude Code (reuses shared infra from 1A)
**API**: DataForSEO Google Organic SERP (`/v3/serp/google/organic/live/advanced`) — paid items
**Cost per report**: ~$0.01 (5 SERP calls × $0.002)
**Feature flag**: `ENABLE_AD_SPEND_ENRICHMENT`

### New file: `functions/services/providers/adSpendProvider.js`

```javascript
// functions/services/providers/adSpendProvider.js

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { matchSerpToCompetitor, normalizeDomain } = require('./visibilityMatcher');

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const CACHE_TTL_HOURS = 72;

/**
 * Detect which competitors are running Google Ads.
 * Uses DataForSEO Google Organic SERP — extracts paid result items.
 * This is a DIFFERENT SERP surface from the Maps endpoint used by Map Pack.
 */
async function enrichAdSpend(reportData, options) {
  const { city, state, industry, subIndustry, industryConfig } = options;

  const queries = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'local');
  const competitors = reportData.competitors || reportData.data?.competitors || [];

  const queryResults = [];

  for (const query of queries) {
    const cacheKey = `adspend_${normalizeCacheKey(query)}_${normalizeCacheKey(city)}_${normalizeCacheKey(state)}`;
    const cached = await readVisibilityCache(cacheKey);
    if (cached) {
      queryResults.push(cached);
      continue;
    }

    try {
      const serpData = await callOrganicSERP(query, city, state);
      const paidItems = extractPaidItems(serpData);

      const result = {
        query,
        hasAds: paidItems.length > 0,
        adCount: paidItems.length,
        advertisers: paidItems
      };

      queryResults.push(result);
      await writeVisibilityCache(cacheKey, result, CACHE_TTL_HOURS, 'ad_spend');

    } catch (err) {
      console.error(`[AdSpend] Organic SERP failed for "${query}":`, err.message);
    }
  }

  return buildAdSpendIntelligence(queryResults, competitors);
}

async function callOrganicSERP(query, city, state) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DATAFORSEO credentials not set');

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const response = await fetch(`${DATAFORSEO_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      keyword: query,
      location_name: `${city},${state},United States`,
      language_code: 'en',
      depth: 10
    }])
  });

  if (!response.ok) throw new Error(`DataForSEO Organic API: ${response.status}`);
  const data = await response.json();
  return data.tasks?.[0]?.result?.[0] || {};
}

function extractPaidItems(serpData) {
  const items = serpData.items || [];
  return items
    .filter(i => i.type === 'paid')
    .map(item => ({
      title: item.title || '',
      domain: item.domain || '',
      description: item.description || '',
      url: item.url || ''
    }));
}

function buildAdSpendIntelligence(queryResults, competitors) {
  if (queryResults.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  const queriesWithAds = queryResults.filter(r => r.hasAds);
  const allAdvertiserDomains = queryResults.flatMap(r => (r.advertisers || []).map(a => a.domain));
  const uniqueAdvertisers = [...new Set(allAdvertiserDomains.filter(Boolean))];

  // Match advertisers to known competitors using domain matching
  const competitorAdStatus = competitors.map(comp => {
    const compDomain = normalizeDomain(comp.website || comp.url || '');
    const isAdvertising = uniqueAdvertisers.some(ad => {
      const adDomain = normalizeDomain(ad);
      return compDomain && adDomain && (compDomain === adDomain || compDomain.includes(adDomain) || adDomain.includes(compDomain));
    });
    return {
      name: comp.name || comp.businessName,
      website: comp.website || comp.url,
      runningGoogleAds: isAdvertising
    };
  });

  const adSaturation = queryResults.length > 0
    ? Math.round((queriesWithAds.length / queryResults.length) * 100)
    : 0;

  return {
    status: 'complete',
    queriesAnalyzed: queryResults.length,
    queriesWithAds: queriesWithAds.length,
    adSaturation: adSaturation + '%',
    uniqueAdvertisers: uniqueAdvertisers.length,
    competitorAdStatus,
    pitchImplication: generateAdSpendImplication(queriesWithAds.length, queryResults.length, uniqueAdvertisers.length),
    enrichedAt: new Date().toISOString()
  };
}

function generateAdSpendImplication(withAds, total, uniqueCount) {
  // Generic language — no vertical-specific terms
  if (withAds === 0) return 'No competitors running Google Ads for these search terms. Organic rankings will dominate visibility with no paid competition.';
  if (withAds < total * 0.3) return `Light ad competition (${withAds}/${total} queries show ads). SEO investment will yield outsized returns with minimal paid competition.`;
  if (withAds < total * 0.7) return `Moderate ad competition (${uniqueCount} advertisers). Businesses without organic SEO are paying a premium for visibility that rankings would provide at lower long-term cost.`;
  return `Heavy ad competition (${uniqueCount} advertisers across ${withAds}/${total} queries). Competitors are spending significantly on ads — SEO pitch should emphasize cost savings and sustainable visibility.`;
}

module.exports = { enrichAdSpend };
```

### Firestore schema: `adSpendIntelligence`

```json
{
  "status": "complete|unavailable",
  "queriesAnalyzed": 5,
  "queriesWithAds": 3,
  "adSaturation": "60%",
  "uniqueAdvertisers": 4,
  "competitorAdStatus": [
    { "name": "Antoine Dental Center", "website": "antoinedental.com", "runningGoogleAds": true },
    { "name": "EaDo Family Dental", "website": "eadofamilydental.com", "runningGoogleAds": false }
  ],
  "pitchImplication": "Moderate ad competition (4 advertisers)...",
  "enrichedAt": "2026-05-14T..."
}
```

---

## TICKET 2: Website Conversion Signals (Phase 2)

**Priority**: P1
**Estimated effort**: 3-4 hours Claude Code
**API**: Google PageSpeed Insights API (free, uses existing `GOOGLE_PLACES_API_KEY`)
**Cost per report**: $0.00
**Feature flag**: `ENABLE_WEBSITE_SIGNALS_ENRICHMENT`
**Timeout**: 20 seconds (PSI is slow)
**Lead cap**: 3 websites per report (not 5 — PSI latency makes 5 risky)

### New file: `functions/services/providers/websiteSignalsProvider.js`

```javascript
// functions/services/providers/websiteSignalsProvider.js

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CACHE_TTL_HOURS = 168; // 7 days

/**
 * Analyze website performance and conversion signals for qualified leads.
 * Uses Google PageSpeed Insights API (free).
 * Capped at 3 leads per report to stay within timeout.
 *
 * @param {Array} qualifiedLeads - leads from market report (already sliced to max 3 by orchestrator)
 * @returns {Object} websiteConversionSignals
 */
async function enrichWebsiteSignals(qualifiedLeads) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const leadSignals = [];

  for (const lead of qualifiedLeads) {
    const website = lead.website || lead.url;
    if (!website) {
      leadSignals.push({
        businessName: lead.name || lead.businessName,
        website: null,
        status: 'no_website'
      });
      continue;
    }

    const url = website.startsWith('http') ? website : `https://${website}`;
    const cacheKey = `website_${normalizeCacheKey(url)}`;
    const cached = await readVisibilityCache(cacheKey);

    if (cached) {
      leadSignals.push({ businessName: lead.name || lead.businessName, website: url, ...cached });
      continue;
    }

    try {
      const signals = await analyzeWebsite(url, apiKey);
      leadSignals.push({ businessName: lead.name || lead.businessName, website: url, ...signals });
      await writeVisibilityCache(cacheKey, signals, CACHE_TTL_HOURS, 'website_signals');
    } catch (err) {
      console.error(`[WebsiteSignals] Failed for ${url}:`, err.message);
      leadSignals.push({
        businessName: lead.name || lead.businessName,
        website: url,
        status: 'error',
        error: err.message
      });
    }
  }

  return {
    status: leadSignals.some(l => l.status === 'complete') ? 'complete' : 'partial',
    leadsAnalyzed: leadSignals.length,
    leadSignals,
    marketSummary: buildMarketWebsiteSummary(leadSignals),
    enrichedAt: new Date().toISOString()
  };
}

async function analyzeWebsite(url, apiKey) {
  // Mobile-first analysis (majority of local searches are mobile)
  const psiUrl = `${PSI_API_BASE}?url=${encodeURIComponent(url)}&key=${apiKey}&category=performance&category=seo&category=best-practices&strategy=mobile`;

  const response = await fetch(psiUrl);
  if (!response.ok) throw new Error(`PageSpeed API: ${response.status}`);

  const data = await response.json();
  const categories = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};

  const performanceScore = Math.round((categories.performance?.score || 0) * 100);
  const seoScore = Math.round((categories.seo?.score || 0) * 100);
  const bestPracticesScore = Math.round((categories['best-practices']?.score || 0) * 100);

  // Core Web Vitals
  const fcp = audits['first-contentful-paint']?.numericValue || null;
  const lcp = audits['largest-contentful-paint']?.numericValue || null;
  const cls = audits['cumulative-layout-shift']?.numericValue || null;

  // Conversion-critical checks
  const hasHttps = url.startsWith('https');
  const isMobileFriendly = audits['viewport']?.score === 1;
  const hasMetaDescription = audits['meta-description']?.score === 1;
  const hasStructuredData = audits['structured-data']?.score !== 0;

  const avgScore = (performanceScore + seoScore + bestPracticesScore) / 3;
  const grade = avgScore >= 90 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 50 ? 'C' : avgScore >= 30 ? 'D' : 'F';

  // Issues (vertical-agnostic language)
  const issues = [];
  if (performanceScore < 50) issues.push('Slow page load — visitors leave before the site finishes loading');
  if (!isMobileFriendly) issues.push('Not mobile-optimized — most local searches happen on phones');
  if (!hasHttps) issues.push('No SSL certificate — search engines penalize non-HTTPS sites');
  if (!hasMetaDescription) issues.push('Missing meta description — reduces click-through rate from search results');
  if (seoScore < 70) issues.push('Weak technical SEO — site structure limits search engine indexing');
  if (lcp && lcp > 4000) issues.push('Largest Contentful Paint over 4 seconds — high bounce rate risk');

  return {
    status: 'complete',
    grade,
    scores: {
      performance: performanceScore,
      seo: seoScore,
      bestPractices: bestPracticesScore,
      overall: Math.round(avgScore)
    },
    coreWebVitals: {
      firstContentfulPaint: fcp ? Math.round(fcp) : null,
      largestContentfulPaint: lcp ? Math.round(lcp) : null,
      cumulativeLayoutShift: cls ? parseFloat(cls.toFixed(3)) : null
    },
    conversionChecks: {
      https: hasHttps,
      mobileFriendly: isMobileFriendly,
      metaDescription: hasMetaDescription,
      structuredData: hasStructuredData
    },
    issues,
    issueCount: issues.length
  };
}

function buildMarketWebsiteSummary(leadSignals) {
  const complete = leadSignals.filter(l => l.status === 'complete');
  if (complete.length === 0) return null;

  const avgPerformance = Math.round(complete.reduce((s, l) => s + (l.scores?.performance || 0), 0) / complete.length);
  const avgSeo = Math.round(complete.reduce((s, l) => s + (l.scores?.seo || 0), 0) / complete.length);
  const mobileFriendlyPct = Math.round((complete.filter(l => l.conversionChecks?.mobileFriendly).length / complete.length) * 100);
  const avgIssues = parseFloat((complete.reduce((s, l) => s + (l.issueCount || 0), 0) / complete.length).toFixed(1));

  return {
    avgPerformanceScore: avgPerformance,
    avgSeoScore: avgSeo,
    mobileFriendlyPercentage: mobileFriendlyPct,
    avgIssuesPerSite: avgIssues,
    // Generic language — no vertical-specific terms
    pitchImplication: generateWebsiteImplication(avgPerformance, avgSeo, mobileFriendlyPct)
  };
}

function generateWebsiteImplication(perf, seo, mobile) {
  if (perf < 50 && seo < 70) return 'Most competitor websites in this market have significant performance and SEO issues. A well-optimized site will stand out immediately.';
  if (perf < 50) return 'Page speed is a major issue across this market. Faster sites will capture more visitors from local search.';
  if (seo < 70) return 'Technical SEO is weak across this market. Proper site structure will yield disproportionate ranking advantage.';
  if (mobile < 80) return 'Several competitors lack mobile optimization. Mobile-first sites have a clear edge given that most local searches happen on phones.';
  return 'Competitor websites are generally well-maintained. Differentiation will come from content quality and conversion optimization.';
}

module.exports = { enrichWebsiteSignals };
```

### Firestore schema: `websiteConversionSignals`

```json
{
  "status": "complete|partial|unavailable",
  "leadsAnalyzed": 3,
  "leadSignals": [
    {
      "businessName": "Dental Wellness Group",
      "website": "https://dentalwellnessgroup.com",
      "status": "complete",
      "grade": "C",
      "scores": { "performance": 42, "seo": 68, "bestPractices": 75, "overall": 62 },
      "coreWebVitals": { "firstContentfulPaint": 2800, "largestContentfulPaint": 5200, "cumulativeLayoutShift": 0.12 },
      "conversionChecks": { "https": true, "mobileFriendly": true, "metaDescription": false, "structuredData": false },
      "issues": ["Slow page load...", "Missing meta description..."],
      "issueCount": 2
    }
  ],
  "marketSummary": {
    "avgPerformanceScore": 48,
    "avgSeoScore": 65,
    "mobileFriendlyPercentage": 67,
    "avgIssuesPerSite": 2.3,
    "pitchImplication": "Most competitor websites have significant performance and SEO issues..."
  },
  "enrichedAt": "2026-05-14T..."
}
```

---

## TICKET 3: AI Visibility Check (Phase 3)

**Priority**: P2
**Estimated effort**: 5-6 hours Claude Code
**APIs**: Gemini grounded search + Perplexity (fallback)
**Cost per report**: ~$0.03-0.05 (9 AI queries across 3 prompts × up to 3 leads)
**Feature flag**: `ENABLE_AI_VISIBILITY_ENRICHMENT`
**Timeout**: 15 seconds

### CRITICAL PRE-IMPLEMENTATION STEP

Before writing any AI Visibility code:

1. **Inspect the current LocalSynch AI Visibility service** in the PathManager codebase
2. **Copy the working Gemini grounded-search pattern** from production — do NOT invent a new syntax
3. Verify the correct `tools` parameter for grounded search (this has changed before — `google_search` vs `google_search_retrieval` vs `googleSearch`)
4. Verify `PERPLEXITY_API_KEY` is set in `functions/.env`
5. **Do NOT hardcode Gemini or Perplexity model names in this sprint.** Read model names from existing config/env vars or the current LocalSynch service. If LocalSynch uses `gemini-3-flash-preview`, use that — do not substitute.
6. **AI Visibility must not be implemented until the working model/tool syntax is verified by running the test script.** This is not optional.

### New file: `functions/services/providers/aiVisibilityProvider.js`

```javascript
// functions/services/providers/aiVisibilityProvider.js

const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');
const { buildVisibilityQueries } = require('./visibilityQueryBuilder');
const { checkAiMention } = require('./visibilityMatcher');

const CACHE_TTL_HOURS = 24; // Short TTL — AI results are non-deterministic

/**
 * Check AI visibility for qualified leads.
 * Queries Gemini (grounded search) + Perplexity (fallback).
 *
 * IMPORTANT: Results are directional signals, NOT definitive visibility scores.
 * AI responses vary by model, prompt, provider, grounding, location, and time.
 * All UI must reflect this (see rendering notes below).
 *
 * @param {Array} qualifiedLeads - leads from market report
 * @param {Object} options - { city, state, industry, subIndustry, industryConfig }
 * @returns {Object} aiVisibilityIntelligence
 */
async function enrichAiVisibility(qualifiedLeads, options) {
  const { city, state, industry, subIndustry, industryConfig } = options;

  const queries = buildVisibilityQueries(industryConfig, subIndustry, city, state, 'ai');

  // Collect business names to check (max 5)
  const businessNames = qualifiedLeads
    .slice(0, 5)
    .map(l => (l.name || l.businessName || ''))
    .filter(Boolean);

  const queryResults = [];

  for (const query of queries) {
    const cacheKey = `aivisibility_${normalizeCacheKey(query)}_${normalizeCacheKey(city)}_${normalizeCacheKey(state)}`;
    const cached = await readVisibilityCache(cacheKey);
    if (cached) {
      queryResults.push(cached);
      continue;
    }

    try {
      // Try Gemini grounded search first
      // IMPORTANT: Copy the working syntax from LocalSynch AI Visibility service.
      // Do NOT hardcode model name or tool syntax — read from production pattern.
      const result = await queryGeminiGrounded(query);

      const mentioned = businessNames.filter(name => checkAiMention(result.response, name));
      const notMentioned = businessNames.filter(name => !checkAiMention(result.response, name));

      const queryResult = {
        query,
        provider: 'gemini_grounded',
        model: result.model || 'unknown',
        responseSummary: result.response.slice(0, 500),
        mentionedBusinesses: mentioned,
        notMentionedBusinesses: notMentioned,
        totalMentioned: mentioned.length,
        totalChecked: businessNames.length,
        checkedAt: new Date().toISOString()
      };

      queryResults.push(queryResult);
      await writeVisibilityCache(cacheKey, queryResult, CACHE_TTL_HOURS, 'ai_visibility');

    } catch (err) {
      console.error(`[AIVisibility] Gemini failed for "${query}":`, err.message);

      // Fallback: Perplexity
      try {
        const result = await queryPerplexity(query);

        const mentioned = businessNames.filter(name => checkAiMention(result.response, name));
        const notMentioned = businessNames.filter(name => !checkAiMention(result.response, name));

        const queryResult = {
          query,
          provider: 'perplexity',
          model: result.model || 'sonar',
          responseSummary: result.response.slice(0, 500),
          mentionedBusinesses: mentioned,
          notMentionedBusinesses: notMentioned,
          totalMentioned: mentioned.length,
          totalChecked: businessNames.length,
          checkedAt: new Date().toISOString()
        };

        queryResults.push(queryResult);
        await writeVisibilityCache(cacheKey, queryResult, CACHE_TTL_HOURS, 'ai_visibility');

      } catch (fallbackErr) {
        console.error(`[AIVisibility] Perplexity fallback also failed for "${query}":`, fallbackErr.message);
      }
    }
  }

  return buildAiVisibilityIntelligence(queryResults, qualifiedLeads);
}

/**
 * Query Gemini with grounded search.
 * COPY THE WORKING PATTERN FROM LocalSynch AI Visibility service.
 * Do not invent new syntax. The grounded search tool parameter has changed before.
 */
async function queryGeminiGrounded(query) {
  // TODO: Implementation must be copied from working LocalSynch production code.
  // The model name, tool syntax, and response parsing should match exactly.
  // Placeholder structure:
  //
  // const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // const model = genAI.getGenerativeModel({
  //   model: '<COPY FROM LOCALSYNCH>',
  //   tools: [<COPY FROM LOCALSYNCH>]
  // });
  // const result = await model.generateContent(query);
  // return { response: result.response.text(), model: '<model used>' };
  //
  throw new Error('queryGeminiGrounded not yet implemented — copy pattern from LocalSynch');
}

async function queryPerplexity(query) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [{ role: 'user', content: query }]
    })
  });

  if (!response.ok) throw new Error(`Perplexity API: ${response.status}`);
  const data = await response.json();
  return {
    response: data.choices?.[0]?.message?.content || '',
    model: data.model || 'sonar'
  };
}

function buildAiVisibilityIntelligence(queryResults, leads) {
  if (queryResults.length === 0) {
    return { status: 'unavailable', enrichedAt: new Date().toISOString() };
  }

  // Per-lead mention rate
  const leadScores = leads.slice(0, 5).map(lead => {
    const name = lead.name || lead.businessName || '';
    const mentionCount = queryResults.filter(qr =>
      (qr.mentionedBusinesses || []).some(m => m.toLowerCase() === name.toLowerCase())
    ).length;

    const mentionRate = Math.round((mentionCount / queryResults.length) * 100);

    return {
      businessName: name,
      mentionRate, // NOT called "aiVisibilityScore" — it's a mention rate, not a score
      mentionedIn: mentionCount,
      queriesChecked: queryResults.length,
      // Directional verdict, NOT definitive
      verdict: mentionRate >= 66 ? 'frequently_mentioned' : mentionRate >= 33 ? 'sometimes_mentioned' : 'not_mentioned_in_sample'
    };
  });

  const avgMentionRate = leadScores.length > 0
    ? Math.round(leadScores.reduce((s, l) => s + l.mentionRate, 0) / leadScores.length)
    : 0;
  const notMentionedCount = leadScores.filter(l => l.verdict === 'not_mentioned_in_sample').length;

  return {
    status: 'complete',
    // Metadata for trust/transparency
    confidence: 'directional', // ALWAYS directional — AI results are non-deterministic
    queriesRun: queryResults.length,
    providers: [...new Set(queryResults.map(q => q.provider))],
    models: [...new Set(queryResults.map(q => q.model).filter(Boolean))],
    sampleNote: `${queryResults.length} prompts checked across ${[...new Set(queryResults.map(q => q.provider))].join(' and ')}. Results are a directional signal and may vary.`,
    // Per-lead data
    leadScores,
    // Market summary
    marketSummary: {
      avgMentionRate,
      notMentionedInSample: notMentionedCount,
      totalLeadsChecked: leadScores.length,
      pitchImplication: generateAiVisibilityImplication(avgMentionRate, notMentionedCount, leadScores.length)
    },
    // Query details (for transparency)
    queryDetails: queryResults.map(q => ({
      query: q.query,
      provider: q.provider,
      model: q.model,
      mentionedCount: q.totalMentioned,
      checkedCount: q.totalChecked,
      checkedAt: q.checkedAt
    })),
    enrichedAt: new Date().toISOString()
  };
}

// Generic language — no vertical-specific terms
function generateAiVisibilityImplication(avgRate, notMentioned, total) {
  if (avgRate < 20) return `Low AI mention rate across sampled recommendation prompts. ${notMentioned} of ${total} businesses checked were not mentioned. Early movers who optimize for AI citations can capture visibility their competitors are missing.`;
  if (avgRate < 50) return `Most businesses in this market have low AI mention rates. AI assistants are directing searchers to only a few dominant players.`;
  return `Moderate AI mention rates across this market. Some businesses are being cited, but there is room to improve AI-powered discovery.`;
}

module.exports = { enrichAiVisibility };
```

### Firestore schema: `aiVisibilityIntelligence`

```json
{
  "status": "complete|partial|unavailable",
  "confidence": "directional",
  "queriesRun": 3,
  "providers": ["gemini_grounded", "perplexity"],
  "models": ["gemini-2.5-flash", "sonar"],
  "sampleNote": "3 prompts checked across gemini_grounded and perplexity. Results are a directional signal and may vary.",
  "leadScores": [
    {
      "businessName": "Dental Wellness Group",
      "mentionRate": 0,
      "mentionedIn": 0,
      "queriesChecked": 3,
      "verdict": "not_mentioned_in_sample"
    },
    {
      "businessName": "Antoine Dental Center",
      "mentionRate": 100,
      "mentionedIn": 3,
      "queriesChecked": 3,
      "verdict": "frequently_mentioned"
    }
  ],
  "marketSummary": {
    "avgMentionRate": 33,
    "notMentionedInSample": 2,
    "totalLeadsChecked": 3,
    "pitchImplication": "Low AI mention rate across sampled recommendation prompts..."
  },
  "queryDetails": [
    {
      "query": "best dental practice in Houston TX",
      "provider": "gemini_grounded",
      "model": "gemini-2.5-flash",
      "mentionedCount": 1,
      "checkedCount": 3,
      "checkedAt": "2026-05-14T..."
    }
  ],
  "enrichedAt": "2026-05-14T..."
}
```

---

## Integration Points (All Tickets)

### Updated: `functions/api/market.js`

Add visibility enrichment call after the existing public data enrichment block:

```javascript
// After the existing publicDataEnrichmentService block:

// Visibility Enrichment (Map Pack, Ad Spend, Website Signals, AI Visibility)
try {
  const { enrichVisibility } = require('../services/visibilityEnrichmentService');
  const visibilityResult = await enrichVisibility(reportData, {
    city, state, industry, subIndustry, industryConfig,
    qualifiedLeads: reportData.qualifiedLeads || reportData.data?.qualifiedLeads || []
  });
  if (visibilityResult) {
    if (visibilityResult.mapPackIntelligence) reportData.mapPackIntelligence = visibilityResult.mapPackIntelligence;
    if (visibilityResult.adSpendIntelligence) reportData.adSpendIntelligence = visibilityResult.adSpendIntelligence;
    if (visibilityResult.websiteConversionSignals) reportData.websiteConversionSignals = visibilityResult.websiteConversionSignals;
    if (visibilityResult.aiVisibilityIntelligence) reportData.aiVisibilityIntelligence = visibilityResult.aiVisibilityIntelligence;
  }
} catch (visErr) {
  console.error('[MarketIntel] Visibility enrichment error (non-blocking):', visErr.message);
}
```

### Updated: `buildTieredResponse()` in `market.js`

```javascript
// Add to baseResponse:
mapPackIntelligence: reportData.mapPackIntelligence || null,
adSpendIntelligence: reportData.adSpendIntelligence || null,
websiteConversionSignals: reportData.websiteConversionSignals || null,
aiVisibilityIntelligence: reportData.aiVisibilityIntelligence || null,
```

### Updated: `functions/utils/reportFieldResolver.js`

Four new resolvers (standard dual-path pattern):

```javascript
getMapPackIntelligence(report) {
  return report.data?.mapPackIntelligence || report.mapPackIntelligence || null;
},
getAdSpendIntelligence(report) {
  return report.data?.adSpendIntelligence || report.adSpendIntelligence || null;
},
getWebsiteConversionSignals(report) {
  return report.data?.websiteConversionSignals || report.websiteConversionSignals || null;
},
getAiVisibilityIntelligence(report) {
  return report.data?.aiVisibilityIntelligence || report.aiVisibilityIntelligence || null;
}
```

### Updated: `functions/services/marketIntelPitchContext.js`

**IMPORTANT: Use resolver helpers, not direct report field access.** Report fields may live under `report.data`, `report.reportData`, or root.

```javascript
const { getMapPackIntelligence, getAdSpendIntelligence, getWebsiteConversionSignals, getAiVisibilityIntelligence } = require('../utils/reportFieldResolver');

// Map Pack context
const mpi = getMapPackIntelligence(report);
if (mpi?.status === 'complete') {
  context.mapPackInsight = mpi.summary;
}

// Ad Spend context
const asi = getAdSpendIntelligence(report);
if (asi?.status === 'complete') {
  context.adSpendInsight = {
    adSaturation: asi.adSaturation,
    pitchImplication: asi.pitchImplication
  };
}

// Website Signals context (summary only — not per-lead details)
const wcs = getWebsiteConversionSignals(report);
if (wcs?.marketSummary) {
  context.websiteInsight = wcs.marketSummary;
}

// AI Visibility context (directional signal)
const aiv = getAiVisibilityIntelligence(report);
if (aiv?.marketSummary) {
  context.aiVisibilityInsight = {
    ...aiv.marketSummary,
    confidence: 'directional'
  };
}
```

### Updated: `functions/services/pitchCompanionMd.js`

Conditional sections using audience-appropriate language. Each section MUST resolve audience terms from the report profile before generating copy.

```javascript
// Resolve audience language from report profile
const reportProfile = report.industry?.reportProfile || report.data?.industry?.reportProfile || 'default_local_business';
const audienceLanguage = getAudienceLanguage(reportProfile);
// audienceLanguage = { audience: 'customers', entity: 'businesses', searchContext: 'local searches' }
// For healthcare: { audience: 'patients', entity: 'practices', searchContext: 'healthcare searches' }
// For government: { audience: 'citizens', entity: 'agencies', searchContext: 'government services' }
// For nonprofit: { audience: 'donors, members, and community', entity: 'organizations', searchContext: 'community services' }
```

Conditional Markdown sections (use `audienceLanguage` terms, not hardcoded "customers" or "patients"):

```markdown
## Local Search Visibility (if mapPackIntelligence)
## Paid Ad Landscape (if adSpendIntelligence)
## Website Performance (if websiteConversionSignals)
## AI Search Visibility (if aiVisibilityIntelligence — include confidence note)
```

### New utility: audience language resolver

Add to `functions/services/providers/visibilityQueryBuilder.js` or a new `config/audienceLanguage.js`:

```javascript
const AUDIENCE_LANGUAGE = {
  default_local_business: { audience: 'customers', entity: 'businesses', searchContext: 'local searches' },
  b2b_services: { audience: 'qualified prospects', entity: 'firms', searchContext: 'industry searches' },
  government_public_sector: { audience: 'citizens, constituents', entity: 'agencies, offices', searchContext: 'government services' },
  nonprofit_association: { audience: 'donors, members, and community', entity: 'organizations', searchContext: 'community services' },
  healthcare: { audience: 'patients', entity: 'practices', searchContext: 'healthcare searches' },
  hospitality: { audience: 'guests, travelers', entity: 'properties', searchContext: 'travel and booking searches' },
  fitness_wellness: { audience: 'members, clients', entity: 'studios, gyms', searchContext: 'fitness searches' }
};

function getAudienceLanguage(reportProfile) {
  return AUDIENCE_LANGUAGE[reportProfile] || AUDIENCE_LANGUAGE.default_local_business;
}

module.exports = { getAudienceLanguage, AUDIENCE_LANGUAGE };
```

All `pitchImplication` generators in all four providers should accept and use `audienceLanguage` so output never drifts back into generic SMB language. Example:

```javascript
// Instead of: "Businesses without organic SEO are paying a premium..."
// Use: `${audienceLanguage.entity} without organic SEO are paying a premium for visibility that ${audienceLanguage.audience} would find organically...`
```

---

## Frontend Rendering

### Overview Tab: Visibility Snapshot (compact)

Do NOT dump four detailed sections into the Overview tab. Render a compact summary card:

```
┌──────────────────────────────────────────────────────────┐
│  VISIBILITY SNAPSHOT                                      │
│                                                          │
│  🗺 Map Pack: 2.4 competitors in top 3 on average        │
│  💰 Paid Ads: 60% ad saturation                          │
│  🌐 Website: Avg performance 48/100                      │
│  🤖 AI Visibility: 33% avg mention rate (directional)    │
│                                                          │
│  [View Details →]                                        │
└──────────────────────────────────────────────────────────┘
```

### Detailed View: New "Visibility" tab or section within SEO/Trends

Four detailed sections rendered conditionally:

```javascript
// synchintro-app/js/pages/market.js

renderVisibilitySnapshot(report)       // Compact card for Overview tab
renderMapPackSection(report)           // Table: keyword → top 3, competitor presence
renderAdSpendSection(report)           // Table: competitor ad status, saturation
renderWebsiteSignalsSection(report)    // Cards: per-lead grade, issues, market summary
renderAiVisibilitySection(report)      // Cards: per-lead mention rate, providers, confidence note
```

### AI Visibility UI: Trust language

The AI Visibility section MUST include:

```
AI Visibility Sample
3 prompts checked · Gemini grounded + Perplexity · directional signal

Results indicate mention frequency in sampled AI recommendation prompts.
AI responses vary by model, time, and query — treat as a directional signal.
```

Never render:
- ❌ "This business is invisible to AI"
- ❌ "AI Visibility Score: 0/100"
- ❌ Any language implying definitive or stable measurement

Always render:
- ✅ "Not mentioned in this AI visibility sample"
- ✅ "Low AI mention rate across sampled recommendation prompts"
- ✅ "33% mention rate (directional)"

### PDF Export

Each section added conditionally to `downloadReport()`. AI Visibility section must include the confidence/sample disclaimer in PDF output.

---

## Test Scripts — MANDATORY (Test-First Implementation)

**RULE: Write and run the test script for each phase BEFORE implementing the provider. Do not wire provider output into `market.js` until the test script confirms actual response field names match the provider code.**

This matters because recent bugs (Instantly `campaign_id` → `campaign`, NAICS `722511` fallback, ProPublica `filings_with_data` path) were all caused by field-name or field-path mismatches between assumed and actual API responses.

### Implementation workflow per phase:

```
1. Write test script (probe API, print raw response, log field names)
2. Run test script → confirm response structure
3. Update provider code if field names differ from spec
4. Implement provider
5. Run provider with test data → verify Firestore field written correctly
6. ONLY THEN wire into market.js and enable feature flag
```

### Test scripts (create in `scripts/`):

```bash
# Phase 1A: Probe DataForSEO Maps SERP — print raw response, confirm item types and field names
node scripts/test-dataforseo-maps.js --query "restaurant near me" --city Houston --state TX

# Phase 1B: Probe DataForSEO Organic SERP — confirm paid item type and field structure
node scripts/test-dataforseo-organic.js --query "restaurant Houston" --city Houston --state TX

# Phase 2: Probe PageSpeed Insights — confirm category scores, audit keys, CWV field names
node scripts/test-pagespeed.js --url "https://example.com"

# Phase 3: Verify Gemini grounded search syntax — copy from LocalSynch, confirm it works
# ALSO verify Perplexity response shape
node scripts/test-ai-visibility.js --query "best restaurant in Houston TX" --businesses "Example Restaurant,Another Restaurant"
```

Each test script should:
- Print the raw API response (truncated to first 2000 chars)
- Print all top-level field names
- Print the specific fields the provider will extract
- Exit with error if expected fields are missing

---

## Activation Sequence

Each phase follows the test-first workflow: test script → verify fields → implement provider → wire into market.js → enable flag.

```
PHASE 1A: Map Pack
  1. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in functions/.env
  2. Write + run scripts/test-dataforseo-maps.js → confirm item types, field names
  3. Implement mapPackProvider.js using confirmed field names
  4. Deploy functions
  5. Set ENABLE_MAP_PACK_ENRICHMENT=true → deploy → test on one report → verify Firestore field

PHASE 1B: Ad Spend
  6. Write + run scripts/test-dataforseo-organic.js → confirm paid item structure
  7. Implement adSpendProvider.js using confirmed field names
  8. Set ENABLE_AD_SPEND_ENRICHMENT=true → deploy → test → verify

PHASE 2: Website Signals
  9. Write + run scripts/test-pagespeed.js → confirm category keys, audit keys, CWV paths
  10. Implement websiteSignalsProvider.js using confirmed field names
  11. Set ENABLE_WEBSITE_SIGNALS_ENRICHMENT=true → deploy → test (watch for PSI timeouts)

PHASE 3: AI Visibility
  12. Inspect LocalSynch AI Visibility service → copy working Gemini grounded-search pattern
  13. Verify PERPLEXITY_API_KEY is set
  14. Write + run scripts/test-ai-visibility.js → confirm both providers work, verify model names
  15. Implement aiVisibilityProvider.js using confirmed patterns (NO hardcoded model names)
  16. Set ENABLE_AI_VISIBILITY_ENRICHMENT=true → deploy → test → verify confidence metadata renders
  17. Deploy Firestore rules update for visibilityEnrichmentCache
```

Each flag is independent. Ship Phase 1A/1B first, observe for a few days, then Phase 2, then Phase 3.

---

## Cost Impact

| Feature | API Provider | Cost Per Report | Monthly @ 20 Reports |
|---------|-------------|----------------|---------------------|
| Map Pack (1A) | DataForSEO Maps SERP | ~$0.01 (5 calls × $0.002) | ~$0.20 |
| Ad Spend (1B) | DataForSEO Organic SERP | ~$0.01 (5 calls × $0.002) | ~$0.20 |
| Website Signals (2) | PageSpeed Insights | $0.00 (free) | $0.00 |
| AI Visibility (3) | Gemini + Perplexity | ~$0.03-0.05 (9 queries) | ~$0.60-1.00 |
| **TOTAL (all enabled)** | | **~$0.05-0.07/report** | **~$1.00-1.40/month** |

No credit model change needed. Enrichment costs are included in existing Market Intel report credit cost.

---

## File Summary

### New files (9)

| File | Purpose |
|------|---------|
| `functions/services/visibilityEnrichmentService.js` | Orchestrator — runs all enabled enrichments in parallel |
| `functions/services/providers/mapPackProvider.js` | Google Maps SERP → Map Pack intelligence |
| `functions/services/providers/adSpendProvider.js` | Google Organic SERP → Ad Spend intelligence |
| `functions/services/providers/websiteSignalsProvider.js` | PageSpeed Insights → Website conversion signals |
| `functions/services/providers/aiVisibilityProvider.js` | Gemini grounded + Perplexity → AI visibility sample |
| `functions/services/providers/visibilityCache.js` | Shared Firestore cache utility |
| `functions/services/providers/visibilityQueryBuilder.js` | Taxonomy-based search query builder + audience language resolver |
| `functions/services/providers/visibilityMatcher.js` | Robust business matching (placeId → domain → fuzzy name) |
| `config/audienceLanguage.js` | Report-profile-to-audience-term mapping (optional — can live in queryBuilder) |

### Modified files (6)

| File | Changes |
|------|---------|
| `functions/api/market.js` | Add visibility enrichment call + 4 fields in `buildTieredResponse()` |
| `functions/utils/reportFieldResolver.js` | 4 new resolvers |
| `functions/services/marketIntelPitchContext.js` | 4 new context blocks (using resolvers, not direct access) |
| `functions/services/pitchCompanionMd.js` | 4 new conditional Markdown sections (using audience language) |
| `synchintro-app/js/pages/market.js` | Visibility Snapshot + 4 detailed render functions + PDF sections |
| `firestore.rules` | Add `visibilityEnrichmentCache` read-only rule |

### New Firestore collection (1)

| Collection | Purpose |
|-----------|---------|
| `visibilityEnrichmentCache/{cacheKey}` | Shared cache for all 4 providers with per-type TTLs |

### Firestore security rules for new collection

Add to `firestore.rules`:

```
match /visibilityEnrichmentCache/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

Cloud Functions Admin SDK writes to this collection. Client-side reads are allowed (for cache-hit logging or debugging) but client-side writes are blocked.

### New env vars (5)

| Variable | Purpose |
|----------|---------|
| `ENABLE_MAP_PACK_ENRICHMENT` | Feature flag — Phase 1A |
| `ENABLE_AD_SPEND_ENRICHMENT` | Feature flag — Phase 1B |
| `ENABLE_WEBSITE_SIGNALS_ENRICHMENT` | Feature flag — Phase 2 |
| `ENABLE_AI_VISIBILITY_ENRICHMENT` | Feature flag — Phase 3 |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | DataForSEO API auth (shared by 1A + 1B) |
