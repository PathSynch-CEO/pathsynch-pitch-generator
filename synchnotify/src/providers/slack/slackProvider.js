/**
 * Slack Provider — STUB (S1)
 *
 * Placeholder for S2 implementation. Does NOT call the Slack API.
 * Implements the provider interface from Master PRD Section 7.
 */

/**
 * Format a message for Slack delivery.
 * S1: Returns a placeholder structure.
 *
 * @param {string} eventType - The event type
 * @param {Object} payload - The event payload
 * @param {Object} merchantPrefs - Merchant notification preferences
 * @returns {Object} Formatted Slack Block Kit message (stub)
 */
function formatMessage(eventType, payload, merchantPrefs) {
    // S2 will implement full Block Kit formatting
    return {
        stub: true,
        eventType,
        text: `[SynchNotify] ${eventType} event received`
    };
}

/**
 * Deliver a formatted message to a Slack channel.
 * S1: No-op stub. Does NOT call the Slack API.
 *
 * @param {string} channel - Slack channel ID
 * @param {Object} formattedMessage - Block Kit message
 * @param {string} botToken - Slack bot token
 * @returns {Promise<{ sent: boolean, stub: boolean }>}
 */
async function deliver(channel, formattedMessage, botToken) {
    // S2 will implement actual Slack API delivery
    return { sent: false, stub: true, reason: 'S1 stub — Slack delivery not yet implemented' };
}

module.exports = { formatMessage, deliver };
