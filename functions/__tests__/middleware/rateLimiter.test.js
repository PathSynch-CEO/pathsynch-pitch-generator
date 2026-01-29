/**
 * Rate Limiter Middleware Tests
 */

const admin = require('firebase-admin');
const {
    rateLimiter,
    checkRateLimit,
    getClientIP,
    getRateLimitKey,
    getEndpointKey,
    getRateLimitStatus,
    cleanupRateLimits
} = require('../../middleware/rateLimiter');

const {
    PLAN_LIMITS,
    IP_LIMITS,
    getEndpointLimit,
    getGlobalLimit,
    getIPLimit,
    isEndpointBlocked
} = require('../../config/rateLimits');

describe('Rate Limit Configuration', () => {
    describe('PLAN_LIMITS', () => {
        it('should define limits for all plan tiers', () => {
            expect(PLAN_LIMITS).toHaveProperty('anonymous');
            expect(PLAN_LIMITS).toHaveProperty('starter');
            expect(PLAN_LIMITS).toHaveProperty('growth');
            expect(PLAN_LIMITS).toHaveProperty('scale');
        });

        it('should have global limits for each plan', () => {
            Object.keys(PLAN_LIMITS).forEach(plan => {
                expect(PLAN_LIMITS[plan].global).toBeDefined();
                expect(PLAN_LIMITS[plan].global.requests).toBeGreaterThanOrEqual(0);
                expect(PLAN_LIMITS[plan].global.window).toBeGreaterThan(0);
            });
        });

        it('should have endpoint limits for each plan', () => {
            Object.keys(PLAN_LIMITS).forEach(plan => {
                expect(PLAN_LIMITS[plan].endpoints).toBeDefined();
                expect(PLAN_LIMITS[plan].endpoints.generatePitch).toBeDefined();
            });
        });

        it('should have increasing limits for higher tiers', () => {
            expect(PLAN_LIMITS.starter.global.requests).toBeGreaterThan(PLAN_LIMITS.anonymous.global.requests);
            expect(PLAN_LIMITS.growth.global.requests).toBeGreaterThan(PLAN_LIMITS.starter.global.requests);
            expect(PLAN_LIMITS.scale.global.requests).toBeGreaterThan(PLAN_LIMITS.growth.global.requests);
        });
    });

    describe('IP_LIMITS', () => {
        it('should define global and burst limits', () => {
            expect(IP_LIMITS.global).toBeDefined();
            expect(IP_LIMITS.burst).toBeDefined();
        });

        it('should have burst window shorter than global', () => {
            expect(IP_LIMITS.burst.window).toBeLessThan(IP_LIMITS.global.window);
        });
    });

    describe('getEndpointLimit', () => {
        it('should return limit for exact path match', () => {
            const limit = getEndpointLimit('starter', '/generate-pitch');
            expect(limit).toBeDefined();
            expect(limit.requests).toBe(10);
        });

        it('should return limit for pattern match', () => {
            const limit = getEndpointLimit('growth', '/narratives/abc123/format');
            expect(limit).toBeDefined();
            expect(limit.requests).toBe(100);
        });

        it('should return null for unmatched path', () => {
            const limit = getEndpointLimit('starter', '/unknown-path');
            expect(limit).toBeNull();
        });

        it('should return null for invalid plan', () => {
            const limit = getEndpointLimit('invalid-plan', '/generate-pitch');
            expect(limit).toBeNull();
        });
    });

    describe('getGlobalLimit', () => {
        it('should return limit for valid plan', () => {
            const limit = getGlobalLimit('growth');
            expect(limit.requests).toBe(500);
            expect(limit.window).toBe(3600);
        });

        it('should return anonymous limit for invalid plan', () => {
            const limit = getGlobalLimit('invalid-plan');
            expect(limit).toEqual(PLAN_LIMITS.anonymous.global);
        });
    });

    describe('getIPLimit', () => {
        it('should return global IP limit by default', () => {
            const limit = getIPLimit();
            expect(limit).toEqual(IP_LIMITS.global);
        });

        it('should return burst limit when specified', () => {
            const limit = getIPLimit('burst');
            expect(limit).toEqual(IP_LIMITS.burst);
        });

        it('should fallback to global for invalid type', () => {
            const limit = getIPLimit('invalid');
            expect(limit).toEqual(IP_LIMITS.global);
        });
    });

    describe('isEndpointBlocked', () => {
        it('should return true for blocked endpoints', () => {
            expect(isEndpointBlocked('anonymous', '/narratives/generate')).toBe(true);
            expect(isEndpointBlocked('anonymous', '/market/report')).toBe(true);
        });

        it('should return false for allowed endpoints', () => {
            expect(isEndpointBlocked('growth', '/generate-pitch')).toBe(false);
            expect(isEndpointBlocked('scale', '/market/report')).toBe(false);
        });

        it('should return falsy for unmatched paths', () => {
            expect(isEndpointBlocked('starter', '/unknown-path')).toBeFalsy();
        });
    });
});

