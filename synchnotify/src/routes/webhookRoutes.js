/**
 * Webhook Routes
 *
 * Receives external webhooks from providers like Instantly.
 * Per-merchant HMAC validation, reply classification, lead enrichment,
 * replyEvents logging, and SynchNotify event construction for positive replies.
 *
 * POST /api/v1/webhooks/instantly/:tenantId
 *
 * Security model:
 * - tenantId from URL path identifies the merchant
 * - Per-merchant webhook secret from merchantConfig/{tenantId}.instantlyWebhookSecret
 * - HMAC-SHA256 validation with constant-time comparison
 * - 5-minute replay window
 * - Webhook idempotency via Firestore
 *
 * Processing:
 * 1. Validate webhook auth
 * 2. Check idempotency (dedup)
 * 3. Classify reply sentiment
 * 4. Write replyEvents document (all classifications)
 * 5. For positive only: enrich lead, construct event envelope, process event
 * 6. Return 200 quickly (async delivery via Cloud Tasks)
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { webhookAuth } = require('../middleware/webhookAuth');
const { classifyReply, safeSnippet } = require('../services/replyClassifier');
const { enrichLead } = require('../services/leadEnrichment');
const { validateEnvelope, processEvent } = require('../services/eventProcessor');

/**
 * Create webhook routes.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} deps.taskClient - Cloud Tasks client
 * @param {Object} deps.config - { queuePath, serviceUrl }
 * @returns {express.Router}
 */
