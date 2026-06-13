'use strict';

jest.mock('firebase-admin', () => require('../__mocks__/firebase-admin'));
jest.mock('axios');
jest.mock('../services/enrichmentCache', () => ({
    getTechDetection: jest.fn().mockResolvedValue(null),
    setTechDetection: jest.fn().mockResolvedValue(undefined),
    normalizeHostname: jest.fn(h => {
        if (!h) return null;
        return h.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    }),
}));

const axios = require('axios');
const { detectTechStack, _validateUrl, _matchFingerprints, _classifyTools, FINGERPRINTS } = require('../services/tools/techStackDetector');
const enrichmentCache = require('../services/enrichmentCache');

// ── SSRF Guard ───────────────────────────────────────────────────────────────

describe('techStackDetector — SSRF guard (_validateUrl)', () => {
    test('accepts valid http/https URLs', () => {
        expect(_validateUrl('https://example.com')).toBe('https://example.com/');
        expect(_validateUrl('http://example.com')).toBe('http://example.com/');
    });

    test('prepends https:// to bare hostnames', () => {
        expect(_validateUrl('example.com')).toBe('https://example.com/');
    });

    test('rejects private IP 10.x', () => {
        expect(_validateUrl('http://10.0.0.1')).toBeNull();
    });

    test('rejects private IP 172.16-31.x', () => {
        expect(_validateUrl('http://172.16.0.1')).toBeNull();
        expect(_validateUrl('http://172.31.255.255')).toBeNull();
    });

    test('rejects private IP 192.168.x', () => {
        expect(_validateUrl('http://192.168.1.1')).toBeNull();
    });

    test('rejects localhost 127.x', () => {
        expect(_validateUrl('http://127.0.0.1')).toBeNull();
    });

    test('rejects metadata host 169.254.169.254', () => {
        expect(_validateUrl('http://169.254.169.254')).toBeNull();
    });

    test('rejects metadata.google.internal', () => {
        expect(_validateUrl('http://metadata.google.internal')).toBeNull();
    });

    test('rejects non-http schemes', () => {
        expect(_validateUrl('ftp://example.com')).toBeNull();
        expect(_validateUrl('file:///etc/passwd')).toBeNull();
    });

    test('rejects null/empty/undefined', () => {
        expect(_validateUrl(null)).toBeNull();
        expect(_validateUrl('')).toBeNull();
        expect(_validateUrl(undefined)).toBeNull();
    });

    test('rejects malformed URLs', () => {
        expect(_validateUrl('not a url at all!!!')).toBeNull();
    });
});

// ── Fingerprint Matching ─────────────────────────────────────────────────────

describe('techStackDetector — fingerprint matching', () => {
    test('has 47 fingerprints', () => {
        expect(FINGERPRINTS.length).toBe(47);
    });

    test('detects Birdeye', () => {
        const html = '<script src="https://birdeye.com/widget.js"></script>';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'Birdeye')).toBe(true);
    });

    test('detects Facebook Pixel', () => {
        const html = '<script>!function(f,b,e,v,n,t,s){fbq("init")};</script>';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'Facebook Pixel')).toBe(true);
    });

    test('detects CallRail', () => {
        const html = '<script src="https://cdn.callrail.com/tracker.js"></script>';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'CallRail')).toBe(true);
    });

    test('detects WordPress', () => {
        const html = '<link rel="stylesheet" href="/wp-content/themes/mytheme/style.css">';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'WordPress')).toBe(true);
    });

    test('detects JotForm', () => {
        const html = '<script src="https://cdn.jotform.com/js/form.js"></script>';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'JotForm')).toBe(true);
    });

    test('detects Gravity Forms', () => {
        const html = '<div class="gform_wrapper"><form></form></div>';
        const tools = _matchFingerprints(html);
        expect(tools.some(t => t.name === 'Gravity Forms')).toBe(true);
    });

    test('returns empty for clean HTML', () => {
        const html = '<html><body><h1>Hello World</h1></body></html>';
        const tools = _matchFingerprints(html);
        expect(tools).toHaveLength(0);
    });

    test('detects multiple tools in one page', () => {
        const html = `
            <script src="https://birdeye.com/widget.js"></script>
            <script src="https://cdn.callrail.com/tracker.js"></script>
            <link rel="stylesheet" href="/wp-content/themes/theme/style.css">
        `;
        const tools = _matchFingerprints(html);
        expect(tools.length).toBeGreaterThanOrEqual(3);
    });
});

// ── Classification ───────────────────────────────────────────────────────────

