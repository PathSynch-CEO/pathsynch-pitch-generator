/**
 * Delivery Worker
 *
 * Processes events from Cloud Tasks. In S1, this is a no-op stub.
 * S2 will add Slack provider delivery.
 *
 * On failure after max attempts, writes to deadLetterEvents collection.
 */

const { CLOUD_TASK_MAX_ATTEMPTS } = require('../config/constants');

/**
 * Process a delivery event.
 *
 * S1: No-op stub. Logs the event and marks as processed.
 * S2: Will route to the appropriate provider (Slack, etc.)
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} eventRecord - The event record from eventLog
 * @returns {Promise<{ delivered: boolean, provider: string|null }>}
 */
async function processEvent({ db }, eventRecord) {
    const { eventId, scopedKey, tenantId, eventType, source } = eventRecord;

    console.log(`[deliveryWorker] Processing event ${eventId} (type: ${eventType}, source: ${source})`);

    try {
        // S1: No-op stub — no actual delivery
        // S2 will add: resolve merchant prefs, check tier, route to Slack provider
        const result = {
            delivered: true,
            provider: null, // No provider in S1
            stub: true,
            processedAt: new Date().toISOString()
        };

        // Update eventLog status
        if (scopedKey) {
            await db.collection('eventLog').doc(scopedKey).update({
                status: 'processed',
                processedAt: result.processedAt,
                deliveryResult: result
            });
        }

        return result;
    } catch (error) {
        console.error(`[deliveryWorker] Processing failed for event ${eventId}:`, error.message);
        throw error; // Let the caller handle retry/dead-letter logic
    }
}

/**
 * Write a failed event to the dead letter collection.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} eventRecord - The event record
 * @param {string} failureReason - Why it failed
 * @param {number} attemptCount - How many times delivery was attempted
 */
async function writeDeadLetter({ db }, eventRecord, failureReason, attemptCount) {
    try {
        const deadLetterRef = db.collection('deadLetterEvents').doc();
        await deadLetterRef.set({
            eventId: eventRecord.eventId,
            scopedKey: eventRecord.scopedKey,
            tenantId: eventRecord.tenantId,
            identitySpace: eventRecord.identitySpace || 'firebase',
            source: eventRecord.source,
            eventType: eventRecord.eventType,
            priority: eventRecord.priority,
            payload: eventRecord.payload || {},
            failureReason,
            attemptCount,
            maxAttempts: CLOUD_TASK_MAX_ATTEMPTS,
            createdAt: new Date().toISOString(),
            resolved: false
        });

        // Update eventLog status
        if (eventRecord.scopedKey) {
            await db.collection('eventLog').doc(eventRecord.scopedKey).update({
                status: 'dead_lettered',
                deadLetteredAt: new Date().toISOString(),
                failureReason
            });
        }

        console.log(`[deliveryWorker] Event ${eventRecord.eventId} written to dead letter`);
    } catch (error) {
        console.error(`[deliveryWorker] Failed to write dead letter for ${eventRecord.eventId}:`, error.message);
    }
}

module.exports = { processEvent, writeDeadLetter };
