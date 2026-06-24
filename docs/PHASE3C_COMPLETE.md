# Phase 3C Completion Record — Offboarding, Public-Share Cutover, Share-Token Endpoint

> Completed June 23, 2026.

---

## 1. P0 Public-Pitch Firestore Rules Cutover

### What changed

**Removed** from `firestore.rules` (was lines 59-61):
```
// Public shared pitches (no auth required for viewing)
allow read: if resource.data.shared == true ||
              (resource.data.sharing != null && resource.data.sharing.public == true);
```

This rule granted **unauthenticated, direct client-side Firestore reads** to the entire `/pitches/{pitchId}` document whenever `shared == true`. Since `shared: true` was stamped on every pitch at creation, this made ALL pitches world-readable via the client SDK.

**Replaced with** a comment noting the server-side endpoint:
```
// Phase 3C: Public share via server-side GET /share/:shareToken endpoint only.
// Direct unauthenticated Firestore reads removed (P0 security cutover).
```

### Remaining pitch read rules (unchanged)

| Rule | Condition |
|------|-----------|
| Authenticated owner read | `isAuthenticated() && resource.data.userId == request.auth.uid` |
| Admin read | `isAuthenticated() && isAdmin()` |
| Create | `isAuthenticated() && request.resource.data.userId == request.auth.uid` |
| Update | Owner OR analytics-only fields |
| Delete | Owner only |

---

## 2. Server-Side Share-Token Endpoint (`shareRoutes.js`)

### New endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET /share/:shareToken` | None (public) | Server-side field projection |
| `POST /pitches/:pitchId/share` | Required | Generate crypto share token |
| `POST /pitches/:pitchId/revoke` | Required | Revoke active share token |

### Share token mechanics (SHA-256 hash-only storage — Gap 1 fix)

- **Generation**: `crypto.randomBytes(32).toString('hex')` = 64-character hex string
- **Hashing**: `crypto.createHash('sha256').update(plainToken).digest('hex')` before storage
- **Storage**: `pitches/{pitchId}.sharing.shareTokenHash` — SHA-256 hash only, plaintext NEVER persisted
- **Lookup**: Hash presented token, then `where('sharing.shareTokenHash', '==', hash).limit(1)` via Admin SDK
- **Revocation**: `pitches/{pitchId}.sharing.revokedAt` timestamp
- **"Already shared" case**: Returns `{ alreadyShared: true }` — plaintext cannot be recovered from hash

### Field projection (allowlist)

Public response includes ONLY:

| Field | Type |
|-------|------|
| `id` | Pitch document ID |
| `businessName` | string |
| `contactName` | string |
| `industry` | string |
| `subIndustry` | string |
| `address` | string |
| `websiteUrl` | string |
| `googleRating` | number |
| `numReviews` | number |
| `pitchLevel` | number |
| `style` | string |
| `html` | string (the rendered pitch content) |
| `roiData` | object |
| `reviewAnalysis` | object |
| `reviewAnalytics` | object |
| `reviewPitchMetrics` | object |
| `status` | string |
| `linkedInPosts` | array |
| `visuals` | object |
| `createdAt` | timestamp |
| `updatedAt` | timestamp |
| `brand` | Sanitized: `companyName`, `agencyName`, `logoUrl`, `accentColor`, `secondaryColor`, `footerText` only |
| `analytics` | `views` + `uniqueViewers` only |

**Stripped fields** (never in public response):
- `userId`, `workspaceId`, `createdByUid`, `createdByDisplayName`
- `formData`, `salesLibrary`, `pitchMetadata`, `triggerEvent`, `precallFormData`
- `resolvedBrand` (full — replaced by sanitized `brand`)
- `sharing` (internal token data)
- `assigneeUid`, `formerMemberAt`, `brandingVersionId`

### Workspace access checks on share/revoke

Both `POST /pitches/:pitchId/share` and `POST /pitches/:pitchId/revoke` enforce:
- Workspace mode: `pitchData.workspaceId === req.workspaceId` + `canAccessResource(req, createdByUid)`
- Solo mode: `pitchData.userId === req.userId`

---

## 3. Batch-Safe Offboarding (`workspaceOffboardingService.js`) — Gap 3 fix

### Architecture

