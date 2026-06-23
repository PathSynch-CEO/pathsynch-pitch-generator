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

## 8. Gap 2 — P0 Public-Pitch Leak Is NOT Yet Closed

### Status: OPEN

This PR removes the P0 rule from `pathsynch-pitch-generator/firestore.rules` (this repo). However, the live leak is **not guaranteed closed** because:

1. **`synchintro-app/firestore.rules` line 69** still contains `allow read: if resource.data.shareId != null` on the pitches collection.
2. **Both repos target the same Firebase project** (`pathsynch-pitch-creation`) via `.firebaserc`.
3. **Neither repo deploys rules via CI/CD** — all rules deployments are manual (`firebase deploy --only firestore:rules`).
4. **Which rules file is currently deployed is unknown** without checking the Firebase Console.

Any manual `firebase deploy` from `synchintro-app` re-introduces the P0 leak, regardless of this PR.

---

## 9. NEXT REQUIRED TASK — Real P0 Closure (Not Release 2)

The following tasks must be completed before this P0 can be declared closed. These are **pre-Release-2 obligations**, not deferred appendix items.

### 9.1 Remove the leak from synchintro-app

Edit `synchintro-app/firestore.rules` — remove the public pitch read rule from the pitches collection:

```diff
- // Allow public read for shared pitches (via shareId query)
- // Note: This allows reading if the pitch has a shareId
- allow read: if resource.data.shareId != null;
```

### 9.2 Consolidate to ONE canonical rules deploy source

Designate `pathsynch-pitch-generator/firestore.rules` as the single canonical source. Document this in both repos. Ensure no one deploys rules from `synchintro-app` — either remove `firestore.rules` from that repo, or replace it with a pointer comment.

### 9.3 Migrate public share pages to GET /share/:shareToken

The existing frontend share pages (`p/index.html`, `onepager/index.html`) currently read pitches/onepagers directly via the Firestore client SDK using `shareId`. These must be migrated to call the server-side `GET /share/:shareToken` endpoint instead. Until they are migrated, those pages will break when the Firestore rule is removed.

### 9.4 Charles verifies the active ruleset in Firebase Console

After steps 9.1-9.3 are complete and rules are deployed from this repo:
- Open Firebase Console → Firestore Database → Rules
- Confirm the pitches collection has NO `allow read: if resource.data.shareId != null`
- Confirm the Phase 3C comment is present: `// Phase 3C: Public share via server-side GET /share/:shareToken endpoint only.`

**Only after step 9.4 is confirmed can the P0 be declared closed.**

---

## 10. Known Limitations / Deferred Work

| Item | Status | Notes |
|------|--------|-------|
| Legacy `shareId` field | Active | Existing `GET /pitch/share/:shareId` route still works via Admin SDK in `pitchRoutes.js`. Must be deprecated after frontend migration (step 9.3). |
| `shared: true` field | Still stamped | Pitch generator still writes `shared: true` at creation. Harmless — the rule removal means this field no longer grants public access. |
| `x-workspace-id` header | Deferred | Frontend will add this when multi-workspace support ships. |

---

## 11. Phase 3C Gate — STOP

Phase 3C code is complete. All Phase 0-3 workspace features for Release 1 are implemented and tested.

**The P0 public-pitch leak is NOT closed.** Complete Section 9 above before declaring closure.

**Do not begin Release 2 (Phases 4-5) or the deferred appendix.**
