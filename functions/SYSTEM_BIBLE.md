## Immutable Invariants (Never Change)

Cross-referenced index of platform rules that must never be violated. Each entry points to the dated session that established it — go there for full context and rationale.

1. **Gemini model hierarchy:** PRIMARY `gemini-3-flash-preview`, ADVANCED `gemini-3.1-pro-preview`, SIMPLE `gemini-2.5-flash`; always `thinkingBudget: 0` for JSON output. Banned: `gemini-1.5-*`, `gemini-2.0-*`, `gemini-3-pro-preview`. *(Established: CLAUDE.md GEMINI MODEL RULES, updated March 29, 2026)*

2. **Gemini call form:** ALWAYS `generateContent({ contents: [...] })` object form — never pass an array directly. *(Established: CLAUDE.md Hotfix May 14, 2026 — Bug A)*

3. **`generateStructured()` throws on failure** — never fall back to unstructured generation. Failure means a bug to fix in prompt or schema. *(Established: CLAUDE.md Session April 7, 2026 — Structured Generation Helper)*

4. **Billing helpers:** Use `checkAndDeductCredits` / `refundCredits` / `writeCreditLedger` from `functions/api/billing.js`. Ledger collection is `creditLedger`. Return 503 (not 402) on `BILLING_TRANSACTION_FAILED`. *(Established: Billing Helpers, May 24, 2026 — this file line ~595)*

5. **Canonical Firestore rules source** = `pathsynch-pitch-generator`. Never bare `firebase deploy` from `synchintro-app` — always `--only hosting`. *(Established: Canonical Firestore Rules Source, June 25, 2026 — this file line ~741)*

6. **`teamInvitations` (with "on") is canonical; `teamInvites` is dead Schema A — never query it.** *(Established: Team Invitation Architecture, June 29, 2026 — this file line ~793)*

7. **Workspace bootstrap MUST be followed by `scripts/backfill-workspaceid.js --write`** or legacy docs vanish from the workspace-scoped UI. *(Established: Workspace — Production State, June 25, 2026 — this file line ~763)*

8. **Identity field convention:** `req.userId` is derived from `decodedToken.uid` in middleware; Firestore docs are owner-scoped on `userId == request.auth.uid` (33 occurrences in `firestore.rules`). *(Evidenced: `functions/middleware/` auth chain + `firestore.rules` across all collections)*

9. **Intentional DB typos (PathManager-scoped — NOT used in SynchIntro):** `buisnessName`, `buisnessAddress`, `STRIPE_SECRETE_KEY`, and `req.user.sub` = merchant `_id`. These are PathManager/MongoDB conventions. Do NOT "correct" them in PathManager code. They do not apply to this repo's Firestore schema. *(Referenced: AIsynch_Technical_Architecture_v2.md, AIsynch_Claude_Code_Prompt_Final.md)*

---

## White-Label Branding System (May 2026)

### `resolvedBrand` Contract

All callers of `resolveBrand(userId)` receive an object with these fields:

| Field | Type | Notes |
|-------|------|-------|
| `companyName` | string | Agency or PathSynch default |
| `contactName` | string | |
| `contactTitle` | string | |
| `contactEmail` | string | |
| `website` | string | |
| `accentColor` | string | Hex color |
| `logoUrl` | string \| null | Firebase Storage download URL |
| `logoStoragePath` | string \| null | For deletion |
| `logoMimeType` | string \| null | |
| `useCustomBranding` | boolean | **Always present.** `false` = toggle off; renderers must check this field and fall back to PathSynch defaults when false |

### Plan Capability Gating

| Capability | Minimum tier |
|-----------|-------------|
| Use custom branding toggle | All tiers |
| Company name, contact details, website | Growth |
| Logo upload | Scale |
| Accent color picker | Scale |

### `effectiveTier` Logic

