'use strict';

const crypto = require('crypto');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const COLLECTIONS = Object.freeze({
    SESSIONS: 'synchintroBookingSessions',
    AVAILABILITY_RECEIPTS: 'synchintroAvailabilityReceipts',
    BOOKING_OPERATIONS: 'synchintroBookingOperations'
});

const SESSION_STATES = Object.freeze({
    ACTIVE: 'ACTIVE',
    BOOKED: 'BOOKED'
});

const OPERATION_STATES = Object.freeze({
    CLAIMED: 'CLAIMED',
    PROVIDER_PENDING: 'PROVIDER_PENDING',
    CONFIRMED: 'CONFIRMED',
    FAILED: 'FAILED',
    OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN'
});

const RETENTION_MS = Object.freeze({
    SESSION: 24 * 60 * 60 * 1000,
    AVAILABILITY_RECEIPT: 60 * 60 * 1000,
    BOOKING_OPERATION: 30 * 24 * 60 * 60 * 1000
});

const OPERATION_LEASE_MS = 5 * 60 * 1000;

const SAFE_DOCUMENT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const SAFE_DIGEST = /^[a-f0-9]{64}$/;
const SAFE_CODE = /^[a-zA-Z0-9_.:-]{1,100}$/;
const FORBIDDEN_FIELD = /(?:api[_-]?key|secret|password|credential|authorization|oauth|access[_-]?token|refresh[_-]?token|provider[_-]?payload|raw[_-]?provider)/i;

function apiError(code, message, details = null) {
    return new ApiError(code, message, details);
}

function assertNoSecretFields(value, path = '') {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_FIELD.test(key)) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Secret or provider payload fields are not accepted');
        }
        assertNoSecretFields(child, path ? `${path}.${key}` : key);
    }
}

function assertSafeDocumentId(value, field) {
    const normalized = String(value || '').trim();
    if (!SAFE_DOCUMENT_ID.test(normalized)) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return normalized;
}

function assertPositiveInteger(value, field) {
    if (!Number.isInteger(value) || value < 1) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return value;
}

function assertSafeCode(value, field) {
    const normalized = String(value || '').trim();
    if (!SAFE_CODE.test(normalized)) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return normalized;
}

function isIanaTimezone(value) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeDate(value, field) {
    if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return date;
}

function storedDate(value, field) {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    if (value && value._timestamp instanceof Date) return value._timestamp;
    return normalizeDate(value, field);
}

function isExpired(record, now) {
    return storedDate(record.expires_at, 'expires_at').getTime() <= now.getTime();
}

function normalizeSlot(slot, timezone) {
    assertNoSecretFields(slot);
    const id = assertSafeDocumentId(slot && slot.id, 'slot.id');
    const start = normalizeDate(slot && slot.start, 'slot.start');
    const end = normalizeDate(slot && slot.end, 'slot.end');
    if (end.getTime() <= start.getTime()) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'slot.end must be after slot.start');
    }
    const slotTimezone = String((slot && slot.timezone) || '').trim();
    if (!isIanaTimezone(slotTimezone) || slotTimezone !== timezone) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'slot.timezone is invalid');
    }
    return {
        id,
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: slotTimezone
    };
}

function normalizeRoutingState(value) {
    if (value === undefined || value === null) return null;
    assertNoSecretFields(value);
    return {
        owner_id: assertSafeDocumentId(value.owner_id, 'routing_state.owner_id'),
        source: assertSafeCode(value.source, 'routing_state.source'),
        rule_version: assertSafeCode(value.rule_version, 'routing_state.rule_version')
    };
}

function normalizeProviderReference(value) {
    if (value === undefined || value === null) return null;
    assertNoSecretFields(value);
    return {
        provider: assertSafeCode(value.provider, 'provider_reference.provider'),
        configuration_id: assertSafeDocumentId(value.configuration_id, 'provider_reference.configuration_id')
    };
}

