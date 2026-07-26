# Seller Profile / Team-Member Identity Diagnosis - 2026-07-16

**Type**: READ-ONLY diagnosis. No application code written, no commits, no PR, no Firestore data modified.
**Repos read (committed `main` only, via git refs)**: `pathsynch-pitch-generator` (backend), `synchintro-app` (frontend).
**Firebase project**: `pathsynch-pitch-creation`.
**Credential used for Firestore ground truth**: the on-disk service-account key at the path recorded in auto-memory (project `pathsynch-pitch-creation`), read-only GETs and one `getUserByEmail` per account. `GOOGLE_APPLICATION_CREDENTIALS` was unset, so the key was passed explicitly to `admin.credential.cert()`. Key contents never printed.

---

## 1. Executive summary

All three symptoms share a single root cause: **workspace members are never resolved as members on the client, so they fall back to their own free-tier `users` doc.** `getCurrentUser()` in the frontend resolves membership with a direct `teams.where('memberUids','array-contains', uid)` collection query, but the `teams` `allow list` rule (hardened on 2026-05-05, commit `3b3cb81`) permits a list only when `request.auth.uid == ownerUid`; a member's array-contains query is therefore rejected wholesale, throws, and is silently swallowed by a `catch` that also strands the email-invite fallback nested inside the same `try`. Because inheritance never applies, the member keeps `tier: FREE`, sees their own partial Seller Profile (onboarding from scratch), and Report Branding correctly-but-wrongly shows "requires Scale+"; Pitch Success Insights is a second, independent bug (a render/loader plan-source mismatch) that spins whenever the plan resolves to Growth+. Compounding all of this, both accounts self-signed-up with Google and **never accepted their invitations**, so even the intended membership record was never written. This is the same failure that hit mariadeth in April 2026: the manual `memberUids` patch worked only because it predated the May 5 rules lockdown, and the June 25 workspace bootstrap later overwrote it.

---

## 2. Prior work (STEP 0)

`SYNCHINTRO_AUDIT_REPORT_2026-07-14.md` (the canonical 8-phase audit) was read in full.

**What it already covers (reused, not redone):**
- Checklist item #4 confirmed the **backend** enterprise-entitlement mapping is healthy: `planGate.js` hierarchy and `brandResolver.js` `TIER_RANK` both include `enterprise`, PR #44 merged, `enterpriseEntitlement.test.js` covers it. I re-verified this and extend it below with the gates PR #44 did **not** touch.
- It confirmed the live `firestore.rules` matched backend `main` as of the 2026-06-26 deploy (its Phase 1 live read). I reuse that as the most recent known parity point but flag it is now ~3 weeks stale (see the caveat in section 4).

**What it does NOT answer (the entire subject of this report):**
- Nothing on team-member plan/Seller-Profile resolution, `getCurrentUser()`, the `array-contains` vs `allow list` rules mismatch, invite acceptance, or Seller Profile scoping. The audit's scope was security/reliability/CI/deps posture, not the member-identity path. This diagnosis is net-new.

---

## 3. STEP 1 ground truth (Firestore)

**Workspace owner** `teams/dehiyRBCXcUUM72O211S27lfXbl1` (Charles): `memberUids = ["cZFXrf3FBOUXmlQU5dep8ymj1Lq1"]` (that UID is `tdh356b@gmail.com`). Neither support nor daniyal is present. mariadeth's UID (`gF49TKPVyDVLVfIIGgW8GLdsodB2`) is **also not present** - the April manual patch is gone, consistent with the June 25 bootstrap overwriting the team doc. Owner `users/dehiyRBCXcUUM72O211S27lfXbl1` has `plan: enterprise`, `tier: enterprise`, `subscription: {tier:enterprise, plan:enterprise}`, and a Seller Profile at 95% completeness.

