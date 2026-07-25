# Gate 2 Review — PR-C2 Backend: Pursuits Pipeline (SynchGov Capture)

**Branch:** `feat/govcapture-c2-pursuits` (off updated `main`, includes merged #52 C1).
**Spec:** `PRD-synchgov-capture-01-v2.2.md` §5.3, §13. **Gate 1:** `strategy-review-govcapture-c2.md` (4 decisions approved).
**Merge routing:** product code + **`firestore.rules` change → Williams** (manual-approval, F-101 class). I do not merge. Backend PR first; frontend is a separate paired PR (§13).

**STOP — this is the Gate 2 stop. Nothing deployed. No production reads/writes performed this session.**

---

## What shipped (backend only, all behind `GOVCAPTURE_PURSUITS_ENABLED`, default off)

| File | Change |
|---|---|
| `functions/services/govcapture/govPursuits.js` | **NEW** — stage vocabulary, mirror map, `isValidTransition`, validators. Pure/deterministic, no I/O. |
| `functions/services/govcapture/govPursuitService.js` | **NEW** — `createPursuit` (idempotent), `transitionStage` (mirror + activity), `updateOutcome`. |
| `functions/routes/govcaptureRoutes.js` | +5 endpoints, `pursuitsGate`, coded-error→HTTP mapper, **409 guard** on the existing `PUT /opportunities/:oppId/status`. |
| `firestore.rules` | +`match /govPursuits/{docId} { allow read, write: if false; }` (CF-only, consistent with the 7 existing gov* blocks). |
| `firestore.indexes.json` | +4 `govPursuits` composite indexes. |
| `functions/.env.example` | +`GOVCAPTURE_PURSUITS_ENABLED=false` with a scope comment. |
| `functions/tests/govPursuits.test.js` | **NEW** — 22 tests. |
| `functions/tests/govcaptureRoutes.test.js` | +`govPursuits` in the gov* deny-block assertion. |

No `index.js` change: pursuit routes live on the already-dispatched `govcaptureRoutes` router.

---

## The pipeline contract (Gate-1 decision #1)

**Stage model (§5.3):** `planning → drafting → compliance_check → ready_to_submit → submitted → awaiting_result → won | lost | no_bid`.
- Transitions: forward-only among non-terminal stages (skipping ahead allowed), plus **any non-terminal → any terminal** (a rep can mark `no_bid`/`lost` at any point). Terminal stages are final.
- `submitted` is user-attested — records `submittedAt` + optional `portalName`.

**`govPursuits/{pursuitId}` doc** (§13): `userId, workspaceId?, profileId, sourceOpportunityId, sourceProvider, title, buyerName, fitScoreAtPromotion, stage, stageHistory[]({stage,at,byUid}), outcome, awardValue?, lossReason?, proposalReadiness?, portalName?, submittedAt?, active, createdAt, updatedAt`.

**Mirror map → `govOpportunities.pursuitStatus`** (Gate-1 #1): `planning/drafting/compliance_check/ready_to_submit → pursuing` · `submitted/awaiting_result → bid_submitted` · terminals 1:1. Every produced value is already in `schemas.PURSUIT_STATUSES` — no new opportunity-status values.

## Idempotency (Gate-1 decision #4) — one active pursuit per opportunity

The **opportunity doc is the transaction guard**: `createPursuit` reads the opp inside `db.runTransaction` and checks its `activePursuitId` pointer. If the pointer references a live (`active:true`) pursuit, the same pursuit is returned (`created:false`, HTTP 200) — a concurrent double-promote cannot create two. A terminal transition clears the pointer (`activePursuitId:null`, `pursuitActive:false`), so an opportunity **can be re-pursued** after a `lost`/`no_bid`. This reuses the `samSyncService._acquireLock` transaction shape and needs no idempotency-query index. (Tested: idempotent re-promote returns the same id with a single doc; re-pursuit after `lost` creates a distinct second pursuit.)

## 409 guard (Gate-1 decision #2)

`PUT /opportunities/:oppId/status` now returns **409** (with the `pursuitId` pointer) when `pursuitActive === true` on the opp — the pursuit board owns the state. For opportunities **without** a pursuit, the endpoint is byte-identical to before. The guard is inert until the flag is on and a pursuit exists.

## Endpoints (all `featureGate` + `pursuitsGate` + `requireAuth`, owner-scoped)

| Method | Path | Purpose |
|---|---|---|
| POST | `/govcapture/opportunities/:oppId/promote` | Promote → pursuit (201 new / 200 existing). |
| GET | `/govcapture/pursuits` | Board list; `?stage=` / `?outcome=` / `?active=` filters. |
| GET | `/govcapture/pursuits/:pursuitId` | Single pursuit. |
| PUT | `/govcapture/pursuits/:pursuitId/stage` | Advance stage (409 on invalid transition). |
| PUT | `/govcapture/pursuits/:pursuitId/outcome` | Record terminal outcome. |

Coded service errors map to HTTP: `OPP_NOT_FOUND`/`PURSUIT_NOT_FOUND`→404, `FORBIDDEN`→403, `INVALID_TRANSITION`→409, else 500.

## Rules + indexes (Gate-1 decision #3 — Williams-reviewed)

- Rules: one **additive** deny block (`govPursuits`, CF-only). No existing rule touched.
- Indexes (4): `userId+updatedAt`, `userId+stage+updatedAt`, `userId+outcome+updatedAt`, `userId+active+updatedAt` — cover the bare board list plus each filter.

## Archival independence (§5-8)

`govPursuits` is queried independently of `govOpportunities.archived`; auto-archiving an opportunity never mutates or hides its pursuit. (Board reads `govPursuits` by `userId`, not through the opp.)

---

## Verification evidence

- **`node --check`**: all 3 new/edited JS files pass.
- **New suite**: `govPursuits.test.js` — **22/22 pass** (constants, validation, create idempotency + cross-tenant + re-pursuit, transition forward/skip/terminal/invalid/cross-tenant/not-found + mirror, outcome).
- **Full suite**: **1765 passed / 0 failed**, 65 suites (baseline after C1 was 1743 → +22).
- **Emulator suite** (`npm run test:emulator`, Temurin JDK 25 ≥21): **137/137 pass** — confirms the additive `firestore.rules` edit does not regress workspace tenancy/deny proofs.
- **Rules deny-block assertion** extended to include `govPursuits`; braces balanced (19/19 in `govcaptureRoutes.test.js`).
- **`git diff --name-only`** limited to: `firestore.indexes.json`, `firestore.rules`, `functions/.env.example`, `functions/routes/govcaptureRoutes.js`, `functions/tests/govcaptureRoutes.test.js` (+ 3 new files: `govPursuits.js`, `govPursuitService.js`, `govPursuits.test.js`). `.claude/settings.local.json` was already modified at session start (not part of this work).
- Indexes JSON re-parsed valid.

## Blast radius / rollback

Additive only; every path gated by `GOVCAPTURE_PURSUITS_ENABLED` (off). The rules deny block + indexes are inert until the flag + collection are used. Existing opportunity flows unchanged except the 409 guard (fires only when an active pursuit exists). Rollback = revert the PR; no data migration (`pursuitStatus` mirroring only writes values the field already supported).

## Owner reminders (not done by me)

1. Deploy carries the **`firestore.rules` + indexes** change — must be a **local** deploy (CI ships without `.env`); rules+indexes deploy is an owner action.
2. Set `GOVCAPTURE_PURSUITS_ENABLED=true` in `functions/.env` only when ready to expose the board (frontend PR pairs with this).
3. Merge routing: **Williams** (product code + rules). I do not merge.

**Awaiting your review. On approval I open the backend PR → Williams, then build the paired frontend (`synchgovPursuits.js`) to its own Gate 2.**
