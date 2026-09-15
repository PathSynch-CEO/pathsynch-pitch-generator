'use strict';

const { createBookingCancellationService } = require('../../services/booking/bookingCancellation');
const { NylasHttpError, ERROR_CATEGORIES } = require('../../services/booking/nylasHttpClient');

const booking = Object.freeze({
    booking_id: 'booking_1',
    event_id: 'event_1',
    status: 'confirmed',
    title: 'SynchIntro Strategy Call',
    organizer_email: 'hello@pathsynch.com',
    attendee_emails: ['buyer@example.com'],
    start: '2026-09-21T13:00:00.000Z',
    end: '2026-09-21T13:30:00.000Z',
    timezone: 'America/New_York',
    duration_minutes: 30
});

const operation = Object.freeze({
    operation_id: 'op_booking_1',
    provider_booking_id: booking.booking_id,
    provider_event_id: booking.event_id,
    confirmed_result: booking,
    confirmation_identity: {
        first_name: 'Buyer', last_name: 'Example', email: 'buyer@example.com'
    },
    specialist: {
        id: 'spc_charles', display_name: 'Charles Berry', title: 'Founder & CEO',
        avatar_url: null, initials: 'CB', timezone: 'America/New_York'
    }
});

function provider() {
    return {
        name: 'nylas',
        configured: true,
        configuration: {
            calendarId: 'primary', configurationId: 'configuration_1',
            organizerEmail: booking.organizer_email, timezone: booking.timezone,
            durationMinutes: 30, minimumNoticeMinutes: 60, noticeSafetyMarginMinutes: 5,
            title: booking.title
        },
        getAvailability: jest.fn(),
        assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true }),
        createBooking: jest.fn(),
        getBooking: jest.fn().mockResolvedValue({
            booking_id: booking.booking_id, event_id: booking.event_id, status: 'confirmed'
        }),
        getEvent: jest.fn().mockResolvedValue({
            event_id: booking.event_id,
            title: booking.title,
            status: 'confirmed',
            organizer_email: booking.organizer_email,
            participant_emails: booking.attendee_emails,
            calendar_id: 'primary',
            start: booking.start,
            end: booking.end,
            start_timezone: booking.timezone,
            end_timezone: booking.timezone
        }),
        rescheduleBooking: jest.fn(),
        cancelBooking: jest.fn().mockResolvedValue({
            booking_id: booking.booking_id, request_id: 'request_cancel_1'
        }),
        verifyWebhook: jest.fn()
    };
}

function persistence() {
    return {
        claimCancellationOperation: jest.fn().mockResolvedValue({
            action: 'cancel', cancellation_authorized: true, claim_token: 'claim_1', operation
        }),
        markCancellationPreflightFailed: jest.fn().mockResolvedValue(undefined),
        markCancellationReconciliationRequired: jest.fn().mockResolvedValue(undefined),
        beginCancellationProviderAttempt: jest.fn().mockResolvedValue(undefined),
        markBookingCancelled: jest.fn().mockResolvedValue(Object.assign({}, operation, {
            cancellation_state: 'CANCELLED', cancellation_delivery_state: 'PENDING'
        })),
        markBookingCancellationReconciled: jest.fn().mockResolvedValue(Object.assign({}, operation, {
            cancellation_state: 'CANCELLED', cancellation_delivery_state: 'PENDING'
        })),
        claimCancellationDelivery: jest.fn().mockResolvedValue({
            action: 'prepare', delivery_prepare_authorized: true,
            delivery_token: 'delivery_1', cancellation_delivery_id: 'cnd_1',
            cancellation_delivery_attempt_id: 'cda_1'
        }),
        beginCancellationDelivery: jest.fn().mockResolvedValue({
            action: 'send', delivery_authorized: true,
            delivery_token: 'delivery_1', cancellation_delivery_id: 'cnd_1',
            cancellation_delivery_attempt_id: 'cda_1'
        }),
        markCancellationDeliverySent: jest.fn().mockResolvedValue(undefined),
        markCancellationDeliveryOutcomeUnknown: jest.fn().mockResolvedValue(undefined)
    };
}

