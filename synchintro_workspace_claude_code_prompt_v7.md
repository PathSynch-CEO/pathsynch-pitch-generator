# Claude Code Prompt — SynchIntro Multi-User Workspace (v7, Firestore-grounded)

> Paste this whole file as your opening message in Claude Code. Work the phases **in order**, stop at each gate, and do not open the next phase until every PR in the current phase is merged and the phase's acceptance tests are green. A phase may contain multiple small PRs. **There is a mandatory full stop after Phase 3 — see "Release strategy."**
>
> **This version is grounded in the actual codebase.** Earlier drafts assumed MongoDB and a greenfield build. SynchIntro is **Firestore + Firebase Functions + vanilla-JS frontend**, and much of this already exists. The governing instruction for the whole prompt: **extend the existing primitives; do not build a parallel system.**

---

## Your role and the goal

Turn **SynchIntro** from a solo GTM tool into a multi-user workspace for a small team. The repo is `functions/` (Firebase 2nd-gen `onRequest`, single `exports.api` in `index.js`, path-prefix dispatch) at `C:\Users\tdh35\pathsynch-pitch-generator`, with a **vanilla-JS** frontend at `C:\Users\tdh35\synchintro-app` (no React — DOM manipulation, page objects, the `settings.js` pattern). Data store is **Firestore**. Email is **SendGrid**.

This is foundational, multi-tenant, money-touching work. Two failure classes dominate: tenancy leaks (one workspace reads/affects another) and credit races (double-charge / oversell). Favor correctness over speed. When something is ambiguous or contradicts the codebase, **stop and ask**.

**Do not import PathManager patterns.** PathManager is a separate product on MongoDB/EC2 with `req.user.sub` / `col_users`. SynchIntro is Firestore with `req.userId` = the Firebase UID. There is no Mongo, no `findOneAndUpdate`, no Atlas replica set, no systemd in this work.

---

## Release strategy — ship 0–3 now, then reassess 4–5

- **Release 1 — Phases 0–3 (build now):** tenancy + workspace resolution, the bootstrap, branding/company inheritance + version history, and the full identity/role/offboarding lifecycle. This delivers the actual value: the workspace works, invited members become productive, the invite/blank-shell/`Invalid Date` bugs die. **Priority.**
- **Release 2 — Phases 4–5 (gated):** Market Intel shared cache and workspace-pooled credits. Cost optimizations that only pay off at usage volume you don't have yet, and the most concurrency-sensitive code. **Mandatory stop after Phase 3:** report active members, weekly Market Intel generations, and whether cost pressure is real before a human authorizes Release 2.

---

## Critical invariants — corrected for SynchIntro/Firestore (do not violate)

- **Identity:** `req.userId` = Firebase UID (set in `index.js` via `verifyAuth`). `/users/{uid}` is keyed by the UID. There is no Mongo ObjectId here.
- **Credits are Firestore and already implemented** — see "Existing primitives." Use the canonical helpers; never write a private copy.
- **`STRIPE_SECRETE_KEY`** is an intentional env-var typo — use the existing dual-read utility; do not rename. (F-003 to move the live key into Secret Manager is still open; the key is in `.env` today.)
- All Gemini 3.x calls: `thinkingBudget: 0` + `indexOf('{')` JSON extraction (some paths are migrating to `generateStructured()` — F-021/F-022; follow whichever the touched file uses).
- Gemini hierarchy: SIMPLE `gemini-2.5-flash`, PRIMARY `gemini-3-flash-preview`, ADVANCED `gemini-3.1-pro-preview`. Never `gemini-1.5-x`, `gemini-2.0-x`, or `gemini-3-pro-preview`.
- **Authoritative plan field:** `users/{uid}.plan` (top-level), fallback `plan → tier → subscription.plan → subscription.tier`. `TIER_RANK = { starter:0, growth:1, scale:2, enterprise:3 }`. Note: in practice `getUserPlan()` checks `subscription.plan` first — reuse `getUserPlan()` / `planGate.js`, don't reimplement.
- **Deploy via `firebase deploy`.** Functions are Firebase, not systemd. PowerShell: sequential commands only, no `&&`.
- **`buisnessName` / `buisnessAddress`** typos are PathManager (`col_users`) fields — only relevant if you touch cross-product code; do not "correct" them there.
- **Reviews:** Williams reviews all product PRs; **production Firestore rules changes MUST route through Williams (no exceptions).** Charles self-merges Build OS / infra / docs.
- **gcloud CLI is non-functional on the dev machine** (Python not installed). Any GCP operation (Secret Manager, etc.) is done via Console / Cloud Shell, not from Claude Code.
- UIDs: Charles (Owner) = `dehiyRBCXcUUM72O211S27lfXbl1`; `SE8bo7rvpdaUMBrmKSmIGLZRpQ32` = demo account; David Hailey / Countifi = `IQaKauAsYnbRFmwKNQPTZj1FqsL2` (**separate tenant — out of scope**); old `vkSfmPqfNrWYo7ZzelTwPgtC8yw2` is invalid.