`resolveBrand()` fetches `users/{uid}` in the same parallel batch as `agencyEntitlements/{uid}` and `agencyBrandOverrides/{uid}`. After resolving entitlements via `_defaultEntitlements(userDoc)`, it computes `effectiveTier` by comparing the entitlements doc tier to the subscription tier using `TIER_RANK = { starter:0, growth:1, scale:2, enterprise:3 }` and taking the higher of the two. **A seeded starter entitlements doc never blocks a paying Scale user.**

### Authoritative Plan Field

`users/{uid}.plan` (top-level Firestore field) is checked first. Fallback order: `userDoc.plan` → `userDoc.tier` → `userDoc.subscription.plan` → `userDoc.subscription.tier`.

### `useCustomBranding` Toggle Behavior

When `overrides.useCustomBranding === false`, `resolveBrand()` returns PathSynch defaults immediately. The user's saved Firestore config is **preserved** in `agencyBrandOverrides` — it is just not applied. Re-enabling the toggle restores the saved config without re-entry.

### Firestore Collections

| Collection | Client write? | Rule summary |
|-----------|---------------|-------------|
| `agencyBrandOverrides/{userId}` | Yes (owner only) | read + create + update; no delete |
| `agencyEntitlements/{userId}` | No | read only; write blocked |

### Invariants

1. Never write `planTier`, `mode`, `canUseCustomLogo`, `canUseCustomColors` to `agencyBrandOverrides` — those are entitlement fields managed server-side only.
2. All renderers that consume `resolvedBrand` must check `useCustomBranding` before applying agency values.
3. `effectiveTier` always uses the higher of entitlements doc vs subscription.
4. `users/{uid}.plan` (top-level) is the authoritative plan field.

---

## Prospect Enrichment Pipeline (Sprint 3+4 — March 26, 2026)

### New Files

**functions/agents/prospectResearchAgent.js** (560 lines)
Vertex AI Deep Search pattern. 5 tools: google_places_lookup,
competitor_scan, website_scrape, news_search, gbp_completeness_check.
Model: gemini-2.0-flash via agentRunner.js. **[NOTE 2026-06-30: `gemini-2.0-flash` predates the canonical model hierarchy — confirm this agent has been migrated to `gemini-3-flash-preview`.]** Returns PROSPECT_INTELLIGENCE JSON:
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
UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2 **[CORRECTION 2026-06-30: This UID is DEFUNCT — do not use. Canonical David Hailey / Countifi UID is `IQaKauAsYnbRFmwKNQPTZj1FqsL2`.]**
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

---

## AIsynch — AI Readiness Scoring Product (Phase 1A, May 20-21, 2026)

AIsynch is a standalone product that scores local SMBs on AI readiness across 6 pillars and surfaces actionable recommendations. Integrated into PathManager dashboard. Free scan funnel available for pathsynch.com website embed.

### Tiers & Pricing

| Tier | Monthly Price | AISYNCH_AMOUNTS constant |
|------|--------------|--------------------------|
| `lite` | $0 | 0 |
| `starter` | $49 | 4900 |
| `growth` | $99 | 9900 |
| `scale` | $199 | 19900 |

Stripe Price ID env vars: `AISYNCH_PRICE_ID_STARTER`, `AISYNCH_PRICE_ID_GROWTH`, `AISYNCH_PRICE_ID_SCALE`. Read at call time (not module load) to support test env override.

### LocalSynch Bundle Map

Merchants on a LocalSynch PathManager plan receive a bundled AIsynch tier at no extra charge:

| PathManager Plan | Bundled AIsynch Tier | bundledFree |
|-----------------|---------------------|-------------|
| `local_growth` | `lite` | true |
| `local_authority` | `starter` | true |

`LOCALSYNCH_BUNDLE_MAP` is defined in `functions/services/aisynchBilling.js`. When `bundledFree: true`, do not create a Stripe subscription item — entitlements are granted by plan membership.

### Firestore Collections

