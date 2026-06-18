/**
 * HMAC Authentication Middleware
 *
 * Validates HMAC-SHA256 signatures on incoming events.
 * Signature = HMAC-SHA256(signingKey, timestamp + "." + rawBody)
 *
 * Headers:
 *   Authorization: HMAC-SHA256 {signature}
 *   X-Timestamp: {ISO-8601}
 */

const crypto = require('crypto');
const { REPLAY_WINDOW_MS } = require('../config/constants');

/**
 * Load signing keys from environment or Secret Manager.
 * Keys are per-source: SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO, SYNCHNOTIFY_HMAC_KEY_PATHMANAGER, etc.
 *
 * @param {Object} options - Optional overrides for testing
 * @param {Object} options.signingKeys - Pre-loaded signing keys map { source: key }
 * @returns {Function} Express middleware
 */
function hmacAuth(options = {}) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const timestamp = req.headers['x-timestamp'];

        if (!authHeader || !timestamp) {
            return res.status(401).json({
                success: false,
                error: 'Missing Authorization or X-Timestamp header'
            });
        }

        // Parse "HMAC-SHA256 {signature}"
        const match = authHeader.match(/^HMAC-SHA256\s+(.+)$/);
        if (!match) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Authorization header format. Expected: HMAC-SHA256 {signature}'
            });
        }
        const providedSignature = match[1];

        // Validate timestamp format and replay window
        const timestampMs = Date.parse(timestamp);
        if (isNaN(timestampMs)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid X-Timestamp format. Expected ISO-8601.'
            });
        }

        const now = options.now ? options.now() : Date.now();
        const age = Math.abs(now - timestampMs);
        if (age > REPLAY_WINDOW_MS) {
            return res.status(401).json({
                success: false,
                error: 'Timestamp outside replay window (5 minutes)'
            });
        }

        // Determine source from body to select signing key
        let body;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch {
            return res.status(400).json({
                success: false,
                error: 'Invalid JSON body'
            });
        }

        const source = body?.source;
        if (!source) {
            return res.status(400).json({
                success: false,
                error: 'Missing source field in request body'
            });
        }

        // Look up signing key for this source
        const signingKeys = options.signingKeys || getSigningKeysFromEnv();
        const key = signingKeys[source];
        if (!key) {
            return res.status(401).json({
                success: false,
                error: `No signing key configured for source: ${source}`
            });
        }

        // Compute expected signature: HMAC-SHA256(key, timestamp + "." + rawBody)
        const rawBody = req.rawBody || JSON.stringify(body);
        const signaturePayload = timestamp + '.' + rawBody;
        const expectedSignature = crypto
            .createHmac('sha256', key)
            .update(signaturePayload)
            .digest('hex');

        // Constant-time comparison
        const providedBuf = Buffer.from(providedSignature, 'utf8');
        const expectedBuf = Buffer.from(expectedSignature, 'utf8');

        if (providedBuf.length !== expectedBuf.length ||
            !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid HMAC signature'
            });
        }

        // Signature valid — attach parsed body and proceed
        req.verifiedBody = body;
        req.verifiedTimestamp = timestamp;
        next();
    };
}

/**
 * Read signing keys from environment variables.
 * Convention: SYNCHNOTIFY_HMAC_KEY_{SOURCE_UPPER}
 */
function getSigningKeysFromEnv() {
    const keys = {};
    const sources = ['synchintro', 'pathmanager', 'pathconnect', 'localsynch', 'referralsynch'];
    for (const source of sources) {
        const envVar = `SYNCHNOTIFY_HMAC_KEY_${source.toUpperCase()}`;
        if (process.env[envVar]) {
            keys[source] = process.env[envVar];
        }
    }
    return keys;
}

/**
 * Compute HMAC signature for outbound event submission.
 * Utility for producers (SynchIntro, PathManager) to sign events.
 */
function computeSignature(signingKey, timestamp, rawBody) {
    const payload = timestamp + '.' + rawBody;
    return crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
}

module.exports = { hmacAuth, computeSignature, getSigningKeysFromEnv };
