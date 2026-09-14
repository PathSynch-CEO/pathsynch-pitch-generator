'use strict';

const {
    DEFAULT_POLICY, assessSlot, assertSlotAllowed, filterSlots
} = require('../../services/booking/bookingSchedulingPolicy');

function slot(start, end, timezone = 'America/New_York') {
    return { id: 'slot_policy', start, end, timezone };
}

describe('booking scheduling policy', () => {
    test.each([
        ['weekend', slot('2026-09-13T14:00:00.000Z', '2026-09-13T14:30:00.000Z'), 'weekend'],
        ['before opening', slot('2026-09-14T12:30:00.000Z', '2026-09-14T13:00:00.000Z'), 'before_business_hours'],
        ['after closing', slot('2026-09-14T19:45:00.000Z', '2026-09-14T20:15:00.000Z'), 'after_business_hours'],
        ['one millisecond after closing', slot('2026-09-14T19:30:00.001Z', '2026-09-14T20:00:00.001Z'), 'after_business_hours'],
        ['wrong timezone', slot('2026-09-14T13:00:00.000Z', '2026-09-14T13:30:00.000Z', 'UTC'), 'timezone_mismatch']
    ])('rejects %s', (_label, candidate, reason) => {
        expect(assessSlot(candidate, DEFAULT_POLICY)).toEqual({ allowed: false, reason });
        expect(() => assertSlotAllowed(candidate, DEFAULT_POLICY)).toThrow(
            expect.objectContaining({ code: 'BOOKING_POLICY_REJECTED', reason })
        );
    });

    test('accepts meetings fully contained in Monday-Friday 9:00-16:00 Eastern', () => {
        const opening = slot('2026-09-14T13:00:00.000Z', '2026-09-14T13:30:00.000Z');
        const closing = slot('2026-09-14T19:30:00.000Z', '2026-09-14T20:00:00.000Z');
        expect(filterSlots([opening, closing], DEFAULT_POLICY)).toEqual([opening, closing]);
    });

    test('applies Eastern local time correctly across daylight-saving seasons', () => {
        expect(assessSlot(
            slot('2026-01-12T14:00:00.000Z', '2026-01-12T14:30:00.000Z'),
            DEFAULT_POLICY
        ).allowed).toBe(true);
        expect(assessSlot(
            slot('2026-07-13T13:00:00.000Z', '2026-07-13T13:30:00.000Z'),
            DEFAULT_POLICY
        ).allowed).toBe(true);
    });
});
