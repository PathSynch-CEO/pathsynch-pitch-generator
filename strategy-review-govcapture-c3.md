# Gate 1 Strategy Review — PR-C3 Analytics Card Set (SynchGov Capture)

**Spec:** `PRD-synchgov-capture-01-v2.2.md` §6. **Merge:** Williams (product code; **no `firestore.rules` change this time** — analytics is computed-on-read, no new collection). Paired backend + frontend PR (§13). **Gate 1 STOP — no code until approval.**

---

## Session-start findings (code-grounded)

| Area | Current state |
|---|---|
| Band source | `govScoreConstants.inboxTab(score, hardDisqualified)` (WARM 45 / HOT 70) is the single source of the Hot/Warm/Review tabs the board uses. Analytics must **reuse it** so the scored-distribution card reconciles exactly with the inbox. |
| Pursuit truth | `govPursuits` (PR-C2) holds `stage`, `stageHistory[]`, `outcome`, `awardValue`, `fitScoreAtPromotion`, `active`. **§6.3 rule: analytics read `govPursuits`, never the mirrored `govOpportunities.pursuitStatus`.** |
| Profile fields | `govProfiles` has **no** `avgContractValue` or weekly-goal field yet (`schemas.PROFILE_CLIENT_FIELDS`). §6.2 says `avgContractValue` is a numeric field edited in SynchGov Settings, default null. |
| Analytics endpoint | None under `/govcapture/*` today. |
| Indexes | `govOpportunities` composites all lead with `userId + archived + …`; there is no bare `userId + createdAt` for a period query. |
| Frontend | Gov surfaces are nav children (`synchgov-opportunities/pursuits/profiles/upload/settings`); no analytics surface. Settings page exists (`synchgovSettings.js`). |

---

## Scope — backend endpoint + paired frontend card set

### Backend
1. **`GET /govcapture/analytics?days=30`** — `featureGate` + `pursuitsGate` + `requireAuth`, owner-scoped. Computes on-read (no stored counters, no new collection). Returns:
   - `opportunitiesIngested` — count `govOpportunities` (userId, `createdAt ≥ periodStart`).
   - `scoredDistribution { Hot, Warm, Review }` — the same opp set grouped by **`inboxTab(fit.score, fit.hardDisqualified)`** (imported, not re-derived).
   - `qualifiedCount` — opps with `fit.score ≥ WARM_THRESHOLD` and not hard-DQ (feeds pipeline value).
   - `pursuitsByStage { planning… no_bid }` — from **`govPursuits`** (userId), grouped by `stage`. Reconciles 1:1 with the board.
   - `submissions { count, goal }` — pursuits whose `stageHistory` has a `submitted` entry within the last 7 days; `goal` = profile weekly goal (null → card hides the goal comparison).
   - `winLoss { won, lost, no_bid }` — from `govPursuits.outcome`; the card renders only once ≥1 terminal exists.
   - `pipelineValueSurfaced` — `avgContractValue × qualifiedCount`, **only when `avgContractValue` is set**; response labels it an assumption (honest theater).
2. **`avgContractValue` + `weeklySubmissionGoal`** added to `schemas.PROFILE_CLIENT_FIELDS` + `validateProfileInput` (numeric, ≥0, nullable). No other profile change.
3. **`firestore.indexes.json`** — one additive `govOpportunities` composite: `userId + createdAt DESC` (the period query). `govPursuits` aggregations reuse the PR-C2 `userId + …` indexes (fetch-by-user, group in memory — bounded).
4. **Flag** `GOVCAPTURE_ANALYTICS_CARDS_ENABLED` (default off) in `.env.example`; endpoint 404s when off (like `pursuitsGate`).
5. **Tests** — aggregation unit tests (mock firebase-admin): counts reconcile with pursuit docs; scored-distribution uses `inboxTab` bands; reads `govPursuits` (asserted — a mirrored-field-only fixture must not change pursuit counts); zero-state renders zeros/nulls cleanly; pipeline value present only when `avgContractValue` set; submissions window = 7 days. Full suite ≥ current baseline **1,765**.

### Frontend (paired)
6. **`synchgovAnalytics.js`** — a new **Analytics** nav child (`synchgov-analytics` → `SynchgovAnalyticsPage`), matching the gov page pattern. Renders the card set from `GET /govcapture/analytics`: ingested, scored distribution (Hot/Warm/Review), pursuits-by-stage, submissions vs goal, win/loss (when present), pipeline surfaced (when `avgContractValue` set). Clean **zero-state**. Probe-gated in `app.js` (like Pursuits) so it's invisible unless the endpoint responds.
7. **SynchGov Settings** — two numeric inputs (`avgContractValue`, `weeklySubmissionGoal`) writing via the existing profile update path.
8. Router/nav/index.html wiring; dark-mode styles.

---

## Gate 1 decisions for Williams
1. **Card set contract** (the six cards above) + **reconciliation rule** (pursuit figures from `govPursuits` only; scored distribution via shared `inboxTab`). Approve?
2. **Placement** — a dedicated **`synchgov-analytics` nav page** (recommended; matches every other gov surface + "Analytics dashboard" framing) vs. a stats strip atop the Pursuits board. Pick one.
3. **Entitlement** — PRD §6 says gate via `getUserPlan()`, but SynchGov pricing is an **open dependency** (§7). Recommendation: for now gate on the **flags + owner-scope** (consistent with all current govcapture endpoints, which aren't plan-gated yet), and wire the `getUserPlan()` tier check when SynchGov pricing lands. OK to defer, or add a tier gate now?
4. **Period semantics** — `days=30` window for ingested/scored/qualified; **submissions compared over a rolling 7-day window** against the weekly goal. Approve, or prefer calendar-month / prorated goal?

## Blast radius
- One new endpoint + one new frontend page + 2 profile fields + 2 Settings inputs + 1 additive index + 1 flag. **No new collection, no `firestore.rules` change.**
- All read-only aggregation over existing owner-scoped data; nothing writes. Invisible until `GOVCAPTURE_ANALYTICS_CARDS_ENABLED` (and `GOVCAPTURE_PURSUITS_ENABLED`) are on.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Numbers drift from the board | Scored distribution reuses `inboxTab`; pursuit figures read `govPursuits` only (never the mirror). A test asserts reconciliation. |
| Large accounts → slow in-memory grouping | Period-scoped opp query (indexed `userId+createdAt`); pursuit set is small (promoted subset). Cap/---note if a merchant ever exceeds a sane bound. |
| Pipeline value reads as a hard number | Rendered only when `avgContractValue` set; UI labels it an assumption (honest theater), per §6.2. |
| Entitlement invents pricing | Defer the plan gate (open dependency); flags + owner-scope for now. |

## Rollback
`GOVCAPTURE_ANALYTICS_CARDS_ENABLED=false` hides the endpoint + nav page + card set. The index + profile fields are inert additions. Full revert = revert both PRs; no data migration (fields default null; nothing stored).

## Build plan (after approval)
1. Backend branch `feat/govcapture-c3-analytics` off `main`: endpoint + profile fields + index + flag + tests. Full suite + emulator green. Gate 2 → PR → Williams.
2. Frontend branch (`synchintro-app`): `synchgovAnalytics.js` + Settings inputs + wiring + probe gate. Smoke gate green. Gate 2 → PR → Williams.

## Merge routing
Product code → **Williams**. Backend first, then frontend (§13). I do not merge.

---

**STOP — approval needed before building.** Confirm the four Gate-1 decisions (card contract + reconciliation, placement, entitlement deferral, period semantics).
