'use strict';

/**
 * usaspendingService.js — USAspending enrichment for gov opportunities.
 *
 * Builds awardContext from similar awards and top recipients.
 * Cache-first via govAwardCache (30d TTL).
 * Never throws — returns null on failure.
 */

const admin  = require('firebase-admin');
const crypto = require('crypto');
const { searchSimilarAwards, searchTopRecipients } = require('./usaspendingClient');

const CACHE_TTL_DAYS = 30;

// ── Cache Key ────────────────────────────────────────────────────────────────

function buildCacheKey(agencyName, naicsCode, fiscalYear) {
    const input = `${(agencyName || '').toLowerCase().trim()}:${naicsCode || ''}:${fiscalYear || ''}`;
    return crypto.createHash('sha1').update(input).digest('hex');
}

// ── Cache Read/Write ─────────────────────────────────────────────────────────

async function _getCached(db, cacheKey) {
    try {
        const doc = await db.collection('govAwardCache').doc(cacheKey).get();
        if (!doc.exists) return null;

        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

        if (ageDays > CACHE_TTL_DAYS) return null; // Expired
        return data.awardContext || null;
    } catch (err) {
        console.warn('[USAspending] Cache read error:', err.message);
        return null;
    }
}

async function _writeCache(db, cacheKey, awardContext) {
    try {
        await db.collection('govAwardCache').doc(cacheKey).set({
            cacheKey,
            awardContext,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.warn('[USAspending] Cache write error:', err.message);
    }
}

// ── Enrichment ───────────────────────────────────────────────────────────────

/**
 * Enrich an opportunity with USAspending award context.
 *
 * @param {object} opportunity — normalized GovOpportunity
 * @param {object} profile — GovProfile
 * @returns {Promise<object|null>} — awardContext or null
 */
async function enrichWithAwardContext(opportunity, profile) {
    try {
        // Determine lookup params
        const naicsCode  = (opportunity.naicsCodes || [])[0]
            || (profile.credentials?.naicsCodes || [])[0]
            || null;
        const agencyName = opportunity.agencyName || opportunity.departmentName || null;

        if (!naicsCode && !agencyName) {
            console.log('[USAspending] Insufficient data for enrichment (no NAICS or agency)');
            return null;
        }

        const fy       = _currentFY();
        const cacheKey = buildCacheKey(agencyName, naicsCode, fy);
        const db       = admin.firestore();

        // Cache check
        const cached = await _getCached(db, cacheKey);
        if (cached) {
            console.log(`[USAspending] Cache HIT for ${cacheKey}`);
            return cached;
        }

        // Fetch similar awards
        const awardsResult = await searchSimilarAwards({ naicsCode, agencyName, fiscalYear: fy });
        const awards = awardsResult.success ? (awardsResult.data?.awards || []) : [];

        // Fetch top recipients
        const recipientsResult = await searchTopRecipients({ naicsCode, agencyName, fiscalYear: fy });
        const recipients = recipientsResult.success ? (recipientsResult.data?.recipients || []) : [];

        // Build awardContext
        const totalValue = awards.reduce((sum, a) => sum + (a.awardAmount || 0), 0);
        const avgValue   = awards.length > 0 ? Math.round(totalValue / awards.length) : 0;

        // Dedupe incumbent vendors
        const vendorNames = new Set();
        for (const r of recipients) {
            if (r.name) vendorNames.add(r.name);
        }
        for (const a of awards) {
            if (a.recipientName) vendorNames.add(a.recipientName);
        }

        // Top agencies
        const agencies = new Set();
        for (const a of awards) {
            if (a.awardingAgency) agencies.add(a.awardingAgency);
        }

        // Most recent award date
        let lastAwardDate = null;
        for (const a of awards) {
            if (a.startDate) {
                const d = new Date(a.startDate);
                if (!isNaN(d.getTime()) && (!lastAwardDate || d > lastAwardDate)) {
                    lastAwardDate = d;
                }
            }
        }

        // Check past performance relevance against profile
        const pastPerformanceRelevant = _checkPastPerformanceRelevance(
            profile, agencyName, Array.from(agencies)
        );

        const awardContext = {
            similarAwardsFound:     awards.length > 0,
            incumbentVendors:       Array.from(vendorNames).slice(0, 10),
            similarAwardCount:      awardsResult.data?.totalCount || awards.length,
            totalSimilarAwardValue: totalValue,
            avgAwardValue:          avgValue,
            topAgencies:            Array.from(agencies).slice(0, 5),
            lastAwardDate:          lastAwardDate ? lastAwardDate.toISOString() : null,
            pastPerformanceRelevant,
            confidence:             awards.length >= 5 ? 'high' : awards.length >= 1 ? 'medium' : 'low',
            enrichedAt:             new Date().toISOString(),
        };

        // Write cache
        await _writeCache(db, cacheKey, awardContext);

        console.log(`[USAspending] Enriched: ${awards.length} awards, ${vendorNames.size} vendors, confidence=${awardContext.confidence}`);
        return awardContext;

    } catch (err) {
        console.error('[USAspending] Enrichment error (non-blocking):', err.message);
        return null;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _currentFY() {
    const now = new Date();
    return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function _checkPastPerformanceRelevance(profile, agencyName, topAgencies) {
    const pastPerf = profile.credentials?.pastPerformance || [];
    if (pastPerf.length === 0) return false;

    // Check if any past performance client overlaps with the awarding agencies
    const agencyLower = (agencyName || '').toLowerCase();
    const allAgencies = topAgencies.map(a => a.toLowerCase());

    for (const pp of pastPerf) {
        const clientLower = (pp.client || '').toLowerCase();
        if (agencyLower && clientLower.includes(agencyLower)) return true;
        if (allAgencies.some(a => a.includes(clientLower) || clientLower.includes(a))) return true;
    }

    return false;
}

module.exports = {
    enrichWithAwardContext,
    buildCacheKey,
    CACHE_TTL_DAYS,
};
