# Changelog — June 8, 2026

**Session type:** Security-focused. No new features shipped.
**Driven by:** `SYNCHINTRO_AUDIT_REPORT_2026-06-08.md` (80/100, grade B, 41 findings: 1 P0, 7 P1, 24 P2, 9 P3)

---

## Summary

This session was a targeted security response to the June 8, 2026 platform audit. Three concrete shipments closed four audit findings. No product features were modified.

---

## Shipment 1 — F-001: Firebase Service Account Key Removal

**Severity:** P0
**Status:** Closed at repo level; GCP Console rotation pending

### What happened

The audit identified a Firebase service account key file on disk:
`functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json`

**Actions taken:**
- Deleted key file from local disk
- Verified key was **never committed to git**: `git log --all --full-history -- functions/pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json` returned empty
- Verified no code in repo references the key file: `git grep` returned clean
- F-002 (suspected committed .env) was a false alarm — verified clean in audit

**Outstanding:** Charles must rotate the key in GCP Console → IAM & Admin → Service Accounts → pathsynch-pitch-creation. Target: EOD June 8 or first thing June 9, 2026.

**Note on F-017 (VertexAI migration):** Audit flagged a June 24 deadline. Zero `@google-cloud/vertexai` imports exist in this repo (`grep` confirmed). This finding likely refers to PathManager or synchintro-app, not this repo.

---

## Shipment 2 — F-013: npm Audit Fix

**Severity:** P1 (follow-up — axios CVE was already resolved in main before this session)
**Branch:** `fix/npm-audit-axios-june8`
**Commit:** `df2f8d6` — "fix(deps): npm audit fix — transitive cleanup (F-001 follow-up)"
**PR #17:** Merged to main (`a9f6410`) — NOT YET DEPLOYED to production

### What happened

`npm audit` in `functions/` confirmed zero axios issues (the critical SSRF/prototype-pollution/CRLF/auth-bypass CVEs were already resolved in a prior session).

Ran `npm audit fix` — this performed transitive lockfile cleanup only. No `package.json` changes.

**9 remaining moderate-severity findings** (all transitive):
- All route through `uuid` inside firebase-admin, gaxios, google-gax, teeny-request, or jest-junit
- Not exploitable in our code path: the uuid v3/v5/v6 buffer-bounds bug only triggers when the caller passes a custom buffer argument, which Firebase Admin internals do not do
- No direct fix available without waiting for firebase-admin or google-gax upstream updates

**Deployment:** PR #17 merged to main. A production deploy (`firebase deploy --only functions`) is required before this lockfile cleanup takes effect.

---

## Shipment 3 — F-004 + F-005: Firestore Rules Tightening

**Severity:** P1 (both)
**Branch:** `fix/firestore-rules-f004-f005`
**Commit:** `48bb869` — "fix(firestore-rules): tighten pitchAnalytics and icpProfiles ownership (F-004, F-005)"
**PR #18:** Open for Williams review — NOT YET MERGED, NOT YET DEPLOYED

### F-004 — pitchAnalytics cross-tenant write vulnerability

**Problem:** `allow create, update: if isAuthenticated()` on `pitchAnalytics/{pitchId}` allowed any authenticated user to write analytics for any pitch, regardless of ownership. This enables cross-tenant analytics manipulation.

**Fix:**
```
// Before
allow create, update: if isAuthenticated();

// After
allow create, update: if isAuthenticated() &&
  get(/databases/$(database)/documents/pitches/$(pitchId)).data.userId
    == request.auth.uid;
```

**Schema confirmation:** `/pitches/{pitchId}` is the canonical pitch collection, verified at `firestore.rules` lines 52-75. The `pitchId` wildcard in `pitchAnalytics/{pitchId}` is the same document ID. Ownership field is `userId` on the pitch document. `get()` without `exists()` wrapper matches the existing pattern used in `prospectIntel` subcollection rules (lines 482-490).

**Client-side impact:** The `trackShare()` client function must be called by the pitch owner. The public track-view endpoint writes via Admin SDK (bypasses rules) and is unaffected.

### F-005 — icpProfiles default-create bypass

