'use strict';

jest.mock('firebase-admin');
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: jest.fn((options, handler) => handler || options),
    onCall: jest.fn((options, handler) => handler || options)
}));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (options, handler) => handler || options }));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (options, handler) => handler || options
}));
jest.mock('firebase-functions/v2', () => ({ setGlobalOptions: () => undefined }));

const mockRuntime = {
    persistence: {
        createSessionWithCapability: jest.fn().mockResolvedValue({
            session: {
                session_id: 'bks_pipeline',
                session_version: 1,
                timezone: 'America/New_York',
                identity: { email: 'buyer@example.com', provider: 'email' },
                company: null,
                qualification: null
            },
            session_token: 'P'.repeat(43)
        }),
        authorizeSessionCapability: jest.fn().mockResolvedValue({ session_id: 'bks_pipeline' }),
        authorizeBookingCapability: jest.fn().mockResolvedValue({ session_id: 'bks_pipeline' })
    },
    orchestrator: {
        getAvailability: jest.fn().mockResolvedValue({
            session_version: 1,
            availability_version: 1,
            timezone: 'America/New_York',
            slots: []
        }),
        createBooking: jest.fn().mockResolvedValue({
            booking_id: 'booking_pipeline',
            event_id: 'event_pipeline',
            status: 'confirmed'
        })
    },
    rateLimiter: {
        enforceSessionCreation: jest.fn().mockResolvedValue(undefined),
        enforceAvailabilityIp: jest.fn().mockResolvedValue(undefined),
        enforceAvailabilitySession: jest.fn().mockResolvedValue(undefined),
        enforceBookingIp: jest.fn().mockResolvedValue(undefined),
        enforceBookingSession: jest.fn().mockResolvedValue(undefined)
    }
};

jest.mock('../services/booking/bookingApiRuntime', () => ({
    getBookingApiRuntime: () => mockRuntime,
    getBookingApiRateLimiter: () => mockRuntime.rateLimiter
}));

const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { api } = require('../index');
const apiRegistrationOptions = onRequest.mock.calls
    .find((call) => call[0] && call[0].memory === '1GiB')[0];

function response() {
    let settle;
    const res = {
        sent: new Promise((resolve) => { settle = resolve; }),
        statusCode: 200,
        body: null,
        headers: {},
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; settle(); return this; },
        send(payload) { this.body = payload; this.headersSent = true; settle(); return this; },
        set(key, value) {
            if (typeof key === 'object') Object.assign(this.headers, key);
            else this.headers[key] = value;
            return this;
        },
        setHeader(key, value) { this.headers[key] = value; },
        getHeader(key) { return this.headers[key]; },
        removeHeader(key) { delete this.headers[key]; },
        end() { this.headersSent = true; settle(); return this; }
    };
    return res;
}

async function callApi(overrides = {}) {
    const body = overrides.body || {};
    const req = Object.assign({
        method: 'POST',
        path: '/v1/booking-sessions',
        url: '/v1/booking-sessions',
        originalUrl: '/v1/booking-sessions',
        headers: {
            origin: 'https://approved.example',
            'content-type': 'application/json',
            authorization: 'Bearer valid_must_not_be_booking_authority'
        },
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
        query: {},
        ip: '203.0.113.24',
        get(name) { return this.headers[String(name).toLowerCase()]; }
    }, overrides);
    const res = response();
    api(req, res);
    await Promise.race([
        res.sent,
        new Promise((_, reject) => setTimeout(() => reject(new Error('booking API did not respond')), 5000))
    ]);
    return res;
}

