# SynchIntro Health Check Report — 2026-05-25

## Score: 82/100

## Summary
SynchIntro is in strong overall health following the comprehensive May 13 audit (79/100) and subsequent sprints. All 882 tests pass, syntax is clean, and the major architectural debt items (dead code in index.js, duplicate billing implementations, missing L4 fix) have been resolved. The primary remaining risks are: the `SENDGRID_API_KEY` not being set in production (team invite emails silently fail), the `icpProfiles` Firestore rule allowing any authenticated user to overwrite default profiles, Storage CORS not explicitly configured for the Firebase bucket (logos could fail in cross-origin PDF render contexts), and the "Send to NemoClaw" frontend button calls `sendProspectsToNemoClaw()` in `prospectIntelService.js` but no matching HTTP route exists in `prospectIntelRoutes.js` — this is a broken end-to-end flow for David Hailey's prospect pipeline.

---

## Critical Findings

1. **[C1] Send to NemoClaw route MISSING** — `prospectIntelService.js` exports `sendProspectsToNemoClaw()` (line 667) and the frontend calls `ProspectIntelPage.sendToNemoClaw()` which triggers it, but **no HTTP route exists** in `functions/routes/prospectIntelRoutes.js` for this operation. The NemoClaw handoff — a primary Prospect Intel workflow for David Hailey — is disconnected at the API layer. The service function exists and is tested, but it is never reachable via HTTP.

2. **[C2] SENDGRID_API_KEY not set** — `functions/services/email.js` calls `sgMail.setApiKey(process.env.SENDGRID_API_KEY)` at module load. This key is not confirmed present in `.env`. Team invite emails (wired in `teamRoutes.js` POST /team/invite) silently fail with no notification to the invited user. This is confirmed outstanding from the May 13 audit.

3. **[C3] DataForSEO `/business_data/google/reviews/live/advanced` returns 404** — Confirmed as known issue from May 18. Review enrichment for Market Intel leads is blocked. No workaround in place. GBP Completeness signals and velocity calculations that depend on this data will be missing.

4. **[C4] Census API returning `missing_key.html`** — `CENSUS_API_KEY` validity unconfirmed (noted May 18, assigned to Williams). Demographics data on Market Intel reports falls back to Serper editorial snippets, which have lower accuracy. City demographics card may render incomplete data.

---

## High Findings

5. **[H1] `icpProfiles` Firestore rule — any auth'd user can overwrite default profiles** — The `allow update` rule at line 515 permits any authenticated user to update any doc where `resource.data.isDefault == true`. This means a malicious user could corrupt the shared default ICP profiles that all users see in their ICP selector dropdown. Scope should be restricted to Cloud Functions only for default profiles.

6. **[H2] Firebase Storage — no CORS config for the bucket** — `firebase.json` has no `hosting` block and no `storageConfig.cors` definition. The storage rules allow public read on logos (line 10: `allow read: if true`) but without explicit CORS headers configured on the GCS bucket, logo images embedded in HTML pitch renders may fail in cross-origin contexts (e.g., puppeteer-core PDF generation, or when the one-pager HTML is opened from a different domain). No `.gcloudignore` or `gcs-cors.json` file was found.

7. **[H3] `pitchAnalytics` rule over-permissive** — `allow read: if isAuthenticated()` (line 124) with no userId scoping. Any logged-in user can read any pitch's analytics counters. This was flagged in the May 13 audit as P1 and is still outstanding.

8. **[H4] `html2pdf.js` known XSS vulnerability** — npm audit reports 14 moderate vulnerabilities. `html2pdf.js` has a known high-severity XSS issue; the upgrade to `0.14.0` (semver-major) was intentionally deferred pending PDF export testing in staging. Still outstanding.

9. **[H5] AIsynch dev bypass removed but `AISYNCH_ALLOW_TEST_TOKEN` env var still in `.env`** — The code no longer checks `AISYNCH_ALLOW_TEST_TOKEN` (the `turnstileToken === 'test'` bypass has been removed from `aiReadinessScan.js`). However, if the env var is still set, it is dead config and should be removed to avoid confusion.

