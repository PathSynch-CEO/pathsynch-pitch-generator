# Functions deploy authentication migration to WIF/ADC

## Scope

The manual authentication smoke test has passed on `main`, proving:

`GitHub OIDC -> Google Workload Identity Federation -> deploy-service-account impersonation -> Application Default Credentials usable by gcloud`

The disabled production Functions deploy job is now configured to use that WIF/ADC path. This
change does not deploy, change IAM, enable the deploy job, delete the repository secret, or revoke
the underlying Firebase refresh token.

## Current auth and deployment inventory

### GitHub Actions

| File | Job or reference | Current state | Purpose and authentication |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `test` | Active on PRs and pushes to `main` | Unit tests and npm audit; `contents: read`; no Google auth. |
| `.github/workflows/ci.yml` | `emulator-tests` | Active on PRs and pushes to `main` | Firestore emulator rules tests; no Google auth. |
| `.github/workflows/ci.yml` | `deploy` | Disabled by literal `if: false` | Uses job-scoped `contents: read` + `id-token: write`, the approved WIF provider/service account, and ADC. The production Functions deploy command remains intact and unreachable. CI no longer consumes `FIREBASE_TOKEN`. |
| `.github/workflows/weekday-health-audit.yml` | `health-audit` | Active by weekday schedule and manual dispatch | Read-only repository health audit. It uses `AUDIT_REPO_TOKEN` for private checkouts, has no Google credentials, requests no OIDC token, and contains no Firebase deploy step. |
| `.github/workflows/wif-auth-smoke.yml` | `authenticate` | Manual dispatch only; job runs only for `refs/heads/main` | New non-deploy WIF/ADC proof. It grants `contents: read` and `id-token: write`, impersonates the dedicated service account, and runs read-only gcloud checks. |

The repository's `FIREBASE_TOKEN` secret still exists as rollback insurance, but no active
CI/deployment/config surface consumes it after this migration.

### Executable deployment and legacy-auth references

| File | Exact purpose | State |
| --- | --- | --- |
| `.github/workflows/ci.yml` | WIF/ADC authentication followed by `npx firebase-tools deploy --only functions ...`. | Production deploy path retained but disabled by `if: false`; no legacy token input. |
| `functions/package.json` | Local `npm run deploy` alias for `firebase deploy --only functions`. | Manual/local command; not invoked by Actions. |
| `firebase.json` | Runs `scripts/assert-clean-deploy.cjs` before Functions deploys. | Active deploy guard; unchanged. |
| `scripts/assert-clean-deploy.cjs` | Blocks deploys from dirty, unpushed, or behind-origin source. | Active via `firebase.json`; unchanged. |
| `functions/scripts/uploadSalesDocFirebase.js` | Legacy manual sales-library helper that invokes `firebase login:ci` while attempting to obtain an access token. It also contains a destructive `firestore:delete salesDocuments` attempt before producing local JSON. | Executable but obsolete/manual-only; not used by CI or deployment workflows. Modernizing it would broaden this PR and preserve unsafe behavior, so it is unchanged and must be separately deprecated/removed. Do not run it. |
| `functions/scripts/seed-king-digital-brand.js` | Prints a scoped Functions deploy suggestion after a one-off seed. | Informational output only; does not deploy by itself. |

There is no active `firebase deploy --token` command and no active CI/deploy/config consumption of
`FIREBASE_TOKEN`. Historical documents and the obsolete manual helper remain outside the permanent
active-surface guard. Legacy auth is therefore removed from CI, not fully eradicated from every
executable file in the repository.

### Permanent active-surface legacy-auth guard

`functions/tests/functionsDeployWifWorkflow.test.js` scans all GitHub Actions workflow YAML plus
the active Firebase, package-script, and deploy-guard configuration surfaces. It rejects
`FIREBASE_TOKEN`, `firebase login:ci`, Firebase CLI `--token` authentication, and equivalent Firebase
refresh-token configuration. Historical docs/changelogs and manual scripts are deliberately not
in that scan; the unresolved helper above remains an explicit follow-up rather than a hidden
exception.

Historical audit/planning prose also mentions these terms, including `docs/SECRET_MANAGER_MIGRATION_PLAN.md`, `pathsynch-build/prd.json`, `pathsynch-build/progress.txt`, the dated audit reports, strategy/PRD reviews, changelogs, `README.md`, `functions/CLAUDE.md`, and `functions/SYSTEM_BIBLE.md`. Those records are not executable auth paths. Where they describe the former token-based CI path, the current `.github/workflows/ci.yml` source is authoritative: its disabled deploy job now uses WIF/ADC and contains neither a `--token` flag nor a legacy-token environment input.

### Google credential references outside Actions

These are existing runtime or local-admin uses of Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; none is changed by this deploy-auth migration.

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

## Current state and next human gate

The smoke proof has succeeded. The deploy job now uses WIF/ADC but remains hard-disabled:

1. Merge this configuration-only migration while `if: false` keeps production deployment unreachable.
2. The next human gate is explicit authorization for one WIF/ADC-based production Functions deploy.
3. In a separate PR/change under that authorization, resolve the remaining environment-injection
   requirement, re-enable the job, and prove the deployment while preserving the clean-source guard.
4. Only after that successful deployment may the GitHub `FIREBASE_TOKEN` secret be deleted and the
   underlying Firebase refresh token revoked.
5. Separately deprecate/remove `functions/scripts/uploadSalesDocFirebase.js`.

The `FIREBASE_TOKEN` secret remains untouched and available for rollback in this step; CI no longer
references or consumes it.
