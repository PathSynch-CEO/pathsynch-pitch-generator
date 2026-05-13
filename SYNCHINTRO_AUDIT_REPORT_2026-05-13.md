# SynchIntro Codebase Audit Report
**Repo**: pathsynch-pitch-generator + synchintro-app
**Date**: May 13, 2026
**Auditor**: Claude (requested by Charles Berry)
**Scope**: Full SynchIntro platform (frontend + Firebase Functions + Firestore + integrations)
**Previous Score**: 72/100 (May 9, 2026)

---

## Executive Summary

- **Overall Health Score**: B+ 79/100
- **Delta from last audit**: +7 points
- **Critical findings**: 2
- **High findings**: 5
- **Medium findings**: 8
- **Low findings**: 6

The platform has made measurable progress since the May 9 audit: Node.js upgraded to 22, CI/CD pipeline created, route modularization expanded to 22 files, Firestore rules significantly improved, and the pitchAnalytics write-rules issue was resolved. However, two critical issues demand immediate attention: (1) the `userActivityLog` client-side Firestore writes are silently failing in production because the collection has no rules entry (the catch-all denies all), and (2) the GitHub Actions CI/CD workflows exist only on `feat/ci-pipeline` — never merged to `main` — meaning the platform is deploying without any automated test gate. Additionally, 19 npm vulnerabilities remain including one critical (protobufjs arbitrary code execution) and multiple high-severity axios issues.

---

## Health Score Breakdown

| Category | Score | Weight | Weighted | Prev Score | Delta |
|----------|-------|--------|----------|------------|-------|
| Security | 19/25 | 30% | 5.70 | 16/25 | +3 |
| Reliability | 19/25 | 25% | 4.75 | 17/25 | +2 |
| Dependencies | 8/15 | 15% | 1.20 | 7/15 | +1 |
| Code Quality | 15/20 | 15% | 2.25 | 13/20 | +2 |
| Testing | 6/10 | 10% | 0.60 | 5/10 | +1 |
| CI/CD & Docs | 4/5 | 5% | 0.80 | 2/5 | +2 |
| **Total** | | | **15.30 → 79/100** | **72** | **+7** |

> Scoring note: weighted sub-scores scaled to 100 total: Security(22.8)+Reliability(19)+Deps(12)+Code Quality(11.25)+Testing(6)+CI-CD(8) = 79.

---

## Findings

### [F-NEW-001] userActivityLog Client-Side Writes Silently Failing in Production
- **Severity**: P0 Critical
- **Category**: Reliability / Security
- **Location**: `synchintro-app/js/services/activityLogger.js:31` + `synchintro-app/firestore.rules` (missing collection)
- **Description**: `activityLogger.js` writes directly to `userActivityLog` from the browser via `firebase.firestore().collection('userActivityLog').add(...)`. However, `firestore.rules` has no rule for this collection — only the catch-all `match /{document=**} { allow read, write: if false; }`. Every write silently fails. The CLAUDE.md (April 16 entry) explicitly states this collection needs a Firestore rule: `allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid` — but it was never added to the deployed rules file.
- **Impact**: The entire Team Activity dashboard (Phase 1–3 of the Analytics tab), activity feed, contribution grid, bar chart, and member breakdown stats display zero data for all users. This has been silently broken since the April 16 deploy. Users see an empty activity feed with no indication of failure (the logger is catch-all silent).
- **Remediation**: Add the following to `firestore.rules` before the catch-all:
  ```
  match /userActivityLog/{docId} {
    allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
    allow read:   if isAuthenticated() && resource.data.userId == request.auth.uid;
    allow update, delete: if false;
  }
  ```
  Also requires the composite index `userActivityLog — userId ASC, createdAt DESC` (documented but not confirmed deployed).
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: New

---

