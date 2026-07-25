# SynchIntro Audit Report — 2026-07-14 (Canonical Consolidation)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Scope**: Full 8-phase read-only audit of both repos. Static/offline for Phases 2–8 (locked credential policy: no service-account key, no production/Rules-API reads). One confirmed non-interactive live read of the deployed `firestore.rules` in Phase 1 (via on-disk SA key, read-only GETs) is reused as established fact. Entity360 (Cloud Run) noted where adjacent, not deep-audited. Per-phase evidence in `phase1`–`phase8-findings.md`. This file is the single canonical consolidation (executive summary + full per-finding detail).

---

## Executive Summary

SynchIntro is in **good shape — Health Score B (79/100)**. There are **no P0 issues**: no secrets in code, no unauthenticated data endpoints, no banned Gemini models, and the **production Firestore ruleset is the correct hardened version** (P0 share-leak fix, entitlement write-guard, and full multi-tenant isolation all live and verified). The automated test suite is large and green (**1,710 passing, 0 failing** — above the 1,702 baseline), with strong coverage of billing, sharing, enrichment, and SynchGov scoring.

The **three P1 findings are latent hazards and governance gaps, not active breaches**:
- **F-201** — the SynchGov/Prospect batch cap has no automated self-heal; a stuck batch permanently consumes one of a user's 5 slots and returns a 429 hard-block until a human runs a manual cleanup script. *(This is the one item with a real production incident behind it.)*
- **F-101** — both repos can deploy `firestore.rules` to the same project; the frontend repo holds a **stale, pre-P0-fix** copy, so one careless unscoped `firebase deploy` from it would re-open the share-leak and drop tenant isolation. (No exposure today; CI is `--only hosting`, so the automated path is safe.)
- **F-701** — the backend CI `deploy` job is armed on every push to `main` and ships **without `functions/.env`**, which would strip all runtime env vars (Gemini/Stripe/SAM.gov/encryption keys) from production.

**Totals — P0: 0 · P1: 3 · P2: 9 · P3: 9 (21 findings).**

---

## Known-Issue Checklist Results

