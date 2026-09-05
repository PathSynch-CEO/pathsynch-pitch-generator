'use strict';

const { createBookingOrchestrator } = require('../../services/booking/bookingOrchestrator');
const { NylasHttpError, ERROR_CATEGORIES } = require('../../services/booking/nylasHttpClient');
const { ApiError, ErrorCodes, createErrorResponse } = require('../../middleware/errorHandler');

const session = Object.freeze({
    session_id: 'bks_1',
    session_version: 2,
    availability_version: 1,
    timezone: 'America/New_York',
    identity: { email: 'buyer@example.com', provider: 'email', first_name: 'Buyer', last_name: 'Example' }
});

const slot = Object.freeze({
    id: 'slot_20260908_0900',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T13:30:00.000Z',
    timezone: 'America/New_York',
    availability_version: 2
});

const request = Object.freeze({ session_version: 2, slot, guests: ['guest@example.com'] });
const created = Object.freeze({ booking_id: 'booking_1', event_id: 'event_1', status: 'booked' });
const confirmed = Object.freeze({
    booking_id: 'booking_1', event_id: 'event_1', status: 'confirmed',
    title: 'SynchIntro Strategy Call', organizer_email: 'hello@pathsynch.com',
    attendee_emails: ['buyer@example.com', 'guest@example.com'],
    start: slot.start, end: slot.end, timezone: slot.timezone, duration_minutes: 30
});

function makeProvider(overrides = {}) {
    return Object.assign({
        name: 'nylas',
        configured: true,
        configuration: {
            grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
            configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
            organizerEmail: 'hello@pathsynch.com',
            timezone: 'America/New_York',
            durationMinutes: 30,
            title: 'SynchIntro Strategy Call',
            calendarId: 'primary'
        },
        getAvailability: jest.fn().mockResolvedValue([Object.assign({}, slot, { availability_version: undefined })]),
        createBooking: jest.fn().mockResolvedValue(created),
        getBooking: jest.fn().mockResolvedValue(created),
        getEvent: jest.fn().mockResolvedValue({
            event_id: created.event_id,
            title: confirmed.title,
            status: 'confirmed',
            organizer_email: confirmed.organizer_email,
            participant_emails: confirmed.attendee_emails,
            calendar_id: 'primary',
            start: slot.start,
            end: slot.end,
            start_timezone: slot.timezone,
            end_timezone: slot.timezone
        }),
        rescheduleBooking: jest.fn(),
        cancelBooking: jest.fn(),
        verifyWebhook: jest.fn()
    }, overrides);
}

function makePersistence(overrides = {}) {
    return Object.assign({
        readSession: jest.fn().mockResolvedValue(session),
        createAvailabilityReceipt: jest.fn().mockImplementation(async (input) => ({
            session_version: input.session_version,
            availability_version: 2,
            timezone: input.timezone,
            slots: input.slots.map((entry) => Object.assign({}, entry, { availability_version: 2 }))
        })),
        validateIssuedSlot: jest.fn().mockResolvedValue(slot),
        claimBookingOperation: jest.fn().mockResolvedValue({
            action: 'create', provider_create_authorized: true, claim_token: 'claim_1'
        }),
        beginProviderAttempt: jest.fn().mockResolvedValue({ state: 'PROVIDER_PENDING' }),
        confirmBookingOperation: jest.fn().mockResolvedValue({ state: 'CONFIRMED' }),
        markBookingFailed: jest.fn().mockResolvedValue({ state: 'FAILED' }),
        markBookingOutcomeUnknown: jest.fn().mockResolvedValue({ state: 'OUTCOME_UNKNOWN' }),
        claimBookingReconciliation: jest.fn()
    }, overrides);
}

function bookingInput(overrides = {}) {
    return Object.assign({
        sessionId: session.session_id,
        idempotencyKey: 'booking_key_1234567890',
        request
    }, overrides);
}

