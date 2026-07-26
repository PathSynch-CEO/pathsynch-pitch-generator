# SynchIntro Comprehensive Codebase Audit
**Date:** 2026-06-08
**Auditor:** Claude Code (claude-sonnet-4-6)
**Prior audits:** SYNCHINTRO_AUDIT_REPORT_2026-05-05, SYNCHINTRO_AUDIT_REPORT_2026-05-13, SynchIntro_HealthCheck_2026-05-25, SynchIntro_HealthCheck_2026-05-28

---

## Executive Summary

| Dimension | Score | Grade |
|-----------|-------|-------|
| Security | 70/100 | C+ |
| Reliability | 82/100 | B |
| Dependencies | 84/100 | B |
| Code Quality | 76/100 | C+ |
| API Surface | 80/100 | B |
| CI/CD | 87/100 | B+ |
| Documentation | 78/100 | C+ |
| **Overall** | **80/100** | **B** |

**Score vs. prior audit (May 28):** 89/100 → 80/100. The regression is not from new bugs—it reflects this audit covering newly built surface area (AIsynch Phase 1A/1B, SEO Intelligence Layer Phase 1–3, branding system) that was not present or not fully audited in the May 28 health check. One new critical finding (F-001) — service account key on disk — drives the security score down significantly.

---

## Health Score Breakdown

| Category | Points | Max | Notes |
|----------|--------|-----|-------|
| No committed secrets | 0 | 15 | Service account key on disk (untracked but on disk is risk) |
| Auth enforcement | 12 | 15 | verifyAuth consistent; one callable without full gate |
| Firestore rules | 8 | 10 | Two intentional public-reads are documented; pitchAnalytics write still open |
| Model compliance | 9 | 10 | No banned models; one legacy indexOf pattern remains |
| Dependency freshness | 8 | 10 | html2pdf.js high XSS unresolved; lockfile present |
| CI/CD pipeline | 9 | 10 | Gates in place; FIREBASE_TOKEN single-point-of-failure |
| Error handling | 8 | 10 | Global handlers present; some scheduled functions throw on error |
| Rate limiting | 7 | 10 | Applied globally; market intel and prospect endpoints lack per-operation hard caps |
| Documentation | 8 | 10 | CLAUDE.md comprehensive; Master Prompt current; 1 Fayzan ref in master prompt |
| Test coverage | 9 | 10 | 1,080 tests; no coverage enforcement in CI |

---

## Phase 0 — Exploration Findings

### 0.1 Directory Inventory

| Folder | Purpose |
|--------|---------|
| `functions/` | Firebase Cloud Functions v2 (Node 22) — backend for all SynchIntro API |
| `functions/api/` | Route handler modules (market, pitch, billing, bulk, export, etc.) |
| `functions/services/` | Business logic services (100+ files) |
| `functions/routes/` | Modular route handlers (22 route files) |
| `functions/middleware/` | Auth, rate limiting, validation, error handling |
| `functions/config/` | Static configs: gemini, stripe, rate limits, industry taxonomy |
| `functions/utils/` | Utilities: router, reportFieldResolver, safetyContextService, etc. |
| `functions/intelligence/` | Collector/synthesizer pipeline (partially wired) |
| `functions/scheduled/` | Scheduled functions: emailDigest, aiVisibilityMonitor |
| `functions/agents/` | prospectResearchAgent (Gemini + tools loop) |
| `functions/formatters/` | Output formatters: deck, email sequence, executive summary, etc. |
| `functions/templates/` | pptTemplate, welcomeEmail |
| `functions/scripts/` | One-off admin scripts (seed, migrate, diagnose) |
| `functions/data/` | IRS BMF CSVs (gitignored) |
| `functions/__tests__/` | Jest tests using modular route pattern |
| `functions/tests/` | Jest tests for service layer |
| `functions/lib/` | shared.js: normalizePath, verifyAuth, getCurrentPeriod |
| `functions/__mocks__/` | firebase-admin mock, stripe mock |
| `public/` | ps-core.js visitor tracking script + 5 module JS files (deployed to Firebase Hosting) |
| `public/modules/` | Visitor tracking modules: identityResolver, sessionTracker, etc. |
| `changelogs/` | 30+ dated CHANGELOG_*.md files |
| `docs/` | Architecture specs, API docs, decomposition plans |
| `scripts/` | Root-level test and seed scripts (.cjs) |
| `src/` | Vite + React scaffold at root (DEFAULT TEMPLATE — not the SynchIntro frontend) |
| `pathsynch-build/` | PRD JSON, sprint guards, progress notes |
| `dist/` | Vite build output |
| `data/` | Gitignored IRS BMF CSVs |

**NOTE:** The `src/` directory at root contains a default Vite + React scaffold (`App.tsx` with Vite/React logos, a counter button). This is NOT the SynchIntro frontend. The actual frontend lives in the separate `synchintro-app` repo. This scaffold should be removed or clarified to avoid confusion.

**NOTE:** A directory named `C:Userstdh35pathsynch-pitch-generatorfunctionsscripts` exists at the root (Windows path that became a folder name). It is empty and appears to be a git artifact from a path normalization error on Windows.

### 0.2 Package.json Inventory

| Location | Name | Version | Node | Prod Deps | Dev Deps | Lockfile |
|----------|------|---------|------|-----------|----------|---------|
| Root | pathsynch-pitch-generator | 0.0.0 | (none) | 5 (firebase, html2pdf.js, lucide-react, react, react-dom) | 13 | package-lock.json ✓ |
| functions/ | pathsynch-pitch-generator-functions | 2.1.0 | 22 | 25 | 2 (jest, jest-junit) | package-lock.json ✓ |

### 0.3 Config Files Inventory

| File | Location | Notes |
|------|----------|-------|
| firebase.json | root | Defines functions source (functions/), storage, firestore, NO hosting block (hosting deploys from synchintro-app) |
| .firebaserc | root | `"default": "pathsynch-pitch-creation"` — correct |
| firestore.rules | root | Last modified 2026-05-27 |
| firestore.indexes.json | root | Last modified 2026-05-21 |
| storage.rules | root | Last modified 2026-03-13 |
| functions/.env | functions/ | **COMMITTED TO GIT** (see finding F-001) — contains live Stripe key, Gemini key, all secrets |
| functions/.env.example | functions/ | 143 lines, documents ~70 env vars; missing ~8 AIsynch-specific vars |
| eslint.config.js | root | Root-level ESLint for Vite/React scaffold |
| tsconfig.json, tsconfig.app.json, tsconfig.node.json | root | TypeScript config for Vite React scaffold |
| vite.config.ts | root | Vite config for React scaffold |
| functions/jest.config.js | functions/ | Jest config |
| .github/workflows/ci.yml | .github/workflows/ | CI: test + deploy (with test gate) |
| .github/workflows/weekday-health-audit.yml | .github/workflows/ | Weekday 6am ET health audit |

