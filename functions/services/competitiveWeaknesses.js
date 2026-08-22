'use strict';

/**
 * competitiveWeaknesses.js — Story S3, Addition 1: the evidence gate's first consumer.
 *
 * Replaces the free-form Gemini generateWeaknessThemes() with deterministic, template-bound weakness
 * themes derived ONLY from values the report already computed. Every theme states its n; a candidate
 * whose underlying metric was never measured is WITHHELD (recorded, never hedged), never rendered as
 * "they likely struggle." No Gemini call, so no hedging phrase can reach output by construction.
 *
 * This closes three defects observed in production (2026-08-19):
 *   1. Numbering gap (1,2,3,5): the old path preserved Gemini-assigned `rank` and dropped filtered
 *      items, leaving a visible hole. Here ranks are assigned sequentially AFTER filtering, always 1..n.
 *   2. "Unknown average SEO score" printed next to an 87/100 SEO Landscape: the old aggregate read a
 *      `seoScore` field that is null on lead/competitor objects. Here the SEO weakness reads the SAME
 *      source the SEO Landscape prints (data.seoLandscape.avgSEOScore), so the two can never disagree.
 *   3. Review-count / satisfaction conflation: themes speak strictly to VISIBILITY and PRESENCE
 *      (map-pack threshold, digital authority, response rate), never to customer satisfaction.
 *
 * Pattern precedents: evidencePainPoints.js (S2), describePositioningQuadrant (PR #71),
 * buildZeroLeadSummary (PR #82). No em dashes in any output string.
 */

const {
    REPORT_SCHEMA_VERSION,
    MIN_N,
    DORMANT_REVIEW_DAYS,
    collectPopulation,
    medianReviewCount,
    resolveAiMentionRate,
    daysSinceLastReviewOf
} = require('./evidencePainPoints');

// Platform-default thresholds. A question pack may override any subset per vertical
// (resolvePainThresholds in questionPacks.js); a null pack yields exactly these, which are the
// values the pre-pack report already used, preserving byte-identical output for pack-less subs.
const DEFAULT_PAIN_THRESHOLDS = {
    noWebsitePct: 40,            // >= this share with no website detected is a presence weakness
    belowReviewThresholdPct: 40, // >= this share below the map-pack review threshold
    avgSeoScore: 60,             // market SEO authority below this is a digital-authority weakness
    lowResponseRatePct: 30,      // average review response rate below this is an engagement weakness
    velocityStalledPct: 40,      // >= this share with no review in 90+ days is a dormancy weakness
    leaderReviewRatio: 5         // leader reviews >= this multiple of the median concentrates discovery
};

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

/**
 * Resolve the market SEO authority from the SAME field the SEO Landscape section renders, so a
 * weakness claim and the SEO Landscape can never print two different numbers. Returns null (not 0)
 * when SEO was not measured, so the gate withholds rather than asserting an "unknown" score.
 */
function resolveMarketSeoScore(reportData) {
    const seo = reportData && reportData.data && reportData.data.seoLandscape;
    if (!seo) return null;
    const v = toNum(seo.avgSEOScore != null ? seo.avgSEOScore : seo.marketAvgScore);
    return v != null && v > 0 ? Math.round(v) : null;
}

/**
 * Deterministic aggregates over the analyzed set (qualified leads + competitors, deduped). Every
 * field is null unless positively measured, so a weakness can never fire on absent evidence.
 */
