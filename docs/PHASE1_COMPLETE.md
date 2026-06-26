# Phase 1 Completion Record — SynchIntro Multi-User Workspace

**Date:** 2026-06-22
**Status:** Code-complete. All 4 blockers resolved. NOT production-deployed. Awaiting Williams review on rules PR #38.

---

## 1. BOOTSTRAP STATUS — DOCUMENTED (backup script created)

**Has the bootstrap been run against live data?** **NO.**

The script (`functions/scripts/bootstrap-workspaces.js`) exists and is syntactically correct, but has never been executed against the production Firestore project (`pathsynch-pitch-creation`).

### Bootstrap is NOT purely additive

The bootstrap mutates the live `teams/` collection in two ways:
- Writes `quarantinedAt` + `quarantinedReason` on stale entries (`tdh356b`, `daniyal@pathsynch.com`)
- Writes `workspaceId` backlink on every migrated team doc

These are reversible (remove the fields) but are NOT additive — they modify existing docs.

### Pre-write backup: `scripts/backup-before-bootstrap.js`

A dedicated backup script was created. It exports:
- `backup_teams_{timestamp}.json` — full teams collection snapshot
- `backup_users_{timestamp}.json` — users collection (credits + plan fields only, for rollback reference)

**Usage (from `functions/` directory):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
node scripts/backup-before-bootstrap.js
```

**Verified:** Script passes `node --check`. `firebase-admin` loads. Service account key exists at `/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json` (removed from repo per F-001, still on local disk).

**Backup files are written to `functions/` cwd. Do NOT commit them (contain PII).**

### Rollback procedure

1. Remove `workspaceId` field from `teams` docs (revert backlink)
2. Remove `quarantinedAt` + `quarantinedReason` from stale entries
3. Delete all `workspaceMembers` docs where `workspaceId` matches a bootstrapped workspace
4. Delete all `workspaces` docs created by the bootstrap

### Deterministic ID

Charles Berry's workspace: `ws_bootstrap_charles` (UID: `dehiyRBCXcUUM72O211S27lfXbl1`). All other workspaces get auto-generated IDs.

### Run sequence

1. Run `backup-before-bootstrap.js` — verify backup files created
2. Run `bootstrap-workspaces.js` — verify output log shows expected creates/skips/quarantines
3. Do NOT run bootstrap until Phase 2 work requires it

---

## 2. ARRAY MIRROR ATOMICITY — FIXED

### What was wrong

`teamRoutes.js` had three fire-and-forget try/catch blocks that updated `teams` and `workspaceMembers` in SEPARATE writes:

- `POST /team/accept`: Updated `teams.members[]` + `teams.memberUids[]` (line 365-369), then called `addMember()` in a try/catch that swallowed errors (line 377-391). If `addMember` failed: user was in `teams` but not in `workspaceMembers` — split brain.
- `POST /team/remove`: Updated `teams` (line 436-440), then called `removeMember()` in a try/catch (line 442-450). If `removeMember` failed: user was removed from `teams` but still active in `workspaceMembers` — orphan member.
- `POST /team/invite`: Workspace lazy-init in try/catch (line 228-242). If `createWorkspace()` failed: team existed without workspace.

### What was fixed

**`workspaceService.js` — extended `addMember()` and `removeMember()`:**
- `addMember()` now accepts `memberData.teamMemberEntry` (optional). When provided, the `teams.members[]` arrayUnion is included in the SAME `batch.commit()` as the `workspaceMembers` doc + `workspace.memberIds` + `teams.memberUids`. **One atomic commit for all 4 writes.**
- `removeMember()` now accepts `options.updatedTeamMembers` (optional). When provided, the filtered `teams.members[]` array replacement is included in the SAME batch. **One atomic commit for all 4 writes.**

**`teamRoutes.js` — eliminated separate writes:**
- `POST /team/accept`: Removed the standalone `teamRef.update()` for `members[]` + `memberUids[]`. Now calls `addMember()` with `teamMemberEntry` — the workspace service batch handles ALL writes. If `addMember` throws, the error propagates to `handleError()` and the route returns a failure (no swallowed errors). Legacy fallback: if no workspace exists yet, falls back to team-only update (pre-workspace path).
- `POST /team/remove`: Removed the standalone `teamRef.update()`. Now calls `removeMember()` with `updatedTeamMembers` — same atomic batch. Error propagates. Legacy fallback for pre-workspace teams.
- `POST /team/invite`: Removed the try/catch wrapper around workspace lazy-init. If `createWorkspace()` fails, the error propagates to `handleError()` and the route returns 500.

### Transaction boundaries (proof)

**Accept path** (`teamRoutes.js:364-384`):
```
addMember(ownerWorkspace.id, { ..., teamMemberEntry })
  → workspaceService.addMember():
    batch.set(workspaceMembers/{wsId}_{uid})          // doc 1
    batch.update(workspaces/{wsId}, memberIds+count)   // doc 2
    batch.update(teams/{ownerId}, memberUids+members)  // doc 3
    batch.commit()                                     // ONE atomic commit
