# Member Onboarding Regression — Diagnosis — 2026-07-20

**Type**: READ-ONLY diagnosis. No application code written, no commits, no PR, no Firestore reads or writes against production.
**Repos read (committed `origin/main` only, via `git show` / `git grep`)**: `pathsynch-pitch-generator` (backend), `synchintro-app` (frontend).
**Live-bundle evidence**: public fetch of `https://app.synchintro.ai/js/{api.js, auth.js, pages/onboarding.js}` only (public hosting URLs; no authenticated or Firestore access).
**Reporter**: Abby Tejares (`support@pathsynch.com`), blocked live on a call with Charles, 2026-07-20 ~9:30 PM ET.

---

## 1. Executive summary / verdict

**Root cause: Hypothesis 1 — coverage gap — activated by the very success of the 07-17 member-identity fix.**

The member-identity engagement (backend #57–#60, frontend #34–#36) fixed *identity resolution*: members now correctly resolve as workspace members via `GET /me/workspace-context`, inherit the owner's plan and Seller Profile, and get flagged `_isWorkspaceMember = true`. But **the onboarding wizard (`js/pages/onboarding.js`, 3,048 lines) and the onboarding gate (`js/auth.js`) were never touched by that engagement and contain zero member awareness.** Every wizard step's **Continue** unconditionally calls `API.updateSellerProfile()`, which since **2026-05-13** has carried an owner-only guard that throws exactly the observed error whenever `_isWorkspaceMember` is true.

That guard was **dormant for two months**: from the 2026-05-05 rules lockdown until 07-17, no member could ever resolve as a member, so the flag was never true and the guard never fired. The moment PR #34 made membership resolution work, the dormant guard armed itself against a wizard that still routes members through owner-only seller-profile writes. Net effect: **every invited member who has not completed onboarding is hard-blocked at the first Continue, cannot ever set `onboardingCompleted`, and re-enters the broken wizard on every login.** The backend behaved correctly throughout; production is serving exactly the code on `main`.

---

## 2. Q1 — Where the rejection originates

**Frontend pre-check, not backend.** The string exists in exactly one place across both repos:

- `synchintro-app js/api.js:708` (`origin/main`):

```js
async updateSellerProfile(profileData) {                       // api.js:701
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not authenticated');

    // Workspace members cannot modify the seller profile — it belongs to the workspace owner
    const currentData = await this.getCurrentUser();
    if (currentData?._isWorkspaceMember) {                     // api.js:707
        throw new Error('Seller profiles can only be edited by the workspace owner.');  // api.js:708
    }
```

Matches the console trace exactly (`api.js:708:19`). **Trigger condition:** `getCurrentUser()` returned `_isWorkspaceMember: true` — i.e. the member-identity fix *worked* and resolved Abby as a member. No backend route emits this string; the underlying write (had it proceeded) would have been a client-side Firestore write to the member's **own** `users/{uid}` doc — the guard exists to stop members from silently writing owner-profile data onto their own doc, not to protect the owner's doc (rules already do that).

**Provenance of the guard:** introduced in frontend commit `d4a0cc2` (**2026-05-13**, "feat: opportunity brief v2 polish…"). It has been dormant ever since, because the 2026-05-05 rules lockdown (`3b3cb81`, backend) broke the client's membership query — `_isWorkspaceMember` could never be set (see `SELLER_PROFILE_DIAGNOSIS_2026-07-16.md` §4). PR #34 (`bcf305a`, merged 2026-07-17T00:55Z) reintroduced the flag via the new workspace-context overlay — arming the guard for the first time.

## 3. Q2 — The wizard routing for invited members

**(a) The gate.** `js/auth.js:47–95` (`onAuthStateChanged`): after `API.getCurrentUser()`, the sole branch condition is

```js
if (!userData.onboardingCompleted) {   // auth.js:70 → show wizard, OnboardingPage.init()
```

The workspace-context overlay (`js/api.js:204–227`) copies `subscription`, `plan`, `tier`, `sellerProfile`, `_isWorkspaceMember`, `_workspaceOwnerUid`, `_workspaceRole` from the backend context — **it does not set `onboardingCompleted`.** A member's own `users` doc (created at self-signup with `onboardingCompleted: false`, `auth.js:960`) therefore always routes them into the full owner wizard. There is **no `_isWorkspaceMember` check anywhere in `auth.js` gating or in all 3,048 lines of `onboarding.js`** (grep: zero hits).

**(b) Why the steps were pre-filled with workspace data.** `onboarding.js:106–160` (`init`) loads `userData.sellerProfile` into `formData`. For a member, that field is now the **owner's** profile (the overlay) — so Abby saw Charles's Managed Concierge / SynchMate catalog and pain-point tags in an editable wizard. Additionally, because she had partially onboarded on 07-15 (own profile 29%, `onboardingStep > 0`), `onboarding.js:126–129` resumed her mid-wizard instead of at Step 0.

**(c) The block.** Every advance path calls the guarded write **unconditionally**:

- `nextStep()` → `API.updateSellerProfile(this.formData)` at `onboarding.js:2955` (trace line), then `updateOnboardingStep()` at 2956 — never reached;
- `completeOnboarding()` → `API.updateSellerProfile(...)` at `onboarding.js:3012`, then `API.completeOnboarding()` at 3013 — never reached.

The `catch` in both surfaces the alert Abby saw. Because `API.completeOnboarding()` (the only place `onboardingCompleted: true` is written — `api.js:2276`) sits *after* the throwing call, **a member can never complete onboarding by any in-app path.** `updateOnboardingStep`/`completeOnboarding` themselves are member-safe (own-doc `set merge`, `api.js:2262/2276`); only `updateSellerProfile` is guarded.

**(d) Did #34–#36 change this path?** No. Their changed-file lists are exactly `CLAUDE.md`, `js/api.js`, `js/pages/settings.js` (#35: `js/api.js` only). `onboarding.js` and the `auth.js` gate were untouched by the engagement.

**(e) Secondary finding — the `?inviteToken=` param is dead code client-side.** Case-insensitive grep for `invitetoken` across the entire frontend `origin/main`: **zero hits.** The frontend parses only the legacy `?invite=` (invitation-ID) param (`auth.js:91–94`) — and only on the *already-onboarded* branch, so a new member in onboarding would never hit it — and `acceptTeamInvitation()` posts `{ invitationId }` (`api.js:3710–3714`), which the Phase-3A backend **rejects** (`functions/routes/teamRoutes.js:331–340`: token-hash acceptance only, `"inviteToken is required"`). So explicit invite acceptance is fully broken client-side; membership currently materializes **only** via the backend self-heal in `GET /me/workspace-context` (`memberContextService.js`: pending + unexpired + **verified-email-match** invite → `acceptInviteByVerifiedEmail`). For Abby that worked (she signed in as the invited address; invite valid until 07-22). For any invitee signing in with a **different** email than the invite, acceptance is currently impossible — contradicting the documented contract ("Email match NOT required to accept", `functions/CLAUDE.md:232`).

## 4. Q3 — What #57–#60 / #34–#36 actually fixed, mapped to the 07-16 failure modes

| PR | Merged (UTC) | Fixed (07-16 diagnosis ref) | Touches today's failing path? |
|---|---|---|---|
| #57 backend | 07-17 00:01 | §4b/§8.1: sanctioned server-side membership resolution — `GET /me/workspace-context` + verified-email self-heal (`memberContextService.js`, `workspaceInviteService.js`) | Yes — **works as designed**; it's what resolved Abby as a member |
| #34 frontend | 07-17 00:55 | §4a/§4c: `getCurrentUser()` overlay via workspace-context; Pitch Insights spinner (§6); Invalid Date (§7) | Yes — the overlay sets the flag that arms the guard; **did not touch onboarding.js/auth.js** |
| #58 backend | 07-17 02:37 | §5: backend plan gates honor workspace plan (`getUserPlanForRequest`) | No |
| #59 backend / #35 frontend | 07-17 03:02/03:03 | planTier event stamping / dead cache-bust cleanup | No |
| #60 backend | 07-17 18:56 | §7: expiry-aware invite pre-check; ICP analytics server-side | No |
| #36 frontend | 07-17 19:00 | §5/§6: single plan resolver in Settings; ICP analytics via backend | No |

**Today's trace path** — `auth.js` gate → `OnboardingPage.init()` → `nextStep()` (`onboarding.js:2955`) → `updateSellerProfile()` (`api.js:707`) — **was touched by none of the six PRs** except that #34's overlay supplies the flag the guard reads. Nothing merged after the engagement (frontend has had no merges since #36; backend #61 is test fixtures only) reintroduced anything: this is not a code regression by later merges.

## 5. Q4 — Deploy parity: production serves the fixed code

Fetched 2026-07-20 from `app.synchintro.ai` (public hosting) and diffed against `origin/main`:

| File | Live vs `origin/main` |
|---|---|
| `js/api.js` (131,063 B) | **byte-identical** (empty diff) |
| `js/pages/onboarding.js` (140,295 B) | **byte-identical** |
| `js/auth.js` (42,997 B) | **byte-identical** |

The `?v=1.0.0` in the trace is a static, never-bumped cache-bust param on the `index.html` script tag (`index.html:388`) — not a build version. It is harmless: `firebase.json` serves `/js/**` with `Cache-Control: no-cache, must-revalidate`, so browsers revalidate every load. **Hypothesis 3 (stale deploy) is eliminated.** The backend needs no parity check for this bug: the only backend call on the failing path is `GET /me/workspace-context`, which demonstrably worked (the guard fired ⇒ `isWorkspaceMember: true` came back).

## 6. Q5 — Abby's data state (known facts + proposed reads, NOT run)

Known from the 07-16 diagnosis (then-fresh ground truth): UID `C4BfVjmSwLY6tlBEjz4IPNZj6px1`; own `users` doc `tier: FREE`, own 29%-complete sellerProfile, self-signed-up via Google 07-15 15:32 UTC; invite `teamInvitations/lqTx9VAfuulItypuJnzj` (inviter Charles) created 07-15 13:28, **expires 07-22**, then still pending.

Inference from today's behavior: the guard fired ⇒ workspace-context returned `isWorkspaceMember: true` ⇒ either the self-heal auto-accepted her pending invite on sign-in (expected — invite was unexpired, her verified Google email matches), or membership already existed. **No old-vs-new membership-shape mismatch is in play** — resolution succeeded. Her own doc should be unchanged by today's attempts (the guard throws *before* any write; `updateOnboardingStep` is sequenced after it).

**Proposed minimal production reads (await explicit approval — commands, not yet run).** One-off read-only Node script using the on-disk `pathsynch-pitch-creation` service-account key (per memory), Admin SDK GETs only:

1. `teamInvitations/lqTx9VAfuulItypuJnzj` → expect `status: 'accepted'`, `acceptedByUid: C4BfVjmSwLY6tlBEjz4IPNZj6px1`, `acceptedAt` ≈ 2026-07-21T01:30Z (confirms self-heal fired).
2. `workspaceMembers/{workspaceId}_C4BfVjmSwLY6tlBEjz4IPNZj6px1` (workspaceId from the invite doc) → expect `status: 'active'` (confirms membership record in the new shape).
3. `users/C4BfVjmSwLY6tlBEjz4IPNZj6px1` → expect `onboardingCompleted: false`, `onboardingStep` unchanged since 07-15, own sellerProfile still 29% (confirms no partial writes from today's failed saves).

These reads **confirm** the mechanism; they are not required to justify the fix (the code path is proven statically), and the expected outcome is **no data repair needed** — the frontend fix alone unblocks her on next login.

## 7. Timeline

| When | Event |
|---|---|
| 2026-05-05 | Rules lockdown `3b3cb81`: member team lookups blocked client-side → members silently stop resolving as members |
| 2026-05-13 | Frontend `d4a0cc2` adds owner-only guard to `updateSellerProfile` — **dormant** (flag can never be true) |
| 2026-07-15 | Abby invited (13:28 UTC); self-signs up via Google (15:32); partially onboards own free account (29%) |
| 2026-07-16 | `SELLER_PROFILE_DIAGNOSIS_2026-07-16.md` — root cause of member non-resolution |
| 2026-07-17 | Fix engagement merges: #57 (00:01), #34 (00:55), #58 (02:37), #59/#35 (03:02), #60 (18:56), #36 (19:00); hosting auto-deploys (live == main confirmed today) |
| 2026-07-20 ~21:30 ET | Abby clicks `/?inviteToken=…` (param ignored by the SPA) → signs in → workspace-context self-heals membership → overlay arms `_isWorkspaceMember` → own `onboardingCompleted:false` routes her into the owner wizard, pre-filled with Charles's profile → Continue → `api.js:708` throws → **hard block** |

## 8. Q6 — Hypothesis verdicts

1. **Coverage gap — CONFIRMED (root cause).** The engagement fixed identity resolution and the *Settings* surfaces, but the invite-arrival onboarding wizard and its `auth.js` gate were out of its blast radius and contain no member branch. The 07-16 diagnosis itself flagged this as future work (§9.6: "Onboarding UX — gate onboarding for members on the personal subset only") — it was scoped out, not missed silently, but nothing interim was shipped to stop members entering the owner wizard.
2. **Regression by later merge — NO.** No frontend merges after #36; backend #61 is test fixtures. The "regression" sensation is real but causal-inverted: the *fix's success* activated a 2-month-dormant guard (`d4a0cc2`).
3. **Stale deploy — NO.** Live bundle byte-identical to `origin/main`; `/js/**` served no-cache.
4. **Expected-but-wrong UX — PARTIALLY, subsumed by 1.** The backend rejection… doesn't exist; the *frontend guard* is correct and should stay. The defect is purely that the wizard routing still asks members to perform an owner-only write.

**Blocked population:** every invited member whose own `users.onboardingCompleted` is false — i.e. effectively **all new invitees** (and Daniyal/mariadeth if/when re-invited, until they complete some flow). Owners are unaffected (`_isWorkspaceMember` is never set for owners; the wizard behaves as before).

---

*Read-only diagnosis. Fix strategy and Gate 1 review in `strategy-review-member-onboarding-2026-07-20.md`. No fixes applied. Entitlement/auth changes require Williams's merge.*
