'use strict';

const sgMail = require('@sendgrid/mail');

const DEFAULT_FROM = Object.freeze({ email: 'hello@pathsynch.com', name: 'SynchIntro by PathSynch' });
const LOGO_URL = 'https://app.synchintro.ai/images/booking/pathsynch-logo.png';

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function guestName(identity) {
    return [identity && identity.first_name, identity && identity.last_name]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
}

function formattedMeeting(booking) {
    const date = new Date(booking.start);
    if (!Number.isFinite(date.getTime())) throw new Error('Booking confirmation start is invalid');
    return new Intl.DateTimeFormat('en-US', {
        timeZone: booking.timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    }).format(date);
}

function deliveryMetadata(delivery) {
    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) return null;
    const confirmationId = String(delivery.confirmation_id || '').trim();
    const attemptId = String(delivery.attempt_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(confirmationId)
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(attemptId)) {
        throw new Error('Booking confirmation delivery identity is invalid');
    }
    return {
        synchintro_confirmation_id: confirmationId,
        synchintro_delivery_attempt_id: attemptId
    };
}

function providerMessageId(result) {
    const response = Array.isArray(result) ? result[0] : result;
    const headers = response && response.headers;
    const value = headers && typeof headers.get === 'function'
        ? headers.get('x-message-id')
        : headers && (headers['x-message-id'] || headers['X-Message-Id']);
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
}

function messageFor({ booking, identity, specialist, delivery }) {
    const name = guestName(identity);
    if (!name || !identity || !identity.email) throw new Error('Booking confirmation identity is incomplete');
    if (!specialist || !specialist.display_name || !specialist.title) {
        throw new Error('Booking confirmation specialist is incomplete');
    }
    const meeting = formattedMeeting(booking);
    const safeName = escapeHtml(name);
    const safeTitle = escapeHtml(booking.title);
    const safeMeeting = escapeHtml(meeting);
    const safeTimezone = escapeHtml(booking.timezone);
    const safeSpecialist = escapeHtml(specialist.display_name);
    const safeSpecialistTitle = escapeHtml(specialist.title);
    const message = {
        to: identity.email,
        from: DEFAULT_FROM,
        subject: `Confirmed: ${booking.title}`,
        text: [
            `Hi ${name},`,
            '',
            `Your ${booking.title} is confirmed for ${meeting}.`,
            `Timezone: ${booking.timezone}`,
            `Your specialist: ${specialist.display_name}, ${specialist.title}`,
            '',
            'We’ll use the context you shared to prepare a more useful conversation.',
            '',
            'SynchIntro by PathSynch'
        ].join('\n'),
        html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;color:#2a2f36;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff"><div style="background:#14181d;padding:24px 32px;text-align:center"><img src="${LOGO_URL}" alt="PathSynch" width="52" height="52" style="display:block;margin:0 auto 10px"><div style="color:#d98a1e;font-size:22px;font-weight:800">SynchIntro</div><div style="color:#e9e5dc;font-size:13px">by PathSynch</div></div><div style="padding:32px"><p style="font-size:17px">Hi ${safeName},</p><h1 style="color:#14181d;font-size:25px">Your meeting is confirmed.</h1><div style="border-left:4px solid #ba7517;background:#f7f4ee;padding:18px 20px;margin:24px 0"><strong>${safeTitle}</strong><p style="margin:10px 0 0">${safeMeeting}</p><p style="margin:6px 0 0;color:#5a616b">${safeTimezone}</p></div><p><strong>Your Specialist</strong><br>${safeSpecialist}<br><span style="color:#5a616b">${safeSpecialistTitle}</span></p><p>We’ll use the context you shared to prepare a more useful conversation.</p></div><div style="background:#14181d;color:#9aa1ab;padding:20px 32px;text-align:center;font-size:12px">SynchIntro by PathSynch Labs</div></div></body></html>`
    };
    const metadata = deliveryMetadata(delivery);
    if (metadata) message.customArgs = metadata;
    return message;
}

function createBookingConfirmationMailer(options = {}) {
    const send = options.send || (async (message) => {
        if (!process.env.SENDGRID_API_KEY) throw new Error('SendGrid is not configured');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        return sgMail.send(message);
    });
    return Object.freeze({
        async sendConfirmation(input) {
            const result = await send(messageFor(input));
            return { provider_message_id: providerMessageId(result) };
        }
    });
}

module.exports = {
    DEFAULT_FROM,
    LOGO_URL,
    guestName,
    formattedMeeting,
    deliveryMetadata,
    providerMessageId,
    messageFor,
    createBookingConfirmationMailer
};