| # | Item | Result |
|---|------|--------|
| 1 | Enrichment agent Gemini 400 / foreign key | **VERIFIED-HEALTHY** — `agentRunner.js:29` reads native `GEMINI_API_KEY`; model `gemini-3-flash-preview`. Foreign-key theory disproven. |
| 2 | Gemini key placement (line 19 native / line 36 unused) | **VERIFIED-HEALTHY** — line 36 commented and read nowhere. |
| 3 | Prompt-scaffolding sanitizer (PR #43) | **VERIFIED-HEALTHY** — `reportSanitizer.scaffolding` present + unit-tested. |
| 4 | Enterprise entitlement mapping (4 locations) | **VERIFIED-HEALTHY** — PR #44 merged to backend `main`; `planGate` hierarchy + `brandResolver` TIER_RANK include `enterprise`; `enterpriseEntitlement.test.js` covers it; frontend fix commit on `main`. |
| 5 | P0 share-leak (PR #23) | **VERIFIED-HEALTHY in production** — live rules removed onepager public-read; server-side share endpoint. ⚠️ Caveat: the *frontend repo's* rules file still carries the pre-fix rule (F-101). |
| 6 | White-label / multi-tenant isolation | **VERIFIED-HEALTHY** — `agencyEntitlements`/`workspaceBranding` are `write:false`; `brandResolver` never trusts client-writable overrides; emulator tests assert it. |
| 7 | SynchGov zombie-batch / "Maximum 5 active" | **STILL-OPEN (partially mitigated)** — cap exists; no automated reconciler; cleanup is a manual whitelist script (F-201). |

---

## Health-Score Breakdown

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Security | 21/25 | 30% | 25.2 |
| Reliability | 20/25 | 25% | 20.0 |
| Dependencies | 12/15 | 15% | 12.0 |
| Code Quality | 17/20 | 15% | 12.75 |
| Testing | 7/10 | 10% | 7.0 |
| CI/CD & Docs | 2.5/5 | 5% | 2.5 |
| **Total** | | | **≈79/100 (B)** |

CI/CD & Docs is the weakest area — it carries a P1 (env-wipe) and three P2s.

---

## Full Findings Table (all 8 phases)

| ID | Sev | Category | One-line description |
|----|-----|----------|----------------------|
| **F-101** | **P1** | Security | Split-brain `firestore.rules`: frontend repo holds stale pre-P0-fix copy; an unscoped deploy from it regresses the share-leak + tenant isolation. |
| **F-201** | **P1** | Reliability | No automated reconciler for stuck prospect batches → "Maximum 5 active" 429 hard-block needs a manual whitelist script (checklist #7). |
| **F-701** | **P1** | CI/CD | Backend CI deploys functions on every `main` push without `.env` → can wipe all production runtime env vars. |
| F-103 | P2 | Security | On-disk service-account key reaches the production Rules API; IAM scope not minimized (review separately — not actioned in-audit). |
| F-202 | P2 | Reliability | `markAllRead` (`activityService.js:166`) does an unbounded batch write; >500 unread notifications exceeds the 500-op limit → commit throws. |
| F-301 | P2 | Dependencies | `multer ^2.1.1` (direct dep, used on upload endpoints) sits at a HIGH advisory ceiling — DoS via malformed multipart. |
| F-401 | P2 | Code Quality | `.env.example` documents 88 of 132 env vars read in code (Stripe price IDs, Turnstile, token-encryption key undocumented). |
| F-601 | P2 | Testing | `*.emulator.test.js` (P0 share-leak + Gate #7 tenant isolation) excluded from CI → the security tests don't gate merges. |
| F-702 | P2 | CI/CD | Deprecated `FIREBASE_TOKEN` CI auth (both repos) — 401s on expiry (already happened once). |
| F-703 | P2 | CI/CD | Frontend CI runs no tests (Tests step = `echo "TODO"`); hosting ships gated only by `npm audit`. |
| F-704 | P2 | CI/CD | Two divergent deploy paths; the `FUNCTIONS_DISCOVERY_TIMEOUT=120` workaround is Windows-local only — no single documented deploy procedure. |
| F-801 | P2 | Docs | `SYSTEM_BIBLE.md` ~7 weeks stale (last content May 26) — predates SynchGov go-live, PR #44, Secret Manager plan. |
| F-102 | P3 | Code Quality | Retired UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` still referenced in `setCountifiICP.js:17`, `testPitchGeneration.js:92`, a comment. |
| F-302 | P3 | Dependencies | 12 backend transitive advisories via firebase-admin/google-cloud (grpc/protobufjs/form-data/uuid) — not in a reachable path. |
| F-303 | P3 | Dependencies | Frontend/root HIGH advisories confined to dev tooling (firebase-tools/serve/playwright/vite) — never shipped to the browser. |
| F-402 | P3 | Code Quality | Gemini-client sprawl (5 modules; `geminiClientV2` near-unused) + untracked build clutter (`coverage/`, `backups/`, `junit.xml`) not git-ignored. |
| F-501 | P3 | API Surface | Vestigial admin endpoints (`backfillConfidenceFields` one-time backfill, `calibrateMerchant`) — retirement candidates. |
| F-602 | P3 | Testing | 50% coverage threshold only enforced on `--coverage`; CI's `npm test` doesn't gate it. |
| F-603 | P3 | Testing | Untested paths: `POST /team/revoke-invite`; F-201/F-202 fixes will need tests. |
| F-802 | P3 | Docs | Frontend `synchintro-app` has no README (only an AI-oriented `CLAUDE.md`). |
| F-803 | P3 | Docs | README env template (~20 vars) and deploy docs lag reality (no `--only`/timeout discipline). |

---

## Findings — Full Detail

### [F-101] Split-brain `firestore.rules` across two repos → one project
- **Severity**: P1 · **Category**: Security / Reliability · **Location**: both repos' `firestore.rules` + `firebase.json`
- **Description**: Both repos declare `firestore.rules` for the same project; last deploy wins. Live == backend (confirmed). The frontend file is the stale, pre-P0-fix version (re-opens the onepager share-leak, drops the `planTier`/`featureFlags` write-guard, omits 39 collections incl. all `workspace*` isolation).
- **Impact**: A manual unscoped `firebase deploy` from `synchintro-app` regresses a P0 + tenant isolation in one command. No exposure today; CI is `--only hosting` so the automated path is safe.
- **Remediation**: remove `firestore`/`storage` rules from `synchintro-app/firebase.json`; single canonical rules owner (backend). · **Effort**: Medium

### [F-201] No automated reconciler for stuck prospect batches (checklist #7)
- **Severity**: P1 · **Category**: Reliability · **Location**: `routes/prospectIntelRoutes.js:66-84`; absent in `scheduled/`
- **Description**: `MAX_ACTIVE=5` counts `queued`/`processing`; a batch stuck in `processing` permanently consumes a slot and nothing ages it out. Cleanup is a manual hardcoded-whitelist script.
- **Impact**: Accumulated zombies → persistent 429 hard-block on new batches until a human runs the script.
- **Remediation**: scheduled reconciler that marks stale `processing` → `failed`. · **Effort**: Medium

### [F-701] Backend CI deploys functions on every `main` push without `.env` → can wipe production env
- **Severity**: P1 · **Category**: CI/CD · **Location**: `.github/workflows/ci.yml:50-75`
- **Description**: The `deploy` job runs `firebase deploy --only functions` after `npm ci` but never provisions `functions/.env` (git-ignored). A 2nd-gen deploy with no `.env` bakes empty runtime env — Gemini/Stripe/SAM.gov/encryption keys all vanish. `CLAUDE.md` documents this exact hazard.
- **Impact**: Wholesale production outage if the job runs effectively. Escalate to P0 if confirmed to have fired against prod.
- **Remediation**: disable/guard the CI functions deploy now; complete Secret Manager migration (B3), or inject `.env` from a secret. · **Effort**: Quick → Large

### [F-103] On-disk service-account key can reach the production Rules API
- **Severity**: P2 · **Category**: Security · **Location**: `C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json` (not in repo)
- **Description**: Broadly-scoped SA key (reached the Rules API this audit); referenced in plaintext memory; unencrypted on disk. Scope not minimized. **Review separately — no action taken this audit.**
- **Remediation**: audit IAM roles; mint a purpose-scoped key / short-lived creds; scrub plaintext path. · **Effort**: Medium

### [F-202] `markAllRead` unbounded batch write
- **Severity**: P2 · **Category**: Reliability · **Location**: `services/activityService.js:166`
- **Description**: Queries all unread notifications and `batch.update()`s each with no `.limit()`; >500 unread exceeds the Firestore 500-op limit → commit throws.
- **Impact**: Broken mark-all-read for heavy-notification users; no data loss.
- **Remediation**: chunk at ≤450. · **Effort**: Quick

### [F-301] `multer` high advisory in the request path
- **Severity**: P2 · **Category**: Dependencies · **Location**: `functions/package.json` (`multer ^2.1.1`), used `index.js:1425`, `govcaptureRoutes.js:512`
- **Description**: Direct dep at the vulnerable ceiling (advisory range `1.0.0–2.1.1`); DoS via malformed multipart on authenticated upload endpoints.
- **Impact**: Authenticated user could crash/hang the upload handler; DoS-only, no data breach.
- **Remediation**: upgrade past 2.1.1; re-run upload smoke tests. · **Effort**: Quick–Medium

### [F-401] `.env.example` drift (88 of 132 vars)
- **Severity**: P2 · **Category**: Code Quality · **Location**: `functions/.env.example`
- **Description**: ~40 undocumented vars incl. Stripe price IDs, AIsynch pricing, `TURNSTILE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`. Fresh-env bootstrap misses them.
- **Impact**: A new environment stood up from `.env.example` silently misses load-bearing config.
- **Remediation**: regenerate from code, grouped by subsystem. · **Effort**: Quick

### [F-601] Security-critical tests excluded from CI
- **Severity**: P2 · **Category**: Testing · **Location**: `jest.config.js:19`; `ci.yml:42`
- **Description**: `*.emulator.test.js` (P0 share-leak prevention + Gate #7 tenant isolation) are ignored by config and CI runs `jest` with no emulator → they don't gate merges. Directly compounds F-101.
- **Impact**: A `firestore.rules` regression (the F-101 hazard) would not be caught by CI.
- **Remediation**: add a `firebase emulators:exec … jest --testPathPattern=emulator` CI job. · **Effort**: Medium

### [F-702] Deprecated `FIREBASE_TOKEN` CI auth (both repos)
- **Severity**: P2 · **Category**: CI/CD · **Location**: `ci.yml` deploy steps (both repos, `env: FIREBASE_TOKEN`)
- **Description**: `firebase login:ci` tokens are deprecated and 401 on expiry (already happened — June 29). Long-lived broad-scope credential in CI secrets.
- **Remediation**: migrate to a service account / Workload Identity Federation. · **Effort**: Medium

### [F-703] Frontend CI runs no tests
- **Severity**: P2 · **Category**: CI/CD · **Location**: `synchintro-app/.github/workflows/ci.yml` (Tests step = `echo "TODO - add CI-compatible test suite"`)
- **Description**: A Playwright suite exists but isn't wired to CI (needs `npx serve` + baseURL + `playwright install`). Hosting deploys gated only by `npm audit`.
- **Remediation**: add a headless Playwright job gating the hosting deploy. · **Effort**: Medium

### [F-704] Two divergent deploy paths; workaround is local-only
- **Severity**: P2 · **Category**: CI/CD · **Location**: deploy configs vs local practice
- **Description**: `FUNCTIONS_DISCOVERY_TIMEOUT=120` appears nowhere in CI — it's a Windows-local manual-deploy workaround. Local path (Windows, has `.env`, `--only` discipline) ≠ CI path (Linux, no `.env`, auto-fires). Deploy flow "matches reality" only for local.
- **Remediation**: converge on one canonical, documented deploy path; remove/guard the redundant unsafe CI functions deploy. · **Effort**: Quick–Medium

### [F-801] `SYSTEM_BIBLE.md` ~7 weeks stale
- **Severity**: P2 · **Category**: Docs · **Location**: `functions/SYSTEM_BIBLE.md` (last content May 26)
- **Description**: Predates SynchGov go-live (July 7), the enterprise-entitlement fix (PR #44), the Gemini native-key fix, and the Secret Manager plan. Minor stale model-string notes in `CLAUDE.md` too (`gemini-2.5-flash-lite` fallback claim is outdated).
- **Remediation**: refresh for SynchGov/entitlements/Secret Manager; reconcile stale model-string notes. · **Effort**: Medium

### P3 findings (backlog)
- **[F-102]** Retired UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` in `scripts/setCountifiICP.js:17`, `testPitchGeneration.js:92`, comment in `templateOnePager.js:12`.
- **[F-302]** 12 backend transitive advisories via firebase-admin/google-cloud (grpc/protobufjs/form-data/uuid) — not in a reachable path.
- **[F-303]** Frontend/root highs confined to dev tooling (firebase-tools/serve/playwright/vite) — never shipped.
- **[F-402]** Gemini-client sprawl (5 modules; `geminiClientV2` near-unused) + untracked build clutter (`coverage/`, `backups/`, `junit.xml`) not git-ignored.
- **[F-501]** Vestigial admin endpoints (`backfillConfidenceFields` one-time backfill, `calibrateMerchant`) — retirement candidates.
- **[F-602]** 50% coverage threshold only enforced on `--coverage`; CI's `npm test` doesn't gate it.
- **[F-603]** Untested paths: `POST /team/revoke-invite`; F-201/F-202 fixes will need tests.
- **[F-802]** Frontend has no README (only AI-oriented `CLAUDE.md`).
- **[F-803]** README env template (~20 vars) and deploy docs lag reality (no `--only`/timeout discipline).

---

## Prioritized Action Plan

### 1. Immediate (P1 — this week)
1. **F-201 — add the stuck-batch reconciler** *(do first: this is the one P1 with a real production incident behind it — users hit the 429 hard-block and cleanup is a manual whitelist script)*. Scheduled job ages stale `processing` batches → `failed` so the 5-active slots self-heal.
2. **F-101 + F-601 (bundled) — unify rules ownership and protect it in CI.** Remove `firestore`/`storage` rules from `synchintro-app/firebase.json` so only the backend repo deploys rules (F-101); **in the same effort**, add a `firebase emulators:exec … jest --testPathPattern=emulator` CI job so the P0 share-leak + Gate #7 tenant-isolation tests gate merges (F-601). *The emulator CI job is what makes the rules fix durable — it catches any future regression that re-opens the leak.*
3. **F-701 — disable/guard the CI functions deploy.** Fastest safe fix: require manual approval or `if: false` on the deploy job so a merge can't ship functions without `.env`. (Proper fix is the Secret Manager migration — see This Sprint.)
- **Owner action (not an audit read):** confirm the **deployed functions revision matches `main`** via `firebase functions:list` / console — the one drift question that can't be answered statically under the locked policy.

### 2. This Sprint (P2)
- **F-701 (proper fix)** — complete the Secret Manager migration (documented B3) so CI can deploy functions safely, or inject `.env` from a GitHub Secret.
- **F-301** — upgrade `multer` past 2.1.1; re-run upload smoke tests.
- **F-202** — bound `markAllRead` to ≤450 ops per batch.
- **F-702** — migrate CI auth off deprecated `FIREBASE_TOKEN` to a service account / WIF.
- **F-703** — wire a headless Playwright job into frontend CI.
- **F-704** — converge on one documented deploy path; remove the redundant unsafe CI functions deploy.
- **F-401 / F-801** — regenerate `.env.example` from code; refresh `SYSTEM_BIBLE.md`.
- **F-103** — schedule a **separate** review to minimize the SA key's IAM scope (not actioned in-audit).

### 3. Next Sprint (P2→P3)
- **F-602** — switch CI to `npm run test:ci` so the coverage threshold gates and `junit.xml` refreshes.
- **F-402** — consolidate Gemini clients behind `modelRouter`; git-ignore `coverage/`, `backups/`, `junit.xml`.
- **F-501 / F-603** — retire vestigial admin endpoints; add missing endpoint tests.

### 4. Backlog (P3)
- **F-102** — replace/parameterize the retired UID in the two scripts + comment.
- **F-302 / F-303** — track transitive/dev-tool advisories; clear on next `firebase-admin` bump.
- **F-802 / F-803** — add a frontend README; bring README env/deploy docs in line with reality.

---

## Known Legacy Items (do NOT "fix")
- `buisnessName` / `buisnessAddress` typos — data-migration concern, not a code change.
- `STRIPE_SECRETE_KEY` env var name — intentional.
- Two Instantly integrations (`/instantly/*` per-user vs `/instantly-market/*` global) — intentional, do not merge.
- `gemini-2.5-flash-lite` string — appears only in `node_modules/@firebase/ai` (vendored SDK), not app code.

---

## Drift & State Snapshot (for the record)
- **Backend**: branch `main`, HEAD `f89daf4` (PR #44 merged); only `.claude/settings.local.json` modified (harness config, not product code); no product-source drift.
- **Frontend**: branch `main`, HEAD `295e587`; working tree clean; no product-source drift.
- **Rules drift**: none (live `firestore.rules` == backend `main`, deployed 2026-06-26).
- **Functions main↔production parity**: not statically verifiable — see the Immediate owner-action above.

*Canonical consolidation of `phase1`–`phase8-findings.md`. Read-only audit — no code, config, or production state was modified.*