Three sequential stages tracked by `offboardingJobs/{jobId}`:

| Stage | Function | Firestore writes |
|-------|----------|------------------|
| 1 — Initiate | `initiateOffboarding()` | Atomic transaction: member → `offboarding`, create job doc |
| 2 — Batch | `processOffboardingBatch()` | Reassign `assigneeUid` on up to `OFFBOARDING_BATCH_SIZE` (100) pitches/reports/briefs per invocation. Persists remaining counts. |
| 3 — Complete | `completeOffboarding()` | **REFUSES** unless all asset cursors are independently verified exhausted. Then: member → `removed`, remove from `memberIds`, decrement count |

### Batch exhaustion guard (Gap 3 — critical)

`completeOffboarding()` does NOT trust job counters. It independently queries live Firestore data for EVERY collection (`pitches`, `marketReports`, `opportunityBriefs`), filters to docs where `assigneeUid !== successorUid`, and **throws** if any remain:

```
Cannot complete offboarding: N {collectionName} remain unprocessed
```

The endpoint (`POST /workspace/members/:uid/offboard`) loops `processOffboardingBatch()` up to 50 times (safety limit). If not exhausted after 50 batches, returns 202 with `status: 'processing'` — member stays `offboarding`, progress is persisted, re-invoke to continue.

### Immutable attribution invariant

**NEVER modified during offboarding:**
- `createdByUid` — immutable, tracks who originally created the asset
- `createdByDisplayName` — immutable, frozen at creation time

**Modified during offboarding:**
- `assigneeUid` — set to successor UID (operational ownership transfer)
- `formerMemberAt` — timestamp marking when the asset was reassigned

### Guards

| Guard | Error |
|-------|-------|
| Target is workspace owner | `Cannot offboard the workspace owner` |
| Target not active | `Target member is not active in this workspace` |
| Successor is the target | `Successor cannot be the member being offboarded` |
| Successor not active | `Successor is not an active workspace member` |
| Concurrent modification | `Member is no longer active (concurrent modification)` |

### Crash/resume behavior

| Crash point | State left behind | Recovery |
|-------------|-------------------|----------|
| After Stage 1, before Stage 2 | Member `status: offboarding` (resolver blocks access), job `status: processing` | Re-call `processOffboardingBatch(jobId)` then `completeOffboarding(jobId)` |
| After Stage 2, before Stage 3 | Assets reassigned, member still `offboarding`, job `status: processing` | Re-call `completeOffboarding(jobId)` — batch is idempotent (re-assigning already-assigned docs is a no-op) |
| During Stage 2 batch | Partial reassignment. `assigneeUid` set on some docs but not all. | Re-call `processOffboardingBatch(jobId)` — processes next batch of unreassigned docs. Repeat until `pitchesReassigned == 0 && reportsReassigned == 0`, then call `completeOffboarding(jobId)`. |

The key invariant: once Stage 1 commits, the member's status is `offboarding`, which means the workspace resolver will NOT resolve them as an active member. Access is revoked immediately, even if Stages 2-3 fail.

### Default successor

If `options.successorUid` is not provided, defaults to the workspace owner (`workspace.ownerId`).

### Offboarding endpoint

`POST /workspace/members/:uid/offboard` — Manager/Admin only (via `requireRole(req, 'manager')`).

Body: `{ successorUid? }` — optional; defaults to workspace owner.

Returns: `{ jobId, targetUid, pitchesReassigned, reportsReassigned }`

---

## 4. Emulator Proof Results

### Phase 3C Emulator Tests — 23/23 PASS

| Proof | Tests | What it proves |
|-------|-------|----------------|
| **1 — Unauthenticated read DENIED** | 3 | Direct doc read, shareId query, and shareTokenHash query all DENIED for unauthenticated clients |
| **2 — Authenticated non-member DENIED** | 4 | Stranger cannot read shared pitch by doc ID or query; owner CAN still read own pitch |
| **3 — Server-side field projection (SHA-256)** | 3 | Admin SDK query by `sharing.shareTokenHash` works; `projectPublicFields` strips 9 sensitive fields; brand sanitized |
| **4 — Revoked token** | 3 | Revoked pitch found by hash but `revokedAt` gate catches it; non-existent token = empty |
| **5 — Offboarding basic flow** | 5 | Last-owner guard, full 3-stage flow, already-removed guard, self-successor guard, audit log |
| **6 — Batch exhaustion (150 pitches)** | 4 | Batch 1: 100 processed, completion REFUSED (50 remain). Batch 2: 50 processed, member REMOVED. Audit once. Idempotent re-run. |
| **7 — Crash recovery** | 1 | After batch 1 crash, re-invoke resumes. All 150 reassigned. Zero duplicates. Cumulative count = 150. |

