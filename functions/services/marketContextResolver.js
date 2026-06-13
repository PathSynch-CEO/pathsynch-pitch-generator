'use strict';

/**
 * marketContextResolver.js — PRD v2.3 §3E
 *
 * Reads existing marketReports to provide market context for Prospect Intel.
 * marketReports is READ-ONLY — this module never writes to it.
 *
 * Exports:
 *   resolveMarketContext(userId, city, state, industry)
 *   matchProspectToReport(prospect, reportMeta, competitorIndex)
 */

const admin = require('firebase-admin');

const MARKET_CONTEXT_MAX_AGE_DAYS = parseInt(process.env.MARKET_CONTEXT_MAX_AGE_DAYS) || 60;

// ── Generic name stoplist for city guard distinctiveness test ─────────────────

const GENERIC_STOPLIST = new Set([
    'auto', 'automotive', 'repair', 'repairs', 'service', 'services',
    'car', 'care', 'shop', 'center', 'centre', 'garage', 'motors',
    'mobile', 'pro', 'professional', 'quality', 'family', 'express',
    'complete', 'total', 'best', 'top',
]);

// ── Legal suffix patterns ────────────────────────────────────────────────────

const LEGAL_SUFFIXES = /\b(llc|inc|co|corp|ltd|l\.l\.c\.?|incorporated|corporation|company)\b\.?/gi;

// ── Name Normalization ───────────────────────────────────────────────────────

function normalizeName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .toLowerCase()
        .replace(LEGAL_SUFFIXES, '')
        .replace(/[^a-z0-9\s]/g, '')  // strip punctuation
        .replace(/\s+/g, ' ')          // collapse whitespace
        .trim();
}

function normalizeCity(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.toLowerCase().trim();
}

// ── Token Set Similarity ─────────────────────────────────────────────────────

function tokenSetSimilarity(a, b) {
    const tokensA = new Set(a.split(' ').filter(Boolean));
    const tokensB = new Set(b.split(' ').filter(Boolean));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
        if (tokensB.has(t)) intersection++;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union > 0 ? intersection / union : 0;
}

// ── Distinctiveness Test ─────────────────────────────────────────────────────

function isDistinctiveName(normalizedName) {
    const tokens = normalizedName.split(' ').filter(Boolean);
    return tokens.some(t => !GENERIC_STOPLIST.has(t));
}

// ── Date Helpers ─────────────────────────────────────────────────────────────

