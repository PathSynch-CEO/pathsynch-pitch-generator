'use strict';

const {
    verifyNylasBooking,
    verifyNylasCancelledEvent,
    BookingVerificationError
} = require('./bookingVerification');
const { NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');

function verificationExpected(operation, expected) {
    const booking = operation.confirmed_result;
    return {
        organizerEmail: booking.organizer_email,
        title: booking.title,
        timezone: booking.timezone,
        durationMinutes: booking.duration_minutes,
        calendarId: expected.calendarId,
        slot: { start: booking.start, end: booking.end },
        attendeeEmails: booking.attendee_emails
    };
}

async function verifyCancellationTarget(provider, operation) {
    const expected = provider.configuration;
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
        if (String(bookingResult.value.status || '').toLowerCase() === 'cancelled'
            && String(eventResult.value.status || '').toLowerCase() === 'cancelled') {
            if (bookingResult.value.booking_id !== operation.provider_booking_id
                || bookingResult.value.event_id !== operation.provider_event_id) {
                throw new BookingVerificationError('cancelled_booking_identity_mismatch');
            }
            verifyNylasCancelledEvent({
                event: eventResult.value,
                expected: verification,
                eventId: operation.provider_event_id
            });
            return { action: 'already_cancelled', result: eventResult.value };
        }
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

module.exports = { verificationExpected, verifyCancellationTarget };