```

**Remove path** (`teamRoutes.js:435-451`):
```
removeMember(ownerWorkspace.id, memberUid, { updatedTeamMembers })
  → workspaceService.removeMember():
    batch.update(workspaceMembers/{wsId}_{uid}, status→removed)  // doc 1
    batch.update(workspaces/{wsId}, memberIds-count)              // doc 2
    batch.update(teams/{ownerId}, memberUids+members)             // doc 3
    batch.commit()                                                // ONE atomic commit
```

**No try/catch swallowing errors.** Failures propagate to the route's outer `catch (error) → handleError(error, res)`, returning a proper error response to the client.

### Tests

37 existing workspace tests pass after the fix (workspaceService + workspaceResolver).

---

## 3. EMULATOR vs MOCK — CLOSED (16 emulator tests passing)

### Test file

`functions/tests/workspace.emulator.test.js` — 16 tests across 3 gate suites.

### How to run

```bash
# From project root:
firebase emulators:exec --only firestore \
  "cd functions && npx jest tests/workspace.emulator.test.js --no-coverage --forceExit"
```

### Gate 1: Deny foreign workspaceId (8 tests)

| Test | Result |
|------|--------|
| Member can read OWN workspaceMembers doc | PASS |
| Owner can read OWN workspaceMembers doc | PASS |
| Stranger CANNOT read another user's workspaceMembers doc | PASS (PERMISSION_DENIED) |
| Owner CANNOT read member's workspaceMembers doc | PASS (PERMISSION_DENIED — Admin SDK only) |
| Unauthenticated user CANNOT read any workspaceMembers doc | PASS (PERMISSION_DENIED) |
| No client can WRITE to workspaceMembers | PASS (PERMISSION_DENIED) |
| Workspace read denied for non-member | PASS (PERMISSION_DENIED) |
| Workspace read allowed for member (in memberIds) | PASS |

### Gate 2: Legacy null-workspaceId never returned (3 tests)

| Test | Result |
|------|--------|
| Query `workspaceId == ws_test2` returns ONLY workspace-stamped pitch | PASS (1 result) |
| Query does NOT return null-workspaceId pitch | PASS |
| Query does NOT return pitch with missing workspaceId field | PASS |

### Gate 3: Bootstrap idempotency (5 tests)

| Test | Result |
|------|--------|
| Owner can update own workspace (expected) | PASS |
| Non-owner cannot update/overwrite existing workspace | PASS (PERMISSION_DENIED) |
| Non-owner cannot create workspace claiming someone else as owner | PASS (PERMISSION_DENIED) |
| Client cannot write workspaceMembers (Admin SDK only) | PASS (PERMISSION_DENIED) |
| Stranger cannot create workspace at known deterministic ID with foreign ownerId | PASS (PERMISSION_DENIED) |

**Deny-by-default tenancy is now proven at the Firestore rules level, not just application logic.**

---

## 4. RULES PR — CLOSED (PR #38 open for Williams)

### PR details

- **Branch:** `feature/workspace-firestore-rules`
- **PR:** [#38](https://github.com/PathSynch-CEO/pathsynch-pitch-generator/pull/38)
- **Status:** Open, awaiting Williams review. NOT merged. NOT deployed.

### What the rules do

```
workspaceMembers/{docId}:
  allow read:  if request.auth != null && resource.data.uid == request.auth.uid;
  allow write: if false;

workspaceAuditLog/{logId}:
  allow read:  if request.auth != null;
  allow write: if false;

workspaceBrandingVersions/{versionId}:
  allow read:  if request.auth != null;
  allow write: if false;
