'use strict';

/**
 * A2 / F-1001 — /admin/bootstrap keyed-auth hardening.
 * - fails CLOSED when ADMIN_BOOTSTRAP_KEY is unset (no hardcoded default)
 * - key accepted only from the x-admin-bootstrap-key HEADER (never body)
 * - constant-time compare
 * - self-disabling: refuses once any admin exists (no force bypass)
 */

jest.mock('firebase-admin');
const admin = require('firebase-admin');
const adminApi = require('../api/admin');

function mockRes() {
    const res = {
        _status: 200,
        _body: null,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; return res; }),
    };
    return res;
}
const req = (headers = {}, body = {}) => ({ headers, body });

describe('A2/F-1001 bootstrapAdmin', () => {
    const KEY = 'unit-test-bootstrap-key-abc123';

    beforeEach(() => {
        admin._resetMockData();
        process.env.ADMIN_BOOTSTRAP_KEY = KEY;
    });
    afterEach(() => { delete process.env.ADMIN_BOOTSTRAP_KEY; });

    test('missing ADMIN_BOOTSTRAP_KEY env → 503 (fails closed, no default)', async () => {
        delete process.env.ADMIN_BOOTSTRAP_KEY;
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': 'anything' }, { email: 'a@b.com' }), res);
        expect(res._status).toBe(503);
    });

    test('wrong header key → 403', async () => {
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': 'wrong-key' }, { email: 'a@b.com' }), res);
        expect(res._status).toBe(403);
    });

    test('key supplied in BODY instead of header → 403', async () => {
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({}, { email: 'a@b.com', secretKey: KEY }), res);
        expect(res._status).toBe(403);
    });

    test('valid header key, no admins yet → 200 creates super_admin', async () => {
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': KEY }, { email: 'First@Admin.com' }), res);
        expect(res._status).toBe(200);
        expect(res._body.success).toBe(true);
        const created = admin._mockData.collections.admins['first@admin.com'];
        expect(created).toBeDefined();
        expect(created.role).toBe('super_admin');
    });

    test('valid header key but an admin already exists → 403 (self-disabling)', async () => {
        admin._setMockCollection('admins', {
            'existing@admin.com': { email: 'existing@admin.com', role: 'super_admin' },
        });
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': KEY }, { email: 'second@admin.com' }), res);
        expect(res._status).toBe(403);
        expect(admin._mockData.collections.admins['second@admin.com']).toBeUndefined();
    });

    test('force:true no longer bypasses the already-exists guard', async () => {
        admin._setMockCollection('admins', { 'existing@admin.com': { role: 'super_admin' } });
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': KEY }, { email: 'x@y.com', force: true }), res);
        expect(res._status).toBe(403);
    });

    test('valid key but missing email → 400', async () => {
        const res = mockRes();
        await adminApi.bootstrapAdmin(req({ 'x-admin-bootstrap-key': KEY }, {}), res);
        expect(res._status).toBe(400);
    });
});
