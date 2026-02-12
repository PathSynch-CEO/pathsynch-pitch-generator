/**
 * Verification test for the pitch module wrapper
 * Ensures the new ./pitch path exports everything the original ./pitchGenerator does
 */

// Mock firebase-admin before requiring the modules
jest.mock('firebase-admin', () => {
    const mockFirestore = {
        collection: jest.fn(function() { return this; }),
        doc: jest.fn(function() { return this; }),
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        where: jest.fn(function() { return this; }),
        limit: jest.fn(function() { return this; }),
    };

    const firestoreFn = jest.fn(() => mockFirestore);
    firestoreFn.FieldValue = {
        serverTimestamp: jest.fn(() => new Date()),
        increment: jest.fn((n) => n),
    };

    return {
        firestore: firestoreFn,
        initializeApp: jest.fn(),
        credential: {
            applicationDefault: jest.fn(),
        },
    };
});

// Mock precallForm service
jest.mock('../services/precallForm', () => ({
    mapResponsesToPitchData: jest.fn(() => ({})),
}));

describe('pitch module wrapper', () => {
    test('exports same functions as pitchGenerator', () => {
        // Import from both paths
        const original = require('../api/pitchGenerator');
        const wrapper = require('../api/pitch');

        // Verify all expected exports exist in both
        const expectedExports = [
            'generatePitch',
            'generatePitchDirect',
            'getPitch',
            'getSharedPitch',
            'generateLevel1',
            'generateLevel2',
            'generateLevel3',
            'calculateROI',
        ];

        expectedExports.forEach((exportName) => {
            expect(typeof original[exportName]).toBe('function');
            expect(typeof wrapper[exportName]).toBe('function');
            // Verify they're the same function reference
            expect(wrapper[exportName]).toBe(original[exportName]);
        });
    });

    test('level generators work through wrapper', () => {
        const wrapper = require('../api/pitch');

        const inputs = {
            businessName: 'Test Business',
            industry: 'Retail',
            contactName: 'Test Person',
            googleRating: 4.5,
            numReviews: 100,
        };

        const reviewData = {
            sentiment: { positive: 70, neutral: 20, negative: 10 },
            topThemes: ['Good service'],
            staffMentions: [],
            differentiators: [],
        };

        const roiData = {
            monthlyVisits: 200,
            newCustomers: 40,
            avgTicket: 50,
            monthlyIncrementalRevenue: 2400,
            sixMonthRevenue: 14400,
            roi: 100,
            growthRate: 20,
        };

        const options = {};

        // Verify each level generator works through the wrapper
        expect(() => wrapper.generateLevel1(inputs, reviewData, roiData, options)).not.toThrow();
        expect(() => wrapper.generateLevel2(inputs, reviewData, roiData, options)).not.toThrow();
        expect(() => wrapper.generateLevel3(inputs, reviewData, roiData, options)).not.toThrow();

        // Verify they return HTML
        const html = wrapper.generateLevel2(inputs, reviewData, roiData, options);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Test Business');
    });
});
