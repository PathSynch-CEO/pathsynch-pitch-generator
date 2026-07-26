# Gate 2 Review — PR-C2 Frontend: Pursuits Board (`synchintro-app`)

**Repo:** `synchintro-app`, branch `feat/govcapture-c2-pursuits` (off updated `main`, C1 frontend merged).
**Pairs with:** backend PR #53 (merged; flag off). **Gate 1:** `strategy-review-govcapture-c2-frontend.md` (4 decisions approved). **Merge:** Williams. **I do not merge.**

**STOP — Gate 2. Nothing deployed. No production reads/writes this session.**

---

## What shipped (6 files, +543/−8)

| File | Change |
|---|---|
| `js/pages/synchgovPursuits.js` | **NEW** (419 lines) — `window.SynchgovPursuitsPage`, self-styled. Kanban (6 stage columns + Closed grid) + table toggle, Active/All scope, advance controls, terminal outcome prompts, instructive empty state. |
| `js/pages/synchgovOpportunities.js` | +Create-Pursuit action, 409-aware status control, `_pursuitsEnabled` probe. |
| `js/router.js` | `synchgov-pursuits` added to `routes[]`, `navGroups`, and the page-class map. |
| `index.html` | Pursuits nav child (hidden by default), `#page-synchgov-pursuits` container, `synchgovPursuits.js` script. |
| `js/app.js` | `probeSynchGovPursuits()` — reveals the nav item only when `GET /govcapture/pursuits` succeeds. |
| `js/api.js` | Thrown errors on 4xx now carry `.status` + `.data` (backward-compatible — existing callers only read `.message`). Enables 409 detection. |

## Decision-by-decision (Gate 1)

1. **Page contract** — `synchgovPursuits.js`: **board** = one column per non-terminal stage (`planning → … → awaiting_result`), cards show title/buyer/`fitScoreAtPromotion`/updatedAt + an **Advance…** select of *valid* forward+terminal targets (mirrors backend `isValidTransition`); a **Closed** grid groups terminals with outcome + award/loss detail. **Table** toggle gives the same rows. Advancing calls `PUT /govcapture/pursuits/:id/stage`; `submitted` prompts portal+date, `won` prompts award value, `lost/no_bid` prompt reason (user-attested, §5.3). **Empty state instructs** ("Create Pursuit" from the inbox) — never auto-fills. ✔
2. **Nav gating** — Pursuits nav item ships `display:none`; `probeSynchGovPursuits()` reveals it only on a successful `GET /govcapture/pursuits` (404 when the backend flag is off). The opportunities page runs the same probe (`_pursuitsEnabled`) to gate its Create-Pursuit button. So with `GOVCAPTURE_PURSUITS_ENABLED=false` the board and the button are invisible. ✔
3. **Opportunities touch-ups** — `_renderDetail`: when `opp.pursuitActive`, the status `<select>` is replaced with a read-only status pill + "Managed by pursuit board →" link; otherwise the normal dropdown plus a **Create Pursuit** button (only when `_pursuitsEnabled`). `createPursuit()` → `POST …/promote` → reloads the opp. `updatePursuitStatus` catch now branches on `err.status === 409` → warning toast + detail reload (surfaces the managed state instead of a generic failure). ✔
4. **Verification** — F-703 Playwright smoke gate + review; no JS unit tests (matches C1 frontend). ✔

## Post-Gate-1 self-review refinements (applied before this Gate 2)
Three small items caught on a second read and fixed here:
1. **Stale inbox chip after promote** — `createPursuit` now calls `_renderList()` after `_loadOppDetail`, so the inbox row's status chip matches the detail pane's "managed by pursuit board" state immediately (previously the array was synced but the list DOM wasn't re-rendered).
2. **Dark mode** — added a `[data-theme="dark"] .sgp-*` block mirroring the opportunities-page palette (the board previously used light-only hex values).
3. **Scope-aware empty state** — in **Active** scope an empty board now reads "No active pursuits — switch to All / promote from the inbox" (with a one-click "Show all" button) instead of the misleading "No pursuits yet."

## Verification evidence
- `node --check` — clean on all 6 files (`synchgovPursuits.js`, `synchgovOpportunities.js`, `router.js`, `app.js`, `api.js`).
- **F-703 smoke gate**: `npx playwright test tests/e2e/smoke.spec.js --project=chromium` → **1 passed** (re-run after the three fixes). The served app boots to the logged-out auth UI with the new `synchgovPursuits.js` loaded — i.e. no load/parse error from the new page or wiring.
- `git diff --stat`: 6 files (new page + 5 touch-points). New page is additive; other pages changed only at the documented touch-points.

## Known limitations / fast-follows (flag to Williams in the PR)
- **Embedded mode + `window.prompt`** — terminal/`submitted` capture uses `window.prompt`. This app also runs embedded (PathManager, `app.js checkEmbeddedMode()`), and sandboxed iframes can suppress `prompt`, which would block advancing to `submitted`/`won`/`lost` in that context. Fast-follow: replace with a small inline modal. **Called out as a known limitation, not a blocker for the standalone app.**
- **No pursuit detail drawer** — `stageHistory[]`, `proposalReadiness`, `portalName`, `submittedAt` are stored but not shown yet; a click-through timeline drawer is the natural next increment (data already present). `proposalReadiness` is validated backend-side but not yet surfaced/sent — deferred to the drawer.
- **No board → source-opportunity link** — `sourceOpportunityId` is on every pursuit; only inbox→board navigation exists today (reuse the existing sessionStorage handoff pattern).
- **Duplicate probe** — `app.js` and the opportunities page each fire `GET /govcapture/pursuits?active=true` on boot to detect the 404 gate; memoize one shared result later.

## Blast radius / rollback
Everything is probe-gated on `GOVCAPTURE_PURSUITS_ENABLED` (backend): with the flag off the board, nav item, and Create-Pursuit button are all hidden, and the opportunities page is byte-identical (the `pursuitActive` branch is never true, the button never renders). The `api.js` change only *adds* fields to thrown errors. Rollback = revert the PR; no data touched.

## Notes for the reviewer
- The pursuit doc carries `fitScoreAtPromotion` (not a full `fit` object); the card badge uses that number and degrades gracefully.
- Terminal outcome capture uses `window.prompt` (portal/award/reason) — minimal and honest for MVP parity; a richer inline form is a fast-follow if desired.
- Activity entries from stage transitions land in the app-level Activity feed (backend writes them); this page does not duplicate that.

## Owner reminders
1. This UI is invisible until you set `GOVCAPTURE_PURSUITS_ENABLED=true` in the backend `.env` (pairs with merged #53) — and that deploy carries `firestore.rules`+indexes, so it must be **local**.
2. Merge routing: **Williams**. I do not merge.

**Awaiting your go to open the frontend PR → Williams.**
