'use strict';

const {
    validateBookingRequest,
    bookingRequestFingerprint
} = require('./bookingContract');
const { assertSchedulingProvider } = require('./schedulingProvider');
const { verifyNylasBooking, BookingVerificationError } = require('./bookingVerification');
const { NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');
const { isValidBookingNoticeMinutes, meetsBookingNotice } = require('./bookingLimits');
const { DEFAULT_POLICY, normalizePolicy, assertSlotAllowed, filterSlots } = require('./bookingSchedulingPolicy');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const FAILURE_CODES = Object.freeze({
    PROVIDER_REJECTED: 'nylas.provider_rejected',
    CREATE_OUTCOME_UNKNOWN: 'nylas.create_outcome_unknown',
    CREATE_RESPONSE_MALFORMED: 'nylas.create_response_malformed',
    VERIFICATION_FAILED: 'nylas.verification_failed',
    CONFIRMATION_PERSISTENCE_FAILED: 'nylas.confirmation_persistence_failed'
});

function apiError(code, message, reason) {
    return new ApiError(code, message, reason ? { reason } : null);
}

function validateWindow(start, end) {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'Availability window is invalid');
    }
    return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

function mapProviderReadError(error) {
    if (error && error.code === 'INVALID_PROVIDER_INPUT') {
        return apiError(ErrorCodes.INVALID_INPUT, 'Availability window is invalid');
    }
    if (error instanceof NylasHttpError && error.category === ERROR_CATEGORIES.MALFORMED) {
        return apiError(
            ErrorCodes.SCHEDULING_PROVIDER_MALFORMED_RESPONSE,
            'The scheduling provider returned an invalid response'
        );
    }
    if (error instanceof NylasHttpError && error.category === ERROR_CATEGORIES.REJECTED) {
        return apiError(ErrorCodes.SCHEDULING_PROVIDER_REJECTED, 'The scheduling provider rejected the request');
    }
    if (error && error.code === 'PROVIDER_NOT_CONFIGURED') {
        return apiError(ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE, 'The scheduling provider is not configured');
    }
    return apiError(ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE, 'The scheduling provider is temporarily unavailable');
}

