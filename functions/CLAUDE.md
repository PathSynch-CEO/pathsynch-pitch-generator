## Session — April 22, 2026

**Deployed to production (functions). Pricing calculation fixes, landing page intelligence improvements.**

### Investment Pricing — Server-Side Calculation Fix

**File: `functions/api/pitchGenerator.js`**

The server-side pricing calculator now handles all pricing structures correctly:

| Structure | Monthly Total | Setup Total | Line Item |
|-----------|--------------|-------------|-----------|
| `monthly` / `tiered` | + `monthlyPrice` | + `setupFee` | `$X/mo` |
| `one_time` | — | + `oneTimeFee` | `$X one-time` |
| `per_unit` | + `perUnitPrice` | — | `$X/label` |
| `quarterly` | — | — | `$X/quarter` (noted only) |
| `custom` | + `perUnitPrice` + `monthlyPrice` | + `oneTimeFee` | all components joined with ` + ` |
| `included_in_plan` | — | — | `included` |

**Key fix**: `custom` was previously lumped with `included_in_plan` in a catch-all `else` branch that added $0 to everything. Now:
- `oneTimeFee > 0` → adds to setup total
- `perUnitPrice > 0` → adds to monthly total
- `monthlyPrice > 0` → adds to monthly total

Example: PathConnect Starter ($149/mo) + LocalSynch Growth (custom: $199/mo + $299 one-time) + NFC Card (one-time: $39) = **$348/mo + $338 one-time**.

### Landing Page — Complaint Theme Override

**File: `functions/routes/landingPageRoutes.js`**

**`extractPitchIntelligence()` — 6 field paths** now checked for complaint themes (was 3):
1. `pitchData.reviewAnalysis.complaintThemes`
2. `pitchData.reviewPitchMetrics.complaintPatterns`
3. `pitchData.marketData.complaintThemes`
4. `pitchData.pitchMetadata.reviewAnalysis.complaintThemes` *(new)*
5. `pitchData.pitchMetadata.complaintThemes` *(new)*
6. `pitchData.complaintThemes` *(new — top-level future path)*

**Post-AI override (generate handler):**
After AI call resolves (success or fallback), if `intel.complaintThemes.length > 0`, `pageContent.painPoints` is unconditionally replaced with real complaint themes. AI cannot generate generic pain points when real data exists.

**Diagnostic logging added:**
- Pitch top-level keys logged on every generation
- Complaint themes count + values logged
- Override status logged (`Overrode AI pain points with real complaint themes: ...` or `No complaint themes — AI pain points kept as-is`)

### Previously Deployed (April 22 context)

Also deployed during this session (these changes were made but tracked in synchintro-app CLAUDE.md):
- `functions/routes/landingPageRoutes.js` — `buildLandingPagePrompt` pitch HTML field fix (`pitchData.html` not `pitchData.content`), em dash ban in prompt
- `functions/api/export.js` — `pitchData.html` fallback for export content
- `functions/services/templateSectionResolver.js` — `pricing_block` null fallback fix, server-calculated totals override
- `functions/services/templatePromptBuilder.js` — seller product catalog in AI prompt
- `functions/services/templates/brewhouseResponseSchema.js` — `solutionPackage` field added to schema and `required` array

### Custom Pricing `setupFee` + `oneTimeFee` Fix

**File: `functions/api/pitchGenerator.js`**
- `custom` branch now computes `fixedFee = setup + oneTime` (was only `oneTime`)
- Products using `setupFee` field (SynchMate, Managed SynchMate Concierge) now correctly added to setup total
- Line item label also updated to use combined `fixedFee`
- Investment math: PathConnect Starter $149/mo + LocalSynch Growth $199/mo = **$348/mo**; LocalSynch $299 one-time + NFC Card $39 = **$338 one-time**

### Pending / Known Issues

- Firestore product persistence: `updateSellerProfile` writes succeed (SDK-local) but server-side verification sometimes shows 0 products. `{ source: 'server' }` read added to frontend for diagnosis. Root cause under investigation (possibly security rules blocking server write while local IndexedDB cache shows success).
- Landing page: complaint themes only present on pitches generated with market intel enrichment or smart card 2. Classic-mode pitches have no structured complaint data — AI must extract from `cleanContent` HTML.

---

## Session — April 19, 2026

### Sprint 6 — Attio Push + Instantly Sequence Trigger from Visitor Intel Workspace

**New files:**
- `functions/routes/attioRoutes.js` — `POST /attio/push-account` endpoint
  - Reads Account360 doc + outbound_view (prefers fresh view, falls back to doc)
  - Maps to attioClient lead shape: `{ name: companyName.value, website: https://${domain}, decisionMaker: contact, email: contact.email, intelSignal }`
  - On success: updates `outboundState.attioId` + `lastOutboundAt`, writes CRM_PUSH signalHistory entry
  - Fire-and-forget: `_actionMatchingAlerts()` + `_fireEntity360CrmPush()` (never block response)
  - Returns `{ success: false, error }` on Attio API failure — NEVER throws 500

**Modified files:**

**`functions/routes/instantlyRoutes.js`**
- Added `GET /instantly/vi-campaigns` — uses global `instantlyClient` (INSTANTLY_API_KEY)
  NOT the per-user `instantlyService`. Path is `/instantly/vi-campaigns` (not `/instantly/campaigns`) to avoid collision
- Added `POST /instantly/trigger-sequence` — reads Account360 + outbound_view
  - Returns error if no identified contact email
  - Visitor Intel custom vars: custom_1=status, custom_2=whyNow, custom_3=topIntentPage, custom_4=score, custom_5=recommendedAction
  - Uses direct `fetch()` to Instantly V1 `/lead/add` (instantlyClient has no `addLeadToCampaign()`)
  - Updates `outboundState.sequenceTriggered = true`, writes SEQUENCE_TRIGGERED signalHistory entry

**`functions/routes/visitorSignalRoutes.js`**
- Added `GET /account360/:accountKey/history` — queries signalHistory where `eventType in ['CRM_PUSH', 'SEQUENCE_TRIGGERED']`
  - No `orderBy` to avoid composite index requirement; sorts in JS memory; returns top 5

**`functions/services/entity360Bridge.js`**
- Added `fireEvent` to `module.exports` (was defined but not exported)

**`functions/routes/index.js`**
- Imported + exported `attioRoutes`
- Added AVAILABLE_ENDPOINTS: `/account360/:accountKey/history`, `/attio/push-account`, `/instantly/vi-campaigns`, `/instantly/trigger-sequence`

**`functions/index.js`**
- Added `attioRoutes` to destructured import
- Added dispatch block: `if (path.startsWith('/attio')) { if (await attioRoutes.handle(req, res)) return; }`
- Placed BEFORE existing inline `/attio/push-lead` and `/attio/push-all` handlers

**Architecture notes:**
- Two Instantly integrations remain separate: per-user `instantlyService` (`/instantly/*`) vs global `instantlyClient` (`/instantly/vi-*`). Do NOT merge.
- `attioRoutes` router returns `false` for non-matching paths — existing inline handlers remain functional
- history endpoint avoids Firestore composite index by sorting in JS (query only uses `where`, no `orderBy`)
- `trigger-sequence` uses direct `fetch()` to Instantly V1 because visitor intel custom vars differ from market intel vars in `pushLeadToInstantly()`

**Commits:** functions 6abc862, hosting 3fbdcbf — deployed April 19, 2026

---

### Sprint 4 — Alert Engine + Analytics Integrations

**New files:**
- `functions/services/alertService.js` — threshold alert creation and management
  - Evaluates `hot`, `outreach_now`, `contact_identified` status changes against per-merchant thresholds
  - Creates alert docs in `notifications/{userId}/alerts/{alertId}` with `accountKey`, `domain`, `companyName`, `intentScore`, `status`, `recommendedAction`
  - Alert types: `HOT_ACCOUNT`, `CONTACT_IDENTIFIED`, `OUTREACH_NOW`
  - Deduplication: checks for existing unread/read alert on same accountKey before creating
- `functions/routes/alertRoutes.js` — 4 endpoints for alert CRUD
  - `GET /alerts` — returns `notifications/{userId}/alerts` ordered by createdAt desc, limit 50
  - `POST /alerts/:alertId/read` — marks alert `status: 'read'`
  - `POST /alerts/:alertId/action` — marks alert `status: 'actioned'`, sets `actionedAt`
  - `POST /alerts/:alertId/dismiss` — marks alert `status: 'dismissed'`

