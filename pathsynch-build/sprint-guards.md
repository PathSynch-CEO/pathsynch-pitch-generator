# Sprint 1 — Countifi Hardening + CI/CD
# SynchIntro-Specific Guards

These guards are NON-NEGOTIABLE for this sprint. Violating any of them is a blocking error.

---

## Universal Guards (apply to all stories)

### Never Modify What Isn't in Scope
- Read the story's `expected_files_changed` list. If you're touching a file not on that list, stop and re-check scope.
- S3/S6/S7/S8/S13 are small loop stories — they should change 1-2 files each. If you're touching 5+ files, something is wrong.

### Test Gate
- **All 882 tests must pass before and after every change.** Run: `cd functions && npm test`
- Never commit if tests are failing — fix the root cause.
- If you add a new test, it must pass too.

### Syntax Gate
- After writing or modifying any JS file: `node -c <filename>` before declaring done.

### Deploy Gate (for stories that require deploy)
- Credentials expire frequently. Run `npx firebase login --reauth` in an interactive terminal if deploy fails with auth error.
- Never use `&&` chaining in PowerShell deploy commands.

---

## Pitch Generation Guards (S1, S2, S10)

### Gemini Model Rules — CRITICAL
- PRIMARY: `gemini-3-flash-preview` (fast tasks, pitch gen, simple agents)
- ADVANCED: `gemini-3.1-pro-preview` (complex reasoning, L3 generation)
- SIMPLE: `gemini-2.5-flash` (email, SVG, question generation)
- **NEVER use**: `gemini-1.5-x`, `gemini-2.0-x`, `gemini-3-pro-preview` (dead or shut down)
- When in doubt: `gemini-3-flash-preview`

### Gemini JSON Output Rules — CRITICAL
- Gemini 3.x thinks before outputting. Always add `thinkingBudget: 0` when expecting JSON.
- Always extract JSON with `indexOf('{')` / `lastIndexOf('}')` — NOT by stripping markdown fences alone.
- Always use `generateContent({ contents: [...] })` object form — NEVER pass an array directly (causes 400 Bad Request with role in wrong location).

### generateLibraryEnhancedContent() Guard (S1)
- This function has TWO guard returns at lines 72 and 95. Both must be checked when adding new paths.
- If it returns null → do not mask with a silent fallback. Investigate why it's returning null first.
- `isL4 = options.pitchLevel === 4 && useCustomLibrary` — if `useCustomLibrary` is false, L4 silently falls back to L2. This is the known bug to fix.

### generatePitchDirect() Must Stay in Sync (S1)
- `generatePitchDirect()` is the bulk upload path. Any fix to `generatePitch()` case 4 must be applied to `generatePitchDirect()` case 4 as well.
- This has been the source of past bugs — do not forget it.

### Do Not Touch Other Pitch Levels (S1)
- L1 (case 1), L2 (case 2), L3 (case 3) handlers must not be modified while fixing L4.
- Run L1, L2, L3 test pitch generations as regression check.

---

## Billing Guards (all stories)

### Single Source of Truth for Credits
- `api/billing.js` is the ONLY place credits are checked and deducted.
- **NEVER** add inline credit deduction in a new route handler.
- Use `checkCredits(userId, amount)` → check result → then `deductCredits(userId, amount, reason)` or `checkAndDeductCredits(userId, amount, reason)` (atomic, preferred).
- Routes must return **503** (not 402) on `BILLING_TRANSACTION_FAILED`.

### Do Not Duplicate Credit Logic
- There must be zero instances of inline Firestore reads to `users/{uid}.credits` in route handlers.
- The three previous duplicate deductCredits implementations (in templateEnrichment.js, intentSignalService.js, opportunityBriefService.js) were already removed. Do not reintroduce them.

---

## Plan Resolution Guard (all stories)

### getUserPlan() is the ONLY Plan Source
- `functions/middleware/planGate.js` → `getUserPlan()` is the single source of truth for plan.
- **NEVER** read `user.plan` or `user.tier` directly in route handlers.
- Priority chain: `subscription.plan` MUST come before `userData.tier` everywhere.
- `userData.tier` is set to 'FREE' at account creation and never updated by Stripe — always stale.

---

## Firestore Rules Guards (S8)

