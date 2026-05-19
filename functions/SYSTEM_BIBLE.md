## Prospect Enrichment Pipeline (Sprint 3+4 — March 26, 2026)

### New Files

**functions/agents/prospectResearchAgent.js** (560 lines)
Vertex AI Deep Search pattern. 5 tools: google_places_lookup,
competitor_scan, website_scrape, news_search, gbp_completeness_check.
Model: gemini-2.0-flash via agentRunner.js. Returns PROSPECT_INTELLIGENCE JSON:
businessProfile, competitivePosition, ownerIntelligence, gbpScore, pitchHooks,
recommendedProduct, urgencySignal.

**functions/services/pitchEnricher.js** (225 lines)
Promise.allSettled parallel runner. 3 sources:
prospectResearchAgent, newsIntelligenceAgent, vertexSearch.
8s timeout per source. Graceful degradation — never blocks pitch generation.
Builds PROSPECT_INTELLIGENCE prompt block for AI synthesis.

**functions/services/vertexSearch.js** (127 lines)
Discovery Engine API client.
Data store: synchintro-knowledge-base_1774560525810
Project: pathconnect-442522, Location: global
Auth via GOOGLE_APPLICATION_CREDENTIALS service account.
Methods: searchKnowledgeBase(query, options), groundedSearch(query, context)
Graceful degradation: logs warning and returns [] on failure.

### Modified Files

**functions/api/pitchGenerator.js**
- Now calls pitchEnricher.enrichProspect() before Claude synthesis
- Places enrichment + deep enrichment run in parallel via Promise.allSettled
- Injects PROSPECT_INTELLIGENCE block into generateLibraryEnhancedContent() prompt
- Stores enrichmentSources and researchCreditsUsed on pitch Firestore document
- pitchMetadata.enrichment: { sourcesUsed, creditsUsed, elapsed, enrichedAt }

### New Environment Variables

```
GOOGLE_SEARCH_API_KEY=<SynchIntro News Search key, restricted to 3.88.108.6>
GOOGLE_SEARCH_CX=c0887a1e024af4f45
VERTEX_SEARCH_DATA_STORE_ID=projects/pathconnect-442522/locations/global/collections/default_collection/dataStores/synchintro-knowledge-base_1774560525810
```

### Research Credit Costs

| Source | Credits |
|--------|---------|
| prospect_research | 50 |
| news_intel | 25 |
| kb_search | 10 |
| standard pitch (no enrichment) | 0 |

### Vertex AI Knowledge Base (GCS)

Bucket: gs://synchintro-kb-docs (us-central1, Standard)
9 documents: PRODUCT_BIBLE.md, SYSTEM_BIBLE.md, SynchIntro_Sales_Reference.md,
SynchIntro_Strategy_March2026_v2.docx, PathSynch_Unified_Snippet_Strategy.docx,
PathSynch_Sales_Library_Blueprint.md, PathConnect_CratesATL_POC.pptx,
PathSynch_x_KEM_Health pitch PDF, Pre-Call_Brief_North_Point PDF
Sync: Periodic (every day)
App: SynchIntro Knowledge Base (gen-app-builder)

### Graceful Degradation Rules

1. Missing GOOGLE_SEARCH_API_KEY → skip news_search, log warning
2. Missing VERTEX_SEARCH_DATA_STORE_ID → skip kb_search, log warning
3. Google Places failure → return null, pitch generates without enrichment
4. Any source >8s → timeout, use whatever completed
5. Never block pitch generation due to enrichment failure

### Bug Fix: Visitor Intel plan gate

- `visitors.js` render(): tier check used `user?.tier || user?.plan` — missed subscription object
- Scale plan users saw upgrade prompt because tier resolved incorrectly
- Fix: comprehensive tier extraction + explicit allowlist `['starter','growth','scale','enterprise']`

---

## Version History — March 23, 2026

### Sprint 2 — Pitch Pipeline & Kanban (March 23)