**Modified files:**
- `functions/routes/visitorSignalRoutes.js` — calls `alertService.evaluateAndCreateAlerts()` after Account360 upsert when status changes to hot/outreach_now/contact_identified
- `functions/index.js` — registered `alertRoutes` dispatch block; registered `processThresholdAlerts` scheduled function (every 6 hours)
- `functions/routes/index.js` — added alert endpoints to AVAILABLE_ENDPOINTS
- `functions/.env` — added `HUMBLYTICS_SITE_TOKEN`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`

**Infrastructure:**
- `processThresholdAlerts` scheduled Cloud Function — sweeps `visitorIntelSummary` for accounts that crossed thresholds since last run, creates alerts for any found. Runs every 6 hours.
- Humblytics + PostHog analytics tokens added to `.env` for frontend snippet injection

**Architecture notes:**
- Alert deduplication key: `accountKey + alertType`. One live (unread/read) alert per account per type at a time.
- `processThresholdAlerts` is a catch-all for accounts that might have been missed by the real-time path (e.g., ingest events processed out of order)

---

### Sprint 3 — ps-core.js Unified Tracking Script + Signal Ingest Pipeline

**New files:**
- `public/ps-core.js` — unified client-side tracking script deployed to Firebase Hosting
  - Loads per-merchant config from `public/config/{merchantId}.json`
  - Identifies visitors via IPinfo.io (IP-to-company), fingerprinting fallback
  - Scores page visits against URL heuristic mappings from merchantConfig
  - Sends scored sessions to `POST /visitor-signal/ingest` with full event payload
  - Handles session continuity, bounce detection, page depth tracking
- `public/modules/` — 5 extracted modules loaded by ps-core.js:
  - `identityResolver.js` — IPinfo.io lookup + fingerprint generation
  - `sessionTracker.js` — session state, bounce/depth detection
  - `intentScorer.js` — URL-to-score mapping using merchantConfig heuristics
  - `eventEmitter.js` — batches + sends events to ingest endpoint
  - `configLoader.js` — fetches and caches `config/{merchantId}.json`
- `functions/api/generateMerchantConfig.js` — generates `public/config/{merchantId}.json` from `merchantConfig/{merchantId}` Firestore doc; writes to Firebase Hosting storage bucket
- `functions/routes/visitorSignalRoutes.js` — full ingest pipeline:
  - `POST /visitor-signal/ingest` — receives scored session events from ps-core.js
  - Validates: `visitorId` required, `merchantId` required
  - Writes raw session to `websiteVisitors/{merchantId}/sessions/{sessionId}`
  - Calls `visitorSignalService.processSession()` for scoring + identity resolution
  - Writes display record to `visitorIntelSummary/{merchantId}/accounts/{accountKey}`
  - Triggers `alertService.evaluateAndCreateAlerts()` on status changes
  - `GET /visitor-accounts` — returns `visitorIntelSummary/{merchantId}/accounts` ordered by score desc, limit 100

**Architecture notes:**
- ps-core.js is served from Firebase Hosting (same CDN as app), NOT from Cloud Functions — zero cold-start latency for the snippet
- merchantConfig `learningModeActive: true` suppresses Entity360Bridge calls and alert creation during calibration period
- Config JSON is regenerated on `POST /merchant-config` saves via `generateMerchantConfig()`

---

### Sprint 2 — Intent Scoring Engine + Merchant Config

**New files:**
- `functions/services/visitorSignalService.js` — core scoring + identity resolution service
  - `processSession(sessionData, merchantConfig)` — assigns intent score, status, whyNow narrative
  - Status ladder: `learning` → `monitoring` → `warming` → `hot` → `outreach_now`
  - Score thresholds configurable per merchant in `merchantConfig.thresholds`
  - `identifyCompany(ipAddress, domain, fingerprint)` — IPinfo.io lookup, domain extraction, confidence scoring
  - ConflictEngine integration: never downgrades confidence on existing identity
  - Returns: `{ accountKey, score, status, whyNow, confidence, identifiedContact, recommendedAction }`
- `functions/services/calibrationService.js` — merchant calibration logic
  - `runCalibration(merchantId)` — analyzes last 30 days of sessions, computes baseline avg score, p75, p90
  - Writes calibration result to `merchantConfig/{merchantId}.calibration`
  - Sets `learningModeActive: false` after calibration completes
  - `GET /merchant-config/calibration-report` endpoint returns calibration stats
- `functions/services/urlHeuristics.js` — URL-to-intent-score mapping
  - `scoreUrl(url, urlMappings)` — matches URL patterns against merchantConfig mappings
  - Default heuristics: pricing (+40), demo/book (+35), contact (+25), product (+20), blog/news (-5)
  - Merchant-specific overrides stored in `merchantConfig.urlMappings[]`
- `functions/routes/merchantConfigRoutes.js` — merchant config CRUD
  - `GET /merchant-config` — returns current merchant config doc
  - `POST /merchant-config` — creates/updates config, triggers config JSON regeneration
  - `GET /merchant-config/top-pages` — top 10 pages by visit volume from sessions (last 30d)
  - `GET /merchant-config/calibration-report` — calibration stats
  - `POST /merchant-config/regenerate-snippet` — forces ps-core.js config JSON regeneration

**Architecture notes:**
- `merchantConfig/{merchantId}` is the source of truth for scoring config — ps-core.js reads a cached JSON copy
- Calibration runs automatically on first 100 sessions OR on manual trigger
- `accountKey` = `${merchantId}:${domain}` — globally unique per merchant+company

---

### Sprint 1 — Foundation: Plan Gate Fix + Confidence Schema

**New files:**
- `functions/services/visitorConfidence.js` — provenance schema helpers
  - `provenance(value, confidence, source, sourceTier)` — creates standardized `{ value, confidence, source, sourceTier, humanConfirmed, updatedAt }` block
  - `ConflictEngine.resolve(existing, incoming)` — 4-rule resolution: humanConfirmed → sourceTier → confidence → recency
  - `sanitizeProvenance(obj)` — strips undefined values before Firestore write
- `functions/api/backfillConfidenceFields.js` + scheduled Cloud Function `backfillConfidenceFields`
  - One-time backfill: adds provenance wrappers to existing `websiteVisitors` docs that predate the schema
  - Runs as a triggered Cloud Function (manual invoke), not scheduled

**Modified files:**
- `functions/routes/visitorRoutes.js`
  - Plan gate fix: visitor tracking (`GET /visitors`, `GET /visitors/snippet`) now correctly resolves plan from `user.plan` before `user.tier` (same Stripe stale-tier bug as elsewhere)
  - Index-resilient queries: removed composite `orderBy` from `getUserTierAndCheckLimit()` and `GET /visitors` — sorts in JS memory to avoid missing index errors

**Bug fix detail — plan gate:**
- `websiteVisitors` queries used `where(userId) + orderBy(lastSeenAt, desc)` which required a composite index not present in `firestore.indexes.json`
- Fix: query without orderBy, filter+sort in JS — avoids index dependency entirely

**Commits (Sprint 1–4):** deployed April 17, 2026 — commit a45d4fd (functions), commit 5566645 (hosting)

---

### Bug Fixes — April 19, 2026

**Fix 1 — `functions/api/pitch/templateOnePager.js`**
- `renderHeader()` logo fallback text was hardcoded `'PathSynch Labs'`
- Fixed to: `${escHtml(sellerProfile?.companyName || sellerProfile?.sellerContext?.companyName || 'Your Company')}`
- Affects all generated one-pagers when seller has no logo URL configured

**Fix 2 — `functions/middleware/planGate.js`**
- `planHierarchy` was `['starter', 'growth', 'scale']` — enterprise not included
- `planHierarchy.indexOf('enterprise')` returned `-1`, causing all enterprise users to fail every `requirePlan()` check
- Fixed to: `['starter', 'growth', 'scale', 'enterprise']`

**Commit:** 6c19f6e — deployed April 19, 2026

---

### Deployed Cloud Functions (as of April 19, 2026)

| Function | Type | Schedule |
|----------|------|---------|
| `api` | HTTP (2nd Gen) | on-request |
| `processThresholdAlerts` | Scheduled (2nd Gen) | every 6 hours |
| `merchantBehaviorSync` | Scheduled (2nd Gen) | Monday 09:00 UTC |
| `calibrateMerchant` | Callable (2nd Gen) | on-demand |
| `backfillConfidenceFields` | Callable (2nd Gen) | on-demand |
| `weeklyDigest` | Scheduled (2nd Gen) | weekly |
| `dailyDigest` | Scheduled (2nd Gen) | daily |
| `activityCleanup` | Scheduled (2nd Gen) | daily |
| `onUserCreated` | Auth trigger (1st Gen) | on user create |

### New API Endpoints — Visitor Intel (Sprints 1–6)

| Method | Path | Sprint | Purpose |
|--------|------|--------|---------|
| POST | `/visitor-signal/ingest` | 3 | Receive scored session from ps-core.js |
| GET | `/visitor-accounts` | 3 | Dashboard list — visitorIntelSummary accounts |
| GET | `/merchant-config` | 2 | Read merchant scoring config |
| POST | `/merchant-config` | 2 | Create/update merchant scoring config |
| GET | `/merchant-config/top-pages` | 2 | Top pages by visit volume |
| GET | `/merchant-config/calibration-report` | 2 | Calibration stats |
| POST | `/merchant-config/regenerate-snippet` | 2 | Force config JSON regen |
| GET | `/account360/:accountKey` | 5 | Read Account360 doc + outbound_view |
| POST | `/account360/:accountKey/outbound` | 5 | Update outboundState fields |
| GET | `/account360/:accountKey/history` | 6 | Last 5 CRM/sequence actions |
| POST | `/attio/push-account` | 6 | Push Account360 to Attio CRM |
| GET | `/instantly/vi-campaigns` | 6 | List campaigns (global INSTANTLY_API_KEY) |
| POST | `/instantly/trigger-sequence` | 6 | Add contact to Instantly sequence |
| GET | `/alerts` | 4 | List threshold alerts for user |
| POST | `/alerts/:alertId/read` | 4 | Mark alert read |
| POST | `/alerts/:alertId/action` | 4 | Mark alert actioned |
| POST | `/alerts/:alertId/dismiss` | 4 | Dismiss alert |

---

### Sprint 5 — Account360 Integration + Merchant Memory Framework

**New files:**
- `functions/services/entity360Bridge.js` — ONE-WAY bridge from visitorSignalService → Entity360. Fire-and-forget `notifyAccountStatus()`, `notifyContactIdentified()`, `notifyBehavioralSummary()`. All calls wrapped in try/catch that only logs. Only fires when `config.entity360MerchantId` is set.
- `functions/services/merchantBehaviorSync.js` — Weekly service. Reads `visitorIntelSummary/{merchantId}/accounts`, computes aggregate stats (total, hot, outreach_now counts, identificationRate, top high-intent pages), posts `BEHAVIORAL_SUMMARY` event. Posts `TRAFFIC_PROFILE_UPDATE` when identificationRate < 10%.

**Modified files:**

**`functions/routes/visitorSignalRoutes.js`**
- Account360 write expanded to full schema: `domain`, `companyName`, `identity` (confidence/tier/source/identifiedContacts[]), `intentSignals` (currentScore, status, scoreExplanation, highIntentPages, lastActivity, signalQualityGates), `outboundState` (pitchGenerated, briefGenerated, attioId, sequenceTriggered, lastOutboundAt), `recommendedNextAction`, `workspaceId`
- ConflictEngine applied on all provenance fields (existing code preserved)
- signalHistory still always appended on non-duplicate events (existing Write 3)
- After every Account360 upsert: writes `Account360/{accountKey}/agentViews/outbound_view` (4hr TTL) and `core_view` (24hr TTL)
- Entity360Bridge called after Account360 write: fires on status=hot/outreach_now/contact_identified when `config.entity360MerchantId` set and not in learning mode
- New endpoints: `GET /account360/:accountKey` (reads doc + outbound_view), `POST /account360/:accountKey/outbound` (updates outboundState fields only)

**`functions/api/pitchGenerator.js`**
- When `accountKey` in request body: reads `Account360/{accountKey}/agentViews/outbound_view` from Firestore
- If view exists and not expired: injects ACCOUNT INTELLIGENCE block into `inputs.statedProblem` before existing context
- Falls back to URL param `visitorContext` when account360View not available (not when account360View is present — avoids double-injection)

**`functions/routes/precallBriefRoutes.js`**
- Accepts `accountKey` from request body
- Reads `Account360/{accountKey}/agentViews/outbound_view` before generation (best-effort, non-blocking)
- `buildBriefPrompt()` now accepts `account360View` — generates richer WEBSITE ACTIVITY section with intent status, score, high-intent pages, identified contact, recommended angle
- Falls back to `visitorContext` when account360View not available
- All three `generateLegacyBrief()` calls pass `account360View`

**`functions/index.js`**
- Route for `/account360` added to visitorSignalRoutes dispatch block
- `merchantBehaviorSync` weekly scheduled function registered (Monday 09:00 UTC)

**`functions/routes/index.js`**
- Added `GET /api/v1/account360/:accountKey` and `POST /api/v1/account360/:accountKey/outbound` to AVAILABLE_ENDPOINTS

**Frontend:**

**`synchintro-app/js/api.js`**
- `getAccount360(accountKey)` — GET /account360/:accountKey
- `updateOutboundState(accountKey, updates)` — POST /account360/:accountKey/outbound

**`synchintro-app/js/pages/visitors.js`**
- [Open Workspace] button added to Outreach Now alert cards
- `openWorkspace(alertId, accountKey, alertData)` — opens full-width slide-over panel, fetches Account360 data
- `closeWorkspace()` — removes overlay, restores scroll
- `_renderWorkspaceBody()` — two-column layout: left (company intel, high-intent pages, why-now, signal quality gates, contacts), right (status badge, asset buttons, CRM actions with confirmation checkbox, action history)
- `_toggleWorkspaceCrmButtons()` — enables Send to Attio / Trigger Sequence after checkbox confirmed
- `_workspaceGeneratePitch()` — navigates to `/#/create?accountKey=...`
- `_workspaceGenerateBrief()` — navigates to `/#/precall-briefs?accountKey=...`
- `_sendToAttio()` — marks alert actioned + updates Account360 outboundState.attioId to 'pending_attio_sync'
- All workspace CSS added to `addStyles()` with dark mode support

**Architecture notes:**
- Account360 collection: prospect intelligence workspace (SynchIntro lane)
- merchant360 collection: merchant intelligence workspace (PathManager lane) — NEVER conflated
- entity360Bridge is ONE-WAY only — Entity360 never writes back to SynchIntro
- All Entity360 calls fire-and-forget — failure never breaks visitor tracking
- `entity360MerchantId` field on `merchantConfig` controls bridge; null = skip
- For KEM Health test merchant (ID: 937DF5): `entity360MerchantId = '937DF5'`
- outbound_view TTL: 4 hours | core_view TTL: 24 hours

---

## Session — April 16, 2026

### Intent Signals v1.1 — Backend Build

**New file:** `functions/services/intentSignalService.js`
- Exports `generateIntentSignals()` and `refreshIntentSignals()`
- Signal 1 (Search Momentum): Keywords Everywhere POST form-encoded, Bearer auth — `KEYWORDS_EVERYWHERE_API_KEY` in `.env`; DataForSEO Google Trends for MoM confirmation
- Signal 2 (Aggregated Velocity): reads `lead.velocityTrend.classification` from `reportContext.leads` — weights: on_pace 1.0, below_pace 0.3, stalling 0.1, declining 0.0; denominator always 20
- `calculateVelocityTrend()` has NO "accelerating" class — on_pace is the top classification
- Cache doc ID pattern: `[vertical, market, state].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, '_')).join('::')` — separator is `::` not `_` (fixed afternoon, commit ed65097)
- `deductCredits` is not exported from templateEnrichment.js — replicated inline (same Firestore update pattern)
- Gemini call uses `gemini-3-flash-preview` with `thinkingBudget:0`, JSON output, `indexOf('{')` extraction

**Modified:** `market.js` — import + wiring at lines ~1211–1225 + write at `reportData.data.intentSignals`
- **CRITICAL:** intent signals wired SEQUENTIALLY after main AI block — needs `lead.velocityTrend` already populated by velocity loop at lines 1038–1073
- Frontend reads path: `report.data.intentSignals` (NOT `report.intentSignals`)

**New Firestore rules:** `intentSignalsCache`, `categoryVelocitySnapshots`, `ke_credit_log`
- All three: `allow read: if isAuthenticated(); allow write: if false` (Cloud Functions write via Admin SDK)
- `categoryVelocitySnapshots` is append-only — never grant client write

**New Firestore index:** `categoryVelocitySnapshots(vertical ASC, market ASC, state ASC, createdAt DESC)` in `firestore.indexes.json`

### Bug Fixes Shipped April 16

**Analytics tab "Missing or insufficient permissions":**
- Root cause: `pitchAnalytics` docs written by public track-view endpoint via Admin SDK — no `userId` field ever written; ownership check `resource.data.userId == request.auth.uid` always denied
- Fix: `allow read: if isAuthenticated()` — matches `pitchVersions` precedent; data is counters only

**`trackShare()` 0 shares across 163 pitches:**
- Root cause: `pitchAnalytics` parent had `allow write: if false`; `shareEvents` subcollection had no rule at all
- Fix: `allow create, update` on parent (no delete granted); `allow create, read` on `shareEvents` subcollection

### Intent Signals Data Quality Fixes (commit ed65097)

**`functions/services/intentSignalService.js` — four data quality bugs fixed:**

**A — DataForSEO response parsing rewrite (`parseTrend`):**
- `item.keyword_data` → `item.data || item.keyword_data` (correct field for explore/live endpoint)
- `d.value` → `d.values[0].value || d.values[0].extracted_value || d.value` (handles both response shapes)
- `daysOfData` now computed from actual earliest→latest `date_from` in time series (was hardcoded 30/90)
- Individual time series values collected as `sparklineValues` array (feeds Issue D fix)
- Added raw response log: `[IntentSignals] DataForSEO raw items: ...` (first 500 chars of trend30 result)