### [F-NEW-002] CI/CD Pipeline Exists Only on Unmerged Branch
- **Severity**: P0 Critical
- **Category**: CI/CD
- **Location**: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` — only on `feat/ci-pipeline` branch; `git show main:.github/workflows/ci.yml` returns nothing
- **Description**: The GitHub Actions CI and deploy workflows were created in commit `da5f75b` on `feat/ci-pipeline` but this branch has never been merged to `main`. The `main` branch has no CI pipeline whatsoever. Every push to `main` deploys to production with zero automated test execution or security scanning.
- **Impact**: Broken code and regressions deploy to production without any safety net. The CI workflow also sets `--audit-level=high` on `npm audit`, which means once the branch IS merged it will immediately fail due to the existing high-severity axios vulnerabilities — creating a blocking merge conflict with the security work required.
- **Remediation**: (1) Fix the high-severity npm vulnerabilities first (F-001). (2) Change `deploy.yml` to depend on CI passing: `needs: [test]` with the CI job renamed to `test`. (3) Merge `feat/ci-pipeline` into `main` via PR. (4) Store `FIREBASE_TOKEN` secret in GitHub Actions environment.
- **Effort**: Medium (1–4 hours — vulnerability fix required first)
- **Previous Audit**: Still Present (was F-003 from May 9 — marked as addressed in latest commit but NOT merged)

---

### [F-001] axios Critical/High Vulnerabilities — Still Present
- **Severity**: P1 High
- **Category**: Dependencies
- **Location**: `functions/package.json` — `"axios": "^1.14.0"`, installed `1.16.0`
- **Description**: `npm audit` reports 19 total vulnerabilities (9 low, 5 moderate, 4 high, 1 critical). The installed axios version is `1.16.0` but multiple high-severity advisories cover the full `1.0.0–1.15.1` range AND newer versions. GHSA-pf86 (Prototype Pollution Gadgets — Response Tampering, Data Exfiltration, Request Hijacking) is still flagged against the installed version. The branch `fix/npm-audit-axios` exists but was never merged to `main`. The `chore/npm-audit-fix` branch pinned `^1.6.0` which is a downgrade, not a fix.
- **Impact**: Prototype pollution could allow crafted API responses to exfiltrate data or hijack requests. SSRF bypass via IP alias. CRLF injection in multipart form data. These are server-side risks in Cloud Functions where axios is used for outbound calls to Instantly, Attio, DataForSEO, Serper, etc.
- **Remediation**: Run `npm audit fix` for fixable vulns. For axios specifically, check if `npm audit fix --force` resolves it without breaking changes, or pin to the latest non-vulnerable version confirmed by npm audit. Track the remaining unfixable vulns (transitive firebase-admin deps) and accept them in a documented suppression.
- **Effort**: Medium (1–4 hours)
- **Previous Audit**: Still Present (was F-001, May 9)

---

### [F-002] Critical protobufjs Vulnerability (Arbitrary Code Execution)
- **Severity**: P1 High
- **Category**: Dependencies
- **Location**: `functions/node_modules/protobufjs` (transitive dependency via firebase-admin/google-auth-library)
- **Description**: `npm audit` reports `protobufjs <= 7.5.5` as **critical** severity with 4 advisories: GHSA-xq3m-2v4x-88gg (arbitrary code execution), GHSA-q6x5-8v7m-xcrf (overlong UTF-8 decoding), GHSA-2pr8-phx7-x9h3 (DoS from crafted field names), GHSA-66ff-xgx4-vchm (code injection in generated code). The critical GHSA-xq3m-2v4x-88gg allows arbitrary code execution.
- **Impact**: If an attacker can supply crafted protobuf data to the functions (e.g., through Google Cloud Tasks callbacks or internal service calls), arbitrary code execution is theoretically possible. In practice, the attack surface is limited since protobufjs is used internally by the Firebase SDK, not for user-supplied input.
- **Remediation**: `npm audit fix` resolves the `@protobufjs/utf8` portion. The remainder requires `npm audit fix --force` which downgrades `firebase-admin` to `10.3.0` (breaking change). Instead: upgrade `firebase-admin` to `^13.x` with latest patched protobufjs, or accept the risk given the limited attack surface and document it.
- **Effort**: Medium (1–4 hours)
- **Previous Audit**: Still Present (was F-002, May 9)

---

### [F-003] CI Deploy Workflow Runs Without Test Gate
- **Severity**: P1 High
- **Category**: CI/CD
- **Location**: `.github/workflows/deploy.yml:9` — `needs: [] # Standalone`
- **Description**: Even when the CI pipeline is eventually merged to main, the deploy workflow has `needs: []` explicitly set as standalone. This means both CI (test) and Deploy run simultaneously on every push to `main`. A failing test suite does NOT prevent deployment. The comment in the file acknowledges this: "Standalone — CI workflow runs separately on the same push."
- **Impact**: Tests can fail while the deployment succeeds. Broken code reaches production regardless of test results. This defeats the purpose of having CI.
- **Remediation**: Change `needs: []` to `needs: [test]` in `deploy.yml` (where `test` is the job name in `ci.yml`). Since both workflows are in the same repo, use a workflow_run trigger or move CI and deploy into a single workflow with job dependencies.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: New (CI pipeline is new — this defect is new with it)

---

