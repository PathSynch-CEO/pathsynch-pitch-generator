# Changelog — May 25, 2026 (Sprint 1 Completion)

## Sprint 1 — Countifi Hardening + CI/CD

Sprint 1 complete. All 14 stories closed. 882 tests passing, 0 failing. Health check score target: 88+/100.

---

### Bug Fixes

**S2 — Logo rendering (L2/L3 one-pager)**
- `dataEnricher.js`: `buildSellerContext()` now reads `branding.logoUrl || branding.logo` — fixes auto-extracted logos saved under wrong field
- `logo.js`: auto-extract endpoint now saves under `branding.logoUrl` (was `branding.logo`)
- `l2OnePagerRenderer.js`: viewer fallback chain includes `branding.logo` for pre-existing pitches

**S3 — [object Object] Timing Recommendation**
- `synchintro-app/js/pages/market.js`: Added `typeof === 'string'` guards on `timing`, `strategy`, `budgetAllocation` fields in `renderTrendsTab()`; safe mapper for `riskFactors` array items

**S4 — One-pager popup sizing**
- `synchintro-app/js/pitchViewer.js` lines 118, 169: Changed `iframe.style.display = 'none'/'block'` to `iframe.style.visibility = 'hidden'/'visible'` — preserves iframe layout dimensions during load, eliminates sizing flicker

**S5 — Website URL auto-populate**
- `synchintro-app/js/pages/create.js` `checkMarketIntelRef()`: Reads `ref.selectedLeadWebsite` from sessionStorage and populates `#prospect-website` when navigating from market intel lead

**S6 — DataForSEO reviews endpoint 404 (CRITICAL)**
- `functions/services/dataForSEOClient.js`: Changed endpoint from `/business_data/google/reviews/live/advanced` to `/business_data/google/reviews/live` — the `/advanced` suffix does not exist for business_data endpoints

**S7 — processThresholdAlerts cron interval**
- `functions/index.js` line 3679: Changed `'every 5 minutes'` to `'every 6 hours'` — was causing excessive Cloud Function invocations and cost overrun

---

### Security

**S8 — Firestore rules hardening**
- `pitchVersions`: `allow read` now owner-scoped (`resource.data.userId == request.auth.uid`); was `isAuthenticated()` — any user could read any pitch version
- `teamInvitations`: `allow read` now scoped to `teamOwnerUid == request.auth.uid || inviteeEmail == request.auth.token.email`; was `isAuthenticated()` — any user could read all invitations
- `icpProfiles` update: Removed `resource.data.isDefault == true` branch — any auth'd user could overwrite shared default profiles; defaults now Admin SDK only
- Added explicit `allow read, write: if false` rules for 5 Cloud-Functions-only collections: `logoReviewQueue`, `publicDataEnrichmentCache`, `visibilityEnrichmentCache`, `aisynchSubscriptions`, `aiReadinessScores`

---

### Infrastructure

**S9 — Census API key**
- `CENSUS_API_KEY` confirmed present in `.env`; services already handle missing key gracefully

**S11 — CI/CD hardening**
- `ci.yml`: Added `concurrency` group (`cancel-in-progress: true`) to prevent queue buildup on rapid pushes
- `ci.yml`: Added `permissions: contents: read` at top level (principle of least privilege)
- `ci.yml`: Added `timeout-minutes: 15` (test job) and `timeout-minutes: 20` (deploy job)
- `weekday-health-audit.yml`: Fixed `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v5` → `@v4` (v5 does not exist for these actions)

**S12 — Dependencies**
- `npm audit fix` applied — resolved `ws` moderate vulnerability; reduced total from 14 to 10 (remaining 10 are transitive in Firebase/GCP SDK chain, unfixable without Google release)
- Stripe SDK upgraded from v14.25.0 to v22.x — 882 tests still passing

**S13 — .env.example**
- Created `functions/.env.example` with all 70+ env vars documented by category with placeholder values and critical notes (GOOGLE_APPLICATION_CREDENTIALS warning, THEORG_API_KEY Secret Manager note, etc.)

---

### Test Baseline

| Metric | Before Sprint | After Sprint |
|--------|--------------|-------------|
| Tests passing | 882 | 882 |
| Tests failing | 0 | 0 |
| Stripe version | 14.25.0 | 22.x |
| npm audit (critical) | 0 | 0 |
| npm audit (moderate) | 14 | 10 |