function computeWeaknessAggregates(reportData) {
    const population = collectPopulation(reportData);
    const size = population.length;

    const reviewCounts = population.map(b => toInt(b.reviewCount != null ? b.reviewCount : b.reviews) || 0);
    const sorted = reviewCounts.slice().sort((a, b) => a - b);
    const medianReviews = medianReviewCount(population); // canonical shared median (N3/Q4)
    const maxReviews = sorted.length ? sorted[sorted.length - 1] : 0;
    const reviewThreshold = Math.max(30, medianReviews);
    const pctBelowReviewThreshold = size > 0
        ? Math.round(reviewCounts.filter(r => r < reviewThreshold).length / size * 100)
        : null;

    const withWebsite = population.filter(b => b.website || b.websiteUrl).length;
    const pctWithWebsite = size > 0 ? Math.round(withWebsite / size * 100) : null;

    const withResponseRate = population.filter(b => b.responseRate != null && Number.isFinite(toNum(b.responseRate)));
    const avgResponseRate = withResponseRate.length > 0
        ? Math.round(withResponseRate.reduce((s, b) => s + toNum(b.responseRate), 0) / withResponseRate.length)
        : null;

    // Shared recency extractor (evidencePainPoints.daysSinceLastReviewOf) — reads the nested
    // dataForSEO.recentReviews timestamps / dataForSEO.daysSinceLastReview first. The old inline
    // filter read only a TOP-LEVEL daysSinceLastReview that production enrichment never sets
    // (it nests everything under dataForSEO), so this aggregate silently never fired on real
    // reports. Boundary unified with the enrichment's velocityStatus classifier (dormant at
    // >= DORMANT_REVIEW_DAYS) — the two consumers can no longer disagree about who is dormant.
    const daysSince = population.map(b => daysSinceLastReviewOf(b)).filter(d => d != null);
    const pctVelocityStalled = daysSince.length > 0
        ? Math.round(daysSince.filter(d => d >= DORMANT_REVIEW_DAYS).length / daysSince.length * 100)
        : null;

    return {
        size,
        medianReviews,
        maxReviews,
        reviewThreshold,
        pctBelowReviewThreshold,
        pctWithWebsite,
        avgResponseRate,
        responseRateN: withResponseRate.length,
        pctVelocityStalled,
        velocityN: daysSince.length,
        avgSeoScore: resolveMarketSeoScore(reportData)
    };
}

const NEUTRAL_LINE =
    'No competitive weakness crossed the reporting threshold across the analyzed businesses in this market. ' +
    'Prioritize prospects from the benchmark and lead figures rather than a blanket weakness claim.';

/**
 * Build the deterministic Competitive Weaknesses section.
 *
 * @param {object} reportData - full report object (read-only)
 * @param {object} thresholds - effective pain thresholds (pack-resolved or DEFAULT_PAIN_THRESHOLDS)
 * @returns {{schemaVersion:number, n:number, packVersion:string|null, items:Array, withheld:Array, neutralLine:string}}
 *   items:    fired weaknesses, ranked 1..n with no gaps: { rank, id, theme, whyItMatters, metric, value, n, provenance }
 *   withheld: candidates whose metric was not measured this run: { id, label, reason } (recorded, never hedged)
 */
