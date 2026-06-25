# Workspace Bootstrap Plan — June 25, 2026

> Confirmed sequence for bootstrapping Charles Berry's workspace and inviting Daniyal.
> All commands run from `functions/` directory in `pathsynch-pitch-generator`.

---

## Prerequisites

- Branch: `feature/phase3c-offboarding-share-cutover` (checked out in pathsynch-pitch-generator)
- Credential: `GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json`
- Project: hardcoded to `pathsynch-pitch-creation` in both scripts
- Working directory: `cd /c/Users/tdh35/pathsynch-pitch-generator/functions`

## Quarantine decisions (applied to `scripts/bootstrap-workspaces.js`)

| Entry | Type | Reason |
|---|---|---|
| `NRPJo05FVMjCTKQo7PTq` | STALE_TEAM_IDS | Orphan Schema A doc — no ownerUid, no members |
| `cbFZRMJSXV5bLHXghPTe` | STALE_TEAM_IDS | Orphan Schema A doc — no ownerUid, no members |
| `tdh356b@gmail.com` | STALE_MEMBER_EMAILS | Charles's wife — stale test account, not a real workspace member |
| `daniyal@pathsynch.com` | STALE_MEMBER_EMAILS | Must rejoin via Phase 3A invite flow (already present pre-edit) |

---

## Step 1 — Backup

```bash
cd /c/Users/tdh35/pathsynch-pitch-generator/functions && \
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
node scripts/backup-before-bootstrap.js
```

### Verify backup

1. Console output ends with `=== Backup Complete ===` and shows `Teams: 3 docs`.
2. Two files exist in `functions/`:
   ```bash
   ls -lh backup_teams_*.json backup_users_*.json
   ```
3. Teams doc count = 3:
   ```bash
   node -e "const d=require('./' + require('fs').readdirSync('.').filter(f=>f.startsWith('backup_teams_')).sort().pop()); console.log(Object.keys(d).length, 'teams')"
   ```
4. Charles's user data present:
   ```bash
   node -e "const d=require('./' + require('fs').readdirSync('.').filter(f=>f.startsWith('backup_users_')).sort().pop()); console.log(d.dehiyRBCXcUUM72O211S27lfXbl1)"
   ```
   Expected: object with `credits`, `plan`, `tier`, `subscription` fields.

---

## Step 2 — Bootstrap

```bash
cd /c/Users/tdh35/pathsynch-pitch-generator/functions && \
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
node scripts/bootstrap-workspaces.js
```

### Expected output

```
=== Workspace Bootstrap Migration ===

Found 3 team doc(s).

  [QUARANTINE] teams/NRPJo05FVMjCTKQo7PTq — stale test entry
  [QUARANTINE] teams/cbFZRMJSXV5bLHXghPTe — stale test entry
  [CREATE] Workspace ws_bootstrap_charles for owner dehiyRBCXcUUM72O211S27lfXbl1 (Charles Berry)
  [SEED] workspaceBranding/ws_bootstrap_charles seeded from agencyBrandOverrides/...
    (or [SKIP] No agencyBrandOverrides — depends on whether brand doc exists)
    [QUARANTINE] Member tdh356b@gmail.com — should rejoin via Phase 3A invite

=== Bootstrap Complete ===
Created     : 1 workspace(s)
Skipped     : 0 (already migrated)
Quarantined : 3 stale entries
```

Key facts:
- Only 1 workspace created: `ws_bootstrap_charles`
- Charles is the sole member (admin, isWorkspaceOwner)
- `tdh356b@gmail.com` quarantined — no workspaceMembers doc created for her
- 2 orphan team docs quarantined — no orphan workspaces created
- `tdh356b` team ID was already in the quarantine list but doesn't match any of the 3 docs (no effect)

---

## Step 3 — Post-Bootstrap Verification

Run this verification script (read-only):

```bash
cd /c/Users/tdh35/pathsynch-pitch-generator/functions && \
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
node -e "
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
(async () => {
  // 1. Workspace exists
  const ws = await db.collection('workspaces').doc('ws_bootstrap_charles').get();
  console.log('workspace exists:', ws.exists);
  if (ws.exists) {
    const d = ws.data();
    console.log('  ownerId:', d.ownerId);
    console.log('  memberIds:', JSON.stringify(d.memberIds));
    console.log('  memberCount:', d.memberCount);
    console.log('  seatLimit:', d.seatLimit);
  }

  // 2. Owner member doc exists
  const ownerMem = await db.collection('workspaceMembers').doc('ws_bootstrap_charles_dehiyRBCXcUUM72O211S27lfXbl1').get();
  console.log('');
  console.log('owner workspaceMembers doc exists:', ownerMem.exists);
  if (ownerMem.exists) {
    const m = ownerMem.data();
    console.log('  role:', m.role);
    console.log('  isWorkspaceOwner:', m.isWorkspaceOwner);
    console.log('  status:', m.status);
  }

  // 3. Teams backlink
  const team = await db.collection('teams').doc('dehiyRBCXcUUM72O211S27lfXbl1').get();
  console.log('');
  console.log('teams backlink workspaceId:', team.data().workspaceId);

  // 4. No tdh356b member doc
  const staleMem = await db.collection('workspaceMembers').doc('ws_bootstrap_charles_cZFXrf3FBOUXmlQU5dep8ymj1Lq1').get();
  console.log('');
  console.log('tdh356b member doc exists (should be false):', staleMem.exists);

  // 5. No orphan workspaces
  const orphan1 = await db.collection('teams').doc('NRPJo05FVMjCTKQo7PTq').get();
  const orphan2 = await db.collection('teams').doc('cbFZRMJSXV5bLHXghPTe').get();
  console.log('');
  console.log('orphan1 quarantinedAt:', orphan1.data().quarantinedAt ? 'SET' : 'MISSING');
  console.log('orphan2 quarantinedAt:', orphan2.data().quarantinedAt ? 'SET' : 'MISSING');

  process.exit(0);
})();
"
```

