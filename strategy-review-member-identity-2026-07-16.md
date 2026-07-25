# Gate 1 Strategy Review - Workspace Member Identity / Plan Inheritance Fix

**Date**: 2026-07-16
**Author**: Claude Code (diagnosis + strategy; no code written)
**Evidence**: `SELLER_PROFILE_DIAGNOSIS_2026-07-16.md` (this repo root)
**Status**: GATE 1 COMPLETE (all five questions answered as of 2026-07-16; see section 8). No code, no data writes, no deploy yet. Build may proceed on explicit go-ahead.
**Merge gate (AMENDED by Charles, 2026-07-16)**: Williams is NOT involved in this fix. Charles is the sole review and merge gate. Standing safeguards that survive the amendment: (1) the build session does not merge, deploy, or write production data without an explicit instruction from Charles in chat, regardless of permission mode; (2) Gate 2 includes an adversarial self-review of the auto-accept security surface and a regression pass on `getCurrentUser`, since no second human reviews the code; (3) Charles personally skims the Gate 2 summary and the auth-adjacent diff before saying "merge."

---

## 0. Decisions recorded (Charles, 2026-07-16)

1. **No immediate DATA PATCH.** Daniyal waits for the code fix. Consequence: the code fix must itself deliver a working end-to-end path for Daniyal, whose invite is EXPIRED (2026-07-06) - see Enhancement E2.
2. **Dedicated new endpoint approved**: `GET /me/workspace-context`. Do not extend `GET /team`.
3. **Bundling approved**: Pitch Success Insights fix + `_fmtDate` fix ride with the root-cause fix on one branch.
4. Still open: auto-accept posture (now a Williams security decision - E3) and how to branch without disturbing the protected working tree (Q5).

---

## 0b. Enhancements from governance-doc review (2026-07-16, post-approval)

A sweep of `functions/SYSTEM_BIBLE.md`, `functions/CLAUDE.md`, frontend `CLAUDE.md`, and all commits from 2026-07-09 to 2026-07-15 surfaced facts that strengthen and sharpen this plan:

**E1 - The server-side inheritance infrastructure already exists; the endpoint is composition, not construction.**
Phase 2 (June 22-23, `functions/CLAUDE.md` Phase 2 Completion Record) already shipped workspace inheritance server-side: `getUserPlan(userId, {workspaceId})` resolves the workspace owner's plan via `workspaces/{wsId}.entitlementOwnerUid` (planGate.js:23-40), `resolveBrand()` inherits workspace branding from the server-only `workspaceBranding/{wsId}`, and `workspaceResolver` middleware resolves membership from `workspaceMembers` and sets `req.workspaceId`/`req.workspaceMembership`. All of it is emulator-tested (26/26, Gate #7). `GET /me/workspace-context` should therefore be a thin composition: `getWorkspaceForUser(uid)` -> `getUserPlan(uid, {workspaceId})` -> owner `sellerProfile` read, plus membership metadata. Build nothing new at the resolution layer; reuse `acceptWorkspaceInvite` for any acceptance write (it already maintains BOTH `teams/{ownerUid}.members[]/memberUids[]` AND `workspaceMembers` - do not reimplement the dual-write).

**E2 - The invitation acceptance loop is completely severed - three independent breaks, so the fix must restore acceptance, not just resolution.**
(a) The invite token email never sends (`SENDGRID_API_KEY` unset - SYSTEM_BIBLE line 371, still pending). (b) The client auto-accept fallback is dead code (inside the rules-blocked `try` - diagnosis section 4c). (c) NEW: even if it ran, it would fail - `js/api.js` calls `acceptTeamInvitation(<invitationId>)`, but `POST /team/accept` post-Phase-3A **fully blocks ID-based acceptance** and requires the cryptographic `inviteToken` (teamRoutes.js:283-335, "Legacy ID-based accept - FULLY BLOCKED"), and that token exists only in the never-sent email (and in the invite-creation response shown to the owner). Net: **no invitee can join a workspace today by any self-serve path.** This is the true systemic root cause behind all three incidents (mariadeth April, Daniyal June 29, support+daniyal July). The fix is incomplete unless one acceptance path works end-to-end.

