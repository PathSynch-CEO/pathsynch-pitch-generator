'use strict';

/**
 * api/billing.js
 *
 * Canonical credit utility shared across pitch generation, market intel,
 * template enrichment, prospect intel, and opportunity briefs.
 *
 * Dependency rule: billing.js imports ONLY firebase-admin.
 * All other services import from billing.js — never the reverse.
 *
 * Exports:
 *   checkCredits(userId, required)          → { allowed, available }
 *   deductCredits(userId, amount, reason, options)  → void (non-blocking, never throws)
 */

const admin = require('firebase-admin');

let _db;
function getDb() {
    if (!_db) _db = admin.firestore();
    return _db;
}

// ── Credit check ───────────────────────────────────────────────────────────────

/**
 * Check whether userId has at least `required` credits.
 *
 * Legacy accounts without a `credits` field are treated as unlimited
 * (no-op — they pre-date the credit system).
 *
 * @param {string} userId
 * @param {number} required
 * @returns {Promise<{allowed: boolean, available: number}>}
 */
async function checkCredits(userId, required) {
    if (!userId || userId === 'anonymous') {
        return { allowed: true, available: Infinity };
    }
    try {
        const db      = getDb();
        const userDoc = await db.collection('users').doc(userId).get();
        const data    = userDoc.exists ? userDoc.data() : {};
        const credits = data.credits;

        // No credits field → legacy account → unlimited
        if (credits === undefined || credits === null) {
            return { allowed: true, available: Infinity };
        }
        return { allowed: credits >= required, available: credits };
    } catch (err) {
        console.warn('[Billing] Credit check failed (allowing):', err.message);
        return { allowed: true, available: Infinity };
    }
}

// ── Credit deduction ───────────────────────────────────────────────────────────

/**
 * Deduct `amount` credits from userId (non-blocking — failure is logged, never thrown).
 *
 * Always writes two records:
 *   1. Decrements users/{userId}.credits
 *   2. Appends a row to creditLedger/{autoId}
 *
 * @param {string}  userId
 * @param {number}  amount   Positive integer — credits to deduct
 * @param {string}  reason   Human-readable label (e.g. 'template_enrichment:brewhouse')
 * @param {object}  [options]
 * @param {string}  [options.service='platform']  Machine-readable service tag
 * @param {boolean} [options.writeLedger=true]     Write audit row to creditLedger
 */
