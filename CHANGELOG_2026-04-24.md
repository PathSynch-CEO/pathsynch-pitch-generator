# Changelog — April 24, 2026

## Prospect Intel — M1-1 through M1-3

### Frontend (synchintro-app)

#### New Feature: Prospect Intel Page (js/pages/prospectIntel.js)

Complete implementation across M1-1 (Empty State + CSV Parser), M1-2 (Column Mapping + API), M1-3 (Table View + Interactions).

**M1-1 — Foundation**
- Empty state: page header, ICP selector dropdown, Product Focus multi-select panel, chat input bar, drag-drop CSV upload zone with 7 source badges, Market Intel cards section with Location + Vertical filter dropdowns, suggestion cards
- CSV parser: 7-format auto-detection (Instantly, Apollo.io, Lemlist, Smartlead, Salesforge, Skylead, Generic) via FORMAT_SIGNATURES
- 9 FIELD_TARGETS: companyName (required), contactEmail, contactFirstName, contactLastName, contactTitle, companyDomain, contactLinkedIn, city, state
- DEFAULT_ICP_PROFILES: 5 built-in profiles seeded to Firestore on first load
- Styles: ~800 lines of .pi-* CSS with full dark mode support

**M1-2 — Column Mapping + API**
- 5-row preview table with auto-mapped dropdowns and live sample values
- "Exclude rows with no email address" checkbox (checked by default)
- Live row count note via _updateRowCount()
- _confirmMapping() flow: filter rows, POST to /prospect-intel/batch, immediately render table view, set up Firestore onSnapshot listener
- _listenToBatch(): onSnapshot on batch doc, logs progress, calls render() on completion

**M1-3 — Table View**
- Stats bar: total, enriched, Strong Fit, failed
- Filter tabs: All | Needs Review | Needs Fix | Approved | Sent | DQ
- Search: 300ms debounce on companyName + contactEmail + city
- Sort: Fit Score desc/asc, Company A-Z/Z-A
- Prospect rows with checkboxes, Fit Score badge (color-coded), workflow badge, kebab menu
- Expanded row: Business Details / Top Services / Buying Signals / Actions
- Floating action bar when >=1 row selected: Export, Approve, Archive
- Workflow status cycle: needs_review -> approved -> sent -> archived

#### New API Methods (js/api.js)

| Method | Endpoint |
|--------|----------|
| getProspectBatch(batchId) | GET /prospect-intel/batch/:batchId |
| getProspectBatchProspects(batchId, opts) | GET /prospect-intel/batch/:batchId/prospects |
| retryProspect(batchId, prospectId) | POST /prospect-intel/batch/:batchId/prospects/:prospectId/retry |
| rescoreProspects(batchId) | POST /prospect-intel/batch/:batchId/rescore |

#### Navigation

- Route prospect-intel added to router.js
- Nav item added to Intel group in index.html
- Page container: <div id="page-prospect-intel" class="page">

#### Bug Fixes

**BUG-1: Table not showing after enrichment + blank state on page refresh**

File: js/pages/prospectIntel.js

Root cause A: _confirmMapping() called _listenToBatch() but never called render(). The listener only fired render() on status === "completed", so the UI was permanently stuck on the mapping screen until the full batch finished.
Fix: Call _renderTableView(container) immediately after setting currentBatchId, before wiring the listener.

Root cause B: On page refresh, loadData() populated recentBatches from Firestore but never set currentBatchId. render() always saw null and showed the empty state.
Fix: After loading recentBatches, find the first batch with status === "completed" | "in_progress" | "processing" and set currentBatchId.

**BUG-2: Market Intel dropdowns show [object Object]**

File: js/pages/prospectIntel.js

Root cause: r.location stored as { city, state, zipCode, coordinates, geoLevel } and r.industry stored as { display, subIndustry, naicsCode, naicsTitle, ... } -- not strings. Dropdown option values and filter equality checks used raw objects.

Fix: Added helpers _locationStr(loc) (returns "city, state") and _industryStr(ind) (returns ind.display || ind.name || ind.label || ind.naicsTitle). Applied to:
- _buildMarketIntelFiltersHTML(): dropdown option values and display text
- _buildMarketIntelCardsHTML(): filter equality check and card rendering
Note: ind.display is the actual backend field name (set in market.js line 741).

**BUG-3: "Exclude rows with no email" not checked by default**

File: js/pages/prospectIntel.js

Fix: Added checked attribute to <input type="checkbox" id="pi-exclude-no-email">.
Also: _renderColumnMappingScreen() now pre-computes initial filtered row count using detected email column mapping, so the row count note reflects the checked state from the moment the mapping screen renders.

---

### Backend (pathsynch-pitch-generator/functions)

#### New File: functions/services/prospectIntelService.js

Complete enrichment pipeline service. Key exports:

**calculateFitScore(agentData, csvData, icpProfile):**
7 buying signals: low_rating (25), low_reviews (20), incomplete_gbp (15), outdated_website (15), no_review_response (15), owner_title (10), industry_match (10). Disqualification checks run first: high_rating (>=4.8 + >=500 reviews), too_large (>200 reviews), franchise_corp (name pattern). Labels: Strong Fit >=70, Good Fit >=50, Moderate Fit >=30, Low Fit <30.

