'use strict';

const { createRouter } = require('../utils/router');
const { ApiError, ErrorCodes, handleError } = require('../middleware/errorHandler');
const {
    getBookingApiRuntime,
    getBookingApiRateLimiter
} = require('../services/booking/bookingApiRuntime');
const { normalizeIdempotencyKey } = require('../services/booking/bookingContract');

const MAX_JSON_BYTES = 16 * 1024;
const MAX_QUERY_VALUE_LENGTH = 64;
const MAX_SESSION_TOKEN_LENGTH = 128;

function apiError(code, message, details = null) {
    return new ApiError(code, message, details);
}

function header(req, name) {
    if (req && typeof req.get === 'function') return req.get(name);
    return req && req.headers ? req.headers[name.toLowerCase()] : undefined;
}

function assertJsonRequest(req) {
    const contentType = String(header(req, 'content-type') || '').toLowerCase();
    if (contentType.split(';', 1)[0].trim() !== 'application/json') {
        throw apiError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE, 'Content type must be application/json');
    }
    const parsedBytes = Buffer.byteLength(JSON.stringify(req.body === undefined ? null : req.body));
    const rawBytes = req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0;
    if (Math.max(rawBytes, parsedBytes) > MAX_JSON_BYTES) {
        throw apiError(ErrorCodes.REQUEST_TOO_LARGE, 'Request body is too large');
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw apiError(ErrorCodes.BAD_REQUEST, 'JSON body must be an object');
    }
}

function assertNoQuery(req, allowed = []) {
    const query = req.query && typeof req.query === 'object' ? req.query : {};
    const allowedSet = new Set(allowed);
    if (Object.keys(query).some((key) => !allowedSet.has(key))) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'Unsupported query parameter');
    }
    return query;
}

function requiredQueryValue(query, name) {
    const value = query[name];
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_QUERY_VALUE_LENGTH) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${name} query parameter is invalid`);
    }
    return value;
}

function requireCapability(req) {
    const token = header(req, 'X-SynchIntro-Session-Token');
    if (typeof token !== 'string' || token.length < 43 || token.length > MAX_SESSION_TOKEN_LENGTH) {
        throw apiError(ErrorCodes.INVALID_SESSION_CAPABILITY, 'Invalid booking session capability');
    }
    return token;
}

function requireIdempotencyKey(req) {
    const key = header(req, 'Idempotency-Key');
    const normalized = normalizeIdempotencyKey(key);
    if (!normalized) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'A valid Idempotency-Key header is required');
    }
    return normalized;
}

function clientSession(session, sessionToken) {
    const value = {
        session_id: session.session_id,
        session_version: session.session_version,
        timezone: session.timezone,
        identity: session.identity,
        company: session.company,
        qualification: session.qualification
    };
    if (sessionToken) value.session_token = sessionToken;
    return value;
}

function createBookingRouter(options = {}) {
    const router = createRouter();
    const runtimeFactory = options.getRuntime || getBookingApiRuntime;
    const rateLimiterFactory = options.getRateLimiter
        || (options.getRuntime ? () => runtimeFactory().rateLimiter : getBookingApiRateLimiter);

    router.post('/booking-sessions', async (req, res) => {
        try {
            const rateLimiter = rateLimiterFactory();
            await rateLimiter.enforceSessionCreation(req);
            assertJsonRequest(req);
            assertNoQuery(req);
            const { persistence } = runtimeFactory();
            const created = await persistence.createSessionWithCapability(req.body);
            return res.status(201).json({
                success: true,
                data: clientSession(created.session, created.session_token)
            });
        } catch (error) {
            return handleError(error, res, 'SynchIntro booking session creation');
        }
    });

    router.get('/booking-sessions/:sessionId/availability', async (req, res) => {
        try {
            const rateLimiter = rateLimiterFactory();
            await rateLimiter.enforceAvailabilityIp(req);
            const query = assertNoQuery(req, ['start', 'end']);
            const start = requiredQueryValue(query, 'start');
            const end = requiredQueryValue(query, 'end');
            const capability = requireCapability(req);
            const { persistence, orchestrator } = runtimeFactory();
            await persistence.authorizeSessionCapability(req.params.sessionId, capability);
            await rateLimiter.enforceAvailabilitySession(req.params.sessionId);
            const availability = await orchestrator.getAvailability({
                sessionId: req.params.sessionId,
                start,
                end
            });
            return res.status(200).json({ success: true, data: availability });
        } catch (error) {
            return handleError(error, res, 'SynchIntro booking availability');
        }
    });

    router.post('/booking-sessions/:sessionId/bookings', async (req, res) => {
        try {
            const rateLimiter = rateLimiterFactory();
            await rateLimiter.enforceBookingIp(req);
            assertJsonRequest(req);
            assertNoQuery(req);
            const capability = requireCapability(req);
            const idempotencyKey = requireIdempotencyKey(req);
            const { persistence, orchestrator } = runtimeFactory();
            await persistence.authorizeBookingCapability(
                req.params.sessionId,
                idempotencyKey,
                capability
            );
            await rateLimiter.enforceBookingSession(req.params.sessionId);
            const booking = await orchestrator.createBooking({
                sessionId: req.params.sessionId,
                idempotencyKey,
                request: req.body
            });
            return res.status(200).json({ success: true, data: booking });
        } catch (error) {
            return handleError(error, res, 'SynchIntro booking creation');
        }
    });

    return router;
}

const bookingRoutes = createBookingRouter();

module.exports = bookingRoutes;
module.exports.createBookingRouter = createBookingRouter;
module.exports.MAX_JSON_BYTES = MAX_JSON_BYTES;
