'use strict';

/**
 * api/prospectIntel.js
 *
 * Cloud Function registrations for the Prospect Intel pipeline.
 * Route-level handlers live in routes/prospectIntelRoutes.js.
 *
 * Exports (re-exported by index.js):
 *   onProspectBatchCreated  — Firestore trigger: fans out Cloud Tasks on batch creation
 *   processProspectTask     — Cloud Tasks HTTP handler: enriches a single prospect
 */

const { onRequest }        = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin                = require('firebase-admin');

const { enqueueProspectTask, processOneProspect } = require('../services/prospectIntelService');

// ── onProspectBatchCreated ─────────────────────────────────────────────────────
//
// Fires when a new prospectIntel/{batchId} document is created (status='queued').
// Fans out one Cloud Task per prospect via Google Cloud Tasks REST API.
//
// Prerequisites (one-time setup):
//   gcloud tasks queues create prospect-enrichment --location=us-central1 --project=pathconnect-442522
//
// Required env vars:
//   PROSPECT_TASK_SECRET         — shared secret validated by processProspectTask
//   PROSPECT_TASK_HANDLER_URL    — URL of processProspectTask Cloud Function

exports.onProspectBatchCreated = onDocumentCreated({
    document: 'prospectIntel/{batchId}',
    region:   'us-central1',
    memory:   '256MiB'
}, async (event) => {
    const batchId   = event.params.batchId;
    const batchData = event.data.data();

    if (batchData.status !== 'queued') {
        console.log(`[onProspectBatchCreated] Ignoring batch ${batchId} — status=${batchData.status}`);
        return;
    }

    const prospectIds = batchData.prospectIds || [];
    if (prospectIds.length === 0) {
        console.warn(`[onProspectBatchCreated] Batch ${batchId} has no prospectIds — nothing to enqueue`);
        return;
    }

    console.log(`[onProspectBatchCreated] Batch ${batchId}: fanning out ${prospectIds.length} Cloud Tasks`);

    // Mark batch as processing
    await event.data.ref.update({
        status:              'processing',
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.warn('[onProspectBatchCreated] Status update failed:', err.message));

    // Enqueue one Cloud Task per prospect (parallel fan-out)
    const results = await Promise.allSettled(
        prospectIds.map(pid => enqueueProspectTask(batchId, pid))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    console.log(`[onProspectBatchCreated] Batch ${batchId}: ${succeeded}/${prospectIds.length} tasks enqueued (${failed} failed)`);

    if (failed > 0) {
        const errors = results
            .filter(r => r.status === 'rejected')
            .slice(0, 3)
            .map(r => r.reason?.message)
            .join('; ');
        console.error(`[onProspectBatchCreated] Enqueue errors: ${errors}`);
    }
});

// ── processProspectTask ────────────────────────────────────────────────────────
//
// Called by Cloud Tasks (NOT by the browser) — no CORS needed.
// Validates X-Task-Secret header (shared secret), then delegates to processOneProspect().
// Always returns 200 to prevent Cloud Tasks from retrying on application-level errors.

exports.processProspectTask = onRequest({
    region:         'us-central1',
    memory:         '512MiB',
    timeoutSeconds: 120,
    concurrency:    20,
    maxInstances:   20
}, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate shared secret (Cloud Tasks → Cloud Function auth)
    const taskSecret     = req.headers['x-task-secret'];
    const expectedSecret = process.env.PROSPECT_TASK_SECRET;

    if (!expectedSecret) {
        console.error('[processProspectTask] PROSPECT_TASK_SECRET env var not set');
        return res.status(500).json({ error: 'Task handler not configured' });
    }
    if (taskSecret !== expectedSecret) {
        console.warn('[processProspectTask] Rejected task call — invalid secret');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Parse body (Cloud Tasks sends body as base64-encoded JSON)
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
    }

    const { batchId, prospectId } = body || {};
    if (!batchId || !prospectId) {
        return res.status(400).json({ error: 'batchId and prospectId required' });
    }

    try {
        await processOneProspect(batchId, prospectId);
        return res.json({ success: true, batchId, prospectId });
    } catch (err) {
        console.error(`[processProspectTask] Error: ${batchId}/${prospectId}:`, err.message);
        // Return 200 to prevent Cloud Tasks from retrying — processOneProspect handles its own error state
        return res.status(200).json({ success: false, error: err.message });
    }
});