describe('SynchIntro booking API mounted pipeline', () => {
    const previousOrigins = process.env.SYNCHINTRO_ALLOWED_ORIGINS;
    const previousNodeEnv = process.env.NODE_ENV;

    beforeAll(() => {
        process.env.SYNCHINTRO_ALLOWED_ORIGINS = 'https://approved.example';
    });

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        admin._resetMockData();
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.NODE_ENV = previousNodeEnv;
        if (previousOrigins === undefined) delete process.env.SYNCHINTRO_ALLOWED_ORIGINS;
        else process.env.SYNCHINTRO_ALLOWED_ORIGINS = previousOrigins;
    });

    test('disables the permissive platform CORS wrapper', () => {
        expect(apiRegistrationOptions.cors).toBe(false);
    });

    test('mounts POST /v1/booking-sessions through the public route', async () => {
        const res = await callApi({
            body: {
                flow_id: 'synchintro_progressive',
                identity: { email: 'buyer@example.com', provider: 'email' },
                timezone: 'America/New_York',
                attribution: {}
            }
        });

        expect(res.statusCode).toBe(201);
        expect(res.body).toMatchObject({
            success: true,
            data: { session_id: 'bks_pipeline', session_token: 'P'.repeat(43) }
        });
        expect(res.headers['Access-Control-Allow-Origin']).toBe('https://approved.example');
        expect(mockRuntime.persistence.createSessionWithCapability).toHaveBeenCalledTimes(1);
        expect(mockRuntime.rateLimiter.enforceSessionCreation).toHaveBeenCalledTimes(1);
        expect(admin._mockData.collections.rateLimits).toBeUndefined();
        expect(admin._mockAuth.verifyIdToken).not.toHaveBeenCalled();
    });

    test('mounts availability through the /api/v1 compatibility prefix exactly once', async () => {
        const res = await callApi({
            method: 'GET',
            path: '/api/v1/booking-sessions/bks_pipeline/availability',
            url: '/api/v1/booking-sessions/bks_pipeline/availability?start=2026-09-08T00%3A00%3A00.000Z&end=2026-09-09T00%3A00%3A00.000Z',
            originalUrl: '/api/v1/booking-sessions/bks_pipeline/availability?start=2026-09-08T00%3A00%3A00.000Z&end=2026-09-09T00%3A00%3A00.000Z',
            headers: {
                origin: 'https://approved.example',
                'x-synchintro-session-token': 'P'.repeat(43)
            },
            query: {
                start: '2026-09-08T00:00:00.000Z',
                end: '2026-09-09T00:00:00.000Z'
            }
        });

        expect(res.statusCode).toBe(200);
        expect(mockRuntime.persistence.authorizeSessionCapability).toHaveBeenCalledTimes(1);
        expect(mockRuntime.orchestrator.getAvailability).toHaveBeenCalledTimes(1);
        expect(mockRuntime.rateLimiter.enforceAvailabilityIp).toHaveBeenCalledTimes(1);
        expect(mockRuntime.rateLimiter.enforceAvailabilitySession).toHaveBeenCalledTimes(1);
    });

    test('mounts both booking aliases without double execution or rate-limit bypass', async () => {
        const body = {
            session_version: 1,
            slot: {
                id: 'slot_pipeline',
                start: '2026-09-08T13:00:00.000Z',
                end: '2026-09-08T13:30:00.000Z',
                timezone: 'America/New_York',
                availability_version: 1
            },
            guests: []
        };
        for (const prefix of ['/v1', '/api/v1']) {
            const path = `${prefix}/booking-sessions/bks_pipeline/bookings`;
            const res = await callApi({
                path,
                url: path,
                originalUrl: path,
                headers: {
                    origin: 'https://approved.example',
                    'content-type': 'application/json',
                    'x-synchintro-session-token': 'P'.repeat(43),
                    'idempotency-key': 'booking_pipeline_123456'
                },
                body,
                rawBody: Buffer.from(JSON.stringify(body))
            });
            expect(res.statusCode).toBe(200);
        }

        expect(mockRuntime.persistence.authorizeBookingCapability).toHaveBeenCalledTimes(2);
        expect(mockRuntime.orchestrator.createBooking).toHaveBeenCalledTimes(2);
        expect(mockRuntime.rateLimiter.enforceBookingIp).toHaveBeenCalledTimes(2);
        expect(mockRuntime.rateLimiter.enforceBookingSession).toHaveBeenCalledTimes(2);
    });

    test('allows approved preflight with deliberate booking headers and no wildcard', async () => {
        const res = await callApi({
            method: 'OPTIONS',
            headers: {
                origin: 'https://approved.example',
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'content-type,x-synchintro-session-token,idempotency-key'
            },
            body: undefined,
            rawBody: undefined
        });

        expect(res.statusCode).toBe(204);
        expect(res.headers['Access-Control-Allow-Origin']).toBe('https://approved.example');
        expect(res.headers['Access-Control-Allow-Origin']).not.toBe('*');
        expect(res.headers['Access-Control-Allow-Headers']).toContain('X-SynchIntro-Session-Token');
        expect(res.headers['Access-Control-Allow-Headers']).toContain('Idempotency-Key');
    });

    test('rejects unapproved browser origins and production requests without Origin', async () => {
        const unapproved = await callApi({
            headers: { origin: 'https://evil.example', 'content-type': 'application/json' }
        });
        expect(unapproved.statusCode).toBe(403);
        expect(unapproved.body.code).toBe('ORIGIN_NOT_ALLOWED');

        const noOrigin = await callApi({ headers: { 'content-type': 'application/json' } });
        expect(noOrigin.statusCode).toBe(403);
        expect(noOrigin.body.code).toBe('ORIGIN_NOT_ALLOWED');
        expect(mockRuntime.persistence.createSessionWithCapability).not.toHaveBeenCalled();
    });
});
