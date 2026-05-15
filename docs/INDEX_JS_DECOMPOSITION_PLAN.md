# index.js Decomposition Inventory

> Auto-generated: 2026-05-15
> Source: `functions/index.js` (4785 lines)
> Purpose: Map every route group that has an extracted file in `functions/api/` or `functions/routes/` but still has inline handlers in `index.js`. Drives incremental migration order.

---

## Legend

| Clean Cut? | Meaning |
|-----------|---------|
| ✅ Yes | Handlers are thin wrappers that fully delegate to the extracted module. No index.js-local state or functions needed. Safe to extract. |
| ⚠️ Partial | Mostly delegating, but one or more handlers touch index.js-local helpers (`checkAndUpdateUsage`, `trackPitchView`, etc.) or have non-trivial inline logic. Requires moving shared helpers first. |
| ❌ No | Significant inline logic not delegated to the extracted module. Extracting would require substantial work beyond routing. |
| 🪦 Dead | Unreachable — a modular router intercepts the prefix before the inline code is reached. These should be deleted, not extracted. |

---

## Route Groups with Extracted Files + Inline Handlers

| # | Route Group | Inline Line Range(s) | Extracted File(s) | Wired in Dispatch? | Clean Cut? | Notes |
|---|------------|----------------------|-------------------|-------------------|-----------|-------|
| 1 | **Narratives & Formatter** `/narratives/*`, `/formatters`, `/assets/*` | 1268–1410, 4037–4056 | `api/narratives.js`, `api/formatterApi.js` | Not via router — inline dispatch only | ✅ Yes | All handlers call `narrativesApi.*` or `formatterApi.*` directly. No index.js-local state touched. Streaming endpoint (4037) also delegates cleanly. |
| 2 | **Market Intelligence** `/market/*`, `/benchmarks/*`, `/market-intel/*` | 1610–1791, 1793–1852, 1727–1739 | `api/market.js` | Not via router — inline dispatch only | ✅ Yes | All handlers call `marketApi.*`. Market report email handler (1685) uses `emailService` — an import, not mutable state. `/market/upload-filing` uses multer locally but that can move with the handler. |
| 3 | **Market Saved Searches** `/market/saved-searches/*` | 2509–2718 | `api/market.js` (logically belongs here) | Not via router | ✅ Yes | Four handlers (POST/GET/DELETE/run). Entirely inline Firestore reads — no extracted module yet, but logically part of the market group. Extract to `api/market.js` or a new `routes/marketRoutes.js`. |
| 4 | **Market Intel Pitch Context** `/market-intel/pitch-context-preview`, `/market-intel/pitch-companion-md` | 1793–1852 | `services/marketIntelPitchContext.js`, `services/pitchCompanionMd.js` | Not via router | ✅ Yes | Both handlers lazy-`require` the service modules. Thin wrappers only. |
| 5 | **Bulk Upload** `/bulk/*` | 1559–1608 | `api/bulk.js` | Not via router — inline dispatch only | ✅ Yes | Five handlers, all call `bulkApi.*`. No shared state. |
| 6 | **Export** `/export/*` | 2746–2806 | `api/export.js` | Not via router — inline dispatch only | ✅ Yes | Five handlers, all call `exportApi.*`. Multer is instantiated inline in the upload-filing handler but scoped locally. |
| 7 | **Stripe & Subscription** `/stripe/*`, `/subscription`, `/pricing-plans` | 2807–2853 | `api/stripe.js` | Not via router — inline dispatch only | ⚠️ Partial | Checkout and portal handlers delegate cleanly. Webhook (`/stripe/webhook`) relies on raw body buffering that must be preserved — confirm `stripeApi.handleWebhook` already handles raw body before extracting. |
| 8 | **Feedback** `/feedback/*` | 3796–3834 | `api/feedback.js` | Not via router — inline dispatch only | ✅ Yes | Four handlers, all call `feedbackApi.*`. No shared state. |
| 9 | **A/B Tests (Admin)** `/admin/ab-tests/*` | 3835–4033 | `api/abTests.js` | Not via router — inline dispatch only | ✅ Yes | Eleven handlers, all call `abTestsApi.*`. No shared state. Largest clean-extractable group by handler count. |
| 10 | **Onboarding** `/onboarding/*` | 802–808, 4350–4410 | `api/onboarding.js` | Not via router — inline dispatch only | ✅ Yes | Seven handlers split across two locations in the file. All call `onboardingApi.*`. Consolidation into a single block is a prerequisite of extraction. |
| 11 | **Logo** `/logo/*`, `/utils/fetch-logo` | 1857–1881, 4411–4448 | `api/logo.js` | Not via router — inline dispatch only | ⚠️ Partial | `/logo/*` (4411–4448) calls `logoApi.*` — clean. `/utils/fetch-logo` (1857–1881) lazy-requires `services/logoFetch` directly and is a distinct path — should be merged into `logoApi` or a separate `utils` router before extraction. |
| 12 | **Version History** `/pitch/:id/versions/*` | 812–864 | `api/versionRoutes.js` | Not via router — inline dispatch only | ✅ Yes | Four handlers (list, get, preview, restore), all call `versionRoutes.*`. `req.params` is set inline before delegating — this pattern is already used elsewhere and is safe. |
| 13 | **Event Logging** `/events/log` | 4451–4458 | `api/events/eventLogger.js` | Not via router — inline dispatch only | ✅ Yes | Single handler, delegates to `eventLoggerApi.logEvent`. |
| 14 | **Preferences** `/preferences/smart-mode` | 4461–4468 | `api/preferences/index.js` | Not via router — inline dispatch only | ✅ Yes | Single handler, delegates to `preferencesApi.getSmartMode`. |
| 15 | **Attio Market Intel** `/attio/push-lead`, `/attio/push-all` | 728–759 | `routes/attioRoutes.js` (handles `/attio/push-account` only) | Partial — `attioRoutes` dispatched at line 711 but returns `false` for these two paths | ✅ Yes | Two handlers that call `pushLeadToAttio` and `pushAllLeadsToAttio` from `attioClient`. Can be added to `routes/attioRoutes.js` alongside the existing `/push-account` handler. No shared mutable state. |
| 16 | **Instantly Market Intel** `/instantly-market/campaigns`, `/instantly-market/push-leads` | 763–797 | `routes/instantlyRoutes.js` (handles `/instantly/*` only — different prefix) | No — `instantlyRoutes` prefix `/instantly/` never matches `/instantly-market/` | ✅ Yes | Two handlers using `getInstantlyMarketCampaigns` and `pushLeadsToInstantly` from `instantlyClient`. Best placed in `routes/instantlyRoutes.js` with a path guard, or a new `routes/instantlyMarketRoutes.js`. |
| 17 | **Admin Core** `/admin/stats`, `/admin/dashboard`, `/admin/users/*`, `/admin/pricing`, `/admin/stripe/sync-metadata`, `/admin/bootstrap`, `/admin/fix-pitch/:id`, `/admin/revenue`, `/admin/pitches`, `/admin/usage` | 2855–3579 | `api/admin.js`, `routes/adminRoutes.js` | `routes/adminRoutes.js` is exported from `routes/index.js` but **not destructured** in `index.js` dispatch — effectively unwired | ❌ No | `/admin/dashboard` (lines 2913–3165) contains ~250 lines of inline Firestore aggregation that does not delegate to `api/admin.js`. Must refactor dashboard logic into `api/admin.js` before the route can be extracted. All other admin handlers are thin wrappers and could extract independently. `adminRoutes.js` needs to be added to the destructured import in `index.js` to activate it. |
| 18 | **Admin Discount Codes** `/admin/discount-codes/*` | 3580–3745 | `api/admin.js` (logically) — no separate file | Not via router | ⚠️ Partial | Four handlers with mixed inline Stripe + Firestore logic. Stripe client is imported at the top of `index.js` (not in `admin.js`). Extract requires either moving the Stripe import into `api/admin.js` or passing it as a dependency. |
| 19 | **Admin Team Management** `/admin/admins/*`, `/admin/roles`, `/admin/model-routing` | 4079–4316 | `api/admin.js` (logically) — no separate file | Not via router | ✅ Yes | Three endpoints. Handlers are mostly Firestore reads/writes with `requireAdmin` gate. No cross-handler shared state. |
| 20 | **Pitch (generate, list, get, update, delete, share, email, styles)** `/generate-pitch`, `/generate-outline`, `/generate-share-email`, `/pitch/styles`, `/pitch/:id`, `/pitches`, `/pitch/:id` (PUT/DELETE), `/pitch/:id/email`, `/extract-trigger-event` | 888–1267 | `routes/pitchRoutes.js`, `api/pitchGenerator.js` | `pitchRoutes` dispatches at line 681 for `/pitch` prefix; generate/list/update/delete remain inline | ❌ No | `/generate-pitch` calls `checkAndUpdateUsage()` and `incrementUsage()` defined only in `index.js`. `GET /pitch/:id` and `GET /pitch/share/:id` call `trackPitchView()` defined only in `index.js`. `/extract-trigger-event` calls `extractTriggerEventContent()` defined only in `index.js`. These four helper functions must be moved to a shared module (e.g. `services/pitchMetrics.js`) before the group can be extracted. |

