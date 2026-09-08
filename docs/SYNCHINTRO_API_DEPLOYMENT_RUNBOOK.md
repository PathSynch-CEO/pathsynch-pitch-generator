# Controlled SynchIntro API deployment and serving-revision verification

A Firebase CLI exit code of zero proves neither production promotion nor application
acceptance. Every authorized deployment has three distinct outcomes: artifact created,
intended revision serving, and application smoke accepted. Record all three separately.
If the created revision is not serving, **STOP**; never mutate traffic automatically.

Project `pathsynch-pitch-creation`; region `us-central1`; Functions Gen2 export/service
`api`; source directory `functions`; codebase `default`.
This runbook proposes procedures. It grants no merge, deploy, tag, traffic or booking authority.
Do not use the broad package deploy alias or enable disabled Actions to follow it.

## Before an explicitly authorized deployment

1. Obtain Charles's authorization for the exact **merged-main SHA** and functions:api scope.
   Fetch origin/main successfully. Require current branch main, HEAD equal fresh origin/main
   and the authorized SHA, and clean tracked/staged files. Stop on every command failure.
   Do not update the SHA to match whatever is locally convenient.
2. Run source/package boundary checks on that exact checkout using the actual approved Firebase
   CLI packager without upload. Inventory every archive path, preserve required runtime assets,
   compare package contents to authorized source and explicitly reviewed additions, and scan
   locally for credential values without printing them. Git cleanliness does not cover ignored
   files. Prefer a clean deployment checkout; record any local environment injection separately.
   An earlier accepted 588-file archive is history, not a permanent count assertion. New source
   requires a fresh inventory. Do not copy incident scratch or credentials into the package.
3. Verify the **actual Firebase CLI loadUserEnvs** for project pathsynch-pitch-creation and the
   production deployment mode, including all .env and project-specific overrides. Check
   NYLAS_MIN_BOOKING_NOTICE_MINUTES resolves to 60 and NODE_ENV to production; reject emulator configuration. Compare each required non-secret
   configuration against the approved configuration. Report names/presence or hashes, not
   unrelated values. .secret.local is emulator-only and must remain excluded.
4. Compare secret binding **metadata** (resource, explicit version, enabled state) to the
   approved baseline. NYLAS_API_KEY must be a Secret Manager binding, never plaintext env.
   Preserve IMAGEN_API_ENDPOINT, THEORG_API_KEY and SPYFU_API_KEY bindings too. Do not access
   secret payloads merely to verify metadata, and do not modify IAM/WIF or secrets.
5. Use the existing approved manual Firebase login or approved WIF/ADC deployment identity.
   WIF authentication smoke does not prove package, configuration, or promotion readiness.
   Do not use FIREBASE_TOKEN, --token, or predeploy bypass variables.
6. Record service revision, latest-created/latest-ready, desired and observed traffic,
   generation/observedGeneration, immutable revision UID/image and health, Functions build/source
   generation, Hosting release, and an explicitly identified rollback reference. Prevent
   concurrent deployment/traffic work during the change window. api-00413-feq is a historical
   degraded baseline, not a known-good booking rollback. api-00416-hoc is the accepted baseline
   as of September 8; re-verify its existence and health for any later change.
7. Preserve exact-head CI/review evidence, the approved archive/content manifest and UTC start.
   A deployment authorization does not silently authorize traffic-policy changes or live bookings.

Source gate, run in PowerShell after inserting the explicitly authorized SHA:

```powershell
Set-Location -LiteralPath C:\Users\tdh35\pathsynch-pitch-generator
$apiAuthorizedSha = '<exact Charles-authorized merged-main SHA>'
if ($apiAuthorizedSha -notmatch '^[0-9a-f]{40}$') { throw 'Require exact authorized SHA' }
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify fresh main' }
$apiBranch = git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'Cannot read branch' }
$apiHead = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read HEAD' }
$apiOrigin = git rev-parse origin/main
if ($LASTEXITCODE -ne 0) { throw 'Cannot read origin/main' }
$apiDirty = git status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw 'Cannot read worktree' }
if ($apiBranch -ne 'main' -or $apiHead -ne $apiOrigin -or $apiHead -ne $apiAuthorizedSha -or $apiDirty) {
    throw 'Require clean exact authorized main'
}
foreach ($apiName in @('ALLOW_UNPUSHED_DEPLOY', 'ALLOW_BEHIND_DEPLOY', 'FIREBASE_TOKEN')) {
    if ([Environment]::GetEnvironmentVariable($apiName)) { throw "Forbidden deployment variable: $apiName" }
}
```

