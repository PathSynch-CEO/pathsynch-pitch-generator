'use strict';

const { createBookingOrchestrator } = require('../../services/booking/bookingOrchestrator');
const { bookingRequestFingerprint } = require('../../services/booking/bookingContract');
const { NylasHttpError, ERROR_CATEGORIES } = require('../../services/booking/nylasHttpClient');
const { createNylasSchedulingProvider } = require('../../services/booking/nylasSchedulingProvider');
const { ApiError, ErrorCodes, createErrorResponse } = require('../../middleware/errorHandler');

const session = Object.freeze({
    session_id: 'bks_1',
    session_version: 2,
    availability_version: 1,
    timezone: 'America/New_York',
    identity: { email: 'buyer@example.com', provider: 'email', first_name: 'Buyer', last_name: 'Example' },
    routing_state: { owner_id: 'charles_uid', workspace_id: 'pathsynch_workspace' },
    specialist: {
        id: 'spc_charles_fixture', display_name: 'Charles Berry', title: 'Founder & CEO',
        avatar_url: null, initials: 'CB', timezone: 'America/New_York'
    }
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
            minimumNoticeMinutes: 0,
            noticeSafetyMarginMinutes: 0,
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
            participant_emails: [...confirmed.attendee_emails, confirmed.organizer_email],
            calendar_id: 'primary',
            start: slot.start,
            end: slot.end,
            start_timezone: slot.timezone,
            end_timezone: slot.timezone
        }),
        rescheduleBooking: jest.fn(),
        cancelBooking: jest.fn(),
        verifyWebhook: jest.fn(),
        assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true })
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
        readBookingOperation: jest.fn().mockRejectedValue(
            new ApiError(ErrorCodes.NOT_FOUND, 'Booking operation not found')
        ),
        validateIssuedSlot: jest.fn().mockResolvedValue(slot),
        claimBookingOperation: jest.fn().mockResolvedValue({
            action: 'create', provider_create_authorized: true, claim_token: 'claim_1'
        }),
        beginProviderAttempt: jest.fn().mockResolvedValue({ state: 'PROVIDER_PENDING' }),
        recordProviderIdentifiers: jest.fn().mockResolvedValue({ state: 'PROVIDER_PENDING' }),
        confirmBookingOperation: jest.fn().mockResolvedValue({ state: 'CONFIRMED' }),
        markBookingFailed: jest.fn().mockResolvedValue({ state: 'FAILED' }),
        markBookingOutcomeUnknown: jest.fn().mockResolvedValue({ state: 'OUTCOME_UNKNOWN' }),
        claimBookingReconciliation: jest.fn(),
        claimConfirmationDelivery: jest.fn().mockResolvedValue({
            action: 'prepare', delivery_authorized: false, delivery_prepare_authorized: true,
            delivery_token: 'delivery_1', confirmation_delivery_id: 'cnf_1', delivery_attempt_id: 'dla_1'
        }),
        beginConfirmationDelivery: jest.fn().mockResolvedValue({
            action: 'send', delivery_authorized: true, delivery_token: 'delivery_1',
            confirmation_delivery_id: 'cnf_1', delivery_attempt_id: 'dla_1'
        }),
        markConfirmationDeliverySent: jest.fn().mockResolvedValue({ confirmation_delivery_state: 'SENT' }),
        markConfirmationDeliveryOutcomeUnknown: jest.fn().mockResolvedValue({
            confirmation_delivery_state: 'OUTCOME_UNKNOWN'
        })
    }, overrides);
}

function bookingInput(overrides = {}) {
    return Object.assign({
        sessionId: session.session_id,
        idempotencyKey: 'booking_key_1234567890',
        request
    }, overrides);
}

function providerResponse(payload) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        text: async () => JSON.stringify(payload)
    };
}