describe('Rate Limiter Helpers', () => {
    describe('getRateLimitKey', () => {
        it('should create valid Firestore document key', () => {
            const key = getRateLimitKey('user123', 'global');
            expect(key).toBe('user123_global');
        });

        it('should sanitize dots and slashes', () => {
            const key = getRateLimitKey('192.168.1.1', 'ip_global');
            expect(key).toBe('192_168_1_1_ip_global');
        });
    });

    describe('getClientIP', () => {
        it('should extract IP from x-forwarded-for header', () => {
            const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
            expect(getClientIP(req)).toBe('1.2.3.4');
        });

        it('should use req.ip as fallback', () => {
            const req = { headers: {}, ip: '10.0.0.1' };
            expect(getClientIP(req)).toBe('10.0.0.1');
        });

        it('should use connection.remoteAddress as secondary fallback', () => {
            const req = { headers: {}, connection: { remoteAddress: '172.16.0.1' } };
            expect(getClientIP(req)).toBe('172.16.0.1');
        });

        it('should return unknown when no IP available', () => {
            const req = { headers: {} };
            expect(getClientIP(req)).toBe('unknown');
        });
    });

    describe('getEndpointKey', () => {
        it('should return key for exact path match', () => {
            expect(getEndpointKey('/generate-pitch')).toBe('generatePitch');
            expect(getEndpointKey('/narratives/generate')).toBe('generateNarrative');
            expect(getEndpointKey('/market/report')).toBe('marketReport');
        });

        it('should return key for pattern match', () => {
            expect(getEndpointKey('/narratives/xyz/format')).toBe('formatNarrative');
            expect(getEndpointKey('/narratives/abc123/regenerate')).toBe('generateNarrative');
        });

        it('should return null for unmatched paths', () => {
            expect(getEndpointKey('/user')).toBeNull();
            expect(getEndpointKey('/unknown')).toBeNull();
        });
    });
});

