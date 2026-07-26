# Gate 1 Strategy Review — F-201: Stuck-Batch Reconciler

**Work Item 1 of the SynchIntro P1 remediation.** This is the Gate 1 STOP: strategy only, no code written yet. On your approval I cut the branch and build (then STOP again at Gate 2 before the PR → Williams).

> On approval I will also save this document verbatim as `strategy-review-f201.md` in the repo root, per the two-gate convention (plan mode currently limits me to editing this one file).

---

## Context — why this change

F-201 is the only P1 with a real production incident behind it. The Prospect Intel batch cap (`MAX_ACTIVE_BATCHES_PER_USER`, default 5) counts every batch in `queued` or `processing`. A batch that gets stuck in `processing` (worker never started, some prospects never reach a terminal state, trigger mis-fire) **never ages out** — nothing transitions it to a terminal state. Those slots are consumed permanently, and the user gets a hard `429 "Maximum 5 active batches"` on every new batch until a human runs the untracked `clear-stuck-batches.js` with hardcoded whitelist IDs (last run `manual_ops_charles_2026_07_10`, 7 Apr-2026 batches).

The fix: a scheduled Cloud Function that ages genuinely-stale `queued`/`processing` batches to the terminal `failed` state, so the 5 slots self-heal — replacing the manual whitelist script with an automated, whitelist-free reconciler.

---

## Recommended approach

A new `onSchedule` Cloud Function, `reconcileStuckBatches`, in `functions/scheduled/prospectBatchReconciler.js`, registered in `index.js` next to the other scheduled exports.