| Collection | Key Fields | Purpose |
|------------|-----------|---------|
| `aisynchSubscriptions/{merchantId}` | tier, stripeSubscriptionItemId, bundledFree, activatedAt, canceledAt | Tier state per merchant |
| `aisynchRateLimits/global` | dailyCount, date | Global free scan daily counter (atomic transaction, cap: 500/day) |
| `aisynchScans/{scanId}` | businessName, businessAddress, score, pillars, actions, ipHash, fingerprintHash, createdAt | Free scan results |

### Billing Flow

- **Attach to existing Stripe subscription:** Use `stripe.subscriptionItems.create({ subscription, price })` — NOT `checkout.sessions.create`. AIsynch charges attach to the merchant's existing PathManager Stripe subscription.
- **Entitlements** (`AISYNCH_ENTITLEMENTS` in `aisynchBilling.js`): each tier defines `{ maxScans, reportHistory, pillarsUnlocked, actionsUnlocked, apiAccess }`.
- **Cancel:** Remove subscription item via `stripe.subscriptionItems.del(itemId)` — reverts merchant to `lite`.

### Scoring Engine (6 Pillars)

Defined in `functions/services/aiReadinessScorer.js` (1,087 lines, 68 tests):

| Pillar | Focus Area |
|--------|-----------|
| 1 | GBP / Local Presence |
| 2 | Review Profile |
| 3 | Website Signals |
| 4 | Citation & AI Visibility |
| 5 | Content & Freshness |
| 6 | Competitive Positioning |

Each pillar returns: `score` (0–100), `confidence` (low/medium/high), `weight`, `actions[]`. Overall score is weighted sum with confidence band.

### Free Scan Endpoint

`functions/api/aiReadinessScan.js` (438 lines, 34 tests). Exported as standalone 2nd Gen Cloud Function `aiReadinessScan` in `functions/index.js`.

- **Cloudflare Turnstile:** TURNSTILE_SECRET_KEY env var — validates widget token before scoring
- **Rate limits:** IP-based + device fingerprint, configurable per env
- **Global cap:** 500 scans/day via Firestore atomic counter at `aisynchRateLimits/global`
- **Dev bypass:** `turnstileToken === 'test'` + `AISYNCH_ALLOW_TEST_TOKEN=true` — REMOVE BEFORE PRODUCTION LAUNCH
- **Cloud Function URL:** `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aiReadinessScan`

### Dashboard API Bridge

`functions/api/aisynchDashboard.js` (402 lines, 8 tests). Exported as standalone Cloud Function `aisynchDashboard`.

- **8 endpoints:** score retrieval, history, actions, tier info, upgrade/downgrade, usage stats, comparisons
- **JWT auth:** HMAC-SHA256 signed token via `PATHMANAGER_JWT_SECRET`. PathManager EC2 generates; Cloud Function verifies on every request.
- **PathManager proxy:** `PathManager_backend/src/v1_0/api/aisynch/index.js` (197 lines) — in-memory cache (5–30 min TTL by endpoint) reduces cold-start impact
- **Cloud Function URL:** `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aisynchDashboard`

### Persistent Monitoring Cron (Phase 1B-1)

`functions/scheduled/aiVisibilityMonitor.js` (742 lines). Exported as `aiVisibilityMonitorCron` scheduled Cloud Function (3 AM ET daily).

- Processes active AIsynch subscribers in batches of 5 (2s pause between batches)
- Queries Gemini + Perplexity **in parallel** — stores per-model data in `aiVisibilitySnapshots.models.{model}`
- Writes aggregated `overallMentionRate` to `aiVisibilitySnapshots.aggregated`
- Updates `aiReadinessScores/{merchantId}.pillars.aiVisibility` after each run
- PII scrubbing before Firestore write
- Daily cost cap via `AISYNCH_DAILY_COST_CAP` env var (default $25)
- **Requires:** `ENABLE_AISYNCH_MONITORING=true`

### PathManager React Components (Phase 1A + 1B-2)

11 components in `PathManager_frontend/src/components/AIsynch/` (~1,200 lines total):

