'use strict';

const {
    validateBookingRequest,
    bookingRequestFingerprint
} = require('./bookingContract');
const { assertSchedulingProvider } = require('./schedulingProvider');
const { verifyNylasBooking, BookingVerificationError } = require('./bookingVerification');
const { NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const FAILURE_CODES = Object.freeze({
    PROVIDER_REJECTED: 'nylas.provider_rejected',
    CREATE_OUTCOME_UNKNOWN: 'nylas.create_outcome_unknown',
    CREATE_RESPONSE_MALFORMED: 'nylas.create_response_malformed',
    VERIFICATION_FAILED: 'nylas.verification_failed'
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
    if (!persistence) throw new Error('booking persistence is required');
    if (typeof provider.getBooking !== 'function' || typeof provider.getEvent !== 'function') {
        throw new Error('booking verification provider capabilities are required');
    }
    const expected = provider.configuration;
    if (!expected) throw new Error('configured scheduling provider metadata is required');

    async function getAvailability({ sessionId, start, end }) {
        const session = await persistence.readSession(sessionId);
        const window = validateWindow(start, end);
        let slots;
        try {
            slots = await provider.getAvailability({
                start: window.start,
                end: window.end,
                timezone: session.timezone
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw mapProviderReadError(error);
        }
        const receipt = await persistence.createAvailabilityReceipt({
            session_id: session.session_id,
            session_version: session.session_version,
            timezone: session.timezone,
            slots,
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
            timezone: expected.timezone,
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

    async function createBooking({ sessionId, idempotencyKey, request }) {
        // The atomic operation claim remains authoritative for session/receipt freshness. Reading an
        // expired session here is permitted only so a previously CONFIRMED operation can replay for
        // the booking operation's longer retention window without another provider call.
        const session = await persistence.readSession(sessionId, { allowExpired: true });
        const validation = validateBookingRequest(request, { prospectEmail: session.identity.email });
        if (!validation.valid) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking request', validation.errors);
        }
        const bookingRequest = validation.value;
        const attendeeEmails = [session.identity.email, ...bookingRequest.guests];
        const claim = await persistence.claimBookingOperation({
            idempotency_key: idempotencyKey,
            request_fingerprint: bookingRequestFingerprint(bookingRequest),
            session_id: sessionId,
            session_version: bookingRequest.session_version,
            slot: bookingRequest.slot,
            attendee_emails: attendeeEmails
        });

        if (claim.action === 'replay') return claim.booking;
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

        await persistence.confirmBookingOperation({
            idempotency_key: idempotencyKey,
            claim_token: claim.claim_token,
            confirmed_result: confirmed
        });
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
                    timezone: expected.timezone,
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
        return confirmed;
    }

    return Object.freeze({ getAvailability, createBooking, reconcileBooking });
}

module.exports = {
    FAILURE_CODES,
    createBookingOrchestrator
};
