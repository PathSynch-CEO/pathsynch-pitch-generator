# Workspace-Aware Plan Resolution — Full Backend Audit

**Date:** 2026-08-28
**Commit audited:** `3ecb5c4` (main, immediately after PR #125 merged)
**Scope:** every call site of `getUserPlan`, `getUserPlanForRequest`, and every local
tier-resolution helper under `functions/` (excluding `functions/tests/`,
`functions/scripts/`, and `node_modules`).
**Status:** audit only — no code was changed in this PR.

The governing rule is SYSTEM_BIBLE law 13: *backend plan gates MUST use
`getUserPlanForRequest(req)`, never `getUserPlan(req.userId)`*, so a workspace member
is gated on the OWNER's plan rather than on the stale signup tier in their own
`users/{uid}` doc.

---

## 1. How each call site was classified

| column | meaning |
|---|---|
| **Purpose — gate** | the resolved tier decides whether the request is allowed (403/429) or whether a paid capability is switched on |
| **Purpose — quota** | the tier selects a numeric limit that the request is then checked against (a gate with a number) |
| **Purpose — display** | the tier is only reported back to the client (availability flags, credit counters); a wrong value misleads the UI but blocks nothing server-side |
| **Purpose — analytics** | the tier is stamped onto a stored record for later analysis |
| **Purpose — retention** | the tier selects how much stored data is kept; a wrong value destroys data |
| **WS ctx** | does the call pass workspace context (`{ workspaceId }`, `getUserPlanForRequest`, or an equivalent owner-resolution such as `req.entitlementOwnerUid`)? |

"Line" is the line of the resolution call itself.

---

## 2. Violations — gates and quotas that resolve workspace-blind

These are the findings. Each one gates a member on their own `users/{uid}` doc, so a
contributor on an Enterprise/Scale workspace is denied a capability the UI (fed by
`GET /me/workspace-context`) tells them they have.

| # | File | Line | Symbol / endpoint | Purpose | WS ctx | Notes |
|---|---|---|---|---|---|---|
| V-1 | `functions/routes/precallFormRoutes.js` | 30 | `requireEnterprise(userId)` | gate | **no** | Same defect PR #125 fixed in investorRoutes. 8 call sites: 59, 83, 124, 154, 183, 214, 262, 361. The call at **214** consumes the return value (`const userData = await requireEnterprise(userId)`), so the dead-read removal done in investorRoutes does **not** transfer here. |
| V-2 | `functions/routes/landingPageRoutes.js` | 54 | `getUserTierAndCheckLimit(userId)` | gate + quota | **no** | Helper takes no `req`. Call sites 444 (`POST /landing-pages/generate`) and 643 (`GET /landing-pages`). Also drives `canRemoveBadge` (`NO_BADGE_TIERS`), so a member on a Scale workspace still gets the "Powered by" badge. |
| V-3 | `functions/routes/precallBriefRoutes.js` | 149 | `getUserTierAndCheckLimit(userId)` | gate + quota | **no** | Helper takes no `req`. Call sites 846 (`POST /precall-briefs/generate`) and 1308 (`GET /precall-briefs`). Also drives `canEnrichContact` (`CONTACT_ENRICHMENT_TIERS`, line 163) and `hasCustomLibrary` (line 170) — a member silently loses contact enrichment and the sales library rather than getting an error. |
| V-4 | `functions/routes/transcriptRoutes.js` | 144 | `POST /transcript/extract` (handler at 110) | gate | **no** | `tier === 'starter'` → 403. `req` is in scope at the call site. |
| V-5 | `functions/routes/transcriptRoutes.js` | 219 | `POST /transcript/leave-behind` (handler at 193) | gate | **no** | Same 403. `req` in scope. |
| V-6 | `functions/routes/sellerProfileRoutes.js` | 100 | `GET /seller-profiles` (handler at 74) | quota (display) | **no** | Returns `tier` + `limit` to the client; under-reports the member's real seat allowance. |
| V-7 | `functions/routes/sellerProfileRoutes.js` | 226 | `POST /seller-profiles` (handler at 210) | quota (enforcing) | **no** | `profiles.length >= limit` → 403. This is the enforcing half of V-6. |
| V-8 | `functions/api/pitch/validators.js` | 205 | `checkPitchLimit(userId)` | quota | **no** | Not previously flagged. Called from `api/pitchGenerator.js:590`; on failure returns 403 `PITCH_LIMIT_REACHED`. Helper takes no `req`. |
| V-9 | `functions/services/pitchMetrics.js` | 123 | `checkAndUpdateUsage(userId)` | quota | **no** | Listed in the brief as an analytics exception — **it is not one**. See §5. Called from `index.js:662` (`POST /generate-pitch`); returns `allowed:false` → HTTP 429. |
| V-10 | `functions/services/versionHistory.js` | 202 | `scheduleCleanup(pitchId, userId)` | retention (destructive) | **no** | Listed in the brief as an analytics exception — **it is not one**. See §5. `userId` here is the *editor* (`index.js:970` passes `decodedToken.uid`), so a member editing a workspace pitch prunes its history to the member's own starter retention limit. |
| V-11 | `functions/routes/merchantConfigRoutes.js` | 104 | `POST /merchant-config` (handler at 80) | gate (persisted) | **no** | Resolved tier is **written** to `merchantConfig/{uid}.planTier`, which is later read as a fallback by `utils/generateMerchantConfig.js:61`. A wrong value persists past the request. |
| V-12 | `functions/utils/generateMerchantConfig.js` | 56–63 | `writeMerchantConfig(merchantId)` | gate (persisted) | **no** | Local re-implementation of the plan chain (`subscription.plan → subscription.tier → plan → tier → config.planTier`), bypassing `getUserPlan` entirely. Feeds `isGrowthPlus(planTier)` at lines 81 and 99, which switch off PostHog and `companyIdEnabled` in the emitted config. Called from `merchantConfigRoutes.js:268`. |
| V-13 | `functions/routes/pitchRoutes.js` | 70 | `GET /pitch/styles` (handler at 63) | display of a gate | **no** | Returns the tier-locked style list and `customLibrary.available`. Does not itself block generation, but a member sees Growth+ styles as locked. |
| V-14 | `functions/index.js` | 737 | inline `GET /pitch/styles` | display of a gate | **no** | The pre-modular duplicate of V-13, still reachable through the inline dispatcher. Fixing V-13 alone leaves this one wrong. |

**Downstream effect of V-8/V-13/V-14:** `api/pitchGenerator.js:1689` gates LinkedIn post
generation on `userTier`, which comes from `checkPitchLimit(...).tier` (V-8). So the
pitch-styles mis-resolution is not purely cosmetic — the same blind tier reaches a real
content gate.

---

## 3. Correct — gates that already pass workspace context

| File | Line | Symbol / endpoint | Purpose | WS ctx | Mechanism |
|---|---|---|---|---|---|
| `functions/middleware/planGate.js` | 138 | `requireFeature(feature)` | gate | yes | `getUserPlanForRequest(req)` |
| `functions/middleware/planGate.js` | 171 | `checkUsageLimit(type)` | quota | yes | `getUserPlanForRequest(req)` |
| `functions/middleware/planGate.js` | 236 | `requirePlan(min)` | gate | yes | `getUserPlanForRequest(req)` — used by `routes/instantlyRoutes.js` at 165, 287, 328, 438, 479 |
| `functions/middleware/planGate.js` | 292 | `requireFormatter(type)` | gate | yes | `getUserPlanForRequest(req)` |
| `functions/middleware/planGate.js` | 326 | `checkNarrativeLimit()` | quota | yes | `getUserPlanForRequest(req)` |
| `functions/api/market.js` | 1008 | `hasFeature(plan,'marketReports')` → 403 | gate | yes | July-16 sweep |
| `functions/api/market.js` | 3469 | credit-info block | display | yes | July-16 sweep |
| `functions/api/market.js` | 4423 | refresh credit gate → 403 | quota | yes | July-16 sweep |
| `functions/api/export.js` | 33 | PPTX export → 403 | gate | yes | July-16 sweep |
| `functions/api/export.js` | 314 | export availability | display | yes | July-16 sweep |
| `functions/api/export.js` | 350 | format availability | display | yes | July-16 sweep |
| `functions/api/export.js` | 416 | PPTX render → 403 | gate | yes | July-16 sweep |
| `functions/api/formatterApi.js` | 41 | formatter availability → 403 | gate | yes | July-16 sweep |
| `functions/api/formatterApi.js` | 168 | batch formatting → 403 | gate | yes | July-16 sweep |
| `functions/api/formatterApi.js` | 465 | `listFormatters` | display | yes | July-16 sweep |
| `functions/api/narratives.js` | 42 | narrative quota → 429 | quota | yes | July-16 sweep |
| `functions/api/narratives.js` | 323 | regeneration quota → 429 | quota | yes | July-16 sweep |
| `functions/api/narratives.js` | 501 | SSE narrative quota | quota | yes | July-16 sweep |
| `functions/api/bulk.js` | 84 | bulk upload → 403 | gate + quota | yes | July-16 sweep |
| `functions/routes/investorRoutes.js` | 40 | `requireEnterprise(userId, req)` | gate (+ integrations) | yes | **PR #125** |
| `functions/routes/visitorRoutes.js` | 95 | `getUserTierAndCheckLimit(userId, req)` | gate + quota | yes | Aug-24 P0 fix; public track path resolves the snippet owner's workspace |
| `functions/services/memberContextService.js` | 142 | `GET /me/workspace-context` | display (authoritative) | yes | `getUserPlan(uid, { workspaceId: workspace.id })` — the value the client UI shows |
| `functions/api/events/eventLogger.js` | 42 | `POST /events` | analytics | yes | Deliberately workspace-aware (see §4) |
| `functions/routes/govcaptureRoutes.js` | 57 | `effectiveGovUserId(req)` | identity + billing | yes | Different mechanism: `req.entitlementOwnerUid` from `workspaceResolver`. No `getUserPlan` call; every gov data op is keyed on the owner uid. |

---

## 4. Deliberate exceptions — and why they are exceptions

### 4.1 Rate limiter — `functions/index.js:250–267`

The per-request plan read that populates `req.user.plan` for `middleware/rateLimiter.js`
is workspace-blind **by design**, and it is also deliberately *not* the canonical chain
(it reads `userData.plan` only, defaulting to `starter`).

Why it is an exception: rate limiting is abuse protection keyed to the **calling
identity**, not an entitlement decision. Every member of a workspace issues their own
request stream, and per-member throttling is the intended behaviour — resolving the
owner's plan here would grant each member the owner's full request budget, multiplying
the workspace's total allowance by seat count. It never returns an entitlement 403 on
behalf of a feature; the 403 it can emit (`rateLimiter.js:218`, endpoint blocked for
plan) is a throttling-policy decision on the same per-caller basis.

Two consequences worth recording rather than fixing:

- Because it does not use the canonical chain, a stale-tier paying user is rate-limited
  as `starter`. That is the pre-F-1014 read pattern surviving in a non-gate location.
- `routes/userRoutes.js:204` (`GET /rate-limit-status`) reports `req.user?.plan` back to
  the client. It inherits the same value; correct for a rate-limit readout, but it is
  **not** an entitlement figure and should not be read as one by the UI.

### 4.2 Analytics stamping — `functions/api/events/eventLogger.js:42`

Stamps `planTier` onto `userEvents/{uid}/events/*`. Historically it had its own local
plan read (stale `tier` first, raw casing, workspace-blind); it now uses
`getUserPlanForRequest(req)`.

Why it is an exception: it is not a gate — nothing is denied on the basis of this value,
and the endpoint has a never-block contract (`getUserPlanForRequest` never throws). It is
listed as an exception in SYSTEM_BIBLE law 13 in the sense that *it does not need to be
swept as a gate*; note that it is nonetheless already workspace-aware, so it stamps the
tier the member actually experiences. No action.

### 4.3 `functions/services/workspaceService.js:50` — `createWorkspace(ownerUid)`

`getUserPlan(ownerUid)` with no workspace context, resolving the seat limit for a
workspace being created.

Why it is an exception: the subject *is* the owner. There is no workspace to inherit from
— it does not exist yet — and `ownerUid` is by definition the entitlement owner. Passing
workspace context would be circular. Named as an exception in SYSTEM_BIBLE law 13. No action.

### 4.4 `functions/api/stripe.js:431` — `GET /subscription`

`getUserPlan(userId)`, canonical chain, no workspace context.

Why it is an exception: billing is personal. This endpoint reports the caller's own
Stripe subscription and price; a member has no subscription of their own and should see
that, not the owner's billing record. Resolving the owner's plan here would show a member
a subscription they do not pay for and cannot manage.

### 4.5 `functions/api/admin.js:239` — admin user detail

`getPlanLimits(await getUserPlan(userId))` where `userId` is the *target* user of an
admin lookup, not the caller.

Why it is an exception: it is an operator view of one specific account's own plan. The
caller's workspace is irrelevant, and the target's workspace inheritance is not what the
operator asked for. Adjacent admin aggregates (`index.js:2070`, `routes/adminRoutes.js:112–124`)
compute plan distributions straight off raw `u.plan || u.tier` for the same reason —
population statistics, not entitlement.

---

## 5. Two items on the exception list that do not hold

The brief listed `pitchMetrics.js` and `versionHistory.js` alongside `eventLogger.js` as
analytics stamping. Reading them, neither is analytics:

- **`services/pitchMetrics.js:123` (V-9)** — `checkAndUpdateUsage(userId)` resolves the
  plan, selects `planLimits[planTier]`, and returns `{ allowed: false, message: 'Monthly
  pitch limit reached…' }` when the counter is at the cap. `index.js:662` turns that into
  an HTTP **429**. It is the primary pitch-generation quota gate. The file *does* contain
  genuine analytics-adjacent code — `incrementUsage` (line ~176) bumps counters and
  `stats.totalPitches` — and that part needs no plan resolution at all. The plan read is
  the gate, not the stamp.
- **`services/versionHistory.js:202` (V-10)** — `scheduleCleanup` resolves the plan to
  pick `VERSION_LIMITS[planTier]` and then **deletes** versions beyond it. Nothing is
  stamped. Under-resolution is destructive and silent: a member editing a workspace
  pitch (`index.js:970` passes the editor's uid) prunes that pitch's history to the
  member's own starter retention limit, and the deleted versions are not recoverable.
  Of all 14 findings this is the only one whose damage is not undone by fixing the
  resolution later.

Both are recorded above as violations. Neither is a judgement about priority — that is
the merge seat's call — only about classification.

---

## 6. Adjacent observation (not a workspace violation)

`functions/services/brandResolver.js:98–104` (`_defaultEntitlements`) resolves a plan tier
with the chain `plan → tier → subscription.plan → subscription.tier`, i.e. the **stale
field first** — the exact ordering F-1014 exists to prevent. It is not a workspace
violation: `resolveBrand(brandOwnerId, { workspaceId })` already resolves the brand owner
before this runs (lines 146–165), so the subject is correct. But the value it derives
drives `_capabilitiesForTier` (custom logo, custom colours, "Powered by" badge), so a
paying user whose plan lives only in `subscription.plan` can be denied white-labelling.
This is an F-1014 residue, and it is worth its own ticket separate from the workspace work.

---

## 7. Coverage note

Searched across all of `functions/` for: `getUserPlan(`, `getUserPlanForRequest(`,
`hasFeature(`, `hasIntegration(`, `getPlanLimits(`, `isWithinLimits(`, and direct reads of
`subscription.plan` / `subscription.tier` / `userData.tier`. Every gated route file was
then read at each hit. Route files that mention `plan`/`tier` but perform no tier
resolution — `analyticsRoutes.js`, `attioRoutes.js`, `visitorSignalRoutes.js` (its `tier`
is identity-confidence, not plan), `instantlyRoutes.js` (delegates to `requirePlan`) — were
confirmed clean by inspection rather than left unlisted.

Totals: **14 violations** (V-1…V-14), **24 correct call sites**, **5 deliberate exceptions**
(rate limiter, eventLogger, `createWorkspace`, `GET /subscription`, admin views), plus
**1 adjacent F-1014 ordering residue** in `brandResolver.js`.