**B — Cache key collision fix (`cacheDocId`):**
- Separator changed from `_` to `::` — `_` was both separator AND replacement char, creating collision risk
- New pattern: `auto_repair::charlotte::nc` (was `auto_repair_charlotte_nc`)
- Added `console.log` in `checkCache`: `[IntentSignals] Cache check: key=..., hit=true/false`
- Added `console.log` in `writeToCache`: `[IntentSignals] Cache write: key=...`
- NOTE: existing cache docs in `intentSignalsCache` have old `_`-joined keys — they will be ignored (cache miss) and re-written with new `::` keys on next report generation

**C — `scoreSummary` field (was never set):**
- Added `scoreSummary` to Gemini prompt alongside `actionRecommendations` — single Gemini call, no extra cost
- Prompt return schema changed: `{"actionRecommendations":[...],"scoreSummary":"..."}` (was `{"actions":[...]}`)
- Backward-compat fallback: parser reads `parsed.actionRecommendations` first, falls back to `parsed.actions`
- `scoreSummary` written to `signals` object → flows into both cache doc and report output automatically

**D — `sparklineData` field (was never written):**
- `parseTrend` now returns `sparklineValues` array (raw time series numbers, chronological)
- `fetchSearchMomentum` exposes as `sparklineData` on `searchMomentum` object
- Rule: `sparklineData = null` if fewer than 4 data points (not enough for meaningful polyline)
- Frontend reads `report.data.intentSignals.searchMomentum.sparklineData`

### userActivityLog Firestore Rule (commit 3d105b6)

**`firestore.rules` — new collection rule, append-only, owner-scoped:**
- `allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid`
- `allow read: if isAuthenticated() && resource.data.userId == request.auth.uid`
- `allow update, delete: if false`
- Inserted after `ke_credit_log` rule block

### Team Management Backend — Full Rewrite (commit 11f91c2)