### pitchAnalytics Rule Warning
- April 16 CLAUDE.md note: `allow read: if isAuthenticated()` was a deliberate fix because pitchAnalytics docs are written by public track-view endpoint via Admin SDK with no userId field.
- Before tightening pitchAnalytics to userId scope — verify that userId is actually written on these docs. If not, the analytics tab will break for all users.
- Document the finding. If userId is not on the docs, the fix requires adding userId to the write path first.

### Admin SDK Bypasses Rules
- The 5 collections with no rules (aisynchSubscriptions, aiReadinessRateLimits, etc.) are written exclusively via Admin SDK in Cloud Functions. `allow read, write: if false` is safe and correct — Admin SDK bypasses rules entirely.

### Deploy Rules Separately
- `npx firebase deploy --only firestore:rules --project pathsynch-pitch-creation`
- Do NOT bundle rules deploy with functions deploy — rules have their own lifecycle.

---

## Instantly Integration Guard (all stories)

### Two Separate Integrations — Do NOT Merge
- `instantlyService.js` — per-user API keys, `/instantly/*` routes (for pre-call brief, prospect outreach)
- `instantlyClient.js` — global `INSTANTLY_API_KEY`, `/instantly-market/*` routes (for Market Intel lead push)
- These must remain completely separate. V2 (per-user) vs V1 (global market intel).

### Payload Field Names
- Per-user push (`instantlyService.js`): uses `campaign` (NOT `campaign_id`)
- Global push (`instantlyClient.js`): uses `campaign_id` for list operations, `campaign` for push — verify before touching

---

## NemoClaw Route Guard (S0)

### Do NOT Modify the Service Function
- `sendProspectsToNemoClaw()` in `prospectIntelService.js` is complete and tested.
- The ONLY change is adding the HTTP route handler in `prospectIntelRoutes.js`.
- If the service function has a bug, document it as a separate finding — do not fix it in S0.

### Auth Pattern
- All routes in `prospectIntelRoutes.js` use `requireAuth` middleware. The new route must use it too.
- `req.user.sub` is the userId from the JWT (pattern used throughout the file).

---

## DataForSEO Guard (S6)

### Do NOT Touch Other DataForSEO Endpoints
- `dataForSEOClient.js` has multiple endpoints (SERP, Maps, Lighthouse, GBP completeness, reviews).
- Only modify the reviews endpoint: `/business_data/google/reviews/live/advanced`
- All other endpoint paths must remain exactly as-is.

---

## Cron Schedule Guard (S7)

### One-Line Change Only
- `index.js` line 3679: `onSchedule('every 5 minutes', ...)` → `onSchedule('every 6 hours', ...)`
- Do NOT change the alert processing logic inside the function.
- Do NOT change other scheduled functions.

---

## Dependency Upgrade Guard (S12)

### Stripe v14 → v22 — Test Before Merging
- This is a major version jump. Stripe has breaking API changes between major versions.
- **Required test**: After upgrade, test checkout flow and webhook handler.
- Files to verify: `functions/api/stripe.js`, `functions/services/aisynchBilling.js`
- If Stripe upgrade breaks tests and you cannot fix quickly — revert and document as a separate story.

### html2pdf.js — Defer if Not Staged
- `html2pdf.js` upgrade to `0.14.0` is semver-major.
- If PDF export cannot be tested end-to-end in staging → skip this upgrade and document it.
- Do NOT apply it speculatively.

---

## shared.js Import Order Guard (all backend stories)

### lib/shared.js Must Be Required After admin.initializeApp()
- `lib/shared.js` uses a lazy Proxy for `db` — requires Firebase Admin to be initialized first.
- In `index.js`, the `require('../lib/shared')` must appear AFTER `admin.initializeApp()`.
- Any new file that imports from `lib/shared.js` must guarantee Admin is initialized before the first db access.

---

## Frontend Guard (S4, S5)

### No Backend Changes in Frontend Stories
- S4 (popup sizing) and S5 (URL prefill) are frontend-only.
- Do NOT modify any Cloud Functions, routes, or services.
- If the root cause appears to be a missing field in the API response → document it as a separate backend story instead of changing backend in scope.

---

## What "Done" Means

A story is DONE when:
1. All acceptance criteria are met
2. `node --check` passes on all modified JS files
3. `npm test` shows 882+ passing, 0 failing
4. The change is committed to a branch
5. For backend changes: `firebase deploy --only functions` succeeds
6. For rules changes: `firebase deploy --only firestore:rules` succeeds
7. For S10 (smoke test): Charles has visually verified each pitch level
