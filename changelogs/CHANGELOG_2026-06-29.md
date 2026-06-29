# Changelog — June 29, 2026

## feat: POST /team/revoke-invite endpoint (PR #40, merged)

**Branch:** `feat/team-revoke-invite` | **Commit:** `c4297e2`

### What

Added `POST /team/revoke-invite` to `functions/routes/teamRoutes.js`. Owner-only endpoint that revokes a pending team invitation.

- Accepts `{ invitationId }` (direct doc lookup) or `{ inviteeEmail }` (query) — both scoped to `teamOwnerUid === req.userId` and `status === 'pending'`
- Sets `status: 'revoked'` + `revokedAt` timestamp (consistent with status-based invitation model — not deletion)
- Returns 404 `"Invitation not found"` / 200 `{ success: true }`
- Auth/owner-check modeled on existing `POST /team/remove`
- Endpoint added to `routes/index.js` AVAILABLE_ENDPOINTS list

**Root cause:** Frontend settings page Revoke button called `POST /api/v1/team/revoke-invite` — endpoint never existed, returned 404.

### Daniyal Onboarding Cleanup

- Orphaned pending doc in `teamInvitations` collection cleared manually via Firestore console
- Stale docs purged from `teamInvites` (obsolete Schema A collection)
- `teamInvitations` (with "on") confirmed as the canonical collection; `teamInvites` (without "on") is dead

### CI Deploy Fix

- Initial deploy failed: 401 on `cloudresourcemanager.googleapis.com` due to expired/deprecated `FIREBASE_TOKEN`
- Regenerated token via `firebase login:ci`, updated GitHub secret, re-ran — deploy green

### Tests

- **1,689 passed, 0 failed**
- New endpoint has no automated test coverage (flagged as TODO)

### Open Items

| Item | Severity |
|------|----------|
| Migrate CI from `FIREBASE_TOKEN` to service account (`GOOGLE_APPLICATION_CREDENTIALS`) | P2 |
| Add test coverage for `POST /team/revoke-invite` | P2 |
