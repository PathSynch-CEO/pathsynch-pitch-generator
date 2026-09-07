'use strict';

const MAX_AVAILABILITY_SLOTS = 512;
const MAX_BOOKING_NOTICE_MINUTES = 525600;
const BOOKING_NOTICE_SAFETY_MARGIN_MINUTES = 5;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

function isValidBookingNoticeMinutes(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_BOOKING_NOTICE_MINUTES;
}

function meetsBookingNotice(slotStart, at, noticeMinutes) {
    const slotStartMs = Date.parse(slotStart);
    const atMs = at instanceof Date ? at.getTime() : Date.parse(at);
    if (!Number.isFinite(slotStartMs)
        || !Number.isFinite(atMs)
        || !Number.isInteger(noticeMinutes)
        || noticeMinutes < 0
        || noticeMinutes > MAX_BOOKING_NOTICE_MINUTES + BOOKING_NOTICE_SAFETY_MARGIN_MINUTES) {
        throw new TypeError('booking notice input is invalid');
    }
    return slotStartMs >= atMs + (noticeMinutes * MILLISECONDS_PER_MINUTE);
}

module.exports = Object.freeze({
    MAX_AVAILABILITY_SLOTS,
    MAX_BOOKING_NOTICE_MINUTES,
    BOOKING_NOTICE_SAFETY_MARGIN_MINUTES,
    isValidBookingNoticeMinutes,
    meetsBookingNotice
});
