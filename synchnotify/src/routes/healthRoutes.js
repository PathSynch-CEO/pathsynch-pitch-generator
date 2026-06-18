/**
 * Health Routes
 *
 * GET /health  — basic liveness check
 * GET /ready   — readiness check (Firestore and Secret Manager connectivity)
 */

const express = require('express');
const router = express.Router();

/**
 * Mount health routes.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @returns {express.Router}
 */
function healthRoutes({ db }) {
    // GET /health — liveness
    router.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    // GET /ready — readiness
    router.get('/ready', async (req, res) => {
        const checks = {
            firestore: false,
            secretManager: false
        };

        // Check Firestore connectivity
        try {
            // Lightweight read to verify Firestore is accessible
            await db.collection('eventLog').limit(1).get();
            checks.firestore = true;
        } catch (error) {
            console.error('[health] Firestore check failed:', error.message);
        }

        // Secret Manager check — verify env vars are loaded
        // (actual Secret Manager connectivity is checked at startup)
        checks.secretManager = !!(
            process.env.SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO ||
            process.env.SYNCHNOTIFY_SECRETS_LOADED === 'true'
        );

        const allReady = checks.firestore; // secretManager is optional in S1
        const status = allReady ? 'ready' : 'not_ready';

        res.status(allReady ? 200 : 503).json({ status, ...checks });
    });

    return router;
}

module.exports = { healthRoutes };