**classifyRecommendedProduct(agentData, productFocus):** Routes to PathConnect + PathManager (rating/review gap), LocalSynch (no GBP/website), ReferralSynch (strong reputation), Full Suite (default). productFocus override skips auto-classification.

**buildSourceAttribution(value, source, confidence):** Returns { value, source, confidence, updatedAt, failureReason: null }.

**callResearchAgent(businessName, city, state):** POST to PROSPECT_AGENT_URL/api/research with 30s timeout.

**processOneProspect(batchId, prospectId):** Full pipeline -- read Firestore prospect doc, guard on enrichmentStatus !== "pending", mark in_progress, load ICP snapshot, call research agent, apply Google Places fallback, calculate Fit Score, classify product, build enriched payload, write to Firestore, increment batch progress counter.

**deductProspectCredits(userId, count, batchId):** Firestore batch write -- decrement users/{uid}.credits by count * 15, write creditLedger/{prospect:batchId} with idempotency guard.

**enqueueProspectTask(batchId, prospectId):** Cloud Tasks REST API enqueue via GCP OAuth2 token. Queue: prospect-enrichment in pathconnect-442522/us-central1. Task includes X-Task-Secret header.

#### New File: functions/routes/prospectIntelRoutes.js

6 endpoints:

| Method | Path | Notes |
|--------|------|-------|
| POST | /prospect-intel/batch | Creates batch doc, maps CSV rows to prospect subdocs (Firestore batch write in chunks of 500), deducts credits, returns { success, batchId, totalProspects } |
| GET | /prospect-intel/batch/:batchId | Returns batch metadata + progress counters |
| GET | /prospect-intel/batch/:batchId/prospects | Paginated prospect list from subcollection. Query params: limit (default 200), status filter |
| POST | /prospect-intel/batch/:batchId/prospects/:prospectId/retry | Resets enrichmentStatus to "pending", re-enqueues task |
| POST | /prospect-intel/batch/:batchId/rescore | Re-runs calculateFitScore on all enriched prospects (no agent call); batch update to Firestore |
| GET | /prospect-intel/icp-profiles | Lists icpProfiles collection |

#### Modified File: functions/services/googlePlaces.js

New export: lookupProspectPlace(businessName, city, state)
- textSearch query: businessName + city + state
- Returns: { success, placeId, rating, totalReviews, websiteUrl, phone, address }
- Two API calls: textSearch (rating + placeId) + getPlaceDetails (website + phone)
- Used as fallback in processOneProspect() when agent returns null for googleRating or websiteUrl

#### Modified File: functions/services/prospectIntelService.js (Google Places fallback)

After callResearchAgent() returns:
- agentRatingMissing = agentResult.googleRating == null
- agentWebsiteMissing = !agentResult.websiteUrl || websiteUrl === "None" || websiteUrl === ""
- If either is true: call lookupProspectPlace(), patch missing fields onto agentResult
- ratingSource set to "google_places" when Places filled it (confidence: "medium")
- websiteSource set to "google_places" when Places filled it (confidence: "medium")
- Phone backfilled opportunistically if agent also missed it
- Full try/catch -- Places failure is non-blocking

#### Cloud Functions Registered (functions/index.js)

**onProspectBatchCreated** (Firestore onCreate trigger on prospectIntel/{batchId}):
- Reads all prospect subdocs from new batch
- Enqueues each via enqueueProspectTask() (max 5 concurrent)
- Updates batch status: "processing"

**processProspectTask** (HTTP 2nd Gen Cloud Function, Cloud Tasks handler):
- Validates X-Task-Secret header
- Parses base64 body: { batchId, prospectId }
- Calls processOneProspect(batchId, prospectId)
- Always returns HTTP 200 (Cloud Tasks retries on non-2xx -- enrichment failures written to Firestore)

---

### Infrastructure

- Cloud Tasks queue: prospect-enrichment (us-central1, pathconnect-442522)
  Create: gcloud tasks queues create prospect-enrichment --location=us-central1 --project=pathconnect-442522
- IAM: 796921234100-compute@developer.gserviceaccount.com requires roles/cloudtasks.enqueuer on pathconnect-442522
- Firestore rules deployed:
  - prospectIntel/{batchId}: read if owner, write: false (Admin SDK only)
  - prospectIntel/{batchId}/prospects/{prospectId}: read if authenticated, write: false
  - icpProfiles/{profileId}: read if authenticated, write: false
  - creditLedger/{docId}: read/write: false (Admin SDK only)
- New env vars: PROSPECT_AGENT_URL, PROSPECT_TASK_HANDLER_URL, PROSPECT_TASK_SECRET

### Live Validation

Batch ecz6yeXafZecjaM7Lr9E: 162 prospects, 133 enriched (82%), 29 failed, 119 Strong Fit
Vertical: Medical practices, Location: Atlanta, GA. Status: completed in Firestore.