10. **[H6] `ws` package moderate vulnerability** — npm audit reports `ws 8.0.0-8.20.0` has an uninitialized memory disclosure issue. Fix is available via `npm audit fix`. Not critical but should be resolved before next deploy.

---

## Medium Findings

11. **[M1] `.env.example` does not exist** — No `.env.example` file in `functions/`. New contributors and CI environments have no reference for required env vars. This was flagged in the May 13 audit and is still missing.

12. **[M2] `index.js` monolith still 3,707 lines** — 12 additional clean-cut route groups remain inline per `docs/INDEX_JS_DECOMPOSITION_PLAN.md`. The decomposition sprint extracted 648 dead lines and key helpers (shared.js, pitchMetrics.js, billing.js, prospectIntel.js) but the remaining inline handlers (Stripe webhook ~180 lines, template enrichment route ~80 lines, pitch route ~60 lines, admin bootstrap ~40 lines) are still candidates for extraction.

13. **[M3] `THEORG_API_KEY` requires Firebase Secret Manager, not `.env`** — CLAUDE.md notes this explicitly ("Only add secrets that are NOT in .env"). Verify this key is NOT in `.env` and IS in Secret Manager. If it was accidentally added to `.env`, the next deploy would fail with "Secret environment variable overlaps non secret environment variable."

14. **[M4] Stripe SDK at v14, needs upgrade to v22** — Flagged as F-008 in May 13 audit and in `stripe.js` comment (line 6). Stripe v14 is now unsupported. Not immediately broken but creates upgrade risk.

15. **[M5] `console.log` debug statements in production code** — 35 `console.log` instances in frontend pages (across all `js/pages/*.js` files). Backend has extensive `console.log` in `instantlyService.js` (line 132: logs raw response structure and full payload sample) which could expose sensitive data in Cloud Functions logs.

16. **[M6] Two Instantly integrations with different API versions** — `instantlyService.js` uses V2 (`https://api.instantly.ai/api/v2`) for per-user flows. `instantlyClient.js` uses V1 (`https://api.instantly.ai/api/v1`) for market intel bulk push. V1 is older and uses `api_key` in request body rather than Bearer auth. This is intentional architecture per CLAUDE.md but creates maintenance risk if Instantly deprecates V1.

17. **[M7] Market Intel timeout not using AbortController** — No `AbortController` was found in `market.js`. The 540s timeout is set via `exports.api` `timeoutSeconds: 540` in `index.js` (Cloud Functions level) and the client passes `timeoutMs: 540000`. However, individual sub-requests (Serper, DataForSEO, enrichment calls) do not have their own AbortController timeouts — they rely on service-level timeouts or Promise.allSettled 8s patterns. Not critical but can cause functions to hang near the boundary.

18. **[M8] `processThresholdAlerts` scheduled every 5 minutes** — In `index.js` line 3679: `exports.processThresholdAlerts = onSchedule('every 5 minutes', ...)`. CLAUDE.md says "every 6 hours". This is a discrepancy — the code is running 72x more frequently than documented, potentially causing unnecessary Firestore reads and cost.

19. **[M9] Humblytics/PostHog tokens in `.env` but not confirmed wired in frontend** — Grep found Humblytics/PostHog only in `market.js` (frontend) and `auth.js` — not in a global analytics init file. Tokens were added to `.env` (April 19) for frontend snippet injection but the actual tracking script injection path is unclear.

20. **[M10] `teamInvitations` rule too permissive for read** — `allow read: if isAuthenticated()` (line 568) with no scoping. Any authenticated user can read all team invitations. Should be scoped to `inviteeEmail == request.auth.token.email || teamOwnerUid == request.auth.uid`.

---

## Low Findings

21. **[L1] No `onepagers` collection in Firestore rules for Market Intel reports** — Market reports are correctly scoped (`resource.data.userId == request.auth.uid`) but workspace members cannot access their team owner's market reports via Firestore rules (only via Admin SDK in the backend). This is by design but could limit future client-side workspace features.

