# Phase 2 — Workspace Inheritance + Branding Version History

## Status: COMPLETE — Gate #7 (B2) bypass closed (June 23, 2026)

---

## Critical Finding — B2 Bypass (June 22-23, 2026)

### The Problem

The workspace owner can directly client-write `agencyBrandOverrides/{ownerUid}` — the canonical source `resolveBrand()` reads in workspace context — and create **0 version records** and **0 audit records**. This bypasses the requirement that every workspace-branding edit goes through the server handler that versions + audits.

The emulator test B2 *proved* this bypass exists: owner's direct `update()` to `agencyBrandOverrides` succeeds (rules allow it — `isOwner(uid)`), but produces zero `workspaceBrandingVersions` and zero `workspaceAuditLog` entries.

### The Fix (approved approach)

**Separate the workspace branding source from the solo branding source.**

1. Create `workspaceBranding/{workspaceId}` as a **server-only** collection (`allow write: if false` in firestore.rules — same pattern as `workspaceBrandingVersions` and `workspaceAuditLog`).
2. In workspace context, `resolveBrand()` reads from `workspaceBranding/{workspaceId}` — NOT from `agencyBrandOverrides/{ownerUid}`.
3. The PUT /workspace/branding handler writes to `workspaceBranding/{workspaceId}` via Admin SDK, creates the version record, and writes the audit event — all in one server-authorized flow.
4. `agencyBrandOverrides/{uid}` remains the **solo** branding source, client-writable as before. A direct client write to it does NOT mutate workspace-visible branding because `resolveBrand` no longer reads it in workspace context.
5. Do NOT add conditional deny rules to `agencyBrandOverrides` — that doc is intentionally client-writable for solo branding.

### Gate #7 Re-Verification — PASSED (June 23, 2026)

**Emulator command:** `npx firebase emulators:start --only firestore`
**Test command:** `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase2.emulator.test.js --no-coverage --forceExit`
**Result: 26/26 PASS**

| Proof | Status | What it proves |
|-------|--------|----------------|
| B2a | PASS | Contributor direct write to `workspaceBranding/{workspaceId}` → DENIED (write:false) |
| B2b | PASS | Owner direct write to `workspaceBranding/{workspaceId}` → DENIED (write:false applies to ALL clients) |
| B2c | PASS | Admin SDK atomically writes workspaceBranding + creates version + creates audit record |
| B2d | PASS | Cache invalidates immediately after authorized server update; re-resolve reflects new brand |
| B2e | PASS | Owner's direct client write to `agencyBrandOverrides/{ownerUid}` does NOT change workspace-resolved branding — `resolveBrand` reads from `workspaceBranding/{wsId}` in workspace context |

### B2 Bypass — CLOSED

The structural fix separates workspace-visible branding from solo branding at the data model level:
- `workspaceBranding/{workspaceId}` — server-only (`allow write: if false`). `resolveBrand()` reads from this in workspace context.
- `agencyBrandOverrides/{uid}` — solo branding, client-writable as before. NOT read by `resolveBrand()` in workspace context.
- A direct client write to `agencyBrandOverrides/{ownerUid}` has NO effect on workspace-resolved branding.
- The PUT /workspace/branding handler writes to `workspaceBranding/{workspaceId}` via Admin SDK, creates a version record, and writes an audit event — all atomically.

### Phase 1 Emulator Discrepancy — RESOLVED (June 23, 2026)

**Root cause:** `workspaceMembers` collection had no `match` rules in `firestore.rules`. Member own-doc reads were denied by Firestore default deny.

**Fix:** Added `workspaceMembers/{docId}` rules:
- `allow read: if isAuthenticated() && resource.data.uid == request.auth.uid` (member reads own doc)
- `allow write: if false` (all writes via Admin SDK)

**Result: 16/16 Phase 1 emulator tests pass** (was 14/16).

---

## Changed Files (as of June 23, 2026 — B2 fix complete)

| File | Action | Purpose |
|------|--------|---------|
| `functions/services/brandResolver.js` | Modified | `resolveBrand(userId, options={})` — workspace inheritance + cache key isolation; workspace context reads from `workspaceBranding/{wsId}` (B2 fix) |
| `functions/middleware/planGate.js` | Modified | `getUserPlan(userId, options={})` — workspace plan inheritance |
| `functions/api/pitchGenerator.js` | Modified | Workspace brand resolution + pitch field stamping |
| `functions/api/market.js` | Modified | `workspaceId` + `createdByUid` stamped on market reports |
| `functions/index.js` | Modified | `workspaceRoutes` import + `/workspace` dispatch |
| `functions/services/workspaceBrandingService.js` | New | Append-only immutable branding version history |
| `functions/services/workspaceAuditService.js` | New | Fire-and-forget audit logging |
| `functions/routes/workspaceRoutes.js` | New | PUT/GET branding, GET history endpoints; writes to `workspaceBranding/{wsId}` (B2 fix) |
| `functions/tests/workspacePhase2.test.js` | New | 17 mock-based gate tests |
| `functions/tests/workspacePhase2.emulator.test.js` | New | 26 emulator-backed tenancy tests (12 cache isolation + 14 Gate #7 bypass proofs) |
| `firestore.rules` | Modified | Added `workspaceBranding/{wsId}` (write:false), `workspaceBrandingVersions` (write:false), `workspaceAuditLog` (write:false), `workspaceMembers/{docId}` (read own, write:false) |

## Test Results (B2 fix complete — June 23, 2026)

| Suite | Tests | Status |
|-------|-------|--------|
| Phase 2 mock gates | 17/17 | PASS |
| Phase 2 emulator | 26/26 | PASS — B2 bypass closed, all 5 proofs verified |
| Phase 1 mock (workspaceService) | 27/27 | PASS |
| Phase 1 mock (workspaceResolver) | 7/7 | PASS |
| Phase 1 emulator | 16/16 | PASS — discrepancy resolved (workspaceMembers rules added) |
| Full mock suite | 1661/1661 | PASS — zero regressions |

## Cache Isolation — PROVEN (12/12 emulator tests, unchanged by B2 fix)

Both call orders tested against real Firestore emulator with production cache active:
- Solo → workspace: member personal brand does not leak into workspace context
- Workspace → solo: owner workspace brand does not leak into personal context
- `getUserPlan` same isolation in both orders
- Cache keys: `memberId` (solo) vs `ownerId:ws:workspaceId` (workspace) — structurally distinct

## Market Report Scope Note

Market-report `workspaceId` and `createdByUid` stamping was implemented in Phase 2 (not deferred) because `workspaceResolver` middleware runs before market intel routes. Phase 3B must implement strict `workspaceId` scoping at read/analytics time in the same PR. No Market Intel report with absent/null `workspaceId` may be returned through a workspace-scoped query.

## Phase 1 Emulator Discrepancy — RESOLVED

`workspaceMembers/{docId}` rules added to `firestore.rules`:
- `allow read: if isAuthenticated() && resource.data.uid == request.auth.uid`
- `allow write: if false`

Phase 1 emulator: **16/16 PASS** (was 14/16).

---

## Deviations from v7 Spec

1. **Role names**: lowercase `admin`/`contributor`/`manager` (established Phase 1) vs spec uppercase
2. **`assigneeUid` on pitches**: deferred to Phase 3B (operational ownership, not creation attribution)
3. **`market.js` analytics scoping**: deferred to Phase 3B (read-time scoping, not write-time stamping)