### Full Mock Suite

| Suite | Tests | Status |
|-------|-------|--------|
| All non-emulator tests | 1,689/1,689 | PASS — zero regressions |

---

## 5. Changed Files

| File | Action | Purpose |
|------|--------|---------|
| `firestore.rules` | Modified | Removed P0 `shared == true` public read rule (lines 59-61) |
| `functions/routes/shareRoutes.js` | **New** | Server-side share-token endpoint with field projection |
| `functions/services/workspaceOffboardingService.js` | **New** | Three-stage offboarding: initiate, batch reassign, complete |
| `functions/routes/workspaceRoutes.js` | Modified | Added `POST /workspace/members/:uid/offboard` endpoint |
| `functions/index.js` | Modified | Registered `shareRoutes` import + dispatch |
| `functions/tests/workspacePhase3C.emulator.test.js` | **New** | 18 emulator tests (4 mandatory denial/projection + offboarding) |

---

## 6. Emulator Commands

```bash
# Start emulator
npx firebase emulators:start --only firestore

# Run Phase 3C
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3C.emulator.test.js --no-coverage --forceExit

# Run all phases
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspace.emulator.test.js tests/workspacePhase2.emulator.test.js tests/workspacePhase3A.emulator.test.js tests/workspacePhase3B.emulator.test.js tests/workspacePhase3C.emulator.test.js --no-coverage --forceExit
```

---

## 7. PR Routing

The `firestore.rules` change in this phase **MUST** be reviewed by Williams before merge. This is the P0 security cutover — the same PR that adds the `shareRoutes.js` endpoint must also remove the unauthenticated read rule. They cannot be deployed independently.

---

## 8. Canonical Firestore Rules Source — SINGLE REPO RULE

### Root cause of Gap 2

Two repos (`pathsynch-pitch-generator` and `synchintro-app`) both contain a `firestore.rules` file, both have `.firebaserc` pointing to the same Firebase project (`pathsynch-pitch-creation`), and both can deploy rules via `firebase deploy --only firestore:rules`. There is no CI/CD deploying rules — all deployments are manual. Whoever runs `firebase deploy` last wins, and the other repo's rules are silently overwritten.

### Resolution: `pathsynch-pitch-generator/firestore.rules` is the SINGLE canonical source

Effective immediately:

1. **`pathsynch-pitch-generator/firestore.rules`** is the only file that may be deployed to Firebase.
2. **`synchintro-app/firestore.rules`** must NEVER be deployed. It exists only as a local reference. Any `firebase deploy` from the frontend repo that includes `firestore:rules` will overwrite the canonical rules and may re-introduce the P0 leak.
3. All future Firestore rule changes — regardless of whether they affect frontend or backend collections — must be made in `pathsynch-pitch-generator/firestore.rules` and deployed from that repo.
4. The frontend repo's copy should eventually be deleted or replaced with a comment-only file pointing to the backend repo.

---

## 9. NEXT REQUIRED TASK — Real P0 Closure (Not Release 2)

The following tasks must be completed before this P0 can be declared closed. These are **pre-Release-2 obligations**, not deferred appendix items.

### 9.1 Remove the leak from synchintro-app — DONE (committed, NOT deployed)

**Commit:** `86280f5` on branch `fix/remove-public-pitch-rule-p0` in `synchintro-app`.

Replaced `allow read: if resource.data.shareId != null` with a Phase 3C comment directing to this document. This commit must NOT be deployed independently — see constraint below.

### 9.1 + 9.3 MUST DEPLOY TOGETHER — critical sequencing constraint

The frontend share pages (`p/index.html`, `onepager/index.html`) currently perform **unauthenticated direct Firestore reads** using `shareId` via the client SDK. The `allow read: if resource.data.shareId != null` rule is what makes those reads succeed.

