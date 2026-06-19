/**
 * Webhook Auth Middleware
 *
 * Per-merchant authentication for external webhook providers (Instantly).
 * Unlike hmacAuth.js (internal product-to-SynchNotify auth), this validates
 * against per-merchant webhook secrets stored in merchantConfig/{tenantId}.
 *
 * Supports two auth methods:
 * 1. HMAC-SHA256 via X-PathSynch-Signature + X-PathSynch-Timestamp headers
 * 2. Bearer token fallback via Authorization header (for providers that
 *    cannot compute HMAC, e.g. Instantly static webhook headers)
 *
 * Both methods validate against the per-merchant instantlyWebhookSecret.
 *
 * Security:
 *   - tenantId from URL path param identifies the merchant BEFORE validation
 *   - webhook secret loaded from merchantConfig/{tenantId}
 *   - HMAC path: HMAC-SHA256(secret, timestamp + "." + rawBody), 5-min replay window
 *   - Bearer path: constant-time compare token against webhook secret
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
        const authHeader = req.headers['authorization'] || '';

        // Validate tenantId present
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Missing tenantId in webhook URL'
            });
        }

        // Determine auth method: HMAC if signature headers present, else bearer token
        const useHmac = !!(signature && timestamp);
        const bearerToken = !useHmac && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : null;

        if (!useHmac && !bearerToken) {
            return res.status(401).json({
                success: false,
                error: 'Missing authentication: provide HMAC signature headers or Bearer token'
            });
        }

        // HMAC path: validate timestamp and replay window
        if (useHmac) {
            const timestampMs = Date.parse(timestamp);
            const timestampMsAlt = Number(timestamp);
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

        if (useHmac) {
            // HMAC validation: SHA256(secret, timestamp + "." + rawBody)
            const rawBody = req.rawBody || JSON.stringify(req.body);
            const signaturePayload = timestamp + '.' + rawBody;
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(signaturePayload)
                .digest('hex');

            const providedBuf = Buffer.from(signature, 'utf8');
            const expectedBuf = Buffer.from(expectedSignature, 'utf8');

            if (providedBuf.length !== expectedBuf.length ||
                !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid webhook signature'
                });
            }
        } else {
            // Bearer token validation: constant-time compare against webhook secret
            const tokenBuf = Buffer.from(bearerToken, 'utf8');
            const secretBuf = Buffer.from(webhookSecret, 'utf8');

            if (tokenBuf.length !== secretBuf.length ||
                !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid bearer token'
                });
            }
        }

        // Auth valid — attach context and proceed
        req.tenantId = tenantId;
        req.webhookId = webhookId;
        req.merchantConfig = configDoc.data();
        req.verifiedTimestamp = useHmac ? timestamp : new Date().toISOString();
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
