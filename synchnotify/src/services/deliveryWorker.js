/**
 * Delivery Worker
 *
 * Processes events from Cloud Tasks. Routes to provider(s) based on
 * merchant notification preferences.
 *
 * S2: Routes positive_reply events to Slack provider.
 * S3: Updates replyEvents.slackNotificationSentAt after successful Slack delivery.
 * On failure after max attempts, writes to deadLetterEvents collection.
 */

const { CLOUD_TASK_MAX_ATTEMPTS } = require('../config/constants');
const slackProvider = require('../providers/slack/slackProvider');
const {
    CONSECUTIVE_FAILURE_DEGRADED,
    CONSECUTIVE_FAILURE_FAILED
} = require('../routes/configRoutes');

/**
 * Process a delivery event.
 *
 * 1. Load merchant config by tenantId
 * 2. Check Slack connected + enabled
 * 3. Resolve eligible channels for this event type
 * 4. Format and deliver to each channel
 * 5. Write notificationLog on success
 * 6. Update channel health fields
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} eventRecord - The event record from eventLog
 * @returns {Promise<{ delivered: boolean, provider: string|null, channels: Array }>}
 */
async function processEvent({ db }, eventRecord) {
    const { eventId, scopedKey, tenantId, eventType, source, payload } = eventRecord;

    console.log(`[deliveryWorker] Processing event ${eventId} (type: ${eventType}, source: ${source})`);

    // Load merchant notification preferences
    const configDoc = await db.collection('merchantConfig').doc(tenantId).get();
    const slackConfig = configDoc.exists
        ? configDoc.data()?.notificationPrefs?.providers?.slack
        : null;

    // Check Slack connected
    if (!slackConfig || !slackConfig.connected) {
        const result = {
            delivered: false,
            provider: null,
            suppressed: true,
            reason: 'Slack not connected',
            processedAt: new Date().toISOString()
        };
        await updateEventLogStatus(db, scopedKey, 'suppressed', result);
        console.log(`[deliveryWorker] Suppressed event ${eventId}: Slack not connected`);
        return result;
    }

    // Check Slack enabled
    if (!slackConfig.enabled) {
        const result = {
            delivered: false,
            provider: null,
            suppressed: true,
            reason: 'Slack disabled by tenant',
            processedAt: new Date().toISOString()
        };
        await updateEventLogStatus(db, scopedKey, 'suppressed', result);
        console.log(`[deliveryWorker] Suppressed event ${eventId}: Slack disabled`);
        return result;
    }

    // Resolve eligible channels for this event type
    const channels = slackConfig.channels || {};
    const eligibleChannels = Object.values(channels).filter(ch =>
        ch.active && ch.events && ch.events.includes(eventType)
    );

    if (eligibleChannels.length === 0) {
        const result = {
            delivered: false,
            provider: 'slack',
            suppressed: true,
            reason: `No active channels subscribed to ${eventType}`,
            processedAt: new Date().toISOString()
        };
        await updateEventLogStatus(db, scopedKey, 'suppressed', result);
        console.log(`[deliveryWorker] Suppressed event ${eventId}: no eligible channels`);
        return result;
    }

    // Format message
    const formattedMessage = slackProvider.formatMessage(eventType, payload || {});

    // Deliver to each eligible channel
    const channelResults = [];
    let anySuccess = false;

    for (const channel of eligibleChannels) {
        const deliveryResult = await slackProvider.deliver(channel, formattedMessage);
        channelResults.push({
            channelId: channel.channelId,
            channelName: channel.channelName,
            ...deliveryResult
        });

        // Update channel health
        await updateChannelHealth(db, tenantId, channel.channelId, deliveryResult.sent);

        if (deliveryResult.sent) {
            anySuccess = true;
            // Write notificationLog entry
            await writeNotificationLog(db, {
                eventId,
                tenantId,
                eventType,
                source,
                provider: 'slack',
                channelId: channel.channelId,
                channelName: channel.channelName,
                status: 'delivered',
                slackTs: deliveryResult.ts,
                deliveredAt: new Date().toISOString()
            });
        }
    }

    const result = {
        delivered: anySuccess,
        provider: 'slack',
        channels: channelResults,
        processedAt: new Date().toISOString()
    };

    await updateEventLogStatus(db, scopedKey, anySuccess ? 'delivered' : 'delivery_failed', result);

    // S3: Update replyEvents with slackNotificationSentAt after successful delivery
    if (anySuccess && payload?.replyEventId) {
        await updateReplyEventSlackStatus(db, payload.replyEventId);
    }

    if (!anySuccess) {
        // All channels failed — throw to trigger retry/dead-letter
        const reasons = channelResults.map(r => `${r.channelId}: ${r.reason}`).join('; ');
        throw new Error(`All Slack deliveries failed: ${reasons}`);
    }

    return result;
}

