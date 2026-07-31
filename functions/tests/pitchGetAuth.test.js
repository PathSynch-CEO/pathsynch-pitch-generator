'use strict';

/**
 * A4 / F-1004 — GET /pitch/:pitchId must not return the full pitch document to
 * unauthenticated / non-owner callers. A valid share token returns the sanitized
 * projection only (never userId/formData/pitchMetadata).
 */

jest.mock('firebase-admin');
jest.mock('../api/pitchGenerator', () => ({
    getPitch: jest.fn(async (req, res) => res.status(200).json({ success: true, data: { __full: true } })),
    getSharedPitch: jest.fn(),
    generatePitch: jest.fn(),
}));

const admin = require('firebase-admin');
const pitchGenerator = require('../api/pitchGenerator');
const pitchRoutes = require('../routes/pitchRoutes');
const { hashToken } = require('../utils/pitchShare');

function mockRes() {
    const res = {
        _status: 200, _body: null, headersSent: false,
        status: jest.fn(function (c) { res._status = c; return res; }),
        json: jest.fn(function (b) { res._body = b; res.headersSent = true; return res; }),
        set: jest.fn(function () { return res; }),
    };
    return res;
}
const getReq = ({ userId = null, pitchId = 'pitch123', query = {}, workspaceId } = {}) =>
    ({ method: 'GET', path: `/pitch/${pitchId}`, userId, workspaceId, query, params: {}, headers: {}, ip: '1.2.3.4' });

const TOKEN = 't'.repeat(40);

beforeEach(() => {
    admin._resetMockData();
    pitchGenerator.getPitch.mockClear();
    admin._setMockCollection('pitches', {
        pitch123: {
            userId: 'owner1',
            businessName: 'Acme Co',
            html: '<p>pitch</p>',
            formData: { secret: 'do-not-leak' },
            pitchMetadata: { enrichment: 'x' },
            sharing: { shareTokenHash: hashToken(TOKEN) },
        },
    });
});

describe('A4/F-1004 GET /pitch/:pitchId', () => {
    test('unauthenticated (userId null), no token → 401 and getPitch NOT called', async () => {
        const res = mockRes();
        const handled = await pitchRoutes.handle(getReq({ userId: null }), res);
        expect(handled).toBe(true);
        expect(res._status).toBe(401);
        expect(pitchGenerator.getPitch).not.toHaveBeenCalled();
    });

    test('authenticated owner → full document via getPitch', async () => {
        const res = mockRes();
        await pitchRoutes.handle(getReq({ userId: 'owner1' }), res);
        expect(pitchGenerator.getPitch).toHaveBeenCalledTimes(1);
        expect(res._body.data.__full).toBe(true);
    });

    test('authenticated non-owner without token → 401', async () => {
        const res = mockRes();
        await pitchRoutes.handle(getReq({ userId: 'someone-else' }), res);
        expect(res._status).toBe(401);
        expect(pitchGenerator.getPitch).not.toHaveBeenCalled();
    });

    test('valid share token → sanitized projection, getPitch NOT called', async () => {
        const res = mockRes();
        await pitchRoutes.handle(getReq({ userId: null, query: { shareToken: TOKEN } }), res);
        expect(res._status).toBe(200);
        expect(pitchGenerator.getPitch).not.toHaveBeenCalled();
        expect(res._body.data.businessName).toBe('Acme Co');
        // Internal fields must never leak through the token path.
        expect(res._body.data.userId).toBeUndefined();
        expect(res._body.data.formData).toBeUndefined();
        expect(res._body.data.pitchMetadata).toBeUndefined();
    });

    test('invalid share token → 401', async () => {
        const res = mockRes();
        await pitchRoutes.handle(getReq({ userId: null, query: { shareToken: 'x'.repeat(40) } }), res);
        expect(res._status).toBe(401);
    });

    test('revoked token → 401 even when the hash matches', async () => {
        admin._mockData.collections.pitches.pitch123.sharing.revokedAt = new Date();
        const res = mockRes();
        await pitchRoutes.handle(getReq({ userId: null, query: { shareToken: TOKEN } }), res);
        expect(res._status).toBe(401);
    });
});
