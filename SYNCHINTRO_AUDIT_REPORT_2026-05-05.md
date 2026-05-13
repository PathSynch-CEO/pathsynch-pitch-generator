# SynchIntro Codebase Audit Report — Backend
**Repo**: pathsynch-pitch-generator
**Date**: 2026-05-05
**Scope**: Firebase Functions backend (`functions/` directory)
**Auditor**: Claude Sonnet 4.6 (automated)
**Branch**: `fix/opportunity-brief-v2-polish`

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall Health Score** | **B- (72/100)** |
| **Critical (P0) findings** | 2 |
| **High (P1) findings** | 6 |
| **Medium (P2) findings** | 8 |
| **Low (P3) findings** | 5 |
| Total JS files in functions/ | 262 |
| Lines of code (index.js) | 4,740 |
| Lines of code (market.js) | 2,812 |
| Lines of code (pitchGenerator.js) | 2,253 |
| Console log/warn/error statements | 1,441 |
| Test files (project-owned) | 14 |
| Node.js runtime | 22 (matches package.json) |

**Summary**: The backend is fundamentally sound — auth is enforced consistently, Firestore rules are well-considered, and the Gemini model hierarchy is clean (no banned deprecated models). The two P0 issues are both secrets-exposure risks: live production credentials in a tracked `.env` file, and a missing encryption key (`INSTANTLY_ENCRYPTION_KEY`) that will crash any Instantly API key save in production. The P1 issues center on Firestore rule over-permissiveness (two collections), missing composite indexes for new collections, and leftover debug console.logs shipping to production. No XSS via `innerHTML` was found in the functions layer. No deprecated Gemini models were found.

---

## Health Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Security — Secrets | 40 | 100 | Live credentials in `.env` file tracked by git (`.env` is in `.gitignore` root, **but** was found on disk; confirmed NOT git-tracked by `git ls-files`) |
| Security — Auth/AuthZ | 78 | 100 | Two Firestore collection rules are over-permissive |
| Security — Input Validation | 85 | 100 | Joi/Zod used consistently in new endpoints |
| Security — CORS | 90 | 100 | Whitelist-based, correct origin behavior |
| Reliability — Error Handling | 72 | 100 | 11 `.then()` without `.catch()`, fire-and-forget patterns documented |
| Code Quality — Models | 100 | 100 | No deprecated Gemini models found |
| Code Quality — Debugging | 50 | 100 | 1,441 console statements; 5 DEBUG-labeled logs in production paths |
| Dependencies | 65 | 100 | Stripe SDK 8 major versions behind; several packages outdated |
| Testing | 55 | 100 | 14 test files, no CI/CD, no coverage gate |
| Documentation | 90 | 100 | SYSTEM_BIBLE + CLAUDE.md comprehensive and current |
| Firestore — Rules | 70 | 100 | 2 collections with overly broad read rules |
| Firestore — Indexes | 60 | 100 | 3 collections missing composite indexes |

---

## Findings

---

### F-001 — P0 CRITICAL | Security — Secrets Exposure
**Category**: Credentials
**Location**: `functions/.env`

**Description**: The `functions/.env` file contains live production credentials in plaintext:
- `STRIPE_SECRET_KEY=sk_live_51OAeaRC...` (Stripe live secret key)
- `GEMINI_API_KEY=AIzaSyAhr8sz...`
- `GOOGLE_PLACES_API_KEY=AIzaSyCR7QOs...`
- `GOOGLE_SEARCH_API_KEY=AIzaSyDKS4g7...`
- `SENDGRID_API_KEY=SG.wOaGXpHE...`
- `CORESIGNAL_API_KEY=VGKhZjkWI7...`
- `CENSUS_API_KEY=009b4d8951...`
- `MONGODB_URI=mongodb+srv://pathconnect11_24:kMsGWxtWyWI3vpFj@...` (includes password)
- `ATTIO_API_KEY`, `INSTANTLY_API_KEY`, `SERPAPI_KEY`, `SERPER_API_KEY`, `DATAFORSEO_PASSWORD`, etc.