**Task 2.1 — Pitch Status Data Model**
- New pitch status field: `Draft | Sent | Viewed | Replied`
- `pitchGenerator.js`: status set to `'Draft'` on creation (was `'ready'`)
- `PATCH /pitches/:pitchId/status` endpoint with auth + ownership check
- Migration script: `functions/scripts/migrate-pitch-status.js`
- Frontend: `API.updatePitchStatus()` calls backend PATCH route

**Task 2.2 — Kanban Board**
- My Pitches page converted from grid/list → 4-column Kanban board
- HTML5 drag-and-drop: cards move between columns, calls PATCH endpoint
- Optimistic UI with rollback on error
- Cards: prospect name, level badge (L1-L4 color coded), date, Sales Library dot
- `normalizeStatus()` maps legacy values (ready, draft, won, lost) → new statuses

**Task 2.3 — Metrics Strip**
- 4 metric cards above Kanban: Total Pitches, Sent This Week, View Rate %, Reply Rate %
- Computed client-side from pitch data on each render

**Task 2.4 — Dashboard Retired**
- Home nav item removed from sidebar
- `#dashboard` → `#pitches` (any unknown route falls to pitches)
- My Pitches is now the default landing page
- `dashboard.js` commented out (script tag + code body), preserved for reference
- Onboarding post-login redirect changed to `#pitches`

### Nav Restructure (Updated)

| Nav Item       | Type       | Route(s)                              |
|----------------|------------|---------------------------------------|
| My Pitches     | flat       | #pitches (default landing page)       |
| Pitch Studio   | group      | —                                     |
|   Create Pitch | child      | #create                               |
|   One-Pagers   | child      | #onepagers                            |
|   Investor Updates | child  | #investorupdates                      |
| Intel          | group      | —                                     |
|   Market Intel | child      | #market                               |
|   Visitor Intel| child      | #visitors                             |
|   Pre-Call Forms| child     | #precallforms                         |
| Analytics      | flat       | #analytics                            |
| Sales Library  | flat       | #library                              |
| Settings       | flat       | #settings                             |

### Bugs Fixed — March 23

**Pre-Call Forms blank page**
File: js/pages/precallforms.js
- Tier detection used `user?.tier` only — missed `subscription.plan` / `subscription.tier`
- Paid users saw upgrade prompt because tier resolved to empty string
- Fix: use comprehensive tier extraction matching api.js:538 pattern

**Visitor Intel server error**
Files: js/pages/visitors.js, functions/routes/visitorRoutes.js
- Backend queries on `websiteVisitors` needed composite indexes not in firestore.indexes.json
- getUserTierAndCheckLimit: `where(userId) + where(firstSeenAt >=)` — no index
- GET /visitors: `where(userId) + orderBy(lastSeenAt, desc)` — no index
- Fix: index-resilient fallback (query without orderBy/filter, sort+filter in JS)
- Fix: frontend checks tier before API calls — free users skip backend entirely

---

## Version History — March 19, 2026

### L4 Product One-Pager — Now Functional
Previously: pitchLevel === 4 fell through to default case → generated Level 3
enterprise deck. No case 4 existed anywhere in the codebase.

Now: Full L4 flow operational.
- generateLevel4() added to pitchGenerator.js
- Delegates to generateLevel2() (one-pager output) with Sales Library context
- generateLibraryEnhancedContent() uses one-pager AI prompt for level 4
- Both generatePitch() and generatePitchDirect() switches updated
- Empty Sales Library throws user-facing error before AI call

### Sales Library Integration Notes
- salesLibraryContext fetched upstream in generatePitch() before the level switch
- options.salesLibraryContext and options.libraryEnhancedContent available to all generators
- Firestore: salesDocuments collection, customerLibraryConfig for per-user settings
- fetchSalesLibraryContext() has two implementations — stricter version is active

### First Paying Pilot: Countifi (David Hailey)
UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2
L4 generation confirmed broken during live session March 19, fixed and deployed same day.

---

## Version History — April 19, 2026 (Visitor Intel Sprints 1–6)

### New Firestore Collections