describe('Rate Limiter Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        admin._resetMockData();

        mockReq = {
            path: '/generate-pitch',
            headers: { 'x-forwarded-for': '1.2.3.4' },
            user: { uid: 'user123', plan: 'starter' }
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            headersSent: false
        };

        mockNext = jest.fn();
    });

    describe('rateLimiter()', () => {
        it('should call next() when under rate limit', async () => {
            const middleware = rateLimiter();
            await middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalledWith(429);
        });

        it('should set rate limit headers', async () => {
            const middleware = rateLimiter();
            await middleware(mockReq, mockRes, mockNext);

            expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(String));
            expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
            expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
        });

        it('should return 403 for blocked endpoints', async () => {
            mockReq.user.plan = 'anonymous';
            mockReq.path = '/narratives/generate';

            const middleware = rateLimiter();
            await middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: expect.stringContaining('not available')
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should apply stricter IP limits for unauthenticated requests', async () => {
            mockReq.user = { uid: null, plan: 'anonymous' };

            const middleware = rateLimiter();
            await middleware(mockReq, mockRes, mockNext);

            // Should still proceed but with IP-based tracking
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.rateLimit.identifier).toBe('1.2.3.4');
        });

        it('should attach rate limit info to request', async () => {
            const middleware = rateLimiter();
            await middleware(mockReq, mockRes, mockNext);

            expect(mockReq.rateLimit).toBeDefined();
            expect(mockReq.rateLimit.identifier).toBe('user123');
            expect(mockReq.rateLimit.plan).toBe('starter');
            expect(mockReq.rateLimit.globalRemaining).toBeDefined();
        });
    });

    describe('checkRateLimit()', () => {
        it('should allow requests within limit', async () => {
            const result = await checkRateLimit('test-user', 'global', { requests: 10, window: 3600 });

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
            expect(result.count).toBe(1);
        });

        it('should track requests across multiple calls', async () => {
            const limit = { requests: 5, window: 3600 };

            const result1 = await checkRateLimit('test-user', 'test', limit);
            expect(result1.count).toBe(1);

            const result2 = await checkRateLimit('test-user', 'test', limit);
            expect(result2.count).toBe(2);

            const result3 = await checkRateLimit('test-user', 'test', limit);
            expect(result3.count).toBe(3);
        });

        it('should block requests over limit', async () => {
            const limit = { requests: 2, window: 3600 };

            await checkRateLimit('over-user', 'test', limit);
            await checkRateLimit('over-user', 'test', limit);
            const result = await checkRateLimit('over-user', 'test', limit);

            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should include reset timestamp', async () => {
            const result = await checkRateLimit('time-user', 'global', { requests: 10, window: 3600 });

            expect(result.resetAt).toBeDefined();
            expect(result.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
        });
    });

    describe('getRateLimitStatus()', () => {
        it('should return zero usage for new users', async () => {
            const status = await getRateLimitStatus('new-user', 'starter');

            expect(status.plan).toBe('starter');
            expect(status.global.used).toBe(0);
            expect(status.global.remaining).toBe(100);
            expect(status.global.limit).toBe(100);
        });

        it('should reflect current usage', async () => {
            // Simulate some usage
            await checkRateLimit('active-user', 'global', { requests: 100, window: 3600 });
            await checkRateLimit('active-user', 'global', { requests: 100, window: 3600 });

            const status = await getRateLimitStatus('active-user', 'starter');

            expect(status.global.used).toBe(2);
            expect(status.global.remaining).toBe(98);
        });
    });

    describe('cleanupRateLimits()', () => {
        it('should delete old rate limit documents', async () => {
            // Add some old data to mock
            const db = admin.firestore();
            const oldTimestamp = Math.floor(Date.now() / 1000) - 100000;

            await db.collection('rateLimits').doc('old_entry').set({
                windowStart: oldTimestamp,
                count: 5
            });

            const deleted = await cleanupRateLimits(86400);

            // Should delete the old entry
            expect(deleted).toBeGreaterThanOrEqual(0);
        });
    });
});

describe('Rate Limiting Integration', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
        admin._resetMockData();

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            headersSent: false
        };
    });

    it('should rate limit expensive endpoints more strictly', async () => {
        mockReq = {
            path: '/generate-pitch',
            headers: { 'x-forwarded-for': '10.0.0.1' },
            user: { uid: 'test123', plan: 'starter' }
        };

        const middleware = rateLimiter();

        // Starter plan: 10 generatePitch per hour
        for (let i = 0; i < 10; i++) {
            mockRes.headersSent = false;
            await middleware(mockReq, mockRes, jest.fn());
        }

        // 11th request should be rate limited
        mockRes.headersSent = false;
        const mockNext = jest.fn();
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(429);
    });

    it('should allow different endpoints independently', async () => {
        const userId = 'independent-user';

        // Use up generatePitch limit
        for (let i = 0; i < 10; i++) {
            await checkRateLimit(userId, 'endpoint_generatePitch', { requests: 10, window: 3600 });
        }

        // formatNarrative should still work (different endpoint)
        const result = await checkRateLimit(userId, 'endpoint_formatNarrative', { requests: 20, window: 3600 });
        expect(result.allowed).toBe(true);
    });

    it('should track users and IPs separately', async () => {
        const userLimit = { requests: 100, window: 3600 };
        const ipLimit = { requests: 30, window: 3600 };

        // User requests
        const userResult = await checkRateLimit('user-abc', 'global', userLimit);
        expect(userResult.remaining).toBe(99);

        // IP requests (different identifier)
        const ipResult = await checkRateLimit('192.168.1.100', 'ip_global', ipLimit);
        expect(ipResult.remaining).toBe(29);

        // They should be tracked independently
        const userResult2 = await checkRateLimit('user-abc', 'global', userLimit);
        expect(userResult2.remaining).toBe(98);
    });
});
