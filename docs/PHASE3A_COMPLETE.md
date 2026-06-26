# Phase 3A Complete — Invite Token System + Acceptance Gates

**Date:** June 23, 2026
**Status:** Approved for Phase 3B

---

## Disposition Items

### 1. Legacy ID-Only Acceptance — FULLY BLOCKED

Post-Phase 3A cutover, invitation ID alone is never sufficient to create or reactivate membership. The entire legacy ID-based acceptance path in `POST /team/accept` has been replaced with a hard rejection:

```
"ID-based invitation acceptance is no longer supported.
 Please request a new invitation link from the workspace owner."
```

**Scope:** ALL invitations — not just those with `tokenHash`. Pre-3A invitations without `tokenHash` are also rejected. The only acceptance path is `inviteToken` (plaintext crypto token → SHA-256 hash lookup → transactional seat check → membership creation).

**User-visible behavior:** A user clicking an old bookmark or cached invite link that passes `invitationId` receives HTTP 400 with a message to request a new invitation. The workspace owner can re-invite them via the standard flow, which issues a new token-based invite.

**Code location:** `functions/routes/teamRoutes.js` — `POST /team/accept` route. Dead code removed: `addMember` import, `mapTeamRoleToWorkspaceRole` helper, and the entire legacy accept block (read-modify-write on teams.members[], non-transactional workspace member creation).

### 2. Duplicate-Invite Race — Accepted R1 Limitation

**Trigger:** Two `createInvite()` calls for the same email execute simultaneously. Both non-transactional reads see no existing pending invite, so both writes succeed. Result: two pending invitations for the same email in `teamInvitations`.

**Why this is acceptable for R1:**

1. **Deterministic membership document IDs guarantee at most one membership per (workspaceId, uid).** The composite doc ID `{workspaceId}_{uid}` in `workspaceMembers` is structurally unique. Accepting either duplicate invitation creates the same doc ID. The second acceptance fails with "already accepted" (transactional status check).

2. **Duplicate invites cannot create divergent `memberIds[]`, `memberUids[]`, seat-count, or acceptance state.** The `acceptInvite` transaction reads workspace and invitation state inside the transaction. Only one accept succeeds per token. The second token's accept either succeeds idempotently (member already active) or fails cleanly.

3. **Capped-seat workspaces must not enable invitations until the `inviteGuard` document transaction is implemented.** The current non-transactional duplicate check is a race window only under concurrent invite creation for the same email. For capped-seat customers, duplicate pending invitations could cause confusion about available seats (two invitations reserved but only one seat consumed). The `inviteGuard` design (transactional invite creation with seat reservation) must be the first billing/team hardening item before the first capped-seat customer goes live.

**Remediation path:** Replace `createInvite()`'s sequential read-then-write with a Firestore transaction that:
- Reads existing pending invitations for the target email within the transaction
- Checks seat availability within the same transaction
- Creates the invitation doc only if no duplicate exists and seats are available
- Reserves the seat atomically (increment a `pendingInviteCount` or similar)

This is tracked as a pre-billing hardening item, not a Phase 3B requirement.

### 3. SendGrid — Implementation-Ready, Production-Disabled

**Current state:**
- `SENDGRID_API_KEY` exists in `functions/.env` with a real `SG.` prefix.
- `sendWorkspaceInviteEmail()` is wired in `POST /team/invite` (non-blocking try/catch).
- Email includes referrer leakage protection (`rel="noreferrer noopener"`, `<meta name="referrer" content="no-referrer">`).
- Plaintext token is never logged in production code paths.

**Production deployment requirement:**
Before any real-recipient invitation emails are enabled in Firebase production:
1. Move `SENDGRID_API_KEY` to a Firebase/Google-managed secret (`firebase functions:secrets:set SENDGRID_API_KEY`).
2. Verify there is no deployed `.env` fallback that could expose the key in Cloud Functions logs or runtime environment inspection.
3. Perform a live delivery test to a controlled mailbox.

**Until then:** Invitation delivery is described as **implementation-ready but production-disabled**. The invite flow returns the `plainToken` in the API response for manual sharing via the frontend.

---

## Test Results at Phase 3A Gate

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Mock unit tests (no emulator) | 59 suites | 1,682/1,682 | PASS |
| Phase 1 emulator | workspace.emulator.test.js | 16/16 | PASS |
| Phase 2 emulator | workspacePhase2.emulator.test.js | 26/26 | PASS |
| Phase 3A emulator | workspacePhase3A.emulator.test.js | 30/30 | PASS |
| **Total** | 62 suites | **1,754/1,754** | **ALL PASS** |

## Bug Found by Emulator

`acceptInvite()` transaction performed `tx.get(teamsRef)` after writes. Real Firestore enforces reads-before-writes ordering. The Jest mock did not enforce this constraint. Fixed by restructuring the transaction: all reads via `Promise.all` first, then validation, then all writes.

## Changed Files (Phase 3A)

| File | Action | Purpose |
|------|--------|---------|
| `services/workspaceInviteService.js` | New | Crypto-token invite: createInvite, acceptInvite, hashToken, generateToken |
| `services/workspaceInviteService.js` | Modified | Transaction restructured: all reads before all writes |
| `services/workspaceService.js` | Modified | createWorkspace() seeds workspaceBranding/{wsId} |
| `services/brandResolver.js` | Modified | Removed fallback to agencyBrandOverrides in workspace context |
| `services/email.js` | Modified | sendWorkspaceInviteEmail() + referrer leakage protection |
| `routes/teamRoutes.js` | Modified | Token-based accept; legacy ID accept fully blocked; dead code removed |
| `__mocks__/firebase-admin.js` | Modified | MockTransaction resolves _arrayUnion/_arrayRemove sentinels |
| `__tests__/routes/teamRoutes.test.js` | Modified | Updated for legacy accept rejection + workspace email mock |
| `tests/workspacePhase3A.emulator.test.js` | New | 30 emulator tests — 7 proofs |
