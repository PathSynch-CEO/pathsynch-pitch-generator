# PRD — SynchGov Capture Enhancements (prd-synchgov-capture-01, v2.2)

**Product**: SynchGov (within SynchIntro, Firebase project pathsynch-pitch-creation)
**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Author**: Charles Berry / Claude
**Date**: 2026-07-15 (v2.2; supersedes v1.1 of 2026-07-15 and v1.0 of 2026-07-14)
**Status**: Gate 1 (strategy review) — awaiting approval before build
**Parent document**: SynchGov MVP PRD v1.2 (2026-06-13) — this PRD extends the shipped MVP; it does not modify MVP scope retroactively.
**Merge convention**: All five PRs are product code → **Williams merges. No self-merge. No bypass-permissions sessions.**

**Changelog v1.1 → v2.2** (from the 2026-07-15 code-grounded critical review):
1. **Composite formula specified** — the Math.max clamp is scoped back to its documented purpose and a **solution-relevance gate** closes the 60/90-point rule-float that made the "Mail Management" fixture unpassable as written (§4.4).
2. **AI-call standards** — all new AI calls use `generateStructured()` + `usageMetadata` (matches live code and parent carry-forward rules 18/20); `indexOf('{')` language removed (§12).
3. **Sequencing inverted** — PR-C5 ships first in manual-upload mode (zero C4 dependency); C4 upgrades it later (§2, §11).
4. **Data model section added** — `govPursuits`, `govProposalDocs`, deny blocks, composite indexes, and the `pursuitStatus` migration (§13).
5. **Terminology corrected** — Rank fields feed `_semanticSolutionMatch()` inside Pass 1's solution dimension, not a "Pass 2 prompt" (§4.2).
6. Seven smaller amendments: scoring-only expandedKeywords, attachment fetch guard + provider licensing gate, threshold methodology + design note for Williams, `avgContractValue` home, entitlement note, "pass" → "No-Bid Recommended" UI string, contacts provenance.

**Source insights**:
1. Competitive teardown of JustWin AI (Countifi/David Hailey account, 13 screenshots + sourcing-profile exports, 2026-07-14), validated against SynchGov's live Opportunity Inbox export.
2. Countifi onboarding call (David Hailey + Aya, 2026-07-15) — live customer validation of the Pursuits gap and two new commitments (evaluator, expanded sources).
3. PathSynch GovCon competitive research package (2026-07-15): GovSpend, GovCon API, Civio, GovDash, SamSearch deep dives.
4. **[v2.2]** Line-level review of the live scoring code (`scoringPipeline.js`, `govScoringEngine.js`, `briefGenerator.js`, `schemas.js`, 2026-07-15).

---

## 1. Problem Statement

SynchGov's first live sync works (25 SAM.gov opportunities, scored, briefed) but the export and the Countifi call expose four gaps:

1. **Triage is dead.** All 25 opportunities sit in Review; 0 Hot, 0 Warm; 18 of 25 score exactly 0. The top score (42, "Mail Management Services") received a no-bid recommendation from its own brief — the rule-based pass rewarded broad NAICS overlap that the semantic pass correctly rejected. **[v2.2] Root cause confirmed in code**: Pass 1's five non-solution dimensions are worth 60 of 90 points (`govScoringEngine.js:114–177`), so an opportunity with *zero* semantic solution relevance can still normalize to ≈67. This is structural, not a threshold-tuning problem — §4.4 specifies the composite fix. Separately, the "18 score exactly 0" figure conflates hard-disqualified rows with genuine zero-signal rows; §4.4 disambiguates them.
2. **No place to work.** The MVP dashboard's pursuit board (MVP PR #8) is a display surface, not a pipeline. David Hailey asked for exactly this on the 2026-07-15 call: "one page and say, where are we with this pitch... this one's still in planning, I'm still drafting this one, I sent five last week." The post-triage workflow (draft → check → submit → await) lives in the user's head.
3. **The judgment layer is thinner than it could be.** The brief already outputs Bid Recommendation / Fit / Deadline Risk (richer than JustWin's "Possible fit"), but lacks the two highest-value extraction passes JustWin ships (yellow flags, key-questions answers) and the evaluator pass Charles committed to David.
4. **Single-source ceiling.** SAM.gov-only coverage caps opportunity volume below David's 5-submissions/week goal. RFPMart was architecturally anticipated in the MVP (GOVCAPTURE_RFPMART_ENABLED, dormant); GovCon API research (2026-07-15) identifies a faster normalized multi-dataset path plus primitives (attachments, recompetes, contacts) that PRs C4/C5 need.

## 2. Customer Commitments Traceability

| **Commitment (made on 2026-07-15 Countifi call)** | **Deadline stated** | **Covered by** |
| :-: | :-: | :-: |
| Proposal evaluator: compliance check + evaluator-style quality score vs. RFP | "Next week" | PR-C5 |
| Sources beyond SAM.gov (RFPMart named) | "Weeks, not months" | PR-C4 |
| Pursuits pipeline page ("where are we with this pitch") | Acknowledged gap, "let me get that implemented" | PR-C2 |
| Tier 1 document intelligence (keyword extraction across uploaded past proposals) | ~6 weeks | Partially PR-C5 (proposal library ingestion); Tier 2 out of scope |
| Submission rules/instructions surfacing | Duly noted, no date | PR-C5 extraction fields (submission instructions in key-questions set) |
| Unlimited uploads for Countifi (VIP) | Immediate | Config change, not a PR; size-gating deferred |

**[v2.2] Sequencing**: Track A: **C1 → C2 → C3**. Track B: **C5 (manual-upload mode) → C4**. C5's only hard dependency on C4 was *automatic* attachment retrieval — a convenience, not a prerequisite; the manual-upload pipeline (MVP PR #5) is live in production, so the merchant uploads both the RFP and the draft. This honors the shortest customer deadline with zero vendor dependency. When C4 lands, its attachment pipeline upgrades C5's RFP input from "user uploads" to "fetched automatically" — an enhancement PR, not a rework. Customer message becomes a capability statement, not a dependency apology: *"Evaluator ships against uploaded RFPs now; automatic RFP retrieval follows with the multi-source connector."*

## 3. Out of Scope (scope fence)

- Autonomous or assisted proposal **submission** (restated: SynchGov never submits on the customer's behalf)
- Tier 2 document intelligence (tables, sentiment, full auto-populate) — separate PRD after Tier 1 proves out
- GovSpend SLED data integration — commercial/licensing discovery track, not a build item (see §9)
- Civio-style autonomous agents / background teammates — deferred until the deterministic opportunity-to-pursuit workflow shows consistent use
- FOIA tooling
- CUI or sensitive-document handling (per GovDash research: MVP stays on public opportunity data + merchant-controlled non-CUI documents)
- Full GovDash-style lifecycle (Pricer, Contract management)
- Nationwide original SLED crawling

## 4. PR-C1 — Rank Fields, Keyword Expansion, and Score Recalibration

**Goal**: Fix dead triage. Make Hot/Warm reachable and make the score reflect what the merchant actually sells.

### Scope

1. **Profile schema: Rank layer.** Add free-text fields to the GovCapture profile, separate from hard Match filters:
   - rankIdealSolutions (string, "describe your ideal solutions like you would to a new sales rep")
   - rankIdealCustomer (string)
   - rankIdealGeography (string)
   - rankAvoid (string, e.g. "skip physical services, logistics, and staffing")
   Each field gets placeholder example text in the UI (JustWin's onboarding pattern). Fields are optional; scoring with absent Rank fields behaves as today (backward compatibility, §13).

2. **[v2.2] Rank fields feed the semantic solution match.** The four Rank fields are consumed by `_semanticSolutionMatch()` (`govScoringEngine.js:255`) — the Gemini call inside **Pass 1's solution-match dimension** (30 pts). Because Pass 2 (`rescoreWithAwardContext()`) re-runs Pass 1 with semantic enabled (`govScoringEngine.js:209`), the Rank context automatically applies to both passes; "Pass 2" refers exclusively to the USAspending award-context rescore and is not a separate prompt surface. The Rank fields are also injected into the brief prompt (`briefGenerator.js`) as merchant context. rankAvoid acts as a semantic negative signal (distinct from hard negative keywords, which remain exclusion filters). Cost note: each enriched opportunity already makes two semantic calls per scoring cycle (Pass 1 + Pass 2's re-run); the Rank prompt lands in `_semanticSolutionMatch()` once and inherits both call sites — do not add a third.

3. **Keyword auto-expansion.** At profile creation/edit, one Gemini call (per §12 AI-call standards) expands each solution description into a candidate keyword set (target 40–60); user prunes before save. Store as expandedKeywords[] per solution with userApproved: true/false per keyword. **[v2.2] Expanded keywords are scoring-only** — consumed by the deterministic prefilter and semantic prompt, **never query-grade**: SAM.gov query construction continues to use the profile's top-10 query-grade keywords (MVP caps: ≤10 queries, ≤500 records, unchanged; extends parent carry-forward rule 13's scoping discipline to positive keywords). Cap stored expansions at 60 per solution (≤10 solutions bounds profile-doc growth at ~600 short strings).

4. **[v2.2] Composite integrity — solution-relevance gate + FIAT decomposition.** Restructure the displayed score into four labeled components with reason codes — **Fit** (solution/capability match — semantic), **Intent** (buyer-type priority, set-aside alignment), **Access** (certifications, registrations, geography, contract-size band), **Timing** (deadline risk — already implemented). Composite remains 0–100. The two-pass architecture (Pass 1: 90 pts, Pass 2: 100 pts with USAspending) is preserved, with one change to composite assembly:
   1. **Gate**: when semantic solution-match relevance is ≤ 3/10 (`_semanticSolutionMatch().relevanceScore <= 3`), the composite is **capped at 39** (top of the Poor Fit band, below the Stretch threshold of 45), regardless of what the rule dimensions earn. Reason code `GATE_LOW_SOLUTION_RELEVANCE` is appended. The gate applies identically in both passes (Pass 2 re-runs Pass 1, so it composes automatically).
   2. **Clamp scoped to its original purpose**: `Math.max(pass1.score, pass2.score)` (`scoringPipeline.js:77`) is retained solely to neutralize the 90→100 denominator shift when award context earns 0 (its documented intent, lines 72–74). Both passes compute under the gate, so the clamp can never resurrect a gated score.
   3. **Disagreement surfacing**: when the rule-only composite (semantic dimension excluded, rescaled) and the semantic-scaled solution score imply labels ≥ 20 normalized points apart, append `RISK_RULE_SEMANTIC_DISAGREEMENT` and require the brief to state the disagreement explicitly instead of presenting a single confident number.
   3a. **Gate behavior without a semantic read** (closes a bypass): when scoring runs without a semantic result — the Gemini call failed (deterministic fallback at `govScoringEngine.js:105–108`) or the Gemini gate skipped the call — the solution-relevance gate cannot evaluate, and the rule dimensions could float the score unchecked. In that state: append `SEMANTIC_UNAVAILABLE`, and **cap the label at Review** (an opportunity may not reach Warm/Hot without a semantic confirmation). A later rescore with semantic available clears the cap.
   4. **Fit-label single source of truth**: `_fitLabel()` is currently duplicated with identical thresholds in `scoringPipeline.js` and `govScoringEngine.js`. PR-C1 consolidates to one exported function **before** recalibrating bands — otherwise the copies diverge silently.
   5. **Zero-score disambiguation**: the FIAT display distinguishes `hardDisqualified` (hard-filter kill, e.g. "Disqualified — past due") from a genuine low score; recalibration statistics exclude hard-disqualified rows.
   6. **`fit.scoringVersion` + deploy rescore sweep**: the fit object gains a `scoringVersion` integer. On C1 deploy, a one-time sweep rescores all non-archived opportunities where `scoringVersion` is absent or below current — otherwise the inbox mixes scores from two incompatible formulas. The sweep respects the Gemini gate (deterministic prefilter first) and is idempotent.
   7. **Gate threshold governance**: the gate parameters (relevance ≤ 3 → cap 39) are **code constants** adjacent to the fixtures — not env vars. They change only with fixture evidence in a reviewed PR; an env var would invite untested production drift.

5. **Threshold recalibration.** **[v2.2]** Bands are recalibrated as fixed score thresholds validated against the 25-opportunity live set plus Countifi's profile as fixtures, with the explicit caveat that n=25 is a starting sample; a revisit is scheduled after PR-C4 changes the volume distribution. Hard-disqualified rows are excluded from distribution statistics. Because scoring-engine edits are flagged for manual approval, PR-C1 attaches a **1-page design note** (current formula → gated formula → fixture outcomes) for Williams. Acceptance requires a non-degenerate distribution (below).

6. **[v2.2] UI string fix (in scope, trivial)**: rename the brief's displayed `Bid Recommendation: pass` value to **"No-Bid Recommended"** (and `pursue` → "Bid Recommended") — "pass" is ambiguous in a scoring UI.

### Acceptance criteria

- Regression test: **"Mail Management Services" (fit 42, NAICS-overlap false positive) must score in the bottom quartile** for the PathSynch profile once rankAvoid includes physical services — **and must carry `GATE_LOW_SOLUTION_RELEVANCE`** (assert the mechanism, not just the rank). The JustWin welcome-kit false-positive fixture from the MVP suite continues to pass.
- **[v2.2] Rule-float fixture**: an opportunity with `MATCH_NAICS_EXACT` + priority buyer + comfortable deadline but semantic relevance 2 → composite ≤ 39 (proves the 60-rule-point float is closed).
- **[v2.2] Gate non-interference fixture**: a genuinely strong opportunity (semantic ≥ 7) is unaffected by the gate.
- On the live 25-opportunity set with a completed Rank layer: not all opportunities in one band; at least one opportunity crosses into Warm or the brief explains why zero do.
- Keyword expansion returns within one Gemini call per solution, per §12 standards (SIMPLE tier via `generateStructured()`, `usageMetadata` logged).
- No changes to firestore.rules without Williams's explicit review (audit finding F-101 context: two repos deploy rules to one project).
- Full suite green (baseline **1,724**).

### Flags

- GOVCAPTURE_RANK_FIELDS_ENABLED
- GOVCAPTURE_FIAT_DISPLAY_ENABLED (display decomposition can ship dark)

## 5. PR-C2 — Pursuits Pipeline

**Goal**: Give the merchant one page that answers "where are we with every pitch." Upgrade the MVP PR #8 board from display surface to working pipeline.

### Scope

1. **Pursuits tab** within SynchGov, adjacent to Opportunities (mirrors the Pitches Pipeline/Library tab pattern). Not merged into the Opportunities page.
2. **Explicit promotion.** Opportunities enter Pursuits only via a "Create Pursuit" action (from the opportunity detail or brief). **Never auto-populate the board with all scored results** — that recreates a second inbox.
3. **Stage model** (from David's JustWin walkthrough, adapted): planning → drafting → compliance_check → ready_to_submit → submitted → awaiting_result → won | lost | no_bid. Submission itself remains external; submitted is user-attested with date + destination portal field.
4. **Outcome attribution from day one** (GovDash lesson). Every pursuit document carries: sourceOpportunityId, sourceProvider (sam.gov | manual | rfpmart | govconapi), fitScoreAtPromotion, stage-transition timestamps, outcome, awardValue (nullable), lossReason (nullable). These fields power PR-C3 honestly and are cheap now, painful to retrofit.
5. **Activity integration.** Stage transitions write to the existing Activity tab/feed.
6. **[v2.2] Data model + `pursuitStatus` migration** per §13 — `govPursuits` is the single source of truth; the existing `govOpportunities.pursuitStatus` field is mirrored, not dual-written by clients.
7. **[v2.2] Promotion idempotency**: at most **one active pursuit per (userId, sourceOpportunityId)** — enforced in a Firestore transaction (the MVP sync-lock pattern). A second "Create Pursuit" returns the existing pursuit (200, not error). A new pursuit for the same opportunity is only possible after the prior one reaches a terminal outcome.
8. **[v2.2] Independence from opportunity archival**: auto-archive (MVP behavior) of a source opportunity never mutates or hides its pursuit — the pursuit is the working object; the board renders from `govPursuits` regardless of opportunity state.

### Acceptance criteria

- Promoting an opportunity removes it from triage counts and appears on the board within one refresh.
- A pursuit can complete the full stage path in tests, with every transition timestamped and attributed to a user.
- Board renders in both kanban and table modes (parity with MVP PR #8 toggle).
- 0 pursuits exist for a fresh account — the empty state instructs, it does not auto-fill.
- **[v2.2]** Direct client writes of pursuit-managed `pursuitStatus` values via `PUT /opportunities/:oppId/status` are rejected (409) when a linked pursuit exists.
- Full suite green (baseline 1,724).

### Flags

- GOVCAPTURE_PURSUITS_ENABLED

## 6. PR-C3 — Analytics Card Set

**Goal**: Make the module visibly pay for itself. One new card set on the existing Analytics dashboard (M1–M10 infrastructure).

### Scope

1. Cards: opportunities ingested this period; scored distribution (Hot/Warm/Review); pursuits by stage; submissions this period vs. the merchant's stated weekly goal (Countifi: 5/week); win/loss once outcomes exist.
2. **Pipeline value surfaced**: user-entered average contract value × qualified opportunities = "$X pipeline surfaced." Label the assumption in the UI (honest theater). **[v2.2]** `avgContractValue` is a numeric field on `govProfiles` (edited in SynchGov Settings), defaulting to null; the card renders only when set.
3. All figures derive from PR-C2's attribution fields — **[v2.2]** analytics read only `govPursuits`, never the mirrored `pursuitStatus` field. No separate counters to drift.

### Acceptance criteria

- Card set renders only when GOVCAPTURE_PURSUITS_ENABLED is true and the govcapture module is entitled. **[v2.2]** Entitlement is enforced via the existing `getUserPlan()` gate (`functions/middleware/planGate.js` — single source of truth). SynchGov-specific pricing is an open dependency; the §7 cost guardrail computes against Growth-tier list price until dedicated pricing exists.
- Numbers reconcile exactly with board counts (single source of truth: pursuit documents).
- Zero-state renders cleanly for accounts with no pursuits.
- Full suite green (baseline 1,724).

### Flags

- GOVCAPTURE_ANALYTICS_CARDS_ENABLED

## 7. PR-C4 — Provider Adapter + GovCon API Connector + Recompete Radar

**Goal**: Break the single-source ceiling behind a provider abstraction SynchGov owns. Honor the "weeks, not months" commitment with the fastest credible path.

### Scope

1. **Provider adapter contract.** Formalize the source-adapter interface the MVP anticipated: every provider maps to SynchGov's canonical opportunity schema (sourceProvider, sourceId, sourceUrl, normalized NAICS/PSC, deadline, agency, set-aside, attachmentRefs[], provenance + lastSeenAt). SAM.gov becomes the first adapter behind the same interface (refactor, no behavior change). Adapter contract tests are the migration insurance (GovCon API research: avoid architecture that cannot switch providers).
2. **GovCon API connector** (https://govconapi.com/api/v1, bearer key) as the second adapter, initially for:
   - opportunity search/detail (supplements SAM.gov during evaluation)
   - **attachment URLs** (upgrades PR-C5's RFP input from manual upload to automatic retrieval)
   - **recompete watchlist** by merchant NAICS codes
   - contracting-officer contacts — **[v2.2]** stored with `source` + `lastSeenAt`, display-only, no enrichment, no outreach automation; staleness > 90 days renders a "verify before use" badge.
3. **[v2.2] Attachment fetching guard.** Server-side download of provider-supplied attachment URLs follows the manual-upload/C-9 discipline: HTTPS only, reject private/metadata hosts, ≤3 re-validated redirects, per-file size cap 25 MB, MIME whitelist identical to N-7, 15s timeout, storage under `govcapture-uploads/` with provenance (`sourceProvider`, `fetchedAt`).
4. **Recompete Radar.** New sub-view or inbox filter: expiring contracts in profile NAICS codes, with incumbent, value, and end date. These flow through the same scoring pipeline with signalType: recompete (stored in `govOpportunities`, not a new collection — §13). **[v2.2] Deadline semantics**: recompetes carry a contract **end date**, not a solicitation due date — they are **exempt from the past-due hard filter**, and the Timing dimension scores on time-to-expiry bands (e.g., 6–18 months = full; <3 months = low, likely already re-solicited; >24 months = low, too early). Exact bands set with the first live recompete fixtures.
5. **RFPMart slot.** The dormant GOVCAPTURE_RFPMART_ENABLED flag remains the third adapter slot; no implementation in this PR unless GovCon API evaluation fails (decision gate below).
6. **Key handling**: provider keys live in Secret Manager / functions/.env per existing convention — never client-side, never committed. (Context: audit F-701 and the Gemini key saga; treat provider keys with the same discipline.)

### Decision gates (before this PR merges)

- Hands-on trial validation: recompete + attachments endpoints return usable data for Countifi's five NAICS codes (CAGE 9FQ89 / UEI H5M4DURV6586 as the lookup fixture).
- Enterprise/multi-tenant terms conversation initiated with GovCon API — self-serve $19–39/mo plans must not be silently assumed for production multi-tenant use.
- **[v2.2]** Data provenance confirmed (SAM/FPDS resale?) and redistribution/caching of **attachments** licensed for multi-tenant SaaS use.
- Variable provider + AI cost projected below 20–25% of SynchGov subscription revenue at Growth-tier pricing.

### Acceptance criteria

- SAM.gov behavior is byte-identical after the adapter refactor (existing fixture suite green).
- Duplicate opportunities appearing in both sources dedupe on solicitation number; provenance shows both sources.
- Provider outage degrades independently (per-adapter flags; MVP §10 pattern).
- At least one live recompete surfaces and scores for the Countifi profile.
- Full suite green (baseline 1,724).

### Flags

- GOVCAPTURE_PROVIDER_GOVCONAPI_ENABLED
- GOVCAPTURE_RECOMPETE_RADAR_ENABLED
- GOVCAPTURE_RFPMART_ENABLED (existing, remains dormant)

## 8. PR-C5 — Proposal Evaluator (Compliance Check + Evaluator Score)

**Goal**: The David commitment. Score a completed draft proposal against the RFP it answers: first for compliance, then as a simulated evaluator. **[v2.2] Ships first on Track B, in manual-upload mode** (§2) — no C4 dependency.

### Scope

1. **Inputs**: an opportunity with its RFP document via **manual upload (v1 path)** or PR-C4 attachments (later upgrade) + a merchant-uploaded draft proposal (PDF/DOCX/TXT, per MVP N-7 storage rules: 25 MB cap, Admin SDK writes only, allowed MIME types only). Parsing uses the existing `pdf-parse` + `mammoth` dependencies (already in `package.json`) — no new parse dependencies. **Adjacency (audit F-301)**: the upload path uses `multer ^2.1.1` (`govcaptureRoutes.js:512`), which sits at the HIGH advisory ceiling; since this PR expands the upload surface, **bump multer past 2.1.1 in (or immediately before) PR-C5** and re-run upload smoke tests.
2. **Pass A — Compliance check** (deterministic-first): extract the RFP's stated requirements (submission instructions, required forms/sections, page limits, certifications, deadlines) into a requirements checklist; mark each as present/missing/unclear in the draft. Reuses and extends the existing Checklist tab rather than adding a new surface.
3. **Pass B — Evaluator score**: Gemini pass that role-plays the awarding evaluator against the RFP's own evaluation criteria where stated (fallback to a generic rubric where not), returning a 0–100 score with per-criterion reason codes and a ranked "what to fix first" list. This is the differentiator JustWin's checklist lacks: reasons, not just a number. **[v2.2] Fix-first acknowledgment state**: each fix-first item persists an ack state (open / acknowledged / addressed, with timestamp) the merchant toggles in the UI — this is the instrumentation behind the §10 "evaluator trusted" metric; without it that metric is unmeasurable.
4. **Re-rank hook**: after evaluation, the pursuit's card shows proposalReadiness alongside fit score (feeds PR-C2 board and PR-C3 cards).
5. **Proposal library (Tier 1 seed)**: evaluated drafts and prior wins persist in the merchant's document vault (`govProposalDocs`, §13) with extracted keywords — the first increment of the committed Tier 1 document intelligence, and the beginning of the first-party data moat (per SamSearch/GovDash research: outcome + proposal data is the durable asset). **[v2.2] Deletion right**: draft proposals are sensitive merchant documents — the vault supports user-initiated deletion (doc + storage object + extracted keywords), logged to the activity feed. Evaluation *results* on the pursuit survive document deletion.
6. **[v2.2] Model discipline**: per §12 — extraction (Pass A) on SIMPLE via `generateStructured()`; evaluator (Pass B) on PRIMARY (gemini-3-flash-preview) via `generateStructured()`; `usageMetadata` on every call; banned models excluded by the existing allowlist. Evaluation runs only on user request (not on every upload) to control cost.

### Acceptance criteria

- Compliance pass finds a deliberately-omitted required form in a fixture RFP/draft pair.
- Evaluator output includes at least one criterion-linked reason code per scored dimension; no naked scores.
- Prompt-scaffolding does not leak into user-visible output (regression class from PR #43).
- Multi-tenant isolation test: merchant A's proposals never retrievable by merchant B (P0 share-leak regression class, PR #23).
- David's shared prompt (Brian's template lineage) reviewed as input to the evaluator rubric before build — attach to the Gate 1 packet when received.
- Full suite green (baseline 1,724).

### Flags

- GOVCAPTURE_EVALUATOR_ENABLED

## 9. Parallel Non-Build Tracks (for the same Gate 1 review)

1. **GovSpend commercial discovery** — one call scoped to downstream SaaS/display rights, LLM-processing rights, caching, and exit portability. Nothing enters the codebase. Target: a bounded SLED-signals design-partner pilot decision. (Research score 83/100; recommendation: partner, don't rebuild.)
2. **Missing executive comparison** — 00_Executive_Comparison_and_SynchGov_Recommendation.md referenced in the research manifest was not delivered; recover it before treating the cross-vendor conclusion as settled.
3. **Countifi profile polish** — Abby + Aya session: verify seeded credentials, apply southeast-corridor geography update if not applied, complete Rank fields once PR-C1 ships (Countifi becomes the first calibration account).

## 10. Success Metrics (30 days post-ship)

- Triage alive: <50% of active opportunities scoring 0 for a completed profile (hard-disqualified rows counted separately); ≥1 Hot or Warm per weekly sync for Countifi, or the brief explains why not.
- Pursuits used: Countifi promotes ≥3 pursuits and advances ≥1 past drafting in the comparison window.
- Evaluator trusted: ≥60% of evaluator "fix first" items acknowledged or acted on (edit uploaded / item checked) by the customer.
- Head-to-head: every SAM.gov opportunity that appears in JustWin also appears in SynchGov during the 1–2 week parallel run (David's explicit bar), plus recompetes JustWin does not surface.
- Cost: variable provider + Gemini cost within the 20–25% revenue guardrail (visible via `usageMetadata`, §12).

**[v2.2] Pause criteria** (mirror of the parent's kill discipline, 30 days post-ship): if Countifi promotes **zero** pursuits, pause C3/C4 investment and run a usage interview before building further; if the evaluator's fix-first ack rate is <20%, revisit the rubric with David's prompt before iterating on features. Pausing is a decision point, not an auto-kill.

## 11. Gate 1 Questions for Reviewer

1. Approve five-PR structure with **[v2.2] Track B inverted**: Track A = C1 → C2 → C3; Track B = **C5 (manual-upload mode) → C4**?
2. GovCon API as second adapter vs. going straight to RFPMart — accept the evaluation-gated approach in §7 (now including the provenance/licensing gate)?
3. Threshold recalibration methodology in C1 — fixture-based fixed bands with hard-DQ exclusion and the attached 1-page scoring design note (§4.5) acceptable?
4. Any objection to contacts data being stored display-only in C4 (source + lastSeenAt provenance, staleness badge, no outreach automation) pending a separate review?
5. **[v2.2]** Approve the solution-relevance gate parameters (semantic ≤ 3/10 → composite cap 39) as the C1 starting point, tunable via the fixture set?

## 12. AI-Call Standards **[v1.2 — new section]**

All new AI calls in this PRD use **`generateStructured()`** (`functions/services/structuredGeneration.js`) with a response schema — matching the existing `_semanticSolutionMatch()` (`govScoringEngine.js:256`) and `briefGenerator.js:52` call sites, and parent MVP carry-forward rule 18. `indexOf('{')` extraction is not used. **Every call logs `usageMetadata`** (`{ inputTokens, outputTokens, estimatedCost, modelName, promptVersion, generatedAt }`) per parent carry-forward rule 20.

| Call | Tier | Notes |
| :-- | :-- | :-- |
| Keyword expansion (C1) | SIMPLE (`gemini-2.5-flash`) | One call per solution |
| Rank-aware semantic scoring (C1) | existing tier, existing call site | Prompt change only, in `_semanticSolutionMatch()` |
| Evaluator Pass A extraction (C5) | SIMPLE | |
| Evaluator Pass B (C5) | PRIMARY (`gemini-3-flash-preview`) | `generateStructured()` guarantees JSON via responseSchema, so `thinkingBudget: 0` is not required for parse safety; Pass B may leave thinking enabled for evaluation quality at measured cost — decide from the first fixture run, not by habit |

Banned models excluded by the existing allowlist (`gemini-1.5-*`, `gemini-2.0-*`, `gemini-3-pro-preview`).

**Always pass `model` explicitly.** `generateStructured()` defaults to `gemini-3.1-pro-preview` (ADVANCED tier — `structuredGeneration.js:54`) when `model` is omitted. A keyword-expansion or extraction call that forgets the parameter silently runs on the most expensive model. Every call site in this PRD names its tier.

**Doc-precedence note**: `functions/CLAUDE.md`'s March 29 "JSON Output Rules" (always `thinkingBudget: 0` + `indexOf('{')`) predate `generateStructured()` and apply only to legacy raw `generateContent()` calls. For all calls in this PRD, this section and the parent PRD's carry-forward rule 18 govern. (CLAUDE.md's own April 7 section already endorses `generateStructured()`; reconciling the older text is part of the F-801 doc refresh, not this PRD.)

## 13. Data Model, Rules, and Indexes **[v1.2 — new section]**

**New collections** (Cloud-Functions-only, deny-ruled per MVP N-6 convention; rules edits reviewed by Williams — F-101 context):

| Collection | Purpose | Rule |
| :-- | :-- | :-- |
| `govPursuits/{pursuitId}` | PR-C2 pipeline doc: userId, profileId, sourceOpportunityId, sourceProvider, fitScoreAtPromotion, stage, stageHistory[] ({stage, at, byUid}), outcome, awardValue (nullable), lossReason (nullable), proposalReadiness (nullable, PR-C5), createdAt/updatedAt | `allow read, write: if false;` |
| `govProposalDocs/{docId}` | PR-C5 proposal library / Tier-1 vault: userId, pursuitId (nullable), storagePath, extractedKeywords[], evaluations[] (refs), uploadedAt | `allow read, write: if false;` |

Recompete items (PR-C4) are **not** a new collection — they flow through `govOpportunities` with `signalType: 'recompete'`. `expandedKeywords[]` (PR-C1) live on `govProfiles` solution objects. `avgContractValue` (PR-C3) is a `govProfiles` field.

**`workspaceId` stamping**: both new collections stamp `workspaceId` (alongside `userId`) at write time when the request carries workspace context — per the platform design note (CLAUDE.md, June 25: docs without `workspaceId` vanish from workspace-scoped queries and require painful backfills). gov* collections are userId-scoped today; stamping now is cheap, backfilling later is not.

**Composite indexes** (added to `firestore.indexes.json` in the owning PR):
```
govPursuits: userId + stage + updatedAt DESC          (board query)
govPursuits: userId + outcome + updatedAt DESC        (win/loss analytics)
govProposalDocs: userId + uploadedAt DESC             (vault listing)
```

**`pursuitStatus` migration.** `govOpportunities.pursuitStatus` already exists (`schemas.js:67`: 'new' | 'reviewing' | 'pursuing' | 'bid_submitted' | 'won' | 'lost' | 'no_bid') and the MVP board reads it. From PR-C2 onward:
1. `govPursuits` documents are the **single source of truth** for pipeline state.
2. On promotion and on every stage transition, the service **mirrors a coarse status back** to `govOpportunities.pursuitStatus` (planning/drafting/compliance_check/ready_to_submit → `pursuing`; submitted/awaiting_result → `bid_submitted`; outcomes map 1:1) so existing opportunity views don't break.
3. Direct writes to pursuit-managed `pursuitStatus` values via `PUT /opportunities/:oppId/status` are rejected (HTTP 409 with pointer to the pursuit).
4. PR-C3 analytics read only `govPursuits`, never the mirrored field.

**Backward compatibility (PR-C1).** Rank fields are optional on `govProfiles`; scoring with absent Rank fields behaves as today. Profile edit sets `rescoreNeeded: true` (existing mechanism); the live 25-opportunity set rescoring under the gated formula is expected and is the calibration event.

**Per-PR conventions**: each PR lands with the full suite green — **current baseline 1,724**.

**[v2.2] PR packaging + estimates.** C1, C2, C3, and C5 each have `synchintro-app` UI; each "PR-Cx" is therefore a **backend PR + paired frontend PR** (same feature branch name in both repos, coordinated merge, backend first). Estimates below include both halves:

| PR | Backend | Frontend | Est. |
| :-- | :-- | :-- | :-- |
| C1 | gate + rank fields + expansion + rescore sweep + fixtures + design note | rank-field form, FIAT display | ~9h |
| C2 | govPursuits + promotion + mirroring + activity | Pursuits tab (kanban/table) | ~8h |
| C3 | aggregation reads | card set | ~4h |
| C5 | compliance pass + evaluator pass + vault + ack state | evaluator UI, vault list | ~10h |
| C4 | adapter contract + SAM refactor + GovCon connector + recompetes | recompete view | ~10h |

Total ≈ 41h across 5 paired PRs — same order of magnitude as the parent MVP.

## 14. Carry-Forward Rules (additions to the parent set)

1. Solution-relevance gate (§4.4) is part of composite assembly — any future scoring change must preserve or consciously supersede it (with fixture evidence), never bypass it.
2. `_fitLabel()` has exactly one implementation after PR-C1. Threshold changes happen there and nowhere else.
3. Expanded keywords are scoring-only. Query-grade keyword sets remain the top-10 per solution.
4. `govPursuits` is the single source of pipeline truth; `pursuitStatus` on opportunities is a mirrored convenience.
5. All new AI calls: `generateStructured()` + `usageMetadata`. No `indexOf('{')` in new code.
6. Provider attachment downloads follow the C-9/N-7 guard (host validation, size, MIME, timeout, provenance).
7. Evaluator outputs are decision support: criterion-linked reasons, `humanReviewRequired` semantics inherited from the parent brief rules; never auto-submission.

*End of PRD v2.2.*
