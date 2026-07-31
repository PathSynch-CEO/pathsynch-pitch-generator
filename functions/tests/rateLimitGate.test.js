'use strict';

/**
 * A3 / F-1003 — the main handler must AWAIT the async rate limiter and block when it fires.
 * The previous wiring raced the limiter against setTimeout(0), so an over-quota request slipped
 * through. This test drives the REAL rateLimiter middleware through the exact gate wiring used
 * in index.js and asserts an over-quota request is blocked (429, next never called).
 */

jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { rateLimiter, getRateLimitKey } = require('../middleware/rateLimiter');
const { getGlobalLimit } = require('../config/rateLimits');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        set: jest.fn(function () { return res; }),
    };
    return res;
}

// Mirrors the index.js gate exactly.
async function rateLimitGate(mw, req, res) {
    let allowed = false;
    try {
        await mw(req, res, () => { allowed = true; });
    } catch {
        allowed = true; // limiter fails open internally
    }
    return allowed && !res.headersSent;
}

beforeEach(() => admin._resetMockData());

describe('A3/F-1003 rate-limit gate blocks over-quota requests', () => {
    test('over-quota request → gate returns false and 429 is sent (next never called)', async () => {
        const plan = 'starter';
        const limit = getGlobalLimit(plan);
        const identifier = 'user-over-quota';
        const key = getRateLimitKey(identifier, 'global');
        const now = Math.floor(Date.now() / 1000);
        const windowStart = Math.floor(now / limit.window) * limit.window;

        // Seed the counter past the limit for the current window.
        admin._setMockCollection('rateLimits', {
            [key]: { windowStart, count: limit.requests + 10 },
        });

        const req = {
            method: 'GET', path: '/user', headers: {}, ip: '9.9.9.9',
            user: { uid: identifier, plan },
        };
        const res = mockRes();

        const passed = await rateLimitGate(rateLimiter(), req, res);

        expect(passed).toBe(false);         // blocked — the bug was this returning true
        expect(res._status).toBe(429);
    });

    test('under-quota request → gate returns true (next called, no 429)', async () => {
        const req = {
            method: 'GET', path: '/user', headers: {}, ip: '9.9.9.10',
            user: { uid: 'fresh-user', plan: 'starter' },
        };
        const res = mockRes();

        const passed = await rateLimitGate(rateLimiter(), req, res);

        expect(passed).toBe(true);
        expect(res._status).not.toBe(429);
    });
});
