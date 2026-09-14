'use strict';

const DEFAULT_POLICY = Object.freeze({
    timezone: 'America/New_York',
    weekdays: Object.freeze([1, 2, 3, 4, 5]),
    startMinute: 9 * 60,
    endMinute: 16 * 60
});

function policyError(reason) {
    const error = new Error('Booking slot is outside the configured scheduling policy');
    error.code = 'BOOKING_POLICY_REJECTED';
    error.reason = reason;
    return error;
}

function localParts(instant, timezone) {
    const milliseconds = Date.parse(instant);
    if (!Number.isFinite(milliseconds)) throw policyError('slot_time_invalid');
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hourCycle: 'h23'
    }).formatToParts(new Date(milliseconds)).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    const weekday = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: weekday[parts.weekday],
        millisecondOfDay: (((Number(parts.hour) * 60 + Number(parts.minute)) * 60
            + Number(parts.second)) * 1000) + Number(parts.fractionalSecond)
    };
}

function normalizePolicy(value) {
    const source = value || DEFAULT_POLICY;
    const timezone = String(source.timezone || '').trim();
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch (_) {
        throw new Error('Booking policy timezone is invalid');
    }
    const weekdays = Array.isArray(source.weekdays) ? source.weekdays.slice() : [];
    if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
        || new Set(weekdays).size !== weekdays.length) {
        throw new Error('Booking policy weekdays are invalid');
    }
    const startMinute = Number(source.startMinute);
    const endMinute = Number(source.endMinute);
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)
        || startMinute < 0 || endMinute > 24 * 60 || endMinute <= startMinute) {
        throw new Error('Booking policy hours are invalid');
    }
    return Object.freeze({ timezone, weekdays: Object.freeze(weekdays), startMinute, endMinute });
}

function assessSlot(slot, policyInput) {
    const policy = normalizePolicy(policyInput);
    if (!slot || slot.timezone !== policy.timezone) return { allowed: false, reason: 'timezone_mismatch' };
    let start;
    let end;
    try {
        start = localParts(slot.start, policy.timezone);
        end = localParts(slot.end, policy.timezone);
    } catch (error) {
        return { allowed: false, reason: error.reason || 'slot_time_invalid' };
    }
    if (start.date !== end.date) return { allowed: false, reason: 'crosses_local_day' };
    if (!policy.weekdays.includes(start.weekday) || !policy.weekdays.includes(end.weekday)) {
        return { allowed: false, reason: 'weekend' };
    }
    if (start.millisecondOfDay < policy.startMinute * 60 * 1000) {
        return { allowed: false, reason: 'before_business_hours' };
    }
    if (end.millisecondOfDay > policy.endMinute * 60 * 1000) {
        return { allowed: false, reason: 'after_business_hours' };
    }
    return { allowed: true, reason: null };
}

function assertSlotAllowed(slot, policy) {
    const assessment = assessSlot(slot, policy);
    if (!assessment.allowed) throw policyError(assessment.reason);
    return slot;
}

function filterSlots(slots, policy) {
    if (!Array.isArray(slots)) throw new Error('Booking slots must be an array');
    return slots.filter((slot) => assessSlot(slot, policy).allowed);
}

module.exports = { DEFAULT_POLICY, normalizePolicy, assessSlot, assertSlotAllowed, filterSlots };