describe('SynchIntro booking orchestration', () => {
    test('fetches timezone-aware availability and issues a client-safe durable receipt', async () => {
        const provider = makeProvider();
        const persistence = makePersistence();
        const service = createBookingOrchestrator({ provider, persistence });
        const result = await service.getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        });

        expect(provider.getAvailability).toHaveBeenCalledWith(expect.objectContaining({
            timezone: session.timezone
        }));
        expect(persistence.createAvailabilityReceipt).toHaveBeenCalledWith(expect.objectContaining({
            session_id: session.session_id,
            provider_reference: { provider: 'nylas', configuration_id: provider.configuration.configurationId }
        }));
        expect(result).toEqual({
            session_version: 2,
            availability_version: 2,
            timezone: session.timezone,
            slots: [slot]
        });
        expect(JSON.stringify(result)).not.toContain('api');
    });

    test('issues a receipt for empty availability', async () => {
        const provider = makeProvider({ getAvailability: jest.fn().mockResolvedValue([]) });
        const persistence = makePersistence();
        const result = await createBookingOrchestrator({ provider, persistence }).getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        });
        expect(result.slots).toEqual([]);
        expect(persistence.createAvailabilityReceipt).toHaveBeenCalledWith(expect.objectContaining({ slots: [] }));
    });

    test.each([
        [ERROR_CATEGORIES.REJECTED, ErrorCodes.SCHEDULING_PROVIDER_REJECTED],
        [ERROR_CATEGORIES.UNAVAILABLE, ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE],
        [ERROR_CATEGORIES.MALFORMED, ErrorCodes.SCHEDULING_PROVIDER_MALFORMED_RESPONSE]
    ])('maps availability provider %s safely', async (category, expectedCode) => {
        const provider = makeProvider({
            getAvailability: jest.fn().mockRejectedValue(new NylasHttpError(category, 'availability'))
        });
        await expect(createBookingOrchestrator({ provider, persistence: makePersistence() }).getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).rejects.toMatchObject({ code: expectedCode });
    });

    test('creates once, verifies booking and event, then persists and returns CONFIRMED', async () => {
        const provider = makeProvider();
        const persistence = makePersistence();
        const result = await createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput());
        expect(result).toEqual(confirmed);
        expect(persistence.claimBookingOperation).toHaveBeenCalledWith(expect.objectContaining({
            attendee_emails: ['buyer@example.com', 'guest@example.com']
        }));
        expect(persistence.beginProviderAttempt).toHaveBeenCalledTimes(1);
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
        expect(provider.getBooking).toHaveBeenCalledWith({ bookingId: created.booking_id });
        expect(provider.getEvent).toHaveBeenCalledWith({ eventId: created.event_id });
        expect(persistence.confirmBookingOperation).toHaveBeenCalledWith(expect.objectContaining({
            confirmed_result: confirmed
        }));
    });

    test('replays CONFIRMED without provider calls', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            validateIssuedSlot: jest.fn().mockRejectedValue(new ApiError(ErrorCodes.CONFLICT, 'stale receipt')),
            claimBookingOperation: jest.fn().mockResolvedValue({ action: 'replay', booking: confirmed })
        });
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .resolves.toEqual(confirmed);
        expect(persistence.readSession).toHaveBeenCalledWith(session.session_id, { allowExpired: true });
        expect(persistence.validateIssuedSlot).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
        expect(provider.getBooking).not.toHaveBeenCalled();
    });

    test('a concurrent duplicate has no create authority and cannot create twice', async () => {
        let claims = 0;
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingOperation: jest.fn().mockImplementation(async () => {
                claims += 1;
                return claims === 1
                    ? { action: 'create', provider_create_authorized: true, claim_token: 'claim_1' }
                    : { action: 'in_progress', provider_create_authorized: false };
            })
        });
        const service = createBookingOrchestrator({ provider, persistence });
        const outcomes = await Promise.allSettled([
            service.createBooking(bookingInput()),
            service.createBooking(bookingInput())
        ]);
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.find((outcome) => outcome.status === 'rejected').reason.code)
            .toBe(ErrorCodes.BOOKING_RECONCILIATION_REQUIRED);
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
    });

    test('idempotency conflict fails before any provider call', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingOperation: jest.fn().mockRejectedValue(new ApiError(ErrorCodes.CONFLICT, 'conflict'))
        });
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test.each([
        ['stale session', new ApiError(ErrorCodes.CONFLICT, 'stale session')],
        ['stale receipt', new ApiError(ErrorCodes.CONFLICT, 'stale receipt')],
        ['unissued slot', new ApiError(ErrorCodes.CONFLICT, 'unissued slot')]
    ])('rejects %s atomically in the claim before provider create', async (_label, validationError) => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingOperation: jest.fn().mockRejectedValue(validationError)
        });
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
        expect(persistence.validateIssuedSlot).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('definite provider rejection becomes FAILED', async () => {
        const provider = makeProvider({
            createBooking: jest.fn().mockRejectedValue(
                new NylasHttpError(ERROR_CATEGORIES.REJECTED, 'create_booking', { status: 400 })
            )
        });
        const persistence = makePersistence();
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.SCHEDULING_PROVIDER_REJECTED });
        expect(persistence.markBookingFailed).toHaveBeenCalledTimes(1);
        expect(persistence.markBookingOutcomeUnknown).not.toHaveBeenCalled();
    });

    test('ambiguous create transport becomes OUTCOME_UNKNOWN and never retries', async () => {
        const provider = makeProvider({
            createBooking: jest.fn().mockRejectedValue(
                new NylasHttpError(ERROR_CATEGORIES.AMBIGUOUS, 'create_booking')
            )
        });
        const persistence = makePersistence();
        const service = createBookingOrchestrator({ provider, persistence });
        await expect(service.createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME
        });
        expect(persistence.markBookingOutcomeUnknown).toHaveBeenCalledTimes(1);
        expect(provider.createBooking).toHaveBeenCalledTimes(1);

        persistence.claimBookingOperation.mockResolvedValueOnce({
            action: 'reconcile', provider_create_authorized: false
        });
        await expect(service.createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED
        });
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
    });

    test('create success followed by failed verification is never CONFIRMED and preserves IDs', async () => {
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: 'Wrong title', status: 'confirmed', organizer_email: confirmed.organizer_email,
                participant_emails: confirmed.attendee_emails, calendar_id: 'primary',
                start: slot.start, end: slot.end,
                start_timezone: slot.timezone, end_timezone: slot.timezone
            })
        });
        const persistence = makePersistence();
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.BOOKING_VERIFICATION_FAILED });
        expect(persistence.confirmBookingOperation).not.toHaveBeenCalled();
        expect(persistence.markBookingOutcomeUnknown).toHaveBeenCalledWith(expect.objectContaining({
            provider_booking_id: created.booking_id,
            provider_event_id: created.event_id
        }));
    });

    test('known identifiers reconcile to CONFIRMED without issuing a second create', async () => {
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: confirmed.title, status: 'confirmed', organizer_email: confirmed.organizer_email,
                participant_emails: ['buyer@example.com'], calendar_id: 'primary',
                start: slot.start, end: slot.end,
                start_timezone: slot.timezone, end_timezone: slot.timezone
            })
        });
        const persistence = makePersistence({
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    session_id: session.session_id,
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id,
                    selected_slot: slot,
                    attendee_emails: ['buyer@example.com']
                }
            })
        });
        const result = await createBookingOrchestrator({ provider, persistence }).reconcileBooking({
            idempotencyKey: 'booking_key_1234567890'
        });
        expect(result).toEqual(Object.assign({}, confirmed, { attendee_emails: ['buyer@example.com'] }));
        expect(provider.createBooking).not.toHaveBeenCalled();
        expect(persistence.confirmBookingOperation).toHaveBeenCalledTimes(1);
    });

    test('unknown outcome without provider identifiers fails closed and never creates', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: { session_id: session.session_id, selected_slot: slot }
            })
        });
        await expect(createBookingOrchestrator({ provider, persistence }).reconcileBooking({
            idempotencyKey: 'booking_key_1234567890'
        })).rejects.toMatchObject({ code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED });
        expect(provider.createBooking).not.toHaveBeenCalled();
        expect(provider.getBooking).not.toHaveBeenCalled();
    });

    test('client-safe errors and persistence transitions contain no API key or raw response', async () => {
        const secret = 'nylas-secret-never-expose';
        const provider = makeProvider({
            createBooking: jest.fn().mockRejectedValue(
                new NylasHttpError(ERROR_CATEGORIES.AMBIGUOUS, 'create_booking', { message: 'safe transport failure' })
            )
        });
        const persistence = makePersistence();
        let error;
        try {
            await createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput());
        } catch (caught) {
            error = caught;
        }
        const serialized = JSON.stringify(createErrorResponse(error));
        expect(serialized).not.toContain(secret);
        expect(serialized.toLowerCase()).not.toContain('authorization');
        expect(JSON.stringify(persistence.markBookingOutcomeUnknown.mock.calls)).not.toContain('provider_payload');
        expect(persistence.markBookingOutcomeUnknown.mock.calls[0][0]).toEqual({
            idempotency_key: 'booking_key_1234567890',
            claim_token: 'claim_1',
            failure_code: 'nylas.create_outcome_unknown'
        });
    });
});