22. **[L2] `pitchVersions` rule — any authenticated user can read** — `allow read: if isAuthenticated()` (line 206) has no userId scoping. Pitch versions contain full pitch HTML content. Should be scoped to the pitch owner.

23. **[L3] `enrichmentWaterfall.js` is stub-only** — Apollo, PDL, Clay, HubSpot stubs all return `null`. Expected env vars (`APOLLO_API_KEY`, `PDL_API_KEY`, `CLAY_API_KEY`, `HUBSPOT_ACCESS_TOKEN`) are not yet wired. Not broken but represents incomplete Sprint 3 work.

24. **[L4] `RAG_SERVICE_URL` and `VERTEX_SEARCH_DATA_STORE_ID` — verify active** — Both referenced in `ragService.js` and `vertexSearch.js`. The Vertex AI Search data store ID (`synchintro-knowledge-base_1774560525810`) was created under project `pathconnect-442522`. Confirm the data store is still seeded and accessible.

25. **[L5] actions/checkout@v4 — TODO note in CI** — `ci.yml` has a comment to upgrade to v5/setup-node@v5 when Node 20 deprecation is resolved. Minor; not blocking.

---

## Pitch Generation Status

| Level | Handler Exists | Gemini Model | Logo | PDF Library | Sales Library | Market Intel Inject | Status |
|-------|---------------|-------------|------|-------------|---------------|---------------------|--------|
| L1 Cold Email | Yes (`level1Generator.js`) | gemini-3-flash-preview (via pitchGenerator) | `logoUrl` passed as public URL | N/A (HTML only) | Yes — `libraryEnhancedContent` injected | No | WORKING |
| L2 One-Pager | Yes (`level2Generator.js` + 5 style variants) | gemini-3-flash-preview | `customLogo` = public URL from seller profile | puppeteer-core (via pdfGenerator.js) | Yes | Yes (marketContext) | WORKING |
| L3 Enterprise Deck | Yes (`level3Generator.js` + 4 style variants) | gemini-3.1-pro-preview for complex tasks | Public URL from seller profile | PptxGenJS (PPTX), puppeteer-core (PDF) | Yes | Yes | WORKING |
| L4 Custom One-Pager | Yes (`generateLevel4()` in pitchGenerator.js line 503) | Same as L2 (delegates to level2Generator with pitchLevel:4 flag) | Same as L2 | Same as L2 | Required — hard gate at line 1513 | Yes | WORKING (known: if libraryEnhancedContent is null, silently falls back to L2) |

**Logo notes:**
- Logos stored in Firebase Storage at `logos/{userId}/{fileName}` with public read (`allow read: if true`)
- Logo URLs are public download URLs (not signed URLs) stored on `users/{uid}.sellerProfile.branding.logo`
- No signed URL expiration issues
- CORS risk: No explicit CORS config on GCS bucket — logos in puppeteer PDF renders may fail in some environments

---

## Route Inventory