describe('techStackDetector — classification', () => {
    test('classifies reputation tools correctly', () => {
        const tools = [
            { name: 'Birdeye', category: 'reputation', type: 'reputation', confidence: 'high' },
            { name: 'Yext', category: 'reputation', type: 'listing_management', confidence: 'high' },
        ];
        const { reputationTools, formBuilders, analytics } = _classifyTools(tools);
        expect(reputationTools).toHaveLength(2);
        expect(reputationTools[0].type).toBe('reputation');
        expect(reputationTools[1].type).toBe('listing_management');
        expect(formBuilders).toHaveLength(0);
        expect(analytics).toHaveLength(0);
    });

    test('classifies form builders with displacement type', () => {
        const tools = [
            { name: 'JotForm', category: 'forms', type: 'cost', confidence: 'high' },
            { name: 'Google Forms', category: 'forms', type: 'basic', confidence: 'high' },
        ];
        const { formBuilders } = _classifyTools(tools);
        expect(formBuilders).toHaveLength(2);
        expect(formBuilders[0].type).toBe('cost');
        expect(formBuilders[1].type).toBe('basic');
    });

    test('classifies analytics', () => {
        const tools = [
            { name: 'Facebook Pixel', category: 'analytics', confidence: 'high' },
        ];
        const { analytics } = _classifyTools(tools);
        expect(analytics).toHaveLength(1);
        expect(analytics[0].name).toBe('Facebook Pixel');
    });
});

// ── Feature Flag ─────────────────────────────────────────────────────────────

describe('techStackDetector — feature flag', () => {
    const originalEnv = process.env.ENABLE_TECH_STACK_DETECTION;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.ENABLE_TECH_STACK_DETECTION = originalEnv;
        } else {
            delete process.env.ENABLE_TECH_STACK_DETECTION;
        }
    });

    test('returns null when flag is not set', async () => {
        delete process.env.ENABLE_TECH_STACK_DETECTION;
        const result = await detectTechStack('https://example.com');
        expect(result).toBeNull();
    });

    test('returns null when flag is false', async () => {
        process.env.ENABLE_TECH_STACK_DETECTION = 'false';
        const result = await detectTechStack('https://example.com');
        expect(result).toBeNull();
    });
});

// ── Cache-first Behavior ─────────────────────────────────────────────────────

describe('techStackDetector — cache-first', () => {
    const originalEnv = process.env.ENABLE_TECH_STACK_DETECTION;

    beforeEach(() => {
        process.env.ENABLE_TECH_STACK_DETECTION = 'true';
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.ENABLE_TECH_STACK_DETECTION = originalEnv;
        } else {
            delete process.env.ENABLE_TECH_STACK_DETECTION;
        }
    });

    test('returns cached result without making HTTP request', async () => {
        const cachedData = {
            tools: [{ name: 'WordPress', category: 'cms', confidence: 'high' }],
            reputationTools: [],
            formBuilders: [],
            analytics: [],
            fetchStatus: 'ok',
        };
        enrichmentCache.getTechDetection.mockResolvedValueOnce(cachedData);

        const result = await detectTechStack('https://example.com');

        expect(result.fetchStatus).toBe('cache_hit');
        expect(result.tools).toHaveLength(1);
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('returns invalid_url for private IPs', async () => {
        const result = await detectTechStack('http://10.0.0.1');
        expect(result.fetchStatus).toBe('invalid_url');
        expect(result.tools).toHaveLength(0);
    });

    test('fetches and caches on cache miss', async () => {
        enrichmentCache.getTechDetection.mockResolvedValueOnce(null);
        axios.get.mockResolvedValueOnce({
            data: '<html><script src="https://birdeye.com/widget.js"></script></html>',
        });

        const result = await detectTechStack('https://example.com');

        expect(result.fetchStatus).toBe('ok');
        expect(result.reputationTools.length).toBeGreaterThanOrEqual(1);
        expect(enrichmentCache.setTechDetection).toHaveBeenCalledWith(
            'example.com',
            expect.objectContaining({ fetchStatus: 'ok' }),
            true
        );
    });

    test('caches failure on fetch error', async () => {
        enrichmentCache.getTechDetection.mockResolvedValueOnce(null);
        axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const result = await detectTechStack('https://example.com');

        expect(result.fetchStatus).toBe('fetch_error');
        expect(enrichmentCache.setTechDetection).toHaveBeenCalledWith(
            'example.com',
            expect.objectContaining({ fetchStatus: 'fetch_error' }),
            false
        );
    });
});
