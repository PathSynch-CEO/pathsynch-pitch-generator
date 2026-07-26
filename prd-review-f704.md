# Gate 2 Review — F-704: Converge on one documented deploy path

**Work Item 3, F-704.** Built — PR NOT opened, nothing merged. Branch: `docs/f704-canonical-deploy` (off `main`). Gate 1: `strategy-review-f704.md`.

---

## What changed

`README.md` — rewrote the "Deployment" section. It previously documented a bare `firebase deploy` (ships rules too) and `firebase deploy --only functions` with **none** of the real requirements. Replaced with one canonical procedure:

- **Banner:** deploys are manual/local; CI auto-deploy is disabled (F-701) until `.env` injection + non-deprecated auth (F-702); **never bare `firebase deploy`** (ships rules).
- **Prerequisites:** `functions/.env` present locally (supplies runtime secrets; deploying without it strips them); `firebase login --reauth` if expired.
- **Functions (canonical):** `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions --project pathsynch-pitch-creation --force` — in both PowerShell and bash — with notes on why the timeout, why `--force`, and to confirm `Loaded environment variables from .env.`
- **Rules (this repo only):** `firebase deploy --only firestore:rules` — sole owner (F-101).
- **Hosting (from `synchintro-app` only):** `firebase deploy --only hosting`.
- Pointer to `functions/CLAUDE.md` → "Deploy Gotchas".

## Verification

- **Matches reality:** the documented functions command is exactly the one just run successfully in production this session — `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"` then `firebase deploy --only functions --project pathsynch-pitch-creation --force`, which logged `Loaded environment variables from .env.` and updated all functions incl. `reconcileStuckBatches`. Cross-checked against `CLAUDE.md` gotchas and `firebase.json`.
- **No tests apply** — documentation change; nothing executable. Stated plainly rather than padding.
- Diff scoped to `README.md` (the `.claude/settings.local.json` entry is the pre-existing harness edit, not mine, not staged).

## Safety
- **Nothing deployed. No code, config, credentials, or production touched.** `README.md` prose only.
- No self-merge.

## Rollback
Revert the one section.

## Merge routing
Docs → **Charles may self-merge** (Build OS / docs convention), or Williams if preferred. I do not merge.

---

**STOP — awaiting your go-ahead to open the PR.** This is the last unblocked remediation item; after it, only **PR-B (F-701 proper + F-702)** remains, which needs you to provision GitHub Secrets.