**If 9.1 deploys without 9.3:** every live `/p/{id}` share link immediately breaks (Firestore denies the unauthenticated read). Shared pitches become inaccessible to recipients.

**If 9.3 deploys without 9.1:** the old rule stays live but the pages call the new endpoint. This is safe but leaves the P0 leak open.

**Correct sequence:**
1. Complete 9.3 (migrate `p/index.html` and `onepager/index.html` to call `GET /share/:shareToken` instead of direct Firestore reads)
2. Test that migrated pages work with the new endpoint
3. Deploy functions (backend PR #39 — `GET /share/:shareToken` endpoint)
4. Deploy rules from `pathsynch-pitch-generator` (the canonical source, which already has the rule removed)
5. Steps 3 + 4 must happen in the same deploy session — the endpoint must be live before the rule is removed
6. Do NOT deploy rules from `synchintro-app` at any point

### 9.2 Consolidate to ONE canonical rules deploy source

See Section 8 above. `pathsynch-pitch-generator/firestore.rules` is canonical. The frontend repo must stop deploying rules. Document this in both repos' README or CLAUDE.md.

### 9.3 Migrate p/index.html to server-side endpoints — DONE (committed, NOT deployed)

**Commit:** on branch `fix/remove-public-pitch-rule-p0` in `synchintro-app`.

`p/index.html` has been rewritten to remove all Firebase client SDK usage. The new flow:

1. Try `GET /api/v1/share/:token` (Phase 3C endpoint — SHA-256 lookup, field-projected response)
2. On 404, fall back to `GET /api/v1/pitch/share/:token` (legacy Admin SDK route — full document)
3. Both endpoints track views server-side

**What was removed:**
- Firebase SDK imports (`firebase-app-compat.js`, `firebase-firestore-compat.js`)
- `firebase.initializeApp()` and `firebase.firestore()` calls
- Direct `db.collection('pitches').doc(pitchId).get()` read
- Direct `db.collection('pitches').where('shareId', '==', pitchId)` query
- Client-side `analytics.views` increment (now handled server-side by both endpoints)

**What was kept:**
- `ViewTracker.init(pitch.id)` — enhanced analytics (no Firebase dependency, calls backend API)
- Landing page handler — was already server-side, unchanged
- All responsive CSS/iframe logic — unchanged

**Backward compatibility (option b):** Old links containing a `shareId` hit the new endpoint first (404, since no `shareTokenHash` exists), then successfully resolve via the legacy `GET /pitch/share/:shareId` route. Old links continue working indefinitely.

**Full-doc exposure on legacy path:** The legacy `GET /pitch/share/:shareId` returns the FULL pitch document (no field projection). The P0 Firestore-rules leak is closed (unauthenticated client SDK reads denied), but legacy links served via the Admin SDK route still expose the complete document. This persists until all existing share links are migrated to crypto tokens and the legacy route is retired. **This is a tracked follow-up, not a closed item.**

### 9.3a OPEN — Onepagers have the SAME P0-equivalent leak

**Severity: P0-equivalent. Status: OPEN. No server endpoint exists.**

During 9.3 investigation, the `onepagers` collection was found to have the identical leak:

- **Both repos** (`pathsynch-pitch-generator/firestore.rules` line 258, `synchintro-app/firestore.rules` line 215) have `allow read: if resource.data.shareId != null` on the `onepagers` collection
- `onepager/index.html` performs unauthenticated direct Firestore reads using the client SDK — same pattern as the original pitch P0
- **No server-side share endpoint exists for onepagers** — there is no equivalent of `GET /share/:shareToken` for the `onepagers` collection
- The `onepagers` `shareId != null` rule **must stay live** — removing it without a server endpoint breaks all live onepager share links

**Required to close this item:**
1. Build a server-side onepager share endpoint (with field projection, analogous to `shareRoutes.js`)
2. Migrate `onepager/index.html` from Firestore client SDK reads to the new endpoint
3. Remove `allow read: if resource.data.shareId != null` from `onepagers` rules in **both repos**
4. Deploy endpoint + rules together (same coupling constraint as pitches)

**This was not descoped — it was discovered during 9.3 and is documented at its actual severity.**

### 9.4 Charles verifies the active ruleset in Firebase Console

After steps 9.1-9.3 are deployed together from the backend repo:
- Open Firebase Console → Firestore Database → Rules
- Confirm the pitches collection has NO `allow read: if resource.data.shareId != null`
- Confirm the Phase 3C comment is present: `// Phase 3C: Public share via server-side GET /share/:shareToken endpoint only.`
- **Note:** The `onepagers` collection `shareId != null` rule will still be present — this is intentional (see 9.3a)

**Only after step 9.4 is confirmed can the PITCH P0 be declared closed. The onepager P0-equivalent (9.3a) remains open.**

---

## 10. CI Failure Diagnosis — Emulator Test Exclusion

### Problem

PR #39 CI run (`28048846356`) failed with exit code 1. The `Test & Audit` job reported 137 test failures across 5 suites — all emulator test files:

- `workspace.emulator.test.js`
- `workspacePhase2.emulator.test.js`
- `workspacePhase3A.emulator.test.js`
- `workspacePhase3B.emulator.test.js`
- `workspacePhase3C.emulator.test.js`

**Root cause:** `connect ECONNREFUSED 127.0.0.1:8080`. CI runs `npm test` (→ `jest`) which picks up all `*.emulator.test.js` files. These files call `initializeTestEnvironment()` from `@firebase/rules-unit-testing`, which connects to a Firestore emulator at `127.0.0.1:8080`. No emulator runs in CI — there is no `firebase emulators:exec` step, no Java runtime, and no Firebase CLI installed in the GitHub Actions workflow.

All 59 non-emulator suites (1,689 mock tests) passed. **Zero real regressions.**

### Fix chosen: Exclude emulator suites from default `jest` run

**Option (a) — Wire emulator into CI** was rejected: requires Java runtime installation, Firebase CLI installation, and `firebase emulators:exec` wrapper — adds ~3 minutes to CI and significant complexity. Emulator tests are integration/gate tests designed for local pre-PR verification, not CI regression testing.

**Option (b) — Exclude via `testPathIgnorePatterns`** was chosen:

```javascript
// functions/jest.config.js
testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '\\.emulator\\.test\\.js$'    // ← added
],
```

This means `npm test` (CI) skips emulator suites. They remain runnable via explicit path:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3C.emulator.test.js --no-coverage --forceExit
```

### Emulator test protocol (local only)

Emulator tests MUST be run locally before submitting any PR that touches:
- `firestore.rules`
- Workspace service files (`workspaceService.js`, `workspaceOffboardingService.js`, etc.)
- Share routes (`shareRoutes.js`)

Commands documented in Section 6 above.

---

## 11. Known Limitations / Deferred Work

| Item | Status | Severity | Notes |
|------|--------|----------|-------|
| **Onepagers `shareId != null` leak** | **OPEN** | **P0-equivalent** | See 9.3a. Unauthenticated full-doc read on `onepagers` collection via both repos' rules. No server endpoint exists. Must NOT remove rule until endpoint is built + `onepager/index.html` migrated. |
| Legacy pitch `shareId` route | Active | P2 | `GET /pitch/share/:shareId` returns full doc via Admin SDK. Serves old links. Must be deprecated after all links migrate to crypto tokens. |
| `shared: true` field | Still stamped | None | Pitch generator still writes `shared: true` at creation. Harmless — the rule removal means this field no longer grants public access. |
| `x-workspace-id` header | Deferred | None | Frontend will add this when multi-workspace support ships. |

---

## 12. Phase 3C Gate — STOP

Phase 3C code is complete. All Phase 0-3 workspace features for Release 1 are implemented and tested.

**Two P0-level leaks remain:**

1. **Pitches P0** — code complete (9.1 + 9.3 done), awaiting coordinated deploy (9.1 + 9.3 + backend functions + rules, then 9.4 manual verification). Legacy `shareId` links will work via Admin SDK fallback but serve full documents until the legacy route is retired.

2. **Onepagers P0-equivalent** (9.3a) — **no server endpoint exists.** The `onepagers` `shareId != null` rule is live in both repos. This is a full unauthenticated read leak identical in severity to the original pitch P0. Closing this requires building a server-side onepager share endpoint, migrating `onepager/index.html`, and removing the rule.

**Do not begin Release 2 (Phases 4-5) or the deferred appendix.**
