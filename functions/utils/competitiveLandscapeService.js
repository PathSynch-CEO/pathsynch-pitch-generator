'use strict';

/**
 * Competitive Landscape Service
 *
 * Builds a structured side-by-side competitive matrix (prospect vs top 10 competitors).
 * Pure functions — no async, no Firestore, no AI.
 *
 * Feeds into:
 *   1. scoreCompetitivePressure() in opportunityScoreEngine.js (via buildEnrichmentData)
 *   2. competitiveGapNarrative.js (AI narrative layer)
 *   3. Frontend renderCompetitiveLandscape()
 */

/**
 * Calculate threat level of a competitor relative to the prospect.
 * @param {Object} competitor
 * @param {Object} prospect
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
function calculateThreatLevel(competitor, prospect) {
    const compRating = parseFloat(competitor.rating) || 0;
    const compReviews = parseInt(competitor.reviewCount || competitor.reviews) || 0;
    const prospRating = parseFloat(prospect.rating) || 0;
    const prospReviews = parseInt(prospect.reviewCount || prospect.reviews) || 0;

    const ratingDelta = compRating - prospRating;
    const reviewRatio = prospReviews > 0
        ? compReviews / prospReviews
        : (compReviews > 0 ? 999 : 0);

    // HIGH: clearly outperforms on multiple dimensions or dominant review volume
    if (ratingDelta >= 0.5 && reviewRatio >= 2) return 'HIGH';
    if (ratingDelta >= 0.3 && reviewRatio >= 3) return 'HIGH';
    if (reviewRatio >= 5) return 'HIGH';
    if (ratingDelta >= 0.7) return 'HIGH';

    // MEDIUM: meaningful advantage on one dimension
    if (ratingDelta >= 0.3 || reviewRatio >= 1.5) return 'MEDIUM';
    if (ratingDelta >= 0.1 && reviewRatio >= 1.2) return 'MEDIUM';

    return 'LOW';
}

/**
 * Estimate GBP completeness score (0-100) from available data fields.
 * @param {Object} biz
 * @returns {number}
 */
function calculateGBPScore(biz) {
    let score = 0;
    if (biz.name) score += 15;
    if ((parseFloat(biz.rating) || 0) > 0) score += 20;
    if ((parseInt(biz.reviewCount || biz.reviews) || 0) > 0) score += 20;
    if (biz.website) score += 25;
    if (biz.address || (biz.location && (biz.location.address || typeof biz.location === 'string'))) score += 20;
    return score;
}

/**
 * Estimate review velocity category from review count (used as accumulation proxy).
 * @param {number} reviewCount
 * @returns {'high'|'moderate'|'low'|'unknown'}
 */
function calculateVelocity(reviewCount) {
    if (!reviewCount || reviewCount === 0) return 'unknown';
    if (reviewCount >= 200) return 'high';
    if (reviewCount >= 50) return 'moderate';
    return 'low';
}

/**
 * Calculate what percentile `value` falls among `allValues` (0-100, higher = better rank).
 * @param {number} value
 * @param {number[]} allValues
 * @returns {number}
 */
function calculatePercentile(value, allValues) {
    if (!allValues || allValues.length === 0) return 50;
    const below = allValues.filter(v => v < value).length;
    return Math.round((below / allValues.length) * 100);
}

/**
 * Build the competitive landscape matrix.
 *
 * @param {Object} prospectData - { name, rating, reviewCount/reviews, website, address, ... }
 * @param {Array}  competitors  - array from market.js pipeline
 * @returns {Object} landscape
 */
function buildCompetitiveLandscape(prospectData, competitors) {
    if (!competitors || competitors.length === 0) {
        return {
            status: 'empty',
            competitorCount: 0,
            prospect: null,
            matrix: [],
            prospectPosition: null,
            gapAnalysis: null
        };
    }

    const top10 = competitors.slice(0, 10);
    const prospRating = parseFloat(prospectData.rating) || 0;
    const prospReviews = parseInt(prospectData.reviewCount || prospectData.reviews) || 0;

    // Build matrix rows
    const matrix = top10.map(c => {
        const compRating = parseFloat(c.rating) || 0;
        const compReviews = parseInt(c.reviewCount || c.reviews) || 0;
        const threatLevel = calculateThreatLevel(c, prospectData);
        const ratingDelta = parseFloat((compRating - prospRating).toFixed(2));
        const reviewRatio = prospReviews > 0
            ? parseFloat((compReviews / prospReviews).toFixed(2))
            : null;

        return {
            name: c.name || 'Unknown',
            rating: compRating,
            reviewCount: compReviews,
            website: !!(c.website),
            address: c.address || null,
            threatLevel,
            ratingDelta,
            reviewRatio,
            velocity: calculateVelocity(compReviews),
            gbpScore: calculateGBPScore(c)
        };
    });

    // Prospect position analytics
    const allRatings = top10.map(c => parseFloat(c.rating) || 0).filter(r => r > 0);
    const allReviews = top10.map(c => parseInt(c.reviewCount || c.reviews) || 0).filter(r => r > 0);

    const ratingPercentile = calculatePercentile(prospRating, allRatings);
    const reviewPercentile = calculatePercentile(prospReviews, allReviews);
    const ratingRank = top10.filter(c => (parseFloat(c.rating) || 0) > prospRating).length + 1;
    const reviewRank = top10.filter(c => (parseInt(c.reviewCount || c.reviews) || 0) > prospReviews).length + 1;

    const highThreats = matrix.filter(r => r.threatLevel === 'HIGH').length;
    const mediumThreats = matrix.filter(r => r.threatLevel === 'MEDIUM').length;

    const prospect = {
        name: prospectData.name || 'Prospect',
        rating: prospRating,
        reviewCount: prospReviews,
        website: !!(prospectData.website),
        gbpScore: calculateGBPScore(prospectData),
        ratingPercentile,
        reviewPercentile
    };

    const prospectPosition = {
        ratingRank,
        reviewRank,
        ratingPercentile,
        reviewPercentile,
        highThreats,
        mediumThreats,
        totalAnalyzed: top10.length
    };

    return {
        status: 'active',
        competitorCount: top10.length,
        prospect,
        matrix,
        prospectPosition,
        gapAnalysis: null
    };
}

module.exports = {
    buildCompetitiveLandscape,
    calculateThreatLevel,
    calculateGBPScore,
    calculateVelocity,
    calculatePercentile
};