function _toDate(val) {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate(); // Firestore Timestamp
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

// ── Resolve Market Context ───────────────────────────────────────────────────

/**
 * Query existing marketReports to find market context for a prospect batch.
 *
 * @param {string} userId
 * @param {string} city
 * @param {string} state
 * @param {string} industry
 * @returns {Promise<{benchmarks: object, competitorIndex: Array}|null>}
 */
async function resolveMarketContext(userId, city, state, industry) {
    if (!city || !industry) return null;
    if (!userId) return null;

    const db  = admin.firestore();
    const now = new Date();

    try {
        // Uses existing composite index: userId ASC + location.city ASC + createdAt DESC
        const snap = await db.collection('marketReports')
            .where('userId', '==', userId)
            .where('location.city', '==', city)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        if (snap.empty) return null;

        // Filter in memory: industry match + freshness
        const normalizedIndustry = (industry || '').toLowerCase().trim();

        let bestReport = null;
        for (const doc of snap.docs) {
            const d = doc.data();

            // Industry match (normalized lowercase)
            const reportIndustry = (d.industry?.display || '').toLowerCase().trim();
            if (!reportIndustry || !reportIndustry.includes(normalizedIndustry) && !normalizedIndustry.includes(reportIndustry)) {
                continue;
            }

            // Freshness check
            const createdAt = _toDate(d.createdAt);
            if (!createdAt) continue;

            const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            if (ageDays > MARKET_CONTEXT_MAX_AGE_DAYS) continue;

            bestReport = { id: doc.id, data: d, createdAt, ageDays };
            break; // Already sorted by createdAt DESC — first match is newest
        }

        if (!bestReport) return null;

        const report = bestReport.data;
        const benchmarksData = report.data?.benchmarks || {};
        const salesIntel     = report.data?.salesIntel || {};
        const newsSignals    = report.data?.newsSignals || [];

        // ── Build benchmarks (lean, for batch doc) ───────────────────────────
        const benchmarks = {
            reportId:          bestReport.id,
            generatedAt:       bestReport.createdAt.toISOString(),
            ageDays:           bestReport.ageDays,
            marketAvgRating:   parseFloat(benchmarksData.avgRating) || null,
            marketAvgReviews:  parseInt(benchmarksData.avgReviews) || null,
            topQuartileRating: parseFloat(benchmarksData.topQuartileRating) || null,
            marketLeader:      _buildLeaderSnapshot(benchmarksData.marketLeader),
            totalCompetitors:  parseInt(benchmarksData.totalCompetitors) || 0,
            seoMarketAvg:      parseFloat(benchmarksData.marketLeader?.seoScore) || null,
            entryWedge:        (salesIntel.entryWedge || '').substring(0, 300) || null,
            bestTimeToCall:    (salesIntel.bestTimeToCall || '').substring(0, 200) || null,
            painPoints:        (salesIntel.topPainPoints || []).slice(0, 3),
            newsSignals:       newsSignals.slice(0, 3).map(ns => ({
                headline: (ns.title || '').substring(0, 200),
                ageDays:  ns.daysAgo || null,
            })),
        };

        // ── Build competitor index (capped, for meta/marketIndex doc) ────────
        const competitors    = report.data?.competitors || [];
        const qualifiedLeads = report.data?.leads || [];
        const reportCity     = normalizeCity(report.location?.city);
        const reportState    = normalizeCity(report.location?.state);

        const competitorIndex = _buildCompetitorIndex(
            competitors, qualifiedLeads, reportCity, reportState
        );

        return { benchmarks, competitorIndex };

    } catch (err) {
        console.error('[MarketContextResolver] resolveMarketContext error:', err.message);
        return null;
    }
}

// ── Build Leader Snapshot ────────────────────────────────────────────────────

function _buildLeaderSnapshot(leader) {
    if (!leader) return null;
    return {
        name:       (leader.name || '').substring(0, 120),
        rating:     parseFloat(leader.rating) || null,
        reviews:    parseInt(leader.reviews) || 0,
        voiceShare: parseFloat(leader.voiceShare) || null,
    };
}

// ── Build Competitor Index ───────────────────────────────────────────────────

function _buildCompetitorIndex(competitors, qualifiedLeads, reportCity, reportState) {
    const deduped = new Map(); // key: normalizedName|city|state

    // qualifiedLeads first (preferred when fields conflict)
    for (const lead of qualifiedLeads) {
        const entry = _buildIndexEntry(lead, reportCity, reportState, true);
        if (entry) {
            deduped.set(entry._dedupeKey, entry);
        }
    }

    // competitors second (only if not already present)
    for (const comp of competitors) {
        const entry = _buildIndexEntry(comp, reportCity, reportState, false);
        if (entry) {
            if (!deduped.has(entry._dedupeKey)) {
                deduped.set(entry._dedupeKey, entry);
            }
        }
    }

    // Sort: qualifiedLeads first (isLead=true), then competitors by voiceShare desc
    let entries = Array.from(deduped.values());
    entries.sort((a, b) => {
        if (a._isLead && !b._isLead) return -1;
        if (!a._isLead && b._isLead) return 1;
        return (b.voiceShare || 0) - (a.voiceShare || 0);
    });

    // Cap at 100
    entries = entries.slice(0, 100);

    // Remove internal fields
    return entries.map(e => {
        const { _dedupeKey, _isLead, ...rest } = e;
        return rest;
    });
}

function _buildIndexEntry(record, reportCity, reportState, isLead) {
    const rawName = (record.name || record.businessName || '').substring(0, 120);
    if (!rawName) return null;

    const normalized = normalizeName(rawName);
    if (!normalized) return null;

    const dedupeKey = `${normalized}|${reportCity}|${reportState}`;

    const reviews = parseInt(record.reviews || record.reviewCount || record.review_count) || 0;

    // Extract response rate and daysSinceLastReview from DataForSEO if available
    const responseRate = record.dataForSEO?.responseRate ?? record.responseRate ?? null;
    const lastReviewDaysAgo = record.dataForSEO?.daysSinceLastReview ?? record.daysSinceLastReview ?? null;

    // Intel signals — cap at 3, each ≤200 chars
    let intelSignals = [];
    if (record.intelSignal && typeof record.intelSignal === 'string') {
        intelSignals = record.intelSignal.split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 3)
            .map(s => s.substring(0, 200));
    }

    return {
        _dedupeKey: dedupeKey,
        _isLead:    isLead,
        normalizedName: normalized,
        rawName,
        city:            reportCity,
        state:           reportState,
        rating:          parseFloat(record.rating) || null,
        reviews,
        voiceShare:      parseFloat(record.shareOfVoice || record.voiceShare) || null,
        seoScore:        parseFloat(record.seoScore) || null,
        seoTier:         record.seoTier || null,
        responseRate:    responseRate != null ? parseFloat(responseRate) : null,
        lastReviewDaysAgo: lastReviewDaysAgo != null ? parseInt(lastReviewDaysAgo) : null,
        opportunityScore: isLead ? (parseInt(record.opportunityScore) || null) : null,
        intelSignals,
    };
}

