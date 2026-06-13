'use strict';

// Mock firebase-admin before requiring module
const mockGet = jest.fn().mockResolvedValue({ exists: false });
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin', () => ({
    firestore: () => ({ collection: mockCollection }),
    initializeApp: jest.fn(),
}));
// Add FieldValue.serverTimestamp
const admin = require('firebase-admin');
admin.firestore.FieldValue = { serverTimestamp: () => new Date() };

const {
    normalizeHostname,
    getTechDetection,
    setTechDetection,
    CACHE_CONFIG,
} = require('../services/enrichmentCache');

// ── normalizeHostname ────────────────────────────────────────────────────────

describe('enrichmentCache — normalizeHostname', () => {
    test('strips protocol', () => {
        expect(normalizeHostname('https://example.com')).toBe('example.com');
        expect(normalizeHostname('http://example.com')).toBe('example.com');
    });

    test('strips www prefix', () => {
        expect(normalizeHostname('https://www.example.com')).toBe('example.com');
        expect(normalizeHostname('www.example.com')).toBe('example.com');
    });

    test('strips path, query, fragment', () => {
        expect(normalizeHostname('https://example.com/path?q=1#hash')).toBe('example.com');
    });

    test('lowercases', () => {
        expect(normalizeHostname('HTTPS://WWW.Example.COM')).toBe('example.com');
    });

    test('strips trailing dots', () => {
        expect(normalizeHostname('example.com.')).toBe('example.com');
    });

    test('returns null for empty/null/undefined', () => {
        expect(normalizeHostname(null)).toBeNull();
        expect(normalizeHostname(undefined)).toBeNull();
        expect(normalizeHostname('')).toBeNull();
        expect(normalizeHostname('   ')).toBeNull();
    });

    test('handles bare hostname', () => {
        expect(normalizeHostname('example.com')).toBe('example.com');
    });
});

// ── Cache Config ─────────────────────────────────────────────────────────────

describe('enrichmentCache — config', () => {
    test('techDetection TTLs are 30d success / 3d failure', () => {
        expect(CACHE_CONFIG.techDetection.successTTLDays).toBe(30);
        expect(CACHE_CONFIG.techDetection.failureTTLDays).toBe(3);
    });

    test('reviewHealth TTLs are 14d success / 3d failure', () => {
        expect(CACHE_CONFIG.reviewHealth.successTTLDays).toBe(14);
        expect(CACHE_CONFIG.reviewHealth.failureTTLDays).toBe(3);
    });

    test('placesLookup TTLs are 30d success / 3d failure', () => {
        expect(CACHE_CONFIG.placesLookup.successTTLDays).toBe(30);
        expect(CACHE_CONFIG.placesLookup.failureTTLDays).toBe(3);
    });

    test('three distinct collection names', () => {
        const names = [
            CACHE_CONFIG.techDetection.collection,
            CACHE_CONFIG.reviewHealth.collection,
            CACHE_CONFIG.placesLookup.collection,
        ];
        expect(new Set(names).size).toBe(3);
    });
});

// ── getTechDetection / setTechDetection ──────────────────────────────────────

describe('enrichmentCache — techDetection read/write', () => {
    test('returns null for null hostname', async () => {
        const result = await getTechDetection(null);
        expect(result).toBeNull();
    });

    test('returns null when doc does not exist', async () => {
        const result = await getTechDetection('nonexistent.com');
        expect(result).toBeNull();
    });

    test('setTechDetection does not throw on null hostname', async () => {
        await expect(setTechDetection(null, { tools: [] }, true)).resolves.not.toThrow();
    });
});