Read `functions/SYSTEM_BIBLE.md` (canonical) and `functions/CLAUDE.md` before writing code; treat them as binding.

---

## Existing primitives you MUST build on (not rebuild)

Phase 0 must read each of these and design around it. Reinventing any of them is a defect.

- **Credits:** `functions/api/billing.js` exports `checkAndDeductCredits(userId, required, reason, options)` (atomic **Firestore transaction**, fails closed, route returns **503** on `BILLING_TRANSACTION_FAILED`, **402** on insufficient), `refundCredits(...)`, `writeCreditLedger(userId, amount, reason, service)`. Ledger lives at `/creditLedger/{userId}_{batchId}` — **already idempotency-keyed**, Admin-SDK only. Balance is `users/{uid}.credits`. The "**reserve max upfront, refund the delta**" pattern is already documented and in use — that *is* reserve-then-settle. SYSTEM_BIBLE: "always use these — never write a private copy."
- **Team/workspace (already partially built):** `/workspaces/{workspaceId}` (`ownerId` + `memberIds[]`), `/teams/{ownerUid}` (`memberUids[]`, Admin-SDK writes, used for plan inheritance), `/teamInvitations/{inviteId}` (`teamOwnerUid` + `inviteeEmail`, Admin-SDK writes). Routes `teamRoutes` / `userRoutes` / `analyticsRoutes` are mounted. `workspaceId` already appears on `pitches`, `marketReports`, and `Account360`.
- **Branding/entitlements (already built — this is most of §2/§6):** `resolveBrand(userId)` returns the `resolvedBrand` contract; `agencyBrandOverrides/{uid}` is client-writable branding **except** `planTier`/`featureFlags`; `agencyEntitlements/{uid}` is server-controlled (Admin-SDK only); `useCustomBranding` toggles application while preserving saved config; capabilities are plan-gated (branding all tiers, company/contact Growth, logo/color Scale); `effectiveTier` = higher of entitlements vs subscription.
- **Pitch:** `/pitches/{pitchId}` (`userId` owner; `shared` / `sharing.public` already enable public read — currently of the **whole doc**); `pitchVersions` (owner-scoped, Admin-SDK writes, `pitchId`+`versionNumber`); `pitchAnalytics`.
- **Public-share precedent:** `opportunityBriefs` are read publicly via a server-side `shareToken` (Admin SDK), not a client rule.
- **Firestore lock precedent:** `/govSyncLocks` is an existing Firestore lock pattern — reuse it; **do not introduce Redis** (no Redis in SynchIntro; semantic caching is a separate Sept item).
- **Cache:** `/marketCache`, `/marketReports`, `/marketBenchmarks`, plus various `*Cache` collections (Admin-SDK only).
- **ICP/company-context:** `/icpProfiles/{profileId}` (owner-scoped; `isDefault` Admin-SDK only).
- **Email:** `@sendgrid/mail` is installed but `SENDGRID_API_KEY` is **not wired** — which is why invite emails don't send. Wiring it is part of Phase 3A.

**Firestore mechanics (not Mongo):** atomicity = `runTransaction` / `FieldValue.increment`. **Uniqueness = make the unique value the document ID** (Firestore has no unique indexes) or use a guard doc. Locks = a lease doc + transaction (the `govSyncLocks` pattern).

**Transaction side-effect rule (applies everywhere — locks, credits, invites, generation):** Firestore transactions may **read/write Firestore state only**. **Never** call Gemini, DataForSEO, Serper, SendGrid, Slack, or any external API from inside a `runTransaction` callback — transactions retry on contention, so an external call inside one can fire more than once (double-charge, duplicate email, duplicate generation). The required sequence is always: (1) a transaction *claims* the reservation/lock/fence state, (2) external work runs **outside** any transaction, (3) a final transaction *re-verifies* current fence/ownership and commits the result, settlement, refund, or recovery state.

---

## In scope / out of scope

**In scope:** server-side workspace resolution; the bootstrap; member model with roles + status; branding/company inheritance built on `resolveBrand`/`agencyBrandOverrides`/`agencyEntitlements`; immutable branding **version history** (new); invite/accept/reactivation/offboarding built on `teamInvitations`; seller-identity rebind; market-intel shared cache (Firestore + `govSyncLocks`); workspace-pooled credits built on `billing.js`; a privileged-action audit log (new); hardening the public share projection.

**Out of scope:** the David/Countifi tenant; per-seat credit sub-limits (leave room); cross-tenant global cache; moving the credit/billing system off Firestore.

