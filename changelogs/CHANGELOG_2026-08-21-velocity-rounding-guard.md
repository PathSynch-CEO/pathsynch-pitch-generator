# CHANGELOG — 2026-08-21 (Velocity rounding guard — follow-up to Gate 1 / PR #93)

**Branch:** `gate1/velocity-rounding-guard`. Micro-PR addressing PR #93's cold-read verdict. Draft PR
only; merges and deploys **together with #93** (main must not deploy until this lands). Two items only.

## 1. Velocity rounding guard (cold-read finding (b))

**Problem (customer-visible).** The velocity block (`market.js:1977`) runs after reconciliation, so the
first post-#93 regeneration per market feeds `calculateVelocityTrend` the reconciled Places-EXACT current
count (e.g. 1188) against the prior report's stored Serper-ROUNDED count (1200) → `reviewsAdded = -12`,
`classification = 'declining'`. On a *growing* lead this surfaces as:
- a red "Declining ↓" velocity badge on `lead.velocityTrend`;
- a depressed aggregated velocity **intent signal** (`intentSignalService.js:245` — `declining` is
  weighted 0.0). It does not reach the opportunity score (`velocityTrend.scoreBonus` is a pre-existing
  no-op computed after `scoreLeads`).

**Fix (classification level, not a transition-specific hack).** In `calculateVelocityTrend`
(`services/opportunityScorer.js`): real-world review counts essentially never decrease, so a negative
delta within rounding-noise scale is noise, not decline.
- **Tolerance rule:** `roundingTolerance = max(10, round(1% of prior count))`. The fixed 10 absorbs the
  small rounding Serper applies at low counts; the 1% scales it for large counts (1% of 1200 = 12, which
  covers the #93 1200→1188 transition exactly).
- When `reviewsAdded < 0` **and** `|reviewsAdded| <= roundingTolerance`: new `'stable'` classification,
  `scoreBonus 0`, neutral grey `→` badge, and the **displayed delta is clamped to 0** (`reviewsAdded` and
  `monthlyVelocity` both 0 in the returned object).
- A drop **beyond** tolerance still classifies `'declining'` with the real (negative) delta preserved.
- Zero and positive paths are unchanged.

The `'stable'` class is intentionally **absent from the `weights` map** in
`intentSignalService.computeAggregatedVelocity`, so a rounding-noise lead is *excluded* from the velocity
aggregate (no signal) rather than counted as declining 0.0 — which is what depressed the score. It also
produces no intel-signal line in `generateIntelSignal` (only `declining`/`stalling` emit lines).

This additionally fixes the **pre-existing** noise sensitivity: a rounded prior vs an exact current was
always possible whenever DataForSEO enrichment supplied an exact count on one side of the comparison.

The exact tolerance rule and the #93 motivating case are stated in a code comment above the guard.

## 2. Known-limitation note (cold-read finding (a4))

Same-city space-variant names within the divergence guard (`"A B Hauling"` vs `"AB Hauling"`) can
false-merge — the accepted cost of the whitespace-stripped match key that JUSTJUNK ↔ "JUST JUNK?"
requires. Added to the `reconcileSnapshots` doc comment (`market.js`) and to the Gate 1 changelog.

## Tests (`functions/tests/velocityRoundingGuard.test.js`)
- `#93` transition (prior 1200 rounded, current 1188 exact) → `'stable'`, displayed delta 0.
- Negative-within-tolerance (low count, delta −5 within tol 10) → `'stable'`, delta 0.
- Boundary: `|delta| == tolerance` → `'stable'`; `|delta| == tolerance + 1` → `'declining'`.
- Negative-beyond-tolerance (−200) → `'declining'` preserved with the real negative delta.
- Zero path → `'stalling'` (unchanged); positive paths → `below_pace`/`on_pace` (unchanged), real delta.
- `'stable'` is excluded from `computeAggregatedVelocity` weighting (does not depress the intent score).

Full suite green (see PR body for the count).
