# PRD — SynchIntro Prospect Intel Enhancement v2.3

**Author:** Charles Berry / Claude
**Date:** June 12, 2026
**Status:** FINAL — build-ready, frozen. Further review is polish; next improvement comes from code.
**Repo:** pathsynch-pitch-generator (`functions/`)
**Frontend repo:** synchintro-app (vanilla JS — NOT React)
**Firebase project:** pathsynch-pitch-creation
**Supersedes:** v2.2 (June 12, 2026). Changes are marked **[v2.3]**: additive-only scoring fix (OR conditions), market snapshot split + caps, city-guarded matching, chip states, PR #23 split into 23A/23B, explicit provenance envelope. Everything else carries forward from v2.2/v2.1 verbatim.

---

## 0. PR map (read this first)

| PR | Branch | Scope | Reviewer | Est. |
|---|---|---|---|---|
| PR #19 | `feat/prospect-intel-tech-detection` | `techStackDetector.js` + `gbpGrader.js` + `techDetectionCache` + `calculateFitScore` extension + firestore.rules deny blocks + tests | Williams | 5h |
| PR #20 | `feat/prospect-intel-review-health` | `reviewHealthAnalyzer.js` + `outscraperClient.js` + `reviewHealthCache` + Cloud Tasks Tier-B handler + atomic credits + daily counters + tests | Williams | 5h |
| PR #21 | `feat/prospect-intel-pipeline-wiring` | `processOneProspect()` integration + `placesLookupCache` + batch-completion Phase B selection + `enrich-reviews` endpoint + F-033 limits | Williams | 4h |
| PR #22 | `feat/prospect-intel-frontend-columns` | synchintro-app table columns + detail panel + status states (vanilla JS) | Williams | 4h |
| **PR #23A [v2.3]** | `feat/prospect-intel-market-context-backend` | `marketContextResolver.js` + snapshot/index split + city-guarded matching + OR-condition scoring + reuse rule + tests | Williams | 3h |
| **PR #23B [v2.3]** | `feat/prospect-intel-market-context-frontend` | chips (2 states) + detail panel market section + partial-provenance rendering | Williams | 1.5h |

Build order strict: #19 → #20 → #21 → #22 → #23A → #23B. #23A/#23B are additive — nothing in #19–22 depends on them; the feature ships complete without them and better with them.

---

## 1. Conflict audit register

C-1 through C-12 carried forward unchanged (binding; **do not relitigate**):

- **C-1:** Path is `prospectIntel/{batchId}/prospects/{prospectId}`.
- **C-2:** Fit Score already 0–100 weighted (25/20/15/15/15/10/10) + 3 disqualification checks; extend `calculateFitScore`, never replace.
- **C-3:** Orchestration = `prospectIntelService.js` + Cloud Tasks → Cloud Run agent. `enrichmentJobProcessor.js` out of scope.
- **C-4:** Phase A inline/free/universal; Phase B async/metered/gated.
- **C-5:** Frontend is vanilla JS (`js/pages/*.js`).
- **C-6:** All new fields wear `buildSourceAttribution()` envelopes.
- **C-7:** Atomic credits, split semantics: sync endpoints 503 on `BILLING_TRANSACTION_FAILED`; task handlers record failure + return 200. Never unify.
- **C-8:** Deny-rule blocks for CF-only cache/counter collections. **[v2.3]** The new `meta/marketIndex` subcollection doc needs no rule: unmatched paths deny by default — verify at session start that `firestore.rules` has no permissive catch-all under `prospectIntel`.
- **C-9:** SSRF guard on all prospect-URL fetches (schemes, private ranges, metadata host, ≤3 redirects, 1.5 MB cap, 8s timeout, repo axios).
- **C-10:** F-033 remediation in PR #21.
- **C-11:** Exact model strings if ever used; `scoringProfiles.js` untouched; endpoint home `routes/prospectIntelRoutes.js` (verify shim).
- **C-12:** v2.1 hardening — flags, three caches with TTL split, `reviewHealthStatus` enum, two-layer enqueue idempotency, spending caps with top-N selection.

