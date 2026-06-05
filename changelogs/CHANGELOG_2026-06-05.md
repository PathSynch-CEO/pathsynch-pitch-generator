# Changelog — June 5, 2026

> **Scope:** PathManager_frontend (PRs #176–184), PathManager_backend (PRs #232–234), PathManager EC2 nginx config.
> **SynchIntro:** No code changes. Architecture documentation updated.

---

## PathManager Frontend

### PR #176 — Sidebar section header labels
**Branch:** `fix/sidebar-product-labels-localsynch-routes`

Functional nav mode section headers renamed to match product names:
- `CAPTURE & ENGAGE` → `PATHCONNECT`
- `LOCAL INTELLIGENCE` → `LOCALSYNCH`
- `SALES INTELLIGENCE` → `SYNCHINTRO`
- `ADD-ONS` — unchanged

Product mode labels unaffected.

---

### PR #177 — LocalSynch auth headers + PromptResultsTable scatter guards
**Branch:** `fix/localsynch-frontend-auth-headers`

- `Competitors.tsx`: Added missing `Authorization: Bearer` headers to `loadPrefs()`, `persistPrefs()`, and `bindCompetitors()` axios calls. Root cause of 401 on all LocalSynch competitor prefs/data endpoints.
- `PromptResultsTable.tsx`: Initial scatter `?? []` guards (superseded by PR #178).

---

### PR #178 — PromptResultsTable useMemo normalization
**Branch:** `fix/prompt-results-table-null-normalize`

Replaced scattered `?? []` guards in `PromptResultsTable.tsx` with a single `useMemo` normalization:

```typescript
const safePrompts = useMemo(() =>
  (prompts ?? []).map(p => ({
    ...p,
    results: (p.results ?? []).map(r => ({
      ...r,
      competitorMentions: r.competitorMentions ?? [],
    })),
  })),
[prompts]);
```

All downstream render logic reads from `safePrompts` instead of raw `prompts`.

---

### PR #179 — AI Visibility service-layer response shape fix
**Branch:** `fix/ai-visibility-full-response-shape-audit`

**Root cause:** Backend wraps all AI Visibility array responses under named keys: `{ data: { history: [] } }`, `{ data: { results: [] } }`, etc. The service layer was passing the wrapper object to components. `?? []` guards in components were inert because truthy objects pass nullish coalescing.

**Fix:** `unwrapArray<T>(value, keys)` helper added to `aiVisibilityService.ts`. Service functions now unwrap before returning:
- `getHistory()` → `unwrapArray(body?.data, ["history"])`
- `getResults()` → `unwrapArray(body?.data, ["results"])`
- `getAiCompetitors()` → `unwrapArray(body?.data, ["competitors"])`
- `getPrompts()` → `unwrapArray(body?.data, ["prompts"])`

`ProviderComparison.tsx` and `CompetitorDisplacementChart.tsx`: loose null checks (`!= null`) to catch both `null` and `undefined`.

3 files changed, 108 insertions, 13 deletions.

---

### PRs #181–184 — Plan tier normalization utility (`planTierUtils.ts`)
**Branches:** `fix/entitlements-agency-tier-gating`, `fix/plan-tier-utils-annual-keys-fail-closed`, `fix/plan-tier-pmadmin-suffix-scope`

New `src/utils/planTierUtils.ts` — canonical tier normalization for all frontend gate checks.

**`normalizePlanTier(plan)`:**
- Input: `String(plan ?? '').trim().toLowerCase()`
- Strips `_yearly` suffix only from `pm*`-prefixed keys (`pmgrowth_yearly` → `growth`; `admin_yearly` stays `admin` → `free`)
- Full map: `pmfree→free`, `pmstarter→starter`, `pmgrowth→growth`, `pmpoweruser→scale`, `pmenterprise→agency`, `pmadmin→agency`, `admin→agency`, `enterprise→agency`, display tier names pass through

**`meetsMinTier(currentTier, requiredTier)`:**
- Fail-closed: unknown `requiredTier` values deny access (a typo like `"growht"` does not silently grant)
- `KNOWN_FREE_INPUTS` set (`free`, `pmfree`) distinguishes intentional free gates from unknown fallbacks

**Components updated** (removed broken inline `isGrowthOrAbove`/`isPlanGrowthOrAbove` functions):
- `AiVisibilityTab.tsx`
- `LocalSynchDashboard.tsx`
- `PCSScoreCard.tsx`
- `ReviewGrowthChart.tsx`
- `ReviewVelocityComparison.tsx`

**Effect:** Agency-plan merchants (`pmenterprise`/`pmadmin`) now pass all growth/scale tier gates. Annual subscribers (`pmgrowth_yearly`, etc.) no longer fall through to `free`.

---

## PathManager Backend

### PR #232 — `normalizePlan()` expansion + LocalSynch tier fix
**Branch:** `fix/entitlements-agency-tier-gating`

- `entitlements/index.js`: `normalizePlan()` now handles all `pm*` planKeys. `pmenterprise` no longer falls through to `free`.
- `localSynchTierResolver.js`: `PLAN_KEY_TO_TIER` gains `agency: 'scale'` (highest PM tier maps to highest LocalSynch tier).
- Tests: 183 passing.

---

### PR #233 — `_yearly` suffix stripping in `normalizePlan()`
**Branch:** `fix/plan-tier-utils-annual-keys-fail-closed`

Annual plan keys (`pmgrowth_yearly`, `pmpoweruser_yearly`, `pmenterprise_yearly`) now resolve correctly. Broad `replace(/_yearly$/, '')` applied — restricted to `pm*` prefix in PR #234.

---

### PR #234 — `pmadmin`, restricted `_yearly`, input trimming
**Branch:** `fix/plan-tier-pmadmin-suffix-scope`

- `normalizePlan()`: `pmadmin → 'agency'` case added.
- `_yearly` suffix stripped only when key starts with `pm` — `admin_yearly` / `agency_yearly` remain unknown and fail to `free`.
- Input: `String(raw).trim().toLowerCase()` before lookup.
- Tests: 186 passing.

---

## Infrastructure

### PathManager Nginx cache control rewrite (EC2)

**File:** `/etc/nginx/conf.d/pathmanager-web.conf` on EC2 `18.209.25.81`

| Location | Cache policy | Purpose |
|----------|-------------|---------|
| `= /index.html` | `no-store, no-cache, must-revalidate` | Always fetch latest HTML on navigation |
| `/assets/` | `public, max-age=31536000, immutable` + `try_files $uri =404` | Long-lived cache for hashed chunks; 404 on missing chunks instead of SPA fallback |
| `/` (SPA fallback) | `no-cache` + `try_files $uri /index.html` | No-cache for HTML, route to index.html |

**Problem solved:** Browsers were serving stale JS chunks after deploy. MIME type errors (`text/html` served as JS) when deleted chunk filenames were requested and nginx fell through to the SPA fallback.

Timestamped backup created before change: `/etc/nginx/conf.d/pathmanager-web.conf.bak-YYYYMMDD-HHMMSS`.

---

## Documentation

- `functions/CLAUDE.md`: June 5 session block added — cross-platform plan tier architecture, PM PRs, nginx config.
- `synchintro-app/CLAUDE.md`: June 5 session block added — nginx pattern, Vite chunk hash caveat, plan tier reference.
- `functions/SYSTEM_BIBLE.md`: Law 6 added — canonical plan tier normalization rules, full planKey→tier map, implementation locations.
- `SynchIntro_Master_Implementation_Prompt.md`: June 5 session entry appended.

---

## Outstanding Bugs Discovered (not yet fixed)

| Error | Endpoint | Priority |
|-------|----------|---------|
| Performance insights 400 | `POST /api/v1/performance/getInsights` | P2 |
| QRsynch presets 404 | `GET /api/v1/merchant/merchant/96E9FE/presets` (double "merchant") | P2 |
| QRsynch logo 500 | `GET /api/v1/merchants/logo/96E9FE` | P2 |
| Analytics GBP tab | `/analytics?tab=gbp` — entitlement misconfiguration | P2 |
| LocalIntel alerts 400 | `POST .../alerts/generate` — missing `locationId` | P3 |
| LocalIntel foot-traffic forecast 400 | Missing `venueName` + `venueAddress` | P3 |
| LocalIntel demographics 400 | Missing `zipCode` | P3 |
| Analytics General "Undefined" label | Time-on-site chart category | P3 |
| Customers mock data | Emma Wilson / James Chen / Sofia Garcia placeholder rows | P3 |

---

## Carry-Forward Rules Established

1. **Service-layer unwrapping beats component scatter guards.** Fix API response shape at the service boundary, not in every consumer.
2. **`_yearly` suffix stripped only from `pm*` keys.** `admin_yearly` is not a valid planKey.
3. **Unknown `requiredTier` in gate checks must deny, not grant.** Typos in caller code should not silently unlock features.
4. **Vite chunk hashes can be stable across logic-only changes.** `immutable` cache headers on `/assets/` can serve stale code if no import graph changes occurred. Verify chunk hashes when deploying logic changes to existing modules.
5. **Prompt phasing:** Investigation → structured table → fix → tests → build verify → push → Codex follow-up loop.
