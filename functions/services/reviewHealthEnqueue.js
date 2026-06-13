'use strict';

/**
 * reviewHealthEnqueue.js — Enqueue review health enrichment tasks.
 *
 * Two-layer idempotency (PRD §Phase 5):
 *   Layer 1 (durable): Firestore transaction flips reviewHealthStatus
 *     from 'not_queued'|'failed' → 'queued'. If already 'queued'/'processing'/'complete' → skip.
 *   Layer 2 (race window): Cloud Tasks named task ID =
 *     'reviewhealth-{batchId}-{prospectId}'. ALREADY_EXISTS = success, not error.
 */

const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');

const GCP_PROJECT  = process.env.PATHSYNCH_GCP_PROJECT || 'pathconnect-442522';
const GCP_LOCATION = 'us-central1';
const TASKS_QUEUE  = 'enrich-reviews';

const TASK_HANDLER_URL = process.env.REVIEW_TASK_HANDLER_URL
    || `https://${GCP_LOCATION}-pathsynch-pitch-creation.cloudfunctions.net/processReviewHealthTask`;

/**
 * Enqueue a single prospect for review health enrichment via Cloud Tasks.
 *
 * @param {string} batchId
 * @param {string} prospectId
 * @returns {Promise<{enqueued: boolean, reason: string}>}
 */
async function enqueueReviewHealthTask(batchId, prospectId) {
    const db          = admin.firestore();
    const prospectRef = db.collection('prospectIntel').doc(batchId)
        .collection('prospects').doc(prospectId);

    // ── Layer 1: Firestore status transition ─────────────────────────────────
    let shouldEnqueue = false;
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(prospectRef);
            if (!snap.exists) {
                shouldEnqueue = false;
                return;
            }

            const currentStatus = snap.data().reviewHealthStatus || 'not_queued';

            // Only enqueue from not_queued or failed
            if (currentStatus === 'not_queued' || currentStatus === 'failed') {
                tx.update(prospectRef, {
                    reviewHealthStatus:    'queued',
                    reviewHealthQueuedAt:  admin.firestore.FieldValue.serverTimestamp(),
                    reviewHealthError:     null,
                });
                shouldEnqueue = true;
            } else {
                // Already queued/processing/complete — skip
                shouldEnqueue = false;
            }
        });
    } catch (err) {
        console.error(`[ReviewHealthEnqueue] Transaction failed for ${prospectId}:`, err.message);
        return { enqueued: false, reason: 'transaction_failed' };
    }

    if (!shouldEnqueue) {
        return { enqueued: false, reason: 'already_in_progress_or_complete' };
    }

    // ── Layer 2: Cloud Tasks with named task ─────────────────────────────────
    try {
        const auth   = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const tokenRes = await client.getAccessToken();
        const token    = tokenRes.token;

        if (!token) throw new Error('Failed to get GCP access token for Cloud Tasks');

        const payload        = { batchId, prospectId };
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');

        // Named task for idempotency (Layer 2)
        const taskName = `reviewhealth-${batchId}-${prospectId}`;
        const queuePath = `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/queues/${TASKS_QUEUE}`;

        const task = {
            name: `${queuePath}/tasks/${taskName}`,
            httpRequest: {
                httpMethod: 'POST',
                url:        TASK_HANDLER_URL,
                headers: {
                    'Content-Type':  'application/json',
                    'X-Task-Secret': process.env.REVIEW_TASK_SECRET || '',
                },
                body: encodedPayload,
            },
        };

        const apiUrl = `https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`;

        const response = await fetch(apiUrl, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ task }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');

            // ALREADY_EXISTS (409) = idempotency success, not an error
            if (response.status === 409) {
                console.log(`[ReviewHealthEnqueue] Task ${taskName} already exists — idempotency OK`);
                return { enqueued: true, reason: 'already_exists' };
            }

            throw new Error(`Cloud Tasks enqueue failed (${response.status}): ${text.substring(0, 300)}`);
        }

        console.log(`[ReviewHealthEnqueue] Enqueued ${taskName}`);
        return { enqueued: true, reason: 'created' };

    } catch (err) {
        console.error(`[ReviewHealthEnqueue] ❌ Enqueue failed for ${prospectId}:`, err.message);

        // Revert status to failed so it can be retried
        await prospectRef.update({
            reviewHealthStatus:   'failed',
            reviewHealthError:    `Enqueue failed: ${err.message.substring(0, 300)}`,
            reviewHealthFailedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(writeErr => {
            console.warn(`[ReviewHealthEnqueue] Status revert failed: ${writeErr.message}`);
        });

        return { enqueued: false, reason: 'enqueue_failed' };
    }
}

module.exports = { enqueueReviewHealthTask };