const request = Object.freeze({
    sessionId: 'bks_1',
    bookingIdempotencyKey: 'booking_key_1234567890',
    cancellationIdempotencyKey: 'cancel_key_1234567890',
    capability: 'S'.repeat(43)
});

describe('SynchIntro booking cancellation orchestration', () => {
    test('verifies the durable target, cancels once, persists, and sends one branded email', async () => {
        const p = provider();
        const store = persistence();
        const mailer = { sendCancellation: jest.fn().mockResolvedValue({ provider_message_id: 'message_1' }) };
        const service = createBookingCancellationService({ persistence: store, provider: p, mailer });

        await expect(service.cancelBooking(request)).resolves.toEqual({
            status: 'cancelled',
            title: booking.title,
            attendee_emails: booking.attendee_emails,
            start: booking.start,
            end: booking.end,
            timezone: booking.timezone,
            duration_minutes: 30,
            communication_status: 'sent'
        });
        expect(p.cancelBooking).toHaveBeenCalledTimes(1);
        expect(p.cancelBooking).toHaveBeenCalledWith({ bookingId: booking.booking_id });
        expect(store.markBookingCancelled).toHaveBeenCalledWith(expect.objectContaining({
            provider_booking_id: booking.booking_id,
            provider_event_id: booking.event_id,
            provider_request_id: 'request_cancel_1'
        }));
        expect(mailer.sendCancellation).toHaveBeenCalledTimes(1);
    });

    test('returns the established result on replay without another provider mutation or email', async () => {
        const p = provider();
        const store = persistence();
        store.claimCancellationOperation.mockResolvedValue({ action: 'already_cancelled', operation });
        store.claimCancellationDelivery.mockResolvedValue({ action: 'already_sent', delivery_authorized: false });
        const mailer = { sendCancellation: jest.fn() };
        const service = createBookingCancellationService({ persistence: store, provider: p, mailer });

        await expect(service.cancelBooking(request)).resolves.toMatchObject({
            status: 'cancelled', communication_status: 'sent'
        });
        expect(p.getBooking).not.toHaveBeenCalled();
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('reconciles an exact already-cancelled provider event without another provider mutation', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new NylasHttpError(
            ERROR_CATEGORIES.REJECTED,
            'get_booking',
            { status: 404 }
        ));
        p.getEvent.mockResolvedValue(Object.assign({}, await p.getEvent(), { status: 'cancelled' }));
        const store = persistence();
        const mailer = { sendCancellation: jest.fn().mockResolvedValue({ provider_message_id: 'message_1' }) };
        const service = createBookingCancellationService({ persistence: store, provider: p, mailer });

        await expect(service.cancelBooking(request)).resolves.toMatchObject({
            status: 'cancelled', communication_status: 'sent'
        });
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(store.beginCancellationProviderAttempt).not.toHaveBeenCalled();
        expect(store.markBookingCancellationReconciled).toHaveBeenCalledWith(expect.objectContaining({
            provider_booking_id: booking.booking_id,
            provider_event_id: booking.event_id,
            reconciliation_evidence: 'nylas.cancellation_already_cancelled'
        }));
        expect(mailer.sendCancellation).toHaveBeenCalledTimes(1);
    });

    test('does not adopt a cancelled provider event whose durable guest identity differs', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new NylasHttpError(
            ERROR_CATEGORIES.REJECTED,
            'get_booking',
            { status: 404 }
        ));
        const priorEvent = await p.getEvent();
        p.getEvent.mockResolvedValue(Object.assign({}, priorEvent, {
            status: 'cancelled',
            participant_emails: ['different@example.com']
        }));
        const store = persistence();
        const service = createBookingCancellationService({ persistence: store, provider: p });

        await expect(service.cancelBooking(request)).rejects.toMatchObject({
            code: 'BOOKING_RECONCILIATION_REQUIRED'
        });
        expect(store.markCancellationReconciliationRequired).toHaveBeenCalledTimes(1);
        expect(store.markBookingCancellationReconciled).not.toHaveBeenCalled();
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('fails closed when durable provider identity no longer matches before cancellation', async () => {
        const p = provider();
        p.getBooking.mockResolvedValue({ booking_id: 'other_booking', event_id: booking.event_id, status: 'confirmed' });
        const store = persistence();
        const service = createBookingCancellationService({ persistence: store, provider: p });

        await expect(service.cancelBooking(request)).rejects.toMatchObject({
            code: 'BOOKING_RECONCILIATION_REQUIRED'
        });
        expect(store.markCancellationReconciliationRequired).toHaveBeenCalledTimes(1);
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('records ambiguous provider mutation and never reports false cancellation', async () => {
        const p = provider();
        p.cancelBooking.mockRejectedValue(new NylasHttpError(ERROR_CATEGORIES.AMBIGUOUS, 'cancel_booking'));
        const store = persistence();
        const service = createBookingCancellationService({ persistence: store, provider: p });

        await expect(service.cancelBooking(request)).rejects.toMatchObject({
            code: 'AMBIGUOUS_PROVIDER_OUTCOME',
            details: { reason: 'cancellation_outcome_unknown' }
        });
        expect(store.markCancellationReconciliationRequired).toHaveBeenCalledTimes(1);
        expect(store.markBookingCancelled).not.toHaveBeenCalled();
    });

    test('preserves provider ambiguity when the reconciliation write also fails', async () => {
        const p = provider();
        p.cancelBooking.mockRejectedValue(new NylasHttpError(ERROR_CATEGORIES.AMBIGUOUS, 'cancel_booking'));
        const store = persistence();
        store.markCancellationReconciliationRequired.mockRejectedValue(new Error('database unavailable'));
        const service = createBookingCancellationService({ persistence: store, provider: p });

        await expect(service.cancelBooking(request)).rejects.toMatchObject({
            code: 'AMBIGUOUS_PROVIDER_OUTCOME',
            details: { reason: 'cancellation_outcome_unknown' }
        });
        expect(p.cancelBooking).toHaveBeenCalledTimes(1);
        expect(store.markBookingCancelled).not.toHaveBeenCalled();
    });

    test('stops before provider I/O when the durable attempt fence acknowledgement is unknown', async () => {
        const p = provider();
        const store = persistence();
        store.beginCancellationProviderAttempt.mockRejectedValue(new Error('database acknowledgement lost'));
        const service = createBookingCancellationService({ persistence: store, provider: p });

        await expect(service.cancelBooking(request)).rejects.toMatchObject({
            code: 'AMBIGUOUS_PROVIDER_OUTCOME',
            details: { reason: 'cancellation_attempt_fence_unknown' }
        });
        expect(store.markCancellationReconciliationRequired).toHaveBeenCalledTimes(1);
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('keeps cancellation durable when email outcome becomes ambiguous', async () => {
        const p = provider();
        const store = persistence();
        const mailer = { sendCancellation: jest.fn().mockRejectedValue(new Error('send failed')) };
        const service = createBookingCancellationService({ persistence: store, provider: p, mailer });

        await expect(service.cancelBooking(request)).resolves.toMatchObject({
            status: 'cancelled', communication_status: 'reconciliation_required'
        });
        expect(store.markBookingCancelled).toHaveBeenCalledTimes(1);
        expect(store.markCancellationDeliveryOutcomeUnknown).toHaveBeenCalledTimes(1);
    });

    test('keeps cancellation durable when the communication claim cannot be read', async () => {
        const p = provider();
        const store = persistence();
        store.claimCancellationDelivery.mockRejectedValue(new Error('database unavailable'));
        const mailer = { sendCancellation: jest.fn() };
        const service = createBookingCancellationService({ persistence: store, provider: p, mailer });

        await expect(service.cancelBooking(request)).resolves.toMatchObject({
            status: 'cancelled', communication_status: 'reconciliation_required'
        });
        expect(store.markBookingCancelled).toHaveBeenCalledTimes(1);
        expect(mailer.sendCancellation).not.toHaveBeenCalled();
    });
});
