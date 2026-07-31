'use strict';

/**
 * A4 / F-1006 — SSRF guard unit tests.
 * Pure/synchronous coverage: scheme + credential rejection, and the IPv4/IPv6/mapped/reserved
 * blocking used to keep the unauthenticated /logo/validate endpoint from becoming an SSRF oracle.
 */

const {
    SsrfError,
    parseSafeUrl,
    isBlockedAddress,
    isBlockedIPv4,
    isBlockedIPv6,
    isSafeUrlReachable,
} = require('../utils/ssrfGuard');

describe('ssrfGuard — IPv4 blocking', () => {
    test.each([
        '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1',
        '127.0.0.1', '0.0.0.0', '169.254.169.254', '100.64.0.1',
        '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    ])('blocks private/reserved IPv4 %s', (ip) => {
        expect(isBlockedIPv4(ip)).toBe(true);
        expect(isBlockedAddress(ip)).toBe(true);
    });

    test.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1'])(
        'allows public IPv4 %s', (ip) => {
            expect(isBlockedIPv4(ip)).toBe(false);
            expect(isBlockedAddress(ip)).toBe(false);
        });

    test('metadata IP 169.254.169.254 is blocked', () => {
        expect(isBlockedAddress('169.254.169.254')).toBe(true);
    });
});

describe('ssrfGuard — IPv6 blocking', () => {
    test.each([
        '::1',                       // loopback
        '::',                        // unspecified
        'fe80::1',                   // link-local
        'fc00::1', 'fd12:3456::1',   // unique-local
        'ff02::1',                   // multicast
        '::ffff:127.0.0.1',          // IPv4-mapped loopback (dotted)
        '::ffff:169.254.169.254',    // IPv4-mapped metadata
        '2001:db8::1',               // documentation
    ])('blocks %s', (ip) => {
        expect(isBlockedIPv6(ip)).toBe(true);
        expect(isBlockedAddress(ip)).toBe(true);
    });

    test('IPv4-mapped hex form of loopback is blocked', () => {
        // ::ffff:7f00:1  == ::ffff:127.0.0.1
        expect(isBlockedIPv6('::ffff:7f00:1')).toBe(true);
    });

    test('allows a public IPv6 address', () => {
        expect(isBlockedIPv6('2606:4700:4700::1111')).toBe(false);
        expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    });
});

describe('ssrfGuard — parseSafeUrl', () => {
    test('rejects non-http(s) schemes', () => {
        for (const u of ['file:///etc/passwd', 'gopher://x', 'ftp://h/x', 'data:text/plain,hi']) {
            expect(() => parseSafeUrl(u)).toThrow(SsrfError);
        }
    });

    test('rejects embedded credentials', () => {
        expect(() => parseSafeUrl('https://user:pass@example.com/logo.png')).toThrow(/credentials/);
    });

    test('rejects private/loopback/metadata IP literals', () => {
        for (const u of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data',
                         'http://10.0.0.5/x', 'https://[::1]/x']) {
            expect(() => parseSafeUrl(u)).toThrow(/blocked_ip/);
        }
    });

    test('accepts a normal public https URL', () => {
        const u = parseSafeUrl('https://cdn.example.com/logo.png');
        expect(u.protocol).toBe('https:');
        expect(u.hostname).toBe('cdn.example.com');
    });

    test('defaults a bare host to https', () => {
        expect(parseSafeUrl('example.com/logo.png').protocol).toBe('https:');
    });
});

describe('ssrfGuard — isSafeUrlReachable never throws and rejects unsafe URLs', () => {
    test('blocked IP literal resolves to false without any network call', async () => {
        await expect(isSafeUrlReachable('http://169.254.169.254/latest')).resolves.toBe(false);
        await expect(isSafeUrlReachable('http://127.0.0.1/logo.png')).resolves.toBe(false);
    });

    test('bad scheme resolves to false', async () => {
        await expect(isSafeUrlReachable('file:///etc/passwd')).resolves.toBe(false);
    });

    test('credentials-in-url resolves to false', async () => {
        await expect(isSafeUrlReachable('https://u:p@example.com/x')).resolves.toBe(false);
    });
});
