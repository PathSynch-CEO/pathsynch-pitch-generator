# SynchIntro Audit — Phase 7 Findings (CI/CD & Deploy Drift)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, static / offline (locked policy — no production reads; the one confirmed live read of `firestore.rules` from Phase 1 is reused as established fact, not re-fetched). Report artifact — no audited code modified.

---

## Verdict

The **rules** deploy story is safe and consistent (manual, backend-repo-only, live == main). The **functions** deploy story is not: the backend `deploy` job is armed on every push to `main` but ships **without `functions/.env`**, which — per the team's own documented hazard — would strip all runtime env vars from production. That is the headline Phase 7 finding.

**Phase 7 finding tally:** P0: 0 · **P1: 1** · **P2: 3** · P3: 0

---

## What each repo's CI actually deploys

### Backend `pathsynch-pitch-generator` (`.github/workflows/ci.yml`)
- **Triggers**: PR to `main` + push to `main`. `concurrency` cancels in-progress; `permissions: contents: read`.
- **`test` job**: `npm ci` → `npm test` (= `jest`, `NODE_ENV=test`) → `npm audit --audit-level=critical`.
  - Reminder from F-601: `npm test` runs the **mock** suite only — the `*.emulator.test.js` security suites (P0 share-leak + Gate #7 tenant isolation) are excluded, so they do **not** gate this deploy.
- **`deploy` job**: `needs: [test]`, `if: main push`, `environment: production` →
  `npx firebase-tools deploy --only functions --project pathsynch-pitch-creation --non-interactive` with `FIREBASE_TOKEN`.
  - **Does NOT deploy `firestore.rules`** (scoped `--only functions`). Good.
  - **Does NOT provision `functions/.env`** anywhere in the job. ← see F-701.

### Frontend `synchintro-app` (`.github/workflows/ci.yml`)
- **`test` job**: `npm ci` → `npm audit --audit-level=critical` → **Tests step = `echo "TODO - add CI-compatible test suite"`** (no tests actually run). ← see F-703.
- **`deploy` job**: `needs: [test]`, `if: main push` → `firebase-tools deploy --only hosting …` with `FIREBASE_TOKEN`.
  - **Scoped `--only hosting`** — CI **cannot** clobber `firestore.rules`. This is the key mitigation for F-101: the automated path is safe; the F-101 hazard is a *manual* unscoped `firebase deploy` from this repo.

### Neither CI deploys Firestore rules → rules are deployed **manually, from the backend repo only**
- Confirmed in Phase 1: live `firestore.rules` == backend `main` byte-for-byte (deployed 2026-06-26, unchanged since commit `c9ca048`). **No rules drift.**

---

## Findings

### [F-701 / P1] Backend CI auto-deploys functions on every `main` push **without `.env`** → can wipe production env vars
- **Location**: `.github/workflows/ci.yml:50-75` (`deploy` job).
- **Description**: The job runs `npm ci` then `firebase deploy --only functions`, but **never restores `functions/.env`** (which is git-ignored, so it isn't in the checkout). Cloud Functions 2nd-gen bakes env vars from `.env` at deploy time; a deploy with no `.env` produces a revision with **empty runtime env** — no `GEMINI_API_KEY`, `STRIPE_SECRET*`, `SAM_GOV_API_KEY`, `INSTANTLY_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY`, etc.
- **Impact**: A successful CI functions deploy would break production wholesale — Gemini calls 400 (`API_KEY_INVALID`), billing fails, SynchGov sync fails, token decryption fails. The team's own `CLAUDE.md` flags exactly this: *"CI deploy (GitHub Actions) ships WITHOUT `.env` — CI deploys can wipe env vars"* and *"any deploy carrying env changes must stay local until Secret Manager migration."*
- **Why P1, not P0**: I could not confirm from static analysis whether the job has actually fired-and-wiped on a recent merge — it may be silently no-op'ing (deprecated `FIREBASE_TOKEN` expiring → deploy fails; see F-702) or the team may rely on always redeploying locally afterward. The **hazard is armed on every merge to `main`**; whether it has already caused a silent incident needs a controlled check. Treat as P1 (escalate to P0 if a CI deploy is confirmed to have run against production).
- **Remediation**: (a) short term — **disable/guard the CI functions deploy** (require manual approval, or `if: false`) so merges can't wipe prod; (b) proper fix — complete the **Secret Manager migration** (the documented B3 plan) so functions read secrets from Secret Manager instead of `.env`, then CI can deploy safely; or (c) inject `.env` from a GitHub Secret in the deploy step. **Do not** leave an armed `--only functions` deploy with no secret provisioning.
- **Effort**: Quick (disable/guard) → Large (Secret Manager migration).

### [F-702 / P2] Deprecated `FIREBASE_TOKEN` CI auth (both repos)
- **Location**: `ci.yml` deploy steps in both repos (`env: FIREBASE_TOKEN`).
- **Description**: `firebase login:ci` tokens are deprecated by Firebase and 401 on expiry (already happened once — June 29 CI failure required regenerating the secret). Documented open item: migrate CI to a service account (`GOOGLE_APPLICATION_CREDENTIALS`).
- **Impact**: Deploy pipeline breaks unpredictably on token expiry; also a long-lived broad-scope credential in CI secrets.
- **Remediation**: migrate to Workload Identity Federation or a scoped deploy service account. **Effort: Medium.**

### [F-703 / P2] Frontend CI runs no tests
- **Location**: `synchintro-app/.github/workflows/ci.yml` — Tests step is `echo "TODO - add CI-compatible test suite"`.
- **Description**: A Playwright suite exists (`tests/`, `playwright.config.js`) but is not wired into CI (needs `npx serve` + baseURL + `playwright install`). Frontend deploys to production hosting with **zero automated test gating** — only `npm audit`.
- **Impact**: Frontend regressions (share pages, market rendering, esc() hardening) ship ungated.
- **Remediation**: add a headless Playwright job (`npx playwright install --with-deps` + serve + run) gating the hosting deploy. **Effort: Medium.**

### [F-704 / P2] Two divergent deploy paths; the documented workaround is local-only
- **Description**: `FUNCTIONS_DISCOVERY_TIMEOUT=120` appears **nowhere** in either CI config or `package.json` — it is a **Windows-local manual-deploy** workaround (a Windows loader-timeout bug), correctly irrelevant on CI's Linux runners. Combined with F-701, this means there are **two non-equivalent deploy paths**:
  - **Local (how the team actually deploys)**: Windows, `FUNCTIONS_DISCOVERY_TIMEOUT=120`, local `functions/.env` present, `--force` for `.env`-only changes, `--only functions`/`--only firestore:rules` chosen deliberately.
  - **CI (`ci.yml` deploy job)**: Linux, no timeout var needed, **no `.env`**, fires automatically on merge.
- **Impact**: The deploy flow "matches reality" only for the **local** path. The CI functions-deploy path does **not** reflect how deploys actually happen and is unsafe (F-701). Deploy behavior is therefore path-dependent and undocumented as a single source of truth.
- **Remediation**: pick one canonical deploy path. Recommended: keep functions deploys **manual/local** (or Secret-Manager-backed CI) and **remove or hard-guard the CI functions deploy**; document the one true procedure in the README/runbook. **Effort: Quick–Medium.**

---

## Deploy-drift assessment (committed vs deployed)

- **Uncommitted source drift**: none. Working tree (Phase 0 `git status`) has **no modified tracked code** (only `.claude/settings.local.json` + untracked scratch/audit files). No inline hotfix sitting uncommitted in tracked source.
- **Rules drift**: none. Live `firestore.rules` == backend `main` (Phase 1, confirmed). Rules deploy manually from backend repo only.
- **Functions code parity (main ↔ production)**: **not statically verifiable.** `main` HEAD (`f89daf4`) contains PR #44 (enterprise-entitlement fix). Whether production functions were redeployed from `main` after the July 7 merge cannot be confirmed without a production read (out of scope under the locked policy). Session notes indicate a period where *"production may be running the unmerged fix branch"*; that branch is now merged, but confirming the deployed revision requires a controlled `firebase functions:list`/console check — **flag for the owner**, do not infer.
- **Inline model/hotfix patches**: no banned models or uncommitted inline `thinkingBudget` patches found (Phase 4). The historical class of "deployed-but-not-committed" hotfixes appears reconciled (main carries the fixes).

---

## Positive controls confirmed
- Frontend CI deploy is `--only hosting` — cannot clobber Firestore rules (key F-101 mitigation).
- Neither CI deploys rules; rules deploy manually from backend repo; live == main (no rules drift).
- CI has least-privilege `permissions: contents: read`, concurrency cancellation, deploy gated on `test` + `main` push only.
- No uncommitted tracked-source drift; no banned-model/inline hotfix drift.

## Open items carried to the action plan
- **[F-701 / P1]** Disable/guard the CI functions deploy (no `.env` → env-wipe risk); complete Secret Manager migration.
- **[F-702 / P2]** Replace deprecated `FIREBASE_TOKEN` with a service account / WIF.
- **[F-703 / P2]** Wire a headless Playwright job into frontend CI.
- **[F-704 / P2]** Converge on one documented deploy path; remove the redundant unsafe CI functions deploy.
- **Owner action (not an audit read)**: confirm production functions revision matches `main` post-PR#44.

*End of Phase 7 findings.*
