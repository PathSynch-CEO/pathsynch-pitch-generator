/**
 * Unit Tests for pitch/validators.js
 *
 * Tests pitch limit checking and quota management.
 */

// Mock firebase-admin before requiring the module
let mockDb;

jest.mock('firebase-admin', () => {
    mockDb = {
        collection: jest.fn(function() { return this; }),
        doc: jest.fn(function() { return this; }),
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        where: jest.fn(function() { return this; }),
        limit: jest.fn(function() { return this; }),
    };

    const firestoreFn = jest.fn(() => mockDb);
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

const { PITCH_LIMITS, checkPitchLimit, incrementPitchCount } = require('../api/pitch/validators');

describe('pitch/validators', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('PITCH_LIMITS', () => {
        test('defines correct limits for each tier', () => {
            expect(PITCH_LIMITS.free).toBe(5);
            expect(PITCH_LIMITS.starter).toBe(25);
            expect(PITCH_LIMITS.growth).toBe(100);
            expect(PITCH_LIMITS.scale).toBe(-1); // unlimited
            expect(PITCH_LIMITS.enterprise).toBe(-1); // unlimited
        });

        test('has all expected tiers', () => {
            const tiers = Object.keys(PITCH_LIMITS);
            expect(tiers).toContain('free');
            expect(tiers).toContain('starter');
            expect(tiers).toContain('growth');
            expect(tiers).toContain('scale');
            expect(tiers).toContain('enterprise');
        });
    });

    describe('checkPitchLimit', () => {
        function setupMocks(options = {}) {
            const {
                userExists = true,
                userTier = 'growth',
                pitchCount = 0,
            } = options;

            let currentCollection = null;
            let isWhereQuery = false;

            mockDb.collection.mockImplementation((name) => {
                currentCollection = name;
                isWhereQuery = false;
                return mockDb;
            });

            mockDb.doc.mockImplementation(() => mockDb);
            mockDb.where.mockImplementation(() => {
                isWhereQuery = true;
                return mockDb;
            });

            mockDb.get.mockImplementation(() => {
                if (isWhereQuery && currentCollection === 'pitches') {
                    return Promise.resolve({
                        size: pitchCount,
                        empty: pitchCount === 0,
                        docs: [],
                    });
                }

                if (!userExists) {
                    return Promise.resolve({ exists: false });
                }

                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        subscription: { plan: userTier },
                    }),
                });
            });
        }

        test('allows pitch for user under limit', async () => {
            setupMocks({ userTier: 'growth', pitchCount: 50 });

            const result = await checkPitchLimit('test-user');

            expect(result.allowed).toBe(true);
            expect(result.tier).toBe('growth');
            expect(result.limit).toBe(100);
            expect(result.used).toBe(50);
        });

        test('blocks pitch for user at limit', async () => {
            setupMocks({ userTier: 'free', pitchCount: 5 });

            const result = await checkPitchLimit('test-user');

            expect(result.allowed).toBe(false);
            expect(result.tier).toBe('free');
            expect(result.limit).toBe(5);
            expect(result.used).toBe(5);
        });

        test('blocks pitch for user over limit', async () => {
            setupMocks({ userTier: 'starter', pitchCount: 30 });

            const result = await checkPitchLimit('test-user');

            expect(result.allowed).toBe(false);
            expect(result.tier).toBe('starter');
            expect(result.limit).toBe(25);
            expect(result.used).toBe(30);
        });

        test('allows unlimited for scale tier', async () => {
            setupMocks({ userTier: 'scale', pitchCount: 1000 });

            const result = await checkPitchLimit('test-user');

            expect(result.allowed).toBe(true);
            expect(result.tier).toBe('scale');
            expect(result.limit).toBe(-1);
        });

        test('allows unlimited for enterprise tier', async () => {
            setupMocks({ userTier: 'enterprise', pitchCount: 5000 });

            const result = await checkPitchLimit('test-user');

            expect(result.allowed).toBe(true);
            expect(result.tier).toBe('enterprise');
            expect(result.limit).toBe(-1);
        });

        test('defaults to free tier for non-existent user', async () => {
            setupMocks({ userExists: false });

            const result = await checkPitchLimit('new-user');

            expect(result.allowed).toBe(true);
            expect(result.tier).toBe('free');
            expect(result.limit).toBe(5);
            expect(result.used).toBe(0);
        });

        test('handles unknown tier by defaulting to free limit', async () => {
            setupMocks({ userTier: 'unknown-tier', pitchCount: 3 });

            const result = await checkPitchLimit('test-user');

            expect(result.limit).toBe(5); // falls back to free limit
        });
    });

    describe('incrementPitchCount', () => {
        test('updates user document with incremented counts', async () => {
            mockDb.update.mockResolvedValue({});

            await incrementPitchCount('test-user');

            expect(mockDb.collection).toHaveBeenCalledWith('users');
            expect(mockDb.doc).toHaveBeenCalledWith('test-user');
            expect(mockDb.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    pitchesThisMonth: expect.anything(),
                    totalPitches: expect.anything(),
                    lastPitchAt: expect.anything(),
                })
            );
        });
    });
});
