# Gate 2 Review — PR-C1 (backend) — SynchGov Capture Rank + Scoring Gate

**Spec**: `PRD-synchgov-capture-01-v2.2.md` §4, §12, §13. **Branch**: `feat/govcapture-c1-rank-scoring`. **Merge**: Williams (scoring engine, manual-approval flagged). Built + tested — **PR NOT opened, nothing merged.** Gate 1 + scoring design note: `strategy-review-govcapture-c1.md`.

> This is the **backend half** of PR-C1. The paired **frontend** PR (rank-field form, keyword-prune UI, FIAT display, `pass`→"No-Bid Recommended" string) is the next unit per v2.2 §13 (coordinated merge, backend first).

---

## What changed

| File | Change |
|---|---|
| `services/govcapture/govScoreConstants.js` | **New.** Single source of truth: `fitLabel` (was duplicated), gate params as **code constants** (§4.4-7), `gateCap()` pure fn, `inboxTab()`, `rankFieldsEnabled()`. |
| `services/govcapture/govScoringEngine.js` | Captures semantic relevance + `semanticAvailable`; applies the gate in Pass 1; **re-applies the cap in Pass 2** (closes the `_raw.earned` bypass); adds `scoringVersion`, FIAT `fiat{}`, `_gateInputs`; injects Rank fields into the semantic prompt (flag-gated); imports the shared `fitLabel`. |
| `services/govcapture/scoringPipeline.js` | Removed its duplicate `_fitLabel`; imports the shared one; `scoringVersion` flows through `finalFit`. |
| `services/govcapture/schemas.js` | Rank fields on `PROFILE_CLIENT_FIELDS` + length-capped validation; `expandedKeywords` cap per solution. |
| `services/govcapture/keywordExpansion.js` | **New.** `expandSolutionKeywords()` — SIMPLE tier via `generateStructured()`, **explicit model** (§12), `usageMetadata`, scoring-only. |
| `routes/govcaptureRoutes.js` | **New** `POST /govcapture/profiles/expand-keywords` (flag-gated, registered before `:profileId`). |
| `scripts/rescoreGovOpportunities.js` | **New.** One-time, idempotent, `scoringVersion`-guarded rescore sweep (§4.4-6); fail-fast preflight; `--dry-run`. |
| `.env.example` | `GOVCAPTURE_RANK_FIELDS_ENABLED`, `GOVCAPTURE_FIAT_DISPLAY_ENABLED` documented. |

## The gate, verified against code (the manual-approval artifact)

- **Root cause closed**: Pass 1's 60 non-solution points let a zero-relevance opp normalize to ~67. The gate caps composite at **39** when semantic relevance ≤ 3.
- **Bypass closed**: `rescoreWithAwardContext` rebuilds from `pass1._raw.earned` (pre-cap) + award — the gate is **re-applied** on the Pass 2 composite (test proves a +10 award does not lift a gated score past 39).
- **Semantic-outage hole closed** (the conflict-check finding): no semantic read → cap **44** + `SEMANTIC_UNAVAILABLE` → stays in Review; a rescore clears it.
- **Bands**: Hot ≥70 · Warm ≥45 · Review <45 → both caps are sub-Warm by construction.
- **Flag-gated**: entire behavior behind `GOVCAPTURE_RANK_FIELDS_ENABLED` (default off). **Production scoring is byte-identical to the MVP until opt-in** — verified by the existing `govScoringEngine.test.js` (runs flag-off) staying green.

## Tests

- **New `tests/govScoringC1.test.js`: 19/19 pass** — gate cap + reason code, **rule-float closed** (Warm+ ungated → Review gated), strong-fixture non-interference (Hot), **semantic-unavailable cap**, disagreement flag, **Pass 2 bypass closed**, rank injection (+ explicit SIMPLE model), FIAT present, flag-off MVP-identity (scoringVersion 1, not capped, no rank block), `gateCap`/`fitLabel`/`inboxTab` units, rank-field + expandedKeywords validation. Fixtures are deterministic (dimension math in the design note).
- **Full suite: 1,743 passing, 0 failing** (1,724 + 19), 64 suites.
- **Emulator suite green** (`npm run test:emulator`) — no `firestore.rules` change; confirms no rules regression.
- `node --check` clean on all files. Diff scoped to 5 modified + 4 new (+ this review + the strategy doc).

## Safety
- **No `firestore.rules` change, no new collection, no new dependency, nothing deployed.** Additive profile fields + flag-gated scoring.
- **Rollback = `GOVCAPTURE_RANK_FIELDS_ENABLED=false`** (instant, no redeploy) or revert the PR.
- No self-merge.

## Operational note for Williams
After merge + deploy, enabling the flag requires **one run of `scripts/rescoreGovOpportunities.js`** (env-guarded) so the live 25 opportunities move to `scoringVersion 2`; otherwise the inbox mixes formulas until the next sync rescores them. `--dry-run` previews.

---

**STOP — awaiting go-ahead to open the backend PR → Williams.** Then the paired **frontend PR-C1** (rank form, keyword prune, FIAT display, "No-Bid Recommended") is the next build unit.
