# Changelog — May 26, 2026

**Sprint:** market-intel-v4-sales-enablement
**Branch:** feat/market-intel-v4
**Stories:** S0, S1, S3, S2, S4, S5, S6 (in implementation order)
**Status:** All deployed to production

---

## S0 — Credibility Guardrails & Report QA Sanitizer

### What Was Built

New `functions/utils/reportSanitizer.js` — 8 independent credibility checks run on every report before `buildTieredResponse`. Each check is wrapped in its own try/catch so a failure skips that check only.

| Check | Description |
|-------|-------------|
| CHECK_UNKNOWN_LEADER | Patches executiveSummary + strategicMarketThesis when market leader is "Unknown" |
| CHECK_EMPTY_COMPETITORS | Sets `_emptyCompetitorMessage` with contextual text when competitor array is empty |
| CHECK_SEO_ZEROES | Recomputes avgSEOScore or marks `_hideAggregateRow`; falls back to PSI performance scores |
| CHECK_ADS_CONTRADICTION | Suppresses paidSignals when adSaturationPct=0 |
| CHECK_STALE_TIMING | Replaces past-month/past-quarter timing strings in highImpactMoves |
| CHECK_KPI_NA | Fills N/A KPI rows from benchmark/SEO data; marks remaining as `_hide` |
| CHECK_MARKET_AVG | Computes benchmarks.avgReviews from leads+competitors union |
| CHECK_MARKET_RATING | Creates benchmarks object if null; computes avgRating; patches "undefined★" strings |

### Files Changed

- `functions/utils/reportSanitizer.js` — NEW
- `functions/api/market.js` — wired `sanitizeReport()` before `buildTieredResponse`
- `synchintro-app/js/pages/market.js` — empty competitors state reads `_emptyCompetitorMessage`

### Validation

Report QA checks fire on every fresh generation. Log line per check fixed: `[Sanitizer] Fixed: {description}`.

---

## S1 — Market Definition & Query Transparency

### What Was Built

New `functions/utils/marketDefinitionBuilder.js`:
- Lookup table with 35+ sub-industry IDs and 19 industry-level fallbacks keyed on `subIndustryConfig?.id`
- `buildMarketDefinition()` produces: definition sentence, confidence badge, query pill list, included/excluded business type columns
- `_computeCategoryConfidence()`: ≥75% of expected business type matches = high, 50-74% = medium, <50% = low
- Supplemental query logic to ensure 4-8 queries per report (base `taxonomyQueries` from `buildSearchQueries()` returns only 2)
- Generic fallback when no lookup match

### Files Changed

- `functions/utils/marketDefinitionBuilder.js` — NEW
- `functions/api/market.js` — call after `reportData.data.leads = serperLeads`; result at `reportData.data.marketDefinition`; starter tier explicit field added
- `synchintro-app/js/pages/market.js` — `renderMarketDefinition()` card above KPI Scorecard in Overview tab; PDF export included

### Validation

Market definition card visible on Overview tab for all fresh reports. Confidence badge reflects query coverage.

---

## S3 — Qualified Lead / Competitor / Reference Player Separation

### What Was Built

`generateReferenceCompetitors(city, industry, subIndustry, localNames)` added to `functions/services/narrativeGenerator.js`:
- gemini-2.5-flash, thinkingBudget:0
- Returns 3-5 institutional/national players NOT present in Google Places results
- Each player gets `isReferencePlayer: true` + disclaimer string
- Returns [] on any failure (non-blocking)

Updated `generateCompetitorAnalysis()` to accept `referenceCompetitors` param and inject as narrative prompt context.

In `market.js`: reference competitor call runs sequentially BEFORE `Promise.allSettled` so narrative generator has names available. Deduplication by 6-char normalized prefix prevents fuzzy duplicates.

### Files Changed

- `functions/services/narrativeGenerator.js` — `generateReferenceCompetitors()` export + `generateCompetitorAnalysis()` signature update
- `functions/api/market.js` — sequential pre-parallel call; dedup; stored at `reportData.data.referenceCompetitors`
- `synchintro-app/js/pages/market.js` — `renderReferenceCompetitors()` indigo card (`border-top: 3px solid #6366f1`), disclaimer banner, threat pills, price tier; wired into `renderCompetitorsTab()`; PDF reference players table; Qualified Leads tab relabeled "Qualified Leads (Sales Prospects)"

### Validation

Reference players appear in Competitors tab with indigo accent and disclaimer. Local competitors unchanged.

---

## S2 — PathSynch Product Wedge per Lead

### What Was Built

`computeProductWedge(lead, benchmarks)` function added in `functions/api/market.js`:

| Priority | Condition | Product Assignment |
|----------|-----------|-------------------|
| 1 | responseRate === 0 | PathManager + Review AI |
| 2 | daysSinceLastReview > 90 | PathConnect + QRsynch |
| 3 | rating >= 4.5 AND reviewCount < marketAvgReviews | PathConnect + LocalSynch |
| 4 | websiteScore < 70 | LocalSynch + Microsite |
| 5 | mapPackCount === 0 | LocalSynch |
| 6 | aiVisibilityRate < 50 | SynchIQ |
| 7 | newsSignal present | SynchIntro |
| 8 | default | PathConnect + LocalSynch |

Every condition guards `!= null` before evaluating — missing data never triggers a false signal. `PRODUCT_WEDGE_TEMPLATES` and `PRODUCT_WEDGE_PITCHES` defined as const objects.

### Files Changed

- `functions/api/market.js` — `computeProductWedge()` function; called after S1 market definition; attached to every `serperLead.productWedge`
- `synchintro-app/js/pages/market.js` — product wedge column in leads table (indigo product name + pitch text); `renderProductFitTable()` in AI Sales Intel tab

