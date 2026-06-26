# Phase 3B Completion Record — Roles, Analytics, Resolver Hardening

> Completed June 23, 2026. Includes post-gate hardening items (resolver fail-closed, brief write scoping, deletion policy).

---

## 1. Resolver Contract — Hardened (workspaceResolver.js rewrite)

### Cross-Cutting Invariant

**Active workspace membership means workspace authorization is MANDATORY, never optional.**

Solo fallback (`req.workspaceId = null`) is permitted ONLY for users with zero active workspace memberships. An active workspace member can never reach the legacy `userId`-only authorization path on any workspace-capable endpoint.

### Resolver Contract Table (9 conditions)

| # | Condition | Behavior | HTTP | Error Code |
|---|-----------|----------|------|------------|
| 1 | Single active membership + no `x-workspace-id` header | Auto-assign that workspace | — | — |
| 2 | Multiple active memberships + no `x-workspace-id` header | **Reject** | 400 | `WORKSPACE_AMBIGUOUS` |
| 3 | `x-workspace-id` header matches an active membership | Resolve that workspace | — | — |
| 4 | `x-workspace-id` header does NOT match any active membership | **Reject** | 403 | `WORKSPACE_MEMBERSHIP_REQUIRED` |
| 5 | `x-workspace-id` header on user with zero active memberships | **Reject** | 403 | `WORKSPACE_NOT_FOUND` |
| 6 | Blank/whitespace `x-workspace-id` header | Trimmed to null — treated as absent (falls to condition 1 or 2) | — | — |
| 7 | Firestore error during workspace enumeration | **Reject** (fail-closed) | 500 | `WORKSPACE_RESOLUTION_FAILED` |
| 8 | Workspace found in enumeration but `workspaceMembers` doc missing or not `status: 'active'` | **Reject** (fail-closed — inconsistent mirror data) | 500 | `WORKSPACE_MEMBERSHIP_INCONSISTENT` |
| 9 | Zero active memberships + no header | Solo fallback — `req.workspaceId = null`, `req.entitlementOwnerUid = req.userId` | — | — |

### Emulator Proof 7 — Resolver Hardening (6/6 PASS)

| Test | Proves |
|------|--------|
| Active contributor, no header → auto-assigns workspace, pitches role-scoped | Condition 1: single-membership auto-assign works; pitch queries remain role-scoped after auto-assign |
| Active contributor, blank header → auto-assigns | Condition 6: blank/whitespace stripped to null, not treated as invalid candidate |
| Active contributor, invalid header → rejected 403 | Condition 4: foreign workspace ID rejects with `WORKSPACE_MEMBERSHIP_REQUIRED`; legacy fallback never reached |
| Multi-workspace user, no header → rejected 400 | Condition 2: no arbitrary workspace selected; `WORKSPACE_AMBIGUOUS` returned |
| Solo user, zero memberships → null workspace | Condition 9: legitimate solo fallback preserved |
| Workspace in enumeration but membership doc missing → 500 | Condition 8: inconsistent mirror data = fail-closed, not silent fall-through |

### WorkspaceResolutionError + index.js Middleware Chain

**`WorkspaceResolutionError`** is a structured error class exported from `middleware/workspaceResolver.js`:
```javascript
class WorkspaceResolutionError extends Error {
    constructor(message, statusCode, code) { ... }
    // .statusCode — 400 | 403 | 500
    // .code — 'WORKSPACE_AMBIGUOUS' | 'WORKSPACE_MEMBERSHIP_REQUIRED' | 'WORKSPACE_NOT_FOUND' |
    //          'WORKSPACE_RESOLUTION_FAILED' | 'WORKSPACE_MEMBERSHIP_INCONSISTENT'
}
```

**index.js placement** (line ~231, inside the `if (req.userId !== 'anonymous')` block):
```javascript
try {
    await resolveWorkspace(req);
} catch (wsErr) {
    if (wsErr instanceof WorkspaceResolutionError) {
        return res.status(wsErr.statusCode).json({
            success: false,
            error: { code: wsErr.code, message: wsErr.message },
        });
    }
    throw wsErr; // Unexpected error — let outer handler catch it
}
```

