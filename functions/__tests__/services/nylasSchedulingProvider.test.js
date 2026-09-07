'use strict';

const {
    createNylasSchedulingProvider,
    loadNylasConfiguration
} = require('../../services/booking/nylasSchedulingProvider');
const {
    NylasHttpError,
    ERROR_CATEGORIES
} = require('../../services/booking/nylasHttpClient');
const realSchedulerAvailabilityResponse = require('../fixtures/nylasSchedulerAvailabilityResponse.json');

const config = Object.freeze({
    apiKey: 'unit-test-key-never-log',
    grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
    organizerEmail: 'organizer@example.invalid',
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

function availabilitySlot(emails) {
    return { emails, start_time: 1788872400, end_time: 1788874200 };
}

const LARGE_AVAILABILITY_START = 1788739200;
const LARGE_AVAILABILITY_WINDOW = Object.freeze({
    start: '2026-09-07T00:00:00.000Z',
    end: '2026-09-13T00:00:00.000Z'
});

function availabilitySlots(count) {
    return Array.from({ length: count }, (_value, index) => {
        const startTime = LARGE_AVAILABILITY_START + (index * 15 * 60);
        return {
            emails: [config.organizerEmail],
            start_time: startTime,
            end_time: startTime + (config.durationMinutes * 60)
        };
    });
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
            data: { time_slots: [availabilitySlot([config.organizerEmail])] }
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
        expect(url.searchParams.get('end_time')).toBe('1788912000');
        expect(request.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    });

    test('rounds availability window bounds inward to whole Unix seconds', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_millisecond_window',
            data: { time_slots: [] }
        }));
        const provider = providerWith(fetchImpl);

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.901Z',
            end: '2026-09-09T00:00:00.901Z'
        })).resolves.toEqual([]);

        const [url] = fetchImpl.mock.calls[0];
        expect(url.searchParams.get('start_time')).toBe('1788868801');
        expect(url.searchParams.get('end_time')).toBe('1788912000');
    });

    test('normalizes availability bounds by instant independent of timezone offset', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_offset_window',
            data: { time_slots: [] }
        }));
        const provider = providerWith(fetchImpl);

        await provider.getAvailability({
            start: '2026-09-08T08:00:00.901-04:00',
            end: '2026-09-08T20:00:00.901-04:00'
        });

        const [url] = fetchImpl.mock.calls[0];
        expect(url.searchParams.get('start_time')).toBe('1788868801');
        expect(url.searchParams.get('end_time')).toBe('1788912000');
    });

    test('sends an exact PR #75-shaped 14-day millisecond window to the provider', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_ui_window',
            data: { time_slots: [] }
        }));
        const provider = providerWith(fetchImpl);

        await expect(provider.getAvailability({
            start: '2026-09-07T12:19:55.901Z',
            end: '2026-09-21T12:19:55.901Z'
        })).resolves.toEqual([]);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url] = fetchImpl.mock.calls[0];
        expect(url.searchParams.get('start_time')).toBe('1788783596');
        expect(url.searchParams.get('end_time')).toBe('1789993195');
    });

    test('fails before the provider request when inward rounding makes the window degenerate', async () => {
        const fetchImpl = jest.fn();
        const provider = providerWith(fetchImpl);

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.901Z',
            end: '2026-09-08T12:00:01.001Z'
        })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_INPUT' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('normalizes the current Scheduler availability data.time_slots response', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(
            200,
            realSchedulerAvailabilityResponse
        )));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z',
            timezone: 'America/New_York'
        })).resolves.toEqual([{
            id: expect.stringMatching(/^nyl_[a-f0-9]{32}$/),
            start: '2026-09-08T13:00:00.000Z',
            end: '2026-09-08T13:30:00.000Z',
            timezone: 'America/New_York'
        }]);
    });

    test('matches the expected organizer case-insensitively', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_case_insensitive',
            data: { time_slots: [availabilitySlot(['ORGANIZER@EXAMPLE.INVALID'])] }
        })));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).resolves.toHaveLength(1);
    });

    test('accepts multiple valid participants when they include the expected organizer', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_multiple_participants',
            data: { time_slots: [availabilitySlot(['guest@example.invalid', config.organizerEmail])] }
        })));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).resolves.toHaveLength(1);
    });

    test.each([
        ['missing', undefined],
        ['null', null],
        ['not an array', config.organizerEmail],
        ['empty', []],
        ['containing a malformed entry', [config.organizerEmail, 'not-an-email']],
        ['omitting the expected organizer', ['other@example.invalid']]
    ])('rejects availability emails that are %s', async (_label, emails) => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_invalid_emails',
            data: { time_slots: [availabilitySlot(emails)] }
        })));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
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

    test('rejects the undocumented direct data-array shape as malformed', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_wrong_wrapper', data: []
        })));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test.each([
        ['missing time_slots', {}],
        ['null time_slots', { time_slots: null }],
        ['non-array time_slots', { time_slots: {} }]
    ])('rejects a data object with %s', async (_label, data) => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_invalid_time_slots', data
        })));

        await expect(provider.getAvailability({
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test('accepts the sanitized live cardinality of 319 valid slots', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_live_cardinality',
            data: { time_slots: availabilitySlots(319) }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW)).resolves.toHaveLength(319);
    });

    test('accepts exactly 512 valid slots', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_at_slot_limit',
            data: { time_slots: availabilitySlots(512) }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW)).resolves.toHaveLength(512);
    });

    test('rejects 513 slots without truncating the provider response', async () => {
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_over_slot_limit',
            data: { time_slots: availabilitySlots(513) }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW))
            .rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test('applies organizer validation to every slot in the accepted array', async () => {
        const slots = availabilitySlots(512);
        slots[slots.length - 1].emails = ['other@example.invalid'];
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_late_organizer_mismatch',
            data: { time_slots: slots }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW))
            .rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test('rejects a malformed candidate anywhere in the accepted array', async () => {
        const slots = availabilitySlots(512);
        slots[slots.length - 1] = null;
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_late_malformed_candidate',
            data: { time_slots: slots }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW))
            .rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test('detects a duplicate across the full accepted array', async () => {
        const slots = availabilitySlots(512);
        slots[slots.length - 1] = Object.assign({}, slots[0]);
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_late_duplicate',
            data: { time_slots: slots }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW))
            .rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
    });

    test.each([
        ['a non-integer start timestamp', (candidate) => Object.assign({}, candidate, {
            start_time: String(candidate.start_time)
        })],
        ['a non-integer end timestamp', (candidate) => Object.assign({}, candidate, {
            end_time: candidate.end_time + 0.5
        })],
        ['the wrong duration', (candidate) => Object.assign({}, candidate, {
            end_time: candidate.start_time + (15 * 60)
        })],
        ['a slot outside the requested window', (candidate) => Object.assign({}, candidate, {
            start_time: Date.parse(LARGE_AVAILABILITY_WINDOW.end) / 1000,
            end_time: (Date.parse(LARGE_AVAILABILITY_WINDOW.end) / 1000) + (30 * 60)
        })]
    ])('preserves strict rejection for %s late in the accepted array', async (_label, invalidate) => {
        const slots = availabilitySlots(512);
        slots[slots.length - 1] = invalidate(slots[slots.length - 1]);
        const provider = providerWith(jest.fn().mockResolvedValue(response(200, {
            request_id: 'req_strict_slot_validation',
            data: { time_slots: slots }
        })));

        await expect(provider.getAvailability(LARGE_AVAILABILITY_WINDOW))
            .rejects.toMatchObject({ category: ERROR_CATEGORIES.MALFORMED });
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
            jest.fn().mockResolvedValue(response(200, { data: { time_slots: [] } }, {
                'content-length': '9999'
            })),
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
                organizer: { email: config.organizerEmail }, calendar_id: 'provider-calendar-id',
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

    test.each([429, 500, 504])('treats POST HTTP %s as ambiguous and never retries', async (status) => {
        const fetchImpl = jest.fn().mockResolvedValue(response(status, {
            error: { type: 'provider_error', message: 'provider detail is not propagated' }
        }));
        const provider = providerWith(fetchImpl);
        await expect(provider.createBooking({
            slot: {
                start: '2026-09-08T13:00:00.000Z',
                end: '2026-09-08T13:30:00.000Z',
                timezone: config.timezone
            },
            identity: { email: 'buyer@example.com' },
            guests: []
        })).rejects.toMatchObject({ category: ERROR_CATEGORIES.AMBIGUOUS, status });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
