# Gate 1 Strategy Review — F-101 + F-601: Unify rules ownership + gate it in CI

**Work Item 2.** Gate 1 STOP: strategy only, no branches cut, nothing edited. On your approval I build (across two repos), then STOP at Gate 2 before the PRs → Williams.

---

## Context — why this change

**F-101 (the loaded gun):** both repos declare `firestore.rules` for the same Firebase project, so either can deploy rules — last deploy wins. Verified today:
- **Frontend** `synchintro-app/firebase.json` declares `firestore` (+ `indexes`) **and** `storage` rules blocks. Its `firestore.rules` is the **stale, 481-line, pre-P0-fix** version (`storage.rules` + `firestore.indexes.json` also present).
- **Backend** `pathsynch-pitch-generator/firebase.json` also declares them; the backend's `firestore.rules` (776 lines) **is the live production ruleset** (confirmed in Phase 1).
- A single **manual, unscoped `firebase deploy` from the frontend repo** would re-open the onepager P0 share-leak, strip the `agencyBrandOverrides` `planTier`/`featureFlags` write-guard, and default-deny ~39 collections including all `workspace*` tenant isolation.
- **Mitigating fact:** the frontend **CI** deploy job is `--only hosting` (verified) — it never deploys rules. So the automated path is safe; the risk is a human running a bare `firebase deploy` locally from `synchintro-app`.

**F-601 (the missing net):** `functions/jest.config.js:19` ignores `*.emulator.test.js`, and backend CI runs plain `jest` with no emulator — so the very suites that would catch an F-101 regression (P0 share-leak prevention + Gate #7 tenant isolation) **don't gate merges.** The emulator CI job is what makes the rules fix durable.

---

## Recommended approach — two PRs, two repos

### PR-1 (frontend `synchintro-app`) — F-101: remove rules ownership
- **Remove the `firestore` and `storage` blocks** from `synchintro-app/firebase.json` (keep `hosting`, `emulators`). The frontend repo then **cannot** deploy rules or storage rules — backend becomes the sole rules owner.
- **Neutralize the stale files** `synchintro-app/firestore.rules` and `synchintro-app/storage.rules` — replace contents with a short pointer stub (canonical source = backend repo) so no one mistakes them for live. (`firestore.indexes.json` is no longer referenced once the block is removed; leave the file or stub it — I'll stub for consistency.)
- **This deploys nothing and does NOT change live production rules.** Live rules already are the backend's; this only removes the frontend's *ability* to deploy them and removes the foot-gun. I'll state that explicitly in Gate 2.

### PR-2 (backend `pathsynch-pitch-generator`) — F-601: gate rules with emulator CI
- Add `functions/jest.emulator.config.js` — matches only `**/*.emulator.test.js`, no ignore, `--forceExit`. (The main `jest.config.js` keeps ignoring them, because `npm test` mocks `firebase-admin`; emulator suites use the real emulator and must run separately.)
- Add `test:emulator` script → `firebase emulators:exec --only firestore "jest --config jest.emulator.config.js"`.
- Add a CI job `emulator-tests` to `.github/workflows/ci.yml` that installs deps + `firebase-tools` and runs `test:emulator` on **pull_request + push to main**, so the 5 suites gate merges.
- Suites proven green locally before the PR.

The 5 emulator suites (verified present): `workspace`, `workspacePhase2`, `workspacePhase3A`, `workspacePhase3B`, `workspacePhase3C`. They load the backend's canonical `firestore.rules` via `@firebase/rules-unit-testing` (already a devDep) against the Firestore emulator on :8080.

---

## Gate 1 required answers

| Question | Answer |
|---|---|
| **Does removing rules from `synchintro-app/firebase.json` break a legit frontend deploy?** | **No.** Frontend CI deploy is `--only hosting` (verified). Hosting deploys don't touch rules. The only thing removed is the ability to deploy rules from the frontend — which is exactly the hazard. (Minor: the frontend's local `emulators` block would start Firestore with no rules file → open rules in the *local* emulator only; acceptable, out of scope.) |
| **Which emulator suites exist; do they pass locally today?** | The 5 above. I'll **prove them green during build** via `npm run test:emulator`. They need the Firestore emulator + `firebase-tools` + Java. If this Windows machine can't run the emulator (e.g., no Java), I'll **flag it honestly** rather than claim a pass — the CI job would then be the first green proof. |
| **Emulator CI cost — gate PRs or post-merge?** | **Gate PRs** (run on `pull_request` + `push`). The suites are fast (short emulator boot + a focused jest run); GitHub `ubuntu-latest` ships Java, and `@firebase/rules-unit-testing` is already a devDep. Gating pre-merge is the whole point — it catches any future rules regression (the F-101 hazard) before it lands. |
| **Rollback if the emulator job is flaky?** | The job is **additive** — make it non-blocking (`continue-on-error`) or revert the job; nothing else depends on it. Frontend rollback = restore the `firebase.json` blocks. |

---

## Blast radius

- **PR-1 (frontend):** config + stale-file change only. **Deploys nothing; live production rules unchanged.** Removes the frontend's rules-deploy capability + the stale foot-gun. Hosting deploys unaffected.
- **PR-2 (backend):** additive test infra + one CI job. No product code, no deploy, no credentials.
- **Sequencing vs PR #49:** PR-2 edits `ci.yml` by *adding a job*; PR #49 edits `ci.yml` by disabling the `deploy` job — different hunks, they compose without conflict. I'll base PR-2 on `main`; if #49 merges first, clean; if not, still additive. Flagged.

## What could go wrong + mitigations

| Risk | Mitigation |
|---|---|
| Local emulator can't run here → can't prove suites green pre-PR | Attempt it; if blocked, surface honestly (don't fake a pass). CI job becomes first green proof; you decide whether to merge on that. |
| Emulator CI job flaky (boot timing) | Additive + revertible; can start as `continue-on-error` then promote to blocking once stable. |
| Frontend local emulator now has no rules | Acceptable — frontend emulator use is UI testing, not rules; canonical rules live in backend. |
| Someone re-adds rules to frontend `firebase.json` later | The neutralized stub is a breadcrumb; the backend emulator gate catches any resulting rules regression. |

## Rollback

Each PR reverts independently. Frontend: restore the two `firebase.json` blocks + files. Backend: delete the emulator config/script/CI job. No data, no deploy, no credential to undo.

---

## Build plan (only after approval)

1. **Frontend:** branch `fix/f101-remove-rules-ownership` off `synchintro-app` `main` → edit `firebase.json` (drop `firestore`+`storage`) → stub `firestore.rules` + `storage.rules` (+ `firestore.indexes.json`). Verify: `firebase.json` parses, no rules blocks, `git diff` scoped, **note no live-rules change**.
2. **Backend:** branch `fix/f601-emulator-ci` off `main` → add `jest.emulator.config.js` + `test:emulator` script + `emulator-tests` CI job → run `npm run test:emulator` (prove green, or flag) → confirm full unit suite still green (≥1,724) → YAML parse → diff scoped.
3. Gate 2 review (`prd-review-f101-f601.md`), then STOP for the two PR handoffs.

## Merge routing

Both are security-relevant (rules governance) / infra → route to **Williams**. Two separate PRs (two repos). **I do not merge.**

## Owner action (unchanged, not mine)

The functions↔prod parity check (`firebase functions:list`) remains yours. No new owner action for this item. (No production reads/writes by me; the emulator runs locally/in CI, never against prod.)
