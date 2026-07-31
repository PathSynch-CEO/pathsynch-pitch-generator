'use strict';

/**
 * SSRF guard for outbound requests to user-supplied URLs (F-1004/1006).
 *
 * Extends the URL-validation pattern from services/tools/techStackDetector.js with:
 *   - full IPv4 + IPv6 private/loopback/link-local/reserved range blocking
 *   - IPv4-mapped IPv6 (::ffff:x.x.x.x, dotted and hex forms)
 *   - cloud metadata IP 169.254.169.254 (covered by 169.254.0.0/16)
 *   - rejection of embedded credentials (user:pass@host) and non-HTTP(S) schemes
 *   - DNS resolution of the hostname with validation of EVERY resolved address
 *   - redirect handling: redirects are followed manually and every hop is re-validated
 *   - connection pinning: the socket connects to the exact validated address via a custom
 *     agent `lookup`, closing the standard TOCTOU DNS-rebinding window between the
 *     validation check and the actual connect.
 *
 * RESIDUAL GAP (documented, not closed here): we trust the host OS resolver, and pinning
 * relies on the custom agent `lookup` being honored by Node's http(s) stack. Only a HEAD is
 * issued (no response body is fetched). NAT64/Teredo/6to4 embedded-address exotica are not
 * exhaustively decoded.
 */

const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const axios = require('axios');

class SsrfError extends Error {
    constructor(reason, detail) {
        super(detail ? `${reason}: ${detail}` : reason);
        this.name = 'SsrfError';
        this.reason = reason;
    }
}

// ── IPv4 range checks ─────────────────────────────────────────────────────────

function ipv4ToLong(ip) {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + (parseInt(oct, 10) & 0xff)) >>> 0, 0) >>> 0;
}

function inCidr(ip, base, bits) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToLong(ip) & mask) === (ipv4ToLong(base) & mask);
}

// RFC1918 + loopback + link-local (incl. 169.254.169.254 metadata) + CGNAT + reserved/special.
const BLOCKED_V4 = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];

function isBlockedIPv4(ip) {
    return BLOCKED_V4.some(([base, bits]) => inCidr(ip, base, bits));
}

// ── IPv6 range checks ─────────────────────────────────────────────────────────

function isBlockedIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;      // loopback / unspecified
    if (/^fe[89ab]/.test(lower)) return true;                // fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true;                   // fc00::/7 unique-local
    if (/^ff/.test(lower)) return true;                      // ff00::/8 multicast
    if (/^2001:db8/.test(lower)) return true;                // documentation

    // IPv4-mapped ::ffff:a.b.c.d (dotted)
    const dotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dotted) return isBlockedIPv4(dotted[1]);

    // IPv4-mapped ::ffff:xxxx:xxxx (hex)
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isBlockedIPv4(v4);
    }
    return false;
}

function isBlockedAddress(ip) {
    const fam = net.isIP(ip);
    if (fam === 4) return isBlockedIPv4(ip);
    if (fam === 6) return isBlockedIPv6(ip);
    return true; // not a valid IP literal → block conservatively
}

// ── URL parsing / validation ──────────────────────────────────────────────────

/**
 * Parse and statically validate a URL (scheme, credentials, IP-literal host).
 * Does NOT perform DNS. Throws SsrfError on any violation. Returns a URL object.
 */
function parseSafeUrl(raw) {
    if (!raw || typeof raw !== 'string') throw new SsrfError('invalid_url');
    let s = raw.trim();

    // Reject any explicit non-http(s) scheme before we default-prepend https://
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) {
        throw new SsrfError('bad_scheme');
    }
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;

    let u;
    try { u = new URL(s); } catch { throw new SsrfError('invalid_url'); }

    if (!['http:', 'https:'].includes(u.protocol)) throw new SsrfError('bad_scheme');
    if (u.username || u.password) throw new SsrfError('credentials_in_url');

    const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (net.isIP(host) && isBlockedAddress(host)) throw new SsrfError('blocked_ip', host);

    return u;
}

/**
 * DNS-resolve a hostname and validate every returned address. Returns the resolved
 * records (already validated). IP-literal hosts are validated directly.
 */
async function resolveAndValidate(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '');

    if (net.isIP(host)) {
        if (isBlockedAddress(host)) throw new SsrfError('blocked_ip', host);
        return [{ address: host, family: net.isIP(host) }];
    }

    let records;
    try {
        records = await dns.lookup(host, { all: true });
    } catch (err) {
        throw new SsrfError('dns_failure', err.code || err.message);
    }
    if (!records || !records.length) throw new SsrfError('dns_empty');

    for (const r of records) {
        if (isBlockedAddress(r.address)) throw new SsrfError('blocked_ip', r.address);
    }
    return records;
}

// ── Pinned, redirect-revalidating HEAD ─────────────────────────────────────────

/**
 * Issue an SSRF-safe request to a user-supplied URL. Redirects are followed manually and
 * every hop is fully re-validated (scheme, credentials, DNS, address ranges). The socket is
 * pinned to the validated address via a custom agent `lookup`.
 * Throws SsrfError on any violation or transport failure.
 */
async function ssrfSafeRequest(rawUrl, { timeout = 5000, maxRedirects = 3, method = 'HEAD' } = {}) {
    let current = parseSafeUrl(rawUrl);

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const records = await resolveAndValidate(current.hostname);
        const pinned = records[0].address;
        const family = records[0].family || net.isIP(pinned);

        // Pin the connection to the validated IP; SNI/Host still use the original hostname,
        // so TLS certificate validation is unaffected.
        const lookup = (_host, _opts, cb) => {
            const callback = typeof _opts === 'function' ? _opts : cb;
            callback(null, pinned, family);
        };
        const isHttps = current.protocol === 'https:';
        const Agent = isHttps ? require('https').Agent : require('http').Agent;
        const agent = new Agent({ lookup });

        let resp;
        try {
            resp = await axios.request({
                url: current.href,
                method,
                timeout,
                maxRedirects: 0,             // follow manually so each hop is re-validated
                httpAgent: isHttps ? undefined : agent,
                httpsAgent: isHttps ? agent : undefined,
                validateStatus: () => true,  // inspect status ourselves
            });
        } catch (err) {
            throw new SsrfError('request_failed', err.message);
        }

        if (resp.status >= 300 && resp.status < 400 && resp.headers && resp.headers.location) {
            let next;
            try { next = new URL(resp.headers.location, current.href); } catch { throw new SsrfError('bad_redirect'); }
            if (!['http:', 'https:'].includes(next.protocol)) throw new SsrfError('bad_redirect_scheme');
            if (next.username || next.password) throw new SsrfError('credentials_in_url');
            current = next;
            continue;
        }
        return resp;
    }
    throw new SsrfError('too_many_redirects');
}

/**
 * Convenience: returns true iff the URL is SSRF-safe AND reachable with HTTP 200.
 * Never throws — any SSRF violation or transport error resolves to false.
 */
async function isSafeUrlReachable(rawUrl, opts = {}) {
    try {
        const resp = await ssrfSafeRequest(rawUrl, opts);
        return resp.status === 200;
    } catch {
        return false;
    }
}

module.exports = {
    SsrfError,
    parseSafeUrl,
    resolveAndValidate,
    isBlockedAddress,
    isBlockedIPv4,
    isBlockedIPv6,
    ssrfSafeRequest,
    isSafeUrlReachable,
};
