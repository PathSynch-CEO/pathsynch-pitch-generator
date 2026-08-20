# CHANGELOG — 2026-08-20 (PR-C2: High-Impact Moves provenance gate)

**Branch:** `fix/him-provenance-gate-pr-c2`

The defect is NOT fabrication — Gemini often recalls REAL owners/businesses from training. It is that
names and businesses arrive with **zero pipeline provenance**, so correct-by-memorization is
indistinguishable from a guess and can go stale or collide.

## Two clarifying findings (reported before implementing)

1. **v10 4th intel-signal line ("Share of voice: X% — effectively invisible online").** NOT scope
   creep from #90. `git log -L` dates it to commit `28c8692` (2026-03-30, "feat: share of voice
   calculation"). #90 only touched intel LINE 1 (median baseline) + LINE 2 (denom). The line is
   conditional (`opportunityScorer.js:243`, fires when `lead.shareOfVoice < 5`), and the number is
   **derived** (`reviews / totalMarketReviews × 100`, computed at `market.js` SOV block). It surfaced
   in v10 because the junk-removal leader (26,802 reviews) drove qualified leads below the 1%/5%
   thresholds — data crossing a threshold, not new code. **Verdict: legitimate, derived, pre-existing
   — line stays.**

2. **DM-enrichment source (read-before-wiring gate).** `enrichDecisionMaker`
   (`services/decisionMakerEnrichment.js`) is a 3-source waterfall: **Serper web search** →
   **website about-page** → **TheOrg API**, with Gemini used only to EXTRACT a name from the
   retrieved snippets (temperature 0). It is **search-grounded, not a bare Gemini guess**, and stamps
   `source: 'search'|'website'|'theorg'`. Verified live on report `Nf5gIdrM2OntxUsAMzQA`: Ryan
   Tabb/Peachtree and Stacey Stembridge/SS PRO both landed with `source:"search"`. **Safe to wire into
   a verified field — no stop needed.**

## Part 1 — DM-enrichment race fix + provenance field

`dmEnrichmentPromise` (started `market.js:~2050`) was awaited ~120 lines AFTER the narrative
generators ran, so the HIM / salesIntel / exec-summary prompts read leads with no `decisionMaker` and
Gemini filled names from training recall. Fix: **await `dmEnrichmentPromise` BEFORE the generator
block** (it was already running concurrently with the reference-competitor fetch, so little added
wall-clock; the redundant late await was removed). Results land in `leads[].decisionMaker` with
`verifiedAt` added alongside the existing `source`/`confidence` provenance.

## Part 2 & 3 — provenance gate (`services/himProvenanceGate.js`, new)

Deterministic post-generation gate over High-Impact Moves + salesIntel prose:
- **Person names** (HIM + salesIntel): a name renders only if it matches the search-grounded
  `leads[].decisionMaker` field (name / buyer / contacts). An unbacked recalled name is rewritten to
  the business role — `"the owner of <business>"` in HIM, `"the business owner"` in salesIntel. Never
  a bare unverified name, never a hedge.
- **Business names** (HIM only): every business named in a move must be in the analyzed set
  (leads + competitors, normalized-name match) or a **news-signal entity** (substring of a news
  title — e.g. "Authority Brands"). An out-of-set business is rewritten to an in-set anchor when the
  move's logic survives, else the move is **dropped**. No filler floor: survivors render even if
  fewer than two (`floorMet:false` is logged).
- Classifier notes: business tokens are distinctive suffix/brand words only (NOT service categories
  like "cleanout"/"dumpster", which would false-positive on "Residential Cleanout"); a leading run of
  verbs/stopwords is stripped before classifying ("Message Bob Roberts" → classify "Bob Roberts").

Wired in `market.js` after generation, before storage (non-blocking).

## Tests
- `functions/tests/himProvenanceGate.test.js` (11) — the **verbatim v10 HIM** passes through untouched
  (0 rewrites, 0 drops; Ryan Tabb kept; Authority Brands kept); unbacked-name rewrite; out-of-set
  rewrite-with-anchor and drop-without-anchor; min-2 floor (render 1 survivor, no filler);
  salesIntel name gate; helper unit tests.
- `functions/tests/himDecisionMakerWiring.test.js` (2) — race mechanism: a populated `decisionMaker`
  reaches the HIM prompt ("DM: Ryan Tabb"); an absent one (the old lost-race state) does not.

Full suite: **2276 passing, 0 failing** (109 suites).