**Named and deferred (leave room, don't build):** true data-deletion / right-to-be-forgotten (PII in display-name snapshots vs "never hard-delete"); advanced cutover (dual-write, automated rollback orchestration). **Minimum cutover IS in scope** (feature-flag workspace reads/authorization; keep legacy reads during the controlled transition).

---

## Architecture decisions (implement; don't re-litigate)

### 1. Tenancy & server-side workspace resolution
Never trust a client-supplied `workspaceId`. Every workspace-scoped handler: derive a candidate workspace, resolve the caller's membership **server-side** (Admin SDK — note the rules already say member lookups must go through the backend, since `array-contains` can't satisfy the `in` rule at query-planning time), verify membership is ACTIVE, enforce role from the live member record, and scope every read/write by `workspaceId`. **Deny-by-default** when no active workspace resolves.

- **Active-workspace contract:** one active membership may default; more than one requires an explicit candidate via the approved header/route, verified server-side; "last selected" is a UX preference, never authorization. Never default to "first membership." (Low urgency today — single workspace — but bake it in.)
- **Legacy null-`workspaceId`:** existing pitches/reports may have no `workspaceId`. A workspace-scoped query must never return a doc with absent/null `workspaceId`, and never treat null as the active workspace. Legacy docs remain reachable only via the owner-scoped legacy path.

### 2. Entitlement & plan — inherit the owner's, don't relocate it
Plan/entitlements already live on the owner (`users/{owner}.plan`, `agencyEntitlements/{owner}`) and already inherit to members (rules let members read the owner's user/team doc for this). **Do not move plan onto the Workspace** — that fights `resolveBrand`, `getUserPlan`, `effectiveTier`, and the existing inheritance reads. Instead, **formalize owner→member inheritance as the workspace entitlement**: a member's effective plan/branding/entitlements = the workspace owner's, resolved server-side. The only open billing decision is credit pooling (§12).

**One unambiguous financial/entitlement owner.** Each workspace has exactly one `entitlementOwnerUid` (== `billingOwnerUid`), and it is the **sole source** for: plan inheritance, Stripe customer mapping, the current credit balance, and `agencyBrandOverrides` / `agencyEntitlements` resolution. A workspace may have **multiple ADMIN members, but they never create competing billing/entitlement owners.** This resolves the contradiction between "Admin/Owner can edit branding" and "branding is owner-client-writable": a **non-owner** Admin's branding edit and a Manager's company-context edit do **not** write directly to the owner-keyed client docs — they go through a **server-side handler** that (1) verifies role, (2) writes the **owner-keyed source record** (`agencyBrandOverrides/{entitlementOwnerUid}` etc.), (3) creates a branding version where applicable (§6), and (4) writes an audit event (§13). Owner transfer is an **explicit, audited migration** that updates the workspace owner, `entitlementOwnerUid`, the `/teams` inheritance mirror, and the Stripe/billing mapping atomically (or through an explicit migration state).

### 3. Ownership model (Firestore)
| Object | Lives in | Who sees it | Writes |
|---|---|---|---|
| Branding (current) | `agencyBrandOverrides/{ownerUid}` (existing) | members inherit via owner | owner (client), entitlement fields Admin-SDK |
| Branding version history | `workspaceBrandingVersions/*` (new, immutable) | system | Admin-SDK append-only |
| Company context | `icpProfiles` + owner profile (existing) | members inherit | Manager+/Admin |
| Personal seller identity | `users/{uid}` profile fields | self (+ admins) | the member |
| Pitch | `/pitches/{id}` (`userId`=creator, `workspaceId`) | self + Manager/Admin | the member (Admin-SDK for versions) |
| Lead | workspace-scoped doc, `assigneeUid` | per role | assignee + Manager/Admin |
| Market Intel report | `marketReports` / cache (existing) | members | Admin-SDK |
| Credits | `users/{owner}.credits` today; workspace balance per §12 | Admin | Admin-SDK via `billing.js` |
| Audit log | `workspaceAuditLog/*` (new) | Manager/Admin | Admin-SDK append-only |

Non-negotiable: **the book of business belongs to the company, not the rep.** Leads are workspace-owned with an `assigneeUid` pointer; the rep is never the owner. Lead export is Manager/Admin only and audited.

### 4. Roles + Owner — and the member-model decision
- Roles enum: `CONTRIBUTOR`, `MANAGER`, `ADMIN`. **Owner is a flag, not a fourth role** (`isWorkspaceOwner: true` on an Admin member). A workspace always has ≥1 active owner; the **last active owner cannot be removed/demoted/deactivated**; ownership transfer is an audited transaction.
- Capabilities: Contributor = own pitches/analytics + may trigger a generation (attributed, visible to Mgr/Admin); Manager = all team pitches + rollup analytics + lead reassignment + export + edit company context; Admin/Owner = + branding, member management, billing/credits/force-refresh.
- **Member-model decision (recommended, Phase 0 to confirm):** the current model embeds members as arrays (`workspaces.memberIds[]`, `teams.memberUids[]`), which can't carry per-member role/status/audit cleanly. Introduce a **`workspaceMembers/{workspaceId}_{uid}`** document collection (doc-ID composition **enforces the `(workspace, user)` uniqueness** Firestore can't index) as the **source of truth** for role, status, `joinedAt`, `removedAt`, `reactivatedAt`. Keep the `memberIds[]` array as a **denormalized mirror** so the existing security rules' `in` checks keep working — update both in the same transaction. Also reconcile the overlap between `/workspaces/{id}` and `/teams/{ownerUid}`: pick `/workspaces/{id}` as canonical and treat `/teams` as the plan-inheritance mirror (or fold it in). Flag this for Charles before building. (Alternative: stay pure-array — rejected, because roles/status/reactivation/seat-reservation get ugly.)