The resolver runs AFTER `verifyAuth` and `ensureUserExists`, BEFORE any route dispatch. Every workspace-capable endpoint is downstream of this middleware. A `WorkspaceResolutionError` terminates the request before any route handler executes.

### getActiveWorkspacesForUser (workspaceService.js)

New function added alongside existing `getWorkspaceForUser()`. Unlike the original (which uses `limit(1)`), this queries WITHOUT limit to enumerate ALL active memberships:

1. Query `workspaces` where `ownerId == userId` (no limit)
2. Query `workspaceMembers` where `uid == userId` AND `status in ['active']` (no limit)
3. De-duplicate by workspace ID
4. Fetch full workspace docs for member-only workspaces
5. Return combined array

This enables the resolver to distinguish "single workspace" from "multiple workspaces" and enforce condition 2 (ambiguous rejection).

---

## 2. Opportunity Brief Write-Path Scoping

### Generation — stamps workspaceId + createdByUid

**Route handler** (`routes/opportunityBriefRoutes.js`, POST `/opportunity-brief/generate`):
- Passes `workspaceId: req.workspaceId || null`, `createdByUid: req.userId`, `createdByDisplayName` from `req.workspaceMembership` into the service `params` object.

**Service** (`services/opportunityBriefService.js`, `saveToFirestore()`):
```javascript
if (params.workspaceId) {
    sanitized.workspaceId = params.workspaceId;
    sanitized.createdByUid = params.createdByUid || params.userId;
    sanitized.createdByDisplayName = params.createdByDisplayName || null;
}
```

Fields are stamped server-side. The client cannot inject a workspace ID — `req.workspaceId` is set exclusively by the resolver middleware from live Firestore data.

### Refresh — preserves verified existing workspace

**Route handler** (`routes/opportunityBriefRoutes.js`, POST `/opportunity-brief/:briefId/refresh`):
```javascript
if (req.workspaceId) {
    const briefDoc = await db.collection('opportunityBriefs').doc(req.params.briefId).get();
    if (briefData.workspaceId !== req.workspaceId) → 403
    if (!canAccessResource(req, briefData.createdByUid || briefData.userId)) → 403
}
```

**Service** (`services/opportunityBriefService.js`, `refreshOpportunityBrief()`):
```javascript
return generateOpportunityBrief({
    ...existing fields...,
    workspaceId: existing.workspaceId || null,        // from EXISTING brief
    createdByUid: existing.createdByUid || existing.userId,  // from EXISTING brief
    createdByDisplayName: existing.createdByDisplayName || null,
});
```

The refresh flow reads workspace fields from the EXISTING brief document and passes them through. No client-provided workspace ID is trusted on refresh.

### No client-provided workspace ID trusted

- Generate: `workspaceId` comes from `req.workspaceId` (set by resolver from live Firestore membership data)
- Refresh: `workspaceId` comes from the existing brief document (server-side read)
- There is no `req.body.workspaceId` read in any brief endpoint

### Workspace-scoped reads exclude null/absent-workspaceId records

All workspace-mode queries use `scopeQueryToWorkspace()` which adds `where('workspaceId', '==', req.workspaceId)`. Firestore equality filters naturally exclude documents where the field is absent or null. This is proven by Emulator Proof 9 test "workspace-scoped brief list excludes null-workspaceId briefs."

### Brief Write Path Inventory

| Path | Workspace Behavior |
|------|--------------------|
| `POST /opportunity-brief/generate` | Stamps `workspaceId` + `createdByUid` server-side |
| `POST /opportunity-brief/:briefId/refresh` | Verifies workspace membership + preserves existing `workspaceId` |
| `GET /opportunity-brief/:briefId` | Workspace-scoped access check (Phase 3B original) |
| `GET /opportunity-brief/public/:shareToken` | No auth, no workspace check (public share endpoint) |
| `POST /opportunity-brief/:briefId/track` | No auth, no workspace check (analytics, anonymous) |

No background, scheduled, retry, or alternate persistence paths exist for opportunity briefs.

### Emulator Proof 9 — Opportunity Brief Write Paths (5/5 PASS)