describe('SynchIntro booking orchestration', () => {
    test('fetches timezone-aware availability and issues a client-safe durable receipt', async () => {
        const provider = makeProvider();
        const persistence = makePersistence();
        const service = createBookingOrchestrator({
            provider, persistence, now: () => new Date('2026-09-08T12:00:00.000Z')
        });
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
        ['more than 65 minutes', '2026-09-08T13:00:01.000Z', true],
        ['exactly 65 minutes', '2026-09-08T13:00:00.000Z', true],
        ['64 minutes 59 seconds', '2026-09-08T12:59:59.000Z', false]
    ])('%s from now follows the inclusive availability notice boundary', async (_label, start, issued) => {
        const candidate = Object.assign({}, slot, {
            id: `slot_${Date.parse(start)}`,
            start,
            end: new Date(Date.parse(start) + (30 * 60 * 1000)).toISOString(),
            availability_version: undefined
        });
        const baseProvider = makeProvider();
        const provider = makeProvider({
            configuration: Object.assign({}, baseProvider.configuration, {
                minimumNoticeMinutes: 60,
                noticeSafetyMarginMinutes: 5
            }),
            getAvailability: jest.fn().mockResolvedValue([candidate])
        });
        const persistence = makePersistence();
        const result = await createBookingOrchestrator({
            provider,
            persistence,
            now: () => new Date('2026-09-08T11:55:00.000Z')
        }).getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T11:55:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        });

        expect(result.slots).toHaveLength(issued ? 1 : 0);
        expect(persistence.createAvailabilityReceipt).toHaveBeenCalledWith(expect.objectContaining({
            slots: issued ? [candidate] : []
        }));
    });

    test('filters only near-start slots and persists a valid empty result when none remain', async () => {
        const candidates = [
            Object.assign({}, slot, {
                id: 'slot_near', start: '2026-09-08T12:59:59.000Z', end: '2026-09-08T13:29:59.000Z'
            }),
            Object.assign({}, slot, {
                id: 'slot_safe', start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T13:30:00.000Z'
            })
        ];
        const baseProvider = makeProvider();
        const provider = makeProvider({
            configuration: Object.assign({}, baseProvider.configuration, {
                minimumNoticeMinutes: 60,
                noticeSafetyMarginMinutes: 5
            }),
            getAvailability: jest.fn().mockResolvedValue(candidates)
        });
        const persistence = makePersistence();
        const service = createBookingOrchestrator({
            provider,
            persistence,
            now: () => new Date('2026-09-08T11:55:00.000Z')
        });

        await expect(service.getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T11:55:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).resolves.toMatchObject({ slots: [expect.objectContaining({ id: 'slot_safe' })] });
        expect(persistence.createAvailabilityReceipt).toHaveBeenLastCalledWith(expect.objectContaining({
            slots: [candidates[1]]
        }));

        provider.getAvailability.mockResolvedValueOnce([candidates[0]]);
        await expect(service.getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T11:55:00.000Z',
            end: '2026-09-09T00:00:00.000Z'
        })).resolves.toMatchObject({ slots: [] });
        expect(persistence.createAvailabilityReceipt).toHaveBeenLastCalledWith(expect.objectContaining({ slots: [] }));
    });

    test('issues a durable receipt for a PR #75-shaped millisecond window through the Nylas adapter', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(providerResponse({
            request_id: 'req_ui_window',
            data: { time_slots: [{
                emails: ['hello@pathsynch.com'],
                start_time: 1788872400,
                end_time: 1788874200
            }] }
        }));
        const provider = createNylasSchedulingProvider({
            fetchImpl,
            config: {
                apiKey: 'unit-test-key-never-log',
                grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
                configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                organizerEmail: 'hello@pathsynch.com',
                timezone: 'America/New_York',
                durationMinutes: 30,
                minimumNoticeMinutes: 0,
                noticeSafetyMarginMinutes: 0,
                title: 'SynchIntro Strategy Call',
                calendarId: 'primary'
            }
        });
        const persistence = makePersistence();

        const result = await createBookingOrchestrator({
            provider, persistence, now: () => new Date('2026-09-07T12:19:55.901Z')
        }).getAvailability({
            sessionId: session.session_id,
            start: '2026-09-07T12:19:55.901Z',
            end: '2026-09-21T12:19:55.901Z'
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url] = fetchImpl.mock.calls[0];
        expect(url.searchParams.get('start_time')).toBe('1788783596');
        expect(url.searchParams.get('end_time')).toBe('1789993195');
        expect(persistence.createAvailabilityReceipt).toHaveBeenCalledWith(expect.objectContaining({
            session_id: session.session_id,
            session_version: session.session_version,
            slots: [expect.objectContaining({
                start: slot.start,
                end: slot.end,
                timezone: session.timezone
            })]
        }));
        expect(result).toEqual(expect.objectContaining({
            availability_version: 2,
            slots: [expect.objectContaining({
                start: slot.start,
                end: slot.end,
                availability_version: 2
            })]
        }));
    });

    test('maps an availability window collapsed by inward rounding to client input without provider I/O', async () => {
        const fetchImpl = jest.fn();
        const provider = createNylasSchedulingProvider({
            fetchImpl,
            config: {
                apiKey: 'unit-test-key-never-log',
                grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
                configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                organizerEmail: 'hello@pathsynch.com',
                timezone: 'America/New_York',
                durationMinutes: 30,
                minimumNoticeMinutes: 0,
                noticeSafetyMarginMinutes: 0,
                title: 'SynchIntro Strategy Call',
                calendarId: 'primary'
            }
        });
        const persistence = makePersistence();

        await expect(createBookingOrchestrator({ provider, persistence }).getAvailability({
            sessionId: session.session_id,
            start: '2026-09-08T12:00:00.901Z',
            end: '2026-09-08T12:00:01.001Z'
        })).rejects.toMatchObject({
            code: ErrorCodes.INVALID_INPUT,
            status: 400,
            message: 'Availability window is invalid'
        });

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(persistence.createAvailabilityReceipt).not.toHaveBeenCalled();
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
            attendee_emails: ['buyer@example.com', 'guest@example.com'],
            confirmation_identity: session.identity,
            specialist: session.specialist,
            minimum_notice_minutes: 0,
            provider_reference: {
                provider: 'nylas',
                configuration_id: provider.configuration.configurationId
            }
        }));
        expect(persistence.beginProviderAttempt).toHaveBeenCalledTimes(1);
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
        expect(persistence.recordProviderIdentifiers).toHaveBeenCalledWith({
            idempotency_key: 'booking_key_1234567890',
            claim_token: 'claim_1',
            provider_booking_id: created.booking_id,
            provider_event_id: created.event_id
        });
        expect(provider.getBooking).toHaveBeenCalledWith({ bookingId: created.booking_id });
        expect(provider.getEvent).toHaveBeenCalledWith({ eventId: created.event_id });
        expect(persistence.confirmBookingOperation).toHaveBeenCalledWith(expect.objectContaining({
            confirmed_result: confirmed
        }));
        expect(provider.assertCustomerEmailsDisabled).toHaveBeenCalledTimes(1);
    });

    test('fails before claiming or creating when Nylas confirmation emails are enabled', async () => {
        const provider = makeProvider({
            assertCustomerEmailsDisabled: jest.fn().mockRejectedValue(
                Object.assign(new Error('provider emails enabled'), { code: 'PROVIDER_EMAILS_ENABLED' })
            )
        });
        const persistence = makePersistence();
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE });
        expect(persistence.claimBookingOperation).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('never replays a confirmed booking while governed recovery is unresolved', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({
                state: 'CONFIRMED',
                cancellation_state: 'CONFIRMED',
                synthetic_recovery_state: 'RECONCILIATION_REQUIRED',
                session_id: session.session_id,
                request_fingerprint: bookingRequestFingerprint(request),
                confirmed_result: confirmed
            })
        });
        const mailer = { sendConfirmation: jest.fn() };
        await expect(createBookingOrchestrator({ provider, persistence, mailer }).createBooking(bookingInput()))
            .rejects.toMatchObject({
                code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                details: { reason: 'governed_recovery_unresolved' }
            });
        expect(persistence.claimConfirmationDelivery).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('fails closed when a session specialist no longer matches the canonical route', async () => {
        const provider = makeProvider();
        const persistence = makePersistence();
        const hostDirectory = { resolve: jest.fn().mockResolvedValue({
            specialist: Object.assign({}, session.specialist, { id: 'spc_different' }),
            policy: { timezone: 'America/New_York', weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 960 }
        }) };
        await expect(createBookingOrchestrator({ provider, persistence, hostDirectory })
            .createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.CONFLICT, details: { reason: 'booking_specialist_changed' }
        });
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('sends exactly one branded confirmation across booking and idempotent replay', async () => {
        const notFound = new ApiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
        const persistence = makePersistence({
            readBookingOperation: jest.fn()
                .mockRejectedValueOnce(notFound)
                .mockResolvedValue({
                    state: 'CONFIRMED', session_id: session.session_id,
                    request_fingerprint: bookingRequestFingerprint(request), confirmed_result: confirmed
                }),
            claimConfirmationDelivery: jest.fn()
                .mockResolvedValueOnce({
                    action: 'prepare', delivery_authorized: false, delivery_prepare_authorized: true,
                    delivery_token: 'delivery_1', confirmation_delivery_id: 'cnf_1', delivery_attempt_id: 'dla_1'
                })
                .mockResolvedValueOnce({ action: 'already_sent', delivery_authorized: false })
        });
        const provider = makeProvider();
        const mailer = { sendConfirmation: jest.fn().mockResolvedValue({ provider_message_id: 'sendgrid_message_1' }) };
        const hostDirectory = { resolve: jest.fn().mockResolvedValue({
            specialist: session.specialist,
            policy: { timezone: 'America/New_York', weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 960 }
        }) };
        const service = createBookingOrchestrator({ provider, persistence, mailer, hostDirectory });

        await expect(service.createBooking(bookingInput())).resolves.toEqual(confirmed);
        await expect(service.createBooking(bookingInput())).resolves.toEqual(confirmed);

        expect(provider.createBooking).toHaveBeenCalledTimes(1);
        expect(mailer.sendConfirmation).toHaveBeenCalledTimes(1);
        expect(mailer.sendConfirmation).toHaveBeenCalledWith({
            booking: confirmed,
            identity: session.identity,
            specialist: session.specialist,
            delivery: { confirmation_id: 'cnf_1', attempt_id: 'dla_1' }
        });
        expect(persistence.markConfirmationDeliverySent).toHaveBeenCalledTimes(1);
        expect(persistence.markConfirmationDeliverySent).toHaveBeenCalledWith({
            idempotency_key: 'booking_key_1234567890',
            delivery_token: 'delivery_1',
            provider_message_id: 'sendgrid_message_1'
        });
    });

    test('an ambiguous confirmation outcome enters reconciliation and never blindly resends', async () => {
        const notFound = new ApiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
        const persistence = makePersistence({
            readBookingOperation: jest.fn()
                .mockRejectedValueOnce(notFound)
                .mockResolvedValue({
                    state: 'CONFIRMED', session_id: session.session_id,
                    request_fingerprint: bookingRequestFingerprint(request), confirmed_result: confirmed,
                    confirmation_identity: session.identity, specialist: session.specialist
                }),
            claimConfirmationDelivery: jest.fn()
                .mockResolvedValueOnce({
                    action: 'prepare', delivery_authorized: false, delivery_prepare_authorized: true,
                    delivery_token: 'delivery_1', confirmation_delivery_id: 'cnf_1', delivery_attempt_id: 'dla_1'
                })
                .mockResolvedValueOnce({
                    action: 'reconcile', delivery_authorized: false,
                    confirmation_delivery_state: 'RECONCILIATION_REQUIRED'
                })
        });
        const provider = makeProvider();
        const mailer = { sendConfirmation: jest.fn().mockRejectedValue(new Error('ambiguous provider outcome')) };
        const hostDirectory = { resolve: jest.fn().mockResolvedValue({
            specialist: session.specialist,
            policy: { timezone: 'America/New_York', weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 960 }
        }) };
        const service = createBookingOrchestrator({ provider, persistence, mailer, hostDirectory });

        await expect(service.createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME
        });
        await expect(service.createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED
        });

        expect(provider.createBooking).toHaveBeenCalledTimes(1);
        expect(mailer.sendConfirmation).toHaveBeenCalledTimes(1);
        expect(persistence.beginConfirmationDelivery).toHaveBeenCalledTimes(1);
        expect(persistence.markConfirmationDeliveryOutcomeUnknown).toHaveBeenCalledTimes(1);
    });

    test('replays CONFIRMED without provider calls', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({
                state: 'CONFIRMED',
                session_id: session.session_id,
                request_fingerprint: bookingRequestFingerprint(request),
                confirmed_result: confirmed
            }),
            readSession: jest.fn().mockRejectedValue(new ApiError(ErrorCodes.NOT_FOUND, 'Booking session not found'))
        });
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .resolves.toEqual(confirmed);
        expect(persistence.readSession).not.toHaveBeenCalled();
        expect(persistence.claimBookingOperation).not.toHaveBeenCalled();
        expect(persistence.validateIssuedSlot).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
        expect(provider.getBooking).not.toHaveBeenCalled();
    });

    test.each([
        ['CANCELLED', ErrorCodes.CONFLICT, 'booking_cancelled'],
        ['PENDING', ErrorCodes.BOOKING_RECONCILIATION_REQUIRED, 'booking_cancellation_unresolved'],
        ['CANCELLING', ErrorCodes.BOOKING_RECONCILIATION_REQUIRED, 'booking_cancellation_unresolved'],
        ['RECONCILIATION_REQUIRED', ErrorCodes.BOOKING_RECONCILIATION_REQUIRED, 'booking_cancellation_unresolved']
    ])('never replays a confirmed booking or sends its original email while cancellation is %s', async (
        cancellationState,
        expectedCode,
        expectedReason
    ) => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({
                state: 'CONFIRMED',
                cancellation_state: cancellationState,
                session_id: session.session_id,
                request_fingerprint: bookingRequestFingerprint(request),
                confirmed_result: confirmed
            })
        });
        const mailer = { sendConfirmation: jest.fn() };

        await expect(createBookingOrchestrator({ provider, persistence, mailer }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: expectedCode, details: { reason: expectedReason } });
        expect(persistence.claimConfirmationDelivery).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('fails closed when cancellation begins between confirmed replay read and delivery claim', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({
                state: 'CONFIRMED', cancellation_state: 'CONFIRMED',
                session_id: session.session_id,
                request_fingerprint: bookingRequestFingerprint(request),
                confirmed_result: confirmed
            }),
            claimConfirmationDelivery: jest.fn().mockResolvedValue({
                action: 'suppressed_by_cancellation',
                cancellation_state: 'CANCELLED',
                delivery_authorized: false
            })
        });
        const mailer = { sendConfirmation: jest.fn() };

        await expect(createBookingOrchestrator({ provider, persistence, mailer }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.CONFLICT, details: { reason: 'booking_cancelled' } });
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('replays a sent confirmation without a retained session or live host', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({
                state: 'CONFIRMED', session_id: session.session_id,
                request_fingerprint: bookingRequestFingerprint(request), confirmed_result: confirmed,
                confirmation_delivery_state: 'SENT'
            }),
            readSession: jest.fn().mockRejectedValue(new ApiError(ErrorCodes.NOT_FOUND, 'Booking session not found')),
            claimConfirmationDelivery: jest.fn().mockResolvedValue({
                action: 'already_sent', delivery_authorized: false
            })
        });
        const mailer = { sendConfirmation: jest.fn() };
        const hostDirectory = { resolve: jest.fn().mockRejectedValue(new Error('host disabled')) };
        await expect(createBookingOrchestrator({ provider, persistence, mailer, hostDirectory })
            .createBooking(bookingInput())).resolves.toEqual(confirmed);
        expect(persistence.readSession).not.toHaveBeenCalled();
        expect(hostDirectory.resolve).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
    });

    test('a claim-time confirmed race uses the durable confirmation context', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingOperation: jest.fn().mockResolvedValue({
                action: 'replay', booking: confirmed,
                operation: { confirmation_identity: session.identity, specialist: session.specialist }
            })
        });
        const mailer = { sendConfirmation: jest.fn().mockResolvedValue(undefined) };
        await expect(createBookingOrchestrator({ provider, persistence, mailer })
            .createBooking(bookingInput())).resolves.toEqual(confirmed);
        expect(provider.createBooking).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).toHaveBeenCalledWith({
            booking: confirmed, identity: session.identity, specialist: session.specialist,
            delivery: { confirmation_id: 'cnf_1', attempt_id: 'dla_1' }
        });
    });

    test('claim-time replay cannot return a confirmed result after cancellation wins the race', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({ state: 'PROVIDER_PENDING' }),
            claimBookingOperation: jest.fn().mockResolvedValue({
                action: 'replay', booking: confirmed,
                operation: {
                    cancellation_state: 'CANCELLED',
                    confirmation_identity: session.identity,
                    specialist: session.specialist
                }
            })
        });
        const mailer = { sendConfirmation: jest.fn() };

        await expect(createBookingOrchestrator({ provider, persistence, mailer }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.CONFLICT, details: { reason: 'booking_cancelled' } });
        expect(persistence.claimConfirmationDelivery).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('claim-time replay cannot return confirmed after governed recovery wins the race', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            readBookingOperation: jest.fn().mockResolvedValue({ state: 'PROVIDER_PENDING' }),
            claimBookingOperation: jest.fn().mockResolvedValue({
                action: 'replay', booking: confirmed,
                operation: {
                    cancellation_state: 'CONFIRMED',
                    synthetic_recovery_state: 'PROVIDER_ATTEMPTING',
                    confirmation_identity: session.identity,
                    specialist: session.specialist
                }
            })
        });
        const mailer = { sendConfirmation: jest.fn() };
        await expect(createBookingOrchestrator({ provider, persistence, mailer }).createBooking(bookingInput()))
            .rejects.toMatchObject({
                code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                details: { reason: 'governed_recovery_unresolved' }
            });
        expect(persistence.claimConfirmationDelivery).not.toHaveBeenCalled();
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
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

    test('unexpected provider attendees fail exact intent verification', async () => {
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: confirmed.title, status: 'confirmed', organizer_email: confirmed.organizer_email,
                participant_emails: [...confirmed.attendee_emails, 'unexpected@example.com'], calendar_id: 'primary',
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

    test('missing event confirmation status fails closed', async () => {
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: confirmed.title, status: null, organizer_email: confirmed.organizer_email,
                participant_emails: confirmed.attendee_emails, calendar_id: 'primary',
                start: slot.start, end: slot.end,
                start_timezone: slot.timezone, end_timezone: slot.timezone
            })
        });
        const persistence = makePersistence();
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.BOOKING_VERIFICATION_FAILED });
        expect(persistence.confirmBookingOperation).not.toHaveBeenCalled();
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
    });

    test('missing Scheduler booking status fails closed', async () => {
        const bookingWithoutStatus = Object.freeze(Object.assign({}, created, { status: null }));
        const provider = makeProvider({
            getBooking: jest.fn().mockResolvedValue(bookingWithoutStatus)
        });
        const persistence = makePersistence();
        await expect(createBookingOrchestrator({ provider, persistence }).createBooking(bookingInput()))
            .rejects.toMatchObject({ code: ErrorCodes.BOOKING_VERIFICATION_FAILED });
        expect(persistence.confirmBookingOperation).not.toHaveBeenCalled();
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
    });

    test('rejects a slot whose timezone differs from the authoritative host policy', async () => {
        const pacificSlot = Object.freeze(Object.assign({}, slot, { timezone: 'America/Los_Angeles' }));
        const pacificSession = Object.freeze(Object.assign({}, session, { timezone: pacificSlot.timezone }));
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: confirmed.title, status: 'confirmed', organizer_email: confirmed.organizer_email,
                participant_emails: confirmed.attendee_emails, calendar_id: 'primary',
                start: pacificSlot.start, end: pacificSlot.end,
                start_timezone: pacificSlot.timezone, end_timezone: pacificSlot.timezone
            })
        });
        const persistence = makePersistence({
            readSession: jest.fn().mockResolvedValue(pacificSession),
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id,
                    selected_slot: pacificSlot,
                    attendee_emails: confirmed.attendee_emails,
                    provider_reference: {
                        provider: 'nylas',
                        configuration_id: provider.configuration.configurationId
                    }
                }
            })
        });
        const service = createBookingOrchestrator({ provider, persistence });
        const pacificRequest = Object.assign({}, request, { slot: pacificSlot });
        await expect(service.createBooking(bookingInput({ request: pacificRequest })))
            .rejects.toMatchObject({ code: ErrorCodes.CONFLICT, details: { reason: 'timezone_mismatch' } });
        expect(provider.createBooking).not.toHaveBeenCalled();
    });

    test('confirmation persistence failure retains IDs for reconciliation without another create', async () => {
        let retainedIdentifiers;
        const provider = makeProvider();
        const persistence = makePersistence({
            recordProviderIdentifiers: jest.fn().mockImplementation(async (input) => {
                retainedIdentifiers = input;
                return { state: 'PROVIDER_PENDING' };
            }),
            confirmBookingOperation: jest.fn()
                .mockRejectedValueOnce(new ApiError(ErrorCodes.DATABASE_ERROR, 'Database error'))
                .mockResolvedValueOnce({ state: 'CONFIRMED' }),
            claimBookingReconciliation: jest.fn().mockImplementation(async () => ({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    provider_booking_id: retainedIdentifiers.provider_booking_id,
                    provider_event_id: retainedIdentifiers.provider_event_id,
                    selected_slot: slot,
                    attendee_emails: confirmed.attendee_emails,
                    provider_reference: {
                        provider: 'nylas',
                        configuration_id: provider.configuration.configurationId
                    }
                }
            }))
        });
        const service = createBookingOrchestrator({ provider, persistence });
        await expect(service.createBooking(bookingInput())).rejects.toMatchObject({
            code: ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME
        });
        await expect(service.reconcileBooking({ idempotencyKey: 'booking_key_1234567890' }))
            .resolves.toEqual(confirmed);
        expect(provider.createBooking).toHaveBeenCalledTimes(1);
        expect(persistence.recordProviderIdentifiers).toHaveBeenCalledTimes(1);
    });

    test('known identifiers reconcile to CONFIRMED without issuing a second create', async () => {
        const provider = makeProvider({
            getEvent: jest.fn().mockResolvedValue({
                event_id: created.event_id,
                title: confirmed.title, status: 'confirmed', organizer_email: confirmed.organizer_email,
                participant_emails: ['buyer@example.com', confirmed.organizer_email], calendar_id: 'primary',
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
                    attendee_emails: ['buyer@example.com'],
                    provider_reference: {
                        provider: 'nylas',
                        configuration_id: provider.configuration.configurationId
                    }
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

    test('reconciliation sends the branded confirmation from durable operation context', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id,
                    selected_slot: slot,
                    attendee_emails: confirmed.attendee_emails,
                    confirmation_identity: session.identity,
                    specialist: session.specialist,
                    provider_reference: {
                        provider: 'nylas', configuration_id: provider.configuration.configurationId
                    }
                }
            })
        });
        const mailer = { sendConfirmation: jest.fn().mockResolvedValue(undefined) };
        await expect(createBookingOrchestrator({ provider, persistence, mailer }).reconcileBooking({
            idempotencyKey: 'booking_key_1234567890'
        })).resolves.toEqual(confirmed);
        expect(mailer.sendConfirmation).toHaveBeenCalledWith({
            booking: confirmed, identity: session.identity, specialist: session.specialist,
            delivery: { confirmation_id: 'cnf_1', attempt_id: 'dla_1' }
        });
        expect(persistence.markConfirmationDeliverySent).toHaveBeenCalledTimes(1);
    });

    test('reconciliation does not send a second confirmation for legacy operations without durable context', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id,
                    selected_slot: slot,
                    attendee_emails: confirmed.attendee_emails,
                    provider_reference: {
                        provider: 'nylas', configuration_id: provider.configuration.configurationId
                    }
                }
            }),
            claimConfirmationDelivery: jest.fn().mockResolvedValue({
                action: 'legacy', delivery_authorized: false
            })
        });
        const mailer = { sendConfirmation: jest.fn().mockResolvedValue(undefined) };

        await expect(createBookingOrchestrator({ provider, persistence, mailer }).reconcileBooking({
            idempotencyKey: 'booking_key_1234567890'
        })).resolves.toEqual(confirmed);
        expect(mailer.sendConfirmation).not.toHaveBeenCalled();
        expect(persistence.markConfirmationDeliverySent).not.toHaveBeenCalled();
        expect(persistence.markConfirmationDeliveryOutcomeUnknown).not.toHaveBeenCalled();
    });

    test('reconciliation fails closed after a provider configuration change', async () => {
        const provider = makeProvider();
        const persistence = makePersistence({
            claimBookingReconciliation: jest.fn().mockResolvedValue({
                action: 'reconcile', reconciliation_authorized: true, claim_token: 'reconcile_1',
                operation: {
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id,
                    selected_slot: slot,
                    attendee_emails: confirmed.attendee_emails,
                    provider_reference: {
                        provider: 'nylas',
                        configuration_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    }
                }
            })
        });

        await expect(createBookingOrchestrator({ provider, persistence }).reconcileBooking({
            idempotencyKey: 'booking_key_1234567890'
        })).rejects.toMatchObject({ code: ErrorCodes.BOOKING_RECONCILIATION_REQUIRED });
        expect(provider.getBooking).not.toHaveBeenCalled();
        expect(provider.getEvent).not.toHaveBeenCalled();
        expect(provider.createBooking).not.toHaveBeenCalled();
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