### 5. Data entities
Extend: `workspaces`, `teams`, `teamInvitations`, `pitches`, `pitchVersions`, `icpProfiles`, `agencyBrandOverrides`, `agencyEntitlements`, `creditLedger`, `marketReports`/`marketCache`. New: `workspaceMembers/{workspaceId}_{uid}`, `workspaceBrandingVersions`, `workspaceAuditLog`, a market-intel shared-cache doc keyed by `(workspaceId, canonicalDomain, reportVersion)`, and a `govSyncLocks`-style lock doc for generation.

### 6. Pitch composition & branding versioning
- **Generated copy is frozen** at creation (later company-context edits never rewrite an existing pitch). `pitchVersions` already exists for content versions — reuse it.
- **Branding is a live reference for active rendering, with immutable version history.** `resolveBrand`/`agencyBrandOverrides` already render live and already preserve config behind `useCustomBranding`. Add `workspaceBrandingVersions` (append-only snapshot on each branding change) and stamp each pitch with the `brandingVersionId` it rendered under, so historical reconstruction is possible. The "branding lock" you'd otherwise build already exists as the server-controlled `agencyEntitlements` fields + the `useCustomBranding` toggle.

### 7. Attribution vs operational ownership (separate fields — overwriting corrupts analytics)
On each pitch/lead: immutable `createdByUid` + `createdByDisplayNameSnapshot` (historical attribution, Contributor analytics) vs mutable `assigneeUid` (operational follow-up) + optional `formerMemberAt`. Offboarding changes operational ownership only; never `createdBy*`.