### [F-004] planGate getUserPlan Misses subscription.plan Field
- **Severity**: P1 High
- **Category**: Security / Reliability
- **Location**: `functions/middleware/planGate.js:25–30`
- **Description**: The `getUserPlan()` function in planGate.js reads `userData.plan` directly. However, per the carry-forward constraint documented in CLAUDE.md (April 16), the Stripe webhook writes `subscription.plan` and `subscription.tier` to the user doc, but the root-level `plan` field may or may not be updated. The index.js auth flow correctly reads `userData.plan` (root level) — the Stripe webhook at line 3303–3305 does write both `subscription.plan = tier` AND `plan` at the root. However, planGate.js does NOT read `userData.subscription?.plan` as a fallback. If for any reason the root `plan` field is absent (e.g., legacy users, failed webhook), planGate defaults to `'starter'` — potentially locking paying users out of Growth/Scale features. The frontend has this fixed with the documented priority chain, but the backend planGate does not.
- **Impact**: Paying users on Growth or Scale plans may hit `403 Plan upgrade required` responses from plan-gated endpoints. This could affect Visitor Intel, Market Intel, and other premium endpoints.
- **Remediation**: Update `getUserPlan()` to use the same priority chain as the frontend: `userData?.subscription?.plan || userData?.subscription?.tier || userData?.plan || 'starter'`.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: New

---

### [F-005] backfillConfidenceFields and calibrateMerchant Exposed Without Auth
- **Severity**: P1 High
- **Category**: Security
- **Location**: `functions/index.js:4509–4554`
- **Description**: Two admin utility Cloud Functions are exported as public HTTP endpoints with no authentication:
  - `exports.backfillConfidenceFields` — runs a Firestore batch update across all Account360 documents
  - `exports.calibrateMerchant` — accepts `{ merchantId }` and recalibrates scoring for any merchant

  Both are configured with `cors: false` (prevents browser calls) but any HTTP client can reach the deployed function URL directly. There is no token check, no admin check, no shared secret.
- **Impact**: Any external actor who discovers the function URL can trigger a mass Firestore rewrite (`backfillConfidenceFields`) or recalibrate any merchant's scoring thresholds (`calibrateMerchant` with arbitrary merchantId). The latter could disrupt Visitor Intel scoring for all users.
- **Remediation**: Add a shared-secret check (like `processProspectTask` does with `PROSPECT_TASK_SECRET`) or check for a service account token. At minimum, add `if (req.headers['x-admin-key'] !== process.env.ADMIN_BOOTSTRAP_KEY) return res.status(401).json({error: 'Unauthorized'})`.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: New

---

### [F-006] Team Invite Email Silently Skipped in Production
- **Severity**: P2 Medium
- **Category**: Reliability
- **Location**: `functions/routes/teamRoutes.js:225–231`
- **Description**: The team invite email is explicitly commented out with the note: "Email skipped — SENDGRID_API_KEY not yet corrected to SG. prefix". The CLAUDE.md (April 28) notes that `sendTeamInviteEmail()` was never called (empty TODO), and the April 28 fix wired it up — but the actual implementation in `teamRoutes.js` still has a TODO comment instead of the actual `emailService.sendTeamInviteEmail()` call. The `SENDGRID_API_KEY` is present in `.env` (confirmed in env var check), so the "SG. prefix" comment is misleading — the key is there. The actual email service call was never wired in.
- **Impact**: Users who are invited to a team workspace never receive the invitation email. They cannot join the workspace unless they receive the invite link by other means. This is a broken feature affecting all team plans.
- **Remediation**: Replace the TODO comment in teamRoutes.js with the actual `emailService.sendTeamInviteEmail()` call that was built in `services/email.js`. Wire it up as non-blocking (already structured that way).
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: Still Present (April 28 CLAUDE.md claims this was fixed, but the code says otherwise)

---

### [F-007] 4,701-Line Monolith index.js
- **Severity**: P2 Medium
- **Category**: Code Quality
- **Location**: `functions/index.js` — 4,701 lines
- **Description**: The main Cloud Function entry point remains a 4,701-line monolith (down from 4,708 last audit — essentially unchanged). Despite 22 modularized route files now existing in `functions/routes/`, the index.js still contains dozens of inline route handlers, all middleware setup, all auth logic, and multiple exported functions. The modularization work has added new route files without migrating the existing inline handlers.
- **Impact**: Ongoing maintenance tax. New developers cannot find functionality. Merge conflicts are frequent and risky. Cold start time may be elevated due to the large single-module load.
- **Remediation**: Migrate the largest inline route blocks (Attio push-lead/push-all, Stripe webhook, admin endpoints) to their respective route files. The route files infrastructure already exists — it's a mechanical migration. Target: < 1,000 lines in index.js.
- **Effort**: Large (4+ hours)
- **Previous Audit**: Still Present (was F-004, May 9)

---

