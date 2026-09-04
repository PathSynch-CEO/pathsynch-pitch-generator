'use strict';

const crypto = require('crypto');
const Joi = require('joi');

const GOALS = Object.freeze([
    'Generate more qualified leads',
    'Improve local visibility',
    'Increase reviews and reputation',
    'Automate follow-up',
    'Government opportunity intelligence',
    'Something else'
]);

const CATEGORIES = Object.freeze([
    'Home Services',
    'Professional Services',
    'Healthcare',
    'Retail & Hospitality',
    'Public Sector',
    'Technology',
    'Other'
]);

const TEAM_SIZES = Object.freeze(['Just me', '2–10', '11–25', '26–50', '51+']);
const ATTRIBUTION_FIELDS = Object.freeze([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_id',
    'utm_term',
    'utm_content',
    'campaign_id',
    'creative_id',
    'landing_variant'
]);

const SAFE_ATTRIBUTION_VALUE = /[^a-zA-Z0-9._~:/+\- ]/g;
const EMAIL_LIKE_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE_VALUE = /(?:\+?\d[\s().-]*){8,}/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

const boundedIdentifier = Joi.string().trim().min(1).max(100).pattern(IDENTIFIER_PATTERN);
const optionalText = (max) => Joi.string().trim().max(max).allow('', null);

const identitySchema = Joi.object({
    email: Joi.string().email().max(254).lowercase().trim().required(),
    provider: Joi.string().valid('email', 'google').required(),
    first_name: optionalText(100),
    last_name: optionalText(100)
}).unknown(false);

const companySchema = Joi.object({
    name: Joi.string().trim().min(1).max(120).required(),
    domain: Joi.string().trim().lowercase().max(253).pattern(DOMAIN_PATTERN).allow(null),
    website: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow(null),
    description: optionalText(500),
    description_source: optionalText(64),
    confidence: Joi.string().valid('low', 'medium', 'high').required(),
    source: Joi.string().trim().min(1).max(64).required(),
    match_status: Joi.string().valid('enriched', 'confirmed', 'corrected', 'provided').required(),
    verified_at: Joi.string().isoDate().allow(null)
}).unknown(false);

const qualificationSchema = Joi.object({
    goal: Joi.string().valid(...GOALS).required(),
    goal_detail: Joi.when('goal', {
        is: 'Something else',
        then: Joi.string().trim().min(2).max(240).required(),
        otherwise: Joi.forbidden()
    }),
    category: Joi.string().valid(...CATEGORIES).required(),
    category_detail: Joi.when('category', {
        is: 'Other',
        then: Joi.string().trim().min(2).max(100).required(),
        otherwise: Joi.forbidden()
    }),
    team_size: Joi.string().valid(...TEAM_SIZES).required()
}).unknown(false);

const createSessionSchema = Joi.object({
    flow_id: boundedIdentifier.required(),
    identity: identitySchema.required(),
    timezone: Joi.string().trim().min(1).max(64).required(),
    attribution: Joi.object().unknown(false).default({})
}).unknown(false);

const updateSessionSchema = Joi.object({
    session_version: Joi.number().integer().min(1).required(),
    company: companySchema.required(),
    qualification: qualificationSchema.required()
}).unknown(false);

const slotSchema = Joi.object({
    id: boundedIdentifier.required(),
    start: Joi.string().isoDate().required(),
    end: Joi.string().isoDate().required(),
    timezone: Joi.string().trim().min(1).max(64).required(),
    availability_version: Joi.number().integer().min(1).required()
}).unknown(false);

const bookingRequestSchema = Joi.object({
    session_version: Joi.number().integer().min(1).required(),
    slot: slotSchema.required(),
    guests: Joi.array().items(Joi.string().email().max(254).lowercase().trim()).max(3).default([])
}).unknown(false);

function isIanaTimezone(value) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeAttribution(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return ATTRIBUTION_FIELDS.reduce((result, key) => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) return result;
        const raw = String(source[key] || '');
        if (EMAIL_LIKE_VALUE.test(raw) || PHONE_LIKE_VALUE.test(raw)) return result;
        const value = raw.replace(SAFE_ATTRIBUTION_VALUE, '').trim().slice(0, 160);
        if (value) result[key] = value;
        return result;
    }, {});
}

function normalizeQualification(input) {
    const value = Object.assign({}, input || {});
    if (typeof value.team_size === 'string') {
        value.team_size = value.team_size.replace(/\s+employees$/i, '').trim();
    }
    if (value.goal !== 'Something else') delete value.goal_detail;
    if (value.category !== 'Other') delete value.category_detail;
    return value;
}

function validationResult(schema, input) {
    const { error, value } = schema.validate(input, {
        abortEarly: false,
        stripUnknown: false,
        convert: true
    });
    if (!error) return { valid: true, value };
    return {
        valid: false,
        errors: error.details.map((detail) => ({
            field: detail.path.join('.'),
            code: detail.type
        }))
    };
}

function validateCreateSession(input) {
    const request = Object.assign({}, input || {}, {
        attribution: normalizeAttribution(input && input.attribution)
    });
    const result = validationResult(createSessionSchema, request);
    if (result.valid && !isIanaTimezone(result.value.timezone)) {
        return { valid: false, errors: [{ field: 'timezone', code: 'timezone.invalid' }] };
    }
    return result;
}

function validateSessionUpdate(input) {
    const request = Object.assign({}, input || {}, {
        qualification: normalizeQualification(input && input.qualification)
    });
    return validationResult(updateSessionSchema, request);
}

function validateBookingRequest(input, options = {}) {
    const result = validationResult(bookingRequestSchema, input || {});
    if (!result.valid) return result;

    const start = new Date(result.value.slot.start).getTime();
    const end = new Date(result.value.slot.end).getTime();
    if (end <= start) {
        return { valid: false, errors: [{ field: 'slot.end', code: 'slot.invalid_range' }] };
    }
    if (!isIanaTimezone(result.value.slot.timezone)) {
        return { valid: false, errors: [{ field: 'slot.timezone', code: 'timezone.invalid' }] };
    }

    const normalizedGuests = result.value.guests.map((email) => email.toLowerCase());
    if (new Set(normalizedGuests).size !== normalizedGuests.length) {
        return { valid: false, errors: [{ field: 'guests', code: 'guests.duplicate' }] };
    }
    const prospectEmail = String(options.prospectEmail || '').trim().toLowerCase();
    if (prospectEmail && normalizedGuests.includes(prospectEmail)) {
        return { valid: false, errors: [{ field: 'guests', code: 'guests.includes_prospect' }] };
    }
    result.value.guests = normalizedGuests;
    return result;
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (key.length < 16 || key.length > 128 || !IDENTIFIER_PATTERN.test(key)) return null;
    return key;
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
    }, {});
}

function bookingRequestFingerprint(value) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(canonicalize(value || {})))
        .digest('hex');
}

function assessIdempotency(existing, idempotencyKey, fingerprint) {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedKey) return { action: 'invalid' };
    if (!existing) return { action: 'create', idempotencyKey: normalizedKey };
    if (existing.idempotencyKey !== normalizedKey) return { action: 'conflict' };
    if (existing.fingerprint === fingerprint) return { action: 'replay', booking: existing.booking };
    return { action: 'conflict' };
}

module.exports = {
    GOALS,
    CATEGORIES,
    TEAM_SIZES,
    ATTRIBUTION_FIELDS,
    normalizeAttribution,
    normalizeQualification,
    validateCreateSession,
    validateSessionUpdate,
    validateBookingRequest,
    normalizeIdempotencyKey,
    bookingRequestFingerprint,
    assessIdempotency
};