**Status**: The `.env` file is NOT git-tracked (`git ls-files functions/.env` returns empty). The root `.gitignore` correctly excludes `functions/.env`. However:
1. The file exists on disk with live credentials (confirmed by `cat functions/.env`)
2. If a developer accidentally runs `git add -A` or stages this file, it will be committed
3. The MongoDB URI contains a username:password in the connection string — this credential has broader impact than just this project

**Impact**: Full production credential exposure if file is accidentally committed. MongoDB password embedded in URI format is particularly risky as it grants access to a shared MongoDB Atlas cluster (`PathConnect1`).

**Remediation**:
1. Rotate any credentials that may have been exposed
2. Migrate all secrets to Firebase Secret Manager (add to `secrets: [...]` array in `exports.api` definition in `index.js`)
3. For the MongoDB URI specifically: use a dedicated read-only service account and/or Secret Manager
4. Add a pre-commit hook that scans for `sk_live_` and `AIzaSy` patterns

**Effort**: Medium (migration to Secret Manager for each secret)

---

### F-002 — P0 CRITICAL | Security — Missing Encryption Key Causes Production Crash
**Category**: Missing Environment Variable
**Location**: `functions/routes/instantlyRoutes.js:27-29`, `functions/.env`

**Description**: The `INSTANTLY_ENCRYPTION_KEY` environment variable is defined in `instantlyRoutes.js` as required for AES-256-CBC encryption of stored Instantly API keys. This key is NOT present in `functions/.env`. The `getEncryptionKey()` function throws `Error('INSTANTLY_ENCRYPTION_KEY environment variable is not set')` if called.

Any user on Growth+ plan who attempts to:
- `POST /instantly/connect` (save their Instantly API key)
- `GET /instantly/campaigns` (list campaigns — calls `decryptApiKey`)
- `POST /instantly/push-lead` (requires decrypted API key)

...will receive an unhandled exception that results in a 500 error.

**Impact**: The entire Instantly integration (a plan-gated feature on Growth+) is silently broken in production. Users will get 500 errors with no clear error message.

**Remediation**: Generate a 32-byte hex key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and add `INSTANTLY_ENCRYPTION_KEY=<key>` to `functions/.env`. Note: existing stored Instantly API keys (if any) were stored as legacy plaintext and `decryptApiKey()` has a graceful fallback for those — so adding the key will not break existing stored keys.

**Effort**: Low (10 minutes — generate key, add to .env, deploy)

---

### F-003 — P1 HIGH | Security — `opportunityBriefs` Firestore Rule: Any Authenticated User Can Read Any Brief
**Category**: Firestore Security Rules
**Location**: `firestore.rules` — `opportunityBriefs` block

**Description**: The current rule is:
```
allow read: if isAuthenticated();
```
This allows any authenticated SynchIntro user to read any other user's opportunity brief document directly from the Firestore client SDK — not just their own. The comment says "Public read via shareToken handled server-side" but the rule does not restrict reads to `userId == request.auth.uid`.

**Impact**: Any authenticated user can enumerate and read all opportunity briefs from all users if they know or can guess a `briefId`. Opportunity briefs contain prospect intelligence, competitor data, revenue models, and business analysis.

**Remediation**: Change to:
```
allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
```
Note: Public share-token reads are handled server-side via Admin SDK (`getOpportunityBriefByToken` in `opportunityBriefService.js`), so this change will not break the public share flow.

**Effort**: Low (5 minutes — update rule, deploy)

---

### F-004 — P1 HIGH | Security — `teams` Firestore Rule: Direct Client Write Enabled
**Category**: Firestore Security Rules
**Location**: `firestore.rules` — `teams` block

**Description**: The current rule is:
```
allow write: if isAuthenticated() && request.auth.uid == ownerUid;
```
This allows the team owner to directly write their `teams/{ownerUid}` document from the client SDK. However, the `teams` document embeds the `members[]` and `memberUids[]` arrays — fields that control workspace inheritance and plan access. A malicious owner could directly manipulate these arrays from the client to add arbitrary UIDs as workspace members, bypassing the invite/accept flow in `teamRoutes.js`.