---

## Dead Code — Unreachable Inline Handlers (Delete, Not Extract)

These inline handlers are preceded by a modular router that intercepts the same path prefix. They can never be reached in production. They should be deleted outright.

| Route Group | Inline Line Range | Intercepted By | Schema Notes |
|------------|-------------------|----------------|--------------|
| **User** `GET /user`, `PUT /user/settings` | 1412–1448 | `userRoutes.handle()` at line 598 | Identical logic to `routes/userRoutes.js`. Safe to delete. |
| **Analytics** `POST /analytics/track`, `GET /analytics/pitch/:id` | 1472–1533 | `analyticsRoutes.handle()` at line 626 | Identical logic to `routes/analyticsRoutes.js`. Safe to delete. |
| **Team (Schema A)** `GET/POST /team`, `/team/invite`, `/team/invite-details`, `/team/accept-invite`, `/team/members/:id/role`, `/team/members/:id` (DELETE), `/team/invites/:id` (DELETE) | 1962–2476 | `teamRoutes.handle()` at line 601 | **Uses obsolete Schema A** (`teamMembers` collection, `teamInvites` collection). Active `teamRoutes` uses Schema B (`teams/{ownerUid}`, `teamInvitations`). Not just dead — also wrong. Delete without extracting. |

---

## Not-Yet-Extracted Groups (No Extracted File Exists)

