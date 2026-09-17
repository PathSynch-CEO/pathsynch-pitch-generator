'use strict';

const {
    LIMITS,
    digestIdentifier,
    createBookingRecoveryRateLimiter
} = require('../../services/booking/bookingRecoveryRateLimiter');

function response() {
    return {
        headersSent: false,
        statusCode: 200,
        body: null,
        headers: {},
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; this.headersSent = true; return this; }
    };
}

function request(overrides = {}) {
    return Object.assign({
        method: 'POST',
        normalizedPath: '/admin/synchintro/synthetic-recovery/RECORD/execute',
        headers: { 'x-operator-id': 'attacker' },
        body: { recovery_operation_id: 'caller-controlled' },
        recoveryActor: { uid: 'authoritative-operator' }
    }, overrides);
}

describe('governed recovery distributed abuse control', () => {
    test('allows bounded use and derives identity only from authenticated operator and server route scope', async () => {
        const checkRateLimit = jest.fn().mockResolvedValue({
            allowed: true, remaining: 4, resetAt: 2_000_000_000
        });
        const limiter = createBookingRecoveryRateLimiter({ checkRateLimit });
        const next = jest.fn();
        await limiter(request(), response(), next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(checkRateLimit).toHaveBeenCalledWith(
            digestIdentifier('authoritative-operator', 'execute'),
            'synchintro_synthetic_recovery_execute',
            LIMITS.execute
        );
        expect(JSON.stringify(checkRateLimit.mock.calls)).not.toMatch(/attacker|caller-controlled/);
    });

    test('rejects exhaustion without invoking recovery work', async () => {
        const limiter = createBookingRecoveryRateLimiter({
            checkRateLimit: jest.fn().mockResolvedValue({
                allowed: false, remaining: 0, resetAt: 2_000_000_000
            }),
            now: () => new Date('2033-05-18T03:32:00.000Z')
        });
        const res = response();
        const next = jest.fn();
        await limiter(request(), res, next);
        expect(res.statusCode).toBe(429);
        expect(next).not.toHaveBeenCalled();
    });

    test.each([
        ['error result', jest.fn().mockResolvedValue({ allowed: true, error: true })],
        ['backend rejection', jest.fn().mockRejectedValue(new Error('firestore unavailable'))]
    ])('fails closed on limiter %s', async (_label, checkRateLimit) => {
        const limiter = createBookingRecoveryRateLimiter({ checkRateLimit });
        const res = response();
        const next = jest.fn();
        await limiter(request(), res, next);
        expect(res.statusCode).toBe(503);
        expect(next).not.toHaveBeenCalled();
    });
});