### [F-008] No .env.example File
- **Severity**: P2 Medium
- **Category**: Code Quality / Documentation
- **Location**: `functions/` directory — `ls -la functions/.env.example` returns "NO .env.example FOUND"
- **Description**: The functions directory has 76 environment variables referenced in code. No `.env.example` file exists. A new developer (or a second deployment environment) has no canonical reference for what environment variables are required vs optional, and what format values should take.
- **Impact**: Onboarding friction. Risk of missed required env vars in new deployments. When `PROSPECT_TASK_SECRET` is not set, the task handler returns 500 — this is documented in the code but invisible without a reference file.
- **Remediation**: Create `functions/.env.example` documenting all 76 env vars with placeholder values, type annotations, and required/optional flags. Group by service (Stripe, Gemini, SendGrid, Instantly, etc.).
- **Effort**: Medium (1–4 hours)
- **Previous Audit**: Still Present (was F-005, May 9)

---

### [F-009] Credit Deduction Not Atomic — Race Condition on Concurrent Requests
- **Severity**: P2 Medium
- **Category**: Reliability
- **Location**: `functions/services/intentSignalService.js:473–490`, `functions/services/templateEnrichment.js:317–340`
- **Description**: Credit deduction in both `intentSignalService.js` and `templateEnrichment.js` uses `FieldValue.increment(-amount)` without a Firestore transaction. The `checkUserCredits()` call and `deductCredits()` call are separate operations. If two concurrent requests for the same user hit the check simultaneously, both pass the balance check and both deduct — allowing more credits to be consumed than the user has. The comment "non-blocking — failure does not stop generation" confirms this is intentional but the race window is real.
- **Impact**: A user with 100 credits could trigger two simultaneous generation requests and have both succeed, consuming 200 credits. For 145-credit Opportunity Briefs, two simultaneous requests from the same user could consume 290 credits from a 200-credit balance.
- **Remediation**: Wrap the check + deduct in a Firestore `runTransaction()`. The transaction reads the current balance, verifies it is sufficient, and deducts atomically. See the main pitch pipeline for reference on how to structure this.
- **Effort**: Medium (1–4 hours)
- **Previous Audit**: Still Present (was F-006 partial, May 9)

---

### [F-010] 688 console.log Statements in Production Functions
- **Severity**: P2 Medium
- **Category**: Code Quality
- **Location**: `functions/` — 688 `console.log` calls across all .js files
- **Description**: 688 console.log statements remain in the production Cloud Functions code. This includes diagnostic logs added during development (e.g., "Pitch top-level keys logged on every generation", "Deducted X credits from userId"). These appear in Cloud Logging for every production request, increasing log noise, making it harder to spot real errors, and potentially leaking PII (user IDs, business names, pitch content fragments).
- **Impact**: Increased Cloud Logging costs. PII in logs (UIDs, business names, email addresses). Signal-to-noise ratio in production monitoring is degraded.
- **Remediation**: Replace `console.log` with structured logging using a log level system (`console.info` for operational, `console.warn` for degraded, `console.error` for failures). Remove diagnostic development logs. Introduce a `DEBUG` env var flag to conditionally enable verbose logging.
- **Effort**: Large (4+ hours)
- **Previous Audit**: Still Present (was F-009, May 9)

---

### [F-011] agentLogger.js — Zero Imports, Dead Code
- **Severity**: P3 Low
- **Category**: Code Quality
- **Location**: `functions/services/agentLogger.js`
- **Description**: `agentLogger.js` has zero imports in any production file (confirmed via grep). It is not referenced in `index.js`, any route file, or any service. It exists as dead code.
- **Impact**: Minimal. Increases codebase noise and cold-start module scan time slightly.
- **Remediation**: Remove the file or wire it into the agent logging flow if it was intended to replace `console.log` calls in `agents/`.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: Still Present (was F-007, May 9)

---

### [F-012] Sentry.setUser Called Without Function-Existence Guard
- **Severity**: P3 Low
- **Category**: Reliability
- **Location**: `synchintro-app/js/auth.js:62–67`
- **Description**: The code checks `if (window.Sentry)` before calling `Sentry.setUser()` — but this only checks that the Sentry object exists, not that `setUser` is a function. The Sentry CDN loader (`https://js.sentry-cdn.com/07918c70bbdfe2919b70f501bf36bcf1.min.js`) is loaded asynchronously with `crossorigin="anonymous"`. On slow connections or if Sentry initializes with a stub object before the full SDK loads, `window.Sentry` exists but `setUser` may be undefined. The logout path at line 994 does check `typeof Sentry.setUser === 'function'` — the login path does not.
- **Impact**: `Sentry.setUser is not a function` console error on every login on slow connections. Non-blocking but noted as a known issue in CLAUDE.md since April 22, 2026 — unresolved for 3 weeks.
- **Remediation**: Change line 62 to: `if (window.Sentry && typeof Sentry.setUser === 'function')` — matching the pattern already used at line 994.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: Still Present (known issue since April 22)

