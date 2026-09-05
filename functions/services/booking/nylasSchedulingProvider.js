'use strict';

const crypto = require('crypto');
const { createNylasHttpClient, NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');
const { assertSchedulingProvider } = require('./schedulingProvider');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function configurationError(field) {
    const error = new Error(`Nylas ${field} is not configured correctly`);
    error.code = 'PROVIDER_NOT_CONFIGURED';
    return error;
}

function validTimezone(value) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
    } catch (_) {
        return false;
    }
}

function loadNylasConfiguration(env = process.env) {
    const config = {
        apiKey: String(env.NYLAS_API_KEY || '').trim(),
        grantId: String(env.NYLAS_GRANT_ID || '').trim(),
        configurationId: String(env.NYLAS_SCHEDULER_CONFIGURATION_ID || '').trim(),
        organizerEmail: String(env.NYLAS_EXPECTED_ORGANIZER || '').trim().toLowerCase(),
        timezone: String(env.NYLAS_EXPECTED_TIMEZONE || '').trim(),
        durationMinutes: Number(env.NYLAS_EXPECTED_DURATION_MINUTES),
        title: String(env.NYLAS_EXPECTED_EVENT_TITLE || '').trim(),
        calendarId: String(env.NYLAS_BOOKING_CALENDAR_ID || 'primary').trim()
    };
    if (!config.apiKey) throw configurationError('API key');
    if (!UUID.test(config.grantId)) throw configurationError('grant ID');
    if (!UUID.test(config.configurationId)) throw configurationError('Scheduler configuration ID');
    if (!EMAIL.test(config.organizerEmail)) throw configurationError('organizer');
    if (!validTimezone(config.timezone)) throw configurationError('timezone');
    if (!Number.isInteger(config.durationMinutes) || config.durationMinutes < 1 || config.durationMinutes > 1440) {
        throw configurationError('duration');
    }
    if (!config.title || config.title.length > 240) throw configurationError('event title');
    if (config.calendarId !== 'primary') throw configurationError('booking calendar');
    return Object.freeze(config);
}

function providerMalformed(operation) {
    return new NylasHttpError(ERROR_CATEGORIES.MALFORMED, operation, {
        message: 'Nylas returned a malformed response'
    });
}

function unixSeconds(value, operation) {
    if (!Number.isInteger(value) || value < 1) throw providerMalformed(operation);
    return new Date(value * 1000).toISOString();
}

function safeIdentifier(value, operation) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw providerMalformed(operation);
    }
    return normalized;
}

function optionalCode(value, operation) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (!/^[a-z0-9_.:-]{1,100}$/.test(normalized)) throw providerMalformed(operation);
    return normalized;
}

function email(value, operation) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!EMAIL.test(normalized) || normalized.length > 254) throw providerMalformed(operation);
    return normalized;
}

function normalizeAvailability(data, config, window = {}) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.time_slots)) {
        throw providerMalformed('availability');
    }
    if (data.time_slots.length > 200) throw providerMalformed('availability');
    const seen = new Set();
    return data.time_slots.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw providerMalformed('availability');
        const start = unixSeconds(candidate.start_time, 'availability');
        const end = unixSeconds(candidate.end_time, 'availability');
        if (Date.parse(end) <= Date.parse(start)) throw providerMalformed('availability');
        if (candidate.end_time - candidate.start_time !== config.durationMinutes * 60) {
            throw providerMalformed('availability');
        }
        if ((window.startTime && candidate.start_time < window.startTime)
            || (window.endTime && candidate.end_time > window.endTime)) {
            throw providerMalformed('availability');
        }
        const digest = crypto.createHash('sha256')
            .update(`${config.configurationId}:${candidate.start_time}:${candidate.end_time}:${config.timezone}`)
            .digest('hex')
            .slice(0, 32);
        const slot = {
            id: `nyl_${digest}`,
            start,
            end,
            timezone: config.timezone
        };
        if (seen.has(slot.id)) throw providerMalformed('availability');
        seen.add(slot.id);
        return slot;
    });
}

function normalizeCreatedBooking(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw providerMalformed('create_booking');
    return {
        booking_id: safeIdentifier(data.booking_id, 'create_booking'),
        event_id: safeIdentifier(data.event_id, 'create_booking'),
        status: optionalCode(data.status, 'create_booking')
    };
}

function normalizeBooking(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw providerMalformed('get_booking');
    return {
        booking_id: safeIdentifier(data.booking_id, 'get_booking'),
        event_id: safeIdentifier(data.event_id, 'get_booking'),
        status: optionalCode(data.status, 'get_booking')
    };
}

