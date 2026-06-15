'use strict';

/**
 * samQueryBuilder.js — Build SAM.gov query buckets from a GovProfile.
 *
 * Multi-bucket strategy (PRD §4A):
 *   Bucket 1: NAICS-first (high precision)
 *   Bucket 2: High-intent title phrases (top 10 per solution)
 *   Bucket 3: Sources sought / market research
 *
 * Max 10 queries per profile per sync.
 * All queries use INTERNAL param names — samGovClient handles translation.
 */

const MAX_QUERIES = 10;
const DEFAULT_LOOKBACK_DAYS = 30;

// Broad generic terms that are scoring-only — never used in SAM.gov queries
const BROAD_KEYWORDS = new Set([
    'logistics', 'operations', 'services', 'healthcare', 'aviation',
    'technology', 'management', 'consulting', 'support', 'training',
    'solutions', 'systems', 'program', 'project', 'analysis',
    'information', 'data', 'security', 'engineering', 'development',
]);

/**
 * Build queries for a profile sync.
 *
 * @param {object} profile — GovProfile document data
 * @param {Date|string|null} lastSyncDate — last successful sync, or null for first sync
 * @returns {Array<object>} — query objects with internal param names
 */
function buildQueriesForProfile(profile, lastSyncDate) {
    if (!profile || !profile.solutions) return [];

    const now       = new Date();
    const postedTo  = now;
    const postedFrom = _resolvePostedFrom(lastSyncDate);

    const queries = [];

    // Collect NAICS codes from credentials and solutions
    const naicsCodes = _collectNaicsCodes(profile);

    // Primary solutions (all solutions for now — priority can be added later)
    const solutions = Array.isArray(profile.solutions) ? profile.solutions : [];

    // ── Bucket 1: NAICS-first queries ────────────────────────────────────
    for (const naics of naicsCodes) {
        if (queries.length >= MAX_QUERIES) break;
        queries.push({
            bucket:     'naics',
            naicsCode:  naics,
            postedFrom,
            postedTo,
            limit:      100,
        });
    }

    // ── Bucket 2: High-intent title phrases ──────────────────────────────
    for (const sol of solutions) {
        if (queries.length >= MAX_QUERIES) break;

        const queryKeywords = _selectQueryKeywords(sol.keywords || [], 10);
        for (const kw of queryKeywords) {
            if (queries.length >= MAX_QUERIES) break;

            // Skip if we already have a NAICS query (avoid duplicate coverage)
            queries.push({
                bucket:    'keyword',
                keyword:   kw,
                postedFrom,
                postedTo,
                limit:     100,
            });
        }
    }

    // ── Bucket 3: Sources sought ─────────────────────────────────────────
    if (queries.length < MAX_QUERIES) {
        const anchor = naicsCodes[0] || _selectQueryKeywords(solutions[0]?.keywords || [], 1)[0];
        if (anchor) {
            const sourceQuery = {
                bucket:     'sources_sought',
                noticeType: 'sources_sought',
                postedFrom,
                postedTo,
                limit:      50,
            };
            // Use NAICS if available, else keyword
            if (naicsCodes[0]) {
                sourceQuery.naicsCode = naicsCodes[0];
            } else {
                sourceQuery.keyword = anchor;
            }
            queries.push(sourceQuery);
        }
    }

    return queries.slice(0, MAX_QUERIES);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _resolvePostedFrom(lastSyncDate) {
    if (lastSyncDate) {
        const d = lastSyncDate instanceof Date ? lastSyncDate : new Date(lastSyncDate);
        if (!isNaN(d.getTime())) return d;
    }
    // Default: 30 days ago
    const d = new Date();
    d.setDate(d.getDate() - DEFAULT_LOOKBACK_DAYS);
    return d;
}

function _collectNaicsCodes(profile) {
    const codes = new Set();

    // From credentials
    if (Array.isArray(profile.credentials?.naicsCodes)) {
        for (const c of profile.credentials.naicsCodes) {
            if (c && typeof c === 'string') codes.add(c.trim());
        }
    }

    // From solutions (if solutions have naicsCodes)
    if (Array.isArray(profile.solutions)) {
        for (const sol of profile.solutions) {
            if (Array.isArray(sol.naicsCodes)) {
                for (const c of sol.naicsCodes) {
                    if (c && typeof c === 'string') codes.add(c.trim());
                }
            }
        }
    }

    return Array.from(codes);
}

/**
 * Select top N query-grade keywords from a keyword list.
 * Prefer multi-word phrases, skip broad generic terms.
 */
function _selectQueryKeywords(keywords, maxCount) {
    if (!Array.isArray(keywords) || keywords.length === 0) return [];

    // Filter out broad terms
    const filtered = keywords.filter(kw => {
        if (!kw || typeof kw !== 'string') return false;
        const lower = kw.toLowerCase().trim();
        // Single-word broad terms are excluded
        if (BROAD_KEYWORDS.has(lower)) return false;
        return true;
    });

    // Sort: prefer multi-word (more specific) first
    filtered.sort((a, b) => {
        const aWords = a.trim().split(/\s+/).length;
        const bWords = b.trim().split(/\s+/).length;
        return bWords - aWords; // more words = higher priority
    });

    // Take top N from the first 10 (query-grade keywords are listed first in profile)
    return filtered.slice(0, maxCount);
}

module.exports = {
    buildQueriesForProfile,
    MAX_QUERIES,
    BROAD_KEYWORDS,
    // Exported for testing
    _selectQueryKeywords,
    _collectNaicsCodes,
};
