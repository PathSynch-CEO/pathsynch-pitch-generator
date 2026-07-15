'use strict';

/**
 * Prospect Batch Reconciler — F-201
 *
 * Scheduled self-heal for the Prospect Intel active-batch cap.
 *
 * The cap in `routes/prospectIntelRoutes.js` (MAX_ACTIVE_BATCHES_PER_USER, default 5)
 * counts every batch whose status is 'queued' or 'processing'. A batch that gets stuck
 * in 'processing' (worker never started, some prospects never reach a terminal state,
 * trigger mis-fire) never ages out on its own — `_incrementBatchProgress()` only flips a
 * batch to 'completed' when completedCount + failedCount >= totalProspects, which never
 * happens for an orphaned batch. Those slots are consumed permanently until a human runs
 * the untracked `scripts/clear-stuck-batches.js` with hardcoded whitelist IDs.
 *
 * This reconciler ages genuinely-stale 'queued'/'processing' batches to the terminal
 * 'failed' state — the same state the manual script writes and the same state the cap
 * filter excludes — so the 5 slots self-heal without a human and without a whitelist.
 *
 * Terminal state written: status='failed', failureReason='auto_reconciled_stale',
 * clearedBy='auto_reconciler' (mirrors the manual script's clearedBy so ops history stays
 * uniform; the distinct 'auto_reconciler' value + reconciledAt timestamp let an auditor
 * tell automated from manual clears apart).
 *
 * Scope: Prospect Intel batches only (the top-level `prospectIntel` collection).
 * NOT SynchGov govcapture batches — different collection and pipeline.
 *
 * The core `reconcileStuckBatches()` is a plain async function (no firebase-functions
 * dependency) so it is unit-testable; index.js wraps it in the onSchedule trigger.
 */

const admin = require('firebase-admin');

// Batches in these statuses consume an active-batch slot (must match the cap filter
// in routes/prospectIntelRoutes.js).
const ACTIVE_STATUSES = ['queued', 'processing'];

// Conservative default: well above the theoretical worst-case legitimate batch
// (500 prospects, fan-out capped at 5 parallel, ~30s agent timeout each + retries →
// tens of minutes, not hours). Tunable at runtime via PROSPECT_BATCH_STALE_HOURS.
const DEFAULT_STALE_HOURS = 3;

/**
 * Coerce a Firestore timestamp (or Date / epoch millis) to epoch milliseconds.
 * Returns null when the value cannot be dated.
 */
function _toMillis(ts) {
    if (ts == null) return null;
    if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
    if (typeof ts.toMillis === 'function') {
        try { const ms = ts.toMillis(); return Number.isFinite(ms) ? ms : null; } catch (_) { /* fall through */ }
    }
    if (typeof ts.toDate === 'function') {
        try { const d = ts.toDate(); return d instanceof Date ? d.getTime() : null; } catch (_) { /* fall through */ }
    }
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
    return null;
}

/**
 * Staleness anchor = the MOST RECENT of the timestamps the write paths actually set
 * (updatedAt on every prospect-progress increment, processingStartedAt when the
 * create-trigger fires, createdAt at batch creation). Using the most recent means any
 * real progress resets the clock — a slowly-but-genuinely-advancing batch is never reaped.
 * Returns null when none of the three is datable.
 */
function _stalenessAnchorMs(data) {
    const candidates = [data.updatedAt, data.processingStartedAt, data.createdAt]
        .map(_toMillis)
        .filter(v => typeof v === 'number');
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
}

/**
 * Age stale active Prospect Intel batches to the terminal 'failed' state.
 *
 * @param {object}  [options]
 * @param {number}  [options.now]        Epoch millis "now" (defaults to Date.now(); injectable for tests).
 * @param {number}  [options.staleHours] Staleness threshold in hours (defaults to
 *                                       PROSPECT_BATCH_STALE_HOURS env or DEFAULT_STALE_HOURS).
 * @returns {Promise<{scanned:number, reconciled:number, skipped:number, failed:number,
 *                    staleHours:number, reconciledIds:string[], queryError?:string}>}
 */
async function reconcileStuckBatches(options = {}) {
    const db = admin.firestore();
    const now = typeof options.now === 'number' ? options.now : Date.now();
    const staleHours = Number.isFinite(options.staleHours)
        ? options.staleHours
        : (parseFloat(process.env.PROSPECT_BATCH_STALE_HOURS) || DEFAULT_STALE_HOURS);
    const staleMs = staleHours * 60 * 60 * 1000;

    const summary = { scanned: 0, reconciled: 0, skipped: 0, failed: 0, staleHours, reconciledIds: [] };

    let snap;
    try {
        snap = await db.collection('prospectIntel')
            .where('status', 'in', ACTIVE_STATUSES)
            .get();
    } catch (err) {
        console.error('[BatchReconciler] Active-batch query failed:', err.message);
        summary.queryError = err.message;
        return summary;
    }

    summary.scanned = snap.size;

    for (const doc of snap.docs) {
        const data = doc.data() || {};
        const anchorMs = _stalenessAnchorMs(data);

        // Never reap a batch we cannot age — skip and surface it for investigation.
        // (In practice every batch has createdAt, so this is a defensive guard.)
        if (anchorMs == null) {
            summary.skipped += 1;
            console.warn(`[BatchReconciler] Batch ${doc.id} has no datable timestamp — skipping`);
            continue;
        }

        const ageMs = now - anchorMs;
        if (ageMs <= staleMs) {
            summary.skipped += 1;
            continue;
        }

        try {
            await doc.ref.update({
                status:        'failed',
                failureReason: 'auto_reconciled_stale',
                reconciledAt:  admin.firestore.FieldValue.serverTimestamp(),
                clearedBy:     'auto_reconciler',
                updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
            });
            summary.reconciled += 1;
            summary.reconciledIds.push(doc.id);
            console.log(
                `[BatchReconciler] Reconciled stale batch ${doc.id} — was '${data.status}', ` +
                `idle ~${Math.round(ageMs / 60000)}m (threshold ${staleHours}h)`
            );
        } catch (err) {
            // One bad doc must never wedge the sweep — record and continue.
            summary.failed += 1;
            console.error(`[BatchReconciler] Failed to reconcile batch ${doc.id}:`, err.message);
        }
    }

    console.log(
        `[BatchReconciler] Run complete — scanned=${summary.scanned} reconciled=${summary.reconciled} ` +
        `skipped=${summary.skipped} failed=${summary.failed} (threshold ${staleHours}h)`
    );
    return summary;
}

module.exports = {
    reconcileStuckBatches,
    _toMillis,
    _stalenessAnchorMs,
    ACTIVE_STATUSES,
    DEFAULT_STALE_HOURS,
};
