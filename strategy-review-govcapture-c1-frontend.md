# Gate 1 Strategy Review — PR-C1 (frontend, synchintro-app)

**Paired with backend PR #52 (merged).** Spec: `PRD-synchgov-capture-01-v2.2.md` §4, §13. **Repo**: `synchintro-app` (vanilla JS). **Merge**: Williams. Gate 1 STOP — no code until approval.

---

## Session-start findings (read-only)

| Check | Result |
|---|---|
| SynchGov pages | `js/pages/synchgov{Opportunities,Profiles,Settings,Upload}.js`. API via `API.request('/govcapture/...')`. |
| **⚠️ Stale inbox thresholds** | `synchgovOpportunities.js` buckets Hot at `fit.score >= 85`, Warm `65–85`, Review `<65` (lines 340,343,346,393-395). Backend PR-C1 recalibrated to **Hot ≥70, Warm ≥45**. **This mismatch is a co-cause of "0 Hot/0 Warm"** — even with the backend fix live, the frontend would keep hiding Warm/Hot. Fixing it is the point of this PR. |
| FIAT data | Backend stamps `fit.fiat {fit,intent,access,timing}` on every scored opp (unconditional — safe to render always). |
| Flag coordination | `GOVCAPTURE_RANK_FIELDS_ENABLED` is server-side; the frontend can't read it. Design below keys UI off data (`fit.scoringVersion`) + graceful 409, not a client flag. |
| Profile form | `synchgovProfiles.js` builds the payload (rank fields go alongside `solutions`/`negativeKeywords`, ~line 248-303) and renders form sections (~line 361). |

## Scope

### A. Opportunities inbox + detail (`synchgovOpportunities.js`)
1. **Recalibrated bands, version-aware (no backend change needed).** Bucket each opportunity by bands chosen from its own `fit.scoringVersion`:
   - `scoringVersion >= 2` (gated) → Hot ≥70, Warm ≥45, Review <45
   - else (legacy) → keep Hot ≥85, Warm ≥65 (old formula, old bands)
   This is correct during the transition (before the rescore sweep) and self-heals after. Apply to both the filter and the tab counts.
2. **FIAT decomposition** on the detail panel — Fit / Intent / Access / Timing from `fit.fiat`. Display-gated: render only when present (it always is post-C1) — the `GOVCAPTURE_FIAT_DISPLAY_ENABLED` "ship dark" option is honored by a small client toggle constant defaulting off, so it can be turned on independently.
3. **Reason/risk badges** from `fit.reasonCodes`/`fit.riskCodes`: `GATE_LOW_SOLUTION_RELEVANCE` ("Low solution match"), `SEMANTIC_UNAVAILABLE` ("Scored without AI — pending re-score"), `RISK_RULE_SEMANTIC_DISAGREEMENT` ("Rules and AI disagree — review"), `SEMANTIC_STRONG_MATCH` ("Strong AI match").
4. **Bid-recommendation string** (§4.4-6): display `pass` → **"No-Bid Recommended"**, `pursue` → **"Bid Recommended"** (data value unchanged; display map only).

### B. Profiles (`synchgovProfiles.js`)
5. **Rank layer** — four textareas (`rankIdealSolutions`, `rankIdealCustomer`, `rankIdealGeography`, `rankAvoid`) with JustWin-style placeholder examples; added to the form render + the save payload. Shown always (inert when the backend flag is off — the fields simply store and aren't consumed).
6. **Keyword expansion** — per-solution "Expand keywords" button → `POST /govcapture/profiles/expand-keywords` → candidate chips the user prunes (toggle keep/drop) → saved as `expandedKeywords[]` (with `userApproved`) on the solution. **Graceful 409** ("Rank features not enabled yet") when the backend flag is off.

## Flag coordination (the tricky bit, resolved)
- **Bands**: keyed off `fit.scoringVersion` per opportunity — never a client flag. Correct in mixed-inbox transition.
- **FIAT/badges**: render from data that's always present; harmless when scores are legacy.
- **Rank fields**: always shown/saved (backend stores regardless; consumes only when flag on).
- **Keyword Expand**: calls the endpoint; 409 → friendly "not enabled" message. No client flag needed.

Net: **the frontend needs no knowledge of the server flag** — it reacts to data and endpoint responses.

## Blast radius
- Two frontend files (`synchgovOpportunities.js`, `synchgovProfiles.js`). No backend change. No other SynchGov page touched. No rules, no deploy.
- Risk is contained to the SynchGov section; existing tabs/detail keep working (bands change values, not structure).

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Mixed inbox (v1+v2) shows inconsistent bands pre-sweep | Correct by design (per-opp version); documented; sweep unifies. |
| Expand endpoint 409/latency | Explicit 409 copy + button spinner + failure toast; expansion is optional. |
| Rank fields confuse users when backend flag off | Section labeled "Ranking (beta)"; harmless storage; no false promise. |
| No unit tests for vanilla-JS pages | Honest: verified via the F-703 Playwright **smoke gate** (page boots) + manual review; full SynchGov E2E remains deferred (matches the F-703 scope fence). I'll drive the profile+inbox flows locally against the served app where feasible. |

## Rollback
Revert the PR; both files return to prior behavior. No data migration.

## Build plan (after approval)
1. `git checkout main && git pull` (frontend is on `fix/frontend-hosting-site-config`); branch `feat/govcapture-c1-rank-scoring` in `synchintro-app`.
2. Opportunities: version-aware bands (filter + counts), FIAT panel, code badges, bid string map.
3. Profiles: rank textareas (render + payload), keyword-expand button + prune UI + save.
4. Verify: `npx playwright test tests/e2e/smoke.spec.js` green; load SynchGov pages locally; `git diff` scoped to the two files.
5. Gate 2 (`prd-review-govcapture-c1-frontend.md`), then STOP → PR → Williams.

## Merge routing
Product code → **Williams**. Coordinated with the merged backend (§13). I do not merge.

---

**STOP — approval needed before building.** The one thing worth your explicit nod: the **version-aware band strategy** (v2 opps → 70/45, v1 → 85/65, keyed off `fit.scoringVersion`) — it's how the frontend stays correct without reading the server flag, and it's why the "0 Hot/0 Warm" finally moves once opps are on v2.
