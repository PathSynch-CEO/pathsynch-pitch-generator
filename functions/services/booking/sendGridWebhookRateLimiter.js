'use strict';

// Twilio SendGrid can deliver webhook batches at high frequency for large mail
// programs. Keep a deliberately generous, process-local signed-request budget:
// it is an abuse backstop, not provider authority and not an end-user quota.
// Exhaustion returns a non-2xx response so SendGrid retains and retries events.
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_REQUESTS_PER_WINDOW = 12_000;

function createSendGridWebhookRateLimiter(options = {}) {
    const now = options.now || Date.now;
    const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    const requestsPerWindow = options.requestsPerWindow || DEFAULT_REQUESTS_PER_WINDOW;
    if (!Number.isSafeInteger(windowMs) || windowMs < 1
        || !Number.isSafeInteger(requestsPerWindow) || requestsPerWindow < 1) {
        throw new Error('SendGrid webhook rate-limit configuration is invalid');
    }

    let windowStartedAt = null;
    let requestCount = 0;

    return async function enforceSendGridWebhookRateLimit() {
        const currentTime = Number(now());
        if (!Number.isFinite(currentTime)) {
            throw new Error('SendGrid webhook rate-limit clock is invalid');
        }
        if (windowStartedAt === null || currentTime - windowStartedAt >= windowMs) {
            windowStartedAt = currentTime;
            requestCount = 0;
        }
        if (requestCount >= requestsPerWindow) {
            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil(
                    (windowStartedAt + windowMs - currentTime) / 1000
                ))
            };
        }
        requestCount += 1;
        return {
            allowed: true,
            remaining: requestsPerWindow - requestCount
        };
    };
}

module.exports = {
    DEFAULT_WINDOW_MS,
    DEFAULT_REQUESTS_PER_WINDOW,
    createSendGridWebhookRateLimiter
};