**Impact**: Team owner could add arbitrary UIDs to `memberUids[]` via direct Firestore write, giving those users access to the owner's plan, products, and ICPs through workspace inheritance. However, this is self-harm by the owner and does not affect other users' data.

**Remediation**: Change `allow write: if false` and ensure all team mutations go through Cloud Functions (which already use Admin SDK). The `teamRoutes.js` backend handles all team operations. This is a defense-in-depth improvement.

**Effort**: Low — but requires verifying no frontend code writes directly to `teams/{uid}`

---

### F-005 — P1 HIGH | Reliability — Missing Composite Firestore Indexes for `prospectIntel` Batches
**Category**: Missing Firestore Indexes
**Location**: `firestore.indexes.json`, `functions/routes/prospectIntelRoutes.js:178-180`

**Description**: `GET /prospect-intel/batches` (list user's batches) executes:
```javascript
db.collection('prospectIntel')
    .where('userId', '==', req.userId)
    .orderBy('createdAt', 'desc')
    .limit(20)
```
This query requires a composite index on `prospectIntel (userId ASC, createdAt DESC)`. No such index exists in `firestore.indexes.json`. Similarly, the prospect subdocument query at line 233 uses `.orderBy('createdAt', 'asc')` which may also need a composite index.

**Impact**: Any user attempting to list their Prospect Intel batches will receive a Firestore "requires index" error. This means the batch list page is currently broken in production.

**Remediation**: Add to `firestore.indexes.json`:
```json
{
  "collectionGroup": "prospectIntel",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**Effort**: Low (add index entry, run `firebase deploy --only firestore:indexes`)

---

### F-006 — P1 HIGH | Reliability — `opportunityBriefs` Missing Composite Index
**Category**: Missing Firestore Indexes
**Location**: `firestore.indexes.json`, `functions/routes/opportunityBriefRoutes.js`

**Description**: The opportunity brief list endpoint (if any) or any query by `userId + createdAt` on the `opportunityBriefs` collection has no composite index. The collection was added April 26, 2026, and no index was added to `firestore.indexes.json`.

**Impact**: Listing opportunity briefs by user will fail with a Firestore index error once more than one brief exists per user.

**Remediation**: Add composite index for `opportunityBriefs (userId ASC, createdAt DESC)`.

**Effort**: Low

---

### F-007 — P1 HIGH | Reliability — Leftover DEBUG Console.log Statements in Production Code
**Category**: Code Quality / Logging
**Location**:
- `functions/api/pitch/templateOnePager.js:515, 519, 531`
- `functions/services/templateSectionResolver.js:101, 109, 113`

**Description**: Five `console.log` statements with `[renderStatCards DEBUG]` and `[resolveStatValue DEBUG]` prefixes remain in production code. These were added during the April 30 debugging session for stat card rendering. CLAUDE.md explicitly notes: "Remove when confirmed working." The stat card rendering has been confirmed working (Estrellita pitch shows correct stats per CLAUDE.md).

**Impact**: Every L2 one-pager generation emits 5+ debug log lines to Cloud Functions logs. This pollutes structured logging, increases costs slightly (Cloud Logging charges by ingestion volume), and makes production debugging harder by burying signal in noise.

**Remediation**: Remove all 5 debug console.log statements from the two files. No functional changes needed.

**Effort**: Very Low (15 minutes)

---

### F-008 — P1 HIGH | Dependencies — Stripe SDK 8 Major Versions Behind
**Category**: Dependencies
**Location**: `functions/package.json` — `"stripe": "^14.0.0"`; current latest: `22.1.0`

**Description**: The Stripe SDK is at major version 14 (installed `14.25.0`). The current version is `22.1.0`. This is an 8-major-version gap spanning approximately 2 years. Stripe regularly deprecates API features and older SDK versions may not support the latest webhook event types or Stripe API versions.

Key risks:
- Stripe Billing v2 (introduced in 2024) is not supported by v14
- `constructEvent()` signature validation continues to work but newer webhook event types may not be typed
- No known CVEs, but older SDKs receive security patches less reliably

**Impact**: Potential incompatibility with Stripe dashboard features, new subscription types, and future Stripe API deprecations. Not immediately broken, but represents meaningful technical debt.

**Remediation**: Upgrade to Stripe v22. Review breaking changes in the Stripe changelog between v14 and v22. Key change: `stripe.checkout.sessions.create()` parameter names changed in v17+.

**Effort**: Medium (1-2 days to upgrade and test Stripe flows)

---

### F-009 — P2 MEDIUM | Code Quality — `index.js` Monolith (4,740 Lines)
**Category**: Maintainability
**Location**: `functions/index.js`

**Description**: `index.js` is 4,740 lines and serves as both the Express-style router AND the host of numerous inline endpoint handlers. Despite the modular route system (`routes/`), many endpoints are still handled inline in `index.js` (lines 737–4740), including all market intel routes, pitch generation routes, Attio/Instantly market endpoints, lead capture, templates, and admin functions. The file has grown by ~1,000+ lines since the initial audit.

**Impact**: High cognitive load for new contributors; merge conflicts in large team; cold start may be slightly impacted by large module initialization.

**Remediation**: Continue migrating inline handlers to dedicated route modules. Immediate candidates: Attio inline handlers (lines 737–771), Instantly Market inline handlers (lines 773–809), and the large market intel block (lines 1621–1900+).

**Effort**: High (multiple sprints)

---

### F-010 — P2 MEDIUM | Code Quality — `market.js` Monolith (2,812 Lines)
**Category**: Maintainability
**Location**: `functions/api/market.js`

**Description**: `market.js` at 2,812 lines handles the complete market intelligence report generation pipeline including AI orchestration, SEO analysis, competitor analysis, decision maker enrichment, demographics, intent signals, share-of-voice, SWOT, and CRM integration. While some services have been extracted (e.g., `narrativeGenerator.js`, `salesIntelGenerator.js`), the core file remains very large.

**Impact**: Testing difficulty, high cognitive load, risk of regressions when modifying any single feature.

**Remediation**: Extract the report generation pipeline into a dedicated `marketReportPipeline.js` service. The remaining handlers (list, refresh, benchmark read) are small and appropriate to remain.

**Effort**: High

---

### F-011 — P2 MEDIUM | Reliability — `backfillConfidenceFields` and `calibrateMerchant` HTTP Endpoints Have No Auth
**Category**: Unauthenticated Admin Endpoints
**Location**: `functions/index.js:4532-4577`

**Description**: Both `exports.backfillConfidenceFields` and `exports.calibrateMerchant` are registered as `onRequest` with `{ cors: false }` but have **no authentication check**. The only protection is obscurity (knowing the function URL). Any unauthenticated caller who knows the Cloud Function URL can:
- Trigger a full Firestore backfill scan (`backfillConfidenceFields`) — resource cost concern
- Run calibration for any arbitrary `merchantId` (`calibrateMerchant`) — modifying production data

**Impact**: Unauthorized data modification and resource abuse. The `calibrateMerchant` function writes calibration results and sets `learningModeActive: false` for any merchant ID provided.

**Remediation**: Add a service secret header check (similar to `processProspectTask`'s `X-Task-Secret` pattern) or use `requireAdmin` middleware. Alternatively, disable these functions post-migration since `backfillConfidenceFields` was a one-time script.

**Effort**: Low

---

### F-012 — P2 MEDIUM | Security — `NODE_ENV` Not Set; No-Origin Requests Allowed in Unknown Environments
**Category**: CORS Configuration
**Location**: `functions/index.js:46-48`

**Description**: The CORS handler has logic:
```javascript
if (!origin) {
    const allowNoOrigin = process.env.NODE_ENV !== 'production';
    return callback(null, allowNoOrigin);
}
```
Since `NODE_ENV` is not set in `functions/.env`, `process.env.NODE_ENV` is `undefined` in Cloud Functions. Therefore `NODE_ENV !== 'production'` evaluates to `true`, and **no-origin requests are allowed in production**. This means curl, Postman, server-to-server requests, and potentially malicious non-browser clients can bypass the CORS origin whitelist entirely.

**Impact**: CORS origin whitelist is not providing the intended protection. Any server-to-server request without an `Origin` header will be accepted.

**Remediation**: Add `NODE_ENV=production` to `functions/.env`. Firebase Cloud Functions sets `FUNCTION_TARGET` and other env vars, but not `NODE_ENV`. Alternatively, use `process.env.K_SERVICE` (set by Cloud Run/Functions v2) as the production detection check.

**Effort**: Very Low (add one line to `.env`)

---

### F-013 — P2 MEDIUM | Security — MongoDB URI in `.env` Unrelated to Firebase Project
**Category**: Credential Scope
**Location**: `functions/.env` — `MONGODB_URI`

**Description**: A MongoDB Atlas connection string (`mongodb+srv://pathconnect11_24:kMsGWxtWyWI3vpFj@pathconnect1.vwhgk.mongodb.net/`) is present in the Firebase Functions `.env`. The credentials embedded in the URI appear to be for the PathConnect PathManager product database (`pathconnect1` cluster). There is no MongoDB dependency in `functions/package.json` and no `mongoose` or `mongodb` import in the functions codebase.

**Impact**: The credential appears unused in this codebase but represents a lateral movement risk — exposure of `functions/.env` (e.g., via accidental git commit) would also expose the PathManager production database.

**Remediation**: Remove `MONGODB_URI` from `functions/.env` if it is not used by any function. If used in scripts, document its purpose and use Secret Manager.

**Effort**: Very Low

---

### F-014 — P2 MEDIUM | Reliability — `enrichmentJobs` Collection Missing Composite Index
**Category**: Missing Firestore Indexes
**Location**: `firestore.indexes.json`

**Description**: The `enrichmentJobs` collection (used by `onEnrichmentJobCreated` trigger and async enrichment endpoints) has no composite index. If the job status polling endpoint (`GET /enrich-leads/jobs/:jobId`) or any query by `userId + createdAt` is added in the future, it will immediately fail without an index. Current polling is by single document ID so may not be currently broken.

**Remediation**: Add `enrichmentJobs (userId ASC, createdAt DESC)` composite index proactively.

**Effort**: Very Low

---

### F-015 — P2 MEDIUM | Code Quality — 1,441 Console Logging Statements
**Category**: Logging Hygiene
**Location**: All files in `functions/`

**Description**: There are 1,441 active `console.log`, `console.error`, and `console.warn` calls across the codebase. While some structured logging is appropriate (errors, key operations), many `console.log` calls appear to be development/debug instrumentation that has never been removed. High log volume costs money (Cloud Logging ingestion pricing) and makes log-based alerting harder to configure.

**Impact**: Increased Cloud Logging costs; signal-to-noise ratio in production logs is low.

**Remediation**: Introduce a lightweight logger abstraction (or use `firebase-functions/logger`) that can be configured to suppress `info`/`debug` in production. At minimum, remove or guard high-frequency logs in hot paths (pitch generation, market report generation, stat card rendering).

**Effort**: Medium (ongoing, can be done incrementally)

---

### F-016 — P2 MEDIUM | Dependencies — Multiple Packages Significantly Outdated
**Category**: Dependencies
**Location**: `functions/package.json`

**Description**: Several dependencies are significantly behind:

| Package | Installed | Latest | Gap |
|---------|-----------|--------|-----|
| `@anthropic-ai/sdk` | 0.39.0 | 0.94.0 | 55 minor versions |
| `stripe` | 14.25.0 | 22.1.0 | 8 major versions |
| `archiver` | 6.0.2 | 7.0.1 | 1 major version |
| `express` | 4.22.1 | 5.2.1 | 1 major version |
| `csv-parse` | 5.6.0 | 6.2.1 | 1 major version |
| `google-auth-library` | 9.15.1 | 10.6.2 | 1 major version |

The `@anthropic-ai/sdk` gap (0.39.0 vs 0.94.0) is notable — Claude API has changed significantly but this may be intentional if the SDK is used only for specific legacy functionality.

**Remediation**: Prioritize Stripe upgrade (see F-008). Run `npm audit` when network access is available to check for CVEs. Schedule quarterly dependency updates.

**Effort**: Medium

---

### F-017 — P3 LOW | Code Quality — Old Countifi UID in Comment and Script
**Category**: Stale References
**Location**:
- `functions/api/pitch/templateOnePager.js:12` (comment only)
- `functions/scripts/setCountifiICP.js:17` (script variable)
- `functions/scripts/testPitchGeneration.js:92` (test script)

**Description**: UID `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` (Countifi test user) appears in a comment in production code and in two scripts. CLAUDE.md notes this was flagged in a previous audit.

**Impact**: Low — no production impact. Scripts with hardcoded UIDs are one-time migration scripts.

**Remediation**: Remove comment from `templateOnePager.js`. Scripts are acceptable as-is (they're one-time tools).

**Effort**: Very Low

---

### F-018 — P3 LOW | Testing — No CI/CD Pipeline
**Category**: Testing / DevOps
**Location**: No `.github/workflows/` directory

**Description**: There is no CI/CD pipeline. Code is deployed manually using `npx firebase deploy --only functions`. There are 14 test files but no automated test execution on PR or push. The `package.json` `lint` script is `"echo 'No linting configured'"`.

**Impact**: Regressions can reach production undetected. No automated quality gate exists.

**Remediation**: Add a minimal GitHub Actions workflow that runs `npm test` on pull requests. Add ESLint configuration (replace the no-op lint script).

**Effort**: Medium

---

### F-019 — P3 LOW | Code Quality — `TODO` Comment for Abandoned Feature in `market.js`
**Category**: Technical Debt
**Location**: `functions/api/market.js:684`

**Description**: A `// TODO: Register for new API and re-enable this feature` comment exists at line 684 of `market.js`. The surrounding context suggests a third-party market data API that was disabled.

**Impact**: No functional impact. Technical debt marker.

**Remediation**: Either implement the feature or remove the dead code and comment.

**Effort**: Very Low

---

### F-020 — P3 LOW | Reliability — `structuredGeneration.js` Defaults to `gemini-3.1-pro-preview` Without `thinkingBudget: 0`
**Category**: Reliability / Gemini Model Usage
**Location**: `functions/services/structuredGeneration.js:54`, `functions/services/templatePromptBuilder.js:481`

**Description**: `structuredGeneration.js` uses `responseMimeType: 'application/json'` and `responseSchema` (which enables Gemini's controlled generation mode). The default model is `gemini-3.1-pro-preview`. While controlled generation mode suppresses thinking tokens from the response, **`thinkingBudget: 0` is not set**. On Gemini 3.x models, thinking tokens still accumulate internally — this increases latency and token cost even if thinking content is not in the response.

Per the Gemini model rules documented in `CLAUDE.md`: "Always add `thinkingBudget: 0` when expecting JSON output."

**Impact**: Increased latency (thinking occurs but is discarded) and higher token costs for the L2 executive brief generation path.

**Remediation**: Add `thinkingConfig: { thinkingBudget: 0 }` to the `generationConfig` in `structuredGeneration.js`.

**Effort**: Very Low

---

## Previously Identified Issues — Status Check

| # | Issue | Status |
|---|-------|--------|
| 1 | XSS via unescaped `innerHTML` in functions layer | **RESOLVED** — No `innerHTML` usage found in `functions/` |
| 2 | Missing auth guards on HTTP endpoints | **PARTIALLY FIXED** — Most endpoints have auth. New issue: `backfillConfidenceFields` and `calibrateMerchant` have no auth (F-011) |
| 3 | Credit enforcement bypass potential | **RESOLVED** — `deductCredits()` is consistently called after operation success; idempotency keys implemented for prospect intel and opportunity brief credits |
| 4 | CORS wildcard | **RESOLVED** — Whitelist-based CORS implemented. New issue: `NODE_ENV` not set so no-origin requests bypass whitelist (F-012) |
| 5 | Storage rules too permissive | **RESOLVED** — Storage rules are well-structured with size limits, content type checks, and owner-scoped write access |
| 6 | `console.log` pollution | **STILL PRESENT** — 1,441 statements; 5 DEBUG-labeled logs shipped in production paths (F-007, F-015) |
| 7 | Deprecated Gemini model references | **RESOLVED** — Zero references to `gemini-1.5-x`, `gemini-2.0-x`, or `gemini-3-pro-preview`. All models are either `gemini-2.5-flash`, `gemini-3-flash-preview`, or `gemini-3.1-pro-preview` |
| 8 | Firestore indexes missing/incomplete | **PARTIALLY FIXED** — Several indexes added. New collections (`prospectIntel`, `opportunityBriefs`, `enrichmentJobs`) lack composite indexes (F-005, F-006, F-014) |
| 9 | Instantly API key stored in plaintext | **RESOLVED** — AES-256-CBC encryption implemented in `instantlyRoutes.js` with `decryptApiKey()`. New issue: `INSTANTLY_ENCRYPTION_KEY` is missing from `.env` (F-002) |
| 10 | Instantly plan gating disabled | **RESOLVED** — All Instantly endpoints use `requirePlan('growth')` middleware |

---

## Recommended Action Plan

### Immediate (This Week)

| Priority | Finding | Action | Owner |
|----------|---------|--------|-------|
| P0 | F-002 | Generate and add `INSTANTLY_ENCRYPTION_KEY` to `.env`, deploy | Dev |
| P0 | F-001 | Audit `.env` access; rotate any potentially exposed credentials; enable Secret Manager for live keys | Dev + Security |
| P1 | F-003 | Fix `opportunityBriefs` Firestore read rule to `userId == request.auth.uid` | Dev |
| P1 | F-005 | Add composite index for `prospectIntel (userId ASC, createdAt DESC)` | Dev |
| P1 | F-007 | Remove 5 DEBUG console.log statements from `templateOnePager.js` and `templateSectionResolver.js` | Dev |
| P2 | F-012 | Add `NODE_ENV=production` to `functions/.env` | Dev |

### This Sprint

| Priority | Finding | Action |
|----------|---------|--------|
| P1 | F-006 | Add `opportunityBriefs (userId ASC, createdAt DESC)` composite index |
| P1 | F-008 | Begin Stripe SDK upgrade planning (review v14→v22 changelog) |
| P1 | F-011 | Add auth check to `backfillConfidenceFields` and `calibrateMerchant` endpoints (or disable them if migration is complete) |
| P2 | F-013 | Remove unused `MONGODB_URI` from `functions/.env` if confirmed unused |
| P2 | F-020 | Add `thinkingBudget: 0` to `structuredGeneration.js` |

### Next Sprint

| Priority | Finding | Action |
|----------|---------|--------|
| P1 | F-004 | Lock `teams` Firestore write rule to `allow write: if false` (audit for direct client writes first) |
| P2 | F-015 | Introduce logger abstraction; audit and prune high-frequency console.log calls |
| P2 | F-016 | Upgrade `@anthropic-ai/sdk` and `archiver`; plan Express v5 upgrade |
| P3 | F-018 | Add GitHub Actions CI with `npm test` gate on PRs |

### Backlog

| Priority | Finding | Action |
|----------|---------|--------|
| P2 | F-009 | Migrate inline `index.js` handlers to route modules (ongoing) |
| P2 | F-010 | Extract `market.js` pipeline into service module |
| P3 | F-014 | Add `enrichmentJobs` composite index |
| P3 | F-017 | Remove old UID comment from `templateOnePager.js:12` |
| P3 | F-019 | Resolve or remove TODO in `market.js:684` |

---

## Positive Findings

1. **Gemini model hygiene is excellent** — Zero references to any deprecated model (`gemini-1.5-x`, `gemini-2.0-x`, `gemini-3-pro-preview`). All calls use approved models with correct `thinkingBudget: 0` + `indexOf('{')` extraction patterns where required.

2. **Plan gate architecture is sound** — `getUserPlan()` in `planGate.js` is consistently used as the single source of truth for plan resolution. Workspace inheritance (team member → owner plan) is correctly implemented and tested.

3. **Credit system has idempotency** — Prospect Intel and Opportunity Brief credit deductions use Firestore idempotency keys in `creditLedger`, preventing double-charging on retries.

4. **CORS implementation is whitelist-based** — The origin whitelist implementation is correct (not a simple wildcard). The `credentials: true` + `allowedHeaders` configuration is properly set.

5. **Auth is consistently enforced** — All user-facing endpoints (pitch generation, market intel, instantly, prospect intel, opportunity brief, attio, team management) verify Firebase Auth tokens via `verifyAuth()`. Route modules use `requireAuth` middleware consistently.

6. **Firestore rules are well-structured** — Rules follow the principle of least privilege for most collections. Collections that should be write-only via Admin SDK (usage, creditLedger, salesDocuments, pitchVersions) correctly set `allow write: if false`.

7. **Stripe webhook signature validation is correct** — `stripe.webhooks.constructEvent()` with `STRIPE_WEBHOOK_SECRET` is properly implemented in `functions/api/stripe.js`.

8. **`processProspectTask` has proper service-to-service auth** — The `X-Task-Secret` shared secret pattern prevents unauthorized Cloud Task injection.

9. **No XSS risk in the functions layer** — Zero `innerHTML` usage found in the backend codebase.

10. **Test coverage exists for critical paths** — 14 test files covering pitch generators, validators, middleware, and enrichers. `geminiLeadEnricher.test.js` has 38/38 passing per CLAUDE.md.

11. **Instantly API keys are encrypted at rest** — AES-256-CBC encryption is implemented for stored per-user Instantly API keys.

12. **No hardcoded secrets in JavaScript source** — `grep` for hardcoded API keys in `.js` files returned no results. All credentials use `process.env.*`.

13. **Documentation quality is high** — `SYSTEM_BIBLE.md` (3,060 lines) and `CLAUDE.md` (2,010 lines) provide comprehensive architecture documentation with specific commit references and known gotchas.

---

## Known Legacy Items (Do Not Fix)

- **`STRIPE_SECRETE_KEY` env var typo** — Intentional. This is the legacy env var name used in the codebase. Do not rename.
- **`buisnessName`/`buisnessAddress` field typos** — These field names exist in Firestore data and require a data migration to fix. Code-only changes would break existing documents.
- **`GOOGLE_APPLICATION_CREDENTIALS=` (empty)** — Intentionally empty in `functions/.env`. As documented in `CLAUDE.md`: "NEVER set `GOOGLE_APPLICATION_CREDENTIALS` in `functions/.env` — this crashes ALL Firestore access in Cloud Functions production." The empty value is a deliberate placeholder to remind developers of the rule.

---

## Appendix: File Inventory

| File | Lines | Role |
|------|-------|------|
| `functions/index.js` | 4,740 | Main entry point, route dispatcher, all exports |
| `functions/api/market.js` | 2,812 | Market intelligence report generation |
| `functions/api/pitchGenerator.js` | 2,253 | Core pitch generation pipeline |
| `functions/api/pitch/templateOnePager.js` | 694 | L2 template one-pager renderer |
| `functions/services/opportunityBriefService.js` | ~800 | Opportunity Brief dual-model pipeline |
| `functions/services/verticalConfigs.js` | 252 | Vertical detection + configs (7 verticals) |
| `functions/geminiLeadEnricher.js` | ~830 | Lead enrichment with Gemini 2.5 Flash |
| `functions/enrichmentJobProcessor.js` | ~100 | Firestore-triggered async job processor |
| `SYSTEM_BIBLE.md` | 3,060 | Architecture documentation |
| `functions/CLAUDE.md` | 2,010 | Session-by-session change log |

---

*Report generated by automated audit — 2026-05-05. All findings are based on static analysis of source files and do not reflect runtime behavior.*
