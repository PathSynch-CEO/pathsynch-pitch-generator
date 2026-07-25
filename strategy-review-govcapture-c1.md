# Gate 1 Strategy Review + Scoring Design Note — PR-C1 (SynchGov Capture)

**Spec**: `PRD-synchgov-capture-01-v2.2.md` §4, §12, §13. **Merge**: Williams (product code; scoring engine is manual-approval flagged). **This is the §4.5 / §11-Q3 design note.** Gate 1 STOP — no scoring code written until approval.

---

## Session-start verifications (all pass, code-grounded)

| Check | Result |
|---|---|
| **Auth ownership** | `req.userId` is canonical; gov docs scope by `userId` (`govcaptureRoutes.js:8,59,84`). No blocker — proceed with `userId` as owner on all new gov* docs. |
| `generateStructured()` | `structuredGeneration.js:50` — `{systemInstruction, userPrompt, responseSchema, model='gemini-3.1-pro-preview', temperature, maxOutputTokens, returnMetadata}`. Supports SIMPLE tier; returns `usageMetadata` when `returnMetadata:true`. **Always pass `model` explicitly** (§12). |
| Semantic match | `_semanticSolutionMatch()` (govScoringEngine.js:255-294) already uses `generateStructured` + `gemini-2.5-flash` + captures `usageMetadata`. Rank fields inject into its `systemPrompt`. |
| Profile schema | `PROFILE_CLIENT_FIELDS` Set + `validateProfileInput` (schemas.js:36,101) are the extension points for rank fields. |
| `_fitLabel` duplication | Confirmed — identical bands in `scoringPipeline.js:94` and `govScoringEngine.js`. Consolidate in C1. |
| firestore.rules | 7 gov* deny blocks present; **no rules change in C1** (rank fields live on existing `govProfiles`; no new collection). |
| Test baseline | 1,724; emulator CI gate live (F-601). |

---

## Scope — PR-C1 (backend + paired frontend)

1. **Rank layer** on `govProfiles`: `rankIdealSolutions`, `rankIdealCustomer`, `rankIdealGeography`, `rankAvoid` (free-text) → add to `PROFILE_CLIENT_FIELDS` + validation (length-capped strings). Frontend: four textareas w/ placeholder examples.
2. **Rank consumption** in `_semanticSolutionMatch()` — inject the four fields into the system prompt; `rankAvoid` as an explicit "AVOID" section (semantic negative signal, distinct from hard negativeKeywords).
3. **Keyword auto-expansion** — one `generateStructured` call/solution (SIMPLE, `usageMetadata`), returns 40–60 candidates → `expandedKeywords[]` per solution with `userApproved` flags. **Scoring-only, never query-grade** (§4.3). Frontend: prune-before-save chips.
4. **Composite gate + FIAT decomposition** — see design note below. `fit.scoringVersion = 2` + one-time deploy rescore sweep.
5. **`_fitLabel` consolidation** — single exported function.
6. **Threshold recalibration** — Hot/Warm/Review bands (below).
7. **UI string**: `Bid Recommendation: pass` → "No-Bid Recommended".
8. **Flags**: `GOVCAPTURE_RANK_FIELDS_ENABLED` (gates rank consumption + gate + recalibrated bands — production scoring unchanged until on), `GOVCAPTURE_FIAT_DISPLAY_ENABLED` (display can ship dark).

---

## 📐 SCORING DESIGN NOTE (for Williams — the manual-approval artifact)

### Current formula (verified in code)
- **Pass 1 (90 pts)**: solution 30 + NAICS 15 + buyer 15 + geo 10 + deadline 10 + certs 10. `normalized = round(earned/90 × 100)`.
- **Solution 30 pts**: semantic relevance R∈[0,10] → `round(R/10 × 30)`; on Gemini failure OR gate-skip → deterministic `round(prefilter/9 × 30)`.
- **Pass 2 (100 pts)**: re-runs Pass 1 (semantic on) + award 10. Pipeline takes `Math.max(pass1, pass2)` (`scoringPipeline.js:77`).
- **Bands**: Strong ≥85 · Possible ≥65 · Stretch ≥45 · Poor ≥20 · Disqualified <20.
- **The bug**: the 60 non-solution points let a zero-relevance opportunity normalize to ≈67. "Mail Management" (rule 42, semantic-rejected) is this.

### Proposed formula (gated) — changes marked ⟶
1. Capture semantic relevance `R` **and** `semanticAvailable` (boolean: did a real semantic read occur?) out of the solution-match block.
2. Compute `normalized` exactly as today.
3. ⟶ **Solution-relevance gate**: if `semanticAvailable && R ≤ 3` → `composite = min(normalized, 39)` + reason `GATE_LOW_SOLUTION_RELEVANCE`.
4. ⟶ **Unavailable cap** (§4.4-3a): if `!semanticAvailable` (Gemini failed or gate skipped the call) → `composite = min(normalized, 44)` + reason `SEMANTIC_UNAVAILABLE`. Keeps it in Review; a later rescore with semantic clears it.
5. ⟶ **Disagreement flag**: let `cSem` = composite using semantic solution score, `cDet` = composite using deterministic solution score; if `|cSem − cDet| ≥ 20` → risk `RISK_RULE_SEMANTIC_DISAGREEMENT`; brief must state it.
6. ⟶ **Clamp scoped**: `Math.max(pass1,pass2)` retained only for the award-context denominator shift (its documented purpose); both passes compute under the gate so it can't resurrect a gated score.
7. ⟶ `fit.scoringVersion = 2`; FIAT dimensions surfaced: **Fit** (solution) · **Intent** (buyer/set-aside) · **Access** (certs/geo/eligibility) · **Timing** (deadline).

