'use strict';

/**
 * usaspendingClient.js — Thin USAspending API client.
 *
 * No auth required (public API). Never throws.
 * Field names use official USAspending display-style names in requests.
 * Responses normalized to camelCase internally.
 */

const USASPENDING_BASE = 'https://api.usaspending.gov';
const TIMEOUT_MS       = 30000;

// Default: contracts only (exclude grants, loans, etc.)
const DEFAULT_AWARD_TYPE_CODES = ['A', 'B', 'C', 'D'];

// Official USAspending display field names for spending_by_award
const AWARD_FIELDS = [
    'Award ID',
    'Recipient Name',
    'Start Date',
    'End Date',
    'Award Amount',
    'Awarding Agency',
    'Awarding Sub Agency',
    'Description',
    'NAICS',
    'PSC',
    'Contract Award Type',
    'generated_internal_id',
];

// ── Search Similar Awards ────────────────────────────────────────────────────

/**
 * Search USAspending for similar contract awards.
 *
 * @param {object} params
 * @param {string} [params.naicsCode]
 * @param {string} [params.agencyName]
 * @param {string} [params.keyword]
 * @param {number} [params.fiscalYear] — defaults to current FY
 * @returns {Promise<{success: boolean, data?: {awards: Array, totalCount: number}, error?: string}>}
 */
async function searchSimilarAwards(params = {}) {
    if (!params.naicsCode && !params.agencyName) {
        return { success: false, data: null, error: 'naicsCode or agencyName required' };
    }

    const fy = params.fiscalYear || _currentFiscalYear();
    const filters = _buildFilters(params, fy);

    const body = {
        filters,
        fields: AWARD_FIELDS,
        limit:  10,
        page:   1,
        sort:   'Award Amount',
        order:  'desc',
    };

    try {
        const response = await _post('/api/v2/search/spending_by_award/', body);

        if (!response.success) return response;

        const results = response.data?.results || [];
        const total   = response.data?.page_metadata?.total || results.length;

        const awards = results.map(_normalizeAward);

        return {
            success: true,
            data: { awards, totalCount: total },
            error: null,
        };
    } catch (err) {
        return { success: false, data: null, error: `USAspending search error: ${err.message}` };
    }
}

// ── Search Top Recipients ────────────────────────────────────────────────────

/**
 * Search USAspending for top recipients by category.
 *
 * @param {object} params
 * @param {string} [params.naicsCode]
 * @param {string} [params.agencyName]
 * @param {number} [params.fiscalYear]
 * @returns {Promise<{success: boolean, data?: {recipients: Array}, error?: string}>}
 */
async function searchTopRecipients(params = {}) {
    if (!params.naicsCode && !params.agencyName) {
        return { success: false, data: null, error: 'naicsCode or agencyName required' };
    }

    const fy = params.fiscalYear || _currentFiscalYear();
    const filters = _buildFilters(params, fy);

    const body = {
        category: 'recipient',
        filters,
        limit: 10,
        page:  1,
    };

    try {
        const response = await _post('/api/v2/search/spending_by_category/recipient/', body);

        if (!response.success) return response;

        const results = response.data?.results || [];
        const recipients = results.map(r => ({
            name:        r.name || null,
            amount:      parseFloat(r.amount) || 0,
            recipientId: r.recipient_id || null,
            code:        r.code || null,
            uei:         r.uei || null,
        }));

        return {
            success: true,
            data: { recipients },
            error: null,
        };
    } catch (err) {
        return { success: false, data: null, error: `USAspending recipients error: ${err.message}` };
    }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function _buildFilters(params, fiscalYear) {
    const filters = {
        award_type_codes: DEFAULT_AWARD_TYPE_CODES,
        time_period: [{
            start_date: `${fiscalYear - 1}-10-01`,
            end_date:   `${fiscalYear}-09-30`,
        }],
    };

    if (params.naicsCode) {
        filters.naics_codes = [String(params.naicsCode)];
    }

    if (params.agencyName) {
        filters.agencies = [{
            type: 'awarding',
            tier: 'toptier',
            name: params.agencyName,
        }];
    }

    if (params.keyword) {
        filters.keywords = [params.keyword];
    }

    return filters;
}

function _normalizeAward(raw) {
    return {
        awardId:         raw['Award ID'] || null,
        recipientName:   raw['Recipient Name'] || null,
        startDate:       raw['Start Date'] || null,
        endDate:         raw['End Date'] || null,
        awardAmount:     parseFloat(raw['Award Amount']) || 0,
        awardingAgency:  raw['Awarding Agency'] || null,
        awardingSubAgency: raw['Awarding Sub Agency'] || null,
        description:     raw['Description'] || null,
        naics:           raw['NAICS'] || null,
        psc:             raw['PSC'] || null,
        contractType:    raw['Contract Award Type'] || null,
        internalId:      raw['generated_internal_id'] || null,
    };
}

function _currentFiscalYear() {
    const now = new Date();
    // US fiscal year starts Oct 1 — if month >= 10, FY = year + 1
    return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

async function _post(path, body) {
    const url = `${USASPENDING_BASE}${path}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            return { success: false, data: null, error: `USAspending HTTP ${response.status}: ${text.substring(0, 300)}` };
        }

        const data = await response.json();
        return { success: true, data, error: null };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, data: null, error: 'USAspending request timed out (30s)' };
        }
        return { success: false, data: null, error: `USAspending fetch error: ${err.message}` };
    }
}

module.exports = {
    searchSimilarAwards,
    searchTopRecipients,
    AWARD_FIELDS,
    DEFAULT_AWARD_TYPE_CODES,
    _normalizeAward,
    _currentFiscalYear,
};
