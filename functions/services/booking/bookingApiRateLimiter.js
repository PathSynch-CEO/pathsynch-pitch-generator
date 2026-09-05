'use strict';

const crypto = require('crypto');
const { checkRateLimit, getClientIP } = require('../../middleware/rateLimiter');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const LIMITS = Object.freeze({
    session_create_ip: Object.freeze({ requests: 5, window: 10 * 60 }),
    availability_ip: Object.freeze({ requests: 60, window: 5 * 60 }),
    availability_session: Object.freeze({ requests: 30, window: 5 * 60 }),
    booking_ip: Object.freeze({ requests: 10, window: 60 * 60 }),
    booking_session: Object.freeze({ requests: 5, window: 60 * 60 })
});

function digestIdentifier(scope, value) {
    return crypto.createHash('sha256').update(`${scope}:${String(value || '')}`).digest('hex');
}

function createBookingApiRateLimiter(options = {}) {
    const check = options.checkRateLimit || checkRateLimit;
    const clientIp = options.getClientIP || getClientIP;

    async function enforce(scope, value) {
        const limit = LIMITS[scope];
        if (!limit) throw new Error(`Unknown booking rate-limit scope: ${scope}`);
        const result = await check(digestIdentifier(scope, value), `synchintro_${scope}`, limit);
        if (!result || result.error) {
            throw new ApiError(
                ErrorCodes.EXTERNAL_SERVICE_ERROR,
                'Rate limit service is temporarily unavailable'
            );
        }
        if (!result.allowed) {
            const nowSeconds = Math.floor(Date.now() / 1000);
            throw new ApiError(ErrorCodes.RATE_LIMIT, 'Rate limit exceeded', {
                scope,
                retry_after_seconds: Math.max(1, Number(result.resetAt || nowSeconds + limit.window) - nowSeconds)
            });
        }
        return result;
    }

    return Object.freeze({
        enforceSessionCreation(req) {
            return enforce('session_create_ip', clientIp(req));
        },
        enforceAvailabilityIp(req) {
            return enforce('availability_ip', clientIp(req));
        },
        enforceAvailabilitySession(sessionId) {
            return enforce('availability_session', sessionId);
        },
        enforceBookingIp(req) {
            return enforce('booking_ip', clientIp(req));
        },
        enforceBookingSession(sessionId) {
            return enforce('booking_session', sessionId);
        }
    });
}

module.exports = {
    LIMITS,
    digestIdentifier,
    createBookingApiRateLimiter
};
