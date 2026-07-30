'use strict';

/**
 * A4 / F-1005 — /visitor-signal/ingest hardening helpers.
 * - isSafeDocSegment: caller input can never form arbitrary Firestore document paths
 * - checkOriginAllowed: opt-in per-merchant Origin/Referer allowlist
 */

jest.mock('firebase-admin');
const { _f1005 } = require('../routes/visitorSignalRoutes');
const { isSafeDocSegment, checkOriginAllowed, requestOriginHost } = _f1005;

describe('F-1005 isSafeDocSegment', () => {
    test.each(['abc123', 'sess_9f8a-77', '937DF5', 'a'.repeat(200)])(
        'accepts valid id %s', (v) => expect(isSafeDocSegment(v)).toBe(true));

    test.each([
        ['contains slash (path injection)', 'merchant/../../secret'],
        ['single dot', '.'],
        ['double dot', '..'],
        ['reserved __*__', '__proto__'],
        ['empty', ''],
        ['too long', 'a'.repeat(201)],
        ['non-string', 12345],
        ['null', null],
    ])('rejects %s', (_label, v) => expect(isSafeDocSegment(v)).toBe(false));
});

describe('F-1005 checkOriginAllowed', () => {
    const reqWith = (origin, referer) => ({ headers: { origin, referer } });

    test('not enforced when merchant has no allowedOrigins', () => {
        const r = checkOriginAllowed(reqWith('https://evil.example'), {});
        expect(r).toEqual({ enforced: false, ok: true });
    });

    test('not enforced when allowedOrigins is empty', () => {
        const r = checkOriginAllowed(reqWith('https://evil.example'), { allowedOrigins: [] });
        expect(r).toEqual({ enforced: false, ok: true });
    });

    test('enforced + ok when Origin host matches (bare host config)', () => {
        const r = checkOriginAllowed(reqWith('https://shop.acme.com'), { allowedOrigins: ['shop.acme.com'] });
        expect(r).toEqual({ enforced: true, ok: true });
    });

    test('enforced + ok when config is a full origin URL', () => {
        const r = checkOriginAllowed(reqWith('https://shop.acme.com/page'), { allowedOrigins: ['https://shop.acme.com'] });
        expect(r).toEqual({ enforced: true, ok: true });
    });

    test('enforced + NOT ok when Origin host does not match', () => {
        const r = checkOriginAllowed(reqWith('https://evil.example'), { allowedOrigins: ['shop.acme.com'] });
        expect(r).toEqual({ enforced: true, ok: false });
    });

    test('falls back to Referer when Origin is absent', () => {
        const r = checkOriginAllowed(reqWith(undefined, 'https://shop.acme.com/x'), { allowedOrigins: ['shop.acme.com'] });
        expect(r.ok).toBe(true);
    });

    test('enforced + NOT ok when no Origin/Referer present at all', () => {
        const r = checkOriginAllowed({ headers: {} }, { allowedOrigins: ['shop.acme.com'] });
        expect(r).toEqual({ enforced: true, ok: false });
    });

    test('requestOriginHost parses host and lowercases', () => {
        expect(requestOriginHost(reqWith('https://Shop.ACME.com/x'))).toBe('shop.acme.com');
        expect(requestOriginHost({ headers: {} })).toBeNull();
    });
});