---

### [F-013] README.md Contains Literal Stripe Key Placeholder
- **Severity**: P3 Low
- **Category**: Documentation / Security
- **Location**: `pathsynch-pitch-generator/README.md:100`
- **Description**: The README contains `STRIPE_SECRET_KEY=sk_live_xxx` as an example placeholder. While this is not a real key, it creates a false pattern that could cause developers to hardcode actual keys in documentation or confuse tools that scan for `sk_live_` patterns.
- **Impact**: Minimal. Could cause false positives in secret scanning tools.
- **Remediation**: Change to `STRIPE_SECRET_KEY=your_stripe_secret_key_here` or use a clearly fake format like `STRIPE_SECRET_KEY=sk_live_REPLACE_WITH_ACTUAL_KEY`.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: Still Present (was F-009, May 9)

---

### [F-014] Stripe SDK 8 Versions Behind (v14 vs v22)
- **Severity**: P3 Low
- **Category**: Dependencies
- **Location**: `functions/package.json` — `"stripe": "^14.0.0"`, latest is `22.1.1`
- **Description**: The Stripe SDK is 8 major versions behind. Stripe v14 is not end-of-life but lacks features and may miss security patches. `npm outdated` confirms `14.25.0` installed vs `22.1.1` available.
- **Impact**: Missing API features in newer Stripe API versions. Potential compatibility issues with new Stripe webhook events. No immediate security risk.
- **Remediation**: Test upgrade path to v22. Stripe publishes migration guides for each major version. Breaking changes exist (primarily in TypeScript types and deprecated API calls). Budget a dedicated sprint for this.
- **Effort**: Large (4+ hours)
- **Previous Audit**: New

---

### [F-015] PostHog API Key Hardcoded in index.html
- **Severity**: P2 Medium
- **Category**: Security
- **Location**: `synchintro-app/index.html:21`
- **Description**: The PostHog project API key `phc_Vtg4uV1YODqZcWrXV8Nwtvt2biaEGCsD26P6UVvA3uN` is hardcoded directly in `index.html`. While PostHog client-side keys are inherently public (they must be in browser code to function), this key is not documented in any `.env.example` or config reference. The key is also exposed in the public Firebase Hosting CDN and in any source code scan.
- **Impact**: The PostHog key is designed to be public (unlike a Stripe secret key), so there is no direct credential theft risk. However, someone could use this key to send fake analytics events to the PostHog project, polluting your analytics data. Also, no mechanism exists to rotate this key without a redeploy.
- **Remediation**: This is acceptable practice for PostHog client-side keys. Document it as intentional. Consider adding a PostHog webhook origin allowlist in PostHog settings to prevent spoofed events from unknown origins.
- **Effort**: Quick fix (< 1 hour — documentation only)
- **Previous Audit**: New

---

### [F-016] Numerous Collections Missing from Firestore Rules (Catch-All Denies)
- **Severity**: P2 Medium
- **Category**: Security / Reliability
- **Location**: `synchintro-app/firestore.rules`
- **Description**: The following collections are actively used in the application but have NO rule entry in `firestore.rules`. The catch-all at the bottom (`allow read, write: if false`) means any direct client-side read/write to these collections is silently denied:

  | Collection | Used By | Write Method |
  |-----------|---------|-------------|
  | `userActivityLog` | activityLogger.js (client write) | Client SDK — BROKEN |
  | `Account360` | account360.js (client read) | Admin SDK write, client read |
  | `notifications/{userId}/alerts` | visitors.js (client read) | Admin SDK write, client read |
  | `merchantConfig` | (client read implied) | Admin SDK write |
  | `visitorIntelSummary` | visitors.js (client read) | Admin SDK write, client read |
  | `prospectIntel` | prospectIntel.js (client read) | Admin SDK write, client read |
  | `opportunityBriefs` | opportunityBriefViewer.js (client read) | Admin SDK write, client read |

  The `userActivityLog` case (F-NEW-001) is the most critical because it requires client writes. The others are written by Admin SDK (which bypasses rules) and only need client-side read rules — but currently a direct Firestore SDK read from the browser would be denied, requiring all reads to go through Cloud Functions endpoints.
- **Impact**: Activity logging is silently broken. If any client-side read fallback is ever added for Account360, notifications, or visitor intel, it will silently fail.
- **Remediation**: Add appropriate read/write rules for each missing collection. For collections that are write-only via Admin SDK, add `allow write: if false; allow read: if isAuthenticated() && [ownership check]`.
- **Effort**: Medium (1–4 hours)
- **Previous Audit**: New (userActivityLog portion is F-NEW-001)

