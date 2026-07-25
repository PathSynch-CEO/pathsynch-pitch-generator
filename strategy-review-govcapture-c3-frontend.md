# Gate 1 Strategy Review — PR-C3 Frontend: Analytics Card Set (`synchintro-app`)

**Repo:** `synchintro-app`. **Pairs with:** backend PR #55 (merged; flags off). **Spec:** `PRD-synchgov-capture-01-v2.2.md` §6; `strategy-review-govcapture-c3.md`. **Merge:** Williams. **Gate 1 STOP — no code until approval.**

---

## Session-start findings (code-grounded)

| Area | Current state |
|---|---|
| Endpoint contract (built) | `GET /govcapture/analytics?days=30` → `{ success, analytics: { periodDays, opportunitiesIngested, scoredDistribution{Hot,Warm,Review}, qualifiedCount, pursuitsByStage{…9…}, winLoss{won,lost,no_bid,hasOutcomes}, submissions{count,windowDays,goal}, pipelineValueSurfaced{value,qualifiedCount,assumption}|null, truncated } }`. 404s unless both flags on. |
| Page pattern | Gov surfaces are `window.Synchgov*Page` objects with `init()`, self-styled `addStyles()`, `API.request`. Nav children in `#nav-synchgov-group`; registered in `router.js` (`routes`/`navGroups`/class map) + `index.html` (nav child, `#page-*` container, script). |
| Probe gate | `app.js probeSynchGov()` → gov group; `probeSynchGovPursuits()` (PR-C2) reveals the Pursuits item when `GET /govcapture/pursuits` responds. Same pattern for Analytics. |
| Settings | `synchgovSettings.js` edits a selected profile; profile-level fields save via `PUT /govcapture/profiles/:pid` (partial `PROFILE_CLIENT_FIELDS`). `avgContractValue` + `weeklySubmissionGoal` are exactly this kind of field. |
| Stage labels | The Pursuits page already has the canonical stage→label map to reuse for the pursuits-by-stage card. |

---

## Scope — one new page + Settings inputs + wiring

### 1. New page `js/pages/synchgovAnalytics.js` (`window.SynchgovAnalyticsPage`)
- New **Analytics** nav child (`synchgov-analytics` → `SynchgovAnalyticsPage`), matching the gov page pattern; self-styled with dark-mode block.
- Fetches `GET /govcapture/analytics` on `init()` and renders the card set:
  - **Opportunities ingested** (period) — with the `periodDays` label.
  - **Scored distribution** — Hot / Warm / Review counts (reuses the inbox band colors for visual continuity).
  - **Pursuits by stage** — the 6 non-terminal + 3 terminal counts (stage→label map).
  - **Submissions** — `count` this week vs `goal` (renders the goal comparison only when `goal != null`; otherwise shows the count with a "set a weekly goal in Settings" hint).
  - **Win / Loss** — rendered only when `winLoss.hasOutcomes` (else a muted "no outcomes yet").
  - **Pipeline surfaced** — `pipelineValueSurfaced.value` formatted as currency, only when non-null, **with the `assumption` string shown as a caption** (honest theater); when null, a hint to set `avgContractValue` in Settings.
- **Zero-state**: clean "No SynchGov activity yet" with a pointer to Opportunities (all counts zero render as a tidy empty board, not broken cards).
- **`truncated`**: if true, a small "showing first 1,000 pursuits" note (no silent cap).
- Optional period toggle (30 / 60 / 90 days) re-fetching with `?days=` — nice-to-have, low cost; include unless you'd rather defer.

### 2. SynchGov Settings — two inputs
- Add an **Analytics** section to `synchgovSettings.js` for the selected profile: `avgContractValue` (currency) + `weeklySubmissionGoal` (integer), saved via `PUT /govcapture/profiles/:pid` with just those fields. Empty input → send `null` (clears). Mirrors the existing min-score numeric input pattern.

### 3. Wiring + gating
- `router.js`: `synchgov-analytics` into `routes[]`, `navGroups`, class map.
- `index.html`: nav child (hidden by default), `#page-synchgov-analytics` container, `synchgovAnalytics.js` script.
- `app.js`: `probeSynchGovAnalytics()` reveals the nav item only when `GET /govcapture/analytics` responds (404 when either flag is off) — same shape as `probeSynchGovPursuits`.

---

## Gate 1 decisions for Williams
1. **Card set + rendering rules** (six cards; goal/win-loss/pipeline each render only when their data is present; pipeline shows the assumption caption). Approve?
2. **Placement** — dedicated **`synchgov-analytics` nav page** (consistent with the approved backend framing and every other gov surface). Confirm?
3. **Settings inputs** — `avgContractValue` + `weeklySubmissionGoal` on the **selected profile**, saved via the existing profile-update endpoint; empty clears to null. OK?
4. **Period toggle** — include the 30/60/90-day toggle now, or ship 30-day only and defer? (Recommend include — it's a couple of buttons over the existing `?days=` param.)

## Blast radius
- One new page + one Settings section + 3 small registration edits. All probe-gated on the two backend flags — **invisible until they're on**. No change to any other page. No API changes (contract already shipped in #55).

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Card shows but flags off → 404 | Probe-gated nav (decision #2); page hides itself on 404. |
| Pipeline reads as a hard promise | Render only when non-null + show the backend `assumption` caption verbatim. |
| Numbers look off vs the board | They come straight from the reconciled endpoint (scored dist via `inboxTab`, pursuit figures from `govPursuits`); no client recomputation. |
| Settings save collides with other profile edits | Sends only the two numeric fields; `PUT /profiles/:pid` is a partial update (validated `isUpdate`). |

## Rollback
Backend flags off → nav item, page, and card set all hidden; Settings section hidden behind the same probe. Full revert = revert the PR; no data touched (fields default null).

## Build plan (after approval)
1. Branch `feat/govcapture-c3-analytics` off `synchintro-app` `main`.
2. `synchgovAnalytics.js` (cards + zero-state + dark mode) → router/nav/index.html wiring → `app.js` probe → Settings inputs.
3. F-703 smoke gate green + manual walkthrough with flags on locally. Gate 2, STOP → PR → Williams.

## Merge routing
Frontend product code → **Williams**. Pairs with merged backend #55. I do not merge.

---

**STOP — approval needed before building.** Confirm the four Gate-1 decisions (card set, placement, Settings inputs, period toggle).
