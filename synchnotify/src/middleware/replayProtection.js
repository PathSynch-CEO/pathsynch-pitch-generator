/**
 * Replay Protection Middleware
 *
 * Rejects events with timestamps outside the configured 5-minute window.
 * This is also enforced inside hmacAuth, but can be used standalone
 * for routes that use different auth mechanisms (e.g., external webhooks).
 */

const { REPLAY_WINDOW_MS } = require('../config/constants');

/**
 * @param {Object} options
 * @param {Function} options.now - Optional clock override for testing
 * @returns {Function} Express middleware
 */
function replayProtection(options = {}) {
    return (req, res, next) => {
        const timestamp = req.headers['x-timestamp'] || req.verifiedTimestamp;

        if (!timestamp) {
            return res.status(401).json({
                success: false,
                error: 'Missing X-Timestamp header'
            });
        }

        const timestampMs = Date.parse(timestamp);
        if (isNaN(timestampMs)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid timestamp format'
            });
        }

        const now = options.now ? options.now() : Date.now();
        const age = Math.abs(now - timestampMs);

        if (age > REPLAY_WINDOW_MS) {
            return res.status(401).json({
                success: false,
                error: 'Timestamp outside replay window'
            });
        }

        next();
    };
}

module.exports = { replayProtection };