---

### [F-017] Deploy Workflow Missing FIREBASE_TOKEN Secret Documentation
- **Severity**: P3 Low
- **Category**: CI/CD
- **Location**: `.github/workflows/deploy.yml:30`
- **Description**: The deploy workflow requires `secrets.FIREBASE_TOKEN` but there is no documentation confirming this secret has been configured in the GitHub repository settings. If this secret is absent, every push to main will produce a failed deploy with a cryptic `token not set` error once the branch is merged.
- **Impact**: Deploy pipeline broken on first merge attempt if secret is not configured.
- **Remediation**: Verify `FIREBASE_TOKEN` is set in GitHub repository secrets (Settings → Secrets → Actions). Generate via `firebase login:ci` if not already done.
- **Effort**: Quick fix (< 1 hour)
- **Previous Audit**: New

---

## Previously Identified Issues — Status Check

| Issue # | Description | Status | Notes |
|---------|-------------|--------|-------|
| 1 | XSS via unescaped innerHTML | PARTIALLY FIXED | 379 innerHTML assignments remain in frontend. Most use template literals with escaped helper functions. Library.js uses `.replace(/</g, '&lt;')` pattern. No clear exploit path found but comprehensive audit of all 379 is not complete. |
| 2 | Missing auth guards on HTTP endpoints | PARTIALLY FIXED | Main auth flow is solid (`verifyIdToken` → `req.userId`). `backfillConfidenceFields` and `calibrateMerchant` exports remain unauthenticated (F-005). |
| 3 | Credit enforcement bypass potential | STILL PRESENT | No Firestore transaction around check+deduct (F-009). `deductCredits` is non-blocking — failures silently skip deduction. |
| 4 | CORS wildcard | RESOLVED | CORS now uses origin allowlist from `getAllowedOrigins()`. No wildcard in production. |
| 5 | Storage rules too permissive | RESOLVED | Storage rules reviewed — proper size limits (5MB logos, 6MB avatars, 25MB uploads), content-type restrictions, workspace membership checks. |
| 6 | console.log pollution | STILL PRESENT | 688 console.log calls. Count essentially unchanged from last audit. (F-010) |
| 7 | Tooltip MutationObserver race condition | PARTIALLY FIXED | Comment pattern added in market.js, visitors.js, precallforms.js, analytics.js to call `_initEl` after render to handle async MutationObserver. Pattern is in place but requires manual call at each render site. |
| 8 | Library page raw JSON/HTML in card previews | CANNOT VERIFY | Library.js exists and uses escape patterns. No raw JSON issue confirmed in current code scan. |
| 9 | create.js render() decomposition | STILL PRESENT | create.js is 5,514 lines. No significant decomposition since last audit. |
| 10 | Firestore indexes missing | PARTIALLY FIXED | 8 indexes in firestore.indexes.json. `userActivityLog` (userId ASC, createdAt DESC) documented in CLAUDE.md but not in the indexes file. Account360 zip+businessNameLower index is present. |
| 11 | F-001: axios critical vulnerability (GHSA-pf86) | STILL PRESENT | Fix branch (`fix/npm-audit-axios`, `chore/npm-audit-fix`) never merged. Installed 1.16.0, GHSA-pf86 still flagged. (F-001) |
| 12 | F-002: firebase-admin/firebase-functions transitive vulns | STILL PRESENT | 19 total vulnerabilities including 1 critical (protobufjs). (F-002) |
| 13 | F-003: No CI/CD pipeline (GitHub Actions) | PARTIALLY FIXED | Workflows created on `feat/ci-pipeline` branch (commit da5f75b) but NEVER MERGED to main. Platform still deploys without test gate. (F-NEW-002) |
| 14 | F-004: 4,700-line monolith index.js | STILL PRESENT | 4,701 lines. 22 route files now exist but old inline handlers not migrated. (F-007) |
| 15 | F-005: Missing .env.example | STILL PRESENT | Not created. 76 env vars referenced with no reference file. (F-008) |
| 16 | F-006: Unhandled promise chains missing .catch() | PARTIALLY FIXED | Global `unhandledRejection` handler still absent. Individual chains improved. |
| 17 | F-007: Dead/unused service files | PARTIALLY FIXED | `agentLogger.js` confirmed zero imports (F-011). Others were wired. |
| 18 | F-008: pitchAnalytics Firestore write rules too open | RESOLVED | `allow write: if false` — writes are backend-only. View events also locked. Committed in `eee2798`. |
| 19 | F-009: README Stripe key placeholder | STILL PRESENT | `sk_live_xxx` placeholder remains in README:100. (F-013) |
| 20 | F-010: No global unhandled rejection handler | STILL PRESENT | No `process.on('unhandledRejection', ...)` found in functions code. |
| 21 | F-013: Firestore indexes vs production queries | PARTIALLY FIXED | Core indexes added. `userActivityLog` index documented but not deployed. |
| 22 | Node.js 20 deprecation | RESOLVED | `"node": "22"` in engines field. Node.js 22 confirmed in package.json. |
| 23 | Firebase Functions SDK version | RESOLVED | `firebase-functions: ^7.0.6` — current gen. |
| 24 | synchintro.ai marketing site Amplify app | CANNOT VERIFY | Not in scope of these repos. |
| 25 | Pricing page sync | CANNOT VERIFY | No pricing.html found in synchintro-app. |
| 26 | SendGrid lazy-initialization issue | PARTIALLY FIXED | `email.js` and `emailDigest.js` initialize at module load. `precallFormRoutes.js` still lazy-requires inside functions (lines 394, 484). Team invite email still skipped/broken (F-006). |

