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
- **(c) ordering** — `functions/api/market.js`: the canonical median
  (`canonicalReviewMedian(serperLeads, reportData.data.competitors)`) is now computed and assigned to
  `benchmarks.medianReviews` **before** the per-lead intel-signal loop, and the same value is reused
  at the later assignment. Previously `benchmarks.medianReviews` at the loop was still the
  competitors-only pre-canonical value (canonical wasn't assigned until ~50 lines later), so intel
  signals cited a nearby-but-different median. Population is identical to every other consumer
  (`serperLeads` is what becomes `reportData.data.leads`; the competitor set is unchanged), so the
  value is byte-identical to the KPI/weaknesses/pain figure.

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
`functions/tests/intelSignalMedianAndPopulation.test.js` (10):
- intel-signal baseline **equals `canonicalReviewMedian`** over the same population (asserts the
  exact integer, not just "a median"); label string; below/at/above-median phrasing; honest
  `"market avg"` fallback when no median present.
- "N of M analyzed businesses" in weakness themes + evidence pain points (and the bare form is gone).
- `reportSchemaVersion` / pain-point `schemaVersion` stays 3.

Full suite: **2260 passing, 0 failing** (107 suites).
