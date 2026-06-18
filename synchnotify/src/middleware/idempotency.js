/**
 * Idempotency Middleware
 *
 * Deduplicates events by scoped key: identitySpace + source + tenantId + idempotencyKey.
 * Stores receipt in Firestore eventLog collection.
 * Duplicate events return 202 with original eventId and do not re-enqueue.
 */

/**
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @returns {Function} Express middleware
 */
function idempotency({ db }) {
    return async (req, res, next) => {
        const body = req.verifiedBody || req.body;

        const { identitySpace, source, tenantId, idempotencyKey } = body;

        if (!idempotencyKey) {
            return res.status(400).json({
                success: false,
                error: 'Missing idempotencyKey in event envelope'
            });
        }

        // Scoped dedup key: identitySpace + source + tenantId + idempotencyKey
        const scopedKey = [
            identitySpace || 'firebase',
            source || 'unknown',
            tenantId || 'unknown',
            idempotencyKey
        ].join(':');

        try {
            const eventLogRef = db.collection('eventLog');
            const existingDoc = await eventLogRef.doc(scopedKey).get();

            if (existingDoc.exists) {
                const existing = existingDoc.data();
                return res.status(202).json({
                    received: true,
                    eventId: existing.eventId,
                    queued: false,
                    duplicate: true
                });
            }

            // Store scoped key for downstream use
            req.idempotencyScopedKey = scopedKey;
            next();
        } catch (error) {
            console.error('[idempotency] Firestore lookup failed:', error.message);
            // Fail open on transient Firestore errors — allow processing
            // The event processor will re-check before enqueueing
            req.idempotencyScopedKey = scopedKey;
            next();
        }
    };
}

module.exports = { idempotency };
