# SynchIntro Audit — Phase 5 Findings (API & Function Surface)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, static / offline (locked policy). Report artifact — no audited code/config/state modified.

---

## Verdict

API surface is **healthy and consistent**. Every frontend-called endpoint prefix resolves to a backend handler; no dead Cloud Functions. **The headline result**: the 7 default-denied Firestore collections from F-101 cause **zero live breakage** — none are read via the client Firestore SDK.

**Phase 5 finding tally:** P0: 0 · P1: 0 · P2: 0 · **P3: 1**

---

## Critical cross-reference — 7 default-denied collections vs client read sites → **NO PRODUCTION IMPACT**

From F-101, the live (backend) ruleset omits 7 collections that exist only in the stale frontend ruleset, so they are **default-deny in production**: `viewEvents, precallBriefs, landingPages, notifications, account360, agentViews, irsBmfCache`. If the frontend read any of them via the **client Firestore SDK**, those reads would be denied right now. Verified read sites in `synchintro-app/js/` (excluding `vendor/`):

| Collection | Frontend refs | Client Firestore read? | Verdict |
|------------|---------------|------------------------|---------|
| `account360` | 35 | **No** — all `API.request('/account360/*')` calls | ✅ server-side, deny harmless |
| `notifications` | 22 | **No** — all DOM/UI (activity bell, plan-gate copy) or API | ✅ deny harmless |
| `precallBriefs` | 5 | **No** — a local JS array (`this.precallBriefs`) filled from an API result (`precallFormsResult.data`) | ✅ deny harmless |
| `viewEvents` | 0 | — | ✅ unused in frontend |
| `landingPages` | 0 | — | ✅ unused in frontend |
| `agentViews` | 0 | — | ✅ unused in frontend |
| `irsBmfCache` | 0 | — | ✅ unused in frontend |

- **Method**: searched for client-SDK read patterns — `collection('X')`, `.doc()`, `getDocs`, `getDoc`, `onSnapshot`, `.where()` — around each collection name. The frontend *does* use client Firestore reads elsewhere (62 sites, e.g. `js/admin/adminApi.js` reading `users`/`pitches`/`platformConfig`/`admins` — all present in the live ruleset), but **none** target the 7 denied collections.
- **Conclusion**: F-101's default-deny is a **latent deploy hazard only** (it would bite if the frontend ruleset were ever deployed), confirmed to cause **no current outage**. This further supports keeping F-101 at P1 (fix the deploy foot-gun) without escalating for a live incident.

---

## Cloud Function inventory (15 exports — all live, none dead)

| Function | Trigger | Invoked by |
|----------|---------|-----------|
| `api` | HTTP (onRequest) | Frontend + integrations (the Express app; all `/*` routes) |
| `weeklyDigest`, `dailyDigest`, `activityCleanup` | onSchedule | Cloud Scheduler |
| `merchantBehaviorSync` | onSchedule (Mon 09:00 UTC) | Cloud Scheduler |
| `processThresholdAlerts` | onSchedule (every 6h) | Cloud Scheduler |
| `aiVisibilityMonitorCron` | onSchedule (3 AM ET) | Cloud Scheduler |
| `onUserCreated` | Auth trigger | Firebase Auth |
| `onProspectBatchCreated` | Firestore trigger | `prospectIntel/{batchId}` onCreate |
| `processProspectTask` | HTTP | Cloud Tasks (`prospect-enrichment` queue) |
| `aiReadinessScan` | HTTP (public) | AIsynch free-scan (Turnstile-gated) |
| `aisynchDashboard` | HTTP (JWT) | PathManager EC2 proxy |
| `backfillConfidenceFields` | HTTP (`x-admin-key`) | Manual admin (one-time backfill) |
| `calibrateMerchant` | HTTP (`x-admin-key`) | Manual admin (on-demand) |
| `bootstrapWorkspaces` | onCall | Manual admin / bootstrap script |

**No dead functions** — every export is a scheduled job, event trigger, queue handler, or on-demand/authenticated endpoint.

### [F-501 / P3] Vestigial admin endpoints
- `backfillConfidenceFields` (`index.js:3683`) is a **one-time backfill** that has already run (per session history); `calibrateMerchant` (`index.js:3703`) is a rarely-used manual calibration. Both are `x-admin-key`-gated (safe) but are retirement/consolidation candidates once confirmed no longer needed.
- **Remediation**: confirm the backfill is complete platform-wide, then remove `backfillConfidenceFields`; document `calibrateMerchant` as an operational tool or fold into an admin route. **Effort: Quick.**

---

## Endpoint mismatch scan

- **Frontend → backend prefix coverage**: all 35 distinct frontend `request()` / `fetch()` path prefixes (`/admin`, `/govcapture`, `/investor`, `/instantly`, `/market`, `/analytics`, `/team`, `/precall-forms`, `/precall-briefs`, `/onboarding`, `/library`, `/pitch`, `/prospect-intel`, `/landing-pages`, `/opportunity-brief`, `/merchant-config`, `/export`, `/alerts`, `/account360`, `/stripe`, `/onepager`, `/brand`, `/audit`, `/reviews`, `/preferences`, `/utils`, `/events`, `/pitches`, `/seller-profiles`, `/transcript`, `/visitors`, `/visitor-accounts`, `/sales-library`, `/generate-share-email`, `/attio`) **resolve to a backend handler** (modular route module and/or inline handler in `index.js`). **No phantom endpoints at prefix granularity.**
- **`campaign-draft` gap (brief's example)**: **not applicable here** — the frontend's `campaigns/drafts` references are plain external `<a href="https://pathsynch.com/campaigns/drafts">` links to PathManager's NemoClaw UI, not calls to this backend. The Instantly campaign endpoints the frontend does call (`/instantly/campaigns`, `/instantly-market/campaigns`) both exist (`instantlyRoutes`).
- **Scope note (honest limitation)**: this scan verified coverage at **path-prefix** granularity, not an exhaustive per-method (`GET`/`POST` + full path) diff across all ~4,100 lines of inline `index.js` handlers plus 25 route modules. A full method-level diff was not performed; the app is in active production, where phantom endpoints surface as user-facing 404s (and the team has caught/fixed those before, e.g. the June `/team/revoke-invite` 404). No prefix-level gaps found.

---

## Observations (not findings)
- The frontend **admin panel** (`js/admin/adminApi.js`) uses **client-side Firestore reads** (`users`, `pitches`, `codeRedemptions`, `discountCodes`, `platformConfig`, `admins`) — all governed by `isAdmin()`/owner rules in the **live** ruleset, so functioning correctly.
- Two Instantly integrations coexist by design (`/instantly/*` per-user vs `/instantly-market/*` global) — not a duplication bug.

---

## Positive controls confirmed
- All 35 frontend endpoint prefixes map to backend handlers.
- All 15 Cloud Function exports have valid triggers; none dead.
- The 7 default-denied collections are never client-read → zero production impact from F-101.
- No frontend calls to a nonexistent `campaign-draft`/campaign backend endpoint.

## Open items carried to the action plan
- **[F-501 / P3]** Retire/settle vestigial admin endpoints (`backfillConfidenceFields`, `calibrateMerchant`).
- (Reinforces **F-101 / P1**) — the 7-collection default-deny is latent-only; fixing the frontend-repo rules deploy foot-gun remains the action.

*End of Phase 5 findings.*
