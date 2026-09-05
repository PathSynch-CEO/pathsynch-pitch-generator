'use strict';

const { createBookingRouter, MAX_JSON_BYTES } = require('../../routes/bookingRoutes');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const token = 'T'.repeat(43);
const sessionId = 'bks_public_1';
const idempotencyKey = 'booking_key_1234567890';
const createBody = {
    flow_id: 'synchintro_progressive',
    identity: { email: 'buyer@example.com', provider: 'email' },
    timezone: 'America/New_York',
    attribution: { utm_source: 'sandbox' }
};
const availability = {
    session_version: 1,
    availability_version: 2,
    timezone: 'America/New_York',
    slots: [{
        id: 'slot_1',
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T13:30:00.000Z',
        timezone: 'America/New_York',
        availability_version: 2
    }]
};
const booking = {
    booking_id: 'booking_1',
    event_id: 'event_1',
    status: 'confirmed',
    title: 'SynchIntro Strategy Call',
    organizer_email: 'hello@pathsynch.com',
    attendee_emails: ['buyer@example.com'],
    start: availability.slots[0].start,
    end: availability.slots[0].end,
    timezone: 'America/New_York',
    duration_minutes: 30
};

function response() {
    return {
        headersSent: false,
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            this.headersSent = true;
            return this;
        }
    };
}

function request(method, path, overrides = {}) {
    return Object.assign({
        method,
        path,
        normalizedPath: path,
        headers: {},
        query: {},
        body: {},
        rawBody: Buffer.from('{}')
    }, overrides);
}

function defaultRuntime() {
    return {
        persistence: {
            createSessionWithCapability: jest.fn().mockResolvedValue({
                session: {
                    session_id: sessionId,
                    session_version: 1,
                    timezone: 'America/New_York',
                    identity: createBody.identity,
                    company: null,
                    qualification: null,
                    internal_state: 'must-not-leak'
                },
                session_token: token
            }),
            authorizeSessionCapability: jest.fn().mockResolvedValue({ session_id: sessionId })
        },
        orchestrator: {
            getAvailability: jest.fn().mockResolvedValue(availability),
            createBooking: jest.fn().mockResolvedValue(booking)
        },
        rateLimiter: {
            enforceSessionCreation: jest.fn().mockResolvedValue(undefined),
            enforceAvailabilityIp: jest.fn().mockResolvedValue(undefined),
            enforceAvailabilitySession: jest.fn().mockResolvedValue(undefined),
            enforceBookingIp: jest.fn().mockResolvedValue(undefined),
            enforceBookingSession: jest.fn().mockResolvedValue(undefined)
        }
    };
}

