'use strict';

const crypto = require('node:crypto');
const {
    createRequireRecoveryOperator,
    RECOVERY_AUTH_MAX_AGE_SECONDS
} = require('../../middleware/adminAuth');

const NOW = new Date('2026-09-16T20:00:00.000Z');

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

function dependencies(record = { role: 'super_admin' }, user = {}) {
    return {
        auth: {
            getUser: jest.fn().mockResolvedValue(Object.assign({
                email: 'operator@example.com', emailVerified: true
            }, user))
        },
        db: {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: Boolean(record), data: () => record })
                }))
            }))
        },
        now: () => NOW
    };
}

function request(overrides = {}) {
    return Object.assign({
        userId: 'operator_uid',
        emailVerified: true,
        authTime: Math.floor(NOW.getTime() / 1000) - 10
    }, overrides);
}

describe('synthetic recovery operator authentication', () => {
    test.each([null, undefined, 'anonymous'])('denies missing public identity %p', async (userId) => {
        const middleware = createRequireRecoveryOperator(dependencies());
        const res = response();
        await middleware(request({ userId }), res, jest.fn());
        expect(res.statusCode).toBe(401);
    });

    test('denies stale authentication', async () => {
        const middleware = createRequireRecoveryOperator(dependencies());
        const res = response();
        await middleware(request({
            authTime: Math.floor(NOW.getTime() / 1000) - RECOVERY_AUTH_MAX_AGE_SECONDS - 1
        }), res, jest.fn());
        expect(res.statusCode).toBe(401);
    });

    test('denies materially future authentication time', async () => {
        const middleware = createRequireRecoveryOperator(dependencies());
        const res = response();
        await middleware(request({ authTime: Math.floor(NOW.getTime() / 1000) + 61 }), res, jest.fn());
        expect(res.statusCode).toBe(401);
    });

    test('denies an unverified token identity', async () => {
        const middleware = createRequireRecoveryOperator(dependencies());
        const res = response();
        await middleware(request({ emailVerified: false }), res, jest.fn());
        expect(res.statusCode).toBe(403);
    });

    test('denies an unverified Firebase user record', async () => {
        const middleware = createRequireRecoveryOperator(dependencies(
            { role: 'super_admin' }, { emailVerified: false }
        ));
        const res = response();
        await middleware(request(), res, jest.fn());
        expect(res.statusCode).toBe(403);
    });

    test('denies an identity absent from the Firestore admins collection', async () => {
        const middleware = createRequireRecoveryOperator(dependencies(null));
        const res = response();
        await middleware(request(), res, jest.fn());
        expect(res.statusCode).toBe(403);
    });

    test.each(['admin', 'manager', 'billing'])('denies non-super-admin role %s', async (role) => {
        const middleware = createRequireRecoveryOperator(dependencies({ role }));
        const res = response();
        await middleware(request(), res, jest.fn());
        expect(res.statusCode).toBe(403);
    });

    test('denies a disabled super admin', async () => {
        const middleware = createRequireRecoveryOperator(dependencies({ role: 'super_admin', active: false }));
        const res = response();
        await middleware(request(), res, jest.fn());
        expect(res.statusCode).toBe(403);
    });

    test('permits a fresh verified Firestore super admin and binds a redacted actor', async () => {
        const deps = dependencies({ role: 'super_admin', active: true });
        const middleware = createRequireRecoveryOperator(deps);
        const req = request();
        const res = response();
        const next = jest.fn();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.recoveryActor).toEqual({
            uid: 'operator_uid',
            uid_digest: crypto.createHash('sha256').update('operator_uid').digest('hex'),
            email_digest: crypto.createHash('sha256').update('operator@example.com').digest('hex'),
            role: 'super_admin',
            permission: 'synchintro.synthetic_recovery'
        });
        expect(deps.db.collection).toHaveBeenCalledWith('admins');
    });

    test('fails closed when the admin directory is unavailable', async () => {
        const deps = dependencies();
        deps.db.collection = jest.fn(() => { throw new Error('offline'); });
        const middleware = createRequireRecoveryOperator(deps);
        const res = response();
        await middleware(request(), res, jest.fn());
        expect(res.statusCode).toBe(500);
    });
});