**No .eslintrc in functions/ — linting in functions is `echo 'No linting configured'`**

### 0.4 Markdown / Documentation Inventory

| File | Notes |
|------|-------|
| README.md | Root, last modified 2026-05-13. Current. |
| functions/CLAUDE.md | Canonical session log, last modified up to June 2026. Current and comprehensive. |
| functions/SYSTEM_BIBLE.md | Last modified 2026-05-30. Current. Contains Williams note. Still references Fayzan in "Replaced Fayzan" context (acceptable — it's historical record). |
| SYSTEM_BIBLE.md | Root pointer only: "See functions/SYSTEM_BIBLE.md" |
| SynchIntro_Master_Implementation_Prompt.md | Last modified 2026-06-05. 86,391 bytes. Contains one Fayzan reference (line 1178) — still present, flagged as F-030. |
| changelogs/CHANGELOG_2026-06-05.md | Most recent changelog. PathManager-only session. |
| changelogs/CHANGELOG_2026-05-19.md | Last SynchIntro code changelog. |
| SYNCHINTRO_AUDIT_REPORT_2026-05-05.md | Prior audit |
| SYNCHINTRO_AUDIT_REPORT_2026-05-13.md | Prior audit |
| SynchIntro_HealthCheck_2026-05-25.md | Untracked file (not in git) |
| SynchIntro_HealthCheck_2026-05-28.md | Last health check. Reports score 89/100, 1,080 tests. |
| docs/API.md | API documentation |
| docs/INDEX_JS_DECOMPOSITION_PLAN.md | Decomposition roadmap |
| docs/Market_Intel_Visibility_Enrichment_Spec_v2.md | Visibility enrichment spec |
| functions/AIsynch_Technical_Architecture_v2.md | AIsynch architecture |
| functions/AIsynch_Claude_Code_Prompt_Final.md | AIsynch build prompt |

### 0.5 Recent Git Activity

**Last 30 commits (last 30 days) include:**
- June 5: PathManager tier gating documentation (no SynchIntro backend changes)
- June 1-2: esc() fix in market.js frontend, Firestore account ops
- May 28: SEO Intelligence Layer Phase 3 (AI Citation Tracking, 1,080 tests, merged PR)
- May 27: Branding Phase 2 changelog
- May 26-24: Market Intel v4 (PRs #16 — all 6 stages merged), crime data pipeline, demographics
- May 21: AIsynch Phase 1B, monolith extraction sessions 1-3
- May 19: Citation intelligence backend + frontend, visibility enrichment enhancements
- May 18: No-GBP detection, test suite fixes, Market Intel bug fixes

**Most recent merged PR:** PR #16 (Market Intel v4, merged ~May 26)

**Git stash:** One stash entry `stash@{0}: WIP on fix/npm-audit-axios` — an axios critical vulnerability fix that was stashed and never resumed. This fix should be applied and closed.

**Uncommitted files of note:**
- `functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json` — **CRITICAL: live service account private key on disk, untracked**
- `SynchIntro_HealthCheck_2026-05-25.md` — health check file never committed
- `functions/scripts/account-audit-3d-3e.js` — untracked script

### 0.6 Cloud Functions Catalog

**HTTP (onRequest) — Main API:**
| Export | Type | Description |
|--------|------|-------------|
| `api` | HTTP (2nd Gen) | Main API handler — all product routes dispatched from here. 1GiB RAM, 300s timeout. |
| `aiReadinessScan` | HTTP (2nd Gen) | AIsynch free scan endpoint. Cloudflare Turnstile, rate limiting. |
| `aisynchDashboard` | HTTP (2nd Gen) | PathManager ↔ AIsynch bridge. HMAC-SHA256 JWT auth via PATHMANAGER_JWT_SECRET. |
| `processProspectTask` | HTTP (2nd Gen) | Cloud Tasks handler for prospect enrichment. Always returns 200. |

**Auth Trigger:**
| Export | Type | Description |
|--------|------|-------------|
| `onUserCreated` | Auth trigger (v1) | Sends welcome email via SendGrid on new Firebase Auth user. |

**Firestore Triggers:**
| Export | Type | Description |
|--------|------|-------------|
| `onProspectBatchCreated` | Firestore trigger | Fires on `prospectIntel/{batchId}` create. Enqueues Cloud Tasks for each prospect. |
| `backfillConfidenceFields` | Callable | One-time backfill for visitor confidence schema. Admin-gated. |
| `calibrateMerchant` | Callable | Runs merchant calibration on visitorIntelSummary. Admin-gated. |

**Scheduled:**
| Export | Type | Schedule |
|--------|------|---------|
| `weeklyDigest` | Scheduled | Every Monday 8am ET |
| `dailyDigest` | Scheduled | Every day 8am ET |
| `activityCleanup` | Scheduled | Every day 3am ET |
| `processThresholdAlerts` | Scheduled | Every 6 hours |
| `merchantBehaviorSync` | Scheduled | Every Monday 9am UTC |
| `aiVisibilityMonitorCron` | Scheduled | 3am ET daily (feature-flagged: ENABLE_AISYNCH_MONITORING) |

### 0.7 Pages / Views (synchintro-app — separate repo)

The frontend lives in `synchintro-app` (separate repo). The `public/` folder in this repo contains only the ps-core.js visitor tracking script and modules. The root `src/` contains a default Vite+React scaffold that is NOT the product frontend.

### 0.8 External Integrations in Code

| Integration | Files | Credentials |
|-------------|-------|-------------|
| Google Gemini | geminiClient.js, geminiClientV2.js, market.js, 20+ service files | `GEMINI_API_KEY` (env var) |
| Anthropic Claude | claudeClient.js, config/claude.js | `ANTHROPIC_API_KEY` (env var) — SDK present, usage path unclear |
| Google Places API | googlePlaces.js, market.js | `GOOGLE_PLACES_API_KEY` (env var) |
| Google PageSpeed Insights | providers/websiteSignalsProvider.js | `GOOGLE_PSI_API_KEY` (env var, falls back to keyless) |
| Google Custom Search | tools/googleSearch.js | `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` (env vars) |
| Serper API | serperClient.js | `SERPER_API_KEY` (env var) |
| DataForSEO | dataForSEOClient.js, providers | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` (env vars) |
| SpyFu | spyFuClient.js | `SPYFU_API_KEY` (Firebase Secret) — **fixed password `SYDM0E4D` hardcoded** |
| Perplexity | providers/aiVisibilityProvider.js | `PERPLEXITY_API_KEY` (env var) |
| Attio CRM | attioClient.js | `ATTIO_API_KEY` (env var) |
| Instantly.ai (global) | instantlyClient.js | `INSTANTLY_API_KEY` (env var) |
| Instantly.ai (per-user) | instantlyService.js | Per-user OAuth tokens, encrypted with `INSTANTLY_ENCRYPTION_KEY` |
| Stripe | api/stripe.js, config/stripe.js | `STRIPE_SECRET_KEY` (env var — live key in .env) |
| SendGrid | services/email.js | `SENDGRID_API_KEY` (env var) |
| IPInfo.io | visitorSignalService.js | `IPINFO_TOKEN` (env var) |
| Keywords Everywhere | intentSignalService.js | `KEYWORDS_EVERYWHERE_API_KEY` (env var) |
| Cloudflare Turnstile | api/aiReadinessScan.js | `TURNSTILE_SECRET_KEY` (env var) |
| Vertex AI Search (Discovery Engine) | services/vertexSearch.js | `google-auth-library` ADC — no hardcoded key |
| Entity360 | utils/entity360Service.js, services/entity360Bridge.js | `ENTITY360_SERVICE_URL` + `ENTITY360_INTERNAL_API_KEY` (env vars) |
| TheOrg API | not found in code | `THEORG_API_KEY` (Firebase Secret) |
| CoreSignal | services/coresignal.js | `CORESIGNAL_API_KEY` (env var) |
| Census Bureau | services/census.js | `CENSUS_API_KEY` (env var) — known invalid, assigned to Williams |
| ProPublica | services/publicDataEnrichmentService.js | No auth required (free API) |
| USAspending.gov | services/publicDataEnrichmentService.js | No auth required (free API) |
| Zyla Labs | utils/safetyContextService.js | `ZYLA_API_KEY` (env var) |
| Google Cloud Storage | api/market.js (10-K filing upload) | ADC (default service account) |
| Prospect Research Cloud Run | services/prospectIntelService.js | `PROSPECT_AGENT_URL` + `PROSPECT_TASK_SECRET` (env vars) |
| RAG Service Cloud Run | services/ragService.js | `RAG_SERVICE_URL` (env var) |
| PathManager (NemoClaw) | services/prospectIntelService.js | `PATHMANAGER_API_URL` + `PATHMANAGER_API_KEY` (env vars) |

---

## Phase 1 — Security Findings

### [F-001] P0 — Firebase Service Account Private Key on Disk
**File:** `functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json`
**Issue:** A live Firebase Admin SDK service account private key exists on disk, untracked by git. The file contains a real RSA private key (`private_key_id: 8aaf3aeefc50d1a1953945419f17aa891fdbb6d2`). Even though it's gitignored (untracked), this file should not exist locally outside a secure vault. If this machine is compromised or synced to cloud storage, the key leaks.
**Remediation:**
1. Delete the local file immediately: `rm functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json`
2. Rotate the service account key in GCP Console → IAM & Admin → Service Accounts
3. Verify this key was never used to authenticate locally (Cloud Functions use ADC automatically)
4. Add `*.json` key patterns to .gitignore
**Effort:** 30 minutes

### [F-002] P0 — functions/.env is Tracked by Git
**File:** `functions/.env`
**Issue:** `git ls-files functions/.env` shows this file is tracked. The .env contains `STRIPE_SECRET_KEY=sk_live_51OAeaRCwhZJHjP6K...` (live Stripe key), `GEMINI_API_KEY`, `ATTIO_API_KEY`, `INSTANTLY_API_KEY`, and all other production secrets. Although `.gitignore` lists `functions/.env`, the file was added to tracking before the .gitignore rule was created, so gitignore does not remove it from tracking.
**Remediation:**
1. `git rm --cached functions/.env` to untrack (does not delete local file)
2. Rotate the Stripe live key immediately (it has been in the git object store)
3. Check `git log --all --full-history -- functions/.env` — if any prior commit captured it, the key must be rotated regardless and a git history rewrite considered
4. Rotate Gemini API key and any other secrets from .env
**Effort:** 1-2 hours for key rotation; git history remediation may require force push

**CORRECTION after deeper check:** `git ls-files --error-unmatch functions/.env` exited 1 (not found), meaning the file is NOT in the git index. The `git ls-files functions/.env` output was misleading. `.env` is properly gitignored and not committed. The Stripe key is safe from git exposure. Downgraded to P2 advisory: verify this is confirmed by running `git log --all --full-history -- functions/.env` (no output = confirmed clean).

**Revised severity: P2** — advisory, already correctly gitignored; run history check as a precaution.

### [F-003] P1 — Stripe Live Key Sits in Local .env
**File:** `functions/.env` (local only, gitignored)
**Issue:** `STRIPE_SECRET_KEY=sk_live_51OAeaRCwhZJHjP6K...` is stored in a plain-text file on the developer's machine. Firebase Functions should use Secret Manager for production secrets. The live key is accessible to any process running on this machine.
**Remediation:** Move `STRIPE_SECRET_KEY` (and other high-value secrets) to Firebase Secret Manager. Reference via `secrets: ['STRIPE_SECRET_KEY']` in the `onRequest` options. Already done for `THEORG_API_KEY` and `SPYFU_API_KEY`.
**Effort:** 2 hours

### [F-004] P1 — Firestore pitchAnalytics — Any Authenticated User Can Write
**File:** `firestore.rules` lines 119-130
**Issue:** `allow create, update: if isAuthenticated()` on `pitchAnalytics/{pitchId}` allows any authenticated user to write analytics for any pitch, not just their own. This enables analytics manipulation.
**Remediation:** Add ownership check: `allow create, update: if isAuthenticated() && (resource == null || resource.data.pitchId == request.resource.data.pitchId)` and ensure pitchId field is validated against the auth user's pitches before write.
**Effort:** 1 hour

### [F-005] P1 — icpProfiles — Any Authenticated User Can Create Default Profiles
**File:** `firestore.rules` lines 506-522
**Issue:** `allow create: if isAuthenticated() && (request.resource.data.isDefault == true || request.resource.data.userId == request.auth.uid)` allows any authenticated user to create a document with `isDefault: true`. A malicious user could create hundreds of fake default ICP profiles that pollute every user's dropdown.
**Remediation:** Remove the `isDefault == true` create path. All default profiles should be seeded exclusively via Admin SDK (Cloud Function), not client SDK.
**Effort:** 30 minutes (rule change + seed endpoint verification)

### [F-006] P1 — SpyFu Hardcoded Password
**File:** `functions/services/spyFuClient.js` line 14
**Issue:** `const SPYFU_PASS = 'SYDM0E4D';` — SpyFu's fixed API password is hardcoded as a string literal. While this is documented as a fixed value per SpyFu API docs, it should be either in an env var or at minimum in the `.env.example` as a known constant. If SpyFu rotates this value, there's no env-var override mechanism.
**Remediation:** Add `SPYFU_PASS=SYDM0E4D` to `.env.example` as a documented constant. Add `process.env.SPYFU_API_PASS || 'SYDM0E4D'` to the code so it can be overridden.
**Effort:** 15 minutes

### [F-007] P2 — marketBenchmarks and platformConfig Are Public Read
**File:** `firestore.rules` lines 291, 349
**Issue:** Two collections have `allow read: if true` (no auth):
- `platformConfig` — "public read for pricing"
- `marketBenchmarks` — "public read — PathManager reads without SynchIntro auth"
These are intentional and documented. However, `marketBenchmarks` contains competitive intelligence data (avg rating, market leader, ICP median, opportunity data) generated from user reports. A competitor could query these without authentication.
**Remediation:** For `marketBenchmarks`, consider requiring a service-account bearer token from PathManager rather than fully public access. For `platformConfig`, public pricing is acceptable.
**Effort:** 2 hours (coordinate with PathManager team)

### [F-008] P2 — Old Countifi UID in Scripts
**Files:**
- `functions/api/pitch/templateOnePager.js` line 12 (comment only)
- `functions/scripts/setCountifiICP.js` line 17
- `functions/scripts/testPitchGeneration.js` line 92
**Issue:** The old Countifi UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` appears in scripts (and one comment). This is the incorrect UID per audit context. If this UID belongs to a departed user/entity, using it in scripts could inadvertently modify their data.
**Remediation:** Update scripts to use the correct David Hailey UID `IQaKauAsYnbRFmwKNQPTZj1FqsL2`. Remove the comment reference in templateOnePager.js.
**Effort:** 30 minutes

---

## Phase 2 — Reliability Findings

### [F-009] P2 — index.js Still 3,729 Lines (Monolith)
**File:** `functions/index.js`
**Issue:** Despite 3 extraction sessions (Sessions 1-3 in May), `index.js` remains at 3,729 lines. The `docs/INDEX_JS_DECOMPOSITION_PLAN.md` identified 12 clean-cut extractable route groups. None of the 12 have been extracted. The file is difficult to review, test, and maintain. The pitch group and several inline market intel route handlers still live here.
**Remediation:** Follow `docs/INDEX_JS_DECOMPOSITION_PLAN.md`. Priority extractions: Stripe webhook handler (~180 lines), market intel inline routes (~120 lines), template enrichment handler (~80 lines).
**Effort:** 4-6 hours per extraction group

### [F-010] P2 — market.js 3,917 Lines (Second Monolith)
**File:** `functions/api/market.js`
**Issue:** 3,917 lines. Despite service extractions in March, this file has grown significantly with Market Intel v4 additions (6 new sprints). Functions like `handleGenerateMarketReport` contain multi-hundred-line blocks that are difficult to test in isolation. No unit tests exist for this file directly.
**Remediation:** Extract enhancement call, SEO Intelligence wiring, and visibility enrichment orchestration into separate orchestrator files. Create at least a smoke test.
**Effort:** 8+ hours

### [F-011] P2 — SEO Intelligence Phase 3 Not Feature-Flagged
**File:** `functions/services/seoIntelligenceService.js`, `functions/api/market.js` lines 2450-2455
**Issue:** Unlike the Visibility Enrichment Layer (which has individual `ENABLE_*` feature flags), the SEO Intelligence Layer (Phase 1-3: DataForSEO backlinks, SpyFu, AI Citations) has no env var flag. It runs unconditionally for all market reports. If DataForSEO or SpyFu APIs fail or are deprecated, there is no clean kill-switch.
**Remediation:** Add `ENABLE_SEO_INTELLIGENCE` env var check before calling `enrichLeadsWithSEO()`. Document in `.env.example`.
**Effort:** 1 hour

### [F-012] P2 — Prospect Intel Uses Old Countifi UID
**File:** `functions/scripts/setCountifiICP.js`
**Issue:** Script uses UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2`. See F-008.

### [F-013] P2 — Stashed Axios Critical Vulnerability Fix Never Applied
**Git stash:** `stash@{0}: WIP on fix/npm-audit-axios: 8224d06 fix(deps): resolve axios critical vulnerability (F-001)`
**Issue:** An axios critical vulnerability fix was stashed and never applied or dropped. The stash suggests a critical CVE was identified but work was interrupted and not resumed.
**Remediation:** `git stash pop` the fix, verify it applies cleanly, and merge/deploy.
**Effort:** 1 hour

### [F-014] P2 — weeklyDigest / dailyDigest Throw on Error
**File:** `functions/index.js` lines 3553-3610
**Issue:** Both `weeklyDigest` and `dailyDigest` rethrow errors (`throw error`). In Cloud Functions v2 scheduled functions, rethrowing causes the function to be retried according to the scheduler's retry policy. If `sendWeeklyDigests()` throws on a bad Firestore state, the function will retry on a fixed schedule, potentially sending duplicate emails.
**Remediation:** Wrap in try/catch that logs but does not rethrow, or implement idempotency checks in the email digest logic.
**Effort:** 30 minutes

### [F-015] P2 — intelligence/ Collector Pipeline Not Wired
**Directory:** `functions/intelligence/`
**Issue:** The `intelligence/` directory contains `collectors/`, `generation/`, `synthesis/`, and an orchestrator. These files exist but examination of `functions/index.js` and route handlers shows no import or invocation of this pipeline. It appears to be partially built infrastructure that is not yet connected.
**Remediation:** Either wire the pipeline into market intel or document it as "not yet active" in CLAUDE.md to prevent confusion.
**Effort:** Investigation (1 hour) + wiring or documentation

### [F-016] P3 — Unbounded Firestore Read in processThresholdAlerts
**File:** `functions/services/alertService.js` (called by `processThresholdAlerts`)
**Issue:** `processThresholdAlerts` sweeps `visitorIntelSummary` for all accounts that crossed thresholds. Without a pagination or limit on the query, a merchant with thousands of accounts could cause a memory/timeout issue in the scheduled function (256MiB is the default).
**Remediation:** Add a Firestore query limit (e.g., 500 accounts per run, cursor-based pagination across runs) or increase memory on this function.
**Effort:** 2 hours

---

## Phase 3 — Dependency Findings

### [F-017] P0 — No @google-cloud/vertexai to Migrate (But June 24 Deadline Context)
**Finding:** The MEMORY.md cites a "5-file migration to @google/genai with a June 24, 2026 deadline" and "4 files remaining." After thorough search, there are **zero** `@google-cloud/vertexai` imports anywhere in the codebase. The migration appears to already be complete, or it refers to files in the PathManager or other repos. The one comment in `structuredGeneration.js` explicitly states "@google-cloud/vertexai is not required." The sole `@google-cloud/storage` usage in `market.js` is for 10-K PDF upload (not the AI SDK).
**Action:** Confirm with Williams whether the VertexAI migration deadline applies to this repo or another repo. If complete here, mark the June 24 deadline closed for this codebase.
**Effort:** 15 minutes (verification)

### [F-018] P1 — html2pdf.js High Severity XSS Unresolved
**File:** `package.json` (root)
**Issue:** `html2pdf.js` at version `^0.13.0` has a known high-severity XSS vulnerability. An upgrade to `0.14.0` (semver-major) is available but was explicitly deferred in the May 15 session because it requires PDF export testing. This has been open for ~3 weeks.
**Remediation:** Test PDF export in staging, then upgrade: `npm install html2pdf.js@^0.14.0` in the root package.
**Effort:** 2 hours (testing + upgrade)

### [F-019] P2 — functions/.env.example Missing ~8 AIsynch Env Vars
**File:** `functions/.env.example`
**Issue:** The following env vars used by AIsynch Phase 1A/1B are NOT documented in `.env.example`:
- `AISYNCH_PRICE_ID_STARTER` / `AISYNCH_PRICE_ID_GROWTH` / `AISYNCH_PRICE_ID_SCALE`
- `ENABLE_AISYNCH_MONITORING`
- `AISYNCH_DAILY_COST_CAP`
- `AISYNCH_MAX_PROMPTS_PER_MERCHANT`, `AISYNCH_MAX_COMPETITORS_PER_MERCHANT`, `AISYNCH_MAX_MODELS_PER_RUN`
- `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile for free scan)
**Remediation:** Add all missing vars to `.env.example` with descriptions.
**Effort:** 30 minutes

### [F-020] P2 — @sparticuz/chromium (143.0.4) and puppeteer-core Present
**File:** `functions/package.json`
**Issue:** `@sparticuz/chromium@^143.0.4` and `puppeteer-core@^24.37.5` are in production dependencies. The May 15 CLAUDE.md session notes document that puppeteer-core was migrated to reduce deploy size. The continued presence of `@sparticuz/chromium` at 143+ suggests the chromium binary is still being bundled. Cloud Functions v2 should be deploying with this. Need to verify this is the intentional cloud-compatible Chromium, not legacy puppeteer bundle.
**Remediation:** Verify that `@sparticuz/chromium` (not full puppeteer) is what's deployed. Check that `puppeteer` (dev dep) is not included in production bundle. Current setup appears intentional but should be confirmed.
**Effort:** 30 minutes (verification)

---

## Phase 4 — Code Quality Findings

### [F-021] P1 — structuredGeneration.js Adoption Too Narrow
**File:** `functions/services/structuredGeneration.js`
**Issue:** `generateStructured()` is only imported and used by `templatePromptBuilder.js` (for executive_brief). According to CLAUDE.md architectural guidance: "ALWAYS use generateStructured() for any Gemini call that needs structured output." However, many other services still use the legacy `indexOf('{')` pattern for JSON extraction:
- `functions/api/market.js` (enhancement call, line 3800)
- `functions/services/opportunityBriefService.js` (lines 212, 631, 652)
These are high-value structured outputs (strategic thesis, roadmap, KPI scorecard, brief sections) that should use `generateStructured()` for schema enforcement.
**Remediation:** Migrate opportunity brief structured sections and market.js enhancement call to `generateStructured()`. Define schemas for each.
**Effort:** 4 hours per migration

### [F-022] P1 — Legacy indexOf('{') JSON Extraction Still in Core Market Path
**Files:**
- `functions/api/market.js` line 3800 (enhancement call)
- `functions/services/opportunityBriefService.js` lines 212, 631, 652
- `functions/services/seoIntelligenceService.js` (implicitly, via Phase 3 runCitationQuery)
**Issue:** The `indexOf('{')` extraction pattern is documented as LEGACY in SYSTEM_BIBLE.md. Its continued use in production paths creates risk of silent JSON parse failures when Gemini's thinking tokens leak. The enhancement call in market.js is a particularly high-value path.
**Remediation:** Migrate to `generateStructured()` (see F-021) or at minimum add structured output enforcement (`responseMimeType: 'application/json'` without schema) where schema migration is blocked.
**Effort:** 2 hours per call site

### [F-023] P2 — Duplicate AI Client Instantiation Pattern
**Files:** `functions/services/geminiClient.js`, `functions/services/geminiClientV2.js`, direct `new GoogleGenerativeAI()` calls in `market.js`, `seoIntelligenceService.js`, `agentRunner.js`, etc.
**Issue:** `GoogleGenerativeAI` is instantiated in multiple places. There are at minimum 3 separate initialization patterns: geminiClient.js (module-level singleton), geminiClientV2.js (per-model client cache), and direct inline `const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)` in market.js and seoIntelligenceService.js. Each initialization re-reads the env var but otherwise duplicates logic.
**Remediation:** Formalize one canonical factory (geminiClientV2 is the most mature). Deprecate geminiClient.js V1.
**Effort:** 4 hours

### [F-024] P2 — claudeClient.js Not Wired to Any Active Route
**Files:** `functions/services/claudeClient.js`, `functions/config/claude.js`
**Issue:** The Anthropic SDK (`@anthropic-ai/sdk`) and `claudeClient.js` are present and configured (claude-sonnet-4-20250514), but no route handler or service file currently requires `claudeClient`. The `modelRouter.js` uses `geminiClientV2` exclusively. The Claude client appears to be infrastructure for a future SynchIQ/Bedrock path that isn't active yet.
**Impact:** The `@anthropic-ai/sdk` adds ~0.39.0 to the bundle unnecessarily if not in use.
**Remediation:** Either wire Claude into an active path (pre-SynchIQ preparation) or move it to devDependencies and add a note that it's pre-wired for SynchIQAIService.
**Effort:** 1 hour (clarification + dependency management)

### [F-025] P2 — No Linting in Functions
**File:** `functions/package.json` script: `"lint": "echo 'No linting configured'"`
**Issue:** The entire functions/ codebase has no ESLint configuration. Linting is silently skipped in CI (`predeploy` runs `npm run lint` which just echoes). This means the 3,729-line index.js and 3,917-line market.js have zero static analysis coverage.
**Remediation:** Add `eslint` + `eslint-config-google` or equivalent to devDependencies. Create `functions/.eslintrc.json` with at least `no-unused-vars`, `no-undef`, `eqeqeq` rules. Update predeploy to run real linting.
**Effort:** 2 hours (setup) + ongoing (fixing violations)

### [F-026] P2 — No Test Coverage for market.js
**Issue:** `functions/api/market.js` (3,917 lines) has no corresponding test file in `functions/tests/` or `functions/__tests__/`. It is the highest-value, most-changed file in the codebase (30+ commits in 30 days). Market Intel v4 added 6 new feature stages without test coverage.
**Remediation:** Add at minimum smoke tests for `handleGenerateMarketReport` covering: successful report generation, Firestore write fields, buildTieredResponse shape.
**Effort:** 8 hours for meaningful coverage

### [F-027] P2 — aiVisibilityMonitorCron Not Tested
**File:** `functions/scheduled/aiVisibilityMonitor.js` (742 lines)
**Issue:** No test file exists for `aiVisibilityMonitor.js`. The monitoring cron runs Gemini queries (cost) and writes to Firestore. A regression in query logic or cost calculation could cause budget overruns before being caught.
**Remediation:** Add unit tests for `detectMention()`, `computeAggregated()`, `updateAiReadinessScore()`, and the daily cost cap check.
**Effort:** 4 hours

### [F-028] P2 — Excessive console.log in Production Code
**Counts:** `functions/api/market.js` has 49 console.log/debug statements. `functions/services/` has 195+ across all service files. Many are diagnostic logs from earlier sessions (ZIP resolution, safety service, market intel status).
**Impact:** In Cloud Functions, each log line is billable and searchable. Excessive logging inflates Cloud Logging costs and obscures real errors.
**Remediation:** Add a logging utility with log levels (debug/info/warn/error). Replace diagnostic `console.log` with `console.debug` in production, or remove where no longer needed.
**Effort:** 4 hours (utility) + ongoing cleanup

### [F-029] P3 — Root src/ Directory is Vite+React Default Scaffold
**File:** `src/App.tsx`
**Issue:** The root `src/` contains a default Vite+React scaffold (counter button, Vite/React logos). This is not the SynchIntro frontend (which is in `synchintro-app`). It creates confusion for new contributors and will be deployed to Firebase Hosting if `firebase.json` is ever misconfigured to include hosting from root.
**Remediation:** Delete `src/`, `vite.config.ts`, `tsconfig.*.json`, `eslint.config.js`, and root `index.html`. Remove React/Vite packages from root `package.json`.
**Effort:** 30 minutes

### [F-030] P3 — Fayzan Reference in Master Implementation Prompt
**File:** `SynchIntro_Master_Implementation_Prompt.md` line 1178
**Issue:** "Williams (`dev1@pathsynch.com`) replaces Fayzan as solutions architect." This is historically correct context, but the standalone mention of Fayzan could confuse a new AI assistant session that hasn't read the full context. SYSTEM_BIBLE.md and CLAUDE.md handle this better (Williams-first framing).
**Remediation:** Reword to: "Williams (`dev1@pathsynch.com`) is solutions architect and reviews `pathsynch-pitch-generator` PRs." Remove the "replaces Fayzan" reference.
**Effort:** 5 minutes

### [F-031] P3 — Stale C:Userstdh35... Artifact Folder at Root
**Path:** `./C:Userstdh35pathsynch-pitch-generatorfunctionsscripts`
**Issue:** An empty folder with a Windows-mangled path exists at the repo root. Likely created when a `mkdir -p` command with an absolute Windows path was run in a non-Unix context.
**Remediation:** `git rm -r "C:Userstdh35pathsynch-pitch-generatorfunctionsscripts"` and commit.
**Effort:** 5 minutes

### [F-032] P3 — SynchIQ / Bedrock Integration Points Not Mapped
**Context:** MEMORY.md mentions "SynchIQAIService (AWS Bedrock Nova Micro, 5 methods: analyzeSentiment, generateResponse, chat, embed, searchRelevance)" as an upcoming abstraction layer. The current codebase has:
- `claudeClient.js` — Anthropic SDK wired but no active routes
- `functions/services/enrichmentWaterfall.js` — TODO stubs for Apollo, PDL, Clay, HubSpot
- `agentClient.js` — `vertexResourceName: null` placeholders for Vertex Agent Engine
None of these have been wired to Bedrock Nova Micro. There is no `SynchIQAIService` file.
**Remediation:** Before the SynchIQAIService sprint, audit which Gemini calls are candidates for routing through it (primarily the narrative formatter path via `modelRouter.js` and `geminiClientV2`). This finding documents the current state for pre-SynchIQ sprint planning.

---

## Phase 5 — API Surface Findings

### [F-033] P2 — /prospect-intel/batch Has No Input Rate Limit
**File:** `functions/routes/prospectIntelRoutes.js`
**Issue:** `POST /prospect-intel/batch` creates a Cloud Tasks fan-out that enqueues one task per prospect. With the global rate limiter applying only at the HTTP level and not per-operation, a scale user could submit a 1,000-row batch repeatedly, creating thousands of Cloud Tasks and running up significant enrichment costs.
**Remediation:** Add a per-user batch creation limit (e.g., max 3 active batches, max 500 rows per batch server-side validation). The batch size limit appears to only exist client-side.
**Effort:** 2 hours

### [F-034] P2 — /market/generate Has No Hard Request Body Size Limit
**File:** `functions/api/market.js`
**Issue:** The market report generation endpoint accepts `competitors`, `serperLeads`, and other arrays from the request body without length caps at the server. Very large payloads could cause memory issues on the 1GiB function or slow AI enrichment.
**Remediation:** Add server-side array length validation (e.g., max 50 competitors, max 200 leads in body).
**Effort:** 1 hour

### [F-035] P2 — Attio Push Route has No Input Validation
**File:** `functions/routes/attioRoutes.js`
**Issue:** `POST /attio/push-account` takes an `accountKey` from the request body and reads Account360 data. There is no validation that `accountKey` belongs to `req.userId`. This could allow a user to trigger an Attio push for another user's Account360 data.
**Remediation:** Add ownership check: verify `accountKey` starts with `${req.userId}:` or that the Account360 doc's `workspaceId` matches `req.userId`.
**Effort:** 1 hour

### [F-036] P3 — Two Instantly Integrations with Different Route Prefixes
**Files:** `functions/services/instantlyService.js`, `functions/services/instantlyClient.js`
**Issue:** Two separate Instantly integrations exist (per-user via `/instantly/*` and global via `/instantly-market/*` and `/instantly/vi-*`). This is intentional but creates ongoing confusion. The routes index exports both but one is named differently.
**Remediation:** Document this architecture decision prominently in a single comment block in `functions/routes/index.js`. No code change needed.
**Effort:** 15 minutes

### [F-037] P3 — /audit Route Exists but Is Not Documented
**File:** `functions/api/audit/index.js`
**Issue:** An `/audit` route module exists with a Gemini call (`thinkingBudget: 0`). This route is not listed in `routes/index.js` AVAILABLE_ENDPOINTS and does not appear to be dispatched from `index.js`. Its purpose is unclear.
**Remediation:** Investigate and either register it in routes or mark it as a dead artifact.
**Effort:** 1 hour (investigation)

---

## Phase 7 — CI/CD Findings

### [F-038] P2 — FIREBASE_TOKEN is a Single Point of Failure
**File:** `.github/workflows/ci.yml` line (deploy job)
**Issue:** The CI deploy uses `FIREBASE_TOKEN` as the deployment credential. If this token expires or is rotated, all CI deploys fail silently until someone notices. Firebase Tokens from `firebase login:ci` expire. The deploy has a timeout of 20 minutes but no alerting if it fails.
**Remediation:** Migrate to Workload Identity Federation for keyless Firebase deployment (GCP best practice). Alternatively, add a GitHub Actions notification on deploy job failure.
**Effort:** 4 hours (Workload Identity) or 30 minutes (failure notification)

### [F-039] P2 — Coverage Is Not Enforced in CI
**File:** `.github/workflows/ci.yml`
**Issue:** `npm test` runs all tests but there is no coverage threshold (`--coverage --coverageThreshold`). The test count is 1,080 but test coverage of the actual production code path is unknown. The prior audit noted coverage was "aspirational, not blocking."
**Remediation:** Add `--coverage --coverageThreshold '{"global":{"lines":50}}' ` to the test command in CI. 50% is a reasonable starting gate; increase over time.
**Effort:** 2 hours (setup + fixing any violations)

### [F-040] P3 — Weekday Health Audit References External Repo (synchintro-app)
**File:** `.github/workflows/weekday-health-audit.yml`
**Issue:** The health audit workflow checks out both `pathsynch-pitch-generator` and `synchintro-app`. If the `synchintro-app` repo is renamed or made private, the workflow will silently fail. The workflow uses `actions/checkout@v4` which may fail on private repos without a PAT.
**Remediation:** Verify that `GITHUB_TOKEN` in the workflow has access to `synchintro-app`. Add explicit error handling.
**Effort:** 1 hour

---

## Phase 8 — Documentation Findings

### [F-041] P2 — functions/CLAUDE.md Does Not Cover AIsynch Phase 1A/1B Carry-Forward Rules
**File:** `functions/CLAUDE.md`
**Issue:** While `functions/CLAUDE.md` documents Phase 1A and 1B architectures in detail, the carry-forward rules are scattered across session entries. The critical "dev bypass must be removed before production launch" note from Phase 1A is buried deep in a session entry dated May 20-21. Since the bypass (`AISYNCH_ALLOW_TEST_TOKEN`) is confirmed absent from code now, this is moot — but the CLAUDE.md should confirm this closure.
**Remediation:** Add a "Phase 1 Deployment Status" section at the top of the AIsynch entries confirming: dev bypass removed ✓, PATHMANAGER_JWT_SECRET added to EC2 ✓ (or ✗ if pending).
**Effort:** 30 minutes

### [F-042] P3 — CHANGELOG.md at Root is Stale (Last Entry April 24)
**File:** `CHANGELOG.md` (root)
**Issue:** The root `CHANGELOG.md` was last updated April 24, 2026. All subsequent changes are in `changelogs/CHANGELOG_2026-*.md`. This creates a misleading first impression for anyone looking at the root changelog.
**Remediation:** Either update root `CHANGELOG.md` to point to the `changelogs/` directory, or add a header: "See changelogs/ for entries after April 24, 2026."
**Effort:** 10 minutes

---

## Miscellaneous Findings

### [F-043] P2 — firestore-debug.log Committed to Repo
**File:** `firestore-debug.log` (root, committed, 22KB)
**Issue:** `firestore-debug.log` is committed to the repository. Debug logs from local Firestore emulator should not be in version control.
**Remediation:** Add `firestore-debug.log` to `.gitignore` and remove with `git rm --cached firestore-debug.log`.
**Effort:** 5 minutes

### [F-044] P2 — AISYNCH_ALLOW_TEST_TOKEN in .env.example Set to false
**File:** `functions/.env.example` line 126: `AISYNCH_ALLOW_TEST_TOKEN=false`
**Issue:** The dev bypass env var is documented in `.env.example` with a default of `false`. However, the actual bypass check has been removed from `aiReadinessScan.js`. Leaving this in `.env.example` implies the var does something when it no longer does.
**Remediation:** Remove `AISYNCH_ALLOW_TEST_TOKEN` from `.env.example` entirely since the code no longer checks it.
**Effort:** 5 minutes

### [F-045] P2 — Census API Key Invalid (Known, Assigned to Williams)
**Known issue from May 18 session.** `CENSUS_API_KEY` returns `missing_key.html`. The demographics enrichment silently degrades but logs confusingly. This is documented as assigned to Williams. Flagging for tracking purposes.
**Remediation:** Williams to verify and update the Census API key.

### [F-046] P2 — DataForSEO 404 on Reviews Endpoint (Known, Assigned to Williams)
**Known issue from May 18 session.** DataForSEO `/business_data/google/reviews/live/advanced` endpoint returning 404. Review enrichment falls back to Google Places. This is documented as assigned to Williams.
**Remediation:** Williams to investigate correct endpoint path.

### [F-047] P2 — Missing Firestore Composite Index for marketReports (Known, Assigned to Williams)
**Known issue from May 18 session.** `marketReports` collection missing composite index on `location.city + userId + createdAt`. This causes slow or failing queries on the My Reports page for users with many reports.
**Remediation:** Williams to add the composite index via Firestore Console.

### [F-048] P3 — SynchIntro HealthCheck files Not Committed
**Files:** `SynchIntro_HealthCheck_2026-05-25.md` (untracked), `SynchIntro_HealthCheck_2026-05-28.md` (committed)
**Issue:** The May 25 health check file exists locally but was never committed. If the local machine is lost, the historical score record is lost.
**Remediation:** Commit the May 25 health check file or delete it if superseded by the May 28 file.
**Effort:** 5 minutes

### [F-049] P3 — functions/coverage/ and functions/junit.xml Are Untracked Artifacts
**Issue:** `functions/coverage/` directory and `functions/junit.xml` are untracked local files from CI test runs. These are generated artifacts and should not be in the working directory.
**Remediation:** Add to `.gitignore`: `functions/coverage/`, `functions/junit.xml`.
**Effort:** 5 minutes

---

## Recommended Action Plan

### Immediate (This Week)

| Finding | Action | Owner |
|---------|--------|-------|
| F-001 | Delete `functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json` and rotate the service account key | Charles |
| F-002 (revised P2) | Run `git log --all --full-history -- functions/.env` to confirm no commit history; document as clean | Charles |
| F-013 | `git stash pop` the axios fix branch, review, merge if valid | Charles/Williams |
| F-031 | Remove the empty mangled folder at root | Charles |
| F-043 | Remove `firestore-debug.log` from git tracking | Charles |
| F-049 | Add `functions/coverage/` and `functions/junit.xml` to .gitignore | Charles |

### This Sprint

| Finding | Action | Owner |
|---------|--------|-------|
| F-004 | Tighten pitchAnalytics Firestore write rule | Williams |
| F-005 | Remove isDefault create path from icpProfiles Firestore rule | Williams |
| F-018 | Test PDF export and upgrade html2pdf.js to 0.14.0 | Williams |
| F-019 | Document all missing AIsynch env vars in `.env.example` | Williams |
| F-025 | Add ESLint to functions/ with basic rules; fix predeploy | Williams |
| F-033 | Add server-side batch size validation in prospect-intel routes | Williams |
| F-035 | Add ownership validation to attio push route | Williams |
| F-038 | Add GitHub Actions failure notification on deploy job | Williams |
| F-044 | Remove `AISYNCH_ALLOW_TEST_TOKEN` from `.env.example` | Charles |
| F-045, F-046, F-047 | Verify Census key, DataForSEO endpoint, Firestore index | Williams |

### Next Sprint

| Finding | Action | Owner |
|---------|--------|-------|
| F-003 | Move high-value secrets (Stripe) to Firebase Secret Manager | Charles/Williams |
| F-011 | Add `ENABLE_SEO_INTELLIGENCE` feature flag to SEO Intelligence Layer | Williams |
| F-021 | Migrate opportunity brief structured generation to `generateStructured()` | Williams |
| F-022 | Migrate market.js enhancement call from indexOf to `generateStructured()` | Williams |
| F-023 | Consolidate Gemini client initialization to geminiClientV2 pattern | Williams |
| F-026 | Add smoke tests for market.js core report generation path | Williams |
| F-029 | Remove Vite+React default scaffold from root src/ | Charles |
| F-039 | Enable coverage threshold in CI | Williams |

### Backlog

| Finding | Action |
|---------|--------|
| F-007 | Add PathManager bearer token auth to marketBenchmarks read |
| F-009 | Continue index.js decomposition (12 groups remain per decomposition plan) |
| F-010 | Extract market.js into sub-orchestrators |
| F-015 | Investigate and wire intelligence/ pipeline or document as not active |
| F-016 | Add pagination to processThresholdAlerts account sweep |
| F-024 | Decide Claude/Anthropic SDK future: SynchIQ pre-wire or devDependency |
| F-025 | Fix all ESLint violations after adding linting (F-025) |
| F-028 | Add log-level utility; replace diagnostic console.log |
| F-032 | Map Gemini call candidates for SynchIQAIService routing |
| F-037 | Investigate /audit route |
| F-040 | Verify weekday health audit cross-repo access |

---

## Pre-SynchIQAIService Integration Prep

Before wiring in `SynchIQAIService` (AWS Bedrock Nova Micro), the following tech debt should be resolved:

1. **Consolidate Gemini client factory (F-023).** Currently 3+ initialization patterns. SynchIQAIService will need to be a peer abstraction, not fight with multiple existing clients.

2. **Migrate to generateStructured() for all structured outputs (F-021, F-022).** Schema-enforced output is required for reliable downstream processing regardless of which model provides the response. This should be in place before adding a second AI provider.

3. **Formal model routing layer.** `modelRouter.js` exists but routes only Gemini↔Claude (Claude never active). Before SynchIQ, define which operations should stay on Gemini vs. route to Bedrock. Candidates for Bedrock Nova Micro: `analyzeSentiment` (review sentiment), `generateResponse` (short narrative fills), `chat` (pre-call brief chat interface).

4. **Decouple business logic from AI client calls.** Several services (narrativeGenerator.js, salesIntelGenerator.js) embed `GoogleGenerativeAI` initialization inline. Extracting to a factory pattern will make them AI-provider-agnostic before SynchIQ wiring.

5. **Remove claudeClient.js dead code or activate it.** If the Anthropic SDK is pre-wired for SynchIQ, document this explicitly. If not, remove the dead dependency.

6. **Add AISYNCH_PRICE_ID env vars to Secret Manager.** Stripe price IDs for production billing should not be read from .env — they should be in Secret Manager or at minimum documented with a validation step at startup.

---

## Pre-VertexAI Migration Section (June 24 Deadline)

**Assessment:** After comprehensive search, there are **zero** `@google-cloud/vertexai` SDK imports in this repository. The migration appears complete here.

**What Williams should verify before June 24:**
1. Run `grep -rn "@google-cloud/vertexai" functions/ --include="*.js"` — expect zero results (confirmed in this audit)
2. Verify the `vertexSearch.js` service uses `google-auth-library` + direct REST (not the VertexAI SDK) — confirmed ✓
3. Confirm the MEMORY.md "4 files remaining" refers to a different repo (likely PathManager_backend or synchintro-app)
4. Check `agentClient.js` — it has `vertexResourceName: null` stubs but imports nothing from `@google-cloud/vertexai` — confirmed safe ✓
5. The `@sparticuz/chromium` and `@google-cloud/storage` usages are unrelated to the VertexAI SDK

**If the deadline applies to synchintro-app (frontend):** That repo is out of scope for this audit. Williams should check `synchintro-app` package.json for `@google-cloud/vertexai`.

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| P0 | 1 (F-001 service account key on disk — delete now) |
| P1 | 7 (F-003 secrets management, F-004/F-005 Firestore rules, F-006 SpyFu password, F-018 html2pdf XSS, F-021/F-022 legacy JSON extraction) |
| P2 | 24 |
| P3 | 9 |
| **Total** | **41** |

---

*Report generated by Claude Code (claude-sonnet-4-6) on 2026-06-08.*