| Component | Tier | Purpose |
|-----------|------|---------|
| `AIsynchCard.jsx` | All | Dashboard card shell |
| `AIsynchScoreRing.jsx` | All | Circular score ring SVG |
| `AIsynchPillarBars.jsx` | All | 6-pillar bar chart |
| `AIsynchActions.jsx` | All | Recommended actions list |
| `AIsynchDetailView.jsx` | All | Expanded detail container (rewired Phase 1B-2) |
| `AIsynchUpgradePrompt.jsx` | All | Upgrade prompt for locked tiers |
| `aisynchApi.js` | All | API helper (calls EC2 proxy) |
| `AIsynchTrendChart.jsx` | Starter+ | Chart.js v4 line chart — 30/60/90-day mention rate |
| `AIsynchHeatmap.jsx` | Growth+ | Multi-model mention rate grid with competitor rows |
| `AIsynchCitations.jsx` | Growth+ | Citation domain table + gap analysis |
| `AIsynchReportModal.jsx` | Scale | Report generation modal (POST /report) |

### Env Vars

| Variable | Purpose | Where |
|----------|---------|-------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile validation | `functions/.env` |
| `AISYNCH_ALLOW_TEST_TOKEN` | Dev bypass (remove before prod) | `functions/.env` |
| `AISYNCH_PRICE_ID_STARTER` | Stripe price ID for starter tier | `functions/.env` |
| `AISYNCH_PRICE_ID_GROWTH` | Stripe price ID for growth tier | `functions/.env` |
| `AISYNCH_PRICE_ID_SCALE` | Stripe price ID for scale tier | `functions/.env` |
| `PATHMANAGER_JWT_SECRET` | HMAC secret for dashboard JWT auth | `functions/.env` + PathManager EC2 `.env` |

### Carry-Forward Rules

1. `AISYNCH_PRICE_IDs` must be read at call time in `aisynchBilling.js` — not at module load
2. `aisynchSubscriptions/{merchantId}` is the canonical tier state collection
3. `bundledFree: true` = no Stripe item — entitlement granted by LocalSynch plan membership
4. JWT auth: PathManager EC2 signs, `aisynchDashboard` verifies. Secrets must match. Never commit.
5. Dev bypass must be removed before production launch
6. Monitoring cron calls `queryGeminiGrounded()` + `queryPerplexity()` DIRECTLY in parallel — it does NOT call `enrichAiVisibility()`
7. Chart.js v4 is in PathManager frontend `package.json` (`^4.5.1`) — always destroy chart instance in cleanup to prevent canvas reuse errors
8. `AIsynchDetailView` is the container that gates and renders all sub-components — tier check uses `TIER_RANK` object, not string comparison
9. Global scan cap is atomic — always use Firestore transaction on `aisynchRateLimits/global`

---

## Market Intel v4 — Sales Enablement Sprint (May 26, 2026)

**Branch:** `feat/market-intel-v4`. 7 stories (S0-S6) deployed to production.

### Completed Stories

| Story | Name | Key Output |
|-------|------|-----------|
| S0 | Credibility Guardrails | `reportSanitizer.js` — 8 independent checks before `buildTieredResponse` |
| S1 | Market Definition & Query Transparency | `marketDefinitionBuilder.js` — lookup table, confidence scoring, supplemental queries |
| S2 | PathSynch Product Wedge per Lead | `computeProductWedge()` in `market.js` — 7-condition chain on every `serperLead` |
| S3 | Qualified Lead / Competitor / Reference Player Separation | `generateReferenceCompetitors()` in `narrativeGenerator.js` — national players with `isReferencePlayer: true` |
| S4 | Competitive Weakness Themes | `generateWeaknessThemes()` in `market.js` — 5-7 ranked aggregate weakness themes |
| S5 | Economic / Demographic Fit | `generateDemographicBusinessMeaning()` in `market.js` — 4-6 `{dataPoint, businessMeaning, salesUse}` items |
| S6 | Website Conversion Audit Pass 1 | `buildLighthouseAudit()` in `websiteSignalsProvider.js` — 13 Lighthouse signals, verdict badge |

