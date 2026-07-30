# Changelog — May 21, 2026

## Monolith Extraction Sessions 1–3 + Billing Consolidation

### Summary

`functions/index.js` reduced from **4,138 → 3,707 lines** (431 lines extracted) across 3 sessions. Four new modules created. Three divergent `deductCredits` implementations consolidated into one canonical `api/billing.js`.

---

### New Files

#### `functions/lib/shared.js` (84 lines)
Shared utilities extracted from `index.js`:
- `normalizePath(path)` — strips `/api/v1/` prefix for route matching
- `verifyAuth(req)` — Firebase ID token verification, sets `req.userId` / `req.userEmail` / `req.user.plan`
- `getCurrentPeriod()` — returns `YYYY-MM` string for usage tracking
- `db` — lazy Firestore Proxy (safe to import before `admin.initializeApp()` is called)
- `getDb()` — direct Firestore accessor

**Import rule:** Require after `admin.initializeApp()` in `index.js`.

#### `functions/services/pitchMetrics.js` (355 lines)
Pitch and usage helpers extracted from `index.js`:
- `ensureUserExists(userId, email, name)` — creates user doc on first sign-in
- `checkAndUpdateUsage(userId, userData)` — enforces monthly pitch limits per plan tier
- `incrementUsage(userId, pitchType)` — increments `pitchesThisMonth` + `totalPitches`
- `trackPitchView(pitchId)` — increments `views` on pitch doc
- `extractTriggerEventContent(url)` — Gemini 2.5 Flash extraction of trigger event from URL

Plan tier resolution priority: `subscription.plan → subscription.tier → plan → tier` (Stripe writes to `subscription.plan`; `userData.tier` is stale at signup).

#### `functions/api/prospectIntel.js` (120 lines)
Cloud Function registrations extracted from `index.js`:
- `exports.onProspectBatchCreated` — Firestore trigger (`prospectBatches/{batchId}`), fans out one Cloud Task per prospect
- `exports.processProspectTask` — Cloud Tasks HTTP handler, always returns HTTP 200 to prevent retry storms

#### `functions/api/billing.js` (104 lines)
Canonical credit system — replaces 3 divergent private implementations:
- `checkCredits(userId, required)` → `{ allowed: boolean, available: number }` — legacy accounts (no `credits` field) treated as unlimited
- `deductCredits(userId, amount, reason, options)` — decrements `users/{uid}.credits` + writes audit row to `creditLedger` collection (non-blocking)

**Dependency rule:** `api/billing.js` imports ONLY `firebase-admin`. All services import from `billing.js` — never the reverse.

---

### Modified Files

#### `functions/index.js`
- Added requires for `lib/shared`, `services/pitchMetrics`, `api/prospectIntel`
- Removed ~431 lines of inline implementations now covered by the 4 new modules
- Re-exports `onProspectBatchCreated` and `processProspectTask` from `api/prospectIntel`

#### `functions/services/templateEnrichment.js`
- Removed 43-line private `checkUserCredits` + `deductCredits` (used legacy `creditHistory.${Date.now()}` map)
- Now imports `checkCredits`, `deductCredits` from `../api/billing`

#### `functions/services/intentSignalService.js`
- Removed 18-line private `deductCredits` (wrote to `creditHistory` map, no ledger)
- Now imports `deductCredits` from `../api/billing`
- Call sites updated with `reason` + `service` tags for ledger traceability:
  - `deductCredits(merchantId, 150, 'intent_signals:fresh', { service: 'intent_signals' })`
  - `deductCredits(merchantId, 50, 'intent_signals:refresh', { service: 'intent_signals' })`

#### `functions/services/opportunityBriefService.js`
- Removed 22-line private `deductCredits` (wrote to `creditLedger` — same as canonical)
- Now imports `deductCredits` from `../api/billing`

#### `functions/routes/opportunityBriefRoutes.js`
- Removed 2 inline Firestore credit reads (direct `users/{uid}` doc reads)
- Now uses `checkCredits(req.userId, CREDIT_COST)` from `../api/billing`

---

### index.js Line Count

| Point | Lines |
|---|---|
| Pre-extraction baseline | 4,138 |
| After Session 1 (shared + pitchMetrics) | ~3,849 |
| After Session 2 (prospectIntel) | ~3,740 |
| After Session 3 (billing) | **3,707** |

---

### Security Action Item (Pending)

Google KG API key `[REVOKED-2026-07-30]` found exposed in a PathManager commit. Required steps:
1. Revoke key in GCP Console → APIs & Services → Credentials
2. Create a new restricted key (restrict to Knowledge Graph Search API + PathManager EC2 IP)
3. Add new key to PathManager EC2 `.env` as `GOOGLE_KG_API_KEY`

---

### Remaining Extraction Targets (future sessions)

| Block | Est. lines | Candidate module |
|---|---|---|
| Stripe webhook handler | ~180 | `api/stripeWebhook.js` |
| Template enrichment route | ~80 | `routes/templateEnrichment.js` |
| Pitch route handler | ~60 | `routes/pitch.js` |
| Admin bootstrap route | ~40 | `routes/admin.js` |
