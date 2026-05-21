# AIsynch Technical Architecture (v2)

**Product:** AIsynch — AI Visibility Intelligence Add-On Module  
**Owner:** Charles Berry  
**Version:** 2 — incorporates confidence scoring, PII safeguards, abuse protection, naming corrections, llms.txt weight adjustment, and Pub/Sub migration path

**Repos:**

| Component | Repo | Path |
| :---- | :---- | :---- |
| Scoring engine \+ monitoring cron \+ billing hooks | `pathsynch-pitch-generator` | `C:\Users\tdh35\pathsynch-pitch-generator\functions` |
| PathManager dashboard UI (AI Readiness card, trend graph) | `PathManager_backend` \+ frontend | EC2 backend at `3.88.108.6` |
| Free scan API endpoint | `pathsynch-pitch-generator` | New Cloud Function |
| SynchIntro integration (Market Intel Visibility tab) | `pathsynch-pitch-generator` \+ `synchintro-app` | Existing enrichment pipeline |
| Review widget extension (page signals) | `synchintro-app` or widget CDN | `cdn.qrsyn.ch/widget/` |

**Firebase project:** `pathsynch-pitch-creation`  
**GCP project:** `pathconnect-442522`  
**MongoDB:** Atlas cluster `PathConnect1`, db `dbPathsynch`

---

## Build Phases

Do not build all 14 features at once. The roadmap is a product vision, not a sprint plan.

### Phase 0 — Pre-Work (Required before Phase 1A, \~30 min Claude Code)

These items resolve conflicts and gaps between the existing codebase and the AIsynch architecture. Complete all before writing any new AIsynch code.

| \# | Task | File(s) | Effort |
| :---- | :---- | :---- | :---- |
| 0A | Export lower-level functions from aiVisibilityProvider.js | `functions/services/providers/aiVisibilityProvider.js` | 5 min |
| 0B | Fix citation grounding domain bug (vertexaisearch.cloud.google.com) | `functions/services/providers/aiVisibilityProvider.js` | 10 min |
| 0C | Add Firestore composite indexes for all AIsynch collections | `firestore.indexes.json` | 5 min |
| 0D | Add model override parameter to queryGeminiGrounded | `functions/services/providers/aiVisibilityProvider.js` | 5 min |
| 0E | Cap citation retrieved percentage at 100% | `functions/services/providers/aiVisibilityProvider.js` | 5 min |

**0A — Export lower-level functions from aiVisibilityProvider.js**

The monitoring cron needs to call `queryGeminiGrounded()` and `queryPerplexity()` independently (parallel, not fallback) and reuse the citation analysis functions. Currently only `enrichAiVisibility` is exported (line 576). Change to:

```javascript
// Current (line 576):
module.exports = { enrichAiVisibility };

// Change to:
module.exports = {
  enrichAiVisibility,
  queryGeminiGrounded,
  queryPerplexity,
  _buildCitationCollector,
  _buildCitationIntelligence,
  _buildGapAnalysis,
  _classifyDomain,
  _classifyUrlType
};
```

**Why parallel instead of fallback:** The existing per-report enrichment (called from `visibilityEnrichmentService.js`) uses Perplexity as a fallback only when Gemini fails (lines 321-331 of aiVisibilityProvider.js). The AIsynch monitoring cron queries Gemini AND Perplexity (and optionally Claude) in parallel because the multi-model split view requires per-model data stored separately in `aiVisibilitySnapshots.models.gemini` and `aiVisibilitySnapshots.models.perplexity`. These are two different invocation patterns using the same underlying query functions. The monitoring cron does NOT call `enrichAiVisibility()` — it calls the lower-level functions directly.

**0B — Fix citation grounding domain bug**

The `_buildCitationCollector()` function processes every URL from Gemini grounding chunks, including internal Google grounding infrastructure domains like `vertexaisearch.cloud.google.com`. These get classified as "Other" and inflate retrieval counts (the Charlotte report showed 1033% retrieved for this domain). The monitoring cron would accumulate this bad data over time.

Add exclusion list as a module-level constant and filter in `_buildCitationCollector()`:

```javascript
// Add near the top of aiVisibilityProvider.js (after _CORPORATE_TERMS):
const _INTERNAL_GROUNDING_DOMAINS = [
  'vertexaisearch.cloud.google.com',
  'vertexai.google.com',
  'generativelanguage.googleapis.com'
];

// Inside _buildCitationCollector, after: var domain = _normalizeCitationDomain(urlItem.uri);
// Add this check (around line 163):
var isInternal = false;
for (var gi = 0; gi < _INTERNAL_GROUNDING_DOMAINS.length; gi++) {
  if (domain === _INTERNAL_GROUNDING_DOMAINS[gi] || domain.endsWith('.' + _INTERNAL_GROUNDING_DOMAINS[gi])) {
    isInternal = true; break;
  }
}
if (isInternal) continue;
```

**0C — Add Firestore composite indexes for all AIsynch collections**

Append to `firestore.indexes.json` inside the `indexes` array, before the closing `]`. Deploy indexes BEFORE deploying functions — they take 2-5 minutes to build:

```
firebase deploy --only firestore:indexes --project pathsynch-pitch-creation
```

```json
{
  "collectionGroup": "aiReadinessScores",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "scoredAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiVisibilitySnapshots",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "snapshotDate", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aisynchSubscriptions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "activatedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiReadinessScans",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "createdAt", "order": "ASCENDING" },
    { "fieldPath": "email", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "scheduledReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "nextGeneration", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "generatedReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "agencyMerchantId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "generatedReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "clientMerchantId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiVisibilityTriggers",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "triggeredAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiReadinessRateLimits",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "date", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "competitorValidationLogs",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "industry", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**0D — Add model override parameter to queryGeminiGrounded**

The existing function hardcodes `gemini-2.5-flash` (SIMPLE tier). The monitoring cron needs `gemini-3-flash-preview` (PRIMARY tier) for better quality on persistent tracking. Add an optional parameter instead of duplicating the function:

```javascript
// Current signature (line 361):
async function queryGeminiGrounded(query, businessNames) {

// Change to:
async function queryGeminiGrounded(query, businessNames, modelOverride) {

// Current model line (line 369):
    model: 'gemini-2.5-flash',

// Change to:
    model: modelOverride || 'gemini-2.5-flash',
```

Per-report enrichment calls `queryGeminiGrounded(query, businessNames)` — no change, uses SIMPLE. The monitoring cron calls `queryGeminiGrounded(query, businessNames, 'gemini-3-flash-preview')` — uses PRIMARY.

**0E — Cap citation retrieved percentage at 100%**

In `_buildCitationIntelligence()` (line 246), the `citationRatePct` can exceed 100% when a domain has multiple URLs cited in a single query's grounding chunks. This produced the 1033% value in the Charlotte report.

```javascript
// Current (line 246):
citationRatePct: totalQueries > 0 ? Math.round((e.retrievals / totalQueries) * 100) : 0,
citationRate:    totalQueries > 0 ? Math.round((e.retrievals / totalQueries) * 100) + '%' : '0%'

// Change to:
citationRatePct: totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) : 0,
citationRate:    totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) + '%' : '0%'
```

**Phase 0 Deploy:**

```
1. Make all 0A-0E changes to aiVisibilityProvider.js
2. Add indexes to firestore.indexes.json
3. Deploy indexes first:
   firebase deploy --only firestore:indexes --project pathsynch-pitch-creation
4. Wait 2-5 minutes for indexes to build
5. Run existing tests to confirm no regression:
   cd functions && npx jest --no-coverage
6. Deploy functions:
   firebase deploy --only functions --project pathsynch-pitch-creation
7. Verify: generate a Market Intel report and check that
   vertexaisearch.cloud.google.com no longer appears in Citation Sources
```

---

### Phase 1A — First Deploy (10-12 hours Claude Code)

| \# | Feature | Effort |
| :---- | :---- | :---- |
| 1 | AI Readiness scoring engine | 3-4 hrs |
| 2 | Firestore schema (all collections) | Included in \#1 |
| 3 | Free scan endpoint on pathsynch.com | 2-3 hrs |
| 4 | Save scan results to Firestore | Included in \#3 |
| 5 | Basic PathManager AI Readiness score card | 2-3 hrs |
| 6 | Competitor AI Readiness comparison | 2-3 hrs |

Ship Phase 1A. Verify end-to-end with a real merchant. Use in sales conversations. Capture leads from the free scan. Then proceed.

### Phase 1B — Retention Layer (6-8 hours Claude Code)

| \# | Feature | Effort |
| :---- | :---- | :---- |
| 7 | Persistent monitoring cron | 4-6 hrs |
| 8 | Auto-generated prompt library | Included in \#7 |
| 9 | AI Readiness trend graph in PathManager | 2-3 hrs |

### Phase 2 — Depth Layer (10-14 hours Claude Code)

| \# | Feature | Effort |
| :---- | :---- | :---- |
| 10 | Citation source depth (domain types, Gap Score) | 3-4 hrs |
| 11 | Multi-model split view with competitor heatmap | 3-4 hrs |
| 12 | llms.txt generation | 2-3 hrs |
| 13 | Review widget extension (page signals \+ AI crawl readiness check) | 2-3 hrs |
| 13b | Auto-suggested competitors from co-mention analysis | 2-3 hrs |

**Item 13b — Auto-suggested competitors from co-mentions:**

After 2-3 weeks of monitoring data, the monitoring cron has captured which business names appear alongside the merchant in AI responses. If a business name appears in 3+ responses across 2+ prompts and is NOT already in the merchant's competitor list, surface it as a suggested competitor in the PathManager dashboard with a "Add to tracking" button. This mirrors Peec AI's auto-suggestion feature (where competitor brands are suggested when repeatedly co-mentioned in tracked prompts) but adapted for local SMBs.

Implementation: after each monitoring run, scan `responseSnippets` across all prompts for business names that appear alongside the merchant. Store co-mention counts in a `suggestedCompetitors` sub-collection or field on `aiReadinessScores`. When a name crosses the threshold (3+ co-mentions), add it to the dashboard as a suggestion. The merchant can accept (adds to tracked competitors) or dismiss (hidden for 90 days).

### Phase 3 — Cross-Product Integration \+ Agency Reporting (13-21 hours Claude Code)

| \# | Feature | Effort |
| :---- | :---- | :---- |
| 14 | GA4 AI traffic attribution | 2-3 hrs |
| 15 | AI mention → review request trigger | 4-6 hrs |
| 16 | AI Readiness badge on QRsynch page | 1 hr |
| 17 | White-label report generation (PDF \+ hosted) | 3-4 hrs |
| 18 | Scheduled report automation (cron \+ email delivery) | 3-4 hrs |
| 19 | Agency brand override configuration UI in PathManager | 2-3 hrs |
| 20 | Looker Studio connector | 2-3 hrs |

### Future (Not In Current Scope)

Review-to-AI pipeline visibility — correlate review text phrases with AI query mentions. Requires 30-60 days of monitoring data. Estimated 8-12 hours. Defer to Q3/Q4.

---

## 1\. Firestore Schema

All AIsynch data lives in Firestore (`pathsynch-pitch-creation` project). MongoDB remains the source of truth for merchant identity and billing records; Firestore stores the AI visibility intelligence layer.

### 1.1 Collection: `aiReadinessScores`

One document per merchant. Updated on each scoring run (monthly for Lite, weekly for Starter, daily for Growth/Scale).

```
aiReadinessScores/{merchantId}
{
  merchantId: string,              // MongoDB merchant _id
  merchantName: string,            // Denormalized for display
  city: string,
  state: string,
  gbpCategory: string,             // Primary GBP category
  placeId: string,                 // Google Places ID

  // Overall score
  totalScore: number,              // 0-100
  previousScore: number | null,    // Last period's score for delta display
  scoreChange: number,             // +/- change from previous
  scoredAt: timestamp,
  schemaVersion: '1.0',            // Enables schema evolution without breaking API consumers
  sourceRunId: string | null,      // Links score back to the monitoring run that produced it (aiVisibilitySnapshots doc ID)

  // Confidence and data completeness
  confidenceLevel: 'high' | 'medium' | 'low',
  confidenceLabel: string,         // "Verified" | "Estimated from public data" | "Limited data"
  dataCompleteness: {
    totalSubItems: number,         // Total sub-items across all pillars (e.g., 23)
    realDataItems: number,         // Sub-items scored with actual data
    defaultedItems: number,        // Sub-items that used fallback defaults
    completenessPercent: number,   // realDataItems / totalSubItems * 100
    missingDataSources: [string]   // ["gbpAudit", "reviewRecency", "widgetSignals"]
  },

  // Six pillars (each has score, max, confidence, and breakdown)
  pillars: {
    reviewAuthority: {
      score: number,               // 0-25
      max: 25,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        reviewCountVsMarket: { score: number, max: 10, detail: string, dataSource: 'real' | 'default' },
        averageRating: { score: number, max: 8, detail: string, dataSource: 'real' | 'default' },
        reviewRecency: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        responseRate: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' }
      }
    },
    gbpCompleteness: {
      score: number,               // 0-20
      max: 20,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        categoryAccuracy: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        businessDescription: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        contactInfo: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        photos: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        qAndA: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' },
        recentPosts: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' },
        servicesMenu: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' }
      }
    },
    webPresence: {
      score: number,               // 0-20
      max: 20,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        hasWebsite: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        mobileOptimized: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        pageLoadPerformance: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        schemaMarkup: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        aiCrawlReadiness: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        contentDepth: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' }
      }
    },
    citationPresence: {
      score: number,               // 0-15
      max: 15,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        majorDirectories: { score: number, max: 5, detail: string, dataSource: 'real' | 'default' },
        napConsistency: { score: number, max: 4, detail: string, dataSource: 'real' | 'default' },
        localAuthoritySites: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        backlinkStrength: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' }
      }
    },
    aiVisibility: {
      score: number,               // 0-10
      max: 10,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        mentionRate: { score: number, max: 5, detail: string, dataSource: 'real' | 'default' },
        sentiment: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        positionInResponse: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' }
      }
    },
    competitivePosition: {
      score: number,               // 0-10
      max: 10,
      confidence: 'high' | 'medium' | 'low',
      breakdown: {
        ratingVsMarket: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        reviewCountPercentile: { score: number, max: 3, detail: string, dataSource: 'real' | 'default' },
        digitalPresenceVsMedian: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' },
        uniqueDifferentiator: { score: number, max: 2, detail: string, dataSource: 'real' | 'default' }
      }
    }
  },

  // Prioritized action items (top 3 for lead_magnet, top 5 for merchant)
  actions: [
    {
      pillar: string,              // Which pillar this fixes
      category: string,            // 'review_growth' | 'gbp_optimization' | 'website_structure' | 'citation_gap' | 'content_gap' | 'ai_crawl_readiness' | 'competitor_gap'
      title: string,               // "Add a business description to your GBP"
      whyItMatters: string,        // "AI models use your GBP description to decide whether to recommend you. Without one, models skip you for competitors who describe their services clearly."
      impact: 'high' | 'medium' | 'low',
      difficulty: 'easy' | 'medium' | 'hard',
      pointsAvailable: number,     // How many points this would add
      linkedProduct: string | null, // "LocalSynch", "PathConnect", "AIsynch", etc.
      ctaTarget: string | null,    // Deep-link route: "/localsynch/gbp-audit" or "/pathconnect/review-requests"
      status: 'open' | 'completed' | 'dismissed'
    }
  ],

  // Source data references (for audit/debugging)
  dataSources: {
    placesApiUsed: boolean,
    gbpAuditUsed: boolean,
    pageSpeedUsed: boolean,
    serperUsed: boolean,
    aiVisibilityUsed: boolean,
    widgetSignalsUsed: boolean
  },

  // Metadata
  aisynchTier: 'lite' | 'starter' | 'growth' | 'scale' | 'lead_magnet',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.2 Collection: `aiVisibilitySnapshots`

