# CHANGELOG — 2026-08-20 (Gate 1: competitor/lead snapshot reconciliation)

**Branch:** `gate1/snapshot-reconciliation`. Implements the approved Gate 1 brief (option b — name+geo,
pre-persist, fix-forward only). Draft PR only; no merge, no deploy.

**Invariant established:** once a lead/competitor match is accepted, no downstream derived metric
consumes an unreconciled review count.

## What changed (`functions/api/market.js`)
- New `reconcileSnapshots(leads, competitors)` (module scope, next to `reconcileReviewEnrichment`). A
  business present in BOTH the Places competitor set (exact `user_ratings_total`, `place_id`) and the
  Serper lead set (rounded `ratingCount`, `cid`) is unified onto ONE **provider-atomic** canonical
  rating+reviewCount. Match = whitespace-insensitive `normalizeBusinessName` + city agreement +
  the existing divergence guards (`REVIEW_COUNT_DIVERGENCE_RATIO`/`REVIEW_RATING_DIVERGENCE`). Mutates
  only matched businesses; unmatched records are byte-identical and get no metadata.
- Ordering: `deduplicateCompetitors` moved above `scoreLeads`; `reconcileSnapshots` inserted after it
  and before `scoreLeads`.
- Competitor persist single-source-of-truth: `rating`/`reviews` removed from the early literal
  (:1526) and written EXACTLY ONCE at the "Gate 1 competitor finalization" step (formerly the
  shareOfVoice back-fill), reading the reconciled `competitors` array.

## DataForSEO acceptance rule (cited, not invented)
`lead.dataForSEO` is set only inside the accept branch of `reconcileReviewEnrichment` (market.js
~:1170 → :1219): `if (!reconcile.accept) return null;`. So "DataForSEO present ⟺ accepted" — the
predicate is `lead.dataForSEO` truthy, plus both `reviewCount` and `averageRating` non-null for atomicity.

## Provider-atomic precedence + fallback exception
`DataForSEO (accepted) → Places exact → Serper`, rating AND count from ONE provider. If the winner
lacks either field, fall through to the next provider for BOTH. Serper is the guaranteed terminal (the
lead's own origin pair), so an atomic pair always exists; there is no impossible case (worst case is a
`(Serper count, null rating)` pair, still atomic).

## Persisted-key decision
Reconciliation is **transient** — it overwrites existing `reviewCount`/`rating` fields; **no new
persisted field** is introduced, so `getReport`'s client contract is unchanged. The match key is
needed only during assembly.

## Schema-version decision: reportSchemaVersion stays **3**
`REPORT_SCHEMA_VERSION` (evidencePainPoints.js:28) is documented as "bumped when the stored report
grows a **section** a pre-version report must not render," and is **shared** with the pain-points
schema (unchanged here). Gate 1 adds no section and no field — it reconciles VALUES within existing
sections (mirroring #90, which changed median-vs-mean values and explicitly kept v3). Encoding a
value-quality guarantee in this section-presence version — and in a constant shared with pain-points —
would misrepresent the pain-points shape. If the reconciliation guarantee ever needs to be queryable,
a dedicated field is the right encoding, not a version bump. Frontend `>= 3` gates are unaffected
regardless.

## Accepted, fenced inconsistency
Qualification (ICP/ceiling/type-gate, market.js ~:1756-1790) runs BEFORE reconciliation and continues
to decide on **pre-reconciliation Serper values** — under the approved scope fence. A matched lead
whose canonical count differs from Serper keeps the qualification result it had before reconciliation.
Regression `snapshotReconciliation.test.js` proves it.

## Tests (`functions/tests/snapshotReconciliation.test.js`, 9)
False-positive (Atlanta≠Marietta by geo); true-positive (JUSTJUNK ↔ JUST JUNK? merges, and plain
`normalizeBusinessName` demonstrably does NOT); divergence + missing-geo guards; provider-atomic
precedence (DataForSEO wins both; incomplete DataForSEO falls through for both); goal regression (one
canonical 1188 across persisted lead row, persisted competitor row projection, SoV totalMarketReviews,
`canonicalReviewMedian`, opportunityScore input, and intel-signal string); qualification fence;
no-match passthrough (deep-equal, no metadata).

Full suite: **2306 passing, 0 failing** (112 suites).

## Known limitation (accepted) — whitespace-insensitive match key
The reconciliation match key is whitespace-insensitive, which is REQUIRED to recover the JUSTJUNK ↔
"JUST JUNK?" true-positive. The same insensitivity means same-city space-variant names within the
divergence guard can false-merge — e.g. `A B Hauling` vs `AB Hauling` (both collapse to `abhauling`),
or `Go Green` vs `GoGreen`. The class is narrow (gated by city agreement + the ≤5× divergence guard)
and is the accepted cost of the whitespace-stripped key. Documented here and in the `reconcileSnapshots`
doc comment so it is not later rediscovered as a defect. (Cold-read finding a4.)

## Follow-up (2026-08-21) — velocity rounding guard
See `CHANGELOG_2026-08-21-velocity-rounding-guard.md`. Addresses cold-read finding (b): the first
post-#93 regeneration per market compared this report's reconciled Places-exact count against the prior
report's Serper-rounded count, producing a false `reviewsAdded < 0` / `declining` on growing leads.
Fixed at the classification level in `opportunityScorer.js` (new rounding-noise `stable` class). Merges
and deploys together with #93.