The existing assert-clean-deploy.cjs hook remains unchanged. It checks the current branch,
allows some unverified fetch paths and detached HEAD cases, and ignores untracked files for
blocking purposes. It cannot substitute for this stronger exact-main/package gate.

## Deployment — separate explicit authorization required

From the checked backend root, the sole deployment command is:

```powershell
firebase deploy --only functions:api --project pathsynch-pitch-creation --non-interactive
if ($LASTEXITCODE -ne 0) { throw 'Functions deployment failed; inspect state read-only' }
```

Do not run another deployment merely because the new revision does not serve. Identify the
existing artifact first. Do not use --force, broader functions scope, or deployment bypasses.

## After deployment: discover the real artifact, then verify

1. Read Functions v2 functions/api and Cloud Run v2 services/api and its revisions.
   Identify the real new revision by creation time after the recorded deployment start,
   previously recorded latest-created revision, function serviceConfig.revision, build identity,
   immutable storage source generation and image/buildInfo. Never increment a name or assume
   the latest entry is yours. Concurrent or no-op/ambiguous deployment: STOP and reconcile.
2. Prove the downloaded immutable source generation contains the approved package and authorized
   Git content. Bind image buildInfo/source labels to that source/build. Firebase buildpack
   Cloud Build responses can have empty sourceProvenance and no results.images; do not invent
   missing fields. Build SUCCESS alone cannot establish Git-to-image identity.
3. Prepare an operator-controlled expectation JSON from the separately saved predeploy source,
   configuration and secret metadata, plus the independently identified new revision:
   schemaVersion=1; project; location; service; authorizedSha; expectedRevision; previousRevision;
   deploymentStartedAt (canonical UTC YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ); revisionUid; image (digest-qualified); build (full resource name);
   source={bucket,object,generation}; configSha256={required name: SHA256 of exact UTF-8 value};
   secretVersions={each expected binding name: explicit positive version string}.
   previousRevision is the **predeploy latest-created** revision. Do not derive configuration
   expectations from the unverified new revision: that would approve its own drift.
   Do not put credentials or secret payload hashes in this file. Low-entropy config hashes
   are change-detection evidence, not encryption; keep the file controlled.
4. With already configured ADC (manual ADC or approved WIF/impersonation), run:

```powershell
node scripts/verify-api-deployment.cjs --expect C:\controlled-evidence\api-deployment-expectation.json
if ($LASTEXITCODE -ne 0) { throw 'STOP: production deployment verification failed' }
```

The command uses existing functions/node_modules/google-auth-library and the APIs' required cloud-platform OAuth scope. Scope is not a read-only authority boundary:
   preserve existing read-only IAM for the operator identity; the tool itself issues GETs only.
It performs five GETs against fixed project/service endpoints: service before, expected revision,
function, build, and service after. Requests have 30-second timeouts, no redirects, no retries.
It emits a sanitized pass summary or a generic failure; SDK errors can contain credentials.
Existing metadata read permissions are sufficient: run.services.get, run.revisions.get,
cloudfunctions.functions.get and cloudbuild.builds.get. Do not grant broader IAM for this tool.
If ADC or read access is unavailable, STOP; do not fall back to a key, legacy Firebase token,
or silently skip a check. The CLI is tested with injected read-only clients; operator Firebase
login and ADC are distinct authentication paths.

The verifier rejects wrong latest-created/latest-ready, stale or split desired/observed traffic,
tags, unreconciled generations, inactive/retired/unhealthy revisions, missing or changed required
configuration (including NODE_ENV=production), emulator flags, changed secret bindings, mismatched Functions build/source/image expectation,
unsuccessful/old builds and concurrent service changes. It accepts desired LATEST only when
latest-created/latest-ready and resolved observed traffic identify the exact expected revision.
It does **not** deploy, promote, tag, rollback, access secret payloads, or call Nylas.

A metadata PASS is explicitly labeled deployment-metadata-only. It is not proof of Git-to-archive
identity, application health, secret runtime access, or Nylas availability. The expectation file
and caller are trusted operator inputs, not an authorization mechanism. Secondary resource reads are point-in-time observations, not a cross-resource transaction;
keep the change window exclusive and repeat the gate after any uncertainty. It is an explicit
manual gate, not automatically installed into CI or the Firebase hook.

5. Verify exact-revision startup conditions and production health, then scoped request logs
   proving the health request reached the expected revision. Read
   https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/health and
   https://app.synchintro.ai/li-book-demo/. Check production booking CORS OPTIONS. Health alone
   does not exercise booking dependencies.
