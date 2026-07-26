# Gate 2 Review - Workspace Member Identity / Plan Inheritance Fix

**Date**: 2026-07-16
**Branch**: `fix/member-plan-resolution` (backend + `synchintro-app`, both cut from `main` in dedicated git worktrees)
**Reviewer**: self-review (adversarial), per the amended merge gate (Charles sole reviewer; Williams not involved this fix)
**Status**: BUILT + TESTED. Committed locally on the branch. NOT pushed, NO PR opened, NOT merged, NOT deployed - awaiting Charles's explicit go-ahead.
**Evidence**: `SELLER_PROFILE_DIAGNOSIS_2026-07-16.md`, `strategy-review-member-identity-2026-07-16.md`

---

## 1. What changed

### Backend (`pathsynch-pitch-generator`)
| File | Change |
|---|---|
| `functions/services/memberContextService.js` | NEW. `resolveWorkspaceContext(uid,{email,emailVerified})` - composes `getWorkspaceForUser` + `getUserPlan(uid,{workspaceId})` + owner-doc read; self-heals a pending verified-email invite. |
| `functions/routes/userRoutes.js` | NEW route `GET /me/workspace-context` (auth-gated; reads `req.userId`/`req.userEmail`/`req.emailVerified`). |
| `functions/services/workspaceInviteService.js` | Extracted the accept transaction into shared `_finalizeAccept` (so token and verified-email paths cannot drift) + shared `_validatePendingInvite`; added `acceptInviteByVerifiedEmail`; records `acceptedVia`/`joinMethod`. |
| `functions/index.js` | Propagate `req.emailVerified = decodedToken?.email_verified === true`. |
| `functions/routes/index.js` | Added endpoint to the docs list. |
| `functions/tests/memberContext.test.js` | NEW - 12 mock gate tests. |
| `functions/tests/memberContext.emulator.test.js` | NEW - 6 emulator tests (real rules + transactions). |
| `functions/CLAUDE.md`, `functions/SYSTEM_BIBLE.md` | Fix record + new invariant #12. |

### Frontend (`synchintro-app`)
| File | Change |
|---|---|
| `js/api.js` | `getCurrentUser()` non-owner branch now overlays from `GET /me/workspace-context` (removed the rules-blocked client array-contains query + dead email fallback). Net -46 lines. |
| `js/pages/settings.js` | Pitch Insights loader gate + `renderAnalyticsDashboard` now resolve the plan with the same full chain as `renderPitchInsightsSection` (fixes the infinite spinner). `_fmtDate` handles `{_seconds}`-shaped timestamps (fixes "Invalid Date"). |
| `CLAUDE.md` | Corrected the (wrong) client-inheritance narrative. |

---

## 2. Test results

- **Backend mock suite: 1796 passed, 0 failed** (67 suites), including the 12 new `memberContext` tests. Baseline moved up from the audit's 1710 due to July 14-15 additions (reconciler etc.) plus these 12.
- **Backend emulator (real Firestore + real rules):**
  - `workspacePhase3A.emulator.test.js` - **30 passed** after the `_finalizeAccept` refactor (proves the token accept path and rules denials are unchanged).
  - `memberContext.emulator.test.js` - **6 passed** (verified-email accept, member inheritance, unverified rejected, expired rejected).
- Frontend: `node --check` clean on both files. (Repo has no frontend unit suite; the F-703 Playwright smoke test runs hosting-side in CI.)

How verified: ran the mock suite and both emulator suites locally via `firebase emulators:exec` (Java 25, firebase-tools 15.22.3). The emulator rules tests are also CI-gated now (F-601), so they re-run on push.

---

## 3. Adversarial self-review (auth surface + getCurrentUser)

**Auto-accept cannot be used to escalate.** The endpoint reads the email and verification flag from the *decoded Firebase token* (`req.userEmail`, `req.emailVerified`), never from request input. `acceptInviteByVerifiedEmail` independently requires `invite.inviteeEmail === verifiedEmail` (lowercased exact). So a caller can only accept an invite addressed to their own verified mailbox. Unverified email (e.g. password accounts) -> no auto-accept (test-covered). This is strictly narrower than "anyone with the invite ID," and it preserves Phase 3A's real intent (ID-alone is never sufficient).

