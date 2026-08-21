# CHANGELOG — 2026-08-21 (Velocity rounding guard — follow-up to Gate 1 / PR #93)

**Branch:** `gate1/velocity-rounding-guard`. Micro-PR addressing PR #93's cold-read verdict. Draft PR
only; merges and deploys **together with #93** (main must not deploy until this lands). Two items only.

## 1. Velocity rounding guard (cold-read finding (b))

**Problem (customer-visible).** The velocity block (`market.js:1977`) runs after reconciliation, so the
first post-#93 regeneration per market feeds `calculateVelocityTrend` the reconciled Places-EXACT current
count (e.g. 1188) against the prior report's stored Serper-ROUNDED count (1200) → `reviewsAdded = -12`,
`classification = 'declining'`. On a *growing* lead this surfaces as:
- a red "Declining ↓" velocity badge on `lead.velocityTrend`;
- a false "Declining" line in the per-lead intel signal (`generateIntelSignal`);
- an inflated `counts.declining` in `computeAggregatedVelocity` (`intentSignalService.js`) — which feeds
  the Gemini action-recommendation prompt ("…N declining") and the persisted `categoryVelocitySnapshots`.

It does **not** reach the opportunity score (`velocityTrend.scoreBonus` is a pre-existing no-op computed
after `scoreLeads`), and — per the #94 cold read — it does **not** depress the *aggregated velocity
score* either (see "Aggregate accuracy" below).

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

**Aggregate accuracy (per #94 cold read).** The `'stable'` class is intentionally **absent from the
`weights` map** in `intentSignalService.computeAggregatedVelocity`, so a rounding-noise lead is *excluded*
from the velocity aggregate rather than counted. This does **not** change the aggregated velocity *score*
in the normal mixed case: `weights['declining'] = 0.0` and the aggregate denominator is a hardcoded `20`
(not `scored`), so a `declining` lead already contributed exactly `0` to a fixed-denominator numerator —
arithmetically identical to an excluded `'stable'` lead (verified on a mixed fixture: score `15` pre and
post). The genuine effects of the reclassification are:
- the customer-visible velocity **badge** flips from red "Declining ↓" to neutral "Stable →";
- `generateIntelSignal` emits **no** "Declining" line for the lead (only `declining`/`stalling` emit lines);
- `counts.declining` is **no longer inflated** by the phantom — and that count feeds the Gemini
  action-recommendation prompt and the persisted `categoryVelocitySnapshots`;
- a **degenerate all-noise market** correctly flips `hasData: true, score: 0` → `hasData: false,
  score: null`, so `computeIntentScore` uses the neutral default `50` instead of a fabricated `0`.

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
- A `'stable'` lead emits **no** "Declining" intel-signal line (`generateIntelSignal`) — the
  customer-visible surface. (`computeAggregatedVelocity` is not exported, so its behavior is reasoned in
  "Aggregate accuracy" above, not unit-tested: `'stable'` contributes `0` like the old weight-0.0
  `declining`, so the mixed-case aggregate score is unchanged.)

Full suite green (see PR body for the count).

## Backlog (out of scope for #94 — do NOT expand here)
Genuine review-count **decreases** do occur (spam purges, batch moderation, user deletions, profile
merges, provider snapshot diffs). These are **data-quality artifacts**, not business-velocity signals —
yet the pre-existing `reviewsAdded < 0 → 'declining'` rule classifies any drop beyond the rounding
tolerance as deteriorating *velocity*. #94 narrows the harm (small rounding-scale drops no longer
mislabel) but does **not** resolve it: a genuine spam-purge on a small base can still surface as
`'declining'`. A future pass should decide whether count-drop-`'declining'` should exist at all — e.g.
routing a real decrease to a data-quality / "needs-review" state rather than a velocity signal (note also
the pre-existing no-op `scoreBonus: 10` on `declining` in `opportunityScorer.js`). — #94 cold-read note.
