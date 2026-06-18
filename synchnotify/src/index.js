/**
 * SynchNotify — Cloud Run Service Entry Point
 *
 * Unified event router and notification engine for PathSynch products.
 * Phase 1: Event ingestion, HMAC auth, idempotency, Cloud Task delivery skeleton.
 */

const express = require('express');
const admin = require('firebase-admin');
const { CloudTasksClient } = require('@google-cloud/tasks');

const { healthRoutes } = require('./routes/healthRoutes');
const { eventRoutes } = require('./routes/eventRoutes');
const { internalRoutes } = require('./routes/internalRoutes');
const { hmacAuth } = require('./middleware/hmacAuth');
const { idempotency } = require('./middleware/idempotency');

// Initialize Firebase Admin SDK
// In Cloud Run, this uses Application Default Credentials.
// Firestore project: pathsynch-pitch-creation
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.FIRESTORE_PROJECT_ID || 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

// Initialize Cloud Tasks client
// Will be null if not configured (dev environment)
let taskClient = null;
try {
    taskClient = new CloudTasksClient();
} catch (error) {
    console.warn('[SynchNotify] Cloud Tasks client initialization failed:', error.message);
}

// Cloud Tasks configuration
const config = {
    queuePath: process.env.CLOUD_TASKS_QUEUE_PATH || null,
    serviceUrl: process.env.SYNCHNOTIFY_SERVICE_URL || 'http://localhost:8080'
};

// Create Express app
const app = express();

// Raw body capture for HMAC signature verification
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Mount routes
app.use(healthRoutes({ db }));
app.use(eventRoutes({
    db,
    taskClient,
    config,
    hmacMiddleware: hmacAuth(),
    idempotencyMiddleware: idempotency({ db })
}));
app.use(internalRoutes({ db }));

// Start server
const PORT = process.env.PORT || 8080;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SynchNotify] Listening on port ${PORT}`);
        console.log(`[SynchNotify] Firestore project: ${process.env.FIRESTORE_PROJECT_ID || 'pathsynch-pitch-creation'}`);
        console.log(`[SynchNotify] Cloud Tasks queue: ${config.queuePath || 'not configured'}`);
    });
}

module.exports = { app, db };
