# Revision Packet — prd-synchgov-capture-01 v1.1 → v1.2

**Purpose**: Concrete replacement/appended spec text resolving the critical review findings (C-1…C-5) plus the significant items, each grounded in the live code. Paste-ready for the Google Doc.
**Evidence base**: `functions/services/govcapture/scoringPipeline.js`, `govScoringEngine.js`, `briefGenerator.js`, `schemas.js` — read line-level 2026-07-15. Test baseline: **1,724 passing**.

---

## R1 — Composite formula: replace the clamp exception with a solution-relevance gate *(resolves C-1; supersedes §4.4's "Math.max preserved" language)*

### What the code actually does (evidence)

- `scoringPipeline.js:77` — `score: Math.max(pass1.score, pass2.score)`. The comment (lines 72–74) shows its **original intent is narrow**: prevent the 90→100 denominator shift from *lowering* a score when award context earns 0. It was never designed as rule-vs-semantic arbitration.
- `govScoringEngine.js:91–112` — the semantic Gemini call lives inside **Pass 1's solution-match dimension** (30 pts). The other five dimensions are worth **60 of 90 pts** (NAICS 15, buyer 15, geo 10, deadline 10, certs 10).
- **Structural consequence**: an opportunity with **zero semantic solution relevance can normalize to ≈67** (60/90) on classification breadth alone. "Mail Management Services" at 42 is this mechanism, not a threshold-tuning problem. Rank fields feeding the semantic prompt cannot, by themselves, satisfy the bottom-quartile acceptance test — the rule dimensions will keep floating it.

### Replacement spec text for §4.4 (drop the "Math.max clamping is preserved" sentence; insert)

> **Composite integrity — solution-relevance gate.** The two-pass architecture (Pass 1: 90 pts, Pass 2: 100 pts with USAspending) is preserved, with one change to composite assembly in `scoringPipeline.js` / `govScoringEngine.js`:
>
> 1. **Gate**: when the semantic solution-match relevance is ≤ 3/10 (`_semanticSolutionMatch().relevanceScore <= 3`), the composite score is **capped at 39** (top of the Poor Fit band, below the Stretch threshold of 45), regardless of what the rule dimensions earn. Reason code `GATE_LOW_SOLUTION_RELEVANCE` is appended. The gate applies identically in Pass 1 and Pass 2 (Pass 2 re-runs Pass 1 with semantic enabled — `govScoringEngine.js:209` — so the gate composes automatically).
> 2. **Clamp scoped to its original purpose**: `Math.max(pass1.score, pass2.score)` is retained solely to neutralize the 90→100 denominator shift when award context earns 0 (its documented intent, `scoringPipeline.js:72–74`). Because both passes are computed under the gate, the clamp can never resurrect a gated score.
> 3. **Disagreement surfacing**: when the rule-only composite (semantic dimension excluded, rescaled) and the semantic-scaled solution score imply labels ≥ 20 normalized points apart, append `RISK_RULE_SEMANTIC_DISAGREEMENT` and require the brief to state the disagreement explicitly instead of presenting a single confident number.
> 4. **Rank fields** (`rankIdealSolutions/Customer/Geography/Avoid`) are consumed **only** in the `_semanticSolutionMatch()` prompt (see R5). `rankAvoid` is a semantic negative signal; a strong `rankAvoid` match should drive relevance ≤ 3 and therefore trip the gate. No changes to the deterministic prefilter are required for the fixtures to pass.
> 5. **Fit-label single source of truth**: `_fitLabel()` is currently duplicated in `scoringPipeline.js` and `govScoringEngine.js` with identical thresholds. PR-C1 must consolidate to one exported function before recalibrating Hot/Warm bands — otherwise the two copies diverge silently.
> 6. **Zero-score disambiguation**: the current inbox conflates `hardDisqualified` (hard-filter kill) with "earned 0" (no signal). The FIAT display must distinguish them (`Disqualified — past due` vs. a genuine low score); recalibration statistics exclude hard-disqualified rows.

### Acceptance criteria adjustments (§4)

- "Mail Management Services" fixture: with `rankAvoid` covering physical services/logistics, `_semanticSolutionMatch` returns ≤ 3 → gate caps composite ≤ 39 → bottom quartile. **Assert the gate reason code**, not just the rank position.
- Add fixture: an opportunity with `MATCH_NAICS_EXACT` + priority buyer + comfortable deadline but semantic relevance 2 → composite ≤ 39 (proves the 60-rule-point float is closed).
- Add regression: a genuinely strong opportunity (semantic ≥ 7) is **not** affected by the gate; JustWin welcome-kit fixture continues to pass.

---

## R2 — AI-call standards block *(resolves C-2; applies to §4 keyword expansion, §8 evaluator, and all new AI calls)*

### Evidence

