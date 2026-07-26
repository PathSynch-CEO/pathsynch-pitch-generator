# Gate 2 Review — F-701: Guard the CI functions-deploy job (fast guard)

**Work Item 3, step 1.** Built and tested — the PR is NOT opened and NOTHING is merged. Branch: `fix/f701-guard-ci-deploy` (off `main`). Gate 1: `strategy-review-f701.md`.

---

## What changed

One change to `.github/workflows/ci.yml`: the `deploy` ("Deploy to Firebase") job is disabled via `if: false`, with a comment preserving the original trigger condition and the criteria for safe re-enable. Nothing else changed — the job body is intact so re-enabling is a one-line revert.

```diff
     needs: [test]
-    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
+    # F-701: CI auto-deploy DISABLED. ... (re-enable criteria documented inline)
+    if: false
     timeout-minutes: 20
```

**Why:** merging PR #48 to `main` auto-triggered this job, which runs `firebase deploy --only functions` from the runner with no `functions/.env`, on deprecated `FIREBASE_TOKEN` auth, unreviewed. Env happened to survive (SynchGov canary confirmed `GEMINI_API_KEY` live — prod healthy), but every future merge would re-fire the same unattended prod deploy. This stops it until the proper fix (PR-B: `.env` injection + non-deprecated auth) lands.

## Verification

- **Workflow YAML parses** (js-yaml): jobs = `test, deploy`; `deploy.if === false` (boolean); deploy job still has its steps (re-enable is trivial).
- **`test` job unchanged** — still runs unit tests + `npm audit` on every PR and push (parse confirms the `Run tests` step present). PRs keep getting gated.
- **`on` triggers unchanged** — PR + push to `main`.
- **`git diff` scoped to `.github/workflows/ci.yml`** only (the `.claude/settings.local.json` entry in the tree is a pre-existing harness edit, not part of this change and not staged).
- **No jest tests apply** to a CI-workflow config change — stated plainly rather than padding the suite. The meaningful test is the YAML validity + job-disabled assertions above.

## Behavior after merge

- **CI no longer auto-deploys functions.** Deploys become manual/local — `firebase deploy --only functions --project pathsynch-pitch-creation --force` with `.env` present and `FUNCTIONS_DISCOVERY_TIMEOUT=120` — which is the team's actual documented practice (`CLAUDE.md`). Nothing is lost.
- **Self-protecting on its own merge:** for `push` events GitHub uses the workflow file at the merged commit, which already carries `if: false`, so the merge that lands this guard skips the deploy job. No deploy fires.

## Safety confirmations

- **Nothing deployed. No production reads/writes, no credentials touched, no product code changed.** Workflow-file edit only.
- I have not merged or self-merged.
- Rollback = revert the one-line `if:` change to restore the original condition. No data/deploy/credential to undo.

## Merge routing

CI/workflow config is **infra / Build OS** — you *may* self-merge it — but the remediation brief routes CI changes to **Williams**. PR prepared either way; you choose the merger. **I do not merge.**

## What comes next (the split, unchanged from Gate 1)

- **PR-B** (F-701 proper + F-702): inject `functions/.env` from a GitHub Secret / Secret Manager **and** move CI auth off `FIREBASE_TOKEN` to a service account / WIF, tested, then re-enable the deploy job. This is where GitHub Secrets get provisioned (owner action). Gets its own Gate 1.
- **PR-C** (F-704), **PR-D** (F-703, frontend repo) — independent, later.

## Owner action (unchanged, not mine)

Confirm `reconcileStuckBatches` registered and the deployed revision matches `main` via `firebase functions:list` / console.

---

**STOP — awaiting your go-ahead to open the PR.** Work Item 2 (rules) still pending; next item doesn't start until this is handed off.