**`functions/routes/teamRoutes.js`** — Full replacement from Schema A to Approach B:
- Schema A (orphaned, no prod data): `teams/{teamId}` + `teamMembers/{membershipId}` + `teamInvites/{inviteId}` — 3 separate collections
- Approach B (live): `teams/{ownerUid}` (doc ID = owner's UID) + embedded `members[]` + `teamInvitations/{autoId}` collection

**Schema:**
- `teams/{ownerUid}`: ownerUid, ownerEmail, ownerDisplayName, members[], memberUids[], createdAt, updatedAt
  - `memberUids[]` flat array maintained in sync with `members[]` — Firestore cannot filter nested object fields in arrays; `memberUids` enables `array-contains` queries
- `teamInvitations/{autoId}`: teamOwnerUid, inviteeEmail, role, status (pending/accepted/expired/declined), createdAt, expiresAt (7-day TTL)

**7 endpoints (all require auth):**
| Method | Path | Notes |
|--------|------|-------|
| GET | `/team` | Returns team + member list; `{}` if no team |
| POST | `/team/invite` | Owner only; lazy-creates team doc on first invite |
| POST | `/team/accept` | Invitee only; adds to members[] + memberUids[] atomically |
| POST | `/team/remove` | Owner only; cannot remove self |
| POST | `/team/update-role` | Owner only; read-modify-write (no atomic array-element update in Firestore) |
| GET | `/team/invitations` | Owner or invitee; expired invitations filtered in JS (avoids composite index) |
| GET | `/team/activity` | Owner only; reads `userActivityLog` via Admin SDK (bypasses Firestore rules for cross-member access) |

**Known limitations:**
- `sendTeamInviteEmail` not implemented — returns `invitationId` for manual sharing (SendGrid key issue)
- `GET /team/activity` uses `in` operator on memberUids — Firestore caps at 10 values, sliced at 10 UIDs
- Admin-invite deferred (owner-only invites for now)

---

## Session — April 7, 2026

### Refactor: L2 Template Generation — Vertex AI Controlled Generation

**Root cause fixed:** Executive Brief fell back to generic boilerplate because:
1. `executiveBriefRenderer.js` looked for `summaryText`/`headlineText`/`narrativeText` but template sections use `summaryBody`/`headlineLine1`/`narrativeBody` — every lookup returned null.
2. Renderer looked for section `whatCustomersLove` but actual section ID is `customerLove`.
3. Legacy batch prompt relied on Gemini returning valid JSON with `indexOf('{')` extraction — Gemini regularly dropped fields, resolver caught with boilerplate defaults.

**New architecture for executive_brief (and future template-based styles):**

#### Structured Generation Helper
File: `functions/services/structuredGeneration.js`

Use `generateStructured()` for **any** Gemini call that needs schema-guaranteed output:
```javascript
const { generateStructured } = require('../services/structuredGeneration');
const result = await generateStructured({
  systemInstruction: 'You are a sales strategist...',
  userPrompt: 'Generate fields for Acme Corp...',
  responseSchema: mySchema,         // see brewhouseResponseSchema.js
  model: 'gemini-3.1-pro-preview',  // or 'gemini-3-flash-preview' for lower cost
  temperature: 0.7,
  maxOutputTokens: 4096
});
// result is a parsed JS object guaranteed to match the schema
```

**SDK used:** `@google/generative-ai` (existing, v0.24.1+) with `responseMimeType: 'application/json'` + `responseSchema`.
**Do NOT use `@google-cloud/vertexai` for this** — it uses different model name conventions and adds new auth complexity. `@google/generative-ai` supports controlled generation natively from v0.13.0+.

**CRITICAL:** On failure, `generateStructured()` throws. Do NOT fall back to unstructured generation — failure means a bug to fix in prompt or schema, not a reason to silently degrade.

#### Schema Files
Directory: `functions/services/templates/`

Create one schema file per template. Schema field names must match template section field IDs so output can be passed directly to `resolveAllSections()` as `aiResults`.

Canonical example: `functions/services/templates/brewhouseResponseSchema.js`
- Used for: executive_brief, and as the base for future one-pager templates
- Schema field → template field ID mapping:
  - `complaintPatterns` (schema) → aliased to `patterns` (template field ID) in buildAndExecuteTemplatePrompt
  - All other fields match directly

#### Routing in templateOnePager.js
```javascript
if (l2StyleEarly === 'executive_brief') {
  aiResults = await buildAndExecuteTemplatePrompt(template, enrichedData.prospect, sellerProfile, enrichedData.analysis);
} else {
  aiResults = await buildAndExecuteBatchPrompt(template.sections, enrichedData, template.generationRules, sellerProfile);
}
```

#### Data Available in Analysis (after enrichment)
Fields now populated by `runTemplateEnrichment()`:
- `positiveSnippets` / `positiveReviews` — 4-5★ review texts (aliases of each other)
- `negativeSnippets` / `negativeReviews` — 1-3★ review texts (3★ included, was 1-2★ before)
- `complaintThemes` — array of strings from Gemini analysis
- `loveThemes` — array of strings from Gemini analysis
- `topComplaintPattern`, `urgencyHook`, `projectedOutcomes` — as before

#### Adding a New Template Style with Controlled Generation
1. Create `functions/services/templates/{styleName}ResponseSchema.js`
2. Add `build{StyleName}Prompt()` function in `templatePromptBuilder.js` (or add to existing)
3. Route in `templateOnePager.js` step 4 based on `l2StyleEarly`
4. Update renderer to use correct field IDs (no fallback boilerplate — empty = debug signal)

---

## Session — April 3–4, 2026

**Deployed to production (functions + hosting). Tier 2 Sprint 1, L2 Style Suite, L3 Data Analyst, David feedback fixes.**

### Critical Bug Fixes (Health Check Audit)
- Fixed: pitchRoutes.handle() wired into dispatch chain — kanban status changes work (C8)
- Fixed: Visitor Intel plan gate — Scale users blocked by upgrade prompt (H1)
- Fixed: Toast.show() → API.showToast() in visitors.js — 7 replacements (C3)
- Fixed: Session-expired redirect /login.html → / (C4)
- Fixed: l2OnePagerRenderer.js tracked in git (C1)
- Fixed: puppeteer-core migration — 300MB lighter deploys (C7)
- Fixed: Cost tracking model string gemini-3-flash → gemini-3-flash-preview (M8)
- Fixed: --radius-md CSS variable added to :root (H3)
- Fixed: Market report delete ownership check (H4)
- Fixed: gemini-2.5-flash-lite → gemini-2.5-flash in all fallbacks (H5)
- Fixed: Firestore rules: websiteVisitors, ipCache, pitchAnalytics (M9/H7)
- Fixed: .env.tmp deleted (M1)
- Fixed: Credit gate fallback — passes prospect data when credits insufficient
- Fixed: User credits reset (Charles Berry + David Hailey both had -5)

### Tier 2 Sprint 1 — Market Intelligence Enhancements

**Item 1: Decision maker enrichment (buyer/check-writer lookup)**
- File: `functions/services/decisionMakerEnrichment.js`
- Owner + buyer Serper queries per lead; buyer search fires for 50+ review businesses
- Multiple contacts: up to 3 owners/partners stored as array
- Department fuzzy matching via DEPARTMENT_ALIASES mapping

**Item 2: Competitor Analysis AI narrative**
- File: `functions/services/narrativeGenerator.js`
- Gemini-generated two-paragraph strategic prose; 20 competitors with seoTier data
- Static fallback ensures section is never blank

**Item 3: Review response rate**
- Files: `functions/api/market.js`, `functions/services/opportunityScorer.js`
- Calculated from DataForSEO `owner_answer` field per review
- Intel Signal: <20% critical, 20-50% moderate, >50% omit
- Opportunity Score +5 bonus for <20% response rate
- SEO Landscape table: new "Resp. Rate" column (red/amber/green)

**Item 4: Review recency badge**
- File: `functions/api/market.js`, `functions/services/opportunityScorer.js`
- `daysSinceLastReview`, `velocityStatus` computed per lead
- Intel Signal velocity alert triggers at 90+ days

### David Hailey Feedback Fixes
- Generate Pitch from lead card: contact, rating, reviews now pass through
- Pre-call brief timeout: 8s per-call wrapper + graceful degradation
- Pre-call brief wiring from Market Intel lead cards
- News dates visible with 90-day staleness indicator
- Seller branding pulls from sellerProfile (logo, colors)
- L3 "Quantify the Solution" JSON extraction: bracket counter + 4096 tokens
- "Back to Report" navigation via sessionStorage
- Market Intel report auto-selects in Import Context on arrival from lead
- Website pass-through from leads to Create Pitch
- Auto-trigger Logo Fetch when website present
- Market intel context injected into pitch generation prompt (`inputs.marketContext`)

### L2 One-Pager Style Suite

**New Files:**
| File | Style |
|------|-------|
| `functions/services/executiveBriefRenderer.js` | executive_brief |
| `functions/services/roiSnapshotRenderer.js` | roi_snapshot |
| `functions/services/battlecardRenderer.js` | competitive_battlecard |
| `functions/services/visualSummaryRenderer.js` | visual_summary |

All wired via `options.l2Style` in `templateOnePager.js`:
```
if (l2Style === 'executive_brief') { renderExecutiveBrief(...) }
else if (l2Style === 'roi_snapshot') { renderROISnapshot(...) }
else if (l2Style === 'competitive_battlecard') { renderBattlecard(...) }
else if (l2Style === 'visual_summary') { renderVisualSummary(...) }
else { renderOnePagerHtml(...) }   // standard
```

`l2Style` derivation in `pitchGenerator.js`:
```javascript
l2Style: body.l2Style || (body.style && body.style !== 'standard' ? body.style : null)
```

Competitor data injected into `inputs.marketContext` when `source === 'market_intel_leads'`:
- `inputs.marketContext.competitors[]` — name, rating, reviewCount, responseRate, seoTier
- `inputs.marketContext.benchmarks`, `.city`, `.industry`, `.seoLandscape`

### L3 Data Analyst Slide Deck

**New File:** `functions/services/dataAnalystDeckRenderer.js`
- `renderDataAnalystDeck(pitch, sellerProfile, marketReport)` → `{ buffer, filename }` (PPTX)
- `renderDataAnalystHTML(pitch, sellerProfile, marketReport)` → HTML string (preview)
- 10 slides using PptxGenJS shapes (not chart API): title, reputation snapshot,
  positioning matrix, head-to-head table, voice of customer, cost of inaction,
  competitive narrative, gap-to-solution map, investment + ROI, next steps

**Modified:** `functions/api/pitch/level3Styles/dataAnalyst.js`
- Replaced ~540-line placeholder HTML with call to `renderDataAnalystHTML()`
- No longer renders blank — uses real market intel data

**Modified:** `functions/api/export.js`
- `generatePPT()` and `prepareCloudExport()` both detect `pitchData.style === 'data_analyst'`
- Routes to `renderDataAnalystDeck()` fetching market report via `pitchData.marketReportId`
- All other styles continue to use existing `pptTemplate`

### News Classification
- `serperClient.js` — new `classifyNewsScope()` function
- Two-section display: "Local Market News — [City]" and "Industry Trends"
- Backward compatible — existing reports without scope default to industry

### Infrastructure
- `IPINFO_TOKEN` added to `.env` (Lite plan)
- Firestore rules updated for new collections
- All Gemini model strings audited: gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash only

### Known Issues (April 4)
- L3 Data Analyst: market leader name may show "Market Leader" — marketReport data path varies
- L3 Data Analyst: opportunity score shows "—" on slide 1 — `pitch.prospect.opportunityScore` not always populated
- Competitive Battlecard + Visual Summary: built and deployed, not yet tested end-to-end in production
- Landing Page generation: Firestore composite index may need manual creation (landingPages: userId + createdAt)
- IPINFO_TOKEN on Lite plan — IP-to-company limited to ISP-level data

---

## Session — March 19, 2026

### Bugs Fixed & Deployed

**Bug: L4 One-Pager generation broken**
File: functions/api/pitchGenerator.js | Commits: 77adfc4 → merged to main a3d32c3
- No case 4 in switch — pitchLevel === 4 fell through to default → generateLevel3()
  (10-12 slide enterprise deck instead of one-pager)
- Fix: added case 4 to generatePitch() switch (line 576)
- Fix: added case 4 to generatePitchDirect() switch (bulk upload path)
- Fix: added generateLevel4() — validates Sales Library has docs, delegates to
  generateLevel2() with salesLibraryContext already populated upstream
- Fix: generateLibraryEnhancedContent() — level === 4 now uses one-pager prompt
  (was using enterprise deck prompt via else branch)
- Sales Library context is fetched upstream in generatePitch() before the switch,
  so generateLevel4() does NOT re-fetch from Firestore

**Bonus: onUserCreated had never deployed**
File: functions/api/auth/welcomeEmail.js
- Importing 'firebase-functions' instead of 'firebase-functions/v1'
- Crashed every deploy silently — welcome emails never sent to any new user
- Fix: corrected import to firebase-functions/v1
- onUserCreated now live for the first time

### Architecture Notes Confirmed
- All pitch logic: exports.api → POST /generate-pitch → pitchGenerator.js
- Formatter (separate path): POST /api/v1/narratives/:id/format/one_pager → formatterApi.js
- Firestore collections: salesDocuments, customerLibraryConfig, pitches
- User logo: users/{uid}.sellerProfile.branding.logoUrl
- generatePitchDirect() — bulk upload switch (now also has case 4)

### Sprint 3+4 — Parallel Prospect Enrichment Pipeline (March 26, 2026)
**PR #5 merged March 26, 2026** — branch `feature/prospect-enrichment`

**New Files:**
- `functions/agents/prospectResearchAgent.js` (560 lines) — Vertex AI Deep Search agent
  (5 tools: google_places_lookup, competitor_scan, website_scrape, news_search,
  gbp_completeness_check). Model: gemini-2.0-flash via agentRunner.js.
  Returns structured PROSPECT_INTELLIGENCE JSON.
- `functions/services/pitchEnricher.js` (225 lines) — Promise.allSettled parallel runner.
  3 sources: prospectResearchAgent, newsIntelligenceAgent, vertexSearch.
  8s timeout per source. Graceful degradation — never blocks pitch generation.
- `functions/services/vertexSearch.js` (127 lines) — Discovery Engine API client.
  Data store: synchintro-knowledge-base_1774560525810 (project pathconnect-442522).
  Methods: searchKnowledgeBase(), groundedSearch().

**Modified Files:**
- `functions/api/pitchGenerator.js` — Wired enrichment pipeline into generatePitch().
  Places enrichment + deep enrichment run in parallel via Promise.allSettled.
  PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt.
  pitchMetadata.enrichment stored on pitch Firestore document.
- `functions/.env` — Added GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX, VERTEX_SEARCH_DATA_STORE_ID

**New Env Vars:**
- `GOOGLE_SEARCH_API_KEY` — for news_search tool (graceful skip if missing)
- `GOOGLE_SEARCH_CX` — Custom Search Engine ID: c0887a1e024af4f45
- `VERTEX_SEARCH_DATA_STORE_ID` — full Discovery Engine data store resource path

**CRITICAL: DO NOT add GOOGLE_APPLICATION_CREDENTIALS to functions/.env**
This crashes ALL Firestore access in Cloud Functions production.
Cloud Functions authenticates automatically via the default service account.
GOOGLE_APPLICATION_CREDENTIALS is only needed for LOCAL DEVELOPMENT and
should be set in your local shell environment, never in the .env file.
Local dev: `$env:GOOGLE_APPLICATION_CREDENTIALS="./pathconnect-442522-ec919d9337b8.json"`

**Architecture:**
- Create Pitch now runs 3 enrichment sources in parallel BEFORE AI synthesis:
  1. Prospect Research Agent (Google Places + competitors + GBP score + website + news)
  2. News Intelligence Agent (already existed in services/newsIntelligenceAgent.js)
  3. Vertex AI Search (knowledge base grounding)
- All run via Promise.allSettled() with 8s timeout per source
- PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt
- Enrichment metadata stored in pitchMetadata.enrichment on pitch Firestore doc
- Credit tracking: prospect_research=50, news_intel=25, kb_search=10

**Bug Fix:**
- Visitor Intel plan gate: `visitors.js` line 70 used `user?.tier || user?.plan` — missed
  `subscription.plan`/`subscription.tier`, blocking Scale users. Fixed to comprehensive pattern.

### Session — March 28, 2026

**Commits:** 19d78c7, b95cd9b — merged to main, deployed to production

**Bug 1 (CRITICAL): Card synthesis prompts silently dropped**
File: functions/api/pitchGenerator.js
- `generateLibraryEnhancedContent()` had two bail-out guards (lines 72, 95) that returned
  null when no Sales Library docs AND no RAG chunks — even when card synthesis instructions
  were present in `prospectIntelBlock`.
- None of the HTML level generators read `options.prospectIntelligenceBlock` directly.
- Fix: Added `hasCardInstructions` check to both guards. Added third fallback branch in
  `generatePitch()` that calls `generateLibraryEnhancedContent()` when card instructions
  exist but no library/RAG.

**Bug 2 (HIGH): generatePitchDirect() missing salesLibraryContext**
File: functions/api/pitchGenerator.js
- Bulk upload path never called `fetchSalesLibraryContext()`. L4 via bulk always threw
  "Your Sales Library is empty."
- Fix: Added fetch + early return for L4 without docs + `generateLibraryEnhancedContent()`
  call before switch. Options now include salesLibraryContext, libraryEnhancedContent,
  useCustomLibrary.

**Bug 3 (ROOT CAUSE for L4): fetchSalesLibraryContext crash on missing config**
File: functions/api/pitch/dataEnricher.js
- `configDoc.data()` returned undefined when `customerLibraryConfig/{userId}` didn't exist.
  `config.companyName` threw TypeError. Catch returned null. Charles Berry had 5 ready docs
  but no config doc — all invisible.
- Fix: `const config = configDoc.exists ? configDoc.data() : {};` + null-coalesce fields.

**Bug 4 (HIGH): L4 output identical to L2**
Files: functions/api/pitchGenerator.js, functions/api/pitch/level2Generator.js
- `generateLibraryEnhancedContent()` used identical system prompt for L2 and L4
  (`else if (level === 2 || level === 4)`).
- `generateLevel4()` just called `generateLevel2()` with zero differentiation.
- Fix: L4 has its own system prompt branch in `generateLibraryEnhancedContent()` that
  instructs AI to use Sales Library as PRIMARY source and returns seller-specific fields:
  sellerProductName, sellerMethodology, proofPoints, caseStudyName, caseStudyResult,
  sellerDifferentiators, solutionOverview, callToAction.
- Fix: `generateLevel4()` passes `pitchLevel: 4` in options.
- Fix: `level2Generator.js` checks `isL4 = options.pitchLevel === 4 && useCustomLibrary`
  and renders L4-specific sections (proof points stats, methodology/differentiators,
  case study block, key benefits grid, seller CTA, "Sales Library Powered" badges).

**KNOWN ISSUE — L4 may still render as L2:**
- The `isL4` check requires BOTH `options.pitchLevel === 4` AND `useCustomLibrary` to be true.
- `useCustomLibrary = options.useCustomLibrary && libraryContent` — if `generateLibraryEnhancedContent()`
  returns null (Gemini call fails, JSON parse fails, etc.), `useCustomLibrary` is false and `isL4`
  is false, causing silent fallback to generic L2 template.
- Debug next session: check if `generateLibraryEnhancedContent()` is actually returning valid JSON
  for level 4 with the new prompt. Check Cloud Functions logs for errors.
- Charles Berry UID: dehiyRBCXcUUM72O211S27lfXbl1 — 5 ready docs, NO customerLibraryConfig doc.

### Sprint 4 — Market Intel Full Enrichment (March 28, 2026)

**Commits:** e5c1170, 3738eeb — merged to main, deployed to production

**New File:**
- `functions/services/theOrgClient.js` — TheOrg API client for enterprise decision maker lookup.
  Searches organizations by name, fetches people, filters by decision-maker titles (C-Suite, VP,
  Director, etc.). Env: THEORG_API_KEY (Secret Manager only, NOT in .env).

**Modified Files:**

**functions/index.js**
- Added `THEORG_API_KEY` to secrets array. SERPER_API_KEY is already in `.env` — adding it to
  secrets causes deploy failure ("Secret environment variable overlaps non secret environment
  variable"). Only add secrets that are NOT in .env.

**functions/services/serperClient.js** — 4 new exported functions:
- `searchFastestGrowingCommunities(city, state, industry)` — 3 parallel Serper searches for
  growing neighborhoods/suburbs, population growth by zip, and industry demand. Returns top 5
  communities by mention frequency + growth signals for top 3.
- `searchAreaIncome(city, state)` — Median household income search, returns top 3 sources.
- `enrichLeadOwner(businessName, city)` — 3 sequential queries (owner, founder/operator,
  LinkedIn) to find business owner name, title, and LinkedIn URL. 200ms delay between queries.
- `searchMarketTrends(city, state, industry)` — 5 parallel searches: demand, new openings (news),
  closings (news), hiring, seasonal patterns. Returns categorized signal arrays.

**functions/api/market.js** — 2 new Gemini functions + enrichment pipeline:
- `generateSalesIntel()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON: topPainPoints,
  objectionResponses, entryWedge, bestTimeToCall, competitorVulnerability, talkingPoints.
- `generateRecommendations()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON:
  priorityActions (rank/action/businessName/reason/openingLine/timing), weeklyGoal,
  sequenceRecommendation, expectedOutcome, quickWin.
- Lead owner enrichment: top 5 serperLeads enriched with ownerName/ownerTitle/linkedInUrl via
  Promise.allSettled before report document creation.
- Parallel AI block expanded: now runs 6 tasks in parallel — aiSummary, competitorAnalysis,
  demographicsCommunities, marketTrends, salesIntel, (placeholder). Recommendations run
  sequentially after salesIntel resolves (needs salesIntel.entryWedge).
- New fields on reportData.data: demographicsCommunities, trends, salesIntel, aiRecommendations.
- Library auto-save content updated with all 4 new data fields.

### Sprint — SEO Landscape (March 28, 2026)

**Commits:** 50c2c6f (bundled with SWOT) — deployed to production

**Modified: functions/api/market.js**
- `calculateSEOLandscape(competitors)` — scores top 10 competitors on rating (25pts),
  review volume (25pts), website presence (20pts), phone/GBP completeness (10pts),
  address (10pts), review response proxy (10pts). Returns tier (strong/moderate/weak),
  signals array, opportunity text, market insight summary.
- Called after benchmarks, before parallel AI block.
- `seoLandscape` included in reportData.data and Library auto-save content.

### Planned (not built)
- Pitch Quality Agent (Vertex AI)

---

## Session — March 29, 2026

**Commits:** Deployed to production (functions + hosting)

### New Files Created

| File | Purpose |
|------|---------|
| `functions/services/opportunityScorer.js` | 5-component opportunity score + Intel Signal generator |
| `functions/services/seoLandscape.js` | `calculateSEOLandscape()` (extracted from market.js) |
| `functions/services/swotGenerator.js` | `generateSWOT()` (extracted from market.js) |
| `functions/services/narrativeGenerator.js` | `generateAIExecutiveSummary()`, `generateCompetitorAnalysis()` |
| `functions/services/salesIntelGenerator.js` | `generateSalesIntel()`, `generateRecommendations()` |
| `functions/services/verticalConfigs.js` | 6 vertical configs + `detectVertical()` + `buildVerticalContext()` |
| `functions/services/verticalQuestions.js` | Dynamic pre-generation questions + fallback templates |

### API Endpoints Added

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/market/questions` | AI-generated precision targeting questions (gemini-2.5-flash, 3s timeout) |
| GET | `/market/questions/fallback` | Hardcoded vertical question templates |

### Key Architectural Decisions

- **ICP filter** is user-configurable toggle, NOT hardcoded (supports Countifi enterprise use case)
- **Opportunity Score v2** INVERTS review count: low reviews = high score (businesses that need PathSynch most)
- **Intel Signals** replace Pitch Hooks: data-specific gap observations for sales rep, not sales copy
- **Vertical configs** auto-detect and inject industry-specific context into all AI prompts
- **market.js** refactored from 1200+ lines to ~860 lines via service extraction
- **PDF export** moved to client-side html2pdf.js (Puppeteer unavailable in Cloud Functions 2nd Gen)
- **All exports fixed**: PDF, PPTX, Google Slides, Google Drive, OneDrive — `Toast.show()` → `API.showToast()` (26 instances)
- **Six Smart Mode cards** produce six visually distinct report types via card-specific system prompts + HTML templates
- **Positioning Matrix**: `positioningMatrix` data object on Market Intel report. SVG scatter plot (rating vs reviews) with opportunity zone, crosshairs, tooltips
- **News signal geographic filter**: state parameter + `isGeographicallyRelevant()` post-filter
- **Dynamic Pre-Generation Questions**: AI-generated via gemini-2.5-flash with hardcoded vertical fallback

### Opportunity Score v2 (5-component formula)

| Component | Range | Description |
|-----------|-------|-------------|
| A: Rating Quality Gap | 0-30 | How far above 4.0★ |
| B: Presence Gap | 0-30 | INVERTED — low review count = HIGH score |
| C: Review Velocity Gap | 0-20 | Recency of last review from DataForSEO |
| D: SEO Tier Gap | 0-10 | Below market average = more opportunity |
| E: Signal Bonus | 0-10 | Award/opening/hiring news triggers |

Interpretation: 80-100 Priority, 60-79 Strong, 40-59 Moderate, <40 Monitor

### Vertical Configs (6 verticals)

| Vertical | Review Ceiling | Key Fields |
|----------|---------------|------------|
| food_beverage | 400 | painPoints, pitchAngle, recommendedProducts, avgTicket, CLV, seasonalTriggers, icpSignals |
| professional_services | 150 | (same fields, industry-specific values) |
| automotive | 300 | " |
| health_beauty | 250 | " |
| retail | 200 | " |
| home_services | 350 | " |

Auto-detected via `detectVertical()` fuzzy-matching from industry/subIndustry/businessName keywords.
Injected into: pitchGenerator.js, market.js ICP filter, salesIntelGenerator.js, opportunityScorer.js.

### DataForSEO Integration

- `getGoogleReviews()` — Real review data (rating, count, 3-5 snippets) on top 5 Market Intel leads. Parallel `Promise.allSettled`. Graceful fallback.
- `getLocalSERPRankings()` — Google Maps pack rankings in SEO Landscape. Position, business name, rating, review count for up to 10 results.

### Six Smart Mode Card Types (CARD_SYSTEM_PROMPTS)

| Card | Focus | Schema |
|------|-------|--------|
| card1 | Competitor Landscape | competitors[], ratingGap, valueGap, pitchHooks |
| card2 | Reputation Health | reviewVelocity, responseRateGap, complaintPatterns, sentimentBreakdown |
| card3 | Market Opportunity | tamEstimate, opportunityScore, marketSaturation, growthRate |
| card4 | Pre-Call Brief | companySnapshot, meetingTrigger, talkingPoints[], objections[] |
| card5 | Referral Potential | currentMonthlyReferrals, potentialMonthlyReferrals, rewardStructure |
| card6 | GBP Audit | gbpScore, dimensions[], quickWins, fullOptimizationPlan |

### Firestore Index Created

- `events` collection: composite index (eventType ASC + timestamp DESC) for Smart Mode preferences query

### Tier 2 Sprint 1 — Lead Enrichment + Review Intelligence (March 29, 2026)

**New File:**
- `functions/services/decisionMakerEnricher.js` — Gemini-powered decision maker extraction.
  `serperQuickSearch()` (standalone lightweight Serper search) + `extractPersonFromSnippets()`
  (gemini-2.5-flash, thinkingBudget:0, temperature:0, maxOutputTokens:100).
  Two sources: direct owner/founder search, website about-page search.
  `enrichDecisionMaker(leadName, city, state, website)` → `{ name, title, source, confidence }`.
  3s timeout per lead via Promise.race. Graceful null return on failure.

**Modified Files:**

**functions/api/market.js** — Decision maker enrichment + review response rate:
- Removed old regex-based `enrichLeadOwner` block (was top 5 pre-ICP, Serper-only)
- Added Gemini-powered DM enrichment post-ICP/post-scoring on top 10 qualified leads
- Runs as `dmEnrichmentPromise` in parallel with AI block, awaited before Firestore save
- Sets `lead.decisionMaker` object + backward-compat `lead.ownerName`/`lead.ownerTitle`
- DataForSEO review mapping now calculates `responseRate` and `respondedCount` from
  individual review `ownerResponse` fields. Also passes `hasOwnerResponse` per review.

**functions/services/narrativeGenerator.js** — Competitor analysis prompt rewrite:
- Model: gemini-3-flash-preview (unchanged)
- Shows top 10 competitors (was top 5)
- Prompt completely rewritten: archetype-based structure
  - Paragraph 1: Market Structure — identify 2-3 competitive archetypes, name specific businesses,
    volume vs quality separation, dominated vs fragmented assessment
  - Paragraph 2: Opportunity Pattern — gap pattern, quality-without-presence businesses,
    ends with usable conversation opener for sales rep
- Constraints: 120 words/paragraph, 3+ named businesses, no generic data-description phrases

**functions/services/opportunityScorer.js** — Intel Signal enrichment:
- `generateIntelSignal()` gained 2 new lines (before existing review snippet):
  - Line 5: Review response rate — shown only when `responseRate < 30%`
    Format: `Response rate: X% — review engagement gap detected.`
  - Line 6: Review velocity alert — shown when last review > 60 days ago
    Format: `Review velocity alert: last review X days ago — dormant engagement.`

### Bug Fix — Positioning Matrix Syntax Error (March 29, 2026)

**File: synchintro-app/js/pages/market.js (line 1719)**
- DataForSEO review block was OUTSIDE the `.map()` callback scope
- `.map()` closed at line 1701, then `${lead.dataForSEO ? ...}` referenced `lead` (out of scope)
- Orphaned `` `).join('')} `` at line 1719 caused `SyntaxError: Unexpected token ')'`
- Fix: moved DataForSEO block back inside `.map()` return template before callback closes
- Market Intel page was completely broken — now fixed