**No data leak to non-members.** A caller with no membership and no valid invite gets `emptyContext()` (no owner plan/profile). Owner plan/subscription/sellerProfile are only returned once membership exists - which is the intended inheritance.

**No transaction drift / TOCTOU.** Both accept paths share `_finalizeAccept`; status is re-validated inside the transaction. `inviteeEmail` is immutable (Admin-SDK-only writes; no code updates it), so the pre-transaction email check is safe. Expired invites are never resurrected (checked in `_validatePendingInvite` and again in `_findPendingInvite`).

**getCurrentUser regressions bounded.** Owner/solo short-circuit (`if (!ownerTeamDoc.exists)`) preserved. The backend call is wrapped in try/catch and fails soft (user keeps own plan) - sign-in is never blocked. Owners never call the endpoint. Solo users now make one backend call (returns empty) instead of one thrown client query - net neutral.

**Known minor, non-blocking (documented):** on the *first* load where auto-accept fires, `API.getTeam()` runs in parallel with `getCurrentUser()` and may resolve before the membership write commits, so the `isContributor` read-only flag can lag by one load (plan/branding/sellerProfile are correct immediately; `autoAccepted` clears the cache so the next load is fully correct). Self-corrects on refresh. Acceptable; called out for transparency.

---

## 4. Scope boundaries (what this does NOT do)

- **No Firestore rules change.** Deploys nothing to rules; the F-101 tenant-isolation surface is untouched. State this explicitly at merge.
- **No production data writes** were made building this.
- **Daniyal's expired invite is not resurrected** - he needs a fresh invite post-deploy (rollout step). Support's invite is valid until 2026-07-22 and will auto-accept on next sign-in once deployed.
- **SendGrid** remains unset - independent ops task; the verified-email path makes it non-blocking for these users.
- Out of scope (backlog, unchanged): "hello / hello" invite display-name, pending-invite `inv.email` guard, AIsynch `TIER_RANK`, Seller Profile workspace-rescoping PRD.

---

## 5. Review outcome (2026-07-16, Charles + fresh-eyes pass)

- Charles reviewed the Gate 2 material and the auth-adjacent diff (discussion session, Fable).
- Fresh-eyes pass swapped `_resolveRole` from a 3-filter `workspaceMembers` query to
  `getMembership`'s doc-ID get (commit `f2cae5d`). CORRECTION (noted in the follow-up
  session): the original "would FAILED_PRECONDITION without a composite index" rationale
  was overstated — the query was equality-only and Firestore likely serves it via
  automatic index merging. The doc-ID swap still stands on its own merits (one read,
  simpler, reuses the existing helper), just not for the stated index reason. All suites
  green after the fix (1796 mock + 6 emulator).
- Charles approved **push/PR**.

## 6. Rollout (post-merge, Charles-gated) — AMENDED for personnel changes

1. ~~daniyal@~~ **disregarded for now** (no data in the system). Charles will manually
   re-invite after all work is done — the verified-email auto-accept means that re-invite
   works without SendGrid: daniyal just signs in with Google afterward.
2. ~~mariadeth@~~ **dropped** — no longer with the company. No cleanup needed for this fix.
   Separate ops flag: disable her Firebase Auth account as routine offboarding.
3. **support@** is the only rollout account and is fully automatic: invite valid until
   **2026-07-22**; deploy before then and they resolve on next sign-in. After that date
   they need a re-invite too.
4. Deploy on explicit "deploy" (Firebase CLI likely needs `npx firebase login --reauth`).
5. Separately: wire `SENDGRID_API_KEY` so future invite emails send.

*Self-review + Charles review. No merge, no deploy, no production data writes. Push/PR approved 2026-07-16; merge and deploy remain explicitly Charles-gated.*
