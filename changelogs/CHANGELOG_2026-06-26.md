# Changelog 2026-06-26 — Server-Boundary Sprint

## C1/C2/C3 Pre-Conditions Confirmed (Phase 2 prerequisites)

**C1 — workspaceId identity:**
- `workspaceId` on `marketReports` = workspace doc ID (e.g. `ws_bootstrap_charles`), NOT ownerUid
- `teams` collection is keyed by ownerUid (`teams/{ownerUid}`)
- `teams.doc(reportData.workspaceId)` would FAIL — that doc does not exist
- Correct delete auth: `canAccessResource(req, reportData.createdByUid || reportData.userId)` (same pattern as `market.js:2856`)
- `req.workspaceRole` already populated by `workspaceResolver` middleware before any handler runs — no teams lookup needed

**C2 — creator field:**
- Both `userId` and `createdByUid` written equal at creation: `market.js:1320-1322`
- Solo delete check: `req.userId === reportData.userId || req.userId === reportData.createdByUid`
- Workspace delete check: `canAccessResource(req, reportData.createdByUid || reportData.userId)`

**C3 — onepager isPublic:**
- Pre-existing field, written as `isPublic: true` at creation (`api.js:3029`)
- Share endpoint must check `isPublic !== false` (not `=== true`) — missing field defaults to readable
- Revocation = set `isPublic: false`
- No query anywhere filters onepagers on `isPublic == true`

---

## Phase 1 (onepagers) — DEPLOYED & VERIFIED June 26, 2026. P0 CLOSED.

**Files shipped:**
- `functions/routes/onepagerShareRoutes.js` — NEW. `GET /onepager/share/:shareId`, public, denylist projection (`userId`/`workspaceId`/`createdByUid`/`createdBy`), `isPublic !== false` gate, server-side view tracking.
- `functions/index.js` — `require` onepagerShareRoutes added; dispatch `path.startsWith('/onepager/share')` added between shareRoutes + workspaceRoutes.
- `synchintro-app/js/api.js` — `getOnepagerByShareId` replaced; now calls `this.request('/onepager/share/...')`.
- `synchintro-app/onepager/index.html` — Firebase SDK imports + init removed; `loadOnepager()` replaced with plain `fetch()`; utility functions unchanged.
- `pathsynch-pitch-generator/firestore.rules` — `allow read: if resource.data.shareId != null` removed; owner-auth read preserved.

**Deploy order (completed):**
1. ✓ `firebase deploy --only functions` (from `pathsynch-pitch-generator`)
2. ✓ `firebase deploy --only hosting` (from `synchintro-app`)
3. ✓ Smoke test passed: html present, 4 leak fields stripped, revocation → 404, garbage id → 404 not 500
4. ✓ Incognito browser render of `/onepager/B8vKjz8W` succeeded
5. ✓ `firebase deploy --only firestore:rules` (from `pathsynch-pitch-generator`) — P0 sealed

---

## Process Note

A live GCP access token was echoed to terminal during a read-only Firestore query. Future
prompts must forbid printing tokens/secrets to stdout. Assign to shell variable; never print.

---

## Phase 2 (market reports soft-delete) — NOT STARTED

Design decisions locked:
- Soft-delete: write `deletedAt` + `deletedBy` on delete (never hard-delete)
- `deletedAt: null` must be stamped at creation on all NEW reports
- Backfill script must run BEFORE list filter is deployed (hard-gate: `updated_count + already_had_field == total` or stop)
- List query: `where('deletedAt', '==', null)` — returns only docs with explicit null (NOT missing field)
- Delete endpoint runs through same `workspaceResolver` middleware so `req.workspaceRole` is populated
- Auth: workspace mode → `canAccessResource(req, reportData.createdByUid || reportData.userId)`; solo mode → `req.userId === reportData.userId || req.userId === reportData.createdByUid`