The live code already exceeds the v1.1 spec: `govScoringEngine.js:256–279` (`_semanticSolutionMatch`) and `briefGenerator.js:52–68` both use `generateStructured()` **and capture `usageMetadata`**. v1.1's `indexOf('{')` language would regress a builder below current practice, and contradicts the parent MVP PRD carry-forward rules 18 and 20.

### Replacement spec text (insert as a new "AI-call standards" subsection; delete both `indexOf('{')` mentions)

> **All new AI calls in this PRD use `generateStructured()`** (`functions/services/structuredGeneration.js`) with a response schema, matching the existing `_semanticSolutionMatch()` and `briefGenerator` call sites. `indexOf('{')` extraction is not used. **Every call logs `usageMetadata`** (`{ inputTokens, outputTokens, estimatedCost, modelName, promptVersion, generatedAt }`) per MVP carry-forward rule 20.
>
> Model tiers:
> - Keyword expansion (PR-C1): SIMPLE (`gemini-2.5-flash`).
> - Rank-aware semantic scoring (PR-C1): unchanged call site, existing tier.
> - Evaluator Pass A extraction (PR-C5): SIMPLE.
> - Evaluator Pass B (PR-C5): PRIMARY (`gemini-3-flash-preview`). Because `generateStructured()` guarantees JSON via `responseSchema`, `thinkingBudget: 0` is **not** required for parse safety; Pass B may leave thinking enabled for evaluation quality, at measured cost (visible via `usageMetadata`). Decide from the first fixture run, not by habit.
>
> Cost note: Pass 2 re-runs Pass 1 with semantic enabled (`govScoringEngine.js:209`), so each enriched opportunity already makes two semantic calls per scoring cycle. The Rank-field prompt lands in `_semanticSolutionMatch()` once and inherits both call sites — do not add a third.

---

## R3 — Sequencing: C5-first in manual-upload mode *(resolves C-3; replaces §11 Q1's proposed sequence)*

### Evidence

§8.1 already lists "manual upload" as a valid RFP input, and the manual-upload pipeline (PDF/DOCX/text extraction, N-7 storage rules) is **live in production** (MVP PR #5, `manualUploadService.js`). C5's only hard dependency on C4 is *automatic* attachment retrieval — a convenience, not a prerequisite. Meanwhile C4 gates on a vendor trial + enterprise-terms conversation, which cannot be guaranteed inside "next week."

### Replacement sequencing text

> **Tracks**: Track A: C1 → C2 → C3. Track B: **C5 (manual-upload mode) → C4**.
>
> C5 ships first in manual-upload mode: the merchant uploads both the RFP document and the draft proposal. This satisfies the David commitment with zero dependency on C4. When C4 lands, its attachment pipeline upgrades C5's RFP input from "user uploads" to "fetched automatically" — an enhancement PR, not a rework.
>
> Customer message accordingly changes from a dependency apology to a capability statement: *"Evaluator ships against uploaded RFPs now; automatic RFP retrieval follows with the multi-source connector."*

---

## R4 — Data layer section *(resolves C-4; insert as a new numbered section, mirroring MVP PRD §3/§N-6)*

> ### Data model, rules, and indexes
>
> **New collections** (all Cloud-Functions-only, deny-ruled per MVP N-6 convention; rules edits reviewed by Williams — F-101 context):
>
> | Collection | Purpose | Deny block |
> | :-- | :-- | :-- |
> | `govPursuits/{pursuitId}` | PR-C2 pipeline doc: userId, profileId, sourceOpportunityId, sourceProvider, fitScoreAtPromotion, stage, stageHistory[] (`{stage, at, byUid}`), outcome, awardValue, lossReason, proposalReadiness (nullable, PR-C5), createdAt/updatedAt | `allow read, write: if false;` |
> | `govProposalDocs/{docId}` | PR-C5 proposal library / Tier-1 vault: userId, pursuitId (nullable), storagePath, extractedKeywords[], evaluations[] (refs), uploadedAt | `allow read, write: if false;` |
>
> Recompete items (PR-C4) are **not** a new collection — they flow through `govOpportunities` with `signalType: 'recompete'` (per §7.3). `expandedKeywords[]` (PR-C1) live on `govProfiles` solution objects.
>
> **Composite indexes** (added to `firestore.indexes.json` in the owning PR):
> ```
> govPursuits: userId + stage + updatedAt DESC          (board query)
> govPursuits: userId + outcome + updatedAt DESC        (win/loss analytics)
> govProposalDocs: userId + uploadedAt DESC             (vault listing)
> ```
>
> **`pursuitStatus` migration (breaking-ambiguity fix).** `govOpportunities.pursuitStatus` already exists (`schemas.js:67`: `'new' | 'reviewing' | 'pursuing' | 'bid_submitted' | 'won' | 'lost' | 'no_bid'`) and the MVP board reads it. From PR-C2 onward:
> 1. `govPursuits` documents are the **single source of truth** for pipeline state.
> 2. On promotion and on every stage transition, the service **mirrors a coarse status back** to `govOpportunities.pursuitStatus` (planning/drafting/compliance_check/ready_to_submit → `pursuing`; submitted/awaiting_result → `bid_submitted`; outcomes map 1:1) so the existing opportunity views don't break.
> 3. Direct writes to `pursuitStatus` via `PUT /opportunities/:oppId/status` are rejected for values managed by a linked pursuit (HTTP 409 with pointer to the pursuit).
> 4. PR-C3 analytics read **only** `govPursuits` — never the mirrored field.
>
> **Backward compatibility (PR-C1).** Rank fields are optional on `govProfiles`. Scoring with absent Rank fields behaves exactly as today (no gate change in behavior until semantic relevance is computable against Rank context — the gate itself applies regardless, since it keys off semantic relevance, which exists today). Profile edit sets `rescoreNeeded: true` (existing mechanism); the live 25-opportunity set rescoring under the new formula is expected and is the calibration event.
>
> **Per-PR conventions** (restored from parent PRD): each PR states an hour estimate at Gate 1 and lands with the **full suite green — current baseline 1,724** (not 1,710).

---

## R5 — Terminology corrections *(resolves C-5; edits §4.2)*

> Replace: *"Semantic pass consumes Rank fields. Pass 2 prompt includes the four Rank fields as ranking context."*
> With: *"Rank fields are consumed by `_semanticSolutionMatch()` (`govScoringEngine.js:255`) — the Gemini semantic call inside **Pass 1's solution-match dimension** (30 pts). Because Pass 2 (`rescoreWithAwardContext()`) re-runs Pass 1 with semantic enabled, the Rank context automatically applies to both passes. 'Pass 2' refers exclusively to the USAspending award-context rescore; it is not a separate prompt surface. The four Rank fields are also injected into the brief prompt (`briefGenerator.js`) as merchant context."*

---

## R6 — Significant-item amendments (one paragraph each)

1. **`expandedKeywords` are scoring-only.** Append to §4.3: *"Expanded keywords are consumed by the deterministic prefilter and semantic prompt only. They are **never query-grade** — SAM.gov query construction continues to use the profile's top-10 query-grade keywords (MVP caps: ≤10 queries, ≤500 records, unchanged). Cap stored expansions at 60 per solution; with ≤10 solutions this bounds profile-doc growth at ~600 short strings."* (Extends parent carry-forward rule 13's scoping discipline to positive keywords.)
2. **Attachment fetching guard (PR-C4).** Append to §7.2: *"Server-side download of provider-supplied attachment URLs follows the manual-upload/C-9 discipline: HTTPS only, reject private/metadata hosts, ≤3 re-validated redirects, per-file size cap 25 MB, MIME whitelist identical to N-7, 15s timeout, storage under `govcapture-uploads/` with provenance (`sourceProvider`, `fetchedAt`). Add to the §7 decision gates: confirm GovCon API's data provenance (SAM/FPDS resale?) and that redistribution/caching of attachments is licensed for multi-tenant SaaS use."*
3. **Threshold methodology (answers §11 Q3).** Append to §4.5: *"Bands are recalibrated as fixed score thresholds validated against the 25-opportunity live set + Countifi fixtures, with the explicit caveat that n=25 is a starting sample; a revisit is scheduled after PR-C4 changes the volume distribution. Hard-disqualified rows are excluded from distribution statistics. Because scoring-engine edits are flagged for manual approval, PR-C1 attaches a 1-page design note (current formula → gated formula → fixture outcomes) for Williams."*
4. **Average contract value (PR-C3).** Append to §6.2: *"`avgContractValue` is a numeric field on `govProfiles` (edited in SynchGov Settings), defaulting to null; the pipeline-value card renders only when set, with the assumption labeled."*
5. **Entitlement dependency.** Append to §6/§10: *"SynchGov module entitlement is enforced via the existing `getUserPlan()` gate (`functions/middleware/planGate.js` — single source of truth). SynchGov-specific pricing is an open dependency; the 20–25% cost guardrail is computed against Growth-tier list price until dedicated pricing exists."*
6. **UI string.** PR-C1 in-scope: rename the brief's `Bid Recommendation: pass` display value to **"No-Bid Recommended"** (and `pursue` → "Bid Recommended") — "pass" is ambiguous in a scoring UI.
7. **Contacts provenance (PR-C4).** Append to §7.2: *"Contracting-officer contacts store `source` + `lastSeenAt`, display-only, no enrichment, no outreach automation; staleness > 90 days renders a 'verify before use' badge."*

---

## Reviewer-question answers reflected (§11)

1. Five-PR structure: **approved with Track B inverted** (C5 manual-upload-first → C4). — R3
2. GovCon API evaluation-gated: **approved**, with the provenance/licensing gate added. — R6.2
3. Fixture-based bands: **approved with** the gate formula (R1), hard-DQ exclusion, and the 1-page design note for Williams. — R6.3
4. Contacts display-only: **no objection**, with provenance/staleness line. — R6.7

*End of revision packet. Apply R1–R6 to produce v1.2; the review's approval condition is R1–R5 incorporated verbatim or with equivalent precision.*