### Recalibrated inbox bands (tie tabs to score, so the gate is automatically sub-Warm)
| Tab | Score band |
|---|---|
| **Hot** | ≥ 70 |
| **Warm** | 45 ≤ score < 70 |
| **Review** | < 45 |

Gate cap 39 → Review ✓. Unavailable cap 44 → Review ✓. (Frontend Hot/Warm/Review mapping confirmed against `synchintro-app` during build; if it currently keys off `fitLabel`, it's repointed to score bands.)

### Gate parameters = **code constants** (not env vars) — §4.4-7
`LOW_RELEVANCE_MAX = 3`, `GATE_CAP = 39`, `UNAVAILABLE_CAP = 44`, `WARM = 45`, `HOT = 70`, `DISAGREEMENT_DELTA = 20`. Changed only with fixture evidence in a reviewed PR.

### Fixture outcomes (acceptance — asserts the *mechanism*)
| Fixture | Semantic | Expect |
|---|---|---|
| Mail Management (rankAvoid=physical svcs) | ≤3 | ≤39, `GATE_LOW_SOLUTION_RELEVANCE`, Review |
| Rule-float (NAICS-exact + buyer + deadline, sem=2) | 2 | ≤39, gated (proves 60-pt float closed) |
| Strong (sem=8, NAICS-exact, good dims) | 8 | ≥70, Hot, no gate |
| Semantic-unavailable (force Gemini throw) | — | ≤44, `SEMANTIC_UNAVAILABLE`, Review |
| JustWin welcome-kit (MVP regression) | — | still Poor/Disqualified |
| Past-due (hard filter) | — | Disqualified, excluded from band stats |

---

## Blast radius
- **Scoring engine edit** (manual-approval) — the whole reason for this note. Gated behind `GOVCAPTURE_RANK_FIELDS_ENABLED` (default off): **production scoring is byte-identical until the flag flips AND a profile has rank fields.**
- **Rescore sweep** touches the live 25 opportunities (Charles/Countifi) when the flag enables — idempotent, respects the Gemini prefilter gate, `scoringVersion`-guarded.
- **No firestore.rules change**, no new collection, no new dependency. Additive profile fields only.
- Frontend: new profile fields + FIAT display; existing SynchGov pages unaffected.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Gate over-suppresses good opps | `LOW_RELEVANCE_MAX=3` is conservative; strong-fixture asserts non-interference; flag-gated + reversible. |
| Rescore sweep cost (25 opps × semantic) | One-time, gated, batched; `usageMetadata` logged; ≤100-call MVP prefilter gate still applies. |
| Semantic outage silently mis-scores | That's exactly what `SEMANTIC_UNAVAILABLE` cap fixes — verified by fixture. |
| `_fitLabel` divergence during consolidation | Single exported fn + a test asserting both old call sites resolve identically pre/post. |
| Keyword expansion runs on ADVANCED model | Explicit `model:'gemini-2.5-flash'` per §12; asserted in test. |

## Rollback
Set `GOVCAPTURE_RANK_FIELDS_ENABLED=false` → scoring reverts to current behavior instantly (no redeploy). Full revert = revert the PR; rank fields are inert additive data.

## Build plan (after approval)
1. `git checkout main && git pull` (repo is on `docs/f704-canonical-deploy`); branch `feat/govcapture-c1-rank-scoring` in **both** repos.
2. Backend: schema (rank fields + validation), `_semanticSolutionMatch` rank injection, keyword-expansion service, gate + `scoringVersion` in `govScoringEngine`/`scoringPipeline`, `_fitLabel` consolidation, rescore sweep, `.env.example` flags.
3. Fixtures (6 above) + unit tests; full suite stays ≥1,724 green; run emulator suite.
4. Frontend: rank-field form, keyword prune UI, FIAT display (behind flag).
5. Gate 2 review (`prd-review-govcapture-c1.md`), then STOP → two PRs (backend + frontend) → Williams.

## Verification
- New fixtures green; full jest suite ≥1,724; `npm run test:emulator` green (no rules change, but confirms no regression).
- `node --check` on changed files; `git diff` scoped.
- Manual dry-run of the gated scorer against the 6 fixtures showing score + reason codes.

---

**STOP — approval needed on the design note before I write scoring code.** Specifically your sign-off (or adjustment) on: the **gate params** (R≤3 → cap 39; unavailable → cap 44), the **Hot/Warm/Review bands** (70/45), and gating the whole behavior behind `GOVCAPTURE_RANK_FIELDS_ENABLED`. On approval I cut the branch and build.
