/**
 * Event Processor
 *
 * Validates event envelope, writes to eventLog, and enqueues Cloud Task
 * for async delivery.
 */

const { v4: uuidv4 } = require('uuid');
const {
    ALLOWED_SOURCES,
    ALLOWED_EVENT_TYPES,
    ALLOWED_PRIORITIES,
    ALLOWED_IDENTITY_SPACES,
    ENVELOPE_VERSION
} = require('../config/constants');

/**
 * Validate event envelope against the Master PRD schema.
 *
 * @param {Object} event - The event envelope
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEnvelope(event) {
    const errors = [];

    if (!event || typeof event !== 'object') {
        return { valid: false, errors: ['Event must be a JSON object'] };
    }

    // Required fields
    if (!event.tenantId || typeof event.tenantId !== 'string') {
        errors.push('Missing or invalid tenantId');
    }

    if (!event.source || !ALLOWED_SOURCES.includes(event.source)) {
        errors.push(`Invalid source. Allowed: ${ALLOWED_SOURCES.join(', ')}`);
    }

    if (!event.eventType || !ALLOWED_EVENT_TYPES.includes(event.eventType)) {
        errors.push(`Invalid eventType. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`);
    }

    if (!event.priority || !ALLOWED_PRIORITIES.includes(event.priority)) {
        errors.push(`Invalid priority. Allowed: ${ALLOWED_PRIORITIES.join(', ')}`);
    }

    if (!event.timestamp || typeof event.timestamp !== 'string') {
        errors.push('Missing or invalid timestamp');
    } else if (isNaN(Date.parse(event.timestamp))) {
        errors.push('timestamp must be a valid ISO-8601 string');
    }

    if (!event.idempotencyKey || typeof event.idempotencyKey !== 'string') {
        errors.push('Missing or invalid idempotencyKey');
    }

    // Optional but validated if present
    if (event.identitySpace && !ALLOWED_IDENTITY_SPACES.includes(event.identitySpace)) {
        errors.push(`Invalid identitySpace. Allowed: ${ALLOWED_IDENTITY_SPACES.join(', ')}`);
    }

    if (event.payload !== undefined && (typeof event.payload !== 'object' || event.payload === null)) {
        errors.push('payload must be an object if provided');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Process a validated event: write to eventLog and enqueue Cloud Task.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} deps.taskClient - Cloud Tasks client (or mock)
 * @param {Object} deps.config - { queuePath, serviceUrl }
 * @param {Object} event - Validated event envelope
 * @param {string} scopedKey - Idempotency scoped key
 * @returns {Promise<{ eventId: string, queued: boolean }>}
 */
async function processEvent({ db, taskClient, config }, event, scopedKey) {
    const eventId = uuidv4();
    const now = new Date().toISOString();

    // Write event receipt to eventLog (idempotency record)
    const eventLogRef = db.collection('eventLog').doc(scopedKey);

    // Use a transaction for safe concurrent dedup
    const result = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(eventLogRef);

        if (doc.exists) {
            // Duplicate detected during transaction
            return { eventId: doc.data().eventId, queued: false, duplicate: true };
        }

        const eventRecord = {
            eventId,
            tenantId: event.tenantId,
            identitySpace: event.identitySpace || 'firebase',
            source: event.source,
            eventType: event.eventType,
            priority: event.priority,
            merchantCode: event.merchantCode || null,
            idempotencyKey: event.idempotencyKey,
            scopedKey,
            payload: event.payload || {},
            eventTimestamp: event.timestamp,
            receivedAt: now,
            status: 'received',
            version: event.version || ENVELOPE_VERSION
        };

        transaction.set(eventLogRef, eventRecord);

        return { eventId, queued: true, duplicate: false, eventRecord };
    });

    if (result.duplicate) {
        return { eventId: result.eventId, queued: false };
    }

    // Enqueue Cloud Task for async delivery
    try {
        await enqueueDeliveryTask({ taskClient, config }, result.eventRecord);
    } catch (error) {
        console.error('[eventProcessor] Failed to enqueue Cloud Task:', error.message);
        // Update status to indicate enqueueing failed
        await eventLogRef.update({ status: 'enqueue_failed', enqueueError: error.message });
        // Still return 202 — the event is logged and can be retried
    }

    return { eventId: result.eventId, queued: result.queued };
}

/**
 * Enqueue a Cloud Task for async delivery.
 */
async function enqueueDeliveryTask({ taskClient, config }, eventRecord) {
    if (!taskClient || !config?.queuePath) {
        console.warn('[eventProcessor] Cloud Tasks not configured — skipping enqueue');
        return;
    }

    const payload = JSON.stringify(eventRecord);
    const serviceUrl = config.serviceUrl || process.env.SYNCHNOTIFY_SERVICE_URL;

    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url: `${serviceUrl}/internal/deliver`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(payload).toString('base64')
        }
    };

    await taskClient.createTask({
        parent: config.queuePath,
        task
    });
}

module.exports = { validateEnvelope, processEvent, enqueueDeliveryTask };
