# Gate 1 Strategy Review — Member Onboarding Fix — 2026-07-20

**Status: AWAITING CHARLES'S APPROVAL. Nothing built.**
**Diagnosis**: `MEMBER_ONBOARDING_REGRESSION_2026-07-20.md` (same date, repo root). Root cause: the onboarding wizard + `auth.js` gate have zero member awareness; the 07-17 identity fix armed a dormant (2026-05-13) owner-only guard on `updateSellerProfile`, hard-blocking every invited member at the first wizard Continue.

---

## 1. Proposed fix

**Frontend-only. One repo (`synchintro-app`), one branch: `fix/member-onboarding-seller-profile`. No backend changes, no `firestore.rules` changes** (⇒ no emulator-suite requirement; Williams still merges — this is auth/entitlement territory).

### A. Member-aware onboarding gate (`js/auth.js`)

In `onAuthStateChanged`, after `getCurrentUser()`: if `userData._isWorkspaceMember === true && !userData.onboardingCompleted`, route to a **member onboarding flow** (`OnboardingPage.initMember()`) instead of `OnboardingPage.init()`. Strictly additive branch — owners never carry the flag (they short-circuit on their own `teams/{uid}` doc before the overlay), non-members are untouched.

### B. Member flow = personal profile only (`js/pages/onboarding.js`)

A single "Welcome to {workspace}" step: confirm display name (pre-filled from Google/`users` doc), optional title/role field. **Save path uses only member-safe own-doc writes**: `API.updateUser({name, title})` + `API.completeOnboarding()` (`api.js:2276` — own-doc `set merge`, allowed by rules, already used by the owner flow). Then land in the app (`App.init()` → pitches). **Zero `updateSellerProfile` calls.** Seller-profile inheritance already works via the workspace-context overlay — nothing to save.

The member flow ignores `onboardingStep` resume logic (Abby has step>0 from her 07-15 free-account start; she must not resume the owner wizard).

### C. Defense in depth: the wizard can never again ask a member for the owner-only write

In `nextStep()` (`onboarding.js:2955`) and `completeOnboarding()` (`onboarding.js:3012`): resolve `this.isMember` once at `init()` from `getCurrentUser()._isWorkspaceMember`; when true, **skip the `API.updateSellerProfile()` call** (proceed with `updateOnboardingStep`/`completeOnboarding`, which are member-safe). This guarantees the acceptance criterion "no code path asks a member to save the workspace seller profile" even if some future path re-enters the full wizard. No-op for owners.

**The guard at `api.js:707-709` stays exactly as is.**

### D. (Recommended include — Charles decides) Consume `?inviteToken=`

Today the token in the invite email is dead client-side, and the legacy `?invite=` path posts a body the Phase-3A backend rejects. Membership works only via the verified-email self-heal — invitees signing in with a different email than the invite **cannot join**, contradicting the documented contract ("Email match NOT required to accept").

Proposed (small diff, same PR): on load, if `?inviteToken=` present and user signed in, `POST /team/accept { inviteToken }` (works in both the onboarding and onboarded branches), clear the param, bust the user cache; update `acceptTeamInvitation()` (`api.js:3710`) to send `inviteToken`. If you prefer minimal blast radius, we defer this to a follow-up PR — Abby's class (matching email) is fully served by A–C. **Default if unspecified: include.**

## 2. Acceptance mapping (Charles's bar)

| Requirement | How it's met |
|---|---|
| Member accepting an invite token inherits workspace Seller Profile automatically | Already works (workspace-context overlay + self-heal); D extends it to non-matching-email invitees |
| Completes **only their personal profile** | New member flow (B): name/title only |
| Lands in the app | B: `completeOnboarding()` → `App.init()` |
| Never sees owner-only seller-profile write steps | A: gate branches before the wizard |
| No code path asks a member to save the workspace profile | C: wizard-level skip + retained `api.js` guard |
| Owner-only guard stays | Untouched |

## 3. Blast radius (every caller of changed code)

| Surface | Change | Risk |
|---|---|---|
| `auth.js` gate (every sign-in) | New branch on `_isWorkspaceMember === true` only | Owners/non-members: provably unchanged (flag never set for them). Members: new flow |
| `onboarding.js` owner wizard | `isMember` short-circuit in 2 functions; new member step | No-op when flag false (all current owner users) |
| `API.updateSellerProfile` callers | `onboarding.js:2955/3012` — skipped for members. `settings.js:2100/2155` (product merge saves) — **unchanged**; members reaching Settings post-fix and editing products will still get the guard error. Pre-existing; flagged as follow-up (hide/disable owner-only edit affordances for members) | Known, contained |
| `API.completeOnboarding` / `updateOnboardingStep` | Now also called by member flow — same own-doc writes the owner flow already performs | Rules-verified today |
| Backend | None | — |
| Degraded mode: `workspace-context` call fails transiently at gate time | Member misclassified as non-member → full wizard against own doc (guard passes, flag false) — **pre-existing behavior, unchanged** | Self-corrects on next resolution |
| (If D included) `auth.js` load path + `acceptTeamInvitation` body | Token POST is idempotent server-side (already-accepted → error caught + warned, non-blocking, matching existing `handleInviteAcceptance` pattern) | Small |

## 4. What could go wrong / mitigations

