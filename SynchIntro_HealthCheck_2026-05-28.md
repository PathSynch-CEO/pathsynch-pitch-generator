# SynchIntro Health Check Report — 2026-05-28

## Score: 89/100

## Summary
SynchIntro is in the strongest health it has been, up from 82/100 on May 25. Nine findings from the May 25 audit have been resolved. SEO Intelligence Layer Phases 1, 2, and 3 are now fully deployed — DataForSEO backlinks enrichment runs on all Market Intel reports, SpyFu keyword and PPC intelligence is layered on when `SPYFU_API_KEY` is set, and Phase 3 AI Citation Tracking runs 5 Gemini local-intent queries per lead to measure whether each business appears in AI-generated search responses. The full pipeline is non-blocking, additive, and feature-flagged. Test count increased from 882 to 1,080. Primary remaining risks: the NemoClaw HTTP route is still missing (David Hailey's Prospect Intel handoff is broken), `SENDGRID_API_KEY` is still not set (team invite emails fail silently), `pitchAnalytics` Firestore rule is still over-permissive, Firebase Storage has no explicit CORS config, and `html2pdf.js` has a known XSS vulnerability pending a major-version upgrade.

---

## Resolved Since May 25

| Finding | Resolution |
|---------|-----------|
| [C3] DataForSEO `/reviews/live/advanced` 404 | Removed `/advanced` suffix — correct endpoint is `/business_data/google/reviews/live` |
| [C4] Census API returning `missing_key.html` | `CENSUS_API_KEY` confirmed present in `.env`; no code change needed |
| [H1] `icpProfiles` rule — any auth'd user could overwrite defaults | Removed `isDefault == true` branch; default profile updates are Cloud Functions only |
| [H6] `ws` moderate vulnerability | Resolved via `npm audit fix` |
| [M1] `.env.example` missing | Created `functions/.env.example` with all 70+ vars documented by category |
| [M4] Stripe SDK at v14 | Upgraded to v22; no test regressions |
| [M8] `processThresholdAlerts` running every 5 min | Corrected to `every 6 hours` per spec |
| [M10] `teamInvitations` read rule — any auth'd user could read all | Now scoped to `inviteeEmail == request.auth.token.email || teamOwnerUid == request.auth.uid` |
| [L2] `pitchVersions` any auth'd user could read | Now owner-scoped: `resource.data.userId == request.auth.uid` |

---

## Critical Findings

1. **[C1] Send to NemoClaw route MISSING** — `prospectIntelService.js` exports `sendProspectsToNemoClaw()` (line 667) and the frontend triggers it, but **no HTTP route exists** in `functions/routes/prospectIntelRoutes.js`. The NemoClaw handoff — a primary Prospect Intel workflow for David Hailey — is disconnected at the API layer.

2. **[C2] SENDGRID_API_KEY not set** — `functions/services/email.js` calls `sgMail.setApiKey(process.env.SENDGRID_API_KEY)` at module load. Team invite emails (wired in `teamRoutes.js` POST /team/invite) silently fail with no notification to the invited user. Outstanding since May 13.

---

## High Findings

3. **[H2] Firebase Storage — no CORS config for the bucket** — `firebase.json` has no `storageConfig.cors` definition. The storage rules allow public read on logos but without explicit CORS headers on the GCS bucket, logo images embedded in pitch HTML renders may fail in cross-origin contexts (puppeteer-core PDF generation, cross-domain one-pager views). No `gcs-cors.json` file found.

4. **[H3] `pitchAnalytics` rule over-permissive** — `allow read: if isAuthenticated()` (line 124) with no userId scoping. Any logged-in user can read any pitch's analytics counters. Flagged in May 13 and May 25 audits; still outstanding.

5. **[H4] `html2pdf.js` known XSS vulnerability** — npm audit reports the library has a known high-severity XSS issue. Upgrade to `0.14.0` (semver-major) was intentionally deferred pending PDF export testing in staging. Still outstanding.

6. **[H5] `AISYNCH_ALLOW_TEST_TOKEN` env var may still be in `.env`** — The code no longer checks this flag (dev bypass removed from `aiReadinessScan.js`). If the env var is still set it is dead config; should be removed.

---

## Medium Findings

7. **[M2] `index.js` monolith still ~3,707 lines** — 12 additional clean-cut route groups remain inline per `docs/INDEX_JS_DECOMPOSITION_PLAN.md`. Stripe webhook (~180 lines), market intel context routes (~130 lines), template enrichment route handler (~80 lines), admin bootstrap endpoints (~50 lines), and logo/pitch dispatch blocks (~100 lines) are the top remaining extraction targets.

8. **[M3] `THEORG_API_KEY` — verify Secret Manager only** — CLAUDE.md requires this key to be in Secret Manager, NOT in `.env`. If accidentally added to `.env`, the next deploy will fail with "Secret environment variable overlaps non secret environment variable."

9. **[M5] `console.log` debug statements in production code** — Extensive `console.log` in `instantlyService.js` (logs raw response structure and full payload sample) could expose sensitive data in Cloud Functions logs. 35 `console.log` instances across frontend page modules.

10. **[M6] Two Instantly integrations with different API versions** — `instantlyService.js` uses V2 for per-user flows; `instantlyClient.js` uses V1 for market intel bulk push. Intentional per CLAUDE.md but creates maintenance risk if Instantly deprecates V1.

11. **[M7] Market Intel sub-requests lack AbortController timeouts** — Individual sub-requests (Serper, DataForSEO, enrichment calls) rely on service-level timeouts or `Promise.allSettled` 8s patterns, not per-request `AbortController`. Can cause functions to hang near the 540s boundary.

12. **[M9] Humblytics/PostHog tokens — frontend wiring not confirmed** — Tokens were added to `.env` (April 19) but the actual tracking script injection path is unclear. Not confirmed working end-to-end.

---

## Low Findings

13. **[L1] Workspace members cannot access team owner's market reports via Firestore rules** — Scoped to `resource.data.userId == request.auth.uid`. Cross-member access works only via Admin SDK in the backend. Could limit future client-side workspace features.

14. **[L3] `enrichmentWaterfall.js` is stub-only** — Apollo, PDL, Clay, HubSpot stubs all return `null`. Expected env vars (`APOLLO_API_KEY`, `PDL_API_KEY`, `CLAY_API_KEY`, `HUBSPOT_ACCESS_TOKEN`) are not wired. Represents incomplete Sprint 3 work.

15. **[L4] `RAG_SERVICE_URL` and `VERTEX_SEARCH_DATA_STORE_ID` — verify active** — The Vertex AI Search data store (`synchintro-knowledge-base_1774560525810`) was created under project `pathconnect-442522`. Confirm the data store is still seeded and accessible.

16. **[L5] actions/checkout@v4 — upgrade pending** — `ci.yml` has a TODO to upgrade to v5/setup-node@v5 when Node 20 deprecation is resolved. Minor; not blocking.

---

## Pitch Generation Status

| Level | Handler Exists | Gemini Model | Logo | PDF Library | Sales Library | Market Intel Inject | Status |
|-------|---------------|-------------|------|-------------|---------------|---------------------|--------|
| L1 Cold Email | Yes (`level1Generator.js`) | gemini-3-flash-preview | `logoUrl` passed as public URL | N/A (HTML only) | Yes — `libraryEnhancedContent` injected | No | WORKING |
| L2 One-Pager | Yes (`level2Generator.js` + 5 style variants) | gemini-3-flash-preview | `customLogo` = public URL from seller profile | puppeteer-core (via pdfGenerator.js) | Yes | Yes (marketContext) | WORKING |
| L3 Enterprise Deck | Yes (`level3Generator.js` + 4 style variants) | gemini-3.1-pro-preview for complex tasks | Public URL from seller profile | PptxGenJS (PPTX), puppeteer-core (PDF) | Yes | Yes | WORKING |
| L4 Custom One-Pager | Yes (`generateLevel4()` in pitchGenerator.js line 503) | Same as L2 (delegates to level2Generator with pitchLevel:4 flag) | Same as L2 | Same as L2 | Required — hard gate at line 1513 | Yes | WORKING (known: if libraryEnhancedContent is null, silently falls back to L2) |

**Logo notes:**
- Logos stored in Firebase Storage at `logos/{userId}/{fileName}` with public read (`allow read: if true`)
- Logo URLs are public download URLs stored on `users/{uid}.sellerProfile.branding.logo`
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
| teamInvitations | Pending team invites | **FIXED May 25** — now scoped to owner+invitee | N/A |
| opportunityBriefs | AI opportunity briefs | Yes — userId scoped, public share server-side | Yes (userId + createdAt) |
| salesDocuments | Sales Library uploads | Yes — userId scoped | N/A |
| Account360 | Visitor Intent workspace docs | NOT IN RULES — relies on Admin SDK only | signalHistory not indexed |
| visitorIntelSummary | Intent scoring aggregation | Yes — merchantId scoped | N/A |
| merchantConfig | Visitor scoring config | Yes — merchantId scoped, write=false | N/A |
| intentSignalsCache | Market intent cache | Yes — read-only for auth'd users | Yes |
| icpProfiles | ICP definitions | **FIXED May 25** — isDefault branch removed | N/A |
| marketBenchmarks | Cross-product benchmark feed | Yes — public read, CF write only | Composite for fuzzy search |
| pitchAnalytics | View/share counters | RISK — any auth'd user can read all | N/A |
| pitchVersions | Pitch edit history | **FIXED May 25** — owner-scoped | N/A |
| aisynchSubscriptions | AIsynch billing tier state | NOT IN firestore.rules | N/A |
| aiReadinessRateLimits | AIsynch scan rate limits | NOT IN firestore.rules | N/A |
| publicDataEnrichmentCache | Gov/Nonprofit enrichment cache | NOT IN firestore.rules | N/A |
| irsBmfCache | IRS BMF seeded data | NOT IN firestore.rules | N/A |
| visibilityEnrichmentCache | Visibility enrichment cache | NOT IN firestore.rules | N/A |

**Note:** Several collections added in recent sprints (aisynchSubscriptions, aiReadinessRateLimits, publicDataEnrichmentCache, irsBmfCache, visibilityEnrichmentCache, Account360) have no Firestore security rules defined. They rely exclusively on Admin SDK access, which bypasses rules. Client-side access would be unrestricted if ever attempted.

---

## Monolith Assessment

- **index.js: ~3,707 lines, 15 exports**
- **Exports:** `api`, `weeklyDigest`, `dailyDigest`, `activityCleanup`, `onUserCreated`, `backfillConfidenceFields`, `calibrateMerchant`, `merchantBehaviorSync`, `processThresholdAlerts`, `onProspectBatchCreated`, `processProspectTask`, `aiReadinessScan`, `aisynchDashboard`, `aiVisibilityMonitorCron` (14 exported functions)

**Top 5 extraction targets (remaining inline blocks):**
1. **Stripe webhook handler** (~lines 2100-2280, ~180 lines) — complex, touches subscription state
2. **Market intel routes block** (~lines 3300-3430, ~130 lines) — pitch context preview, companion md, questions endpoints
3. **Template enrichment route handler** (~lines 1250-1330, ~80 lines) — calls `templateOnePager.js`
4. **Admin bootstrap endpoints** (~lines 3610-3660, ~50 lines)
5. **Logo + pitch-related dispatch blocks** (~lines 800-900, ~100 lines)

**Already extracted (confirmed active modules):**
- `lib/shared.js` — normalizePath, verifyAuth, getCurrentPeriod
- `services/pitchMetrics.js` — ensureUserExists, checkAndUpdateUsage, incrementUsage, trackPitchView
- `api/billing.js` — checkCredits, deductCredits, checkAndDeductCredits, refundCredits
- `api/prospectIntel.js` — onProspectBatchCreated, processProspectTask
- All route modules: teamRoutes, userRoutes, analyticsRoutes, pitchRoutes, instantlyRoutes, attioRoutes, alertRoutes, visitorSignalRoutes, opportunityBriefRoutes, salesLibraryRoutes, prospectIntelRoutes, merchantConfigRoutes, landingPageRoutes, sellerProfileRoutes, salesIntelligenceRoutes

---

## Integration Status

| Integration | Connected | Tested | Working | Notes |
|------------|-----------|--------|---------|-------|
| Gemini (gemini-3-flash-preview) | Yes | Yes | Yes | Primary model |
| Gemini (gemini-3.1-pro-preview) | Yes | Yes | Yes | Advanced tasks |
| Gemini (gemini-2.5-flash) | Yes | Yes | Yes | Simple tasks, SEO narrative |
| Google Places API | Yes | Yes | Yes | |
| Serper API | Yes | Yes | Partial | Low balance issue observed May 19 |
| DataForSEO | Yes | Yes | Yes | **FIXED** — `/reviews/live` (without `/advanced`) now correct |
| SpyFu | Yes | Yes | Yes | Phase 2 SEO Intelligence; `SPYFU_API_KEY` as Firebase Secret |
| Gemini — AI Citation Tracking | Yes | Yes | Yes | **NEW** — Phase 3 SEO Intelligence; 5 queries/lead, deterministic matching |
| Instantly V2 (per-user) | Yes | Yes | Yes | AES-256-CBC encrypted key storage |
| Instantly V1 (global market intel) | Yes | Yes | Yes | |
| Attio V2 | Yes | Yes | Yes | |
| Stripe | Yes | Yes | Yes | **FIXED** — now at SDK v22 |
| SendGrid | Wired | No | NO | SENDGRID_API_KEY not set — all team emails fail silently |
| Entity360 (fire-and-forget) | Yes | Yes | Yes | One-way push only |
| NemoClaw (Prospect Intel) | Partial | No | BROKEN | Service function exists, HTTP route missing |
| Census API | Yes | Yes | Yes | **RESOLVED** — `CENSUS_API_KEY` confirmed present in `.env` |
| Humblytics | Tokens present | No | UNKNOWN | Frontend wiring not confirmed |
| PostHog | Tokens present | No | UNKNOWN | Frontend wiring not confirmed |
| PathManager Benchmark Feed | Yes | Yes | Yes | Public marketBenchmarks collection |
| Perplexity API | Yes | Yes | Yes | AI Visibility Phase 3 |
| Keywords Everywhere | Yes | Yes | Yes | Intent signals |
| Cloud Tasks (Prospect Intel) | Yes | Yes | Yes | prospect-enrichment queue |
| USAspending.gov | Yes | Yes | Yes | Gov vertical enrichment |
| ProPublica Nonprofit Explorer | Yes | Yes | Yes | Nonprofit vertical enrichment |
| IRS BMF (Firestore cache) | Yes | Partial | Conditional | Requires seed-irs-bmf.js run per state |
| Zyla Labs (Safety/Crime) | Yes | Unconfirmed | DEGRADED | Key validity unconfirmed |
| FBI Crime Data | Yes | Unconfirmed | DEGRADED | Key validity unconfirmed |
| IPInfo.io (Visitor Intel) | Yes | Yes | Yes | Lite plan (ISP-level only) |
| TheOrg API | Configured | No | UNKNOWN | Secret Manager key, not tested recently |
| Orange Slice AI | No | No | NOT BUILT | API availability pending |
| Apollo/PDL/Clay/HubSpot | No | No | NOT BUILT | enrichmentWaterfall.js stubs only |

---

## SEO Intelligence Layer

All three phases deployed as of May 28, 2026. Runs after Visibility Enrichment, before Firestore save. Pattern: non-blocking (Promise.allSettled), graceful failure, additive only.

| Phase | Data Source | Env Var | New Fields on `seoHealth` |
|-------|------------|---------|--------------------------|
| Phase 1 | DataForSEO Backlinks | `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | `domain`, `domainAuthority`, `backlinks`, `referringDomains`, `referringDomainsNofollow`, `brokenBacklinks`, `topReferringDomains[]`, `seoHealthRating` |
| Phase 2 | SpyFu | `SPYFU_API_KEY` (Firebase Secret) | `spyfu.{ strength, organicKeywords, monthlyOrganicClicks, monthlyOrganicValue, monthlyPaidClicks, monthlyBudget, topOrganicKeywords[], topPaidKeywords[], ppcActive }` |
| Phase 3 | Gemini (gemini-2.5-flash) | `GEMINI_API_KEY` (shared) | `aiCitations.{ queriesRun, mentionedIn, mentionRate, avgPosition, competitorsMentioned[], citedSources[], sentiment, queryResults[] }` |

**Gate:** DataForSEO must succeed for `seoHealth` to be non-null. SpyFu and AI Citations are additive legs — failure on either attaches `null`, never blocks Phase 1 data.

**Phase 3 query pattern:** 5 local-intent queries per lead, run serially with 200ms delay. Industry-aware templates: dental, HVAC, auto, salon, restaurant, home services, generic fallback. Business name matching is fully deterministic (no LLM) via `buildNameVariants`, `detectPosition`, `detectSentiment`, `extractCompetitorNames`, `extractDomains`.

**`marketSummary` aggregates:**
- Phase 2: `ppcActiveCount`, `avgSpyfuStrength`
- Phase 3: `avgMentionRate`, `leadsWithAiPresence`, `topAiCompetitors[]` (top 5 by totalMentions)

**Gemini narrative:** Includes `AI CITATION INTELLIGENCE` block when any lead has citation data — reports `leadsWithPresence`, `avgMentionRatePct`, `topAiCompetitor`.

**`SPYFU_API_KEY` auth:** Basic Auth — `base64(apiKey:SYDM0E4D)`. Password `SYDM0E4D` is fixed per SpyFu API docs (not secret). Key read at call time from `process.env.SPYFU_API_KEY`.

---

## CI/CD Status

**`.github/workflows/ci.yml`** — Active, working:
- Triggers: `push` and `pull_request` on `main`
- `test` job: Node 22, `npm ci`, `npm test`, `npm audit --audit-level=critical`
- `deploy` job: `needs: [test]`, only runs on push to main
- `concurrency` block added May 25: cancels in-progress runs on rapid pushes
- **Gap:** No lint step in `test` job independently
- **Gap:** Firestore rules deploy is manual only

**`.github/workflows/weekday-health-audit.yml`** — Active; gate and path resolution bugs fixed May 15.

---

## Environment Variables

**Core Platform:**
- `GEMINI_API_KEY`, `GEMINI_MODEL` (default: `gemini-3-flash-preview`)
- `GOOGLE_PLACES_API_KEY`, `GOOGLE_PSI_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`
- `NODE_ENV` — `production` (confirmed set)
- `ALLOWED_ORIGINS`, `PATHSYNCH_GCP_PROJECT`, `GCP_PROJECT_ID`

**Billing & Payments:**
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `AISYNCH_STARTER_PRICE_ID`, `AISYNCH_GROWTH_PRICE_ID`, `AISYNCH_SCALE_PRICE_ID`, `AISYNCH_DAILY_COST_CAP`

**Integrations:**
- `SERPER_API_KEY`
- `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
- `SPYFU_API_KEY` — **Firebase Secret** (NEW — Phase 2 SEO Intelligence)
- `INSTANTLY_API_KEY`, `INSTANTLY_ENCRYPTION_KEY`
- `ATTIO_API_KEY`
- `KEYWORDS_EVERYWHERE_API_KEY`
- `PERPLEXITY_API_KEY`
- `THEORG_API_KEY` — **Secret Manager ONLY** (NOT in `.env`)

**Prospect Intel:**
- `PROSPECT_AGENT_URL`, `PROSPECT_TASK_HANDLER_URL`, `PROSPECT_TASK_SECRET`, `NEMOCLAW_SERVICE_KEY`

**AIsynch / Visitor Intel:**
- `TURNSTILE_SECRET_KEY`, `PATHMANAGER_JWT_SECRET`
- `ENABLE_AISYNCH_MONITORING`
- `AISYNCH_MAX_COMPETITORS_PER_MERCHANT`, `AISYNCH_MAX_MODELS_PER_RUN`, `AISYNCH_MAX_PROMPTS_PER_MERCHANT`
- `FRONTEND_URL`

**Safety/Crime Data:**
- `ZYLA_API_KEY`, `ZYLA_CRIME_API_URL`, `FBI_CRIME_API_KEY`, `ENABLE_CRIME_DATA_ENRICHMENT`

**Public Data Enrichment:**
- `ENABLE_USASPENDING_ENRICHMENT`, `ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT`, `ENABLE_IRS_BMF_ENRICHMENT`
- `CENSUS_API_KEY` — confirmed present

**Visibility Enrichment:**
- `ENABLE_MAP_PACK_ENRICHMENT`, `ENABLE_AD_SPEND_ENRICHMENT`, `ENABLE_WEBSITE_SIGNALS_ENRICHMENT`, `ENABLE_AI_VISIBILITY_ENRICHMENT`
- `DEBUG_CITATIONS`

**Infrastructure:**
- `RAG_SERVICE_URL`, `VERTEX_SEARCH_DATA_STORE_ID`
- `ENTITY360_SERVICE_URL`, `ENTITY360_INTERNAL_API_KEY`

**Email:**
- `SENDGRID_API_KEY` — **NOT SET** (team emails fail silently)
- `SALES_TEAM_EMAIL`

**Feature Flags:**
- `ENABLE_AI_NARRATIVES`, `FALLBACK_TO_TEMPLATES`, `ENABLE_COMPETITOR_VALIDATION_LOGGING`, `ADMIN_BOOTSTRAP_KEY`

---

## Recommended Priority Actions

1. **[P0 — David Hailey BROKEN] Add `/prospect-intel/batch/:batchId/send-to-nemoclaw` HTTP route** to `functions/routes/prospectIntelRoutes.js` calling `sendProspectsToNemoClaw()`. Service function is complete and tested; only the HTTP route is missing.

2. **[P0 — Billing] Set `SENDGRID_API_KEY` in `functions/.env`** — Team invite flow is completely silent without it. Outstanding since May 13.

3. **[P1 — Security] Restrict `pitchAnalytics` read rule** — Change `allow read: if isAuthenticated()` to `resource.data.userId == request.auth.uid`. Any logged-in user can currently read any pitch's analytics.

4. **[P1 — Security] Add missing Firestore security rules** for `aisynchSubscriptions`, `aiReadinessRateLimits`, `publicDataEnrichmentCache`, `irsBmfCache`, `visibilityEnrichmentCache`, `Account360` — each should have `allow read, write: if false` (Cloud Functions only).

5. **[P2 — Security] Configure Firebase Storage CORS** — Create `gcs-cors.json` and apply to the `pathsynch-pitch-creation.appspot.com` bucket. Prevents logo failures in puppeteer PDF renders and cross-origin one-pager views.

6. **[P2 — Security] Remove `AISYNCH_ALLOW_TEST_TOKEN` from `.env`** if still present — the code no longer uses it.

7. **[P2 — Maintenance] Upgrade `html2pdf.js` to `0.14.0`** — Test PDF export in staging before deploying. High-severity XSS in current version.

8. **[P3 — Reliability] Verify Zyla Labs and FBI Crime API keys** — Both flagged as `DEGRADED` since May 18. Confirm key validity against provider portals.

9. **[P3 — Maintenance] Run `npm audit fix`** for `html2pdf.js` after staging test validates the major version bump.

10. **[P3 — Quality] Wire Humblytics/PostHog** — Confirm whether analytics tokens are injected into the frontend. If not, add snippet injection. If yes, document the path in CLAUDE.md.

---

*Report generated: 2026-05-28 (updated post-Phase 3 deploy). Backend: ~3,707 lines, 14 Cloud Function exports, **1,080 tests passing**. Frontend: 43,398 lines across 17 page modules. SEO Intelligence Layer Phases 1 + 2 + 3 deployed. SpyFu integration live. AI Citation Tracking live.*