### C-13 (amended **[v2.3]**) — Market Intel cross-reference constraints
1. Report query uses the existing composite index (`marketReports: userId + location.city + createdAt DESC`); industry filtered in memory; **no new index**.
2. **Matches are strictly additive — now mathematically guaranteed.** v2.2's market-relative condition *swaps* could lower a score (market avg 4.1, prospect 4.2: static `<4.3` fires, relative `<4.1` doesn't). **[v2.3]** replaces swaps with OR-conditions (§5), so market context can only add signal fires, never remove them. The sole sanctioned suppression remains the flag-gated Phase B reuse rule.
3. Market Intel review fields are partial: may fill `responseRate` + `daysSinceLastReview`; must NEVER fabricate `velocity` or a grade.
4. `marketReports` is read-only to this feature.
5. **[v2.3] Snapshot size discipline:** the batch doc is consumed by the frontend `onSnapshot` progress listener — it must stay lean. Benchmarks live on the batch doc; the competitor index lives in a separate `meta/marketIndex` doc with hard caps (§3E). Cap-before-write follows the existing citation-intelligence precedent (25/50/15 caps enforced pre-write).
6. **[v2.3] City guard:** fuzzy matching requires geographic compatibility (§3E) — business names repeat across cities in exactly these verticals.

---

## 2. Business case & cost design principles

### 2A. Business case — unchanged from v2.2
Displacement-aware + market-relative Fit Score; matched prospects inherit market leader, presence gap, news triggers, entry wedge. The Market-Intel-to-Prospect-Intel join is structurally PathSynch-exclusive.