1. **Stale `getCurrentUser()` cache mis-sets `isMember`.** Gate uses the fresh sign-in-time call; wizard resolves once at init from the same object. Acceptable.
2. **Member flow writes collide with overlay fields.** `updateUser` writes only `name`/`title`/`updatedAt` — disjoint from overlaid plan/profile fields (which are in-memory only, never persisted to the member doc).
3. **Owner regression.** All changes are behind `_isWorkspaceMember === true`; existing owner Playwright spec must stay green (test c).
4. **A member who *should* be an owner** (edge: owner flagged as member) — impossible by construction: owners short-circuit before the overlay (`api.js:204`, `ownerTeamDoc.exists`).
5. **Invite expired before first login** — self-heal declines, user is a plain free user in the owner wizard (current behavior). Fresh invite required; out of scope (backend #60 already added expiry-aware pre-checks).

## 5. Rollback

Single frontend PR revert → hosting auto-deploys the revert (F-703 smoke gate applies). No data migrations, no schema changes, no backend coupling. Worst case equals today's state.

## 6. Test plan (same PR, Playwright e2e per repo convention, emulator-backed)

a. **Member invite path**: seeded member (membership + owner profile) with `onboardingCompleted:false` signs in → sees member welcome step, not the owner wizard → completes → lands in app; assert **no** `sellerProfile` write on the member doc and no owner-doc write.
b. **Inheritance**: post-onboarding, member's view exposes the workspace seller profile (overlay fields present, e.g. Settings read surface).
c. **Owner path unchanged**: existing `onboarding.spec.js` green, plus explicit owner Continue → profile saved.
d. **The exact regression**: member routed into the full wizard context (simulating re-entry) presses Continue → advances **without** calling `updateSellerProfile` and without the "can only be edited by the workspace owner" alert. (Asserted via route/network interception + absence of alert.)
(If D included) e. `?inviteToken=` present at load → `POST /team/accept {inviteToken}` fired, param cleared.

Frontend baseline: run existing Playwright suite pre-change in the worktree, record counts, report exact before/after. Backend suite untouched (no backend changes) — will still run once in the backend worktree only if any backend file ends up touched (not planned).

## 7. Build mechanics

- Worktree from `origin/main`: reuse `C:\Users\tdh35\wt-member-frontend` (re-point to a new branch `fix/member-onboarding-seller-profile` off `origin/main`). Dirty C5 trees untouched.
- No deploys this session. Frontend hosting auto-deploys on merge (F-703 smoke gate). `/js/**` is served no-cache, so Abby gets the fix on her next page load after Williams merges.
- Gate 2 review doc: `prd-review-member-onboarding-2026-07-20.md` before the PR opens.

## 8. Abby's unblock path (goes in the PR description)

1. Williams merges → hosting auto-deploy (~minutes, gated on smoke test).
2. Abby reloads `app.synchintro.ai` and signs in (no need to re-click the invite link — her membership was already self-healed on 07-20; the fix routes her to the member welcome step).
3. She confirms her name → lands in the app with Charles's workspace profile inherited. Expected: no seller-profile write, no error.
4. Optional pre-verification with a throwaway invite + test account before asking Abby to retry.

**Data repair: none expected.** Her membership exists (the guard firing proves resolution succeeded) and her own doc took no writes from the failed saves. If Charles wants her unblocked **before** the PR lands, a one-line patch (`users/C4BfVjmSwLY6tlBEjz4IPNZj6px1` → `onboardingCompleted: true`) would skip the wizard on next login — proposed as a separate, explicitly-approved script step (modeled on `scripts/invite-daniyal.js` conventions), **not run this session**.

## 9. Open questions for Charles (Gate 1)

1. **Include D (`?inviteToken=` consumption) in this PR?** Recommended yes (it's in your acceptance-bar language and closes the non-matching-email hole); can defer if you want the smallest possible diff.
2. **Member personal step contents**: name only, or name + title/role? Recommended: name + optional title (both member-safe own-doc fields).
3. **Immediate data unblock for Abby** (the `onboardingCompleted` patch) while the PR is in review — yes/no?
4. **Settings follow-up**: members can still trigger the guard error via product edits in Settings (`settings.js:2100/2155`). File as a follow-up ticket, or fold hiding those edit affordances for members into this PR? Recommended: follow-up ticket (keep this PR single-purpose).
5. **Confirm the proposed production reads** in the diagnosis §6 (three read-only GETs to verify the self-heal fired) — run them, or skip as unnecessary? Recommended: skip unless something surprises us post-deploy.

---

## 10. Gate 1 DECISIONS (Charles, 2026-07-20)

1. **APPROVED — build.** Branch `fix/member-onboarding-seller-profile` in the frontend worktree from `origin/main`.
2. **Defer D** (`?inviteToken=` consumption) to a follow-up PR — this PR is wizard-fix only.
3. **No immediate data patch for Abby** — she's unblocked by the PR at next login after Williams merges.
4. **Member step contents:** name (pre-filled from Google, confirmable) + optional job title + optional booking/calendar link (plain URL field). Nothing else — headshot, phone, signature stay in Settings. All three are member-safe own-doc fields.
5. Settings owner-only edit affordances for members: follow-up ticket (default). Production verification reads: skipped (default).

**Gate 1 CLOSED — proceeding to Phase 2 build.**
