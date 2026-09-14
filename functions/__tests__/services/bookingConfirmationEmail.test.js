'use strict';

const {
    DEFAULT_FROM, LOGO_URL, messageFor, createBookingConfirmationMailer
} = require('../../services/booking/bookingConfirmationEmail');

const booking = Object.freeze({
    title: 'SynchIntro Strategy Call',
    start: '2026-09-14T13:00:00.000Z',
    end: '2026-09-14T13:30:00.000Z',
    timezone: 'America/New_York'
});
const identity = Object.freeze({ first_name: 'Taylor', last_name: 'Jordan', email: 'taylor@example.com' });
const specialist = Object.freeze({ display_name: 'Charles Berry', title: 'Founder & CEO' });

describe('SynchIntro booking confirmation email', () => {
    test('builds one branded, timezone-explicit customer message', () => {
        const message = messageFor({ booking, identity, specialist });
        expect(message).toMatchObject({
            to: identity.email, from: DEFAULT_FROM, subject: 'Confirmed: SynchIntro Strategy Call'
        });
        expect(message.text).toContain('Taylor Jordan');
        expect(message.text).toContain('Charles Berry, Founder & CEO');
        expect(message.text).toContain('America/New_York');
        expect(message.html).toContain(LOGO_URL);
        expect(message.html).toContain('SynchIntro by PathSynch');
        expect(JSON.stringify(message)).not.toMatch(/grant_id|configuration_id|api[_-]?key/i);
    });

    test('sends exactly once per explicit mailer invocation', async () => {
        const send = jest.fn().mockResolvedValue(undefined);
        await createBookingConfirmationMailer({ send }).sendConfirmation({ booking, identity, specialist });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: identity.email }));
    });

    test('fails before egress when the real guest name is unavailable', () => {
        expect(() => messageFor({ booking, identity: { email: identity.email }, specialist }))
            .toThrow('identity is incomplete');
    });
});