// ── Match Prospect to Report ─────────────────────────────────────────────────

/**
 * Match a single prospect against a competitor index from a market report.
 *
 * @param {object} prospect — { name, city, state }
 * @param {object} reportMeta — { city, state } (report's location)
 * @param {Array} competitorIndex — capped index from resolveMarketContext
 * @returns {{ matched: object, matchType: 'exact'|'token' }|null}
 */
function matchProspectToReport(prospect, reportMeta, competitorIndex) {
    if (!prospect?.name || !Array.isArray(competitorIndex) || competitorIndex.length === 0) {
        return null;
    }

    const prospectNorm  = normalizeName(prospect.name);
    const prospectCity  = normalizeCity(prospect.city);
    const prospectState = normalizeCity(prospect.state);
    const reportCity    = normalizeCity(reportMeta?.city);
    const reportState   = normalizeCity(reportMeta?.state);

    if (!prospectNorm) return null;

    // Try exact match first
    for (const entry of competitorIndex) {
        if (entry.normalizedName === prospectNorm) {
            // CITY GUARD for exact matches:
            // Require same state
            if (prospectState && reportState && prospectState !== reportState) continue;

            // Same city → allowed
            if (prospectCity === reportCity) {
                return { matched: entry, matchType: 'exact' };
            }

            // Cross-city same-state: requires distinctive name
            if (isDistinctiveName(prospectNorm)) {
                return { matched: entry, matchType: 'exact' };
            }

            // Generic name cross-city → rejected
            continue;
        }
    }

    // Try token-set similarity ≥ 0.9
    // Token matches REQUIRE same city AND same state (strict geographic anchor)
    if (!prospectCity || prospectCity !== reportCity) {
        return null; // No token matches allowed cross-city
    }
    if (prospectState && reportState && prospectState !== reportState) {
        return null; // No token matches allowed cross-state
    }

    for (const entry of competitorIndex) {
        const sim = tokenSetSimilarity(prospectNorm, entry.normalizedName);
        if (sim >= 0.9) {
            // Substring guard: ensure neither is a strict substring of the other
            // (prevents "Automotive Service" matching "Automotive Service & Repair")
            if (prospectNorm !== entry.normalizedName) {
                const shorter = prospectNorm.length < entry.normalizedName.length ? prospectNorm : entry.normalizedName;
                const longer  = prospectNorm.length < entry.normalizedName.length ? entry.normalizedName : prospectNorm;
                if (longer.includes(shorter) && longer !== shorter) {
                    continue; // Substring trap — reject
                }
            }

            return { matched: entry, matchType: 'token' };
        }
    }

    return null;
}

module.exports = {
    resolveMarketContext,
    matchProspectToReport,
    // Exported for testing
    normalizeName,
    normalizeCity,
    tokenSetSimilarity,
    isDistinctiveName,
    _buildCompetitorIndex,
};
