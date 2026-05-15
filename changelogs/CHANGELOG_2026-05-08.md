# Changelog — May 7–8, 2026

## Status: Built, Not Yet Deployed

---

## Market Intelligence Report — 7-Prompt Enrichment Series (Prompts 5–6 of 7)

### Prompt 5 — Safety & Local Operating Context

**What it does:** Adds ZIP-level and state-level safety data to the Demographics tab of Market Intel reports. Never framed as a "crime report" — always in terms of foot traffic, customer comfort, after-hours operations, and staffing. Card hides entirely when data is unavailable. Mandatory compliance disclaimer on every render.

**New backend files:**
- `functions/utils/safetyContextService.js`
  - Dual-provider fetch: Zyla Labs Crime Data by Zipcode API (direct) + FBI Crime Data Explorer API (free)
  - Feature flag: `ENABLE_CRIME_DATA_ENRICHMENT=true` — disable without redeploy
  - 8s timeout per provider, `Promise.allSettled` (both run in parallel)
  - Returns `null` when both fail; frontend card never renders
  - Server-side confidence: `high` (both providers), `medium` (one provider), `low` (stale)
  - 90-day Firestore cache at `safetyContextCache/{zipCode}`
  - Raw response debug cache: `safetyContextRaw/{zip}_zyla` and `safetyContextRaw/{zip}_fbi` (30 days)

- `functions/utils/safetyContextNarrative.js`
  - `generateStructured()` with `gemini-2.5-flash` (temp 0.4, maxOutputTokens 500)
  - Schema: `{ summary: string, salesUse: string, caution: string }`
  - System instruction explicitly bans: "safe" / "unsafe" labels, individual predictions, alarming language
  - All output framed as operational context for B2B field sales rep

**`functions/api/market.js` changes:**
- Non-blocking `try/catch` block inserted after `localContext`, before `executiveScore`
- Writes `reportData.safetyContext = { status, confidence, zipLevel, stateLevel, providers, narratives }`
- 10s `Promise.race` timeout on narrative generation

**New frontend — `js/pages/market.js`:**
- `renderSafetyContext(report)` method added
- Returns `''` when `sc.status === 'unavailable'`
- Local `esc()` helper (NOT `this._escHtml()` — that method does not exist)
- Grade badge, safety index, national/state comparison pills
- Provider dot indicators (green/gray)
- AI narrative sections with slate blue sales callout
- Partial-data notice when one provider failed
- Mandatory disclaimer footer with source attribution

**New CSS — `css/app.css`:**
- ~130 lines of `.sc-*` classes
- Confidence classes (`.sc-conf-high/medium/low`) — all neutral gray, no alarm colors
- Grade badge, comparison pills, narrative blocks, disclaimer
- `[data-theme="dark"]` overrides, `@media (max-width: 640px)` responsive

**New env vars required:**

| Var | Required | Notes |
|-----|----------|-------|
| `ENABLE_CRIME_DATA_ENRICHMENT` | Yes | Set to `'true'` to enable |
| `ZYLA_API_KEY` | Yes | Zyla Labs API key (direct, not RapidAPI) |
| `ZYLA_CRIME_API_URL` | No | Optional endpoint override |
| `FBI_CRIME_API_KEY` | Yes | Free at api.data.gov/signup |

**New Firestore collections:**

| Collection | TTL |
|------------|-----|
| `safetyContextCache/{zipCode}` | 90 days |
| `safetyContextRaw/{zip}_zyla` | 30 days |
| `safetyContextRaw/{zip}_fbi` | 30 days |

---

### Prompt 6 — Industry & Labor Economics

**What it does:** Adds BLS QCEW county-level employment, wage, and establishment data to Market Intel reports. Includes year-over-year trends, location quotient, and Gemini-generated sales narrative. No API key required — uses BLS public CSV endpoint.

**New backend files:**
- `functions/utils/industryEconomicsService.js`
  - `CITY_TO_FIPS` map: 100+ US cities → 5-digit county FIPS
  - `STATE_FIPS` map: all 50 states + DC → state FIPS for fallback
  - `mapToNAICS(category)` — 15+ regex patterns → NAICS code + label
  - BLS QCEW CSV URL: `https://data.bls.gov/cew/data/api/{year}/a/area/{FIPS5}.csv`
  - Tries up to 3 prior years in sequence until data found
  - Row fallback chain: 4-digit NAICS → 3-digit NAICS → county total private
  - Skips suppressed rows (`disclosure_code = N`)
  - Extracts: employment, weekly wage, establishments + OTY change % fields
  - Trend classification: growing/flat/declining (employment), rising fast/rising/stable/falling (wages)
  - 90-day Firestore cache at `industryEconomicsCache/{fips}_{naics}`

