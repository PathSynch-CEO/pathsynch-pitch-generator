# Gate 1 Strategy Review — F-704: Converge on one documented deploy path

**Work Item 3, F-704 (unblocked — docs only, no secrets).** Gate 1 STOP: strategy only, nothing edited. On approval I build, then STOP at Gate 2 before the PR.

---

## Context — why this change

F-704: two divergent deploy paths and no single documented procedure. The real, working deploy flow (local, with `functions/.env`, `FUNCTIONS_DISCOVERY_TIMEOUT=120`, `--force`, reauth) lives only as Windows-local folklore in `CLAUDE.md`. Meanwhile the backend `README.md` "Deployment" section (lines 135–148) documents the **naive and partly dangerous** commands:
- `firebase deploy` (bare) — deploys **everything incl. Firestore/Storage rules**; a foot-gun now that backend is the sole rules owner (F-101).
- `firebase deploy --only functions` — with **none** of the real requirements (`.env` present, discovery-timeout workaround, `--force` for `.env`-only changes, reauth).
- No mention that **CI auto-deploy is disabled** (F-701) so manual/local IS the canonical path today.

The "remove the redundant unsafe CI functions deploy" half of F-704 is already done (the #49 guard). This item closes the other half: **document one canonical procedure.**

## Recommended approach — rewrite the README "Deployment" section

Replace lines ~133–149 of `README.md` with a single canonical procedure:

1. **Prerequisites** — local `functions/.env` present (never committed); `firebase login --reauth` if credentials expired.
2. **Functions (backend — canonical):**
   `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions --project pathsynch-pitch-creation --force`
   with short notes: why the timeout (discovery load), why `--force` (2nd-gen skips `.env`-only diffs), that `.env` must be present locally.
3. **Rules (backend only):** `firebase deploy --only firestore:rules` — this repo is the **sole rules owner** (F-101); route rules changes through Williams.
4. **Hosting (frontend `synchintro-app`):** `firebase deploy --only hosting` **only** — never a bare deploy from the frontend (F-101).
5. **⚠️ Warnings:** never run bare `firebase deploy` (ships everything incl. rules); **CI auto-deploy is disabled (F-701)** — deploys are manual/local until `.env` is injected from a secret / Secret Manager (PR-B) and CI auth moves off `FIREBASE_TOKEN` (F-702); CI runners have no `.env`.

`CLAUDE.md` already carries the deploy gotchas — I'll keep it as-is and make the README the single canonical, human-facing procedure (optionally a one-line pointer from README to `CLAUDE.md` for the deep gotchas).

## Gate 1 answers

| Question | Answer |
|---|---|
| Secrets needed? | **None.** Docs only. |
| Tests? | **N/A** — documentation change; nothing executable. I'll sanity-check the commands read correctly and match `CLAUDE.md`/`firebase.json` reality. |
| Blast radius | `README.md` only. No code, no deploy, no config, no credentials. |
| Rollback | Revert the one section. |

## What could go wrong
Minimal — it's prose. Only real risk is documenting a command that drifts from reality; mitigated by cross-checking against `CLAUDE.md`, `firebase.json`, and the project ID already in use.

## Build plan (after approval)
1. Branch `docs/f704-canonical-deploy` off `main`.
2. Rewrite the README "Deployment" section per above.
3. Verify: renders correctly, commands match `CLAUDE.md`/`firebase.json`; diff scoped to `README.md`.
4. Gate 2 (`prd-review-f704.md`), then STOP for the PR.

## Merge routing
Docs → **Charles may self-merge** (Build OS / docs convention), or route to Williams if you prefer. I do not merge.

## Note
This is the **last unblocked remediation item.** After it, the only remaining work is **PR-B (F-701 proper + F-702)**, which needs you to provision GitHub Secrets before it can be built — and the P2/P3 backlog, which is out of scope unless you say otherwise.
