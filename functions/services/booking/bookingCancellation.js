'use strict';

const { assertSchedulingProvider } = require('./schedulingProvider');
const {
    verifyNylasBooking,
    verifyNylasCancelledEvent,
    BookingVerificationError
} = require('./bookingVerification');
const { NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');
const { CONFIRMATION_DELIVERY_STATES } = require('./bookingPersistenceSchema');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const CANCELLATION_FAILURE_CODES = Object.freeze({
    PREFLIGHT_UNAVAILABLE: 'nylas.cancellation_preflight_unavailable',
    PREFLIGHT_MISMATCH: 'nylas.cancellation_preflight_mismatch',
    PROVIDER_REJECTED: 'nylas.cancellation_provider_rejected',
    OUTCOME_UNKNOWN: 'nylas.cancellation_outcome_unknown',
    RESPONSE_MALFORMED: 'nylas.cancellation_response_malformed',
    PERSISTENCE_UNKNOWN: 'booking.cancellation_persistence_unknown',
    ALREADY_CANCELLED: 'nylas.cancellation_already_cancelled'
});

function apiError(code, message, reason) {
    return new ApiError(code, message, reason ? { reason } : null);
}

function isExpiredCancellationClaim(error) {
    return error instanceof ApiError
        && error.code === ErrorCodes.CONFLICT
        && error.details
        && error.details.reason === 'cancellation_claim_expired';
}

function cancellationBooking(operation, communicationStatus) {
    const booking = operation && operation.confirmed_result;
    if (!booking) throw apiError(ErrorCodes.CONFLICT, 'Confirmed booking result is unavailable');
    return {
        status: 'cancelled',
        title: booking.title,
        attendee_emails: booking.attendee_emails,
        start: booking.start,
        end: booking.end,
        timezone: booking.timezone,
        duration_minutes: booking.duration_minutes,
        communication_status: communicationStatus
    };
}

function verificationExpected(operation, expected) {
    const booking = operation.confirmed_result;
    return {
        organizerEmail: booking.organizer_email,
        title: booking.title,
        timezone: booking.timezone,
        durationMinutes: booking.duration_minutes,
        calendarId: expected.calendarId,
        slot: {
            start: booking.start,
            end: booking.end
        },
        attendeeEmails: booking.attendee_emails
    };
}

function createBookingCancellationService(options = {}) {
    const persistence = options.persistence;
    const provider = assertSchedulingProvider(options.provider);
    const mailer = options.mailer || null;
    const expected = provider.configuration;
    if (!persistence) throw new Error('booking persistence is required');
    if (!expected || typeof provider.getBooking !== 'function' || typeof provider.getEvent !== 'function') {
        throw new Error('booking cancellation provider metadata is required');
    }

    async function verifyCancellationTarget(operation) {
        const created = {
            booking_id: operation.provider_booking_id,
            event_id: operation.provider_event_id,
            status: null
        };
        const [bookingResult, eventResult] = await Promise.allSettled([
            provider.getBooking({ bookingId: operation.provider_booking_id }),
            provider.getEvent({ eventId: operation.provider_event_id })
        ]);
        const verification = verificationExpected(operation, expected);
        if (bookingResult.status === 'fulfilled' && eventResult.status === 'fulfilled') {
            return {
                action: 'active',
                result: verifyNylasBooking({
                    created,
                    booking: bookingResult.value,
                    event: eventResult.value,
                    expected: verification
                })
            };
        }
        const bookingMissing = bookingResult.status === 'rejected'
            && bookingResult.reason instanceof NylasHttpError
            && bookingResult.reason.category === ERROR_CATEGORIES.REJECTED
            && bookingResult.reason.status === 404;
        if (bookingMissing && eventResult.status === 'fulfilled') {
            verifyNylasCancelledEvent({
                event: eventResult.value,
                expected: verification,
                eventId: operation.provider_event_id
            });
            return { action: 'already_cancelled', result: eventResult.value };
        }
        throw bookingResult.status === 'rejected' ? bookingResult.reason : eventResult.reason;
    }

    async function deliverCancellation(bookingIdempotencyKey, operation) {
        if (!mailer || typeof mailer.sendCancellation !== 'function') return 'pending';
        let claim;
        try {
            claim = await persistence.claimCancellationDelivery(bookingIdempotencyKey);
        } catch (_) {
            // Provider cancellation is already durable. Communication recovers independently.
            return 'reconciliation_required';
        }
        if (claim.action === 'already_sent') return 'sent';
        if (claim.action === 'reconcile') {
            try {
                await persistence.reconcileCancellationDelivery({
                    booking_idempotency_key: bookingIdempotencyKey,
                    delivery_attempt_id: claim.cancellation_delivery_attempt_id
                });
                return 'sent';
            } catch (_) {
                return 'reconciliation_required';
            }
        }
        if (claim.action === 'in_progress') return 'in_progress';
        if (claim.action !== 'prepare' || !claim.delivery_prepare_authorized) {
            return 'reconciliation_required';
        }
        let authorization;
        try {
            authorization = await persistence.beginCancellationDelivery({
                booking_idempotency_key: bookingIdempotencyKey,
                delivery_token: claim.delivery_token,
                delivery_attempt_id: claim.cancellation_delivery_attempt_id
            });
        } catch (_) {
            return 'reconciliation_required';
        }
        if (authorization.action !== 'send' || !authorization.delivery_authorized) {
            return 'reconciliation_required';
        }
        try {
            const delivery = await mailer.sendCancellation({
                booking: operation.confirmed_result,
                identity: operation.confirmation_identity,
                specialist: operation.specialist,
                delivery: {
                    confirmation_id: authorization.cancellation_delivery_id,
                    attempt_id: authorization.cancellation_delivery_attempt_id
                }
            });
            await persistence.markCancellationDeliverySent({
                booking_idempotency_key: bookingIdempotencyKey,
                delivery_token: authorization.delivery_token,
                provider_message_id: delivery && delivery.provider_message_id
            });
            return 'sent';
        } catch (_) {
            try {
                await persistence.markCancellationDeliveryOutcomeUnknown({
                    booking_idempotency_key: bookingIdempotencyKey,
                    delivery_token: authorization.delivery_token
                });
            } catch (_) {
                // Provider cancellation is already durable. Never risk a duplicate email.
            }
            return 'reconciliation_required';
        }
    }

    async function cancelBooking(input) {
        const claim = await persistence.claimCancellationOperation({
            session_id: input.sessionId,
            booking_idempotency_key: input.bookingIdempotencyKey,
            cancellation_idempotency_key: input.cancellationIdempotencyKey,
            capability: input.capability
        });
        const operation = claim.operation;
        if (claim.action === 'already_cancelled') {
            const communicationStatus = await deliverCancellation(input.bookingIdempotencyKey, operation);
            return cancellationBooking(operation, communicationStatus);
        }
        const providerReconciliation = claim.action === 'reconcile' && claim.reconciliation_authorized;
        if (claim.action === 'reconcile' && !providerReconciliation) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking cancellation requires reconciliation',
                'cancellation_reconciliation_required'
            );
        }
        if (claim.action === 'confirmation_in_progress') {
            throw apiError(
                ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
                'Booking confirmation delivery is still in progress',
                'confirmation_delivery_in_progress'
            );
        }
        if (claim.action === 'confirmation_reconcile') {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking confirmation delivery requires reconciliation before cancellation',
                'confirmation_delivery_reconciliation_required'
            );
        }
        if (claim.action === 'in_progress' || (!claim.cancellation_authorized && !providerReconciliation)) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking cancellation is already in progress',
                'cancellation_in_progress'
            );
        }

        if (!operation.provider_reference
            || operation.provider_reference.provider !== provider.name
            || operation.provider_reference.configuration_id !== expected.configurationId) {
            if (providerReconciliation) {
                throw apiError(
                    ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                    'Booking provider configuration no longer matches the retained operation',
                    'provider_configuration_mismatch'
                );
            }
            await persistence.markCancellationReconciliationRequired({
                booking_idempotency_key: input.bookingIdempotencyKey,
                cancellation_idempotency_key: input.cancellationIdempotencyKey,
                claim_token: claim.claim_token,
                failure_code: CANCELLATION_FAILURE_CODES.PREFLIGHT_MISMATCH
            });
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking provider configuration no longer matches the retained operation',
                'provider_configuration_mismatch'
            );
        }

        if (!providerReconciliation) {
            try {
                await provider.assertCustomerEmailsDisabled();
            } catch (_) {
                await persistence.markCancellationPreflightFailed({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: CANCELLATION_FAILURE_CODES.PREFLIGHT_UNAVAILABLE
                });
                throw apiError(
                    ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
                    'The scheduling provider is temporarily unavailable'
                );
            }
        }

        let target;
        try {
            target = await verifyCancellationTarget(operation);
        } catch (error) {
            const mismatch = error instanceof BookingVerificationError
                || (error instanceof NylasHttpError
                    && error.category === ERROR_CATEGORIES.REJECTED
                    && error.status === 404);
            if (providerReconciliation) {
                throw apiError(
                    ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                    'Booking cancellation requires reconciliation',
                    mismatch ? 'cancellation_reconciliation_mismatch' : 'cancellation_reconciliation_unavailable'
                );
            }
            if (mismatch) {
                await persistence.markCancellationReconciliationRequired({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: CANCELLATION_FAILURE_CODES.PREFLIGHT_MISMATCH
                });
                throw apiError(
                    ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                    'Booking cancellation requires reconciliation',
                    error instanceof BookingVerificationError ? error.reason : 'provider_booking_not_found'
                );
            }
            await persistence.markCancellationPreflightFailed({
                booking_idempotency_key: input.bookingIdempotencyKey,
                cancellation_idempotency_key: input.cancellationIdempotencyKey,
                claim_token: claim.claim_token,
                failure_code: CANCELLATION_FAILURE_CODES.PREFLIGHT_UNAVAILABLE
            });
            throw apiError(
                ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
                'The scheduling provider is temporarily unavailable'
            );
        }

        if (target.action === 'already_cancelled') {
            let reconciled;
            try {
                reconciled = await persistence.markBookingCancellationReconciled({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    provider_booking_id: operation.provider_booking_id,
                    provider_event_id: operation.provider_event_id,
                    reconciliation_evidence: CANCELLATION_FAILURE_CODES.ALREADY_CANCELLED
                });
            } catch (_) {
                throw apiError(
                    ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                    'The booking cancellation outcome is unknown and requires reconciliation',
                    'cancellation_persistence_unknown'
                );
            }
            const communicationStatus = await deliverCancellation(input.bookingIdempotencyKey, reconciled);
            return cancellationBooking(reconciled, communicationStatus);
        }

        if (providerReconciliation) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Booking cancellation requires reconciliation',
                'cancellation_provider_still_active'
            );
        }

        try {
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.bookingIdempotencyKey,
                cancellation_idempotency_key: input.cancellationIdempotencyKey,
                claim_token: claim.claim_token
            });
        } catch (error) {
            if (isExpiredCancellationClaim(error)) throw error;
            try {
                await persistence.markCancellationReconciliationRequired({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: CANCELLATION_FAILURE_CODES.PERSISTENCE_UNKNOWN
                });
            } catch (_) {
                // The durable provider-attempt fence might have committed. Never proceed or retry.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking cancellation outcome is unknown and requires reconciliation',
                'cancellation_attempt_fence_unknown'
            );
        }

        let cancelled;
        try {
            cancelled = await provider.cancelBooking({ bookingId: operation.provider_booking_id });
        } catch (error) {
            if (error instanceof NylasHttpError
                && error.category === ERROR_CATEGORIES.REJECTED
                && error.status !== 404) {
                try {
                    await persistence.markCancellationProviderRejected({
                        booking_idempotency_key: input.bookingIdempotencyKey,
                        cancellation_idempotency_key: input.cancellationIdempotencyKey,
                        claim_token: claim.claim_token,
                        failure_code: CANCELLATION_FAILURE_CODES.PROVIDER_REJECTED
                    });
                } catch (_) {
                    throw apiError(
                        ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                        'Provider rejection was definitive but local state requires reconciliation',
                        'cancellation_rejection_persistence_unknown'
                    );
                }
                throw apiError(
                    ErrorCodes.SCHEDULING_PROVIDER_REJECTED,
                    'The scheduling provider rejected the cancellation',
                    'cancellation_provider_rejected'
                );
            }
            try {
                await persistence.markCancellationReconciliationRequired({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: error instanceof NylasHttpError && error.category === ERROR_CATEGORIES.MALFORMED
                        ? CANCELLATION_FAILURE_CODES.RESPONSE_MALFORMED
                        : CANCELLATION_FAILURE_CODES.OUTCOME_UNKNOWN
                });
            } catch (_) {
                // Provider mutation may have happened. Preserve ambiguity even if its persistence write fails.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking cancellation outcome is unknown and requires reconciliation',
                'cancellation_outcome_unknown'
            );
        }

        let durable;
        try {
            durable = await persistence.markBookingCancelled({
                booking_idempotency_key: input.bookingIdempotencyKey,
                cancellation_idempotency_key: input.cancellationIdempotencyKey,
                claim_token: claim.claim_token,
                provider_booking_id: cancelled.booking_id,
                provider_event_id: operation.provider_event_id,
                provider_request_id: cancelled.request_id
            });
        } catch (_) {
            try {
                await persistence.markCancellationReconciliationRequired({
                    booking_idempotency_key: input.bookingIdempotencyKey,
                    cancellation_idempotency_key: input.cancellationIdempotencyKey,
                    claim_token: claim.claim_token,
                    failure_code: CANCELLATION_FAILURE_CODES.PERSISTENCE_UNKNOWN
                });
            } catch (_) {
                // The provider cancellation may already have succeeded. Never retry blindly.
            }
            throw apiError(
                ErrorCodes.AMBIGUOUS_PROVIDER_OUTCOME,
                'The booking cancellation outcome is unknown and requires reconciliation',
                'cancellation_persistence_unknown'
            );
        }

        const communicationStatus = await deliverCancellation(input.bookingIdempotencyKey, durable);
        return cancellationBooking(durable, communicationStatus);
    }

    return Object.freeze({ cancelBooking });
}

module.exports = {
    CANCELLATION_FAILURE_CODES,
    cancellationBooking,
    createBookingCancellationService
};
