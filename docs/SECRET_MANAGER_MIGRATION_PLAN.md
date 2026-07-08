# Secret Manager Migration Plan — `pathsynch-pitch-generator`

**Status:** Plan only. No code changes, no deploys. Drafted July 7, 2026 (B3).
**Project:** `pathsynch-pitch-creation` · **Functions runtime:** Firebase Functions **v2** (`firebase-functions/v2`).

## Scope

Migrate these four secrets from `functions/.env` to **Firebase Secret Manager** (Google Secret Manager, bound to functions via `defineSecret`):

| Secret | Current read sites | Reached by |
|--------|--------------------|-----------|
| `GEMINI_API_KEY` | `new GoogleGenerativeAI(process.env.GEMINI_API_KEY)` across ~15 modules (`market.js`, `swotGenerator.js`, `geminiLeadEnricher.js`, `agentRunner.js`, `competitorValidator.js`, `api/audit/index.js`, `aisynchPromptGenerator.js`, …) | `api` + Gemini-using schedulers |
| `SAM_GOV_API_KEY` | `functions/routes/govcaptureRoutes.js:805` | `api` (SAM sync route) |
| `GOVCAPTURE_SCHEDULER_SECRET` | `functions/routes/govcaptureRoutes.js:857, 1040` (admin `x-admin-key` gate) | `api` (admin/digest-run routes) |
| `GOVCAPTURE_SENDGRID_API_KEY` | `functions/services/govcapture/digestSender.js:136` | `api` (send-test) + gov digest scheduler (**currently off**) |

### 🚫 Explicitly EXCLUDED: `SERPER_API_KEY`

**`SERPER_API_KEY` stays in `functions/.env` ONLY. It MUST NOT appear in any `secrets: [...]` array, `defineSecret` call, or Secret Manager plan.** Binding it as a Firebase secret triggers a **known deploy-conflict** (invariant carried across sessions). This document deliberately omits it. Any future migration must treat this as a hard exclusion until that conflict is separately root-caused and resolved.

---

## Why this works with zero read-site rewrites

In Functions **v2**, a secret bound to a function via the `secrets` option is injected into that function's runtime `process.env` under its own name. So existing `process.env.GEMINI_API_KEY` (etc.) reads **keep working unchanged** — the only code change is adding the `secrets: [...]` option to each function whose code path reads the value. No `.value()` refactor of the ~15 Gemini call sites is required.

**Consequence — binding must be complete:** a secret is only present in `process.env` for functions that declare it. A function that reads `process.env.GEMINI_API_KEY` without declaring the secret will see `undefined` at runtime. Bind to **every** function whose code path can read each secret.

---

## Step 1 — Declare secrets (code)

In `functions/index.js`, near the top (after the existing `firebase-functions/v2` imports, before `setGlobalOptions` at line 75):

```js
const { defineSecret } = require('firebase-functions/params');

const GEMINI_API_KEY            = defineSecret('GEMINI_API_KEY');
const SAM_GOV_API_KEY           = defineSecret('SAM_GOV_API_KEY');
const GOVCAPTURE_SCHEDULER_SECRET  = defineSecret('GOVCAPTURE_SCHEDULER_SECRET');
const GOVCAPTURE_SENDGRID_API_KEY  = defineSecret('GOVCAPTURE_SENDGRID_API_KEY');
// NOTE: SERPER_API_KEY is intentionally NOT declared here — .env only (deploy-conflict invariant).
```