### New Firestore Report Fields (marketReports documents)

| Field | Location | Added by |
|-------|---------|---------|
| `marketDefinition` | `report.data.marketDefinition` | S1 |
| `referenceCompetitors` | `report.data.referenceCompetitors` | S3 |
| `productWedge` | `report.data.leads[].productWedge` (serperLeads only) | S2 |
| `weaknessThemes` | `report.data.weaknessThemes` | S4 |
| `demographicBusinessMeaning` | `report.data.demographicBusinessMeaning` | S5 |
| `lighthouseAudit` | `report.websiteConversionSignals.leadSignals[].lighthouseAudit` | S6 |

`lighthouseAudit` shape: `{ signals: [{id, label, pass, issue}], verdict, passCount, failCount, evaluatedCount }`. `pass: null` means signal not evaluated — excluded from verdict denominator.

`productWedge` is only attached to `serperLeads` — never competitors or referenceCompetitors.

### Key Architecture Rules

- `reportSanitizer.js` is called in `market.js` right before `buildTieredResponse()` — each check is independent try/catch
- Reference competitor call runs sequentially BEFORE `Promise.allSettled` — `generateCompetitorAnalysis()` needs the names
- 6-char normalized prefix dedup prevents fuzzy duplicates in reference competitor list
- `auditPass()` returns null (not false) for absent Lighthouse audits — null excluded from verdict count
- Lighthouse verdict: ≥9 pass OR ≥69% = "Captures demand"; ≥6 OR ≥46% = "Leaks demand"; else = "Not converting local intent"
- `cityDemographics` has exactly 3 fields: population, medianIncome, medianHomeValue

---

## Billing Helpers — `functions/api/billing.js` (May 24, 2026)

Three canonical helpers ship alongside `checkCredits` and `deductCredits`. Always use these — never write a private copy.

### `checkAndDeductCredits(userId, required, reason, options)` → `{ allowed, available, deducted, error? }`

- Atomic Firestore transaction — eliminates double-spend race condition
- **FAILS CLOSED**: transaction error → `{ allowed: false, error: 'BILLING_TRANSACTION_FAILED' }`
- Routes MUST return **503** (not 402) on `BILLING_TRANSACTION_FAILED`
- Legacy accounts with no `credits` field: allowed, logged

### `refundCredits(userId, amount, reason, options)` → void

- Restores credits + writes positive ledger entry
- Non-blocking — failure is logged, never thrown to caller

### `writeCreditLedger(userId, amount, reason, service)` → void

- Shared ledger writer: negative = deduction, positive = refund
- Fire-and-forget — failure logged, never thrown

### Billing Patterns (canonical — use for all new endpoints)

| Pattern | When to use | Implementation |
|---------|-------------|----------------|
| Fixed-cost | Opportunity Brief, any single known credit cost | Atomic deduct in ROUTE before work; `refundCredits()` on hard failure in catch block |
| Variable-cost | Template Enrichment, any "reserve max / refund delta" flow | Reserve max upfront with `checkAndDeductCredits()`; call `refundCredits(unused)` after work completes |
| Guard-before-work | Intent Signals, any service that can return early | `checkAndDeductCredits()` BEFORE the expensive call; check `creditBlocked` return and bail early |
| creditBlocked handling | `market.js` after `generateIntentSignals` | `intentSignalsResult?.creditBlocked === true` → pass `null`, omit section from report |

### Rules

1. `billing.js` imports only `firebase-admin` — no circular dependencies
2. All credit writes go to the `creditLedger` collection
3. 503 on `BILLING_TRANSACTION_FAILED` — distinct from 402 (insufficient credits)
4. `refundCredits` and `writeCreditLedger` are always fire-and-forget — never await in a way that blocks the response
5. firebase-admin mock (`functions/__mocks__/firebase-admin.js`) handles `_increment` in `MockDocumentReference.update()` — required for billing tests

