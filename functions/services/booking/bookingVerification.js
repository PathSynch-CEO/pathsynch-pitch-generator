'use strict';

class BookingVerificationError extends Error {
    constructor(reason) {
        super('Nylas booking verification failed');
        this.name = 'BookingVerificationError';
        this.code = 'BOOKING_VERIFICATION_FAILED';
        this.reason = reason;
    }
}

function fail(reason) {
    throw new BookingVerificationError(reason);
}

function normalizedEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function verifyNylasEvent({ event, expected, eventId, requiredStatus }) {
    if (!event || !expected || !eventId) fail('missing_verification_data');
    if (eventId !== event.event_id) fail('event_id_mismatch');
    if (normalizedEmail(event.organizer_email) !== normalizedEmail(expected.organizerEmail)) {
        fail('organizer_mismatch');
    }
    if (event.title !== expected.title) fail('title_mismatch');
    if (event.start !== expected.slot.start || event.end !== expected.slot.end) fail('time_mismatch');
    if (Date.parse(event.end) - Date.parse(event.start) !== expected.durationMinutes * 60 * 1000) {
        fail('duration_mismatch');
    }
    if (event.calendar_id !== expected.calendarId) fail('calendar_mismatch');

    const eventTimezones = [event.start_timezone, event.end_timezone].filter(Boolean);
    if (eventTimezones.some((timezone) => timezone !== expected.timezone)) fail('timezone_mismatch');

    const attendeeEmails = new Set((event.participant_emails || []).map(normalizedEmail));
    const expectedAttendeeEmails = new Set(expected.attendeeEmails.map(normalizedEmail));
    // Nylas/provider event responses may repeat the independently verified organizer in
    // participants. Every intended guest must still be present, and no other extra is valid.
    const allowedParticipantEmails = new Set([
        ...expectedAttendeeEmails,
        normalizedEmail(expected.organizerEmail)
    ]);
    if ([...expectedAttendeeEmails].some((attendee) => !attendeeEmails.has(attendee))
        || [...attendeeEmails].some((attendee) => !allowedParticipantEmails.has(attendee))) {
        fail('attendee_set_mismatch');
    }

    if (event.status !== requiredStatus) fail('event_status_invalid');
    return {
        event_id: event.event_id,
        status: event.status,
        title: event.title,
        organizer_email: normalizedEmail(event.organizer_email),
        attendee_emails: expected.attendeeEmails.map(normalizedEmail),
        start: event.start,
        end: event.end,
        timezone: event.start_timezone || event.end_timezone || expected.timezone,
        duration_minutes: expected.durationMinutes
    };
}

function verifyNylasBooking({ created, booking, event, expected }) {
    if (!created || !booking || !event || !expected) fail('missing_verification_data');
    if (created.booking_id !== booking.booking_id) fail('booking_id_mismatch');
    if (created.event_id !== booking.event_id) fail('event_id_mismatch');
    const verifiedEvent = verifyNylasEvent({
        event,
        expected,
        eventId: created.event_id,
        requiredStatus: 'confirmed'
    });

    const bookingStatus = booking.status;
    if (!['booked', 'confirmed'].includes(bookingStatus)) fail('booking_status_invalid');
    return Object.assign({}, verifiedEvent, {
        booking_id: booking.booking_id,
        status: 'confirmed'
    });
}

function verifyNylasCancelledEvent({ event, expected, eventId }) {
    return verifyNylasEvent({ event, expected, eventId, requiredStatus: 'cancelled' });
}

module.exports = {
    BookingVerificationError,
    verifyNylasBooking,
    verifyNylasCancelledEvent
};
