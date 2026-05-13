# Changelog — May 13, 2026

## Platform Health Audit + Fixes

**Audit score: 79/100 (B+)** — First formal 10-phase health check of both repos.
Full report: `SYNCHINTRO_AUDIT_REPORT_2026-05-13.md`

---

### Backend (pathsynch-pitch-generator)

#### Fixed

- **`functions/middleware/planGate.js`** — Stale `userData.tier` bug. Scale/Growth users were plan-gated as free because `tier:'FREE'` (set at account creation, never updated by Stripe) was short-circuiting before `subscription.plan`. Fixed priority chain: `subscription.plan → subscription.tier → plan → tier`.

- **`functions/index.js`** — Added global `unhandledRejection` + `uncaughtException` process handlers to surface silent crashes in Cloud Functions logs.

- **`functions/index.js`** — Added `X-Admin-Key` authentication to `backfillConfidenceFields` and `calibrateMerchant` HTTP exports. Both were unauthenticated open endpoints. Key sourced from `ADMIN_BOOTSTRAP_KEY || PROSPECT_TASK_SECRET`.

- **`functions/routes/teamRoutes.js`** — Wired `sendTeamInviteEmail()` on `POST /team/invite`. This was an empty TODO block since April 28, 2026. Email failure is non-blocking.

- **`README.md`** — Redacted hardcoded `STRIPE_SECRET_KEY=sk_live_xxx` example value.

#### Removed

- **`functions/services/agentLogger.js`** — Deleted. Zero imports across all files. Dead code from an earlier sprint.

- **`.github/workflows/deploy.yml`** — Deleted. Was a standalone deploy workflow with no `needs:` dependency — ran in parallel with CI regardless of test results, defeating the gate.

#### Infrastructure

- **`.github/workflows/ci.yml`** — Added `deploy` job with `needs: [test]` and `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`. Deploy now only runs after all tests pass on main.

- **Orphaned `onEnrichmentJobCreated` Cloud Function** — Deleted via `firebase functions:delete`. Was blocking function deploys.

---

### Frontend (synchintro-app)

#### Fixed

- **`firestore.rules`** — Added `userActivityLog` collection rules. This was a P0 silent failure: Team Activity Dashboard reads and writes were being denied by the default catch-all rule.

- **`firestore.rules`** — Added rules for 5 collections that had no explicit rules and were falling through to the default deny: `opportunityBriefs`, `prospectIntel` (+ `prospects` subcollection), `visitorIntelSummary`, `notifications/alerts`, `account360` (+ `agentViews` subcollection). All write as `if false` (Admin SDK only); read scoped to authenticated owner.

- **`firestore.indexes.json`** — Added `userActivityLog` composite index (`userId ASC + createdAt DESC`). Required for Team Activity dashboard query.

- **`js/auth.js`** — Fixed Sentry guard: `if (window.Sentry)` → `if (window.Sentry && typeof Sentry.setUser === 'function')`. Eliminates `Sentry.setUser is not a function` console error on slow connections where Sentry async-loads after `auth.js` executes.

---

### Known Backlog (not addressed this session)

| Item | Risk |
|------|------|
| `SENDGRID_API_KEY` not set | Team invite emails silently fail |
| `functions/index.js` monolith | Maintenance burden, not a runtime issue |
| Credit deduction atomicity | <1s double-spend window on high concurrency |
| Stripe SDK v14 (latest: v22) | Breaking change risk deferred |
| `innerHTML` in pitchGenerator.js | XSS surface if untrusted input reaches renderer |
