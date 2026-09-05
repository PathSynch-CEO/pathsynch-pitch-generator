'use strict';

const {
    LIMITS,
    digestIdentifier,
    bookingClientIp,
    createBookingApiRateLimiter
} = require('../../services/booking/bookingApiRateLimiter');

describe('SynchIntro booking API distributed rate limits', () => {
    test('uses bounded distributed IP and session counters with opaque identifiers', async () => {
        const check = jest.fn().mockResolvedValue({ allowed: true, remaining: 1, resetAt: 123 });
        const limiter = createBookingApiRateLimiter({
            checkRateLimit: check,
            getClientIP: () => '203.0.113.8'
        });

        await limiter.enforceSessionCreation({});
        await limiter.enforceAvailabilityIp({});
        await limiter.enforceAvailabilitySession('bks_public');
        await limiter.enforceBookingIp({});
        await limiter.enforceBookingSession('bks_public');

        expect(check).toHaveBeenCalledTimes(5);
        for (const [identifier, type, limit] of check.mock.calls) {
            expect(identifier).toMatch(/^[a-f0-9]{64}$/);
            expect(identifier).not.toContain('203.0.113.8');
            expect(identifier).not.toContain('bks_public');
            expect(type).toMatch(/^synchintro_/);
            expect(limit.requests).toBeGreaterThan(0);
            expect(limit.window).toBeGreaterThan(0);
        }
        expect(LIMITS.booking_session.requests).toBeLessThan(LIMITS.availability_session.requests);
    });

    test('returns a stable rate-limit error when a counter is exhausted', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const limiter = createBookingApiRateLimiter({
            checkRateLimit: async () => ({ allowed: false, remaining: 0, resetAt: nowSeconds + 30 }),
            getClientIP: () => '203.0.113.8'
        });

        await expect(limiter.enforceSessionCreation({})).rejects.toMatchObject({
            code: 'RATE_LIMIT',
            status: 429,
            details: { scope: 'session_create_ip', retry_after_seconds: expect.any(Number) }
        });
    });

    test('fails closed when the distributed counter is unavailable', async () => {
        const limiter = createBookingApiRateLimiter({
            checkRateLimit: async () => ({ allowed: true, error: true }),
            getClientIP: () => '203.0.113.8'
        });

        await expect(limiter.enforceBookingIp({})).rejects.toMatchObject({
            code: 'EXTERNAL_SERVICE_ERROR',
            status: 503
        });
    });

    test('produces different digests for different scopes', () => {
        expect(digestIdentifier('availability_ip', 'same'))
            .not.toBe(digestIdentifier('booking_ip', 'same'));
    });

    test('ignores a caller-supplied forwarded prefix and uses the client appended by Google', () => {
        expect(bookingClientIp({
            headers: {
                'x-forwarded-for': '198.51.100.99, 203.0.113.8, 35.191.0.1'
            },
            ip: '127.0.0.1'
        })).toBe('203.0.113.8');
        expect(bookingClientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
        expect(bookingClientIp({ headers: { 'x-forwarded-for': 'not-an-ip' } })).toBe('unknown');
    });
});
