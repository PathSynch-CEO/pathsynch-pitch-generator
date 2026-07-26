# Gate 2 Review — Guard the broken frontend hosting deploy

**New finding (not in the original audit).** Built — PR NOT opened, nothing merged. Branch: `fix/frontend-hosting-deploy-guard` (off `synchintro-app` `main`). Gate 1: `strategy-review-f705-frontend-deploy-guard.md`.

---

## What changed (frontend `synchintro-app`)

`.github/workflows/ci.yml` — the `Deploy to Firebase Hosting` job is disabled via `if: false`, with a comment stating the two reasons (missing `site`/`target` → `resolving hosting target of a site with no site name` error; deprecated `FIREBASE_TOKEN`, F-702) and the re-enable criteria. Mirrors the backend F-701 guard. Nothing else changed.

## Why
The deploy job has failed on every merge to `main` for weeks: the project has multiple Hosting sites and `firebase.json` specifies no `site`, so `firebase deploy --only hosting` can't resolve a target. In the last run the `FIREBASE_TOKEN` authenticated (deprecation warning only) — the sole failure was the missing `site`. Hosting has been deployed manually meanwhile. This guard stops the recurring red X and makes "hosting deploys are manual" explicit until the proper fix.

## Verification
- Workflow YAML parses (js-yaml); `deploy.if === false`.
- **`test` job unchanged** — still runs `npm audit` + the F-703 Playwright smoke gate (steps confirmed: checkout → node → npm ci → Security audit → Install chromium → Smoke tests). PRs stay gated.
- Diff scoped to `.github/workflows/ci.yml` only.
- No jest/unit tests apply to a workflow-config change.

## Behavior after merge
- The frontend `deploy` job no longer runs → no more false-alarm red X on `main` merges.
- **Self-protecting:** for `push` to `main`, GitHub uses the workflow at the merged commit, which already has `if: false`, so the guard's own merge skips the deploy job.
- Hosting deploys remain manual (`firebase deploy --only hosting` from this repo) — the status quo.

## Safety
- **Nothing deployed. No production reads/writes, no credentials, no product code, no live-hosting change.** One CI job disabled.
- No self-merge.

## Deferred (proper fix — needs owner input)
Add `"site": "<id>"` to `synchintro-app/firebase.json` hosting (site ID from Firebase Console → Hosting — a prod detail I won't guess) and migrate CI auth off `FIREBASE_TOKEN` (F-702); then re-enable the job. That restores real frontend CI/CD (low-risk for static hosting).

## Rollback
Revert the one-line `if:` change.

## Merge routing
Frontend CI/infra → **Williams** (or Charles as infra). I do not merge.

---

**STOP — awaiting your go-ahead to open the PR.** After this, the only remaining item is **PR-B (F-701 proper + F-702)**, which needs you to provision GitHub Secrets.