### Expected verification output

```
workspace exists: true
  ownerId: dehiyRBCXcUUM72O211S27lfXbl1
  memberIds: ["dehiyRBCXcUUM72O211S27lfXbl1"]
  memberCount: 1
  seatLimit: -1

owner workspaceMembers doc exists: true
  role: admin
  isWorkspaceOwner: true
  status: active

teams backlink workspaceId: ws_bootstrap_charles

tdh356b member doc exists (should be false): false

orphan1 quarantinedAt: SET
orphan2 quarantinedAt: SET
```

---

## Step 4 — Invite Daniyal

**Endpoint:** `POST /team/invite`
**URL:** `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/team/invite`
**Auth:** Bearer token from Charles's Firebase Auth session
**Body:**
```json
{
  "email": "daniyal@pathsynch.com",
  "role": "contributor"
}
```

### Expected 201 response

```json
{
  "success": true,
  "data": {
    "invitationId": "<auto-generated>",
    "plainToken": "<64-char-hex-string>",
    "email": "daniyal@pathsynch.com",
    "role": "contributor"
  }
}
```

**Save the `plainToken` from this response.** It is never stored server-side and cannot be recovered.

### What happens on invite

- `teamInvitations/{autoId}` created with `tokenHash` (SHA-256 of plainToken), `status: 'pending'`, `expiresAt: now + 7 days`
- No workspaceMembers doc created yet (pending until acceptance)
- Email sent via SendGrid (non-blocking — invite works even if email fails)
- `getWorkspaceForUser()` finds existing `ws_bootstrap_charles` — no new workspace created

---

## Step 5 — Share Accept Link with Daniyal

Construct this URL from the `plainToken`:

```
https://app.synchintro.ai/?inviteToken={plainToken}
```

Share this link with Daniyal directly (Slack, text, etc.). The SendGrid email also contains this link, but manual sharing is the reliable path.

### Notes on acceptance

- Email match NOT required — Daniyal can accept with any Firebase Auth account
- Token expires in 7 days
- Token is single-use — once accepted, it cannot be reused
- Seat limit is -1 (unlimited) — no cap concern

---

## Step 6 — Verify Daniyal's Access (after he accepts)

Daniyal calls `POST /team/accept` with `{ "inviteToken": "<plainToken>" }` (the frontend handles this automatically when he clicks the link).

After acceptance, verify:

```bash
cd /c/Users/tdh35/pathsynch-pitch-generator/functions && \
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
node -e "
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
(async () => {
  // Workspace should now have 2 members
  const ws = await db.collection('workspaces').doc('ws_bootstrap_charles').get();
  const d = ws.data();
  console.log('memberIds:', JSON.stringify(d.memberIds));
  console.log('memberCount:', d.memberCount);

  // Find Daniyal's member doc
  const members = await db.collection('workspaceMembers')
    .where('workspaceId', '==', 'ws_bootstrap_charles')
    .where('status', '==', 'active')
    .get();
  console.log('');
  console.log('Active members:');
  members.forEach(m => {
    const data = m.data();
    console.log('  ', data.email, '| role:', data.role, '| isWorkspaceOwner:', data.isWorkspaceOwner);
  });

  // Check invite status
  const invites = await db.collection('teamInvitations')
    .where('inviteeEmail', '==', 'daniyal@pathsynch.com')
    .where('status', '==', 'accepted')
    .limit(1)
    .get();
  console.log('');
  console.log('Accepted invite found:', !invites.empty);

  process.exit(0);
})();
"
```

### Expected output

```
memberIds: ["dehiyRBCXcUUM72O211S27lfXbl1", "<daniyal-uid>"]
memberCount: 2

Active members:
  hello@pathsynch.com | role: admin | isWorkspaceOwner: true
  daniyal@pathsynch.com | role: contributor | isWorkspaceOwner: false

Accepted invite found: true
```

---

## Rollback (if needed)

Per the bootstrap script header (lines 17-21):

1. Delete `workspaceMembers/ws_bootstrap_charles_*` docs
2. Delete `workspaces/ws_bootstrap_charles`
3. Delete `workspaceBranding/ws_bootstrap_charles` (if created)
4. Remove `workspaceId` field from `teams/dehiyRBCXcUUM72O211S27lfXbl1`

All bootstrap writes are additive — no existing data was modified (except the teams backlink). Restoring backup files is not necessary unless credits/plan fields were corrupted (they are not touched by bootstrap).
