# Gate 1 Strategy Review — Guard the broken frontend hosting deploy (new finding)

**New finding (not in the original audit; surfaced this session).** Gate 1 STOP: strategy only, nothing edited. On approval I build (frontend repo), then STOP at Gate 2 before the PR.

---

## Context — why this change

`synchintro-app`'s CI `deploy` job (`Deploy to Firebase Hosting`) has failed on **every** merge to `main` for weeks with `Error: Assertion failed: resolving hosting target of a site with no site name or target name`. Diagnosis:
- `.firebaserc` = `{ projects: { default: pathsynch-pitch-creation } }` — no hosting targets.
- `firebase.json` hosting is a single object with **no `site` / no `target`**.
- The project has **more than one Hosting site**, so `firebase deploy --only hosting` can't resolve which site without an explicit `site`.
- In the last run the `FIREBASE_TOKEN` **authenticated** (deprecation warning only) — the *only* failure is the missing `site`.

So the job is a persistent red X on every merge; hosting has been deployed manually instead. This is separate from the merged F-703 change (which added the smoke test to the `test` job, not the deploy job).

## Recommended approach — guard now, proper fix deferred

**This PR (guard):** set the `deploy` job to `if: false` with a comment explaining the two reasons it's disabled (missing `site` → target-resolution error; deprecated `FIREBASE_TOKEN`, F-702) and the re-enable criteria. Mirrors the backend F-701 guard.

**Deferred (proper fix, needs owner input):** add `"site": "<id>"` to `synchintro-app/firebase.json` hosting (site ID from Firebase Console → Hosting — a production detail I won't guess) and migrate off `FIREBASE_TOKEN` (F-702); then re-enable. That restores real frontend CI/CD — low-risk for static hosting.

## Gate 1 answers

| Question | Answer |
|---|---|
| Secrets needed? | **None.** Workflow-file change only. |
| Does guarding break anything? | No — the job never succeeds today; guarding just stops the noise. The `test` job (incl. the F-703 smoke gate) is **untouched** and keeps gating PRs. |
| Blast radius | `synchintro-app/.github/workflows/ci.yml` `deploy` job only. No product code, no deploy, no credentials, no live hosting change. |
| Self-protecting? | Yes — on a `push` to `main`, GitHub uses the workflow at the merged commit, which already has `if: false`, so the guard's own merge skips the deploy job. |
| Rollback | Revert the one-line `if:` change. |

## What could go wrong
Minimal. Only real note: this leaves frontend hosting on manual deploy (status quo) until the `site` fix + F-702 land. Documented in the job comment.

## Build plan (after approval)
1. Branch `fix/frontend-hosting-deploy-guard` off `synchintro-app` `main`.
2. `deploy` job → `if: false` + explanatory comment (mirrors F-701).
3. Verify: YAML parses; `test` job unchanged; diff scoped to `ci.yml`.
4. Gate 2, then STOP for the PR → Williams.

## Merge routing
Frontend CI/infra → **Williams** (or Charles as infra). I do not merge.