Time-series data for the trend graph. One document per merchant per monitoring run.

**PII and storage policy:**

- Store only response snippets (first 300 characters) by default.  
- Run PII scrubbing (email regex, phone regex, SSN pattern) on all snippet text before storage.  
- Full raw responses stored ONLY when `AISYNCH_DEBUG_RAW_RESPONSES=true` env flag is set.  
- Snippets trimmed to empty after 90 days by the cleanup cron. Aggregated data kept indefinitely.

```
aiVisibilitySnapshots/{auto-id}
{
  merchantId: string,
  snapshotDate: timestamp,         // Date of this monitoring run
  snapshotType: 'daily' | 'weekly' | 'monthly',

  // Per-model results (never merged — enables multi-model split view)
  models: {
    gemini: {
      mentioned: boolean,
      mentionRate: number,         // 0-100 percentage across prompts
      position: number | null,     // Average position in response (1 = first mentioned)
      sentiment: 'positive' | 'neutral' | 'negative' | null,
      promptsChecked: number,
      promptsMentioned: number,
      citedUrls: [string],         // URLs cited in the response
      responseSnippets: [          // PII-scrubbed, 300-char max per snippet
        {
          prompt: string,
          mentioned: boolean,
          position: number | null,
          sentiment: string | null,
          citedUrls: [string],
          snippet: string          // First 300 chars, PII-scrubbed
        }
      ]
    },
    perplexity: {
      // Same structure as gemini
    },
    claude: {
      // Same structure — populated only for Growth/Scale tiers
    }
  },

  // Aggregated (computed from models above)
  aggregated: {
    overallMentionRate: number,    // Average across all models
    modelsChecked: number,
    modelsMentioned: number,
    totalPrompts: number,
    totalMentions: number
  },

  // Competitor visibility (same prompts, checked for competitors)
  competitors: [
    {
      name: string,
      placeId: string,
      mentionRate: number,
      modelBreakdown: {
        gemini: number,
        perplexity: number,
        claude: number | null
      }
    }
  ],

  // Citation sources from this run (Growth/Scale tiers only)
  citations: {
    domains: [
      {
        domain: string,
        type: 'institutional' | 'corporate' | 'editorial' | 'ugc' | 'reference' | 'other',
        count: number,
        merchantMentioned: boolean,
        competitorsMentioned: [string]
      }
    ],
    urls: [
      {
        url: string,
        pageTitle: string | null,
        urlType: 'homepage' | 'article' | 'listicle' | 'comparison' | 'profile' | 'directory' | 'other',
        domainType: string,
        merchantMentioned: boolean,
        mentionedInText: boolean,      // true = explicitly named in AI response text; false = retrieved as grounding source only
        count: number
      }
    ],
    gapAnalysis: [
      {
        domain: string,
        domainType: string,
        competitorsMentioned: [string],
        merchantMentioned: false,
        gapScore: number           // Higher = more urgent to get listed
      }
    ]
  },

  // Source events — collected from Phase 1B onward, even before source UI ships in Phase 2.
  // Accumulating source history from day one is critical — if you wait until Phase 2
  // to collect this data, you lose weeks of historical context you can never recover.
  // These events are stored inside the snapshot (not a separate collection) to avoid
  // double-writes and to keep source data co-located with the monitoring run that produced it.
  sourceEvents: [
    {
      promptId: string,            // Which prompt generated this source
      promptText: string,          // Denormalized for debugging
      model: string,               // 'gemini' | 'perplexity' | 'claude'
      url: string,
      domain: string,
      domainType: string,          // 'institutional' | 'corporate' | 'editorial' | 'ugc' | 'reference' | 'other'
      urlType: string,             // 'homepage' | 'article' | 'profile' | 'directory' | 'comparison' | 'other'
      wasRetrieved: boolean,       // Source was used to inform the AI response (grounding chunk)
      wasExplicitlyCited: boolean, // Source URL/domain was named in the response text (mentionedInText)
      merchantMentioned: boolean,  // Merchant name found on this source page/listing
      competitorsMentioned: [string], // Competitor names found on this source
      createdAt: timestamp
    }
  ],

  // Metadata
  aisynchTier: string,
  schemaVersion: '1.0',            // Enables schema evolution without breaking consumers
  runDurationMs: number,
  errorCount: number,              // Errors encountered during this run (non-fatal)
  fallbackUsed: boolean,           // Whether any model query fell back to a secondary model
  apiCosts: {
    gemini: number,
    perplexity: number,
    claude: number
  },
  debugMode: boolean,              // Whether full raw responses were stored
  createdAt: timestamp
}
```

### 1.3 Collection: `aiVisibilityPrompts`

Auto-generated prompt library per merchant. Created during onboarding, updated when GBP category or location changes.

```
aiVisibilityPrompts/{merchantId}
{
  merchantId: string,
  city: string,
  state: string,
  gbpCategory: string,
  gbpSubCategories: [string],

  // Merchant name aliases for mention detection accuracy
  // AI models may reference a business by abbreviated name, owner name,
  // neighborhood colloquial name, or GBP display name variant.
  // Generated during onboarding from GBP data; editable by merchant.
  merchantNameAliases: [
    {
      alias: string,               // "Dr. Smith's office", "Brilliant Smiles Dental"
      source: 'auto_gbp' | 'auto_reviews' | 'custom',
      active: boolean
    }
  ],

  prompts: [
    {
      id: string,                  // "prompt_001"
      text: string,                // "best fabric store in Charlotte NC"
      type: 'category' | 'service' | 'comparison' | 'recommendation',
      intentBucket: string,        // See eight-bucket taxonomy below
      source: 'auto_generated' | 'custom',
      active: boolean,
      createdAt: timestamp,

      // Tracking fields — populated automatically by the monitoring cron
      lastRunAt: timestamp | null,         // When this prompt was last queried
      lastMentionedAt: timestamp | null,   // When the merchant was last mentioned for this prompt
      historicalMentionRate: number | null  // Running mention rate across all runs (0-100)
    }
  ],

  // Auto-generation metadata
  lastAutoGenerated: timestamp,
  autoGenVersion: string,          // "1.0"
  customPromptsCount: number,      // Growth/Scale can add custom prompts

  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Merchant name alias generation:**

During AIsynch onboarding, auto-generate aliases from available data:

| Source | Example alias | How |
| :---- | :---- | :---- |
| GBP display name | "Brilliant Smiles" | Direct from Places API |
| GBP display name without suffix | "Brilliant Smiles" (from "Brilliant Smiles LLC") | Strip LLC/Inc/Ltd/Corp |
| GBP display name without punctuation | "Robyn's Fabrics" → "Robyns Fabrics" | Remove apostrophes, hyphens |
| Owner name (if available from GBP) | "Dr. Sarah Smith" | From Places details |
| Common abbreviation | "BS Dental" | First letters of multi-word name |

The monitoring cron passes `merchantNameAliases` to the mention detection function alongside the primary merchant name. The existing `checkAiMention()` in `visibilityMatcher.js` already does token overlap matching — aliases just add more strings to check against the response text. Growth/Scale merchants can add custom aliases ("the dentist on Main Street," "that place next to Kroger") if they know how locals refer to their business.

**Eight-bucket prompt taxonomy for local SMBs:**

Each merchant receives prompts across eight intent buckets. This is AIsynch's local-market edge over generic AI visibility trackers like Peec — we generate prompts that match how real consumers ask AI about local businesses, not how marketers track brand keywords.

| \# | Bucket | Intent | Example (dental, Atlanta) |
| :---- | :---- | :---- | :---- |
| 1 | best-in-city | Discovery, top picks | "best dentist in Atlanta" |
| 2 | near-me | Location proximity | "dentist near Buckhead" |
| 3 | service-intent | Specific service need | "emergency dentist open Saturday Atlanta" |
| 4 | comparison | Head-to-head vs competitor | "Brilliant Smiles vs \[competitor\]" |
| 5 | trust-intent | Review/reputation driven | "top rated dentist with great reviews in Atlanta" |
| 6 | price-value | Cost-sensitive search | "affordable dentist in Atlanta" |
| 7 | situation-problem | Pain/need driven | "where should I go for tooth pain in Atlanta" |
| 8 | competitor-comparison | Named competitor vs category | "best Invisalign provider in Atlanta" |

The prompt generator assigns an `intentBucket` label to each generated prompt. The four-type classification (`type: category | service | comparison | recommendation`) is the output label used for grouping and filtering. The eight buckets are the generation inputs that ensure coverage across all local search intent patterns. A merchant who's invisible on price-value queries but visible on best-in-city queries has a specific, actionable content gap.

**Auto-generation logic:**

Given a GBP category of "fabric\_store" and city "Charlotte, NC", Gemini flash generates 10-15 prompts:

```
Category prompts:
- "best fabric store in Charlotte NC"
- "fabric stores near Charlotte"
- "where to buy fabric in Charlotte NC"

Service prompts (from GBP services/description):
- "custom curtains Charlotte NC"
- "upholstery fabric Charlotte"
- "window treatments Charlotte NC"

Comparison prompts:
- "fabric store vs Joann Fabrics Charlotte"
- "best place for home decor fabric Charlotte"

