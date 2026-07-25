# Gate 2 Review — F-101 + F-601: Unify rules ownership + gate it in CI

**Work Item 2.** Built and tested — PRs NOT opened, nothing merged. Two PRs across two repos (the findings live in different repos, so a single branch isn't possible — flagged and approved at Gate 1). Gate 1: `strategy-review-f101-f601.md`.

---

## PR-1 (frontend `synchintro-app`) — F-101: remove rules ownership
**Branch:** `fix/f101-remove-rules-ownership` (off `synchintro-app` `main`)

**Changes:**
- `firebase.json` — removed the `firestore` and `storage` blocks. Parsed result has only `hosting` + `emulators`. The frontend repo **can no longer deploy Firestore or Storage rules** — the backend repo is now the sole rules owner.
- `firestore.rules` — replaced the stale 481-line pre-P0-fix ruleset with a **deny-all fail-safe stub** + pointer to the canonical backend file.
- `storage.rules` — same treatment (deny-all stub + pointer).
- `firestore.indexes.json` — left in place (now unreferenced by `firebase.json`, inert; kept to minimize the diff).

**Why the stub, not just deletion:** it's a breadcrumb (says where the real rules live) *and* fail-safe — if anyone ever wired it back up and deployed it by accident, it denies everything rather than re-opening the P0 share-leak.

**Blast radius / safety:**
- **Deploys nothing; live production rules are unchanged.** Live rules already are the backend's; this only removes the frontend's *ability* to deploy rules and removes the stale foot-gun.
- **No runtime effect on the app.** `firebase.json` rules blocks only govern *deploying* rules — the hosted client app reads/writes Firestore under the LIVE (backend) rules regardless. Hosting config untouched.
- Verified: `firebase.json` parses; `firestore`/`storage` blocks absent; `hosting`/`emulators` intact. Diff scoped to `firebase.json`, `firestore.rules`, `storage.rules` (2 untracked docs in the tree are unrelated, not staged).

## PR-2 (backend `pathsynch-pitch-generator`) — F-601: gate rules with emulator CI
**Branch:** `fix/f601-emulator-ci` (off `main`, which already includes the #48 reconciler + #49 guard)

**Changes:**
- `functions/jest.emulator.config.js` — new; matches only `*.emulator.test.js`, drops the emulator ignore, mirrors the unit config otherwise (30s timeout for emulator round-trips).
- `functions/package.json` — new `test:emulator` script: `firebase emulators:exec --only firestore --project demo-synchintro -c ../firebase.json "jest --config jest.emulator.config.js --forceExit"`.
- `.github/workflows/ci.yml` — new `emulator-tests` job (Node 22 + Temurin JDK 17 + `firebase-tools`) running `npm run test:emulator` on every PR + push. The `deploy` job stays `if: false` (from #49); the `test` job is unchanged.

**Test results:**
- **Emulator suites green locally via the exact CI command** (`npm run test:emulator`): **5 suites, 137 tests passed** — `workspace`, `workspacePhase2`, `workspacePhase3A/3B/3C` — run against the real `firestore.rules`. Includes "Proof 6: Firestore rules deny direct client writes" (Gate #7 tenant isolation) and the workspace-isolation / invite-security proofs. `emulators:exec` exited 0.
- **Unit suite unaffected:** `npm test` still **1,724 passing, 0 failing** (the new config isn't a `.test.js` file; `jest.config.js` still ignores emulator suites). The "worker failed to exit gracefully" line is the pre-existing teardown artifact.
- Local env used Java 25 + Firebase CLI 15.22.3; CI pins Temurin 17 + installs `firebase-tools`.
- `ci.yml` YAML parses; jobs = `test, emulator-tests, deploy`. Diff scoped to `ci.yml`, `package.json`, `jest.emulator.config.js`.

**How this makes F-101 durable:** with `emulator-tests` gating PRs, any change that regresses the share-leak or tenant-isolation rules fails CI before merge.

---

## Gate 1 answers — confirmed in build

- **Frontend deploy not broken:** frontend CI is `--only hosting`; removing rules blocks doesn't affect it. ✓
- **Emulator suites pass locally today:** yes — 137/137, proven above (I did not have to fall back to "flag it"). ✓
- **Gating PRs:** the job runs on `pull_request` + `push`. **Note (owner action):** to make it *block* merges, add `emulator-tests` to the repo's required status checks in branch protection — that's a Settings toggle, not something the workflow file can self-enforce.
- **Rollback:** each PR reverts independently; the emulator job is additive (can be set `continue-on-error` if it ever flakes).

## Safety confirmations
- **Nothing deployed. No production reads/writes, no credentials touched.** The emulator ran locally against a `demo-` project, never prod.
- No self-merge. Both PRs stop at handoff.

## Merge routing
Both are security-relevant (rules governance) → **Williams**. Two PRs, two repos. **I do not merge.**

## Owner actions (flagged, not mine)
1. Add `emulator-tests` to required status checks (branch protection) to make the gate blocking.
2. The standing functions↔prod parity check (`firebase functions:list`).

---

**STOP — awaiting your go-ahead to open both PRs.** On approval I commit → push → open PR-1 (`synchintro-app`) and PR-2 (`pathsynch-pitch-generator`), both to Williams. I won't merge.
