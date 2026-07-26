# Gate 1 Strategy Review — PR-C2 Pursuits Pipeline (SynchGov Capture)

**Spec**: `PRD-synchgov-capture-01-v2.2.md` §5, §13. **Merge**: Williams (product code + **firestore.rules change → manual-approval**). Paired backend + frontend PR (§13). Gate 1 STOP — no code until approval.

---

## Session-start findings (code-grounded)

| Area | Current state |
|---|---|
| Pursuit model today | A `pursuitStatus` **field on `govOpportunities`** (`'new'\|'reviewing'\|'pursuing'\|'bid_submitted'\|'won'\|'lost'\|'no_bid'`), set via `PUT /govcapture/opportunities/:oppId/status` (`govcaptureRoutes.js:331`). The "board" is just the inbox filtered by that field. **No `govPursuits` collection, no pipeline object, no board page.** |
| Rules | 7 gov* deny blocks at `firestore.rules:653-677` (all CF-only). `govPursuits` needs a new deny block. |
| Indexes | `govOpportunities` has 4 composite indexes; none for pursuits. |
| Activity feed | `services/activityService.js` writes `users/{uid}/activityFeed` — reuse for stage-transition entries. |
| Idempotency pattern | `samSyncService._acquireLock` uses `db.runTransaction` on `govSyncLocks` — reuse the transaction shape for promotion idempotency. |
| Frontend | No pursuits page; `synchgovOpportunities.js` has the status filter. A new `synchgovPursuits.js` page is needed. |

---

## Scope — backend PR + paired frontend PR

### Backend
1. **`govPursuits/{pursuitId}` collection** (new) — §13 schema:
   `userId, workspaceId?, profileId, sourceOpportunityId, sourceProvider, fitScoreAtPromotion, stage, stageHistory[] ({stage, at, byUid}), outcome, awardValue?, lossReason?, proposalReadiness?, portalName?, submittedAt?, createdAt, updatedAt`.
2. **Stage model** (§5.3): `planning → drafting → compliance_check → ready_to_submit → submitted → awaiting_result → won | lost | no_bid`. `submitted` is user-attested (date + destination portal).
3. **`govPursuitService.js`**:
   - `createPursuit(userId, oppId, {workspaceId})` — **idempotent**: at most one *active* (non-terminal) pursuit per `(userId, sourceOpportunityId)`, enforced in a transaction; a second call returns the existing pursuit (200, not error). Stamps `fitScoreAtPromotion` from the opp's current `fit.score`, `sourceProvider` from `primarySource`, `workspaceId` when present.
   - `transitionStage(pursuitId, userId, newStage)` — validates the transition, appends `stageHistory`, **mirrors** coarse status to the opportunity, writes an activity entry.
   - `updateOutcome(pursuitId, userId, {outcome, awardValue, lossReason})`.
4. **`pursuitStatus` mirror** (§13): govPursuits is the source of truth; on every transition, mirror to `govOpportunities.pursuitStatus`:
   `planning/drafting/compliance_check/ready_to_submit → pursuing` · `submitted/awaiting_result → bid_submitted` · `won/lost/no_bid → 1:1`.
   **409 guard**: `PUT /opportunities/:oppId/status` is rejected (409, pointer to the pursuit) when the opp has a linked *active* pursuit — the pursuit owns the state.
