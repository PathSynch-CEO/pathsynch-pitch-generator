'use strict';

/**
 * Firestore-triggered Cloud Function that processes async enrichment jobs.
 *
 * Fires when enrichmentJobs/{jobId} is created with status: 'queued'.
 * Processes leads in chunks of 50, updating Firestore progress after each chunk.
 * On completion writes all results to the job document.
 *
 * Memory: 1GB  |  Timeout: 540s  |  Trigger: enrichmentJobs/{jobId} onCreate
 */

const admin = require('firebase-admin');
const { batchEnrichLeads } = require('./geminiLeadEnricher');

const CHUNK_SIZE = 50; // Update progress every N leads

async function processEnrichmentJob(event) {
    const jobId = event.params.jobId;
    const job   = event.data.data();

    // Only process queued jobs (guard against duplicate triggers)
    if (job.status !== 'queued') {
        console.log(`[JobProcessor] Job ${jobId} — status=${job.status}, skipping`);
        return;
    }

    const jobRef = admin.firestore().collection('enrichmentJobs').doc(jobId);

    try {
        // Mark as processing
        await jobRef.update({
            status:    'processing',
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[JobProcessor] Starting job ${jobId}: ${job.totalLeads} leads, concurrency=${job.concurrency}`);

        const allResults    = [];
        let enrichedCount   = 0;
        let failedCount     = 0;

        for (let i = 0; i < job.leads.length; i += CHUNK_SIZE) {
            const chunk = job.leads.slice(i, i + CHUNK_SIZE);

            const { results } = await batchEnrichLeads(chunk, job.concurrency, job.delayBetweenBatches);

            for (const r of results) {
                allResults.push(r);
                if (r.enrichment_status === 'enriched') enrichedCount++;
                else failedCount++;
            }

            // Update progress counters after each chunk (non-blocking on failure)
            await jobRef.update({
                processedCount: allResults.length,
                enrichedCount,
                failedCount
            }).catch(err => console.warn(`[JobProcessor] Progress update failed for ${jobId}:`, err.message));

            console.log(`[JobProcessor] Job ${jobId}: ${allResults.length}/${job.totalLeads} processed`);
        }

        // Mark completed with full results
        await jobRef.update({
            status:         'completed',
            processedCount: allResults.length,
            enrichedCount,
            failedCount,
            results:        allResults,
            completedAt:    admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[JobProcessor] Job ${jobId} completed: ${enrichedCount} enriched, ${failedCount} failed`);

    } catch (err) {
        console.error(`[JobProcessor] Job ${jobId} failed:`, err);
        await jobRef.update({
            status:      'failed',
            error:       err.message,
            completedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.error(`[JobProcessor] Failed to mark job ${jobId} as failed:`, e.message));
    }
}

module.exports = { processEnrichmentJob };
