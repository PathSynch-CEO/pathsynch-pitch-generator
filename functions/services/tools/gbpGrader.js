'use strict';

// ── GBP Grader ───────────────────────────────────────────────────────────────
//
// Grades a prospect's Google Business Profile completeness across 5 dimensions,
// each worth 20 points (total: 100). Returns a letter grade (A–F) and a
// dimension breakdown with a gradeBasis string explaining data availability.

/**
 * Grade a prospect's GBP completeness.
 *
 * @param {object} agentData — enrichment result from Cloud Run agent or Places fallback
 * @returns {{ score: number, grade: string, dimensions: Array, gradeBasis: string }}
 */
function gradeGBP(agentData) {
    if (!agentData || typeof agentData !== 'object') {
        return {
            score: 0,
            grade: 'F',
            dimensions: _emptyDimensions(),
            gradeBasis: 'No GBP data available',
        };
    }

    const dimensions = [];
    const dataSources = [];

    // 1. Rating (20 points)
    const rating = parseFloat(agentData.googleRating) || 0;
    let ratingScore = 0;
    if (rating > 0) {
        dataSources.push('rating');
        if (rating >= 4.5) ratingScore = 20;
        else if (rating >= 4.0) ratingScore = 16;
        else if (rating >= 3.5) ratingScore = 12;
        else if (rating >= 3.0) ratingScore = 8;
        else ratingScore = 4;
    }
    dimensions.push({
        name: 'Rating',
        score: ratingScore,
        maxScore: 20,
        detail: rating > 0 ? `${rating}★` : 'No rating',
    });

    // 2. Reviews (20 points)
    const reviews = parseInt(agentData.totalReviews) || 0;
    let reviewsScore = 0;
    if (reviews > 0) {
        dataSources.push('reviews');
        if (reviews >= 100) reviewsScore = 20;
        else if (reviews >= 50) reviewsScore = 16;
        else if (reviews >= 25) reviewsScore = 12;
        else if (reviews >= 10) reviewsScore = 8;
        else reviewsScore = 4;
    }
    dimensions.push({
        name: 'Reviews',
        score: reviewsScore,
        maxScore: 20,
        detail: reviews > 0 ? `${reviews} reviews` : 'No reviews',
    });

    // 3. Photos (20 points)
    const photoCount = parseInt(agentData.photoCount || agentData.photos) || 0;
    let photosScore = 0;
    if (photoCount > 0) {
        dataSources.push('photos');
        if (photoCount >= 20) photosScore = 20;
        else if (photoCount >= 10) photosScore = 16;
        else if (photoCount >= 5) photosScore = 12;
        else photosScore = 8;
    }
    dimensions.push({
        name: 'Photos',
        score: photosScore,
        maxScore: 20,
        detail: photoCount > 0 ? `${photoCount} photos` : 'No photos detected',
    });

    // 4. Info Completeness (20 points) — website + phone + address + hours
    let infoScore = 0;
    const infoFields = [];

    const hasWebsite = !!(agentData.websiteUrl && agentData.websiteUrl !== 'None' && agentData.websiteUrl !== '');
    if (hasWebsite) { infoScore += 5; infoFields.push('website'); }

    const hasPhone = !!(agentData.phone && agentData.phone !== 'None' && agentData.phone !== '');
    if (hasPhone) { infoScore += 5; infoFields.push('phone'); }

    const hasAddress = !!(agentData.address && (typeof agentData.address === 'string' ? agentData.address : agentData.address.city));
    if (hasAddress) { infoScore += 5; infoFields.push('address'); }

    const hasHours = !!(agentData.hours || agentData.openingHours || agentData.businessHours);
    if (hasHours) { infoScore += 5; infoFields.push('hours'); }

    if (infoFields.length > 0) dataSources.push('info');
    dimensions.push({
        name: 'Info Completeness',
        score: infoScore,
        maxScore: 20,
        detail: infoFields.length > 0 ? `Has: ${infoFields.join(', ')}` : 'No contact info detected',
    });

    // 5. Recency (20 points) — based on most recent review activity
    let recencyScore = 0;
    const daysSinceLast = _extractDaysSinceLastReview(agentData);
    if (daysSinceLast !== null) {
        dataSources.push('recency');
        if (daysSinceLast <= 7) recencyScore = 20;
        else if (daysSinceLast <= 30) recencyScore = 16;
        else if (daysSinceLast <= 60) recencyScore = 12;
        else if (daysSinceLast <= 90) recencyScore = 8;
        else recencyScore = 4;
    }
    dimensions.push({
        name: 'Recency',
        score: recencyScore,
        maxScore: 20,
        detail: daysSinceLast !== null ? `Last review ~${daysSinceLast} days ago` : 'Recency unknown',
    });

    // Total
    const score = dimensions.reduce((sum, d) => sum + d.score, 0);
    const grade = _letterGrade(score);
    const gradeBasis = dataSources.length > 0
        ? `Graded from: ${dataSources.join(', ')}`
        : 'No GBP data available';

    return { score, grade, dimensions, gradeBasis };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _letterGrade(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function _extractDaysSinceLastReview(agentData) {
    // Check pre-computed field first
    if (typeof agentData.daysSinceLastReview === 'number') {
        return agentData.daysSinceLastReview;
    }

    // Check DataForSEO enrichment
    if (agentData.dataForSEO?.daysSinceLastReview != null) {
        return parseInt(agentData.dataForSEO.daysSinceLastReview) || null;
    }

    // Check recent reviews array
    const recentReviews = agentData.recentReviews || agentData.dataForSEO?.recentReviews;
    if (Array.isArray(recentReviews) && recentReviews.length > 0) {
        for (const r of recentReviews) {
            const dateStr = r.date || r.datetime || r.time;
            if (dateStr) {
                const reviewDate = new Date(dateStr);
                if (!isNaN(reviewDate.getTime())) {
                    return Math.floor((Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24));
                }
            }
        }
    }

    return null;
}

function _emptyDimensions() {
    return [
        { name: 'Rating', score: 0, maxScore: 20, detail: 'No data' },
        { name: 'Reviews', score: 0, maxScore: 20, detail: 'No data' },
        { name: 'Photos', score: 0, maxScore: 20, detail: 'No data' },
        { name: 'Info Completeness', score: 0, maxScore: 20, detail: 'No data' },
        { name: 'Recency', score: 0, maxScore: 20, detail: 'No data' },
    ];
}

module.exports = {
    gradeGBP,
    // Exported for testing only
    _letterGrade,
    _extractDaysSinceLastReview,
};