### 2B. Cost design principles — unchanged from v2.2
Zero new LLM calls; cache before calling (PR #23 = zero external calls, reads existing Firestore); meter everything (`outscraperUsageLog`); caps not hope; flags not reverts.

**Feature flags:**
```
ENABLE_TECH_STACK_DETECTION=true
ENABLE_REVIEW_HEALTH_ENRICHMENT=true
ENABLE_AUTO_REVIEW_ENRICHMENT=true
ENABLE_ENRICHMENT_REUSE=true
ENABLE_MARKET_CONTEXT=true
MARKET_CONTEXT_MAX_AGE_DAYS=60
MARKET_INTEL_REVIEW_REUSE=true
```

---

## 3. New files

### 3A–3D — unchanged from v2.1/v2.2
`techStackDetector.js` (47 fingerprints, SSRF guard, displacement classification, cache-first) · `reviewHealthAnalyzer.js` + `outscraperClient.js` (≥5 reviews AND ≥90d gates, A–F grades, 429 retry, cache-first, usage logging) · `gbpGrader.js` (5×20, `gradeBasis`) · `enrichmentCache.js` (three caches, success/failure TTL split, full-hostname normalization).

### 3E. `functions/services/marketContextResolver.js` **[v2.3 — amended]**

```javascript
async function resolveMarketContext(userId, city, state, industry)
// Existing-index query (limit 5), in-memory industry + freshness filter.
// Returns null, or TWO objects:
//
// benchmarks (→ batch doc, lean, listener-safe):
// { reportId, generatedAt, ageDays, marketAvgRating, marketAvgReviews,
//   topQuartileRating, marketLeader: { name, rating, reviews, voiceShare },
//   totalCompetitors, seoMarketAvg, entryWedge, bestTimeToCall,
//   painPoints: [≤3], newsSignals: [≤3 × { headline ≤200 chars, ageDays }] }
//
// competitorIndex (→ prospectIntel/{batchId}/meta/marketIndex doc):
// [≤100 records × { normalizedName, rawName ≤120, city, state, rating, reviews,
//   voiceShare, seoScore, seoTier, responseRate?, lastReviewDaysAgo?,
//   opportunityScore?, intelSignals: [≤3 × ≤200 chars] }]
// Built from BOTH competitors and qualifiedLeads lists; if source exceeds 100,
// keep all qualifiedLeads first, then competitors by voiceShare desc.
// ALL CAPS ENFORCED BEFORE WRITE (citation-intelligence precedent).

function matchProspectToReport(prospect, reportMeta, competitorIndex)
// prospect: { name, city, state }
// Normalization: lowercase, strip punctuation, strip legal suffixes
// (llc, inc, co, corp, ltd), collapse whitespace.
//
// NAME RULE (unchanged): exact normalized equality, OR token-set similarity ≥ 0.9.
// Substring matches forbidden.
//
// [v2.3] CITY GUARD (all conditions evaluated on normalized values):
//   token-similarity matches REQUIRE prospect.city == reportMeta.city
//     (fuzzy names need the geographic anchor — metro-suburb rows like
//      Vinings in an Atlanta batch will simply not token-match, by design);
//   exact matches REQUIRE prospect.state == reportMeta.state, AND
//     (prospect.city == reportMeta.city OR name passes the distinctiveness test);
//   DISTINCTIVENESS TEST: after normalization, the name must contain ≥1 token
//     outside the generic stoplist [auto, automotive, repair, repairs, service,
//     services, car, care, shop, center, centre, garage, motors, mobile, pro,
//     professional, quality, family, express, complete, total, best, top].
//     "professional automotive repair" → all generic → cross-city exact REJECTED.
//     "hemixperts" → distinctive → cross-city exact (same state) ALLOWED.
//
// Returns { matched, matchType: 'exact' | 'token' } or null.
```

**Execution model [v2.3 amended]:** `onProspectBatchCreated` calls the resolver once; writes `marketContext` (benchmarks) to the batch doc and the capped `competitorIndex` to `prospectIntel/{batchId}/meta/marketIndex`. `processOneProspect()` reads the meta doc (one small read per task, already reading the batch doc) and matches in memory. The frontend listener never receives the index.

**On match (provenance `source: 'market_intel'`, confidence `medium`):** `marketIntelMatch` written; reviewHealth partials per the explicit envelope in §6.

**Phase B reuse rule — unchanged from v2.2:** matched prospect with BOTH `responseRate` AND `lastReviewDaysAgo` from a report ≤30 days old is excluded from AUTO selection when `MARKET_INTEL_REVIEW_REUSE=true`; manual enrichment always available and overwrites partials (provenance flips to `outscraper_reviews`). Counted in `phaseBReusedFromMarketIntel`.

---

## 4. Modified files

### 4A. `processOneProspect()` **[v2.3]** — as v2.2 with one change: reads `meta/marketIndex` for matching (batch doc supplies benchmarks only). All market steps try/catch-wrapped; failures null-exclude, never block.

### 4B. `processReviewHealthTask` — unchanged (status guard → cache-first → atomic credits with C-7 split → Outscraper → analyze → write → cache upsert → rescore → always 200; named-task + status-transaction idempotency).

### 4C. `prospectIntelRoutes.js` — unchanged (`enrich-reviews`: ≤50/400, owner/403, flag/409, cap/429, billing/503; F-033 limits on batch endpoint).

### 4D. `calculateFitScore()` — §5.

### 4E. `runPhaseBSelection(batchId)` — unchanged from v2.2 (single-fire transaction, ≥70, top-N desc, caps, shared daily budget, market-intel reuse exclusion + counter).

---

## 5. Enhanced Fit Score **[v2.3 — additive-only fix]**

Existing 7 weighted signals, fit labels, 3 disqualification checks preserved (C-2). New signals (weights unchanged from v2.2):

| Signal | Weight | Condition |
|---|---|---|
| no_reputation_tool | 10 | no reputation hit AND fetchStatus 'ok' |
| displaceable_form_tool | 8 | formBuilders hit, type cost/workflow |
| analytics_upsell | 5 | FB Pixel or CallRail |
| low_response_rate | 6 | responseRate < 0.20 (Phase B or market_intel partial) |
| low_velocity | 6 | velocity < 2 (Phase B only — never from market intel) |
| stale_profile | 5 | daysSinceLastReview > 30 (Phase B or market_intel partial) |
| presence_gap | 6 | reviews ≤ 0.35 × marketAvgReviews (requires marketContext) |

**[v2.3] Market-relative OR-conditions (replaces v2.2's swaps):** when `batch.marketContext` exists —
- `low_rating` (25) fires iff `rating < 4.3` **OR** `rating < marketAvgRating`
- `low_reviews` (20) fires iff `reviews < 50` **OR** `reviews < 0.5 × marketAvgReviews`

Without context, the static conditions stand alone — identical to v2.1 behavior. **Invariant (now mathematical, not aspirational): for identical prospect data, fitScore(with context) ≥ fitScore(without context) minus nothing — context can only add fires.** Note the deliberate corollary: in hot markets (Atlanta avg 4.76 / 360 reviews) the OR widens detection (`low_reviews` effectively `<180`), so context-enriched batches may legitimately score HIGHER than blind ones. More information surfaces more opportunity; it never hides any.

Null-exclusion unchanged: `fitScore = round(100 × earnedWeight / availableWeight)`; `presence_gap` denominator-excluded without context; `no_review_response` legacy proxy yields to measured/prefilled `low_response_rate`.

`classifyRecommendedProduct()` + pitch context as v2.2 (displacement awareness; `marketContext` block with wedge/leader/news/bestTimeToCall/painPoints; market-relative `primaryPitchAngle` lines).

---

## 6. Firestore schema additions

Prospect doc — v2.1 fields unchanged, plus:
```javascript
marketIntelMatch: { value: { matchedName, matchType: 'exact'|'token', reportId, voiceShare, seoScore, seoTier, opportunityScore, intelSignals }, source: 'market_intel', confidence: 'medium', updatedAt } | null,
```

**[v2.3] Explicit reviewHealth partial envelope (market-intel-sourced — byte-for-byte spec):**
```javascript
reviewHealth: {
  value: {
    responseRate,                // from report
    daysSinceLastReview,         // from report
    velocity: null,              // NEVER fabricated
    reviewHealthGrade: null      // NEVER fabricated
  },
  source: 'market_intel',        // flips to 'outscraper_reviews' on manual enrich overwrite
  confidence: 'medium',
  updatedAt,
  failureReason: null
}
```

Batch doc — v2.1 counters + `phaseBSelectionDone`, `phaseBCapHit?`, `phaseBReusedFromMarketIntel`, plus **[v2.3]** `marketContext` = **benchmarks only** (§3E shape, lean).
**[v2.3]** New doc: `prospectIntel/{batchId}/meta/marketIndex` — capped competitorIndex (≤100 records). CF-only; protected by default-deny (verify no catch-all, C-8).

Cache collections, daily counter, `reviewHealthStatus` enum, `failureReason` vocabulary — unchanged.

---

## 7. Frontend — synchintro-app (vanilla JS)

Columns, detail panel, bulk action, status states — unchanged from v2.1/v2.2. **[v2.3] chip states:**

| State | Row UI |
|---|---|
| `matchType: 'exact'` | "Market Intel" chip |
| `matchType: 'token'` | "Market Intel · likely match" chip |
| batch `marketContext` only, no prospect match | no row chip; detail panel still renders the Market context section |

Chip tooltip: matched report name + age + matchType. Review-health partials render with the medium-confidence dot and "velocity pending"; full Outscraper data replaces on manual enrich (source flip visible in tooltip). Old batches render identically to v2.1 — zero regressions, zero console errors.

---

## 8. Graceful degradation
Rules 1–11 from v2.1/v2.2 unchanged. **[v2.3]** 12. `meta/marketIndex` read failure in a prospect task → that prospect matches nothing (`marketIntelMatch: null`); benchmarks-driven OR-conditions still apply from the batch doc; pipeline continues.

---

## 9. Credits, cost & metering — unchanged from v2.2
Phase A $0 · Places ~$0.05/agent-miss (cached 30d/3d) · Phase B 10 credits + ~$0.30 live (cached 14d/3d; cache hit = no deduction) · daily ceiling ≈ $150 · `outscraperUsageLog` with `cached` flag · PR #23 marginal cost $0 and net-negative via reuse counter.

---

## 10. Env vars — unchanged from v2.2 (§2B list; all in `.env.example` per S13).

---

## 11. Acceptance criteria

PR #19, #20, #21, #22 — unchanged from v2.1 (binding).

**PR #23A [v2.3 — backend]**
- [ ] Resolver: null on no report / wrong industry / stale (> MARKET_CONTEXT_MAX_AGE_DAYS); newest qualifying report wins; existing index only (assert query shape)
- [ ] **Caps enforced pre-write:** competitorIndex ≤100 (qualifiedLeads kept first, then competitors by voiceShare desc), rawName ≤120, intelSignals ≤3×200, newsSignals ≤3, painPoints ≤3 — fixture with oversized synthetic report
- [ ] **Snapshot split:** benchmarks on batch doc, index in `meta/marketIndex`; batch doc payload asserted lean (no competitorIndex field)
- [ ] Matcher name fixtures: exact; suffix-stripped ("HemiXperts LLC"); token ≥0.9 ("Blue Ridge Automotive - European & Domestic" variants); REJECTS substring trap ("Automotive Service" vs "Automotive Service & Repair"); REJECTS near-name siblings ("Braxton ... Howell Mill" vs "Braxton ... Northside")
- [ ] **[v2.3] City-guard fixtures:** token match in Vinings vs Atlanta report → REJECTED (city anchor); exact "HemiXperts" in Marietta, GA vs Atlanta report → ALLOWED (distinctive + same state); exact "Professional Automotive Repair" in Marietta vs Atlanta report → REJECTED (all-generic stoplist); exact same-name different state → REJECTED
- [ ] **[v2.3] Additive-only invariant test:** for a fixture sweep including the v2.2 bug case (market avg 4.1, prospect 4.2★), assert fitScore(with context) ≥ fitScore(without context) for every prospect; OR-conditions fire on static-only, relative-only, and both
- [ ] reviewHealth partials: exact envelope per §6 — responseRate + daysSinceLastReview set, velocity null, grade null, source 'market_intel', confidence 'medium'
- [ ] Match never disqualifies / never lowers (regression pair)
- [ ] Reuse rule: exclusion from auto selection, counter increments, manual overwrite flips source to 'outscraper_reviews', flag-off disables
- [ ] `ENABLE_MARKET_CONTEXT=false` → scores byte-identical to v2.1 fixtures
- [ ] Full suite green

**PR #23B [v2.3 — frontend]**
- [ ] Three chip states render per §7 table; tooltips correct
- [ ] Market context detail section renders for batch-context-only rows (no chip)
- [ ] Partial provenance visible (medium dot, "velocity pending"); source flip after manual enrich
- [ ] Old batches: zero regressions, zero console errors

---

## 12. Scope boundaries — NOT in this build
Unchanged from v2.2: no Gemini fallback (V2: SIMPLE tier + context caching); no changes to enrichmentJobProcessor.js / pitchEnricher.js / agents/prospectResearchAgent.js / Cloud Run agent / scoringProfiles.js; no Redis semantic cache; no agent-result caching; no density column; no PathManager col_leads integration; no Phase A pricing changes; no `marketReports` writes; no placeId joining (V2 if reports store placeId); no report auto-generation; no cross-user report sharing.

---

## 13. Integration test plan (post-merge)
Tests 1–7 (v2.1) and 8–9 (v2.2) unchanged, with test 8 amended **[v2.3]**: assert benchmarks-on-batch / index-in-meta split, Vinings-row token rejection, and the additive-only sweep on the live Atlanta report data.

---

## 14. Resolutions (confirmed June 12) — unchanged
Q1 auto Phase B W1 / manual W2-W3 · Q2 deduct credits, absorb Outscraper cost · Q3 Gemini fallback OFF · Q4 density in detail panel only.

---

## 15. Carry-forward rules

1. Phase A free and universal; Phase B metered and gated. Never invert.
2. Review health requires ≥5 reviews AND ≥90-day span; otherwise `insufficient_data` — never a fabricated grade (applies equally to market-intel partials: velocity/grade stay null).
3. Null signals excluded from the denominator, never scored 0.
4. All new fields wear provenance envelopes; cache hits `source: 'cache'`; market partials `source: 'market_intel'` until Outscraper overwrites.
5. Every prospect-URL fetch goes through the SSRF guard — including all future V2 work.
6. Legacy `no_review_response` yields to measured/prefilled `low_response_rate`.
7. Sync endpoints fail loud (503); task handlers fail recorded (200). Never unify.
8. Cache failures cache short (3d); successes long (30d/14d). Caches are optimizations, never dependencies.
9. Spend has a daily hard ceiling. Caps are transactions, not estimates.
10. Market Intel matches are additive-only; sole sanctioned suppression is the flag-gated reuse rule.
11. Fuzzy matches are confidence `medium`, forever; only a placeId join earns `high`.
12. **[v2.3]** Market-relative conditions are OR-extensions of static conditions, never replacements. Context may only ADD signal fires. The additive-only invariant (`score with context ≥ score without`) is a tested property, not a policy.
13. **[v2.3]** Everything written to batch-level docs is capped before write; the realtime listener payload stays lean. Bulk reference data goes in `meta/` subcollection docs.
14. **[v2.3]** Geographic compatibility is part of identity: token matches require same city; exact matches require same state plus name distinctiveness for cross-city.

---

## 16. Claude Code kickoff prompt

Identical to v2.1 §16 (read order; verifications a–d; prior-art fence; PR #19-only first unit of work), with:
- Step 3 file: `PRD-prospect-intel-v2.md` is the copy of **this v2.3** document.
- Verification **(e)**: open a recent `marketReports` doc; confirm field names for market averages, leader, competitors, qualified leads (binds §3E mapping to the real shape — report before the 23A session).
- Verification **(f) [v2.3]**: confirm `firestore.rules` has no permissive catch-all under `prospectIntel` (default-deny covers `meta/marketIndex`).
- Subsequent sessions swap the unit-of-work block for PR #20 / #21 / #22 / **#23A** / **#23B**; the 23A session re-reads §3E, §5, and C-13 in full.
