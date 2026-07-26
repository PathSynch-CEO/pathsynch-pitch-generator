# SynchIntro Codebase Audit Report
**Date**: 2026-07-21
**Scope**: `pathsynch-pitch-generator` (backend, branch `fix/govscoring-fixture-daterot`) + `synchintro-app` (frontend, branch `feat/govcapture-c5-evaluator`). Full 8-phase read-only re-audit — every phase re-verified from current code/git state, not assumed from the prior report.
**Prior audit reference**: `SYNCHINTRO_AUDIT_REPORT_2026-07-14.md` (B / 79/100)

## Executive Summary

- **Overall Health Score: B+ (≈84/100)**
- **Change since last audit: +5 points.** The week since 07-14 saw a genuine remediation sprint (backend PRs #48/#49/#51 + frontend PRs #27/#29/#30, plus the July 16–17 workspace-identity fix chain) that closed **all three prior P1s** and four P2s. That gain is partly offset by one **newly discovered P1**: `pathconnect-442522` (the GCP project this platform's own operating rules flag as *wrong* for SynchIntro) is a **live production dependency**, not just historical incident narrative — the same failure class as the July Gemini-key outage, now found on Vertex AI Search grounding and the Prospect Intel Cloud Tasks queue.
- **Critical (P0): 0 | High (P1): 1 | Medium (P2): 9 | Low (P3): 12** (22 open findings; 8 prior findings confirmed fixed — see below)

## Status of Previously Known Issues

| Item | Status | Evidence |
|---|---|---|
| **F-201** — no reconciler for stuck prospect batches | **FIXED** | `functions/scheduled/prospectBatchReconciler.js` ages out stale `processing` batches hourly (`onSchedule('every 1 hours')`, `index.js:3675`); tested in `prospectBatchReconciler.test.js`. Merged PR #48. |
| **F-101** — dual-repo `firestore.rules` drift | **FIXED** | `synchintro-app/firebase.json` no longer declares `firestore`/`storage` targets; `synchintro-app/firestore.rules` is now a 19-line deny-all stub headed "NOT THE SOURCE OF TRUTH — DO NOT DEPLOY FROM THIS REPO." Backend remains sole canonical owner (792-line rules file, only 2 intentionally-public read paths, both `write:false`). Commit `7b56d68` (#27). |
| **F-701** — CI deploys functions without `.env` | **FIXED (mitigated)** | Backend `ci.yml`'s `deploy` job now has `if: false` with an inline comment naming F-701 explicitly: unreviewed auto-deploys on deprecated auth, no `.env` on the runner. No push to `main` can auto-deploy functions today. Proper fix (Secret Manager injection) is scoped but not yet built — acceptable as a fast-guard. Merged PR #49. |
| **Seller Profile P0** (support/GTM accounts not inheriting workspace profiles) | **FIXED** | Root cause: `getCurrentUser()` used a client-side `array-contains` team-membership query the May-5 rules lockdown silently rejects for non-owners. Fixed via new server-side `GET /me/workspace-context` endpoint (backend commit `93664c1`, tested) + frontend rewrite (`bcf305a`, `3a5b4ca`). A same-day second-order regression this fix exposed (onboarding wizard hard-blocked for members) was diagnosed and fixed same day (`fee39f5`, PR #37). Cross-verified independently by two agents. |

Also confirmed fixed this pass (P2s from the prior audit): **F-601** (emulator/security test suites now run in a dedicated CI job and gate merges), **F-703** (frontend CI runs a real headless Playwright smoke test before hosting deploy, replacing the old no-op), **F-704** (README now documents one canonical deploy procedure, including the `FUNCTIONS_DISCOVERY_TIMEOUT=120` workaround that was previously tribal knowledge), **F-801** (`SYSTEM_BIBLE.md` now current through July 16, past SynchGov go-live and the entitlement fix).

## Health Score Breakdown

| Category | Score | Weight | Weighted | Δ vs 07-14 |
|---|---|---|---|---|
| Security | 22/25 | 30% | 26.4 | +1 (F-101 closed; offset by new pathconnect-442522 P1) |
| Reliability | 22/25 | 25% | 22.0 | +2 (F-201 closed; F-202 still open) |
| Dependencies | 12/15 | 15% | 12.0 | flat (multer fixed; new critical `tar` advisory + dead `html2pdf.js` dep found, both low-impact) |
| Code Quality | 16/20 | 15% | 12.0 | −1 (F-102/F-402/F-501 unchanged; new inconsistent-error-shape finding) |
| Testing | 8/10 | 10% | 8.0 | +1 (suite grew 1,710→1,904 tests, 0 failing; F-601 closed; new untested-path findings) |
| CI/CD & Docs | 4/5 | 5% | 4.0 | +1.5 (F-701/F-703/F-704/F-801 closed; F-702/F-802/F-803 still open) |
| **Total** | | | **≈84.4/100 (B+)** | **+5.4** |

## New Findings

### [SEC-1] `pathconnect-442522` is a live production dependency for Vertex Search + Prospect Intel
- **Severity**: **P1** · **Category**: Security/Infra · **Location**: `functions/.env:16,35,82`; hardcoded fallbacks in `services/vertexSearch.js:8,15,17`, `services/prospectIntelService.js:34`, `services/reviewHealthEnqueue.js:16`; Cloud Tasks queue `prospect-enrichment` (us-central1)
- **Description**: `GCP_PROJECT_ID`, `PATHSYNCH_GCP_PROJECT`, and `VERTEX_SEARCH_DATA_STORE_ID` all point at `pathconnect-442522` — the project this platform's own documented rules identify as *wrong* for SynchIntro (it belongs to PathManager/Entity360). Three services have hardcoded fallback defaults pointing at the same project, and the live Prospect Intel enrichment pipeline runs its Cloud Tasks queue there too. This isn't legacy doc drift — it's wired into the runtime path today.
- **Impact**: Identical failure class to the July Gemini-key outage. Any IAM change, API restriction, or project-level action taken by the PathManager/Entity360 team in `pathconnect-442522` can silently break SynchIntro's Vertex AI Search grounding and/or the entire Prospect Intel enrichment pipeline, with no warning on the SynchIntro side.
- **Remediation**: Migrate the `synchintro-knowledge-base` Discovery Engine datastore and the `prospect-enrichment` Cloud Tasks queue into `pathsynch-pitch-creation`; update `.env` + the three hardcoded fallbacks; re-grant IAM on the new project's compute service account.
- **Effort**: Medium

### [F-904] Banned-language / em-dash enforcement is weaker than documented
- **Severity**: P2 · **Category**: AI/Content Quality · **Location**: `intelligence/constants.js` (`BANNED_PHRASES`), `intelligence/generation/briefGenerator.js:95`
- **Description**: The enforcement list has 30 terms, not the ~90 expected — no source of that larger number was found. Phrase-list violations are only `console.warn`-logged (recorded in `_meta.qualityCheck`), never stripped or regenerated — flagged content still reaches the client. The em-dash prohibition exists only as prompt-level instructions scattered across generator files; no runtime code actually strips em-dashes from Gemini output.
- **Impact**: Banned phrases and em-dashes can and do reach client-facing sales content; the "enforcement" is closer to a soft audit trail than a hard gate.
- **Remediation**: Make `genericityTest` fail-closed (strip/regenerate, matching `reportSanitizer.js`'s pattern) and add a runtime em-dash regex strip on all generator outputs.
- **Effort**: Medium

### [F-905] `activityService.js` — including the F-202 bug — has zero test coverage
- **Severity**: P2 · **Category**: Testing · **Location**: `functions/services/activityService.js`
- **Description**: No test file references this service at all. `markAllRead`'s unbounded-batch bug (F-202, still open — queries all unread notifications with no `.limit()`, single `batch.commit()` throws past 500 ops) will land any future fix untested unless one is added alongside it.
- **Remediation**: add coverage when F-202 is fixed; chunk writes at ≤450.
- **Effort**: Quick–Medium

### [F-906] Inconsistent API error response shapes
- **Severity**: P2 · **Category**: Code Quality · **Location**: cross-route (e.g. `opportunityBriefRoutes.js`/`govcaptureRoutes.js` use `{success:false, error:{code,message}}`; `prospectIntelRoutes.js` returns bare-string `error`)
- **Description**: No shared error-response helper exists; shape is decided ad hoc per route file.
- **Impact**: Frontend error handling gets harder to standardize as more routes are added.
- **Remediation**: introduce one shared error-response helper, migrate routes incrementally.
- **Effort**: Medium

### [F-907] New critical `tar` advisory in frontend dev tooling
- **Severity**: P2 · **Category**: Dependencies · **Location**: `synchintro-app` root, transitive via `firebase-tools`
- **Description**: `tar <=7.5.18` DoS (GHSA-23hp-3jrh-7fpw) is now **critical** severity in the root `npm audit` (up from the prior "high" ceiling described in F-303). Confined to dev tooling — never bundled into the deployed hosting bundle — but the severity class changed.
- **Remediation**: bump `firebase-tools`.
- **Effort**: Quick

### [F-908] `html2pdf.js` — unused runtime dependency carrying a HIGH XSS advisory
- **Severity**: P3 · **Category**: Dependencies · **Location**: `pathsynch-pitch-generator` root (Vite/React admin console) `package.json`
- **Description**: Declared as a runtime dependency but not imported anywhere in `src/`.
- **Remediation**: remove it.
- **Effort**: Quick

### [F-909] `agentRunner.js` / `geminiClient.js` — Gemini call wrappers have no dedicated unit tests
- **Severity**: P3 · **Category**: Testing · **Location**: `functions/services/agentRunner.js`, `functions/services/geminiClient.js`
- **Remediation**: add direct unit tests; currently only reached indirectly via higher-level route tests.
- **Effort**: Medium

### [F-910] No `minInstances` anywhere — every function cold-starts, including the primary 1GiB `api` export
- **Severity**: P3 · **Category**: Reliability · **Location**: `functions/index.js` (global function config)
- **Remediation**: consider `minInstances:1` on the main `api` export if p95 latency on cold sales-facing requests matters.
- **Effort**: Quick–Medium

### [F-911] Stripe webhook has no `event.id` dedupe; confirmation email can double-send on retry
- **Severity**: P3 · **Category**: Billing · **Location**: `functions/api/stripe.js:191-239`
- **Description**: Entitlement writes are naturally idempotent (`set({...},{merge:true})` keyed by subscription/user ID), so no double-grant risk. `handleCheckoutComplete`'s confirmation email has no dedupe guard — a Stripe retry can send it twice.
- **Remediation**: guard the email send with an idempotency key or processed-events check.
- **Effort**: Quick

### [F-912] No rollback runbook for a bad Functions deploy
- **Severity**: P3 · **Category**: Docs · **Location**: `README.md` (new Deployment section only covers forward-deploy)
- **Effort**: Quick

### [F-913] Firebase CLI unpinned in the new `emulator-tests` CI job
- **Severity**: P3 · **Category**: CI/CD · **Location**: `.github/workflows/ci.yml` (`emulator-tests` job installs `firebase-tools` globally, no version pin)
- **Remediation**: pin to the same version the frontend devDependency uses (`^15.5.1`).
- **Effort**: Quick

## Still-Open Findings Carried From 07-14 (unchanged this pass)

| ID | Sev | One-line |
|---|---|---|
| F-202 | P2 | `activityService.js:markAllRead` unbounded batch write still throws past 500 unread items (now also untested — see F-905) |
| F-702 | P2 | Both repos' CI still auth via deprecated `FIREBASE_TOKEN`; frontend's **active** hosting-deploy job still uses it live (has already expired twice this session per team notes) |
| F-602 | P3 | 50% coverage threshold only enforced via `test:ci` script, which CI never invokes (`npm test` runs plain `jest`) |
| F-603 | P3 | `POST /team/revoke-invite` still has no test coverage |
| F-102 | P3 | Retired UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` still referenced in `setCountifiICP.js:17`, `testPitchGeneration.js:92`, `templateOnePager.js:12` |
| F-402 | P3 | `geminiClient.js`/`geminiClientV2.js` sprawl; `coverage/`, `backups/`, `junit.xml` still untracked and still not in `.gitignore` |
| F-501 | P3 | Vestigial admin endpoints (`backfillConfidenceFields`, `calibrateMerchant`) still exported |
| F-401 | P2 | `.env.example` drift has **grown**: now ~95 vars documented vs. many more app-specific vars in code, including newer gaps (`ANTHROPIC_API_KEY`, `APOLLO_API_KEY`, `CLAY_API_KEY`, `PDL_API_KEY`, `HUBSPOT_ACCESS_TOKEN`, `AISYNCH_*_PRICE_ID`, `ADMIN_BOOTSTRAP_KEY`, `ALLOWED_ORIGINS`) alongside the original Stripe-price/Turnstile/token-encryption gaps |
| F-802 | P3 | `synchintro-app` still has no `README.md` (only `AGENTS.md`, `CLAUDE.md`, `PRODUCT_BIBLE.md`, `CHANGELOG.md`) |
| F-803 | P3 | README env template/deploy docs lag reality (compounds as F-401 grows) |
| F-103 | P2 | On-disk SA key `C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json` still present, unencrypted, broadly scoped — not deep-audited this pass |

## Verified-Healthy (re-confirmed, no change)

- No hardcoded secrets/keys/tokens in tracked source of either repo; `.env` files correctly git-ignored in both; no Firebase SA keys committed.
- No banned Gemini models anywhere in `functions/` app code (`gemini-1.5-*`, `gemini-2.0-*`, bare `gemini-3-pro-preview` — zero hits). Model hierarchy correctly applied: `gemini-3-flash-preview` (primary), `gemini-2.5-flash` (simple), `gemini-3.1-pro-preview` (advanced). One stale doc note in `SYSTEM_BIBLE.md`/`CLAUDE.md` about a March `gemini-2.0-flash` migration is confirmed **not live in code** (`agentRunner.js:20` hardcodes the correct model) — just needs the doc note closed out.
- `thinkingBudget:0` + object-form `generateContent` (or `generateStructured()`) correctly used for deterministic JSON extraction; thinking correctly left on for synthesis/brief calls.
- `GEMINI_API_KEY` confirmed native to `pathsynch-pitch-creation`, not `pathconnect-442522` — the new SEC-1 finding is a different resource class (Vertex Search datastore + Cloud Tasks queue), not the Gemini key itself.
- No unbounded/unmetered Gemini fan-out loops found (`govTailoringService.js` explicitly caps at `MAX_GROUPS=10`; Prospect Intel batches capped at 500 rows / 5 concurrent).
- Cloud Functions auth coverage verified healthy — every route spot-checked has `requireAuth` + ownership checks; the few raw admin endpoints have their own `x-admin-key` gate.
- Input validation verified strong on the two highest-risk endpoints (Prospect Intel batch upload, GovCapture manual file upload — the latter does magic-byte file-signature validation beyond declared MIME type).
- Test suite: **1,904 passing, 0 failing** (up from 1,710 at baseline), run live this session.
- GovCapture (the dominant feature area since 07-14) has strong test coverage of its own (evaluator, rubric assembler, tailoring, master-proposal vault all have dedicated test files).

## Recommended Action Plan

1. **Immediate (P0/P1 — this week)**
   - SEC-1: migrate the Vertex Search datastore and `prospect-enrichment` Cloud Tasks queue out of `pathconnect-442522` into `pathsynch-pitch-creation`.
2. **This Sprint (P2)**
   - F-702: finish the scoped-but-unbuilt migration off deprecated `FIREBASE_TOKEN` (frontend's live hosting deploy is the active exposure — it has already expired mid-session before).
   - F-202 + F-905: chunk `markAllRead` batch writes at ≤450 and add test coverage in the same change.
   - F-904: make banned-language enforcement fail-closed (strip/regenerate) and add a runtime em-dash strip.
   - F-401: regenerate `.env.example` from code, grouped by subsystem.
   - F-907: bump `firebase-tools` to clear the critical `tar` advisory.
   - F-906: introduce one shared API error-response shape.
3. **Next Sprint (P3)**
   - F-602/F-603: wire `test:ci` (coverage-gated) into the CI `test` job; add revoke-invite test coverage.
   - F-102/F-402/F-501: retired-UID cleanup, Gemini client consolidation, `.gitignore` the build artifacts, retire vestigial admin endpoints.
   - F-802/F-803/F-912/F-913: add a frontend README, a rollback runbook, and pin `firebase-tools` in the new CI job.
   - F-908: remove unused `html2pdf.js`.
   - F-909/F-910/F-911: add agentRunner/geminiClient tests, consider `minInstances` on the primary API function, add Stripe webhook email-send dedupe.
4. **Backlog**
   - F-103: separately scoped IAM review of the on-disk SA key (flagged, not actioned, in both this and the prior audit).

## Known Legacy Issues — Do Not "Fix"
- `STRIPE_SECRETE_KEY`, `buisnessName`, `buisnessAddress`, `GOVCAPTURE_RFPMART_ENABLED` — documented legacy naming decisions, intentionally left as-is.

## What Could Not Be Verified With Local Repo Access
- Actual deployed Firestore rules state in production (only file-vs-file drift between the two repos was checkable this session — the file-level fix (F-101) is confirmed, but a live pull of the deployed ruleset was not performed).
- IAM role scope on the on-disk service-account key or on the `pathconnect-442522` compute service account.
- Whether `pathconnect-442522`'s Vertex Search datastore / Cloud Tasks queue have had any recent instability from PathManager/Entity360-side activity (this audit only confirms the *dependency exists*, not that it has already caused an incident).