| Test | Proves |
|------|--------|
| workspace-mode generate stamps workspaceId + createdByUid | Server-side stamping verified in Firestore |
| refresh preserves existing workspaceId | Client cannot inject different workspace on refresh |
| workspace-scoped brief list excludes null-workspaceId briefs | Firestore equality filter excludes legacy briefs |
| contributor cannot access another member's brief | `canAccessResource` denies cross-member reads |
| admin can access any member's brief | Manager+ rollup works for briefs |

---

## 3. Workspace Pitch Deletion Policy

### Confirmed Policy

> In workspace mode, Contributors cannot delete pitches — including pitches they created. Delete is Manager/Admin only.

**Rationale:** The workspace owns the book of business. Preserving pitches protects team history, attribution, analytics, and continuity when a contributor leaves.

### Implementation

**Route handler** (`routes/pitchRoutes.js`, DELETE `/pitch/:pitchId`):
```javascript
if (req.workspaceId) {
    if (pitchData.workspaceId !== req.workspaceId) → 403
    if (!requireRole(req, 'manager')) → 403  // Contributors blocked entirely
}
```

- Contributors: `requireRole(req, 'manager')` returns `false` → 403 denied
- Manager/Admin: `requireRole(req, 'manager')` returns `true` → allowed ONLY within verified workspace
- Cross-workspace: `pitchData.workspaceId !== req.workspaceId` → 403 denied
- Solo legacy: `requireRole(req, 'manager')` returns `false` (no workspace), route falls to existing `userId` ownership check

### Emulator Proof 8 — Deletion Policy (5/5 PASS)

| Test | Proves |
|------|--------|
| Contributor cannot delete own workspace pitch | `requireRole(req, 'manager')` = false for contributor |
| Manager can delete within workspace | `requireRole(req, 'manager')` = true for manager |
| Admin can delete within workspace | `requireRole(req, 'manager')` = true for admin |
| Manager/Admin cannot delete cross-workspace pitch | `pitchData.workspaceId !== req.workspaceId` guard catches it |
| Solo user retains legacy deletion | No workspace context → falls to userId ownership check |

---

## 4. Phase 3B Endpoint/Query Inventory (complete)

### Workspace-Scoped Endpoints

| Endpoint | Scoping Method | Role Policy |
|----------|---------------|-------------|
| `GET /pitches` | `scopeQueryToWorkspace` | contributor (own), manager+ (all) |
| `GET /pitch/:pitchId` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `PUT /pitch/:pitchId` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `PATCH /pitches/:pitchId/status` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `DELETE /pitch/:pitchId` | workspaceId match + `requireRole('manager')` | **manager+ only** |
| `GET /analytics/enhanced` | `scopeQueryToWorkspace` on pitch query | contributor (own), manager+ (all) |
| `POST /export/ppt` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `POST /export/cloud` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `GET /market/reports` | `scopeQueryToWorkspace` | contributor (own), manager+ (all) |
| `GET /market/report/:id` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `POST /market/refresh/:id` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `GET /opportunity-brief/:briefId` | workspaceId match + `canAccessResource` | contributor (own), manager+ (all) |
| `POST /opportunity-brief/generate` | Stamps `workspaceId` + `createdByUid` server-side | auth required |
| `POST /opportunity-brief/:briefId/refresh` | workspaceId match + `canAccessResource` + preserves existing workspace | contributor (own), manager+ (all) |

### Unscoped Endpoints (no workspace check — by design)

| Endpoint | Reason |
|----------|--------|
| `GET /opportunity-brief/public/:shareToken` | Public share — no auth |
| `POST /opportunity-brief/:briefId/track` | Analytics tracking — works anonymously |

---

## 5. Changed Files (Phase 3B complete list including hardening)