### Known Issues (March 29, 2026)

- **Executive summary leader misidentification**: AI summary sometimes picks first competitor
  as "market leader" instead of actual highest-rated. Narrative prompt may need to explicitly
  receive the market leader object rather than relying on Gemini to identify it from the data.
- **ICP filter vertical ceiling not applying for all verticals**: Nashville Salon report showed
  leads with 1,100+ reviews passing through a 250-review ceiling. Investigate whether
  `detectVertical()` is matching "Salon & Beauty" to the `health_beauty` config.
- **L4 may still render as L2** (from March 28): `isL4` requires both `pitchLevel === 4` AND
  `useCustomLibrary` to be true. If `generateLibraryEnhancedContent()` returns null, silent
  fallback to generic L2 template.

---

## GEMINI MODEL RULES (Updated March 29, 2026)

### Model Hierarchy
- gemini-3-flash-preview — PRIMARY model for fast tasks (reasoning, synthesis, pitch gen, simple agents)
  Used in: geminiClient.js, geminiClientV2.js, agentRunner.js, config/gemini.js primary tier

- gemini-3.1-pro-preview — ADVANCED model for complex reasoning (multi-step analysis, intelligence synthesis, agentic orchestration)
  Note: "gemini-3.1-pro-preview-customtools" does NOT exist — use gemini-3.1-pro-preview

- gemini-2.5-flash — SIMPLE TASKS model (email, SVG, trigger extraction, question generation)
  Used in: shareEmailGenerator.js, geminiVisuals.js, index.js trigger extraction, config/gemini.js economy tier

- gemini-2.5-flash-lite — BUDGET model for high-volume low-complexity tasks
  Used in: config/gemini.js fallback tier

### Model Rules
- NEVER use gemini-1.5-pro or gemini-1.5-flash — DEAD (404)
- NEVER use gemini-2.0-flash — DEPRECATED, shuts down June 1 2026
- NEVER use gemini-2.0-flash-exp — DEPRECATED
- NEVER use gemini-3-pro-preview — SHUT DOWN March 9 2026
- When in doubt, use gemini-3-flash-preview
- gemini-3-flash-preview or higher = KEEP, never downgrade
- GEMINI_MODEL env var controls geminiClient.js default — currently set to gemini-3-flash-preview in .env

### JSON Output Rules (Critical for 3.x models)
- Gemini 3.x models have thinking enabled by default
- Thinking tokens leak before JSON output causing parse failures
- Always add thinkingBudget: 0 when expecting JSON output:
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
- Always extract JSON using indexOf('{') / lastIndexOf('}')
  NOT by stripping markdown fences alone
- Always start system prompt with:
  "IMPORTANT: Output ONLY a valid JSON object.
   Start your response with { and end with }.
   Do not include any explanation or text outside the JSON."
- Leave thinking ENABLED (no thinkingConfig) for:
  pitch synthesis, agent reasoning, pre-call briefs

---

## Session — March 30, 2026

**Deployed to production (functions + hosting). Market Intelligence Report — FEATURE COMPLETE.**

### Pre-Tier 3 Fixes (Items 1-4)

**1. ICP ceiling hard exclusion**
File: `services/verticalConfigs.js`, `api/market.js`
- Added missing keywords to `health_beauty` vertical config
- Added `else if (verticalConfig)` branch that enforces ceiling even without explicit ICP toggle
- Fix for Nashville Salon report showing 1,100+ review leads passing 250-review ceiling

**2. Market leader identification (initial fix)**
Files: `services/narrativeGenerator.js` (2 locations), `api/market.js`
- Replaced `competitors[0]` with proper sort by rating (desc) then review count (desc)
- Applied in `calculateMarketBenchmarks()` and both narrative generator leader selections
- Later superseded by composite score in item 22

**3. News signal → Opportunity Score cross-reference**
File: `api/market.js`
- Cross-reference loop matching `newsSignals` to `serperLeads` by business name BEFORE `scoreLeads()` runs
- `classifySignalType()` helper categorizes signals (award, opening, hiring, expansion)
- Matching signals boost Opportunity Score component E (Signal Bonus)

**4. News signal deduplication**
File: `api/market.js`
- Deduplicates signals by title (case-insensitive) after Serper fetch
- Prevents same news article appearing multiple times from different search queries

### Sprint 2A — Demographics Enrichment (Item 5)

**New File:**
- `functions/services/demographicsEnricher.js` — US Census ACS API (free, no key required).
  `enrichDemographics(city, state)` fetches population, median income, median home value.
  `parseGrowthFromSnippets()` extracts growth %, population gains from Serper editorial snippets.
  Returns `{ population, medianIncome, medianHomeValue, growthIndicators[] }`.

**Modified:** `api/market.js` — Wired into parallel enrichment block. Demographics data stored
on `reportData.data.demographics`. Frontend renders City Demographics card, community pills
with green growth badges, growth signal cards with structured data.

### Sprint 2B — Share of Voice (Item 6)

**Modified:** `api/market.js`, `services/opportunityScorer.js`
- Share of voice: `reviews / totalMarketReviews × 100` for all competitors + leads
- Added to: Competitors table (Voice column), Market Benchmarks (Leader Voice Share card),
  Intel Signals (<1% share line), positioning matrix tooltips, leads table (color-coded badges)
- Fixed positioning matrix rendering which was getting undefined data from missing voice values

### Sprint 2C — PathManager Benchmark Feed (Item 7)

**Modified:** `api/market.js`, `index.js`
- `writeMarketBenchmark()` writes to `marketBenchmarks` Firestore collection on every report generation
- 30-day TTL via Firestore TTL policy
- Benchmark document includes: avg rating, reviews, market leader, ICP median, share of voice,
  SEO landscape tier, Census demographics, market saturation index
- Two new read endpoints (public, no auth required):
  - `GET /benchmarks/:industry/:city/:state` — exact match
  - `GET /benchmarks/search` — fuzzy search with query params

**New Firestore Collection:**
- `marketBenchmarks/{industry}_{city}_{state}` — cross-product benchmark data (30-day TTL)
- Firestore rules: public read, admin-only write
- Composite indexes for search queries

### Tier 3 Part A Fixes (Items 8-11)

**8. Duplicate business deduplication**
File: `api/market.js`
- `normalizeBusinessName()` — strips Inc/LLC/Corp suffixes, lowercases, trims
- `deduplicateLeads()` — merges duplicates, keeps higher-scoring instance
- `deduplicateCompetitors()` — same logic for competitor array
- Runs after Places API fetch, before scoring

**9. News signal hard reject list**
File: `api/market.js`
- 13 source domains rejected (IndexBox, GlobeNewsWire, MarketWatch press releases, etc.)
- Global market patterns rejected ("CAGR", "2030-2035", "market size", "forecast")
- Off-topic patterns rejected (national chains, stock market, unrelated industries)

**10. Award signal business name match required**
File: `api/market.js`
- `matchSignalToLead()` — scores signal relevance per lead
- Business name exact match = 10pts, industry keyword = 3pts, geography alone = 0pts
- Signals with 0pts are not attributed to any lead

**11. Precision questions driven by Sub-Industry**
Files: `services/verticalQuestions.js`, frontend
- `onSubIndustryChange()` fires questions based on sub-industry selection
- 16 sub-industry templates added to `verticalQuestions.js` (was 6 vertical-level only)
- Questions are more specific: "Thai restaurant" gets different questions than "Pizza shop"

### Tier 3 Sprint 1 — Enhancements (Items 12-15)

**12. Pre-Call Form trigger from leads**
File: `api/market.js` (endpoint), frontend
- Per-lead button navigates to `/#precall` with data pre-filled
- Passes: businessName, contactName (from decisionMaker), industry, location, website
- `createPreCallFromLead()` frontend handler