describe('public SynchIntro booking routes', () => {
    let runtime;
    let router;
    let errorLog;

    beforeEach(() => {
        runtime = defaultRuntime();
        router = createBookingRouter({ getRuntime: () => runtime });
        errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    test('creates a normalized session and returns its capability exactly once', async () => {
        const req = request('POST', '/booking-sessions', {
            headers: { 'content-type': 'application/json' },
            body: createBody,
            rawBody: Buffer.from(JSON.stringify(createBody))
        });
        const res = response();

        expect(await router.handle(req, res)).toBe(true);
        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({
            success: true,
            data: {
                session_id: sessionId,
                session_version: 1,
                timezone: 'America/New_York',
                identity: createBody.identity,
                company: null,
                qualification: null,
                session_token: token
            }
        });
        expect(JSON.stringify(res.body)).not.toContain('internal_state');
        expect(runtime.persistence.createSessionWithCapability).toHaveBeenCalledWith(createBody);
    });

    test.each([
        ['invalid input', new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking session'), 400],
        ['rate limited', new ApiError(ErrorCodes.RATE_LIMIT, 'Rate limit exceeded'), 429]
    ])('normalizes session creation %s errors', async (_name, error, status) => {
        if (error.code === ErrorCodes.RATE_LIMIT) {
            runtime.rateLimiter.enforceSessionCreation.mockRejectedValue(error);
        } else {
            runtime.persistence.createSessionWithCapability.mockRejectedValue(error);
        }
        const req = request('POST', '/booking-sessions', {
            headers: { 'content-type': 'application/json' },
            body: createBody
        });
        const res = response();
        await router.handle(req, res);
        expect(res.statusCode).toBe(status);
        expect(res.body).toMatchObject({ success: false, code: error.code });
    });

    test('rejects unsupported media types, malformed bodies, query fields, and oversized JSON', async () => {
        const cases = [
            request('POST', '/booking-sessions', { body: createBody }),
            request('POST', '/booking-sessions', {
                headers: { 'content-type': 'application/json' }, body: '{bad json'
            }),
            request('POST', '/booking-sessions', {
                headers: { 'content-type': 'application/json' }, body: createBody, query: { owner: 'client' }
            }),
            request('POST', '/booking-sessions', {
                headers: { 'content-type': 'application/json' },
                body: createBody,
                rawBody: Buffer.alloc(MAX_JSON_BYTES + 1)
            })
        ];
        const expected = [415, 400, 400, 413];
        for (let index = 0; index < cases.length; index += 1) {
            const res = response();
            await router.handle(cases[index], res);
            expect(res.statusCode).toBe(expected[index]);
        }
        expect(runtime.persistence.createSessionWithCapability).not.toHaveBeenCalled();
    });

    test('requires a capability before availability and never calls orchestration without it', async () => {
        const req = request('GET', `${'/booking-sessions'}/${sessionId}/availability`, {
            query: { start: '2026-09-08T00:00:00.000Z', end: '2026-09-09T00:00:00.000Z' }
        });
        const res = response();
        await router.handle(req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe(ErrorCodes.INVALID_SESSION_CAPABILITY);
        expect(runtime.orchestrator.getAvailability).not.toHaveBeenCalled();
    });

    test('authorizes and returns the exact client-safe availability shape', async () => {
        const req = request('GET', `/booking-sessions/${sessionId}/availability`, {
            headers: { 'x-synchintro-session-token': token },
            query: { start: '2026-09-08T00:00:00.000Z', end: '2026-09-09T00:00:00.000Z' }
        });
        const res = response();
        await router.handle(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, data: availability });
        expect(JSON.stringify(res.body)).not.toMatch(/grant|configuration|provider/i);
        expect(runtime.persistence.authorizeSessionCapability).toHaveBeenCalledWith(sessionId, token);
        expect(runtime.orchestrator.getAvailability).toHaveBeenCalledWith({
            sessionId,
            start: req.query.start,
            end: req.query.end
        });
    });

    test('treats empty availability as a successful result', async () => {
        runtime.orchestrator.getAvailability.mockResolvedValue(Object.assign({}, availability, { slots: [] }));
        const res = response();
        await router.handle(request('GET', `/booking-sessions/${sessionId}/availability`, {
            headers: { 'x-synchintro-session-token': token },
            query: { start: '2026-09-08T00:00:00.000Z', end: '2026-09-09T00:00:00.000Z' }
        }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.slots).toEqual([]);
    });

    test.each([
        ['wrong capability', 'INVALID_SESSION_CAPABILITY', 401, 'authorizeSessionCapability'],
        ['expired session', 'EXPIRED', 410, 'authorizeSessionCapability'],
        ['provider failure', 'SCHEDULING_PROVIDER_UNAVAILABLE', 503, 'getAvailability']
    ])('returns a safe availability error for %s', async (_name, code, status, method) => {
        const target = method === 'getAvailability' ? runtime.orchestrator : runtime.persistence;
        target[method].mockRejectedValue(new ApiError(ErrorCodes[code], `safe ${_name}`));
        const res = response();
        await router.handle(request('GET', `/booking-sessions/${sessionId}/availability`, {
            headers: { 'x-synchintro-session-token': token },
            query: { start: '2026-09-08T00:00:00.000Z', end: '2026-09-09T00:00:00.000Z' }
        }), res);
        expect(res.statusCode).toBe(status);
        expect(res.body).toMatchObject({ success: false, code });
    });

    test('requires a bounded Idempotency-Key and capability for booking', async () => {
        const common = {
            headers: { 'content-type': 'application/json', 'x-synchintro-session-token': token },
            body: { session_version: 1, slot: availability.slots[0], guests: [] }
        };
        const res = response();
        await router.handle(request('POST', `/booking-sessions/${sessionId}/bookings`, common), res);
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe(ErrorCodes.INVALID_INPUT);
        expect(runtime.orchestrator.createBooking).not.toHaveBeenCalled();
    });

    test('creates a booking only through the orchestrator and returns the confirmed result', async () => {
        const body = { session_version: 1, slot: availability.slots[0], guests: [] };
        const res = response();
        await router.handle(request('POST', `/booking-sessions/${sessionId}/bookings`, {
            headers: {
                'content-type': 'application/json',
                'x-synchintro-session-token': token,
                'idempotency-key': idempotencyKey
            },
            body,
            rawBody: Buffer.from(JSON.stringify(body))
        }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, data: booking });
        expect(runtime.orchestrator.createBooking).toHaveBeenCalledWith({
            sessionId,
            idempotencyKey,
            request: body
        });
    });

    test.each([
        ['conflicting replay', 'CONFLICT', 409],
        ['stale session version', 'CONFLICT', 409],
        ['stale availability', 'CONFLICT', 409],
        ['slot not issued', 'CONFLICT', 409],
        ['provider failure', 'SCHEDULING_PROVIDER_REJECTED', 502],
        ['outcome unknown', 'AMBIGUOUS_PROVIDER_OUTCOME', 503],
        ['reconciliation required', 'BOOKING_RECONCILIATION_REQUIRED', 409],
        ['guest limit', 'VALIDATION_ERROR', 400]
    ])('preserves the safe booking error contract for %s', async (message, code, status) => {
        runtime.orchestrator.createBooking.mockRejectedValue(new ApiError(ErrorCodes[code], message));
        const body = { session_version: 1, slot: availability.slots[0], guests: [] };
        const res = response();
        await router.handle(request('POST', `/booking-sessions/${sessionId}/bookings`, {
            headers: {
                'content-type': 'application/json',
                'x-synchintro-session-token': token,
                'idempotency-key': idempotencyKey
            }, body
        }), res);
        expect(res.statusCode).toBe(status);
        expect(res.body).toEqual({ success: false, error: message, code });
    });

    test('never includes capability or idempotency key values in errors or logs', async () => {
        runtime.persistence.authorizeSessionCapability.mockRejectedValue(
            new ApiError(ErrorCodes.INVALID_SESSION_CAPABILITY, 'Invalid booking session capability')
        );
        const res = response();
        await router.handle(request('POST', `/booking-sessions/${sessionId}/bookings`, {
            headers: {
                'content-type': 'application/json',
                'x-synchintro-session-token': token,
                'idempotency-key': idempotencyKey
            },
            body: { session_version: 1, slot: availability.slots[0], guests: [] }
        }), res);

        const combined = JSON.stringify({ response: res.body, logs: errorLog.mock.calls });
        expect(combined).not.toContain(token);
        expect(combined).not.toContain(idempotencyKey);
    });
});
