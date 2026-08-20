# CHANGELOG — 2026-08-20 (N3 single-median completion)

**Branch:** `fix/intel-signal-canonical-median-and-population-framing`
Backend copy/value only — no schema change (`reportSchemaVersion` stays 3). Completes N3's
single-median guarantee: every report surface now cites ONE canonical review median.

## Fix 1 — Lead intel signals cite the canonical median, not the mean

The per-lead intel signal presence line was the last surface on the competitor-inflated mean
(`benchmarks.avgReviews`, e.g. 3164) while the KPI scorecard, deterministic weaknesses, evidence
pain points, exec summary, and sanitizer fallback all cite the canonical leads+competitors median
(e.g. 734). Three coordinated pieces:

- **(a) baseline** — `functions/services/opportunityScorer.js` `generateIntelSignal`: presence
  baseline switched from `avgReviews` to `benchmarks.medianReviews` (the canonical figure).
- **(b) label** — the review line's `"vs. NNNN market avg"` becomes `"vs. NNNN market median"`
  (and "at the market median of …" / "% above the median"). The rating line (LINE 2) intentionally
  keeps `"market avg"` — it compares against the MEAN rating, for which no canonical median exists.
  Honesty guard: if a report has no computed median (legacy/stored benchmarks), the line falls back
  to the mean **and labels it `"market avg"`** — a mean is never mislabeled as a median.
- **(c) ordering** — `functions/api/market.js`: the per-lead intel-signal loop was **moved to run
  AFTER** the canonical assignment `benchmarks.medianReviews = canonicalReviewMedian(reportData.data
  .leads, reportData.data.competitors)` (#88's recompute over the FINAL analyzed population), and now
  reads that field. Previously the loop ran ~50 lines earlier, where `benchmarks.medianReviews` was
  still the competitors-only pre-canonical value. **Review-round correction:** an earlier draft
  computed the median early and reused it at the #88 site — but that inverts #88's "final population
  wins" and is fragile to any future filter added in between. The loop was relocated instead so #88's
  final-population recompute stays authoritative. The loop mutates leads in place (`serperLeads ===
  reportData.data.leads` at that point — `serperLeads` has no reassignment after the dedup at
  `:1830`), so both references carry `intelSignal` with no risk of reading a stale median.

## Fix 1.5 (review round) — exec-summary fallback was the OTHER mean emission

`functions/services/narrativeGenerator.js` `generateAIExecutiveSummary` deterministic fallback
(Gemini-down path) cited `"${multiplier}x the market average of ${avgReviews}"` — a second
mean-over-reviews emission in the report, and inconsistent (the multiplier is
`leaderReviews / medianReviews`, so 36.5× lands on the median 734, not the mean 3164). Now cites
`"the market median of ${medianReviews}"`, matching the primary Gemini path. In production the
canonical median is always assigned before the exec summary runs (AI block is after the `:1987`
assignment), so this reads the real median.

The "% below presence threshold" is recomputed off the median; above-median leads read
"…% above the median" (sanity-checked).

## Fix 2 — Population framing names the analyzed-business count

Weakness/pain copy read "7 of 15 fall under 734" beside a KPI of "13 competitors" — arithmetically
fine (leads+competitors union) but reads as a contradiction. The bare `${count} of ${agg.size}`
now names the population: **"N of M analyzed businesses"**. Sites:
`functions/services/evidencePainPoints.js` (below-threshold claim) and
`functions/services/competitiveWeaknesses.js` (below-threshold + website-absence themes). This also
heals an existing inconsistency — the website-absence pain point already said "analyzed businesses".

## Tests
`functions/tests/intelSignalMedianAndPopulation.test.js` (12):
- intel-signal baseline **equals `canonicalReviewMedian`** over the same population (asserts the
  exact integer, not just "a median"); label string; below/at/above-median phrasing; honest
  `"market avg"` fallback when no median present.
- **final-population wins** (reviewer's settling test): on a fixture where qualification drops a lead
  and that changes the median, the intel signal cites the FINAL-population median, never the pre-drop
  superset median.
- "N of M analyzed businesses" in weakness themes + evidence pain points (and the bare form is gone).
- `reportSchemaVersion` / pain-point `schemaVersion` stays 3.
`marketDataDrivenClaims.test.js`: exec-summary fallback cites "market median", never "market average".

## Point-2 confirmation (single source, no stale read)
`benchmarks.medianReviews` is assigned **exactly once** (`market.js:1987`, final population). Every
consumer reads it after: the intel loop (`:2003`), `computeKpiScorecard` (`:2521`), `sanitizeReport`
(`:2800`), `buildEvidenceLedger` (`:2820`). The sanitizer median fallback and the weaknesses/pain
builders don't read the field at all — they recompute `canonicalReviewMedian` over the same
`reportData.data.leads` + `reportData.data.competitors` population, so their value is identical by
construction. No consumer reads a pre-canonical field.

## Point-3 confirmation (last mean-over-reviews emission)
Swept `market avg`/`market average` across the report-generating code. Remaining hits are all exempt:
rating comparisons (mean rating — no median exists), other products (AIsynch `aiReadinessScorer`,
Prospect Intel `prospectIntelService`, L2/L3 pitch renderers), the dormant `opportunityScoreEngine`
(not imported by `market.js`), and sanitizer `console.log`s. The two live review-count emissions in
the Market Intel report — the per-lead intel signal and the exec-summary fallback — are both fixed.

Full suite: **2263 passing, 0 failing** (107 suites).
