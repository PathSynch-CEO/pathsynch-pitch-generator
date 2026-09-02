# GitHub OIDC / WIF Authentication Smoke Test

## Scope

This change proves authentication only:

`GitHub OIDC -> Google Workload Identity Federation -> deploy-service-account impersonation -> Application Default Credentials usable by gcloud`

It does not deploy, change IAM, enable the disabled production deploy job, or remove legacy authentication.

## Current auth and deployment inventory

### GitHub Actions

| File | Job or reference | Current state | Purpose and authentication |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `test` | Active on PRs and pushes to `main` | Unit tests and npm audit; `contents: read`; no Google auth. |
| `.github/workflows/ci.yml` | `emulator-tests` | Active on PRs and pushes to `main` | Firestore emulator rules tests; no Google auth. |
| `.github/workflows/ci.yml` | `deploy` | Disabled by literal `if: false` | Retains the production Functions deploy command and supplies `secrets.FIREBASE_TOKEN` to Firebase CLI. This is the only current workflow dependency on `FIREBASE_TOKEN`; it cannot run while disabled. |
| `.github/workflows/weekday-health-audit.yml` | `health-audit` | Active by weekday schedule and manual dispatch | Read-only repository health audit. It uses `AUDIT_REPO_TOKEN` for private checkouts, has no Google credentials, requests no OIDC token, and contains no Firebase deploy step. |
| `.github/workflows/wif-auth-smoke.yml` | `authenticate` | Manual dispatch only; job runs only for `refs/heads/main` | New non-deploy WIF/ADC proof. It grants `contents: read` and `id-token: write`, impersonates the dedicated service account, and runs read-only gcloud checks. |

Before this smoke workflow, no workflow requested `id-token: write` and no workflow used `google-github-actions/auth`.

### Executable deployment and legacy-auth references

| File | Exact purpose | State |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `npx firebase-tools deploy --only functions ...`; receives `secrets.FIREBASE_TOKEN`. | Production deploy path retained but disabled by `if: false`. |
| `functions/package.json` | Local `npm run deploy` alias for `firebase deploy --only functions`. | Manual/local command; not invoked by Actions. |
| `firebase.json` | Runs `scripts/assert-clean-deploy.cjs` before Functions deploys. | Active deploy guard; unchanged. |
| `scripts/assert-clean-deploy.cjs` | Blocks deploys from dirty, unpushed, or behind-origin source. | Active via `firebase.json`; unchanged. |
| `functions/scripts/uploadSalesDocFirebase.js` | Legacy manual sales-library helper that invokes `firebase login:ci` while attempting to obtain an access token. | Executable legacy reference, not used by CI or deploy workflows; intentionally unchanged in this narrowly scoped PR and must not be run for this migration. |
| `functions/scripts/seed-king-digital-brand.js` | Prints a scoped Functions deploy suggestion after a one-off seed. | Informational output only; does not deploy by itself. |

There is no active `firebase deploy --token` command. The disabled CI deploy instead relies on Firebase CLI discovering the `FIREBASE_TOKEN` environment variable.

Historical audit/planning prose also mentions these terms, including `docs/SECRET_MANAGER_MIGRATION_PLAN.md`, `pathsynch-build/prd.json`, `pathsynch-build/progress.txt`, the dated audit reports, strategy/PRD reviews, changelogs, `README.md`, `functions/CLAUDE.md`, and `functions/SYSTEM_BIBLE.md`. Those records are not executable auth paths. Where they say the current workflow passes `--token`, or that nothing consumes `FIREBASE_TOKEN`, the current `.github/workflows/ci.yml` source is authoritative: it contains no `--token` flag, but its disabled deploy job does expose `secrets.FIREBASE_TOKEN` as an environment variable.

### Google credential references outside Actions

These are existing runtime or local-admin uses of Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; none is changed by the smoke test.

