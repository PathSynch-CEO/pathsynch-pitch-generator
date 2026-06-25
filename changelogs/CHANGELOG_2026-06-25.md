# Changelog — June 25, 2026

**Session type:** Production operations. P0 security fix, workspace bootstrap, data backfill, team invite.
**Commit:** `c13ed1a` (pushed to origin)
**Branches:** `feature/phase3c-offboarding-share-cutover` (functions/rules), `fix/remove-public-pitch-rule-p0` (synchintro-app hosting)
**PRs:** #38 + #39 (open, NOT merged to main)

---

## Summary

Four production mutations ran live against Firestore on June 25, 2026. A P0 pitch data leak was closed, the first workspace was bootstrapped, legacy documents were backfilled with workspace IDs, and the first team member invite was created. Production is deployed from feature branches — main is behind and must be reconciled before any further deploys.

---

## Mutation 1 — P0 Pitch Leak CLOSED

**Severity:** P0
**Status:** CLOSED in production

### Root Cause

Production `firestore.rules` had unauthenticated public-read on pitches:
```
allow read: if resource.data.shared == true || sharing.public == true
```

A real pitch (Bumble Roofing, shareId `jm36djhwrl9m5uepuws19`) was publicly readable via direct Firestore client SDK read. Confirmed live.

### Fix — 3 Coordinated Deploys

| Step | Repo | Deploy Command | What |
|------|------|---------------|------|
| 1 | pathsynch-pitch-generator | `firebase deploy --only functions` | `/share/:shareToken` + legacy `/pitch/share/:shareId` endpoints live |
| 2 | synchintro-app | `firebase deploy --only hosting` | Migrated `p/index.html` from Firebase SDK to fetch-based (NO Firebase SDK) |
| 3 | pathsynch-pitch-generator | `firebase deploy --only firestore:rules` | `shared==true` public-read REMOVED, replaced with Phase 3C comment |

Branch confirmed before each deploy. Rules deployed LAST to ensure share endpoints were live first.

### Verification

- Firebase Console: rule gone
- Browser: pitch still renders via `/share` 404 -> legacy 200

### Cross-Repo Rules Hazard Discovered

BOTH repos (`pathsynch-pitch-generator` and `synchintro-app`) deploy `firestore.rules` to the SAME project (`pathsynch-pitch-creation`). A bare `firebase deploy` from `synchintro-app` would overwrite the canonical rules and could re-introduce the leak.

**New rule (permanent):** Never run bare `firebase deploy` from `synchintro-app`. Always use `--only hosting`. Canonical `firestore.rules` source = `pathsynch-pitch-generator`.

### Production Share Host

Confirmed: `https://pathsynch-pitch-creation.web.app/p/{shareId}`. `synchintro.ai` is a separate marketing site, NOT connected to this Firebase Hosting.

---

## Mutation 2 — Workspace Bootstrap

**Script:** `scripts/bootstrap-workspaces.js`
**Pre-flight:** Backup via `backup-before-bootstrap.js` (teams + users collections). Verified backup captured Charles's data (credits/plan/tier/subscription).

### Result

| Field | Value |
|-------|-------|
| Workspace ID | `ws_bootstrap_charles` |
| Owner UID | `dehiyRBCXcUUM72O211S27lfXbl1` (Charles Berry) |
| Owner role | `admin`, `isWorkspaceOwner: true` |
| Member count | 1 |
| Seat limit | -1 (unlimited) |
| Teams backlink | `workspaceId` set on `teams/{ownerUid}` |

### Quarantined (Skipped)

- `tdh356b@gmail.com` — Charles's wife, test account
- Team `NRPJo05FVMjCTKQo7PTq` — orphan
- Team `cbFZRMJSXV5bLHXghPTe` — orphan

Created exactly 1 workspace, no debris.

### Safety Properties

- Bootstrap only READS user doc — never touches Auth claims, never migrates pitches
- Idempotent: `workspaceId`-exists guard + deterministic ID guard prevent double-creation

---

## Mutation 3 — Workspace-Scoping Display Bug + Backfill

**Script:** `scripts/backfill-workspaceid.js --write`

### Problem

After bootstrap, the workspace resolver auto-assigns `req.workspaceId` on every request. All queries scope `WHERE workspaceId == ws_bootstrap_charles`. Legacy docs created before workspaces had NO `workspaceId` field — equality filter excluded them — UI showed 0 pitches / no reports.

**ZERO data loss.** 227 pitches + 93 reports were always present in Firestore, just invisible to the scoped query.

### Fix

Stamped `workspaceId` on:
- **225 pitches** (2 already had it)
- **37 marketReports** (56 already had it)

Idempotent, scoped to Charles's UID only. Data verified visible in UI after backfill.

### Design Rule (Carry Forward)

All docs must carry `workspaceId`. Any future bootstrap of another account MUST be followed by a backfill of that owner's legacy pitches/marketReports, or their data will vanish from the UI.

---

## Mutation 4 — Daniyal Invite Created

**Script:** `scripts/invite-daniyal.js` (Admin SDK, calling the real `createWorkspaceInvite()` service)

| Field | Value |
|-------|-------|
| Invitation ID | `RIpTodxC2DowSfLRbJux` |
| Workspace | `ws_bootstrap_charles` |
| Email | `daniyal@pathsynch.com` |
| Role | `contributor` |
| Status | `PENDING` |
| Expires | July 2, 2026 |

Created via script because the browser token path was BLOCKED by GCP Secure Token API restriction (see Open Items below).

Accept URL: `https://app.synchintro.ai/?inviteToken={token}`. Email match NOT required to accept.

---

## Critical State Flags

### Production is Ahead of Main

All 4 mutations ran live, but the code is on feature branches, NOT merged to main:
- **functions + rules:** `feature/phase3c-offboarding-share-cutover`
- **hosting:** `fix/remove-public-pitch-rule-p0` (synchintro-app)

PRs #38 + #39 are open. **A deploy from main today would REGRESS the pitch leak fix.** Main must be reconciled with what's deployed.

### Commit

`c13ed1a` (pushed to origin).

---

## Open Items (Carry Forward)

| Item | Severity | Description |
|------|----------|-------------|
| onepagers leak | P0 | `onepagers` has identical `shareId != null` unauthenticated read in `firestore.rules` (synchintro-app and deployed rules). No server share endpoint exists yet. Needs same build-endpoint -> migrate-page -> remove-rule pattern used for pitches. |
| GCP Secure Token API restricted | P0 | `securetoken.googleapis.com` returns 403 "granttoken-are-blocked". Broke browser Firebase ID token refresh (caused invite browser path to 401). LIKELY caused by recent GCP API key restriction sweep. RISK: may log out real users when tokens expire. Fix: allow `securetoken.googleapis.com` / Identity Toolkit API in GCP API key restrictions. |
| Brief Williams | P1 | Solo production rules deploy + workspace bootstrap ran without his review (he was unreachable; justified to close a live leak + meet Daniyal deadline). Send him rules diff + summary. |
| Daniyal acceptance | P1 | Confirm his `workspaceMembers` doc + workspace access once he accepts. |
| POST /analytics/track 400 | P2 | Pre-existing view-tracking bug, unrelated to tonight's changes. |
| SendGrid key .env-only | P2 | Not a Firebase secret (F-003 still open). Invites work via direct link regardless. |