### 8. Seller identity on already-sent pitches
A shared pitch embeds the creator's name/email/calendar link. On offboarding, **rebind active/shared pitches' seller identity to the new assignee** (so "book a meeting" doesn't hit a dead calendar), falling back to a workspace default, while preserving `createdBy*`.

### 9. Offboarding (two-stage: atomic control plane + bounded batch worker)
A single transaction over an unbounded set of leads and pitches will eventually exceed Firestore's per-transaction document and time limits, so do **not** put the record rewrites in one atomic transaction. Split it:

**Stage 1 — control-plane transaction (atomic, small, fixed-size):** mark the member `status: OFFBOARDING`; revoke access immediately; select and persist the successor assignee (chosen member → Admin fallback); update the `memberIds[]` mirror; create an **idempotent offboarding job** record and an **audit-start** entry. This is the transaction your rollback test targets.

**Stage 2 — server-side batch worker (bounded, resumable, idempotent):** in bounded batches, reassign leads, rebind seller identity on active/shared pitches, set `formerMemberAt` (never `createdBy*`), and record progress idempotently so a crash resumes rather than restarts.

**Stage 3 — completion transaction (atomic):** mark the member `status: REMOVED` + `removedAt` and write the completion audit entry. **Never hard-delete** a member doc; analytics rows persist.

**During the transition,** public/shared pitches must resolve seller identity through the **current assignee or the workspace fallback** (§8/§14), so a former member's calendar is never exposed while batch work is still running. Tests: keep the rollback test on the Stage-1 control-plane transaction, and add resume/retry tests for the batch worker.

### 10. Invitation lifecycle, security, reactivation (extend `teamInvitations`)
`teamInvitations` exists (owner+invitee, Admin-SDK writes). Harden it:
- Generate a **cryptographically random token; store only its hash** on the invite. Lowercase/trim email.
- Accept = **bind by token, then by Firebase UID** (not email — the invited email may differ from the login email). Atomic transition PENDING→ACCEPTED only when token-hash matches, unexpired, status PENDING. On accept, create/locate the canonical `/users/{uid}` doc (already UID-keyed, so one UID ⇒ one user doc — the duplicate-identity risk is structurally handled), create the `workspaceMembers/{workspaceId}_{uid}` doc, mirror into `memberIds[]`, store `acceptedByUid`/`acceptedAt`. **Second redemption fails safely; no second member.** Single-use, short expiry.
- **Reactivation:** a REMOVED member re-invited → reactivate the existing `workspaceMembers` doc (`reactivatedAt`), never a second doc.
- Populate `invitedAt`/`joinedAt` (kills `Invalid Date`). Render the invite email with **workspace name + inviter display name** (kills "hello / hello"), and **wire `SENDGRID_API_KEY`** so invites actually send.
- **Seat reservation:** PENDING unexpired invitations reserve a seat; invite requires `ACTIVE members + PENDING unexpired < seat limit`; accept converts atomically; expiry/revocation releases. (Your Enterprise plan is unlimited-seat, so this binds only on capped tiers you sell.)

### 11. Market Intel shared cache (Release 2) — Firestore + `govSyncLocks`
- Cache doc keyed `(workspaceId, canonicalDomain, reportVersion)`. Resolve input → **canonical domain (eTLD+1)** before keying (lowercase, strip protocol/`www`/path); resolve name→domain via existing DataForSEO/Serper and cache that mapping. Bump `reportVersion` when the report shape changes (clean rollover). `marketReports`/`marketCache` already exist — extend, don't fork.
- **TTL:** 14-day report-level v1; store each section's `fetchedAt` for later per-section freshness.
- **Lock (reuse the `govSyncLocks` Firestore pattern — not Redis):** a lease doc with a unique owner token, acquired/released inside a transaction; release only if the token matches; bounded waiter backoff then re-read. Support **lease renewal** while generating, and persist a **monotonically increasing fence value** with the cache doc; before writing the cache result or settling a charge, re-verify ownership/fence inside the transaction so a stale worker can't overwrite a newer result or double-charge.
- **Negative caching** with a bounded TTL by failure class (~15 min transient, up to ~60 min hard resolution failure). **Partial generation:** cache succeeded sections with status; don't charge full credits for a partial report.

### 12. Workspace-pooled credits (Release 2) — extend `billing.js`, don't replace it
- **Build on the canonical helpers.** Firestore transactions already make `users/{uid}.credits` atomic; the `/creditLedger/{userId}_{batchId}` ledger is already idempotency-keyed; "reserve max / refund delta" already implements reserve-then-settle. Do **not** introduce a Mongo ledger, a materialized balance projection, or a parallel reserve system — those were Mongo-shaped and are unnecessary in Firestore.
- **The one real decision (Phase 0):** do member generations draw on the **owner's** `users/{owner}.credits` (simplest, matches existing inheritance — effectively already pooled) or a new **`workspaces/{id}.credits`** balance? Recommended: introduce a workspace balance and a thin workspace-aware wrapper around `checkAndDeductCredits`/`refundCredits` that targets it, so attribution (who spent) is recorded in the ledger entry while the balance is shared. Decide before building.
- Cache hit (fresh) = **0 credits** (a free ledger note, not a debit). Cache miss = deduct, attributed to the triggering member via the ledger. Force-refresh = Admin-gated, flagged. Idempotency via the existing `{userId}_{batchId}` keying (`batchId` = the generation request id).
- **Recovery:** a crash between deduct and refund-delta can strand credits; a recovery job keyed on the ledger's batchId detects unresolved reservations, checks whether generation completed, and refunds idempotently with an audit entry.
- **Thresholds:** alert at ~20% remaining via the **SynchNotify → Slack** pipeline; reconciliation recomputes balance from the ledger and **alerts on drift via SynchNotify** (don't just log). Hard-block at zero (cached reads stay free); top-up is an Admin action.

### 13. Privileged-action audit log (new)
Append-only `workspaceAuditLog` (Admin-SDK only) for role changes, removals/reactivations, lead exports (who/when/count), force-refresh, company-context and branding edits, ownership transfer, entitlement changes. Concrete value: protects Charles in any dispute over Daniyal's pilot (role/lead-reassignment history).

### 14. Public pitch share-link (build on what exists) — **P0 security**
Today `/pitches` rules serve the **whole doc** publicly when `shared==true || sharing.public==true` — a real leak. Replace client-public-read with the **`opportunityBriefs` precedent**: a server-side `shareToken` queried via Admin SDK returning an **allowlisted projection** (the pitch + bound seller identity only — never roster, analytics, credits, other pitches, internal notes). Add `revokedAt`/`expiresAt`; a revoked/expired token returns nothing. Never serialize the raw pitch document to the public endpoint.

**Rules cutover (the endpoint alone does not close the hole).** Firestore reads are document-level — rules cannot expose some fields while hiding internal ones in the same doc. So **in the same PR** that adds the server-side share-token endpoint: **remove unauthenticated public read of `/pitches/{pitchId}` from `firestore.rules`** (public access only via the server projection), and **preserve or redirect existing public share URLs** before disabling the old path. Emulator tests must prove: (1) an unauthenticated direct Firestore read of a shared pitch is **denied**; (2) an authenticated non-member direct read is **denied**; (3) the valid server share-token endpoint returns **only** the allowlisted fields; (4) revoked and expired tokens return **nothing**. (This PR touches `firestore.rules` → mandatory Williams review.)

### 15. Bootstrap safety
Single-owner bootstrap: create/confirm Charles's `/workspaces/{id}` with him as `ownerId` + `isWorkspaceOwner`, reconcile any existing `/workspaces` and `/teams/{ownerUid}` docs for his UID (don't create duplicates), confirm branding/entitlements already resolve via `resolveBrand` (they should — they're owner-keyed). **Idempotent, reversible, backed up** before writing; ship a written rollback runbook; do not retire any legacy user-level copies until workspace reads verify. **Archive/quarantine** (not hard-delete) the stale pre-refactor team entries (`tdh356b`, `daniyal@pathsynch.com`) with a reversible audit trail so they can no longer grant authorization. Daniyal/Tonya join later via the real Phase 3A invite flow.

### 16. De-risking the concurrency core (gate before Release 2)
Before any Phase 4/5 feature code: spike the **Firestore transaction credit guard** (extending `billing.js`) and the **`govSyncLocks`-style lease+fence lock** in isolation, prove each under contention, and confirm a test harness can run **genuinely parallel** requests against the **Firestore emulator**. If the harness can't, building it is the first task. Release 2 does not start until this passes.

---

## Phases — gated

### Phase 0 — Explore, confirm, settle blocking decisions (no production code)
- Read SYSTEM_BIBLE, CLAUDE.md, and the actual `billing.js`, `planGate.js`, `resolveBrand`, `teamRoutes`/`userRoutes`, the `workspaces`/`teams`/`teamInvitations` rules + shapes, and the market-intel cache code.
- Map every "already made" decision here against the real code; report matches/differences.
- Settle the blocking decisions: (a) member model — `workspaceMembers` doc collection + array mirror vs pure array (§4); (b) `/workspaces` vs `/teams` consolidation (§4/§15); (c) credit pooling — owner balance vs workspace balance (§12).
- **Preflight (read-only):** confirm one-UID-to-one-user-doc holds (it should, since `/users/{uid}` is UID-keyed) and report any anomalies; inventory every Stripe webhook/billing path (F-003 context) before any entitlement change.
- Produce schemas + per-phase file plan. **Gate: human sign-off before Phase 1.**

### Phase 1 — Data model + bootstrap + workspace-resolution guard
- Create `workspaceMembers`, `workspaceBrandingVersions`, `workspaceAuditLog`; implement the server-side workspace-resolution guard (§1) and deny-by-default; single-owner bootstrap (§15).
- **Gate tests:** foreign `workspaceId` denied; legacy null-`workspaceId` never returned; bootstrap idempotent; branding/plan resolve for the owner via existing `resolveBrand`/`getUserPlan`.

### Phase 2 — Inheritance + branding version history
- Members inherit the owner's branding/company context via `resolveBrand`; add `workspaceBrandingVersions` + per-pitch `brandingVersionId`; generated copy frozen.
- **Gate tests:** member with no personal branding sees workspace branding; a branding update reflects on active pitches while their generated copy is unchanged; prior branding reconstructable from history.

### Phase 3 — Identity, roles, offboarding (sub-phases)
- **3A Invite binding & email:** token-hash + atomic single-use accept, bind by token+UID, both signup paths, reactivation, seat reservation, `invitedAt`/`joinedAt`, invite email renders workspace+inviter name, **wire SendGrid**.
- **3B Roles & analytics:** three roles + owner flag enforced server-side from the live member doc; analytics scope `workspaceId` always, `+ createdByUid = self` for Contributors, rollup for Manager/Admin; Contributor generation allowed + attributed.
- **3C Offboarding & public-share cutover:** the two-stage offboarding (§9 — control-plane transaction + batch worker + completion transaction), lead export audited, audit log live, and the **P0 public-share rules cutover** (§14 — remove unauthenticated `/pitches` public read + add the share-token endpoint in the same PR, with the four emulator tests).
- **Gate tests:** all identity/role/offboarding/public-link rows below.

### ⛔ MANDATORY STOP — end of Release 1
Report usage (active members, weekly generations, cost pressure). No Phase 4 without explicit human go-ahead.

### Pre-Release-2 spike (gate — §16)
Spike the Firestore credit guard and the lease+fence lock; confirm a parallel Firestore-emulator load harness exists. Report results.

### Phase 4 — Market Intel shared cache (§11)
Canonical key, 14-day TTL with per-section `fetchedAt`, `govSyncLocks`-style lease+fence lock, bounded negative cache, partial generation, on top of existing `marketReports`/`marketCache`.
- **Gate tests:** cache hit/miss, real-parallel concurrency, fence (stale worker can't commit), negative-cache, partial-generation.

### Phase 5 — Workspace-pooled credits (§12)
Workspace-aware wrapper over `billing.js`, the pooling decision implemented, attribution in the ledger, 20% + drift alerts via SynchNotify, hard-block at zero, recovery job.
- **Gate tests:** all credit rows below, including real-parallel oversell and the drift alert.

---

## Acceptance tests (encode as automated; concurrency tests MUST run under real parallel load on the Firestore emulator)

Tenancy & entitlement:
- A caller with no ACTIVE membership in the passed `workspaceId` → denied; role enforced from the live member doc, not a client claim.
- A workspace-scoped query never returns a null/absent-`workspaceId` doc, nor treats null as active.
- A member's effective plan/branding resolves to the owner's via `resolveBrand`/`getUserPlan` (inheritance), with no plan field relocated onto the workspace.
- Exactly one `entitlementOwnerUid` per workspace; a non-owner Admin's branding edit goes through the server handler that writes the owner-keyed record, creates a branding version, and writes an audit event — it does not write a competing owner doc.
- No external API call (Gemini, DataForSEO, Serper, SendGrid, Slack) occurs inside any `runTransaction` callback in the generation, credit, lock, or invite paths (enforced by structure/review; verified by the claim → external-work → verify-and-commit sequencing).
- >1 active membership → no candidate is rejected (never defaults to first); a candidate is honored only after server-side verification.

Inheritance & branding:
- New member → sees inherited branding + company context (not a blank shell).
- Branding update → reflects on active pitches; existing generated copy unchanged; prior branding reconstructable from `workspaceBrandingVersions`.

Identity, roles, offboarding:
- Accept from a different email than invited → binds to the correct UID via token; no orphan PENDING; no duplicate member.
- Second redemption of a token → fails safely; no second member.
- `workspaceMembers/{workspaceId}_{uid}` doc-ID composition blocks a duplicate member.
- Re-invited REMOVED member → existing member doc reactivated; no second doc.
- `invitedAt`/`joinedAt` populated → no `Invalid Date`; invite email sends via SendGrid with workspace+inviter name.
- Two simultaneous accepts against the last seat → limit not exceeded (atomic).
- Offboarding control-plane atomicity: inject a failure inside Stage 1 → the control-plane transaction rolls back (no successor persisted, no status change, no false audit-start). The Stage-2 batch worker is resumable: a crash mid-batch resumes from recorded progress without double-reassigning, and during the transition a shared pitch resolves seller identity to the current assignee/workspace fallback (a former member's calendar is never exposed).
- Last active owner cannot be removed/demoted/deactivated; ownership transfer audited.
- Contributor analytics → only own `createdByUid` rows; Manager/Admin → full rollup. Contributor cannot export leads or edit branding or see others' pitches.
- Public share link (P0 cutover): (1) unauthenticated direct Firestore read of a shared pitch is denied; (2) authenticated non-member direct read is denied; (3) the share-token endpoint returns only the allowlisted fields; (4) revoked/expired tokens return nothing. The raw pitch doc is never served publicly.
- Privileged actions each write an audit entry.

Cache (R2):
- Name variants → one canonical key/entry.
- Fresh hit → 0 credits (free ledger note).
- Two concurrent uncached requests (real parallel) → one generation; charged once; waiter attaches.
- Stale worker after a newer owner/fence → cannot overwrite the result or double-charge.
- One source fails → succeeded sections cached; full credits not charged.

Credits (R2):
- Concurrent generations against a near-empty pool (real parallel) → cannot oversell.
- Built on `checkAndDeductCredits`/`refundCredits`/`writeCreditLedger` (no parallel ledger).
- Same `batchId` retried → charged once (idempotent).
- A crash-stranded reservation → recovery checks completion and refunds idempotently with an audit entry.
- Reconciliation recomputes from the ledger; induced drift fires a SynchNotify alert.

Operability:
- Bootstrap run twice → no-op; rollback runbook restores pre-run state; quarantined legacy entries can no longer authorize and are reversible.
- Pre-Release-2 spike passes; parallel Firestore-emulator harness confirmed.

---

## Workflow and review protocol
- Small PRs; prefer the 3A/3B/3C split. Don't advance a phase until its gate is green. Honor the Release-1 stop and the spike gate.
- **Williams reviews all product PRs; every `firestore.rules` change MUST go through Williams.** Hardest review on: §2/§12 billing-adjacent work, §11 lock/cache concurrency, and any rules change. Charles self-merges Build OS / infra / docs.
- Deploy via `firebase deploy`. Watch `functions/package.json` lockfile conflicts (PR #12 axios is open — low risk).
- If reality contradicts any decision here, **stop and flag it.**

## Start now with Phase 0 only.

---

## Appendix — deferred refinements (revisit at Release 2 / first paid multi-seat customer; do not build now)

These were reviewed and are correct, but acting on them now buys little at your current scale and adds length/risk. Pick them up at the trigger noted.

- **Workspace-scoped credit idempotency (Release 2 trigger).** If credit pooling targets a workspace balance, the ledger idempotency key must become `${workspaceId}_${generationRequestId}` (not `${triggeringUid}_…`), with `triggeredByUid` stored separately for attribution, and `checkAndDeductCredits`/`refundCredits` must accept an explicit account target. This also implies coupling the ledger write into the charge transaction, which **overrides the existing fire-and-forget ledger rule** — so it is a **Williams decision**, not a silent change. Resolve when building Phase 5, behind the spike gate.
- **Invite-guard document (first capped-seat paid customer trigger).** For strict one-pending-invite-per-`(workspace, email)`, create `workspaces/{workspaceId}/inviteGuards/{sha256(normalizedEmail)}` in the same transaction as the invitation; release it on accept/revoke/expiry; add a scheduled cleanup that expires stale invites and releases seats; lazily reject expired invites on the invite/accept paths; never log/analytics/referrer the raw token. Matters only once capped-seat plans and concurrent same-email invites are real (your Enterprise plan is unlimited-seat).
- **Nested member path (optional cleanliness).** `workspaces/{workspaceId}/members/{uid}` is cleaner than the concatenated `workspaceMembers/{workspaceId}_{uid}` (better rule scoping, collection-group queries) and is collision-safe by path. Both are correct; switch only if/when convenient, since it touches every member-referencing rule and query.
- **SendGrid production-secret gate (honor operationally in 3A).** Real invitation email must not go live through the `.env` key. Build/test the invite lifecycle behind a non-delivery adapter and hold production email activation until `SENDGRID_API_KEY` is a proper Firebase/Google secret (ties to open F-003). This can be enforced by hand during 3A without a prompt rule.

---

## Production State Record — June 25, 2026 (Bootstrap Night)

> This section records the production state after the June 25 session. It is append-only context for future phases.

### What Happened

Four production mutations ran live on June 25, 2026:

1. **P0 Pitch Leak CLOSED.** Production `firestore.rules` had unauthenticated public-read on pitches (`allow read: if resource.data.shared == true || sharing.public == true`). A real pitch was publicly readable. Fixed via 3 coordinated deploys: functions (share endpoints live), hosting (fetch-based `p/index.html`), then rules (public-read removed). Verified in Firebase Console + browser.

2. **Workspace Bootstrap.** `scripts/bootstrap-workspaces.js` created `workspaces/ws_bootstrap_charles` with Charles as sole admin/owner. Backup taken first. Quarantined `tdh356b@gmail.com` (test account) and 2 orphan teams. Idempotent — never touches Auth claims or migrates pitches.

3. **Workspace-Scoping Backfill.** After bootstrap, workspace resolver scoped all queries to `workspaceId == ws_bootstrap_charles`, hiding 225 pitches + 37 marketReports with no `workspaceId` field. Fixed via `scripts/backfill-workspaceid.js --write`. **RULE: any future bootstrap MUST be followed by backfill.**

4. **Daniyal Invite.** Invitation `RIpTodxC2DowSfLRbJux`, workspace `ws_bootstrap_charles`, email `daniyal@pathsynch.com`, role `contributor`, status PENDING, expires July 2. Created via Admin SDK script because browser path was blocked by GCP Secure Token API restriction.

### Production-Ahead-of-Main

Code is on branches `feature/phase3c-offboarding-share-cutover` (functions/rules) and `fix/remove-public-pitch-rule-p0` (synchintro-app hosting), NOT merged to main. PRs #38 + #39 open. **A deploy from main would regress the leak fix.** Commit: `c13ed1a`.

### Cross-Repo Rules Hazard

Both repos deploy `firestore.rules` to the same project (`pathsynch-pitch-creation`). **RULE: never run bare `firebase deploy` from synchintro-app — always `--only hosting`. Canonical rules source = pathsynch-pitch-generator.**

### Production Share Host

`https://pathsynch-pitch-creation.web.app/p/{shareId}`. `synchintro.ai` is a separate marketing site.

### Open Items (Carry Forward)

- **onepagers leak (P0):** Identical `shareId != null` unauthenticated read. No server share endpoint yet. Same fix pattern as pitches needed.
- **GCP Secure Token API restricted (P0):** `securetoken.googleapis.com` returns 403. May break token refresh for real users. Fix: allow Identity Toolkit API in GCP key restrictions.
- **Brief Williams:** Solo production deploys ran without his review. Send rules diff + summary.
- **Daniyal acceptance:** Confirm `workspaceMembers` doc + workspace access once he accepts.

### Impact on Future Phases

- **Phase 3A (invite binding):** The Daniyal invite was created via script, bypassing the browser invite flow. Phase 3A must still build the full invite lifecycle (token-hash, atomic accept, SendGrid email). The existing invite record is compatible — it uses the real `createWorkspaceInvite()` service.
- **Phase 3C (offboarding + share cutover):** The pitches share cutover is partially complete (server endpoints live, rules updated). Onepagers share cutover remains. The four emulator tests from the prompt (unauthenticated denied, non-member denied, allowlisted fields only, revoked/expired returns nothing) should be validated against the deployed state.
- **Backfill obligation:** Any new user bootstrapped into a workspace requires a backfill pass on their legacy pitches/marketReports before their data is visible in the workspace-scoped UI.
