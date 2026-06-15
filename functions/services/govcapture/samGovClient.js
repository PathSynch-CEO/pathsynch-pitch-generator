'use strict';

/**
 * samGovClient.js — Thin SAM.gov Opportunities API client.
 *
 * Fetch only — no scoring, no dedup, no Firestore writes.
 * Rate limit: 500ms minimum between requests (internal throttle).
 * Never throws — always returns { success, data, error }.
 */

const SAM_BASE_URL = 'https://api.sam.gov/opportunities/v2/search';
const TIMEOUT_MS   = 30000;
const THROTTLE_MS  = 500;

let _lastRequestTime = 0;

// ── Notice Type Mapping (internal → SAM.gov ptype) ──────────────────────────

const NOTICE_TYPE_MAP = {
    sources_sought:                 'r',
    presolicitation:                'p',
    solicitation:                   'o',
    combined_synopsis_solicitation: 'k',
    award_notice:                   'a',
    special_notice:                 's',
    justification:                  'u',
};

// ── Date Formatter ───────────────────────────────────────────────────────────

/**
 * Format a Date to MM/dd/yyyy (SAM.gov required format).
 */
function formatSamDate(date) {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

// ── Throttle ─────────────────────────────────────────────────────────────────

async function _throttle() {
    const now  = Date.now();
    const diff = now - _lastRequestTime;
    if (diff < THROTTLE_MS) {
        await new Promise(r => setTimeout(r, THROTTLE_MS - diff));
    }
    _lastRequestTime = Date.now();
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search SAM.gov Opportunities API.
 *
 * @param {object} params — internal normalized param names
 * @param {string} [params.keyword]     — maps to SAM `title`
 * @param {string} [params.naicsCode]   — maps to SAM `ncode`
 * @param {string} [params.noticeType]  — internal name, mapped to SAM `ptype`
 * @param {string|Date} params.postedFrom — REQUIRED, maps to SAM `postedFrom` (MM/dd/yyyy)
 * @param {string|Date} params.postedTo   — REQUIRED, maps to SAM `postedTo` (MM/dd/yyyy)
 * @param {number} [params.limit=100]
 * @param {number} [params.offset=0]
 * @returns {Promise<{success: boolean, data?: {opportunities: Array, totalRecords: number}, error?: string}>}
 */
async function searchOpportunities(params = {}) {
    const apiKey = process.env.SAM_GOV_API_KEY;
    if (!apiKey) {
        return { success: false, data: null, error: 'SAM_GOV_API_KEY not configured' };
    }

    // Validate mandatory date params
    const postedFrom = formatSamDate(params.postedFrom);
    const postedTo   = formatSamDate(params.postedTo);

    if (!postedFrom || !postedTo) {
        return {
            success: false, data: null,
            error: 'Both postedFrom and postedTo are required (SAM.gov mandate). Format: Date or ISO string.',
        };
    }

    // Build SAM.gov query params (translate internal → official names)
    const queryParams = new URLSearchParams();
    queryParams.set('api_key', apiKey);
    queryParams.set('postedFrom', postedFrom);
    queryParams.set('postedTo', postedTo);
    queryParams.set('limit', String(params.limit || 100));
    queryParams.set('offset', String(params.offset || 0));

    if (params.keyword) {
        queryParams.set('title', params.keyword);
    }
    if (params.naicsCode) {
        queryParams.set('ncode', params.naicsCode);
    }
    if (params.noticeType) {
        const ptype = NOTICE_TYPE_MAP[params.noticeType];
        if (ptype) {
            queryParams.set('ptype', ptype);
        }
    }

    const url = `${SAM_BASE_URL}?${queryParams.toString()}`;

    // Throttle
    await _throttle();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const text = await response.text().catch(() => '');

            // SAM.gov 404 or "No Data found" → empty, not error
            if (response.status === 404 || text.includes('No Data found')) {
                return {
                    success: true,
                    data: { opportunities: [], totalRecords: 0 },
                    error: null,
                };
            }

            return {
                success: false, data: null,
                error: `SAM.gov HTTP ${response.status}: ${text.substring(0, 300)}`,
            };
        }

        const json = await response.json();

        // SAM.gov may return { opportunitiesData: [...], totalRecords } or { error }
        const opportunities = json.opportunitiesData || json.opportunities || [];
        const totalRecords  = json.totalRecords || opportunities.length;

        return {
            success: true,
            data: { opportunities, totalRecords },
            error: null,
        };

    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, data: null, error: 'SAM.gov request timed out (30s)' };
        }
        return { success: false, data: null, error: `SAM.gov fetch error: ${err.message}` };
    }
}

/**
 * Reset the throttle timer (for testing).
 */
function _resetThrottle() {
    _lastRequestTime = 0;
}

module.exports = {
    searchOpportunities,
    formatSamDate,
    NOTICE_TYPE_MAP,
    _resetThrottle,
};