| Collection | Key Fields | Purpose |
|------------|-----------|---------|
| `merchantConfig/{merchantId}` | urlMappings[], thresholds{}, learningModeActive, entity360MerchantId, calibration{} | Per-merchant scoring configuration and URL heuristic mappings |
| `websiteVisitors/{merchantId}/sessions/{sessionId}` | visitorId, domain, companyName, score, pages[], duration, identityConfidence, firstSeenAt, lastSeenAt | Raw ps-core.js session data with per-session intent scores |
| `visitorIntelSummary/{merchantId}/accounts/{accountKey}` | domain, companyName, score, status, whyNow, recommendedAction, lastActivity, identifiedContacts[], sessionCount | Dashboard display layer — pre-aggregated account view |
| `Account360/{accountKey}` | domain, companyName{provenance}, identity{confidence,tier,source,identifiedContacts[]}, intentSignals{currentScore,status,scoreExplanation,highIntentPages[],lastActivity,signalQualityGates}, outboundState{pitchGenerated,briefGenerated,attioId,sequenceTriggered,lastOutboundAt}, recommendedNextAction, workspaceId | Prospect intelligence workspace (SynchIntro outbound lane) — uses full provenance schema on all fields |
| `Account360/{accountKey}/signalHistory/{eventId}` | eventType, domain, companyName, score, status, sessionData, createdAt | Immutable event history — NEVER delete; append-only |
| `Account360/{accountKey}/agentViews/outbound_view` | All Account360 fields, expiresAt (4hr TTL) | Scoped view for outbound AI agents — pitch generator, pre-call brief |
| `Account360/{accountKey}/agentViews/core_view` | All Account360 fields, expiresAt (24hr TTL) | Scoped view for core intelligence reads |
| `notifications/{userId}/alerts/{alertId}` | accountKey, domain, companyName, alertType, intentScore, status (unread/read/actioned/dismissed), recommendedAction, createdAt, actionedAt | Threshold-triggered alerts for sales reps |
| `pubSubThresholdLog/{merchantId}` | accountKey, previousStatus, newStatus, score, triggeredAt, alertCreated | Pub/Sub threshold event log — audit trail for processThresholdAlerts |

**Critical schema rules:**
- `Account360` is the SynchIntro outbound lane — NEVER conflate with `merchant360` (PathManager lane)
- All `Account360` intelligence fields use provenance schema: `{ value, confidence, source, sourceTier, humanConfirmed, updatedAt }`
- ConflictEngine resolution order: humanConfirmed → sourceTier → confidence → recency (updatedAt)
- `accountKey` = `${merchantId}:${domain}` — globally unique per merchant + company
- `signalHistory` is append-only — no deletes, no updates to existing entries
- `agentViews` TTLs enforced by app logic (check `expiresAt` before reading); no Firestore TTL policy needed

### Firebase Hosting Files (Visitor Intel)

| Path | Purpose |
|------|---------|
| `public/ps-core.js` | Unified tracking script — served from Firebase Hosting CDN (no cold-start) |
| `public/modules/identityResolver.js` | IPinfo.io lookup + fingerprint generation |
| `public/modules/sessionTracker.js` | Session state, bounce/depth detection |
| `public/modules/intentScorer.js` | URL-to-score mapping using merchantConfig heuristics |
| `public/modules/eventEmitter.js` | Batches + sends events to ingest endpoint |
| `public/modules/configLoader.js` | Fetches and caches `config/{merchantId}.json` |
| `public/config/{merchantId}.json` | Per-merchant scoring config snapshot — generated by `generateMerchantConfig.js` on every `POST /merchant-config` |

**Snippet installation (merchant sites):**
```html
<script src="https://pathsynch-pitch-creation.web.app/ps-core.js?mid=MERCHANT_ID" async></script>
```

---

## Repo Structure Notes (May 15, 2026)

### Changelog Location
- **New changelogs go in `changelogs/CHANGELOG_2026-MM-DD.md`** — not the repo root
- Root `CHANGELOG.md` is the summary log; dated files are in `changelogs/`
- 18 dated files were moved to `changelogs/` on May 15, 2026 (commit `19ce781`)