**E3 - Auto-accept is now a deliberate security decision for Williams, not a convenience toggle.**
Phase 3A intentionally moved acceptance to token-only ("Binds by token+UID. Email match NOT required.") - possession of the emailed token is the proof. Having `GET /me/workspace-context` auto-accept on an email match partially reverses that design. Proposed constraints if we go that way: auto-accept only when (i) the Firebase auth token has `email_verified == true`, (ii) `token.email` lowercased exactly equals `inviteeEmail`, (iii) invite is `pending` and unexpired, (iv) server-side via `acceptWorkspaceInvite`. For a Google-sign-in user this proves control of the invited mailbox, which is arguably as strong as token possession - but it is a documented exception to Phase 3A and must be called out to Williams as such. Alternative: resolve read-only and fix SendGrid so the token path works; slower for Daniyal.

**E4 - Daniyal specifically needs a fresh invite.** His invite expired 2026-07-06. Whatever acceptance path lands, Charles must re-invite him (support's invite is valid until 2026-07-22; mariadeth needs a fresh invite too - she is also absent from `memberUids`). Fold "re-invite all three members" into the rollout step, after the fix deploys.

**E5 - This is the third manual intervention on the same failure class.** `functions/CLAUDE.md` (June 29 session) records a prior Daniyal incident: stuck onboarding from an orphaned pending `teamInvitations` doc, cleared manually via console; a fresh invite was created that same evening (22:25 UTC - the one that then expired unaccepted). April: mariadeth's manual `memberUids` write. Gate 2 should include a regression test that a never-accepted invitee resolves correctly, so this class cannot silently recur.

**E6 - CI now supports the right test shape.** F-601 landed 2026-07-14 (PR #50): emulator-backed rules tests gate merges. The new endpoint's tests should include emulator rules coverage (member resolution + acceptance path). Note the suite baseline has moved past the audit's 1,710 (F-201 reconciler etc. added tests July 14-15) - re-baseline at build time, do not chase 1,710.

**E7 - Update the governance docs in the same PR.** Frontend `CLAUDE.md` still documents the client memberUids query + auto-accept as the working inheritance design, and `SYSTEM_BIBLE.md` still lists the acceptance/SendGrid state ambiguously. The fix PR should correct both narratives so the next session does not rediscover this from scratch (see the conflicts analysis accompanying this review).

---

## 1. Problem being fixed

Workspace members (support@, daniyal@, previously mariadeth@) never resolve as members on the client, so they fall back to their own free-tier `users` doc: no inherited Seller Profile, Report Branding shows "requires Scale+", and (once a plan does resolve) Pitch Success Insights spins forever. Root cause and full evidence are in the diagnosis. This review covers the fix for the **primary root cause** (member resolution) and names the two small dependent fixes that should ride with it.

**In scope for this fix:**
1. Member plan/tier/subscription + Seller Profile resolution (the root cause).
2. Pitch Success Insights spinner (render/loader plan-source divergence) - independent bug that becomes visible the moment inheritance works, so it must ship together or members trade one broken card for another.
3. "Invalid Date" in the Settings team list (`_fmtDate` timestamp-shape mismatch) - trivial, same file, same user-visible surface.

**Explicitly NOT in this fix (separate tracks):**
- Seller Profile workspace-rescoping (diagnosis section 9) - Medium/Large data-model change, its own PRD after this lands.
- SendGrid key wiring (config/ops task, not code).
- "hello / hello" display-name fallback, pending-invite avatar guard, AIsynch `TIER_RANK` - cosmetic/other-product; backlog.

---

## 2. Why the obvious client-only fix does not work

The tempting minimal fix is "move the `teamInvitations` email fallback out of the `try` that throws." It fails for two independent, rules-level reasons, both now confirmed against `firestore.rules` on `main`:

1. **Membership discovery is blocked.** `teams` `allow list` requires `uid == ownerUid` (rules:578). A member's `array-contains` list query is rejected, so the client cannot discover which workspace/owner it belongs to.
2. **The owner-doc read is blocked too.** The overlay reads `users/{ownerUid}` to get the plan/sellerProfile. `users` `allow read` (rules:40-43) permits a cross-user read only if `request.auth.uid in teams/{ownerUid}.memberUids`. An invitee who has not accepted is **not** in `memberUids`, so even if the email fallback ran and found `teamOwnerUid`, the subsequent `users/{ownerUid}.get()` is denied.

So any purely client-side path is stuck behind the rules unless we first write the member into `memberUids` (an Admin-SDK-only write; `teams` is `write:false`). The resolution has to be server-side. The rules comment already says as much: "member team lookups must go through the backend API (GET /team)."

---

## 3. Options considered

### Option A (RECOMMENDED) - backend resolver endpoint, client overlays from it
Add or extend a backend endpoint (Admin SDK, bypasses rules) that, for the authenticated caller:
- resolves their workspace membership via `getUserTeam(uid)` (already exists, used by `GET /team`);
- if they are a member (or have a valid, unexpired pending invite for a workspace), auto-accepts the invite server-side (writes `memberUids` + `workspaceMembers`) so future loads are clean;
- returns the **effective** plan/tier/subscription computed by `getUserPlan()` (the documented single source of truth in `planGate.js`) plus the workspace Seller Profile.

`getCurrentUser()` calls this only in its existing non-owner branch and overlays the result. Owners and solo users are untouched.

- **Pros**: works within the hardened rules (the whole point); centralizes plan resolution on the server where it already belongs (`getUserPlan`); self-heals membership; fixes mariadeth-class regressions permanently; expiry and case handled server-side.
- **Cons**: adds a backend round-trip to `getCurrentUser` for members (mitigated by the existing 5-min cache and the owner/solo short-circuit); touches the single most-called frontend function - regression risk if not carefully guarded; new/extended endpoint needs tests.

### Option B - client-only, restructure the fallback
Move the email fallback out of the throwing `try` and read the owner doc.
- **Rejected**: blocked by both rules above (section 2). Cannot read the owner doc pre-membership. Would also silently apply expired invites (daniyal's) and depends on case-exact email matching. Non-viable under current rules.

### Option C - loosen the Firestore rules to permit the member array-contains list / cross-user read
- **Rejected**: directly re-opens the tenant-isolation surface the 2026-05-05 lockdown (`3b3cb81`) closed. Exactly the F-101/Gate-#7 hazard the prior audit flagged. Not acceptable.

### Immediate DATA PATCH (orthogonal, to unblock Daniyal now)
Independent of A/B/C: write `subscription`, `plan`, `tier` (copied from owner) and `sellerProfile` (copied from `users/{ownerUid}.sellerProfile`) directly onto the member's own `users/{uid}` doc. `getCurrentUser` reads the member's own doc first (`isOwner` read, always permitted), so this resolves everything except Pitch Insights without a deploy. This is a stopgap, not the fix; Option A supersedes it.

**Recommendation: ship Option A for the durable fix; optionally apply the DATA PATCH first to unblock Wave 1 today, with your explicit go-ahead since it writes production data.**

---

## 4. Blast radius

- **`getCurrentUser()` (`js/api.js`)** is called on nearly every page (dashboard, create, market, settings, onepager, pitches, precall, prospectIntel, onboarding, app.js, auth.js). Highest-risk surface. Guard rails: change only the non-owner membership branch; keep the owner/solo path byte-for-byte; preserve the 5-min cache; ensure a backend failure degrades to the member's own doc (current behavior) rather than throwing.
- **New/extended backend endpoint** - additive; if it is a new route, zero risk to existing routes. If we extend `GET /team`, we must not change its existing response shape (Settings depends on it).
- **`getUserPlan()` / `planGate.js`** - read-only reuse; do not modify the source of truth.
- **Pitch Insights fix** - isolated to `settings.js` render/loader plan resolution; affects only that card.
- **`_fmtDate` fix** - isolated to the Settings team list rendering.
- **Firestore rules** - NOT touched by this fix. State that explicitly in Gate 2. (This is what keeps the change deployable without a rules change and without touching the F-101 surface.)
- **Data**: the auto-accept write adds members to `memberUids`/`workspaceMembers`. That is the intended self-heal, but it is a production write path - it must be idempotent and must validate invite ownership + expiry server-side.

---

## 5. What could go wrong

1. **Regression for owners/solo users** if the non-owner guard is imperfect. Mitigation: explicit `ownerTeamDoc.exists` short-circuit stays first; unit-test owner and solo paths unchanged.
2. **Added latency / new failure mode on every member page load.** Mitigation: cache; fail-soft to own-doc; only fire on the membership branch.
3. **Auto-accept writing bad state** (accepting an expired or wrong-owner invite, double-adding). Mitigation: server validates `teamOwnerUid`, `status==pending`, `expiresAt>now`, and dedupes `memberUids`; idempotent.
4. **Seller Profile source ambiguity.** Today there is no workspace-scoped profile; the resolver returns the owner's `users/{ownerUid}.sellerProfile`. That is correct for now but is a stopgap until the rescoping PRD. Note it so we do not bake in assumptions the rescope will break.
5. **Pitch Insights fix reveals real data-load errors** previously masked by the never-firing loader. That is desirable (the catch shows "Failed to load"), but call it out so it is not mistaken for a new bug.
6. **Deployed-rules uncertainty.** The fix assumes the hardened `allow list` is live (consistent with observed behavior). If live rules are actually looser, Option A still works (Admin SDK is rules-independent); no downside. Still: confirm deployed rules in console as an owner action.
7. **Test baseline.** Suite baseline is 1,710 green; new endpoint + resolution logic ship with tests in the same PR.

---

## 6. Rollback

- **Code**: single revert of the fix PR restores prior `getCurrentUser` behavior; owners/solo unaffected throughout. A new endpoint is dead once the client stops calling it.
- **Data (auto-accept writes)**: adding a UID to `memberUids` is forward-compatible and does not need rollback; if a bad accept occurs, remove the UID via the existing `POST /team/remove` (Admin SDK). The immediate DATA PATCH (own-doc plan overlay) is reversible by clearing the added fields.
- **No rules change**, so no rules rollback risk.

---

## 7. Sequencing (updated per Decisions Recorded)

1. ~~DATA PATCH~~ - **declined by Charles 2026-07-16**; Daniyal waits for the code fix.
2. Cut a dedicated `git worktree` in each repo from `main` (backend branch `fix/member-plan-resolution`, matching frontend branch); protected WIP trees untouched (Q5 decided). `npm ci` in the backend worktree's `functions/` before running the suite.
3. Build `GET /me/workspace-context` (approved) as a composition over existing Phase 2/3A services (E1), with constrained verified-email auto-accept per Q3 (decided; flagged for Williams at PR); `getCurrentUser` overlays from it in the non-owner branch only. Bundle the Pitch Insights and `_fmtDate` fixes (approved).
4. Tests in the same PR, including emulator rules coverage (E6); full suite green at the current baseline.
5. Update SYSTEM_BIBLE.md / CLAUDE.md narratives in the same PR (E7).
6. Gate 2 review (adversarial self-review per the amended merge gate), then STOP at PR handoff for Charles. Charles skims the diff and says "merge" explicitly. No self-merge, no deploy without an explicit instruction in chat.
7. Post-merge rollout: deploy on Charles's explicit "deploy" (note: Firebase CLI likely needs `npx firebase login --reauth` in an interactive terminal), then Charles re-invites daniyal + mariadeth (expired/absent) and confirms support resolves (E4). Separately: wire `SENDGRID_API_KEY` (ops task).

---

## 8. Questions for the approver (Gate 1 sign-off)

1. ~~**Unblock now?**~~ ANSWERED 2026-07-16: no data patch; wait for the code fix.
2. ~~**New endpoint vs extend `GET /team`?**~~ ANSWERED 2026-07-16: dedicated `GET /me/workspace-context` approved.
3. ~~**Auto-accept on resolve?**~~ DECIDED 2026-07-16 (Charles delegated the call): **constrained auto-accept, build it.** Rationale: token possession and a verified IdP email claim anchor to the same root of trust (control of the invited mailbox); the verified claim is not weaker. Phase 3A's real target - ID-based acceptance - stays fully blocked. Mandatory constraints, all four: (i) `email_verified === true` on the decoded Firebase token; (ii) `token.email` lowercased exactly equals `inviteeEmail`; (iii) invite is `pending` and unexpired (no resurrecting expired invites); (iv) acceptance via existing `acceptWorkspaceInvite` (preserves the teams/workspaceMembers dual-write) with a `workspaceAuditLog` entry marked e.g. `verified-email-auto-accept` so it is distinguishable from token accepts. The PR description MUST flag this as a deliberate, constrained exception to Phase 3A token-only acceptance, with this rationale - Williams retains veto at merge review. SendGrid wiring proceeds separately as an ops task, not a blocker.
4. ~~**Bundle scope.**~~ ANSWERED 2026-07-16: bundling Pitch Insights + `_fmtDate` approved.
5. ~~**Working tree.**~~ DECIDED 2026-07-16 (Charles delegated the call): **dedicated `git worktree` in both repos; do not wait for the govcapture-c5 session.** `git worktree add` shares `.git` but never touches the protected trees' uncommitted WIP - no branch switch, no stash. Waiting would queue a P0 (Daniyal blocked on live Wave 1) behind feature work. Practical note: the backend worktree needs its own `npm ci` in `functions/` before the suite runs; frontend worktree likewise if its tooling needs install.

---

*Gate 1 draft. No application code, config, data, or production state modified. STOP for approval before building.*
