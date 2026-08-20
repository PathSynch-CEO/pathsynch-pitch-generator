'use strict';

/**
 * evidencePainPoints.js — Story S2: evidence-derived pain points.
 *
 * Replaces the free-form Gemini "Top Pain Points" with template-bound claims computed
 * ONLY from values the report already produces. Each candidate renders ONLY when its
 * threshold fires and carries a provenance line stating its n ("Computed from 13
 * businesses"). When no threshold fires, `items` is empty and a single neutral line is
 * returned instead of filler.
 *
 * Pattern precedents: describePositioningQuadrant (PR #71 — deterministic template prose
 * with a neutral fallback) and buildZeroLeadSummary (PR #82 — never assert a claim whose
 * subject does not exist). No Gemini call. No em dashes in any output string.
 *
 * The aggregate math is shared with the deterministic Competitive Weaknesses builder
 * (services/competitiveWeaknesses.js) via canonicalReviewMedian() below, so a market produces
 * the SAME central review figure in the pain points, the weaknesses, the benchmarks/KPI, and the
 * sanitizer fallback. (S3/PR-C — replaced the former free-form Gemini generateWeaknessThemes.)
 */

// Bumped whenever the stored report grows a section that a pre-version stored report must
// NOT render (even partially). Old reports lack this field and read as v1. (D4.)
//   v2 (PR-B): evidence-derived pain points.
//   v3 (PR-C): Evidence Ledger + deterministic Competitive Weaknesses. The stamp is forward-only;
//              the frontend presence-gates today (no schemaVersion gate exists yet), so a stored v2
//              report keeps its v2 shape. A frontend gate on `>= 3` is the intended follow-up.
const REPORT_SCHEMA_VERSION = 3;

// A percentage claim over fewer than this many businesses is not trustworthy (the n=1
// "ranging from X to X" class). Below it, the metric is treated as unresolved: no claim.
const MIN_N = 3;

function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// Union of qualified leads + competitors, deduped by normalized name. This is the exact
// "analyzed set" the report scoped, so every count is defensible.
function dedupePopulation(leads, competitors) {
    const raw = [].concat(Array.isArray(leads) ? leads : [], Array.isArray(competitors) ? competitors : []);
    const seen = new Set();
    const out = [];
    for (const b of raw) {
        if (!b) continue;
        const key = normalizeName(b.name);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        out.push(b);
    }
    return out;
}

function collectPopulation(reportData) {
    const d = (reportData && reportData.data) || {};
    return dedupePopulation(d.leads, d.competitors);
}

// Review count for a business, 0 when absent (a business with no reviews is still part of the
// market and belongs in the median). Kept identical across every consumer so the figures agree.
function reviewCountOf(b) {
    return toInt(b && (b.reviewCount != null ? b.reviewCount : b.reviews)) || 0;
}

// The one median formula: lower-middle element, zeros included. Shared so no consumer can drift.
function medianReviewCount(population) {
    const counts = (population || []).map(reviewCountOf).sort((a, b) => a - b);
    return counts.length ? counts[Math.floor(counts.length / 2)] : 0;
}

/**
 * THE canonical market review median (N3/Q4). One population definition — deduped leads + competitors
 * — and one formula used by benchmarks (KPI + dominance), the weaknesses builder, the pain points, and
 * the sanitizer fallback, so a report never prints two different "market median" numbers.
 */
function canonicalReviewMedian(leads, competitors) {
    return medianReviewCount(dedupePopulation(leads, competitors));
}

// Deterministic aggregates. Every field is null unless it was positively measured, so a
// pain point can never fire on absent evidence.
function computePopulationAggregates(population) {
    const size = population.length;
    const reviewCounts = population.map(reviewCountOf);

    const sorted = reviewCounts.slice().sort((a, b) => a - b);
    const medianReviews = medianReviewCount(population); // canonical shared median
    const maxReviews = sorted.length ? sorted[sorted.length - 1] : 0;
    // Map-pack visibility threshold: max(30, canonical median).
    const reviewThreshold = Math.max(30, medianReviews);
    const pctBelowReviewThreshold = size > 0
        ? Math.round(reviewCounts.filter(r => r < reviewThreshold).length / size * 100)
        : null;

    const withWebsiteCount = population.filter(b => b.website || b.websiteUrl).length;
    const pctWithWebsite = size > 0 ? Math.round(withWebsiteCount / size * 100) : null;

    const withSEO = population.filter(b => toNum(b.seoScore) != null);
    const avgSEOScore = withSEO.length > 0
        ? Math.round(withSEO.reduce((s, b) => s + toNum(b.seoScore), 0) / withSEO.length)
        : null;

    // NOTE: review velocity / dormancy is deliberately NOT computed here. Per decision D3,
    // velocity is withheld-by-default until the velocity work lands: only the top-5 leads are
    // enriched and only 5 review timestamps persist per business, so daysSinceLastReview exists
    // for at most ~5 businesses. There is no depth guard that makes a velocity claim trustworthy
    // on that base, so no velocity pain point is emitted from this PR.

    return {
        size,
        medianReviews,
        maxReviews,
        reviewThreshold,
        pctBelowReviewThreshold,
        pctWithWebsite,
        avgSEOScore,
        seoMeasuredCount: withSEO.length
    };
}

