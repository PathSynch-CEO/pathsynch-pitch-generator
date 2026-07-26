# Gate 2 Review — PR-C3 Frontend: Analytics Card Set (`synchintro-app`)

**Repo:** `synchintro-app`, branch `feat/govcapture-c3-analytics` (off updated `main`, C2 merged).
**Pairs with:** backend PR #55 (merged; flags off). **Gate 1:** `strategy-review-govcapture-c3-frontend.md` (4 decisions approved). **Merge:** Williams. **I do not merge.**

**STOP — Gate 2. Nothing deployed. No production reads/writes this session.**

---

## What shipped (5 files, +379/−1)

| File | Change |
|---|---|
| `js/pages/synchgovAnalytics.js` | **NEW** (276 lines) — `window.SynchgovAnalyticsPage`, self-styled + dark mode. Six cards from `GET /govcapture/analytics`, 30/60/90-day toggle, zero-state, truncation note. |
| `js/pages/synchgovSettings.js` | +**Analytics Inputs** card (`avgContractValue`, `weeklySubmissionGoal`) saved via `PUT /govcapture/profiles/:pid`; empty → null; local profile kept in sync. |
| `js/router.js` | `synchgov-analytics` in `routes[]`, `navGroups`, class map. |
| `index.html` | Analytics nav child (hidden by default), `#page-synchgov-analytics` container, `synchgovAnalytics.js` script. |
| `js/app.js` | `probeSynchGovAnalytics()` — reveals the nav item only when `GET /govcapture/analytics` responds. |

## Decision-by-decision (Gate 1)

1. **Card set + rendering rules** — six cards: **Opportunities Ingested** (+ qualified, period label); **Scored Distribution** (Hot/Warm/Review, inbox band colors); **Pursuits by Stage** (non-zero stages, stage→label map); **Submissions** (`count / goal` when a goal is set, else count + "set a weekly goal in Settings"); **Win/Loss** (only when `hasOutcomes`, else muted); **Pipeline Surfaced** (currency, only when non-null, **with the backend `assumption` string rendered verbatim as a caption**, else a hint to set the value in Settings). The client renders straight from the endpoint — **no recomputation**, so nothing can drift from the board. ✔
2. **Placement** — dedicated `synchgov-analytics` nav page. ✔
3. **Settings inputs** — on the selected profile via the existing partial profile-update endpoint; empty clears to null; invalid (negative/non-number) blocked client-side with a toast. ✔
4. **Period toggle** — 30/60/90-day buttons re-fetch with `?days=`. ✔

Zero-state: when ingested = 0 **and** no pursuits, a single tidy empty block (not a grid of empty cards). `truncated` surfaces a "showing the most recent 1,000 pursuits" note.

## Verification evidence
- `node --check` clean on all 4 edited JS files (+ the new page).
- **F-703 smoke gate**: `npx playwright test tests/e2e/smoke.spec.js --project=chromium` → **1 passed**. The served app boots to the logged-out auth UI with `synchgovAnalytics.js` + the Settings changes loaded — no load/parse error.
- `git diff --stat`: 5 files, +379/−1. New page is additive; other files changed only at the documented touch-points.

## Blast radius / rollback
Everything probe-gated on the backend flags: with them off, the nav item, page, and the Analytics Inputs card's *usefulness* are hidden (the Settings card itself renders under the existing gov-group probe, but writes only the two nullable fields). The client never recomputes analytics — it renders the reconciled endpoint. Rollback = revert the PR; no data touched.

## Notes for the reviewer
- The Settings **Analytics Inputs** card appears whenever the gov group is visible (profiles probe), independent of the analytics flag — the fields are harmless profile inputs and are useful to set before enabling the cards. Only the **Analytics nav page** is gated on the analytics endpoint probe.
- Currency is display-only (`$` + rounded, `toLocaleString`); the assumption caption keeps the pipeline number honestly framed.

## Owner reminders
1. Invisible until both `GOVCAPTURE_PURSUITS_ENABLED` and `GOVCAPTURE_ANALYTICS_CARDS_ENABLED` are set in the backend `.env` (pairs with merged #55; that backend deploy carries the new index, so it must be local).
2. Merge routing: **Williams**. I do not merge.

**Awaiting your go to open the frontend PR → Williams.** This completes the PR-C3 unit.
