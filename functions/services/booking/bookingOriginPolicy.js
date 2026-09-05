'use strict';

const BOOKING_DEFAULT_ORIGINS = Object.freeze([
    'https://app.synchintro.ai',
    'https://synchintro.ai'
]);

const LOCAL_DEFAULT_ORIGINS = Object.freeze([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
]);

const GENERAL_DEFAULT_ORIGINS = Object.freeze([
    'https://pathsynch-pitch-creation.web.app',
    'https://pathsynch-pitch-creation.firebaseapp.com',
    ...BOOKING_DEFAULT_ORIGINS
]);

function parseOrigins(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin && origin !== '*');
}

function isLocalRuntime(env = process.env) {
    return env.NODE_ENV === 'test'
        || env.NODE_ENV === 'development'
        || env.FUNCTIONS_EMULATOR === 'true';
}

function normalizedApiPath(rawPath) {
    const path = String(rawPath || '');
    if (path === '/api/v1' || path === '/v1') return '/';
    if (path.startsWith('/api/v1/')) return path.slice('/api/v1'.length);
    if (path.startsWith('/v1/')) return path.slice('/v1'.length);
    return path;
}

function isBookingApiRequest(req) {
    const path = normalizedApiPath(req && (req.path || req.url));
    return path === '/booking-sessions' || path.startsWith('/booking-sessions/');
}

function bookingAllowedOrigins(env = process.env) {
    const configured = parseOrigins(env.SYNCHINTRO_ALLOWED_ORIGINS);
    const base = configured.length ? configured : [...BOOKING_DEFAULT_ORIGINS];
    const candidates = isLocalRuntime(env) ? [...base, ...LOCAL_DEFAULT_ORIGINS] : base;
    return [...new Set(candidates.filter((origin) => {
        if (!/^https:\/\//i.test(origin) && !isLocalRuntime(env)) return false;
        if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) {
            return isLocalRuntime(env);
        }
        return true;
    }))];
}

function generalAllowedOrigins(env = process.env) {
    const configured = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    return configured.length ? configured : [...GENERAL_DEFAULT_ORIGINS];
}

function createOriginValidator({ booking, env = process.env }) {
    const allowedOrigins = booking ? bookingAllowedOrigins(env) : generalAllowedOrigins(env);
    return (origin, callback) => {
        if (!origin) {
            if (booking && !isLocalRuntime(env)) return callback(new Error('Origin is not allowed'));
            return callback(null, isLocalRuntime(env));
        }
        if (allowedOrigins.includes(origin) || (!booking && allowedOrigins.includes('*'))) {
            return callback(null, true);
        }
        return callback(new Error('Origin is not allowed'));
    };
}

function corsOptionsForRequest(req, env = process.env) {
    const booking = isBookingApiRequest(req);
    return {
        origin: createOriginValidator({ booking, env }),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'X-SynchIntro-Session-Token',
            'Idempotency-Key'
        ]
    };
}

module.exports = {
    BOOKING_DEFAULT_ORIGINS,
    LOCAL_DEFAULT_ORIGINS,
    parseOrigins,
    isLocalRuntime,
    normalizedApiPath,
    isBookingApiRequest,
    bookingAllowedOrigins,
    corsOptionsForRequest
};
