# Gate 2 Review — PR-C1 (frontend, synchintro-app)

**Paired with backend PR #52 (merged).** Spec: `PRD-synchgov-capture-01-v2.2.md` §4, §13. Branch `feat/govcapture-c1-rank-scoring` (in `synchintro-app`). Built + tested — **PR NOT opened, nothing merged.** Gate 1: `strategy-review-govcapture-c1-frontend.md`.

---

## What changed (2 files)

### `js/pages/synchgovOpportunities.js`
- **Version-aware inbox bands** (the triage fix): `_bandsFor(opp)` — gated opps (`fit.scoringVersion >= 2`) bucket at **Hot ≥70 / Warm ≥45**, legacy (v1) opps keep 85/65. Applied to both the tab filter and the tab counts. Keys off data, not the server flag → correct through the mixed-inbox transition, self-heals after the rescore sweep.
- **FIAT decomposition** on the overview tab — Fit / Intent / Access / Timing from `fit.fiat` (inline-styled, `SHOW_FIAT` toggle honors the "ship dark" option).
- **Reason/risk codes surfaced** — `_normalizeCodes()` converts the backend's string `reasonCodes`/`riskCodes` into `{code, description}` with a friendly `CODE_LABELS` map (incl. `GATE_LOW_SOLUTION_RELEVANCE`, `SEMANTIC_UNAVAILABLE`, `RISK_RULE_SEMANTIC_DISAGREEMENT`). **Bonus fix**: the existing "Why this score?" / Fit-Drivers panels read `fit.reasons`/`fit.risks` (objects), but the backend writes string `reasonCodes`/`riskCodes` — so those panels were **dead**. They now render.
- **Bid-recommendation display** — `pass` → **"No-Bid Recommended"**, `pursue` → **"Bid Recommended"** (stored value unchanged; display + color mapping only).

### `js/pages/synchgovProfiles.js`
- **Rank layer wired** — the existing Targeting descriptions (Ideal Opportunity / Customer / Geography) now map to the **top-level `rankIdeal*` fields the backend scorer consumes** (previously they sat inert in `filters`). Added a **"What to Avoid"** textarea → `rankAvoid`, with a hint that these drive scoring. Form-state load, render, generic `_onFieldChange`, DOM-sync, and payload all wired.

## Scope decision — keyword-expansion prune UI deferred (flagged at Gate 1)
The backend `POST /govcapture/profiles/expand-keywords` endpoint shipped in PR #52, but its **frontend prune UI** (per-solution expand → chip-select → save as `expandedKeywords[]`) is **deferred to a fast-follow PR**. Rationale: it's the largest/riskiest sub-piece in a 1,400-line stateful vanilla-JS form, and it does **not** move the "dead triage" metric — the metric-movers (recalibrated bands + gate visibility + rank consumption) are all delivered here. This is the smaller clean cut I offered at Gate 1. **Ask: accept the deferral, or want it in this PR?**

## Verification
- `node --check` clean on both files.
- **F-703 Playwright smoke gate green** (`smoke.spec.js`, 1 passed) — app boots, no global JS breakage from the edits.
- `git diff` scoped to the two files (2 untracked repo docs excluded).
- **Honest limits**: vanilla-JS pages, no unit tests; SynchGov flows aren't in CI (matches the F-703 scope fence). Verified via smoke + code review + the deterministic band/label logic. The visual FIAT/badge rendering and profile round-trip were reviewed, not automated-E2E'd.

## How this completes the triage fix
Backend PR #52 caps junk scores; **this PR's version-aware bands are what actually surface Hot/Warm** (the old frontend hid them at 85/65). End state after: enable `GOVCAPTURE_RANK_FIELDS_ENABLED` → run `scripts/rescoreGovOpportunities.js` → opps become `scoringVersion 2` → the 70/45 bands engage → Hot/Warm populate; the Targeting descriptions rank by what the merchant sells; `rankAvoid` suppresses off-target work.

## Safety
- Frontend-only; no backend, no rules, no deps, nothing deployed. Rollback = revert (bands/labels return to prior values).
- No self-merge.

## Merge routing
Product code → **Williams**, coordinated with the merged backend (§13). I do not merge.

---

**STOP — awaiting go-ahead to open the frontend PR → Williams.** Then: the deferred **keyword-expansion prune UI** (small follow-up), or move to **PR-C2 (Pursuits)**.
