'use strict';

/**
 * api/reviewHealthTask.js
 *
 * Cloud Function: processReviewHealthTask
 * 2nd Gen HTTP handler called by Cloud Tasks (enrich-reviews queue).
 *
 * Sequence per PRD §4B:
 *   1. Validate X-Task-Secret
 *   2. Parse { batchId, prospectId }
 *   3. Status guard (reviewHealthStatus !== 'queued' → skip)
 *   4. Cache check → short-circuit on hit
 *   5. Atomic credit deduction (10 credits)
 *   6. Outscraper fetch
 *   7. Analyze review health
 *   8. Write result + cache + usage log
 *   9. Always return 200 on application paths (C-7)
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin         = require('firebase-admin');

const { fetchReviews }                            = require('../services/outscraperClient');
const { analyzeReviewHealth }                     = require('../services/tools/reviewHealthAnalyzer');
const { getReviewHealth, setReviewHealth }         = require('../services/enrichmentCache');
const { checkAndDeductCredits, refundCredits }     = require('./billing');
const { buildSourceAttribution }                   = require('../services/prospectIntelService');

const CREDITS_PER_ENRICHMENT = 10;

// ── Cloud Function Export ────────────────────────────────────────────────────

exports.processReviewHealthTask = onRequest({
    region:         'us-central1',
    memory:         '512MiB',
    timeoutSeconds: 120,
    concurrency:    10,
    maxInstances:   10,
}, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── 1. Validate task secret ──────────────────────────────────────────────
    const taskSecret     = req.headers['x-task-secret'];
    const expectedSecret = process.env.REVIEW_TASK_SECRET;

    if (!expectedSecret) {
        console.error('[ReviewHealthTask] REVIEW_TASK_SECRET env var not set');
        return res.status(500).json({ error: 'Task handler not configured' });
    }
    if (taskSecret !== expectedSecret) {
        console.warn('[ReviewHealthTask] Rejected — invalid secret');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── 2. Parse payload ─────────────────────────────────────────────────────
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

    const db          = admin.firestore();
    const prospectRef = db.collection('prospectIntel').doc(batchId)
        .collection('prospects').doc(prospectId);
    const batchRef    = db.collection('prospectIntel').doc(batchId);

    // Task name for usage logging
    const taskName = `reviewhealth-${batchId}-${prospectId}`;

    try {
        // ── 3. Read prospect + status guard ──────────────────────────────────
        const prospectDoc = await prospectRef.get();
        if (!prospectDoc.exists) {
            console.warn(`[ReviewHealthTask] Prospect ${prospectId} not found in batch ${batchId}`);
            return res.json({ success: false, reason: 'prospect_not_found' });
        }

        const prospect = prospectDoc.data();

        if (prospect.reviewHealthStatus && prospect.reviewHealthStatus !== 'queued') {
            console.log(`[ReviewHealthTask] ${prospectId} status=${prospect.reviewHealthStatus} — skipping`);
            return res.json({ success: true, reason: 'already_processed' });
        }

        // ── 4. Set processing ────────────────────────────────────────────────
        await prospectRef.update({
            reviewHealthStatus:    'processing',
            reviewHealthStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Read batch for userId
        const batchDoc  = await batchRef.get();
        const batchData = batchDoc.exists ? batchDoc.data() : {};
        const userId    = prospect.userId || batchData.userId;

        // Build cache key params
        const placeId      = _extractPlaceId(prospect);
        const businessName = prospect.companyName || '';
        const city         = prospect.city  || '';
        const state        = prospect.state || '';
        const cacheKeyParams = { placeId, businessName, city, state };

        // ── 5. Cache check ───────────────────────────────────────────────────
        try {
            const cached = await getReviewHealth(cacheKeyParams);
            if (cached) {
                console.log(`[ReviewHealthTask] Cache HIT for ${businessName}`);

                // Write cached result to prospect doc
                await prospectRef.update({
                    reviewHealth: buildSourceAttribution(cached, 'cache', 'medium'),
                    reviewHealthStatus:      'complete',
                    reviewHealthCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Usage log — cache hit, no credits
                await _writeUsageLog(db, {
                    userId, batchId, prospectId,
                    status: 'cache_hit', cached: true,
                    creditsCharged: 0, reviewsFetched: 0, taskName,
                });

                // Increment batch counter
                await _incrementReviewEnrichedCount(batchRef);

                return res.json({ success: true, reason: 'cache_hit' });
            }
        } catch (cacheErr) {
            console.warn('[ReviewHealthTask] Cache read error (continuing):', cacheErr.message);
        }

        // ── 6. Atomic credit deduction ───────────────────────────────────────
        const idempotencyKey = `reviewhealth:${batchId}:${prospectId}`;
        const creditResult = await checkAndDeductCredits(
            userId, CREDITS_PER_ENRICHMENT, 'review_health',
            { service: 'review_health' }
        );

        if (creditResult.error === 'BILLING_TRANSACTION_FAILED') {
            await _failProspect(prospectRef, 'failed', 'billing_transaction_failed');
            await _writeUsageLog(db, {
                userId, batchId, prospectId,
                status: 'billing_failed', cached: false,
                creditsCharged: 0, reviewsFetched: 0, taskName,
            });
            return res.json({ success: false, reason: 'billing_transaction_failed' });
        }

        if (!creditResult.allowed) {
            await _failProspect(prospectRef, 'credit_blocked', 'insufficient_credits');
            await _writeUsageLog(db, {
                userId, batchId, prospectId,
                status: 'credit_blocked', cached: false,
                creditsCharged: 0, reviewsFetched: 0, taskName,
            });
            return res.json({ success: false, reason: 'credit_blocked' });
        }

        // ── 7. Outscraper fetch ──────────────────────────────────────────────
        const query = placeId || `${businessName}, ${city}, ${state}`;
        const outscraperResult = await fetchReviews(query, { reviewsLimit: 100, sort: 'newest' });

        if (!outscraperResult.success) {
            console.error(`[ReviewHealthTask] Outscraper failed for ${businessName}: ${outscraperResult.error}`);
            // Refund credits on Outscraper failure
            await refundCredits(userId, CREDITS_PER_ENRICHMENT, 'review_health:outscraper_failure', { service: 'review_health' });

            await _failProspect(prospectRef, 'failed', outscraperResult.error);
            await _writeUsageLog(db, {
                userId, batchId, prospectId,
                status: 'failed', cached: false,
                creditsCharged: 0, reviewsFetched: 0, taskName,
            });

            // Cache failure (3d TTL)
            await setReviewHealth(cacheKeyParams, null, false).catch(() => {});

            return res.json({ success: false, reason: 'outscraper_failed' });
        }

        const reviews = outscraperResult.data || [];

        // ── 8. Analyze ───────────────────────────────────────────────────────
        const analysis = analyzeReviewHealth(reviews, new Date());

        if (analysis.status === 'insufficient_data') {
            // Still charged — Outscraper call was made. No refund for insufficient data.
            await prospectRef.update({
                reviewHealth: buildSourceAttribution(analysis, 'outscraper_reviews', 'low'),
                reviewHealthStatus:      'insufficient_data',
                reviewHealthCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            await _writeUsageLog(db, {
                userId, batchId, prospectId,
                status: 'insufficient_data', cached: false,
                creditsCharged: CREDITS_PER_ENRICHMENT,
                reviewsFetched: reviews.length, taskName,
            });

            // Cache insufficient_data result (success TTL — data won't change soon)
            await setReviewHealth(cacheKeyParams, analysis, true).catch(() => {});
            await _incrementReviewEnrichedCount(batchRef);

            return res.json({ success: true, reason: 'insufficient_data' });
        }

        // ── 9. Write result ──────────────────────────────────────────────────
        await prospectRef.update({
            reviewHealth: buildSourceAttribution(analysis, 'outscraper_reviews', 'high'),
            reviewHealthStatus:      'complete',
            reviewHealthCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // ── 10. Cache success ────────────────────────────────────────────────
        await setReviewHealth(cacheKeyParams, analysis, true).catch(() => {});

        // ── 11. Usage log ────────────────────────────────────────────────────
        await _writeUsageLog(db, {
            userId, batchId, prospectId,
            status: 'success', cached: false,
            creditsCharged: CREDITS_PER_ENRICHMENT,
            reviewsFetched: reviews.length, taskName,
        });

        // ── 12. Increment batch counter ──────────────────────────────────────
        await _incrementReviewEnrichedCount(batchRef);

        console.log(`[ReviewHealthTask] ✅ ${businessName} — grade=${analysis.reviewHealthGrade}, responseRate=${analysis.responseRate}`);
        return res.json({ success: true, reason: 'enriched' });

    } catch (err) {
        console.error(`[ReviewHealthTask] ❌ Unhandled error for ${batchId}/${prospectId}:`, err.message);
        await _failProspect(prospectRef, 'failed', err.message).catch(() => {});
        // Always return 200 (C-7 task-handler semantics)
        return res.status(200).json({ success: false, error: err.message });
    }
});

// ── Internal Helpers ─────────────────────────────────────────────────────────

function _extractPlaceId(prospect) {
    // Check various locations where placeId might be stored
    if (prospect.placeId) return prospect.placeId;
    if (prospect.googleRating?.value?.placeId) return prospect.googleRating.value.placeId;
    const addr = prospect.address;
    if (addr && typeof addr === 'object' && addr.value?.placeId) return addr.value.placeId;
    return null;
}

async function _failProspect(prospectRef, status, reason) {
    try {
        await prospectRef.update({
            reviewHealthStatus:   status,
            reviewHealthFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            reviewHealthError:    (reason || '').substring(0, 500),
        });
    } catch (err) {
        console.warn('[ReviewHealthTask] Failed to update prospect status:', err.message);
    }
}

async function _writeUsageLog(db, entry) {
    try {
        await db.collection('outscraperUsageLog').add({
            ...entry,
            provider:  'outscraper',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.warn('[ReviewHealthTask] Usage log write failed (non-blocking):', err.message);
    }
}

async function _incrementReviewEnrichedCount(batchRef) {
    try {
        await batchRef.update({
            reviewEnrichedCount: admin.firestore.FieldValue.increment(1),
            updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.warn('[ReviewHealthTask] Batch counter update failed (non-blocking):', err.message);
    }
}
