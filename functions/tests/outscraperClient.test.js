'use strict';

const { fetchReviews } = require('../services/outscraperClient');

// ── Missing API Key ──────────────────────────────────────────────────────────

describe('outscraperClient — fetchReviews', () => {
    const originalKey = process.env.OUTSCRAPER_API_KEY;

    afterEach(() => {
        if (originalKey !== undefined) {
            process.env.OUTSCRAPER_API_KEY = originalKey;
        } else {
            delete process.env.OUTSCRAPER_API_KEY;
        }
    });

    test('returns error when API key not set', async () => {
        delete process.env.OUTSCRAPER_API_KEY;
        const result = await fetchReviews('ChIJ12345');
        expect(result.success).toBe(false);
        expect(result.error).toContain('OUTSCRAPER_API_KEY');
    });

    test('returns error when placeIdOrQuery is null', async () => {
        process.env.OUTSCRAPER_API_KEY = 'test-key';
        const result = await fetchReviews(null);
        expect(result.success).toBe(false);
        expect(result.error).toContain('required');
    });

    test('returns error when placeIdOrQuery is empty', async () => {
        process.env.OUTSCRAPER_API_KEY = 'test-key';
        const result = await fetchReviews('');
        expect(result.success).toBe(false);
        expect(result.error).toContain('required');
    });

    test('never throws — always returns result object', async () => {
        process.env.OUTSCRAPER_API_KEY = 'test-key';
        // Even with a non-existent URL, it should return { success: false, error }
        // This test just verifies the function signature — actual HTTP is not tested
        const result = await fetchReviews(null);
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('error');
    });
});
