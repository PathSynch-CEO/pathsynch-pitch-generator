/**
 * Event Routes
 *
 * POST /api/v1/events — Ingest events from PathSynch products.
 *
 * Pipeline: HMAC auth → replay protection → idempotency → validate → process → 202
 */

const express = require('express');
const { validateEnvelope, processEvent } = require('../services/eventProcessor');

/**
 * Mount event routes.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} deps.taskClient - Cloud Tasks client (or null in dev)
 * @param {Object} deps.config - { queuePath, serviceUrl }
 * @param {Object} deps.hmacMiddleware - HMAC auth middleware
 * @param {Object} deps.idempotencyMiddleware - Idempotency middleware
 * @returns {express.Router}
 */
function eventRoutes({ db, taskClient, config, hmacMiddleware, idempotencyMiddleware }) {
    const router = express.Router();

    // POST /api/v1/events
    router.post('/api/v1/events',
        hmacMiddleware,
        idempotencyMiddleware,
        async (req, res) => {
            const event = req.verifiedBody || req.body;

            // Validate envelope schema
            const { valid, errors } = validateEnvelope(event);
            if (!valid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid event envelope',
                    details: errors
                });
            }

            try {
                const result = await processEvent(
                    { db, taskClient, config },
                    event,
                    req.idempotencyScopedKey
                );

                return res.status(202).json({
                    received: true,
                    eventId: result.eventId,
                    queued: result.queued
                });
            } catch (error) {
                console.error('[eventRoutes] Event processing failed:', error.message);
                return res.status(500).json({
                    success: false,
                    error: 'Internal processing error'
                });
            }
        }
    );

    return router;
}

module.exports = { eventRoutes };
