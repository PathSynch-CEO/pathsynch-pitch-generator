'use strict';

/**
 * spyFuClient.test.js
 *
 * Uses jest.resetModules() in beforeEach so SPYFU_API_KEY env var changes
 * and fetch mock implementations take effect cleanly on each test.
 */

let getDomainStats;
let getTopOrganicKeywords;
let getTopPaidKeywords;

// ── Module reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
    process.env.SPYFU_API_KEY = 'test-api-key-12345';
    ({ getDomainStats, getTopOrganicKeywords, getTopPaidKeywords } = require('../services/spyFuClient'));
});

afterEach(() => {
    delete process.env.SPYFU_API_KEY;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetchOk(body) {
    global.fetch.mockResolvedValue({
        ok:   true,
        json: () => Promise.resolve(body)
    });
}

function mockFetchError(status) {
    global.fetch.mockResolvedValue({
        ok:     false,
        status: status || 500
    });
}

function mockFetchThrow(message) {
    global.fetch.mockRejectedValue(new Error(message || 'Network error'));
}

// ── Auth header ───────────────────────────────────────────────────────────────

describe('Auth header', () => {
    test('sends Basic Auth header with apiKey:SYDM0E4D base64 encoded', async () => {
        mockFetchOk({ strength: 42 });
        await getDomainStats('example.com');

        const [, options] = global.fetch.mock.calls[0];
        const auth = options.headers['Authorization'];
        expect(auth).toMatch(/^Basic /);

        const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8');
        expect(decoded).toBe('test-api-key-12345:SYDM0E4D');
    });

    test('returns null and skips fetch when SPYFU_API_KEY is not set', async () => {
        jest.resetModules();
        delete process.env.SPYFU_API_KEY;
        ({ getDomainStats } = require('../services/spyFuClient'));

        const result = await getDomainStats('example.com');
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('returns null and skips fetch when SPYFU_API_KEY is empty string', async () => {
        jest.resetModules();
        process.env.SPYFU_API_KEY = '';
        ({ getDomainStats } = require('../services/spyFuClient'));

        const result = await getDomainStats('example.com');
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── getDomainStats ────────────────────────────────────────────────────────────

describe('getDomainStats', () => {
    test('returns null for null domain', async () => {
        const result = await getDomainStats(null);
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('calls correct SpyFu endpoint with encoded domain', async () => {
        mockFetchOk({ strength: 42 });
        await getDomainStats('example.com');

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('/domain_stats_api/v2/getLatestDomainStats');
        expect(url).toContain('domain=example.com');
    });

    test('uses GET method', async () => {
        mockFetchOk({ strength: 42 });
        await getDomainStats('example.com');

        const [, options] = global.fetch.mock.calls[0];
        expect(options.method).toBe('GET');
    });

    test('maps all expected fields from response', async () => {
        mockFetchOk({
            strength:             65,
            averageOrganicRank:   8,
            totalOrganicResults:  2400,
            monthlyOrganicClicks: 18000,
            monthlyOrganicValue:  22500,
            monthlyPaidClicks:    3000,
            monthlyBudget:        4800,
            totalAdsPurchased:    120
        });

        const result = await getDomainStats('example.com');

        expect(result).toEqual({
            strength:             65,
            averageOrganicRank:   8,
            totalOrganicResults:  2400,
            monthlyOrganicClicks: 18000,
            monthlyOrganicValue:  22500,
            monthlyPaidClicks:    3000,
            monthlyBudget:        4800,
            totalAdsPurchased:    120
        });
    });

    test('returns null for missing fields as null (not undefined)', async () => {
        mockFetchOk({});

        const result = await getDomainStats('example.com');

        expect(result.strength).toBeNull();
        expect(result.averageOrganicRank).toBeNull();
        expect(result.totalOrganicResults).toBeNull();
        expect(result.monthlyOrganicClicks).toBeNull();
        expect(result.monthlyOrganicValue).toBeNull();
        expect(result.monthlyPaidClicks).toBeNull();
        expect(result.monthlyBudget).toBeNull();
        expect(result.totalAdsPurchased).toBeNull();
    });

    test('returns null on HTTP error', async () => {
        mockFetchError(403);
        const result = await getDomainStats('example.com');
        expect(result).toBeNull();
    });

    test('returns null on fetch throw', async () => {
        mockFetchThrow('Connection refused');
        const result = await getDomainStats('example.com');
        expect(result).toBeNull();
    });

    test('URL-encodes domain with special characters', async () => {
        mockFetchOk({ strength: 30 });
        await getDomainStats('my-biz.co.uk');

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('domain=my-biz.co.uk');
    });
});

// ── getTopOrganicKeywords ─────────────────────────────────────────────────────

describe('getTopOrganicKeywords', () => {
    test('returns null for null domain', async () => {
        const result = await getTopOrganicKeywords(null);
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('calls correct SpyFu endpoint', async () => {
        mockFetchOk({ results: [] });
        await getTopOrganicKeywords('example.com', 10);

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('/seo_research_api/v2/getTopOrganicKeywords');
        expect(url).toContain('domain=example.com');
        expect(url).toContain('maxResults=10');
    });

    test('defaults to maxResults=10 when limit not provided', async () => {
        mockFetchOk({ results: [] });
        await getTopOrganicKeywords('example.com');

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('maxResults=10');
    });

    test('uses provided limit', async () => {
        mockFetchOk({ results: [] });
        await getTopOrganicKeywords('example.com', 25);

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('maxResults=25');
    });

    test('parses results from .results array shape', async () => {
        mockFetchOk({
            results: [
                { keyword: 'dentist near me', rankNumber: 3, searchVolume: 5400, costPerClick: 8.50, rankChange: 2 },
                { keyword: 'dental implants',  rankNumber: 7, searchVolume: 2900, costPerClick: 12.00, rankChange: -1 }
            ]
        });

        const result = await getTopOrganicKeywords('example.com');

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            keyword:      'dentist near me',
            rankNumber:   3,
            searchVolume: 5400,
            costPerClick: 8.50,
            rankChange:   2
        });
    });

    test('parses results from direct array shape', async () => {
        mockFetchOk([
            { keyword: 'hvac repair', rankNumber: 5, searchVolume: 3200, costPerClick: 15.00, rankChange: 0 }
        ]);

        const result = await getTopOrganicKeywords('example.com');

        expect(result).toHaveLength(1);
        expect(result[0].keyword).toBe('hvac repair');
    });

    test('returns null when response is neither array nor has .results', async () => {
        mockFetchOk({ unexpectedShape: true });
        const result = await getTopOrganicKeywords('example.com');
        expect(result).toBeNull();
    });

    test('returns null fields as null for missing keyword properties', async () => {
        mockFetchOk({ results: [{}] });
        const result = await getTopOrganicKeywords('example.com');

        expect(result[0].keyword).toBeNull();
        expect(result[0].rankNumber).toBeNull();
        expect(result[0].searchVolume).toBeNull();
        expect(result[0].costPerClick).toBeNull();
        expect(result[0].rankChange).toBeNull();
    });

    test('returns empty array for empty results', async () => {
        mockFetchOk({ results: [] });
        const result = await getTopOrganicKeywords('example.com');
        expect(result).toEqual([]);
    });

    test('returns null on HTTP error', async () => {
        mockFetchError(401);
        const result = await getTopOrganicKeywords('example.com');
        expect(result).toBeNull();
    });

    test('returns null on fetch throw', async () => {
        mockFetchThrow('Timeout');
        const result = await getTopOrganicKeywords('example.com');
        expect(result).toBeNull();
    });

    test('returns null when fetch returns null body', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
        const result = await getTopOrganicKeywords('example.com');
        expect(result).toBeNull();
    });
});

// ── getTopPaidKeywords ────────────────────────────────────────────────────────

describe('getTopPaidKeywords', () => {
    test('returns null for null domain', async () => {
        const result = await getTopPaidKeywords(null);
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('calls correct SpyFu endpoint', async () => {
        mockFetchOk({ results: [] });
        await getTopPaidKeywords('example.com', 5);

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('/ppc_research_api/v2/getTopPaidKeywords');
        expect(url).toContain('domain=example.com');
        expect(url).toContain('maxResults=5');
    });

    test('defaults to maxResults=5 when limit not provided', async () => {
        mockFetchOk({ results: [] });
        await getTopPaidKeywords('example.com');

        const [url] = global.fetch.mock.calls[0];
        expect(url).toContain('maxResults=5');
    });

    test('parses results from .results array shape', async () => {
        mockFetchOk({
            results: [
                { keyword: 'emergency dentist', adPosition: 1, searchVolume: 8100, costPerClick: 22.50, monthlyClicks: 650 },
                { keyword: 'dental crown cost',  adPosition: 2, searchVolume: 4400, costPerClick: 18.00, monthlyClicks: 290 }
            ]
        });

        const result = await getTopPaidKeywords('example.com');

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            keyword:       'emergency dentist',
            adPosition:    1,
            searchVolume:  8100,
            costPerClick:  22.50,
            monthlyClicks: 650
        });
    });

    test('parses results from direct array shape', async () => {
        mockFetchOk([
            { keyword: 'ac repair', adPosition: 3, searchVolume: 2400, costPerClick: 19.00, monthlyClicks: 180 }
        ]);

        const result = await getTopPaidKeywords('example.com');

        expect(result).toHaveLength(1);
        expect(result[0].keyword).toBe('ac repair');
    });

    test('returns null fields as null for missing keyword properties', async () => {
        mockFetchOk({ results: [{}] });
        const result = await getTopPaidKeywords('example.com');

        expect(result[0].keyword).toBeNull();
        expect(result[0].adPosition).toBeNull();
        expect(result[0].searchVolume).toBeNull();
        expect(result[0].costPerClick).toBeNull();
        expect(result[0].monthlyClicks).toBeNull();
    });

    test('returns null when response is neither array nor has .results', async () => {
        mockFetchOk({ noPpcData: true });
        const result = await getTopPaidKeywords('example.com');
        expect(result).toBeNull();
    });

    test('returns empty array for empty results', async () => {
        mockFetchOk({ results: [] });
        const result = await getTopPaidKeywords('example.com');
        expect(result).toEqual([]);
    });

    test('returns null on HTTP error', async () => {
        mockFetchError(429);
        const result = await getTopPaidKeywords('example.com');
        expect(result).toBeNull();
    });

    test('returns null on fetch throw', async () => {
        mockFetchThrow('DNS failure');
        const result = await getTopPaidKeywords('example.com');
        expect(result).toBeNull();
    });
});

// ── Cross-function: missing API key propagates to all three ───────────────────

describe('missing API key — all three functions', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.SPYFU_API_KEY;
        ({ getDomainStats, getTopOrganicKeywords, getTopPaidKeywords } = require('../services/spyFuClient'));
    });

    test('getDomainStats returns null without calling fetch', async () => {
        expect(await getDomainStats('example.com')).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('getTopOrganicKeywords returns null without calling fetch', async () => {
        expect(await getTopOrganicKeywords('example.com')).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('getTopPaidKeywords returns null without calling fetch', async () => {
        expect(await getTopPaidKeywords('example.com')).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── Module exports ────────────────────────────────────────────────────────────

describe('module exports', () => {
    test('exports getDomainStats, getTopOrganicKeywords, getTopPaidKeywords', () => {
        const mod = require('../services/spyFuClient');
        expect(typeof mod.getDomainStats).toBe('function');
        expect(typeof mod.getTopOrganicKeywords).toBe('function');
        expect(typeof mod.getTopPaidKeywords).toBe('function');
    });

    test('does not export internal helpers', () => {
        const mod = require('../services/spyFuClient');
        expect(mod.getAuthHeader).toBeUndefined();
        expect(mod.spyFuRequest).toBeUndefined();
    });
});