### Validation

Every qualified lead in the Leads tab shows a product recommendation. AI Sales Intel tab shows full product fit table.

---

## S4 — Competitive Weakness Themes

### What Was Built

`generateWeaknessThemes(qualifiedLeads, competitors, industry, subIndustry)` in `functions/api/market.js`:
- Computes aggregate stats from all leads + competitors: avgResponseRate, pctBelowReviewThreshold, avgSEOScore, pctVelocityStalled, pctWithWebsite, avgWebsiteScore
- Calls gemini-2.5-flash, thinkingBudget:0, returns `[{rank, theme, whyItMatters}]` 5-7 items
- Filter: items must have a number in the theme text; sliced to max 7

### Files Changed

- `functions/api/market.js` — `generateWeaknessThemes()` function; stored at `reportData.data.weaknessThemes`; added to starter tier in `buildTieredResponse`
- `synchintro-app/js/pages/market.js` — `renderWeaknessThemes()` red-accented card; wired into `renderCompetitorsTab()` after Competitor Analysis, before Positioning Matrix; PDF table with rank/theme/whyItMatters columns

### Validation

Weakness themes appear in Competitors tab with numbered badges. Section header reads "Across the analyzed local businesses".

---

## S5 — Economic / Demographic Fit

### What Was Built

`generateDemographicBusinessMeaning(cityDemographics, industry, subIndustry)` in `functions/api/market.js`:
- gemini-2.5-flash, thinkingBudget:0, returns `[{dataPoint, businessMeaning, salesUse}]` 4-6 items
- Prompt enforces specific numbers in every dataPoint; includes 8 vertical-specific examples
- Filter: dataPoint must contain a number; all 3 fields must be present
- Only runs when `cityDemographics` exists (Census API succeeded)
- `cityDemographics` has exactly 3 fields: population, medianIncome, medianHomeValue

### Files Changed

- `functions/api/market.js` — `generateDemographicBusinessMeaning()` function; stored at `reportData.data.demographicBusinessMeaning`; added to starter tier
- `synchintro-app/js/pages/market.js` — inline cyan-accented block (`#0e7490`) after Census City Demographics card in Demographics tab; dataPoint in header, businessMeaning body, salesUse italic; PDF Data Point / Business Meaning / Sales Use table

### Validation

Demographic meaning block appears in Demographics tab below Census card when Census data is available.

---

## S6 — Website Conversion Audit Pass 1 (Lighthouse Deep Extract)

### What Was Built

New helpers in `functions/services/providers/websiteSignalsProvider.js`:
- `auditPass(auditObj)` — returns true/false/null (null = not evaluated; excluded from verdict denominator)
- `buildLighthouseAudit(url, audits, lcp)` — extracts 13 signals from existing PSI Lighthouse response (no new API calls)

13 signals extracted:
`HTTPS, viewport, LCP (≤2500ms), meta-description, document-title, is-crawlable, canonical, robots-txt, image-alt, link-text, tap-targets, structured-data, errors-in-console`

Verdict thresholds:
- ≥9 pass OR ≥69% pass rate → "Captures demand" (green)
- ≥6 pass OR ≥46% pass rate → "Leaks demand" (yellow)
- else → "Not converting local intent" (red)

Absolute count checked first; ratio used as fallback for partial Lighthouse responses (not all 13 signals always present). `conversionChecks` (old format) preserved for backward compat on existing reports.

Pass 2 signals (click-to-call, contact form, booking link, Maps embed, GA4, broken links) require HTML parse — explicitly deferred to future sprint.

### Files Changed

- `functions/services/providers/websiteSignalsProvider.js` — `auditPass()`, `buildLighthouseAudit()`, `lighthouseAudit` field added to `extractSignals()` return
- `synchintro-app/js/pages/market.js` — `renderWebsiteSignalsSection()` rebuilt: per-lead card with verdict badge, pass/fail count, 13-signal checklist table (checkmark/X/dash icons); no-website leads show "No website detected"; PDF per-lead audit table

### Validation

Website Signals section in Visibility tab shows 13-signal checklist with colored verdict badge per lead.

---

## Key Learnings

1. **Stripe v14.x lock** — Firebase CLI deploy subprocess does NOT inherit shell env vars. Stripe v22+ throws on undefined `STRIPE_SECRET_KEY` at module init. Stay at v14.25.0.
2. **`reportSanitizer.js` pattern** — each check is its own try/catch; failure skips that check, never blocks report; log format `[Sanitizer] Fixed: {description}`.
3. **Reference competitor call sequence** — must run sequentially BEFORE `Promise.allSettled` because `generateCompetitorAnalysis()` needs the names for context injection.
4. **6-char normalized prefix dedup** — catches fuzzy duplicates in reference competitor list without over-filtering legitimate distinct names.
5. **Product wedge null guards** — every condition in `computeProductWedge()` must check `!= null` before comparing. Missing data never triggers a false product signal.
6. **`auditPass()` null semantics** — null means "signal not evaluated by PSI", distinct from false (signal evaluated and failed). Null is excluded from verdict denominator.
7. **`taxonomyQueries` supplement** — `buildSearchQueries()` returns only 2 queries; `marketDefinitionBuilder.js` must always supplement to 4-8.
8. **`cityDemographics` field set** — Census enricher returns exactly 3 fields: population, medianIncome, medianHomeValue. No other fields available.
9. **Lighthouse verdict logic** — use absolute pass count as primary check; ratio as fallback for reports where not all 13 signals were evaluated.
