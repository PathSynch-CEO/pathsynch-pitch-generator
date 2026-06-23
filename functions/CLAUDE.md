## Phase 2 Completion Record — June 22-23, 2026 (Workspace Inheritance + Branding Version History)

### Scope Note — Market Report Workspace Scoping

Market-report `workspaceId` and `createdByUid` stamping was implemented in Phase 2 (not deferred to Phase 3B) because the `workspaceResolver` middleware runs before market intel routes, meaning workspace members can already generate Market Intel reports with `req.workspaceId` set on the request object.

Both fields are now stamped at write time in `functions/api/market.js` on every new report and every refresh. This ensures no Market Intel report generated in workspace context will have absent/null `workspaceId`.

**Remaining Phase 3B obligation:** Phase 3B must implement strict `workspaceId` scoping at read/analytics time (workspace-scoped `listReports` query, contributor-only-own vs manager/admin-sees-all) in the same PR. No Market Intel report with absent/null `workspaceId` may be returned through a workspace-scoped query. Legacy reports (pre-workspace, null `workspaceId`) are excluded by Firestore equality filter — same guarantee proven by the Phase 1 + Phase 2 emulator tests against `pitches`.

### Emulator Verification Results

**Emulator command:** `npx firebase emulators:start --only firestore`

**Test command:** `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase2.emulator.test.js --no-coverage --forceExit`

**Result: 26/26 PASS** (post-B2 fix — June 23, 2026)

#### Section A — Cache Isolation (12 tests)

All tests run the real `resolveBrand()` and `getUserPlan()` against emulator-backed Firestore, with the production module-level cache active in the same Node process. No mocked Firestore reads.

| Test | Status |
|------|--------|
| Call order 1 (solo→workspace): member personal brand resolves correctly | PASS |
| Call order 1: workspace resolve returns OWNER branding, not cached member brand | PASS |
| Call order 1: re-resolving solo returns member personal brand | PASS |
| Call order 2 (workspace→solo): workspace resolve returns OWNER branding first | PASS |
| Call order 2: solo resolve returns MEMBER personal brand, not cached owner brand | PASS |
| Call order 2: re-resolving workspace returns owner branding | PASS |
| getUserPlan: member own plan = starter | PASS |
| getUserPlan: member plan with workspaceId = owner scale | PASS |
| getUserPlan: solo→workspace order, no leak | PASS |
| getUserPlan: workspace→solo order, no leak | PASS |
| Cache key distinctness: solo key ≠ workspace key | PASS |
| invalidateCache(uid) only clears targeted key | PASS |

Cache key implementation: solo = `brandOwnerId` (e.g., `emul_member1`), workspace = `${brandOwnerId}:ws:${workspaceId}` (e.g., `emul_owner1:ws:ws_phase2_emul`). The `:ws:` infix and different brandOwnerId make collision structurally impossible.

#### Section B — Client-Write Bypass / Gate #7 (14 tests — B2 bypass CLOSED)

All tests run against the real Firestore emulator with the actual production `firestore.rules` loaded.

| Test | Status | What it proves |
|------|--------|----------------|
| B1: contributor cannot update owner's agencyBrandOverrides | PASS | Non-admin workspace member blocked from mutating solo branding source |
| B1: contributor cannot create owner's agencyBrandOverrides | PASS | Same — create path also blocked |
| B2: admin direct write to agencyBrandOverrides does NOT create branding version | PASS | Direct client write to agencyBrandOverrides produces zero version/audit records |
| B2: client cannot write to workspaceBrandingVersions | PASS | write:false — only Admin SDK can create version records |
| B2: client cannot write to workspaceAuditLog | PASS | write:false — only Admin SDK can create audit records |
| B2a: contributor cannot write to workspaceBranding/{wsId} | PASS | write:false blocks contributor |
| B2b: owner cannot write to workspaceBranding/{wsId} | PASS | write:false blocks ALL clients including owner |
| B2c: Admin SDK updates workspaceBranding + version + audit atomically | PASS | Server handler path works end-to-end |
| B2d: cache invalidates immediately after authorized update | PASS | Re-resolve reflects new brand after invalidation |
| B2e: owner direct write to agencyBrandOverrides does NOT change workspace branding | PASS | **B2 bypass CLOSED** — resolveBrand reads from workspaceBranding/{wsId} in workspace context |
| B3: Admin SDK creates branding version + audit record | PASS | Server-side (Admin SDK) write path works |
| B4: solo user can update own agencyBrandOverrides | PASS | Existing solo-user branding behavior unchanged |
| B4: solo user can create own agencyBrandOverrides | PASS | Solo create path preserved |
| B4: solo user cannot set planTier/featureFlags | PASS | Server-controlled fields remain blocked by rules |

**B2 bypass fix architecture:**
- `workspaceBranding/{workspaceId}` — new server-only collection (`allow write: if false`). `resolveBrand()` reads from this in workspace context.
- `agencyBrandOverrides/{uid}` — unchanged, client-writable for solo branding. NOT read by `resolveBrand()` in workspace context.
- PUT /workspace/branding handler writes to `workspaceBranding/{wsId}` via Admin SDK + creates version + writes audit.

### Changed Files (Phase 2 — complete list)

