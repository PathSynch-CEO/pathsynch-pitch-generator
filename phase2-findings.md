# SynchIntro Audit — Phase 2 Findings (Reliability & Error Handling)

**Repos**: pathsynch-pitch-generator (backend), synchintro-app (frontend)
**Date**: 2026-07-14
**Auditor**: Claude Code
**Mode**: READ-ONLY, **static / offline** (locked policy — no service-account key, no credentialed calls, no production/Rules-API reads). This file is a report artifact — no audited code, config, or state was modified.

---

## Verdict

Reliability foundations are **solid**: global error handlers, atomic fail-closed billing, `Promise.allSettled`/`Promise.race`+timeout enrichment, and verified graceful degradation on every external API. **One real reliability gap** — the Prospect/SynchGov zombie-batch cap has no automated self-heal (checklist #7) — plus one unbounded batch-write edge case.

**Phase 2 finding tally:** P0: 0 · **P1: 1** · **P2: 1** · P3: 0

| ID | Sev | Title |
|----|-----|-------|
| F-201 | P1 | No automated reconciler for stuck prospect batches → "Maximum 5 active" (429) hard-block needs manual script |
| F-202 | P2 | `markAllRead` unbounded batch write can exceed Firestore 500-op limit |

---

## Checklist #7 — Zombie-batch / "Maximum 5 active batches" (429) → **STILL-OPEN (partially mitigated)**

**Is there protection against orphaned batch docs re-triggering the 5-active cap? Partial. Is cleanup manual or automated? Manual.**

- **Cap enforcement**: `functions/routes/prospectIntelRoutes.js:66-84` (`F-033`). `MAX_ACTIVE = parseInt(process.env.MAX_ACTIVE_BATCHES_PER_USER) || 5`. Counts `prospectIntel` docs for the user with `status in ['queued','processing']`; returns **HTTP 429** when `activeSnap.size >= MAX_ACTIVE`.
- **The zombie mechanism is live**: if an enrichment task dies without writing a terminal status, its batch stays `processing` **forever** and permanently consumes one of the 5 slots. Five stuck batches → the user is hard-blocked from creating any new batch.
- **No automated reconciler.** The only scheduled functions are `weeklyDigest`, `dailyDigest`, `activityCleanup`, `merchantBehaviorSync`, `processThresholdAlerts`, `aiVisibilityMonitorCron` (`functions/index.js` + `functions/scheduled/`). **None** sweep stale `prospectIntel` batches; there is no max-processing-age TTL/watchdog that flips a stuck `processing` → `failed`.
- **Cleanup is manual**: `functions/scripts/clear-stuck-batches.js` (untracked) with **hardcoded whitelisted batch IDs** — a human runs it to free slots. Companion `functions/scripts/backup-stuck-batches.js` also untracked.
- **Mitigating design**: the cap check is **non-blocking** — `prospectIntelRoutes.js:81-84` catches a failed count query and *allows* batch creation (`console.warn('...allowing')`), so a transient Firestore error cannot false-block a user.

### [F-201 / P1] No automated stuck-batch reconciler
- **Severity**: P1
- **Category**: Reliability
- **Location**: `functions/routes/prospectIntelRoutes.js:66-84`; absence in `functions/scheduled/*`
- **Description**: The 5-active-batch cap counts `queued`/`processing` docs but nothing transitions an orphaned `processing` batch to a terminal state automatically.
- **Impact**: Accumulated zombie batches silently exhaust a user's 5 slots → persistent 429 on new batch creation until a human runs the manual whitelist script.
- **Remediation**: Add a scheduled reconciler (e.g. every 1–6h) that marks batches `failed` after a max processing age, so slots self-heal. Optionally decrement/repair progress counters. Consider committing the two `*-stuck-batches.js` scripts (currently untracked) as an interim runbook.
- **Effort**: Medium

---

## Unhandled promise rejections (enrichment / sentiment / agent pipelines)

- ✅ **Global safety net**: `functions/index.js:19-22` — `process.on('unhandledRejection', …)` and `process.on('uncaughtException', …)`.
- ✅ **No bare `.then()` without `.catch()`** in the enrichment/sentiment/agent pipelines scanned (`pitchEnricher.js`, `sentimentExtractor.js`, `seoIntelligenceService.js`, `prospectIntelService.js`, `agents/prospectResearchAgent.js`).
- ✅ The only `.then()` chains — `functions/services/visibilityEnrichmentService.js:42-63` — are each wrapped in `Promise.race([enrich…, <timeout>]).catch(…)` with per-phase timeouts (Map Pack 30s, Ad Spend 30s, Website 35s, AI Visibility 25s) and graceful fallback assignment. A failed or slow phase degrades that phase only; the report still writes.
- ✅ Deep-enrichment fan-out uses `Promise.allSettled` with per-source 8s timeouts (never blocks pitch/report generation).
- ✅ `processProspectTask` (Cloud Tasks handler) **always returns HTTP 200** even on error, preventing Cloud Tasks retry storms.

---

## Firestore batch / transaction safety

- ✅ Credit deduction is **atomic and fails-closed**: `checkAndDeductCredits()` runs in a Firestore transaction and returns `{ allowed:false, error:'BILLING_TRANSACTION_FAILED' }` (routes → 503) on failure. No double-spend window.
- ✅ Cleanup/delete loops are **bounded**: `narrativeCache.js` `.limit(100)`, `emailDigest.js`/activityCleanup `.limit(100)` per user, `marketCache.js` `.limit(50)`, `versionHistory.js` `.limit(excessCount)`; IRS BMF seed chunks at 490 (< 500).
- 🟡 **[F-202 / P2] `functions/services/activityService.js:166` `markAllRead` has no `.limit()`** — it queries all `isRead == false` notifications and `batch.update()`s each in a single batch. A user with **>500 unread notifications** exceeds the Firestore 500-op batch limit → `batch.commit()` throws → mark-all-read fails.
  - **Impact**: broken mark-all-read action for heavy-notification users; **no data loss**.
  - **Remediation**: chunk at ≤450 ops per batch (or paginate + loop-commit).
  - **Effort**: Quick

---

## External-API failure handling (verified per provider)

All provider clients return **structured error objects** rather than throwing to callers, and carry timeouts. Verified statically:

| Provider | File | try/catch | throws-to-caller | Graceful pattern |
|----------|------|-----------|------------------|------------------|
| **Gemini** | `agentRunner.js`, `market.js`, `structuredGeneration.js` | ✓ | Market Intel: **no** (template fallback). SynchGov briefs: **yes, by design** (visible hard fail). | Market degrades silently; `runCitationQuery` never throws (`{mentioned:false}` fallback) |
| **SAM.gov** | `services/govcapture/samGovClient.js` | 2 | **0** | Missing-key → `{success:false,data:null,error}`; checks `response.ok`; treats 404 / "No Data found" as empty |
| **USAspending** | `services/govcapture/usaspendingClient.js` | 4 | **0** | Every path returns `{success:false,data:null,error}` |
| **Outscraper** | `services/outscraperClient.js` | 2 | **0** | 429 retry on first attempt; `response.ok` guard; `{success:false,…}` |
| **Instantly** | `services/instantlyClient.js` | 2 | few internal | Structured `{success:false,skipped:true,reason}` returns; internal throws wrapped by fire-and-forget callers (documented "never throws 500") |

- ⚠️ **By-design exception (not a finding)**: SynchGov brief generation throws hard on Gemini failure — intentional so a gov brief with missing AI content fails loudly. Gov scoring is rule-based (5 of 6 dimensions) and does not depend on Gemini, so a Gemini outage degrades only the 30-pt solution-match refinement.

---

## Function timeout / memory config (long-running agents)

| Function | Memory | Timeout | Notes |
|----------|--------|---------|-------|
| `exports.api` | 1 GiB | 300 s | Headroom for Puppeteer PDF generation |
| `bootstrapWorkspaces` (onCall) | 512 MiB | 120 s | |
| scheduled jobs (`weeklyDigest`, `dailyDigest`, `activityCleanup`, `merchantBehaviorSync`) | 256 MiB | default | |
| Global | — | — | `maxInstances: 10` caps runaway scale/cost |

Enrichment phases self-bound via `Promise.race` timeouts (25–35s) rather than relying solely on the function timeout. Adequate for the workloads.

---

## Positive controls confirmed
- Global `unhandledRejection` / `uncaughtException` handlers present.
- Atomic, fail-closed credit deduction (503 on transaction failure).
- Cloud Tasks handler returns 200 to avoid retry storms.
- `Promise.allSettled` + per-source timeouts across deep enrichment.
- Every external API client degrades gracefully with structured errors + timeouts.
- Cleanup/delete batch loops bounded by `.limit()`.

## Open items carried to the action plan
- **[F-201 / P1]** Automated stuck-batch reconciler (checklist #7 self-heal).
- **[F-202 / P2]** Bound `markAllRead` batch writes to ≤450 ops.

*End of Phase 2 findings.*