async function deductCredits(userId, amount, reason, options = {}) {
    if (!userId || userId === 'anonymous' || !amount) return;

    const { service = 'platform', writeLedger = true } = options;

    try {
        const db = getDb();

        // 1. Decrement user credits
        await db.collection('users').doc(userId).update({
            credits: admin.firestore.FieldValue.increment(-amount)
        });

        // 2. Audit ledger (non-blocking — failure must not block the caller)
        if (writeLedger) {
            db.collection('creditLedger').add({
                userId,
                amount:    -amount,
                reason:    reason || 'platform',
                service,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.warn('[Billing] Ledger write failed (non-blocking):', e.message));
        }

        console.log(`[Billing] Deducted ${amount} credits from ${userId} (${service}: ${reason})`);
    } catch (err) {
        console.warn(`[Billing] Credit deduction failed (non-blocking): ${err.message}`);
    }
}

// ── Shared ledger writer ───────────────────────────────────────────────────────

/**
 * Write an entry to the creditLedger collection.
 * Non-blocking — failure is logged, never thrown.
 *
 * @param {string} userId
 * @param {number} amount   Negative for deductions, positive for refunds
 * @param {string} reason
 * @param {string} service
 */
function writeCreditLedger(userId, amount, reason, service) {
    try {
        const db = getDb();
        db.collection('creditLedger').add({
            userId,
            amount,
            reason:    reason || 'platform',
            service:   service || 'platform',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('[Billing] Ledger write failed (non-blocking):', e.message));
    } catch (e) {
        console.warn('[Billing] Ledger write setup failed:', e.message);
    }
}

// ── Atomic check + deduct ──────────────────────────────────────────────────────

/**
 * Atomically check and deduct credits in a single Firestore transaction.
 * Prevents double-spend from concurrent requests.
 *
 * FAILS CLOSED: If the transaction itself fails (Firestore error),
 * returns { allowed: false, error: 'BILLING_TRANSACTION_FAILED' }.
 * Routes should return 503 BILLING_UNAVAILABLE, NOT 402 INSUFFICIENT_CREDITS.
 *
 * @param {string}  userId
 * @param {number}  required   Credits needed
 * @param {string}  reason     Human-readable label
 * @param {object}  [options]
 * @param {string}  [options.service='platform']
 * @param {boolean} [options.writeLedger=true]
 * @returns {Promise<{allowed: boolean, available: number, deducted: number, error?: string}>}
 */
async function checkAndDeductCredits(userId, required, reason, options = {}) {
    if (!userId || userId === 'anonymous') {
        return { allowed: true, available: Infinity, deducted: 0 };
    }
    if (!required || required <= 0) {
        return { allowed: true, available: Infinity, deducted: 0 };
    }

    const { service = 'platform', writeLedger = true } = options;
    const db = getDb();
    const userRef = db.collection('users').doc(userId);

    try {
        const result = await db.runTransaction(async (tx) => {
            const userSnap = await tx.get(userRef);
            const data = userSnap.exists ? userSnap.data() : {};
            const credits = data.credits;

            // No credits field → legacy account → unlimited (intentional, logged)
            if (credits === undefined || credits === null) {
                console.log(`[Billing] Legacy account (no credits field): ${userId} — allowing ${reason}`);
                return { allowed: true, available: Infinity, deducted: 0, legacy: true };
            }

            if (credits < required) {
                return { allowed: false, available: credits, deducted: 0 };
            }

            // Deduct inside transaction
            tx.update(userRef, {
                credits: admin.firestore.FieldValue.increment(-required)
            });

            return { allowed: true, available: credits, deducted: required };
        });

        // Ledger write OUTSIDE transaction (non-blocking, non-critical)
        if (result.allowed && result.deducted > 0 && writeLedger) {
            writeCreditLedger(userId, -required, reason, service);
        }

        if (result.allowed) {
            console.log(`[Billing] Atomic deduct: ${required} credits from ${userId} (${service}: ${reason})`);
        } else {
            console.warn(`[Billing] Insufficient credits: need ${required}, have ${result.available} (${userId})`);
        }

        return result;
    } catch (err) {
        // FAIL CLOSED — do not allow work to proceed on billing failure
        console.error(`[Billing] Transaction FAILED for ${userId} (${reason}): ${err.message}`);
        return { allowed: false, available: 0, deducted: 0, error: 'BILLING_TRANSACTION_FAILED' };
    }
}

// ── Refund credits ─────────────────────────────────────────────────────────────

/**
 * Refund credits to a user with a ledger entry.
 * Used for: generation failure refunds, variable-cost partial refunds.
 *
 * Non-blocking — failure is logged but never thrown to the caller.
 *
 * @param {string}  userId
 * @param {number}  amount    Positive integer — credits to restore
 * @param {string}  reason    Human-readable label (e.g. 'opportunity_brief:refund_on_failure')
 * @param {object}  [options]
 * @param {string}  [options.service='platform']
 */
async function refundCredits(userId, amount, reason, options = {}) {
    if (!userId || userId === 'anonymous' || !amount || amount <= 0) return;

    const { service = 'platform' } = options;

    try {
        const db = getDb();
        await db.collection('users').doc(userId).update({
            credits: admin.firestore.FieldValue.increment(amount)
        });

        // Positive amount in ledger = refund
        writeCreditLedger(userId, amount, reason, service);

        console.log(`[Billing] Refunded ${amount} credits to ${userId} (${service}: ${reason})`);
    } catch (err) {
        // Log but don't throw — refund failure should not crash the caller
        console.error(`[Billing] Refund FAILED for ${userId}: ${amount} credits (${reason}): ${err.message}`);
    }
}

module.exports = { checkCredits, deductCredits, checkAndDeductCredits, refundCredits, writeCreditLedger };