| File | Action | Purpose |
|------|--------|---------|
| `functions/services/brandResolver.js` | Modified | `resolveBrand(userId, options={})` — workspace inheritance + cache key isolation |
| `functions/middleware/planGate.js` | Modified | `getUserPlan(userId, options={})` — workspace plan inheritance |
| `functions/api/pitchGenerator.js` | Modified | Workspace brand resolution + pitch field stamping |
| `functions/api/market.js` | Modified | `workspaceId` + `createdByUid` stamped on market reports |
| `functions/index.js` | Modified | `workspaceRoutes` import + `/workspace` dispatch |
| `functions/services/workspaceBrandingService.js` | New | Append-only immutable branding version history |
| `functions/services/workspaceAuditService.js` | New | Fire-and-forget audit logging |
| `functions/routes/workspaceRoutes.js` | New | PUT/GET branding, GET history endpoints |
| `functions/tests/workspacePhase2.test.js` | New | 17 mock-based gate tests |
| `functions/tests/workspacePhase2.emulator.test.js` | New | 26 emulator-backed tenancy tests (12 cache + 14 Gate #7) |
| `firestore.rules` | Modified | Added workspaceBranding, workspaceBrandingVersions, workspaceAuditLog, workspaceMembers rules |

### Test Results Summary (post-B2 fix — June 23, 2026)

| Suite | Tests | Status |
|-------|-------|--------|
| Phase 2 mock gates (workspacePhase2.test.js) | 17/17 | PASS |
| Phase 2 emulator (workspacePhase2.emulator.test.js) | 26/26 | PASS — B2 bypass closed |
| Phase 1 mock (workspaceService.test.js) | 27/27 | PASS |
| Phase 1 resolver (workspaceResolver.test.js) | 7/7 | PASS |
| Phase 1 emulator (workspace.emulator.test.js) | 16/16 | PASS — discrepancy resolved |
| Full mock suite (excl. emulator) | 1661/1661 | PASS — zero regressions |

---

## Session — June 8, 2026 (Security Audit Response — F-001, F-013, F-004, F-005)

**Security-focused session driven by SYNCHINTRO_AUDIT_REPORT_2026-06-08.md (80/100, grade B, 41 findings: 1 P0, 7 P1, 24 P2, 9 P3).**

### Audit Report

- **File:** `SYNCHINTRO_AUDIT_REPORT_2026-06-08.md` at repo root (~51KB, 41 findings)
- **Companion:** `AUDIT_TREE.txt` (478 lines) at repo root
- **Both files currently untracked** — recommend committing in a follow-up docs commit to survive any local tree reset

### Shipment 1 — F-001: Firebase Service Account Key Removal

- Deleted `functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json` from local disk
- Key was **never committed to git** (confirmed via `git log --all --full-history` — empty)
- No code in repo references the key file (confirmed via `git grep` — clean)
- **GCP Console key rotation deferred** — Charles to complete EOD June 8 or first thing June 9
- **Status:** P0 closed at repo level; GCP Console rotation pending

### Shipment 2 — F-013: npm Audit Fix (PR #17, merged)

- **Branch:** `fix/npm-audit-axios-june8`
- axios critical vulnerability was already resolved in main before this session — `npm audit` confirmed zero axios issues
- Ran `npm audit fix` in `functions/` — transitive lockfile cleanup, no `package.json` changes
- Remaining 9 moderate findings are transitive via `uuid` inside firebase-admin/gaxios/google-gax — **not exploitable** in our code path (uuid buf-bounds bug only triggers when caller passes custom buffer; Firebase Admin internals do not)
- **Commit:** `df2f8d6` — "fix(deps): npm audit fix — transitive cleanup (F-001 follow-up)"
- **PR #17 merged to main, NOT YET DEPLOYED to production**

### Shipment 3 — F-004 + F-005: Firestore Rules Tightening (PR #18, open for Williams review)

- **Branch:** `fix/firestore-rules-f004-f005`
- **F-004 (`pitchAnalytics/{pitchId}`):** `allow create, update` now requires:
  ```
  get(/databases/$(database)/documents/pitches/$(pitchId)).data.userId
    == request.auth.uid
  ```
  Prevents cross-tenant analytics manipulation. Schema confirmed: `/pitches/{pitchId}` canonical path verified at `firestore.rules` lines 52-75. `get()` without `exists()` matches existing `prospectIntel` subcollection pattern (lines 482-490).
- **F-005 (`icpProfiles/{profileId}`):** Removed `isDefault == true` client-create bypass. Default profiles are now Admin SDK / Cloud Function only. Client creates require `userId` ownership match only.
- **Validation:** `firebase deploy --only firestore:rules --dry-run` PASSED (rules compiled successfully)
- **Commit:** `48bb869`
- **PR #18 open for Williams review — NOT YET MERGED, NOT YET DEPLOYED**

### Adjacent Flags Surfaced (Scope-Fenced — Intentionally Not Fixed)

- **`pitchAnalytics` events/shareEvents subcollections (lines 128-138):** `allow create: if isAuthenticated()` — same class of cross-tenant write bug as F-004, on subcollection. Should be added as a new audit finding.
- **`pitchAnalytics` allow read:** `if isAuthenticated()` — any logged-in user can read view/click counters for any pitch. Privacy nit, not a security flaw. Deferred.

### Process Notes

- **PR #17 self-merge by Charles** — acceptable: lockfile-only, covered under Build OS/infrastructure Option B invariant (Charles may self-merge infrastructure/deps/docs PRs)
- **PR #18** — routes through Williams per the Option B PR review invariant. Firestore rule changes, function code changes, and any change with production blast radius must be reviewed by Williams before merge. This is the correct path.
- **Going forward:** Production Firestore security rule changes MUST be routed to Williams before merge. No exceptions.

### Remaining P0/P1 Backlog (priority order, Williams's domain)

1. **F-018:** Upgrade `html2pdf.js` to 0.14.0 after PDF export regression test (high-severity XSS, ~3 weeks open)
2. **F-003:** Move Stripe live key from `.env` to Firebase Secret Manager
3. **F-006:** Add SpyFu password to `.env.example` as documented override
4. **F-021:** Migrate `opportunityBriefService.js` structured generation to `generateStructured()`
5. **F-022:** Migrate `market.js` enhancement call from `indexOf('{')` to `generateStructured()`

### Deployment Status

- `functions/` lockfile cleanup (PR #17) — merged to main, **NOT YET DEPLOYED**
- `firestore.rules` tightening (PR #18) — open for Williams review, **NOT YET MERGED, NOT YET DEPLOYED**

---

## Session — May 25, 2026 (Sprint 1 Completion — Countifi Hardening + CI/CD)

**Sprint 1 complete. All 14 stories closed. 882 tests passing, 0 failing.**

### Stories Completed This Session (S2–S13)

S2, S3, S4 were closed in the previous context window. This session closed S5–S13.

| Story | Fix | Files |
|-------|-----|-------|
| S4 | One-pager popup sizing — `display:none/block` → `visibility:hidden/visible` on iframe during load | `synchintro-app/js/pitchViewer.js` |
| S5 | Website URL auto-populate from market intel lead — reads `selectedLeadWebsite` from `marketIntelRef` sessionStorage | `synchintro-app/js/pages/create.js` |
| S6 | DataForSEO reviews endpoint 404 — removed `/advanced` suffix (not valid for business_data API) | `functions/services/dataForSEOClient.js` |
| S7 | processThresholdAlerts cron — corrected from `'every 5 minutes'` to `'every 6 hours'` | `functions/index.js` |
| S8 | Firestore rules hardening — tightened `pitchVersions` (owner-scoped), `teamInvitations` (owner+invitee), `icpProfiles` update (removed isDefault branch); added 5 explicit deny rules for Cloud-Functions-only collections | `firestore.rules` |
| S9 | Census API key — already present in `.env`; no code change needed | — |
| S11 | CI/CD hardening — added `concurrency` (cancel-in-progress duplicates), `permissions: contents: read`, `timeout-minutes` to both jobs; fixed `@v5` → `@v4` for checkout/setup-node/upload-artifact in audit workflow | `.github/workflows/ci.yml`, `.github/workflows/weekday-health-audit.yml` |
| S12 | npm audit fix + Stripe v14 → v22 upgrade | `functions/package.json`, `functions/package-lock.json` |
| S13 | Created `.env.example` with all 70+ env vars documented by category | `functions/.env.example` |

### Key Architecture Notes Added

**DataForSEO reviews endpoint:** Correct endpoint is `/business_data/google/reviews/live` (NOT `/live/advanced`). The `/advanced` suffix applies to SERP endpoints only (`/serp/google/organic/live/advanced`). The business_data API does not use `/advanced`.

**Firestore `pitchVersions` rule:** Now owner-scoped: `resource.data.userId == request.auth.uid`. Was incorrectly `isAuthenticated()` — any user could read any pitch version.

**Firestore `teamInvitations` rule:** Now scoped to: `resource.data.teamOwnerUid == request.auth.uid || resource.data.inviteeEmail == request.auth.token.email`.

**Firestore `icpProfiles` update rule:** Removed `resource.data.isDefault == true` branch — any auth'd user could vandalize shared default profiles. Default profiles now managed via Admin SDK only.

**processThresholdAlerts schedule:** Was incorrectly `'every 5 minutes'` (cost overrun risk). Corrected to `'every 6 hours'` (matches CLAUDE.md spec and April Sprint 4 intent).

**Stripe SDK:** Now at v22. Was at v14. No test regressions.

**CI concurrency:** `concurrency: group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true` prevents queue buildup on rapid pushes.

**Website URL auto-populate (S5):** When navigating from a market intel lead to Create Pitch, `market.js` writes `selectedLeadWebsite` to `marketIntelRef` sessionStorage (line 4990). `create.js` `checkMarketIntelRef()` now reads it and populates `#prospect-website` if the field is empty.

---

## Session — May 24, 2026 (Credit Deduction Double-Spend Fix)

**Reviewed by Arthur Morrissette (Focal AI). Backend-only change.**

### New Billing Helpers (`functions/api/billing.js`)

Three new exports added after `deductCredits`. `checkCredits` and `deductCredits` are retained.

#### `checkAndDeductCredits(userId, required, reason, options)` → `{ allowed, available, deducted, error? }`
- Atomic Firestore transaction — eliminates double-spend race condition
- **FAILS CLOSED**: transaction error → `{ allowed: false, error: 'BILLING_TRANSACTION_FAILED' }`
- Routes must return **503** (not 402) on `BILLING_TRANSACTION_FAILED`
- Legacy accounts (no `credits` field) → allowed, logged

#### `refundCredits(userId, amount, reason, options)` → void
- Restores credits + writes positive ledger entry
- Non-blocking — failure is logged, never thrown

#### `writeCreditLedger(userId, amount, reason, service)` → void
- Shared ledger writer (negative = deduction, positive = refund)
- Fire-and-forget — failure logged, never thrown

### Billing Pattern Reference

| Pattern | Service | Rule |
|---------|---------|------|
| Fixed-cost | Opportunity Brief | Atomic deduct in ROUTE before work; refund on hard failure |
| Variable-cost | Template Enrichment | Reserve max upfront; refund unused delta after work |
| Guard-before-work | Intent Signals | Atomic check+deduct BEFORE `fetchAndComputeSignals`; `creditBlocked` return |
| creditBlocked handling | market.js | `intentSignalsResult.creditBlocked` → null (omit from report) |

### Files Changed

- `functions/api/billing.js` — 3 new helpers + updated `module.exports`
- `functions/services/templateEnrichment.js` — reserve-max + partial-refund pattern
- `functions/routes/opportunityBriefRoutes.js` — atomic deduct + 503 path + failure refund (both endpoints)
- `functions/services/opportunityBriefService.js` — `deductCredits` removed (billing now in route)
- `functions/services/intentSignalService.js` — credit guard before work, `creditBlocked` return
- `functions/api/market.js` — `creditBlocked` null check after `generateIntentSignals`
- `functions/__mocks__/firebase-admin.js` — added `_increment` handling to `MockDocumentReference.update()`
- `functions/tests/billing.test.js` — **NEW**: 10 billing tests

**Test count:** 872 → 882 passing, 0 failing.

### Infrastructure Note — QRsynch (May 24)

QRsynch Pages backend is live and confirmed running on a **GCP VM** (`34.73.146.195`), not PathManager EC2. Process manager: **PM2** (`pm2 restart qrsyn-backend`). OS user: `hello`. SSH via GCP Console browser (no PEM key). Firestore DB: `qrsynch-pages`. PathManager backend now proxies all QRsynch API calls server-side (PR #163) — the `x-api-key` never reaches the browser.

---

## IRS BMF Seed Script — May 14, 2026

**Commit included in next push**

### `scripts/seed-irs-bmf.js`

Seeds IRS Business Master File CSV exports into Firestore `irsBmfCache` collection.

**CLI usage (from `functions/` directory):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=./pathconnect-442522-ec919d9337b8.json \
node scripts/seed-irs-bmf.js --state GA --file data/eo_bmf_ga.csv
```

**CSV files:** `functions/data/eo_bmf_ga.csv` (GA, ~10 MB), `functions/data/eo_bmf_tx.csv` (TX, ~25 MB)

**CSV column mapping (actual IRS headers):**
| Script field | CSV column |
|---|---|
| `ein` | `EIN` |
| `name` | `NAME` |
| `city` | `CITY` |
| `state` | `STATE` |
| `zip` | `ZIP` |
| `ruling_date` | `RULING` |
| `ntee_code` | `NTEE_CD` |
| `activity_code` | `ACTIVITY` |
| `organization_type` | `ORGANIZATION` |
| `asset_amount` | `ASSET_AMT` |
| `income_amount` | `INCOME_AMT` |
| `revenue_amount` | `REVENUE_AMT` |

**Doc ID:** `{lowercase_name_underscored}_{lowercase_state}` (e.g., `celebration_inc_ga`)

**Batch size:** 490 writes per Firestore batch (under 500 hard limit)

**Skips:** rows with empty `EIN` or `NAME`

**Dependency:** `csv-parse` ^5.5.0 (already in `package.json`)

---

## Hotfix — May 14, 2026 (Gemini Payload Format + Safety ZIP)

**Backend commit `c9dcdff`**

### Bug A (P0) — Gemini 400 Bad Request: role in wrong location

**Root cause:** Two call sites in `functions/api/market.js` used `generateContent([...])` array form. In `@google/generative-ai` v0.24.1, passing an array to `generateContent` treats each element as a `Part` object (not a `Content` object). So `{ role: 'user', parts: [...] }` was serialized as `contents[0].parts[0]` → 400 Bad Request: `Unknown name "role" at contents[0].parts[0]`.

**SDK version confirmed:** `@google/generative-ai` v0.24.1

**Broken call sites (array form → object form):**
- Enhancement call (gemini-3-flash-preview) — strategic thesis, roadmap, KPI
- AI questions call (gemini-2.5-flash) — precision targeting questions

**Fix:** Both call sites changed from:
```javascript
model.generateContent([{ role: 'user', parts: [{ text: '...' }] }])
```
to:
```javascript
model.generateContent({ contents: [{ role: 'user', parts: [{ text: '...' }] }] })
```

**Already correct (object form, not broken):**
- 10-K signal extraction (line ~3158)
- Compare markets narrative (line ~3252)
- Model availability test (line ~3122)

**Permanent rule: ALWAYS use `generateContent({ contents: [...] })` object form. NEVER pass an array directly.**

**Verified locally:** `model.generateContent({ contents: [{ role: 'user', parts: [{ text: '...' }] }] })` returns SUCCESS with gemini-2.5-flash.

### Bug B (P1) — Safety service skipping: no ZIP code

**Root cause:** `getSafetyContext()` was called with `{ zipCode: zipCode || '' }` where `zipCode` comes from `req.body.zipCode`. Users generating reports by city+state never provide a ZIP, so the field was always empty → `[SafetyContext] No valid ZIP code — skipping`.

**Fix:** Added ZIP extraction block before the safety call (line ~1652 in `market.js`):
- Scans `competitors[].address` then `serperLeads[].address/formatted_address/vicinity`
- Extracts first 5-digit US ZIP with regex `/\b(\d{5})(?:-\d{4})?\b/`
- Stores as `resolvedZip`, passed to `getSafetyContext()`
- Logs: `[MarketIntel] Safety ZIP resolved: XXXXX` (or `none` if not found)

**Address source:** Google Places returns `vicinity` (simplified, may lack ZIP) or `formatted_address` (full, includes ZIP). CoreSignal leads may also have addresses. The regex handles both formats.

**Fallback:** If no competitor/lead address contains a ZIP, `resolvedZip` stays `''` and the service skips gracefully as before.

**Log lines to watch:**
- `[MarketIntel] Safety ZIP resolved: 30301` — ZIP found, service will proceed
- `[SafetyContext] Fetching data for ZIP 30301` — Zyla API call starting
- `[MarketIntel] Safety context: status=complete` — success
- `[SafetyContext] Zyla fetch failed: 401` — API key expired (separate issue)

---

## Crime/Safety Section — End-to-End Trace & Fix — May 14, 2026

**Backend commit `febd1e3`**

### Diagnostic Findings

| Step | Result | Detail |
|------|--------|--------|
| env var (`ENABLE_CRIME_DATA_ENRICHMENT`) | PASS | Set to `true` at `.env` line 82 |
| `safetyContextService.js` | PASS | `functions/utils/safetyContextService.js` — complete, 2-provider |
| `market.js` call | PASS | Imported line 61, called line 1654, result → `reportData.safetyContext` |
| `buildTieredResponse` | **FAIL** | `safetyContext` was NOT included in `baseResponse` — the root cause |
| Firestore write | PASS | `reportData` (including `safetyContext`) written via `tx.set/reportRef.set` |
| `reportFieldResolver.js` | PASS | `getSafetyContextData()` exists, exported |
| Frontend render | PASS | `renderSafetyContext()` exists at market.js:2118, placed on Overview tab |
| Frontend resolver | N/A | Render reads `report.safetyContext` directly — acceptable |
| PDF export | **FAIL** | `downloadReport()` had no safety section — added |
| External API | PARTIAL | `ZYLA_API_KEY` and `FBI_CRIME_API_KEY` both set; validity unconfirmed |

### External API

- **Zyla Labs** (ZIP-level): `https://zylalabs.com/api/1236/...` — key env var: `ZYLA_API_KEY`
- **FBI CDE** (state-level): `https://api.usa.gov/crime/fbi/cde` — key env var: `FBI_CRIME_API_KEY`
- Cache TTL: 90 days in Firestore collection `safetyContextCache`
- Raw responses cached in `safetyContextRaw` for debugging

### Firestore Field

Field: `safetyContext` (top-level on the `marketReports/{id}` document, NOT nested under `data`)

Shape:
```json
{
  "status": "complete|partial|unavailable",
  "confidence": "high|medium|low",
  "zipCode": "30301",
  "state": "GA",
  "zipLevel": { "safetyIndex": 42, "grade": "B", "violentCrimeRate": 3.2, "propertyCrimeRate": 18.7, "nationalComparison": "...", "stateComparison": "..." },
  "stateLevel": { "year": "2023", "state": "GA", "summary": {} },
  "narratives": { "summary": "...", "salesUse": "...", "caution": "..." }
}
```

### What Was Fixed

1. **`functions/api/market.js`** `buildTieredResponse()` — added `safetyContext: reportData.safetyContext || null` to `baseResponse`. This was the critical break: data was computed and saved to Firestore correctly, but never included in the API response sent back to the frontend after generation.
2. **`functions/services/marketIntelPitchContext.js`** — added block 10a: reads `report.safetyContext`, derives neutral `safetyProfile` string, stores as `context.safetyContext`
3. **`functions/services/pitchCompanionMd.js`** — added "Community Safety Profile" section (uses neutral language, no raw rates in pitch copy)

---

## Hotfix — May 14, 2026 (4-Issue Hotfix: NAICS + KPI Targets)

**Backend commit `5d1307a`. Frontend commit `d96bc5b`.**

### Fix 1 (P0) — NAICS code shows 722511 for Agencies

**File: `functions/api/market.js`**

The `industry` object in the report document used `naicsCode` (from the old NAICS lookup, which fell back to `722511`) instead of the canonical taxonomy value.

**Fix:**
```javascript
naicsCode: industryConfig?.naicsCode || naicsCode,
naicsTitle: industryConfig?.naicsLabel || industryDetails?.title || displayIndustryName,
```

The taxonomy NAICS (e.g., `541810` for Agencies & Marketing Services) now takes priority. Old NAICS lookup is the fallback only.

### Fix 4 (P2) — KPI Scorecard target values missing

**File: `functions/api/market.js`**

`computeKpiScorecard()` now populates a `target` field on each KPI deterministically from benchmark data:

| KPI | Target |
|-----|--------|
| Average Rating | `topQuartileAvg★` (or `4.5★` if no data) |
| Share of Voice | `15%` |
| Avg Review Count | `1.5 × avgReviews reviews` (or `30 reviews` if no data) |
| SEO / Digital Authority | `80/100` |
| Total Competitors | `null` (informational only) |
| Qualified Leads Found | `5+ per market` |

`mergeKpiScorecard()` updated: Gemini targets only override when non-empty and not `'See roadmap'`.

### Fix 2 (P1) — gapLabel missing from PDF Positioning Matrix

**File: `synchintro-app/js/pages/market.js`**

`renderPositioningMatrixPDF()` now reads `gapLabel` from `_mktGetStrategicMarketThesis(this.currentReport)` and renders an amber pill. Hardcoded `'Opportunity Zone'` removed.

### Notes

- Fix 2 live app and Fix 3 (Archetypes) were already done in 10-Issue Hotfix (`e2cf36d`)

---

## Session — April 22, 2026

**Deployed to production (functions). Pricing calculation fixes, landing page intelligence improvements.**

### Investment Pricing — Server-Side Calculation Fix

**File: `functions/api/pitchGenerator.js`**

The server-side pricing calculator now handles all pricing structures correctly:

| Structure | Monthly Total | Setup Total | Line Item |
|-----------|--------------|-------------|-----------|
| `monthly` / `tiered` | + `monthlyPrice` | + `setupFee` | `$X/mo` |
| `one_time` | — | + `oneTimeFee` | `$X one-time` |
| `per_unit` | + `perUnitPrice` | — | `$X/label` |
| `quarterly` | — | — | `$X/quarter` (noted only) |
| `custom` | + `perUnitPrice` + `monthlyPrice` | + `oneTimeFee` | all components joined with ` + ` |
| `included_in_plan` | — | — | `included` |

**Key fix**: `custom` was previously lumped with `included_in_plan` in a catch-all `else` branch that added $0 to everything. Now:
- `oneTimeFee > 0` → adds to setup total
- `perUnitPrice > 0` → adds to monthly total
- `monthlyPrice > 0` → adds to monthly total

Example: PathConnect Starter ($149/mo) + LocalSynch Growth (custom: $199/mo + $299 one-time) + NFC Card (one-time: $39) = **$348/mo + $338 one-time**.

### Landing Page — Complaint Theme Override

**File: `functions/routes/landingPageRoutes.js`**

**`extractPitchIntelligence()` — 6 field paths** now checked for complaint themes (was 3):
1. `pitchData.reviewAnalysis.complaintThemes`
2. `pitchData.reviewPitchMetrics.complaintPatterns`
3. `pitchData.marketData.complaintThemes`
4. `pitchData.pitchMetadata.reviewAnalysis.complaintThemes` *(new)*
5. `pitchData.pitchMetadata.complaintThemes` *(new)*
6. `pitchData.complaintThemes` *(new — top-level future path)*

**Post-AI override (generate handler):**
After AI call resolves (success or fallback), if `intel.complaintThemes.length > 0`, `pageContent.painPoints` is unconditionally replaced with real complaint themes. AI cannot generate generic pain points when real data exists.

**Diagnostic logging added:**
- Pitch top-level keys logged on every generation
- Complaint themes count + values logged
- Override status logged (`Overrode AI pain points with real complaint themes: ...` or `No complaint themes — AI pain points kept as-is`)

### Previously Deployed (April 22 context)

Also deployed during this session (these changes were made but tracked in synchintro-app CLAUDE.md):
- `functions/routes/landingPageRoutes.js` — `buildLandingPagePrompt` pitch HTML field fix (`pitchData.html` not `pitchData.content`), em dash ban in prompt
- `functions/api/export.js` — `pitchData.html` fallback for export content
- `functions/services/templateSectionResolver.js` — `pricing_block` null fallback fix, server-calculated totals override
- `functions/services/templatePromptBuilder.js` — seller product catalog in AI prompt
- `functions/services/templates/brewhouseResponseSchema.js` — `solutionPackage` field added to schema and `required` array

### Custom Pricing `setupFee` + `oneTimeFee` Fix

**File: `functions/api/pitchGenerator.js`**
- `custom` branch now computes `fixedFee = setup + oneTime` (was only `oneTime`)
- Products using `setupFee` field (SynchMate, Managed SynchMate Concierge) now correctly added to setup total
- Line item label also updated to use combined `fixedFee`
- Investment math: PathConnect Starter $149/mo + LocalSynch Growth $199/mo = **$348/mo**; LocalSynch $299 one-time + NFC Card $39 = **$338 one-time**

### Pending / Known Issues

- Firestore product persistence: `updateSellerProfile` writes succeed (SDK-local) but server-side verification sometimes shows 0 products. `{ source: 'server' }` read added to frontend for diagnosis. Root cause under investigation (possibly security rules blocking server write while local IndexedDB cache shows success).
- Landing page: complaint themes only present on pitches generated with market intel enrichment or smart card 2. Classic-mode pitches have no structured complaint data — AI must extract from `cleanContent` HTML.

---

## Session — April 19, 2026

### Sprint 6 — Attio Push + Instantly Sequence Trigger from Visitor Intel Workspace

**New files:**
- `functions/routes/attioRoutes.js` — `POST /attio/push-account` endpoint
  - Reads Account360 doc + outbound_view (prefers fresh view, falls back to doc)
  - Maps to attioClient lead shape: `{ name: companyName.value, website: https://${domain}, decisionMaker: contact, email: contact.email, intelSignal }`
  - On success: updates `outboundState.attioId` + `lastOutboundAt`, writes CRM_PUSH signalHistory entry
  - Fire-and-forget: `_actionMatchingAlerts()` + `_fireEntity360CrmPush()` (never block response)
  - Returns `{ success: false, error }` on Attio API failure — NEVER throws 500

**Modified files:**

**`functions/routes/instantlyRoutes.js`**
- Added `GET /instantly/vi-campaigns` — uses global `instantlyClient` (INSTANTLY_API_KEY)
  NOT the per-user `instantlyService`. Path is `/instantly/vi-campaigns` (not `/instantly/campaigns`) to avoid collision
- Added `POST /instantly/trigger-sequence` — reads Account360 + outbound_view
  - Returns error if no identified contact email
  - Visitor Intel custom vars: custom_1=status, custom_2=whyNow, custom_3=topIntentPage, custom_4=score, custom_5=recommendedAction
  - Uses direct `fetch()` to Instantly V1 `/lead/add` (instantlyClient has no `addLeadToCampaign()`)
  - Updates `outboundState.sequenceTriggered = true`, writes SEQUENCE_TRIGGERED signalHistory entry

**`functions/routes/visitorSignalRoutes.js`**
- Added `GET /account360/:accountKey/history` — queries signalHistory where `eventType in ['CRM_PUSH', 'SEQUENCE_TRIGGERED']`
  - No `orderBy` to avoid composite index requirement; sorts in JS memory; returns top 5

**`functions/services/entity360Bridge.js`**
- Added `fireEvent` to `module.exports` (was defined but not exported)

**`functions/routes/index.js`**
- Imported + exported `attioRoutes`
- Added AVAILABLE_ENDPOINTS: `/account360/:accountKey/history`, `/attio/push-account`, `/instantly/vi-campaigns`, `/instantly/trigger-sequence`

**`functions/index.js`**
- Added `attioRoutes` to destructured import
- Added dispatch block: `if (path.startsWith('/attio')) { if (await attioRoutes.handle(req, res)) return; }`
- Placed BEFORE existing inline `/attio/push-lead` and `/attio/push-all` handlers

**Architecture notes:**
- Two Instantly integrations remain separate: per-user `instantlyService` (`/instantly/*`) vs global `instantlyClient` (`/instantly/vi-*`). Do NOT merge.
- `attioRoutes` router returns `false` for non-matching paths — existing inline handlers remain functional
- history endpoint avoids Firestore composite index by sorting in JS (query only uses `where`, no `orderBy`)
- `trigger-sequence` uses direct `fetch()` to Instantly V1 because visitor intel custom vars differ from market intel vars in `pushLeadToInstantly()`

**Commits:** functions 6abc862, hosting 3fbdcbf — deployed April 19, 2026

---

### Sprint 4 — Alert Engine + Analytics Integrations

**New files:**
- `functions/services/alertService.js` — threshold alert creation and management
  - Evaluates `hot`, `outreach_now`, `contact_identified` status changes against per-merchant thresholds
  - Creates alert docs in `notifications/{userId}/alerts/{alertId}` with `accountKey`, `domain`, `companyName`, `intentScore`, `status`, `recommendedAction`
  - Alert types: `HOT_ACCOUNT`, `CONTACT_IDENTIFIED`, `OUTREACH_NOW`
  - Deduplication: checks for existing unread/read alert on same accountKey before creating
- `functions/routes/alertRoutes.js` — 4 endpoints for alert CRUD
  - `GET /alerts` — returns `notifications/{userId}/alerts` ordered by createdAt desc, limit 50
  - `POST /alerts/:alertId/read` — marks alert `status: 'read'`
  - `POST /alerts/:alertId/action` — marks alert `status: 'actioned'`, sets `actionedAt`
  - `POST /alerts/:alertId/dismiss` — marks alert `status: 'dismissed'`

**Modified files:**
- `functions/routes/visitorSignalRoutes.js` — calls `alertService.evaluateAndCreateAlerts()` after Account360 upsert when status changes to hot/outreach_now/contact_identified
- `functions/index.js` — registered `alertRoutes` dispatch block; registered `processThresholdAlerts` scheduled function (every 6 hours)
- `functions/routes/index.js` — added alert endpoints to AVAILABLE_ENDPOINTS
- `functions/.env` — added `HUMBLYTICS_SITE_TOKEN`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`

**Infrastructure:**
- `processThresholdAlerts` scheduled Cloud Function — sweeps `visitorIntelSummary` for accounts that crossed thresholds since last run, creates alerts for any found. Runs every 6 hours.
- Humblytics + PostHog analytics tokens added to `.env` for frontend snippet injection

**Architecture notes:**
- Alert deduplication key: `accountKey + alertType`. One live (unread/read) alert per account per type at a time.
- `processThresholdAlerts` is a catch-all for accounts that might have been missed by the real-time path (e.g., ingest events processed out of order)

---

### Sprint 3 — ps-core.js Unified Tracking Script + Signal Ingest Pipeline

**New files:**
- `public/ps-core.js` — unified client-side tracking script deployed to Firebase Hosting
  - Loads per-merchant config from `public/config/{merchantId}.json`
  - Identifies visitors via IPinfo.io (IP-to-company), fingerprinting fallback
  - Scores page visits against URL heuristic mappings from merchantConfig
  - Sends scored sessions to `POST /visitor-signal/ingest` with full event payload
  - Handles session continuity, bounce detection, page depth tracking
- `public/modules/` — 5 extracted modules loaded by ps-core.js:
  - `identityResolver.js` — IPinfo.io lookup + fingerprint generation
  - `sessionTracker.js` — session state, bounce/depth detection
  - `intentScorer.js` — URL-to-score mapping using merchantConfig heuristics
  - `eventEmitter.js` — batches + sends events to ingest endpoint
  - `configLoader.js` — fetches and caches `config/{merchantId}.json`
- `functions/api/generateMerchantConfig.js` — generates `public/config/{merchantId}.json` from `merchantConfig/{merchantId}` Firestore doc; writes to Firebase Hosting storage bucket
- `functions/routes/visitorSignalRoutes.js` — full ingest pipeline:
  - `POST /visitor-signal/ingest` — receives scored session events from ps-core.js
  - Validates: `visitorId` required, `merchantId` required
  - Writes raw session to `websiteVisitors/{merchantId}/sessions/{sessionId}`
  - Calls `visitorSignalService.processSession()` for scoring + identity resolution
  - Writes display record to `visitorIntelSummary/{merchantId}/accounts/{accountKey}`
  - Triggers `alertService.evaluateAndCreateAlerts()` on status changes
  - `GET /visitor-accounts` — returns `visitorIntelSummary/{merchantId}/accounts` ordered by score desc, limit 100

**Architecture notes:**
- ps-core.js is served from Firebase Hosting (same CDN as app), NOT from Cloud Functions — zero cold-start latency for the snippet
- merchantConfig `learningModeActive: true` suppresses Entity360Bridge calls and alert creation during calibration period
- Config JSON is regenerated on `POST /merchant-config` saves via `generateMerchantConfig()`

---

### Sprint 2 — Intent Scoring Engine + Merchant Config

**New files:**
- `functions/services/visitorSignalService.js` — core scoring + identity resolution service
  - `processSession(sessionData, merchantConfig)` — assigns intent score, status, whyNow narrative
  - Status ladder: `learning` → `monitoring` → `warming` → `hot` → `outreach_now`
  - Score thresholds configurable per merchant in `merchantConfig.thresholds`
  - `identifyCompany(ipAddress, domain, fingerprint)` — IPinfo.io lookup, domain extraction, confidence scoring
  - ConflictEngine integration: never downgrades confidence on existing identity
  - Returns: `{ accountKey, score, status, whyNow, confidence, identifiedContact, recommendedAction }`
- `functions/services/calibrationService.js` — merchant calibration logic
  - `runCalibration(merchantId)` — analyzes last 30 days of sessions, computes baseline avg score, p75, p90
  - Writes calibration result to `merchantConfig/{merchantId}.calibration`
  - Sets `learningModeActive: false` after calibration completes
  - `GET /merchant-config/calibration-report` endpoint returns calibration stats
- `functions/services/urlHeuristics.js` — URL-to-intent-score mapping
  - `scoreUrl(url, urlMappings)` — matches URL patterns against merchantConfig mappings
  - Default heuristics: pricing (+40), demo/book (+35), contact (+25), product (+20), blog/news (-5)
  - Merchant-specific overrides stored in `merchantConfig.urlMappings[]`
- `functions/routes/merchantConfigRoutes.js` — merchant config CRUD
  - `GET /merchant-config` — returns current merchant config doc
  - `POST /merchant-config` — creates/updates config, triggers config JSON regeneration
  - `GET /merchant-config/top-pages` — top 10 pages by visit volume from sessions (last 30d)
  - `GET /merchant-config/calibration-report` — calibration stats
  - `POST /merchant-config/regenerate-snippet` — forces ps-core.js config JSON regeneration

**Architecture notes:**
- `merchantConfig/{merchantId}` is the source of truth for scoring config — ps-core.js reads a cached JSON copy
- Calibration runs automatically on first 100 sessions OR on manual trigger
- `accountKey` = `${merchantId}:${domain}` — globally unique per merchant+company

---

### Sprint 1 — Foundation: Plan Gate Fix + Confidence Schema

**New files:**
- `functions/services/visitorConfidence.js` — provenance schema helpers
  - `provenance(value, confidence, source, sourceTier)` — creates standardized `{ value, confidence, source, sourceTier, humanConfirmed, updatedAt }` block
  - `ConflictEngine.resolve(existing, incoming)` — 4-rule resolution: humanConfirmed → sourceTier → confidence → recency
  - `sanitizeProvenance(obj)` — strips undefined values before Firestore write
- `functions/api/backfillConfidenceFields.js` + scheduled Cloud Function `backfillConfidenceFields`
  - One-time backfill: adds provenance wrappers to existing `websiteVisitors` docs that predate the schema
  - Runs as a triggered Cloud Function (manual invoke), not scheduled

**Modified files:**
- `functions/routes/visitorRoutes.js`
  - Plan gate fix: visitor tracking (`GET /visitors`, `GET /visitors/snippet`) now correctly resolves plan from `user.plan` before `user.tier` (same Stripe stale-tier bug as elsewhere)
  - Index-resilient queries: removed composite `orderBy` from `getUserTierAndCheckLimit()` and `GET /visitors` — sorts in JS memory to avoid missing index errors

**Bug fix detail — plan gate:**
- `websiteVisitors` queries used `where(userId) + orderBy(lastSeenAt, desc)` which required a composite index not present in `firestore.indexes.json`
- Fix: query without orderBy, filter+sort in JS — avoids index dependency entirely

**Commits (Sprint 1–4):** deployed April 17, 2026 — commit a45d4fd (functions), commit 5566645 (hosting)

---

### Bug Fixes — April 19, 2026

**Fix 1 — `functions/api/pitch/templateOnePager.js`**
- `renderHeader()` logo fallback text was hardcoded `'PathSynch Labs'`
- Fixed to: `${escHtml(sellerProfile?.companyName || sellerProfile?.sellerContext?.companyName || 'Your Company')}`
- Affects all generated one-pagers when seller has no logo URL configured

**Fix 2 — `functions/middleware/planGate.js`**
- `planHierarchy` was `['starter', 'growth', 'scale']` — enterprise not included
- `planHierarchy.indexOf('enterprise')` returned `-1`, causing all enterprise users to fail every `requirePlan()` check
- Fixed to: `['starter', 'growth', 'scale', 'enterprise']`

**Commit:** 6c19f6e — deployed April 19, 2026

---

### Deployed Cloud Functions (as of April 19, 2026)

| Function | Type | Schedule |
|----------|------|---------|
| `api` | HTTP (2nd Gen) | on-request |
| `processThresholdAlerts` | Scheduled (2nd Gen) | every 6 hours |
| `merchantBehaviorSync` | Scheduled (2nd Gen) | Monday 09:00 UTC |
| `calibrateMerchant` | Callable (2nd Gen) | on-demand |
| `backfillConfidenceFields` | Callable (2nd Gen) | on-demand |
| `weeklyDigest` | Scheduled (2nd Gen) | weekly |
| `dailyDigest` | Scheduled (2nd Gen) | daily |
| `activityCleanup` | Scheduled (2nd Gen) | daily |
| `onUserCreated` | Auth trigger (1st Gen) | on user create |

### New API Endpoints — Visitor Intel (Sprints 1–6)

| Method | Path | Sprint | Purpose |
|--------|------|--------|---------|
| POST | `/visitor-signal/ingest` | 3 | Receive scored session from ps-core.js |
| GET | `/visitor-accounts` | 3 | Dashboard list — visitorIntelSummary accounts |
| GET | `/merchant-config` | 2 | Read merchant scoring config |
| POST | `/merchant-config` | 2 | Create/update merchant scoring config |
| GET | `/merchant-config/top-pages` | 2 | Top pages by visit volume |
| GET | `/merchant-config/calibration-report` | 2 | Calibration stats |
| POST | `/merchant-config/regenerate-snippet` | 2 | Force config JSON regen |
| GET | `/account360/:accountKey` | 5 | Read Account360 doc + outbound_view |
| POST | `/account360/:accountKey/outbound` | 5 | Update outboundState fields |
| GET | `/account360/:accountKey/history` | 6 | Last 5 CRM/sequence actions |
| POST | `/attio/push-account` | 6 | Push Account360 to Attio CRM |
| GET | `/instantly/vi-campaigns` | 6 | List campaigns (global INSTANTLY_API_KEY) |
| POST | `/instantly/trigger-sequence` | 6 | Add contact to Instantly sequence |
| GET | `/alerts` | 4 | List threshold alerts for user |
| POST | `/alerts/:alertId/read` | 4 | Mark alert read |
| POST | `/alerts/:alertId/action` | 4 | Mark alert actioned |
| POST | `/alerts/:alertId/dismiss` | 4 | Dismiss alert |

---

### Sprint 5 — Account360 Integration + Merchant Memory Framework

**New files:**
- `functions/services/entity360Bridge.js` — ONE-WAY bridge from visitorSignalService → Entity360. Fire-and-forget `notifyAccountStatus()`, `notifyContactIdentified()`, `notifyBehavioralSummary()`. All calls wrapped in try/catch that only logs. Only fires when `config.entity360MerchantId` is set.
- `functions/services/merchantBehaviorSync.js` — Weekly service. Reads `visitorIntelSummary/{merchantId}/accounts`, computes aggregate stats (total, hot, outreach_now counts, identificationRate, top high-intent pages), posts `BEHAVIORAL_SUMMARY` event. Posts `TRAFFIC_PROFILE_UPDATE` when identificationRate < 10%.

**Modified files:**

**`functions/routes/visitorSignalRoutes.js`**
- Account360 write expanded to full schema: `domain`, `companyName`, `identity` (confidence/tier/source/identifiedContacts[]), `intentSignals` (currentScore, status, scoreExplanation, highIntentPages, lastActivity, signalQualityGates), `outboundState` (pitchGenerated, briefGenerated, attioId, sequenceTriggered, lastOutboundAt), `recommendedNextAction`, `workspaceId`
- ConflictEngine applied on all provenance fields (existing code preserved)
- signalHistory still always appended on non-duplicate events (existing Write 3)
- After every Account360 upsert: writes `Account360/{accountKey}/agentViews/outbound_view` (4hr TTL) and `core_view` (24hr TTL)
- Entity360Bridge called after Account360 write: fires on status=hot/outreach_now/contact_identified when `config.entity360MerchantId` set and not in learning mode
- New endpoints: `GET /account360/:accountKey` (reads doc + outbound_view), `POST /account360/:accountKey/outbound` (updates outboundState fields only)

**`functions/api/pitchGenerator.js`**
- When `accountKey` in request body: reads `Account360/{accountKey}/agentViews/outbound_view` from Firestore
- If view exists and not expired: injects ACCOUNT INTELLIGENCE block into `inputs.statedProblem` before existing context
- Falls back to URL param `visitorContext` when account360View not available (not when account360View is present — avoids double-injection)

**`functions/routes/precallBriefRoutes.js`**
- Accepts `accountKey` from request body
- Reads `Account360/{accountKey}/agentViews/outbound_view` before generation (best-effort, non-blocking)
- `buildBriefPrompt()` now accepts `account360View` — generates richer WEBSITE ACTIVITY section with intent status, score, high-intent pages, identified contact, recommended angle
- Falls back to `visitorContext` when account360View not available
- All three `generateLegacyBrief()` calls pass `account360View`

**`functions/index.js`**
- Route for `/account360` added to visitorSignalRoutes dispatch block
- `merchantBehaviorSync` weekly scheduled function registered (Monday 09:00 UTC)

**`functions/routes/index.js`**
- Added `GET /api/v1/account360/:accountKey` and `POST /api/v1/account360/:accountKey/outbound` to AVAILABLE_ENDPOINTS

**Frontend:**

**`synchintro-app/js/api.js`**
- `getAccount360(accountKey)` — GET /account360/:accountKey
- `updateOutboundState(accountKey, updates)` — POST /account360/:accountKey/outbound

**`synchintro-app/js/pages/visitors.js`**
- [Open Workspace] button added to Outreach Now alert cards
- `openWorkspace(alertId, accountKey, alertData)` — opens full-width slide-over panel, fetches Account360 data
- `closeWorkspace()` — removes overlay, restores scroll
- `_renderWorkspaceBody()` — two-column layout: left (company intel, high-intent pages, why-now, signal quality gates, contacts), right (status badge, asset buttons, CRM actions with confirmation checkbox, action history)
- `_toggleWorkspaceCrmButtons()` — enables Send to Attio / Trigger Sequence after checkbox confirmed
- `_workspaceGeneratePitch()` — navigates to `/#/create?accountKey=...`
- `_workspaceGenerateBrief()` — navigates to `/#/precall-briefs?accountKey=...`
- `_sendToAttio()` — marks alert actioned + updates Account360 outboundState.attioId to 'pending_attio_sync'
- All workspace CSS added to `addStyles()` with dark mode support

**Architecture notes:**
- Account360 collection: prospect intelligence workspace (SynchIntro lane)
- merchant360 collection: merchant intelligence workspace (PathManager lane) — NEVER conflated
- entity360Bridge is ONE-WAY only — Entity360 never writes back to SynchIntro
- All Entity360 calls fire-and-forget — failure never breaks visitor tracking
- `entity360MerchantId` field on `merchantConfig` controls bridge; null = skip
- For KEM Health test merchant (ID: 937DF5): `entity360MerchantId = '937DF5'`
- outbound_view TTL: 4 hours | core_view TTL: 24 hours

---

## Session — April 16, 2026

### Intent Signals v1.1 — Backend Build

**New file:** `functions/services/intentSignalService.js`
- Exports `generateIntentSignals()` and `refreshIntentSignals()`
- Signal 1 (Search Momentum): Keywords Everywhere POST form-encoded, Bearer auth — `KEYWORDS_EVERYWHERE_API_KEY` in `.env`; DataForSEO Google Trends for MoM confirmation
- Signal 2 (Aggregated Velocity): reads `lead.velocityTrend.classification` from `reportContext.leads` — weights: on_pace 1.0, below_pace 0.3, stalling 0.1, declining 0.0; denominator always 20
- `calculateVelocityTrend()` has NO "accelerating" class — on_pace is the top classification
- Cache doc ID pattern: `[vertical, market, state].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, '_')).join('::')` — separator is `::` not `_` (fixed afternoon, commit ed65097)
- `deductCredits` is not exported from templateEnrichment.js — replicated inline (same Firestore update pattern)
- Gemini call uses `gemini-3-flash-preview` with `thinkingBudget:0`, JSON output, `indexOf('{')` extraction

**Modified:** `market.js` — import + wiring at lines ~1211–1225 + write at `reportData.data.intentSignals`
- **CRITICAL:** intent signals wired SEQUENTIALLY after main AI block — needs `lead.velocityTrend` already populated by velocity loop at lines 1038–1073
- Frontend reads path: `report.data.intentSignals` (NOT `report.intentSignals`)

**New Firestore rules:** `intentSignalsCache`, `categoryVelocitySnapshots`, `ke_credit_log`
- All three: `allow read: if isAuthenticated(); allow write: if false` (Cloud Functions write via Admin SDK)
- `categoryVelocitySnapshots` is append-only — never grant client write

**New Firestore index:** `categoryVelocitySnapshots(vertical ASC, market ASC, state ASC, createdAt DESC)` in `firestore.indexes.json`

### Bug Fixes Shipped April 16

**Analytics tab "Missing or insufficient permissions":**
- Root cause: `pitchAnalytics` docs written by public track-view endpoint via Admin SDK — no `userId` field ever written; ownership check `resource.data.userId == request.auth.uid` always denied
- Fix: `allow read: if isAuthenticated()` — matches `pitchVersions` precedent; data is counters only

**`trackShare()` 0 shares across 163 pitches:**
- Root cause: `pitchAnalytics` parent had `allow write: if false`; `shareEvents` subcollection had no rule at all
- Fix: `allow create, update` on parent (no delete granted); `allow create, read` on `shareEvents` subcollection

### Intent Signals Data Quality Fixes (commit ed65097)

**`functions/services/intentSignalService.js` — four data quality bugs fixed:**

**A — DataForSEO response parsing rewrite (`parseTrend`):**
- `item.keyword_data` → `item.data || item.keyword_data` (correct field for explore/live endpoint)
- `d.value` → `d.values[0].value || d.values[0].extracted_value || d.value` (handles both response shapes)
- `daysOfData` now computed from actual earliest→latest `date_from` in time series (was hardcoded 30/90)
- Individual time series values collected as `sparklineValues` array (feeds Issue D fix)
- Added raw response log: `[IntentSignals] DataForSEO raw items: ...` (first 500 chars of trend30 result)

**B — Cache key collision fix (`cacheDocId`):**
- Separator changed from `_` to `::` — `_` was both separator AND replacement char, creating collision risk
- New pattern: `auto_repair::charlotte::nc` (was `auto_repair_charlotte_nc`)
- Added `console.log` in `checkCache`: `[IntentSignals] Cache check: key=..., hit=true/false`
- Added `console.log` in `writeToCache`: `[IntentSignals] Cache write: key=...`
- NOTE: existing cache docs in `intentSignalsCache` have old `_`-joined keys — they will be ignored (cache miss) and re-written with new `::` keys on next report generation

**C — `scoreSummary` field (was never set):**
- Added `scoreSummary` to Gemini prompt alongside `actionRecommendations` — single Gemini call, no extra cost
- Prompt return schema changed: `{"actionRecommendations":[...],"scoreSummary":"..."}` (was `{"actions":[...]}`)
- Backward-compat fallback: parser reads `parsed.actionRecommendations` first, falls back to `parsed.actions`
- `scoreSummary` written to `signals` object → flows into both cache doc and report output automatically

**D — `sparklineData` field (was never written):**
- `parseTrend` now returns `sparklineValues` array (raw time series numbers, chronological)
- `fetchSearchMomentum` exposes as `sparklineData` on `searchMomentum` object
- Rule: `sparklineData = null` if fewer than 4 data points (not enough for meaningful polyline)
- Frontend reads `report.data.intentSignals.searchMomentum.sparklineData`

### userActivityLog Firestore Rule (commit 3d105b6)

**`firestore.rules` — new collection rule, append-only, owner-scoped:**
- `allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid`
- `allow read: if isAuthenticated() && resource.data.userId == request.auth.uid`
- `allow update, delete: if false`
- Inserted after `ke_credit_log` rule block

### Team Management Backend — Full Rewrite (commit 11f91c2)

**`functions/routes/teamRoutes.js`** — Full replacement from Schema A to Approach B:
- Schema A (orphaned, no prod data): `teams/{teamId}` + `teamMembers/{membershipId}` + `teamInvites/{inviteId}` — 3 separate collections
- Approach B (live): `teams/{ownerUid}` (doc ID = owner's UID) + embedded `members[]` + `teamInvitations/{autoId}` collection

**Schema:**
- `teams/{ownerUid}`: ownerUid, ownerEmail, ownerDisplayName, members[], memberUids[], createdAt, updatedAt
  - `memberUids[]` flat array maintained in sync with `members[]` — Firestore cannot filter nested object fields in arrays; `memberUids` enables `array-contains` queries
- `teamInvitations/{autoId}`: teamOwnerUid, inviteeEmail, role, status (pending/accepted/expired/declined), createdAt, expiresAt (7-day TTL)

**7 endpoints (all require auth):**
| Method | Path | Notes |
|--------|------|-------|
| GET | `/team` | Returns team + member list; `{}` if no team |
| POST | `/team/invite` | Owner only; lazy-creates team doc on first invite |
| POST | `/team/accept` | Invitee only; adds to members[] + memberUids[] atomically |
| POST | `/team/remove` | Owner only; cannot remove self |
| POST | `/team/update-role` | Owner only; read-modify-write (no atomic array-element update in Firestore) |
| GET | `/team/invitations` | Owner or invitee; expired invitations filtered in JS (avoids composite index) |
| GET | `/team/activity` | Owner only; reads `userActivityLog` via Admin SDK (bypasses Firestore rules for cross-member access) |

**Known limitations:**
- `sendTeamInviteEmail` not implemented — returns `invitationId` for manual sharing (SendGrid key issue)
- `GET /team/activity` uses `in` operator on memberUids — Firestore caps at 10 values, sliced at 10 UIDs
- Admin-invite deferred (owner-only invites for now)

---

## Session — April 7, 2026

### Refactor: L2 Template Generation — Vertex AI Controlled Generation

**Root cause fixed:** Executive Brief fell back to generic boilerplate because:
1. `executiveBriefRenderer.js` looked for `summaryText`/`headlineText`/`narrativeText` but template sections use `summaryBody`/`headlineLine1`/`narrativeBody` — every lookup returned null.
2. Renderer looked for section `whatCustomersLove` but actual section ID is `customerLove`.
3. Legacy batch prompt relied on Gemini returning valid JSON with `indexOf('{')` extraction — Gemini regularly dropped fields, resolver caught with boilerplate defaults.

**New architecture for executive_brief (and future template-based styles):**

#### Structured Generation Helper
File: `functions/services/structuredGeneration.js`

Use `generateStructured()` for **any** Gemini call that needs schema-guaranteed output:
```javascript
const { generateStructured } = require('../services/structuredGeneration');
const result = await generateStructured({
  systemInstruction: 'You are a sales strategist...',
  userPrompt: 'Generate fields for Acme Corp...',
  responseSchema: mySchema,         // see brewhouseResponseSchema.js
  model: 'gemini-3.1-pro-preview',  // or 'gemini-3-flash-preview' for lower cost
  temperature: 0.7,
  maxOutputTokens: 4096
});
// result is a parsed JS object guaranteed to match the schema
```

**SDK used:** `@google/generative-ai` (existing, v0.24.1+) with `responseMimeType: 'application/json'` + `responseSchema`.
**Do NOT use `@google-cloud/vertexai` for this** — it uses different model name conventions and adds new auth complexity. `@google/generative-ai` supports controlled generation natively from v0.13.0+.

**CRITICAL:** On failure, `generateStructured()` throws. Do NOT fall back to unstructured generation — failure means a bug to fix in prompt or schema, not a reason to silently degrade.

#### Schema Files
Directory: `functions/services/templates/`

Create one schema file per template. Schema field names must match template section field IDs so output can be passed directly to `resolveAllSections()` as `aiResults`.

Canonical example: `functions/services/templates/brewhouseResponseSchema.js`
- Used for: executive_brief, and as the base for future one-pager templates
- Schema field → template field ID mapping:
  - `complaintPatterns` (schema) → aliased to `patterns` (template field ID) in buildAndExecuteTemplatePrompt
  - All other fields match directly

#### Routing in templateOnePager.js
```javascript
if (l2StyleEarly === 'executive_brief') {
  aiResults = await buildAndExecuteTemplatePrompt(template, enrichedData.prospect, sellerProfile, enrichedData.analysis);
} else {
  aiResults = await buildAndExecuteBatchPrompt(template.sections, enrichedData, template.generationRules, sellerProfile);
}
```

#### Data Available in Analysis (after enrichment)
Fields now populated by `runTemplateEnrichment()`:
- `positiveSnippets` / `positiveReviews` — 4-5★ review texts (aliases of each other)
- `negativeSnippets` / `negativeReviews` — 1-3★ review texts (3★ included, was 1-2★ before)
- `complaintThemes` — array of strings from Gemini analysis
- `loveThemes` — array of strings from Gemini analysis
- `topComplaintPattern`, `urgencyHook`, `projectedOutcomes` — as before

#### Adding a New Template Style with Controlled Generation
1. Create `functions/services/templates/{styleName}ResponseSchema.js`
2. Add `build{StyleName}Prompt()` function in `templatePromptBuilder.js` (or add to existing)
3. Route in `templateOnePager.js` step 4 based on `l2StyleEarly`
4. Update renderer to use correct field IDs (no fallback boilerplate — empty = debug signal)

---

## Session — April 3–4, 2026

**Deployed to production (functions + hosting). Tier 2 Sprint 1, L2 Style Suite, L3 Data Analyst, David feedback fixes.**

### Critical Bug Fixes (Health Check Audit)
- Fixed: pitchRoutes.handle() wired into dispatch chain — kanban status changes work (C8)
- Fixed: Visitor Intel plan gate — Scale users blocked by upgrade prompt (H1)
- Fixed: Toast.show() → API.showToast() in visitors.js — 7 replacements (C3)
- Fixed: Session-expired redirect /login.html → / (C4)
- Fixed: l2OnePagerRenderer.js tracked in git (C1)
- Fixed: puppeteer-core migration — 300MB lighter deploys (C7)
- Fixed: Cost tracking model string gemini-3-flash → gemini-3-flash-preview (M8)
- Fixed: --radius-md CSS variable added to :root (H3)
- Fixed: Market report delete ownership check (H4)
- Fixed: gemini-2.5-flash-lite → gemini-2.5-flash in all fallbacks (H5)
- Fixed: Firestore rules: websiteVisitors, ipCache, pitchAnalytics (M9/H7)
- Fixed: .env.tmp deleted (M1)
- Fixed: Credit gate fallback — passes prospect data when credits insufficient
- Fixed: User credits reset (Charles Berry + David Hailey both had -5)

### Tier 2 Sprint 1 — Market Intelligence Enhancements

**Item 1: Decision maker enrichment (buyer/check-writer lookup)**
- File: `functions/services/decisionMakerEnrichment.js`
- Owner + buyer Serper queries per lead; buyer search fires for 50+ review businesses
- Multiple contacts: up to 3 owners/partners stored as array
- Department fuzzy matching via DEPARTMENT_ALIASES mapping

**Item 2: Competitor Analysis AI narrative**
- File: `functions/services/narrativeGenerator.js`
- Gemini-generated two-paragraph strategic prose; 20 competitors with seoTier data
- Static fallback ensures section is never blank

**Item 3: Review response rate**
- Files: `functions/api/market.js`, `functions/services/opportunityScorer.js`
- Calculated from DataForSEO `owner_answer` field per review
- Intel Signal: <20% critical, 20-50% moderate, >50% omit
- Opportunity Score +5 bonus for <20% response rate
- SEO Landscape table: new "Resp. Rate" column (red/amber/green)

**Item 4: Review recency badge**
- File: `functions/api/market.js`, `functions/services/opportunityScorer.js`
- `daysSinceLastReview`, `velocityStatus` computed per lead
- Intel Signal velocity alert triggers at 90+ days

### David Hailey Feedback Fixes
- Generate Pitch from lead card: contact, rating, reviews now pass through
- Pre-call brief timeout: 8s per-call wrapper + graceful degradation
- Pre-call brief wiring from Market Intel lead cards
- News dates visible with 90-day staleness indicator
- Seller branding pulls from sellerProfile (logo, colors)
- L3 "Quantify the Solution" JSON extraction: bracket counter + 4096 tokens
- "Back to Report" navigation via sessionStorage
- Market Intel report auto-selects in Import Context on arrival from lead
- Website pass-through from leads to Create Pitch
- Auto-trigger Logo Fetch when website present
- Market intel context injected into pitch generation prompt (`inputs.marketContext`)

### L2 One-Pager Style Suite

**New Files:**
| File | Style |
|------|-------|
| `functions/services/executiveBriefRenderer.js` | executive_brief |
| `functions/services/roiSnapshotRenderer.js` | roi_snapshot |
| `functions/services/battlecardRenderer.js` | competitive_battlecard |
| `functions/services/visualSummaryRenderer.js` | visual_summary |

All wired via `options.l2Style` in `templateOnePager.js`:
```
if (l2Style === 'executive_brief') { renderExecutiveBrief(...) }
else if (l2Style === 'roi_snapshot') { renderROISnapshot(...) }
else if (l2Style === 'competitive_battlecard') { renderBattlecard(...) }
else if (l2Style === 'visual_summary') { renderVisualSummary(...) }
else { renderOnePagerHtml(...) }   // standard
```

`l2Style` derivation in `pitchGenerator.js`:
```javascript
l2Style: body.l2Style || (body.style && body.style !== 'standard' ? body.style : null)
```

Competitor data injected into `inputs.marketContext` when `source === 'market_intel_leads'`:
- `inputs.marketContext.competitors[]` — name, rating, reviewCount, responseRate, seoTier
- `inputs.marketContext.benchmarks`, `.city`, `.industry`, `.seoLandscape`

### L3 Data Analyst Slide Deck

**New File:** `functions/services/dataAnalystDeckRenderer.js`
- `renderDataAnalystDeck(pitch, sellerProfile, marketReport)` → `{ buffer, filename }` (PPTX)
- `renderDataAnalystHTML(pitch, sellerProfile, marketReport)` → HTML string (preview)
- 10 slides using PptxGenJS shapes (not chart API): title, reputation snapshot,
  positioning matrix, head-to-head table, voice of customer, cost of inaction,
  competitive narrative, gap-to-solution map, investment + ROI, next steps

**Modified:** `functions/api/pitch/level3Styles/dataAnalyst.js`
- Replaced ~540-line placeholder HTML with call to `renderDataAnalystHTML()`
- No longer renders blank — uses real market intel data

**Modified:** `functions/api/export.js`
- `generatePPT()` and `prepareCloudExport()` both detect `pitchData.style === 'data_analyst'`
- Routes to `renderDataAnalystDeck()` fetching market report via `pitchData.marketReportId`
- All other styles continue to use existing `pptTemplate`

### News Classification
- `serperClient.js` — new `classifyNewsScope()` function
- Two-section display: "Local Market News — [City]" and "Industry Trends"
- Backward compatible — existing reports without scope default to industry

### Infrastructure
- `IPINFO_TOKEN` added to `.env` (Lite plan)
- Firestore rules updated for new collections
- All Gemini model strings audited: gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash only

### Known Issues (April 4)
- L3 Data Analyst: market leader name may show "Market Leader" — marketReport data path varies
- L3 Data Analyst: opportunity score shows "—" on slide 1 — `pitch.prospect.opportunityScore` not always populated
- Competitive Battlecard + Visual Summary: built and deployed, not yet tested end-to-end in production
- Landing Page generation: Firestore composite index may need manual creation (landingPages: userId + createdAt)
- IPINFO_TOKEN on Lite plan — IP-to-company limited to ISP-level data

---

## Session — March 19, 2026

### Bugs Fixed & Deployed

**Bug: L4 One-Pager generation broken**
File: functions/api/pitchGenerator.js | Commits: 77adfc4 → merged to main a3d32c3
- No case 4 in switch — pitchLevel === 4 fell through to default → generateLevel3()
  (10-12 slide enterprise deck instead of one-pager)
- Fix: added case 4 to generatePitch() switch (line 576)
- Fix: added case 4 to generatePitchDirect() switch (bulk upload path)
- Fix: added generateLevel4() — validates Sales Library has docs, delegates to
  generateLevel2() with salesLibraryContext already populated upstream
- Fix: generateLibraryEnhancedContent() — level === 4 now uses one-pager prompt
  (was using enterprise deck prompt via else branch)
- Sales Library context is fetched upstream in generatePitch() before the switch,
  so generateLevel4() does NOT re-fetch from Firestore

**Bonus: onUserCreated had never deployed**
File: functions/api/auth/welcomeEmail.js
- Importing 'firebase-functions' instead of 'firebase-functions/v1'
- Crashed every deploy silently — welcome emails never sent to any new user
- Fix: corrected import to firebase-functions/v1
- onUserCreated now live for the first time

### Architecture Notes Confirmed
- All pitch logic: exports.api → POST /generate-pitch → pitchGenerator.js
- Formatter (separate path): POST /api/v1/narratives/:id/format/one_pager → formatterApi.js
- Firestore collections: salesDocuments, customerLibraryConfig, pitches
- User logo: users/{uid}.sellerProfile.branding.logoUrl
- generatePitchDirect() — bulk upload switch (now also has case 4)

### Sprint 3+4 — Parallel Prospect Enrichment Pipeline (March 26, 2026)
**PR #5 merged March 26, 2026** — branch `feature/prospect-enrichment`

**New Files:**
- `functions/agents/prospectResearchAgent.js` (560 lines) — Vertex AI Deep Search agent
  (5 tools: google_places_lookup, competitor_scan, website_scrape, news_search,
  gbp_completeness_check). Model: gemini-2.0-flash via agentRunner.js.
  Returns structured PROSPECT_INTELLIGENCE JSON.
- `functions/services/pitchEnricher.js` (225 lines) — Promise.allSettled parallel runner.
  3 sources: prospectResearchAgent, newsIntelligenceAgent, vertexSearch.
  8s timeout per source. Graceful degradation — never blocks pitch generation.
- `functions/services/vertexSearch.js` (127 lines) — Discovery Engine API client.
  Data store: synchintro-knowledge-base_1774560525810 (project pathconnect-442522).
  Methods: searchKnowledgeBase(), groundedSearch().

**Modified Files:**
- `functions/api/pitchGenerator.js` — Wired enrichment pipeline into generatePitch().
  Places enrichment + deep enrichment run in parallel via Promise.allSettled.
  PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt.
  pitchMetadata.enrichment stored on pitch Firestore document.
- `functions/.env` — Added GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX, VERTEX_SEARCH_DATA_STORE_ID

**New Env Vars:**
- `GOOGLE_SEARCH_API_KEY` — for news_search tool (graceful skip if missing)
- `GOOGLE_SEARCH_CX` — Custom Search Engine ID: c0887a1e024af4f45
- `VERTEX_SEARCH_DATA_STORE_ID` — full Discovery Engine data store resource path

**CRITICAL: DO NOT add GOOGLE_APPLICATION_CREDENTIALS to functions/.env**
This crashes ALL Firestore access in Cloud Functions production.
Cloud Functions authenticates automatically via the default service account.
GOOGLE_APPLICATION_CREDENTIALS is only needed for LOCAL DEVELOPMENT and
should be set in your local shell environment, never in the .env file.
Local dev: `$env:GOOGLE_APPLICATION_CREDENTIALS="./pathconnect-442522-ec919d9337b8.json"`

**Architecture:**
- Create Pitch now runs 3 enrichment sources in parallel BEFORE AI synthesis:
  1. Prospect Research Agent (Google Places + competitors + GBP score + website + news)
  2. News Intelligence Agent (already existed in services/newsIntelligenceAgent.js)
  3. Vertex AI Search (knowledge base grounding)
- All run via Promise.allSettled() with 8s timeout per source
- PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt
- Enrichment metadata stored in pitchMetadata.enrichment on pitch Firestore doc
- Credit tracking: prospect_research=50, news_intel=25, kb_search=10

**Bug Fix:**
- Visitor Intel plan gate: `visitors.js` line 70 used `user?.tier || user?.plan` — missed
  `subscription.plan`/`subscription.tier`, blocking Scale users. Fixed to comprehensive pattern.

### Session — March 28, 2026

**Commits:** 19d78c7, b95cd9b — merged to main, deployed to production

**Bug 1 (CRITICAL): Card synthesis prompts silently dropped**
File: functions/api/pitchGenerator.js
- `generateLibraryEnhancedContent()` had two bail-out guards (lines 72, 95) that returned
  null when no Sales Library docs AND no RAG chunks — even when card synthesis instructions
  were present in `prospectIntelBlock`.
- None of the HTML level generators read `options.prospectIntelligenceBlock` directly.
- Fix: Added `hasCardInstructions` check to both guards. Added third fallback branch in
  `generatePitch()` that calls `generateLibraryEnhancedContent()` when card instructions
  exist but no library/RAG.

**Bug 2 (HIGH): generatePitchDirect() missing salesLibraryContext**
File: functions/api/pitchGenerator.js
- Bulk upload path never called `fetchSalesLibraryContext()`. L4 via bulk always threw
  "Your Sales Library is empty."
- Fix: Added fetch + early return for L4 without docs + `generateLibraryEnhancedContent()`
  call before switch. Options now include salesLibraryContext, libraryEnhancedContent,
  useCustomLibrary.

**Bug 3 (ROOT CAUSE for L4): fetchSalesLibraryContext crash on missing config**
File: functions/api/pitch/dataEnricher.js
- `configDoc.data()` returned undefined when `customerLibraryConfig/{userId}` didn't exist.
  `config.companyName` threw TypeError. Catch returned null. Charles Berry had 5 ready docs
  but no config doc — all invisible.
- Fix: `const config = configDoc.exists ? configDoc.data() : {};` + null-coalesce fields.

**Bug 4 (HIGH): L4 output identical to L2**
Files: functions/api/pitchGenerator.js, functions/api/pitch/level2Generator.js
- `generateLibraryEnhancedContent()` used identical system prompt for L2 and L4
  (`else if (level === 2 || level === 4)`).
- `generateLevel4()` just called `generateLevel2()` with zero differentiation.
- Fix: L4 has its own system prompt branch in `generateLibraryEnhancedContent()` that
  instructs AI to use Sales Library as PRIMARY source and returns seller-specific fields:
  sellerProductName, sellerMethodology, proofPoints, caseStudyName, caseStudyResult,
  sellerDifferentiators, solutionOverview, callToAction.
- Fix: `generateLevel4()` passes `pitchLevel: 4` in options.
- Fix: `level2Generator.js` checks `isL4 = options.pitchLevel === 4 && useCustomLibrary`
  and renders L4-specific sections (proof points stats, methodology/differentiators,
  case study block, key benefits grid, seller CTA, "Sales Library Powered" badges).

**KNOWN ISSUE — L4 may still render as L2:**
- The `isL4` check requires BOTH `options.pitchLevel === 4` AND `useCustomLibrary` to be true.
- `useCustomLibrary = options.useCustomLibrary && libraryContent` — if `generateLibraryEnhancedContent()`
  returns null (Gemini call fails, JSON parse fails, etc.), `useCustomLibrary` is false and `isL4`
  is false, causing silent fallback to generic L2 template.
- Debug next session: check if `generateLibraryEnhancedContent()` is actually returning valid JSON
  for level 4 with the new prompt. Check Cloud Functions logs for errors.
- Charles Berry UID: dehiyRBCXcUUM72O211S27lfXbl1 — 5 ready docs, NO customerLibraryConfig doc.

### Sprint 4 — Market Intel Full Enrichment (March 28, 2026)

**Commits:** e5c1170, 3738eeb — merged to main, deployed to production

**New File:**
- `functions/services/theOrgClient.js` — TheOrg API client for enterprise decision maker lookup.
  Searches organizations by name, fetches people, filters by decision-maker titles (C-Suite, VP,
  Director, etc.). Env: THEORG_API_KEY (Secret Manager only, NOT in .env).

**Modified Files:**

**functions/index.js**
- Added `THEORG_API_KEY` to secrets array. SERPER_API_KEY is already in `.env` — adding it to
  secrets causes deploy failure ("Secret environment variable overlaps non secret environment
  variable"). Only add secrets that are NOT in .env.

**functions/services/serperClient.js** — 4 new exported functions:
- `searchFastestGrowingCommunities(city, state, industry)` — 3 parallel Serper searches for
  growing neighborhoods/suburbs, population growth by zip, and industry demand. Returns top 5
  communities by mention frequency + growth signals for top 3.
- `searchAreaIncome(city, state)` — Median household income search, returns top 3 sources.
- `enrichLeadOwner(businessName, city)` — 3 sequential queries (owner, founder/operator,
  LinkedIn) to find business owner name, title, and LinkedIn URL. 200ms delay between queries.
- `searchMarketTrends(city, state, industry)` — 5 parallel searches: demand, new openings (news),
  closings (news), hiring, seasonal patterns. Returns categorized signal arrays.

**functions/api/market.js** — 2 new Gemini functions + enrichment pipeline:
- `generateSalesIntel()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON: topPainPoints,
  objectionResponses, entryWedge, bestTimeToCall, competitorVulnerability, talkingPoints.
- `generateRecommendations()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON:
  priorityActions (rank/action/businessName/reason/openingLine/timing), weeklyGoal,
  sequenceRecommendation, expectedOutcome, quickWin.
- Lead owner enrichment: top 5 serperLeads enriched with ownerName/ownerTitle/linkedInUrl via
  Promise.allSettled before report document creation.
- Parallel AI block expanded: now runs 6 tasks in parallel — aiSummary, competitorAnalysis,
  demographicsCommunities, marketTrends, salesIntel, (placeholder). Recommendations run
  sequentially after salesIntel resolves (needs salesIntel.entryWedge).
- New fields on reportData.data: demographicsCommunities, trends, salesIntel, aiRecommendations.
- Library auto-save content updated with all 4 new data fields.

### Sprint — SEO Landscape (March 28, 2026)

**Commits:** 50c2c6f (bundled with SWOT) — deployed to production

**Modified: functions/api/market.js**
- `calculateSEOLandscape(competitors)` — scores top 10 competitors on rating (25pts),
  review volume (25pts), website presence (20pts), phone/GBP completeness (10pts),
  address (10pts), review response proxy (10pts). Returns tier (strong/moderate/weak),
  signals array, opportunity text, market insight summary.
- Called after benchmarks, before parallel AI block.
- `seoLandscape` included in reportData.data and Library auto-save content.

### Planned (not built)
- Pitch Quality Agent (Vertex AI)

---

## Session — March 29, 2026

**Commits:** Deployed to production (functions + hosting)

### New Files Created

| File | Purpose |
|------|---------|
| `functions/services/opportunityScorer.js` | 5-component opportunity score + Intel Signal generator |
| `functions/services/seoLandscape.js` | `calculateSEOLandscape()` (extracted from market.js) |
| `functions/services/swotGenerator.js` | `generateSWOT()` (extracted from market.js) |
| `functions/services/narrativeGenerator.js` | `generateAIExecutiveSummary()`, `generateCompetitorAnalysis()` |
| `functions/services/salesIntelGenerator.js` | `generateSalesIntel()`, `generateRecommendations()` |
| `functions/services/verticalConfigs.js` | 6 vertical configs + `detectVertical()` + `buildVerticalContext()` |
| `functions/services/verticalQuestions.js` | Dynamic pre-generation questions + fallback templates |

### API Endpoints Added

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/market/questions` | AI-generated precision targeting questions (gemini-2.5-flash, 3s timeout) |
| GET | `/market/questions/fallback` | Hardcoded vertical question templates |

### Key Architectural Decisions

- **ICP filter** is user-configurable toggle, NOT hardcoded (supports Countifi enterprise use case)
- **Opportunity Score v2** INVERTS review count: low reviews = high score (businesses that need PathSynch most)
- **Intel Signals** replace Pitch Hooks: data-specific gap observations for sales rep, not sales copy
- **Vertical configs** auto-detect and inject industry-specific context into all AI prompts
- **market.js** refactored from 1200+ lines to ~860 lines via service extraction
- **PDF export** moved to client-side html2pdf.js (Puppeteer unavailable in Cloud Functions 2nd Gen)
- **All exports fixed**: PDF, PPTX, Google Slides, Google Drive, OneDrive — `Toast.show()` → `API.showToast()` (26 instances)
- **Six Smart Mode cards** produce six visually distinct report types via card-specific system prompts + HTML templates
- **Positioning Matrix**: `positioningMatrix` data object on Market Intel report. SVG scatter plot (rating vs reviews) with opportunity zone, crosshairs, tooltips
- **News signal geographic filter**: state parameter + `isGeographicallyRelevant()` post-filter
- **Dynamic Pre-Generation Questions**: AI-generated via gemini-2.5-flash with hardcoded vertical fallback

### Opportunity Score v2 (5-component formula)

| Component | Range | Description |
|-----------|-------|-------------|
| A: Rating Quality Gap | 0-30 | How far above 4.0★ |
| B: Presence Gap | 0-30 | INVERTED — low review count = HIGH score |
| C: Review Velocity Gap | 0-20 | Recency of last review from DataForSEO |
| D: SEO Tier Gap | 0-10 | Below market average = more opportunity |
| E: Signal Bonus | 0-10 | Award/opening/hiring news triggers |

Interpretation: 80-100 Priority, 60-79 Strong, 40-59 Moderate, <40 Monitor

### Vertical Configs (6 verticals)

| Vertical | Review Ceiling | Key Fields |
|----------|---------------|------------|
| food_beverage | 400 | painPoints, pitchAngle, recommendedProducts, avgTicket, CLV, seasonalTriggers, icpSignals |
| professional_services | 150 | (same fields, industry-specific values) |
| automotive | 300 | " |
| health_beauty | 250 | " |
| retail | 200 | " |
| home_services | 350 | " |

Auto-detected via `detectVertical()` fuzzy-matching from industry/subIndustry/businessName keywords.
Injected into: pitchGenerator.js, market.js ICP filter, salesIntelGenerator.js, opportunityScorer.js.

### DataForSEO Integration

- `getGoogleReviews()` — Real review data (rating, count, 3-5 snippets) on top 5 Market Intel leads. Parallel `Promise.allSettled`. Graceful fallback.
- `getLocalSERPRankings()` — Google Maps pack rankings in SEO Landscape. Position, business name, rating, review count for up to 10 results.

### Six Smart Mode Card Types (CARD_SYSTEM_PROMPTS)

| Card | Focus | Schema |
|------|-------|--------|
| card1 | Competitor Landscape | competitors[], ratingGap, valueGap, pitchHooks |
| card2 | Reputation Health | reviewVelocity, responseRateGap, complaintPatterns, sentimentBreakdown |
| card3 | Market Opportunity | tamEstimate, opportunityScore, marketSaturation, growthRate |
| card4 | Pre-Call Brief | companySnapshot, meetingTrigger, talkingPoints[], objections[] |
| card5 | Referral Potential | currentMonthlyReferrals, potentialMonthlyReferrals, rewardStructure |
| card6 | GBP Audit | gbpScore, dimensions[], quickWins, fullOptimizationPlan |

### Firestore Index Created

- `events` collection: composite index (eventType ASC + timestamp DESC) for Smart Mode preferences query

### Tier 2 Sprint 1 — Lead Enrichment + Review Intelligence (March 29, 2026)

**New File:**
- `functions/services/decisionMakerEnricher.js` — Gemini-powered decision maker extraction.
  `serperQuickSearch()` (standalone lightweight Serper search) + `extractPersonFromSnippets()`
  (gemini-2.5-flash, thinkingBudget:0, temperature:0, maxOutputTokens:100).
  Two sources: direct owner/founder search, website about-page search.
  `enrichDecisionMaker(leadName, city, state, website)` → `{ name, title, source, confidence }`.
  3s timeout per lead via Promise.race. Graceful null return on failure.

**Modified Files:**

**functions/api/market.js** — Decision maker enrichment + review response rate:
- Removed old regex-based `enrichLeadOwner` block (was top 5 pre-ICP, Serper-only)
- Added Gemini-powered DM enrichment post-ICP/post-scoring on top 10 qualified leads
- Runs as `dmEnrichmentPromise` in parallel with AI block, awaited before Firestore save
- Sets `lead.decisionMaker` object + backward-compat `lead.ownerName`/`lead.ownerTitle`
- DataForSEO review mapping now calculates `responseRate` and `respondedCount` from
  individual review `ownerResponse` fields. Also passes `hasOwnerResponse` per review.

**functions/services/narrativeGenerator.js** — Competitor analysis prompt rewrite:
- Model: gemini-3-flash-preview (unchanged)
- Shows top 10 competitors (was top 5)
- Prompt completely rewritten: archetype-based structure
  - Paragraph 1: Market Structure — identify 2-3 competitive archetypes, name specific businesses,
    volume vs quality separation, dominated vs fragmented assessment
  - Paragraph 2: Opportunity Pattern — gap pattern, quality-without-presence businesses,
    ends with usable conversation opener for sales rep
- Constraints: 120 words/paragraph, 3+ named businesses, no generic data-description phrases

**functions/services/opportunityScorer.js** — Intel Signal enrichment:
- `generateIntelSignal()` gained 2 new lines (before existing review snippet):
  - Line 5: Review response rate — shown only when `responseRate < 30%`
    Format: `Response rate: X% — review engagement gap detected.`
  - Line 6: Review velocity alert — shown when last review > 60 days ago
    Format: `Review velocity alert: last review X days ago — dormant engagement.`

### Bug Fix — Positioning Matrix Syntax Error (March 29, 2026)

**File: synchintro-app/js/pages/market.js (line 1719)**
- DataForSEO review block was OUTSIDE the `.map()` callback scope
- `.map()` closed at line 1701, then `${lead.dataForSEO ? ...}` referenced `lead` (out of scope)
- Orphaned `` `).join('')} `` at line 1719 caused `SyntaxError: Unexpected token ')'`
- Fix: moved DataForSEO block back inside `.map()` return template before callback closes
- Market Intel page was completely broken — now fixed

### Known Issues (March 29, 2026)

- **Executive summary leader misidentification**: AI summary sometimes picks first competitor
  as "market leader" instead of actual highest-rated. Narrative prompt may need to explicitly
  receive the market leader object rather than relying on Gemini to identify it from the data.
- **ICP filter vertical ceiling not applying for all verticals**: Nashville Salon report showed
  leads with 1,100+ reviews passing through a 250-review ceiling. Investigate whether
  `detectVertical()` is matching "Salon & Beauty" to the `health_beauty` config.
- **L4 may still render as L2** (from March 28): `isL4` requires both `pitchLevel === 4` AND
  `useCustomLibrary` to be true. If `generateLibraryEnhancedContent()` returns null, silent
  fallback to generic L2 template.

---

## GEMINI MODEL RULES (Updated March 29, 2026)

### Model Hierarchy
- gemini-3-flash-preview — PRIMARY model for fast tasks (reasoning, synthesis, pitch gen, simple agents)
  Used in: geminiClient.js, geminiClientV2.js, agentRunner.js, config/gemini.js primary tier

- gemini-3.1-pro-preview — ADVANCED model for complex reasoning (multi-step analysis, intelligence synthesis, agentic orchestration)
  Note: "gemini-3.1-pro-preview-customtools" does NOT exist — use gemini-3.1-pro-preview

- gemini-2.5-flash — SIMPLE TASKS model (email, SVG, trigger extraction, question generation)
  Used in: shareEmailGenerator.js, geminiVisuals.js, index.js trigger extraction, config/gemini.js economy tier

- gemini-2.5-flash-lite — BUDGET model for high-volume low-complexity tasks
  Used in: config/gemini.js fallback tier

### Model Rules
- NEVER use gemini-1.5-pro or gemini-1.5-flash — DEAD (404)
- NEVER use gemini-2.0-flash — DEPRECATED, shuts down June 1 2026
- NEVER use gemini-2.0-flash-exp — DEPRECATED
- NEVER use gemini-3-pro-preview — SHUT DOWN March 9 2026
- When in doubt, use gemini-3-flash-preview
- gemini-3-flash-preview or higher = KEEP, never downgrade
- GEMINI_MODEL env var controls geminiClient.js default — currently set to gemini-3-flash-preview in .env

### JSON Output Rules (Critical for 3.x models)
- Gemini 3.x models have thinking enabled by default
- Thinking tokens leak before JSON output causing parse failures
- Always add thinkingBudget: 0 when expecting JSON output:
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
- Always extract JSON using indexOf('{') / lastIndexOf('}')
  NOT by stripping markdown fences alone
- Always start system prompt with:
  "IMPORTANT: Output ONLY a valid JSON object.
   Start your response with { and end with }.
   Do not include any explanation or text outside the JSON."
- Leave thinking ENABLED (no thinkingConfig) for:
  pitch synthesis, agent reasoning, pre-call briefs

---

## Session — March 30, 2026

**Deployed to production (functions + hosting). Market Intelligence Report — FEATURE COMPLETE.**

### Pre-Tier 3 Fixes (Items 1-4)

**1. ICP ceiling hard exclusion**
File: `services/verticalConfigs.js`, `api/market.js`
- Added missing keywords to `health_beauty` vertical config
- Added `else if (verticalConfig)` branch that enforces ceiling even without explicit ICP toggle
- Fix for Nashville Salon report showing 1,100+ review leads passing 250-review ceiling

**2. Market leader identification (initial fix)**
Files: `services/narrativeGenerator.js` (2 locations), `api/market.js`
- Replaced `competitors[0]` with proper sort by rating (desc) then review count (desc)
- Applied in `calculateMarketBenchmarks()` and both narrative generator leader selections
- Later superseded by composite score in item 22

**3. News signal → Opportunity Score cross-reference**
File: `api/market.js`
- Cross-reference loop matching `newsSignals` to `serperLeads` by business name BEFORE `scoreLeads()` runs
- `classifySignalType()` helper categorizes signals (award, opening, hiring, expansion)
- Matching signals boost Opportunity Score component E (Signal Bonus)

**4. News signal deduplication**
File: `api/market.js`
- Deduplicates signals by title (case-insensitive) after Serper fetch
- Prevents same news article appearing multiple times from different search queries

### Sprint 2A — Demographics Enrichment (Item 5)

**New File:**
- `functions/services/demographicsEnricher.js` — US Census ACS API (free, no key required).
  `enrichDemographics(city, state)` fetches population, median income, median home value.
  `parseGrowthFromSnippets()` extracts growth %, population gains from Serper editorial snippets.
  Returns `{ population, medianIncome, medianHomeValue, growthIndicators[] }`.

**Modified:** `api/market.js` — Wired into parallel enrichment block. Demographics data stored
on `reportData.data.demographics`. Frontend renders City Demographics card, community pills
with green growth badges, growth signal cards with structured data.

### Sprint 2B — Share of Voice (Item 6)

**Modified:** `api/market.js`, `services/opportunityScorer.js`
- Share of voice: `reviews / totalMarketReviews × 100` for all competitors + leads
- Added to: Competitors table (Voice column), Market Benchmarks (Leader Voice Share card),
  Intel Signals (<1% share line), positioning matrix tooltips, leads table (color-coded badges)
- Fixed positioning matrix rendering which was getting undefined data from missing voice values

### Sprint 2C — PathManager Benchmark Feed (Item 7)

**Modified:** `api/market.js`, `index.js`
- `writeMarketBenchmark()` writes to `marketBenchmarks` Firestore collection on every report generation
- 30-day TTL via Firestore TTL policy
- Benchmark document includes: avg rating, reviews, market leader, ICP median, share of voice,
  SEO landscape tier, Census demographics, market saturation index
- Two new read endpoints (public, no auth required):
  - `GET /benchmarks/:industry/:city/:state` — exact match
  - `GET /benchmarks/search` — fuzzy search with query params

**New Firestore Collection:**
- `marketBenchmarks/{industry}_{city}_{state}` — cross-product benchmark data (30-day TTL)
- Firestore rules: public read, admin-only write
- Composite indexes for search queries

### Tier 3 Part A Fixes (Items 8-11)

**8. Duplicate business deduplication**
File: `api/market.js`
- `normalizeBusinessName()` — strips Inc/LLC/Corp suffixes, lowercases, trims
- `deduplicateLeads()` — merges duplicates, keeps higher-scoring instance
- `deduplicateCompetitors()` — same logic for competitor array
- Runs after Places API fetch, before scoring

**9. News signal hard reject list**
File: `api/market.js`
- 13 source domains rejected (IndexBox, GlobeNewsWire, MarketWatch press releases, etc.)
- Global market patterns rejected ("CAGR", "2030-2035", "market size", "forecast")
- Off-topic patterns rejected (national chains, stock market, unrelated industries)

**10. Award signal business name match required**
File: `api/market.js`
- `matchSignalToLead()` — scores signal relevance per lead
- Business name exact match = 10pts, industry keyword = 3pts, geography alone = 0pts
- Signals with 0pts are not attributed to any lead

**11. Precision questions driven by Sub-Industry**
Files: `services/verticalQuestions.js`, frontend
- `onSubIndustryChange()` fires questions based on sub-industry selection
- 16 sub-industry templates added to `verticalQuestions.js` (was 6 vertical-level only)
- Questions are more specific: "Thai restaurant" gets different questions than "Pizza shop"

### Tier 3 Sprint 1 — Enhancements (Items 12-15)

**12. Pre-Call Form trigger from leads**
File: `api/market.js` (endpoint), frontend
- Per-lead button navigates to `/#precall` with data pre-filled
- Passes: businessName, contactName (from decisionMaker), industry, location, website
- `createPreCallFromLead()` frontend handler

**13. Lead color palette system**
- 4px left border + tier label on lead cards
- Priority (green #10B981), Strong (teal #14B8A6), Moderate (amber #F59E0B), Monitor (gray #6B7280)
- `getLeadTier()` maps Opportunity Score ranges to tier names

**14. Competitor Types visual section**
Files: `services/salesIntelGenerator.js`, frontend
- Gemini generates `competitorTypes[]` array (2-4 archetypes per market)
- Each archetype: name, description, exampleBusinesses[], opportunityLevel
- Rendered as cards with "PathSynch ICP" badge on high-opportunity types
- Positioned between Competitor Analysis and SEO Landscape sections

**15. High-Impact Moves**
File: `services/salesIntelGenerator.js`
- `generateHighImpactMoves()` — gemini-3-flash-preview generates 3-5 sequenced strategic moves
- Each move: title, context, action, timing, expectedOutcome
- Replaces old Recommendations section when present (true fallback pattern)
- Data-driven: references specific leads, scores, and Intel Signal gaps

### Sprint 2B Session 1 — GBP + Sentiment (Items 16-17)

**16. GBP Completeness Signals**
File: `api/market.js`
- `getBusinessInfo()` calls DataForSEO `/business_data/google/my_business_info/live`
- `calculateGBPCompleteness()` scoring: photos (30pts), hours (20pts), claimed (20pts),
  website (15pts), phone (15pts)
- Intel Signal lines added for GBP gaps (missing photos, no hours, unclaimed)
- Stored in `services/opportunityScorer.js` via `calculateGBPCompleteness()`
- Exported from `opportunityScorer.js`, called in `adjustSEOScoreForPhotos()`

**17. Review Sentiment Extraction**
**New File:** `functions/services/sentimentExtractor.js`
- Gemini extracts from review text: `praiseThemes[]`, `complaintThemes[]`, `standoutPhrase`
- Model: gemini-3-flash-preview with thinkingBudget:0
- Called per lead (top 10 qualified) with DataForSEO review snippets as input
- Frontend: CUSTOMERS SAY section (praise pills green, complaint pills red, standout quote teal)

### Sprint 2B Session 2 — Operational Layer (Items 18-21)

**18. Report Refresh**
Files: `api/market.js`, `index.js`
- `POST /market/refresh/:reportId` — re-runs full enrichment pipeline on existing report
- 50 credits per refresh
- Updates existing Firestore document in place (preserves reportId, shareId)
- Freshness badges: green (≤14d), amber (≤30d), red (>30d)
- Refresh button appears at 15+ days, stale banner at 30+ days

**19. LinkedIn URL Enrichment**
File: `services/decisionMakerEnricher.js`
- `findLinkedInURL()` — two-query Serper search (company + person name)
- Returns LinkedIn profile URL or null
- Blue LinkedIn badge on lead cards (links to profile)

**20. Time in Business Signal**
File: `services/decisionMakerEnricher.js`, `services/opportunityScorer.js`
- `findTimeInBusiness()` — Serper search for founding date / years in business
- `classifyVelocity()` — Reviews/year: High velocity (≥30), Moderate (≥10), Low (≥5), Stalled (<5)
- Intel Signal LINE 10: "Est. X years — Y reviews/year (velocity classification)"

**21. Pre-Call Brief Auto-Attach**
Files: `api/market.js`, `index.js`
- `GET /market/match` — scores existing reports by city + state + industry
- Returns matching report when similarity score ≥ 50
- Pre-Call Form auto-attaches market intelligence from matched report

### Sprint 4 Session 1 — Rendering Fixes (Items 22-25)

**22. Market leader composite score**
Files: `services/opportunityScorer.js`, `services/narrativeGenerator.js` (2x),
`services/salesIntelGenerator.js`, `api/market.js`
- `identifyMarketLeader(competitors)` — composite: `((rating - minRating) / ratingRange) * 0.4 + (reviews / maxReviews) * 0.6`
- `getDominanceLanguage(leader, marketAvgReviews)` — ratio ≥3: "dominates", ≥1.5: "leads", else: "edges out the field in"
- Replaced rating-first sort in 4 locations (narrativeGenerator.js ×2, salesIntelGenerator.js ×1, market.js ×1)
- Executive summary prompt uses dynamic `dominanceVerb`

**23. Signal cross-reference tightening**
File: `api/market.js`
- `getIndustryKeywords()` upgraded from single-word to multi-word terms
  (e.g., 'food' → 'food service', 'restaurant opening')
- `trendBonusAwarded` flag — industry trend bonus applied to FIRST matching lead only
- Prevents score inflation from one industry trend boosting all leads

**24. High-Impact Moves for all verticals**
Files: `services/salesIntelGenerator.js`, frontend `js/pages/market.js`
- Confirmed backend already calls HIM unconditionally (no vertical gating)
- Frontend changed: HIM takes priority over Recommendations (true fallback)
- If HIM exists → render HIM. If not → fall back to Recommendations.

**25. Competitor Types + HIM in PDF export**
File: frontend `js/pages/market.js`
- Added Competitive Archetypes table to `downloadReport()` HTML builder
- Added High-Impact Moves section with styled cards
- HIM replaces Recommendations in PDF when present (same fallback pattern as UI)

### Sprint 4 Session 2 — CRM Integration / FINAL SPRINT (Items 26-27)

**26. Attio CRM Push**
**New File:** `functions/services/attioClient.js` (~173 lines)
- Uses Attio V2 REST API (`https://api.attio.com/v2`) with native `fetch` (Node 22)
- `pushLeadToAttio(lead, report)` — Creates Company record + Person record + Intel Signal note
- `pushAllLeadsToAttio(leads, report)` — Bulk push with concurrency limit of 3, 500ms delay
- `buildAttioNote(lead, report)` — Multi-line plaintext note with full enrichment data
- Routes: `POST /attio/push-lead`, `POST /attio/push-all`
- Env: `ATTIO_API_KEY` in `.env` (NOT in secrets[])

**27. Instantly Sequence Trigger**
**New File:** `functions/services/instantlyClient.js` (~100 lines)
- Uses Instantly V1 API (`https://api.instantly.ai/api/v1`) with native `fetch`
- **SEPARATE** from existing `instantlyService.js` (which uses per-user API keys for pre-call brief flow)
- `getInstantlyCampaigns()` — Fetches up to 20 campaigns
- `pushLeadToInstantly(lead, campaignId, report)` — 7 custom variables from Intel Signal
- `pushLeadsToInstantly(leads, campaignId, report)` — Sequential with added/skipped/failed tracking
- Routes: `GET /instantly-market/campaigns`, `POST /instantly-market/push-leads`
- Route prefix: `/instantly-market/*` to avoid collision with existing `/instantly/*`
- Env: `INSTANTLY_API_KEY` in `.env` (NOT in secrets[])

### New Files Summary (March 30)

| File | Purpose |
|------|---------|
| `functions/services/demographicsEnricher.js` | Census ACS API enrichment (population, income, home value, growth) |
| `functions/services/sentimentExtractor.js` | Gemini review sentiment extraction (praise, complaints, standout) |
| `functions/services/attioClient.js` | Attio V2 CRM client (Company + Person + Intel Signal note) |
| `functions/services/instantlyClient.js` | Instantly V1 market intel client (campaigns + lead push) |

### New Env Vars (March 30)

| Var | Location | Purpose |
|-----|----------|---------|
| `ATTIO_API_KEY` | `.env` only (NOT secrets[]) | Attio CRM API authentication |
| `INSTANTLY_API_KEY` | `.env` only (NOT secrets[]) | Instantly market intel push (separate from per-user Instantly integration) |

### New API Endpoints (March 30)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/market/refresh/:reportId` | Report refresh (50 credits) |
| GET | `/market/match` | Pre-call brief auto-match by city/state/industry |
| GET | `/benchmarks/:industry/:city/:state` | PathManager benchmark read |
| GET | `/benchmarks/search` | Benchmark fuzzy search |
| POST | `/attio/push-lead` | Single lead CRM push to Attio |
| POST | `/attio/push-all` | Bulk lead CRM push to Attio |
| GET | `/instantly-market/campaigns` | List Instantly campaigns (market intel) |
| POST | `/instantly-market/push-leads` | Push leads to Instantly sequence |

### New Firestore Collections (March 30)

| Collection | Key | TTL | Purpose |
|------------|-----|-----|---------|
| `marketBenchmarks/{industry}_{city}_{state}` | industry + city + state | 30 days | Cross-product benchmark data for PathManager |

### Known Issues Resolved (March 30)

| Issue | Resolution |
|-------|-----------|
| Executive summary leader misidentification | Fixed by `identifyMarketLeader()` composite score (item 22) |
| ICP vertical ceiling bypass | Fixed by hard exclusion branch (item 1) |

### Architecture Notes (March 30)

- **Two Instantly integrations coexist:** `instantlyService.js` (per-user API keys, pre-call brief flow, `/instantly/*` routes) and `instantlyClient.js` (global API key, market intel push, `/instantly-market/*` routes). Do NOT merge them.
- **Native fetch preferred:** New services (`attioClient.js`, `instantlyClient.js`) use Node 22 built-in `fetch`. Older services use axios or node-fetch. Do not refactor existing services to match.
- **Market Intelligence is FEATURE COMPLETE** as of this session. No further sprints planned. Next priorities: Chrome Extension, Universal Onboarding, Multi-agent pipeline refactor.

---

## Session — April 17, 2026

### Entity360 Account360 Integration

**New file:** `functions/utils/entity360Service.js`
- `syncReportToAccount360(reportData)` — creates or updates Account360
  document in Entity360 after every Market Intelligence Report generation
- `syncOutboundStatus(accountId, updateType, payload)` — updates Attio/
  Instantly push status in Entity360 after SynchIntro executes pushes
- `buildSyncPayload()` — maps SynchIntro report fields to Entity360
  provenance format (sourceTier: 2, confidence: 0.8)
- All fetch calls pass `Authorization: Bearer ENTITY360_INTERNAL_API_KEY`

**Modified:** `functions/api/market.js`
- Import added: `const { syncReportToAccount360 } = require('../utils/entity360Service')`
- Non-blocking `.then().catch(() => {})` call after report Firestore write at line ~1440
- Maps serperLeads[0] (highest opportunity-scored lead) to Entity360 sync payload
- Entity360 failure never throws to caller — report generation completes normally

**New env vars in `functions/.env`:**
- `ENTITY360_SERVICE_URL=https://entity360-218613212853.us-central1.run.app`
- `ENTITY360_INTERNAL_API_KEY` — service-to-service auth key (matches INTERNAL_API_KEY on Cloud Run)

SynchIntro is the intelligence push layer — Entity360 never calls back.

---

## PathSynch Admin Panel (April 20, 2026)

PathSynch Admin Panel is a **separate product** hosted on the PathManager backend. It is NOT part of this Firebase project.

- **Repo**: `PathSynch-CEO/pathsynch-admin` (GitHub private)
- **Routes file**: `src/v1_0/api/admin/adminRoutes.js` in `PathManager_backend` repo
- **Mounted at**: `/api/admin` on PathManager backend EC2 (`3.88.108.6:3000`)
- **Auth**: `x-admin-key` request header — separate `ADMIN_API_KEY` env var, **not** Firebase Auth
- **Data source**: `col_users` MongoDB collection via the PathManager merchant model (primary DB connection)

No SynchIntro Firebase functions are called by the admin panel. The admin panel does not interact with Firestore, Firebase Auth, or any `pathsynch-pitch-creation` project resources.

---

## Competitive Intelligence & Integration Radar (April 21, 2026)

### Adjacent / Competitive Landscape

**Eragon AI** (`eragon.ai`)
- Enterprise AI OS. $12M seed, $100M post-money valuation. CEO: Josh Sirota (ex-Oracle, ex-Salesforce). LAUNCH batch 34.
- Post-trains Qwen/Kimi models on customer data. $5/M tokens pricing.
- **ICP:** Enterprise — not direct competition with SynchIntro's SMB ICP.
- **Strategic relevance:** "Own your intelligence" thesis directly validates the Entity360 + Merchant Memory Framework direction SynchIntro is building toward at the merchant level. Partnership ecosystem model (they integrate with CRMs/ERPs) worth studying.
- **Action:** Monitor; not a partnership target given enterprise vs SMB ICP gap.

### Integration Partners Under Evaluation

**Orange Slice AI** (`orangeslice.ai`)
- Agentic sales enrichment spreadsheet. YC S25, $5.3M seed. Founders: Vihaar Nandigala, Kishan Sripada.
- Clay alternative with TypeScript-first architecture. 100+ enrichments, waterfall across 50+ sources.
- **Stack overlap:** Integrates natively with Attio + Instantly — both already in SynchIntro's stack.
- **API status:** No public API as of April 2026. Webhook inbound supported.
- **Outreach:** Initiated contact with Vihaar Nandigala (April 2026).
- **Three integration concepts under evaluation:**
  1. **Lead buckets** — "Expand List" button on Market Intel reports pulling 25–1,000 enriched leads.
  2. **Additional report types** — Competitive Deep Dive, E-commerce Landscape, Hiring Signal Scan as new dropdown options on the Market Intel form.
  3. **Onboarding enrichment** — auto-enrich new merchant's prospect list during onboarding flow.
- **Status:** Concepts only. No implementation started. Blocked on API availability.

---

## Session — April 22, 2026 (Evening)

### Server-Side Pricing Calculator — Multi-Location & Integrations

**File: `functions/api/pitchGenerator.js`**

Extended the pricing calculator post-loop block:

**`per_unit` case update:** Products whose name contains "integration" now skip the automatic `perUnitPrice` → `totalMonthly` addition. Instead they emit a descriptive line item (`first 3 free, +$X/mo each additional`), leaving all arithmetic to the `integrationCount` post-loop block. This prevents double-counting when `integrationCount` > 0.

**Integrations post-loop block (new):**
```javascript
const integrationCount = Math.max(0, parseInt(body.integrationCount) || 0);
if (integrationCount > 0) {
    const integrationProduct = rawSelectedProducts.find(p =>
        (p.productName || p.name || '').toLowerCase().includes('integration')
    );
    const unitPrice = parseFloat(integrationProduct?.perUnitPrice) || 19;
    const additionalCost = integrationCount * unitPrice;
    totalMonthly += additionalCost;
    lineItems.push(`${integrationCount} additional integration${integrationCount !== 1 ? 's' : ''} — $${additionalCost}/mo`);
}
```

Runs BEFORE the `locationCount` multiplier so multi-location correctly scales integrations.

**Location multiplier (no change to logic, clarification):**
```javascript
const locationCount = Math.max(1, parseInt(body.locationCount) || 1);
if (locationCount > 1) {
    totalMonthly = totalMonthly * locationCount;
    totalSetup   = totalSetup   * locationCount;
    inputs.locationCount = locationCount;
}
```

**Pricing order of operations:** Per-product loop → integrations add-on → location multiply → set `inputs.monthlyTotal` / `inputs.setupFee`.

### Template Section Resolver — selectedProducts Priority

**File: `functions/services/templateSectionResolver.js`**

`product_line_items` case now checks `dataContext.pitch.selectedProducts` before falling back to AI-generated `solutionPackage.products`:

1. `resolvePath(dataContext, field.source)` — template-defined source path
2. `dataContext.pitch.selectedProducts` — actual user selection from server calc
3. `aiResults.solutionPackage.products` — AI fallback (last resort only)

Prevents hallucinated product names (e.g., "PathConnect Growth" when only "PathConnect Starter" was selected).

### Previously Documented — Morning Session (same date)

See earlier April 22, 2026 entry for: `custom` pricing fix (`setupFee` + `oneTimeFee`), landing page complaint themes override, `landingPageRoutes.js` `pitchData.html` fix.

### Deployed

Functions deployed — both morning and evening changes live as of April 22, 2026.


---

## Session — April 24, 2026

**Deployed to production (functions). Prospect Intel enrichment pipeline — M1-1 through M1-3 backend complete. Google Places fallback added.**

### New Files

| File | Purpose |
|------|---------|
| `functions/services/prospectIntelService.js` | Core enrichment service — batch creation, Cloud Tasks fan-out, agent calling, Fit Score engine, credit deduction |
| `functions/routes/prospectIntelRoutes.js` | 6 REST endpoints under `/prospect-intel/*` |

### Prospect Intel Service (`prospectIntelService.js`)

**Exports:**

| Export | Description |
|--------|-------------|
| `calculateFitScore(agentData, csvData, icpProfile)` | Scores 0-100 against 7 ICP buying signals; returns fitScore, fitLabel, signalHits, disqualified, disqualifyReason |
| `classifyRecommendedProduct(agentData, productFocus)` | Maps enrichment signals to PathSynch product recommendation |
| `buildSourceAttribution(value, source, confidence)` | Wraps field value in provenance schema { value, source, confidence, updatedAt, failureReason } |
| `callResearchAgent(businessName, city, state)` | POSTs to Cloud Run agent at PROSPECT_AGENT_URL, 30s timeout |
| `processOneProspect(batchId, prospectId)` | Full enrichment pipeline for a single prospect (read -> agent -> Places fallback -> score -> write) |
| `deductProspectCredits(userId, count, batchId)` | 15 credits/prospect from users/{uid}.credits; logged to creditLedger with idempotency key |
| `enqueueProspectTask(batchId, prospectId)` | Creates Cloud Tasks HTTP task -> processProspectTask Cloud Function |

**Fit Score buying signals (7):**

| Signal Key | Weight | Condition |
|-----------|--------|-----------|
| low_rating | 25 | googleRating > 0 && googleRating < 4.3 |
| low_reviews | 20 | totalReviews < 50 |
| incomplete_gbp | 15 | No GBP or missing city address |
| outdated_website | 15 | No website or websiteUrl === "None" |
| no_review_response | 15 | reviews < 20 && rating < 4.0 |
| owner_title | 10 | Contact title matches ICP targetTitles |
| industry_match | 10 | Prospect industry in ICP industries |

**Disqualification checks (run before scoring):**
- high_rating: rating >= 4.8 AND reviews >= 500 -> fitScore: 0
- too_large: reviews > 200 -> fitScore: 0
- franchise_corp: name contains "franchise"/"corporate" patterns -> fitScore: 0

**Fit labels:** Strong Fit (>=70) | Good Fit (>=50) | Moderate Fit (>=30) | Low Fit (<30)

### Google Places Fallback in `processOneProspect`

After `callResearchAgent()` returns, if `googleRating == null` OR `websiteUrl` is null/"None"/empty:

1. Calls `lookupProspectPlace(businessName, city, state)` (new export in `googlePlaces.js`)
2. textSearch query uses business name + city + state -> rating, totalReviews, placeId from result[0]
3. If placeId exists -> `getPlaceDetails(placeId)` -> websiteUrl and phone
4. Missing fields patched onto agentResult before buildSourceAttribution
5. Source attribution: 'google_places' with confidence: 'medium' (not 'high')
6. Phone backfilled if agent also missed it
7. Entire Places call is non-blocking -- any error is caught and logged, enrichment continues

**Cost:** 0 extra API calls when agent succeeds. Max 2 Places calls per failed prospect.

### Cloud Functions Registered

| Function | Type | Trigger |
|----------|------|---------|
| onProspectBatchCreated | Firestore trigger | prospectIntel/{batchId} onCreate |
| processProspectTask | HTTP (2nd Gen) | Cloud Tasks -- prospect-enrichment queue |

**onProspectBatchCreated flow:** Reads all prospect subdocs, enqueues each via enqueueProspectTask() (max 5 parallel), updates batch status: 'processing'.

**processProspectTask flow:** Validates X-Task-Secret header, parses { batchId, prospectId } from base64 body, calls processOneProspect(). Always returns 200.

### API Endpoints -- Prospect Intel

| Method | Path | Description |
|--------|------|-------------|
| POST | /prospect-intel/batch | Create batch + enqueue all tasks. Body: { rows[], mappings{}, icpProfileId, productFocus }. Returns { success, batchId, totalProspects } |
| GET | /prospect-intel/batch/:batchId | Read batch metadata + progress counters |
| GET | /prospect-intel/batch/:batchId/prospects | Paginated prospect list. Query: ?limit=200&status=enriched |
| POST | /prospect-intel/batch/:batchId/prospects/:prospectId/retry | Re-enqueue a single failed prospect |
| POST | /prospect-intel/batch/:batchId/rescore | Re-run Fit Score on all enriched prospects (no agent call) |
| GET | /prospect-intel/icp-profiles | List icpProfiles collection |

### Firestore Collections

| Collection | Purpose |
|-----------|---------|
| prospectIntel/{batchId} | Batch metadata: userId, status, totalProspects, completedCount, failedCount, icpProfileSnapshot, productFocus, createdAt |
| prospectIntel/{batchId}/prospects/{prospectId} | Per-prospect data: CSV fields + enrichment fields (all with source attribution) + fitScore + workflowStatus |
| icpProfiles/{profileId} | ICP definitions: buyingSignals[], disqualificationSignals[], targetTitles[], industries[] |
| creditLedger/{idempotencyKey} | Credit deduction audit log (idempotency key = prospect:{batchId}) |

### Infrastructure

- Cloud Tasks queue: prospect-enrichment (us-central1, project pathconnect-442522)
- Queue creation: gcloud tasks queues create prospect-enrichment --location=us-central1 --project=pathconnect-442522
- IAM required: 796921234100-compute@developer.gserviceaccount.com needs roles/cloudtasks.enqueuer on pathconnect-442522
- PROSPECT_AGENT_URL: https://prospect-research-218613212853.us-central1.run.app
- PROSPECT_TASK_HANDLER_URL: https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/processProspectTask
- PROSPECT_TASK_SECRET: shared secret for X-Task-Secret header

### Research Agent (Cloud Run)

URL: https://prospect-research-218613212853.us-central1.run.app
Endpoint: POST /api/research
Request: { businessName, city, state }
Response: prospectBusiness, websiteUrl, industry, subIndustry, address, phone, googleRating, totalReviews, tagline, topProducts, differentiators, targetCustomer, confidence

Google Places fallback fires when: googleRating == null OR websiteUrl is null/None/empty

### Live Validation

Batch ecz6yeXafZecjaM7Lr9E: 162 total, 133 enriched, 29 failed, 119 Strong Fit. Medical practices in Atlanta.

### New Env Vars

| Var | Description |
|-----|-------------|
| PROSPECT_AGENT_URL | Cloud Run agent base URL |
| PROSPECT_TASK_HANDLER_URL | Cloud Function URL for task handler |
| PROSPECT_TASK_SECRET | Shared secret for X-Task-Secret header |

### Updated Deployed Cloud Functions (as of April 24, 2026)

api (HTTP), onProspectBatchCreated (Firestore trigger), processProspectTask (HTTP/Cloud Tasks),
processThresholdAlerts (scheduled 6h), merchantBehaviorSync (scheduled Mon 09:00 UTC),
calibrateMerchant (callable), backfillConfidenceFields (callable),
weeklyDigest (scheduled), dailyDigest (scheduled), activityCleanup (scheduled), onUserCreated (Auth trigger)

---

## Session — May 13, 2026

**10-phase platform audit + all actionable findings fixed. Both repos deployed and merged to main.**

### Audit Score: 79/100 (B+)

Full report: `pathsynch-pitch-generator/SYNCHINTRO_AUDIT_REPORT_2026-05-13.md`

### Backend Fixes (pathsynch-pitch-generator)

**`functions/middleware/planGate.js`**
- Fixed stale `userData.tier` bug in `getUserPlan()`. The `tier` field is set to `'FREE'` at account creation and never updated by Stripe. Stripe writes to `subscription.plan`. Old code: `userData.plan || userData.tier` — stale FREE string won.
- Fixed priority chain:
  ```javascript
  const plan = userData?.subscription?.plan ||
               userData?.subscription?.tier ||
               userData?.plan ||
               userData?.tier;
  if (typeof plan === 'string') return plan.toLowerCase();
  else if (plan && typeof plan === 'object') return (plan.tier || 'starter').toLowerCase();
  return 'starter';
  ```
- This is a carry-forward constraint: `subscription.plan` MUST come before `userData.tier` in all plan extraction chains across the entire codebase.

**`functions/index.js`**
- Added global error handlers at top (after `API_VERSION` const):
  ```javascript
  process.on('unhandledRejection', (reason, promise) => { console.error('[UnhandledRejection]', reason); });
  process.on('uncaughtException', (err) => { console.error('[UncaughtException]', err); });
  ```
- Added `X-Admin-Key` auth to `backfillConfidenceFields` and `calibrateMerchant` exports. Key source: `process.env.ADMIN_BOOTSTRAP_KEY || process.env.PROSPECT_TASK_SECRET` (no new env var needed).

**`functions/routes/teamRoutes.js`**
- Wired `sendTeamInviteEmail()` call on `POST /team/invite` — was an empty TODO block since April 28.
- Email failure is non-blocking (try/catch, only `console.warn`). Invite record + 201 returned regardless.
- SendGrid key not yet active — email silently fails until `SENDGRID_API_KEY` is set in `.env`.

**`functions/services/agentLogger.js`**
- Deleted. Zero imports across all files (confirmed via grep). Was dead code from an earlier sprint.

**`README.md`**
- Changed `STRIPE_SECRET_KEY=sk_live_xxx` to `STRIPE_SECRET_KEY=your_stripe_secret_key_here`.

**`.github/workflows/ci.yml`**
- Added `deploy` job with `needs: [test]` and `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`.
- Deploy only runs after test job passes on main.

**`.github/workflows/deploy.yml`**
- Deleted. Was a standalone deploy workflow with no `needs:` — ran in parallel with CI, defeating the gate.
- NOTE: `needs` keyword only works within the same workflow file. Cross-workflow `needs` is not supported. Always keep deploy jobs in ci.yml.

### Deploy Issues Encountered

| Issue | Resolution |
|-------|-----------|
| Firebase auth expired | `firebase login --reauth` |
| Orphaned `onEnrichmentJobCreated` blocked deploy | `firebase functions:delete onEnrichmentJobCreated --region us-central1 --force` |
| Transient GCP timeout on `backfillConfidenceFields` + `onUserCreated` | Redeployed individually: `firebase deploy --only functions:backfillConfidenceFields,functions:onUserCreated` |
| Git push rejected (remote ahead) | `git pull origin main --no-rebase` + auto-merged cleanly |

### Commits

| Commit | What |
|--------|------|
| 964815b | Post-merge main — all audit fixes, CI pipeline consolidation |

### Skipped (Backlog)

- SendGrid API key (`SENDGRID_API_KEY`) — email calls wired but key not set. Non-blocking.
- `index.js` monolith migration to route files
- `.env.example` creation
- Credit deduction atomicity (double-spend window)
- Console.log cleanup (production logging noise)
- Stripe SDK v14 → v22 upgrade
- innerHTML XSS audit (pitchGenerator.js)

---

## Session — May 13, 2026 (Industry Taxonomy Sprints 1–3)

**Deployed to production (backend functions + hosting). Industry Taxonomy Config, Market Intel Intelligence Upgrade, and Integration Metadata Pass-Through.**

### Sprint 1 — Industry Taxonomy Config + UI

#### New Files

| File | Purpose |
|------|---------|
| `functions/config/industryTaxonomy.json` | Canonical source of truth — 22 industries, all sub-industries with IDs/labels/aliases |
| `functions/config/industryTaxonomy.js` | Backend wrapper: `findIndustry()`, `findSubIndustry()`, `buildSearchQueries()`, `normalizeTaxonomyKey()`, `getIndustryLabels()`, `getSubIndustryLabels()` |
| `scripts/sync-taxonomy.cjs` | Copies JSON → `synchintro-app/config/` and verifies identity. `.cjs` because repo root has `"type": "module"` |

#### Key Facts

- **22 industries** (not 23 — existing codebase had 16 incl. Professional Services + Other, + 6 new = 22)
- **6 new industries**: Agencies & Marketing Services, Construction & Trades, Government & Public Sector, Hospitality & Lodging, Media & Entertainment, Nonprofit & Associations
- **Professional Services**: expanded from 5 → 14 sub-industries
- `normalizeTaxonomyKey()` handles: `&` → `and`, `+` → `and`, hyphens/spaces/case — so "Health & Wellness" and "health-and-wellness" both match
- Sync script: `node scripts/sync-taxonomy.cjs` (run after ANY change to taxonomy JSON)
- **Modified**: `functions/services/verticalQuestions.js` — Professional Services updated, 6 new VERTICAL_QUESTIONS templates added

### Sprint 2 — Market Intel Intelligence Upgrade

#### New Files

| File | Purpose |
|------|---------|
| `functions/config/scoringProfiles.js` | 4 scoring profiles: `default_local_business` (ceiling 400), `b2b_services` (150), `government_public_sector` (75), `nonprofit_association` (150). `getScoringProfile()` + `resolveWeights()` (proxy mapper) |
| `functions/config/reportProfiles.js` | Matching report language profiles: competitor/opportunity/leads language, section avoid-lists, `promptInjection` text appended to Gemini prompts. `getReportProfile()` |

#### Changes to `functions/api/market.js`

- Added imports: `industryTaxonomy`, `scoringProfiles`, `reportProfiles`
- `resolveTaxonomyForReport()` helper — backfills taxonomy fields on legacy reports (backward compat, never throws)
- Taxonomy resolution block after `detectVertical()`: resolves `industryConfig`, `subIndustryConfig`, `scoringProfile`, `reportProfile`, `benchmarkKey`, `profileContext`, `primaryTaxonomyQuery`
- Profile context appended to `aiIndustryContext` — Gemini prompts receive industry-specific language (never replacing existing prompts)
- Serper query uses taxonomy sub-industry label
- `verticalCeiling` uses `scoringProfile.reviewCeiling` (was hardcoded 400)
- Report Firestore write: 10 taxonomy fields added (`taxonomyVersion`, `industryId/Label`, `subIndustryId/Label`, `scoringProfile`, `reportProfile`, `benchmarkKey`, `queryTemplateUsed`, `searchQueryUsed`)
- Benchmark write: `taxonomyVersion`, `industryId`, `benchmarkKey`, `scoringProfile` added alongside existing fields
- Analytics event: structured JSON log after benchmark write (`market_report_generated`)
- Refresh endpoint: `resolveTaxonomyForReport()` used on existing doc, resolved fields stored back on update

#### Integration check results

- Gov ceiling: **75** ✓ | Gov language: **peer entities** ✓ | F&B ceiling: **400** ✓ | Version: **1.0.0** ✓

### Sprint 3 — Integration Metadata Pass-Through + Enrichment Readiness

#### New File

| File | Purpose |
|------|---------|
| `functions/services/enrichmentWaterfall.js` | TODO hooks only — `ENRICHMENT_FIELDS` contracts, stub functions for Apollo, PDL, Clay, HubSpot. All return `null` when env var missing. No live API calls. |

#### Integration Changes

| File | Change |
|------|--------|
| `functions/utils/entity360Service.js` | `buildSyncPayload()` now includes `taxonomyMetadata` block (9 fields). Non-blocking. |
| `functions/services/attioClient.js` | Attio push includes 11 taxonomy/intelligence fields. Analytics event `market_attio_push` added. |
| `functions/services/instantlyClient.js` | Market Intel Instantly push only — 7 new `custom_*` variables added (`custom_industry`, `custom_sub_industry`, `custom_opportunity_gap`, `custom_report_profile`, `custom_intel_signal`, `custom_recommended_angle`, `custom_peer_language`). Per-user Instantly integration untouched. Analytics event `market_instantly_push` added. |
| `functions/services/prospectIntelService.js` | NemoClaw handoff: `taxonomyCampaignContext` added to payload. All guardrails preserved. |
| `functions/services/opportunityBriefService.js` | `BRIEF_TITLES` map by report profile, `brief.title` set dynamically, profile prompt injection appended to Gemini narrative prompt. Analytics event `market_opportunity_brief_generated` added. |

#### Brief Title Mapping

| reportProfile | Brief Title |
|---|---|
| `government_public_sector` | Public Engagement Modernization Brief |
| `nonprofit_association` | Community Visibility & Member Engagement Brief |
| `b2b_services` | Market Positioning & Client Acquisition Brief |
| `default_local_business` | Opportunity Brief (unchanged) |

#### Enrichment Waterfall — Future Env Vars Needed

| Provider | Env Var | Status |
|----------|---------|--------|
| Apollo | `APOLLO_API_KEY` | TODO |
| People Data Labs | `PDL_API_KEY` | TODO |
| Clay | `CLAY_API_KEY` + `CLAY_TABLE_ID` | TODO |
| HubSpot | `HUBSPOT_ACCESS_TOKEN` | TODO |

### Commits

| Commit | What |
|--------|------|
| `56bedd5` | Sprint 1 — taxonomy JSON, wrapper, sync script, 6 new industries, vertical questions |
| `a5f8edb` | Sprint 2 — scoring profiles, report profiles, market.js surgical updates |
| `942125e` | Sprint 3 — integration metadata pass-through, enrichmentWaterfall.js |

---

## Hotfix — May 13, 2026 (Post-Taxonomy Sprint Bugs)

**Three production bugs fixed and deployed. Backend `2ea3848`, Frontend `1f55399`.**

### Bug 1 (P0) — Competitor search returning wrong businesses (restaurants)

**Root cause:** `fetchCompetitors()` used `industryDetails.placesKeyword` from the NAICS config as the Google Places search keyword. For "Agencies & Marketing Services", the NAICS lookup fell through to code `722511` whose `placesKeyword` is `'restaurant'`. The taxonomy-aware `primaryTaxonomyQuery` (e.g. `"Digital Marketing Agency Atlanta GA"`) was built at Sprint 2 line ~419 but was never passed into `fetchCompetitors`.

**Fix in `functions/api/market.js`:**
- Added `taxonomyQuery: primaryTaxonomyQuery` to the `fetchCompetitors` call
- Added `taxonomyQuery = null` parameter to `fetchCompetitors` signature
- `const placesKeyword = taxonomyQuery || industryDetails?.placesKeyword;` at top of function
- All 3 occurrences of `industryDetails?.placesKeyword` inside `fetchCompetitors` replaced with `placesKeyword`

**Carry-forward:** `primaryTaxonomyQuery` (from `buildSearchQueries()`) must be the first-priority keyword for ALL Google Places calls — NAICS keyword is the fallback only.

### Bug 2 (P1) — Sub-industry dropdown labels didn't match spec

**Root cause:** `functions/config/industryTaxonomy.json` had stale labels from Sprint 1 (e.g. "Creative / Full-Service Agency", "Digital Marketing / Performance Agency"). The frontend dropdown code was correct — it reads from the JSON via `getSubIndustryLabels()`. The JSON itself was wrong.

**Fix:**
- Updated all 11 Agencies & Marketing Services sub-industry labels in `functions/config/industryTaxonomy.json` to match the spec
- Ran `node scripts/sync-taxonomy.cjs` to propagate to `synchintro-app/config/industryTaxonomy.json`

**Correct Agencies & Marketing Services labels:**
1. Advertising & Creative Agency
2. Digital Marketing Agency
3. SEO & Content Agency
4. Social Media Agency
5. PR & Communications
6. Branding & Design Studio
7. Media Buying & Planning
8. Web Development Agency
9. Video / Content Production Agency
10. Experiential / Event Marketing Agency
11. Staffing & Recruiting Agency

### Bug 3 (P1) — Crime score missing from reports

**Root cause:** `utils/safetyContextService.js` and `utils/safetyContextNarrative.js` were complete implementations but were never imported or called in `market.js`. The frontend `renderSafetyContext()` was already wired and waiting for `report.safetyContext`.

**Fix in `functions/api/market.js`:**
- Added `require` for `getSafetyContext` and `generateSafetyContextNarrative`
- Added non-blocking try/catch block before Firestore save: calls `getSafetyContext({ zipCode, state })`, calls `generateSafetyContextNarrative`, assigns result to `reportData.safetyContext`

**IMPORTANT:** Crime data requires `ENABLE_CRIME_DATA_ENRICHMENT=true` in `functions/.env`. If the section still doesn't appear in reports, verify this env var is set.

### Carry-Forward Constraints

- Never use `industryDetails.placesKeyword` as the primary Places query — always use `primaryTaxonomyQuery` first
- After ANY change to `functions/config/industryTaxonomy.json`, run `node scripts/sync-taxonomy.cjs` immediately
- Crime score section: `ENABLE_CRIME_DATA_ENRICHMENT=true` required in `.env`

---

## Hotfix 2 — May 13, 2026 (Missing Report Sections + Broken Data Fields)

**Three issues fixed after Taxonomy Sprints 1–3 + Hotfix 1.**

### Bug 1 (P1) — Review Velocity section missing from B2B reports

**Root cause:** `functions/config/reportProfiles.js` had `"Review Velocity"` in `b2b_services.avoidSections`. This injected "Do NOT include: Review Velocity" into every Gemini prompt for B2B verticals, causing Gemini to suppress the section entirely.

**Fix in `functions/config/reportProfiles.js`:**
- Removed `"Review Velocity"` from `b2b_services.avoidSections`
- Added de-emphasis guidance to `b2b_services.promptInjection` text: "Review count and velocity are less critical for B2B; weight qualitative positioning over volume metrics."
- Government + Nonprofit `avoidSections` retained for truly inapplicable commercial sections ("Promotional Offers", "Sales Pipeline", etc.)

**Carry-forward:** `avoidSections` is a hard suppression ("Do NOT include"). Use it only for sections that are completely inapplicable to a vertical. For sections that should be de-emphasized, use `promptInjection` language instead.

### Bug 2 (P1) — Top Product Recommendations table shows "undefined" / blank rows

**Root cause:** `synchintro-app/js/pages/market.js` `renderProductRecommendations()` referenced fields that didn't exist on all product objects (`p.name`, `p.price`). Different backend response shapes use different field names.

**Fix in `synchintro-app/js/pages/market.js`:**
- Name: `p.name || p.product`
- Price: `p.price || (p.monthlyPrice ? p.monthlyPrice + '/mo' : '')`
- Reason: `p.reasons || p.reason || p.description`
- Added null guard: skips table row if resolved name is falsy or `'undefined'`

### Bug 3 (P2) — No logging when crime data flag is off

**Fix in `functions/utils/safetyContextService.js`:**
- Added `console.log('ENABLE_CRIME_DATA_ENRICHMENT not set — skipping crime data')` when env var is absent
- Helps distinguish "flag not set" from "API error" in Cloud Functions logs

### Known Non-Issues (Do Not Re-investigate)

- **Enhanced Overview Score donut / Growth Factors breakdown** — `functions/utils/opportunityScoreEngine.js` exists but is NOT imported in `market.js`. The frontend card renders "coming soon" placeholders. This is a missing feature, not a regression. Future sprint item.
- **Competitive Activity + Aggregated Velocity cards** — These are intentional "v2 — coming soon" placeholder cards in the Intent Signals tab. Not bugs.

### Numeric Safety Utility

**New file: `functions/utils/numericSafety.js`**

Three exported functions to prevent NaN/undefined propagation in scoring and display:
- `safeNumber(value, fallback=0)` — coerces to finite number or returns fallback
- `safePercent(numerator, denominator, fallback=0)` — safe division × 100
- `normalizeReviewCount(business)` — checks `reviews`, `reviewCount`, `review_count`, `user_ratings_total`, `totalReviews` fields in order

Use `safeNumber` / `safePercent` in any scoring math that touches external data. Use `normalizeReviewCount` whenever reading review counts from Places / competitor data.

---

## Sprint — May 13, 2026 (Strategic Depth Upgrade)

**Backend commit `427b8a9`. Frontend commit `a17b90a`.**

Additive-only sprint. No existing sections, prompts, tabs, or data fields were modified.

### New: Enhancement Gemini Call in `functions/api/market.js`

After all existing report data is assembled (before Firestore save), a **non-blocking** Gemini call (`gemini-3-flash-preview`, `thinkingBudget:0`, `indexOf('{')` extraction) requests a single JSON object with three new sections:

```json
{
  "strategicMarketThesis": { "title": "...", "thesis": "...", "gapLabel": "..." },
  "strategicRoadmap": [ /* 4 phase objects */ ],
  "kpiInterpretations": [ /* 6 KPI objects with target + whyItMatters */ ]
}
```

If the call fails, the report saves normally with existing sections only. New fields are absent; frontend renders conditionally.

### New fields written to Firestore report document

| Field | Type | Description |
|-------|------|-------------|
| `strategicMarketThesis` | object | `{ title, thesis, gapLabel }` — structural gap thesis + short gap label |
| `strategicRoadmap` | array | 4 phase objects: `{ phase, name, timeframe, focus, actions[], milestone, pathsynchProduct }` |
| `kpiScorecard` | array | 6 KPI objects merged from deterministic data + Gemini interpretation |

### New utility functions in `functions/api/market.js`

- `computeKpiScorecard(reportData)` — reads `marketBenchmarks`, `seoLandscape`, `qualifiedLeads` to produce deterministic current values and status for 6 KPIs. Never calls Gemini for numeric values.
- `computeKpiStatus(current, benchmark)` — returns `above / near / below / unknown`
- `computeSeoKpiStatus(score)` — returns `above / near / below / unknown` based on SEO score thresholds
- `mergeKpiScorecard(deterministic, geminiInterpretations)` — merges Gemini `target` + `whyItMatters` onto deterministic KPI objects. Gemini failure = scorecard still renders with empty interpretation.

### `functions/config/reportProfiles.js` — promptInjection APPENDED (not replaced)

Guidance appended to all 4 profiles for thesis framing, roadmap phase priorities, and KPI emphasis:
- `default_local_business` — competitive dynamics, geographic gaps, review volume vs quality
- `b2b_services` — digital authority, portfolio visibility, specialization; Phase 1=portfolio+case studies, Phase 4=category authority
- `government_public_sector` — citizen engagement, service discoverability; phases around digital communication modernization
- `nonprofit_association` — mission visibility, donor/member engagement; phases around grant readiness + impact storytelling

**Carry-forward:** Always APPEND to `promptInjection`. Never replace. `avoidSections` = hard suppression; `promptInjection` = guidance and de-emphasis.

### KPI Scorecard — 6 deterministic metrics

| KPI | Source field(s) | Status logic |
|-----|----------------|--------------|
| Average Rating | `marketBenchmarks.avgRating` vs `topQuartileRating` | above/near/below |
| Share of Voice | `marketBenchmarks.leaderVoiceShare` | benchmark (display only) |
| Avg Review Count | `marketBenchmarks.avgReviews` | benchmark (display only) |
| SEO / Digital Authority | `seoLandscape.marketAvgScore` | ≥80=above, ≥60=near, else below |
| Total Competitors | `marketBenchmarks.totalCompetitors` | info |
| Qualified Leads Found | `qualifiedLeads.length` | ≥5=above, else below |

---

## Sprint A/B — May 13–14, 2026 (Report Quality + Pitch Context Bridge)

### Part A — Report Quality Fixes (backend commit `baa7769`)

| Fix | Root Cause | Resolution |
|-----|-----------|------------|
| Voice % missing from Top Competitors | Competitor objects built before `shareOfVoice` was computed; stored array always had `undefined` | Voice back-filled onto `reportData.data.competitors` by name-match after SOV computation |
| Enhancement sections not rendering | `buildTieredResponse()` only included `executiveSummary` in baseResponse — thesis/kpiScorecard/roadmap set on reportData but never included in API response | All 4 fields added to baseResponse |
| gapLabel fallback | Only static `'Opportunity Zone'` regardless of profile | `deriveGapLabelFromProfile()` added with profile-specific defaults |
| KPI scorecard deterministic fallback | `kpiScorecard` only set inside try block — any failure left it undefined | `deterministicKpisBase` computed BEFORE try block; set immediately; merged if Gemini succeeds |
| Strategic Roadmap deterministic fallback | No fallback if Gemini returned fewer than 4 phases | `deriveRoadmapFromHighImpactMoves()` added; Gemini only overrides if ≥4 valid phases returned |
| News/trend signal noise | No relevance scoring against industry/location | `filterRelevantNews()` scores against industry + subIndustry + city terms; takes top 8; falls back to top 5 if nothing matches |
| Product Recommendations missing | Pipeline returned null — no fallback existed | `DEFAULT_PATHSYNCH_PRODUCTS` catalog (LocalSynch, PathConnect, PathManager) added as fallback; sanitization removes undefined/null names |

**Enhancement call logging added:**
```javascript
console.log('[MarketIntel] Enhancement result:', JSON.stringify({
  hasThesis, thesisKeys, hasRoadmap, roadmapLength, hasKpiInterp
}));
```

### Part B — Pitch Context Bridge (backend commit `6c586fa`)

**New files:**
- `functions/services/marketIntelPitchContext.js` — Context builder. Reads `marketReports/{reportId}` (0 credits), authorizes via owner-or-workspace-member, resolves taxonomy/profile, finds lead via 5-step priority chain (ID→placeId→website→exactName→partialName), builds language rules, assembles context with size caps (6 proof points, 4 phases, 6 KPIs), returns completeness score.
- `functions/services/pitchCompanionMd.js` — Pure deterministic Markdown from context object. No Gemini call. Sections: Strategic Frame, Prospect Profile, Market Benchmarks, Pitch Angle, Proof Points, Language Rules, Roadmap, KPI table.

**New endpoints (added to `functions/index.js`):**
- `POST /market-intel/pitch-context-preview` — auth required, 0 credits, returns raw context JSON
- `POST /market-intel/pitch-companion-md` — auth required, 0 credits, returns Markdown file download

**Modified: `functions/api/pitchGenerator.js`**
- Non-blocking market intel context fetch (failure does NOT stop pitch generation)
- `=== MARKET INTELLIGENCE CONTEXT ===` block appended to existing Gemini prompt
- Source metadata stored on pitch doc when context is present: `source`, `marketIntelReportId`, `libraryItemId`, `selectedMarketLeadName`, `marketIntelContextCompleteness`, `gapLabel`, `industryId`, `subIndustryId`

**Key design notes:**
- Report benchmarks live at `report.data.benchmarks` NOT `report.marketBenchmarks` — the context builder reads from the correct location
- Authorization: owner check + workspace team membership (Admin SDK read of `teams/{workspaceId}`) at the service layer
- Credit rule: context builder Firestore read charges 0 credits. Only pitch generation charges credits.

**Context size caps:** 1 selected lead, 6 proof points, 4 roadmap phases, 6 KPIs, 1 thesis + gapLabel, 1 primary + 1 secondary angle

---

## Hotfix — May 14, 2026 (10-Issue Post-Sprint Cleanup)

**Backend commit `3fd125c` | Frontend commit `e2cf36d`**

### New: `functions/utils/reportFieldResolver.js`

Shared resolver for inconsistent report field paths (`report.data` vs `report.reportData` vs `report` itself):

```javascript
getReportPayload(report)      // report.data || report.reportData || report
getBenchmarks(report)         // handles .benchmarks vs .marketBenchmarks
getStrategicMarketThesis(report)
getStrategicRoadmap(report)
getKpiScorecard(report)
getProductRecommendations(report)
getGrowthFactors(report)
getSafetyContextData(report)
getQualifiedLeads(report)
getSeoLandscape(report)
```

Frontend gets equivalent inline `_mktGet*` helpers (no module system in frontend).

**CRITICAL carry-forward:** Always use these resolvers when reading report fields. Never access `report.marketBenchmarks` or `report.data.benchmarks` directly — use `getBenchmarks(report)`.

### Issue-by-issue findings

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Thesis not rendering (P0) | Fallback set `thesis: ''` — `renderStrategicThesis()` guards on empty string, so fallback caused nothing to render even when Gemini succeeded | `buildFallbackThesis()` generates real text from benchmark data; both pre-enhancement fallback and empty-thesis guard use it |
| 2 | gapLabel on Matrix (P1) | Old field path access | Updated to use `_mktGetStrategicMarketThesis()` resolver |
| 3 | NAICS 722511 for Agencies (P1) | No `naicsCode`/`naicsLabel` in taxonomy; backend fell back to hardcoded values | Added fields to all 22 industries in `industryTaxonomy.json`; synced to frontend; backend reads from `industryConfig.naicsCode` |
| 4 | Growth Factors NaN (P1) | `parseFloat(undefined)` not caught by `\|\| 0`; `NaN.toFixed(1)` = `"NaN"` | `_mktSafeNum()` guards in both Overview and Trends tabs; section hidden if all values 0 |
| 5 | Crime env var (P2) | Already set | No change needed |
| 6 | Product Recs missing (P1) | Fallback already universal from Part A | No change needed |
| 7 | Growth Signals noise (P2) | No filter existed | `GROWTH_SIGNAL_NOISE` array + `filterGrowthSignals()` added; applied before `demographicsCommunities` stored |
| 8 | Create Pitch industry (P1) | `industry` field not included in `marketIntelRef` | Added to ref; `create.js` auto-selects `#prospect-industry` dropdown |
| 9 | KPI targets empty (P2) | Enhancement prompt lacked numeric examples → Gemini returned vague targets | Explicit numeric examples added to prompt |
| 10 | Contact name prefill (P1) | Fields not in prefillPitchData | `contactName`/`contactTitle` added; reads `lead.contactName \|\| lead.ownerName \|\| lead.contact_name \|\| lead.decisionMaker.name` |

### NAICS codes added to taxonomy

| Industry | naicsCode | naicsLabel |
|----------|-----------|-----------|
| Agencies & Marketing Services | 541810 | Advertising Agencies |
| Automotive | 441110 | New Car Dealers |
| Food & Beverage | 722511 | Full-Service Restaurants |
| Professional Services | 541 | Professional, Scientific, Technical |
| Health & Wellness | 621 | Ambulatory Health Care |
| Home Services | 811 | Repair and Maintenance |
| Retail | 44-45 | Retail Trade |
| Salon & Beauty | 812111 | Barber Shops, Beauty Salons |
| Technology & SaaS | 511210 | Software Publishers |
| Education | 611 | Educational Services |
| Fitness & Wellness | 713940 | Fitness and Recreational Sports Centers |
| Legal Services | 5411 | Legal Services |
| Financial Services | 523 | Securities, Commodity Contracts, Investments |
| Real Estate | 531 | Real Estate |
| Construction & Trades | 236 | Construction of Buildings |
| Hospitality & Lodging | 721 | Accommodation |
| Media & Entertainment | 711 | Performing Arts, Spectator Sports |
| Government & Public Sector | 921 | Executive, Legislative, General Government |
| Nonprofit & Associations | 813 | Religious, Grantmaking, Civic, Professional |
| Other | null | null |

---

## Sprint — May 14, 2026 (Tier 1 Public Data Enrichment)

**Backend commit `2a030f6` | Frontend commit `e000273`**

Additive only. All enrichment is non-blocking and feature-flagged. Standard report verticals (Food & Beverage, Automotive, etc.) are completely unaffected.

### New file: `functions/services/publicDataEnrichmentService.js`

Core enrichment service for Government and Nonprofit Market Intel reports.

**Providers:**

| Provider | Vertical | Flag | Notes |
|----------|---------|------|-------|
| USAspending.gov API | Government | `ENABLE_USASPENDING_ENRICHMENT` | Federal awards by city/state. Free, no auth. |
| ProPublica Nonprofit Explorer | Nonprofit | `ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT` | IRS 990 financials per lead. Free, no auth. Schema subject to change — uses defensive fallback chains. |
| IRS EO Business Master File | Nonprofit | `ENABLE_IRS_BMF_ENRICHMENT` | Bulk CSV pre-processed into Firestore. BMF is divided by filing address (HQ), NOT operating location. BMF-only matches = `low` confidence. Requires `seed-irs-bmf.js` to have been run first. |

**Activation sequence (in order):**
1. `ENABLE_USASPENDING_ENRICHMENT=true` — simplest, report-level only
2. `ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT=true` — per-lead matching
3. `ENABLE_IRS_BMF_ENRICHMENT=true` — ONLY after `seed-irs-bmf.js` has been run for target state(s)

**New Firestore fields written to report document:**

| Field | Profile | Shape |
|-------|---------|-------|
| `publicSectorIntelligence` | government_public_sector | `{ sourceSummary, federalFunding, pitchImplication, confidence, enrichedAt }` |
| `nonprofitFinancialIntelligence` | nonprofit_association | `{ leadMatches[], marketSummary, sourceSummary, enrichedAt }` |

**`federalFunding` shape:** `{ totalAwardsAmount, awardCount, grantsAmount, contractsAmount, topAwardingAgencies[], recentAwards[], fiscalYear, trend }`

**`leadMatches[]` shape:** `{ businessName, placeId, ein, legalName, matchConfidence, nteeCode, nteeDescription, rulingDate, latestFilingYear, revenue, expenses, netAssets, programServiceRevenue, filingUrl, pitchImplication, source }`

**Confidence scoring:**
- `high` = ProPublica + IRS BMF both matched the same entity
- `medium` = ProPublica matched with name similarity ≥ 0.4
- `low` = IRS BMF only (filing address may not match operating location)

**Cache:** Firestore `publicDataEnrichmentCache` collection, 72-hour TTL. ProPublica per-lead results also cached individually by normalized name + state.

**New Firestore collections:**
- `publicDataEnrichmentCache` — enrichment results, 72h TTL, Cloud Functions write only
- `irsBmfCache` — IRS BMF seeded data, seeded by `seed-irs-bmf.js` script

### Actual API field names (confirmed by live test scripts)

**ProPublica Nonprofit Explorer:**
- Search orgs: `ein`, `name`, `city`, `state`, `ntee_code`, `score`
- Detail: `filings_with_data` is at TOP LEVEL (not nested under `organization`)
- Filing fields: `tax_prd_yr`, `totrevenue`, `totfuncexpns`, `totassetsend`, `totnetassetend`, `pdf_url`
- Executive comp field `pct_compnsatncurrofcr` is present — NEVER extracted or stored

**USAspending.gov `/api/v2/search/spending_by_award/`:**
- Response keys are Title Case: `Award Amount`, `Recipient Name`, `Awarding Agency`, `Award Type`, `Start Date`, `Description`

### New script: `scripts/seed-irs-bmf.js`

Downloads IRS EO BMF CSV → seeds Firestore `irsBmfCache` in batches of 500.
Uses `csv-parse` (NOT `line.split(',')` — org names contain commas).
Run: `node scripts/seed-irs-bmf.js --state GA --file data/eo_bmf_ga.csv`
BMF CSVs from: https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf

### Test scripts

- `scripts/test-usaspending-provider.js` — probe USAspending API, print field names
- `scripts/test-propublica-provider.js` — probe ProPublica API, print field names
Run these before modifying the service to verify API schemas haven't changed.

### Updated: `functions/utils/reportFieldResolver.js`

Two new resolvers added:
- `getPublicSectorIntelligence(report)` — handles `report.data.publicSectorIntelligence || report.publicSectorIntelligence`
- `getNonprofitFinancialIntelligence(report)` — same pattern

### Updated: `functions/api/market.js`

Non-blocking enrichment call added AFTER Gemini enhancement call, BEFORE Firestore write:
```javascript
try {
  const enrichmentResult = await enrichReport(reportData, industryConfig, { city, state, subIndustry, qualifiedLeads });
  if (enrichmentResult) { /* merge publicSectorIntelligence / nonprofitFinancialIntelligence */ }
} catch (enrichErr) {
  console.error('[MarketIntel] Public data enrichment error (non-blocking):', enrichErr.message);
}
```
Both new fields added to `buildTieredResponse()` baseResponse.

### Updated: `functions/services/marketIntelPitchContext.js`

Pitch context now includes enrichment data when available:
- Government: `context.publicSectorIntelligence` — total awards, agency list, pitch implication
- Nonprofit: `context.nonprofitFinancialIntelligence` — uses `financialCapacity` (revenue band), NOT exact amounts

### Updated: `functions/services/pitchCompanionMd.js`

New Markdown sections added conditionally:
- `## Public Funding Context` (government)
- `## Nonprofit Financial Profile` (nonprofit)

### SENSITIVITY RULES — PERMANENT

1. **NEVER extract, store, or display executive compensation** from ProPublica 990 data (`pct_compnsatncurrofcr` and similar fields must be ignored)
2. **Use revenue bands in all pitch copy:** `"$5M–$10M annual revenue"` NOT `"$7,234,567"`
3. Financial data in the report card = exact (for SynchIntro user reference only)
4. Financial data in pitch context = band language only
5. Source attribution required on all enrichment sections

---

## Session — May 14, 2026 (Nashville Dental Bugs — 3 Fixes)

**Backend commits `9bfe3e8` + prior commit in same session. No frontend changes.**

### Bug 1 (P1) — NAICS shows parent code 621 instead of 621210 for Dental Practice

**Root cause A — `industryTaxonomy.json` missing sub-industry NAICS:**

`dental_practice` sub-industry had no `naicsCode` or `naicsLabel` — fell back to parent Health & Wellness industry's code (`621`).

**Fix: `functions/config/industryTaxonomy.json`**
```json
{
  "id": "dental_practice",
  "label": "Dental Practice",
  "aliases": ["dentist", "dental office", "orthodontist"],
  "naicsCode": "621210",
  "naicsLabel": "Offices of Dentists"
}
```

**Root cause B — `market.js` NAICS priority chain wrong:**

`industry` object in report document used `industryConfig?.naicsCode` (industry-level) before `subIndustryConfig?.naicsCode` (sub-industry-level) — taxonomy sub-industry was never consulted.

**Fix: `functions/api/market.js`** (lines ~958–965):
```javascript
naicsCode: subIndustryConfig?.naicsCode || industryConfig?.naicsCode || naicsCode,
naicsTitle: subIndustryConfig?.naicsLabel || industryConfig?.naicsLabel || industryDetails?.title || displayIndustryName,
// ...
taxonomyNaicsCode: subIndustryConfig?.naicsCode || industryConfig?.naicsCode || null,
taxonomyNaicsLabel: subIndustryConfig?.naicsLabel || industryConfig?.naicsLabel || null
```

**Sub-industry NAICS always comes first in the fallback chain.**

**Also sync:** `synchintro-app/config/industryTaxonomy.json` must be kept in sync with backend. Run `node scripts/sync-taxonomy.cjs` from `pathsynch-pitch-generator/functions/` after any taxonomy changes.

---

### Bug 2 (P1) — Only 1 qualified lead in Nashville dental market (ceiling 250 too restrictive)

**Root cause — Two layers:**

1. `dental`/`dentist` keywords in `KEYWORD_MAP` mapped to `health_beauty` (ceiling 250). Nashville dental practices commonly have 300–600+ reviews → most filtered out.
2. `detectVertical()` sorts keywords by length descending. For "Dental Practice / Health & Wellness", `searchTerms = "dental practice health & wellness"`. "wellness" (8 chars) sorted ahead of "dental" (6 chars) → `health_beauty` vertical won even if dental keywords were remapped.

**Fix: `functions/services/verticalConfigs.js`**

New `dental_medical` vertical added (ceiling 500):
```javascript
'dental_medical': {
    key: 'dental_medical',
    industryName: 'Dental & Medical',
    reviewCountCeiling: 500,
    painPoints: [
        'Patients rely heavily on reviews before choosing a provider',
        'Insurance complexity reduces perceived value differentiation',
        'Difficulty converting new-patient inquiries from online search',
        'Competitor practices with stronger Google Business Profiles capturing new patients'
    ],
    pitchAngle: 'Healthcare is the highest-stakes review vertical — patients read more reviews, take longer to decide, and are most loyal once they commit. The practice with the most social proof wins.',
    recommendedProducts: ['Review Generation', 'Reputation Management', 'Local SEO', 'Patient Retention'],
    avgTicket: { low: 200, mid: 500, high: 2000 },
    customerLifetimeValue: { low: 2000, mid: 8000, high: 25000 },
    seasonalTriggers: ['Back-to-school checkups (Aug-Sep)', 'Year-end insurance rush (Oct-Dec)', 'New Year health resolutions (Jan)', 'Spring new-patient season (Mar-Apr)'],
    icpSignals: ['4.0+ rating with <100 reviews', 'No response to negative reviews', 'Competitor has 3x+ reviews in same zip code', 'No online scheduling or GBP booking link']
}
```

KEYWORD_MAP updated — dental/medical keywords remapped from `health_beauty` → `dental_medical`. Longer multi-word keywords added to ensure priority over `"wellness"` (8 chars):
```javascript
// Dental & Medical (separate from health_beauty — higher review ceilings)
// Longer keywords sort first in detectVertical(), ensuring dental matches before 'wellness' (8 chars)
'dental practice': 'dental_medical', 'dental office': 'dental_medical',
'medical practice': 'dental_medical', 'urgent care': 'dental_medical',
'orthodontist': 'dental_medical', 'chiropractor': 'dental_medical',
'dermatologist': 'dental_medical', 'podiatrist': 'dental_medical', 'pediatric': 'dental_medical',
'dental': 'dental_medical', 'dentist': 'dental_medical',
'chiropract': 'dental_medical', 'optom': 'dental_medical', 'optician': 'dental_medical',
'physician': 'dental_medical', 'doctor': 'dental_medical',
```

Removed: `'dental': 'health_beauty'`, `'dentist': 'health_beauty'`, `'chiropract': 'health_beauty'`, `'optom': 'health_beauty'`

**Keyword priority carry-forward:** When adding new vertical keywords, always check whether any existing keyword in `KEYWORD_MAP` shorter than the new entry could match before it on a combined search string. `detectVertical()` sorts by length descending — multi-word keywords (e.g., "dental practice" = 15 chars) always beat single-word keywords (e.g., "wellness" = 8 chars).

---

### Bug 3 (P1) — Safety ZIP resolver grabs wrong-state ZIP (PA ZIP 15576 on Nashville report)

**Root cause:** ZIP resolver iterated all competitor addresses without state validation. If any competitor happened to have a Pennsylvania address (e.g., from a national chain), its ZIP was grabbed first → Zyla API returned 404.

**Fix: `functions/api/market.js`** (lines ~1655–1665):
```javascript
let resolvedZip = zipCode || '';
if (!resolvedZip) {
    const stateUpper = (state || '').toUpperCase().trim();
    const addrSources = [
        ...(competitors || []).map(c => c.address || ''),
        ...(serperLeads || []).map(l => l.address || l.formatted_address || l.vicinity || '')
    ];
    for (const addr of addrSources) {
        const addrUpper = addr.toUpperCase();
        // Only use ZIP if address contains the target state abbreviation
        if (stateUpper && !addrUpper.includes(`, ${stateUpper}`) && !addrUpper.includes(` ${stateUpper} `)) continue;
        const m = addr.match(/\b(\d{5})(?:-\d{4})?\b/);
        if (m) { resolvedZip = m[1]; break; }
    }
}
```

**Carry-forward:** Safety ZIP resolver validates state before accepting any ZIP. If no state-matching address contains a ZIP, `resolvedZip` stays `''` and safety service skips gracefully.

---

### Session Commits

| Commit | What |
|--------|------|
| `9bfe3e8` | keyword priority fix (dental_medical vertical + longer KEYWORD_MAP entries) + ZIP state filter |
| prior | NAICS sub-industry priority fix + `dental_practice` naicsCode in taxonomy |

---

## Visibility Enrichment Layer — May 14, 2026

4 phases, all non-blocking, feature-flagged, additive only. Same pattern as `publicDataEnrichmentService.js`.

### New Files

| File | Purpose |
|------|---------|
| `functions/services/visibilityEnrichmentService.js` | Orchestrator — runs enabled enrichments in parallel with per-phase timeouts |
| `functions/services/providers/mapPackProvider.js` | Phase 1A: DataForSEO Google Maps SERP → `mapPackIntelligence` |
| `functions/services/providers/adSpendProvider.js` | Phase 1B: DataForSEO Google Organic SERP → `adSpendIntelligence` |
| `functions/services/providers/websiteSignalsProvider.js` | Phase 2: Google PageSpeed Insights → `websiteConversionSignals` |
| `functions/services/providers/aiVisibilityProvider.js` | Phase 3: Gemini grounded + Perplexity → `aiVisibilityIntelligence` |
| `functions/services/providers/visibilityCache.js` | Shared Firestore cache (72h SERP, 168h website, 24h AI visibility) |
| `functions/services/providers/visibilityQueryBuilder.js` | Taxonomy-based query builder (not hardcoded per-vertical) |
| `functions/services/providers/visibilityMatcher.js` | 3-tier matching: placeId → domain → fuzzy token; `checkAiMention()` |
| `scripts/test-dataforseo-maps.cjs` | Phase 1A test script |
| `scripts/test-dataforseo-organic.cjs` | Phase 1B test script |
| `scripts/test-pagespeed.cjs` | Phase 2 test script |
| `scripts/test-ai-visibility.cjs` | Phase 3 test script |

### Modified Files

| File | Changes |
|------|---------|
| `functions/api/market.js` | `enrichVisibility()` call after `publicDataEnrichment` block; 4 fields added to `buildTieredResponse()` |
| `functions/utils/reportFieldResolver.js` | 4 new resolvers: `getMapPackIntelligence`, `getAdSpendIntelligence`, `getWebsiteConversionSignals`, `getAiVisibilityIntelligence` |
| `functions/services/marketIntelPitchContext.js` | 4 new context blocks using resolver helpers (NOT direct report access) |
| `functions/services/pitchCompanionMd.js` | 4 conditional Markdown sections |

### Firestore

- **New collection:** `visibilityEnrichmentCache/{cacheKey}` — Cloud Functions write only; cache TTLs: 72h SERP, 168h website signals, 24h AI visibility
- **New fields on `marketReports/{id}`:** `mapPackIntelligence`, `adSpendIntelligence`, `websiteConversionSignals`, `aiVisibilityIntelligence` (top-level, not nested under `data`)

### Env Vars (5 new — add to `functions/.env`)

| Variable | Purpose |
|----------|---------|
| `ENABLE_MAP_PACK_ENRICHMENT` | Phase 1A feature flag |
| `ENABLE_AD_SPEND_ENRICHMENT` | Phase 1B feature flag (separate — different SERP surface) |
| `ENABLE_WEBSITE_SIGNALS_ENRICHMENT` | Phase 2 feature flag |
| `ENABLE_AI_VISIBILITY_ENRICHMENT` | Phase 3 feature flag |
| `GOOGLE_PSI_API_KEY` | Dedicated PageSpeed Insights key (falls back to keyless) |

Note: `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` (shared by 1A + 1B) were already present.

### AI Visibility Trust Rules — PERMANENT

1. Field is `mentionRate`, **NOT** `aiVisibilityScore`
2. Verdicts: `frequently_mentioned`, `sometimes_mentioned`, `not_mentioned_in_sample` — NEVER "visible" or "invisible"
3. `confidence` is always `"directional"` — never `"high"` or `"low"`
4. `sampleNote` string must be included (provider/model/query count)
5. UI and PDF **must** include disclaimer: *"Results are directional only — AI responses vary by model, time, and query."*
6. Do NOT hardcode Gemini or Perplexity model names — read from config/env

### Carry-Forward Rules

1. **Test script before provider implementation** — confirm API field names before wiring into `market.js`
2. **Use resolver helpers everywhere** — never access `report.mapPackIntelligence` directly; use `_mktGetMapPackIntelligence(r)` (frontend) or `getMapPackIntelligence(report)` (backend resolver)
3. **Audience language from taxonomy** — `pitchImplication` text must use vertical-appropriate terms: `patients` for healthcare, `customers` for local business, `citizens` for government
4. **Map Pack and Ad Spend are separate SERP surfaces** with separate feature flags — never merge them into one provider

### Spec Document

`docs/Market_Intel_Visibility_Enrichment_Spec_v2.md` — full implementation spec committed to `feature/visibility-enrichment-phase-1a` branch.
6. Confidence labels must be honest (see scoring above)

---

## Session — May 15, 2026

**Repo hygiene, audit workflow fixes, dependency security, and index.js decomposition sprint.**

### Audit Workflow — `weekday-health-audit.yml`

**Bug 1 — Gate was decorative (exit 0 only exits its own step):**
- Deleted "Stop if not scheduled audit window" step — `exit 0` in a step exits that step, not the job
- Added `if: steps.gate.outputs.run_audit == 'true'` to all 8 heavy steps: Create workspace folders, Checkout backend, Checkout frontend, Set up Node, Write audit prompt, Generate audit script, Run health audit, Upload artifact
- Scheduled runs outside 6am ET are now genuinely skipped. `workflow_dispatch` always proceeds.

**Bug 2 — `has_npm_script()` path resolution:**
- `require('${dir}/package.json')` resolved from Node's module path (process cwd, not shell pwd)
- Fixed to: `JSON.parse(require('fs').readFileSync('${dir}/package.json', 'utf8'))` — resolves from shell working directory

Commit: `4a31853`

### Repo Hygiene

- 18 dated `CHANGELOG_2026-*.md` files moved from repo root → `changelogs/` directory. Commit: `19ce781`
- Root `SYSTEM_BIBLE.md` replaced with single-line pointer to `functions/SYSTEM_BIBLE.md`. Functions copy is canonical. Commit: `768d586`

**Carry-forward:** New changelogs go in `changelogs/CHANGELOG_2026-MM-DD.md`, not root.

### Security — npm Audit Fix

**Root package:** `npm audit fix` resolved 6 vulnerabilities:
- `brace-expansion` — ReDoS
- `dompurify` — XSS (high)
- `flatted` — prototype pollution + DoS (high)
- `picomatch` — ReDoS (high)
- `postcss` — path traversal (high)
- `vite` — path traversal + arbitrary file read (high)

Commit: `5dae584`

**Still outstanding:**
- `html2pdf.js` high (XSS) — `0.14.0` is semver-major, needs PDF export test in staging before applying

### index.js Decomposition Sprint

**`docs/INDEX_JS_DECOMPOSITION_PLAN.md`** — generated full inventory of all route groups:
- 20 route groups catalogued with line numbers, extracted file, clean-cut assessment
- 12 clean-cut extractable, 3 partial (stripe webhook, logo split, admin discount codes), 2 blocked (admin core, pitch group)
- 3 dead-code blocks identified
- Shared helpers blocking pitch extraction documented: `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent`, `ensureUserExists`, `getCurrentPeriod`
- Suggested targets: `services/pitchMetrics.js` + `services/userBootstrap.js`

Commit: `1432604`

**Deleted 3 dead-code blocks — commit `24f4292`:**

| Block | Lines Deleted | Why Dead |
|-------|--------------|---------|
| Stale user routes (`GET /user`, `PUT /user/settings`) | 38 | `userRoutes.handle()` at line 598 intercepts first |
| Stale analytics handlers (`POST /analytics/track`, `GET /analytics/pitch/:id`) | 63 | `analyticsRoutes.handle()` at line 626 intercepts first |
| Team Schema A (8 handlers, `teamMembers`/`teamInvites` collections) | 547 | `teamRoutes.handle()` at line 601 intercepts first; also uses obsolete Schema A |

Total: **648 lines removed**. `index.js` is now **4,138 lines** (was 4,786). `node --check` passes.

Replacement modules confirmed mounted:
- `userRoutes` — line 598
- `teamRoutes` — line 601
- `analyticsRoutes` — line 626

### Still Outstanding (P0)

- Add `INSTANTLY_ENCRYPTION_KEY` to `functions/.env` on EC2: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Add `NODE_ENV=production` to `functions/.env` on EC2 (CORS bypass risk without it)
- `html2pdf.js` upgrade to `0.14.0` — test PDF export in staging first

### Still Outstanding (P1–P2)

- Tighten `pitchAnalytics` Firestore rules (currently `allow read: if isAuthenticated()` — over-permissive)
- Tighten `icpProfiles` rules — any auth'd user can overwrite defaults
- Wire `sendTeamInviteEmail()` in `teamRoutes.js` (wired at call site, `SENDGRID_API_KEY` not yet set)
- Extract 12 clean-cut route groups from `index.js` per `docs/INDEX_JS_DECOMPOSITION_PLAN.md`
- Move `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` to shared service to unblock pitch group extraction

---

## Session — May 18, 2026

### No-GBP Detection & LocalSynch Upsell (commits d63cb1f, 86dbe96, b432f35)

**Tri-state GBP model** flows through the entire L2 one-pager pipeline:

| State | Trigger | Effect |
|-------|---------|--------|
| `found` | DataForSEO returned rating/reviewCount | Normal flow |
| `not_found` | DataForSEO ran, returned nothing | Amber banner + outcome card override |
| `unknown` | Source not run (timeout / credit-gate) | Silent section strip only — NO banner |

**Files changed:**
- `functions/services/templateEnrichment.js` — `buildDefaultAnalysis()` returns honest nulls; tri-state computation block added to `runTemplateEnrichment()`; credit-gate early-return spreads `gbpStatus: 'unknown'`
- `functions/services/templateSectionResolver.js` — hard-skips `complaintPatterns` + `customerLove` when no review evidence
- `functions/services/templatePromptBuilder.js` — `CRITICAL — NO REVIEW DATA AVAILABLE` guard in system instruction + user prompt
- `functions/services/templates/brewhouseResponseSchema.js` — `complaintPatterns` and `lovePoints` allow empty arrays; "Minimum 4 items" requirement removed from lovePoints
- `functions/api/pitch/templateOnePager.js` — `renderNoGBPBanner()` function; Step 3c overrides `projectedOutcomes` on `not_found` (4 GBP-acquisition cards); `case 'noGBPBanner'` in renderSection

**Outcome cards on `not_found`:** GBP CLAIMED & OPTIMIZED / 4.8+ RATING TARGET / 100% REVIEW RESPONSE RATE / 18+ NEW REVIEWS IN 90 DAYS

### Test Suite — 574 passing, 0 failing (commit 0861e39)

Was: 561 passed, 19 failed. Changes:
- `teamRoutes.test.js` — rewritten for Schema B (`teams/{ownerUid}` document); firebase-admin mock extended with `Timestamp.fromDate/now`, `arrayUnion/arrayRemove`, auto-create on update
- `validation.js` — `pitchLevel` gets `.default(1)`
- `geminiLeadEnricher.test.js` — wrapped in `Jest test()` with `expect(failed).toBe(0)`

### DEBUG Log Cleanup (commit 0861e39)

- `[L2 STAT DEBUG]` block removed from `templateSectionResolver.js`
- `[TemplateOnePager DEBUG]` statCards block removed from `templateOnePager.js`

### Security (commit 0861e39)

- `NODE_ENV=production` confirmed in `functions/.env` — closes CORS wildcard bypass
- `INSTANTLY_ENCRYPTION_KEY` confirmed present in `functions/.env`

### Market Intel Fixes (commit f610035)

**Fix 1 — Crime/Safety ZIP geocoding fallback:**
Added after competitor address loop in `market.js`. If `resolvedZip` is still empty and `city`/`state` are set, calls Google Geocoding API (reuses `GOOGLE_PLACES_API_KEY`) to extract `postal_code` component. Non-blocking (try/catch).

**Fix 2 — Velocity scoring (Component C) in `opportunityScorer.js`:**
Now scans ALL `recentReviews` entries for most recent valid date (skips null/NaN). Falls back to `lead.dataForSEO.daysSinceLastReview` (pre-computed by market.js). Was only checking index [0] and treating `null` dates as epoch.

**Fix 3 — Signal bonus (Component E) in `market.js`:**
- Added 13 industry keyword entries to `getIndustryKeywords()`: food, beverage, bar, nightclub, brewery, coffee, medical, insurance, pet, home service, landscap, marketing, tech
- Added `SIGNAL_STOPWORDS` set (40+ common words like park/social/house/bar/grill)
- `matchSignalToLead()` rewritten: requires ≥1 meaningful (non-stopword) word OR ≥2 total word overlap for business name match; industry keyword match → bonus:3

### Known Issues Discovered May 18

- DataForSEO 404 on `/business_data/google/reviews/live/advanced` — review enrichment blocked (assigned to Williams)
- Census API returning `missing_key.html` — `CENSUS_API_KEY` needs verification (assigned to Williams)
- Missing Firestore composite index: `marketReports` → `location.city + userId + createdAt` (link sent to Williams)
- Safety geocoding fallback deployed — not yet log-verified; `city`/`state` variables at call site need confirmation

### Personnel Change

**Williams (`dev1@pathsynch.com`) replaces Fayzan as solutions architect.** Williams reviews `pathsynch-pitch-generator` PRs.

---

## Session — May 19, 2026

### Growth Snapshot Renderer (PR #14)

`growth_snapshot` L2 style merged and deployed to Firebase backend. Renderer: `functions/services/growthSnapshotRenderer.js` (added in PR #14). Frontend card was already fully implemented in commit `de9b08e` — hosting deploy pushed it live.

**Card spec:** id: `growth_snapshot`, 145 credits, sends `l2Style: 'growth_snapshot'`, saves to Library. Routes through `_executeGrowthSnapshot()` → `_executeSmartGeneration()` with `l2Style: 'growth_snapshot'`.

### Date Extraction Bug — "New" Badge Overcounting

**Root cause:** `dateLabelPattern` in `templateOnePager.js` Step 3f included `|New` as a valid match. Google's pasted review format renders "New" as a standalone UI badge line, not a date timestamp. This inflated matched date labels from ~90 real timestamps to 203.

**Diagnostic evidence:** 1258 total lines in pasted text | 203 matched date labels (expected ~90).

**Fix (`functions/api/pitch/templateOnePager.js`):**
```
Before: /^(...|yesterday|New)$/i
After:  /^(...|yesterday)$/i
```

`New` removed from `dateLabelPattern`. 90-day review targets and CTA line now reflect accurate velocity.

### executiveBriefRenderer.js — Two Fixes Ported

**Why needed:** Smith's Olde Bar pitches route through `l2Style: 'executive_brief'`, which calls `executiveBriefRenderer.js` and bypasses `renderStatCards()` / `renderOnePagerHtml()` in `templateOnePager.js`. Yesterday's fixes landed only in the default path.

**Fix 1 — Response rate "%" suffix (`renderStatStrip`):**
```javascript
if (/RESPONSE RATE/i.test(s.label) && /^\d+$/.test(String(s.num))) {
    displayNum = s.num + '%';
}
```
Guard prevents double-`%` and only fires on RESPONSE RATE cells.

**Fix 2 — Methodology footnote (`renderSolution`):**
Added below product pills inside the teal PATHSYNCH SOLUTION block:
```
"Methodology: Review targets based on trailing 90-day velocity from pasted Google review timestamps. Response rate calculated from owner reply patterns detected in review text."
```
Styled `7.5px / rgba(255,255,255,0.55)` for legibility on teal background.

### Diagnostic Log Cleanup

Three temporary diagnostic `console.log` lines removed before deploy:
- `[TemplateOnePager] DIAGNOSTIC — total lines in pasted text:...`
- `[TemplateOnePager] DIAGNOSTIC — first 20 matched labels:...`
- `[TemplateOnePager] RENDERER — l2Style:...`

### Verification Protocol Applied

Before deploy: `git diff --name-only` confirmed only 2 files modified (`templateOnePager.js` + `executiveBriefRenderer.js`), `node --check` passed both, `grep` confirmed diagnostic logs absent and pattern/guard present.

### Commits / Deploy

No new commits (deploy-only session). Changes deployed to functions via `firebase deploy --only functions --project pathsynch-pitch-creation`.

---

## Visibility Enrichment Enhancements — May 19, 2026

### adSpendProvider.js — LSA Detection + Structured Paid Signals

**`extractPaidItems()`:**
- Now classifies items with `type:'local_services'` → `local_services_ad` (previously lumped with regular search ads)
- All defensive paid fields added (`cpc`, `position`, `title`, `domain`, `adSignalTypes[]`)

**`buildAdSpendIntelligence()`:**
- Builds `evidence[]` array — array of string descriptors for each detected paid item
- Adds `paidSignals` object: `{ searchAds: boolean, localServicesAds: boolean, mapsAds: boolean, evidence[] }`
  - Note: `paidSignals.mapsAds` is always `false` here — Maps Ads signal lives on `mapPackIntelligence.mapsAds`
- Adds `adSaturationPct` (numeric, e.g. `40`) alongside existing `adSaturation` string (e.g. `"40%"`)
- `competitorAdStatus[].adSignalTypes[]` — array of signal type strings per competitor (`'search'`, `'local_services'`, `'maps'`)
- `generateAdSpendImplication()` updated to use "detected" language throughout; accepts `paidSignals` param for LSA-aware copy; never claims "no one is advertising"

**File:** `functions/services/providers/adSpendProvider.js`

### mapPackProvider.js — Maps Ads Detection

**`extractMapResults()`:**
- Now returns `{ results, mapsAdEvidence }` (was: `results` array only)
- Detects `maps_paid_item` type + organic entries with paid indicators → `mapsAdEvidence[]`

**`buildMapPackIntelligence()`:**
- Adds `mapsAds: { detected: boolean, count: number, evidence[] }` to the returned intelligence object

**File:** `functions/services/providers/mapPackProvider.js`

### Backward Compatibility

Old cached enrichment results (without `adSignalTypes`/`mapsAdEvidence` fields) are handled via `|| []` fallbacks in the frontend. Cache TTL is 72h — stale records expire naturally.

### Deploy

Functions + hosting deployed successfully May 19, 2026 (`firebase deploy --only functions,hosting --project pathsynch-pitch-creation`).

---

## Citation Source Intelligence — Backend — May 19, 2026

### `functions/services/providers/aiVisibilityProvider.js` — Full Rewrite

**New classification constants (module-level, prefixed `_`):**
- `_UGC_DOMAINS` — yelp.com, google.com, tripadvisor.com, facebook.com, etc.
- `_REFERENCE_DOMAINS` — yellowpages.com, angi.com, thumbtack.com, homeadvisor.com, etc.
- `_EDITORIAL_DOMAINS` — healthline.com, webmd.com, nytimes.com, etc.
- `_CORPORATE_TERMS` — 'insurance', 'financial', 'bank', 'capital', etc.

**New helper functions (all private, `_` prefix):**

| Function | Purpose |
|----------|---------|
| `_normalizeCitationDomain(url)` | Strips protocol/www/path → bare domain |
| `_classifyDomain(domain, leadDomains)` | Returns one of 6 domain types |
| `_classifyUrlType(url)` | Returns one of 7 URL types from path patterns |
| `_checkMentionsLead(url, title, leadName)` | 3-strategy match; skips names <4 chars |
| `_buildCitationCollector(allQueryResults, lead)` | Aggregates all citation URLs across queries; deduplicates by normalized URL per domain |
| `_buildGapAnalysis(domainMap, totalQueries)` | Gap score = `retrievals × typeWeight × 10`; only UGC/Reference/Editorial; weights: UGC=1.5, Reference=1.3, Editorial=1.2 |
| `_buildCitationIntelligence(collector, totalQueries)` | Builds final `citationIntelligence` object; enforces caps (25 domains, 50 URLs, 15 gaps) |

**`queryGeminiGrounded()` changes:** Extracts `citationUrls[]` from `groundingMetadata.groundingChunks` using multi-path defensive check (`groundingMetadata`/`grounding_metadata`, `groundingChunks`/`grounding_chunks`/`retrievalResults`) + try/catch. Returns `citationUrls` in result object.

**`queryPerplexity()` changes:** Extracts `citationUrls[]` from `data.citations` (URL strings) or `data.choices[0].message.citations` (objects with `url` field). Returns `citationUrls` in result object.

**`enrichAiVisibility()` changes:** After all provider queries resolve, calls `_buildCitationCollector()` → `_buildCitationIntelligence()` → attaches result to `avi.citationIntelligence`.

**`buildAiVisibilityIntelligence()` — unchanged.** Citation intelligence is attached externally in `enrichAiVisibility()`, not inside the builder.

**`DEBUG_CITATIONS` env var:** Logging guard only. When set: logs top-level keys + citation count. Never full response payloads. Never gates functionality.

### `functions/utils/reportFieldResolver.js`

Added `getCitationIntelligence(report)`:
```javascript
function getCitationIntelligence(report) {
    var avi = getAiVisibilityIntelligence(report);
    return (avi && avi.citationIntelligence) || null;
}
```
Exported in `module.exports`.

### `functions/services/marketIntelPitchContext.js`

Block 11 added after nonprofit block (line ~376), before `return context`:
- Reads `report.aiVisibilityIntelligence.citationIntelligence` (NOT `report.data.aiVisibilityIntelligence`)
- Distills into `context.citationInsight` with 11 fields: totals, top domain, dominant source type, gap count + top gap details

### `functions/services/pitchCompanionMd.js`

"AI Citation Sources" Markdown section added after nonprofit section, before `return md`:
- Guard: `if (mic.citationInsight)`
- Renders: most-cited domain, gap count + top gap + suggested action
- Fallback: "This business is well-represented across AI-cited sources in this market."

### Carry-Forward Rules

1. `citationIntelligence` is nested INSIDE `aiVisibilityIntelligence`. Access via `getCitationIntelligence(report)` resolver — never `report.data.citationIntelligence`.
2. `report.aiVisibilityIntelligence` is top-level on the Firestore document (same as `mapPackIntelligence`, `adSpendIntelligence`, `websiteConversionSignals`).
3. URL deduplication: normalized URL (no query string, no fragment, no trailing slash) per domain's `urlEntries[]`.
4. Gap analysis scope: UGC, Reference, Editorial only. Corporate/Institutional/Other excluded.
5. Short names (<4 chars) skipped in `_checkMentionsLead()`.
6. `DEBUG_CITATIONS` is logging-only — never a feature gate.

---

## Visibility Enrichment — Operational Details (May 19, 2026)

**Phase activation (all 4 confirmed live May 19):**

| Phase | Timeout | Env Flag |
|-------|---------|---------|
| 1A Map Pack | 30s | `ENABLE_MAP_PACK_ENRICHMENT=true` |
| 1B Ad Spend | 30s | `ENABLE_AD_SPEND_ENRICHMENT=true` |
| 2 Website Signals (parallel PSI) | 35s | `ENABLE_WEBSITE_SIGNALS_ENRICHMENT=true` |
| 3 AI Visibility (Gemini + Perplexity) | 25s | `ENABLE_AI_VISIBILITY_ENRICHMENT=true` |

**Perplexity API key:** Env var `PERPLEXITY_API_KEY`. Key created May 19 under name `PathSynch_AI_Visibility`.

**DataForSEO creds:** `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` — shared by Phase 1A (Maps) and Phase 1B (Organic). These are separate SERP surfaces on the same credentials.

**Serper credits:** ~33 Serper credits consumed per Market Intel report. Low balance caused 0-leads on first smoke test (May 19). Monitor balance; top up before bulk report generation.

## Carry-Forward Rules — Full List (Citation Intelligence, May 19, 2026)

1. "Detected" language: Never say "no competitors are running ads" — always say "no paid ads were detected in the tracked queries."
2. Domain classifier is deterministic — extend `_UGC_DOMAINS`, `_REFERENCE_DOMAINS`, `_EDITORIAL_DOMAINS`, `_CORPORATE_TERMS` in `aiVisibilityProvider.js`. No AI calls for classification.
3. `citationIntelligence` nested INSIDE `aiVisibilityIntelligence` — access via `getCitationIntelligence(report)` resolver.
4. `report.aiVisibilityIntelligence` is top-level on Firestore document (NOT under `report.data`).
5. Gap analysis: UGC/Reference/Editorial only. Corporate/Institutional/Other excluded.
6. Short names (<4 chars) skipped in `_checkMentionsLead()`.
7. `DEBUG_CITATIONS` is logging-only — never gates functionality.
8. Perplexity API key: `PERPLEXITY_API_KEY`, key name `PathSynch_AI_Visibility`.
9. DataForSEO creds shared by Phase 1A + 1B — separate feature flags, same credentials.
10. Citation Rate column: hide if all values null.
11. Gemini grounding: multi-path (`groundingMetadata`/`grounding_metadata`, `groundingChunks`/`grounding_chunks`/`retrievalResults`). Always try/catch.
12. Perplexity citations: `data.citations` first, then `data.choices[0].message.citations`. Items may be strings or `{url, title}` objects.

---

## Session — May 20-21, 2026 (AIsynch Phase 1A)

### Overview

Full Phase 1A build of AIsynch — AI Readiness scoring product for local SMBs. Includes scoring engine, free scan endpoint, Stripe billing, Cloud Function API bridge, PathManager EC2 proxy, and 7 React dashboard components. End-to-end production validated.

**Test count:** 574 → 790 passing (216 new tests, 0 failing)

---

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `functions/services/aiReadinessScorer.js` | 1,087 | AI Readiness scoring engine — 6 pillars, confidence scoring, action generation, 68 tests |
| `functions/api/aiReadinessScan.js` | 438 | Free scan Cloud Function endpoint — Cloudflare Turnstile, rate limiting, fingerprint, 500/day global cap, 34 tests |
| `functions/services/aisynchBilling.js` | 335 | Stripe billing — 4 tiers (lite/starter/growth/scale), AISYNCH_ENTITLEMENTS, AISYNCH_AMOUNTS, LocalSynch bundle map, 27 tests |
| `functions/api/aisynchDashboard.js` | 402 | Cloud Function API bridge — 8 endpoints, HMAC-SHA256 JWT auth via PATHMANAGER_JWT_SECRET, 8 tests |
| `PathManager_backend/src/v1_0/api/aisynch/index.js` | 197 | EC2 proxy routes — in-memory cache (5–30 min TTL by endpoint) |
| `PathManager_frontend/src/components/AIsynch/AIsynchCard.jsx` | ~65 | Dashboard card shell |
| `PathManager_frontend/src/components/AIsynch/AIsynchScoreRing.jsx` | ~60 | Circular score ring SVG |
| `PathManager_frontend/src/components/AIsynch/AIsynchPillarBars.jsx` | ~75 | 6-pillar bar chart |
| `PathManager_frontend/src/components/AIsynch/AIsynchActions.jsx` | ~70 | Recommended actions list |
| `PathManager_frontend/src/components/AIsynch/AIsynchDetailView.jsx` | ~85 | Expanded detail modal |
| `PathManager_frontend/src/components/AIsynch/AIsynchUpgradePrompt.jsx` | ~55 | Upgrade prompt for locked tiers |
| `PathManager_frontend/src/components/AIsynch/aisynchApi.js` | ~45 | API helper (calls EC2 proxy) |

React dashboard components total: 455 lines across 7 files.

---

### Modified Files

| File | Change |
|------|--------|
| `functions/index.js` | Exported `aiReadinessScan` and `aisynchDashboard` as standalone 2nd Gen Cloud Functions |

---

### Phase 0 Fixes (Pre-Phase 1A)

Applied before building Phase 1A:

1. **Exported `aiVisibilityProvider` functions** — functions that were internal-only made accessible for AIsynch scoring engine
2. **Citation grounding domain bug fix** — domain extraction was losing TLD in some grounding URLs
3. **Gemini model override** — added per-call model override support to `generateStructured()`
4. **Capped citation percentages** — `citationRatePct` capped at 100 (was returning >100 in some edge cases)
5. **9 Firestore indexes added** — `firestore.indexes.json` updated with composite indexes required by AIsynch queries

---

### Key Architecture Decisions

**Scoring Engine (6 Pillars)**
- Pillar 1: GBP / Local Presence
- Pillar 2: Review Profile
- Pillar 3: Website Signals
- Pillar 4: Citation & AI Visibility
- Pillar 5: Content & Freshness
- Pillar 6: Competitive Positioning
- Each pillar: 0–100 score, confidence level (low/medium/high), weighted contribution to total
- Overall score: 0–100 with confidence band

**Free Scan Rate Limiting (aiReadinessScan)**
- Cloudflare Turnstile token validation (TURNSTILE_SECRET_KEY env var)
- IP-based rate limit: configurable (default 3/day per IP)
- Device fingerprint rate limit: configurable
- Global daily cap: 500 scans/day (Firestore counter at `aisynchRateLimits/global`)
- Dev bypass: `turnstileToken === 'test'` + `AISYNCH_ALLOW_TEST_TOKEN=true` — **must be removed before production launch**

**Billing (4 Tiers)**
| Tier | Monthly Price | Stripe Price ID env var |
|------|--------------|-------------------------|
| lite | $0 | — |
| starter | $49 | `AISYNCH_PRICE_ID_STARTER` |
| growth | $99 | `AISYNCH_PRICE_ID_GROWTH` |
| scale | $199 | `AISYNCH_PRICE_ID_SCALE` |

- Uses `subscriptionItems.create` (attach to existing Stripe subscription) — NOT `checkout.sessions.create`
- AISYNCH_PRICE_IDs read at call time (not module load) to support test env override
- Firestore collection: `aisynchSubscriptions/{merchantId}`

**LocalSynch Bundle Map**
| PathManager Plan | AIsynch Tier | bundledFree |
|-----------------|-------------|-------------|
| `local_growth` | `lite` | true |
| `local_authority` | `starter` | true |

**JWT Auth (aisynchDashboard ↔ PathManager)**
- HMAC-SHA256 signed JWT via `PATHMANAGER_JWT_SECRET`
- PathManager EC2 generates token, includes in `Authorization: Bearer <token>` header
- `aisynchDashboard` Cloud Function verifies signature + expiry on every request
- PathManager backend in-memory cache (5–30 min TTL by endpoint) reduces Cloud Function cold-start impact

**Cloud Function URLs**
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aiReadinessScan`
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aisynchDashboard`

---

### Test Results

| File | Tests |
|------|-------|
| `aiReadinessScorer` | 68 |
| `aiReadinessScan` | 34 |
| `aisynchBilling` | 27 |
| `aisynchDashboard` | 8 |
| **New total** | **137 (net new)** |
| **Suite total** | **790 passing, 0 failing** |

---

### Production Validation

End-to-end test: KEM Health scored **43/100** via live `aiReadinessScan` Cloud Function call in production. All 6 pillars returned scores, confidence levels, and action items. Firestore write confirmed.

---

### Env Vars Added

| Variable | Value | Location |
|----------|-------|----------|
| `AISYNCH_ALLOW_TEST_TOKEN` | `true` | `functions/.env` |
| `PATHMANAGER_JWT_SECRET` | `<generated>` | `functions/.env` |

**Pending:** `PATHMANAGER_JWT_SECRET` still needs to be added to PathManager backend EC2 `.env`.

---

### Pending / Next Steps

1. **Remove dev bypass** — delete `turnstileToken === 'test'` + `AISYNCH_ALLOW_TEST_TOKEN` check from `aiReadinessScan.js` before production launch
2. **Add `PATHMANAGER_JWT_SECRET` to EC2 `.env`** on PathManager backend
3. **Phase 1A-5 — Monitoring cron** — scheduled Cloud Function to re-score merchants on a cadence and persist score history
4. **Phase 2 — PathManager card integration** — wire the 7 React components into PathManager dashboard

---

### Carry-Forward Rules

1. `AISYNCH_PRICE_IDs` must be read at call time (not module load) — required for Jest env var overrides in billing tests
2. `aisynchSubscriptions/{merchantId}` is the canonical Firestore collection for AIsynch tier state
3. `bundledFree: true` in `LOCALSYNCH_BUNDLE_MAP` means the AIsynch tier is granted at no extra charge alongside a LocalSynch plan — do not bill separately
4. JWT auth: PathManager EC2 signs the token; `aisynchDashboard` verifies. Secret must match on both sides. Never commit the secret value.
5. Dev bypass (`AISYNCH_ALLOW_TEST_TOKEN=true`) must be removed before production launch — it bypasses Turnstile completely
6. The 500/day global scan cap is stored in Firestore at `aisynchRateLimits/global` — a Firestore transaction increments it atomically

---

## Session — May 21, 2026 (AIsynch Phase 1B-1 + 1B-2)

### Phase 1B-1 — Persistent Monitoring Cron

**New file:** `functions/scheduled/aiVisibilityMonitor.js` (742 lines)

Scheduled Cloud Function (`aiVisibilityMonitorCron`) running at 3 AM ET daily. Processes active AIsynch subscribers in batches of 5.

**Key functions:**
- `processOneMonitoringRun(subscription)` — full per-merchant pipeline
- `queryGeminiGrounded()` + `queryPerplexity()` — run in PARALLEL (not fallback), store per-model data in `aiVisibilitySnapshots.models.{model}`
- `detectMention()` / `detectCompetitorMentions()` / `detectPosition()` — mention analysis
- `buildSourceEvents()` — citation URL tracking per query
- `computeAggregated()` — cross-model aggregated metrics
- `updateAiReadinessScore()` — updates `aiVisibility` pillar on `aiReadinessScores/{merchantId}`
- `checkMentionRateTrigger()` — review request trigger (Growth/Scale, rate-limited 1/week)

**PII scrubbing:** Removes emails, phone numbers, SSN patterns, CC patterns before Firestore write.

**Cost tracking:** Daily atomic increment on `aisynchRunLogs` with configurable cap (`AISYNCH_DAILY_COST_CAP`, default $25/day).

**Feature flags:**
- `ENABLE_AISYNCH_MONITORING=true` — must be set to run
- `AISYNCH_DAILY_COST_CAP` — default $25

**Carry-forward:** Monitoring cron calls `queryGeminiGrounded()` and `queryPerplexity()` in PARALLEL — NOT the fallback pattern used in `enrichAiVisibility()`. These are two different invocation patterns. The cron does NOT call `enrichAiVisibility()`.

---

### Phase 1B-2 — PathManager Frontend Trend Chart + Detail Components

**PR:** `PathSynch-CEO/PathManager_frontend` — branch `feature/aisynch-trend-chart-phase-1b2`

**New files (4 components, ~750 lines total):**

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/AIsynch/AIsynchTrendChart.jsx` | ~110 | Chart.js v4 line chart for 30/60/90-day mention rate trend (Starter+) |
| `src/components/AIsynch/AIsynchHeatmap.jsx` | ~155 | Multi-model mention rate grid, merchant + competitor rows (Growth+) |
| `src/components/AIsynch/AIsynchCitations.jsx` | ~155 | Citation domain table + gap analysis with GapBadge scores (Growth+) |
| `src/components/AIsynch/AIsynchReportModal.jsx` | ~160 | Report generation modal — date range + format, queues via POST /report (Scale) |

**Modified files:**

- `src/components/AIsynch/AIsynchDetailView.jsx` — rewired to render proper components instead of raw text; mounts `AIsynchTrendChart`, `AIsynchHeatmap`, `AIsynchCitations`, `AIsynchReportModal`; Report button visible Scale-only

**Component tier gating:**
- `AIsynchTrendChart` — Starter+
- `AIsynchHeatmap` — Growth+
- `AIsynchCitations` — Growth+
- `AIsynchReportModal` — Scale only

**AIsynchTrendChart implementation notes:**
- Uses `chart.js/auto` (already in package.json at `^4.5.1`)
- Destroys chart instance on cleanup (`chartInstance.current.destroy()`) — prevents canvas reuse errors
- Empty state: renders "No trend data yet" message when `trendData.length === 0`
- Error state: renders inline message on fetch failure

**AIsynchHeatmap data shape:** `/heatmap` returns `{ models: { gemini: { mentionRate }, perplexity: { mentionRate } }, competitors: [{ name, models: { ... } }], snapshotDate }`

**AIsynchCitations data shape:** `/citations` returns `{ citations: { domainMap: { domain: { domainType, retrievalCount } }, gaps: [{ domain, gapScore }] }, snapshotDate }`

**AIsynchReportModal flow:** POST `/report` with `{ type: 'ai_visibility', dateRange, format }` → `{ status: 'queued', reportId }` → shows "Report queued" confirmation

**Gate results:**
- Gate 5.1: `/trend` endpoint returns `{ trendData: [...], days: 30 }` ✓
- Gate 5.2: `AIsynchTrendChart` renders Chart.js canvas in `AIsynchDetailView` ✓
- Gate 5.3: `/heatmap` returns `{ gated: true, requiredTier: 'growth' }` for Starter/Lite ✓
- Gate 5.4: 872 tests passing (was 790 after Phase 1A) ✓

**Test count:** 872 passing, 0 failing (82 new tests from Phase 1B-1 monitoring cron tests)

---

## Session — May 21, 2026 (Monolith Extraction Sessions 1–3)

### Goal
Reduce `functions/index.js` from ~4,138 lines by extracting shared utilities, pitch metrics helpers, prospect intel Cloud Function registrations, and the three divergent `deductCredits` implementations into dedicated modules.

### New File Map

| File | Lines | Purpose |
|------|-------|---------|
| `functions/lib/shared.js` | 84 | `normalizePath`, `verifyAuth`, `getCurrentPeriod`, lazy `db` Proxy |
| `functions/services/pitchMetrics.js` | 355 | `ensureUserExists`, `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` |
| `functions/api/prospectIntel.js` | 120 | `onProspectBatchCreated` (Firestore trigger), `processProspectTask` (Cloud Tasks HTTP) |
| `functions/api/billing.js` | 104 | `checkCredits`, `deductCredits` — canonical credit system |

### index.js Line Count Progression

| After step | Lines |
|---|---|
| Baseline (pre-extraction) | 4,138 |
| Session 1 (shared.js + pitchMetrics.js) | ~3,849 |
| Session 2 (prospectIntel.js) | ~3,740 |
| Session 3 (billing.js) | **3,707** |

### Dependency Graph (billing layer)

```
firebase-admin
    └── api/billing.js
            ├── services/templateEnrichment.js
            ├── services/intentSignalService.js
            ├── services/opportunityBriefService.js
            └── routes/opportunityBriefRoutes.js
```

**Dependency rule:** `api/billing.js` imports ONLY `firebase-admin`. All callers import from `billing.js` — never the reverse. No circular deps.

### lib/shared.js — Lazy db Proxy

`lib/shared.js` must be required **after** `admin.initializeApp()` in `index.js`. The `db` export uses a Proxy so property access is deferred until first use:

```javascript
const db = new Proxy({}, {
    get(_target, prop) { return getDb()[prop]; },
    apply(_target, _thisArg, args) { return getDb()(...args); }
});
```

This is safe across all import orderings but especially important for test environments that initialize `admin` lazily.

### Billing Consolidation

Three private `deductCredits` implementations were removed and replaced with `api/billing.js`:

| File | Old behavior | Removed |
|------|-------------|---------|
| `services/templateEnrichment.js` | Direct Firestore read + write to `creditHistory.${Date.now()}` map | ✓ (43 lines) |
| `services/intentSignalService.js` | Same `creditHistory` map pattern, no ledger | ✓ (18 lines) |
| `services/opportunityBriefService.js` | Wrote to `creditLedger` collection (same as canonical) | ✓ (22 lines) |

`api/billing.js` always writes to `creditLedger` collection (proper audit trail). The `creditHistory` map pattern was a legacy anti-pattern — not queryable, not auditable.

Call sites updated with `reason` + `service` tags:
```javascript
// intentSignalService.js
deductCredits(merchantId, 150, 'intent_signals:fresh', { service: 'intent_signals' });
deductCredits(merchantId, 50,  'intent_signals:refresh', { service: 'intent_signals' });
```

### opportunityBriefRoutes.js Credit Check Fix

Replaced 2 inline Firestore reads with canonical `checkCredits()`:
```javascript
// Before (raw Firestore read):
const userDoc = await db.collection('users').doc(req.userId).get();
const credits = userDoc.data()?.credits || 0;
if (credits < CREDIT_COST) { ... }

// After:
const creditResult = await checkCredits(req.userId, CREDIT_COST);
if (!creditResult.allowed) { ... }
```

### processProspectTask — Cloud Tasks Pattern

`processProspectTask` always returns HTTP 200 (even on error) to prevent Cloud Tasks retry storms:
```javascript
exports.processProspectTask = onRequest({ ... }, async (req, res) => {
    try {
        await processOneProspect(payload);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[ProspectTask] Failed:', err);
        return res.status(200).json({ success: false, error: err.message }); // 200 to prevent retry
    }
});
```

### Remaining Extraction Targets (future sessions)

The following large blocks remain in `index.js` and are candidates for future extraction:

| Block | Approx lines | Target module |
|---|---|---|
| Stripe webhook handler | ~180 | `api/stripeWebhook.js` |
| Market intel routes | ~120 | already in `api/market.js` — check if inline copy still exists |
| Template enrichment route handler | ~80 | `routes/templateEnrichment.js` |
| Pitch route handler | ~60 | `routes/pitch.js` |
| Admin bootstrap route | ~40 | `routes/admin.js` |

### PathManager Security Action Item

Google KG API key `AIzaSyCcdaRR6nfz1YTUiWCgTyIdBBZUMLuxUek` was found exposed in a commit. Action required:
1. Revoke key in GCP Console → APIs & Services → Credentials
2. Create a new restricted key
3. Add new key to PathManager EC2 `.env` as `GOOGLE_KG_API_KEY`

## May 24, 2026 — No functions changes. PathManager Forms Sprint 1 shipped. AI form generation in PathManager backend now queries meta.knowledgeBox for merchant context. RAG integration added with graceful MODULE_NOT_FOUND fallback. No SynchIntro functions were modified.


---

## Session — May 28, 2026 (SEO Intelligence Layer Phase 3 — AI Citation Tracking)

**Backend commit `f6b8104` → merged to main `e368350` → deployed. Frontend commit `931413e` → deployed. Health check updated `3f5ab14`. Test count: 1,004 → 1,080 passing, 0 failing. Score: 88/100 → 89/100.**

### Phase 3 — AI Citation Tracking

New 4th `Promise.allSettled` leg in `enrichOneLead`. Non-blocking — AI citation failure never blocks Phase 1 (DataForSEO) or Phase 2 (SpyFu) data.

**New functions in `functions/services/seoIntelligenceService.js`:**

| Function | Purpose |
|----------|---------|
| `buildCitationQueries(businessName, city, industry)` | Returns 5 local-intent query strings. Industry branches: dental, HVAC, auto, salon, restaurant, home services, generic fallback. All queries include city name. |
| `buildNameVariants(businessName)` | Strips common suffixes (dental, LLC, Inc, center, spa, etc.), adds first-two-words variant for 3+ word names. All variants ≥4 chars. Deduped array. |
| `detectPosition(text, variants)` | Walks text line by line looking for numbered list patterns (`1.`, `**1.**`, `1)`, `1:`). Returns 1-based position or 1 as fallback. |
| `detectSentiment(text, variants)` | Scans ±100 chars around each variant occurrence. 14 positive / 10 negative word lists. Returns `positive` / `negative` / `neutral`. |
| `detectBusinessMention(text, businessName)` | Orchestrates the above. Pure deterministic — no LLM. Returns `{ mentioned, position, sentiment }`. |
| `extractCompetitorNames(text, variants)` | Regex on numbered list lines; skips own name, generic words (best/top/great/the/a), items <3 or >70 chars. Returns up to 5 unique names. |
| `extractDomains(text)` | URL regex; skips google.com, yelp.com, facebook.com, instagram.com, twitter.com, x.com, linkedin.com, maps.google.com, apple.com, bbb.org. Returns up to 10 unique domains. |
| `runCitationQuery(query, businessName)` | Single Gemini call (`gemini-2.5-flash`, `thinkingBudget:0`). Prompt: "You are a helpful local search assistant. Answer this query as if a customer asked you: [query]..." Catches all errors and returns fallback `{mentioned:false}` — never throws. |
| `checkAiCitations(lead, options)` | Resolves businessName from `lead.name || lead.businessName`, city from `lead.city || lead.location || options.city`. Null if either missing. Runs 5 queries serially with 200ms delay. Aggregates: `mentionedIn`, `mentionRate`, `avgPosition`, `competitorsMentioned[]`, `citedSources[]`, `sentiment`, `queryResults[]`. Returns null only if top-level try/catch fires. |

**`enrichOneLead` signature after Phase 3:**
```javascript
const [summaryResult, domainsResult, spyfuResult, citationsResult] = await Promise.allSettled([
    getBacklinksSummary(domain),
    getBacklinksReferringDomains(domain, 10),
    enrichOneLeadSpyfu(domain),
    checkAiCitations(lead, options)    // ← Phase 3
]);
// ...
return {
    // ...Phase 1 + Phase 2 fields...
    spyfu:       spyfu      || null,
    aiCitations: citations  || null    // ← Phase 3
};
```

**`marketSummary` Phase 3 aggregates (added to `enrichLeadsWithSEO`):**
- `avgMentionRate` — mean `mentionRate` across leads with citations; null if none
- `leadsWithAiPresence` — count of leads where `mentionedIn > 0`
- `topAiCompetitors` — top 5 competitors by `totalMentions` across all leads, shape: `[{ name, totalMentions }]`

**Gemini narrative Phase 3 context block:**
- Added `citationContext` string injected into the narrative prompt when `hasCitations` is true
- Reports: leads with AI presence / total analyzed, avg mention rate %, top AI competitor (if any)
- Text: `"AI CITATION INTELLIGENCE (Gemini local search queries): ..."`

**Module exports:** All 7 Phase 3 helpers + `checkAiCitations` exported from `seoIntelligenceService.js` for testability. `runCitationQuery` is NOT exported (internal only).

### Frontend — AI Citation Card (`synchintro-app/js/pages/market.js`)

New `_renderAiCitationCard(sei)` method added to the `MarketIntelPage` class, called from `renderSeoIntelligenceSection` after the SpyFu card.

**Card structure:**
- Per-lead rows: business name, mention badge (green ≥3/5 queries, yellow 1-2/5, red 0/5), avg position, sentiment icon (✅/⚠️/➖), top AI competitor
- Expandable "View queries ▾" button per lead — toggles `.seo-intel-cite-open` class on a detail row
- Detail row: table of 5 queries — ✅/❌ mentioned, query text, result (mentioned at position N / not mentioned), competitors found, 200-char `responseExcerpt`
- Market-level competitor summary block — renders `ms.topAiCompetitors` as tag pills
- Summary stat row: `leadsWithAiPresence`, `avgMentionRate`, `leads.length * 5` total queries run

**CSS added to `addStyles()`:** Full `.seo-intel-cite-*` block with dark mode variants for all 13 new class names.

**Bug fixed:** `leads.length × 5` (multiplication sign rendered as NaN) → `leads.length * 5`.

### Tests

**New file:** `functions/tests/seoIntelligenceService.phase3.test.js` — 76 tests

| Suite | Tests |
|-------|-------|
| `buildCitationQueries` — industry branching | 11 |
| `buildNameVariants` — suffix stripping, dedup | 11 |
| `detectPosition` — numbered list parsing | 5 |
| `detectSentiment` — word scoring | 5 |
| `detectBusinessMention` — full orchestration | 5 |
| `extractCompetitorNames` — list extraction | 5 |
| `extractDomains` — URL parsing + skip list | 5 |
| `checkAiCitations` — full flow, partial failures, null inputs | 14 |
| `marketSummary` Phase 3 aggregates | 4 |
| Narrative citation context injection | 2 |
| Module exports | 9 |

**Also fixed:** `seoIntelligenceService.phase2.test.js` — two tests that captured `mockGenerateContent.mock.calls[0]` (was the narrative call pre-Phase 3; now Phase 3 adds 5 citation calls first). Fixed to find the narrative call by searching for `'IMPORTANT: Output ONLY a valid JSON object'` in the prompt text.

### Key Carry-Forward Rules — Phase 3

1. **`runCitationQuery` always returns a fallback** — it never throws. Individual query failure → `{mentioned: false, ...}`, so `checkAiCitations` returns a valid result (not null) even when all 5 Gemini calls fail. `avgMentionRate` will be `0`, not `null`, when all queries fail.
2. **Deterministic matching only** — `detectBusinessMention`, `extractCompetitorNames`, `extractDomains` use pure string/regex. No LLM call for mention detection.
3. **200ms inter-query delay** — required to respect Gemini rate limits. Do not remove.
4. **`gemini-2.5-flash` with `thinkingBudget: 0`** — citation queries are SIMPLE tasks. Do not upgrade to gemini-3-flash-preview (unnecessary cost) or enable thinking.
5. **`aiCitations` is nested on `seoHealth`** — access path is `lead.seoHealth.aiCitations`, NOT `lead.aiCitations`. Market summary fields are at `result.marketSummary.avgMentionRate`, etc.
6. **Phase 3 exports are testing aids only** — `buildCitationQueries`, `buildNameVariants`, etc. are exported so tests can unit-test them directly. They are not part of the public service API.

---

## Session — June 1-2, 2026 (No Backend Changes)

No SynchIntro backend (Firebase Functions) changes in this session. All work was on the frontend (`synchintro-app`) and PathManager repos.

### SynchIntro Frontend Change (synchintro-app repo)

- **esc() helper hardened** — 36 instances in `js/pages/market.js` (commit `9ed05c5`). Prevents TypeError on Market Intel PDF download when data fields contain numbers/objects/arrays. Full HTML entity escaping added. See `synchintro-app/CLAUDE.md` for details.

### SynchIntro Firestore Account Changes

- `users/dehiyRBCXcUUM72O211S27lfXbl1` (hello@pathsynch.com): plan/tier/subscription updated from `scale` → `enterprise`
- `users/SE8bo7rvpdaUMBrmKSmIGLZRpQ32` (demo@pathsynch.com): new doc created with `enterprise` plan, 50,000 credits

### SynchIntro Plan Keys Declared (SYSTEM_BIBLE.md Law 1)

New plan key format for SynchIntro checkout routing from PathManager Plans & Billing page:
- `si_starter`, `si_growth`, `si_scale`, `si_enterprise`

These are declared for frontend display/routing only. SynchIntro's own plan gating still uses the existing `planGate.js` hierarchy (`['starter', 'growth', 'scale', 'enterprise']`) with unprefixed plan names stored in Firestore `users/{uid}.plan`.

---

## Session — June 5, 2026 (PathManager Tier Gating — No SynchIntro Backend Changes)

No SynchIntro Firebase Functions code was changed in this session. All work was on PathManager_frontend and PathManager_backend.

### Cross-Platform Plan Tier Architecture (reference)

A canonical plan tier normalization pattern was established in PathManager and should inform any future SynchIntro/PathManager cross-system plan detection work:

**Canonical tier hierarchy:** `free < starter < growth < scale < agency`

**Full planKey → tier map (PathManager canonical):**

| planKey | tier | Notes |
|---------|------|-------|
| `pmfree` | `free` | Also: bare `"free"` |
| `pmstarter` | `starter` | Also: bare `"starter"` |
| `pmgrowth` | `growth` | Also: bare `"growth"` |
| `pmpoweruser` | `scale` | Also: bare `"scale"` |
| `pmenterprise` | `agency` | Also: `"enterprise"`, `"Enterprise"` |
| `pmadmin` | `agency` | Also: `"admin"` |
| `{key}_yearly` | same as base | Only stripped for `pm*`-prefixed keys |

**Key rules:**
1. Strip `_yearly` suffix **only** from `pm*`-prefixed keys — `admin_yearly` and `agency_yearly` are not valid and fail closed to `free`.
2. Input must be trimmed and lowercased: `String(plan ?? '').trim().toLowerCase()` before lookup.
3. Unknown inputs fail closed to `free` (no accidental access grants).
4. Unknown `requiredTier` arguments in gate checks fail closed (deny access) — a typo like `"growht"` must not silently pass.

**SynchIntro plan keys** (declared for PathManager checkout routing, not yet enforced in Functions):
- `si_starter`, `si_growth`, `si_scale`, `si_enterprise`
- SynchIntro's own `planGate.js` still uses unprefixed names (`starter`, `growth`, `scale`, `enterprise`) from Firestore `users/{uid}.plan`.

### PathManager PRs shipped (for cross-product awareness)

| PR | Repo | Description |
|----|------|-------------|
| #176 | PathManager_frontend | Sidebar section headers renamed: PATHCONNECT, LOCALSYNCH, SYNCHINTRO |
| #177 | PathManager_frontend | 401 fix: auth headers on LocalSynch competitor prefs/data endpoints |
| #178 | PathManager_frontend | `useMemo` normalization in PromptResultsTable.tsx |
| #179 | PathManager_frontend | `unwrapArray<T>()` service-layer fix for AI Visibility `t.map` crash |
| #181–184 | PathManager_frontend | `planTierUtils.ts`: `normalizePlanTier()`, `meetsMinTier()`, annual keys, pmadmin |
| #232–234 | PathManager_backend | `normalizePlan()`: pm* planKeys, pmadmin, `_yearly` suffix, input trimming |

### Nginx cache control (PathManager EC2 — for deploy awareness)

`/etc/nginx/conf.d/pathmanager-web.conf` updated:
- `/index.html` → `no-store, no-cache, must-revalidate`
- `/assets/` → `public, max-age=31536000, immutable` with `try_files $uri =404`
- `/` SPA fallback → `no-cache`

Fixes stale deploys and MIME type errors on deleted chunk filenames.

### Outstanding items from prior sessions (status after June 5)

| Item | Status |
|------|--------|
| QRsynch SSL cert (exp. June 10) | ⏳ Williams handling — 5 days remaining |
| VertexAI migration (June 24 deadline) | ⏳ 4 files remaining, not started |
| demo@pathsynch.com delete/re-onboard | ⏳ Not started |
| SynchIntro/LocalSynch cross-system plan detection | ⏳ Deferred |

---

## Session — June 16, 2026 (PathManager Audit — Cross-Reference)

No changes to SynchIntro functions today. For reference: PathManager AI Visibility tab audited against Peec.ai feature set. Build completeness ~70%, Peec parity ~35%. Full report: `PathManager_backend/AI_VISIBILITY_GAP_REPORT_2026-06-16.md`. No impact on SynchIntro functions.
