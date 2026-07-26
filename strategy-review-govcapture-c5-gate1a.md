# Gate 1a Addendum — PR-C5 Evaluator: Rubric-as-Data Architecture

**Amends:** `strategy-review-govcapture-c5.md` (decision #4 — "Pass B rubric slots in last when David's prompt arrives").
**What changed:** the original plan treated David's prompt as a hardcoded `davids-v1` swap. That is a **code deploy per customer** and does not scale — every customer needs a somewhat unique rubric. This addendum replaces the swap with a multi-tenant structure, grounded in a field inventory of what customers have already told us.

---

## 1. Core principle — rubric = data, never prompt code

The evaluator prompt decomposes into three layers with different owners and lifecycles:

| Layer | Content | Lives in | Versioning |
|---|---|---|---|
| **Scaffold** | Evaluator role, output contract (`score`/`reasonCode`/`evidence`/`fixFirst`), "judge only the draft" discipline, anti-injection guardrails | **Code** | `promptVersion` (`generic-v1`, `v2`, …) — engineering change, tested |
| **RFP criteria** | The solicitation's own stated evaluation criteria | **Runtime**, per-opportunity | n/a (already spec'd, §8.3) |
| **Merchant rubric** | What this customer's market rewards: win themes, deal-breakers, certification emphasis, weights | **Data**, per-profile | `rubricVersion`/hash stamped on every evaluation |

**Hard rule:** customers never author raw prompt text. Customer input reaches the model only as validated, length-capped **structured data** injected into a delimited block of the fixed scaffold — the exact pattern PR-C1's rank fields already run in production (`_semanticSolutionMatch`). The output schema is enforced by `generateStructured` regardless of rubric content.

## 2. Field inventory finding — most of the rubric already exists

Audit of the SynchGov profile editor, SynchGov Settings, and general SynchIntro settings:

| Existing field | Surface | Rubric use |
|---|---|---|
| `credentials.pastPerformance[]` (≤10: client + details) | Gov profile | Past-performance criterion checks the draft against *known* past performance ("3 relevant contracts, none cited") |
| `credentials.certifications` + `setAsideEligibility` | Gov profile | Flag drafts that fail to claim certifications the merchant holds — deterministic, high-value |
| `valueProposition.uniqueSellingPoints[]` / `keyBenefits[]` / `differentiator` | **General SynchIntro settings** | The win themes — does the draft communicate the merchant's differentiators? |
| `rankIdealCustomer` / `rankIdealSolutions` / `rankAvoid` (C1) | Gov profile | Merchant-authored strategic emphasis, already validated free text |
| `solutions[]` + `description` | Gov profile | Solution-fit framing context |
| Custom checklist questions | Gov Settings | Per-profile compliance emphases → Pass A extensions |
| `lossReason` (C2) + fix-first ack states (C5) | Accruing automatically | The learning-loop signal — already collecting itself |
| `avgContractValue` (C3) | Gov Settings | Optional proportionality context |

**Genuinely missing (the only true delta):** criterion weight preferences, pre-SynchGov loss patterns, tone/structure standards.

**Note:** `valueProposition` is merchant-level (shared sellerProfile); the rest is per-gov-profile. The assembler pulls both layers — correct, since differentiators are company truths and targeting emphasis is per-capture-profile.

## 3. The three phases

**Phase 1 — Rubric assembler (goes into PR-C5 before it opens).** A pure function assembles the `MERCHANT RUBRIC` block from *existing* data (certifications, set-asides, past performance, USPs/differentiator, rank fields) + at most one new optional field (`rubricNotes`, length-capped, or a small `criterionWeights` object). Injected into `evaluateDraft()` as a delimited section; `generic-v1` scaffold remains the no-rubric fallback forever. Every evaluation stamps `rubricVersion` (content hash) beside `promptVersion`. Tests: assembler output from fixture profiles; **injection-containment** (hostile rubric text cannot alter the output contract or leak scaffold); no-rubric fallback identical to today. Customers with completed onboarding get a working custom rubric **with zero new forms**.

**Phase 2 — Confirm-and-fill wizard (fast-follow, not in PR-C5).** A one-time setup flow pre-populated from existing data, asking only the three missing things (weights, loss history, tone standards) plus review/edit. If AI-assisted, the generator outputs **data conforming to the rubric schema — never prompt text** — which the merchant reviews before saving.

**Phase 3 — Outcome-informed rubric (the moat).** `lossReason` + fix-first ack behavior per `rubricVersion` enables suggested rubric adjustments and makes the §10 ack-rate metric comparable across rubric versions — exactly what the <20%-ack pause criterion needs.

## 4. David decomposition protocol (when the prompt arrives — email sent 2026-07-16)

1. Read his prompt against the scaffold: whatever generalizes → **scaffold v2** candidates (engineering change, tested, benefits every customer).
2. Whatever is specific to how Countifi wins → mapped onto **rubric data fields** for his profile (most will land in fields he already has; gaps identify Phase-2 wizard questions).
3. His four email answers (evaluator punishments, loss reasons, must-say items, open wishlist) feed the same mapping; #4 answers also route to the product backlog.
4. Countifi becomes the **first rubric calibration account** (mirroring its role for scoring thresholds in C1).

## 5. Impact on the built C5 backend (small delta, prompt-independent)

- `govRubricAssembler` (new, pure) + injection block in `evaluateDraft()`.
- `rubricVersion` hash on `govEvaluations` docs.
- Optional `rubricNotes`/`criterionWeights` on `PROFILE_CLIENT_FIELDS` + validation.
- Tests as in Phase 1. No endpoint, rules, or index changes.

This can be built now — it does not depend on David's prompt. With it, PR-C5 ships **multi-tenant-ready** rather than David-shaped, and his prompt becomes calibration input instead of a blocker.

## 6. Decisions requested

1. Approve rubric-as-data (3-layer) architecture + the no-raw-prompt-text rule.
2. Approve the **assembler-over-existing-fields** approach for Phase 1 (≤1 new field), built into the C5 branch before the PR opens.
3. Confirm Phase 2 wizard is a scoped fast-follow (not in PR-C5).
4. Confirm the David decomposition protocol replaces the old "swap in davids-v1" plan.

**STOP — on approval (and back on Opus), I build the Phase-1 assembler into `feat/govcapture-c5-evaluator`, re-run the suites, and update the Gate 2 doc. The PR-opening trigger then becomes your hold-vs-ship call — David's prompt is calibration, no longer a blocker.**