5. **Independence from archival** (§5-8): auto-archiving an opportunity never mutates/hides its pursuit; the board reads `govPursuits` regardless of opp state.
6. **Endpoints**: `POST /govcapture/pursuits` (promote), `GET /govcapture/pursuits` (board), `GET /govcapture/pursuits/:id`, `PUT /govcapture/pursuits/:id/stage`, `PUT /govcapture/pursuits/:id` (outcome). All `featureGate` + `requireAuth` + owner-scoped, behind `GOVCAPTURE_PURSUITS_ENABLED`.
7. **`firestore.rules`** — add `match /govPursuits/{docId} { allow read, write: if false; }` (CF-only, consistent with all gov*). **Williams reviews (F-101).**
8. **`firestore.indexes.json`** — `govPursuits`: `userId + stage + updatedAt DESC` (board), `userId + outcome + updatedAt DESC` (win/loss).
9. **Tests** — createPursuit idempotency, stage transition + mirror map, 409 guard, outcome attribution, archival independence. Full suite ≥ current baseline. **Emulator suite**: add an assertion that a client SDK cannot read/write `govPursuits` (the new deny block).
10. **Flag**: `GOVCAPTURE_PURSUITS_ENABLED` (default off) in `.env.example`.

### Frontend (paired)
11. **`synchgovPursuits.js`** — a **Pursuits tab** adjacent to Opportunities (mirrors the Pitches Pipeline/Library pattern): **kanban** (stage columns) + **table** toggle (parity with MVP #8), stage-advance controls, outcome fields on terminal stages, empty state that instructs (never auto-fills).
12. **"Create Pursuit"** action on the opportunity detail/brief → `POST /pursuits` → moves it onto the board (removed from triage counts on refresh).
13. Nav/route wiring; activity entries visible in the existing Activity feed.

## Gate 1 decisions for Williams
1. **Schema + stage model + mirror map** above — approve as the pipeline contract?
2. **409 guard** on direct `pursuitStatus` writes when a linked active pursuit exists — approve the behavior change (existing status endpoint keeps working for opps *without* a pursuit)?
3. **Rules + indexes** — `govPursuits` deny block + 2 composite indexes (the manual-approval-flagged part).
4. **Promotion idempotency** = one active pursuit per opportunity (re-promote returns the existing one). OK?

## Blast radius
- **New collection + service + 5 endpoints + 1 rules block + 2 indexes + 1 frontend page.** All behind `GOVCAPTURE_PURSUITS_ENABLED` (default off).
- Existing opportunity flows unchanged **except** the 409 guard (fires only when a linked active pursuit exists — otherwise byte-identical).
- Rules change is additive (a new deny block) — no existing rule modified; zero effect on live data until the flag + the collection are used.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Double-promote → two pursuits | Transaction-guarded single active pursuit; 2nd returns existing. |
| Mirror + status endpoint race | Pursuit transition is the only writer of mirrored statuses; direct writes 409 when a pursuit exists. |
| Rules regression (F-101 class) | Additive deny block only; emulator test asserts client denial; Williams reviews. |
| Board reads stale after promote | Promote returns the pursuit; frontend optimistic-updates + refreshes counts. |
| Frontend page is large/stateful | Model on the existing `synchgov*` page pattern; smoke-gate + review (no unit tests for vanilla JS — honest, matches C1). |

## Rollback
`GOVCAPTURE_PURSUITS_ENABLED=false` hides the endpoints/UI; the deny block + indexes are inert additions. Full revert = revert both PRs; no data migration (pursuits are new docs; `pursuitStatus` mirroring only writes values the field already supported).

## Build plan (after approval)
1. `git checkout main && git pull`; branch `feat/govcapture-c2-pursuits` in **both** repos.
2. Backend: schema + service (idempotent create, transition+mirror+activity, outcome) → endpoints → 409 guard → rules block → indexes → flag → tests. Full suite + emulator green.
3. Gate 2 (backend), STOP → PR → Williams.
4. Frontend: Pursuits page (kanban/table) + Create Pursuit action + nav; smoke green. Gate 2, STOP → PR → Williams.

## Merge routing
Product code + rules → **Williams**. Backend first, then frontend (§13). I do not merge.

---

**STOP — approval needed before building.** Please confirm the four Gate-1 decisions (schema/stage/mirror, the 409 guard, the rules+indexes, single-active-pursuit idempotency). Given the size, I'll build **backend first to its Gate 2 stop**, then the frontend as a second unit — so you get two reviewable PRs rather than one giant one.