- `functions/utils/industryEconomicsNarrative.js`
  - `generateStructured()` with `gemini-2.5-flash` (temp 0.5, maxOutputTokens 600)
  - Schema: `{ industryContext: string, salesInsight: string, laborNote: string }`
  - `industryContext`: 2-3 sentences on employment, growth trajectory, competitive density
  - `salesInsight`: 1-2 sentences — what does this mean for pitching marketing/reputation software
  - `laborNote`: 1 sentence on wages or labor dynamics

**`functions/api/market.js` changes:**
- Non-blocking `try/catch` block inserted after safety context, before `executiveScore`
- Writes `reportData.industryEconomics = { status, naicsCode, naicsLabel, county, state, dataYear, isStateFallback, metrics, narratives }`
- 10s `Promise.race` timeout on narrative generation

**New frontend — `js/pages/market.js`:**
- `renderIndustryEconomics(report)` method added
- Returns `''` when `ie.status !== 'complete'`
- Local `esc()` helper + `trendArrow(t)` inline helper (▲ green / ▼ red / ─ gray)
- 3-column metric tiles grid: Employment / Avg Weekly Wage / Establishments (each with YoY%)
- Location Quotient badge (blue) with interpretation
- BLS QCEW year + source attribution
- Amber sales callout (`.ie-sales-callout`) for `salesInsight`
- Labor note row

**New CSS — `css/app.css`:**
- ~110 lines of `.ie-*` classes
- `.ie-metrics-grid` — `repeat(3, 1fr)` grid
- Trend arrow classes: `.ie-trend-up` (green), `.ie-trend-down` (red), `.ie-trend-flat` (gray)
- `.ie-lq-badge` (blue `#1D4ED8`)
- `.ie-sales-callout` (amber `#F59E0B` left border)
- `[data-theme="dark"]` overrides, `@media (max-width: 640px)` — 2-column fallback

**New Firestore collection:**

| Collection | TTL |
|------------|-----|
| `industryEconomicsCache/{fips}_{naics}` | 90 days |

---

## Architecture Notes

- Both prompts use `generateStructured()` from `functions/services/structuredGeneration.js` — never `indexOf('{')` JSON extraction
- Both are non-blocking enrichments: wrapped in `try/catch`, market report completes even if they fail
- BLS CSV headers require `User-Agent` header (some servers block default Node.js agent)
- `this._escHtml()` does NOT exist on `MarketPage` — always use local `const esc = (s) => ...`

---

## Deploy Instructions

```powershell
# Add to functions/.env first:
# ENABLE_CRIME_DATA_ENRICHMENT=true
# ZYLA_API_KEY=your_key_here
# FBI_CRIME_API_KEY=your_key_here

# Deploy backend
cd C:\Users\tdh35\pathsynch-pitch-generator
firebase deploy --only functions

# Deploy frontend
cd C:\Users\tdh35\synchintro-app
firebase deploy --only hosting
```

## Test Checklist (Prompts 5 & 6)

- [ ] Generate Atlanta auto repair report (ZIP 30318, city=Atlanta, state=GA)
- [ ] Verify `safetyContextCache/30318` writes to Firestore
- [ ] Verify `safetyContext.narratives.summary` is populated
- [ ] Verify `industryEconomicsCache/13121_8111` writes to Firestore (Fulton Co., NAICS 8111)
- [ ] Verify `industryEconomics.metrics.localEmployment` has a value
- [ ] Confirm Demographics tab shows both new cards in browser
- [ ] Confirm both cards respect dark mode toggle
- [ ] Confirm card hides when ENABLE_CRIME_DATA_ENRICHMENT is not set (safety card only)

---

## PathManager Local Presence Audit v2 — Full Fix Sprint (May 8, 2026)

