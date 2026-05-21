# Changelog — May 20-21, 2026

## AIsynch Phase 1A — AI Readiness Scoring Product

**Sprint:** AIsynch Phase 1A (May 20-21, 2026)
**Repos touched:** `pathsynch-pitch-generator` (functions), `PathManager_backend`, `PathManager_frontend`

---

## Overview

Full Phase 1A build of AIsynch — a standalone AI Readiness scoring product for local SMBs. Surfaces a 0–100 score across 6 pillars, confidence bands, and prioritized action items. Includes a free scan funnel (Cloudflare Turnstile + rate limiting), Stripe billing with 4 tiers, a Cloud Function API bridge with HMAC-JWT auth, PathManager EC2 proxy routes, and 7 React dashboard components. Validated end-to-end in production.

**Pre-sprint (Phase 0):** Fixed aiVisibilityProvider exports, citation domain bug, added Gemini model override, capped citation percentages, and added 9 Firestore composite indexes to support AIsynch queries.

---

## New Files

### `pathsynch-pitch-generator` (functions repo)

| File | Lines | Description |
|------|-------|-------------|
| `functions/services/aiReadinessScorer.js` | 1,087 | Core scoring engine — 6 pillars, confidence scoring, weighted roll-up, action generation |
| `functions/api/aiReadinessScan.js` | 438 | Free scan Cloud Function endpoint — Turnstile validation, IP/fingerprint rate limits, 500/day global cap |
| `functions/services/aisynchBilling.js` | 335 | Stripe billing service — 4 tiers, AISYNCH_ENTITLEMENTS, AISYNCH_AMOUNTS, LocalSynch bundle map |
| `functions/api/aisynchDashboard.js` | 402 | Cloud Function API bridge — 8 endpoints, HMAC-SHA256 JWT auth via PATHMANAGER_JWT_SECRET |

### `PathManager_backend`

| File | Lines | Description |
|------|-------|-------------|
| `src/v1_0/api/aisynch/index.js` | 197 | EC2 proxy routes — forwards requests to Cloud Function with JWT auth; in-memory cache (5–30 min TTL by endpoint) |

### `PathManager_frontend`

| File | Lines | Description |
|------|-------|-------------|
| `src/components/AIsynch/AIsynchCard.jsx` | ~65 | Dashboard card shell component |
| `src/components/AIsynch/AIsynchScoreRing.jsx` | ~60 | SVG circular score ring |
| `src/components/AIsynch/AIsynchPillarBars.jsx` | ~75 | 6-pillar horizontal bar chart |
| `src/components/AIsynch/AIsynchActions.jsx` | ~70 | Prioritized actions list |
| `src/components/AIsynch/AIsynchDetailView.jsx` | ~85 | Expanded detail modal |
| `src/components/AIsynch/AIsynchUpgradePrompt.jsx` | ~55 | Tier gate upgrade prompt |
| `src/components/AIsynch/aisynchApi.js` | ~45 | API helper (calls PathManager EC2 proxy) |

---

## Modified Files

| File | Change |
|------|--------|
| `functions/index.js` | Exported `aiReadinessScan` and `aisynchDashboard` as standalone 2nd Gen Cloud Functions (Node.js 22) |
| `functions/services/providers/aiVisibilityProvider.js` | Phase 0: exported internal functions; fixed citation grounding domain extraction; added model override; capped `citationRatePct` at 100 |
| `firestore.indexes.json` | Phase 0: added 9 composite indexes required by AIsynch Firestore queries |

---

## Test Results

| Test File | New Tests | Notes |
|-----------|-----------|-------|
| `aiReadinessScorer.test.js` | 68 | 6-pillar scoring, confidence bands, action generation, edge cases |
| `aiReadinessScan.test.js` | 34 | Turnstile validation, rate limiting, global cap, error paths |
| `aisynchBilling.test.js` | 27 | Tier entitlements, LocalSynch bundle map, Stripe flow, price ID env override |
| `aisynchDashboard.test.js` | 8 | JWT auth, endpoint routing, error responses |
| **Suite total** | **790 passing, 0 failing** | Up from 574 before this sprint (661 after May 20 competitor validation sprint) |

---

## Production Validation

**Test business:** KEM Health
**Result:** Scored **43/100** via live `aiReadinessScan` Cloud Function call
**Confirmed:**
- All 6 pillars returned scores, confidence levels, and action items
- Firestore write to `aisynchScans/{scanId}` confirmed
- Cloud Function cold-start and response time acceptable

**Cloud Function URLs live in production:**
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aiReadinessScan`
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aisynchDashboard`

---

## Env Vars

### Added to `functions/.env`

| Variable | Value | Notes |
|----------|-------|-------|
| `AISYNCH_ALLOW_TEST_TOKEN` | `true` | Dev bypass for Turnstile — **MUST BE REMOVED before production free scan launch** |
| `PATHMANAGER_JWT_SECRET` | `<generated>` | HMAC secret for dashboard JWT auth |

### Pending

| Variable | Location | Status |
|----------|----------|--------|
| `PATHMANAGER_JWT_SECRET` | PathManager backend EC2 `.env` | **Not yet added** — required for dashboard endpoints to work end-to-end |
| `TURNSTILE_SECRET_KEY` | `functions/.env` | Required for production Turnstile validation |
| `AISYNCH_PRICE_ID_STARTER` | `functions/.env` | Required for Stripe billing (starter tier) |
| `AISYNCH_PRICE_ID_GROWTH` | `functions/.env` | Required for Stripe billing (growth tier) |
| `AISYNCH_PRICE_ID_SCALE` | `functions/.env` | Required for Stripe billing (scale tier) |

---

## Architecture Notes

### Scoring (6 Pillars)
- Pillar 1: GBP / Local Presence
- Pillar 2: Review Profile
- Pillar 3: Website Signals
- Pillar 4: Citation & AI Visibility
- Pillar 5: Content & Freshness
- Pillar 6: Competitive Positioning
- Overall: weighted sum, 0–100, with confidence band

### Billing Flow
- Attach to existing Stripe subscription via `subscriptionItems.create` — NOT `checkout.sessions.create`
- Tiers: `lite` ($0) / `starter` ($49) / `growth` ($99) / `scale` ($199)
- LocalSynch bundle: `local_growth` → `lite` (bundledFree), `local_authority` → `starter` (bundledFree)
- Firestore collection: `aisynchSubscriptions/{merchantId}`

### JWT Auth Pattern
- PathManager EC2 generates HMAC-SHA256 signed JWT using `PATHMANAGER_JWT_SECRET`
- `aisynchDashboard` Cloud Function verifies signature + expiry on every request
- EC2 proxy caches responses (5–30 min TTL by endpoint) to reduce Cloud Function invocations

---

## Pending / Next Steps

| Item | Priority | Notes |
|------|----------|-------|
| Add `PATHMANAGER_JWT_SECRET` to PathManager EC2 `.env` | P0 | Blocks dashboard endpoints in production |
| Remove dev Turnstile bypass from `aiReadinessScan.js` | P0 — before free scan launch | `AISYNCH_ALLOW_TEST_TOKEN` + `turnstileToken === 'test'` check |
| Phase 1A-5 — Monitoring cron | Next | Scheduled re-scoring, score history persistence, threshold alerts |
| Phase 2 — Wire React components into PathManager routing | Next | Components built; need mounting in dashboard layout |
| Free scan widget for pathsynch.com | After bypass removal | POST to `aiReadinessScan` Cloud Function with Turnstile widget |
| Set Stripe Price IDs in `functions/.env` | Before billing launch | `AISYNCH_PRICE_ID_STARTER/GROWTH/SCALE` |
