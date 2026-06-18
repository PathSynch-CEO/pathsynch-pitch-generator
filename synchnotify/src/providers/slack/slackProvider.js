/**
 * Slack Provider
 *
 * Formats and delivers Slack Block Kit messages via chat.postMessage.
 * Bot token loaded from Secret Manager, cached in memory.
 */

const https = require('https');
const { loadSecret } = require('../../utils/secretManager');

// In-memory bot token cache
let _botToken = null;

/**
 * Load Slack bot token from Secret Manager (cached after first load).
 * @returns {Promise<string|null>}
 */
async function getBotToken() {
    if (_botToken) return _botToken;
    const token = await loadSecret('SLACK_BOT_TOKEN', {
        envFallback: 'SLACK_BOT_TOKEN'
    });
    if (token) _botToken = token;
    return token;
}

/**
 * Clear cached bot token. Used for testing.
 */
function clearBotTokenCache() {
    _botToken = null;
}

/**
 * Set bot token directly. Used for testing.
 */
function setBotToken(token) {
    _botToken = token;
}

// ============================================
// FIT SCORE HELPERS
// ============================================

function getFitScoreEmoji(score) {
    if (score == null || score === undefined) return ':white_circle:'; // neutral/unknown
    if (score >= 80) return ':large_green_circle:';
    if (score >= 60) return ':large_yellow_circle:';
    return ':red_circle:';
}

function getFitScoreLabel(score) {
    if (score == null || score === undefined) return 'Unknown';
    if (score >= 80) return 'Strong Fit';
    if (score >= 60) return 'Moderate Fit';
    return 'Weak Fit';
}

// ============================================
// MESSAGE FORMATTING
// ============================================

/**
 * Format an event into Slack Block Kit layout.
 *
 * @param {string} eventType - Event type (only 'positive_reply' supported in S2)
 * @param {Object} payload - Event payload
 * @param {Object} merchantPrefs - Merchant notification preferences (unused in S2)
 * @returns {Object} Slack Block Kit message object with blocks array
 */
function formatMessage(eventType, payload, merchantPrefs) {
    if (eventType === 'positive_reply') {
        return formatPositiveReply(payload);
    }

    // Unsupported event type — return minimal fallback
    return {
        text: `[SynchNotify] ${eventType} event received`,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${eventType}* event received`
                }
            }
        ]
    };
}

/**
 * Format a positive_reply event into Slack Block Kit layout.
 */
function formatPositiveReply(payload) {
    const {
        companyName,
        contactName,
        contactEmail,
        industry,
        buyingSignals,
        fitScore,
        replySnippet,
        campaignName,
        account360Url,
        receivedAt
    } = payload || {};

    const blocks = [];

    // Header
    blocks.push({
        type: 'header',
        text: {
            type: 'plain_text',
            text: `:fire: Positive Reply — ${companyName || 'Unknown Company'}`,
            emoji: true
        }
    });

    // Contact section
    const contactParts = [];
    if (contactName) contactParts.push(`*Contact:* ${contactName}`);
    if (contactEmail) contactParts.push(`*Email:* ${contactEmail}`);
    if (industry) contactParts.push(`*Industry:* ${industry}`);

    if (contactParts.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: contactParts.join('\n')
            }
        });
    }

    // Buying signals
    if (buyingSignals && Array.isArray(buyingSignals) && buyingSignals.length > 0) {
        const signalList = buyingSignals.map(s => `• ${s}`).join('\n');
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Buying Signals:*\n${signalList}`
            }
        });
    }

    // Fit score badge
    const scoreEmoji = getFitScoreEmoji(fitScore);
    const scoreLabel = getFitScoreLabel(fitScore);
    const scoreText = fitScore != null
        ? `${scoreEmoji} *Fit Score:* ${fitScore}/100 (${scoreLabel})`
        : `${scoreEmoji} *Fit Score:* ${scoreLabel}`;

    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: scoreText
            }
        ]
    });

    // Reply snippet (truncated to 200 chars)
    if (replySnippet) {
        const truncated = replySnippet.length > 200
            ? replySnippet.substring(0, 197) + '...'
            : replySnippet;
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `> ${truncated}`
            }
        });
    }

    // Campaign + timestamp
    const metaParts = [];
    if (campaignName) metaParts.push(`*Campaign:* ${campaignName}`);
    if (receivedAt) metaParts.push(`*Received:* ${receivedAt}`);

    if (metaParts.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: metaParts.join('  |  ')
            }
        });
    }

    // Account360 button (only if URL present)
    if (account360Url) {
        blocks.push({
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'View Account360',
                        emoji: true
                    },
                    url: account360Url,
                    style: 'primary'
                }
            ]
        });
    }

    // Fallback text for notifications
    const fallbackText = `:fire: Positive Reply — ${companyName || 'Unknown Company'}${contactName ? ` from ${contactName}` : ''}`;

    return {
        text: fallbackText,
        blocks
    };
}

// ============================================
// DELIVERY
// ============================================

/**
 * Deliver a formatted message to a Slack channel via chat.postMessage.
 *
 * @param {Object} channelConfig - Channel config with channelId
 * @param {Object} formattedMessage - Block Kit message from formatMessage()
 * @param {Object} options - Optional overrides
 * @param {string} options.botToken - Override bot token (for testing)
 * @param {Function} options.httpPost - Override HTTP post function (for testing)
 * @returns {Promise<{ sent: boolean, channelId?: string, ts?: string, reason?: string, statusCode?: number }>}
 */
async function deliver(channelConfig, formattedMessage, options = {}) {
    const channelId = channelConfig?.channelId;
    if (!channelId) {
        return { sent: false, reason: 'Missing channelId in channel config' };
    }

    const token = options.botToken || await getBotToken();
    if (!token) {
        return { sent: false, reason: 'Slack bot token not available' };
    }

    const postBody = JSON.stringify({
        channel: channelId,
        text: formattedMessage.text || '',
        blocks: formattedMessage.blocks || []
    });

    try {
        const httpPost = options.httpPost || slackHttpPost;
        const response = await httpPost(postBody, token);

        if (response.ok) {
            return {
                sent: true,
                channelId,
                ts: response.ts,
                timestamp: new Date().toISOString()
            };
        }

        return {
            sent: false,
            channelId,
            reason: response.error || 'Slack API returned ok=false',
            statusCode: response.statusCode || 200
        };
    } catch (error) {
        return {
            sent: false,
            channelId,
            reason: error.message || 'Slack API request failed',
            statusCode: error.statusCode
        };
    }
}

/**
 * POST to Slack chat.postMessage API.
 * Separated for testability.
 */
function slackHttpPost(postBody, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'slack.com',
            path: '/api/chat.postMessage',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(postBody)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    parsed.statusCode = res.statusCode;
                    resolve(parsed);
                } catch {
                    reject({ message: 'Invalid JSON from Slack API', statusCode: res.statusCode });
                }
            });
        });

        req.on('error', (err) => {
            reject({ message: err.message, statusCode: 0 });
        });

        req.write(postBody);
        req.end();
    });
}

module.exports = {
    formatMessage,
    deliver,
    getBotToken,
    clearBotTokenCache,
    setBotToken,
    getFitScoreEmoji,
    getFitScoreLabel,
    // Exposed for testing only
    _test: { slackHttpPost }
};
