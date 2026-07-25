# Gate 1 Strategy Review — PR-C2 Frontend: Pursuits Board (`synchintro-app`)

**Repo:** `synchintro-app` (separate from the functions repo). **Pairs with:** backend PR #53 (merged to `main`, flag off). **Spec:** `PRD-synchgov-capture-01-v2.2.md` §5.3, §13; `strategy-review-govcapture-c2.md` items 11–13. **Merge:** Williams. **Gate 1 STOP — no code until approval.**

---

## Session-start findings (code-grounded, `synchintro-app`)

| Area | Current state |
|---|---|
| Page model | Vanilla JS, one class per file exposed as `window.Synchgov*Page` (e.g. `js/pages/synchgovOpportunities.js`, ~2,519 lines). No build/module system — matches C1. |
| Backend calls | `API.request('/govcapture/…', { method, body })` — the global `API` helper handles base URL + auth. Same helper the pursuit endpoints expect. |
| Routing | `js/router.js`: `routes[]` array, `groups{}` map (`synchgov-* → 'synchgov'`), and a page-class map (`'synchgov-opportunities' → 'SynchgovOpportunitiesPage'`). |
| Nav | `index.html` `#nav-synchgov-group` (a `nav-group`, `display:none`) with one `<a class="nav-item nav-child" data-page="synchgov-*">` per page. |
| Feature gate | `js/app.js probeSynchGov()` shows the whole gov nav group only when the backend responds (probes the profiles endpoint). |
| Kanban precedent | `js/pages/pitches.js` already implements a pipeline/board — mirror its column + card + drag/advance styling. |
| Promote/status anchor | `synchgovOpportunities.js _renderDetail(opp)` renders the per-opp status control and calls `PUT /govcapture/opportunities/:id/status` (line ~223). This endpoint now **409س** when a pursuit owns the opp. |

---

## Scope — one new page + wiring + two touch-ups to the opportunities page

### 1. New page `js/pages/synchgovPursuits.js` (`window.SynchgovPursuitsPage`)
- **Board (kanban) + table toggle** (parity with MVP #8), mirroring the `pitches.js` pipeline pattern.
- **Columns** = the six non-terminal stages (`planning → drafting → compliance_check → ready_to_submit → submitted → awaiting_result`) plus a **Closed** area for terminals (`won/lost/no_bid`), grouped by outcome.
- **Card** = title, buyer, `fitScoreAtPromotion` badge, current stage, updatedAt. **Advance control** = a "next stage" action (dropdown of valid forward targets + terminal outcomes), calling `PUT /govcapture/pursuits/:id/stage`.
- **Terminal stages** reveal outcome fields (`awardValue` for won, `lossReason` for lost/no_bid) → `PUT /govcapture/pursuits/:id/outcome`.
- **`submitted`** prompts for `submittedAt` + `portalName` (user-attested, §5.3).
- **Empty state instructs** ("Promote an opportunity to start a pursuit") — never auto-fills.
- **Data**: `GET /govcapture/pursuits` (+ optional `?active`/`?stage`/`?outcome`). Read-only, no polling.

### 2. Wiring
- `router.js`: add `'synchgov-pursuits'` to `routes[]`, `groups{}` (`→ 'synchgov'`), and the class map (`→ 'SynchgovPursuitsPage'`).
- `index.html`: add one `nav-child` anchor inside `#nav-synchgov-group`.
- Load the new `<script src="js/pages/synchgovPursuits.js">` alongside the other gov pages.

### 3. Opportunities page touch-ups (`synchgovOpportunities.js`)
- **"Create Pursuit"** button in `_renderDetail(opp)` → `POST /govcapture/opportunities/:id/promote` → toast + optional jump to the board. On refresh the opp shows it's pursuit-managed.
- **409-aware status control**: when `opp.pursuitActive === true`, replace the status dropdown with a read-only "Managed by pursuit board → open pursuit" link; if a stale `PUT …/status` still returns 409, surface the message + board link (no silent failure).

### 4. Feature gating (matches `probeSynchGov`)
- The Pursuits **nav item** appears only when the backend flag is on: probe `GET /govcapture/pursuits` (200 → show; 404 → hide), same shape as the existing gov-group probe. So with `GOVCAPTURE_PURSUITS_ENABLED=false` the board is invisible and the opportunities page is byte-identical (promote button hidden behind the same probe).

---

## Gate 1 decisions for Williams
1. **Page contract** — new `synchgovPursuits.js` (kanban columns above + table toggle), advance controls, terminal outcome fields, instructive empty state. Approve?
2. **Nav gating** — Pursuits nav item + Create-Pursuit button shown only when a `GET /govcapture/pursuits` probe succeeds (mirrors `probeSynchGov`). OK?
3. **Opportunities touch-ups** — Create-Pursuit in the detail panel + 409-aware read-only status control when a pursuit owns the opp. Approve the behavior change?
4. **Verification** — Playwright **smoke gate (F-703)** + review, **no JS unit tests** (honest; matches C1 frontend). OK?

## Blast radius
- One new page + 3 small registration edits + 2 edits to the opportunities detail panel. Everything behind the same probe gate as the rest of SynchGov, so **invisible until `GOVCAPTURE_PURSUITS_ENABLED` is on**.
- No change to any other page; the opportunities list/detail is unchanged except the new button + the pursuit-managed status branch.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Board shown but backend flag off → 404s | Probe-gated nav (decision #2); page also handles 404 by hiding itself. |
| Stale status write after promote → 409 | 409-aware control renders the pointer instead of an error; refresh reflects `pursuitActive`. |
| Kanban is large/stateful | Mirror the proven `pitches.js` pipeline; smoke-gate + review (no unit tests, matches C1). |
| Optimistic board drift after advance | `transitionStage` returns the updated pursuit; re-render from the response + refetch counts. |

## Rollback
`GOVCAPTURE_PURSUITS_ENABLED=false` (backend) hides the nav item, the board, and the Create-Pursuit button (all probe-gated). Full revert = revert the frontend PR; no data touched (read + the same mutations the backend already exposes).

## Build plan (after approval)
1. Branch `feat/govcapture-c2-pursuits` off `synchintro-app` `main`.
2. `synchgovPursuits.js` (board + table + advance/outcome controls) → router/nav/index.html wiring → opportunities Create-Pursuit + 409-aware status → probe gate.
3. Smoke gate (F-703) green + manual walkthrough with the flag on locally. Gate 2, STOP → PR → Williams.

## Merge routing
Frontend product code → **Williams**. Pairs with the merged backend #53. I do not merge.

---

**STOP — approval needed before building.** Confirm the four Gate-1 decisions (page contract, probe gating, opportunities touch-ups, smoke-only verification).
