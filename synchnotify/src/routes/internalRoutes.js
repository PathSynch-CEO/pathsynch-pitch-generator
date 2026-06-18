/**
 * Internal Routes
 *
 * POST /internal/deliver — Cloud Task handler for async event delivery.
 *
 * Called by Cloud Tasks, not by external clients. In production, this endpoint
 * is protected by IAM (only the Cloud Tasks service account can invoke it).
 */

const express = require('express');
const deliveryWorker = require('../services/deliveryWorker');
const { CLOUD_TASK_MAX_ATTEMPTS } = require('../config/constants');

/**
 * Mount internal routes.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @returns {express.Router}
 */
function internalRoutes({ db }) {
    const router = express.Router();

    // POST /internal/deliver — Cloud Task delivery handler
    router.post('/internal/deliver', async (req, res) => {
        const eventRecord = req.body;

        if (!eventRecord || !eventRecord.eventId) {
            return res.status(400).json({
                success: false,
                error: 'Missing event record in request body'
            });
        }

        // Cloud Tasks sends retry count in header
        const attemptCount = parseInt(req.headers['x-cloudtasks-taskretrycount'] || '0', 10) + 1;

        try {
            const result = await deliveryWorker.processEvent({ db }, eventRecord);

            return res.status(200).json({
                success: true,
                eventId: eventRecord.eventId,
                ...result
            });
        } catch (error) {
            console.error(`[internal/deliver] Delivery failed (attempt ${attemptCount}/${CLOUD_TASK_MAX_ATTEMPTS}):`, error.message);

            if (attemptCount >= CLOUD_TASK_MAX_ATTEMPTS) {
                // Max attempts reached — dead letter
                await deliveryWorker.writeDeadLetter(
                    { db },
                    eventRecord,
                    error.message,
                    attemptCount
                );

                // Return 200 so Cloud Tasks does not retry again
                return res.status(200).json({
                    success: false,
                    eventId: eventRecord.eventId,
                    deadLettered: true,
                    reason: error.message
                });
            }

            // Return 500 so Cloud Tasks retries
            return res.status(500).json({
                success: false,
                error: 'Delivery failed, will retry',
                attempt: attemptCount
            });
        }
    });

    return router;
}

module.exports = { internalRoutes };
