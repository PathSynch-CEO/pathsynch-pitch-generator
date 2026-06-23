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

### Share token mechanics

- **Generation**: `crypto.randomBytes(32).toString('hex')` = 64-character hex string
- **Storage**: `pitches/{pitchId}.sharing.shareToken` (Firestore, server-side write)
- **Revocation**: `pitches/{pitchId}.sharing.revokedAt` timestamp
- **Query**: `where('sharing.shareToken', '==', token).limit(1)` via Admin SDK

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

## 3. Two-Stage Offboarding (`workspaceOffboardingService.js`)

### Architecture

Three sequential stages tracked by `offboardingJobs/{jobId}`:

| Stage | Function | Firestore writes |
|-------|----------|------------------|
| 1 — Initiate | `initiateOffboarding()` | Atomic transaction: member → `offboarding`, create job doc |
| 2 — Batch | `processOffboardingBatch()` | Reassign `assigneeUid` on pitches/reports/briefs |
| 3 — Complete | `completeOffboarding()` | Member → `removed`, remove from `memberIds`, decrement count |

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

### Default successor

If `options.successorUid` is not provided, defaults to the workspace owner (`workspace.ownerId`).

### Offboarding endpoint

`POST /workspace/members/:uid/offboard` — Manager/Admin only (via `requireRole(req, 'manager')`).

Body: `{ successorUid? }` — optional; defaults to workspace owner.

Returns: `{ jobId, targetUid, pitchesReassigned, reportsReassigned }`

---

## 4. Emulator Proof Results

### Phase 3C Emulator Tests — 18/18 PASS

| Proof | Tests | What it proves |
|-------|-------|----------------|
| **1 — Unauthenticated read DENIED** | 3 | Direct doc read, shareId query, and shareToken query all DENIED for unauthenticated clients |
| **2 — Authenticated non-member DENIED** | 4 | Stranger cannot read shared pitch by doc ID or query; owner CAN still read own pitch |
| **3 — Server-side field projection** | 3 | Admin SDK query works; `projectPublicFields` strips 9 sensitive fields; brand sanitized |
| **4 — Revoked token** | 3 | Revoked pitch found in Firestore but `revokedAt` gate catches it; non-existent token = empty |
| **5 — Offboarding** | 5 | Last-owner guard, full 3-stage flow, already-removed guard, self-successor guard, audit log |

### Combined Emulator Results (all phases, one emulator session)

| Suite | Tests | Status |
|-------|-------|--------|
| Phase 1 | 16/16 | PASS |
| Phase 2 | 26/26 | PASS |
| Phase 3A | 30/30 | PASS |
| Phase 3B | 42/42 | PASS |
| Phase 3C | 18/18 | PASS |
| **Emulator total** | **132/132** | **PASS** |

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

## 8. Known Limitations / Deferred Work

| Item | Status | Notes |
|------|--------|-------|
| Legacy `shareId` field | Active | Existing `GET /pitch/share/:shareId` route still works via Admin SDK in `pitchRoutes.js`. Can be deprecated after frontend migration to `sharing.shareToken`. |
| `shared: true` field | Still stamped | Pitch generator still writes `shared: true` at creation. Harmless — the rule removal means this field no longer grants public access. |
| Offboarding batch > 100 items | Partial | `processOffboardingBatch` processes up to 100 pitches/reports per call. For workspaces with more, re-invoke until counts return 0. |
| Frontend share URL migration | Deferred | Frontend must update share URLs from `/#/shared/:shareId` to the new `GET /share/:shareToken` pattern. |
| `x-workspace-id` header | Deferred | Frontend will add this when multi-workspace support ships. |

---

## 9. Phase 3C Gate — STOP

Phase 3C is complete. All Phase 0-3 workspace features for Release 1 are implemented and tested:

- Phase 1: Data model + bootstrap + workspace-resolution guard
- Phase 2: Inheritance + branding version history
- Phase 3A: Invite binding + email
- Phase 3B: Roles + analytics + resolver hardening + deletion policy
- Phase 3C: Offboarding + P0 public-share cutover + server-side share endpoint

**Do not begin Release 2 (Phases 4-5) or the deferred appendix.**
