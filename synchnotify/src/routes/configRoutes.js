/**
 * Slack Config CRUD Routes
 *
 * POST   /api/v1/config/slack/connect     — Save channel config
 * GET    /api/v1/config/slack/status       — Connection status (no secrets)
 * PUT    /api/v1/config/slack/toggle       — Enable/disable
 * DELETE /api/v1/config/slack/disconnect   — Soft-deactivate Slack config
 * POST   /api/v1/config/slack/test         — Send test message
 *
 * All endpoints require Firebase auth. tenantId = req.tenantId (Firebase UID).
 */

const express = require('express');
const slackProvider = require('../providers/slack/slackProvider');
const { resolveTenant } = require('../utils/tenantResolver');
const { getChannelLimit } = require('../utils/tierGating');

// S2 allowed event types for channel subscription
const ALLOWED_CHANNEL_EVENTS = ['positive_reply'];

// Channel health thresholds
const CONSECUTIVE_FAILURE_DEGRADED = 3;
const CONSECUTIVE_FAILURE_FAILED = 10;

/**
 * Mount config routes.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {Object} deps.authMiddleware - Firebase auth middleware
 * @returns {express.Router}
 */
function configRoutes({ db, authMiddleware }) {
    const router = express.Router();

    // All config routes require Firebase auth
    router.use('/api/v1/config/slack', authMiddleware);

    // ---- POST /api/v1/config/slack/connect ----
    router.post('/api/v1/config/slack/connect', async (req, res) => {
        const tenantId = req.tenantId;
        const { channelId, channelName, events, active } = req.body;

        // Validate channelId
        if (!channelId || typeof channelId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid channelId'
            });
        }

        // Validate events
        const eventList = events || ['positive_reply'];
        if (!Array.isArray(eventList)) {
            return res.status(400).json({
                success: false,
                error: 'events must be an array'
            });
        }

        const invalidEvents = eventList.filter(e => !ALLOWED_CHANNEL_EVENTS.includes(e));
        if (invalidEvents.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Unsupported event types: ${invalidEvents.join(', ')}. Allowed: ${ALLOWED_CHANNEL_EVENTS.join(', ')}`
            });
        }

        try {
            // Resolve tenant for tier gating
            const tenant = await resolveTenant({ db }, tenantId, 'firebase');
            const channelLimit = getChannelLimit(tenant.plan);

            // Read current config
            const configRef = db.collection('merchantConfig').doc(tenantId);
            const configDoc = await configRef.get();
            const configData = configDoc.exists ? configDoc.data() : {};
            const currentPrefs = configData.notificationPrefs || {};
            const currentSlack = currentPrefs.providers?.slack || {};
            const currentChannels = currentSlack.channels || {};

            // Check channel limit (existing channels + new, minus updates)
            const isUpdate = !!currentChannels[channelId];
            const channelCount = Object.keys(currentChannels).length;
            if (!isUpdate && channelCount >= channelLimit) {
                return res.status(403).json({
                    success: false,
                    error: `Channel limit reached for ${tenant.plan} plan (${channelLimit} max). Upgrade for more channels.`,
                    currentPlan: tenant.plan,
                    channelLimit
                });
            }

            // Build channel config
            const channelConfig = {
                channelId,
                channelName: channelName || channelId,
                events: eventList,
                active: active !== false,
                healthStatus: 'healthy',
                consecutiveFailures: 0,
                lastDeliveryAt: null,
                ...(isUpdate ? {} : { addedAt: new Date().toISOString() })
            };

            // Build updated notification preferences
            const now = new Date().toISOString();
            const updatedSlack = {
                connected: true,
                enabled: currentSlack.enabled !== false,
                connectedAt: currentSlack.connectedAt || now,
                updatedAt: now,
                channels: {
                    ...currentChannels,
                    [channelId]: channelConfig
                }
            };

            // Write using set with merge to preserve other merchantConfig fields
            await configRef.set({
                notificationPrefs: {
                    providers: {
                        slack: updatedSlack
                    }
                }
            }, { merge: true });

            return res.status(200).json({
                success: true,
                channel: channelConfig,
                totalChannels: Object.keys(updatedSlack.channels).length,
                channelLimit
            });
        } catch (error) {
            console.error('[config/slack/connect] Error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to save Slack configuration'
            });
        }
    });

    // ---- GET /api/v1/config/slack/status ----
    router.get('/api/v1/config/slack/status', async (req, res) => {
        const tenantId = req.tenantId;

        try {
            const configDoc = await db.collection('merchantConfig').doc(tenantId).get();

            if (!configDoc.exists) {
                return res.status(200).json({
                    success: true,
                    connected: false,
                    enabled: false,
                    channels: []
                });
            }

            const data = configDoc.data();
            const slackConfig = data?.notificationPrefs?.providers?.slack;

            if (!slackConfig) {
                return res.status(200).json({
                    success: true,
                    connected: false,
                    enabled: false,
                    channels: []
                });
            }

            // Return safe fields only — never expose bot token or secrets
            const channels = Object.values(slackConfig.channels || {}).map(ch => ({
                channelId: ch.channelId,
                channelName: ch.channelName,
                events: ch.events,
                active: ch.active,
                healthStatus: ch.healthStatus,
                consecutiveFailures: ch.consecutiveFailures,
                lastDeliveryAt: ch.lastDeliveryAt
            }));

            return res.status(200).json({
                success: true,
                connected: !!slackConfig.connected,
                enabled: !!slackConfig.enabled,
                connectedAt: slackConfig.connectedAt || null,
                channels
            });
        } catch (error) {
            console.error('[config/slack/status] Error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to read Slack status'
            });
        }
    });

    // ---- PUT /api/v1/config/slack/toggle ----
    router.put('/api/v1/config/slack/toggle', async (req, res) => {
        const tenantId = req.tenantId;
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'enabled must be a boolean'
            });
        }

        try {
            const configRef = db.collection('merchantConfig').doc(tenantId);
            await configRef.set({
                notificationPrefs: {
                    providers: {
                        slack: {
                            enabled,
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, { merge: true });

            return res.status(200).json({
                success: true,
                enabled
            });
        } catch (error) {
            console.error('[config/slack/toggle] Error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to toggle Slack'
            });
        }
    });

    // ---- DELETE /api/v1/config/slack/disconnect ----
    router.delete('/api/v1/config/slack/disconnect', async (req, res) => {
        const tenantId = req.tenantId;

        try {
            // Soft deactivate — preserve config but mark disconnected
            const configRef = db.collection('merchantConfig').doc(tenantId);
            await configRef.set({
                notificationPrefs: {
                    providers: {
                        slack: {
                            connected: false,
                            enabled: false,
                            disconnectedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, { merge: true });

            return res.status(200).json({
                success: true,
                message: 'Slack disconnected'
            });
        } catch (error) {
            console.error('[config/slack/disconnect] Error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to disconnect Slack'
            });
        }
    });

    // ---- POST /api/v1/config/slack/test ----
    router.post('/api/v1/config/slack/test', async (req, res) => {
        const tenantId = req.tenantId;

        try {
            const configDoc = await db.collection('merchantConfig').doc(tenantId).get();
            const slackConfig = configDoc.exists
                ? configDoc.data()?.notificationPrefs?.providers?.slack
                : null;

            if (!slackConfig || !slackConfig.connected) {
                return res.status(400).json({
                    success: false,
                    error: 'Slack is not connected. Connect Slack first.'
                });
            }

            const channels = slackConfig.channels || {};
            const activeChannels = Object.values(channels).filter(ch => ch.active);

            if (activeChannels.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No active Slack channels configured'
                });
            }

            // Send test message to each active channel
            const results = [];
            for (const channel of activeChannels) {
                const testMessage = {
                    text: ':white_check_mark: SynchNotify connected successfully! This channel will receive positive reply alerts.',
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: ':white_check_mark: *SynchNotify connected successfully!*\nThis channel will receive positive reply alerts.'
                            }
                        },
                        {
                            type: 'context',
                            elements: [
                                {
                                    type: 'mrkdwn',
                                    text: `Subscribed events: ${channel.events.join(', ')}`
                                }
                            ]
                        }
                    ]
                };

                const deliveryResult = await slackProvider.deliver(channel, testMessage);
                results.push({
                    channelId: channel.channelId,
                    channelName: channel.channelName,
                    ...deliveryResult
                });
            }

            const allSent = results.every(r => r.sent);

            return res.status(200).json({
                success: allSent,
                results
            });
        } catch (error) {
            console.error('[config/slack/test] Error:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to send test message'
            });
        }
    });

    return router;
}

// Export threshold constants for delivery worker
module.exports = {
    configRoutes,
    CONSECUTIVE_FAILURE_DEGRADED,
    CONSECUTIVE_FAILURE_FAILED,
    ALLOWED_CHANNEL_EVENTS
};
