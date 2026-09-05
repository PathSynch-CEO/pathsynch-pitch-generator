'use strict';

const {
    createNylasSchedulingProvider,
    loadNylasConfiguration
} = require('../../services/booking/nylasSchedulingProvider');
const {
    NylasHttpError,
    ERROR_CATEGORIES
} = require('../../services/booking/nylasHttpClient');

const config = Object.freeze({
    apiKey: 'unit-test-key-never-log',
    grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
    organizerEmail: 'hello@pathsynch.com',
    timezone: 'America/New_York',
    durationMinutes: 30,
    title: 'SynchIntro Strategy Call',
    calendarId: 'primary'
});

function response(status, payload, headers = {}) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] || null },
        body: null,
        text: async () => text
    };
}

function providerWith(fetchImpl, overrides = {}) {
    return createNylasSchedulingProvider(Object.assign({ config, fetchImpl }, overrides));
}

describe('Nylas scheduling REST adapter', () => {
    test('loads required environment configuration without exposing the API key as metadata', () => {
        const loaded = loadNylasConfiguration({
            NYLAS_API_KEY: config.apiKey,
            NYLAS_GRANT_ID: config.grantId,
            NYLAS_SCHEDULER_CONFIGURATION_ID: config.configurationId,
            NYLAS_EXPECTED_ORGANIZER: config.organizerEmail,
            NYLAS_EXPECTED_TIMEZONE: config.timezone,
            NYLAS_EXPECTED_DURATION_MINUTES: '30',
            NYLAS_EXPECTED_EVENT_TITLE: config.title
        });
        const provider = providerWith(jest.fn());
        expect(loaded.apiKey).toBe(config.apiKey);
        expect(JSON.stringify(provider.configuration)).not.toContain(config.apiKey);
    });

    test('normalizes availability, preserves the caller timezone, and sends documented query fields', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_1',
            data: { time_slots: [{ start_time: 1788872400, end_time: 1788874200 }] }
        }));
        const provider = providerWith(fetchImpl);
        const slots = await provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z',
            timezone: 'America/Los_Angeles'
        });

        expect(slots).toEqual([expect.objectContaining({
            id: expect.stringMatching(/^nyl_[a-f0-9]{32}$/),
            start: '2026-09-08T13:00:00.000Z',
            end: '2026-09-08T13:30:00.000Z',
            timezone: 'America/Los_Angeles'
        })]);
        const [url, request] = fetchImpl.mock.calls[0];
        expect(url.pathname).toBe('/v3/scheduling/availability');
        expect(url.searchParams.get('configuration_id')).toBe(config.configurationId);
        expect(url.searchParams.get('start_time')).toBe('1788868800');
        expect(request.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    });

    test('accepts empty availability', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_empty', data: { time_slots: [] }
        })));
        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).resolves.toEqual([]);
    });

    test('aborts an availability request at the configured timeout', async () => {
        let observedSignal;
        const fetchImpl = jest.fn((_url, options) => {
            observedSignal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            });
        });
        const provider = providerWith(fetchImpl, { timeoutMs: 5 });
        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.UNAVAILABLE });
        expect(observedSignal.aborted).toBe(true);
    });

    test('classifies rejection, timeout, malformed JSON, and oversized responses safely', async () => {
        const rejected = providerWith(jest.fn().mockResolvedValue(response(400, {
            request_id: 'req_bad', error: { type: 'invalid_request_error', message: config.apiKey }
        })));
        await expect(rejected.getAvailability({
            start: '2026-09-08T12:00:00.000Z', end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.REJECTED, status: 400 });

        const timeout = providerWith(jest.fn().mockRejectedValue(Object.assign(new Error('socket secret'), {
            name: 'AbortError'
        })));
        await expect(timeout.getAvailability({
            start: '2026-09-08T12:00:00.000Z', end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.UNAVAILABLE });

        const malformed = providerWith(jest.fn().mockResolvedValue(response(200, '{not-json')));
        await expect(malformed.getAvailability({
            start: '2026-09-08T12:00:00.000Z', end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });

        const oversized = providerWith(
            jest.fn().mockResolvedValue(response(200, { data: { time_slots: [] } }, { 'content-length': '9999' })),
            { maximumBytes: 100 }
        );
        await expect(oversized.getAvailability({
            start: '2026-09-08T12:00:00.000Z', end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test('creates once with the documented body and retrieves booking and primary-calendar event', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response(200, { data: {
                booking_id: '842becf5-eab6-4cb9-87ca-5638c31ba56e',
                event_id: 'event_1', status: 'booked'
            } }))
            .mockResolvedValueOnce(response(200, { data: {
                booking_id: '842becf5-eab6-4cb9-87ca-5638c31ba56e',
                event_id: 'event_1', status: 'booked'
            } }))
            .mockResolvedValueOnce(response(200, { data: {
                id: 'event_1', title: config.title, status: 'confirmed',
                organizer_email: config.organizerEmail, calendar_id: 'provider-calendar-id',
                participants: [{ email: 'buyer@example.com' }],
                when: {
                    object: 'timespan', start_time: 1788872400, end_time: 1788874200,
                    start_timezone: config.timezone, end_timezone: config.timezone
                }
            } }));
        const provider = providerWith(fetchImpl);
        const slot = {
            start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T13:30:00.000Z', timezone: config.timezone
        };
        const created = await provider.createBooking({
            slot,
            identity: { email: 'buyer@example.com', first_name: 'Buyer', last_name: 'Example' },
            guests: ['guest@example.com']
        });
        await expect(provider.getBooking({ bookingId: created.booking_id })).resolves.toMatchObject({
            event_id: 'event_1'
        });
        await expect(provider.getEvent({ eventId: created.event_id })).resolves.toMatchObject({
            event_id: 'event_1', calendar_id: 'primary', organizer_email: config.organizerEmail
        });

        const createCall = fetchImpl.mock.calls[0];
        expect(createCall[0].pathname).toBe('/v3/scheduling/bookings');
        expect(JSON.parse(createCall[1].body)).toEqual({
            start_time: 1788872400,
            end_time: 1788874200,
            guest: { name: 'Buyer Example', email: 'buyer@example.com' },
            timezone: config.timezone,
            additional_guests: [{ email: 'guest@example.com' }]
        });
        expect(fetchImpl.mock.calls[2][0].searchParams.get('calendar_id')).toBe('primary');
    });

    test('treats POST transport and malformed success responses as ambiguous without leaking secrets', async () => {
        const transport = providerWith(jest.fn().mockRejectedValue(new Error(`socket ${config.apiKey}`)));
        const input = {
            slot: { start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T13:30:00.000Z', timezone: config.timezone },
            identity: { email: 'buyer@example.com' }, guests: []
        };
        let caught;
        try {
            await transport.createBooking(input);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(NylasHttpError);
        expect(caught.category).toBe(ERROR_CATEGORIES.AMBIGUOUS);
        expect(JSON.stringify(caught)).not.toContain(config.apiKey);
        expect(caught.message).not.toContain(config.apiKey);

        const malformed = providerWith(jest.fn().mockResolvedValue(response(200, { data: { booking_id: 'only' } })));
        await expect(malformed.createBooking(input)).rejects.toMatchObject({
            category: ERROR_CATEGORIES.MALFORMED
        });
    });
});
