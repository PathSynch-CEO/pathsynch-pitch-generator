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
