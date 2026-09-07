'use strict';

const {
    BookingVerificationError,
    verifyNylasBooking
} = require('../../services/booking/bookingVerification');

const created = Object.freeze({ booking_id: 'booking_1', event_id: 'event_1', status: 'booked' });
const booking = Object.freeze({ booking_id: 'booking_1', event_id: 'event_1', status: 'booked' });
const expected = Object.freeze({
    organizerEmail: 'hello@pathsynch.com',
    title: 'SynchIntro Strategy Call',
    timezone: 'America/New_York',
    durationMinutes: 30,
    calendarId: 'primary',
    slot: {
        start: '2026-09-08T00:30:00.000Z',
        end: '2026-09-08T01:00:00.000Z',
        timezone: 'America/New_York'
    },
    attendeeEmails: ['demo@pathsynch.com']
});

function event(overrides = {}) {
    return Object.assign({
        event_id: 'event_1',
        title: expected.title,
        status: 'confirmed',
        organizer_email: expected.organizerEmail,
        participant_emails: ['demo@pathsynch.com', expected.organizerEmail],
        calendar_id: expected.calendarId,
        start: expected.slot.start,
        end: expected.slot.end,
        start_timezone: expected.timezone,
        end_timezone: expected.timezone
    }, overrides);
}

function verify(overrides = {}) {
    return verifyNylasBooking({
        created: overrides.created || created,
        booking: overrides.booking || booking,
        event: overrides.event || event(),
        expected: overrides.expected || expected
    });
}

describe('Nylas booking verification', () => {
    test('accepts the intended primary guest when Nylas also lists the organizer as a participant', () => {
        expect(verify({
            event: event({
                organizer_email: 'HELLO@PathSynch.com',
                participant_emails: ['DEMO@PathSynch.com', 'hello@pathsynch.com']
            })
        })).toMatchObject({
            organizer_email: 'hello@pathsynch.com',
            attendee_emails: ['demo@pathsynch.com']
        });
    });

    test('accepts the organizer represented separately from event participants', () => {
        expect(verify({
            event: event({ participant_emails: ['demo@pathsynch.com'] })
        })).toMatchObject({ attendee_emails: ['demo@pathsynch.com'] });
    });

    test('requires every intended additional guest while allowing only the configured organizer as an extra', () => {
        const withAdditionalGuest = Object.assign({}, expected, {
            attendeeEmails: ['demo@pathsynch.com', 'additional@example.com']
        });
        expect(verify({
            expected: withAdditionalGuest,
            event: event({
                participant_emails: [
                    'additional@example.com',
                    'hello@pathsynch.com',
                    'demo@pathsynch.com'
                ]
            })
        })).toMatchObject({
            attendee_emails: ['demo@pathsynch.com', 'additional@example.com']
        });
        expect(() => verify({
            expected: withAdditionalGuest,
            event: event({ participant_emails: ['demo@pathsynch.com', 'hello@pathsynch.com'] })
        })).toThrow(expect.objectContaining({ reason: 'attendee_set_mismatch' }));
    });

    test.each([
        ['missing primary guest', ['hello@pathsynch.com']],
        ['wrong primary guest', ['wrong@example.com', 'hello@pathsynch.com']],
        ['unexpected non-organizer participant', [
            'demo@pathsynch.com',
            'hello@pathsynch.com',
            'unexpected@example.com'
        ]]
    ])('%s fails closed', (_label, participantEmails) => {
        expect(() => verify({ event: event({ participant_emails: participantEmails }) }))
            .toThrow(expect.objectContaining({
                name: 'BookingVerificationError',
                reason: 'attendee_set_mismatch'
            }));
    });

    test('verifies the organizer independently from participant membership', () => {
        expect(() => verify({
            event: event({
                organizer_email: 'wrong@example.com',
                participant_emails: ['demo@pathsynch.com', 'hello@pathsynch.com']
            })
        })).toThrow(expect.objectContaining({ reason: 'organizer_mismatch' }));
    });

    test.each([
        ['title', event({ title: 'Wrong title' }), 'title_mismatch'],
        ['time', event({ start: '2026-09-08T00:31:00.000Z' }), 'time_mismatch'],
        ['booking status', event(), 'booking_status_invalid', Object.assign({}, booking, { status: null })],
        ['event status', event({ status: null }), 'event_status_invalid']
    ])('keeps %s verification strict', (_label, candidateEvent, reason, candidateBooking = booking) => {
        expect(() => verify({ event: candidateEvent, booking: candidateBooking }))
            .toThrow(expect.objectContaining({ reason }));
    });

    test('throws only the typed verification error for attendee mismatch', () => {
        try {
            verify({ event: event({ participant_emails: [] }) });
            throw new Error('verification unexpectedly passed');
        } catch (error) {
            expect(error).toBeInstanceOf(BookingVerificationError);
            expect(error.message).toBe('Nylas booking verification failed');
        }
    });
});
