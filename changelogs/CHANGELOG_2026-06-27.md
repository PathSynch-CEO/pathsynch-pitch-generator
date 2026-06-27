# Changelog — June 27, 2026

## Session Type: Production Fixes + Comprehensive Health Audit

**Branch:** `feature/phase3c-offboarding-share-cutover`
**Key commit:** `afe5a71` (billing fix — squash-merged to `origin/main` as `69d3dd8` via PR #39)
**Health audit score:** 52/100

---

## Production Fix 1 — Gemini API Key Restriction (GCP Console)

**Symptom:** Daniyal hit "Gemini API authentication failed. Check your API key" on onboarding website-analysis (`functions/api/onboarding.js:197` → `geminiClient.generateJSON()`).

**Root cause:** The `GEMINI_API_KEY` (project `pathsynch-pitch-creation`, bound to service account `pathsynch-pitch-creation@appspot.gserviceaccount.com`) had Application restriction = IP addresses. Cloud Functions egress IPs are dynamic → calls failed auth. Same family as the June 19 API key restriction sweep.

**Fix (GCP Console, no code):** Set Application restrictions to **None**. Kept API restriction = Gemini API only + the service-account binding. This is the "authorization key" model — satisfies Google's "restrict your keys" requirement via API restriction + SA binding. Application restriction = None is acceptable for server-side keys.

**Verification:** Market report generation (which calls Gemini) succeeded after the change.

**Lesson:** The June 19 API key restriction sweep applied IP restrictions to ALL keys in the project. Server-side keys used by Cloud Functions must NOT have IP restrictions — Cloud Functions egress IPs are dynamic and unpredictable. The correct pattern for server-side keys: API restriction (which API) + SA binding (which identity) — NOT application restriction (which IP/referrer).

---

## Production Fix 2 — Billing Gate `-1`/Unlimited Bug (Code + Deploy)

**Commit:** `afe5a71` — `fix(billing): treat marketReportsPerMonth -1 as unlimited in hasFeature + isWithinLimits`

**Symptom:** Enterprise account blocked from generating market reports.

**Debugging lesson:** Initial data hypotheses were BOTH WRONG:
- Hypothesis A: `subscription.plan='scale'` winning the priority chain → WRONG, all 4 plan fields = enterprise
- Hypothesis B: `marketReportsThisMonth` counter = 22 → WRONG, that was May's counter; June counter = 1

Reading actual Firestore production values showed the real issue.

**Real bug:** `hasFeature('enterprise', 'marketReports')` in `functions/config/stripe.js` checked `marketReportsPerMonth > 0`. Enterprise plan defines `marketReportsPerMonth: -1` (unlimited). `-1 > 0` evaluates to `false` → enterprise users wrongly gated out entirely. Same `-1` mishandling in `isWithinLimits` at line 290.

**Fix (2 lines in `functions/config/stripe.js`):**
- `hasFeature` line 257: `return limits.marketReportsPerMonth > 0 || limits.marketReportsPerMonth === -1;`
- `isWithinLimits` line 290: `return limits.marketReportsPerMonth === -1 || currentUsage < limits.marketReportsPerMonth;`

Mirrors existing correct `-1` handling for `pitchesPerMonth`.

**Deployed:** 15 functions to production. Committed `afe5a71`, pushed to `feature/phase3c-offboarding-share-cutover`. PR #39 squash-merged to `origin/main` as `69d3dd8` on June 26.

**NOTE:** Zero test coverage on `hasFeature`/`isWithinLimits`. That's how this `-1` bug survived to production.

---

## Live-Rules Verification — Onepager Leak CLOSED

Verified the **DEPLOYED** `firestore.rules` in Firebase Console (active deploy "Yesterday 3:02 PM"):

| Check | Result |
|-------|--------|
| Onepagers rule | `allow read: if request.auth != null && resource.data.userId == request.auth.uid` — **SAFE** |
| Leaky `shareId != null` rule | **NOT in deployed rules** |
| Pitches rule | Phase 3C comment present, no `shared==true` public read — **SAFE** |

**Status change:** Onepagers leak downgraded from **P0 OPEN** → **RESOLVED in production**.

**Remaining risk (not a live leak):** `synchintro-app/firestore.rules` still CONTAINS the leaky `shareId != null` rule (~line 215). Both repos deploy to the same project. A future rules deploy from `synchintro-app` would silently RE-OPEN the leak.

**Carry-forward fix:** Delete the leaky rule from `synchintro-app/firestore.rules` and enforce that `synchintro-app` only ever deploys `--only hosting`. Canonical rules source = `pathsynch-pitch-generator`.

---

## Git/Deploy State — Reconciliation Update

| Item | Status |
|------|--------|
| PR #39 (`feature/phase3c-offboarding-share-cutover`) | **MERGED** — squash-merged to `origin/main` as `69d3dd8` on June 26 |
| PR #38 (`feature/workspace-firestore-rules`) | **OPEN** — 2 unmerged commits (`44b8260`, `68cb446`): workspace Firestore rules |
| Local `main` | **12 commits behind `origin/main`** — must `git pull` before any deploy |
| Commit `afe5a71` (billing fix) | Content is on `origin/main` via squash merge |

**Deploy risk:** Deploying from local `main` would regress: onepager share endpoint, billing `-1` fix, workspace Phases 1-3C, market report soft-delete.

---

## SynchIntro Health Audit — Score: 52/100

Full read-only health audit across backend (`functions/`), `firestore.rules`, and frontend (`synchintro-app`).

### P0 Findings

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| 1 | **Onepager leak** — CLOSED in deployed rules; synchintro-app still has leaky rule | `synchintro-app/firestore.rules:215` | RESOLVED (prod), carry-forward (synchintro-app cleanup) |
| 2 | **getUserPlan() bypasses** — 14 route handlers read plan fields directly; 5 use `userData.tier \|\| 'starter'` ignoring Stripe entirely → paying users treated as starter | `precallFormRoutes.js:23`, `transcriptRoutes.js:142,216`, `onboarding.js:1102`, `investorRoutes.js:30`, `landingPageRoutes.js:53`, `precallBriefRoutes.js:148`, `sellerProfileRoutes.js:97,222`, `visitorRoutes.js:71-74`, `index.js:250-254` | OPEN |
| 3 | **Secure Token API 403** — `securetoken.googleapis.com` "granttoken-are-blocked"; browser ID token refresh broken, users silently logged out | GCP Console API key restrictions | OPEN |
| 4 | **Secrets in plaintext `.env`** — 30+ secrets incl. live `STRIPE_SECRET_KEY`, `GCP_SERVICE_ACCOUNT_KEY` (full private key), `MONGODB_URI` w/ creds, `INSTANTLY_ENCRYPTION_KEY` | `functions/.env` (gitignored, never committed) | OPEN |
| 5 | **Billing gates zero test coverage** — `hasFeature()` + `isWithinLimits()` at `FNDA:0` | `functions/config/stripe.js:247-294` | OPEN |
| 6 | **Local main stale** — 12 commits behind `origin/main`; deploy from local main would regress P0 fixes | git state | OPEN |

### P1 Findings

| # | Finding | File:Line |
|---|---------|-----------|
| 7 | Unauthenticated analytics-field write on pitches + onepagers (OR clause lacks `isAuthenticated()`) | `firestore.rules:67-69`, `270-272` |
| 8 | `cors: true` at Firebase framework level bypasses custom CORS whitelist for preflight | `functions/index.js:210` |
| 9 | 3 latent `-1` bugs in `bulkUploadRows` (same class as fixed marketReports bug) | `stripe.js:255,288`, `bulk.js:87` |
| 10 | No ESLint — lint predeploy = `echo 'No linting configured'` (no-op) | `functions/package.json:10` |
| 11 | Coverage not enforced in CI — `test:ci` never invoked by `.github/workflows/ci.yml` | CI config |
| 12 | 33 npm vulnerabilities (4 high: `@grpc/grpc-js`, `form-data`) | `functions/package-lock.json` |
| 13 | PR #38 (workspace Firestore rules) still OPEN with 2 unmerged commits | git |
| 14 | Duplicate `PM_GAUTH_CLIENT_SECRET` in `.env` (lines 90, 112 — different values, second wins) | `functions/.env` |

### P2/P3 Findings

| # | Finding | File:Line |
|---|---------|-----------|
| 15 | `pitchAnalytics` events/shareEvents cross-tenant write | `firestore.rules:131-138` |
| 16 | `workspaceAuditLog` + `workspaceBrandingVersions` readable by any auth user | `firestore.rules:728-731` |
| 17 | Prompt injection surface (user input → Gemini → HTML stored) | `api/pitchGenerator.js` |
| 18 | `@anthropic-ai/sdk` 67 versions behind (0.39.0 vs 0.106.0) | `functions/package.json` |
| 19 | 1,027 lines dead code (3 orphaned files) | `competitiveLandscapeService.js`, `enrichmentWaterfall.js`, `opportunityScoreEngine.js` |
| 20 | `index.js` monolith 3,825 lines | `functions/index.js` |
| 21 | No structured logging (raw `console.log` — 250+ calls) | throughout |
| 22 | Stale TODO in `stripe.js:6` — "Stripe at v14, needs upgrade to v22" (already at v22.1.1) | `api/stripe.js:6` |

---

## Carry-Forward Open Items (Next Session)

| # | Item | Severity |
|---|------|----------|
| 1 | Fix the 14 `getUserPlan()` bypasses (paying users blocked on 5+ endpoints) | P0 |
| 2 | Browser key (`...zDJY`): add Token Service + Identity Toolkit APIs in GCP; confirm 3 APIs enabled at project level | P0 |
| 3 | Delete leaky `shareId != null` rule from `synchintro-app/firestore.rules`; enforce `--only hosting` from that repo | P1 |
| 4 | `git checkout main && git pull` (local main 12 behind); reconcile/close PR #38 | P0 |
| 5 | Add billing-gate tests (`hasFeature`/`isWithinLimits`, `-1` cases); fix the 3 `bulkUploadRows` `-1` bugs | P0/P1 |
| 6 | Secret Manager migration (top-5 secrets) — deliberate, scheduled (don't panic-rotate live Stripe key) | P1 |
| 7 | ESLint + real predeploy hook; wire `test:ci` for coverage; `npm audit fix` the 4 highs | P1 |
| 8 | Daniyal full-access confirm once accepted (`workspaceMembers` doc + sees Charles's context); brief Williams on solo deploys | P1 |