**Scope**: PathManager_frontend + PathManager_backend
**Status**: All 22 findings (F-007 through F-022) fixed in feature branches. Awaiting PRs from Charles / Fayzan review.
**Score**: 42/100 (pre-PR #112) → 63/100 (post-#112) → ~82/100 (post this sprint, estimated)

### Branches pushed

| Branch | Repo | Findings |
|--------|------|----------|
| `fix/f007-f009-hardcoded-keys-settings-deeplink` | frontend | F-007, F-008, F-009 |
| `fix/f010-f011-pdr-auth-cron-scores` | backend | F-010, F-011 |
| `fix/f012-f013-competitor-debug-logs-merchant-snapshot` | backend | F-012, F-013 |
| `fix/f014-f016-auto-fix-tooltip-radar-label-settings-deeplink` | frontend | F-014, F-015, F-016 |
| `fix/f017-f019-listing-agent-cache-key-wordcloud-empty` | backend + frontend | F-017, F-018, F-019 |
| `fix/f020-trend-chart-4-series` | frontend | F-020 |
| `fix/f021-f022-gitignore-entity360` | backend | F-021, F-022 |

### Key architectural changes (non-obvious — important for future sessions)

**F-011 — PDR cron real scores:** `pdrService.js` now reads presenceCache (GBP data) and `aiResponseModel` (Gemini website analysis results) to compute all 4 pillar scores. No new API calls in the nightly batch.

**F-013 — CompetitorSnapshot `isMerchant` field:** New boolean field on `CompetitorSnapshot` schema (`default: false`, indexed). The weekly cron now writes a self-snapshot with `isMerchant: true` before the competitor sort. The `action-items/generate` endpoint uses `snapshots.find(s => s.isMerchant)` — the fallback to `snapshots[0]` was previously feeding the highest-PCS competitor as if it were the merchant.

**F-018 — presenceCache `locationKey` rename:** `localPresenceCacheModel.js` and `presenceCache.js` utility both renamed `placeId` → `locationKey`. The field holds different key types across callers: Google PlaceID (GBP routes), MongoDB ObjectID (PDR routes), website URL (web analysis routes). **One-time cache flush on deploy is acceptable** — all TTLs are 24h–7d, cache repopulates on next access. Manual action needed: drop old `{ placeId: 1, type: 1 }` Atlas index on `localpresencecaches` collection after deploy.

**F-013 upsert fix:** Filter updated to `{ mcntCode, competitorPlaceId, snapshotWeek, isMerchant: !!doc.isMerchant }` to prevent self-snapshot collision with a competitor that shares the same placeId (edge case).

### Manual infrastructure actions still needed

- Fayzan: verify/add `STRIPE_SECRET_KEY` (not `STRIPE_SECRETE_KEY`) to EC2 `.env`
- Fayzan: drop old `{ placeId: 1, type: 1 }` Atlas index on `localpresencecaches` after F-018 deploys
- Developer: move `pathsynch-pitch-creation-c6d08f00a3fc.json` out of any git working tree to secure location
- Charles: sign up for SpyFu Pro+AI ($79/mo) for SEO Intelligence Layer Phase 2

---

## SEO Intelligence Layer — Strategy Finalized (May 8, 2026)

**Decision**: Dual-provider approach — DataForSEO (already integrated) + SpyFu ($79/mo).
**Combined cost**: ~$179/mo vs Ahrefs $499/mo.
**Credit impact**: Market Intel reports 100 → 140 credits when SEO Health card is included.

### Three phases

| Phase | What | Status |
|-------|------|--------|
| 1 | DataForSEO Backlinks API → Local Presence + SynchIntro Market Intel | Not built |
| 2 | SpyFu keyword rankings + PPC intel → Market Intel competitive overlay | Not started (needs signup) |
| 3 | AI citation tracking (Gemini + Perplexity) | Not started |

**Phase 1 specifics:**
- DataForSEO Backlinks API is **greenfield** in PathManager (not yet called anywhere)
- New 5th score card on Local Presence: "SEO Health X/100"
- New collapsible "SEO Performance" section on Local Presence page
- Market Intel reports gain a new "SEO & Backlinks" subsection in the Competitive Intelligence tab
- Cache key pattern: `locationKey = domain`, type = `seo_backlinks`, TTL = 7 days

**Phase 2 specifics:**
- SpyFu Pro+AI: `$79/mo`, 10,000 rows/export, unlimited keyword history
- New `spyfuService.js` in PathManager backend
- Feeds into Market Intel "Keyword Rankings" section (competitor keyword gap)

---

## SynchIntro × PathManager Data Integration Map (May 8, 2026)

All data for SynchIntro Prompts 1A–5 already exists in PathManager MongoDB. Zero new third-party APIs needed for these prompts.

| Prompt | What | PathManager data source | Estimated hours |
|--------|------|------------------------|-----------------|
| 1A | Executive Presence Score | `CompetitorSnapshot.isMerchant` snapshot | 2h |
| 1B | Outreach Angles | `CompetitorSnapshot`, GBP cache, web scores | 3h |
| 2 | Demographics | Census ACS + Walk Score (already collected) | 3h |
| 3 | Competitive Matrix | `CompetitorSnapshot` collection (weekly cron) | 4h |
| 4 | Events & Foot Traffic | `LocalPresenceCache` pdr_impact + BestTime | 4h |
| 5 | Safety Context | `safetyContextCache` (Firestore, just built) | 2h |
| 6 | Labor Economics | `industryEconomicsCache` (Firestore, just built) | 3h |

**Only functional cross-product API**: `GET /api/v1/local-intelligence/summary` with `X-Service-Key` header. All other data requires new bridge endpoints.

**Next build priority**: Prompts 1A and 1B — zero new APIs, ~5 dev-hours total, highest sales impact.