function normalizeProviderIdentifier(value, field) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return normalized;
}

function normalizeAttendeeEmails(value, field = 'attendee_emails') {
    const attendeeEmails = Array.isArray(value)
        ? value.map((email) => String(email).trim().toLowerCase())
        : [];
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (attendeeEmails.length < 1 || attendeeEmails.length > 4
        || attendeeEmails.some((email) => email.length > 254 || !emailPattern.test(email))
        || new Set(attendeeEmails).size !== attendeeEmails.length) {
        throw apiError(ErrorCodes.INVALID_INPUT, `${field} is invalid`);
    }
    return attendeeEmails;
}

function normalizeConfirmedResult(value) {
    assertNoSecretFields(value);
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const allowed = new Set([
        'booking_id', 'event_id', 'status', 'title', 'organizer_email',
        'attendee_emails', 'start', 'end', 'timezone', 'duration_minutes'
    ]);
    for (const key of Object.keys(value || {})) {
        if (!allowed.has(key)) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Confirmed booking result contains an unsupported field');
        }
    }

    const start = normalizeDate(value.start, 'confirmed_result.start');
    const end = normalizeDate(value.end, 'confirmed_result.end');
    if (end.getTime() <= start.getTime()) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.end must be after start');
    }
    if (!isIanaTimezone(value.timezone)) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.timezone is invalid');
    }
    if (!Number.isInteger(value.duration_minutes) || value.duration_minutes < 1) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.duration_minutes is invalid');
    }
    if (end.getTime() - start.getTime() !== value.duration_minutes * 60 * 1000) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result duration does not match its time range');
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const attendeeEmails = normalizeAttendeeEmails(
        value.attendee_emails,
        'confirmed_result.attendee_emails'
    );
    const organizerEmail = String(value.organizer_email || '').trim().toLowerCase();
    if (organizerEmail.length > 254 || !emailPattern.test(organizerEmail)) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.organizer_email is invalid');
    }
    const title = String(value.title || '').trim();
    if (!title || title.length > 240) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.title is invalid');
    }

    const status = assertSafeCode(value.status, 'confirmed_result.status').toLowerCase();
    if (!['booked', 'confirmed'].includes(status)) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'confirmed_result.status is invalid');
    }

    return {
        booking_id: normalizeProviderIdentifier(value.booking_id, 'confirmed_result.booking_id'),
        event_id: normalizeProviderIdentifier(value.event_id, 'confirmed_result.event_id'),
        status,
        title,
        organizer_email: organizerEmail,
        attendee_emails: attendeeEmails,
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: value.timezone,
        duration_minutes: value.duration_minutes
    };
}

function sanitizeOperation(record) {
    if (!record) return null;
    const copy = Object.assign({}, record);
    delete copy.claim_token_digest;
    return copy;
}

function availabilityReceiptId(sessionId, availabilityVersion) {
    const digest = crypto.createHash('sha256')
        .update(`${sessionId}:${availabilityVersion}`)
        .digest('hex');
    return `avr_${digest}`;
}

function assertFingerprint(value) {
    const fingerprint = String(value || '').trim().toLowerCase();
    if (!SAFE_DIGEST.test(fingerprint)) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'Booking request fingerprint is invalid');
    }
    return fingerprint;
}

module.exports = {
    COLLECTIONS,
    SESSION_STATES,
    OPERATION_STATES,
    RETENTION_MS,
    OPERATION_LEASE_MS,
    apiError,
    assertNoSecretFields,
    assertSafeDocumentId,
    assertPositiveInteger,
    assertSafeCode,
    isIanaTimezone,
    normalizeDate,
    storedDate,
    isExpired,
    normalizeSlot,
    normalizeRoutingState,
    normalizeProviderReference,
    normalizeProviderIdentifier,
    normalizeAttendeeEmails,
    normalizeConfirmedResult,
    sanitizeOperation,
    availabilityReceiptId,
    assertFingerprint
};