| Method | Path | Handler Location | Auth | Status |
|--------|------|-----------------|------|--------|
| POST | /generate-pitch | `api/pitchGenerator.js` → `index.js` | Required | WORKING |
| GET | /get-pitch | `index.js` inline | Required | WORKING |
| GET | /get-shared-pitch | `index.js` inline | None | WORKING |
| POST | /generate-pitch-direct | `api/pitchGenerator.js` | Admin key | WORKING |
| GET/POST | /market/* | `api/market.js` | Required | WORKING |
| GET | /benchmarks/:industry/:city/:state | `api/market.js` | None (public) | WORKING |
| POST | /market/refresh/:reportId | `api/market.js` | Required | WORKING |
| POST | /market/questions | `api/market.js` | Required | WORKING |
| GET | /market/match | `api/market.js` | Required | WORKING |
| POST | /market-intel/pitch-context-preview | `index.js` inline | Required | WORKING |
| POST | /market-intel/pitch-companion-md | `index.js` inline | Required | WORKING |
| GET/POST | /instantly/* | `routes/instantlyRoutes.js` | Required | WORKING |
| GET | /instantly/vi-campaigns | `routes/instantlyRoutes.js` | Required | WORKING |
| POST | /instantly/trigger-sequence | `routes/instantlyRoutes.js` | Required | WORKING |
| GET | /instantly-market/campaigns | `index.js` inline | Required | WORKING |
| POST | /instantly-market/push-leads | `index.js` inline | Required | WORKING |
| POST | /attio/push-lead | `index.js` inline | Required | WORKING |
| POST | /attio/push-all | `index.js` inline | Required | WORKING |
| POST | /attio/push-account | `routes/attioRoutes.js` | Required | WORKING |
| GET | /account360/:accountKey | `routes/visitorSignalRoutes.js` | Required | WORKING |
| POST | /account360/:accountKey/outbound | `routes/visitorSignalRoutes.js` | Required | WORKING |
| GET | /account360/:accountKey/history | `routes/visitorSignalRoutes.js` | Required | WORKING |
| POST | /visitor-signal/ingest | `routes/visitorSignalRoutes.js` | None (ps-core.js) | WORKING |
| GET | /visitor-accounts | `routes/visitorSignalRoutes.js` | Required | WORKING |
| GET/POST | /merchant-config/* | `routes/merchantConfigRoutes.js` | Required | WORKING |
| GET | /alerts | `routes/alertRoutes.js` | Required | WORKING |
| POST | /alerts/:id/read\|action\|dismiss | `routes/alertRoutes.js` | Required | WORKING |
| GET/POST | /team/* | `routes/teamRoutes.js` | Required | WORKING |
| GET/POST | /prospect-intel/* | `routes/prospectIntelRoutes.js` | Required | WORKING (NemoClaw route MISSING) |
| POST | /prospect-intel/batch/:id/send-nemoclaw | NOT FOUND | — | BROKEN |
| GET/POST | /sales-library/* | `routes/salesLibraryRoutes.js` | Required | WORKING |
| GET/POST | /opportunity-brief/* | `routes/opportunityBriefRoutes.js` | Required | WORKING |
| GET/POST | /billing/* | `api/billing.js` | Required | WORKING |
| POST | /stripe/* | `api/stripe.js` | Mixed | WORKING |
| GET/POST | /user/* | `routes/userRoutes.js` | Required | WORKING |
| GET/POST | /analytics/* | `routes/analyticsRoutes.js` | Required | WORKING |
| POST | /logo/extract | `api/logo.js` | Required | WORKING |
| POST | /export/* | `api/export.js` | Required | WORKING |

---

## Firestore Collections

| Collection | Purpose | Rules OK | Indexed |
|-----------|---------|----------|---------|
| users | User profiles, plan, credits | Yes — owner + team members | N/A |
| pitches | Generated pitch HTML + metadata | Yes — userId scoped | Partial |
| usage | Monthly pitch usage counters | Yes — Cloud Functions write only | N/A |
| marketReports | Market intelligence reports | Yes — userId scoped | Composite indexes added May 20 |
| prospectIntel | Prospect batch + enrichment | Yes — userId checked via parent doc | Yes (userId + createdAt) |
| creditLedger | Credit audit trail | Yes — Cloud Functions write only | N/A |
| teams | Team/workspace ownership | Yes — owner get, member get, write=false | N/A |
| teamInvitations | Pending team invites | RISK — any auth'd user can read all | N/A |
| opportunityBriefs | AI opportunity briefs | Yes — userId scoped, public share server-side | Yes (userId + createdAt) |
| salesDocuments | Sales Library uploads | Yes — userId scoped | N/A |
| Account360 | Visitor Intent workspace docs | NOT IN RULES — relies on Admin SDK only | signalHistory not indexed |
| visitorIntelSummary | Intent scoring aggregation | Yes — merchantId scoped | N/A |
| merchantConfig | Visitor scoring config | Yes — merchantId scoped, write=false | N/A |
| intentSignalsCache | Market intent cache | Yes — read-only for auth'd users | Yes |
| icpProfiles | ICP definitions | RISK — any auth'd user can update defaults | N/A |
| marketBenchmarks | Cross-product benchmark feed | Yes — public read, CF write only | Composite for fuzzy search |
| pitchAnalytics | View/share counters | RISK — any auth'd user can read all | N/A |
| pitchVersions | Pitch edit history | RISK — any auth'd user can read all | N/A |
| aisynchSubscriptions | AIsynch billing tier state | NOT IN firestore.rules | N/A |
| aiReadinessRateLimits | AIsynch scan rate limits | NOT IN firestore.rules | N/A |
| publicDataEnrichmentCache | Gov/Nonprofit enrichment cache | NOT IN firestore.rules | N/A |
| irsBmfCache | IRS BMF seeded data | NOT IN firestore.rules | N/A |
| visibilityEnrichmentCache | Visibility enrichment cache | NOT IN firestore.rules | N/A |

**Note:** Several new collections added in recent sprints (aisynchSubscriptions, aiReadinessRateLimits, publicDataEnrichmentCache, irsBmfCache, visibilityEnrichmentCache, Account360) have no Firestore security rules defined. They rely exclusively on Admin SDK access from Cloud Functions, which bypasses rules. Client-side access to these collections would be unrestricted if ever attempted.

---

## Monolith Assessment

- **index.js: 3,707 lines, 15 exports**
- **Exports:** `api`, `weeklyDigest`, `dailyDigest`, `activityCleanup`, `onUserCreated`, `backfillConfidenceFields`, `calibrateMerchant`, `merchantBehaviorSync`, `processThresholdAlerts`, `onProspectBatchCreated`, `processProspectTask`, `aiReadinessScan`, `aisynchDashboard`, `aiVisibilityMonitorCron` (14 exported functions)

**Top 5 extraction targets (remaining inline blocks):**
1. **Stripe webhook handler** (~lines 2100-2280, ~180 lines) — complex, touches subscription state
2. **Market intel routes block** (~lines 3300-3430, ~130 lines) — pitch context preview, companion md, questions endpoints
3. **Template enrichment route handler** (~lines 1250-1330, ~80 lines) — calls `templateOnePager.js`
4. **Admin bootstrap endpoints** (~lines 3610-3660, ~50 lines) — backfill and calibrate (already exported but inline logic)
5. **Logo + pitch-related dispatch blocks** (~lines 800-900, ~100 lines) — logo extract/save endpoints inline

**Already extracted (confirmed active modules):**
- `lib/shared.js` — normalizePath, verifyAuth, getCurrentPeriod
- `services/pitchMetrics.js` — ensureUserExists, checkAndUpdateUsage, incrementUsage, trackPitchView
- `api/billing.js` — checkCredits, deductCredits, checkAndDeductCredits, refundCredits
- `api/prospectIntel.js` — onProspectBatchCreated, processProspectTask
- `routes/teamRoutes.js`, `routes/userRoutes.js`, `routes/analyticsRoutes.js`, `routes/pitchRoutes.js`, `routes/instantlyRoutes.js`, `routes/attioRoutes.js`, `routes/alertRoutes.js`, `routes/visitorSignalRoutes.js`, `routes/opportunityBriefRoutes.js`, `routes/salesLibraryRoutes.js`, `routes/prospectIntelRoutes.js`, `routes/merchantConfigRoutes.js`, `routes/landingPageRoutes.js`, `routes/sellerProfileRoutes.js`, `routes/salesIntelligenceRoutes.js`

---

## Integration Status

| Integration | Connected | Tested | Working | Notes |
|------------|-----------|--------|---------|-------|
| Gemini (gemini-3-flash-preview) | Yes | Yes | Yes | Primary model |
| Gemini (gemini-3.1-pro-preview) | Yes | Yes | Yes | Advanced tasks |
| Gemini (gemini-2.5-flash) | Yes | Yes | Yes | Simple tasks |
| Google Places API | Yes | Yes | Yes | |
| Serper API | Yes | Yes | Partial | Low balance issue observed May 19 |
| DataForSEO | Yes | Partial | Partial | `/reviews/live/advanced` 404 (known) |
| Instantly V2 (per-user) | Yes | Yes | Yes | AES-256-CBC encrypted key storage |
| Instantly V1 (global market intel) | Yes | Yes | Yes | Uses `campaign_id` for list, `campaign` for push (correct) |
| Attio V2 | Yes | Yes | Yes | |
| Stripe | Yes | Yes | Yes | SDK v14 (needs upgrade to v22) |
| SendGrid | Wired | No | NO | SENDGRID_API_KEY not set — all team emails fail silently |
| Entity360 (fire-and-forget) | Yes | Yes | Yes | One-way push only |
| NemoClaw (Prospect Intel) | Partial | No | BROKEN | Service function exists, HTTP route missing |
| Census API | Yes | Unconfirmed | DEGRADED | Returning `missing_key.html` as of May 18 |
| Humblytics | Tokens present | No | UNKNOWN | Frontend wiring not confirmed |
| PostHog | Tokens present | No | UNKNOWN | Frontend wiring not confirmed |
| PathManager Benchmark Feed | Yes | Yes | Yes | Public marketBenchmarks collection |
| Perplexity API | Yes | Yes | Yes | AI Visibility Phase 3 |
| Keywords Everywhere | Yes | Yes | Yes | Intent signals |
| Cloud Tasks (Prospect Intel) | Yes | Yes | Yes | prospect-enrichment queue |
| USAspending.gov | Yes | Yes | Yes | Gov vertical enrichment |
| ProPublica Nonprofit Explorer | Yes | Yes | Yes | Nonprofit vertical enrichment |
| IRS BMF (Firestore cache) | Yes | Partial | Conditional | Requires seed-irs-bmf.js run per state |
| Zyla Labs (Safety/Crime) | Yes | Unconfirmed | DEGRADED | Key validity unconfirmed; ZIP state filter fix deployed May 18 |
| FBI Crime Data | Yes | Unconfirmed | DEGRADED | Key validity unconfirmed |
| IPInfo.io (Visitor Intel) | Yes | Yes | Yes | Lite plan (ISP-level only) |
| TheOrg API | Configured | No | UNKNOWN | Secret Manager key, not tested recently |
| Orange Slice AI | No | No | NOT BUILT | API availability pending; 3 concepts under evaluation |
| Apollo/PDL/Clay/HubSpot | No | No | NOT BUILT | enrichmentWaterfall.js stubs only |

---

## CI/CD Status

**`.github/workflows/ci.yml`** — Active, working:
- Triggers: `push` and `pull_request` on `main`
- `test` job: Node 22, `npm ci`, `npm test`, `npm audit --audit-level=critical` (only blocks on critical, not moderate)
- `deploy` job: `needs: [test]`, only runs on push to main, deploys to Firebase using `FIREBASE_TOKEN` secret
- **Gap:** No lint step in `test` job (lint runs in `predeploy` hook in `firebase.json` but not independently in CI)
- **Gap:** No Firestore rules deploy in CI — rules must be deployed manually

**`.github/workflows/weekday-health-audit.yml`** — Active:
- Bug fixes applied May 15: gate step corrected, `has_npm_script()` path resolution fixed
- Scheduled runs outside 6am ET are now genuinely skipped

**Firestore rules deploy:** Manual only (`npx firebase deploy --only firestore:rules`). Not automated in CI.

---

## Environment Variables

**Core Platform:**
- `GEMINI_API_KEY` — Vertex AI / Google GenAI
- `GEMINI_MODEL` — Model override (default: `gemini-3-flash-preview`)
- `GOOGLE_PLACES_API_KEY` — Places, logo fetch, geocoding fallback
- `GOOGLE_PSI_API_KEY` — PageSpeed Insights (Phase 2 visibility)
- `GOOGLE_SEARCH_API_KEY` — Custom Search (prospect enrichment)
- `GOOGLE_SEARCH_CX` — Search engine ID: `c0887a1e024af4f45`
- `NODE_ENV` — `production` (confirmed set)
- `ALLOWED_ORIGINS` — CORS origins override
- `PATHSYNCH_GCP_PROJECT` — GCP project (use this, NOT `GCP_PROJECT`)
- `GCP_PROJECT_ID` — RAG service / Vertex Search

**Billing & Payments:**
- `STRIPE_SECRET_KEY` — Stripe API
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook validation
- `AISYNCH_STARTER_PRICE_ID` — AIsynch Stripe price ID
- `AISYNCH_GROWTH_PRICE_ID` — AIsynch Stripe price ID
- `AISYNCH_SCALE_PRICE_ID` — AIsynch Stripe price ID
- `AISYNCH_DAILY_COST_CAP` — Default $25

**Integrations:**
- `SERPER_API_KEY` — Serper web search
- `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` — DataForSEO (Phases 1A + 1B)
- `INSTANTLY_API_KEY` — Market Intel global push (V1)
- `INSTANTLY_ENCRYPTION_KEY` — AES-256-CBC key for per-user Instantly keys
- `ATTIO_API_KEY` — Attio CRM
- `KEYWORDS_EVERYWHERE_API_KEY` — Intent signals
- `PERPLEXITY_API_KEY` — AI Visibility Phase 3
- `THEORG_API_KEY` — Secret Manager only (NOT in .env)

**Prospect Intel:**
- `PROSPECT_AGENT_URL` — Cloud Run agent
- `PROSPECT_TASK_HANDLER_URL` — Cloud Function task handler URL
- `PROSPECT_TASK_SECRET` — Cloud Tasks X-Task-Secret header
- `NEMOCLAW_SERVICE_KEY` — NemoClaw handoff auth

**AIsynch / Visitor Intel:**
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile (free scan)
- `PATHMANAGER_JWT_SECRET` — JWT auth for PathManager ↔ AIsynch
- `ENABLE_AISYNCH_MONITORING` — Feature flag
- `AISYNCH_MAX_COMPETITORS_PER_MERCHANT` / `AISYNCH_MAX_MODELS_PER_RUN` / `AISYNCH_MAX_PROMPTS_PER_MERCHANT`
- `FRONTEND_URL` — For email link generation

**Safety/Crime Data:**
- `ZYLA_API_KEY` + `ZYLA_CRIME_API_URL` — Zyla Labs safety API
- `FBI_CRIME_API_KEY` — FBI CDE API
- `ENABLE_CRIME_DATA_ENRICHMENT` — Feature flag

**Public Data Enrichment:**
- `ENABLE_USASPENDING_ENRICHMENT` — Gov vertical
- `ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT` — Nonprofit vertical
- `ENABLE_IRS_BMF_ENRICHMENT` — Requires seeded Firestore
- `CENSUS_API_KEY` — US Census ACS API (status: unconfirmed)

**Visibility Enrichment:**
- `ENABLE_MAP_PACK_ENRICHMENT` — Phase 1A
- `ENABLE_AD_SPEND_ENRICHMENT` — Phase 1B
- `ENABLE_WEBSITE_SIGNALS_ENRICHMENT` — Phase 2
- `ENABLE_AI_VISIBILITY_ENRICHMENT` — Phase 3
- `DEBUG_CITATIONS` — Logging only flag

**Infrastructure:**
- `RAG_SERVICE_URL` — Vertex AI Search endpoint
- `VERTEX_SEARCH_DATA_STORE_ID` — Knowledge base data store ID
- `ENTITY360_SERVICE_URL` — Entity360 Cloud Run service
- `ENTITY360_INTERNAL_API_KEY` — Service-to-service auth

**Email:**
- `SENDGRID_API_KEY` — **NOT SET** (team emails fail)
- `SALES_TEAM_EMAIL` — Sales notification recipient

**Feature Flags (toggles):**
- `ENABLE_AI_NARRATIVES` — AI narrative generation
- `FALLBACK_TO_TEMPLATES` — Template fallback on AI failure
- `ENABLE_COMPETITOR_VALIDATION_LOGGING` — Competitor validation debug
- `ADMIN_BOOTSTRAP_KEY` — Admin endpoint auth

---

## Recommended Priority Actions

1. **[P0 — David Hailey BROKEN] Add `/prospect-intel/batch/:batchId/send-to-nemoclaw` HTTP route** to `functions/routes/prospectIntelRoutes.js` that calls `sendProspectsToNemoClaw(batchId, prospectIds, userId, options)`. The service function is complete and tested; only the HTTP route is missing.

2. **[P0 — Billing] Set `SENDGRID_API_KEY` in `functions/.env`** — Team invite flow is completely silent without it. `sendTeamInviteEmail()` is wired but the key is not present. Contact SendGrid account to get or generate a key.

3. **[P1 — Security] Restrict `icpProfiles` Firestore rule** — Change `allow update: if isAuthenticated() && (resource.data.isDefault == true || ...)` to `allow update: if isAuthenticated() && resource.data.userId == request.auth.uid` for non-default profiles. Default profile updates should go through Cloud Functions only.

4. **[P1 — Security] Restrict `teamInvitations` read rule** — Change `allow read: if isAuthenticated()` to `allow read: if isAuthenticated() && (resource.data.inviteeEmail == request.auth.token.email || resource.data.teamOwnerUid == request.auth.uid)`.

5. **[P1 — Security] Restrict `pitchVersions` and `pitchAnalytics` read rules** — Scope both to `resource.data.userId == request.auth.uid` or pitch ownership check. Current "any authenticated user" rules expose pitch content and analytics cross-user.

6. **[P1 — Reliability] Add missing Firestore security rules** for: `aisynchSubscriptions`, `aiReadinessRateLimits`, `publicDataEnrichmentCache`, `irsBmfCache`, `visibilityEnrichmentCache`, `Account360`. Each should have `allow read, write: if false` (Cloud Functions only) to prevent any accidental client-side access.

7. **[P1 — Data Quality] Verify and restore Census API key** — `CENSUS_API_KEY` returning `missing_key.html`. Demographics data on Market Intel reports is degraded. Check key validity in `.env` against the Census API portal.

8. **[P1 — Data Quality] Resolve DataForSEO 404 on reviews endpoint** — `/business_data/google/reviews/live/advanced` returning 404 since May 18. Check DataForSEO account status, endpoint URL correctness, and API credentials. Review enrichment for Market Intel is blocked.

9. **[P2 — Cost] Fix `processThresholdAlerts` schedule** — Change from `'every 5 minutes'` (line 3679 in index.js) to `'every 6 hours'` per CLAUDE.md documentation. Current schedule runs 72x more frequently than intended.

10. **[P2 — Security] Configure Firebase Storage CORS** — Create a `gcs-cors.json` file and apply it to the `pathsynch-pitch-creation.appspot.com` bucket to explicitly allow cross-origin reads for logo images. This prevents logo failures in puppeteer PDF renders and cross-origin one-pager views.

11. **[P2 — Security] Remove `AISYNCH_ALLOW_TEST_TOKEN` from `.env`** if it is still present — the code no longer uses it; keeping it creates confusion.

12. **[P3 — Maintenance] Upgrade Stripe SDK from v14 to v22** — Stripe v14 is unsupported. Test checkout and webhook flows in staging before deploying.

13. **[P3 — Maintenance] Run `npm audit fix`** — Addresses the `ws` moderate vulnerability and other resolvable issues. Test `html2pdf.js` upgrade to `0.14.0` separately in staging.

14. **[P3 — Maintenance] Create `.env.example`** in `functions/` with all env vars documented (using `your_value_here` placeholders for secrets). Use the environment variable list in this report as the basis.

15. **[P3 — Quality] Wire Humblytics/PostHog** — Confirm whether the analytics tokens are actually injected into the frontend. If not, add the snippet injection. If they are wired, document the integration path in CLAUDE.md.

---

*Report generated: 2026-05-25. Backend: 3,707 lines, 14 Cloud Function exports, 882 tests passing. Frontend: 43,244 lines across 17 page modules.*
