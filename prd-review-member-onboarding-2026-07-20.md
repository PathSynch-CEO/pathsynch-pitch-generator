# Gate 2 Review — Member Onboarding Fix — 2026-07-20

**Branch**: `synchintro-app` `fix/member-onboarding-seller-profile` (commit `8090d9b`), built in worktree `C:\Users\tdh35\wt-member-frontend` from `origin/main` (`3a5b4ca`). Backend untouched. Protected dirty C5 trees untouched.
**Gate 1**: `strategy-review-member-onboarding-2026-07-20.md` §10 — approved 2026-07-20 (D deferred, no data patch, member step = name + optional title + optional booking link).
**Diagnosis**: `MEMBER_ONBOARDING_REGRESSION_2026-07-20.md`.

---

## 1. What changed (3 files, +538/−5)

| File | Change |
|---|---|
| `js/auth.js` (+13/−4) | Onboarding gate branches on `userData._isWorkspaceMember` → `OnboardingPage.initMember(userData)`; owners/non-members take the exact prior path. Strictly additive — the flag is only ever set by the workspace-context overlay, never for owners. |
| `js/pages/onboarding.js` (+207/−1) | (a) `initMember()` + `renderMember()` + `completeMemberOnboarding()`: single welcome step (name pre-filled, optional job title, optional booking URL — field names follow existing `jobTitle`/`bookingUrl` conventions), saved via `API.updateUser()` + `API.completeOnboarding()` — own-doc writes only, **zero `updateSellerProfile` calls**; ignores `onboardingStep` resume on purpose. (b) Defense in depth: `init()` records `this.isMember` from `getCurrentUser()`; `nextStep()` and `completeOnboarding()` skip the `API.updateSellerProfile()` call when set (their own-doc `updateOnboardingStep`/`completeOnboarding` writes still run) — so even a stray re-entry into the full wizard can never hit the owner-only write. (c) `_escAttr()` helper — member-supplied values are escaped before HTML interpolation (the legacy wizard interpolates raw; new code doesn't repeat that). |
| `tests/e2e/memberOnboarding.spec.js` (new, 6 tests) | See §2. |
| `js/api.js` | **Untouched** — the owner-only guard at `api.js:707-709` stays exactly as deployed. |

## 2. Test results

**New spec — 6/6 green** (chromium, Firebase auth+firestore emulators, `npx playwright test tests/e2e/memberOnboarding.spec.js --project=chromium`):

- (a) member sees the personal-profile step, never the owner wizard (asserts no progress bar, no `#companyName`, name pre-filled, workspace name shown)
- (a) member completes onboarding with member-safe writes only and lands in the app (spy asserts `updateSellerProfile` called **0** times; member's own doc: `onboardingCompleted:true`, `jobTitle`/`bookingUrl` saved, `sellerProfile` still null; no "workspace owner" alert)
- (b) member inherits the workspace seller profile (overlaid `companyProfile.companyName` + plan present, `_isWorkspaceMember` true)
- member welcome step requires a name (validation alert, stays on step)
- (d) **the exact regression**: member forced into the full wizard fills Step 1, presses Continue → advances to Step 2 with `updateSellerProfile` called **0** times and no owner-only alert (pre-fix this was Abby's hard block)
- (c) owner path unchanged: non-member goes through the full wizard and the Step-1 Continue **does** call `updateSellerProfile` exactly once

Membership is simulated by intercepting `GET /me/workspace-context` (the sanctioned resolution path) with the exact context shape `memberContextService.js` returns; all other backend calls are aborted so the 401→sign-out redirect in `API.request` can't fire mid-test.

**CI gate (F-703 smoke): 1/1 green** (`smoke.spec.js --project=chromium`).

**Pre-existing, NOT caused by this change (flagged for backlog):** the legacy `tests/e2e/onboarding.spec.js` suite cannot pass on `main` today — it fails at signup, before any changed line executes, for two stacked reasons: (1) email/password signup lands on the "Verify Your Email" wall which the suite never bypasses; (2) `page.goto('/')` drops the baseURL's `?emulator=true` query, silently pointing the app at production Firebase. Verified by running it on this branch (fails at `signUpAndGetToOnboarding`, `onboarding.spec.js:40`). CI runs only `smoke.spec.js`, so this was invisible. The new spec handles both (explicit `/?emulator=true` navigation + Auth-emulator admin `emailVerified` flip). Recommend a follow-up ticket to retrofit the legacy suite with the same helpers — not bundled here (single-purpose PR).

**Backend suite:** not run — no backend files changed. No `firestore.rules` changes ⇒ emulator rules suite not required.

## 3. Adversarial self-review notes

- **Owner regression risk:** the only behavioral branch keys on `_isWorkspaceMember === true`, which owners can never carry (`getCurrentUser()` short-circuits on their own `teams/{uid}` doc before the overlay). Test (c) proves the owner write path is intact.
- **Degraded mode:** if workspace-context fails transiently at gate time the member is treated as a non-member and takes the full wizard against their own doc — identical to pre-fix behavior for that failure mode, and the `init()` defense re-checks membership from the (cached) user object anyway.
- **Member with stale wizard progress** (Abby: `onboardingStep > 0`, own 29% profile from 07-15): `initMember()` deliberately ignores resume logic; she gets the clean welcome step.
- **XSS:** new interpolations of user/owner-supplied strings go through `_escAttr`.
- **Booking URL validation:** optional; requires `http(s)://` when present.
- **No new backend calls, no schema changes, no rules changes.**

## 4. Deploy plan

1. **Williams merges** the PR (auth/entitlement territory — per session contract he is the merge gate; the 07-16 Charles-sole-reviewer amendment applied to that engagement only).
2. Merge to `main` auto-deploys hosting via CI (F-703 smoke gates it). No backend deploy, no `.env` interaction, nothing else to sequence.
3. `/js/**` is served `Cache-Control: no-cache, must-revalidate` — clients pick the fix up on next page load.

**Rollback:** revert the single PR; hosting auto-deploys the revert. No data migrations.

## 5. Abby verification steps (post-merge)

1. Optional pre-check with a throwaway invite + test account: accept → sign in → expect the "Welcome to the team!" step, complete it, land in app.
2. Abby reloads `app.synchintro.ai` and signs in (support@pathsynch.com — her membership already self-healed on 07-20; no need to re-click the invite link). Expected: welcome step (name pre-filled) → Get Started → lands in the app with Charles's workspace profile inherited. No seller-profile write, no error.
3. If anything still blocks her, capture the console trace and compare against the diagnosis §6 proposed reads (not expected to be needed).

---

**STOP after PR opens — Williams merges. Nothing deployed, nothing merged, no production writes, bypass never enabled.**
