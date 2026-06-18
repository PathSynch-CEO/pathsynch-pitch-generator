/**
 * Webhook Auth Middleware
 *
 * Per-merchant HMAC-SHA256 validation for external webhook providers (Instantly).
 * Unlike hmacAuth.js (internal product-to-SynchNotify auth), this validates
 * against per-merchant webhook secrets stored in merchantConfig/{tenantId}.
 *
 * Headers:
 *   X-PathSynch-Signature: {hmac hex}
 *   X-PathSynch-Timestamp: {ISO timestamp or unix millis}
 *   X-PathSynch-Webhook-Id: {provider event id} (optional)
 *
 * Security:
 *   - tenantId from URL path param identifies the merchant BEFORE validation
 *   - webhook secret loaded from merchantConfig/{tenantId}
 *   - HMAC-SHA256(secret, timestamp + "." + rawBody)
 *   - constant-time comparison
 *   - 5-minute replay window
 *   - Never logs secrets or signatures
 */

const crypto = require('crypto');
const { REPLAY_WINDOW_MS } = require('../config/constants');

/**
 * Create webhook auth middleware.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @returns {Function} Express middleware
 */
function webhookAuth({ db }) {
    return async (req, res, next) => {
        const tenantId = req.params.tenantId;
        const signature = req.headers['x-pathsynch-signature'];
        const timestamp = req.headers['x-pathsynch-timestamp'];
        const webhookId = req.headers['x-pathsynch-webhook-id'] || null;

        // Validate tenantId present
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Missing tenantId in webhook URL'
            });
        }

        // Validate required headers
        if (!signature || !timestamp) {
            return res.status(401).json({
                success: false,
                error: 'Missing X-PathSynch-Signature or X-PathSynch-Timestamp header'
            });
        }

        // Validate timestamp format and replay window
        const timestampMs = Date.parse(timestamp);
        const timestampMsAlt = Number(timestamp); // support unix millis
        const resolvedTimestampMs = !isNaN(timestampMs) ? timestampMs : (!isNaN(timestampMsAlt) ? timestampMsAlt : NaN);

        if (isNaN(resolvedTimestampMs)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid X-PathSynch-Timestamp format'
            });
        }

        const now = Date.now();
        const age = Math.abs(now - resolvedTimestampMs);
        if (age > REPLAY_WINDOW_MS) {
            return res.status(401).json({
                success: false,
                error: 'Timestamp outside replay window (5 minutes)'
            });
        }

        // Look up merchant and webhook secret
        let configDoc;
        try {
            configDoc = await db.collection('merchantConfig').doc(tenantId).get();
        } catch (error) {
            console.error('[webhookAuth] Firestore lookup failed:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Internal error during tenant lookup'
            });
        }

        if (!configDoc.exists) {
            return res.status(401).json({
                success: false,
                error: 'Unknown tenantId'
            });
        }

        const webhookSecret = configDoc.data()?.instantlyWebhookSecret;
        if (!webhookSecret) {
            return res.status(401).json({
                success: false,
                error: 'No webhook secret configured for this tenant'
            });
        }

        // Compute expected HMAC: SHA256(secret, timestamp + "." + rawBody)
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const signaturePayload = timestamp + '.' + rawBody;
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(signaturePayload)
            .digest('hex');

        // Constant-time comparison
        const providedBuf = Buffer.from(signature, 'utf8');
        const expectedBuf = Buffer.from(expectedSignature, 'utf8');

        if (providedBuf.length !== expectedBuf.length ||
            !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid webhook signature'
            });
        }

        // Signature valid — attach context and proceed
        req.tenantId = tenantId;
        req.webhookId = webhookId;
        req.merchantConfig = configDoc.data();
        req.verifiedTimestamp = timestamp;
        next();
    };
}

/**
 * Compute webhook HMAC signature.
 * Utility for testing and webhook secret setup documentation.
 */
function computeWebhookSignature(secret, timestamp, rawBody) {
    const payload = timestamp + '.' + rawBody;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

module.exports = { webhookAuth, computeWebhookSignature };