**Logic (each run):**
1. Query `prospectIntel` where `status in ['queued','processing']` (collection-group not needed — batches are top-level docs).
2. For each, compute a staleness anchor = latest of `updatedAt` → `processingStartedAt` → `createdAt` (whichever exists; these are the timestamps the write paths actually set).
3. If `now - anchor > STALE_THRESHOLD`, transition the doc to the terminal state via `update()`:
   - `status: 'failed'`
   - `failureReason: 'auto_reconciled_stale'`
   - `reconciledAt: serverTimestamp()`
   - `clearedBy: 'auto_reconciler'` (mirrors the manual script's `clearedBy` field so ops history stays uniform)
4. Log a per-run summary (scanned, reconciled, batch IDs). Never throw on an individual doc failure — accumulate and continue, so one bad doc can't wedge the sweep.

**Why `failed` (not a new state):** it's the exact terminal state the manual script already writes, it's excluded from the cap's `['queued','processing']` filter (so slots free immediately), and `_serializeBatch` already surfaces it to the frontend. No downstream reader needs to learn a new value.

**Why staleness-based, not whitelist:** removes the hardcoded-ID operational burden entirely; any future stuck batch self-heals without a human.

---

## Gate 1 required answers

| Question | Answer / recommendation |
|---|---|
| **Staleness threshold** (stuck vs. legitimately long-running) | Worst-case legit batch: 500 prospects, fan-out capped at 5 parallel, ~30s agent timeout + up to 2 Places fallback calls each, plus per-prospect retries → tens of minutes, not hours. **Recommend a conservative default of 3 hours**, exposed as env var `PROSPECT_BATCH_STALE_HOURS` (default `3`) so it can be tuned without a redeploy. I cannot measure real historical batch durations this session (no production reads permitted — see note below); 3h is deliberately well above the theoretical max. **Decision point for you: confirm 3h or set your own.** |
| **Terminal state + downstream readers** | `status:'failed'`. Readers of `status`: the cap filter (`['queued','processing']` — `failed` excluded ✓), `_serializeBatch` → frontend (shows "failed" ✓), `onProspectBatchCreated` (ignores non-`queued` ✓), the single-prospect retry route (sets `processing` on manual retry — still works ✓). No reader breaks. |
| **User notification / child-doc cleanup?** | **Recommend neither for v1**, to keep blast radius minimal and match the manual script (which touches neither prospects subcollection nor credits). Individual prospects keep their own `enrichmentStatus`; per-prospect retry still works after the batch is failed. Notification can be a fast-follow if you want it. **Decision point: confirm no-notify, or ask for a notification.** |
| **Schedule cadence** | **Recommend `every 1 hours`.** Frequent enough that a stuck slot frees within ~1h of crossing the threshold; cheap (one indexed query per run). |
| **Scope** | **Prospect Intel batches only** (`prospectIntel` collection). Explicitly NOT SynchGov `govcapture` batches — different collection/pipeline, out of scope for F-201. Confirmed. |

---

## Blast radius

- **Production data touched at runtime:** only `prospectIntel` docs already stuck in `queued`/`processing` past the threshold — i.e. batches that are already dead. Healthy in-flight batches (anchor within threshold) are never touched. New/fast batches complete long before the window.
- **No new collections, no schema migration, no credit/ledger writes, no prospect-subcollection writes.**
- **This session: nothing deploys.** Code lands on a branch + PR; deploy happens later, separately, after Williams merges. The reconciler only ever runs in production once deployed by that separate process.
- Query cost: one `where status in [...]` per hour. Existing indexes cover it (equality/`in` on a single field needs no composite index); I'll confirm during build and add to `firestore.indexes.json` only if the emulator/CLI flags it.

## What could go wrong + mitigations

| Risk | Mitigation |
|---|---|
| Threshold too low → kills a legit long-running batch | Conservative 3h default, env-tunable; anchor uses the *most recent* of three timestamps so any real progress resets the clock. |
| A batch legitimately in `queued` for a bit gets reaped | `queued` only lasts until the create-trigger fires (seconds); 3h dwarfs it. A batch still `queued` after 3h is genuinely orphaned (trigger never ran). |
| Sweep throws on one malformed doc, skips the rest | Per-doc try/catch, accumulate failures, continue; run-level summary log. |
| Reconciler races the real completion write | Both are idempotent `update()`s; if `_incrementBatchProgress` sets `completed` first, the reconciler's next-hour query no longer sees the doc. Worst case a doc flips `failed` moments before a straggler would've completed — acceptable and rare at a 3h threshold. |

## Rollback

Pure additive change (one new file + one `exports.reconcileStuckBatches` registration). Rollback = revert the PR / delete the deployed scheduled function; the manual `clear-stuck-batches.js` remains as the existing fallback. No data migration to undo.

---

## Build plan (only after your approval)

1. Branch `fix/f201-stuck-batch-reconciler` off `main`.
2. `functions/scheduled/prospectBatchReconciler.js` — exported `reconcileStuckBatches(nowMs?)` core (pure/testable) + thin `onSchedule` wrapper.
3. Register `exports.reconcileStuckBatches` in `index.js` alongside `weeklyDigest`/`activityCleanup`.
4. Env: document `PROSPECT_BATCH_STALE_HOURS` in `functions/.env.example`.
5. **Tests** (same PR — new behavior ships with tests; baseline 1,710 green), following the existing `functions/tests/` + `__mocks__/firebase-admin.js` patterns:
   - stale `processing` batch → reconciled to `failed` with correct fields
   - stale `queued` batch → reconciled
   - **fresh in-flight batch (anchor within threshold) → NOT touched** (the key safety test)
   - already-`completed`/`failed` batch → ignored (not in query set)
   - cap frees: after reconciliation a user at 5 stuck can create again (simulated via the count query)
   - per-doc failure doesn't abort the sweep

## Verification (Gate 2 evidence I'll gather before the PR)

- Full suite green (≥1,710) via the repo's jest run; new reconciler tests included in the count.
- `node --check` on both changed files.
- Dry-run the core function against mocked Firestore fixtures (stale + fresh mix) and show the reconciled-vs-skipped summary.
- `git diff --name-only` limited to the two intended files (+ `.env.example`).
- Confirm in the Gate 2 writeup: **nothing deployed; no production reads/writes performed this session.**

## Constraints I'm holding to

No merge/self-merge (PR → **Williams**). No production reads this session — including that I will **not** run `firebase functions:list`/console to check deployed-revision parity (that's your owner action). Windows/PowerShell sequential commands only. Known-intentional items untouched.
