# CHANGELOG — 2026-07-22

## SI-2026-07-22-001 — Visitor Intel workspace-aware entitlement + role normalization (P0)

**Branch:** `fix/visitor-intel-workspace-plan-role-normalize` (backend). Full suite **1921 passing** (24 new). NOT merged.

### Bug A ① (P0) — Visitor Intel 403 for workspace members — FIXED at the resolution layer

`routes/visitorRoutes.js` gated `/visitors` + `/visitors/snippet` with a private, **workspace-blind** `getUserTierAndCheckLimit(userId)` that read the **caller's own** `users/{userId}` doc. An invited member's own doc carries stale `tier:'FREE'` (set at signup) → `VISITOR_LIMITS.free === 0` → `hasAccess:false` → 403 "Website Visitor Intel is not available on your current plan." This route was the gate **missed by the July-16 `getUserPlanForRequest` workspace-aware sweep (PR #58)** — every other gated route (`market/export/bulk/formatter/narratives` + the 5 planGate middlewares) was converted then; this one was not.

**Fix:** `getUserTierAndCheckLimit(userId, req)` now resolves tier through the canonical, workspace-aware `getUserPlan(userId, { workspaceId })` (single source of truth, correct `subscription.plan → subscription.tier → plan → tier` chain). Authenticated routes reuse `req.workspaceId` (set by `workspaceResolver`); the public track path resolves the snippet owner's workspace via `getWorkspaceForUser`. A member now inherits the workspace OWNER's plan — closing the blast radius for **all** non-owner members of **all** multi-seat workspaces, not just the two reported internal accounts.

- Exported `getUserTierAndCheckLimit` for unit testing.
- New `tests/visitorEntitlement.test.js` — role × plan-tier matrix (contributor/admin member × enterprise/growth; solo starter/free), regression guard, public-track path.

### Bug A ② — Market Intel "restricted to the account owner" — INTENTIONAL, KEPT BY PRODUCT DECISION

The owner-only gate on Market Intel *report generation* is deliberate design — the string lives only in the frontend (`synchintro-app/js/pages/market.js:188`, `renderPage()` locked notice for contributors); the backend generate path has no owner/role check. **This was NOT changed and must not be "fixed" as an oversight.** Decision by Charles, 2026-07-22, is final for this ticket. Frontend only clarified the copy (separate repo).

### Role vocabulary normalization (latent fail-closed landmine) — HARDENED

`middleware/workspaceRoleGuard.js` ranks `{contributor,manager,admin}`, but `routes/teamRoutes.js` validated against `['admin','contributor','viewer']` (dead `viewer`, missing `manager`) and `middleware/workspaceResolver.js` stored `membership.role` unnormalized — so any legacy/miscased role failed closed and denied an active member every gated action.

- New `normalizeRole()` in `workspaceRoleGuard.js` (canonical or → least-privilege `contributor`), exported.
- `workspaceResolver.js:157` canonicalizes `req.workspaceRole` at the single source point; `requireRole` normalizes defensively.
- `teamRoutes.js`: `VALID_ROLES` reconciled to `['admin','manager','contributor']`; incoming `role`/`newRole` normalized before persist; dead `'viewer'` default → `'contributor'`.
- New `tests/roleNormalization.test.js`.

Not the active cause for the two reported users (their stored role is exactly `"contributor"`, verified in `ws_bootstrap_charles`) — a defused time-bomb.

### Verified (read-only, Admin SDK)
`users/dehiyRBCXcUUM72O211S27lfXbl1` (Charles): `plan`/`tier`/`subscription.plan`/`subscription.tier` all `"enterprise"` — no plan discrepancy; UI Enterprise badge is correct.