### SYSTEM_BIBLE.md Canonical Location
- **`functions/SYSTEM_BIBLE.md` is the canonical copy** — all Claude Code work happens in `functions/`
- Root `SYSTEM_BIBLE.md` is a single-line pointer only (commit `768d586`)
- Do not edit the root copy

### index.js Size Tracking
- May 15, 2026: **4,138 lines** (down from 4,786 after removing 648 lines of dead code)
- Decomposition plan: `docs/INDEX_JS_DECOMPOSITION_PLAN.md`
- Replacement modules confirmed mounted: `userRoutes` (line 598), `teamRoutes` (line 601), `analyticsRoutes` (line 626)

---

## No-GBP Detection & LocalSynch Upsell (May 18, 2026)

### Tri-State GBP Model

`gbpStatus: 'found' | 'not_found' | 'unknown'` flows from enrichment through prompt to render.

| State | Meaning | Banner? | Sections stripped? |
|-------|---------|---------|-------------------|
| `found` | DataForSEO returned data | No | No |
| `not_found` | DataForSEO ran, nothing returned | **Yes** | Yes (complaint/love) |
| `unknown` | Source not run (timeout / credit-gate) | **Never** | Yes (silent) |

**Critical rule:** `'unknown'` must NEVER trigger the banner. A timeout or credit-gated path must never tell the prospect they have no GBP — we simply don't know.

### Pipeline Files

| File | Role |
|------|------|
| `functions/services/templateEnrichment.js` | Sets `gbpStatus`, `reviewDataStatus`, `hasReviewData` on enrichmentMeta |
| `functions/services/templateSectionResolver.js` | Hard-skips complaintPatterns + customerLove when no review evidence |
| `functions/services/templatePromptBuilder.js` | Injects `CRITICAL — NO REVIEW DATA AVAILABLE` guard into Gemini prompts |
| `functions/services/templates/brewhouseResponseSchema.js` | Allows empty arrays for `complaintPatterns` and `lovePoints` |
| `functions/api/pitch/templateOnePager.js` | `renderNoGBPBanner()` + Step 3c outcome cards override |
| `synchintro-app/js/l2OnePagerRenderer.js` | `_noGBPBanner()` client-side render |
| `synchintro-app/css/app.css` | `.op-no-gbp-*` amber banner CSS + dark mode variants |

### LocalSynch Upsell Defaults

| Plan | Price | Setup |
|------|-------|-------|
| LocalSynch — Local Growth | $199/mo | $299 one-time |
| LocalSynch — Local Authority | $329/mo | $599 one-time |

Seller products override defaults when product name contains "local growth" or "local authority" (case-insensitive).

---

## Repo Hygiene (May 18, 2026)

### Test Suite Baseline
- **574 tests passing, 0 failing** as of commit `0861e39` (May 18, 2026)
- Previous baseline: 561 passed, 19 failed

### Personnel
- **Williams (`dev1@pathsynch.com`)** is solutions architect — reviews `pathsynch-pitch-generator` PRs
- Replaced Fayzan (previous solutions architect)

### Outstanding Known Issues (May 18)