---

## Law 6 — Plan Tier Normalization (June 5, 2026)

All tier comparisons across the PathSynch platform must use canonical normalization. Never compare raw plan strings — normalize first.

### Canonical tier hierarchy

```
free (0) < starter (1) < growth (2) < scale (3) < agency (4)
```

### Normalization rules

1. **Input sanitization first:** `String(plan ?? '').trim().toLowerCase()` before any lookup.
2. **Strip `_yearly` suffix only from `pm*`-prefixed keys.** `pmgrowth_yearly` → `pmgrowth` → `growth`. `admin_yearly` is NOT a valid planKey and must fail closed to `free`.
3. **Unknown inputs fail closed to `free`.** Never grant access on an unknown value.
4. **Unknown `requiredTier` in gate checks must deny access.** A typo like `"growht"` normalizes to `"free"` via fallback; the gate must detect this and return `false`.

### Full planKey → tier map (canonical as of June 5, 2026)

| Input (lowercased, suffix stripped) | Tier | Source |
|--------------------------------------|------|--------|
| `pmfree`, `free` | `free` | PM canonical |
| `pmstarter`, `starter` | `starter` | PM canonical |
| `pmgrowth`, `growth` | `growth` | PM canonical |
| `pmpoweruser`, `scale` | `scale` | PM canonical |
| `pmenterprise`, `agency` | `agency` | PM canonical |
| `pmadmin` | `agency` | PM admin |
| `enterprise` | `agency` | PM legacy alias |
| `admin` | `agency` | PM legacy alias |
| `si_starter` | `starter` | SynchIntro (declared, routing only) |
| `si_growth` | `growth` | SynchIntro (declared, routing only) |
| `si_scale` | `scale` | SynchIntro (declared, routing only) |
| `si_enterprise` | `agency` | SynchIntro (declared, routing only) |

**SynchIntro internal gating** (`planGate.js` hierarchy) still uses unprefixed names stored in Firestore `users/{uid}.plan`: `starter`, `growth`, `scale`, `enterprise`. The `si_*` keys are PathManager checkout routing identifiers only.

### Implementation locations

