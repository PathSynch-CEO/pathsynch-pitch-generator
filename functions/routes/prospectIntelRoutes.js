/**
 * Prospect Intel Routes — M1-2: Enrichment Pipeline
 *
 * POST /prospect-intel/batch                                   — create batch, fan out Cloud Tasks
 * GET  /prospect-intel/batches                                 — list user's recent batches
 * GET  /prospect-intel/batch/:batchId                          — batch status + progress
 * GET  /prospect-intel/batch/:batchId/prospects                — paginated prospect list
 * POST /prospect-intel/batch/:batchId/rescore                  — rescore enriched prospects with new ICP
 * POST /prospect-intel/batch/:batchId/prospect/:pid/retry      — retry failed / low-confidence prospect
 * POST /prospect-intel/batch/:batchId/send-to-nemoclaw         — send selected prospects to NemoClaw
 *
 * Firestore schema:
 *   prospectIntel/{batchId}                    — batch metadata + progress
 *   prospectIntel/{batchId}/prospects/{pid}    — individual prospect (CSV + agent + scoring)
 *   icpProfiles/{profileId}                    — ICP profiles (seeded by frontend M1-1)
 *   creditLedger/{idempotencyKey}              — credit audit trail
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const {
    deductProspectCredits,
    calculateFitScore,
    classifyRecommendedProduct,
    processOneProspect,
    sendProspectsToNemoClaw,
} = require('../services/prospectIntelService');

const router = createRouter();
const db     = admin.firestore();

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
}

// ── POST /prospect-intel/batch ─────────────────────────────────────────────────
//
// Body: { rows: object[], mappings: object, icpProfileId: string, productFocus: string }
//
// Creates:
//   1. N prospect subdocs with enrichmentStatus: 'pending'
//   2. Batch doc with status: 'queued'  ← triggers onProspectBatchCreated Firestore function
//
// Returns: { success, batchId, totalProspects }

router.post('/prospect-intel/batch', requireAuth, async (req, res) => {
    const { rows, mappings, icpProfileId, productFocus } = req.body;
    const userId = req.userId;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'rows array required' });
    }
    if (!mappings || !mappings.companyName) {
        return res.status(400).json({ success: false, error: 'mappings.companyName required' });
    }
    if (rows.length > 500) {
        return res.status(400).json({ success: false, error: 'Maximum 500 prospects per batch' });
    }

    // F-033: active batch limit
    const MAX_ACTIVE = parseInt(process.env.MAX_ACTIVE_BATCHES_PER_USER) || 5;
    try {
        const activeSnap = await db.collection('prospectIntel')
            .where('userId', '==', userId)
            .where('status', 'in', ['queued', 'processing'])
            .get();

        if (activeSnap.size >= MAX_ACTIVE) {
            return res.status(429).json({
                success: false,
                error: `Maximum ${MAX_ACTIVE} active batches per user. Wait for existing batches to complete.`,
                activeBatches: activeSnap.size,
            });
        }
    } catch (limitErr) {
        // Non-blocking — allow batch creation if limit check fails
        console.warn('[ProspectIntelRoutes] Active batch limit check failed (allowing):', limitErr.message);
    }

    try {
        // ── Load ICP profile ──────────────────────────────────────────────────
        let icpProfile = null;
        const resolvedIcpId = icpProfileId || 'default-smb';
        if (resolvedIcpId) {
            const icpDoc = await db.collection('icpProfiles').doc(resolvedIcpId).get();
            if (icpDoc.exists) {
                icpProfile = { id: icpDoc.id, ...icpDoc.data() };
            }
        }

        // ── Map CSV rows to prospect docs ─────────────────────────────────────
        const prospects = [];
        for (const row of rows) {
            const mapped = {};
            for (const [field, col] of Object.entries(mappings)) {
                if (col && row[col] !== undefined) {
                    mapped[field] = String(row[col] || '').trim();
                }
            }
            if (mapped.companyName) {
                mapped._productFocus = productFocus || 'auto';
                prospects.push(mapped);
            }
        }

        if (prospects.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid prospects after mapping (companyName required in every row)' });
        }

        // ── Create Firestore documents ────────────────────────────────────────
        const batchRef   = db.collection('prospectIntel').doc();
        const batchId    = batchRef.id;
        const prospectIds = [];

        // Firestore WriteBatch limit = 500 ops. Leave one slot for the batch doc itself.
        const CHUNK_SIZE = 499;
        for (let i = 0; i < prospects.length; i += CHUNK_SIZE) {
            const chunk         = prospects.slice(i, i + CHUNK_SIZE);
            const firestoreBatch = db.batch();

            for (const prospect of chunk) {
                const pRef = batchRef.collection('prospects').doc();
                prospectIds.push(pRef.id);
                firestoreBatch.set(pRef, {
                    ...prospect,
                    batchId,
                    userId,
                    enrichmentStatus: 'pending',
                    workflowStatus:   'needs_review',
                    retryCount:       0,
                    createdAt:        admin.firestore.FieldValue.serverTimestamp()
                });
            }

            await firestoreBatch.commit();
        }

        // ── Write batch doc AFTER prospects (triggers Firestore function) ──────
        await batchRef.set({
            userId,
            status:             'queued',
            totalProspects:     prospects.length,
            completedCount:     0,
            failedCount:        0,
            currentProspect:    null,
            icpProfileId:       resolvedIcpId,
            icpProfileSnapshot: icpProfile,    // snapshot so rescore uses consistent profile
            productFocus:       productFocus || 'auto',
            prospectIds,                        // consumed by Firestore trigger fan-out
            createdAt:          admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:          admin.firestore.FieldValue.serverTimestamp()
        });

        // ── Deduct credits (non-blocking, idempotent) ─────────────────────────
        deductProspectCredits(userId, prospects.length, batchId).catch(err => {
            console.warn('[ProspectIntelRoutes] Credit deduction error (non-blocking):', err.message);
        });

        console.log(`[ProspectIntelRoutes] Created batch ${batchId} with ${prospects.length} prospects for ${userId}`);

        return res.json({
            success:        true,
            batchId,
            totalProspects: prospects.length,
            message:        `Batch created — enriching ${prospects.length} prospect${prospects.length === 1 ? '' : 's'}…`
        });

    } catch (err) {
        console.error('[ProspectIntelRoutes] POST /prospect-intel/batch error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /prospect-intel/batches ────────────────────────────────────────────────

router.get('/prospect-intel/batches', requireAuth, async (req, res) => {
    try {
        const snap = await db.collection('prospectIntel')
            .where('userId', '==', req.userId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const batches = snap.docs.map(doc => _serializeBatch(doc));
        return res.json({ success: true, batches });

    } catch (err) {
        console.error('[ProspectIntelRoutes] GET /prospect-intel/batches error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /prospect-intel/batch/:batchId ────────────────────────────────────────

router.get('/prospect-intel/batch/:batchId', requireAuth, async (req, res) => {
    try {
        const { batchId } = req.params;
        const doc = await db.collection('prospectIntel').doc(batchId).get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }
        if (doc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        return res.json({ success: true, batch: _serializeBatch(doc) });

    } catch (err) {
        console.error('[ProspectIntelRoutes] GET /prospect-intel/batch/:batchId error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /prospect-intel/batch/:batchId/prospects ──────────────────────────────
//
// Query params: status (filter), limit (max 200, default 50), startAfter (cursor prospectId)

router.get('/prospect-intel/batch/:batchId/prospects', requireAuth, async (req, res) => {
    try {
        const { batchId }  = req.params;
        const { status, limit: limitStr, startAfter } = req.query;
        const pageSize     = Math.min(parseInt(limitStr) || 50, 200);

        // Auth check via batch ownership
        const batchDoc = await db.collection('prospectIntel').doc(batchId).get();
        if (!batchDoc.exists || batchDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let query = db.collection('prospectIntel').doc(batchId)
            .collection('prospects')
            .orderBy('createdAt', 'asc')
            .limit(pageSize);

        if (status) {
            query = query.where('enrichmentStatus', '==', status);
        }

        if (startAfter) {
            const cursorDoc = await db.collection('prospectIntel').doc(batchId)
                .collection('prospects').doc(startAfter).get();
            if (cursorDoc.exists) {
                query = query.startAfter(cursorDoc);
            }
        }

        const snap      = await query.get();
        const prospects = snap.docs.map(doc => _serializeProspect(doc));

        return res.json({
            success:    true,
            prospects,
            hasMore:    snap.docs.length === pageSize,
            nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null
        });

    } catch (err) {
        console.error('[ProspectIntelRoutes] GET /prospect-intel/batch/:batchId/prospects error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /prospect-intel/batch/:batchId/rescore ───────────────────────────────
//
// Body: { icpProfileId: string }
//
// Re-scores all enriched prospects without re-running agent enrichment.
// Updates batch icpProfileId + icpProfileSnapshot.

router.post('/prospect-intel/batch/:batchId/rescore', requireAuth, async (req, res) => {
    const { batchId }    = req.params;
    const { icpProfileId } = req.body;

    try {
        const batchDoc = await db.collection('prospectIntel').doc(batchId).get();
        if (!batchDoc.exists || batchDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Load new ICP profile
        let icpProfile = null;
        const resolvedIcpId = icpProfileId || batchDoc.data().icpProfileId || 'default-smb';
        const icpDoc = await db.collection('icpProfiles').doc(resolvedIcpId).get();
        if (icpDoc.exists) {
            icpProfile = { id: icpDoc.id, ...icpDoc.data() };
        }

        // Load all enriched prospects
        const prospectsSnap = await db.collection('prospectIntel').doc(batchId)
            .collection('prospects')
            .where('enrichmentStatus', '==', 'enriched')
            .get();

        if (prospectsSnap.empty) {
            return res.json({ success: true, rescored: 0, message: 'No enriched prospects to rescore' });
        }

        // Rescore in batches of 499
        const CHUNK_SIZE = 499;
        const docs       = prospectsSnap.docs;
        let rescored     = 0;

        for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
            const chunk          = docs.slice(i, i + CHUNK_SIZE);
            const firestoreBatch = db.batch();

            for (const doc of chunk) {
                const d = doc.data();

                // Reconstruct agentData from stored attribution objects
                const agentData = {
                    googleRating:  d.googleRating?.value,
                    totalReviews:  d.totalReviews?.value,
                    websiteUrl:    d.websiteUrl?.value,
                    address:       d.address?.value,
                    industry:      d.industry?.value,
                    prospectBusiness: d.prospectBusiness?.value,
                };
                const csvData = {
                    contactTitle: d.contactTitle,
                    city:         d.city,
                    state:        d.state,
                };

                const fitResult          = calculateFitScore(agentData, csvData, icpProfile);
                const recommendedProduct = classifyRecommendedProduct(agentData, d._productFocus || 'auto');

                firestoreBatch.update(doc.ref, {
                    fitScore:         fitResult.fitScore,
                    fitLabel:         fitResult.fitLabel,
                    disqualified:     fitResult.disqualified,
                    disqualifyReason: fitResult.disqualifyReason || null,
                    signalHits:       fitResult.signalHits,
                    recommendedProduct,
                    rescoredAt:       admin.firestore.FieldValue.serverTimestamp()
                });
                rescored++;
            }

            await firestoreBatch.commit();
        }

        // Update batch with new ICP
        await db.collection('prospectIntel').doc(batchId).update({
            icpProfileId:       resolvedIcpId,
            icpProfileSnapshot: icpProfile,
            updatedAt:          admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[ProspectIntelRoutes] Rescored ${rescored} prospects in batch ${batchId} with ICP ${resolvedIcpId}`);
        return res.json({ success: true, rescored, message: `Rescored ${rescored} prospect${rescored === 1 ? '' : 's'} with updated ICP` });

    } catch (err) {
        console.error('[ProspectIntelRoutes] POST /prospect-intel/batch/:batchId/rescore error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /prospect-intel/batch/:batchId/prospect/:pid/retry ──────────────────
//
// Retries a single failed or low-confidence prospect (max 2 retries).
// Runs enrichment synchronously and returns the updated status.

router.post('/prospect-intel/batch/:batchId/prospect/:pid/retry', requireAuth, async (req, res) => {
    const { batchId, pid } = req.params;

    try {
        const batchDoc = await db.collection('prospectIntel').doc(batchId).get();
        if (!batchDoc.exists || batchDoc.data().userId !== req.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const prospectRef = db.collection('prospectIntel').doc(batchId)
            .collection('prospects').doc(pid);
        const prospectDoc = await prospectRef.get();

        if (!prospectDoc.exists) {
            return res.status(404).json({ success: false, error: 'Prospect not found' });
        }

        const d = prospectDoc.data();

        if ((d.retryCount || 0) >= 2) {
            return res.status(400).json({ success: false, error: 'Maximum 2 retries reached for this prospect' });
        }

        // Reset to pending so processOneProspect can run
        await prospectRef.update({
            enrichmentStatus: 'pending',
            enrichmentError:  null,
            enrichmentFailedAt: null
        });

        // Also fix the batch counter (decrement failedCount since we're retrying)
        if (d.enrichmentStatus === 'failed') {
            await db.collection('prospectIntel').doc(batchId).update({
                failedCount: admin.firestore.FieldValue.increment(-1),
                status:      'processing'
            });
        }

        // Process inline (synchronous retry — result returned in response)
        await processOneProspect(batchId, pid);

        const updated = await prospectRef.get();
        return res.json({
            success:         true,
            prospectId:      pid,
            enrichmentStatus: updated.data().enrichmentStatus,
            fitScore:        updated.data().fitScore,
            fitLabel:        updated.data().fitLabel
        });

    } catch (err) {
        console.error('[ProspectIntelRoutes] POST retry error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /prospect-intel/batch/:batchId/enrich-reviews ────────────────────────
//
// Manual review health enrichment for selected prospects.
// Body: { prospectIds: string[] }
// Billing: preflight check only — task handler (PR #20) deducts credits.
// Daily cap shared with Phase B auto-selection.

router.post('/prospect-intel/batch/:batchId/enrich-reviews', requireAuth, async (req, res) => {
    const { batchId } = req.params;
    const { prospectIds } = req.body;
    const userId = req.userId;

    // Feature flag
    if (process.env.ENABLE_REVIEW_HEALTH_ENRICHMENT !== 'true') {
        return res.status(409).json({ success: false, error: 'Review health enrichment is not enabled' });
    }

    // Validation
    if (!Array.isArray(prospectIds) || prospectIds.length === 0) {
        return res.status(400).json({ success: false, error: 'prospectIds array required' });
    }
    if (prospectIds.length > 50) {
        return res.status(400).json({ success: false, error: 'Maximum 50 prospects per enrich-reviews request' });
    }

    try {
        // Owner check
        const batchDoc = await db.collection('prospectIntel').doc(batchId).get();
        if (!batchDoc.exists || batchDoc.data().userId !== userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Billing preflight — check only, do NOT deduct
        const { checkCredits } = require('../api/billing');
        const creditCheck = await checkCredits(userId, prospectIds.length * 10);
        if (!creditCheck.allowed) {
            return res.status(402).json({
                success: false,
                error: 'insufficient_credits',
                required: prospectIds.length * 10,
                available: creditCheck.available,
            });
        }

        // Daily cap check
        const today      = new Date().toISOString().slice(0, 10);
        const counterRef = db.collection('reviewHealthDailyCounters').doc(today);
        const counterSnap = await counterRef.get();
        const currentDaily = counterSnap.exists ? (counterSnap.data().count || 0) : 0;
        const dailyMax     = parseInt(process.env.REVIEW_HEALTH_DAILY_MAX_PROSPECTS) || 500;

        if (currentDaily + prospectIds.length > dailyMax) {
            return res.status(429).json({
                success: false,
                error: 'daily_cap_reached',
                currentCount: currentDaily,
                dailyMax,
            });
        }

        // Enqueue each prospect with atomic status transition + daily counter
        const { enqueueReviewHealthTask } = require('../services/reviewHealthEnqueue');
        let queued = 0;
        let skipped = 0;

        for (const pid of prospectIds) {
            try {
                // Atomic: daily counter + status flip
                let enqueueOk = false;
                await db.runTransaction(async (t) => {
                    const cSnap = await t.get(counterRef);
                    const cnt   = cSnap.exists ? (cSnap.data().count || 0) : 0;
                    if (cnt >= dailyMax) return;

                    const pRef  = db.collection('prospectIntel').doc(batchId)
                        .collection('prospects').doc(pid);
                    const pSnap = await t.get(pRef);
                    if (!pSnap.exists) return;

                    const status = pSnap.data().reviewHealthStatus || 'not_queued';
                    if (status !== 'not_queued' && status !== 'failed') return;

                    if (cSnap.exists) {
                        t.update(counterRef, { count: cnt + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                    } else {
                        t.set(counterRef, { count: 1, date: today, createdAt: admin.firestore.FieldValue.serverTimestamp() });
                    }
                    t.update(pRef, {
                        reviewHealthStatus:   'queued',
                        reviewHealthQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    enqueueOk = true;
                });

                if (enqueueOk) {
                    await enqueueReviewHealthTask(batchId, pid).catch(() => {});
                    queued++;
                } else {
                    skipped++;
                }
            } catch (txErr) {
                console.warn(`[EnrichReviews] Transaction failed for ${pid}:`, txErr.message);
                skipped++;
            }
        }

        return res.json({ success: true, queued, skipped, total: prospectIds.length });

    } catch (err) {
        console.error('[ProspectIntelRoutes] POST enrich-reviews error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /prospect-intel/batch/:batchId/send-to-nemoclaw ─────────────────────
//
// Body: { prospectIds: string[], options?: object }
//
// Calls sendProspectsToNemoClaw() service function which:
//   1. Reads approved prospect docs from Firestore
//   2. Builds NemoClaw payload and POSTs to PathManager
//   3. Marks each prospect workflowStatus: 'sent_to_nemoclaw'
//
// Returns: { success, sentCount, nemoClawBatchId }

router.post('/prospect-intel/batch/:batchId/send-to-nemoclaw', requireAuth, async (req, res) => {
    const { batchId } = req.params;
    const userId = req.userId;
    const { prospectIds, options } = req.body;

    if (!Array.isArray(prospectIds) || prospectIds.length === 0) {
        return res.status(400).json({ success: false, error: 'prospectIds array required' });
    }

    try {
        const batchDoc = await db.collection('prospectIntel').doc(batchId).get();
        if (!batchDoc.exists || batchDoc.data().userId !== userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await sendProspectsToNemoClaw(batchId, prospectIds, userId, options || {});
        return res.status(200).json({ success: true, ...result });

    } catch (err) {
        console.error('[ProspectIntelRoutes] POST send-to-nemoclaw error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Serialization helpers ──────────────────────────────────────────────────────

function _serializeBatch(doc) {
    const d = doc.data();
    return {
        batchId:        doc.id,
        status:         d.status,
        totalProspects: d.totalProspects,
        completedCount: d.completedCount,
        failedCount:    d.failedCount,
        currentProspect: d.currentProspect || null,
        icpProfileId:   d.icpProfileId,
        productFocus:   d.productFocus,
        createdAt:      d.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt:      d.updatedAt?.toDate?.()?.toISOString() || null,
        completedAt:    d.completedAt?.toDate?.()?.toISOString() || null,
    };
}

function _serializeProspect(doc) {
    const d = doc.data();
    return {
        prospectId:       doc.id,
        // CSV fields (direct)
        companyName:      d.companyName,
        contactFirstName: d.contactFirstName,
        contactLastName:  d.contactLastName,
        contactEmail:     d.contactEmail,
        contactTitle:     d.contactTitle,
        contactLinkedIn:  d.contactLinkedIn,
        companyDomain:    d.companyDomain,
        city:             d.city,
        state:            d.state,
        // Agent-enriched (source attribution objects)
        prospectBusiness: d.prospectBusiness,
        websiteUrl:       d.websiteUrl,
        industry:         d.industry,
        subIndustry:      d.subIndustry,
        address:          d.address,
        phone:            d.phone,
        googleRating:     d.googleRating,
        totalReviews:     d.totalReviews,
        tagline:          d.tagline,
        topProducts:      d.topProducts,
        differentiators:  d.differentiators,
        targetCustomer:   d.targetCustomer,
        // Qualification
        fitScore:          d.fitScore,
        fitLabel:          d.fitLabel,
        disqualified:      d.disqualified,
        disqualifyReason:  d.disqualifyReason,
        signalHits:        d.signalHits,
        recommendedProduct: d.recommendedProduct,
        // Status
        enrichmentStatus:  d.enrichmentStatus,
        workflowStatus:    d.workflowStatus,
        agentConfidence:   d.agentConfidence,
        retryCount:        d.retryCount,
        enrichmentError:   d.enrichmentError,
        createdAt:         d.createdAt?.toDate?.()?.toISOString() || null,
        enrichmentCompletedAt: d.enrichmentCompletedAt?.toDate?.()?.toISOString() || null,
    };
}

module.exports = router;
