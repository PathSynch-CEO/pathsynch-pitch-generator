# Gate 2 Review — PR-C5 Frontend: Evaluator Panel (`synchintro-app`)

**Repo:** `synchintro-app`, branch `feat/govcapture-c5-evaluator` (off `main`). **Pairs with:** the C5 backend branch (built, PR held for David's prompt / your ship-generic-first call). **Gate 1:** covered by `strategy-review-govcapture-c5.md` items 11–12 (approved with "all five"). **Merge:** Williams. **I do not merge.**

**STOP — Gate 2. Nothing deployed. No production reads/writes this session.**

---

## What shipped (1 file, +338/−4)

A single-file change to **`js/pages/synchgovPursuits.js`** — the Evaluator ships as the **pursuit detail drawer** (which also delivers the C2 fast-follow "detail drawer"). Scoped to one file on purpose: it does **not** touch `router.js` / `index.html` / `app.js`, so there is **zero conflict** with the still-open C3-frontend PR #33.

- **Card → drawer**: pursuit card titles (board + table) become buttons that open a right-side drawer for that pursuit. A **readiness badge** (`R <score>`) shows on any card/row whose `proposalReadiness` is set.
- **Evaluator panel** in the drawer (probe-gated):
  - **Upload draft** — file input (`.pdf/.docx/.txt`) → `POST /pursuits/:id/proposal` via the app's established `getAuthToken()` + `FormData` + direct `fetch` pattern (the one path `API.request`'s JSON default can't handle).
  - **Proposal list** with **Run evaluation** (`POST /pursuits/:id/evaluate`, explicit user action) and **Delete** (`DELETE /proposals/:docId`, confirm dialog noting results are kept).
  - **Latest evaluation** render: evaluator score + `promptVersion`; **Pass A compliance** (present/unclear/**missing** summary + per-requirement status chips); **per-criterion** score with `reasonCode` + evidence; **fix-first** list with **ack toggles** (Open / Acknowledged / Addressed → `PUT …/fix-first/:i/ack`).
  - On evaluation completion the card's readiness badge updates immediately (local sync + board re-render).
- **Probe gate**: `_probeEvaluator()` calls `GET /govcapture/proposals` on page init; 404 (flag off) → `_evaluatorEnabled=false` and the panel shows a neutral "not enabled" line. So with `GOVCAPTURE_EVALUATOR_ENABLED` off, the drawer still opens (pursuit summary) but exposes no evaluator surface.
- Full dark-mode block for all new classes.

## Decision-by-decision (Gate 1 items 11–12)
1. **Evaluator panel on the pursuit detail** — delivered as the drawer, with upload → run → Pass A checklist → Pass B score + reasons → fix-first ack toggles, and the `proposalReadiness` badge on the card. ✔
2. **Probe-gated** like Pursuits/Analytics — `GET /govcapture/proposals` probe; invisible/neutral when the flag is off. ✔
3. **`window.prompt` fast-follow (partial payment)** — the drawer is the new inline surface; the evaluator adds **no** prompts. The board's quick-advance select still uses `window.prompt` for terminal/`submitted` capture (unchanged) — full inline-modal replacement remains a fast-follow, as scoped ("partial payment"). Noted honestly, not silently dropped.

## Verification evidence
- `node --check` clean on the edited page.
- **F-703 smoke gate**: `1 passed` — app boots to the logged-out UI with the updated page loaded (no load/parse error).
- `git diff --stat`: 1 file, +338/−4. No router/nav/index changes → no overlap with the pending C3-frontend PR #33.

## Blast radius / rollback
The drawer + evaluator live entirely inside the pursuits page and are probe-gated on `GOVCAPTURE_EVALUATOR_ENABLED`. With the flag off, behavior is the C2 board plus a read-only pursuit-summary drawer. No other page touched. Rollback = revert the PR; no data touched.

## Notes for the reviewer
- Multipart upload deliberately bypasses `API.request` (which forces `Content-Type: application/json`) and uses the same `getAuthToken()`+`FormData`+`fetch` pattern as `synchgovUpload.js`.
- The drawer re-renders on every action (upload/evaluate/delete/ack) — simple and correct for the data volumes here; no optimistic-state drift.
- Depends only on the C5 backend endpoint contract, which is built; this PR should open **alongside** the backend PR (which is itself held for David's rubric / your generic-first call).

## Owner reminders
1. Invisible until `GOVCAPTURE_EVALUATOR_ENABLED` (+ `GOVCAPTURE_PURSUITS_ENABLED`) are on in the backend `.env`.
2. Open this frontend PR **together with** the C5 backend PR so Williams reviews the unit as a whole.
3. Merge routing: **Williams**. I do not merge.

**Awaiting your go.** Because C5's opening trigger is David's prompt, the natural sequence is: decide hold-vs-ship-generic-first on the backend → open backend + this frontend PR together → Williams.