| Location | Function | Status |
|----------|----------|--------|
| `PathManager_frontend/src/utils/planTierUtils.ts` | `normalizePlanTier()`, `meetsMinTier()` | Production (PRs #181–184) |
| `PathManager_backend/src/v1_0/api/entitlements/index.js` | `normalizePlan()` | Production (PRs #232–234) |
| `PathManager_backend/src/v1_0/utils/localSynchTierResolver.js` | `PLAN_KEY_TO_TIER` | Production (PR #232) |
| SynchIntro `functions/middleware/planGate.js` | `TIER_RANK` | Partial — SynchIntro-only tiers, no `pm*` keys |

---

## Security Posture — Firestore Rules Update (June 8, 2026)

### Audit

Full security audit completed June 8, 2026. Report: `SYNCHINTRO_AUDIT_REPORT_2026-06-08.md` at repo root.
**Score: 80/100 (grade B). 41 findings: 1 P0, 7 P1, 24 P2, 9 P3.**

### Closed Findings (June 8, 2026)

| Finding | Severity | Resolution | PR |
|---------|---------|------------|-----|
| F-001 — Firebase SA key on disk | P0 | Key deleted; verified never committed; GCP rotation pending (Charles EOD June 8-9) | — |
| F-013 — npm audit / axios CVE | P1 | `npm audit fix` transitive cleanup; 9 remaining moderate findings not exploitable in our code path | PR #17 (merged `a9f6410`) |
| F-004 — pitchAnalytics cross-tenant write | P1 | `create/update` now requires ownership via `get(/pitches/$(pitchId)).data.userId == uid` | PR #18 (open, Williams) |
| F-005 — icpProfiles default-create bypass | P1 | Removed `isDefault==true` client-create path; defaults now Admin SDK only | PR #18 (open, Williams) |

### Tightened Firestore Rules (F-004 + F-005)

**F-004 — pitchAnalytics:**
```
// Before (any authenticated user could write to any pitch's analytics):
allow create, update: if isAuthenticated();

// After (ownership required via parent pitch document):
allow create, update: if isAuthenticated() &&
  get(/databases/$(database)/documents/pitches/$(pitchId)).data.userId
    == request.auth.uid;
```

**F-005 — icpProfiles:**
```
// Before (any user could create a default profile, polluting global defaults):
allow create: if isAuthenticated() &&
                (request.resource.data.isDefault == true ||
                 request.resource.data.userId == request.auth.uid);

// After (ownership required; isDefault profiles are Admin SDK only):
allow create: if isAuthenticated() &&
                request.resource.data.userId == request.auth.uid;
```

### Adjacent Flags Noted (Not Fixed, Pending New Findings)

- `pitchAnalytics` events/shareEvents subcollections: `allow create: if isAuthenticated()` — same class as F-004; subcollection not yet tightened. Add as new audit finding.
- `pitchAnalytics` allow read: `if isAuthenticated()` — any user reads view/click counters for any pitch; privacy nit, not exploitable.

### Open P0/P1 Backlog (post June 8)

| Finding | Severity | Status |
|---------|---------|--------|
| F-001 GCP key rotation | P0 | Pending Charles — GCP Console |
| F-018 html2pdf.js XSS (upgrade to 0.14.0) | P1 | Pending PDF export test in staging |
| F-003 Stripe live key → Secret Manager | P1 | Not started |
| F-006 SpyFu password in .env.example | P2 | Not started |
| F-021 opportunityBriefService.js → generateStructured() | P2 | Not started |
| F-022 market.js enhancement call → generateStructured() | P2 | Not started |

### PR Review Invariant (Reinforced June 8)

Production Firestore rule changes MUST be reviewed by Williams (`dev1@pathsynch.com`) before merge. Charles may self-merge Build OS/infrastructure/docs PRs only (lockfile, CI config, README, changelogs). Any change touching `firestore.rules`, `functions/` code, or frontend code routes through Williams.

---

## Canonical Firestore Rules Source (June 25, 2026)

**`pathsynch-pitch-generator` is the canonical source for `firestore.rules`.** Both repos (`pathsynch-pitch-generator` and `synchintro-app`) contain a `firestore.rules` file that deploys to the same project (`pathsynch-pitch-creation`). A bare `firebase deploy` from `synchintro-app` would overwrite the canonical rules and could re-introduce closed security vulnerabilities.

**RULE:** Never run bare `firebase deploy` from `synchintro-app`. Always use `--only hosting`. All `firestore.rules` changes must be made in `pathsynch-pitch-generator` and deployed from there.

---

## Workspace — Production State (June 25, 2026)

### Live Workspace

| Field | Value |
|-------|-------|
| Workspace ID | `ws_bootstrap_charles` |
| Owner | Charles Berry (`dehiyRBCXcUUM72O211S27lfXbl1`) |
| Owner role | `admin`, `isWorkspaceOwner: true` |
| Member count | 1 (Daniyal invite PENDING, not yet accepted) |
| Seat limit | -1 (unlimited) |

**Created via:** `scripts/bootstrap-workspaces.js` run against live Firestore on June 25, 2026. Backup taken first via `backup-before-bootstrap.js`.

### Backfill-After-Bootstrap Requirement

After bootstrap, the workspace resolver scopes all queries with `WHERE workspaceId == {wsId}`. Legacy docs with no `workspaceId` field are excluded by equality filter and vanish from the UI. **ZERO data loss** occurs — docs remain in Firestore but are invisible to the scoped query.

**RULE:** Any future bootstrap of a new account MUST be followed by a backfill of that owner's legacy `pitches` and `marketReports` using `scripts/backfill-workspaceid.js --write`. Without the backfill, the user's historical data will not appear in the workspace-scoped UI.

June 25 backfill: 225 pitches + 37 marketReports stamped with `workspaceId` for Charles.

### Production-Ahead-of-Main State (June 25, 2026)

Production is deployed from feature branches, NOT main:
- **functions + rules:** branch `feature/phase3c-offboarding-share-cutover`
- **hosting:** branch `fix/remove-public-pitch-rule-p0` (synchintro-app)

PRs #38 + #39 are open. **A deploy from main today would REGRESS the P0 pitch leak fix.** Main must be reconciled before any further deploys.

**[RESOLVED 2026-06-30: Main is reconciled. `git log main` confirms the P0 fix commits are on main: `69d3dd8` (workspace Phases 1-3C + onepagers P0), `c9ca048` (server-side onepager share), and the `feature/phase3c-offboarding-share-cutover` content has been merged. The current `firestore.rules` on main has the owner-scoped pitches rule (no public `shared==true` read) and the owner-scoped onepagers rule (no public `shareId!=null` read). A deploy from main no longer regresses the P0 fixes. Note: the `synchintro-app` hosting repo status was not verified in this reconciliation — Charles should confirm `fix/remove-public-pitch-rule-p0` is merged there as well.]**

### Production Share Host

Production share URLs: `https://pathsynch-pitch-creation.web.app/p/{shareId}`

`synchintro.ai` is a separate marketing site and is NOT connected to this Firebase Hosting project.

---

## Open P0 — onepagers Leak (June 25, 2026)

`onepagers` has an identical `shareId != null` unauthenticated read rule in `firestore.rules`. No server share endpoint exists yet for onepagers. Needs the same build-endpoint -> migrate-page -> remove-rule pattern used for the pitches P0 fix. Same severity as the original pitch leak.

**[RESOLVED 2026-06-30: This P0 is CLOSED. Evidence: (1) `firestore.rules` onepagers rule is now owner-scoped: `allow read: if request.auth != null && resource.data.userId == request.auth.uid` — the unauthenticated `shareId != null` public read has been removed. (2) Server-side share endpoint `functions/routes/onepagerShareRoutes.js` exists and is mounted in `index.js` at `/onepager/share/:shareId`. (3) Commits `c9ca048` (server-side onepager share) and `69d3dd8` (onepagers P0 + workspace phases) are on main.]**

---

## Team Invitation Architecture (June 29, 2026)

### Canonical Collection

`teamInvitations` (with "on") is the canonical pending-invite collection. All team routes (`POST /team/invite`, `POST /team/accept`, `POST /team/revoke-invite`, `GET /team/invitations`) read/write this collection.

`teamInvites` (without "on") is an obsolete Schema A artifact. Its dead code handlers were deleted from `index.js` in the May 15 monolith extraction session. Stale documents may still exist in Firestore but are never read by any live code path.

**RULE:** Never query or write to `teamInvites`. Always use `teamInvitations`.

### Team Routes (Complete — June 29, 2026)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/team` | Any auth'd user | List team + pending invitations |
| POST | `/team/invite` | Owner only | Invite by email |
| POST | `/team/accept` | Invitee | Accept invite via token |
| POST | `/team/remove` | Owner only | Remove a member |
| POST | `/team/update-role` | Owner only | Change member role |
| POST | `/team/revoke-invite` | Owner only | Revoke a pending invitation |
| GET | `/team/invitations` | Any auth'd user | Pending invitations for current user's email |
| GET | `/team/activity` | Any auth'd user | Activity log across team members |

All routes are in `functions/routes/teamRoutes.js`, mounted via `teamRoutes.handle()` at `index.js:292`.

---

## Open Items (June 29, 2026)

| Item | Severity | Status |
|------|----------|--------|
| Migrate CI from `FIREBASE_TOKEN` to service account (`GOOGLE_APPLICATION_CREDENTIALS`) — deprecated auth, will 401 on token expiry | P2 | OPEN |
| Add test coverage for `POST /team/revoke-invite` | P2 | OPEN |