function buildWeaknessThemes(reportData, thresholds) {
    const t = Object.assign({}, DEFAULT_PAIN_THRESHOLDS, thresholds || {});
    const agg = computeWeaknessAggregates(reportData);
    const items = [];
    const withheld = [];

    const tooSmall = agg.size < MIN_N;

    // 1. Website absence — presence weakness (never satisfaction).
    if (agg.pctWithWebsite == null || tooSmall) {
        withheld.push({ id: 'website_absence', label: 'Website presence', reason: tooSmall
            ? `Only ${agg.size} businesses analyzed, below the minimum of ${MIN_N} for a market-wide percentage.`
            : 'Website presence was not measured for the analyzed businesses.' });
    } else {
        const pctNoWebsite = 100 - agg.pctWithWebsite;
        if (pctNoWebsite >= t.noWebsitePct) {
            const count = Math.round(pctNoWebsite / 100 * agg.size);
            items.push({
                id: 'website_absence', metric: 'pctNoWebsite', value: pctNoWebsite, n: agg.size,
                theme: `${pctNoWebsite}% of analyzed businesses have no website detected. ${count} of ${agg.size} analyzed businesses are absent from primary search channels.`,
                whyItMatters: 'These businesses are unreachable through organic and AI search, so an outbound opener can lead with the visibility gap.',
                provenance: `Computed from ${agg.size} businesses`
            });
        }
    }

    // 2. Below the map-pack review threshold — VISIBILITY, not quality.
    if (agg.pctBelowReviewThreshold == null || tooSmall) {
        withheld.push({ id: 'below_review_threshold', label: 'Map-pack review threshold', reason: tooSmall
            ? `Only ${agg.size} businesses analyzed, below the minimum of ${MIN_N}.`
            : 'Review counts were not available for the analyzed businesses.' });
    } else if (agg.pctBelowReviewThreshold >= t.belowReviewThresholdPct) {
        const count = Math.round(agg.pctBelowReviewThreshold / 100 * agg.size);
        items.push({
            id: 'below_review_threshold', metric: 'pctBelowReviewThreshold', value: agg.pctBelowReviewThreshold, n: agg.size,
            theme: `${agg.pctBelowReviewThreshold}% sit below the map-pack review threshold. ${count} of ${agg.size} analyzed businesses fall under ${agg.reviewThreshold} reviews, the level where map-pack visibility drops off in this market.`,
            whyItMatters: 'Below-threshold businesses are losing the local pack to higher-volume rivals, a concrete review-generation wedge.',
            provenance: `Computed from ${agg.size} businesses`
        });
    }

    // 3. Weak market SEO / digital authority — read from the SAME source SEO Landscape prints.
    if (agg.avgSeoScore == null) {
        withheld.push({ id: 'weak_seo', label: 'Digital authority (SEO)', reason: 'SEO Landscape did not resolve a market score this run.' });
    } else if (agg.avgSeoScore < t.avgSeoScore) {
        items.push({
            id: 'weak_seo', metric: 'avgSeoScore', value: agg.avgSeoScore, n: null,
            theme: `Market digital authority is weak. The SEO Landscape averages ${agg.avgSeoScore} out of 100 across this market, below the ${t.avgSeoScore} line for competitive local visibility.`,
            whyItMatters: 'A low market SEO floor means a modest optimization lift can move a prospect ahead of the field.',
            provenance: 'Computed from the SEO Landscape aggregate'
        });
    }
    // avgSeoScore >= threshold: measured and healthy — not a weakness, nothing emitted (no hedge).

    // 4. Low review-response engagement.
    if (agg.avgResponseRate == null) {
        withheld.push({ id: 'low_response_rate', label: 'Review response rate', reason: 'Review response rate was not measured for the analyzed businesses.' });
    } else if (agg.avgResponseRate < t.lowResponseRatePct) {
        items.push({
            id: 'low_response_rate', metric: 'avgResponseRate', value: agg.avgResponseRate, n: agg.responseRateN,
            theme: `Review responses are largely unanswered. The average response rate is ${agg.avgResponseRate}% across ${agg.responseRateN} measured businesses.`,
            whyItMatters: 'Unanswered reviews are a public trust signal left on the table, an immediate reputation-management opening.',
            provenance: `Computed from ${agg.responseRateN} businesses`
        });
    }

    // 5. Stalled review velocity (dormancy) — measured across the enriched subset only.
    if (agg.pctVelocityStalled == null) {
        withheld.push({ id: 'velocity_stalled', label: 'Review velocity', reason: 'Review timestamps were not available at sufficient depth to measure dormancy.' });
    } else if (agg.pctVelocityStalled >= t.velocityStalledPct) {
        items.push({
            id: 'velocity_stalled', metric: 'pctVelocityStalled', value: agg.pctVelocityStalled, n: agg.velocityN,
            theme: `${agg.pctVelocityStalled}% have gone quiet. That share of ${agg.velocityN} measured businesses has not received a review in 90+ days.`,
            whyItMatters: 'A stalled review engine is a reactivation wedge before a competitor fills the gap.',
            provenance: `Computed from ${agg.velocityN} businesses`
        });
    }

    // 6. Leader dominance — discovery concentrates on a single name (uses the ROBUST median, not the
    //    outlier-skewed mean; the median vs mean split is Addition 2).
    if (tooSmall || !(agg.medianReviews > 0 && agg.maxReviews > 0)) {
        withheld.push({ id: 'leader_dominance', label: 'Discovery concentration', reason: tooSmall
            ? `Only ${agg.size} businesses analyzed, below the minimum of ${MIN_N}.`
            : 'Review distribution was not measurable for the analyzed businesses.' });
    } else {
        const ratio = agg.maxReviews / agg.medianReviews;
        if (ratio >= t.leaderReviewRatio) {
            items.push({
                id: 'leader_dominance', metric: 'leaderReviewRatio', value: Math.round(ratio * 10) / 10, n: agg.size,
                theme: `One player owns the conversation. The most-reviewed business holds ${agg.maxReviews} reviews versus a market median of ${agg.medianReviews}, a ${Math.round(ratio)}x gap that concentrates discovery on a single name.`,
                whyItMatters: 'The long tail is invisible next to the leader, so review volume is the lever that reshapes local discovery.',
                provenance: `Computed from ${agg.size} businesses`
            });
        }
    }

    // Assign contiguous ranks AFTER filtering. This is the fix for the 1,2,3,5 numbering gap: rank is
    // never carried from a generator, so a dropped candidate can never leave a hole.
    items.forEach((it, i) => { it.rank = i + 1; });

    const packVersion = (thresholds && thresholds._packVersion) || null;

    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        n: agg.size,
        packVersion,
        items,
        withheld,
        neutralLine: NEUTRAL_LINE
    };
}

module.exports = {
    DEFAULT_PAIN_THRESHOLDS,
    NEUTRAL_LINE,
    buildWeaknessThemes,
    computeWeaknessAggregates,
    resolveMarketSeoScore
};