**13. Lead color palette system**
- 4px left border + tier label on lead cards
- Priority (green #10B981), Strong (teal #14B8A6), Moderate (amber #F59E0B), Monitor (gray #6B7280)
- `getLeadTier()` maps Opportunity Score ranges to tier names

**14. Competitor Types visual section**
Files: `services/salesIntelGenerator.js`, frontend
- Gemini generates `competitorTypes[]` array (2-4 archetypes per market)
- Each archetype: name, description, exampleBusinesses[], opportunityLevel
- Rendered as cards with "PathSynch ICP" badge on high-opportunity types
- Positioned between Competitor Analysis and SEO Landscape sections

**15. High-Impact Moves**
File: `services/salesIntelGenerator.js`
- `generateHighImpactMoves()` — gemini-3-flash-preview generates 3-5 sequenced strategic moves
- Each move: title, context, action, timing, expectedOutcome
- Replaces old Recommendations section when present (true fallback pattern)
- Data-driven: references specific leads, scores, and Intel Signal gaps

### Sprint 2B Session 1 — GBP + Sentiment (Items 16-17)

**16. GBP Completeness Signals**
File: `api/market.js`
- `getBusinessInfo()` calls DataForSEO `/business_data/google/my_business_info/live`
- `calculateGBPCompleteness()` scoring: photos (30pts), hours (20pts), claimed (20pts),
  website (15pts), phone (15pts)
- Intel Signal lines added for GBP gaps (missing photos, no hours, unclaimed)
- Stored in `services/opportunityScorer.js` via `calculateGBPCompleteness()`
- Exported from `opportunityScorer.js`, called in `adjustSEOScoreForPhotos()`

**17. Review Sentiment Extraction**
**New File:** `functions/services/sentimentExtractor.js`
- Gemini extracts from review text: `praiseThemes[]`, `complaintThemes[]`, `standoutPhrase`
- Model: gemini-3-flash-preview with thinkingBudget:0
- Called per lead (top 10 qualified) with DataForSEO review snippets as input
- Frontend: CUSTOMERS SAY section (praise pills green, complaint pills red, standout quote teal)

### Sprint 2B Session 2 — Operational Layer (Items 18-21)

**18. Report Refresh**
Files: `api/market.js`, `index.js`
- `POST /market/refresh/:reportId` — re-runs full enrichment pipeline on existing report
- 50 credits per refresh
- Updates existing Firestore document in place (preserves reportId, shareId)
- Freshness badges: green (≤14d), amber (≤30d), red (>30d)
- Refresh button appears at 15+ days, stale banner at 30+ days

**19. LinkedIn URL Enrichment**
File: `services/decisionMakerEnricher.js`
- `findLinkedInURL()` — two-query Serper search (company + person name)
- Returns LinkedIn profile URL or null
- Blue LinkedIn badge on lead cards (links to profile)

**20. Time in Business Signal**
File: `services/decisionMakerEnricher.js`, `services/opportunityScorer.js`
- `findTimeInBusiness()` — Serper search for founding date / years in business
- `classifyVelocity()` — Reviews/year: High velocity (≥30), Moderate (≥10), Low (≥5), Stalled (<5)
- Intel Signal LINE 10: "Est. X years — Y reviews/year (velocity classification)"

**21. Pre-Call Brief Auto-Attach**
Files: `api/market.js`, `index.js`
- `GET /market/match` — scores existing reports by city + state + industry
- Returns matching report when similarity score ≥ 50
- Pre-Call Form auto-attaches market intelligence from matched report

### Sprint 4 Session 1 — Rendering Fixes (Items 22-25)

**22. Market leader composite score**
Files: `services/opportunityScorer.js`, `services/narrativeGenerator.js` (2x),
`services/salesIntelGenerator.js`, `api/market.js`
- `identifyMarketLeader(competitors)` — composite: `((rating - minRating) / ratingRange) * 0.4 + (reviews / maxReviews) * 0.6`
- `getDominanceLanguage(leader, marketAvgReviews)` — ratio ≥3: "dominates", ≥1.5: "leads", else: "edges out the field in"
- Replaced rating-first sort in 4 locations (narrativeGenerator.js ×2, salesIntelGenerator.js ×1, market.js ×1)
- Executive summary prompt uses dynamic `dominanceVerb`

**23. Signal cross-reference tightening**
File: `api/market.js`
- `getIndustryKeywords()` upgraded from single-word to multi-word terms
  (e.g., 'food' → 'food service', 'restaurant opening')
- `trendBonusAwarded` flag — industry trend bonus applied to FIRST matching lead only
- Prevents score inflation from one industry trend boosting all leads

**24. High-Impact Moves for all verticals**
Files: `services/salesIntelGenerator.js`, frontend `js/pages/market.js`
- Confirmed backend already calls HIM unconditionally (no vertical gating)
- Frontend changed: HIM takes priority over Recommendations (true fallback)
- If HIM exists → render HIM. If not → fall back to Recommendations.

**25. Competitor Types + HIM in PDF export**
File: frontend `js/pages/market.js`
- Added Competitive Archetypes table to `downloadReport()` HTML builder
- Added High-Impact Moves section with styled cards
- HIM replaces Recommendations in PDF when present (same fallback pattern as UI)

### Sprint 4 Session 2 — CRM Integration / FINAL SPRINT (Items 26-27)

**26. Attio CRM Push**
**New File:** `functions/services/attioClient.js` (~173 lines)
- Uses Attio V2 REST API (`https://api.attio.com/v2`) with native `fetch` (Node 22)
- `pushLeadToAttio(lead, report)` — Creates Company record + Person record + Intel Signal note
- `pushAllLeadsToAttio(leads, report)` — Bulk push with concurrency limit of 3, 500ms delay
- `buildAttioNote(lead, report)` — Multi-line plaintext note with full enrichment data
- Routes: `POST /attio/push-lead`, `POST /attio/push-all`
- Env: `ATTIO_API_KEY` in `.env` (NOT in secrets[])

**27. Instantly Sequence Trigger**
**New File:** `functions/services/instantlyClient.js` (~100 lines)
- Uses Instantly V1 API (`https://api.instantly.ai/api/v1`) with native `fetch`
- **SEPARATE** from existing `instantlyService.js` (which uses per-user API keys for pre-call brief flow)
- `getInstantlyCampaigns()` — Fetches up to 20 campaigns
- `pushLeadToInstantly(lead, campaignId, report)` — 7 custom variables from Intel Signal
- `pushLeadsToInstantly(leads, campaignId, report)` — Sequential with added/skipped/failed tracking
- Routes: `GET /instantly-market/campaigns`, `POST /instantly-market/push-leads`
- Route prefix: `/instantly-market/*` to avoid collision with existing `/instantly/*`
- Env: `INSTANTLY_API_KEY` in `.env` (NOT in secrets[])

### New Files Summary (March 30)

| File | Purpose |
|------|---------|
| `functions/services/demographicsEnricher.js` | Census ACS API enrichment (population, income, home value, growth) |
| `functions/services/sentimentExtractor.js` | Gemini review sentiment extraction (praise, complaints, standout) |
| `functions/services/attioClient.js` | Attio V2 CRM client (Company + Person + Intel Signal note) |
| `functions/services/instantlyClient.js` | Instantly V1 market intel client (campaigns + lead push) |

### New Env Vars (March 30)

| Var | Location | Purpose |
|-----|----------|---------|
| `ATTIO_API_KEY` | `.env` only (NOT secrets[]) | Attio CRM API authentication |
| `INSTANTLY_API_KEY` | `.env` only (NOT secrets[]) | Instantly market intel push (separate from per-user Instantly integration) |

### New API Endpoints (March 30)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/market/refresh/:reportId` | Report refresh (50 credits) |
| GET | `/market/match` | Pre-call brief auto-match by city/state/industry |
| GET | `/benchmarks/:industry/:city/:state` | PathManager benchmark read |
| GET | `/benchmarks/search` | Benchmark fuzzy search |
| POST | `/attio/push-lead` | Single lead CRM push to Attio |
| POST | `/attio/push-all` | Bulk lead CRM push to Attio |
| GET | `/instantly-market/campaigns` | List Instantly campaigns (market intel) |
| POST | `/instantly-market/push-leads` | Push leads to Instantly sequence |

### New Firestore Collections (March 30)

| Collection | Key | TTL | Purpose |
|------------|-----|-----|---------|
| `marketBenchmarks/{industry}_{city}_{state}` | industry + city + state | 30 days | Cross-product benchmark data for PathManager |

### Known Issues Resolved (March 30)

| Issue | Resolution |
|-------|-----------|
| Executive summary leader misidentification | Fixed by `identifyMarketLeader()` composite score (item 22) |
| ICP vertical ceiling bypass | Fixed by hard exclusion branch (item 1) |

### Architecture Notes (March 30)

- **Two Instantly integrations coexist:** `instantlyService.js` (per-user API keys, pre-call brief flow, `/instantly/*` routes) and `instantlyClient.js` (global API key, market intel push, `/instantly-market/*` routes). Do NOT merge them.
- **Native fetch preferred:** New services (`attioClient.js`, `instantlyClient.js`) use Node 22 built-in `fetch`. Older services use axios or node-fetch. Do not refactor existing services to match.
- **Market Intelligence is FEATURE COMPLETE** as of this session. No further sprints planned. Next priorities: Chrome Extension, Universal Onboarding, Multi-agent pipeline refactor.

---

## Session — April 17, 2026

### Entity360 Account360 Integration

**New file:** `functions/utils/entity360Service.js`
- `syncReportToAccount360(reportData)` — creates or updates Account360
  document in Entity360 after every Market Intelligence Report generation
- `syncOutboundStatus(accountId, updateType, payload)` — updates Attio/
  Instantly push status in Entity360 after SynchIntro executes pushes
- `buildSyncPayload()` — maps SynchIntro report fields to Entity360
  provenance format (sourceTier: 2, confidence: 0.8)
- All fetch calls pass `Authorization: Bearer ENTITY360_INTERNAL_API_KEY`

**Modified:** `functions/api/market.js`
- Import added: `const { syncReportToAccount360 } = require('../utils/entity360Service')`
- Non-blocking `.then().catch(() => {})` call after report Firestore write at line ~1440
- Maps serperLeads[0] (highest opportunity-scored lead) to Entity360 sync payload
- Entity360 failure never throws to caller — report generation completes normally

**New env vars in `functions/.env`:**
- `ENTITY360_SERVICE_URL=https://entity360-218613212853.us-central1.run.app`
- `ENTITY360_INTERNAL_API_KEY` — service-to-service auth key (matches INTERNAL_API_KEY on Cloud Run)

SynchIntro is the intelligence push layer — Entity360 never calls back.

---

## PathSynch Admin Panel (April 20, 2026)

PathSynch Admin Panel is a **separate product** hosted on the PathManager backend. It is NOT part of this Firebase project.

- **Repo**: `PathSynch-CEO/pathsynch-admin` (GitHub private)
- **Routes file**: `src/v1_0/api/admin/adminRoutes.js` in `PathManager_backend` repo
- **Mounted at**: `/api/admin` on PathManager backend EC2 (`3.88.108.6:3000`)
- **Auth**: `x-admin-key` request header — separate `ADMIN_API_KEY` env var, **not** Firebase Auth
- **Data source**: `col_users` MongoDB collection via the PathManager merchant model (primary DB connection)

No SynchIntro Firebase functions are called by the admin panel. The admin panel does not interact with Firestore, Firebase Auth, or any `pathsynch-pitch-creation` project resources.

---

## Competitive Intelligence & Integration Radar (April 21, 2026)

### Adjacent / Competitive Landscape

**Eragon AI** (`eragon.ai`)
- Enterprise AI OS. $12M seed, $100M post-money valuation. CEO: Josh Sirota (ex-Oracle, ex-Salesforce). LAUNCH batch 34.
- Post-trains Qwen/Kimi models on customer data. $5/M tokens pricing.
- **ICP:** Enterprise — not direct competition with SynchIntro's SMB ICP.
- **Strategic relevance:** "Own your intelligence" thesis directly validates the Entity360 + Merchant Memory Framework direction SynchIntro is building toward at the merchant level. Partnership ecosystem model (they integrate with CRMs/ERPs) worth studying.
- **Action:** Monitor; not a partnership target given enterprise vs SMB ICP gap.

### Integration Partners Under Evaluation

**Orange Slice AI** (`orangeslice.ai`)
- Agentic sales enrichment spreadsheet. YC S25, $5.3M seed. Founders: Vihaar Nandigala, Kishan Sripada.
- Clay alternative with TypeScript-first architecture. 100+ enrichments, waterfall across 50+ sources.
- **Stack overlap:** Integrates natively with Attio + Instantly — both already in SynchIntro's stack.
- **API status:** No public API as of April 2026. Webhook inbound supported.
- **Outreach:** Initiated contact with Vihaar Nandigala (April 2026).
- **Three integration concepts under evaluation:**
  1. **Lead buckets** — "Expand List" button on Market Intel reports pulling 25–1,000 enriched leads.
  2. **Additional report types** — Competitive Deep Dive, E-commerce Landscape, Hiring Signal Scan as new dropdown options on the Market Intel form.
  3. **Onboarding enrichment** — auto-enrich new merchant's prospect list during onboarding flow.
- **Status:** Concepts only. No implementation started. Blocked on API availability.

---

## Session — April 22, 2026 (Evening)

### Server-Side Pricing Calculator — Multi-Location & Integrations

**File: `functions/api/pitchGenerator.js`**

Extended the pricing calculator post-loop block:

**`per_unit` case update:** Products whose name contains "integration" now skip the automatic `perUnitPrice` → `totalMonthly` addition. Instead they emit a descriptive line item (`first 3 free, +$X/mo each additional`), leaving all arithmetic to the `integrationCount` post-loop block. This prevents double-counting when `integrationCount` > 0.

**Integrations post-loop block (new):**
```javascript
const integrationCount = Math.max(0, parseInt(body.integrationCount) || 0);
if (integrationCount > 0) {
    const integrationProduct = rawSelectedProducts.find(p =>
        (p.productName || p.name || '').toLowerCase().includes('integration')
    );
    const unitPrice = parseFloat(integrationProduct?.perUnitPrice) || 19;
    const additionalCost = integrationCount * unitPrice;
    totalMonthly += additionalCost;
    lineItems.push(`${integrationCount} additional integration${integrationCount !== 1 ? 's' : ''} — $${additionalCost}/mo`);
}
```

Runs BEFORE the `locationCount` multiplier so multi-location correctly scales integrations.

**Location multiplier (no change to logic, clarification):**
```javascript
const locationCount = Math.max(1, parseInt(body.locationCount) || 1);
if (locationCount > 1) {
    totalMonthly = totalMonthly * locationCount;
    totalSetup   = totalSetup   * locationCount;
    inputs.locationCount = locationCount;
}
```

**Pricing order of operations:** Per-product loop → integrations add-on → location multiply → set `inputs.monthlyTotal` / `inputs.setupFee`.

### Template Section Resolver — selectedProducts Priority

**File: `functions/services/templateSectionResolver.js`**

`product_line_items` case now checks `dataContext.pitch.selectedProducts` before falling back to AI-generated `solutionPackage.products`:

1. `resolvePath(dataContext, field.source)` — template-defined source path
2. `dataContext.pitch.selectedProducts` — actual user selection from server calc
3. `aiResults.solutionPackage.products` — AI fallback (last resort only)

Prevents hallucinated product names (e.g., "PathConnect Growth" when only "PathConnect Starter" was selected).

### Previously Documented — Morning Session (same date)

See earlier April 22, 2026 entry for: `custom` pricing fix (`setupFee` + `oneTimeFee`), landing page complaint themes override, `landingPageRoutes.js` `pitchData.html` fix.

### Deployed

Functions deployed — both morning and evening changes live as of April 22, 2026.


---

## Session — April 24, 2026

**Deployed to production (functions). Prospect Intel enrichment pipeline — M1-1 through M1-3 backend complete. Google Places fallback added.**

### New Files

| File | Purpose |
|------|---------|
| `functions/services/prospectIntelService.js` | Core enrichment service — batch creation, Cloud Tasks fan-out, agent calling, Fit Score engine, credit deduction |
| `functions/routes/prospectIntelRoutes.js` | 6 REST endpoints under `/prospect-intel/*` |

### Prospect Intel Service (`prospectIntelService.js`)

**Exports:**

| Export | Description |
|--------|-------------|
| `calculateFitScore(agentData, csvData, icpProfile)` | Scores 0-100 against 7 ICP buying signals; returns fitScore, fitLabel, signalHits, disqualified, disqualifyReason |
| `classifyRecommendedProduct(agentData, productFocus)` | Maps enrichment signals to PathSynch product recommendation |
| `buildSourceAttribution(value, source, confidence)` | Wraps field value in provenance schema { value, source, confidence, updatedAt, failureReason } |
| `callResearchAgent(businessName, city, state)` | POSTs to Cloud Run agent at PROSPECT_AGENT_URL, 30s timeout |
| `processOneProspect(batchId, prospectId)` | Full enrichment pipeline for a single prospect (read -> agent -> Places fallback -> score -> write) |
| `deductProspectCredits(userId, count, batchId)` | 15 credits/prospect from users/{uid}.credits; logged to creditLedger with idempotency key |
| `enqueueProspectTask(batchId, prospectId)` | Creates Cloud Tasks HTTP task -> processProspectTask Cloud Function |

**Fit Score buying signals (7):**

| Signal Key | Weight | Condition |
|-----------|--------|-----------|
| low_rating | 25 | googleRating > 0 && googleRating < 4.3 |
| low_reviews | 20 | totalReviews < 50 |
| incomplete_gbp | 15 | No GBP or missing city address |
| outdated_website | 15 | No website or websiteUrl === "None" |
| no_review_response | 15 | reviews < 20 && rating < 4.0 |
| owner_title | 10 | Contact title matches ICP targetTitles |
| industry_match | 10 | Prospect industry in ICP industries |

**Disqualification checks (run before scoring):**
- high_rating: rating >= 4.8 AND reviews >= 500 -> fitScore: 0
- too_large: reviews > 200 -> fitScore: 0
- franchise_corp: name contains "franchise"/"corporate" patterns -> fitScore: 0

**Fit labels:** Strong Fit (>=70) | Good Fit (>=50) | Moderate Fit (>=30) | Low Fit (<30)

### Google Places Fallback in `processOneProspect`

After `callResearchAgent()` returns, if `googleRating == null` OR `websiteUrl` is null/"None"/empty:

1. Calls `lookupProspectPlace(businessName, city, state)` (new export in `googlePlaces.js`)
2. textSearch query uses business name + city + state -> rating, totalReviews, placeId from result[0]
3. If placeId exists -> `getPlaceDetails(placeId)` -> websiteUrl and phone
4. Missing fields patched onto agentResult before buildSourceAttribution
5. Source attribution: 'google_places' with confidence: 'medium' (not 'high')
6. Phone backfilled if agent also missed it
7. Entire Places call is non-blocking -- any error is caught and logged, enrichment continues

**Cost:** 0 extra API calls when agent succeeds. Max 2 Places calls per failed prospect.

### Cloud Functions Registered

| Function | Type | Trigger |
|----------|------|---------|
| onProspectBatchCreated | Firestore trigger | prospectIntel/{batchId} onCreate |
| processProspectTask | HTTP (2nd Gen) | Cloud Tasks -- prospect-enrichment queue |

**onProspectBatchCreated flow:** Reads all prospect subdocs, enqueues each via enqueueProspectTask() (max 5 parallel), updates batch status: 'processing'.

**processProspectTask flow:** Validates X-Task-Secret header, parses { batchId, prospectId } from base64 body, calls processOneProspect(). Always returns 200.

### API Endpoints -- Prospect Intel

| Method | Path | Description |
|--------|------|-------------|
| POST | /prospect-intel/batch | Create batch + enqueue all tasks. Body: { rows[], mappings{}, icpProfileId, productFocus }. Returns { success, batchId, totalProspects } |
| GET | /prospect-intel/batch/:batchId | Read batch metadata + progress counters |
| GET | /prospect-intel/batch/:batchId/prospects | Paginated prospect list. Query: ?limit=200&status=enriched |
| POST | /prospect-intel/batch/:batchId/prospects/:prospectId/retry | Re-enqueue a single failed prospect |
| POST | /prospect-intel/batch/:batchId/rescore | Re-run Fit Score on all enriched prospects (no agent call) |
| GET | /prospect-intel/icp-profiles | List icpProfiles collection |

### Firestore Collections

| Collection | Purpose |
|-----------|---------|
| prospectIntel/{batchId} | Batch metadata: userId, status, totalProspects, completedCount, failedCount, icpProfileSnapshot, productFocus, createdAt |
| prospectIntel/{batchId}/prospects/{prospectId} | Per-prospect data: CSV fields + enrichment fields (all with source attribution) + fitScore + workflowStatus |
| icpProfiles/{profileId} | ICP definitions: buyingSignals[], disqualificationSignals[], targetTitles[], industries[] |
| creditLedger/{idempotencyKey} | Credit deduction audit log (idempotency key = prospect:{batchId}) |

### Infrastructure

- Cloud Tasks queue: prospect-enrichment (us-central1, project pathconnect-442522)
- Queue creation: gcloud tasks queues create prospect-enrichment --location=us-central1 --project=pathconnect-442522
- IAM required: 796921234100-compute@developer.gserviceaccount.com needs roles/cloudtasks.enqueuer on pathconnect-442522
- PROSPECT_AGENT_URL: https://prospect-research-218613212853.us-central1.run.app
- PROSPECT_TASK_HANDLER_URL: https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/processProspectTask
- PROSPECT_TASK_SECRET: shared secret for X-Task-Secret header

### Research Agent (Cloud Run)

URL: https://prospect-research-218613212853.us-central1.run.app
Endpoint: POST /api/research
Request: { businessName, city, state }
Response: prospectBusiness, websiteUrl, industry, subIndustry, address, phone, googleRating, totalReviews, tagline, topProducts, differentiators, targetCustomer, confidence

Google Places fallback fires when: googleRating == null OR websiteUrl is null/None/empty

### Live Validation

Batch ecz6yeXafZecjaM7Lr9E: 162 total, 133 enriched, 29 failed, 119 Strong Fit. Medical practices in Atlanta.

### New Env Vars

| Var | Description |
|-----|-------------|
| PROSPECT_AGENT_URL | Cloud Run agent base URL |
| PROSPECT_TASK_HANDLER_URL | Cloud Function URL for task handler |
| PROSPECT_TASK_SECRET | Shared secret for X-Task-Secret header |

### Updated Deployed Cloud Functions (as of April 24, 2026)

api (HTTP), onProspectBatchCreated (Firestore trigger), processProspectTask (HTTP/Cloud Tasks),
processThresholdAlerts (scheduled 6h), merchantBehaviorSync (scheduled Mon 09:00 UTC),
calibrateMerchant (callable), backfillConfidenceFields (callable),
weeklyDigest (scheduled), dailyDigest (scheduled), activityCleanup (scheduled), onUserCreated (Auth trigger)

---

## Session — May 13, 2026

**10-phase platform audit + all actionable findings fixed. Both repos deployed and merged to main.**

### Audit Score: 79/100 (B+)

Full report: `pathsynch-pitch-generator/SYNCHINTRO_AUDIT_REPORT_2026-05-13.md`

### Backend Fixes (pathsynch-pitch-generator)

**`functions/middleware/planGate.js`**
- Fixed stale `userData.tier` bug in `getUserPlan()`. The `tier` field is set to `'FREE'` at account creation and never updated by Stripe. Stripe writes to `subscription.plan`. Old code: `userData.plan || userData.tier` — stale FREE string won.
- Fixed priority chain:
  ```javascript
  const plan = userData?.subscription?.plan ||
               userData?.subscription?.tier ||
               userData?.plan ||
               userData?.tier;
  if (typeof plan === 'string') return plan.toLowerCase();
  else if (plan && typeof plan === 'object') return (plan.tier || 'starter').toLowerCase();
  return 'starter';
  ```
- This is a carry-forward constraint: `subscription.plan` MUST come before `userData.tier` in all plan extraction chains across the entire codebase.

**`functions/index.js`**
- Added global error handlers at top (after `API_VERSION` const):
  ```javascript
  process.on('unhandledRejection', (reason, promise) => { console.error('[UnhandledRejection]', reason); });
  process.on('uncaughtException', (err) => { console.error('[UncaughtException]', err); });
  ```
- Added `X-Admin-Key` auth to `backfillConfidenceFields` and `calibrateMerchant` exports. Key source: `process.env.ADMIN_BOOTSTRAP_KEY || process.env.PROSPECT_TASK_SECRET` (no new env var needed).

**`functions/routes/teamRoutes.js`**
- Wired `sendTeamInviteEmail()` call on `POST /team/invite` — was an empty TODO block since April 28.
- Email failure is non-blocking (try/catch, only `console.warn`). Invite record + 201 returned regardless.
- SendGrid key not yet active — email silently fails until `SENDGRID_API_KEY` is set in `.env`.

**`functions/services/agentLogger.js`**
- Deleted. Zero imports across all files (confirmed via grep). Was dead code from an earlier sprint.

**`README.md`**
- Changed `STRIPE_SECRET_KEY=sk_live_xxx` to `STRIPE_SECRET_KEY=your_stripe_secret_key_here`.

**`.github/workflows/ci.yml`**
- Added `deploy` job with `needs: [test]` and `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`.
- Deploy only runs after test job passes on main.

**`.github/workflows/deploy.yml`**
- Deleted. Was a standalone deploy workflow with no `needs:` — ran in parallel with CI, defeating the gate.
- NOTE: `needs` keyword only works within the same workflow file. Cross-workflow `needs` is not supported. Always keep deploy jobs in ci.yml.

### Deploy Issues Encountered

| Issue | Resolution |
|-------|-----------|
| Firebase auth expired | `firebase login --reauth` |
| Orphaned `onEnrichmentJobCreated` blocked deploy | `firebase functions:delete onEnrichmentJobCreated --region us-central1 --force` |
| Transient GCP timeout on `backfillConfidenceFields` + `onUserCreated` | Redeployed individually: `firebase deploy --only functions:backfillConfidenceFields,functions:onUserCreated` |
| Git push rejected (remote ahead) | `git pull origin main --no-rebase` + auto-merged cleanly |

### Commits

| Commit | What |
|--------|------|
| 964815b | Post-merge main — all audit fixes, CI pipeline consolidation |

### Skipped (Backlog)

- SendGrid API key (`SENDGRID_API_KEY`) — email calls wired but key not set. Non-blocking.
- `index.js` monolith migration to route files
- `.env.example` creation
- Credit deduction atomicity (double-spend window)
- Console.log cleanup (production logging noise)
- Stripe SDK v14 → v22 upgrade
- innerHTML XSS audit (pitchGenerator.js)

---

## Session — May 13, 2026 (Industry Taxonomy Sprints 1–3)

**Deployed to production (backend functions + hosting). Industry Taxonomy Config, Market Intel Intelligence Upgrade, and Integration Metadata Pass-Through.**

### Sprint 1 — Industry Taxonomy Config + UI

#### New Files

| File | Purpose |
|------|---------|
| `functions/config/industryTaxonomy.json` | Canonical source of truth — 22 industries, all sub-industries with IDs/labels/aliases |
| `functions/config/industryTaxonomy.js` | Backend wrapper: `findIndustry()`, `findSubIndustry()`, `buildSearchQueries()`, `normalizeTaxonomyKey()`, `getIndustryLabels()`, `getSubIndustryLabels()` |
| `scripts/sync-taxonomy.cjs` | Copies JSON → `synchintro-app/config/` and verifies identity. `.cjs` because repo root has `"type": "module"` |

#### Key Facts

- **22 industries** (not 23 — existing codebase had 16 incl. Professional Services + Other, + 6 new = 22)
- **6 new industries**: Agencies & Marketing Services, Construction & Trades, Government & Public Sector, Hospitality & Lodging, Media & Entertainment, Nonprofit & Associations
- **Professional Services**: expanded from 5 → 14 sub-industries
- `normalizeTaxonomyKey()` handles: `&` → `and`, `+` → `and`, hyphens/spaces/case — so "Health & Wellness" and "health-and-wellness" both match
- Sync script: `node scripts/sync-taxonomy.cjs` (run after ANY change to taxonomy JSON)
- **Modified**: `functions/services/verticalQuestions.js` — Professional Services updated, 6 new VERTICAL_QUESTIONS templates added

### Sprint 2 — Market Intel Intelligence Upgrade

#### New Files

| File | Purpose |
|------|---------|
| `functions/config/scoringProfiles.js` | 4 scoring profiles: `default_local_business` (ceiling 400), `b2b_services` (150), `government_public_sector` (75), `nonprofit_association` (150). `getScoringProfile()` + `resolveWeights()` (proxy mapper) |
| `functions/config/reportProfiles.js` | Matching report language profiles: competitor/opportunity/leads language, section avoid-lists, `promptInjection` text appended to Gemini prompts. `getReportProfile()` |

#### Changes to `functions/api/market.js`

- Added imports: `industryTaxonomy`, `scoringProfiles`, `reportProfiles`
- `resolveTaxonomyForReport()` helper — backfills taxonomy fields on legacy reports (backward compat, never throws)
- Taxonomy resolution block after `detectVertical()`: resolves `industryConfig`, `subIndustryConfig`, `scoringProfile`, `reportProfile`, `benchmarkKey`, `profileContext`, `primaryTaxonomyQuery`
- Profile context appended to `aiIndustryContext` — Gemini prompts receive industry-specific language (never replacing existing prompts)
- Serper query uses taxonomy sub-industry label
- `verticalCeiling` uses `scoringProfile.reviewCeiling` (was hardcoded 400)
- Report Firestore write: 10 taxonomy fields added (`taxonomyVersion`, `industryId/Label`, `subIndustryId/Label`, `scoringProfile`, `reportProfile`, `benchmarkKey`, `queryTemplateUsed`, `searchQueryUsed`)
- Benchmark write: `taxonomyVersion`, `industryId`, `benchmarkKey`, `scoringProfile` added alongside existing fields
- Analytics event: structured JSON log after benchmark write (`market_report_generated`)
- Refresh endpoint: `resolveTaxonomyForReport()` used on existing doc, resolved fields stored back on update

#### Integration check results

- Gov ceiling: **75** ✓ | Gov language: **peer entities** ✓ | F&B ceiling: **400** ✓ | Version: **1.0.0** ✓

### Sprint 3 — Integration Metadata Pass-Through + Enrichment Readiness

#### New File

| File | Purpose |
|------|---------|
| `functions/services/enrichmentWaterfall.js` | TODO hooks only — `ENRICHMENT_FIELDS` contracts, stub functions for Apollo, PDL, Clay, HubSpot. All return `null` when env var missing. No live API calls. |

#### Integration Changes

| File | Change |
|------|--------|
| `functions/utils/entity360Service.js` | `buildSyncPayload()` now includes `taxonomyMetadata` block (9 fields). Non-blocking. |
| `functions/services/attioClient.js` | Attio push includes 11 taxonomy/intelligence fields. Analytics event `market_attio_push` added. |
| `functions/services/instantlyClient.js` | Market Intel Instantly push only — 7 new `custom_*` variables added (`custom_industry`, `custom_sub_industry`, `custom_opportunity_gap`, `custom_report_profile`, `custom_intel_signal`, `custom_recommended_angle`, `custom_peer_language`). Per-user Instantly integration untouched. Analytics event `market_instantly_push` added. |
| `functions/services/prospectIntelService.js` | NemoClaw handoff: `taxonomyCampaignContext` added to payload. All guardrails preserved. |
| `functions/services/opportunityBriefService.js` | `BRIEF_TITLES` map by report profile, `brief.title` set dynamically, profile prompt injection appended to Gemini narrative prompt. Analytics event `market_opportunity_brief_generated` added. |

#### Brief Title Mapping

| reportProfile | Brief Title |
|---|---|
| `government_public_sector` | Public Engagement Modernization Brief |
| `nonprofit_association` | Community Visibility & Member Engagement Brief |
| `b2b_services` | Market Positioning & Client Acquisition Brief |
| `default_local_business` | Opportunity Brief (unchanged) |

#### Enrichment Waterfall — Future Env Vars Needed

| Provider | Env Var | Status |
|----------|---------|--------|
| Apollo | `APOLLO_API_KEY` | TODO |
| People Data Labs | `PDL_API_KEY` | TODO |
| Clay | `CLAY_API_KEY` + `CLAY_TABLE_ID` | TODO |
| HubSpot | `HUBSPOT_ACCESS_TOKEN` | TODO |

### Commits

| Commit | What |
|--------|------|
| `56bedd5` | Sprint 1 — taxonomy JSON, wrapper, sync script, 6 new industries, vertical questions |
| `a5f8edb` | Sprint 2 — scoring profiles, report profiles, market.js surgical updates |
| `942125e` | Sprint 3 — integration metadata pass-through, enrichmentWaterfall.js |

---

## Hotfix — May 13, 2026 (Post-Taxonomy Sprint Bugs)

**Three production bugs fixed and deployed. Backend `2ea3848`, Frontend `1f55399`.**

### Bug 1 (P0) — Competitor search returning wrong businesses (restaurants)

**Root cause:** `fetchCompetitors()` used `industryDetails.placesKeyword` from the NAICS config as the Google Places search keyword. For "Agencies & Marketing Services", the NAICS lookup fell through to code `722511` whose `placesKeyword` is `'restaurant'`. The taxonomy-aware `primaryTaxonomyQuery` (e.g. `"Digital Marketing Agency Atlanta GA"`) was built at Sprint 2 line ~419 but was never passed into `fetchCompetitors`.

**Fix in `functions/api/market.js`:**
- Added `taxonomyQuery: primaryTaxonomyQuery` to the `fetchCompetitors` call
- Added `taxonomyQuery = null` parameter to `fetchCompetitors` signature
- `const placesKeyword = taxonomyQuery || industryDetails?.placesKeyword;` at top of function
- All 3 occurrences of `industryDetails?.placesKeyword` inside `fetchCompetitors` replaced with `placesKeyword`

**Carry-forward:** `primaryTaxonomyQuery` (from `buildSearchQueries()`) must be the first-priority keyword for ALL Google Places calls — NAICS keyword is the fallback only.

### Bug 2 (P1) — Sub-industry dropdown labels didn't match spec

**Root cause:** `functions/config/industryTaxonomy.json` had stale labels from Sprint 1 (e.g. "Creative / Full-Service Agency", "Digital Marketing / Performance Agency"). The frontend dropdown code was correct — it reads from the JSON via `getSubIndustryLabels()`. The JSON itself was wrong.

**Fix:**
- Updated all 11 Agencies & Marketing Services sub-industry labels in `functions/config/industryTaxonomy.json` to match the spec
- Ran `node scripts/sync-taxonomy.cjs` to propagate to `synchintro-app/config/industryTaxonomy.json`

**Correct Agencies & Marketing Services labels:**
1. Advertising & Creative Agency
2. Digital Marketing Agency
3. SEO & Content Agency
4. Social Media Agency
5. PR & Communications
6. Branding & Design Studio
7. Media Buying & Planning
8. Web Development Agency
9. Video / Content Production Agency
10. Experiential / Event Marketing Agency
11. Staffing & Recruiting Agency

### Bug 3 (P1) — Crime score missing from reports

**Root cause:** `utils/safetyContextService.js` and `utils/safetyContextNarrative.js` were complete implementations but were never imported or called in `market.js`. The frontend `renderSafetyContext()` was already wired and waiting for `report.safetyContext`.

**Fix in `functions/api/market.js`:**
- Added `require` for `getSafetyContext` and `generateSafetyContextNarrative`
- Added non-blocking try/catch block before Firestore save: calls `getSafetyContext({ zipCode, state })`, calls `generateSafetyContextNarrative`, assigns result to `reportData.safetyContext`

**IMPORTANT:** Crime data requires `ENABLE_CRIME_DATA_ENRICHMENT=true` in `functions/.env`. If the section still doesn't appear in reports, verify this env var is set.

### Carry-Forward Constraints

- Never use `industryDetails.placesKeyword` as the primary Places query — always use `primaryTaxonomyQuery` first
- After ANY change to `functions/config/industryTaxonomy.json`, run `node scripts/sync-taxonomy.cjs` immediately
- Crime score section: `ENABLE_CRIME_DATA_ENRICHMENT=true` required in `.env`

---

## Hotfix 2 — May 13, 2026 (Missing Report Sections + Broken Data Fields)

**Three issues fixed after Taxonomy Sprints 1–3 + Hotfix 1.**

### Bug 1 (P1) — Review Velocity section missing from B2B reports

**Root cause:** `functions/config/reportProfiles.js` had `"Review Velocity"` in `b2b_services.avoidSections`. This injected "Do NOT include: Review Velocity" into every Gemini prompt for B2B verticals, causing Gemini to suppress the section entirely.

**Fix in `functions/config/reportProfiles.js`:**
- Removed `"Review Velocity"` from `b2b_services.avoidSections`
- Added de-emphasis guidance to `b2b_services.promptInjection` text: "Review count and velocity are less critical for B2B; weight qualitative positioning over volume metrics."
- Government + Nonprofit `avoidSections` retained for truly inapplicable commercial sections ("Promotional Offers", "Sales Pipeline", etc.)

**Carry-forward:** `avoidSections` is a hard suppression ("Do NOT include"). Use it only for sections that are completely inapplicable to a vertical. For sections that should be de-emphasized, use `promptInjection` language instead.

### Bug 2 (P1) — Top Product Recommendations table shows "undefined" / blank rows

**Root cause:** `synchintro-app/js/pages/market.js` `renderProductRecommendations()` referenced fields that didn't exist on all product objects (`p.name`, `p.price`). Different backend response shapes use different field names.

**Fix in `synchintro-app/js/pages/market.js`:**
- Name: `p.name || p.product`
- Price: `p.price || (p.monthlyPrice ? p.monthlyPrice + '/mo' : '')`
- Reason: `p.reasons || p.reason || p.description`
- Added null guard: skips table row if resolved name is falsy or `'undefined'`

### Bug 3 (P2) — No logging when crime data flag is off

**Fix in `functions/utils/safetyContextService.js`:**
- Added `console.log('ENABLE_CRIME_DATA_ENRICHMENT not set — skipping crime data')` when env var is absent
- Helps distinguish "flag not set" from "API error" in Cloud Functions logs

### Known Non-Issues (Do Not Re-investigate)

- **Enhanced Overview Score donut / Growth Factors breakdown** — `functions/utils/opportunityScoreEngine.js` exists but is NOT imported in `market.js`. The frontend card renders "coming soon" placeholders. This is a missing feature, not a regression. Future sprint item.
- **Competitive Activity + Aggregated Velocity cards** — These are intentional "v2 — coming soon" placeholder cards in the Intent Signals tab. Not bugs.

### Numeric Safety Utility

**New file: `functions/utils/numericSafety.js`**

Three exported functions to prevent NaN/undefined propagation in scoring and display:
- `safeNumber(value, fallback=0)` — coerces to finite number or returns fallback
- `safePercent(numerator, denominator, fallback=0)` — safe division × 100
- `normalizeReviewCount(business)` — checks `reviews`, `reviewCount`, `review_count`, `user_ratings_total`, `totalReviews` fields in order

Use `safeNumber` / `safePercent` in any scoring math that touches external data. Use `normalizeReviewCount` whenever reading review counts from Places / competitor data.
