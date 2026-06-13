'use strict';

// Lightweight firebase-admin mock
const mockGet = jest.fn().mockResolvedValue({ exists: false });
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin', () => ({
    firestore: () => ({ collection: mockCollection }),
    initializeApp: jest.fn(),
}));
const admin = require('firebase-admin');
admin.firestore.FieldValue = { serverTimestamp: () => new Date() };

const {
    buildReviewHealthCacheKey,
    getReviewHealth,
    setReviewHealth,
    CACHE_CONFIG,
} = require('../services/enrichmentCache');

// ── Cache Key Strategy ───────────────────────────────────────────────────────

describe('enrichmentCache — buildReviewHealthCacheKey', () => {
    test('placeId takes priority', () => {
        const key = buildReviewHealthCacheKey({
            placeId: 'ChIJ12345',
            businessName: 'Acme Corp',
            city: 'Atlanta',
            state: 'GA',
        });
        expect(key).toBe('ChIJ12345');
    });

    test('falls back to sha1 when no placeId', () => {
        const key = buildReviewHealthCacheKey({
            businessName: 'Acme Corp',
            city: 'Atlanta',
            state: 'GA',
        });
        // sha1('acme corp|atlanta|ga')
        expect(key).toMatch(/^[a-f0-9]{40}$/);
    });

    test('sha1 is case-insensitive', () => {
        const k1 = buildReviewHealthCacheKey({ businessName: 'Acme Corp', city: 'Atlanta', state: 'GA' });
        const k2 = buildReviewHealthCacheKey({ businessName: 'acme corp', city: 'atlanta', state: 'ga' });
        expect(k1).toBe(k2);
    });

    test('different business names produce different keys', () => {
        const k1 = buildReviewHealthCacheKey({ businessName: 'Acme Corp', city: 'Atlanta', state: 'GA' });
        const k2 = buildReviewHealthCacheKey({ businessName: 'Beta LLC', city: 'Atlanta', state: 'GA' });
        expect(k1).not.toBe(k2);
    });

    test('returns null for null params', () => {
        expect(buildReviewHealthCacheKey(null)).toBeNull();
    });

    test('returns null for empty business name without placeId', () => {
        expect(buildReviewHealthCacheKey({ businessName: '', city: 'Atlanta' })).toBeNull();
    });

    test('whitespace placeId is ignored, falls to sha1', () => {
        const key = buildReviewHealthCacheKey({
            placeId: '   ',
            businessName: 'Test',
            city: 'NYC',
            state: 'NY',
        });
        expect(key).toMatch(/^[a-f0-9]{40}$/);
    });
});

// ── TTL Config ───────────────────────────────────────────────────────────────

describe('enrichmentCache — reviewHealth TTL', () => {
    test('success TTL is 14 days', () => {
        expect(CACHE_CONFIG.reviewHealth.successTTLDays).toBe(14);
    });

    test('failure TTL is 3 days', () => {
        expect(CACHE_CONFIG.reviewHealth.failureTTLDays).toBe(3);
    });
});

// ── Read/Write ───────────────────────────────────────────────────────────────

describe('enrichmentCache — reviewHealth read/write', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns null for null key params', async () => {
        const result = await getReviewHealth(null);
        expect(result).toBeNull();
    });

    test('returns null when doc does not exist', async () => {
        mockGet.mockResolvedValueOnce({ exists: false });
        const result = await getReviewHealth({ businessName: 'test', city: 'x', state: 'y' });
        expect(result).toBeNull();
    });

    test('returns null when doc is expired', async () => {
        const pastDate = new Date(Date.now() - 86400000); // 1 day ago
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                result: { status: 'complete' },
                expiresAt: { toDate: () => pastDate },
            }),
        });
        const result = await getReviewHealth({ businessName: 'test', city: 'x', state: 'y' });
        expect(result).toBeNull();
    });

    test('returns cached data when doc is fresh', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 10); // 10 days from now
        const cachedData = { status: 'complete', responseRate: 0.75 };
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                result: cachedData,
                expiresAt: { toDate: () => futureDate },
            }),
        });
        const result = await getReviewHealth({ businessName: 'test', city: 'x', state: 'y' });
        expect(result).toEqual(cachedData);
    });

    test('setReviewHealth does not throw on null key', async () => {
        await expect(setReviewHealth(null, { status: 'complete' }, true))
            .resolves.not.toThrow();
    });
});
