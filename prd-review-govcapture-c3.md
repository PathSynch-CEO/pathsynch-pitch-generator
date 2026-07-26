# Gate 2 Review — PR-C3 Backend: Analytics Card Set (SynchGov Capture)

**Branch:** `feat/govcapture-c3-analytics` (off `main`). **Spec:** `PRD-synchgov-capture-01-v2.2.md` §6. **Gate 1:** `strategy-review-govcapture-c3.md` (4 decisions approved). **Merge:** Williams (product code; **no `firestore.rules` change** — analytics is computed-on-read).

**STOP — Gate 2. Nothing deployed. No production reads/writes this session.**

---

## What shipped (backend, all behind `GOVCAPTURE_ANALYTICS_CARDS_ENABLED` + `GOVCAPTURE_PURSUITS_ENABLED`)

| File | Change |
|---|---|
| `functions/services/govcapture/govAnalyticsService.js` | **NEW** — `computeAnalytics(userId, {days,nowMs})`. Two owner-scoped reads + a small profiles read; pure aggregation. |
| `functions/routes/govcaptureRoutes.js` | +`analyticsGate` (requires both flags), +`GET /govcapture/analytics`. |
| `functions/services/govcapture/schemas.js` | +`avgContractValue` + `weeklySubmissionGoal` on `PROFILE_CLIENT_FIELDS`; numeric (≥0, nullable) validation. |
| `functions/services/govcapture/govPursuits.js` | +`submittedAt` ISO-date validation in `validateStageTransitionInput` (closes a PR-C2 hygiene gap Fable flagged). |
| `functions/firestore.indexes.json` | +1 additive `govOpportunities` composite (`userId + createdAt DESC`). |
| `functions/.env.example` | +`GOVCAPTURE_ANALYTICS_CARDS_ENABLED=false`. |
| `functions/tests/govAnalytics.test.js` | **NEW** — 19 tests. |

## Design (matches Gate-1 approvals + the Fable pre-build review)

**Two reads, no new indexes for pursuits** (the endpoint already fetches every pursuit for stage/win-loss grouping, so submissions is a free in-memory filter):
1. `govOpportunities` (`userId`, `createdAt ≥ periodStart`) → ingested, scored distribution, qualified. *(the one new composite)*
2. `govPursuits` (`userId`, `limit 1001`) → pursuits-by-stage, win/loss, submissions. Bare equality = automatic single-field index. `truncated` flag if > 1000.
3. `govProfiles` (`userId`) → `avgContractValue` / `weeklySubmissionGoal` (automatic single-field).

**Reconciliation (§6.3):**
- Scored distribution reuses **`inboxTab(fit.score, fit.hardDisqualified)`** — the exact bands the inbox/board use. Test asserts `{Hot,Warm,Review}` from a mixed fixture.
- Pursuit figures derive from **`govPursuits` only**. A dedicated test seeds an opportunity with a mirrored `pursuitStatus:'won'` and **zero** pursuit docs → `winLoss.won === 0`. The mirror can never move a count.
- **Submissions** = count of pursuits whose top-level `submittedAt` (the user-attested transition stamp, §5.3) falls in a rolling **7-day** window. A deliberately-skipped `submitted` stage is not counted; documented as attested-submissions-only.

**Fields / gating:**
- Pipeline value = Σ over qualified opps of each owning profile's `avgContractValue` (multi-profile-safe; single-profile reduces to `avg × qualified`). Rendered **only when set**, and the response carries an explicit `assumption` string (honest theater, §6.2).
- `weeklySubmissionGoal` = sum across profiles that set it (null → card hides the goal comparison).
- Endpoint 404s unless **both** flags are on (`analyticsGate`). Entitlement/plan gate deferred (Gate-1 #3 — SynchGov pricing is an open dependency); owner-scoped like every current govcapture endpoint.
- `days` clamped to [1, 365], default 30.

## Verification evidence
- `node --check` clean on all changed/new files; `firestore.indexes.json` re-parsed valid.
- **New suite** `govAnalytics.test.js` — **19/19**: full aggregate (ingested/distribution/qualified/stage/winLoss/submissions/pipeline), mirrored-field independence, zero-state, pipeline+goal gating, days clamp, truncation cap, and both validator additions.
- **Full suite**: **1784 passed / 0 failed**, 66 suites (baseline after C2 was 1765 → +19).
- **Emulator suite** (`npm run test:emulator`, JDK 25): **137/137** — confirms no regression (there is no rules change this PR; run for a clean bill).
- `git diff` scoped to: `govcaptureRoutes.js`, `schemas.js`, `govPursuits.js`, `firestore.indexes.json`, `.env.example` (+2 new files). `.claude/settings.local.json` was already modified at session start (not this work).

## Blast radius / rollback
Read-only aggregation; **no new collection, no rules change, nothing writes.** Everything gated by the two flags (off). The index + profile fields are inert additions. Rollback = revert the PR; no data migration (fields default absent/null).

## Owner reminders
1. Deploy carries `firestore.indexes.json` — an index-only change (no rules), still best done from a **local** deploy alongside the flag.
2. Set both `GOVCAPTURE_PURSUITS_ENABLED=true` and `GOVCAPTURE_ANALYTICS_CARDS_ENABLED=true` to expose the endpoint (frontend pairs with this).
3. Merge routing: **Williams**. I do not merge.

**Awaiting your review. On approval I open the backend PR → Williams, then build the paired frontend (`synchgovAnalytics.js` + Settings inputs) to its own Gate 2.**
