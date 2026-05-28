'use strict';

/**
 * SpyFu API Client
 *
 * Provides keyword rankings, organic traffic estimates, and PPC intelligence.
 * Auth: Basic Auth — base64(SPYFU_API_KEY:SYDM0E4D) per SpyFu API docs.
 * Env: SPYFU_API_KEY (Firebase Secret)
 *
 * All functions return null on failure — never throws.
 */

const BASE_URL   = 'https://api.spyfu.com/apis';
const SPYFU_PASS = 'SYDM0E4D'; // Fixed password component per SpyFu API docs

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Build Basic Auth header, reading SPYFU_API_KEY at call time
 * (Firebase Secrets are populated into process.env at runtime).
 * Returns null if key is missing.
 */
function getAuthHeader() {
    const key = process.env.SPYFU_API_KEY;
    if (!key) return null;
    return 'Basic ' + Buffer.from(`${key}:${SPYFU_PASS}`).toString('base64');
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function spyFuRequest(endpoint) {
    const auth = getAuthHeader();
    if (!auth) {
        console.warn('[SpyFu] SPYFU_API_KEY not configured — skipping');
        return null;
    }

    try {
        const resp = await fetch(`${BASE_URL}${endpoint}`, {
            method:  'GET',
            headers: { 'Authorization': auth }
        });

        if (!resp.ok) {
            console.warn('[SpyFu] HTTP error:', resp.status, endpoint);
            return null;
        }

        const data = await resp.json();
        return data;
    } catch (e) {
        console.warn('[SpyFu] Request failed:', e.message, endpoint);
        return null;
    }
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Get domain-level stats: authority strength, organic/paid traffic estimates.
 *
 * @param {string} domain - bare domain (e.g. "example.com")
 * @returns {{
 *   strength: number,
 *   averageOrganicRank: number,
 *   totalOrganicResults: number,
 *   monthlyOrganicClicks: number,
 *   monthlyOrganicValue: number,
 *   monthlyPaidClicks: number,
 *   monthlyBudget: number,
 *   totalAdsPurchased: number
 * }|null}
 */
async function getDomainStats(domain) {
    if (!domain) return null;
    try {
        const data = await spyFuRequest(
            `/domain_stats_api/v2/getLatestDomainStats?domain=${encodeURIComponent(domain)}`
        );
        if (!data) return null;

        return {
            strength:             data.strength              ?? null,
            averageOrganicRank:   data.averageOrganicRank    ?? null,
            totalOrganicResults:  data.totalOrganicResults   ?? null,
            monthlyOrganicClicks: data.monthlyOrganicClicks  ?? null,
            monthlyOrganicValue:  data.monthlyOrganicValue   ?? null,
            monthlyPaidClicks:    data.monthlyPaidClicks     ?? null,
            monthlyBudget:        data.monthlyBudget         ?? null,
            totalAdsPurchased:    data.totalAdsPurchased     ?? null
        };
    } catch (e) {
        console.warn('[SpyFu] getDomainStats failed:', e.message);
        return null;
    }
}

/**
 * Get top organic keywords for a domain.
 *
 * @param {string} domain
 * @param {number} [limit=10]
 * @returns {Array<{ keyword, rankNumber, searchVolume, costPerClick, rankChange }>|null}
 */
async function getTopOrganicKeywords(domain, limit) {
    if (!domain) return null;
    try {
        const max = limit || 10;
        const data = await spyFuRequest(
            `/seo_research_api/v2/getTopOrganicKeywords?domain=${encodeURIComponent(domain)}&maxResults=${max}`
        );
        if (!data) return null;

        // SpyFu wraps results in a .results array; handle both shapes defensively
        const items = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : null);
        if (!items) return null;

        return items.map(k => ({
            keyword:      k.keyword      ?? null,
            rankNumber:   k.rankNumber   ?? null,
            searchVolume: k.searchVolume ?? null,
            costPerClick: k.costPerClick ?? null,
            rankChange:   k.rankChange   ?? null
        }));
    } catch (e) {
        console.warn('[SpyFu] getTopOrganicKeywords failed:', e.message);
        return null;
    }
}

/**
 * Get top paid (PPC) keywords for a domain.
 *
 * @param {string} domain
 * @param {number} [limit=5]
 * @returns {Array<{ keyword, adPosition, searchVolume, costPerClick, monthlyClicks }>|null}
 */
async function getTopPaidKeywords(domain, limit) {
    if (!domain) return null;
    try {
        const max = limit || 5;
        const data = await spyFuRequest(
            `/ppc_research_api/v2/getTopPaidKeywords?domain=${encodeURIComponent(domain)}&maxResults=${max}`
        );
        if (!data) return null;

        const items = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : null);
        if (!items) return null;

        return items.map(k => ({
            keyword:      k.keyword      ?? null,
            adPosition:   k.adPosition   ?? null,
            searchVolume: k.searchVolume ?? null,
            costPerClick: k.costPerClick ?? null,
            monthlyClicks: k.monthlyClicks ?? null
        }));
    } catch (e) {
        console.warn('[SpyFu] getTopPaidKeywords failed:', e.message);
        return null;
    }
}

module.exports = {
    getDomainStats,
    getTopOrganicKeywords,
    getTopPaidKeywords
};