function normalizeEvent(data, calendarId = 'primary') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw providerMalformed('get_event');
    const when = data.when;
    if (!when || typeof when !== 'object' || when.object !== 'timespan') throw providerMalformed('get_event');
    if (!Array.isArray(data.participants)) throw providerMalformed('get_event');
    const start = unixSeconds(when.start_time, 'get_event');
    const end = unixSeconds(when.end_time, 'get_event');
    const timezones = [when.start_timezone, when.end_timezone].filter(Boolean);
    if (timezones.some((timezone) => !validTimezone(timezone))) throw providerMalformed('get_event');
    if (data.calendar_id !== undefined) safeIdentifier(data.calendar_id, 'get_event');
    return {
        event_id: safeIdentifier(data.id, 'get_event'),
        title: String(data.title || '').trim(),
        status: optionalCode(data.status, 'get_event'),
        organizer_email: email(data.organizer && data.organizer.email, 'get_event'),
        participant_emails: data.participants.map((participant) => email(participant && participant.email, 'get_event')),
        calendar_id: calendarId,
        start,
        end,
        start_timezone: when.start_timezone || null,
        end_timezone: when.end_timezone || null
    };
}

function toUnixSeconds(value, field) {
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
        const error = new Error(`${field} is invalid`);
        error.code = 'INVALID_PROVIDER_INPUT';
        throw error;
    }
    return milliseconds / 1000;
}

function guestName(identity) {
    const name = [identity && identity.first_name, identity && identity.last_name]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
    return name || 'SynchIntro Guest';
}

function createNylasSchedulingProvider(options = {}) {
    const config = options.config || loadNylasConfiguration(options.env);
    const http = options.http || createNylasHttpClient({
        apiKey: config.apiKey,
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        maximumBytes: options.maximumBytes
    });

    const unsupported = async () => {
        const error = new Error('Scheduling operation is outside this adapter slice');
        error.code = 'PROVIDER_OPERATION_NOT_IMPLEMENTED';
        throw error;
    };

    return assertSchedulingProvider(Object.freeze({
        name: 'nylas',
        configured: true,
        configuration: Object.freeze({
            grantId: config.grantId,
            configurationId: config.configurationId,
            organizerEmail: config.organizerEmail,
            timezone: config.timezone,
            durationMinutes: config.durationMinutes,
            title: config.title,
            calendarId: config.calendarId
        }),
        async getAvailability({ start, end, timezone = config.timezone }) {
            if (!validTimezone(timezone)) {
                const error = new Error('timezone is invalid');
                error.code = 'INVALID_PROVIDER_INPUT';
                throw error;
            }
            const startTime = toUnixSeconds(start, 'start');
            const endTime = toUnixSeconds(end, 'end');
            const data = await http.request({
                method: 'GET',
                path: '/v3/scheduling/availability',
                query: {
                    start_time: startTime,
                    end_time: endTime,
                    configuration_id: config.configurationId
                },
                operation: 'availability'
            });
            return normalizeAvailability(
                data,
                Object.assign({}, config, { timezone }),
                { startTime, endTime }
            );
        },
        async createBooking({ slot, identity, guests = [] }) {
            const start = toUnixSeconds(slot.start, 'slot.start');
            const end = toUnixSeconds(slot.end, 'slot.end');
            const body = {
                start_time: start,
                end_time: end,
                guest: { name: guestName(identity), email: identity.email },
                timezone: slot.timezone
            };
            if (guests.length) {
                body.additional_guests = guests.map((guestEmail) => ({ email: guestEmail }));
            }
            const data = await http.request({
                method: 'POST',
                path: '/v3/scheduling/bookings',
                query: { configuration_id: config.configurationId, timezone: slot.timezone },
                body,
                operation: 'create_booking'
            });
            return normalizeCreatedBooking(data);
        },
        async getBooking({ bookingId }) {
            const data = await http.request({
                method: 'GET',
                path: `/v3/scheduling/bookings/${encodeURIComponent(bookingId)}`,
                query: { configuration_id: config.configurationId },
                operation: 'get_booking'
            });
            return normalizeBooking(data);
        },
        async getEvent({ eventId }) {
            const data = await http.request({
                method: 'GET',
                path: `/v3/grants/${encodeURIComponent(config.grantId)}/events/${encodeURIComponent(eventId)}`,
                query: { calendar_id: config.calendarId },
                operation: 'get_event'
            });
            return normalizeEvent(data, config.calendarId);
        },
        rescheduleBooking: unsupported,
        cancelBooking: unsupported,
        verifyWebhook: unsupported
    }));
}

module.exports = {
    loadNylasConfiguration,
    normalizeAvailability,
    normalizeCreatedBooking,
    normalizeBooking,
    normalizeEvent,
    createNylasSchedulingProvider
};