function createBookingOrchestrator(options = {}) {
    const persistence = options.persistence;
    const provider = assertSchedulingProvider(options.provider);
    const hostDirectory = options.hostDirectory || null;
    const mailer = options.mailer || null;
    const now = options.now || (() => new Date());
    if (!persistence) throw new Error('booking persistence is required');
    if (typeof provider.getBooking !== 'function' || typeof provider.getEvent !== 'function') {
        throw new Error('booking verification provider capabilities are required');
    }
    const expected = provider.configuration;
    if (!expected) throw new Error('configured scheduling provider metadata is required');
    if (!isValidBookingNoticeMinutes(expected.minimumNoticeMinutes)
        || !isValidBookingNoticeMinutes(expected.noticeSafetyMarginMinutes)) {
        throw new Error('configured booking notice metadata is required');
    }

    function currentTime() {
        const value = now();
        const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
        if (!Number.isFinite(milliseconds)) throw new Error('booking clock is invalid');
        return new Date(milliseconds);
    }

    function noticeEligibleAvailability(slots) {
        if (!Array.isArray(slots)) {
            throw apiError(
                ErrorCodes.SCHEDULING_PROVIDER_MALFORMED_RESPONSE,
                'The scheduling provider returned an invalid response'
            );
        }
        const at = currentTime();
        const noticeMinutes = expected.minimumNoticeMinutes + expected.noticeSafetyMarginMinutes;
        try {
            return slots.filter((slot) => meetsBookingNotice(slot && slot.start, at, noticeMinutes));
        } catch (_) {
            throw apiError(
                ErrorCodes.SCHEDULING_PROVIDER_MALFORMED_RESPONSE,
                'The scheduling provider returned an invalid response'
            );
        }
    }

    async function routedHost(session) {
        if (hostDirectory) {
            const current = await hostDirectory.resolve(session.routing_state);
            const specialist = session && session.specialist;
            if (!specialist || specialist.id !== current.specialist.id
                || specialist.timezone !== session.timezone
                || current.policy.timezone !== session.timezone) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Booking specialist changed; create a new booking session',
                    'booking_specialist_changed'
                );
            }
            return Object.freeze(Object.assign({}, current, { specialist }));
        }
        return {
            policy: normalizePolicy(Object.assign({}, DEFAULT_POLICY, { timezone: expected.timezone })),
            specialist: session && session.specialist
        };
    }

    async function getAvailability({ sessionId, start, end }) {
        const session = await persistence.readSession(sessionId);
        const host = await routedHost(session);
        const window = validateWindow(start, end);
        let slots;
        try {
            slots = await provider.getAvailability({
                start: window.start,
                end: window.end,
                timezone: host.policy.timezone
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw mapProviderReadError(error);
        }
        const receipt = await persistence.createAvailabilityReceipt({
            session_id: session.session_id,
            session_version: session.session_version,
            timezone: session.timezone,
            slots: filterSlots(noticeEligibleAvailability(slots), host.policy),
            provider_reference: {
                provider: provider.name,
                configuration_id: expected.configurationId
            }
        });
        return {
            session_version: receipt.session_version,
            availability_version: receipt.availability_version,
            timezone: receipt.timezone,
            slots: receipt.slots
        };
    }

    function verificationExpected(session, slot, guests) {
        return {
            organizerEmail: expected.organizerEmail,
            title: expected.title,
            timezone: slot.timezone,
            durationMinutes: expected.durationMinutes,
            calendarId: expected.calendarId,
            slot,
            attendeeEmails: [session.identity.email, ...guests]
        };
    }

    async function verifyCreatedBooking(created, verification) {
        const booking = await provider.getBooking({ bookingId: created.booking_id });
        const event = await provider.getEvent({ eventId: created.event_id });
        return verifyNylasBooking({ created, booking, event, expected: verification });
    }

    async function replayConfirmedBooking({ sessionId, idempotencyKey, request }) {
        let operation;
        try {
            operation = await persistence.readBookingOperation(idempotencyKey);
        } catch (error) {
            if (error instanceof ApiError && error.code === ErrorCodes.NOT_FOUND) return null;
            throw error;
        }
        if (operation.state !== 'CONFIRMED') return null;

        assertBookingReplayAllowed(operation);

        const validation = validateBookingRequest(request);
        if (!validation.valid) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking request', validation.errors);
        }
        if (operation.session_id !== sessionId
            || operation.request_fingerprint !== bookingRequestFingerprint(validation.value)) {
            throw apiError(ErrorCodes.CONFLICT, 'Idempotency key was reused with different booking data');
        }
        if (!operation.confirmed_result) {
            throw apiError(ErrorCodes.CONFLICT, 'Confirmed booking result is unavailable');
        }
        if (mailer) {
            await deliverConfirmation({
                idempotencyKey,
                booking: operation.confirmed_result,
                identity: operation.confirmation_identity,
                specialist: operation.specialist
            });
        }
        return operation.confirmed_result;
    }

    function assertBookingCancellationAllowsReplay(cancellationLifecycle) {
        if (cancellationLifecycle === 'CANCELLED') {
            throw apiError(ErrorCodes.CONFLICT, 'Booking has already been cancelled', 'booking_cancelled');
        }
        if (cancellationLifecycle !== 'CONFIRMED') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking cancellation is in progress or requires reconciliation',
                'booking_cancellation_unresolved'
            );
        }
    }

    function assertBookingReplayAllowed(operation) {
        if ([
            'CLAIMED',
            'PROVIDER_ATTEMPTING',
            'RECONCILIATION_REQUIRED',
            'COMMUNICATION_PENDING',
            'MANUAL_REVIEW_REQUIRED'
        ].includes(operation && operation.synthetic_recovery_state)) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Governed synthetic recovery is unresolved',
                'governed_recovery_unresolved'
            );
        }
        assertBookingCancellationAllowsReplay(
            operation && (operation.cancellation_state || 'CONFIRMED')
        );
    }

    async function deliverConfirmation({ idempotencyKey, booking, identity, specialist }) {
        const claim = await persistence.claimConfirmationDelivery(idempotencyKey);
        if (claim.action === 'suppressed_by_cancellation') {
            assertBookingCancellationAllowsReplay(claim.cancellation_state);
        }
        if (claim.action === 'suppressed_by_recovery') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Governed synthetic recovery is unresolved',
                'governed_recovery_unresolved'
            );
        }
        if (claim.action === 'already_sent' || claim.action === 'legacy') return;
        if (!claim.delivery_prepare_authorized || claim.action !== 'prepare') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking confirmation delivery requires reconciliation',
                'confirmation_delivery_in_progress'
            );
        }
        const authorization = await persistence.beginConfirmationDelivery({
            idempotency_key: idempotencyKey,
            delivery_token: claim.delivery_token,
            delivery_attempt_id: claim.delivery_attempt_id
        });
        if (authorization.action === 'suppressed_by_cancellation') {
            assertBookingCancellationAllowsReplay(authorization.cancellation_state);
        }
        if (authorization.action === 'suppressed_by_recovery') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Governed synthetic recovery is unresolved',
                'governed_recovery_unresolved'
            );
        }
        if (!authorization.delivery_authorized || authorization.action !== 'send') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking confirmation delivery requires reconciliation',
                'confirmation_delivery_in_progress'
            );
        }
        try {
            const delivery = await mailer.sendConfirmation({
                booking,
                identity,
                specialist,
                delivery: {
                    confirmation_id: authorization.confirmation_delivery_id,
                    attempt_id: authorization.delivery_attempt_id
                }
            });
            await persistence.markConfirmationDeliverySent({
                idempotency_key: idempotencyKey,
                delivery_token: authorization.delivery_token,
                provider_message_id: delivery && delivery.provider_message_id
            });
        } catch (_) {
            try {
                await persistence.markConfirmationDeliveryOutcomeUnknown({
                    idempotency_key: idempotencyKey,
                    delivery_token: authorization.delivery_token
                });
            } catch (_) {
                // The booking is confirmed. Never risk a second customer email after an ambiguous send.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking is confirmed but email delivery requires reconciliation',
                'confirmation_delivery_unknown'
            );
        }
    }

    async function createBooking({ sessionId, idempotencyKey, request }) {
        const confirmedReplay = await replayConfirmedBooking({ sessionId, idempotencyKey, request });
        if (confirmedReplay) return confirmedReplay;
        // The atomic operation claim remains authoritative for session/receipt freshness. Reading an
        // expired session here is permitted only so a previously CONFIRMED operation can replay for
        // the booking operation's longer retention window without another provider call.
        const session = await persistence.readSession(sessionId, { allowExpired: true });
        const host = await routedHost(session);
        const validation = validateBookingRequest(request, { prospectEmail: session.identity.email });
        if (!validation.valid) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking request', validation.errors);
        }
        const bookingRequest = validation.value;
        try {
            assertSlotAllowed(bookingRequest.slot, host.policy);
        } catch (error) {
            throw apiError(ErrorCodes.CONFLICT, 'Selected slot is outside booking policy', error.reason);
        }
        try {
            await provider.assertCustomerEmailsDisabled();
        } catch (error) {
            throw mapProviderReadError(error);
        }
        const attendeeEmails = [session.identity.email, ...bookingRequest.guests];
        const claim = await persistence.claimBookingOperation({
            idempotency_key: idempotencyKey,
            request_fingerprint: bookingRequestFingerprint(bookingRequest),
            session_id: sessionId,
            session_version: bookingRequest.session_version,
            slot: bookingRequest.slot,
            attendee_emails: attendeeEmails,
            confirmation_identity: session.identity,
            specialist: host.specialist,
            provider_reference: {
                provider: provider.name,
                configuration_id: expected.configurationId
            },
            minimum_notice_minutes: expected.minimumNoticeMinutes
        });

        if (claim.action === 'replay') {
            assertBookingReplayAllowed(claim.operation);
            if (mailer) {
                await deliverConfirmation({
                    idempotencyKey,
                    booking: claim.booking,
                    identity: claim.operation && claim.operation.confirmation_identity,
                    specialist: claim.operation && claim.operation.specialist
                });
            }
            return claim.booking;
        }
        if (claim.action === 'failed') {
            throw apiError(ErrorCodes.SCHEDULING_PROVIDER_REJECTED, 'The previous booking attempt was rejected');
        }
        if (!claim.provider_create_authorized || !['create', 'resume'].includes(claim.action)) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'The booking is already in progress or requires reconciliation'
            );
        }

        await persistence.beginProviderAttempt({
            idempotency_key: idempotencyKey,
            claim_token: claim.claim_token
        });

        let created;
        try {
            created = await provider.createBooking({
                slot: bookingRequest.slot,
                identity: session.identity,
                guests: bookingRequest.guests
            });
        } catch (error) {
            if (error instanceof NylasHttpError && error.category === ERROR_CATEGORIES.REJECTED) {
                await persistence.markBookingFailed({
                    idempotency_key: idempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: FAILURE_CODES.PROVIDER_REJECTED
                });
                throw apiError(ErrorCodes.SCHEDULING_PROVIDER_REJECTED, 'The scheduling provider rejected the booking');
            }
            await persistence.markBookingOutcomeUnknown({
                idempotency_key: idempotencyKey,
                claim_token: claim.claim_token,
                failure_code: error instanceof NylasHttpError && error.category === ERROR_CATEGORIES.MALFORMED
                    ? FAILURE_CODES.CREATE_RESPONSE_MALFORMED
                    : FAILURE_CODES.CREATE_OUTCOME_UNKNOWN
            });
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking outcome is unknown and requires reconciliation'
            );
        }

        try {
            await persistence.recordProviderIdentifiers({
                idempotency_key: idempotencyKey,
                claim_token: claim.claim_token,
                provider_booking_id: created.booking_id,
                provider_event_id: created.event_id
            });
        } catch (_) {
            try {
                await persistence.markBookingOutcomeUnknown({
                    idempotency_key: idempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: FAILURE_CODES.CREATE_OUTCOME_UNKNOWN,
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id
                });
            } catch (_) {
                // The provider create already happened. Never retry it when persistence is unavailable.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking outcome is unknown and requires reconciliation'
            );
        }

        let confirmed;
        try {
            confirmed = await verifyCreatedBooking(
                created,
                verificationExpected(session, bookingRequest.slot, bookingRequest.guests)
            );
        } catch (error) {
            await persistence.markBookingOutcomeUnknown({
                idempotency_key: idempotencyKey,
                claim_token: claim.claim_token,
                failure_code: FAILURE_CODES.VERIFICATION_FAILED,
                provider_booking_id: created.booking_id,
                provider_event_id: created.event_id
            });
            const reason = error instanceof BookingVerificationError ? error.reason : 'provider_verification_unavailable';
            throw apiError(ErrorCodes.BOOKING_VERIFICATION_FAILED, 'The created booking could not be verified', reason);
        }

        try {
            await persistence.confirmBookingOperation({
                idempotency_key: idempotencyKey,
                claim_token: claim.claim_token,
                confirmed_result: confirmed
            });
        } catch (_) {
            try {
                await persistence.markBookingOutcomeUnknown({
                    idempotency_key: idempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: FAILURE_CODES.CONFIRMATION_PERSISTENCE_FAILED,
                    provider_booking_id: created.booking_id,
                    provider_event_id: created.event_id
                });
            } catch (_) {
                // A lost confirmation response might already have committed; replay will prove it.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking outcome is unknown and requires reconciliation'
            );
        }
        if (mailer) {
            await deliverConfirmation({
                idempotencyKey,
                booking: confirmed,
                identity: session.identity,
                specialist: host.specialist
            });
        }
        return confirmed;
    }

    async function reconcileBooking({ idempotencyKey }) {
        const claim = await persistence.claimBookingReconciliation(idempotencyKey);
        if (!claim.reconciliation_authorized || claim.action !== 'reconcile') {
            throw apiError(ErrorCodes.BOOKING_RECONCILIATION_REQUIRED, 'Booking reconciliation is already in progress');
        }
        const operation = claim.operation;
        if (!operation.provider_booking_id || !operation.provider_event_id || !operation.selected_slot) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Manual or provider-assisted booking reconciliation is required',
                'provider_identifiers_unavailable'
            );
        }
        if (!operation.provider_reference
            || operation.provider_reference.provider !== provider.name
            || operation.provider_reference.configuration_id !== expected.configurationId) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Manual or provider-assisted booking reconciliation is required',
                'provider_configuration_changed'
            );
        }
        let confirmed;
        try {
            const created = {
                booking_id: operation.provider_booking_id,
                event_id: operation.provider_event_id,
                status: null
            };
            confirmed = await verifyCreatedBooking(
                created,
                {
                    organizerEmail: expected.organizerEmail,
                    title: expected.title,
                    timezone: operation.selected_slot.timezone,
                    durationMinutes: expected.durationMinutes,
                    calendarId: expected.calendarId,
                    slot: operation.selected_slot,
                    attendeeEmails: operation.attendee_emails
                }
            );
        } catch (error) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking reconciliation could not prove a terminal outcome',
                error instanceof BookingVerificationError ? error.reason : 'provider_verification_unavailable'
            );
        }
        await persistence.confirmBookingOperation({
            idempotency_key: idempotencyKey,
            claim_token: claim.claim_token,
            confirmed_result: confirmed
        });
        if (mailer) {
            await deliverConfirmation({
                idempotencyKey,
                booking: confirmed,
                identity: operation.confirmation_identity,
                specialist: operation.specialist
            });
        }
        return confirmed;
    }

    return Object.freeze({ getAvailability, createBooking, reconcileBooking });
}

module.exports = {
    FAILURE_CODES,
    createBookingOrchestrator
};