These groups are fully inline with no corresponding `api/` or `routes/` file. Out of scope for this inventory but noted for completeness.

| Route Group | Inline Line Range | Suggested Target |
|------------|-------------------|-----------------|
| Reviews `GET /reviews/google` | 868–886 | `routes/reviewsRoutes.js` |
| Health check `GET /health` | 4318–4349 | Keep inline (trivial) |
| Website Audit `GET /audit/website` | 4471–4479 | `api/analytics/` (logical home) |

---

## Migration Priority Order

Based on extraction complexity and blast radius:

1. **Delete dead code first** (groups 20–22 in dead-code table) — zero risk, reduces noise
2. **Clean-cut single-file groups** (groups 1, 3–6, 8, 12–14) — create `routes/*.js`, move inline `if` blocks, update dispatch
3. **Attio + Instantly market intel** (groups 15–16) — add to existing route files
4. **Onboarding** (group 10) — consolidate two locations first, then extract
5. **Logo** (group 11) — resolve `/utils/fetch-logo` vs `logoApi` split first
6. **Stripe** (group 7) — verify webhook raw-body handling before moving
7. **Admin A/B Tests** (group 9) — large but clean; good standalone PR
8. **Admin Discount Codes + Team Mgmt** (groups 18–19) — move Stripe client import first
9. **Admin Core** (group 17) — requires refactoring dashboard Firestore logic into `api/admin.js` and wiring `adminRoutes` into dispatch
10. **Pitch** (group 20) — requires extracting `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` into shared service modules first

---

## Shared Helpers That Block Pitch Extraction

These functions are defined in `index.js` and referenced by inline pitch handlers. They must be moved to a shared module before the pitch group can be extracted.

| Function | Defined At | Used By |
|---------|-----------|---------|
| `checkAndUpdateUsage(userId)` | ~line 386 | `/generate-pitch` handler |
| `incrementUsage(userId, field)` | ~line 458 | `/generate-pitch` handler |
| `trackPitchView(pitchId, viewerId, context)` | ~line 494 | `GET /pitch/:id`, `GET /pitch/share/:id` |
| `extractTriggerEventContent(url)` | ~line 227 | `/extract-trigger-event` handler |
| `ensureUserExists(userId, email)` | ~line 320 | `/generate-pitch`, bootstrapped via `api` handler |
| `getCurrentPeriod()` | ~line 218 | `checkAndUpdateUsage`, `incrementUsage`, `/usage` handler |

Suggested target: `services/pitchMetrics.js` for the first four; `services/userBootstrap.js` for `ensureUserExists` + `getCurrentPeriod`.