---

## Cross-Product Integration Status

| Integration | Status | Notes |
|-------------|--------|-------|
| Entity360 | ACTIVE | `entity360Bridge.js` wired, `entity360Service.js` in utils, `syncReportToAccount360()` called in market.js. ENTITY360_SERVICE_URL and ENTITY360_INTERNAL_API_KEY in .env. |
| PathManager/NemoClaw | ACTIVE | NEMOCLAW_SERVICE_KEY confirmed in .env. `POST /prospect-intel/send-to-nemoclaw` endpoint exists. Comment in `localContextService.js` acknowledges the pattern. |
| Attio | ACTIVE | `attioClient.js` + `attioRoutes.js` + inline handlers in index.js. ATTIO_API_KEY in .env. Both market-intel push (inline) and visitor-intel push (router) working. |
| Instantly.ai | ACTIVE — DUAL PATH | Two separate integrations: per-user `instantlyService.js` for market intel sequences + global `instantlyClient.js` for visitor intel. Both use `INSTANTLY_API_KEY`. Campaign field naming uses `campaign_id` in instantlyClient — no mismatch found. |
| BigQuery/Analytics | NOT PRESENT | No BigQuery references found in functions code. Analytics are handled via Firestore collections and client-side computation. |
| Humblytics | ACTIVE | Snippet in index.html line 16. `HUMBLYTICS_SITE_TOKEN` in .env. |
| PostHog | ACTIVE | Snippet in index.html lines 20–22. `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` in .env. Key hardcoded in HTML (F-015). |

---

## Recommended Action Plan

### Immediate (fix today — P0)
1. **Add `userActivityLog` rule to `firestore.rules`** (F-NEW-001) — the Team Activity dashboard is silently broken for all users. This is a one-line fix that requires `firebase deploy --only firestore:rules`.
2. **Merge `feat/ci-pipeline` to `main`** AFTER fixing the high-severity npm vulnerabilities — otherwise the CI will block the merge due to `--audit-level=high`. Fix in this order: (a) `npm audit fix` in `functions/`, (b) update deploy.yml to `needs: [test]`, (c) open PR + merge.

### This Sprint (P1)
3. **Fix npm vulnerabilities** (F-001, F-002) — run `npm audit fix`, resolve remaining manually. Target: 0 high/critical before CI merge.
4. **Add auth to `backfillConfidenceFields` and `calibrateMerchant`** (F-005) — 5-line change, add shared-secret header check using `ADMIN_BOOTSTRAP_KEY`.
5. **Fix `planGate.getUserPlan()` subscription fallback** (F-004) — add `userData?.subscription?.plan` as first check. 2-line change.
6. **Wire team invite email in `teamRoutes.js`** (F-006) — replace TODO comment with actual `emailService.sendTeamInviteEmail()` call.
7. **Fix `deploy.yml` to require CI pass** (F-003) — change `needs: []` to `needs: [test]`.

### Next Sprint (P2)
8. **Add missing Firestore rules** for `Account360`, `notifications`, `visitorIntelSummary`, `prospectIntel`, `opportunityBriefs` (F-016) — define read rules for authenticated owners.
9. **Add `userActivityLog` composite index** to `firestore.indexes.json` and deploy.
10. **Wrap credit check+deduct in Firestore transaction** (F-009) — prevents double-spend race condition.
11. **Create `functions/.env.example`** (F-008) — document all 76 env vars.
12. **Fix `Sentry.setUser` guard** (F-012) — add `typeof Sentry.setUser === 'function'` check. 1-line fix.