/**
 * Update eventLog status.
 */
async function updateEventLogStatus(db, scopedKey, status, deliveryResult) {
    if (!scopedKey) return;
    try {
        await db.collection('eventLog').doc(scopedKey).update({
            status,
            processedAt: deliveryResult.processedAt,
            deliveryResult
        });
    } catch (error) {
        console.error('[deliveryWorker] Failed to update eventLog:', error.message);
    }
}

/**
 * Update channel health fields after a delivery attempt.
 */
async function updateChannelHealth(db, tenantId, channelId, success) {
    try {
        const configRef = db.collection('merchantConfig').doc(tenantId);
        const channelPath = `notificationPrefs.providers.slack.channels.${channelId}`;

        if (success) {
            await configRef.update({
                [`${channelPath}.consecutiveFailures`]: 0,
                [`${channelPath}.healthStatus`]: 'healthy',
                [`${channelPath}.lastDeliveryAt`]: new Date().toISOString()
            });
        } else {
            // Read current failure count to determine new status
            const doc = await configRef.get();
            const currentChannel = doc.data()?.notificationPrefs?.providers?.slack?.channels?.[channelId];
            const failures = (currentChannel?.consecutiveFailures || 0) + 1;

            let healthStatus = 'healthy';
            if (failures >= CONSECUTIVE_FAILURE_FAILED) {
                healthStatus = 'failed';
            } else if (failures >= CONSECUTIVE_FAILURE_DEGRADED) {
                healthStatus = 'degraded';
            }

            await configRef.update({
                [`${channelPath}.consecutiveFailures`]: failures,
                [`${channelPath}.healthStatus`]: healthStatus
            });
        }
    } catch (error) {
        console.error('[deliveryWorker] Failed to update channel health:', error.message);
    }
}

/**
 * Write a delivery record to notificationLog collection.
 */
async function writeNotificationLog(db, logEntry) {
    try {
        await db.collection('notificationLog').doc().set({
            ...logEntry,
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[deliveryWorker] Failed to write notificationLog:', error.message);
    }
}

/**
 * S3: Update replyEvents document with slackNotificationSentAt after Slack delivery.
 */
async function updateReplyEventSlackStatus(db, replyEventId) {
    try {
        const now = new Date().toISOString();
        await db.collection('replyEvents').doc(replyEventId).update({
            slackNotificationSentAt: now,
            updatedAt: now
        });
        console.log(`[deliveryWorker] Updated replyEvents/${replyEventId} with slackNotificationSentAt`);
    } catch (error) {
        // Missing replyEventId should not fail delivery
        console.warn(`[deliveryWorker] Failed to update replyEvents/${replyEventId}:`, error.message);
    }
}

/**
 * Write a failed event to the dead letter collection.
 */
async function writeDeadLetter({ db }, eventRecord, failureReason, attemptCount) {
    try {
        const deadLetterRef = db.collection('deadLetterEvents').doc();
        await deadLetterRef.set({
            eventId: eventRecord.eventId,
            scopedKey: eventRecord.scopedKey,
            tenantId: eventRecord.tenantId,
            identitySpace: eventRecord.identitySpace || 'firebase',
            source: eventRecord.source,
            eventType: eventRecord.eventType,
            priority: eventRecord.priority,
            payload: eventRecord.payload || {},
            failureReason,
            attemptCount,
            maxAttempts: CLOUD_TASK_MAX_ATTEMPTS,
            createdAt: new Date().toISOString(),
            resolved: false
        });

        if (eventRecord.scopedKey) {
            await db.collection('eventLog').doc(eventRecord.scopedKey).update({
                status: 'dead_lettered',
                deadLetteredAt: new Date().toISOString(),
                failureReason
            });
        }

        console.log(`[deliveryWorker] Event ${eventRecord.eventId} written to dead letter`);
    } catch (error) {
        console.error(`[deliveryWorker] Failed to write dead letter for ${eventRecord.eventId}:`, error.message);
    }
}

module.exports = { processEvent, writeDeadLetter };