| Field | support@pathsynch.com | daniyal@pathsynch.com |
|---|---|---|
| Auth UID | `C4BfVjmSwLY6tlBEjz4IPNZj6px1` | `qOnkOJeOGPOwfnPMUFwSpGvpXgs1` |
| Provider | google.com | google.com |
| creationTime | 2026-07-15 15:32 UTC | 2026-06-17 13:26 UTC |
| lastSignInTime | 2026-07-15 15:32 UTC | 2026-07-06 12:10 UTC |
| `users` tier | FREE | FREE |
| `users` plan/subscription | none | none |
| teamId / ownerUid on doc | none | none |
| Seller Profile on own doc | yes, own, 29% complete | yes, own, PathSynch Labs, onboardingCompleted=true |
| In owner `memberUids`? | **No** | **No** |
| teamInvitation | id `lqTx9VAfuulItypuJnzj`, status **pending**, acceptedAt **null**, teamOwnerUid Charles, created 2026-07-15 13:28, expires 2026-07-22 (valid) | id `cxWZKqlVmnWn8CJBbo74`, status **pending**, acceptedAt **null**, teamOwnerUid Charles, created 2026-06-29 22:25, expires **2026-07-06 (EXPIRED)** |

**Invite vs self-signup verdict:**
- **support@pathsynch.com - direct self-signup.** Google account created 2026-07-15 15:32, about two hours *after* the invite was created (13:28) the same day. The invite is still valid but `acceptedAt` is null and `acceptedByUid` is null - it was never accepted. The user signed in with Google directly rather than via the accept link.
- **daniyal@pathsynch.com - direct self-signup, unambiguously.** The Google account (2026-06-17) predates the invitation (2026-06-29) by twelve days, so the account cannot have originated from the invite. The invite has since **expired** (2026-07-06) and was never accepted.

In both cases the invite-acceptance flow that would write the UID into `memberUids` never ran.

---

## 4. STEP 2 resolution path (where it breaks)

**a. Where the client resolves the plan.** `synchintro-app/js/api.js:148` `getCurrentUser()`. It loads `users/{uid}` and `teams/{uid}` in parallel; if the user does not own a team it attempts membership resolution:

- `js/api.js:202-206` - the membership query: `this.db.collection('teams').where('memberUids','array-contains', user.uid).limit(1).get()`.
- `js/api.js:238-243` - the email fallback: `teamInvitations.where('inviteeEmail','==', userEmail).where('status','==','pending')`, which on a hit overlays the owner's plan and calls `acceptTeamInvitation()` in the background.

**b. The rules mismatch (CONFIRMED).** `firestore.rules` (`git show main:firestore.rules`, lines 568-581):
```
match /teams/{ownerUid} {
  allow get:  if isAuthenticated() && (request.auth.uid == ownerUid || request.auth.uid in resource.data.memberUids);
  allow list: if isAuthenticated() && request.auth.uid == ownerUid;   // <-- members cannot list
  allow write: if false;
}
```
The rule comment itself states it: "array-contains queries on memberUids do NOT satisfy the 'in' rule at query-planning time - member team lookups must go through the backend API (GET /team)." The client `array-contains` in `getCurrentUser()` is a **list**; Firestore cannot prove every matched doc has `ownerUid == auth.uid`, so it **rejects the query with permission-denied for every non-owner**. This is the break point. History: the restriction landed in commit `3b3cb81` ("Firestore rules lockdown", the 2026-05-05 hardening that split `teams` read into get/list). That is exactly when the April `memberUids` workaround stopped working.

**Deployed-rules caveat (state explicitly):** rules deploy separately from code, so `main` may not equal what is live. The 2026-07-14 audit's Phase 1 live read found live == backend `main` as of the 2026-06-26 deploy, but that is ~3 weeks old. **The deployed ruleset must be confirmed in the Firebase console / `firebase deploy` history before treating the `allow list` restriction as live.** The behavior observed (members stuck at free) is consistent with the hardened rule being live.