// AI mention rate is directional (per the AI-Visibility Trust Rules) and lives on either
// aiVisibilityIntelligence or the SEO citation summary. Returns { rate, sampleNote } or null.
function resolveAiMentionRate(reportData) {
    const avi = reportData && reportData.aiVisibilityIntelligence;
    const seo = reportData && reportData.seoIntelligence && reportData.seoIntelligence.marketSummary;
    let raw = null;
    let note = 'directional AI-answer sample';
    if (avi && toNum(avi.mentionRate) != null) {
        raw = toNum(avi.mentionRate);
        if (avi.sampleNote) note = String(avi.sampleNote);
    } else if (seo && toNum(seo.avgMentionRate) != null) {
        raw = toNum(seo.avgMentionRate);
    }
    if (raw == null) return null;
    // Normalize a 0-1 fraction to a 0-100 percentage.
    const rate = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    return { rate, sampleNote: note };
}

const NEUTRAL_LINE =
    'No single measured weakness crossed the reporting threshold in this market. ' +
    'Prioritize prospects using the benchmark figures above rather than a blanket pain claim.';

/**
 * Build the evidence-derived pain section.
 * @param {object} reportData - the full report object (reportData), read-only.
 * @returns {{schemaVersion:number, computedCount:number, items:Array, neutralLine:string}}
 *   items: [{ id, claim, provenance, n, metric, value }] — only fired thresholds.
 */
function buildEvidencePainPoints(reportData) {
    const population = collectPopulation(reportData);
    const agg = computePopulationAggregates(population);
    const items = [];

    // 1. Website absence — a plurality with no website detected in search data.
    if (agg.size >= MIN_N && agg.pctWithWebsite != null) {
        const pctNoWebsite = 100 - agg.pctWithWebsite;
        if (pctNoWebsite >= 40) {
            const count = Math.round(pctNoWebsite / 100 * agg.size);
            items.push({
                id: 'website_absence',
                metric: 'pctNoWebsite',
                value: pctNoWebsite,
                n: agg.size,
                claim: `${pctNoWebsite}% have no website detected. ${count} of ${agg.size} analyzed businesses are absent from primary search channels.`,
                provenance: `Computed from ${agg.size} businesses`
            });
        }
    }

    // 2. Review threshold — a plurality below the map-pack visibility level.
    if (agg.size >= MIN_N && agg.pctBelowReviewThreshold != null && agg.pctBelowReviewThreshold >= 40) {
        const count = Math.round(agg.pctBelowReviewThreshold / 100 * agg.size);
        items.push({
            id: 'below_review_threshold',
            metric: 'pctBelowReviewThreshold',
            value: agg.pctBelowReviewThreshold,
            n: agg.size,
            claim: `${agg.pctBelowReviewThreshold}% sit below the review threshold. ${count} of ${agg.size} analyzed businesses fall under ${agg.reviewThreshold} reviews, the level where map-pack visibility drops off in this market.`,
            provenance: `Computed from ${agg.size} businesses`
        });
    }

    // 3. SEO distribution — market digital authority below the competitive line.
    if (agg.seoMeasuredCount >= MIN_N && agg.avgSEOScore != null && agg.avgSEOScore < 60) {
        items.push({
            id: 'weak_seo',
            metric: 'avgSEOScore',
            value: agg.avgSEOScore,
            n: agg.seoMeasuredCount,
            claim: `Market digital authority is weak. The average SEO score is ${agg.avgSEOScore} out of 100 across ${agg.seoMeasuredCount} measured businesses, below the 60 line for competitive local visibility.`,
            provenance: `Computed from ${agg.seoMeasuredCount} businesses`
        });
    }

    // 4. AI mention rate — directional. Fires when AI answers skip these businesses often.
    const ai = resolveAiMentionRate(reportData);
    if (ai && ai.rate < 70) {
        const skipPct = 100 - ai.rate;
        items.push({
            id: 'low_ai_mention',
            metric: 'aiMentionRate',
            value: ai.rate,
            n: null,
            claim: `AI answers skip these businesses ${skipPct}% of the time. Average mention rate is ${ai.rate}% across the sampled prompts, so AI-assisted discovery excludes them in a meaningful share of queries. Directional only.`,
            provenance: `Computed from a ${ai.sampleNote}`
        });
    }

    // 5. Leader dominance — discovery concentrates on a single name.
    if (agg.size >= MIN_N && agg.medianReviews > 0 && agg.maxReviews > 0) {
        const ratio = agg.maxReviews / agg.medianReviews;
        if (ratio >= 5) {
            items.push({
                id: 'leader_dominance',
                metric: 'leaderReviewRatio',
                value: Math.round(ratio * 10) / 10,
                n: agg.size,
                claim: `One player owns the conversation. The most-reviewed business holds ${agg.maxReviews} reviews versus a market median of ${agg.medianReviews}, a ${Math.round(ratio)}x gap that concentrates discovery on a single name.`,
                provenance: `Computed from ${agg.size} businesses`
            });
        }
    }

    // (Review velocity / dormancy pain point intentionally omitted — see D3 note in
    // computePopulationAggregates. It returns with the dedicated velocity work.)

    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        computedCount: population.length,
        items,
        neutralLine: NEUTRAL_LINE
    };
}

module.exports = {
    REPORT_SCHEMA_VERSION,
    MIN_N,
    NEUTRAL_LINE,
    buildEvidencePainPoints,
    computePopulationAggregates,
    collectPopulation,
    dedupePopulation,
    reviewCountOf,
    medianReviewCount,
    canonicalReviewMedian,
    resolveAiMentionRate
};