**Problem:** `allow create: if isAuthenticated() && (request.resource.data.isDefault == true || ...)` allowed any authenticated user to create ICP profiles with `isDefault: true`, polluting global default profiles shared across all users.

**Fix:**
```
// Before
allow create: if isAuthenticated() &&
                (request.resource.data.isDefault == true ||
                 request.resource.data.userId == request.auth.uid);

// After
allow create: if isAuthenticated() &&
                request.resource.data.userId == request.auth.uid;
```

**Client-side impact:** Any client-side code that seeds default ICP profiles via batch.set with `isDefault: true` will be blocked after this rule is deployed. Default profiles must be seeded via Admin SDK / Cloud Function only. The existing read rule (`allow read: if isAuthenticated()`) is unchanged — default profiles remain visible to all users.

### Validation

- `firebase deploy --only firestore:rules --dry-run` — **PASSED** (rules compiled successfully against `pathsynch-pitch-creation`)
- No Firestore rule tests exist in the repo (noted in PR description)

---

## Adjacent Flags Surfaced (Not Fixed — Scope-Fenced)

These issues were spotted during the F-004 investigation but intentionally not fixed in this PR to maintain a clean scope fence:

1. **`pitchAnalytics` events/shareEvents subcollections (lines 128-138):**
   `allow create: if isAuthenticated()` — same class of cross-tenant write bug as F-004, affecting the subcollection level. Any authenticated user can create analytics events under any pitch's analytics document. Should be added as a new audit finding (P1).

2. **`pitchAnalytics` allow read:**
   `if isAuthenticated()` — any logged-in user can read view/click counters for any pitch. No PII exposure (counters only), but metrics leakage. Deferred — privacy nit, not a security flaw.

---

## Process Notes

### PR Review Invariant

**PR #17 (lockfile-only):** Self-merged by Charles — acceptable. Lockfile-only changes are covered under the Build OS/infrastructure Option B invariant (Charles may self-merge infrastructure/deps/docs PRs).

**PR #18 (production Firestore security rules):** Should have been routed to Williams for review per the Option B PR review invariant before merge. This PR is open and correctly pending Williams's review.

**Going forward:** Any change touching `firestore.rules`, `functions/` code, or frontend code routes through Williams (`dev1@pathsynch.com`) before merge. No exceptions for production security rules.

---

## Remaining P0/P1 Backlog

Priority order — all in Williams's domain:

| # | Finding | Severity | Why Pending |
|---|---------|---------|-------------|
| 1 | **F-001 GCP Console key rotation** | P0 | Charles action required in GCP Console |
| 2 | **F-018: html2pdf.js → 0.14.0** (XSS) | P1 | ~3 weeks open; requires PDF export regression test in staging before applying |
| 3 | **F-003: Stripe live key → Firebase Secret Manager** | P1 | Not started |
| 4 | **F-006: SpyFu password in .env.example** | P2 | Not started |
| 5 | **F-021: opportunityBriefService.js → generateStructured()** | P2 | Legacy indexOf('{') pattern; low blast radius but tech debt |
| 6 | **F-022: market.js enhancement call → generateStructured()** | P2 | Same as above |

---

## Deployment Status

| Change | Merged | Deployed |
|--------|--------|---------|
| F-013 npm audit fix (PR #17) | ✅ Yes (`a9f6410`) | ❌ No — requires `firebase deploy --only functions` |
| F-004/F-005 Firestore rules (PR #18) | ⏳ Pending Williams review | ❌ No |

**Deploy command (when ready):**
```bash
firebase deploy --only functions,firestore:rules --project pathsynch-pitch-creation
```

---

## Audit Report Reference

- **Full report:** `SYNCHINTRO_AUDIT_REPORT_2026-06-08.md` at repo root (~51KB, 41 findings)
- **File tree:** `AUDIT_TREE.txt` at repo root (478 lines)
- **Status:** Both files currently untracked. Recommend committing in a follow-up docs commit so they survive any local working tree reset.
- **Grading:** 80/100 (grade B). Previous audit (May 13, 2026) scored 79/100 (B+).