> Do **not** add secrets to `setGlobalOptions({...})`. Global secrets attach to *every* function (including ones that don't need them and, critically, would pull in bindings we want to keep scoped). Bind per-function instead.

## Step 2 — Bind secrets per function (code)

Add a `secrets` array to each function's options object. Binding matrix:

| Function (`index.js`) | Line | `secrets` to add |
|-----------------------|------|------------------|
| `exports.api` (`onRequest`) | 209 | `GEMINI_API_KEY`, `SAM_GOV_API_KEY`, `GOVCAPTURE_SCHEDULER_SECRET`, `GOVCAPTURE_SENDGRID_API_KEY` |
| `exports.weeklyDigest` (`onSchedule`) | 3604 | `GEMINI_API_KEY` *(only if its code path calls Gemini — verify, see below)* |
| `exports.dailyDigest` (`onSchedule`) | 3624 | `GEMINI_API_KEY` *(verify)* |
| `exports.merchantBehaviorSync` (`onSchedule`) | 3738 | `GEMINI_API_KEY` *(verify)* |
| `exports.processThresholdAlerts` (`onSchedule`) | 3752 | `GEMINI_API_KEY` *(verify)* |
| Gov digest scheduler (**off — DO NOT enable in this migration**) | — | `GOVCAPTURE_SENDGRID_API_KEY`, `GEMINI_API_KEY` when it is eventually re-enabled |

`activityCleanup`, `backfillConfidenceFields`, `calibrateMerchant`, `bootstrapWorkspaces` do **not** read any of these secrets → no binding.

**Verification grep before binding schedulers** (run from `functions/`), to confirm which schedulers actually touch Gemini so we don't over- or under-bind:

```bash
# For each scheduled function, trace its handler's requires to any GoogleGenerativeAI usage.
grep -rn "GoogleGenerativeAI\|process.env.GEMINI_API_KEY" services/ api/ routes/
```

Example for `exports.api`:
```js
exports.api = onRequest({
    // …existing options (cors, timeoutSeconds: 300, etc.)…
    secrets: [GEMINI_API_KEY, SAM_GOV_API_KEY, GOVCAPTURE_SCHEDULER_SECRET, GOVCAPTURE_SENDGRID_API_KEY],
}, async (req, res) => { /* unchanged */ });
```

## Step 3 — Create the secret values (one-time, per secret)

Use the Firebase CLI (writes to Google Secret Manager, grants the runtime SA accessor):

```bash
firebase functions:secrets:set GEMINI_API_KEY            --project pathsynch-pitch-creation
firebase functions:secrets:set SAM_GOV_API_KEY           --project pathsynch-pitch-creation
firebase functions:secrets:set GOVCAPTURE_SCHEDULER_SECRET  --project pathsynch-pitch-creation
firebase functions:secrets:set GOVCAPTURE_SENDGRID_API_KEY --project pathsynch-pitch-creation
```

Each prompts for the value on stdin (paste the current `.env` value — never echo it into logs, PRs, or this file). This creates version `1` of each secret.

## Step 4 — Local emulator parity

The emulator does **not** read Secret Manager. Keep the four values available locally via **`functions/.secret.local`** (git-ignored, same `KEY=value` format), OR leave them in `.env` for local only. Confirm `.secret.local` is in `.gitignore` (add if missing). `SERPER_API_KEY` remains in `.env` regardless.

## Step 5 — Remove migrated keys from deployed `.env`

Once secrets are set and bound, delete the four lines from `functions/.env` (they are now sourced from Secret Manager at runtime). **Keep `SERPER_API_KEY` in `.env`.** Also clean the pre-existing duplicate/stale keys noted in the A2 hygiene pass (`PM_GAUTH_CLIENT_ID` has two *disagreeing* values at lines 90/112) as a separate hygiene commit — out of scope here but flagged.

## Step 6 — Deploy sequence

1. **Merge code first** (Steps 1–2) via PR to `main` (Williams review — production blast radius).
2. Ensure secret values exist (Step 3) **before** deploying the new code, or the deploy will warn/fail on unresolved secret bindings.
3. Deploy functions:
   ```bash
   firebase deploy --only functions:api --project pathsynch-pitch-creation
   # then the bound schedulers, individually, e.g.:
   firebase deploy --only functions:weeklyDigest,functions:dailyDigest,functions:merchantBehaviorSync,functions:processThresholdAlerts --project pathsynch-pitch-creation
   ```
   Deploying `api` first limits blast radius; verify it boots and serves before the schedulers.
4. **Smoke test** after each deploy: hit a Gemini-backed route (e.g. generate a small Market Intel report), a SAM route, and the gov digest **send-test** endpoint. Confirm no `undefined key` / 401 from the providers.
5. First deploy of a secret-bound v2 function may need the **Secret Manager Secret Accessor** role granted to the runtime service account — the CLI usually does this in Step 3; if a deploy errors with a Secret Manager permission failure, grant `roles/secretmanager.secretAccessor` to the functions runtime SA and retry (mirrors the Eventarc first-deploy retry pattern).

## Step 7 — Rollback

Low-risk and fast because Secret Manager retains versions and `.env` values are unchanged until Step 5:

- **Before Step 5 (keys still in `.env`):** redeploy the previous function revision (or revert the `secrets:` code change) — runtime falls back to `.env` values. No secret deletion needed.
- **After Step 5:** restore the four lines to `functions/.env` (values from your secure store), revert the `secrets:` bindings + `defineSecret` lines, redeploy. Secret Manager versions remain and can be re-bound later.
- Secret **value** rollback: `firebase functions:secrets:set <NAME>` creates a new version; the previous version is retained and can be re-pinned via `functions:secrets:` tooling / Cloud Console.

## Post-migration verification checklist

- [ ] `firebase functions:secrets:get <NAME>` lists a version for all four.
- [ ] `api` boots; Gemini report generation, SAM sync, and gov digest send-test all succeed.
- [ ] Scheduler functions that call Gemini run without `undefined` key errors (check next scheduled invocation logs).
- [ ] `SERPER_API_KEY` still resolves from `.env` (Serper-backed features work) and appears in **no** `secrets:` array.
- [ ] No secret **values** were written to logs, commit messages, or PR descriptions.

---

# Companion: Migrate CI off the deprecated `FIREBASE_TOKEN`

Same failure class as `.env`-based secrets — a long-lived credential that silently expires and 401s. The June 29 CI deploy already failed once with a `401 on cloudresourcemanager.googleapis.com` due to the deprecated `firebase login:ci` token. Replace token auth with **service-account auth via `GOOGLE_APPLICATION_CREDENTIALS`** (Application Default Credentials).

## Current state

- CI (`.github/workflows/ci.yml`) authenticates deploys with the `FIREBASE_TOKEN` GitHub secret (`firebase deploy --token "$FIREBASE_TOKEN"`).
- `firebase login:ci` tokens are **deprecated** and expire unpredictably → recurring 401s (open item since June 29).

## Target state

Deploy authenticated by a **GCP service account key** provided as ADC.

### Steps

1. **Create a deploy service account** (Console or gcloud), e.g. `github-deployer@pathsynch-pitch-creation.iam.gserviceaccount.com`, with least-privilege roles:
   - `roles/cloudfunctions.admin` (deploy functions)
   - `roles/iam.serviceAccountUser` (act as the functions runtime SA)
   - `roles/firebasehosting.admin` *(only if this workflow also deploys hosting — the pitch-generator repo generally deploys functions/rules, not hosting)*
   - `roles/cloudscheduler.admin` *(schedulers)* and `roles/eventarc.admin` *(Firestore/Eventarc triggers)* if the deploy manages those
   - `roles/secretmanager.admin` **only** on the CI identity if CI must *set* secrets; runtime SA needs just `roles/secretmanager.secretAccessor` (granted in Step 3 above). Prefer setting secret values manually (Step 3), keeping CI to `secretAccessor`-less deploys.
2. **Download a JSON key** for that SA. Store it as a **GitHub Actions secret** `GCP_SA_KEY` (repo → Settings → Secrets → Actions). Never commit it.
3. **Update the workflow** to write ADC and drop the token:
   ```yaml
   - name: Authenticate to Google Cloud
     uses: google-github-actions/auth@v2
     with:
       credentials_json: ${{ secrets.GCP_SA_KEY }}
   # google-github-actions/auth exports GOOGLE_APPLICATION_CREDENTIALS for later steps.

   - name: Deploy functions
     run: npx firebase deploy --only functions --project pathsynch-pitch-creation --non-interactive
     # NOTE: no --token. firebase-tools picks up ADC from GOOGLE_APPLICATION_CREDENTIALS.
   ```
   (Equivalent without the marketplace action: `echo "$GCP_SA_KEY" > "$RUNNER_TEMP/sa.json"; export GOOGLE_APPLICATION_CREDENTIALS="$RUNNER_TEMP/sa.json"`.)
4. **Remove** the `FIREBASE_TOKEN` GitHub secret and every `--token` usage from all workflows (`ci.yml`, `weekday-health-audit.yml`, any others).
5. **Key hygiene:** SA JSON keys don't expire, but rotate on a schedule (e.g. 90 days) or move to **Workload Identity Federation** (keyless, OIDC from GitHub → GCP) as a follow-up to eliminate the long-lived key entirely.

### Rollback (CI)

Re-add the `FIREBASE_TOKEN` secret (regenerate via `firebase login:ci`) and restore the `--token` deploy step. Keep this only as a stopgap — the token path is the thing we're retiring.

### Verification (CI)

- [ ] A CI run deploys with ADC (no `--token`) and succeeds.
- [ ] `FIREBASE_TOKEN` secret removed; no workflow references it.
- [ ] Deploy SA has only the roles it needs (audit in IAM).
- [ ] `GCP_SA_KEY` never printed in logs (mask is automatic for secrets, but avoid `set -x` around it).

---

## Follow-up items surfaced (not part of this plan)

- `.env` duplicate keys: `PM_GAUTH_CLIENT_ID` (lines 90 & 112) hold **different** values — `dotenv` keeps the first, so line 112 is dead *and* disagrees; `PM_GAUTH_CLIENT_SECRET` (91/113) and `VERTEX_SEARCH_DATA_STORE_ID` (12/35) are duplicated but identical. Resolve in a hygiene commit.
- Consider Workload Identity Federation to remove the long-lived CI SA key.