function webhookRoutes({ db, taskClient, config }) {
    const router = express.Router();
    const authMiddleware = webhookAuth({ db });

    /**
     * POST /api/v1/webhooks/instantly/:tenantId
     *
     * Receives Instantly campaign reply webhooks.
     * Returns 200 quickly — all downstream processing is async.
     */
    router.post('/api/v1/webhooks/instantly/:tenantId', authMiddleware, async (req, res) => {
        const tenantId = req.tenantId;
        const webhookId = req.webhookId;

        try {
            // Extract payload fields from Instantly webhook
            const {
                email,
                reply_text,
                campaign_name,
                campaign_id,
                timestamp: eventTimestamp,
                lead_email,
                from_email
            } = req.body || {};

            const leadEmail = email || lead_email || from_email;
            const replyText = reply_text || '';
            const campaignName = campaign_name || '';

            if (!leadEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing email in webhook payload'
                });
            }

            // Build deterministic idempotency key for this webhook receipt
            const providerWebhookId = webhookId || buildWebhookIdempotencyHash(
                leadEmail, campaignName, replyText, eventTimestamp
            );

            const idempotencyKey = `instantly:${tenantId}:${providerWebhookId}`;

            // Check idempotency — fast duplicate rejection
            const existingDoc = await db.collection('webhookReceipts').doc(idempotencyKey).get();
            if (existingDoc.exists) {
                console.log(`[webhookRoutes] Duplicate webhook receipt: ${idempotencyKey}`);
                return res.status(200).json({
                    success: true,
                    duplicate: true,
                    message: 'Webhook already processed'
                });
            }

            // Write webhook receipt for idempotency
            await db.collection('webhookReceipts').doc(idempotencyKey).set({
                tenantId,
                providerWebhookId,
                source: 'instantly',
                receivedAt: new Date().toISOString(),
                leadEmail,
                campaignName
            });

            // Classify reply sentiment
            const { classification, positiveMatches, negativeMatches } = classifyReply(replyText);

            console.log(`[webhookRoutes] Classified reply from ${leadEmail}: ${classification}` +
                ` (positive: ${positiveMatches.length}, negative: ${negativeMatches.length})`);

            // Write replyEvents document for ALL classifications
            const replyEventRef = db.collection('replyEvents').doc();
            const replyEventId = replyEventRef.id;
            const now = new Date().toISOString();

            const replyEventData = {
                tenantId,
                leadEmail,
                companyName: null, // enriched below for positive
                campaignName,
                replyClassification: classification,
                replySnippet: safeSnippet(replyText),
                webhookReceivedAt: now,
                slackNotificationSentAt: null,
                attioUpdatedAt: null,
                claimedBy: null,
                claimedAt: null,
                responseLatencyMs: null,
                account360Url: null,
                source: 'instantly',
                providerWebhookId,
                synchNotifyEventId: null,
                createdAt: now,
                updatedAt: now
            };

            // For positive classification: enrich and emit SynchNotify event
            if (classification === 'positive') {
                // Enrich lead data (non-blocking — missing data doesn't block alert)
                let enrichment;
                try {
                    enrichment = await enrichLead({ db }, tenantId, leadEmail);
                } catch (enrichErr) {
                    console.error('[webhookRoutes] Lead enrichment failed (non-blocking):', enrichErr.message);
                    enrichment = {
                        companyName: null,
                        contactName: null,
                        contactEmail: leadEmail,
                        industry: null,
                        buyingSignals: [],
                        fitScore: null,
                        accountId: null,
                        account360Url: null
                    };
                }

                // Update replyEvent with enrichment data
                replyEventData.companyName = enrichment.companyName;
                replyEventData.account360Url = enrichment.account360Url;

                // Resolve merchantCode from config
                const merchantCode = req.merchantConfig?.merchantCode ||
                    req.merchantConfig?.entity360MerchantId || null;

                // Build SynchNotify event envelope
                const eventEnvelope = {
                    tenantId,
                    identitySpace: 'firebase',
                    merchantCode,
                    source: 'synchintro',
                    eventType: 'positive_reply',
                    priority: 'high',
                    payload: {
                        replyEventId,
                        companyName: enrichment.companyName || 'Unknown Company',
                        contactName: enrichment.contactName || null,
                        contactEmail: enrichment.contactEmail || leadEmail,
                        industry: enrichment.industry || null,
                        buyingSignals: enrichment.buyingSignals || [],
                        fitScore: enrichment.fitScore ?? null,
                        replySnippet: safeSnippet(replyText),
                        campaignName,
                        account360Url: enrichment.account360Url || null,
                        receivedAt: now
                    },
                    timestamp: now,
                    idempotencyKey: `instantly-reply:${providerWebhookId}`,
                    version: '1.0'
                };

                // Validate envelope against S1 schema
                const validation = validateEnvelope(eventEnvelope);
                if (!validation.valid) {
                    console.error('[webhookRoutes] Event envelope validation failed:', validation.errors);
                    // Still write replyEvent, but skip event processing
                    await replyEventRef.set(replyEventData);
                    return res.status(200).json({
                        success: true,
                        classification,
                        replyEventId,
                        eventEmitted: false,
                        reason: 'Envelope validation failed'
                    });
                }

                // Process event internally (same pipeline as POST /api/v1/events)
                const scopedKey = `firebase:synchintro:${tenantId}:${eventEnvelope.idempotencyKey}`;

                try {
                    const eventResult = await processEvent(
                        { db, taskClient, config },
                        eventEnvelope,
                        scopedKey
                    );

                    replyEventData.synchNotifyEventId = eventResult.eventId;
                    console.log(`[webhookRoutes] Event emitted: ${eventResult.eventId} for ${leadEmail}`);
                } catch (eventErr) {
                    console.error('[webhookRoutes] Event processing failed (non-blocking):', eventErr.message);
                    // Still write replyEvent — event failure doesn't block logging
                }
            } else {
                // Negative or ambiguous — log but do not emit Slack event
                console.log(`[webhookRoutes] Skipping Slack for ${classification} reply from ${leadEmail}`);
            }

            // Write replyEvents document
            await replyEventRef.set(replyEventData);

            // Return 200 quickly
            return res.status(200).json({
                success: true,
                classification,
                replyEventId,
                eventEmitted: classification === 'positive',
                slackSkipped: classification !== 'positive'
            });

        } catch (error) {
            console.error('[webhookRoutes] Webhook processing error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Internal processing error'
            });
        }
    });

    return router;
}

/**
 * Build a deterministic hash for webhook dedup when no provider webhook ID exists.
 * Uses email + campaign + reply text + timestamp to create a unique fingerprint.
 */
function buildWebhookIdempotencyHash(email, campaign, replyText, timestamp) {
    const input = [
        email || '',
        campaign || '',
        (replyText || '').substring(0, 200),
        timestamp || ''
    ].join('|');

    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
}

module.exports = { webhookRoutes, buildWebhookIdempotencyHash };