- Runtime ADC via `google-auth-library`: `functions/services/imagenHero.js` (Vertex Imagen), `functions/services/prospectIntelService.js` (authenticated Google task/service call), `functions/services/reviewHealthEnqueue.js` (authenticated review-health enqueue), and `functions/services/vertexSearch.js` (Vertex AI Search).
- Firebase Admin/local migration credentials: `functions/backfill-migration.js`.
- Local Firestore admin, backup, backfill, diagnostic, migration, refund, rescore, and seed scripts using ADC or `GOOGLE_APPLICATION_CREDENTIALS`: `functions/scripts/backfill-workspace-fields.js`, `functions/scripts/backfill-workspaceid.js`, `functions/scripts/backfillDescriptionsFromBulk.js`, `functions/scripts/backfillMarketReportDeletedAt.js`, `functions/scripts/backup-before-bootstrap.js`, `functions/scripts/backup-stuck-batches.js`, `functions/scripts/bootstrap-workspaces.js`, `functions/scripts/clear-stuck-batches.js`, `functions/scripts/invite-daniyal.js`, `functions/scripts/migrate-pitch-status.js`, `functions/scripts/refund-prospect-intel-credits.js`, `functions/scripts/rescoreGovOpportunities.js`, `functions/scripts/seed-irs-bmf.js`, `functions/scripts/seed-king-digital-brand.js`, `functions/scripts/seedGovProfiles.js`, and `functions/scripts/seedPitchTemplates.js`.
- Local scripts using an explicit service-account JSON certificate path: `functions/scripts/account-audit-3d-3e.js` (account audit), `functions/scripts/countifi-rollout-recon.js` (read-only Countifi reconciliation), `functions/scripts/countifi-rollout.js` (Countifi rollout), `functions/scripts/diagnoseMariadeth.js` (workspace diagnosis), and `functions/scripts/setup-enrichment-auth.js` (one-time Firestore config setup).
- Local scripts reading Firebase CLI OAuth credentials or tokens: `functions/scripts/setCountifiICP.js` (Countifi Firestore update), `functions/scripts/testPitchGeneration.js` (sales-library pitch test), `functions/scripts/uploadSalesDocFirebase.js` (legacy upload helper), and `functions/scripts/uploadViaRest.js` (Firestore REST upload). These are not CI paths and are unchanged.
- Root IRS BMF seed variants: `scripts/seed-irs-bmf.cjs` and `scripts/seed-irs-bmf.js`.
- Configuration guidance only: `functions/.env.example` and `synchnotify/.env.example`. `pathsynch-build/progress.txt` also records local credential guidance but is not executable.
- Test-only GoogleAuth mocks: `functions/tests/pipelineWiring.test.js`, `functions/tests/prospectIntelCircuitBreaker.test.js`, `functions/tests/prospectIntelCredits.test.js`, and `functions/tests/reviewHealthEnqueue.test.js`.

## Branch and provider boundary

The workflow has no PR or push trigger and its sole job requires `github.ref == 'refs/heads/main'`. The already-configured WIF provider independently requires `refs/heads/main`, in addition to the fixed GitHub owner and repository IDs. A token issued for a pull-request or feature-branch ref therefore fails both the workflow job guard and the provider-side ref condition. This PR does not weaken or modify that provider policy.

## Later migration sequence

Keep the legacy secret and production workflow unchanged until the smoke proof succeeds:

1. Merge this PR, then manually run the WIF authentication smoke workflow on `main`.
2. Migrate the actual deploy workflow from `FIREBASE_TOKEN` to WIF-provided ADC.
3. Validate the existing deploy guard in the new workflow shape.
4. Separately authorize a production deployment.
5. Prove the production deployment.
6. Remove the GitHub `FIREBASE_TOKEN` secret.
7. Revoke the legacy Firebase refresh token.
8. Add a permanent CI guard banning `FIREBASE_TOKEN`, `firebase login:ci`, and Firebase `--token` authentication.

`FIREBASE_TOKEN` remains untouched in this step.
