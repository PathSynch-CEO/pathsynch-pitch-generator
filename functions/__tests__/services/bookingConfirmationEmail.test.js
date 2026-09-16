'use strict';

const {
    DEFAULT_FROM, LOGO_URL, messageFor, cancellationMessageFor, createBookingConfirmationMailer
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
    test('fails configuration before any booking-side effect when SendGrid is absent', () => {
        const prior = process.env.SENDGRID_API_KEY;
        delete process.env.SENDGRID_API_KEY;
        try {
            expect(() => createBookingConfirmationMailer()).toThrow('SendGrid is not configured');
        } finally {
            if (prior === undefined) delete process.env.SENDGRID_API_KEY;
            else process.env.SENDGRID_API_KEY = prior;
        }
    });

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

    test('binds stable confirmation and attempt identity and retains the provider message ID', async () => {
        const send = jest.fn().mockResolvedValue([{ headers: { 'x-message-id': 'provider_message_1' } }]);
        const delivery = { confirmation_id: 'cnf_stable_1', attempt_id: 'dla_attempt_1' };

        await expect(createBookingConfirmationMailer({ send }).sendConfirmation({
            booking, identity, specialist, delivery
        })).resolves.toEqual({ provider_message_id: 'provider_message_1' });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            customArgs: {
                synchintro_confirmation_id: delivery.confirmation_id,
                synchintro_delivery_attempt_id: delivery.attempt_id
            }
        }));
    });

    test('rejects malformed delivery identity before email egress', async () => {
        const send = jest.fn();
        await expect(createBookingConfirmationMailer({ send }).sendConfirmation({
            booking, identity, specialist,
            delivery: { confirmation_id: 'cnf_valid', attempt_id: '../unsafe' }
        })).rejects.toThrow('delivery identity is invalid');
        expect(send).not.toHaveBeenCalled();
    });

    test('fails before egress when the real guest name is unavailable', () => {
        expect(() => messageFor({ booking, identity: { email: identity.email }, specialist }))
            .toThrow('identity is incomplete');
    });

    test('builds and sends one branded cancellation message with stable delivery identity', async () => {
        const delivery = { confirmation_id: 'cnd_stable_1', attempt_id: 'cda_attempt_1' };
        const message = cancellationMessageFor({ booking, identity, specialist, delivery });
        expect(message).toMatchObject({
            to: identity.email,
            from: DEFAULT_FROM,
            subject: 'Your SynchIntro meeting is cancelled',
            customArgs: {
                synchintro_cancellation_id: delivery.confirmation_id,
                synchintro_cancellation_delivery_attempt_id: delivery.attempt_id
            }
        });
        expect(message.text).toContain('Taylor Jordan');
        expect(message.text).toContain('Charles Berry, Founder & CEO');
        expect(message.text).toContain('America/New_York');
        expect(message.html).toContain(LOGO_URL);
        expect(JSON.stringify(message)).not.toMatch(/grant_id|configuration_id|api[_-]?key/i);

        const send = jest.fn().mockResolvedValue([{ headers: { 'x-message-id': 'provider_cancel_message_1' } }]);
        await expect(createBookingConfirmationMailer({ send }).sendCancellation({
            booking, identity, specialist, delivery
        })).resolves.toEqual({ provider_message_id: 'provider_cancel_message_1' });
        expect(send).toHaveBeenCalledTimes(1);
    });
});