6. If new revision is not serving, record ARTIFACT CREATED / PRODUCTION PROMOTION BLOCKED,
   and STOP for Charles. A temporary tag for isolated health requires separate explicit
   authorization. Do not test an ordinary URL and attribute the old revision's health to the new.
7. If serving verification and health pass, execute only the smoke scope Charles authorized.
   A no-booking smoke may allow one controlled session and one availability GET, with capability
   in memory only. It must not create a booking/event. A real booking/replay requires its own
   explicit bounded authorization. Read final traffic/config/Hosting and scoped logs again.
8. Record successful artifact, successful production serving, and successful authorized smoke
   independently. Any unexpected change or ambiguous result is a failed gate, never an automatic
   rollback/promotion instruction.

## Traffic policy comparison and recommendation

Google documents that explicit revision allocations persist into subsequent deployments;
sending traffic to LATEST restores future latest-revision behavior.
Functions v2 exposes allTrafficOnLatestRevision to explicitly override splits.
The September 8 Firebase update omitted it and demonstrably preserved the pin.
Do not assume every CLI/version/deploy will choose the same traffic semantics.

| Policy | Safety and rollback | Firebase Gen2 behavior / predictability | Stale-code risk / complexity / governance |
| --- | --- | --- | --- |
| A: restore LATEST | New ready revisions receive ordinary traffic without an isolated acceptance step. Rollback to an explicit known-good revision is possible but recreates pinning; policy must then be reconsidered. | Native Cloud Run behavior under Functions Gen2. Firebase deployment is expected to advance the latest target once ready, subject to actual control-plane state and verification. | Lower silent-staleness risk, simpler routine operation, greater coupling of deploy and promotion. Requires Charles to authorize that enduring policy and accept promotion as part of future deployments. |
| B: retain explicit pin; separate promotion | New artifact stays isolated until exact-revision health/source/config proof and explicit promotion approval. Exact-revision rollback remains possible with separate authorization. | Compatible with the observed Firebase Gen2 deployment. Firebase must not be expected to override an explicit pin; a deploy may create a non-serving retired revision. | Staleness remains possible if verification is skipped; mandatory fail-closed verification exposes it. More operator steps, strongest separation of deployment and traffic authority. |
| C: native staged/canary rollout with tags | Isolated tag proof then percentage rollout limits exposure; rollback restores recorded known-good allocation. Tags themselves expose an alternate URL. | Cloud Run-native control of the Gen2 service; verify Functions management interactions. Cloud Deploy automation would require separately reviewed integration rather than assuming Firebase manages it. | More allocation states and monitoring; more complexity and approval design. Could improve later release operations but is unnecessary for this closeout. |

**Recommend B now.** It fits Charles's existing separate deployment/promotion authority, requires no
production policy change, and reuses the recovery's successful isolated proof then promotion
sequence. The read-only verifier makes a preserved pin an explicit failed production-acceptance
gate. A successful deploy that creates a non-serving revision is expected artifact delivery,
not a successful production release. This recommendation does not implement new policy or automation.

No change to LATEST is recommended in this task. If Charles later prefers A, prepare a fresh
proposal against current state, re-verify that latest-created and latest-ready are the accepted
revision, prevent concurrent deploys, and obtain explicit authorization for the enduring
traffic behavior before using the documented --to-latest operation. Do not execute it from
this document or assume today's revision remains latest.

For future B promotion, after separate Charles authorization of the **real observed revision**,
the procedure is: record unchanged baseline; complete isolated health proof (any tag separately
authorized); promote exactly that revision with the approved percentage; verify desired/observed
traffic, generation convergence, health and scoped logs; stop on mismatch. Prepare the concrete
command only when the revision and authorization are known. No automatic traffic mutation exists.

Authoritative sources (reviewed September 8, 2026):
- [Cloud Run persistent traffic allocations and LATEST](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
- [Cloud Functions v2 ServiceConfig](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions#ServiceConfig)
- [Cloud Run GET OAuth scope](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/get)
- [Cloud Functions GET OAuth scope](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/get)
- [Firebase scoped Functions deployment](https://firebase.google.com/docs/functions/manage-functions#deploy_functions)

See [acceptance and incident record](SYNCHINTRO_PRODUCTION_ACCEPTANCE_2026-09-08.md) for the
causal chain, immutable baseline, bounded booking proof and separately authorized cleanup plan.