| Issue | Owner |
|-------|-------|
| DataForSEO 404 on `/business_data/google/reviews/live/advanced` | Williams |
| Census API returning `missing_key.html` — CENSUS_API_KEY invalid | Williams |
| Missing Firestore composite index: `marketReports` `location.city + userId + createdAt` | Williams |
| Safety geocoding fallback needs log verification (`city`/`state` at call site) | Pending |
| `html2pdf.js` high XSS vulnerability — upgrade to 0.14.0 needs PDF export regression test | Pending |
| Tighten `pitchAnalytics` Firestore rules (currently any auth'd user can read) | Pending |
| Tighten `icpProfiles` rules (any auth'd user can overwrite defaults) | Pending |
| Wire `SENDGRID_API_KEY` so team invite emails send | Pending |

---

## Date Extraction — "New" Badge Bug (May 19, 2026)

`dateLabelPattern` in `templateOnePager.js` Step 3f must NOT include `New`.

Google's pasted review text format renders "New" as a standalone UI badge on its own line. Including it in the pattern inflated date label counts (~90 real timestamps → 203 matched). This caused 90-day review velocity targets and CTA copy to be roughly 2× too high.

**Canonical pattern:**
```javascript
/^(\d+\s+(?:hours?|days?|weeks?|months?)\s+ago|a\s+(?:day|week|month|year)\s+ago|an?\s+hour\s+ago|yesterday)$/i
```

**Rule:** Never add UI-only strings (badge labels, section headers, navigation text) to this pattern. Only real relative-time timestamp formats belong here.

---

## executiveBriefRenderer.js — Parity Rules (May 19, 2026)

`executiveBriefRenderer.js` is the render path for `l2Style: 'executive_brief'`. It **bypasses** `renderStatCards()` and `renderOnePagerHtml()` in `templateOnePager.js`. Any fix landed in those functions must be evaluated for porting here.

**Current parity fixes applied:**

| Feature | templateOnePager.js location | executiveBriefRenderer.js location |
|---------|------------------------------|-------------------------------------|
| Response rate "%" suffix | `renderStatCards()` | `renderStatStrip()` lines ~280 |
| Methodology footnote | `renderOnePagerHtml()` | `renderSolution()` after product pills |

**Rule:** When fixing a stat card display issue or adding a footnote/annotation to the solution section in `templateOnePager.js`, check whether the same fix is needed in `executiveBriefRenderer.js`.

---

## Citation Source Intelligence — Architecture (May 19, 2026)

**Where it lives:** `citationIntelligence` is a sub-object of `aiVisibilityIntelligence` on the Firestore `marketReports/{id}` document. It is NOT a sibling field — it is nested: `report.aiVisibilityIntelligence.citationIntelligence`.

**Access pattern:**
- Backend: `getCitationIntelligence(report)` resolver in `reportFieldResolver.js`
- Frontend: `_mktGetAiVisibilityIntelligence(r)?.citationIntelligence`

**Data flow:**
1. `aiVisibilityProvider.js` — `queryGeminiGrounded()` and `queryPerplexity()` each extract `citationUrls[]` from their respective APIs
2. `enrichAiVisibility()` calls `_buildCitationCollector()` after all queries complete → attaches `avi.citationIntelligence`
3. `market.js` — `aiVisibilityIntelligence` written top-level to Firestore document (not under `data`)
4. `marketIntelPitchContext.js` block 11 — reads `report.aiVisibilityIntelligence.citationIntelligence` → distills into `context.citationInsight`
5. `pitchCompanionMd.js` — renders `mic.citationInsight` into "AI Citation Sources" Markdown section

**Domain type classification (6 types):** Institutional / UGC / Reference / Editorial / Corporate / Other

**Gap analysis scope:** Only UGC, Reference, and Editorial domains surface as actionable gaps. Institutional/Corporate/Other are excluded.

**Payload caps:** 25 top domains, 50 top URLs, 15 gap entries — enforced in `_buildCitationIntelligence()` before Firestore write.

---

## Visibility Enrichment — Phase Timeouts (May 19, 2026)

Set in `visibilityEnrichmentService.js`. Do not raise without reason — these protect report generation latency.

| Phase | Timeout |
|-------|---------|
| 1A Map Pack | 30s |
| 1B Ad Spend | 30s |
| 2 Website Signals (parallel PSI calls) | 35s |
| 3 AI Visibility (Gemini + Perplexity) | 25s |

## AI Visibility Roadmap — Planned (Not Built)

- **Daily tracking cron:** Persist AI visibility snapshots daily → PathManager merchant dashboard card (next priority)
- **Multi-model split:** Attribute Gemini and Perplexity results separately instead of merging
- **Trend lines:** Requires daily cron first
- **Claude via AWS Bedrock:** Third AI model (free AWS credits available)
