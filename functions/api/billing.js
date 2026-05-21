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

module.exports = { checkCredits, deductCredits };
