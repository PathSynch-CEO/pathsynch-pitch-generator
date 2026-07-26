# Gate 1 Strategy Review — F-701: Guard the CI functions-deploy job (fast guard)

**Work Item 3, step 1 — reordered ahead of Work Item 2 by a live incident.** Gate 1 STOP: strategy only, no branch cut, `ci.yml` untouched. On your approval I build, then STOP at Gate 2 before the PR.

---

## Context — why now (the incident)

Merging PR #48 to `main` triggered the backend CI `deploy` job (`.github/workflows/ci.yml:50-76`), which runs `firebase deploy --only functions` **from the runner, with no `functions/.env`**, authenticating with `FIREBASE_TOKEN`. First run failed on an expired token (F-702) — which harmlessly blocked it. A fresh token was provisioned and the run re-triggered **green**, so the deploy executed against production.

Verified aftermath: the SynchGov brief canary generated real Gemini output → `GEMINI_API_KEY` is live → **the feared env-wipe did NOT happen; prod is healthy.** Empirically, an env-less `firebase deploy` left Cloud Run's existing runtime env in place. So **F-701 is a latent P1, not a live P0.**

But the incident exposed the standing hazard plainly: **every push/merge to `main` now auto-deploys all functions to production, unreviewed, on deprecated `FIREBASE_TOKEN` auth, from a runner with no `.env`.** That is not a pipeline we want firing unattended while we land the remaining remediation PRs. The fast guard stops it before the next merge.

---

## Scope of THIS PR (fast guard only)

One change to `.github/workflows/ci.yml`: **disable the `deploy` job** so no push/merge can auto-deploy functions. Nothing else in this PR. The `test` job (unit tests + `npm audit`) is untouched and keeps gating PRs.

**Recommended mechanism — option (a): `if: false` on the deploy job**, with a comment that preserves the original condition and the re-enable criteria:

```yaml
  deploy:
    name: Deploy to Firebase
    runs-on: ubuntu-latest
    needs: [test]
    # F-701: CI auto-deploy DISABLED. Merges to main were auto-deploying all functions to
    # production — unreviewed, on deprecated FIREBASE_TOKEN auth, from a runner without
    # functions/.env. Deploys are manual/local (with .env + FUNCTIONS_DISCOVERY_TIMEOUT=120)
    # until .env is injected from a secret / Secret Manager (F-701 proper fix) AND CI auth
    # moves off FIREBASE_TOKEN to a service account / WIF (F-702). Then re-enable with:
    #   github.ref == 'refs/heads/main' && github.event_name == 'push'
    if: false
    ...
```

Job body kept intact so re-enabling later is a one-line change.

**Alternatives considered:**
- (b) Gate behind the `production` environment's required-reviewers (manual approval). Keeps a deploy button, but (i) it's a repo-Settings change, not just a workflow edit, and (ii) it would still run the *env-less, `FIREBASE_TOKEN`* deploy once approved — it doesn't fix the underlying unsafety, just adds a click. Rejected for the fast guard; approval belongs on the *proper* fix once the deploy is actually safe.
- (c) `workflow_dispatch`-only trigger. More rewiring than needed for an urgent stop. Defer to the proper-fix PR.

**(a) is self-protecting on its own merge:** for `push` events GitHub uses the workflow file *at the merged commit*, which already has `if: false`, so the merge that lands the guard skips the deploy job. No deploy fires.

---

## Gate 1 required answers (whole WI3 cluster)

**One PR vs. split — proposed split (never leaves the pipeline broken between merges):**

| PR | Findings | Merge-safe order | Needs a Secret first? |
|---|---|---|---|
| **PR-A (this one)** | F-701 fast guard | Now — turns CI deploy OFF. Deploys revert to manual/local (current documented practice). Pipeline safe. | **No** |
| **PR-B** | F-701 proper + F-702 | After A. Inject `functions/.env` from a GitHub Secret (or finish Secret Manager) **and** move CI auth off `FIREBASE_TOKEN` to a service account / WIF, tested, **then** re-enable the deploy job. Bundled because re-enabling safely requires *both* env-injection and non-deprecated auth. | **Yes** — the `.env` payload as a secret and/or an SA key / WIF config (owner action, provisioned before merge). |
| **PR-C** | F-704 | Converge on one documented deploy path; bake `FUNCTIONS_DISCOVERY_TIMEOUT=120` into the flow. Fold into B or ship after. | No |
| **PR-D** | F-703 | Frontend `synchintro-app` Playwright CI job — separate repo, independent. | No |

**GitHub Secret to provision before merge:** none for PR-A. PR-B is where secrets get set up (I'll flag the exact ones in its Gate 1). **This PR provisions and touches no credentials.**

**Order that never breaks the pipeline:** A (deploy off) → B (env + safe auth + re-enable) → C/D independent. Between A and B, deploys are manual/local — exactly how the team deploys today, so nothing is lost.

---

## Blast radius

- **Workflow-file change only.** Deploys nothing, reads/writes no production, touches no credentials, changes no product code.
- After merge: CI no longer auto-deploys functions. Deploys become manual/local (`firebase deploy --only functions ... --force`, `.env` present, `FUNCTIONS_DISCOVERY_TIMEOUT=120`) — the current real practice per `CLAUDE.md`.
- `test` job unchanged → PRs still run tests + `npm audit`.
- Self-protecting on its own merge (no deploy fires when this lands).

## What could go wrong + mitigations

| Risk | Mitigation |
|---|---|
| Team expects CI to deploy on merge and is surprised deploys stop | This *is* the intent; documented in the job comment + PR body. Manual/local deploy is already the working path. |
| Someone re-enables without doing PR-B first | Comment spells out the re-enable criteria (env injection + non-deprecated auth). PR-B does it properly. |
| YAML typo breaks the workflow | Validate YAML parse before PR; confirm the `test` job still runs. |

## Rollback

Revert the one-line `if:` change to restore the original condition. No data, no deploy, no credential to undo.

---

## Build plan (only after your approval)

1. Branch `fix/f701-guard-ci-deploy` off `main`.
2. Edit `.github/workflows/ci.yml` — `if: false` + explanatory comment on the `deploy` job (option a). No other change.
3. Verify: parse the workflow YAML (validity); confirm the `deploy` job is disabled and the `test` job is unchanged; `git diff` scoped to `ci.yml` only. (No jest tests apply to a workflow-config change — I'll state that explicitly in Gate 2 rather than pad the suite.)
4. Gate 2 review (`prd-review-f701.md`), then STOP for the PR handoff.

## Merge routing

CI/workflow config is **infra / Build OS**, which the convention lets **Charles self-merge** — but the remediation brief's Work Item 3 says CI changes route to **Williams**. Given it's urgent and infra, I'll prepare the PR and let you choose the merger. **I do not merge either way.**

## Owner action (unchanged, not mine)

Confirm `reconcileStuckBatches` registered and the deployed revision matches `main` via `firebase functions:list` / console — a production read outside this session's policy.