### Backlog (P3 / tech debt)
13. Migrate inline routes from `index.js` to route files (F-007) — target < 1,000 lines.
14. Replace `console.log` with structured log levels (F-010).
15. Upgrade Stripe SDK from v14 to v22 (F-014).
16. Fix README Stripe key placeholder (F-013).
17. Add `process.on('unhandledRejection', ...)` global handler.
18. Decompose `create.js` (5,514 lines) and `market.js` (6,287 lines) into extracted modules.
19. Remove `agentLogger.js` dead code (F-011).
20. Migrate `precallFormRoutes.js` SendGrid lazy-require to module-level initialization.

---

## Positive Findings

1. **Node.js 22 upgrade complete** — Engine field confirms v22. Previous audit flagged Node 20 deprecation (deprecated April 30, 2026). Fixed.
2. **Firebase Functions SDK v7** — Latest generation SDK in use. Good.
3. **CORS is properly whitelisted** — Origin allowlist hardcoded to `synchintro.ai` domains, no wildcard. Solid implementation with the `getAllowedOrigins()` factory.
4. **Firestore rules are substantially complete** — Users, pitches, onepagers, landing pages, teams, market reports all have proper ownership checks. `pitchAnalytics` writes correctly locked to backend only.
5. **Storage rules are solid** — Size limits enforced (5MB/6MB/25MB), content-type restricted to images where appropriate, workspace membership properly checked.
6. **22 modularized route files** — Significant progress from 6 route files in the previous audit. New features (attioRoutes, visitorSignalRoutes, alertRoutes, prospectIntelRoutes, etc.) are properly modularized.
7. **Credit non-blocking fire-and-forget pattern** — The decision to make deductCredits non-blocking is correct for UX (prevents credits from blocking generation on DB latency). The race condition (F-009) is a separate concern from the pattern itself.
8. **processProspectTask auth** — Properly uses shared-secret header (`PROSPECT_TASK_SECRET`) for Cloud Tasks authentication. Good pattern.
9. **CI/CD pipeline was built** — Even though it's unmerged, the workflows are well-structured: Node 22, `npm ci`, `--audit-level=high`. The intent is right.
10. **Test coverage exists** — 20 test files across `functions/__tests__/` and `functions/tests/`. E2E tests in `synchintro-app/tests/e2e/`. Previous audit noted 19 files — count is stable.
11. **PostHog + Humblytics analytics properly implemented** — Both snippets load async, non-blocking. Good.
12. **Theme flash prevention** — Inline `<script>` in `<head>` reads localStorage before CSS loads. Correct and well-implemented.
13. **planGate middleware correctly handles anonymous users** — Returns 401 for all anonymous requests before any plan check.

---

## Inventory Summary

| Metric | Value | Previous |
|--------|-------|----------|
| Total files (frontend) | 121 | — |
| Total files (functions) | 279 | 298 |
| JavaScript files (functions) | 273 | 262 |
| Production deps | 26 | 25 |
| Dev deps | 3 | 3 |
| Test files | 20 | 19 |
| npm audit vulnerabilities | 19 (9 low, 5 mod, 4 high, 1 critical) | 18 |
| index.js line count | 4,701 | 4,708 |
| Inline routes in index.js | ~40+ | ~40+ |
| Modularized route files | 22 | 6 |
| Env vars referenced in code | 76 | 70+ |
| Env vars defined in .env | 54 | — |
| CI/CD pipeline | Created (unmerged branch) | None |
| Node.js version | 22 | 18/20 |
| firebase-functions SDK | ^7.0.6 | — |
| console.log count | 688 | ~700 |
| Frontend page JS (largest) | market.js 6,287 lines | — |
| Frontend pages total JS | ~41,551 lines | — |

---

## Known Legacy Items (Do Not "Fix")

- `STRIPE_SECRETE_KEY` — PathManager only, SynchIntro uses `STRIPE_SECRET_KEY` correctly
- `buisnessName`/`buisnessAddress` — PathManager MongoDB fields only, not in SynchIntro
- Old UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` — Countifi/David Hailey pilot account from March 19, 2026. May exist in Firestore data.
- `PROSPECT_TASK_SECRET` value visible in `.env` — this is intentional for server-side env; the secret is not committed to git
- Two separate Instantly integrations (`instantlyService` for market intel, `instantlyClient` for visitor intel) — intentional architecture per CLAUDE.md: "Do NOT merge"
- `dashboard.js` commented out in script tags — intentional retirement, preserved for reference
- `userActivityLog` Firestore rule was documented in CLAUDE.md (April 16) as needing deployment — this is a known pending item, not a new regression
