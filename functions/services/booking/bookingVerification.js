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

function verifyNylasBooking({ created, booking, event, expected }) {
    if (!created || !booking || !event || !expected) fail('missing_verification_data');
    if (created.booking_id !== booking.booking_id) fail('booking_id_mismatch');
    if (created.event_id !== booking.event_id || created.event_id !== event.event_id) {
        fail('event_id_mismatch');
    }
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
    if (attendeeEmails.size !== expectedAttendeeEmails.size
        || [...expectedAttendeeEmails].some((attendee) => !attendeeEmails.has(attendee))) {
        fail('attendee_set_mismatch');
    }

    const bookingStatus = booking.status;
    if (!['booked', 'confirmed'].includes(bookingStatus)) fail('booking_status_invalid');
    if (event.status !== 'confirmed') fail('event_status_invalid');
    const confirmedStatus = event.status;

    return {
        booking_id: booking.booking_id,
        event_id: event.event_id,
        status: confirmedStatus,
        title: event.title,
        organizer_email: normalizedEmail(event.organizer_email),
        attendee_emails: expected.attendeeEmails.map(normalizedEmail),
        start: event.start,
        end: event.end,
        timezone: event.start_timezone || event.end_timezone || expected.timezone,
        duration_minutes: expected.durationMinutes
    };
}

module.exports = {
    BookingVerificationError,
    verifyNylasBooking
};
