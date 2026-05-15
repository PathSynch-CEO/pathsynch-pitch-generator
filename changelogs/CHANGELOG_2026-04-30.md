# Changelog — April 30, 2026

**Deployed:** functions + hosting

---

## L2 One-Pager Stat Fixes

### Response Rate "%" Suffix
- **Root cause:** `seedPitchTemplates.js` had been updated with `numberFormat: "{{value}}%"` but the seed script had never been re-run, so Firestore still held the old `"{{value}}"` value.
- `scripts/seedPitchTemplates.js`: `stat4.numberFormat` → `"{{value}}%"`, `cardCount` → 5, `stat5` added
- `services/executiveBriefRenderer.js` `renderStatStrip()`: expanded from 4 hardcoded cards to 5; stat4 now reads `responseRate` via `resolveStatValue()` instead of nonexistent `ownerResponseCount` field
- `api/pitch/templateOnePager.js` `renderStatCards()`: CSS grid changed from hardcoded `repeat(4, 1fr)` → `repeat(${count}, 1fr)` where `count = statFields.length`

### Review Velocity (stat5)
- `api/pitchGenerator.js`: `inputs.reviewVelocity = reviewAnalyticsResult.reviewsPerMonth`
- `api/pitch/templateOnePager.js` `buildPitchData()`: forwards `reviewVelocity` to `enrichedData.analysis`
- `services/templateSectionResolver.js`: `STAT_FALLBACK_PATHS['analysis.reviewVelocity']` + `dataContext.reviewVelocity` alias added
- Estrellita confirmed value: 23.3/mo

## Response Rate Parsing from Pasted Review Text

- `api/pitchGenerator.js`: scans pasted review text for `"(Owner)"` and `"Response from"` patterns to count owner replies when DataForSEO returns 0
- `api/pitch/templateOnePager.js`: override block recomputes `responseRate = Math.round((parsedRespondedCount / reviewCount) * 100)` when DataForSEO returned 0 but parsed count > 0

## Mariadeth Workspace Inheritance — Complete Fix Chain

All 10 locations where stale plan/tier reads were bypassing workspace inheritance:

| # | File | Fix |
|---|------|-----|
| 1 | `firestore.rules` | `users/{userId}` read — workspace members can read owner doc via `memberUids` |
| 2 | `firestore.rules` | `teams` collection — split `get` (OR) and `list` (memberUids) rules |
| 3 | `firestore.rules` | Firebase Storage: `isWorkspaceMember()` helper for avatars/logos/uploads |
| 4 | `firestore.indexes.json` | Composite index: `marketReports (workspaceId ASC, createdAt DESC)` |
| 5 | `synchintro-app/js/api.js` | Removed duplicate `getSubscription()` (lines 2543–2575) bypassing inheritance |
| 6 | `synchintro-app/js/api.js` | Tier extraction order: `subscription.plan > subscription.tier > plan > tier` |
| 7 | `functions/api/market.js` | `getReport`: workspace member read access via `getUserWorkspaceInfo()` |
| 8 | `functions/index.js` | `/pitch/styles` inline handler — replaced raw Firestore read with `getUserPlan()` |
| 9 | `functions/index.js` | `checkAndUpdateUsage()` — uses `getUserPlan()` with workspace inheritance |
| 10 | `functions/middleware/planGate.js` | `getUserPlan()` — checks workspace membership first, not own plan first |
| 11 | `functions/api/validators.js` | `checkPitchLimit()` — same stale-tier fix |

**Architecture rule locked:** `getUserPlan()` is the single source of truth. Never read `user.plan`/`user.tier` directly in route handlers.

## Market Intel Timeout Fix

| Layer | Before | After |
|-------|--------|-------|
| `exports.api` `timeoutSeconds` (`functions/index.js`) | 300s | 540s |
| `generateMarketReport()` AbortController (`synchintro-app/js/api.js`) | 180s (hardcoded) | 540s |
| All other `request()` calls | 180s | 180s (unchanged default) |

Root cause: client-side AbortController was the real ceiling. Server never reached its limit — the browser killed the request at 3 minutes and showed "Request timed out after 3 minutes."

Fix: `request()` now accepts `options.timeoutMs`; `generateMarketReport()` passes `540000`.

## Debug Logs (To Remove)

`templateOnePager.js` and `templateSectionResolver.js` have temporary `[renderStatCards DEBUG]` and `[resolveStatValue DEBUG]` console.log statements. Remove once stat cards confirmed working in production.

---

## Files Modified

**functions/**
- `index.js` — timeout 300→540, `/pitch/styles` + `checkAndUpdateUsage()` use `getUserPlan()`
- `api/market.js` — `getReport` workspace member access
- `api/pitchGenerator.js` — `reviewVelocity` + response rate parsing
- `api/pitch/templateOnePager.js` — dynamic grid, `buildPitchData()` velocity, response rate override, debug logs
- `middleware/planGate.js` — `getUserPlan()` workspace-first logic
- `api/validators.js` — `checkPitchLimit()` stale-tier fix
- `services/templateSectionResolver.js` — fallback paths + dataContext alias, debug logs
- `services/executiveBriefRenderer.js` — 5-card stat strip
- `scripts/seedPitchTemplates.js` — stat4 format, stat5, cardCount=5

**firestore.rules** — workspace member reads (users, teams, storage)

**firestore.indexes.json** — marketReports workspaceId composite index

**synchintro-app/**
- `js/api.js` — `timeoutMs` option on `request()`, `generateMarketReport()` 540s, duplicate `getSubscription()` removed, tier extraction order fixed