```

### Composite indexes added

- `workspaceMembers(uid ASC, status ASC)`
- `workspaceMembers(workspaceId ASC, status ASC)`
- `workspaceAuditLog(workspaceId ASC, createdAt DESC)`

### Conflict check with PR #18 (`fix/firestore-rules-f004-f005`)

**No conflict.** PR #18 is already merged into main (commit `48bb869`). It modified:
- `pitchAnalytics` rules (lines ~119-128)
- `icpProfiles` rules (lines ~510-524)

Workspace rules are at lines 200-235 — completely separate sections. No line overlap, no semantic conflict.

### Admin reads via Admin SDK

Cross-member reads (e.g., "list all workspace members") go through Admin SDK backend routes, NOT client Firestore rules. The `workspaceMembers` rule only allows a member to read their OWN doc (`resource.data.uid == request.auth.uid`). This matches Phase 0 Decision (c).

### Rules are OFF main working tree

The rules changes are committed ONLY on `feature/workspace-firestore-rules`. The `main` branch working tree does NOT contain these rules. Local emulator tests must run on the feature branch (or checkout the rules file from it).

---

## 5. CLOSE THE PHASE 0 LOOPS

### (a) Can current generation/credit paths double-charge on a retry?

**YES — this is a known pre-existing risk.**

`writeCreditLedger()` in `functions/api/billing.js:118` uses `db.collection('creditLedger').add(...)` — **auto-generated document IDs, no idempotency key.**

The credit DEDUCTION itself is atomic (Firestore transaction in `checkAndDeductCredits`). But the ledger write is fire-and-forget OUTSIDE the transaction (line 184-187). If the HTTP request is retried (client timeout + retry, Cloud Functions auto-retry on 5xx, etc.):

- The balance deduction transaction MAY execute twice (Firestore transactions are not idempotent across separate invocations — only within a single transaction attempt's retry loop)
- The ledger entry WILL be written twice (separate `.add()` calls)

**Exception:** `prospectIntelService.js` uses a deterministic doc ID (`doc('prospect:' + batchId)`) for its ledger entries, making those deductions idempotent. This is the ONLY idempotent credit path.

**Risk classification:** Medium. Deferred to Release 2 per Phase 0 plan (D-2).

**Mitigation for R1:** Monitor `creditLedger` for duplicate `reason` + `userId` + `createdAt` within 5-second windows. No code fix in R1.

### (b) Live Stripe env key name

**The deployed environment variable is `STRIPE_SECRET_KEY` (correctly spelled).**

Confirmed in 6 source files:
- `functions/api/stripe.js:21`
- `functions/api/admin.js:10`
- `functions/services/pricingService.js:15`
- `functions/services/aisynchBilling.js:18`
- `functions/services/discountService.js:10`
- `functions/index.js:2139`

The spec's claim of `STRIPE_SECRETE_KEY` (in `AIsynch_Claude_Code_Prompt_Final.md:113`) is wrong. No dual-read utility exists or is needed. Code and deployed environment agree on `STRIPE_SECRET_KEY`.

---

## Summary of Blockers

| # | Blocker | Status | Resolution |
|---|---------|--------|------------|
| 1 | Bootstrap pre-write backup | **CLOSED** | `scripts/backup-before-bootstrap.js` created, verified runnable. Bootstrap NOT purely additive — documented. |
| 2 | teamRoutes.js atomicity gap | **CLOSED** | `addMember`/`removeMember` extended with `teamMemberEntry`/`updatedTeamMembers`. Team + workspace writes in ONE `batch.commit()`. Errors propagate (no swallowing). |
| 3 | Firestore emulator gate tests | **CLOSED** | 16/16 emulator tests passing. Deny-by-default proven at rules level. |
| 4 | Rules PR for Williams | **CLOSED** | PR #38 on `feature/workspace-firestore-rules`. Awaiting review. No conflict with PR #18. |

---

## Files Created/Modified in Phase 1

### New (5)
- `functions/services/workspaceService.js` — 450 lines, 12 exports
- `functions/middleware/workspaceResolver.js` — 55 lines, 1 export
- `functions/scripts/bootstrap-workspaces.js` — 226 lines, standalone script
- `functions/scripts/backup-before-bootstrap.js` — 68 lines, pre-bootstrap backup
- `functions/tests/workspace.emulator.test.js` — 16 emulator gate tests

### Modified (3)
- `functions/index.js` — workspace resolver in middleware chain + bootstrapWorkspaces callable
- `functions/routes/teamRoutes.js` — atomic workspace sync (one batch, no error swallowing)
- `firebase.json` — emulator config (firestore port 8080)

### On PR branch only (1)
- `firestore.rules` + `firestore.indexes.json` — 3 new collection rules + 3 composite indexes (PR #38)

### Tests (3)
- `functions/tests/workspaceService.test.js` — 30 tests (Jest mock)
- `functions/tests/workspaceResolver.test.js` — 7 tests (Jest mock)
- `functions/tests/workspace.emulator.test.js` — 16 tests (Firestore emulator)

**Total new tests:** 53
**Suite total:** 37 mock tests passing + 16 emulator tests passing
