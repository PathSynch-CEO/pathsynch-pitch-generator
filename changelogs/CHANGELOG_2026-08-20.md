# CHANGELOG — 2026-08-20

## P0 — Market Intel precision-context leak + discovery-side lead zeroing

**Branch:** `fix/market-intel-precision-leak-and-discovery-zeroing`
**Trigger:** Live 2026-08-20 Atlanta "Junk Removal & Hauling" report (id `G9Ope6tejD79RtbB3NCm`) — 13 competitors, **0 leads**, and internal prompt text spliced into the customer-facing executive summary.

Two coupled defects, both root-caused against the actual Firestore report and its prior-day sibling (`3jhnZDTbifBVX219b3cO`, 6 leads).

### Defect 1 — Prompt text leaked into the zero-lead executive summary

The zero-lead run's exec summary contained verbatim steering text:

> "...dominates Atlanta Home Services **PRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses within the Home Services vertical. Prioritize businesses matching this sub-type. User's approach preference: All Atlanta Metro Area.** with 26793 reviews. No qualified leads were identified..."

**Root cause:** `market.js` fused `precisionContext` into the industry label —
`aiIndustryContext = \`${displayIndustryName}${precisionContext}\`` (market.js:~2005) — and passed it as the `industry` arg to `generateAIExecutiveSummary`. On the zero-lead path that value is interpolated **verbatim** by the deterministic `buildZeroLeadSummary` (narrativeGenerator.js). On the non-zero path the model rewrote it into prose, which is why the prior day's 6-lead run read clean — the leak only surfaces on the zero-lead template. This is the same class as the earlier "=== INDUSTRY-SPECIFIC INSTRUCTIONS ===" leak that Fix A resolved for `profileContext`, but `precisionContext` was never unfused, and the sanitizer's `CHECK_PROMPT_SCAFFOLDING` did not cover the precision markers.

**Fixes:**
- `functions/api/market.js` — keep the industry label CLEAN (`aiIndustryContext = displayIndustryName`); thread `precisionContext` through the silent `profileGuidance` channel alongside `profileContext` (every narrative generator already applies `profileGuidance` in a labeled, non-echoed prompt section).
- `functions/services/narrativeGenerator.js` — `buildZeroLeadSummary` (and `summaryData.industry`) now interpolate a `cleanIndustryLabel()`-scrubbed value, so the descriptor can never echo prompt-context text even if handed a dirty label.
- `functions/utils/bannedLanguage.js` — new `INSTRUCTION_MARKERS` + `findInstructionMarkers()` + `stripInstructionMarkerLines()` (markers: `PRECISION FILTER`, `The user is`, `Prioritize businesses`, `User's approach preference`, `INDUSTRY-SPECIFIC INSTRUCTIONS`, `apply silently`, `Do NOT include these sections`).
- `functions/utils/reportSanitizer.js` — new `CHECK_PROMPT_INSTRUCTION_MARKERS` strips marker-bearing lines from `executiveSummary`, `competitorAnalysis`, and `strategicMarketThesis.thesis`; fail-closed; flags `_instructionMarkersStripped` (deleted before persist in market.js, like the other telemetry flags).

### Defect 2 — Lead-zeroing was DISCOVERY-side, driven by the supplemental answer

`leadQualification` on the live report: `{ candidatesDiscovered: 0, qualified: 0, filteredOut: 0, zeroQualified: true, likelyFilteringOutcome: false }` — **not** an over-filter (filteredOut=0). Zero candidates were discovered at all, while 13 competitors were found via the taxonomy query, so the market is not empty.

**Root cause:** the supplemental precision answer (`q1`) was folded into the Serper **discovery** query — `\`${precisionQuestions.q1.value} ${displayIndustryName}\`` → `"Residential Cleanouts Home Services"` — an unnatural term that returned nothing. The prior day's identical-param run discovered 10 candidates → 6 leads; the query is brittle and lets a supplemental answer starve discovery to zero. This is the **#80 lesson**: supplemental answers may RANK leads, never ELIMINATE them to zero.

**Fix:**
- `functions/api/market.js` — extracted `buildLeadDiscoveryQuery(subIndustryConfig, displayIndustryName)` (pure, exported, unit-tested). Lead discovery now depends only on the robust taxonomy label (`subIndustryConfig?.label || displayIndustryName`); the precision answer still steers ranking + narrative via `precisionContext`/`profileGuidance`, but can no longer decide whether any candidate exists.

### Tests
- `functions/tests/bannedLanguage.instructionMarkers.test.js` — marker detection/stripping incl. the verbatim production leak string.
- `functions/tests/marketPrecisionLeak.test.js` — #80 discovery decoupling, zero-lead descriptor cleanliness (dirty-label input), and sanitizer defense-in-depth (reproduces the exact leak).
- Full suite: **2242 passing, 0 failing** (105 suites).