Recommendation prompts:
- "recommend a fabric store in Charlotte"
- "where should I go for custom upholstery in Charlotte"
```

Growth/Scale merchants can add custom prompts on top.

### 1.4 Collection: `aisynchSubscriptions`

Tracks which merchants have AIsynch and at which tier. The monitoring cron checks this before running.

```
aisynchSubscriptions/{merchantId}
{
  merchantId: string,
  tier: 'lite' | 'starter' | 'growth' | 'scale',
  status: 'active' | 'cancelled' | 'past_due' | 'trialing',

  // Stripe references (for paid tiers only)
  stripeSubscriptionItemId: string | null,
  stripePriceId: string | null,
  monthlyAmount: number,           // 0 for lite, 49/99/199 for paid

  // Entitlements derived from tier
  entitlements: {
    monitoringFrequency: 'monthly' | 'weekly' | 'daily',
    aiModels: ['gemini', 'perplexity'] | ['gemini', 'perplexity', 'claude'],
    maxCompetitors: 3 | 5 | 10,
    citationDepth: boolean,
    gapAnalysis: boolean,
    multiModelSplit: boolean,
    heatmapReports: boolean,
    ga4Integration: boolean,
    apiAccess: boolean,
    whiteLabel: boolean,
    lookerConnector: boolean,
    customPrompts: boolean,
    maxCustomPrompts: 0 | 0 | 10 | 25,
    llmsTxtGeneration: boolean,
    reviewRequestTrigger: boolean
  },

  // Billing context
  parentProduct: string | null,    // "pathconnect", "localsynch", "synchintro", "standalone"
  parentSubscriptionId: string | null,
  bundledFree: boolean,            // true for lite (Local Growth+) and starter (Local Authority)

  // Lifecycle
  activatedAt: timestamp,
  cancelledAt: timestamp | null,
  currentPeriodEnd: timestamp | null,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.5 Collection: `widgetPageSignals`

Data collected from the review widget extension on merchant websites. This is "AI crawl readiness" data — page metadata and configuration checks — NOT actual crawler traffic analytics.

```
widgetPageSignals/{merchantId}
{
  merchantId: string,
  lastCollectedAt: timestamp,

  pages: [
    {
      url: string,
      canonicalUrl: string | null,
      pageTitle: string,
      metaDescription: string | null,
      hasViewportMeta: boolean,
      hasLocalBusinessSchema: boolean,
      hasLlmsTxt: boolean,
      robotsTxt: {
        allowsGPTBot: boolean | null,
        allowsClaudeBot: boolean | null,
        allowsPerplexityBot: boolean | null,
        fetchedAt: timestamp | null
      },
      contentSignals: {
        hasAboutPage: boolean,
        hasServicesPage: boolean,
        hasBlogOrContent: boolean,
        estimatedPageCount: number
      },
      collectedAt: timestamp
    }
  ],

  // Aggregated for AI Readiness Pillar 3
  webPresenceSummary: {
    totalPagesScanned: number,
    hasMobileOptimization: boolean,
    hasSchemaMarkup: boolean,
    hasLlmsTxt: boolean,
    blocksAiCrawlers: boolean,
    estimatedContentDepth: 'thin' | 'moderate' | 'deep'
  },

  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.6 Collection: `llmsTxtFiles`

Generated llms.txt file content per merchant. This is an execution deliverable, not a core scoring input.

```
llmsTxtFiles/{merchantId}
{
  merchantId: string,
  merchantName: string,
  websiteUrl: string,

  fileContent: string,
  generatedAt: timestamp,
  generatedBy: 'auto' | 'manual',
  geminiModel: string,

  sourceData: {
    gbpCategory: string,
    gbpDescription: string,
    services: [string],
    city: string,
    state: string,
    keyPages: [{ url: string, description: string }]
  },

  deployed: boolean,
  deployedAt: timestamp | null,
  deploymentMethod: 'manual' | 'widget_auto' | 'wordpress_plugin' | null,

  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.7 Collection: `aiReadinessScans`

Lead magnet scan results. Stored for lead follow-up and re-engagement.

```
aiReadinessScans/{auto-id}
{
  businessName: string,
  city: string,
  state: string,
  email: string | null,
  placeId: string,
  placeData: {
    name: string,
    rating: number,
    reviewCount: number,
    address: string,
    website: string | null,
    types: [string]
  },
  score: number,
  confidenceLevel: string,
  confidenceLabel: string,
  pillars: { ... },                // Same structure as aiReadinessScores.pillars
  actions: [ ... ],
  ip: string,                     // For rate limiting (hashed after 30 days)
  turnstileVerified: boolean,
  userAgent: string,
  source: 'pathsynch_website' | 'api' | 'partner',
  createdAt: timestamp
}
```

### 1.8 Collection: `agencyBrandOverrides`

Brand configuration for agencies using white-label reports. One document per agency merchant. Similar to the `brandOverride` pattern already specced for `templateOnePager.js` in the King Digital white-label work.

```
agencyBrandOverrides/{agencyMerchantId}
{
  agencyMerchantId: string,        // The agency's own merchant ID (e.g., Brian Hampton)
  agencyName: string,              // "King Digital Services"
  domain: string | null,           // "kingseoservice.com"

  // Branding applied to all white-label outputs
  branding: {
    logoUrl: string,               // URL to agency logo (hosted on GCS or S3)
    logoWidth: number | null,      // Optional width constraint in px
    companyName: string,           // Displayed on reports
    accentColor: string,           // Hex color, e.g., "#1E40AF"
    secondaryColor: string | null, // Optional secondary
    footerText: string,            // "Prepared by King Digital Services"
    contactEmail: string | null,   // Agency contact shown on reports
    contactPhone: string | null,
    websiteUrl: string | null      // "https://kingseoservice.com"
  },

  // Client roster (which merchants are this agency's clients)
  clients: [
    {
      merchantId: string,          // Brilliant Smiles' merchant ID
      merchantName: string,        // Denormalized
      addedAt: timestamp,
      reportFrequency: 'weekly' | 'monthly' | 'quarterly' | 'on_demand',
      autoSendToClient: boolean,   // If true, scheduled reports email directly to client
      clientContactEmails: [string]
    }
  ],

  // Limits based on AIsynch tier
  maxClients: number,              // Scale = 10, Growth = 5, Starter = 1 (self only)
  currentClientCount: number,

  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.9 Collection: `scheduledReports`

Automated report generation configurations. One document per agency-client reporting relationship.

```
scheduledReports/{auto-id}
{
  agencyMerchantId: string,        // Brian's merchant ID
  clientMerchantId: string,        // Brilliant Smiles' merchant ID
  clientName: string,              // Denormalized for display

  // Schedule
  frequency: 'weekly' | 'monthly' | 'quarterly',
  dayOfMonth: number | null,       // 1-28 for monthly/quarterly, null for weekly
  dayOfWeek: number | null,        // 0-6 (Sun-Sat) for weekly, null for monthly
  quarterMonths: [number] | null,  // [1,4,7,10] for quarterly (Jan/Apr/Jul/Oct)
  timezone: string,                // "America/New_York"

  // Report configuration
  reportType: 'ai_visibility' | 'full_readiness' | 'competitor_analysis',
  dateRangeType: 'last_30_days' | 'last_7_days' | 'last_quarter' | 'custom',
  includeSections: {
    aiReadinessScore: boolean,     // Score + pillar breakdown
    trendGraph: boolean,           // Visibility over time
    competitorComparison: boolean, // Heatmap + comparison table
    citationSources: boolean,     // Domain types + gap analysis
    actionItems: boolean,          // Prioritized recommendations
    executiveSummary: boolean      // Gemini-generated narrative
  },

  // Branding (pulled from agencyBrandOverrides, can be overridden per report)
  useBrandOverride: boolean,       // If true, apply agency branding
  brandOverrideId: string | null,  // Reference to agencyBrandOverrides doc

  // Delivery
  deliveryMethod: 'email' | 'hosted_link' | 'both',
  recipientEmails: [string],       // Client email(s) — only used if autoSendToClient is true
  ccEmails: [string],              // Agency email(s) — always receives a copy
  emailSubjectTemplate: string,    // "Your Monthly AI Visibility Report — {{monthName}} {{year}}"
  emailBodyTemplate: string | null,// Custom email body (Gemini-generated default if null)

  // Output format
  outputFormat: 'pdf' | 'html' | 'both',
  lastGeneratedReport: {
    reportId: string | null,
    generatedAt: timestamp | null,
    downloadUrl: string | null,    // GCS signed URL (expires in 30 days)
    hostedUrl: string | null,      // Permanent hosted link
    pageCount: number | null
  },

  // Lifecycle
  nextGeneration: timestamp,       // When the next report should be generated
  lastGenerated: timestamp | null,
  totalReportsGenerated: number,
  status: 'active' | 'paused' | 'cancelled',

  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 1.10 Collection: `generatedReports`

Stores generated report metadata and download links. One document per generated report instance.

```
generatedReports/{auto-id}
{
  scheduledReportId: string | null, // Null if generated on-demand
  agencyMerchantId: string,
  clientMerchantId: string,
  clientName: string,

  // Report content references
  reportType: string,
  dateRange: {
    start: timestamp,
    end: timestamp
  },
  sectionsIncluded: [string],

  // Generated output
  pdfUrl: string | null,           // GCS signed URL
  pdfStoragePath: string | null,   // GCS path for cleanup
  hostedUrl: string | null,        // Permanent hosted page URL
  pageCount: number | null,

  // Branding used
  brandOverride: {
    companyName: string,
    logoUrl: string,
    accentColor: string,
    footerText: string
  } | null,

  // Data snapshot (key metrics at generation time, for historical record)
  dataSnapshot: {
    aiReadinessScore: number,
    previousScore: number | null,
    mentionRate: number,
    competitorCount: number,
    topCompetitorScore: number | null,
    citationGapsFound: number
  },

  // Delivery status
  deliveryStatus: 'generated' | 'sent' | 'failed',
  sentTo: [string],                // Email addresses that received it
  sentAt: timestamp | null,
  deliveryError: string | null,

  // Metadata
  generatedBy: 'scheduled_cron' | 'manual' | 'api',
  generationDurationMs: number,
  createdAt: timestamp
}
```

---

## 2\. AI Readiness Scoring Engine

### 2.1 Architecture

The scoring engine is a single module that can be invoked in three modes:

```
functions/services/aiReadinessScorer.js
```

| Mode | Trigger | Data Sources | Confidence |
| :---- | :---- | :---- | :---- |
| `lead_magnet` | Public API (no auth) | Places API \+ Serper \+ PageSpeed | Low — "Estimated from public data" |
| `merchant_lite` | Cron (monthly) | Above \+ GBP audit \+ review data | Medium — "Estimated, connect GBP for full score" |
| `merchant_full` | Cron (weekly/daily) | All sources \+ widget \+ AI visibility \+ competitors | High — "Verified" |

### 2.2 Confidence Calculation

```javascript
function calculateConfidence(pillars) {
  let totalSubItems = 0;
  let realDataItems = 0;
  let defaultedItems = 0;
  const missingDataSources = [];

  for (const [pillarName, pillarData] of Object.entries(pillars)) {
    for (const [subName, subData] of Object.entries(pillarData.breakdown)) {
      totalSubItems++;
      if (subData.dataSource === 'real') {
        realDataItems++;
      } else {
        defaultedItems++;
      }
    }
  }

  const completenessPercent = Math.round((realDataItems / totalSubItems) * 100);

  // Determine overall confidence from pillar-level confidences
  const pillarConfidences = Object.values(pillars).map(p => p.confidence);
  let overallConfidence;
  let confidenceLabel;

  if (pillarConfidences.every(c => c === 'high')) {
    overallConfidence = 'high';
    confidenceLabel = 'Verified';
  } else if (pillarConfidences.filter(c => c === 'low').length >= 3) {
    overallConfidence = 'low';
    confidenceLabel = 'Estimated from public data';
  } else {
    overallConfidence = 'medium';
    confidenceLabel = 'Partially verified — connect more data sources for full accuracy';
  }

  return {
    confidenceLevel: overallConfidence,
    confidenceLabel,
    dataCompleteness: {
      totalSubItems,
      realDataItems,
      defaultedItems,
      completenessPercent,
      missingDataSources
    }
  };
}

// Each pillar calculates its own confidence:
function calculatePillarConfidence(breakdown) {
  const items = Object.values(breakdown);
  const realCount = items.filter(i => i.dataSource === 'real').length;
  const ratio = realCount / items.length;

  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}
```

### 2.3 Scoring Function

```javascript
// functions/services/aiReadinessScorer.js

async function scoreAiReadiness(merchantData, mode, options = {}) {
  const {
    placeData,
    gbpAuditData,        // null for lead_magnet
    reviewData,          // null for lead_magnet
    pageSpeedData,
    serperResults,
    widgetSignals,       // null for lead_magnet and lite
    aiVisibilityData,    // null for lead_magnet
    competitorData,      // null for lead_magnet
    marketBenchmarks     // null for lead_magnet — uses defaults
  } = merchantData;

  const benchmarks = marketBenchmarks || {
    avgRating: 4.3,
    avgReviewCount: 150,
    avgSeoScore: 55
  };

  // --- Score all six pillars ---
  const reviewAuthority = scoreReviewAuthority(placeData, reviewData, benchmarks);
  const gbpCompleteness = scoreGbpCompleteness(placeData, gbpAuditData);
  const webPresence = scoreWebPresence(placeData, pageSpeedData, widgetSignals);
  const citationPresence = scoreCitationPresence(serperResults, placeData);
  const aiVisibility = scoreAiVisibility(aiVisibilityData);
  const competitivePosition = scoreCompetitivePosition(placeData, competitorData, benchmarks);

  const pillars = {
    reviewAuthority, gbpCompleteness, webPresence,
    citationPresence, aiVisibility, competitivePosition
  };

  const totalScore = Object.values(pillars).reduce((sum, p) => sum + p.score, 0);

  // Calculate confidence
  const confidence = calculateConfidence(pillars);

  // Generate prioritized actions
  const maxActions = mode === 'lead_magnet' ? 3 : 5;
  const actions = generateActions(pillars, maxActions);

  return {
    totalScore,
    ...confidence,
    pillars,
    actions,
    scoredAt: new Date().toISOString(),
    scoreVersion: '1.0',
    mode
  };
}
```

### 2.4 Pillar 3 — aiCrawlReadiness Scoring (llms.txt weight correction)

llms.txt contributes a maximum of 1 point (out of 3\) to `aiCrawlReadiness`. It is a nice execution deliverable but not a proven AI ranking signal yet. GBP quality, review authority, schema markup, and structured content have stronger evidence.

```javascript
function scoreAiCrawlReadiness(widgetSignals) {
  // If no widget signals available, use defaults
  if (!widgetSignals) {
    return { score: 1, max: 3, detail: 'AI crawl readiness data unavailable', dataSource: 'default' };
  }

  let score = 0;
  const summary = widgetSignals.webPresenceSummary;

  // Does robots.txt allow AI crawlers? (0-2 points)
  if (summary && !summary.blocksAiCrawlers) {
    score += 2;
  } else if (summary && summary.blocksAiCrawlers) {
    score += 0; // Actively blocking AI crawlers
  } else {
    score += 1; // Unknown — assume partial access
  }

  // Does the site have an llms.txt file? (0-1 point)
  if (summary?.hasLlmsTxt) {
    score += 1;
  }

  return {
    score: Math.min(score, 3),
    max: 3,
    detail: summary?.blocksAiCrawlers
      ? 'AI crawlers are blocked by robots.txt'
      : summary?.hasLlmsTxt
        ? 'AI crawlers can access your site and llms.txt is present'
        : 'AI crawlers can access your site',
    dataSource: 'real'
  };
}
```

### 2.5 Action Generation with Product Mapping

```javascript
const PRODUCT_MAP = {
  reviewAuthority: {
    reviewCountVsMarket: 'PathConnect',
    averageRating: 'PathConnect',
    reviewRecency: 'PathConnect',
    responseRate: 'PathManager'
  },
  gbpCompleteness: {
    categoryAccuracy: 'LocalSynch',
    businessDescription: 'LocalSynch',
    contactInfo: 'LocalSynch',
    photos: 'LocalSynch',
    qAndA: 'LocalSynch',
    recentPosts: 'LocalSynch',
    servicesMenu: 'LocalSynch'
  },
  webPresence: {
    hasWebsite: null,
    mobileOptimized: null,
    pageLoadPerformance: null,
    schemaMarkup: 'AIsynch',
    aiCrawlReadiness: 'AIsynch',
    contentDepth: null
  },
  citationPresence: {
    majorDirectories: 'LocalSynch',
    napConsistency: 'LocalSynch',
    localAuthoritySites: null,
    backlinkStrength: null
  },
  aiVisibility: {
    mentionRate: 'AIsynch',
    sentiment: 'AIsynch',
    positionInResponse: 'AIsynch'
  },
  competitivePosition: {
    ratingVsMarket: 'PathConnect',
    reviewCountPercentile: 'PathConnect',
    digitalPresenceVsMedian: 'LocalSynch',
    uniqueDifferentiator: null
  }
};

function generateActions(pillars, maxActions) {
  const allActions = [];

  for (const [pillarName, pillarData] of Object.entries(pillars)) {
    for (const [subName, subData] of Object.entries(pillarData.breakdown)) {
      const gap = subData.max - subData.score;
      if (gap > 0) {
        allActions.push({
          pillar: pillarName,
          title: ACTION_TITLES[pillarName]?.[subName] || `Improve ${subName}`,
          impact: gap >= 4 ? 'high' : gap >= 2 ? 'medium' : 'low',
          difficulty: ACTION_DIFFICULTY[pillarName]?.[subName] || 'medium',
          pointsAvailable: gap,
          linkedProduct: PRODUCT_MAP[pillarName]?.[subName] || null,
          status: 'open'
        });
      }
    }
  }

  allActions.sort((a, b) => {
    const impactOrder = { high: 0, medium: 1, low: 2 };
    if (impactOrder[a.impact] !== impactOrder[b.impact]) {
      return impactOrder[a.impact] - impactOrder[b.impact];
    }
    return b.pointsAvailable - a.pointsAvailable;
  });

  return allActions.slice(0, maxActions);
}
```

---

## 3\. Free Scan API Endpoint (Lead Magnet)

### 3.1 Abuse Protection

The public scan endpoint requires layered protection beyond IP rate limiting:

| Protection | Implementation | Cost |
| :---- | :---- | :---- |
| Cloudflare Turnstile | Invisible challenge on pathsynch.com form. Token verified server-side. | Free |
| CORS restriction | Only allow requests from `pathsynch.com`, `www.pathsynch.com`, `localhost` | Free |
| IP rate limiting | 10 scans per IP per hour (Firestore-based) | Free |
| Daily global cap | 500 scans per day total. Returns 503 with "High demand" message when exceeded. | Free |
| Request fingerprinting | Hash of IP \+ User-Agent \+ Accept-Language stored. Flag if same fingerprint exceeds 20 scans/day. | Free |

### 3.2 Cloud Function

```javascript
// functions/api/aiReadinessScan.js

const { onRequest } = require('firebase-functions/v2/https');

exports.aiReadinessScan = onRequest({
  cors: ['https://pathsynch.com', 'https://www.pathsynch.com', 'http://localhost:3000'],
  maxInstances: 10,
  timeoutSeconds: 30,
  region: 'us-central1'
}, async (req, res) => {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { businessName, city, state, email, turnstileToken } = req.body;

  if (!businessName || !city || !state) {
    return res.status(400).json({ error: 'businessName, city, and state are required' });
  }

  // --- Abuse protection checks ---

  // 1. Turnstile verification
  if (!turnstileToken) {
    return res.status(400).json({ error: 'Verification token required' });
  }
  const turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) {
    return res.status(403).json({ error: 'Verification failed. Please try again.' });
  }

  // 2. Daily global cap
  const dailyCount = await getDailyScanCount();
  if (dailyCount >= 500) {
    return res.status(503).json({ error: 'High demand — please try again tomorrow.' });
  }

  // 3. IP rate limit
  const rateLimitOk = await checkRateLimit(req.ip, 10, 3600);
  if (!rateLimitOk) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in 1 hour.' });
  }

  // 4. Fingerprint check
  const fingerprint = hashFingerprint(req.ip, req.headers['user-agent'], req.headers['accept-language']);
  const fingerprintOk = await checkFingerprint(fingerprint, 20);
  if (!fingerprintOk) {
    return res.status(429).json({ error: 'Too many requests from this device.' });
  }

  try {
    // Step 1: Google Places lookup
    const placeData = await findPlace(businessName, city, state);
    if (!placeData) {
      return res.status(404).json({ error: 'Business not found. Check the name and city.' });
    }

    // Step 2: Parallel data collection
    const [pageSpeedData, serperResults] = await Promise.allSettled([
      getPageSpeedScore(placeData.website),
      searchDirectoryPresence(businessName, city, state)
    ]);

    // Step 3: Run scoring engine in lead_magnet mode
    const score = await scoreAiReadiness({
      placeData,
      gbpAuditData: null,
      reviewData: null,
      pageSpeedData: pageSpeedData.status === 'fulfilled' ? pageSpeedData.value : null,
      serperResults: serperResults.status === 'fulfilled' ? serperResults.value : null,
      widgetSignals: null,
      aiVisibilityData: null,
      competitorData: null,
      marketBenchmarks: null
    }, 'lead_magnet');

    // Step 4: Store scan result
    const scanRef = await db.collection('aiReadinessScans').add({
      businessName,
      city,
      state,
      email: email || null,
      placeId: placeData.place_id,
      placeData: {
        name: placeData.name,
        rating: placeData.rating,
        reviewCount: placeData.user_ratings_total,
        address: placeData.formatted_address,
        website: placeData.website || null,
        types: placeData.types || []
      },
      score: score.totalScore,
      confidenceLevel: score.confidenceLevel,
      confidenceLabel: score.confidenceLabel,
      pillars: score.pillars,
      actions: score.actions,
      ip: req.ip,
      turnstileVerified: true,
      userAgent: req.headers['user-agent'],
      source: 'pathsynch_website',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Step 5: Increment daily counter
    await incrementDailyScanCount();

    // Step 6: If email provided, create outbound lead
    if (email) {
      await createOutboundLead({
        email,
        businessName,
        city,
        state,
        placeId: placeData.place_id,
        aiReadinessScore: score.totalScore,
        weakestPillar: findWeakestPillar(score.pillars),
        source: 'ai_readiness_scan'
      });
    }

    return res.json({
      scanId: scanRef.id,
      businessName: placeData.name,
      address: placeData.formatted_address,
      totalScore: score.totalScore,
      confidenceLevel: score.confidenceLevel,
      confidenceLabel: score.confidenceLabel,
      pillars: score.pillars,
      actions: score.actions,
      placeId: placeData.place_id
    });

  } catch (err) {
    console.error('[AIReadinessScan] Error:', err.message);
    return res.status(500).json({ error: 'Scan failed. Try again.' });
  }
});

// --- Abuse protection helpers ---

async function verifyTurnstile(token, ip) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: ip
    })
  });
  const data = await response.json();
  return data.success === true;
}

async function getDailyScanCount() {
  const today = new Date().toISOString().split('T')[0];
  const doc = await db.collection('aiReadinessRateLimits').doc(`daily_${today}`).get();
  return doc.exists ? (doc.data().count || 0) : 0;
}

async function incrementDailyScanCount() {
  const today = new Date().toISOString().split('T')[0];
  await db.collection('aiReadinessRateLimits').doc(`daily_${today}`).set(
    { count: admin.firestore.FieldValue.increment(1), date: today },
    { merge: true }
  );
}

function hashFingerprint(ip, userAgent, acceptLanguage) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update(`${ip}|${userAgent || ''}|${acceptLanguage || ''}`)
    .digest('hex')
    .substring(0, 16);
}
```

### 3.3 API Cost Per Scan

| API Call | Cost | Notes |
| :---- | :---- | :---- |
| Google Places textSearch | \~$0.032 | One query to find the business |
| Google Places Details | \~$0.017 | Website, hours, photos, types |
| PageSpeed Insights | $0.00 | Free API |
| Serper (directory search) | \~$0.004 | One search for directory presence |
| **Total per scan** | **\~$0.05** | At 500 scans/day cap \= \~$25/day max |

No Gemini cost in lead magnet mode — the AI Visibility pillar uses defaults (2 points) since no live AI query runs.

### 3.4 Load Testing & Failure Scenarios

**Baseline capacity:**

The free scan endpoint is a single Cloud Function with `maxInstances: 10`. Each scan takes 2-4 seconds (Places lookup \+ parallel PageSpeed \+ Serper). At 10 concurrent instances, maximum throughput is roughly 3-5 scans per second, or \~180-300 per minute. The daily cap of 500 scans is well within this capacity.

**Scenario 1: Normal growth (10-50 scans/day)**

No issues. Total daily cost: $0.50-$2.50. Rate limits never triggered. This is the expected steady state for the first 3-6 months.

**Scenario 2: Blog post or social mention (200-500 scans/day)**

The 500/day cap handles this gracefully. Users hitting the cap see "High demand — please try again tomorrow." This is actually a good problem — it means the lead magnet is working. If this becomes regular, raise the cap to 1,000 and monitor conversion rate.

**Scenario 3: Product Hunt or Hacker News spike (2,000-5,000 attempts/day)**

The 500/day cap means 1,500-4,500 users get the "high demand" message. This is acceptable for a free tool — scarcity can increase perceived value. The Turnstile \+ rate limiting prevents bot abuse during the spike. Google Places API quota (typically 2,500 free/day, then $7/1000 with billing enabled) could be the actual bottleneck if Places billing isn't configured. Verify Places billing is active before any marketing push.

**Action items before any marketing launch:**

- Confirm Google Places API billing is enabled (not just free tier)  
- Confirm Serper plan supports 500+ daily searches  
- Set up Cloud Monitoring alert for daily scan count approaching 400  
- Prepare a "waitlist" variant of the 503 response that captures email

**Scenario 4: Targeted abuse (bot farm, competitor scraping)**

Layered protection handles this:

- Turnstile blocks automated requests (bots fail the invisible challenge)  
- IP rate limit (10/hour) blocks single-IP scrapers  
- Fingerprint limit (20/day) blocks IP-rotating bots sharing user-agent/accept-language  
- Daily global cap (500) is the hard ceiling regardless

**Worst case cost if all protections fail:** 500 scans × $0.05 \= $25. The daily cap is the ultimate safety net. Even a sophisticated attack cannot cost more than $25/day.

**Scenario 5: Places API or PageSpeed API outage**

Both API calls are wrapped in `Promise.allSettled()` (not `Promise.all()`). If PageSpeed is down, the scan completes with null PageSpeed data — the scoring engine assigns default values for the web presence pillar with `dataSource: 'default'` and `confidence: 'low'`. If Places API is down, the scan returns a 500 error since the business can't be found. Cloud Functions retry semantics don't apply (this is an HTTP function, not a triggered function), so the user simply retries.

**Scenario 6: Firestore write failures**

Scan results are written to `aiReadinessScans` collection after the response is sent to the user. If Firestore is temporarily unavailable, the user still gets their score (it was computed in memory), but the scan isn't persisted for lead follow-up. Add a try/catch around the Firestore write with a log-and-continue pattern — never block the user response on a Firestore write.

**Monitoring dashboard (set up during Phase 1A deploy):**

| Metric | Alert Threshold | Action |
| :---- | :---- | :---- |
| Daily scan count | 400/day | Notification — approaching cap |
| Scan error rate | \>10% of scans | Page — API key or quota issue |
| Avg scan latency | \>8 seconds | Investigation — API slowdown |
| Turnstile rejection rate | \>30% of requests | Investigation — bot attack or Turnstile misconfiguration |
| Places API 429 errors | Any | Urgent — quota exceeded, enable billing or raise quota |

**Conversion economics sanity check:**

| Monthly scans | Monthly cost | Required conversion to break even at $49/mo Starter |
| :---- | :---- | :---- |
| 500 (17/day) | $25 | 1 conversion \= 196% ROI |
| 3,000 (100/day) | $150 | 4 conversions \= 31% ROI |
| 15,000 (500/day) | $750 | 16 conversions \= 4.7% ROI |

At 500/day cap for 30 days \= 15,000 scans/month \= $750/month in API costs. If you convert 1% of scans to Starter ($49/mo), that's 150 conversions × $49 \= $7,350/month revenue against $750 cost. Even at 0.1% conversion (15 conversions), you're at $735 revenue — roughly break-even. Below 0.1% conversion, the free scan is a marketing expense, not a profit center — which is fine as long as you're capturing emails for outbound follow-up.

**Recommendation:** Start with the 500/day cap. Track conversion rate for 30 days. If conversion rate is above 0.5%, raise cap to 1,000. If below 0.1%, reduce cap to 200 and focus on improving the scan-to-signup funnel before scaling traffic.

---

## 4\. Stripe Add-On Billing Integration

### 4.1 Stripe Product & Price Setup

```javascript
// One-time setup script: functions/scripts/setupAisynchStripeProducts.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function setup() {
  const product = await stripe.products.create({
    name: 'AIsynch — AI Visibility Intelligence',
    description: 'AI Readiness scoring, visibility monitoring, citation analysis',
    metadata: { pathsynch_product: 'aisynch' }
  });

  const starterMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 4900,  // $49.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'starter', product: 'aisynch' }
  });

  const growthMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 9900,  // $99.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'growth', product: 'aisynch' }
  });

  const scaleMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 19900,  // $199.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'scale', product: 'aisynch' }
  });

  console.log('AIsynch Stripe products created:', {
    productId: product.id,
    starterPriceId: starterMonthly.id,
    growthPriceId: growthMonthly.id,
    scalePriceId: scaleMonthly.id
  });
}

setup();
```

### 4.2 Add-On Subscription Model

AIsynch is a line item on the merchant's existing Stripe subscription, not a separate subscription. One invoice, one charge.

```javascript
async function addAisynchToSubscription(merchantId, aisynchTier) {
  const merchant = await Merchant.findById(merchantId);
  const subscriptionId = merchant.subscription?.stripeSubscriptionId;

  if (!subscriptionId) {
    // No existing subscription — create new checkout session
    const session = await stripe.checkout.sessions.create({
      customer: merchant.subscription.stripeCustomerId,
      mode: 'subscription',
      line_items: [{
        price: AISYNCH_PRICE_IDS[aisynchTier],
        quantity: 1
      }],
      metadata: {
        merchantId: merchant._id.toString(),
        product: 'aisynch',
        tier: aisynchTier
      },
      success_url: `${PATHMANAGER_URL}/settings?aisynch=activated`,
      cancel_url: `${PATHMANAGER_URL}/settings?aisynch=cancelled`
    });
    return { checkoutUrl: session.url };
  }

  // Existing subscription — add AIsynch as a line item
  const subscriptionItem = await stripe.subscriptionItems.create({
    subscription: subscriptionId,
    price: AISYNCH_PRICE_IDS[aisynchTier],
    quantity: 1,
    proration_behavior: 'create_prorations',
    metadata: { product: 'aisynch', tier: aisynchTier }
  });

  // Create Firestore entitlement record
  await db.collection('aisynchSubscriptions').doc(merchant._id.toString()).set({
    merchantId: merchant._id.toString(),
    tier: aisynchTier,
    status: 'active',
    stripeSubscriptionItemId: subscriptionItem.id,
    stripePriceId: AISYNCH_PRICE_IDS[aisynchTier],
    monthlyAmount: AISYNCH_AMOUNTS[aisynchTier],
    entitlements: AISYNCH_ENTITLEMENTS[aisynchTier],
    parentProduct: merchant.subscribedProducts?.[0] || 'standalone',
    parentSubscriptionId: subscriptionId,
    bundledFree: false,
    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Generate initial prompts
  await generateInitialPrompts(merchant._id.toString(), merchant);

  // Run first AI Readiness score
  await runAiReadinessScore(merchant._id.toString(), 'merchant_full');

  return { success: true, tier: aisynchTier };
}

const AISYNCH_PRICE_IDS = {
  starter: 'price_XXXXX',   // From Stripe setup script output
  growth: 'price_XXXXX',
  scale: 'price_XXXXX'
};

const AISYNCH_AMOUNTS = { starter: 4900, growth: 9900, scale: 19900 };

const AISYNCH_ENTITLEMENTS = {
  lite: {
    monitoringFrequency: 'monthly', aiModels: ['gemini', 'perplexity'],
    maxCompetitors: 0, citationDepth: false, gapAnalysis: false,
    multiModelSplit: false, heatmapReports: false, ga4Integration: false,
    apiAccess: false, whiteLabel: false, lookerConnector: false,
    customPrompts: false, maxCustomPrompts: 0, llmsTxtGeneration: false,
    reviewRequestTrigger: false
  },
  starter: {
    monitoringFrequency: 'weekly', aiModels: ['gemini', 'perplexity'],
    maxCompetitors: 3, citationDepth: false, gapAnalysis: false,
    multiModelSplit: false, heatmapReports: false, ga4Integration: false,
    apiAccess: false, whiteLabel: false, lookerConnector: false,
    customPrompts: false, maxCustomPrompts: 0, llmsTxtGeneration: true,
    reviewRequestTrigger: false
  },
  growth: {
    monitoringFrequency: 'daily', aiModels: ['gemini', 'perplexity', 'claude'],
    maxCompetitors: 5, citationDepth: true, gapAnalysis: true,
    multiModelSplit: true, heatmapReports: true, ga4Integration: true,
    apiAccess: true, whiteLabel: false, lookerConnector: false,
    customPrompts: true, maxCustomPrompts: 10, llmsTxtGeneration: true,
    reviewRequestTrigger: true
  },
  scale: {
    monitoringFrequency: 'daily', aiModels: ['gemini', 'perplexity', 'claude'],
    maxCompetitors: 10, citationDepth: true, gapAnalysis: true,
    multiModelSplit: true, heatmapReports: true, ga4Integration: true,
    apiAccess: true, whiteLabel: true, lookerConnector: true,
    customPrompts: true, maxCustomPrompts: 25, llmsTxtGeneration: true,
    reviewRequestTrigger: true
  }
};
```

### 4.3 Webhook Handling

Extend the existing PathManager webhook handler to recognize AIsynch line items:

```javascript
function handleSubscriptionChange(subscription) {
  for (const item of subscription.items.data) {
    const product = item.price.metadata?.product;
    const tier = item.price.metadata?.tier;

    if (product === 'aisynch') {
      const merchantId = subscription.metadata?.merchantId;
      if (merchantId) {
        db.collection('aisynchSubscriptions').doc(merchantId).update({
          status: mapStripeStatus(subscription.status),
          tier: tier,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  }
}
```

### 4.4 Bundled Free Tiers

```javascript
async function activateBundledAisynch(merchantId, localSynchTier) {
  const bundledTier = {
    'local_growth': 'lite',
    'local_authority': 'starter'
  }[localSynchTier];

  if (!bundledTier) return; // Local Launch gets one-time score only

  await db.collection('aisynchSubscriptions').doc(merchantId).set({
    merchantId,
    tier: bundledTier,
    status: 'active',
    stripeSubscriptionItemId: null,
    stripePriceId: null,
    monthlyAmount: 0,
    entitlements: AISYNCH_ENTITLEMENTS[bundledTier],
    parentProduct: 'localsynch',
    parentSubscriptionId: null,
    bundledFree: true,
    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}
```

---

## 5\. Persistent Monitoring Cron

### 5.1 Architecture

The monitoring cron runs as a Firebase Scheduled Function. It enumerates active AIsynch subscribers, checks tier-based monitoring frequency, and runs the appropriate checks.

**Prompt generation — new, not reusing visibilityQueryBuilder.js:** The existing `buildVisibilityQueries()` in `visibilityQueryBuilder.js` generates only 3 queries for AI mode ("best X in city", "recommend X near city", "top rated X city"). This is sufficient for per-report enrichment (3 queries × $0.005 \= cheap). The monitoring cron needs 10-15 prompts per merchant for comprehensive tracking. These are generated once during AIsynch onboarding by Gemini flash (using GBP category \+ city \+ services as context), stored in the `aiVisibilityPrompts` Firestore collection, and read from there on each cron run. The cron does NOT call `buildVisibilityQueries()` — it reads prompts from Firestore. Custom prompts added by Growth/Scale merchants are also stored there.

**Model queries — parallel, not fallback:** The existing `enrichAiVisibility()` uses Perplexity as a fallback when Gemini fails. The monitoring cron queries all enabled models in parallel using the exported `queryGeminiGrounded()` and `queryPerplexity()` functions (see Phase 0, item 0A). Results are stored per-model in `aiVisibilitySnapshots.models` and never merged — this enables the multi-model split view and competitor heatmap. The monitoring cron passes `'gemini-3-flash-preview'` as the model override (see Phase 0, item 0D).

**Pub/Sub migration path:** The current design uses one scheduled function with batch-of-5 sequential processing. This handles approximately 25-30 merchants within the 9-minute timeout. When active merchants exceed 50, refactor to Pub/Sub fan-out: the cron becomes an enumerator that publishes one message per merchant to a topic, and `processOneMonitoringRun` becomes the subscriber handler. The function is already self-contained for this migration. See the GSC sync pipeline in `pathconnect-442522` for the established pattern (daily-sync-trigger → sync-work-topic → sync-work-subscription).

### 5.2 Scheduled Function

```javascript
// functions/scheduled/aiVisibilityMonitor.js

const { onSchedule } = require('firebase-functions/v2/scheduler');

/**
 * AIsynch Monitoring Cron
 *
 * Runs at 3 AM ET daily. Checks which merchants need monitoring
 * based on their tier's frequency (daily/weekly/monthly).
 *
 * SCALING NOTE: Current design handles ~25-30 merchants per run.
 * When active merchants > 50, migrate to Pub/Sub fan-out:
 *   1. This function becomes the enumerator (publishes messages)
 *   2. processOneMonitoringRun becomes the Pub/Sub subscriber
 *   3. No logic changes — just a different trigger mechanism
 * Pattern reference: pathconnect-442522 GSC sync pipeline
 */
exports.aiVisibilityMonitorCron = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'America/New_York',
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 1,
  region: 'us-central1'
}, async (event) => {

  if (process.env.ENABLE_AISYNCH_MONITORING !== 'true') {
    console.log('[AIVisMonitor] Monitoring disabled via feature flag');
    return;
  }

  // Cost control: check if today's estimated API spend exceeds the daily cap.
  // Prevents runaway costs from bugs, misconfiguration, or unexpected merchant volume.
  const dailyCostCap = parseFloat(process.env.AISYNCH_DAILY_COST_CAP || '25');
  const todayDateStr = new Date().toISOString().split('T')[0];
  const costDoc = await db.collection('aisynchRunLogs').doc(`cost_${todayDateStr}`).get();
  const todayCost = costDoc.exists ? (costDoc.data().totalEstimatedCost || 0) : 0;
  if (todayCost >= dailyCostCap) {
    console.warn(`[AIVisMonitor] Daily cost cap reached: $${todayCost.toFixed(2)} >= $${dailyCostCap}. Skipping.`);
    return;
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  const dayOfMonth = today.getDate();

  const frequenciesToRun = ['daily'];
  if (dayOfWeek === 0) frequenciesToRun.push('weekly');
  if (dayOfMonth === 1) frequenciesToRun.push('monthly');

  console.log(`[AIVisMonitor] Running for: ${frequenciesToRun.join(', ')}`);

  const subsSnapshot = await db.collection('aisynchSubscriptions')
    .where('status', '==', 'active')
    .get();

  const merchants = [];
  subsSnapshot.forEach(doc => {
    const sub = doc.data();
    const frequency = sub.entitlements?.monitoringFrequency;
    if (frequenciesToRun.includes(frequency)) {
      merchants.push(sub);
    }
  });

  console.log(`[AIVisMonitor] ${merchants.length} merchants to process`);

  // Process in batches of 5
  const BATCH_SIZE = 5;
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batch = merchants.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(merchant => processOneMonitoringRun(merchant))
    );

    results.forEach(r => {
      if (r.status === 'fulfilled') processed++;
      else failed++;
    });

    if (i + BATCH_SIZE < merchants.length) {
      await sleep(2000);
    }
  }

  console.log(`[AIVisMonitor] Complete. Processed: ${processed}, Failed: ${failed}`);
});

/**
 * Process one merchant's monitoring run.
 *
 * This function is fully self-contained — it takes a subscription
 * object and does everything. When migrating to Pub/Sub fan-out,
 * this becomes the subscriber handler with zero logic changes.
 */
async function processOneMonitoringRun(subscription) {
  const startTime = Date.now();
  const { merchantId, tier, entitlements } = subscription;

  try {
    // Load prompts
    const promptsDoc = await db.collection('aiVisibilityPrompts').doc(merchantId).get();
    if (!promptsDoc.exists) {
      console.warn(`[AIVisMonitor] No prompts for ${merchantId}, skipping`);
      return;
    }
    const prompts = promptsDoc.data().prompts.filter(p => p.active);

    // Query AI models
    const modelResults = {};
    const modelsToQuery = entitlements.aiModels || ['gemini', 'perplexity'];

    for (const model of modelsToQuery) {
      modelResults[model] = await queryAiModel(model, prompts, merchantId);
    }

    // Check competitor visibility
    let competitorResults = [];
    if (entitlements.maxCompetitors > 0) {
      competitorResults = await checkCompetitorVisibility(
        merchantId, prompts, modelsToQuery, entitlements.maxCompetitors
      );
    }

    // Parse citations (Growth/Scale only)
    let citations = null;
    if (entitlements.citationDepth) {
      citations = parseCitationSources(modelResults);
    }

    // Build snapshot
    const snapshot = {
      merchantId,
      snapshotDate: admin.firestore.FieldValue.serverTimestamp(),
      snapshotType: entitlements.monitoringFrequency,
      models: modelResults,
      aggregated: computeAggregated(modelResults),
      competitors: competitorResults,
      citations: citations,
      aisynchTier: tier,
      runDurationMs: Date.now() - startTime,
      apiCosts: computeApiCosts(modelsToQuery, prompts.length),
      debugMode: process.env.AISYNCH_DEBUG_RAW_RESPONSES === 'true',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('aiVisibilitySnapshots').add(snapshot);

    // Re-run AI Readiness score with new visibility data
    await updateAiReadinessScore(merchantId, snapshot);

    // Check mention rate trigger for review requests (Growth/Scale)
    if (entitlements.reviewRequestTrigger) {
      await checkMentionRateTrigger(merchantId, snapshot);
    }

    console.log(`[AIVisMonitor] ✓ ${merchantId} (${Date.now() - startTime}ms)`);

  } catch (err) {
    console.error(`[AIVisMonitor] ✗ ${merchantId}:`, err.message);
  }
}
```

### 5.3 PII Scrubbing for Response Snippets

```javascript
function scrubPii(text) {
  if (!text) return '';

  return text
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // Phone numbers (US formats)
    .replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]')
    // SSN patterns
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, '[SSN]')
    // Credit card patterns (basic)
    .replace(/\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g, '[CARD]');
}

function prepareSnippet(responseText, maxLength = 300) {
  if (!responseText) return '';
  const trimmed = responseText.substring(0, maxLength);
  return scrubPii(trimmed);
}
```

### 5.4 AI Model Query Function

```javascript
async function queryAiModel(model, prompts, merchantId) {
  const results = {
    mentioned: false,
    mentionRate: 0,
    position: null,
    sentiment: null,
    promptsChecked: prompts.length,
    promptsMentioned: 0,
    citedUrls: [],
    responseSnippets: []
  };

  const merchantName = await getMerchantName(merchantId);

  // Load aliases from aiVisibilityPrompts (includes auto-generated + custom)
  const promptsDoc = await db.collection('aiVisibilityPrompts').doc(merchantId).get();
  const storedAliases = (promptsDoc.exists && promptsDoc.data().merchantNameAliases || [])
    .filter(a => a.active)
    .map(a => a.alias.toLowerCase());

  // Combine primary name + variants + stored aliases for mention detection
  const merchantAliases = [
    merchantName.toLowerCase(),
    merchantName.toLowerCase().replace(/['']/g, ''),
    merchantName.toLowerCase().replace(/ (llc|inc|ltd|corp)\.?$/i, ''),
    ...storedAliases
  ].filter(Boolean);

  for (const prompt of prompts) {
    let response;

    if (model === 'gemini') {
      response = await queryGeminiGrounded(prompt.text, null, 'gemini-3-flash-preview');
    } else if (model === 'perplexity') {
      response = await queryPerplexity(prompt.text);
    } else if (model === 'claude') {
      response = await queryClaudeBedrock(prompt.text);
    }

    const responseText = (response.text || '').toLowerCase();
    const mentioned = merchantAliases.some(alias => responseText.includes(alias));

    // Track which citation URLs are explicitly named in the response text
    // vs only retrieved as grounding sources (Peec-inspired distinction)
    const citationsWithTextFlag = (response.citations || []).map(url => ({
      url,
      mentionedInText: responseText.includes(
        url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
      )
    }));

    if (mentioned) {
      results.promptsMentioned++;
      const position = detectPosition(responseText, merchantAliases);
      const sentiment = await detectSentiment(responseText, merchantName);

      results.responseSnippets.push({
        prompt: prompt.text,
        mentioned: true,
        position,
        sentiment,
        citedUrls: citationsWithTextFlag,
        snippet: prepareSnippet(response.text) // PII-scrubbed, 300 char max
      });

      results.citedUrls.push(...(response.citations || []));
    } else {
      results.responseSnippets.push({
        prompt: prompt.text,
        mentioned: false,
        position: null,
        sentiment: null,
        citedUrls: citationsWithTextFlag,
        snippet: prepareSnippet(response.text)
      });
    }
  }

  results.mentioned = results.promptsMentioned > 0;
  results.mentionRate = prompts.length > 0
    ? Math.round((results.promptsMentioned / prompts.length) * 100) : 0;

  const positions = results.responseSnippets
    .filter(r => r.position !== null).map(r => r.position);
  results.position = positions.length > 0
    ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
    : null;

  results.sentiment = majorityVote(
    results.responseSnippets.filter(r => r.sentiment).map(r => r.sentiment)
  );

  results.citedUrls = [...new Set(results.citedUrls)];

  return results;
}
```

### 5.5 Mention Rate Trigger for Review Requests

```javascript
async function checkMentionRateTrigger(merchantId, currentSnapshot) {
  const prevSnapshots = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(2)
    .get();

  if (prevSnapshots.size < 2) return;

  const docs = [];
  prevSnapshots.forEach(d => docs.push(d.data()));
  const previous = docs[1];

  const currentRate = currentSnapshot.aggregated.overallMentionRate;
  const previousRate = previous.aggregated?.overallMentionRate || 0;

  // Only trigger if mention rate increased by 10+ percentage points
  if (currentRate - previousRate < 10) return;

  // Throttle: max one trigger per merchant per week
  const lastTrigger = await db.collection('aiVisibilityTriggers')
    .where('merchantId', '==', merchantId)
    .where('type', '==', 'review_request')
    .orderBy('triggeredAt', 'desc')
    .limit(1)
    .get();

  if (!lastTrigger.empty) {
    const lastDate = lastTrigger.docs[0].data().triggeredAt?.toDate();
    const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return;
  }

  await db.collection('aiVisibilityTriggers').add({
    merchantId,
    type: 'review_request',
    mentionRateChange: currentRate - previousRate,
    currentRate,
    previousRate,
    message: 'Great news — your business was just recommended by AI! Help us stay visible by sharing your experience.',
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending'
  });

  console.log(`[AIVisMonitor] Review trigger fired: ${merchantId} ${previousRate}% → ${currentRate}%`);
}
```

### 5.6 API Cost Per Monitoring Run

| Component | Cost per merchant per run | Notes |
| :---- | :---- | :---- |
| Gemini Grounded (10 prompts) | \~$0.005 | Gemini flash |
| Perplexity (10 prompts) | \~$0.05 | Sonar model |
| Claude via Bedrock (10 prompts) | \~$0.03 | Growth/Scale only |
| Sentiment detection (Gemini) | \~$0.002 | One batch call |
| **Starter (weekly, 2 models)** | **\~$0.055/week \= \~$0.24/mo** |  |
| **Growth (daily, 3 models)** | **\~$0.087/day \= \~$2.61/mo** |  |
| **Scale (daily, 3 models \+ 10 comps)** | **\~$0.50/day \= \~$15/mo** |  |

Margins: Starter 99.5%, Growth 97.4%, Scale 92.5%.

---

## 6\. Data Retention & Cleanup

```javascript
// functions/scheduled/aisynchDataCleanup.js

exports.aisynchDataCleanup = onSchedule({
  schedule: '0 4 * * 0',  // Sundays at 4 AM ET
  timeZone: 'America/New_York',
  timeoutSeconds: 300,
  region: 'us-central1'
}, async () => {

  const now = new Date();

  // 1. Trim response snippets from snapshots older than 90 days
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const oldSnapshots = await db.collection('aiVisibilitySnapshots')
    .where('snapshotDate', '<', ninetyDaysAgo)
    .limit(500)
    .get();

  const batch = db.batch();
  let trimCount = 0;
  oldSnapshots.forEach(doc => {
    const data = doc.data();
    if (data.models?.gemini?.responseSnippets?.length > 0) {
      const trimmedModels = {};
      for (const [model, modelData] of Object.entries(data.models)) {
        trimmedModels[model] = { ...modelData, responseSnippets: [] };
      }
      batch.update(doc.ref, { models: trimmedModels });
      trimCount++;
    }
  });
  await batch.commit();
  console.log(`[AIsynchCleanup] Trimmed snippets from ${trimCount} snapshots`);

  // 2. Delete anonymous scans older than 180 days (no email = no lead value)
  const sixMonthsAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);
  const oldScans = await db.collection('aiReadinessScans')
    .where('createdAt', '<', sixMonthsAgo)
    .where('email', '==', null)
    .limit(500)
    .get();

  const scanBatch = db.batch();
  oldScans.forEach(doc => scanBatch.delete(doc.ref));
  await scanBatch.commit();
  console.log(`[AIsynchCleanup] Deleted ${oldScans.size} anonymous scans`);

  // 3. Hash IP addresses on scans older than 30 days (privacy)
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const recentScans = await db.collection('aiReadinessScans')
    .where('createdAt', '<', thirtyDaysAgo)
    .where('ip', '!=', null)
    .limit(500)
    .get();

  const ipBatch = db.batch();
  let ipCount = 0;
  recentScans.forEach(doc => {
    const data = doc.data();
    if (data.ip && !data.ip.startsWith('hashed_')) {
      const crypto = require('crypto');
      const hashed = 'hashed_' + crypto.createHash('sha256')
        .update(data.ip).digest('hex').substring(0, 8);
      ipBatch.update(doc.ref, { ip: hashed });
      ipCount++;
    }
  });
  await ipBatch.commit();
  console.log(`[AIsynchCleanup] Hashed ${ipCount} IP addresses`);

  // 4. Clean up expired rate limit docs
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const oldLimits = await db.collection('aiReadinessRateLimits')
    .where('date', '<', yesterday)
    .limit(100)
    .get();
  const limitBatch = db.batch();
  oldLimits.forEach(doc => limitBatch.delete(doc.ref));
  await limitBatch.commit();
});
```

---

## 7\. Agency White-Label Reporting

### 10.1 How It Works

An agency like King Digital Services onboards their clients as merchants in PathManager. Each client gets an AIsynch subscription (bundled via LocalSynch Authority or as a standalone add-on). The persistent monitoring cron runs daily/weekly for each client, accumulating snapshot data. At the end of each reporting period, the agency generates a branded report from the accumulated data.

The client never sees PathSynch branding. The agency looks like the expert.

**Agency workflow:**

```
1. Agency configures brand override (logo, colors, footer) — one-time setup
2. Agency adds clients to their roster in agencyBrandOverrides
3. Monitoring cron collects data for each client automatically
4. At reporting time, agency either:
   a. Clicks "Generate Report" manually in PathManager → downloads PDF
   b. Has scheduled reports auto-generate and email on the 1st of each month
5. Client receives branded report showing AI Readiness score trends,
   citation sources, competitor comparison, and action items
```

### 10.2 Report Generation Function

```javascript
// functions/services/agencyReportGenerator.js

/**
 * Generates a white-label AI Visibility report for an agency's client.
 *
 * Can be invoked manually (agency clicks "Generate Report") or by
 * the scheduled report cron.
 *
 * Data sources: aiReadinessScores, aiVisibilitySnapshots,
 * aiVisibilityPrompts — all already collected by the monitoring cron.
 * Report generation has ZERO additional API cost.
 */

async function generateAgencyReport(options) {
  const {
    agencyMerchantId,
    clientMerchantId,
    dateRange,              // { start, end }
    reportType,             // 'ai_visibility' | 'full_readiness' | 'competitor_analysis'
    includeSections,        // { aiReadinessScore, trendGraph, competitorComparison, ... }
    outputFormat,           // 'pdf' | 'html' | 'both'
    brandOverride           // From agencyBrandOverrides or null for PathSynch branding
  } = options;

  // 1. Gather data (all from Firestore — no API calls)
  const [currentScore, snapshots, prompts, competitors] = await Promise.all([
    db.collection('aiReadinessScores').doc(clientMerchantId).get(),
    db.collection('aiVisibilitySnapshots')
      .where('merchantId', '==', clientMerchantId)
      .where('snapshotDate', '>=', dateRange.start)
      .where('snapshotDate', '<=', dateRange.end)
      .orderBy('snapshotDate', 'asc')
      .get(),
    db.collection('aiVisibilityPrompts').doc(clientMerchantId).get(),
    getCompetitorScores(clientMerchantId)
  ]);

  // 2. Build report data bundle
  const reportData = {
    client: {
      name: currentScore.data()?.merchantName,
      city: currentScore.data()?.city,
      state: currentScore.data()?.state,
      category: currentScore.data()?.gbpCategory
    },
    currentScore: currentScore.data(),
    trendData: snapshots.docs.map(d => ({
      date: d.data().snapshotDate,
      mentionRate: d.data().aggregated?.overallMentionRate,
      modelBreakdown: extractModelRates(d.data().models),
      aiReadinessScore: null // Backfilled from aiReadinessScores history
    })),
    competitors: competitors,
    citations: extractLatestCitations(snapshots),
    actions: currentScore.data()?.actions || [],
    dateRange,
    reportType
  };

  // 3. Generate executive summary via Gemini
  if (includeSections.executiveSummary) {
    reportData.executiveSummary = await generateExecutiveSummary(reportData);
  }

  // 4. Render report
  let pdfUrl = null;
  let hostedUrl = null;

  if (outputFormat === 'pdf' || outputFormat === 'both') {
    pdfUrl = await renderReportPdf(reportData, brandOverride, includeSections);
  }
  if (outputFormat === 'html' || outputFormat === 'both') {
    hostedUrl = await renderReportHtml(reportData, brandOverride, includeSections);
  }

  // 5. Store report record
  const reportRef = await db.collection('generatedReports').add({
    agencyMerchantId,
    clientMerchantId,
    clientName: reportData.client.name,
    reportType,
    dateRange,
    sectionsIncluded: Object.keys(includeSections).filter(k => includeSections[k]),
    pdfUrl,
    pdfStoragePath: pdfUrl ? extractStoragePath(pdfUrl) : null,
    hostedUrl,
    pageCount: null, // Set after PDF generation
    brandOverride: brandOverride ? {
      companyName: brandOverride.companyName,
      logoUrl: brandOverride.logoUrl,
      accentColor: brandOverride.accentColor,
      footerText: brandOverride.footerText
    } : null,
    dataSnapshot: {
      aiReadinessScore: currentScore.data()?.totalScore || 0,
      previousScore: currentScore.data()?.previousScore || null,
      mentionRate: reportData.trendData.length > 0
        ? reportData.trendData[reportData.trendData.length - 1].mentionRate : 0,
      competitorCount: competitors.length,
      topCompetitorScore: competitors.length > 0
        ? Math.max(...competitors.map(c => c.mentionRate || 0)) : null,
      citationGapsFound: reportData.citations?.gapAnalysis?.length || 0
    },
    deliveryStatus: 'generated',
    sentTo: [],
    sentAt: null,
    deliveryError: null,
    generatedBy: options.triggeredBy || 'manual',
    generationDurationMs: Date.now() - options._startTime,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    reportId: reportRef.id,
    pdfUrl,
    hostedUrl,
    dataSnapshot: reportData
  };
}
```

### 10.3 Scheduled Report Cron

```javascript
// functions/scheduled/scheduledReportGenerator.js

/**
 * Runs daily at 6 AM ET. Checks for any scheduled reports due today,
 * generates them, and delivers via email.
 *
 * Separate from the monitoring cron (which runs at 3 AM ET) to ensure
 * monitoring data is fresh before reports are generated.
 */
exports.scheduledReportCron = onSchedule({
  schedule: '0 6 * * *',
  timeZone: 'America/New_York',
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 1,
  region: 'us-central1'
}, async (event) => {

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Find all active scheduled reports due today
  const dueReports = await db.collection('scheduledReports')
    .where('status', '==', 'active')
    .where('nextGeneration', '<=', now)
    .get();

  if (dueReports.empty) {
    console.log(`[ScheduledReports] No reports due today`);
    return;
  }

  console.log(`[ScheduledReports] ${dueReports.size} reports due`);

  for (const doc of dueReports.docs) {
    const config = doc.data();

    try {
      // Load brand override
      let brandOverride = null;
      if (config.useBrandOverride && config.brandOverrideId) {
        const brandDoc = await db.collection('agencyBrandOverrides')
          .doc(config.brandOverrideId).get();
        if (brandDoc.exists) {
          brandOverride = brandDoc.data().branding;
        }
      }

      // Calculate date range
      const dateRange = calculateDateRange(config.dateRangeType, now);

      // Generate the report
      const result = await generateAgencyReport({
        agencyMerchantId: config.agencyMerchantId,
        clientMerchantId: config.clientMerchantId,
        dateRange,
        reportType: config.reportType,
        includeSections: config.includeSections,
        outputFormat: config.outputFormat || 'pdf',
        brandOverride,
        triggeredBy: 'scheduled_cron',
        _startTime: Date.now()
      });

      // Deliver via email if configured
      if (config.deliveryMethod === 'email' || config.deliveryMethod === 'both') {
        const allRecipients = [
          ...(config.ccEmails || []),           // Agency always gets a copy
          ...(config.recipientEmails || [])     // Client gets it if autoSend is on
        ];

        if (allRecipients.length > 0) {
          await sendReportEmail({
            to: allRecipients,
            subject: renderTemplate(config.emailSubjectTemplate, {
              monthName: now.toLocaleString('en-US', { month: 'long' }),
              year: now.getFullYear(),
              clientName: config.clientName
            }),
            body: config.emailBodyTemplate || generateDefaultEmailBody(config, result),
            pdfUrl: result.pdfUrl,
            hostedUrl: result.hostedUrl,
            brandOverride
          });

          // Update delivery status
          await db.collection('generatedReports').doc(result.reportId).update({
            deliveryStatus: 'sent',
            sentTo: allRecipients,
            sentAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      // Calculate next generation date
      const nextGeneration = calculateNextGeneration(config.frequency, config, now);

      // Update schedule
      await doc.ref.update({
        lastGenerated: admin.firestore.FieldValue.serverTimestamp(),
        nextGeneration,
        totalReportsGenerated: admin.firestore.FieldValue.increment(1),
        'lastGeneratedReport.reportId': result.reportId,
        'lastGeneratedReport.generatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'lastGeneratedReport.downloadUrl': result.pdfUrl,
        'lastGeneratedReport.hostedUrl': result.hostedUrl
      });

      console.log(`[ScheduledReports] ✓ ${config.clientName} report generated`);

    } catch (err) {
      console.error(`[ScheduledReports] ✗ ${config.clientName}:`, err.message);

      // Update the generated report with failure status if it was created
      // (generateAgencyReport may have partially succeeded)
    }
  }
});

function calculateDateRange(type, now) {
  const end = now;
  let start;

  switch (type) {
    case 'last_7_days':
      start = new Date(now - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'last_30_days':
      start = new Date(now - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'last_quarter':
      start = new Date(now - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function calculateNextGeneration(frequency, config, now) {
  const next = new Date(now);

  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      if (config.dayOfMonth) {
        next.setDate(Math.min(config.dayOfMonth, daysInMonth(next)));
      }
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      if (config.dayOfMonth) {
        next.setDate(Math.min(config.dayOfMonth, daysInMonth(next)));
      }
      break;
  }

  return next;
}
```

### 10.4 Report Limits Policy

**Reports are unlimited at all tiers.** Reports are views of data already collected by the monitoring cron. Generating a report is a Firestore read plus formatting — essentially zero marginal cost. Restricting report count would feel punitive without saving meaningful money.

What is limited is the number of monitored brands (which drives the actual API cost):

| AIsynch Tier | Monitored Brands | Report Generation | Scheduled Reports | White-Label |
| :---- | :---: | :---: | :---: | :---: |
| Lite (free) | 1 (self) | On-demand only | — | — |
| Starter ($49) | 1 \+ 3 competitors | Unlimited on-demand | — | — |
| Growth ($99) | 1 \+ 5 competitors | Unlimited on-demand | — | — |
| Scale ($199) | 10 brands total | Unlimited on-demand | ✓ (auto-generate \+ email) | ✓ |

**For agencies:** The 10-brand limit on Scale means Brian at King Digital can monitor up to 10 dental clients. Each client gets unlimited report pulls. If Brian needs more than 10 brands, that's an Enterprise conversation — custom pricing, likely $399-599/mo with 25-50 brands.

**On-demand vs scheduled:** All tiers can generate reports manually (click a button, get a PDF). Only Scale gets scheduled automation (reports auto-generate on a cadence and email to clients). This is the key differentiator that justifies the $199 price for agencies — Starter/Growth merchants don't need automated reporting because they're checking their own score, not delivering reports to clients.

### 10.5 King Digital Services — Example Setup

Brian Hampton (Suite 320, same building as PathSynch) is the reference implementation:

```
agencyBrandOverrides/brian_merchant_id:
  agencyName: "King Digital Services"
  domain: "kingseoservice.com"
  branding:
    logoUrl: "https://storage.googleapis.com/.../king-digital-logo.png"
    companyName: "King Digital Services"
    accentColor: "#1E40AF"
    footerText: "Prepared by King Digital Services | kingseoservice.com"
    contactEmail: "brian@kingseoservice.com"
  clients:
    - merchantId: brilliant_smiles_id
      merchantName: "Brilliant Smiles"
      reportFrequency: "monthly"
      autoSendToClient: true
      clientContactEmails: ["office@brilliantsmilesga.com"]
    - merchantId: smile_academy_id
      merchantName: "Smile Academy Kids"
      reportFrequency: "monthly"
      autoSendToClient: false  // Brian reviews first, then forwards
      clientContactEmails: []
  maxClients: 10
  currentClientCount: 2

scheduledReports/auto-id-1:
  agencyMerchantId: brian_merchant_id
  clientMerchantId: brilliant_smiles_id
  clientName: "Brilliant Smiles"
  frequency: "monthly"
  dayOfMonth: 1
  reportType: "ai_visibility"
  includeSections:
    aiReadinessScore: true
    trendGraph: true
    competitorComparison: true
    citationSources: true
    actionItems: true
    executiveSummary: true
  deliveryMethod: "both"
  recipientEmails: ["office@brilliantsmilesga.com"]
  ccEmails: ["brian@kingseoservice.com"]
  outputFormat: "pdf"
  status: "active"
  nextGeneration: 2026-07-01T10:00:00Z
```

**Brian's monthly cost:** AIsynch Scale add-on: $199/mo. Covers monitoring for Brilliant Smiles, Smile Academy Kids, and up to 8 more dental clients. Unlimited report generation. Automated monthly reports emailed to clients under King Digital branding.

**What Brian charges his clients:** Brian marks up the AI Visibility monitoring as part of his SEO retainer. A typical local SEO retainer is $1,500-3,000/mo. The AI Visibility report is a deliverable that justifies the retainer — "here's proof your AI presence is improving." Brian's cost for that proof: $19.90/client/mo ($199 ÷ 10 clients). His margin on the visibility reporting alone is 95%+.

**DFY Outbound Engine integration:** If Brian is on the DFY Outbound Engine pilot ($1,999-2,999/mo), AIsynch Scale could be bundled into the DFY package at no additional charge — he's already paying enough to absorb the $199. The AI Visibility reports become another deliverable in the DFY service, making it stickier. If Brian stops the DFY service, he loses the monitoring history — that's a switching cost.

---

## 8\. Report Format & UX Placement

### 8.1 Report Sections

Every AIsynch report — whether generated for a direct merchant or white-labeled for an agency client — contains the same seven sections. The data sources, depth, and branding change by tier and context. The layout does not.

| \# | Section | Data Source | Tier Required |
| :---- | :---- | :---- | :---- |
| 1 | Summary metrics (AI Readiness score, mention rate, avg position, sentiment) | `aiReadinessScores` \+ latest `aiVisibilitySnapshots` | All tiers |
| 2 | Visibility trend chart (mention rate over time, competitor comparison lines) | `aiVisibilitySnapshots` time series | Starter+ |
| 3 | Multi-model heatmap (mention rate per AI model per business) | `aiVisibilitySnapshots.models` (per-model, never merged) | Growth+ |
| 4 | AI Readiness score ring \+ six-pillar breakdown with progress bars | `aiReadinessScores.pillars` | All tiers |
| 5 | Citation sources table (domain, type badge, brand cited, competitor cited, retrievals) | `aiVisibilitySnapshots.citations.domains` | Growth+ |
| 6 | Citation gaps table (domains citing competitors but not merchant, gap score, priority) | `aiVisibilitySnapshots.citations.gapAnalysis` | Growth+ |
| 7 | Prioritized actions (title, description, impact, difficulty, points available, linked product) | `aiReadinessScores.actions` | All tiers (3 actions for Lite, 5 for paid) |
| 8 | Executive summary (Gemini-generated narrative summarizing the period) | One Gemini flash call at report generation time | Starter+ |

### 8.2 Branding Variants

| Context | Header Left | Header Right | Footer |
| :---- | :---- | :---- | :---- |
| Direct merchant (no agency) | PathSynch logo | Merchant business name \+ city | "Powered by AIsynch · pathsynch.com" |
| Agency white-label (Scale) | Agency logo \+ name from `agencyBrandOverrides.branding` | Client business name \+ city | Agency footer text \+ "Powered by AIsynch" |
| Free scan lead magnet (public) | PathSynch logo | Business name \+ city | "Get your full AI Readiness audit · pathsynch.com" \+ CTA |

The free scan version shows only sections 1, 4, and 7 (summary metrics, score ring with pillar bars, and 3 actions). Sections 2, 3, 5, 6, and 8 are omitted — they require monitoring history that doesn't exist for a one-time scan. This creates a natural upgrade prompt: "Want to see how your visibility changes over time? Add AIsynch Starter."

### 8.3 Where It Lives in PathManager

The report is NOT a dedicated tab. The data lives across the existing PathManager dashboard and the report is an export format.

**PathManager dashboard — AI Readiness card:**

This is the always-visible entry point. A new dashboard card sits alongside the existing GBP Performance, Review Velocity, and Local Rank cards. It shows:

- AI Readiness score ring (52/100) with delta badge (+18 pts)  
- Trend sparkline (last 30 days, tiny — 120px wide)  
- Top 2 action items (truncated, with "View all" link)  
- Confidence label ("Verified" / "Estimated from public data")

Content depth inside the card is tier-gated:

| AIsynch Tier | Card Shows |
| :---- | :---- |
| Lite (free) | Score ring \+ 3 actions. No sparkline (monthly data only). |
| Starter ($49) | Score ring \+ sparkline \+ 5 actions. "View details" expands to full pillar breakdown. |
| Growth ($99) | Everything in Starter \+ expandable sections for: multi-model heatmap, citation sources, gap analysis. |
| Scale ($199) | Everything in Growth \+ "Generate report" button with date range picker, brand override toggle, and PDF/hosted link output. |

**Expandable detail view (Growth/Scale):**

Clicking "View details" on the dashboard card expands inline (no page navigation) to show the full heatmap, citation sources table, gap analysis table, and all actions. This is the same data as the report but rendered live in the dashboard rather than as a static PDF. The merchant can browse their AI visibility data anytime without generating a formal report.

**"Generate report" button (Scale):**

Visible only on Scale tier. Opens a modal with:

- Date range selector (last 7 days, last 30 days, last quarter, custom)  
- Report type (AI visibility, full readiness, competitor analysis)  
- Sections to include (checkboxes, all checked by default)  
- Brand override toggle (for agencies — pulls from `agencyBrandOverrides`)  
- Output format (PDF download, hosted link, or both)  
- "Generate" button → produces the formatted report from Firestore data \+ one Gemini executive summary call

For agencies, an additional "Client" dropdown appears above the date range, letting the agency select which client to generate the report for.

**Report cost:**

| Component | Cost |
| :---- | :---- |
| Firestore reads (scores \+ snapshots \+ citations) | \~$0.001 |
| Gemini flash call (executive summary, \~500 tokens) | \~$0.001 |
| PDF generation (if PDF format selected) | \~$0.00 (local rendering) |
| **Total per report** | **\< $0.01** |

This is why reports are unlimited — the expensive monitoring already happened during the cron. The report is essentially free to generate.

### 8.4 SynchIntro Integration

The AIsynch data also feeds into SynchIntro's Market Intel report Visibility tab. When a SynchIntro user runs a Market Intel report and the qualified leads have AIsynch monitoring data (because they're also PathManager merchants or because AIsynch data was collected during the monitoring cron), the Visibility tab displays the same AI Visibility Check, Citation Sources, and Gap Analysis sections using data from `aiVisibilitySnapshots`.

For leads that are NOT AIsynch-monitored merchants, the Visibility tab continues to use the existing per-report AI Visibility enrichment (Gemini Grounded \+ Perplexity, point-in-time). The difference: AIsynch merchants get historical trend data and citation depth; non-AIsynch leads get a single snapshot. This creates a natural bridge — a SynchIntro user sees the richer data for AIsynch merchants and asks "how do I get this for my other leads?"

### 8.5 Free Scan Output (pathsynch.com)

The free scan on pathsynch.com renders a simplified version of the report directly in the browser (not as a PDF). It shows:

- The score ring with 6 pillar bars (section 4\)  
- Summary metrics — score, confidence label, business name, address (section 1\)  
- Top 3 actions with linked products (section 7\)  
- A prominent CTA: "Track your AI visibility over time — add AIsynch to your PathSynch account"  
- An email capture field: "Get your full report emailed to you" (feeds `aiReadinessScans` with email for outbound follow-up)

What it intentionally does NOT show: trend data (doesn't exist yet), heatmap (requires monitoring), citations (requires monitoring), gap analysis (requires monitoring). These omissions are the upgrade hook — the merchant sees their score and weaknesses but can't see the trajectory or competitive context without paying.

---

## 9\. PathManager Dashboard Integration

### 9.1 Architecture Decision: Cloud Function API Bridge

PathManager runs on EC2 (backend at `3.88.108.6`, Amazon Linux 2023, systemd; frontend at `18.209.25.81`, Ubuntu, nginx) with MongoDB Atlas as its database. AIsynch data lives in Firestore (`pathsynch-pitch-creation`). These are two different data stores on two different infrastructure stacks.

**Decision: PathManager's EC2 backend calls a Cloud Function API that reads Firestore and returns the data.**

Why not read Firestore directly from PathManager:

- PathManager backend is plain JavaScript CommonJS on EC2, not a Firebase project. Adding the Firebase Admin SDK to the EC2 backend introduces a new dependency, a new service account credential to manage, and a second database connection alongside MongoDB.  
- The Cloud Function API acts as a clean boundary — PathManager asks "give me the AIsynch data for this merchant" and gets a JSON response. It doesn't need to know about Firestore collections, document structures, or query patterns.  
- The Cloud Function can enforce auth (validate the PathManager JWT), apply tier-gating (return different depth based on AIsynch subscription tier), and shape the response for the dashboard without the EC2 backend carrying that logic.

Why not use the Firebase client SDK on the frontend:

- PathManager's frontend is a React SPA served by nginx on EC2. Adding the Firebase client SDK would require Firebase Auth tokens for every merchant, which PathManager doesn't use — it has its own JWT auth via `req.user.sub` (merchant `_id`).  
- Client-side Firestore reads would expose the data structure and query patterns to the browser, and would require Firestore security rules that understand PathManager's auth model.

### 9.2 Cloud Function API Endpoints

All AIsynch dashboard endpoints live in a single Cloud Function and are authenticated via PathManager's existing JWT. The Cloud Function validates the JWT by checking the signature against a shared secret (already used by PathManager's existing Firebase integrations).

```javascript
// functions/api/aisynchDashboard.js

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const db = admin.firestore();

exports.aisynchDashboard = onRequest({
  cors: [
    'https://app.pathmanager.com',
    'https://pathmanager.com',
    'http://localhost:3000'   // local dev
  ],
  maxInstances: 20,
  timeoutSeconds: 15,
  region: 'us-central1'
}, async (req, res) => {

  // Validate PathManager JWT
  const merchantId = await validatePathManagerToken(req);
  if (!merchantId) return res.status(401).json({ error: 'Unauthorized' });

  // Route by path
  const path = req.path.replace(/^\/+/, '');

  switch (path) {
    case 'score':       return handleGetScore(merchantId, req, res);
    case 'trend':       return handleGetTrend(merchantId, req, res);
    case 'heatmap':     return handleGetHeatmap(merchantId, req, res);
    case 'citations':   return handleGetCitations(merchantId, req, res);
    case 'actions':     return handleGetActions(merchantId, req, res);
    case 'competitors': return handleGetCompetitors(merchantId, req, res);
    case 'subscription':return handleGetSubscription(merchantId, req, res);
    case 'report':      return handleGenerateReport(merchantId, req, res);
    default:            return res.status(404).json({ error: 'Not found' });
  }
});
```

**Endpoint: GET /score**

Returns the current AI Readiness score, pillar breakdown, confidence, and delta. This is the primary data source for the dashboard card.

```javascript
async function handleGetScore(merchantId, req, res) {
  const doc = await db.collection('aiReadinessScores').doc(merchantId).get();
  if (!doc.exists) return res.json({ status: 'no_score', merchantId });

  const data = doc.data();
  const sub = await getSubscriptionTier(merchantId);

  return res.json({
    totalScore: data.totalScore,
    previousScore: data.previousScore,
    scoreChange: data.scoreChange,
    confidenceLevel: data.confidenceLevel,
    confidenceLabel: data.confidenceLabel,
    dataCompleteness: data.dataCompleteness,
    pillars: data.pillars,
    actions: sub.tier === 'lite' ? (data.actions || []).slice(0, 3) : data.actions,
    scoredAt: data.scoredAt,
    aisynchTier: sub.tier,
    aisynchStatus: sub.status
  });
}
```

**Endpoint: GET /trend?days=30**

Returns time-series visibility data for the trend chart. Tier-gated: Starter+ only.

```javascript
async function handleGetTrend(merchantId, req, res) {
  const sub = await getSubscriptionTier(merchantId);
  if (sub.tier === 'lite') return res.json({ gated: true, requiredTier: 'starter' });

  const days = Math.min(parseInt(req.query.days) || 30, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snapshots = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .where('snapshotDate', '>=', since)
    .orderBy('snapshotDate', 'asc')
    .get();

  const trendData = [];
  snapshots.forEach(doc => {
    const d = doc.data();
    trendData.push({
      date: d.snapshotDate,
      mentionRate: d.aggregated?.overallMentionRate || 0,
      modelsChecked: d.aggregated?.modelsChecked || 0,
      modelBreakdown: sub.tier === 'growth' || sub.tier === 'scale'
        ? extractModelRates(d.models) : null
    });
  });

  return res.json({ trendData, days, tier: sub.tier });
}
```

**Endpoint: GET /heatmap**

Returns multi-model mention rates per business. Tier-gated: Growth+ only.

```javascript
async function handleGetHeatmap(merchantId, req, res) {
  const sub = await getSubscriptionTier(merchantId);
  if (sub.tier === 'lite' || sub.tier === 'starter') {
    return res.json({ gated: true, requiredTier: 'growth' });
  }

  // Get the latest snapshot
  const latest = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  if (latest.empty) return res.json({ status: 'no_data' });

  const data = latest.docs[0].data();
  return res.json({
    models: data.models,
    competitors: data.competitors,
    snapshotDate: data.snapshotDate
  });
}
```

**Endpoint: GET /citations**

Returns citation sources, gap analysis, and type breakdown. Tier-gated: Growth+ only.

```javascript
async function handleGetCitations(merchantId, req, res) {
  const sub = await getSubscriptionTier(merchantId);
  if (sub.tier === 'lite' || sub.tier === 'starter') {
    return res.json({ gated: true, requiredTier: 'growth' });
  }

  const latest = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  if (latest.empty) return res.json({ status: 'no_data' });

  const data = latest.docs[0].data();
  return res.json({
    citations: data.citations,
    snapshotDate: data.snapshotDate
  });
}
```

**Endpoint: POST /report**

Generates a report (PDF or hosted link). Tier-gated: Scale only for scheduled/white-label; Growth+ for on-demand.

**Full endpoint list:**

| Endpoint | Method | Auth | Tier Gate | Response |
| :---- | :---- | :---- | :---- | :---- |
| `/score` | GET | JWT | All | Score, pillars, confidence, actions |
| `/trend?days=30` | GET | JWT | Starter+ | Time-series mention rate array |
| `/heatmap` | GET | JWT | Growth+ | Per-model mention rates, competitor grid |
| `/citations` | GET | JWT | Growth+ | Citation domains, URLs, gap analysis |
| `/actions` | GET | JWT | All | Prioritized action items with product links |
| `/competitors` | GET | JWT | Starter+ | Competitor AI Readiness scores |
| `/subscription` | GET | JWT | All | AIsynch tier, status, entitlements |
| `/report` | POST | JWT | Growth+ (on-demand), Scale (scheduled) | Report URL (PDF or hosted) |

### 9.3 PathManager EC2 Backend Integration

The PathManager EC2 backend adds a new route group that proxies to the Cloud Function API. This keeps the frontend simple — it calls PathManager's own API as usual, and PathManager forwards to Firestore via the Cloud Function.

```javascript
// pathConnect_backend/routes/aisynch.js

const express = require('express');
const router = express.Router();
const https = require('https');
const { authenticateToken } = require('../middleware/auth');

const AISYNCH_API_BASE = 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aisynchDashboard';

// Proxy helper — forwards request to Cloud Function with merchant JWT
async function proxyToAisynch(path, merchantId, token, query) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const url = AISYNCH_API_BASE + '/' + path + qs;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('AIsynch API parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('AIsynch API timeout')); });
    req.end();
  });
}

// GET /api/aisynch/score
router.get('/score', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToAisynch('score', req.user.sub, req.headers.authorization?.split(' ')[1]);
    res.json(data);
  } catch (err) {
    console.error('[AIsynch] Score fetch failed:', err.message);
    res.status(502).json({ error: 'AIsynch data unavailable' });
  }
});

// GET /api/aisynch/trend?days=30
router.get('/trend', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToAisynch('trend', req.user.sub, req.headers.authorization?.split(' ')[1], { days: req.query.days || 30 });
    res.json(data);
  } catch (err) {
    console.error('[AIsynch] Trend fetch failed:', err.message);
    res.status(502).json({ error: 'AIsynch data unavailable' });
  }
});

// GET /api/aisynch/heatmap
router.get('/heatmap', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToAisynch('heatmap', req.user.sub, req.headers.authorization?.split(' ')[1]);
    res.json(data);
  } catch (err) {
    console.error('[AIsynch] Heatmap fetch failed:', err.message);
    res.status(502).json({ error: 'AIsynch data unavailable' });
  }
});

// GET /api/aisynch/citations
router.get('/citations', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToAisynch('citations', req.user.sub, req.headers.authorization?.split(' ')[1]);
    res.json(data);
  } catch (err) {
    console.error('[AIsynch] Citations fetch failed:', err.message);
    res.status(502).json({ error: 'AIsynch data unavailable' });
  }
});

// Repeat pattern for /actions, /competitors, /subscription, /report

module.exports = router;
```

Mount in the PathManager backend server:

```javascript
// In the main server file (e.g., server.js or index.js):
const aisynchRoutes = require('./routes/aisynch');
app.use('/api/aisynch', aisynchRoutes);
```

### 9.4 PathManager Frontend React Components

All AIsynch components live in a single directory: `src/components/AIsynch/`. The main entry point is `AIsynchCard.jsx` which renders on the PathManager dashboard. It fetches data from `/api/aisynch/score` on mount and conditionally renders sub-components based on tier.

**Component tree:**

```
src/components/AIsynch/
├── AIsynchCard.jsx              — Dashboard card (always visible)
├── AIsynchScoreRing.jsx         — Circular score display (52/100)
├── AIsynchPillarBars.jsx        — Six horizontal progress bars
├── AIsynchTrendChart.jsx        — Line chart (Chart.js, Starter+)
├── AIsynchHeatmap.jsx           — Multi-model competitor grid (Growth+)
├── AIsynchCitations.jsx         — Citation sources + gap table (Growth+)
├── AIsynchActions.jsx           — Prioritized action cards (all tiers)
├── AIsynchDetailView.jsx        — Expandable container for all sub-components
├── AIsynchUpgradePrompt.jsx     — Tier gate CTA ("Upgrade to Growth to see citation sources")
├── AIsynchReportModal.jsx       — Report generation modal (Scale)
└── aisynchApi.js                — API client (fetch wrappers for all endpoints)
```

**AIsynchCard.jsx — Main dashboard card:**

```
// src/components/AIsynch/AIsynchCard.jsx

import React, { useState, useEffect } from 'react';
import { fetchAIsynchScore } from './aisynchApi';
import AIsynchScoreRing from './AIsynchScoreRing';
import AIsynchPillarBars from './AIsynchPillarBars';
import AIsynchActions from './AIsynchActions';
import AIsynchDetailView from './AIsynchDetailView';

export default function AIsynchCard() {
  const [scoreData, setScoreData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAIsynchScore()
      .then(data => { setScoreData(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <DashboardCardSkeleton title="AI Readiness" />;
  if (error) return <DashboardCardError title="AI Readiness" message={error} />;
  if (!scoreData || scoreData.status === 'no_score') {
    return <AIsynchEmptyState />;
  }

  return (
    <div className="dashboard-card aisynch-card">
      <div className="card-header">
        <h3>AI Readiness</h3>
        <span className={`confidence-badge confidence-${scoreData.confidenceLevel}`}>
          {scoreData.confidenceLabel}
        </span>
      </div>

      <div className="card-body">
        {/* Score ring + delta badge */}
        <div className="aisynch-summary">
          <AIsynchScoreRing
            score={scoreData.totalScore}
            previousScore={scoreData.previousScore}
            scoreChange={scoreData.scoreChange}
          />
          <div className="aisynch-quick-stats">
            <span className="stat-label">AI Readiness Score</span>
            <span className={`delta-badge ${scoreData.scoreChange >= 0 ? 'positive' : 'negative'}`}>
              {scoreData.scoreChange >= 0 ? '+' : ''}{scoreData.scoreChange} pts
            </span>
          </div>
        </div>

        {/* Pillar bars (always shown) */}
        <AIsynchPillarBars pillars={scoreData.pillars} />

        {/* Top actions (3 for lite, 5 for paid) */}
        <AIsynchActions actions={scoreData.actions} maxShown={3} />

        {/* Expand button (Starter+ sees more content) */}
        {scoreData.aisynchTier !== 'lite' && (
          <button
            className="aisynch-expand-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show less' : 'View details'}
          </button>
        )}

        {/* Expanded detail view */}
        {expanded && (
          <AIsynchDetailView
            merchantId={scoreData.merchantId}
            tier={scoreData.aisynchTier}
          />
        )}
      </div>
    </div>
  );
}
```

**AIsynchScoreRing.jsx:**

```
// src/components/AIsynch/AIsynchScoreRing.jsx

import React from 'react';

export default function AIsynchScoreRing({ score, previousScore, scoreChange }) {
  // SVG circle math: circumference = 2 * PI * radius
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const offset = circumference - progress;

  // Color based on score
  const color = score >= 70 ? '#1D9E75' : score >= 40 ? '#185FA5' : '#D85A30';

  return (
    <div className="score-ring-container">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius}
          fill="none" stroke="#e5e5e5" strokeWidth="6" />
        <circle cx="50" cy="50" r={radius}
          fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)" />
      </svg>
      <div className="score-ring-value">
        <span className="score-number">{score}</span>
        <span className="score-total">/100</span>
      </div>
    </div>
  );
}
```

**AIsynchPillarBars.jsx:**

```
// src/components/AIsynch/AIsynchPillarBars.jsx

import React from 'react';

const PILLAR_CONFIG = {
  reviewAuthority:     { label: 'Review authority',     color: '#185FA5' },
  gbpCompleteness:     { label: 'GBP completeness',     color: '#1D9E75' },
  webPresence:         { label: 'Web presence',         color: '#D85A30' },
  citationPresence:    { label: 'Citation presence',    color: '#BA7517' },
  aiVisibility:        { label: 'AI visibility',        color: '#534AB7' },
  competitivePosition: { label: 'Competitive position', color: '#888780' }
};

export default function AIsynchPillarBars({ pillars }) {
  return (
    <div className="pillar-bars">
      {Object.entries(PILLAR_CONFIG).map(([key, config]) => {
        const pillar = pillars[key];
        if (!pillar) return null;
        const pct = Math.round((pillar.score / pillar.max) * 100);

        return (
          <div key={key} className="pillar-row">
            <span className="pillar-label">{config.label}</span>
            <div className="pillar-bar-track">
              <div className="pillar-bar-fill"
                style={{ width: pct + '%', background: config.color }} />
            </div>
            <span className="pillar-score">{pillar.score}/{pillar.max}</span>
          </div>
        );
      })}
    </div>
  );
}
```

**AIsynchTrendChart.jsx:**

```
// src/components/AIsynch/AIsynchTrendChart.jsx

import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { fetchAIsynchTrend } from './aisynchApi';

export default function AIsynchTrendChart({ days = 30 }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchAIsynchTrend(days).then(setData);
  }, [days]);

  useEffect(() => {
    if (!data || !chartRef.current) return;

    if (chartInstance.current) chartInstance.current.destroy();

    const labels = data.trendData.map(d =>
      new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
    const mentionRates = data.trendData.map(d => d.mentionRate);

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Mention rate',
          data: mentionRates,
          borderColor: '#185FA5',
          backgroundColor: 'rgba(24,95,165,0.08)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.parsed.y + '% mention rate'
            }
          }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } },
          x: { ticks: { maxRotation: 0 } }
        }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [data]);

  if (!data) return <div className="chart-skeleton" />;

  return (
    <div className="trend-chart-container">
      <h4>Visibility trend</h4>
      <div style={{ position: 'relative', height: 200 }}>
        <canvas ref={chartRef} />
      </div>
    </div>
  );
}
```

**AIsynchDetailView.jsx — expandable container with tier gating:**

```
// src/components/AIsynch/AIsynchDetailView.jsx

import React from 'react';
import AIsynchTrendChart from './AIsynchTrendChart';
import AIsynchHeatmap from './AIsynchHeatmap';
import AIsynchCitations from './AIsynchCitations';
import AIsynchActions from './AIsynchActions';
import AIsynchUpgradePrompt from './AIsynchUpgradePrompt';

export default function AIsynchDetailView({ merchantId, tier }) {
  return (
    <div className="aisynch-detail-view">
      {/* Trend chart — Starter+ */}
      {tier === 'lite' ? (
        <AIsynchUpgradePrompt
          feature="Visibility trend"
          requiredTier="Starter"
          description="See how your AI mention rate changes over time"
        />
      ) : (
        <AIsynchTrendChart days={30} />
      )}

      {/* Heatmap — Growth+ */}
      {(tier === 'lite' || tier === 'starter') ? (
        <AIsynchUpgradePrompt
          feature="Multi-model heatmap"
          requiredTier="Growth"
          description="See how each AI model mentions your business vs competitors"
        />
      ) : (
        <AIsynchHeatmap />
      )}

      {/* Citations + Gap analysis — Growth+ */}
      {(tier === 'lite' || tier === 'starter') ? (
        <AIsynchUpgradePrompt
          feature="Citation sources & gap analysis"
          requiredTier="Growth"
          description="See which websites AI models cite and where you're missing"
        />
      ) : (
        <AIsynchCitations />
      )}

      {/* Full action list (all tiers, but more actions for paid) */}
      <AIsynchActions maxShown={10} showAll />
    </div>
  );
}
```

**aisynchApi.js — API client:**

```javascript
// src/components/AIsynch/aisynchApi.js

const BASE = '/api/aisynch';

async function fetchJSON(path, options = {}) {
  const token = localStorage.getItem('token'); // PathManager JWT
  const res = await fetch(BASE + path, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  if (!res.ok) throw new Error('AIsynch API error: ' + res.status);
  return res.json();
}

export function fetchAIsynchScore() {
  return fetchJSON('/score');
}

export function fetchAIsynchTrend(days = 30) {
  return fetchJSON('/trend?days=' + days);
}

export function fetchAIsynchHeatmap() {
  return fetchJSON('/heatmap');
}

export function fetchAIsynchCitations() {
  return fetchJSON('/citations');
}

export function fetchAIsynchActions() {
  return fetchJSON('/actions');
}

export function fetchAIsynchCompetitors() {
  return fetchJSON('/competitors');
}

export function fetchAIsynchSubscription() {
  return fetchJSON('/subscription');
}

export function generateAIsynchReport(options) {
  return fetchJSON('/report', {
    method: 'POST',
    body: JSON.stringify(options)
  });
}
```

### 9.5 Data Flow Summary

```
Merchant opens PathManager dashboard
  → Browser loads AIsynchCard.jsx
  → Component calls GET /api/aisynch/score
  → PathManager EC2 backend (routes/aisynch.js)
  → Proxy to Cloud Function: GET aisynchDashboard/score
  → Cloud Function reads Firestore: aiReadinessScores/{merchantId}
  → Cloud Function checks Firestore: aisynchSubscriptions/{merchantId}
  → Cloud Function applies tier gate + shapes response
  → JSON response → EC2 backend → Browser → React renders card

Merchant clicks "View details"
  → AIsynchDetailView renders
  → Parallel fetches: /trend, /heatmap, /citations
  → Same proxy chain: EC2 → Cloud Function → Firestore → response
  → Tier-gated: Growth+ gets heatmap/citations, Starter+ gets trend
  → Components render as data arrives (independent loading states)

Merchant clicks "Generate Report" (Scale only)
  → AIsynchReportModal opens
  → User selects date range, sections, format
  → POST /api/aisynch/report
  → Cloud Function calls generateAgencyReport() from Section 7
  → Returns PDF URL or hosted link
  → Modal displays download button
```

### 9.6 Latency Budget

| Step | Expected Latency | Notes |
| :---- | :---- | :---- |
| Browser → EC2 backend | 20-50ms | Same-region (us-east-1) |
| EC2 → Cloud Function | 80-150ms | Cross-service HTTPS call |
| Cloud Function cold start | 0-800ms | Only on first request after idle |
| Firestore read (score) | 10-30ms | Single document read |
| Firestore read (snapshots for trend) | 30-80ms | 30 documents, indexed query |
| Total (warm) | 150-300ms | Acceptable for dashboard card |
| Total (cold start) | 500-1100ms | First load after idle, show skeleton |

The dashboard card shows a skeleton loader during the initial fetch. Sub-components in the detail view load independently — the trend chart can appear before the heatmap is ready.

### 9.7 Caching Strategy

To avoid hitting the Cloud Function on every PathManager page load, the EC2 backend caches AIsynch responses in memory (node-cache or simple object with TTL):

```javascript
// In routes/aisynch.js
const NodeCache = require('node-cache');
const aisynchCache = new NodeCache({ stdTTL: 300 }); // 5-minute TTL

router.get('/score', authenticateToken, async (req, res) => {
  const cacheKey = 'aisynch_score_' + req.user.sub;
  const cached = aisynchCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await proxyToAisynch('score', req.user.sub, req.headers.authorization?.split(' ')[1]);
    aisynchCache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('[AIsynch] Score fetch failed:', err.message);
    res.status(502).json({ error: 'AIsynch data unavailable' });
  }
});
```

TTL by endpoint:

- `/score`: 5 minutes (score changes at most daily)  
- `/trend`: 15 minutes (trend data changes at most daily)  
- `/heatmap`: 15 minutes  
- `/citations`: 15 minutes  
- `/subscription`: 30 minutes (rarely changes)

Cache is per-merchant (keyed by `req.user.sub`). Cache invalidation happens naturally via TTL — no manual cache busting needed because AIsynch data only changes when the monitoring cron runs (daily at most).

---

## 10\. Integration Points Summary

| System | Direction | What Flows |
| :---- | :---- | :---- |
| **PathManager Dashboard** | ← AIsynch | AI Readiness score card, trend graph, action items, competitor comparison |
| **PathConnect** | ← AIsynch | Review request triggers when AI mentions increase |
| **PathConnect Widget** | → AIsynch | Page signals (schema, mobile, AI crawl readiness) feed Pillar 3 |
| **LocalSynch** | → AIsynch | GBP audit data feeds Pillar 2 |
| **LocalSynch** | ← AIsynch | llms.txt file generated and offered for deployment |
| **SynchIntro Market Intel** | ← AIsynch | AI Visibility data populates the Visibility tab |
| **SynchIntro Leads** | ← AIsynch | Free scan leads with scores feed into qualified leads |
| **QRsynch Pages** | ← AIsynch | AI Readiness badge displays on review capture pages (score 60+) |
| **ReferralSynch** | ← AIsynch | "Your referral pages aren't cited by AI" surfaced as action |
| **Entity360** | ↔ AIsynch | Merchant identity bridge — AI Readiness score as merchant attribute |
| **Stripe** | ↔ AIsynch | Subscription line items, webhooks for status changes |
| **MongoDB (PathManager)** | → AIsynch | Merchant identity, review stats, GBP data |
| **Firestore** | ← AIsynch | All AIsynch data stored here |
| **Agency Reports** | ← AIsynch | White-label PDFs/hosted pages generated from accumulated monitoring data |
| **SendGrid / SES** | ← AIsynch | Scheduled report email delivery to agency clients |

---

## 11\. Environment Variables Required

Add to `pathsynch-pitch-generator/functions/.env`:

```
# AIsynch
ENABLE_AISYNCH_MONITORING=true
PERPLEXITY_API_KEY=pplx-XXXXX              # Already exists (PathSynch_AI_Visibility)
AISYNCH_STARTER_PRICE_ID=price_XXXXX
AISYNCH_GROWTH_PRICE_ID=price_XXXXX
AISYNCH_SCALE_PRICE_ID=price_XXXXX
TURNSTILE_SECRET_KEY=XXXXX                  # Cloudflare Turnstile (free scan protection)
AISYNCH_DEBUG_RAW_RESPONSES=false           # Set true only for debugging

# Cost control — prevents runaway API costs from bugs or misconfigurations
AISYNCH_DAILY_COST_CAP=25                   # Max estimated daily API spend in USD. Cron stops processing if exceeded.
AISYNCH_MAX_PROMPTS_PER_MERCHANT=15         # Hard cap on prompts per merchant per monitoring run
AISYNCH_MAX_COMPETITORS_PER_MERCHANT=10     # Hard cap on tracked competitors per merchant
AISYNCH_MAX_MODELS_PER_RUN=3               # Hard cap on AI models queried per run (gemini + perplexity + claude)

# Optional: Claude via AWS Bedrock (Growth/Scale tiers)
AWS_BEDROCK_REGION=us-east-1
AWS_BEDROCK_ACCESS_KEY_ID=XXXXX
AWS_BEDROCK_SECRET_ACCESS_KEY=XXXXX
```

---

## 12\. AIsynch Tier Feature Matrix (Reference)

| Feature | Lite (free) | Starter ($49) | Growth ($99) | Scale ($199) |
| :---- | :---: | :---: | :---: | :---: |
| AI Readiness score | ✓ | ✓ | ✓ | ✓ |
| Six-pillar breakdown | ✓ | ✓ | ✓ | ✓ |
| Action items (linked to products) | 3 | 5 | 5 | 5 |
| Monitoring frequency | Monthly | Weekly | Daily | Daily |
| AI models | 2 | 2 | 3+ | 3+ |
| Trend graph | — | ✓ | ✓ | ✓ |
| Competitor AI Readiness comparison | — | 3 comps | 5 comps | 10 comps |
| Citation source depth | — | Domain-level | Full \+ types | Full \+ types |
| Gap analysis | — | — | ✓ | ✓ |
| Multi-model split view | — | — | ✓ | ✓ |
| Competitor heatmap | — | — | ✓ | ✓ |
| llms.txt generation | — | ✓ | ✓ | ✓ |
| AI crawl readiness check (widget) | — | ✓ | ✓ | ✓ |
| GA4 AI traffic attribution | — | — | ✓ | ✓ |
| AI mention → review request trigger | — | — | ✓ | ✓ |
| API access | — | — | ✓ | ✓ |
| Custom prompts | — | — | 10 | 25 |
| Monitored brands | 1 | 1 | 1 | 10 |
| On-demand report generation | — | Unlimited | Unlimited | Unlimited |
| Scheduled automated reports | — | — | — | ✓ |
| White-label branding | — | — | — | ✓ |
| Agency client roster management | — | — | — | ✓ |
| Report email delivery to clients | — | — | — | ✓ |
| Looker Studio connector | — | — | — | ✓ |
| AI Readiness badge on QRsynch | — | ✓ (60+) | ✓ (60+) | ✓ (60+) |

---

## 13\. Deploy Sequence

```
Phase 0 Deploy (Pre-Work — do this first):
1. Open aiVisibilityProvider.js and apply changes 0A through 0E:
   - 0A: Export queryGeminiGrounded, queryPerplexity, _buildCitationCollector,
         _buildCitationIntelligence, _buildGapAnalysis, _classifyDomain, _classifyUrlType
   - 0B: Add _INTERNAL_GROUNDING_DOMAINS array, add exclusion check in _buildCitationCollector
   - 0D: Add modelOverride parameter to queryGeminiGrounded signature + model line
   - 0E: Add Math.min(100, ...) cap on citationRatePct and citationRate in _buildCitationIntelligence
2. Append AIsynch indexes to firestore.indexes.json (10 new composite indexes)
3. Deploy indexes first (takes 2-5 min to build):
   firebase deploy --only firestore:indexes --project pathsynch-pitch-creation
4. Run existing test suite to confirm no regression:
   cd functions && npx jest --no-coverage
5. Deploy functions:
   firebase deploy --only functions --project pathsynch-pitch-creation
6. Verify: generate a Market Intel report and confirm vertexaisearch.cloud.google.com
   no longer appears in Citation Sources and citationRatePct values are ≤ 100

Phase 1A Deploy:
1. Run Stripe setup script (one-time): node functions/scripts/setupAisynchStripeProducts.js
2. Record price IDs in functions/.env
3. Add TURNSTILE_SECRET_KEY to functions/.env
4. Deploy Cloud Functions:
   firebase deploy --only functions --project pathsynch-pitch-creation
5. Test free scan endpoint:
   curl -X POST https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aiReadinessScan \
     -H "Content-Type: application/json" \
     -d '{"businessName":"Robyn'\''s Fabrics","city":"Charlotte","state":"NC","turnstileToken":"test"}'
   (Note: Turnstile test tokens only work in dev mode)
6. Verify aiReadinessScans collection populated in Firestore
7. Build PathManager dashboard card (separate Claude Code session on EC2 backend)

Phase 1B Deploy:
8. Set ENABLE_AISYNCH_MONITORING=true in functions/.env
9. Deploy functions again
10. Verify aiVisibilityMonitorCron in Cloud Scheduler:
    https://console.cloud.google.com/cloudscheduler?project=pathsynch-pitch-creation
11. Create test AIsynch subscription in Firestore (manual)
12. Force-run the cron from Cloud Scheduler console
13. Verify snapshot in aiVisibilitySnapshots collection
14. Build trend graph in PathManager (separate Claude Code session)

Phase 3 Deploy (Agency Reporting):
15. Build report PDF/HTML template with brand override support
16. Deploy scheduledReportCron function
17. Verify scheduledReportCron appears in Cloud Scheduler (runs at 6 AM ET daily)
18. Create test agencyBrandOverrides document for King Digital Services
19. Create test scheduledReports document for Brilliant Smiles
20. Force-run the scheduled report cron from Cloud Scheduler console
21. Verify generatedReports document created with PDF URL
22. Verify email delivery (check Brian's ccEmails receives the report)
23. Build agency brand override configuration UI in PathManager settings
```

