# Gate 2 Review — F-201: Stuck-Batch Reconciler

**Work Item 1 of the SynchIntro P1 remediation.** Built, tested, and stopped here — the PR is NOT opened and NOTHING is merged. Product code merges via **Williams**.

Branch: `fix/f201-stuck-batch-reconciler` (off `main`). Gate 1 strategy: `strategy-review-f201.md`.

---

## What changed

A scheduled Cloud Function that ages genuinely-stale Prospect Intel batches (`queued`/`processing`) to the terminal `failed` state, so the per-user active-batch cap (`MAX_ACTIVE_BATCHES_PER_USER`, default 5) self-heals — retiring the manual whitelist script `scripts/clear-stuck-batches.js` as the only remedy for the "Maximum 5 active batches" 429 hard-block.

| File | Change |
|---|---|
| `functions/scheduled/prospectBatchReconciler.js` | **New.** Testable core `reconcileStuckBatches({ now?, staleHours? })` + `_toMillis` / `_stalenessAnchorMs` helpers. Queries `prospectIntel where status in ['queued','processing']`; for each, staleness anchor = most-recent of `updatedAt` → `processingStartedAt` → `createdAt`; if idle past the threshold, `update()`s to `status:'failed'`, `failureReason:'auto_reconciled_stale'`, `reconciledAt`, `clearedBy:'auto_reconciler'`. Per-doc try/catch so one bad doc can't wedge the sweep; returns a run summary. |
| `functions/index.js` | **+30 lines.** `exports.reconcileStuckBatches` — `onSchedule('every 1 hours', ...)` wrapper delegating to the core, placed beside `weeklyDigest`/`activityCleanup`. |
| `functions/.env.example` | **+3 lines.** Documents `PROSPECT_BATCH_STALE_HOURS=3`. |
| `functions/tests/prospectBatchReconciler.test.js` | **New.** 14 unit tests. |

Design choices carried from Gate 1, unchanged: terminal state `failed` (excluded from the cap filter, already surfaced by `_serializeBatch`, matches the manual script); staleness threshold default **3h**, env-tunable via `PROSPECT_BATCH_STALE_HOURS`; cadence **hourly**; **no** user notification and **no** prospect-subcollection/credit writes (parity with the manual script); scope **Prospect Intel only**.

## Test results

- **New file:** 14/14 pass (`npx jest tests/prospectBatchReconciler.test.js`).
- **Full suite:** **1,724 passed, 0 failing**, 63 suites (baseline 1,710 + 14 new). The "worker process failed to exit gracefully" line is a pre-existing teardown artifact from other suites, not a failure in this change.
- Coverage of the key behaviors: stale `processing` → `failed` (fields asserted); stale `queued` → `failed`; **fresh in-flight batch NOT touched** (recent `updatedAt` resets the clock); `completed`/`failed` ignored by the filter; **cap frees** (5 stuck → `activeCount` 5→0 via the real cap query); per-doc write failure doesn't abort the sweep; threshold boundary is exclusive; env override + 3h default; undatable doc skipped, never reaped; empty collection clean; helper units.

## Verification performed

- `node --check` on `scheduled/prospectBatchReconciler.js` and `index.js` → OK.
- `git diff` confirms only the four intended files changed (plus the pre-existing, not-mine `.claude/settings.local.json` harness edit). Tracked diffs reviewed — additions only, no stray edits.
- Dry-run behavior exercised through the mocked-Firestore tests (stale + fresh + failed-write mix); reconciled-vs-skipped summary asserted.

## Safety confirmations

- **Nothing deployed. No production reads or writes this session.** No `firebase deploy`, no `firebase functions:list`, no Rules API, no service-account-key use. The reconciler only runs in production once deployed later, separately, after merge.
- **This is a repo change only** — the code lands on a branch and (pending your go-ahead) a PR to **Williams**. I do not merge or self-merge.
- Known-intentional items untouched. No changes to the manual `clear-stuck-batches.js` (kept as the existing fallback).
- Rollback = revert the PR / delete the deployed function; no data migration to undo.

## Open decision (from Gate 1, still yours)

You approved the plan as-is; the two tunables baked in as recommended defaults are **3h staleness** and **no user notification**. If you'd prefer a different threshold or a notification on auto-reconcile, say so and I'll fold it in before the PR. Otherwise this is ready for the PR handoff.

## Owner action (not mine — flagged, not performed)

Per the audit's Immediate plan, confirm the deployed functions revision matches `main` (`firebase functions:list` / console) — a production read outside this session's policy.

---

**STOP — awaiting your go-ahead to open the PR to Williams.** Next work item (F-101 + F-601) does not start until this one is handed off.
