# Gate 1 Strategy Review - Workspace-Aware Plan Gates (Follow-up to Member Identity Fix)

**Date**: 2026-07-16
**Status**: DRAFT for approval. No code written. STOP for sign-off before build.
**Predecessor**: member identity fix (backend PR #57 / frontend PR #34, merged + deployed 2026-07-16). This is the "second shoe" found in the post-deploy critical review.
**Merge gate**: assumed Charles (same amended gate as the predecessor) - confirm.
**Timing**: should land BEFORE daniyal@ is re-invited, so frontend and backend agree on his plan from day one.

---

## 1. Problem

The member identity fix repaired plan/profile resolution on the CLIENT. But every backend-enforced plan gate still resolves the caller's own free-tier doc: all ~19 `getUserPlan()` call sites outside the new `memberContextService` call it WITHOUT `workspaceId`:

- `api/market.js:771, 3783` - market report generation gate (incl. enterprise mode 403)
- `api/export.js:33, 314, 350, 416` - exports incl. PPTX
- `api/bulk.js:84` - bulk upload
- `api/formatterApi.js:41, 168, 465` - formatter access
- `api/narratives.js:42, 323, 501` - narrative limits
- `api/events/eventLogger.js:46` - plan tier stamping on events
- `middleware/planGate.js:114, 147, 212, 268, 302` - `requireFeature`, `checkUsageLimit`, `requirePlan`, `requireFormatter`, `checkNarrativeLimit`

Result: a workspace member sees enterprise in the UI but gets starter treatment on any server-enforced route - 403 on enterprise market mode and PPTX export, starter formatter/narrative access, starter usage caps. Phase 2 (June 22-23) built the capability (`getUserPlan(uid, {workspaceId})`, emulator-tested 26/26) but call sites never adopted it.

Not in scope here (separate, already-scoped work): server-side Seller Profile reads during pitch generation still use the caller's own doc - that is the Seller Profile workspace-rescoping PRD (diagnosis section 9).

## 2. Options

### Option A - make `getUserPlan()` itself resolve membership when no workspaceId is passed
Single choke point; zero call-site changes.
- **Cons that kill it**: adds a `getWorkspaceForUser` lookup (2 queries) inside EVERY gated call even though `workspaceResolver` already resolved membership once per request - duplicate reads, added latency on every gate. Also a lazy-require dance to avoid the existing `workspaceService` <-> `planGate` circular dependency. Implicit global behavior change is harder to reason about and test.

### Option B (RECOMMENDED) - pass the already-resolved `req.workspaceId` at the call sites
`workspaceResolver` runs on every request (`index.js:234`) and sets `req.workspaceId` / `req.workspaceMembership` from `workspaceMembers`. The information is already on the request; the gates just ignore it.
- Add one tiny helper in `planGate.js`: `getUserPlanForRequest(req)` = `getUserPlan(req.userId, { workspaceId: req.workspaceId || null })`.
- Sweep the ~19 sites to use the helper (the five `planGate.js` middleware sites already have `req` in scope; the api/* sites all sit in handlers with `req`).
- Zero extra Firestore reads. Solo users: `req.workspaceId` is null -> behavior byte-identical to today. Owners: workspace `entitlementOwnerUid` is themselves -> same plan as own doc. Members: gates open per owner plan - the intended change and the only behavior delta.
- The helper prevents future drift (new endpoints use it instead of hand-rolling).

### Bundled cleanups (small, same branch)
1. Remove the dead `ctx.autoAccepted` cache-clear no-op in frontend `js/api.js` `getCurrentUser()` (immediately overwritten two lines later; harmless but clutter).
2. Correct the overstated index claim in the repo record: one line in `functions/CLAUDE.md` July 16 session note (the `_resolveRole` query was equality-only and likely needed no composite index; the doc-ID swap stands on its own merits).

## 3. Decision needed in Gate 1: usage semantics for members

`checkUsageLimit` compares `getUserUsage(userId)` (per-member usage doc) against plan limits. With Option B the LIMITS become owner-tier while USAGE stays per-member. For an enterprise workspace (unlimited) this is moot. For a hypothetical growth/scale workspace, each member independently gets the owner-tier allowance (per-seat, generous) rather than a pooled workspace allowance.

**Recommendation: accept per-member usage against owner-tier limits for now.** Pooled workspace usage is a real product decision with schema impact (workspace-scoped usage docs) - defer, document the choice in SYSTEM_BIBLE.

## 4. Blast radius

- Touches the gating path of every plan-gated endpoint - but the delta is provably scoped: null workspaceId (solo) and owner-self cases are behavior-identical; only active members change. Tests must pin all three cases.
- `workspaceResolver` failure mode: if it ever fails/skips, `req.workspaceId` is undefined -> helper passes null -> caller's own plan (today's behavior). Fail-soft by construction.
- No Firestore rules changes. No schema changes. No new endpoints.
- Frontend change is one deleted no-op statement.

## 5. What could go wrong

1. A missed call site (member gets inconsistent gating on one route). Mitigation: the grep list above IS the inventory; final sweep grep in Gate 2 proving zero remaining bare `getUserPlan(userId)` request-path calls (allowed exceptions: `memberContextService` - already workspace-aware; `workspaceService.createWorkspace(ownerUid)` - owner-scoped by design).
2. A call site without `req` in scope (service-layer caller). Handle case-by-case; none visible in the inventory.
3. Latency regressions: none expected (no added reads).
4. Tests overfit to enterprise: include a growth-tier workspace case so hierarchy mapping is exercised.

## 6. Test plan

- Unit (mock): member hits `requireFeature('pptExport')` / market plan gate / formatter access / narrative limit -> owner plan honored; solo user unchanged; owner unchanged; resolver-failure (no workspaceId) falls back to own plan.
- Reuse the Phase 2 emulator seed pattern for one end-to-end member-gate proof if cheap; otherwise mock coverage is adequate (the workspace resolution itself is already emulator-proven).
- Full suite green at current baseline (1796).

## 7. Rollout

1. Branch `fix/workspace-aware-plan-gates` in the existing worktrees - **after resetting both worktrees to fresh `origin/main`** (lesson from the frontend drift incident: verify parity before building and again before any deploy).
2. Build helper + sweep + cleanups; tests; Gate 2 self-review with the same adversarial standard.
3. STOP at PR for Charles; merge; deploy `--only functions:api` with the same `.env` copy-in procedure (76 vars, verify "Loaded environment variables from .env" in output); frontend hosting deploy for the one-line cleanup.
4. THEN re-invite daniyal@ (and optionally a fresh invite for tdh356b@ if that test account should resolve via the new path - it exists only in `teams.memberUids`, not `workspaceMembers`).

## 8. Open questions for approval

1. Confirm Option B (call-site sweep with helper) over Option A (choke-point).
2. Confirm per-member usage semantics (section 3).
3. Confirm merge gate remains Charles-only for this follow-up.
4. tdh356b@ test account: leave unresolvable (fine for a test account), or fresh-invite it post-deploy as a live smoke test of the auto-accept path? (Cheap and useful: it would be a real end-to-end verification before daniyal.)

*Gate 1 draft. No code, no data writes, no deploy. STOP for approval.*
