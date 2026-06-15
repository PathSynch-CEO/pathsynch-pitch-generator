'use strict';

/**
 * govPrefilter.js — Deterministic relevance scoring before Gemini.
 *
 * Pure function, no AI, no Firestore.
 * Score range: 0-9 (floor 0, never negative).
 */

/**
 * @param {object} opportunity — normalized GovOpportunity
 * @param {object} profile — GovProfile
 * @returns {{ score: number, signals: string[] }}
 */
function scoreRelevance(opportunity, profile) {
    let score = 0;
    const signals = [];

    const titleLower = _normalizeText(opportunity.title || '');
    const descLower  = _normalizeText(opportunity.description || '');
    const combinedText = titleLower + ' ' + descLower;

    // 1. Exact NAICS/PSC match (+3)
    const oppNaics  = (opportunity.naicsCodes || []).map(c => String(c).trim());
    const profNaics = _collectNaicsCodes(profile);

    if (oppNaics.length > 0 && profNaics.length > 0) {
        const hasExact = oppNaics.some(n => profNaics.includes(n));
        if (hasExact) {
            score += 3;
            signals.push('MATCH_NAICS_EXACT');
        }
    }

    // 2. Query-grade keyword hits in title + description (+1 per hit, cap 5)
    const allKeywords = _collectAllKeywords(profile);
    let keywordHits = 0;
    for (const kw of allKeywords) {
        if (keywordHits >= 5) break;
        if (_matchKeyword(kw, combinedText)) {
            keywordHits++;
            signals.push(`KEYWORD_HIT:${kw}`);
        }
    }
    score += keywordHits;

    // 3. Negative keyword hit (-3 once per distinct keyword, capped at -3 total)
    const negKeywords = profile.negativeKeywords || [];
    let negPenalty = 0;
    for (const nk of negKeywords) {
        if (negPenalty >= 3) break;
        if (_matchKeyword(nk, combinedText)) {
            negPenalty++;
            signals.push(`NEGATIVE_KEYWORD:${nk}`);
        }
    }
    score -= negPenalty;

    // 4. Buyer type in priority list (+1)
    const priorityBuyers = profile.filters?.buyerTypes || [];
    if (priorityBuyers.length > 0 && opportunity.buyerName) {
        const buyerLower = opportunity.buyerName.toLowerCase();
        if (priorityBuyers.some(bt => buyerLower.includes(bt.toLowerCase()))) {
            score += 1;
            signals.push('BUYER_TYPE_PRIORITY');
        }
    }

    // Floor at 0
    return { score: Math.max(0, score), signals };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _normalizeText(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Match a keyword against text.
 * Multi-word: exact phrase match.
 * Single-word: word boundary match (not substring).
 */
function _matchKeyword(keyword, normalizedText) {
    if (!keyword || !normalizedText) return false;
    const kwNorm = _normalizeText(keyword);
    if (!kwNorm) return false;

    if (kwNorm.includes(' ')) {
        // Multi-word: exact phrase match
        return normalizedText.includes(kwNorm);
    }
    // Single-word: word boundary match
    const regex = new RegExp(`\\b${_escapeRegex(kwNorm)}\\b`, 'i');
    return regex.test(normalizedText);
}

function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _collectNaicsCodes(profile) {
    const codes = new Set();
    if (Array.isArray(profile.credentials?.naicsCodes)) {
        for (const c of profile.credentials.naicsCodes) {
            if (c) codes.add(String(c).trim());
        }
    }
    if (Array.isArray(profile.solutions)) {
        for (const sol of profile.solutions) {
            if (Array.isArray(sol.naicsCodes)) {
                for (const c of sol.naicsCodes) {
                    if (c) codes.add(String(c).trim());
                }
            }
        }
    }
    return Array.from(codes);
}

function _collectAllKeywords(profile) {
    const kws = [];
    if (Array.isArray(profile.solutions)) {
        for (const sol of profile.solutions) {
            if (Array.isArray(sol.keywords)) {
                kws.push(...sol.keywords);
            }
        }
    }
    return kws;
}

module.exports = {
    scoreRelevance,
    // Exported for testing
    _matchKeyword,
    _normalizeText,
};