| File | Action | Purpose |
|------|--------|---------|
| `functions/middleware/workspaceRoleGuard.js` | **New** | `ROLE_RANK`, `requireRole`, `canAccessResource`, `scopeQueryToWorkspace` |
| `functions/middleware/workspaceResolver.js` | **Rewritten** | Fail-closed resolver with `WorkspaceResolutionError`, `getActiveWorkspacesForUser` |
| `functions/services/workspaceService.js` | Modified | Added `getActiveWorkspacesForUser()` |
| `functions/index.js` | Modified | `WorkspaceResolutionError` import + HTTP error handler in middleware chain |
| `functions/routes/pitchRoutes.js` | Modified | Workspace scoping on 5 endpoints (GET list, GET single, PUT, PATCH status, DELETE) |
| `functions/routes/analyticsRoutes.js` | Modified | Workspace scoping on GET /analytics/enhanced |
| `functions/api/export.js` | Modified | Workspace access checks on 2 export handlers |
| `functions/api/market.js` | Modified | Workspace scoping on listReports, getReport, refreshReport |
| `functions/routes/opportunityBriefRoutes.js` | Modified | Workspace stamping on generate + membership check on refresh |
| `functions/services/opportunityBriefService.js` | Modified | `saveToFirestore` stamps workspace fields; `refreshOpportunityBrief` preserves them |
| `functions/tests/workspaceResolver.test.js` | **Rewritten** | 14 hardened resolver unit tests |
| `functions/tests/workspacePhase3B.emulator.test.js` | **New** | 42 emulator tests across 9 proofs |

---

## 6. Test Results

### Emulator Suites

| Suite | Tests | Status |
|-------|-------|--------|
| Phase 3B emulator (9 proofs) | 42/42 | PASS |
| Phase 3A emulator | 30/30 | PASS |
| Phase 2 emulator | 26/26 | PASS |
| Phase 1 emulator | 16/16 | PASS |
| **Emulator total** | **114/114** | **PASS** |

### Mock Suites

| Suite | Tests | Status |
|-------|-------|--------|
| workspaceResolver.test.js (hardened) | 14/14 | PASS |
| workspaceService.test.js | 29/29 | PASS |
| workspacePhase3A.test.js | varies | PASS |
| workspacePhase2.test.js | 17/17 | PASS |
| Full mock suite (all non-emulator) | 1,777 | PASS — zero regressions |

### Emulator Commands

```bash
# Start emulator
npx firebase emulators:start --only firestore

# Run Phase 3B (includes all 9 proofs)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3B.emulator.test.js --no-coverage --forceExit

# Run all phases
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspace.emulator.test.js --no-coverage --forceExit
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase2.emulator.test.js --no-coverage --forceExit
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3A.emulator.test.js --no-coverage --forceExit
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3B.emulator.test.js --no-coverage --forceExit
```

---

## 7. Known Limitations / Deferred Work

| Item | Status | Notes |
|------|--------|-------|
| `x-workspace-id` header not yet sent by frontend | Deferred | Frontend will add this when multi-workspace support ships. Current single-workspace users auto-resolve. |
| Opportunity Brief list endpoint | Not yet implemented | No `GET /opportunity-briefs` list endpoint exists. Individual brief reads are scoped. |
| Bulk pitch operations | Not affected | No bulk pitch endpoints exist in the current API |
| Workspace-scoped analytics aggregation | Implemented | `GET /analytics/enhanced` uses `scopeQueryToWorkspace` |
| Credit deduction in workspace mode | R1 pattern | Credits deducted from `users/{entitlementOwnerUid}.credits` — the workspace owner's balance |

---

## 8. Architecture Notes

### Role Guard Module (`workspaceRoleGuard.js`)

```javascript
const ROLE_RANK = { contributor: 0, manager: 1, admin: 2 };

requireRole(req, minimumRole)        // Returns boolean — is caller's role >= minimum?
canAccessResource(req, createdByUid) // Manager+ = any resource; contributor = own only
scopeQueryToWorkspace(query, req, options) // Adds where() clauses for workspace + optional creator
```

All three functions return `false` when `req.workspaceId` is null (solo mode). Route handlers use `if (req.workspaceId) { ... } else { legacy check }` pattern.

### Firestore Equality Filter Guarantee

`where('workspaceId', '==', 'ws_123')` naturally excludes documents where:
- `workspaceId` field is absent (never set)
- `workspaceId` field is `null`
- `workspaceId` field has a different value

This is the mechanism that prevents legacy (pre-workspace) documents from appearing in workspace-scoped queries. No additional filter is needed.
