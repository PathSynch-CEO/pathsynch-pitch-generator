'use strict';

/**
 * outscraperClient.js — Thin wrapper around Outscraper Reviews API.
 *
 * Fetch only — no billing, no cache, no status updates.
 * One retry on 429 with exponential backoff.
 * Never throws into the handler — always returns { success, data, error }.
 */

const OUTSCRAPER_BASE = 'https://api.app.outscraper.com';
const TIMEOUT_MS      = 30000;

/**
 * Fetch reviews from Outscraper Reviews API v3.
 *
 * @param {string} placeIdOrQuery — Google Place ID or search query
 * @param {object} [options]
 * @param {number} [options.reviewsLimit=100]
 * @param {string} [options.sort='newest']
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function fetchReviews(placeIdOrQuery, options = {}) {
    const apiKey = process.env.OUTSCRAPER_API_KEY;
    if (!apiKey) {
        return { success: false, data: null, error: 'OUTSCRAPER_API_KEY not configured' };
    }

    if (!placeIdOrQuery || typeof placeIdOrQuery !== 'string') {
        return { success: false, data: null, error: 'placeIdOrQuery is required' };
    }

    const { reviewsLimit = 100, sort = 'newest' } = options;

    const params = new URLSearchParams({
        query:         placeIdOrQuery,
        reviewsLimit:  String(reviewsLimit),
        sort,
        async:         'false',
    });

    const url = `${OUTSCRAPER_BASE}/maps/reviews-v3?${params.toString()}`;

    const headers = {
        'X-API-KEY':    apiKey,
        'Accept':       'application/json',
    };

    // Attempt with one retry on 429
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

            const response = await fetch(url, {
                method:  'GET',
                headers,
                signal:  controller.signal,
            });

            clearTimeout(timeout);

            if (response.status === 429 && attempt === 0) {
                // Exponential backoff: wait 2s before retry
                console.warn('[OutscraperClient] 429 rate limited — retrying in 2s');
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                return {
                    success: false,
                    data:    null,
                    error:   `Outscraper HTTP ${response.status}: ${text.substring(0, 300)}`,
                };
            }

            const json = await response.json();

            // Outscraper returns an array of results; first element contains the reviews
            const result = Array.isArray(json) ? json[0] : json;
            const reviews = result?.reviews_data || result?.reviews || [];

            return {
                success: true,
                data:    reviews,
                error:   null,
            };
        } catch (err) {
            if (err.name === 'AbortError') {
                return { success: false, data: null, error: 'Outscraper request timed out (30s)' };
            }
            // On first attempt network error, don't retry (only retry 429)
            return { success: false, data: null, error: `Outscraper fetch error: ${err.message}` };
        }
    }

    return { success: false, data: null, error: 'Outscraper request failed after retry' };
}

module.exports = { fetchReviews };