**c. What happens on failure, and whether it is logged (STEP 2c).** The membership query and the email fallback live in the **same** `try` block. The array-contains query throws first, so control jumps to the `catch (wsErr)` at `js/api.js:276-278`, which does only `console.warn('[getCurrentUser] workspace query FAILED (Firestore rules?):', ...)`. The failure is **silently swallowed** (a warn, no rethrow, no user-facing signal), **and the email-invite fallback is never reached** because it is nested after the query that threw. There is no literal "default to Starter" line; the user simply retains the `tier: FREE` already on their own `users` doc (set at `js/api.js:167` for existing docs, or the new-user branch at `js/api.js:182` `tier: 'FREE'`). Net effect: default to free.

Consequence: this is a total, not partial, breakage. **No** workspace member can inherit a plan through `getCurrentUser()` while the hardened `allow list` rule is live. The only members who appear to work are those whose own `users` doc already carries the plan.

**d. Where Seller Profile is read from.** Inheritance would set `userData.sellerProfile = ownerData.sellerProfile` (owner's `users/{ownerUid}.sellerProfile`) at `js/api.js:220` (member branch) or `js/api.js:255` (invite branch). Since neither branch runs, the member sees their **own** `users/{memberUid}.sellerProfile`. That is why support (29% own profile) and daniyal (own PathSynch Labs profile) are asked to fill it from scratch instead of inheriting Charles's 95% profile. Seller Profile is stored per-user on `users/{uid}.sellerProfile`; there is no workspace-scoped Seller Profile document (see section 9).

---

## 5. STEP 3 gate inventory

`resolveResponseTier(plan)` (`functions/api/market.js:3312`) maps `enterprise -> scale`, `scale -> scale`, `growth -> growth`, else `starter`. PR #44 applied it in `api/market.js` and `config/claude.js` only. Full inventory of every ad-hoc plan/tier gate on committed `main` (both repos, WIP excluded):

| file:line | the check | handles `enterprise`? | verdict |
|---|---|---|---|
| **BACKEND** | | | |
| `functions/middleware/planGate.js:200` | `planHierarchy = ['starter','growth','scale','enterprise']` (source of truth) | Yes | correct |
| `functions/api/pitch/validators.js:92` | `TIER_HIERARCHY = ['free','starter','growth','scale','enterprise']` | Yes | correct |
| `functions/api/pitch/validators.js:145` | Custom Sales Library: `tierMeetsMinimum(userTier,'scale')` | Yes (via hierarchy) | correct |
| `functions/config/claude.js:43` | `FORMATTER_PLAN_ACCESS` lists include `enterprise` | Yes | correct |
| `functions/config/claude.js:76` | `NARRATIVE_LIMITS.enterprise` present (mirrors scale) | Yes | correct |
| `functions/config/stripe.js:146,157` | `PLANS.enterprise` with `pptExport:true` | Yes | correct |
| `functions/api/export.js:418` | PPTX: `hasFeature(plan,'pptExport')` via `getUserPlan` | Yes (PLANS.enterprise) | correct |
| `functions/api/market.js:803` | Enterprise mode: `['scale','enterprise'].includes(plan)` | Yes | correct |
| `functions/api/market.js:1178,1208,1300` | `tier === 'growth' || tier === 'scale'` (tier is `resolveResponseTier`) | Yes (enterprise pre-mapped to scale) | correct |
| `functions/routes/precallBriefRoutes.js:169` | `tier === 'scale' || tier === 'enterprise'` | Yes | correct |
| `functions/services/brandResolver.js:233` | `TIER_RANK = {starter,growth,scale,enterprise}` (backend Report Branding) | Yes | correct |
| `functions/api/aisynchDashboard.js:41` | `TIER_RANK = {lite,starter,growth,scale}` - **no `enterprise`**; `hasAccess` uses `TIER_RANK[subTier]||0` so `enterprise` ranks 0 | **No** | **buggy** (separate AIsynch/PathManager product, `aisynchSubscriptions` collection; not the SynchIntro user-plan path, so no impact on this bug - flagged for completeness) |
| `functions/services/email.js:764,773` | `plan === 'growth' ? ... : plan === 'scale' ? ...` (email body content) | **No** (falls through) | buggy-cosmetic (email copy only) |
| `functions/api/admin.js:31-33`, `routes/adminRoutes.js:115-118` | admin count buckets by plan | admin.js no enterprise bucket; adminRoutes.js has one | reporting only, low impact |
| `synchnotify/src/utils/tierGating.js:18` | `PLAN_HIERARCHY` (separate SynchNotify product) | verify separately | out of scope for this bug |
| **FRONTEND** | | | |
| `synchintro-app/js/pages/settings.js:3047` | **Report Branding gate**: `isScalePlus = ['scale','enterprise'].includes(plan)` | **Yes** | **correct** - the "requires Scale+" symptom is NOT this gate; it is downstream of the failed inheritance (plan resolves to starter/free) |
| `js/pages/settings.js:3046` | `isGrowthPlus = ['growth','scale','enterprise'].includes(plan)` | Yes | correct |
| `js/api.js:1652` | `isGrowthOrAbove = ['growth','scale','enterprise'].includes(plan)` | Yes | correct |
| `js/api.js:1660` | `isEnterprise = plan === 'enterprise'` | n/a (exact) | correct by intent |
| `js/pages/settings.js:812-813` | team seats: `['growth','scale','enterprise']`, `enterprise?999...` | Yes | correct |
| `js/app.js:172` | `const isEnterprise = current === 'scale'` | **No** - variable named `isEnterprise` but tests `=== 'scale'`; an actual enterprise plan is shown upgrade options instead of the "highest plan" message | buggy-cosmetic (upgrade modal copy) |
| `js/pages/create.js:1172` | enterprise-mode auto-suggest: `this.userSubscription === 'enterprise'` (one OR condition among ICP/industry/size) | narrower than backend (scale also eligible per market.js:803) | minor |
| `js/share.js:77` | social-share platforms: `userTier === 'enterprise'` (all vs email-only) | n/a (enterprise-only feature by intent) | correct by intent |
| `js/pages/documents.js:211,227,243` | static "Scale+" badges (labels, not gates) | n/a | display only |

**Report Branding call-out (as requested):** the frontend Report Branding gate (`settings.js:3047`) and the backend `brandResolver.js` both handle `enterprise` correctly. `agencyEntitlements` / `agencyBrandOverrides` are Admin-SDK-write-only (`write:false`) and `brandResolver` never trusts client overrides (confirmed healthy by the prior audit's Gate #6). So Report Branding has **no** residual enterprise-mapping defect; its symptom is purely the inheritance failure resolving the member to free.

---

## 6. STEP 4 Pitch Success Insights findings

**Backing endpoint:** there is **no backend endpoint**. Pitch Success Insights is computed entirely **client-side** in `synchintro-app/js/api.js:1820` `getPitchSuccessInsights(userPlan)`, which reads `getPitches()` + `getICPs()` from Firestore and aggregates in the browser. (`GET /sales-intelligence/icp/insights` is a different feature.)

- **Requires:** `isGrowthOrAbove(userPlan)` - throws `'available for Growth plan and above'` if starter/free (`js/api.js:1821`). Auth required (`firebase.auth().currentUser`).
- **What a Starter caller gets:** the function throws before any read; but the gate at the call site normally prevents even calling it for starter.
- **Calls Gemini?** No. Pure client-side Firestore aggregation. It does **not** share the Gemini key path. Note: `functions/agents/prospectResearchAgent.js` reads `GOOGLE_PLACES_API_KEY` / `GOOGLE_SEARCH_API_KEY`, not the Gemini key, so the referenced Gemini 400 is unrelated to this endpoint on two counts (client-side, and no Gemini).
- **Catch/finally that clears the spinner?** `loadPitchInsights()` (`js/pages/settings.js`) has a `try/catch` that overwrites the container on both success and error - **but only if it runs.**

**The actual "spins forever" bug (independent of the inheritance issue):** the spinner is rendered and cleared by two code paths that resolve the plan **differently**:
- `renderPitchInsightsSection(subscription)` (`settings.js:2618`) computes `plan = subscription?.data?.plan || subscription?.data?.tier || subscription?.plan || **subscription?.tier** || 'starter'` (includes `.tier`). If Growth+, it renders the `#pitch-insights-content` **spinner** card.
- The loader guard (`settings.js:400-402`) computes `plan = subscription?.data?.plan || subscription?.plan || 'starter'` (**omits `.tier`**) and only calls `loadPitchInsights(plan)` if `isGrowthOrAbove(plan)`.

`getSubscription()` (`js/api.js:682-712`) returns an object whose plan lives in a **top-level `tier`** field and has no `plan` and no `.data` wrapper. So the render path sees the real tier and shows the spinner, while the loader guard resolves to `'starter'`, fails `isGrowthOrAbove`, and **never calls the loader**. The spinner is never replaced -> spins forever. This bites **every** Growth+ resolution, including owner Charles today. For support/daniyal right now, their tier resolves to free, so they currently see the "Upgrade to Growth" locked card, not a spinner; the spinner is what they will hit the moment inheritance is fixed. In other words, fixing inheritance alone will convert their symptom from "locked" to "spins forever" unless this divergence is also fixed.

---

## 7. STEP 5 Settings inventory

| Item | file:line | Finding |
|---|---|---|
| **"Invalid Date"** on Joined / Invited | `js/pages/settings.js:844-847` (`_fmtDate`) | `_fmtDate` checks `ts.toDate` then `ts.seconds`, else `new Date(ts)`. Backend `GET /team` (`functions/routes/teamRoutes.js:113-116,126`) returns raw Firestore Timestamps for `joinedAt`/`createdAt`/`expiresAt`, which serialize over JSON as `{_seconds,_nanoseconds}` - **no `.toDate`, and the field is `_seconds` not `seconds`**. So `_fmtDate` falls to `new Date({_seconds...})` -> **Invalid Date**. Confirmed by ground truth (member `joinedAt` is `{_seconds:1782066486,...}`). The fields are populated; the frontend reads the wrong sub-field. |
| **"hello / hello"** on invites | `functions/routes/teamRoutes.js:210,227,234-238` | `ownerDisplayName`/`inviterDisplayName` fall back to `req.userEmail?.split('@')[0]`, and `workspaceName` defaults to `${ownerDisplayName}'s Workspace`. When the inviter signs in as `hello@pathsynch.com` with an empty displayName, both fields become "hello", rendering "hello / hello" (inviter name + workspace name derived from it). Depends on who sent the invite and whether their displayName was set at invite time. |
| **Invites never send (SendGrid)** | `teamRoutes.js:253-264`; `functions/.env.example:73` | The invite calls `sendWorkspaceInviteEmail(...)` wrapped in a `try/catch` that only `console.warn`s on failure ("non-blocking"). `SENDGRID_API_KEY` is a placeholder in `.env.example` and, per `functions/CLAUDE.md:2226` and `SYSTEM_BIBLE.md:371`, is **not set** in production. So the email silently fails, the invitation is still created as `pending`, and the invitee never receives an accept link. This is exactly why support/daniyal have pending, unaccepted invites and self-signed-up with Google instead. |
| Pending-invite avatar assumes `inv.email` exists | `settings.js:875,889` | `inv.email.charAt(0)` and `inv.email.replace(...)` will throw if `email` is ever missing. Backend maps `email: inviteeEmail` (`teamRoutes.js:113`), so it is populated today, but there is no guard. |
| Auto-accept path is dead code | `js/api.js:260-266` | `acceptTeamInvitation()` (background auto-accept) sits inside the `try` that the array-contains query throws out of, so it never runs. Even for a valid pending invite, membership is never self-healed on the client. |

---

## 8. Minimal fix per issue

Each labeled DATA PATCH (Firestore write, no deploy) or CODE CHANGE (needs review + deploy). Per the session contract, entitlement/auth code changes require Williams's review before merge; nothing here is applied.

1. **Root cause - members never resolve (Report Branding, Seller Profile, plan gates).**
   - **DATA PATCH (immediate unblock for Daniyal, and support):** because the client `array-contains` query is rejected by rules, writing `memberUids` alone does **not** fix client resolution (this is why the April mariadeth patch silently regressed). The only data write that works client-side is to set the plan and profile **directly on the member's own `users/{uid}` doc**: `subscription`, `plan`, `tier` copied from the owner, and `sellerProfile` copied from `users/{ownerUid}.sellerProfile`. That makes `getCurrentUser()` read the correct values from the member's own doc before the (failing) workspace block. This unblocks Report Branding and all plan gates immediately without a deploy. (Pitch Insights will then hit issue #3.)
   - **CODE CHANGE (durable fix):** stop resolving membership with a forbidden client query. Either (a) have `getCurrentUser()` call the backend `GET /team` (Admin SDK, already the sanctioned path per the rule comment) and overlay `plan`/`tier`/`sellerProfile` from its response, or (b) at minimum restructure so the `teamInvitations` email fallback runs even when the membership query throws (move it out of the shared `try`, or wrap the array-contains in its own `try`). Option (a) is preferred; (b) is a smaller mitigation that works for these users because the `teamInvitations` list query is permitted by rules (`inviteeEmail == token.email`), though it depends on the token email being lowercase.

2. **Invites never accepted / never sent.**
   - **CODE CHANGE / config:** set `SENDGRID_API_KEY` in production `.env` (config task, not code) so invites actually send. Until then, acceptance depends on the auto-accept fallback, which is currently dead code (fixed by #1b).
   - **DATA PATCH (optional):** daniyal's invite is expired; a fresh invite (or extending `expiresAt`) is needed if the invite route is used rather than the direct users-doc patch.

3. **Pitch Success Insights spins forever.**
   - **CODE CHANGE:** make the render path and the loader guard resolve the plan identically. Simplest: in `settings.js:400`, compute `plan` with the same expression `renderPitchInsightsSection` uses (include `subscription?.tier`), or centralize plan resolution in one helper and call it from both. Independent of the inheritance fix and must ship for Growth+ users (including the owner) to see insights at all.

4. **"Invalid Date".**
   - **CODE CHANGE:** in `_fmtDate` (`settings.js:844`), handle the serialized-Timestamp shape: check `ts._seconds` (and `ts.seconds`) before `new Date(ts)`. Optionally have `GET /team` return ISO strings instead of raw Timestamps.

5. **"hello / hello".**
   - **CODE CHANGE:** improve the display-name fallback (use the owner's real `name`/`displayName`, and do not derive the workspace name from the email local-part). Low severity; cosmetic in the invite email/UI.

6. **Pending-invite avatar guard.**
   - **CODE CHANGE:** guard `inv.email` before `.charAt`/`.replace` in `settings.js:875,889`.

7. **AIsynch `TIER_RANK` missing `enterprise` (`aisynchDashboard.js:41`).**
   - **CODE CHANGE:** add `enterprise: 4` for consistency. Separate product; no impact on this bug. Flag to the AIsynch owner rather than bundling here.

---

## 9. Seller Profile rescoping (scope, do not build)

Today Seller Profile is **per-user**: `users/{uid}.sellerProfile` (and an array `users/{uid}.sellerProfiles` on the owner). Members get the owner's profile only via a runtime overlay in `getCurrentUser()` that copies `ownerData.sellerProfile` onto the member's in-memory object; nothing is workspace-scoped at rest. To make Seller Profile genuinely workspace-scoped so future members complete only a personal profile, the work is:

1. **Introduce a workspace-scoped Seller Profile record.** A `workspaces/{workspaceId}.sellerProfile` doc (or `workspaceSellerProfiles/{workspaceId}`) owned by the workspace, holding company profile, products, ICP, branding, value proposition - the shared, company-level fields. Add a Firestore rule allowing members to **read** it (owner + `memberUids`, via the backend/Admin path since member list queries are blocked) and only owner/admin to **write** it (or Admin-SDK-only, consistent with the current `teams` write model).
2. **Split personal vs shared fields.** Define which fields are personal to each seller (name, title, personal LinkedIn, personal tone, signature, headshot) versus workspace-shared (company profile, products, ICP, brand). Personal fields stay on `users/{uid}`; shared fields move to the workspace record. Onboarding for a member then only prompts for the personal subset.
3. **Read path.** Everywhere that currently reads `sellerProfile` (pitch generation, one-pager/report branding, market, precall) needs to merge workspace-shared + member-personal, with the workspace record as the source for shared fields. This is the largest surface: `generatePitch`/`generatePitchDirect`, `generateLibraryEnhancedContent` and the level generators, `brandResolver`, and the Settings UI all read `sellerProfile` today.
4. **Resolution prerequisite.** This only helps once membership actually resolves for the member (issue #1). The workspace-profile read must go through the sanctioned backend path (Admin SDK), not a client member-list query, for the same rules reason.
5. **Migration.** Backfill each existing workspace's shared fields from the owner's `users/{ownerUid}.sellerProfile` into the new workspace record; leave members' personal fields in place. One-time script, owner-run.
6. **Onboarding UX.** Gate `onboardingStep`/`onboardingCompleted` for members on the personal subset only; do not ask a member to fill company/product/ICP (they inherit those). Owners still complete the full profile.

Effort: Medium-to-Large. It touches the data model, rules, every `sellerProfile` reader, onboarding, and requires a backfill. It should not be attempted before issue #1 (member resolution) is fixed, since a workspace-scoped profile is unreadable by members until membership resolves.

---

## 10. Open questions / could not determine

1. **Live rules parity.** I read committed `main` only. Whether the deployed ruleset still carries the hardened `allow list: uid == ownerUid` needs Firebase-console confirmation. The observed behavior is consistent with it being live, but this is the one fact not statically verifiable under the read-only policy.
2. **Exact mariadeth regression timing.** The `allow list` restriction landed in `3b3cb81` (2026-05-05 lockdown, per auto-memory). I inferred the April `memberUids` workaround worked under the prior, looser list rule and was then re-broken by that lockdown, and finally erased by the June 25 bootstrap overwriting the team doc. I did not reconstruct the full rules diff at the April date to prove the pre-lockdown rule was permissive; that would require reading the parent of `3b3cb81`.
3. **Why the June 25 bootstrap dropped mariadeth from `memberUids`.** Ground truth shows only `cZFXrf3FBOUXmlQU5dep8ymj1Lq1` remains. I did not trace the bootstrap script to confirm it rewrote (rather than merged) the array.
4. **`getSubscription()` shape assumption.** My Pitch-Insights conclusion assumes `getSubscription()` returns a top-level `tier` with no `plan`/`.data`, which is what `js/api.js:708-712` returns. If any caller wraps it in `{data:...}` before passing to Settings, the divergence details shift (the fix - unify the two resolutions - still holds).
5. **`teamInvitations` email-fallback case sensitivity.** The fallback query lowercases `user.email` but the rule compares against `request.auth.token.email`. For these all-lowercase Google accounts it matches; whether any account has mixed-case token email that would break the permitted-query proof is unverified.
6. **support account intent.** support@pathsynch.com's Google account was created ~2 hours after its invite the same day. I treated it as self-signup (it did not accept the invite), but I could not determine whether the person intended to accept and mis-navigated to a plain Google sign-in.

---

*Read-only diagnosis. No application code, config, Firestore data, or production state was modified. STOP: no fixes applied. Entitlement/auth changes require Williams's review before merge.*
