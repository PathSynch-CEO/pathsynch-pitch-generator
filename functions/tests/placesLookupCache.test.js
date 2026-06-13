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
    buildPlacesLookupCacheKey,
    getPlacesLookup,
    setPlacesLookup,
    CACHE_CONFIG,
} = require('../services/enrichmentCache');

// ── Cache Key Strategy ───────────────────────────────────────────────────────

describe('enrichmentCache — buildPlacesLookupCacheKey', () => {
    test('returns sha1 hash for valid inputs', () => {
        const key = buildPlacesLookupCacheKey('Acme Corp', 'Atlanta', 'GA');
        expect(key).toMatch(/^[a-f0-9]{40}$/);
    });

    test('is case-insensitive', () => {
        const k1 = buildPlacesLookupCacheKey('Acme Corp', 'Atlanta', 'GA');
        const k2 = buildPlacesLookupCacheKey('acme corp', 'atlanta', 'ga');
        expect(k1).toBe(k2);
    });

    test('different names produce different keys', () => {
        const k1 = buildPlacesLookupCacheKey('Acme Corp', 'Atlanta', 'GA');
        const k2 = buildPlacesLookupCacheKey('Beta LLC', 'Atlanta', 'GA');
        expect(k1).not.toBe(k2);
    });

    test('different cities produce different keys', () => {
        const k1 = buildPlacesLookupCacheKey('Acme', 'Atlanta', 'GA');
        const k2 = buildPlacesLookupCacheKey('Acme', 'Savannah', 'GA');
        expect(k1).not.toBe(k2);
    });

    test('returns null for empty business name', () => {
        expect(buildPlacesLookupCacheKey('', 'Atlanta', 'GA')).toBeNull();
    });

    test('returns null for null business name', () => {
        expect(buildPlacesLookupCacheKey(null, 'Atlanta', 'GA')).toBeNull();
    });

    test('handles missing city/state gracefully', () => {
        const key = buildPlacesLookupCacheKey('Acme Corp', '', '');
        expect(key).toMatch(/^[a-f0-9]{40}$/);
    });
});

// ── TTL Config ───────────────────────────────────────────────────────────────

describe('enrichmentCache — placesLookup TTL', () => {
    test('success TTL is 30 days', () => {
        expect(CACHE_CONFIG.placesLookup.successTTLDays).toBe(30);
    });

    test('failure TTL is 3 days', () => {
        expect(CACHE_CONFIG.placesLookup.failureTTLDays).toBe(3);
    });
});

// ── Read/Write ───────────────────────────────────────────────────────────────

describe('enrichmentCache — placesLookup read/write', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns null for null business name', async () => {
        const result = await getPlacesLookup(null, 'Atlanta', 'GA');
        expect(result).toBeNull();
    });

    test('returns null when doc does not exist', async () => {
        mockGet.mockResolvedValueOnce({ exists: false });
        const result = await getPlacesLookup('Test', 'Atlanta', 'GA');
        expect(result).toBeNull();
    });

    test('returns cached data when doc is fresh', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 10);
        const cachedData = { success: true, rating: 4.5 };
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                result: cachedData,
                expiresAt: { toDate: () => futureDate },
            }),
        });
        const result = await getPlacesLookup('Test', 'Atlanta', 'GA');
        expect(result).toEqual(cachedData);
    });

    test('returns null when doc is expired', async () => {
        const pastDate = new Date(Date.now() - 86400000);
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                result: { success: true },
                expiresAt: { toDate: () => pastDate },
            }),
        });
        const result = await getPlacesLookup('Test', 'Atlanta', 'GA');
        expect(result).toBeNull();
    });

    test('setPlacesLookup does not throw on null name', async () => {
        await expect(setPlacesLookup(null, 'ATL', 'GA', { success: true }, true))
            .resolves.not.toThrow();
    });
});
