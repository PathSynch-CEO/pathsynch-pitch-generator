/**
 * Review Analytics Service
 *
 * Analyzes Google reviews to generate compelling metrics for pitches
 * Includes volume/velocity, rating quality/stability, and response performance
 */

/**
 * Parse reviews from text input (pasted from Google)
 * Expected format: blocks of text separated by double newlines
 *
 * @param {string} reviewText - Raw review text
 * @returns {Array} Parsed review objects
 */
function parseReviews(reviewText) {
    if (!reviewText || typeof reviewText !== 'string') {
        return [];
    }

    const reviews = [];
    const blocks = reviewText.split(/\n\n+/).filter(b => b.trim().length > 20);

    blocks.forEach((block, index) => {
        const review = {
            id: index + 1,
            text: block.trim(),
            rating: null,
            date: null,
            hasOwnerResponse: false,
            ownerResponseText: null
        };

        // Try to extract rating (look for star patterns)
        const starMatch = block.match(/(\d)\s*star|(\d)\/5|rating[:\s]*(\d)/i);
        if (starMatch) {
            review.rating = parseInt(starMatch[1] || starMatch[2] || starMatch[3]);
        } else {
            // Infer rating from sentiment
            review.rating = inferRatingFromSentiment(block);
        }

        // Try to extract date
        const dateMatch = block.match(/(\d{1,2})\s*(day|week|month|year)s?\s*ago/i);
        if (dateMatch) {
            review.date = parseDateFromRelative(dateMatch[1], dateMatch[2]);
        } else {
            const absoluteDate = block.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
            if (absoluteDate) {
                review.date = new Date(absoluteDate[1]);
            }
        }

        // Check for owner response
        if (block.toLowerCase().includes('response from') ||
            block.toLowerCase().includes('owner response') ||
            block.toLowerCase().includes('replied')) {
            review.hasOwnerResponse = true;
        }

        reviews.push(review);
    });

    return reviews;
}

/**
 * Infer rating from review sentiment
 */
function inferRatingFromSentiment(text) {
    const lowerText = text.toLowerCase();

    const positiveWords = ['amazing', 'excellent', 'great', 'wonderful', 'fantastic', 'love', 'best', 'awesome', 'perfect', 'outstanding'];
    const negativeWords = ['terrible', 'awful', 'horrible', 'worst', 'bad', 'poor', 'disappointing', 'never again', 'avoid', 'rude'];
    const neutralWords = ['okay', 'ok', 'fine', 'average', 'decent'];

    let positiveScore = positiveWords.filter(w => lowerText.includes(w)).length;
    let negativeScore = negativeWords.filter(w => lowerText.includes(w)).length;
    let neutralScore = neutralWords.filter(w => lowerText.includes(w)).length;

    if (negativeScore > positiveScore) return Math.max(1, 3 - negativeScore);
    if (positiveScore > negativeScore + neutralScore) return Math.min(5, 4 + (positiveScore > 2 ? 1 : 0));
    if (neutralScore > 0) return 3;
    return 4; // Default to 4 if unclear
}

/**
 * Parse relative date string
 */
function parseDateFromRelative(amount, unit) {
    const now = new Date();
    const num = parseInt(amount);

    switch (unit.toLowerCase()) {
        case 'day':
            return new Date(now.setDate(now.getDate() - num));
        case 'week':
            return new Date(now.setDate(now.getDate() - (num * 7)));
        case 'month':
            return new Date(now.setMonth(now.getMonth() - num));
        case 'year':
            return new Date(now.setFullYear(now.getFullYear() - num));
        default:
            return null;
    }
}

/**
 * Calculate volume and velocity metrics
 *
 * @param {Array} reviews - Parsed review objects
 * @returns {Object} Volume/velocity metrics
 */
function calculateVolumeVelocity(reviews) {
    const now = new Date();
    const reviewsWithDates = reviews.filter(r => r.date);

    // Reviews per time period
    const last7Days = reviewsWithDates.filter(r => (now - r.date) / (1000 * 60 * 60 * 24) <= 7).length;
    const last30Days = reviewsWithDates.filter(r => (now - r.date) / (1000 * 60 * 60 * 24) <= 30).length;
    const prior30Days = reviewsWithDates.filter(r => {
        const daysAgo = (now - r.date) / (1000 * 60 * 60 * 24);
        return daysAgo > 30 && daysAgo <= 60;
    }).length;

    // Velocity change
    const velocityChange = prior30Days > 0
        ? Math.round(((last30Days - prior30Days) / prior30Days) * 100)
        : (last30Days > 0 ? 100 : 0);

    // Days since last review
    const sortedByDate = [...reviewsWithDates].sort((a, b) => b.date - a.date);
    const daysSinceLastReview = sortedByDate.length > 0
        ? Math.floor((now - sortedByDate[0].date) / (1000 * 60 * 60 * 24))
        : null;

    // Monthly average
    const oldestReview = sortedByDate[sortedByDate.length - 1];
    const monthsOfData = oldestReview
        ? Math.max(1, Math.ceil((now - oldestReview.date) / (1000 * 60 * 60 * 24 * 30)))
        : 1;
    const reviewsPerMonth = Math.round((reviews.length / monthsOfData) * 10) / 10;

    // Review streak (weeks with at least 1 review)
    let currentStreak = 0;
    let maxStreak = 0;
    let tempStreak = 0;

    for (let i = 0; i < 52; i++) {
        const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        const hasReview = reviewsWithDates.some(r => r.date >= weekStart && r.date < weekEnd);

        if (hasReview) {
            tempStreak++;
            if (i === 0) currentStreak = tempStreak;
        } else {
            maxStreak = Math.max(maxStreak, tempStreak);
            tempStreak = 0;
        }
    }
    maxStreak = Math.max(maxStreak, tempStreak);

    return {
        totalReviews: reviews.length,
        last7Days,
        last30Days,
        prior30Days,
        velocityChange,
        velocityTrend: velocityChange > 10 ? 'accelerating' : velocityChange < -10 ? 'slowing' : 'stable',
        daysSinceLastReview,
        isStale: daysSinceLastReview > 30,
        reviewsPerMonth,
        currentStreak,
        maxStreak
    };
}

/**
 * Calculate rating quality and stability metrics
 *
 * @param {Array} reviews - Parsed review objects
 * @returns {Object} Rating quality metrics
 */
function calculateRatingQuality(reviews) {
    const reviewsWithRatings = reviews.filter(r => r.rating != null);

    if (reviewsWithRatings.length === 0) {
        return {
            averageRating: null,
            weightedRating: null,
            distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
            lowRatingRate: 0,
            volatility: 0,
            trendSlope: 0,
            trendDirection: 'stable'
        };
    }

    // Average rating
    const ratings = reviewsWithRatings.map(r => r.rating);
    const averageRating = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100;

    // Weighted rating (recent reviews count more)
    const now = new Date();
    let weightedSum = 0;
    let weightTotal = 0;

    reviewsWithRatings.forEach(r => {
        const daysAgo = r.date ? (now - r.date) / (1000 * 60 * 60 * 24) : 180;
        const weight = Math.exp(-daysAgo / 90); // Exponential decay over 90 days
        weightedSum += r.rating * weight;
        weightTotal += weight;
    });

    const weightedRating = weightTotal > 0
        ? Math.round((weightedSum / weightTotal) * 100) / 100
        : averageRating;

    // Rating distribution
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    ratings.forEach(r => {
        if (distribution[r] !== undefined) distribution[r]++;
    });

    // Percentages
    const distributionPct = {};
    Object.keys(distribution).forEach(k => {
        distributionPct[k] = Math.round((distribution[k] / ratings.length) * 100);
    });

    // Low rating rate (<=3 stars)
    const lowRatings = ratings.filter(r => r <= 3).length;
    const lowRatingRate = Math.round((lowRatings / ratings.length) * 100);

    // Volatility (std dev)
    const mean = averageRating;
    const variance = ratings.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / ratings.length;
    const volatility = Math.round(Math.sqrt(variance) * 100) / 100;

    // Trend slope (simple linear regression)
    const reviewsWithDates = reviewsWithRatings.filter(r => r.date).sort((a, b) => a.date - b.date);
    let trendSlope = 0;
    let trendDirection = 'stable';

    if (reviewsWithDates.length >= 3) {
        const n = reviewsWithDates.length;
        const xValues = reviewsWithDates.map((_, i) => i);
        const yValues = reviewsWithDates.map(r => r.rating);

        const xMean = xValues.reduce((a, b) => a + b, 0) / n;
        const yMean = yValues.reduce((a, b) => a + b, 0) / n;

        let numerator = 0;
        let denominator = 0;

        for (let i = 0; i < n; i++) {
            numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
            denominator += Math.pow(xValues[i] - xMean, 2);
        }

        trendSlope = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
        trendDirection = trendSlope > 0.05 ? 'improving' : trendSlope < -0.05 ? 'declining' : 'stable';
    }

    return {
        averageRating,
        weightedRating,
        distribution,
        distributionPct,
        lowRatingRate,
        volatility,
        isConsistent: volatility < 0.8,
        trendSlope,
        trendDirection
    };
}

/**
 * Calculate response performance metrics
 *
 * @param {Array} reviews - Parsed review objects
 * @returns {Object} Response performance metrics
 */
function calculateResponsePerformance(reviews) {
    const total = reviews.length;
    const withResponse = reviews.filter(r => r.hasOwnerResponse).length;
    const responseRate = total > 0 ? Math.round((withResponse / total) * 100) : 0;

    // Negative reviews without response
    const negativeReviews = reviews.filter(r => r.rating && r.rating <= 3);
    const unansweredNegative = negativeReviews.filter(r => !r.hasOwnerResponse).length;

    // Response quality indicators
    const responseQuality = {
        responding: responseRate > 50,
        prioritizingNegative: negativeReviews.length > 0 &&
            (negativeReviews.filter(r => r.hasOwnerResponse).length / negativeReviews.length) > 0.7,
        engaging: responseRate > 70
    };

    return {
        totalReviews: total,
        reviewsWithResponse: withResponse,
        responseRate,
        responseRateLabel: responseRate >= 70 ? 'Excellent' : responseRate >= 40 ? 'Good' : responseRate >= 20 ? 'Fair' : 'Needs Improvement',
        negativeReviews: negativeReviews.length,
        unansweredNegative,
        hasUnansweredNegative: unansweredNegative > 0,
        responseQuality,
        recommendation: getResponseRecommendation(responseRate, unansweredNegative)
    };
}

/**
 * Get recommendation based on response metrics
 */
function getResponseRecommendation(responseRate, unansweredNegative) {
    if (unansweredNegative > 0) {
        return `You have ${unansweredNegative} negative review${unansweredNegative > 1 ? 's' : ''} without a response. Responding to negative reviews can improve customer perception by up to 45%.`;
    }
    if (responseRate < 30) {
        return 'Responding to reviews can increase customer trust by 33%. Aim to respond to at least 50% of reviews.';
    }
    if (responseRate < 60) {
        return 'Good job responding to reviews! Increasing your response rate to 70%+ can significantly boost customer confidence.';
    }
    return 'Excellent response rate! Keep engaging with your customers to maintain strong relationships.';
}

/**
 * Generate full review analytics report
 *
 * @param {string|Array} reviewInput - Raw review text or array of reviews
 * @param {number} googleRating - Current Google rating
 * @param {number} totalReviewCount - Total review count from Google
 * @returns {Object} Complete analytics report
 */
function analyzeReviews(reviewInput, googleRating = null, totalReviewCount = null) {
    // Parse reviews if string input
    const reviews = typeof reviewInput === 'string'
        ? parseReviews(reviewInput)
        : reviewInput || [];

    const volume = calculateVolumeVelocity(reviews);
    const quality = calculateRatingQuality(reviews);
    const response = calculateResponsePerformance(reviews);

    // Generate insights
    const insights = generateInsights(volume, quality, response, googleRating, totalReviewCount);

    // Calculate overall health score (0-100)
    const healthScore = calculateHealthScore(volume, quality, response);

    return {
        reviewCount: reviews.length,
        googleRating,
        totalReviewCount,
        volume,
        quality,
        response,
        insights,
        healthScore,
        analyzedAt: new Date().toISOString()
    };
}

/**
 * Generate actionable insights from metrics
 */
function generateInsights(volume, quality, response, googleRating, totalReviewCount) {
    const insights = [];

    // Volume insights
    if (volume.velocityTrend === 'accelerating') {
        insights.push({
            type: 'positive',
            category: 'velocity',
            title: 'Review Momentum Building',
            message: `Reviews are up ${volume.velocityChange}% compared to last month. This indicates growing customer engagement.`
        });
    } else if (volume.velocityTrend === 'slowing') {
        insights.push({
            type: 'warning',
            category: 'velocity',
            title: 'Review Velocity Declining',
            message: `Reviews are down ${Math.abs(volume.velocityChange)}% from last month. Consider implementing a review request strategy.`
        });
    }

    if (volume.isStale) {
        insights.push({
            type: 'critical',
            category: 'freshness',
            title: 'Reviews Getting Stale',
            message: `It's been ${volume.daysSinceLastReview} days since your last review. Fresh reviews are crucial for customer trust.`
        });
    }

    // Quality insights
    if (quality.trendDirection === 'improving') {
        insights.push({
            type: 'positive',
            category: 'quality',
            title: 'Ratings Improving',
            message: 'Your ratings are trending upward, indicating improving customer satisfaction.'
        });
    } else if (quality.trendDirection === 'declining') {
        insights.push({
            type: 'warning',
            category: 'quality',
            title: 'Ratings Declining',
            message: 'Recent reviews show lower ratings. Review recent customer feedback for improvement areas.'
        });
    }

    if (quality.lowRatingRate > 20) {
        insights.push({
            type: 'warning',
            category: 'quality',
            title: 'High Rate of Low Ratings',
            message: `${quality.lowRatingRate}% of reviews are 3 stars or below. Focus on addressing common complaints.`
        });
    }

    // Response insights
    if (response.hasUnansweredNegative) {
        insights.push({
            type: 'critical',
            category: 'response',
            title: 'Unanswered Negative Reviews',
            message: `${response.unansweredNegative} negative review${response.unansweredNegative > 1 ? 's need' : ' needs'} a response. This is your top priority.`
        });
    }

    if (response.responseRate < 30) {
        insights.push({
            type: 'warning',
            category: 'response',
            title: 'Low Response Rate',
            message: 'Only responding to ' + response.responseRate + '% of reviews. Aim for at least 50% to show customers you care.'
        });
    }

    return insights;
}

/**
 * Calculate overall review health score
 */
function calculateHealthScore(volume, quality, response) {
    let score = 50; // Base score

    // Volume factors (max 20 points)
    if (!volume.isStale) score += 5;
    if (volume.velocityTrend === 'accelerating') score += 10;
    else if (volume.velocityTrend === 'slowing') score -= 5;
    if (volume.reviewsPerMonth >= 5) score += 5;

    // Quality factors (max 40 points)
    if (quality.averageRating) {
        score += (quality.averageRating - 3) * 10; // -20 to +20
        if (quality.isConsistent) score += 5;
        if (quality.trendDirection === 'improving') score += 10;
        else if (quality.trendDirection === 'declining') score -= 10;
        if (quality.lowRatingRate < 10) score += 5;
    }

    // Response factors (max 20 points)
    if (response.responseRate >= 70) score += 15;
    else if (response.responseRate >= 40) score += 8;
    else if (response.responseRate >= 20) score += 4;

    if (!response.hasUnansweredNegative) score += 5;
    else score -= 10;

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate pitch-ready metrics summary
 */
function getPitchMetrics(analytics) {
    const { volume, quality, response, healthScore, insights } = analytics;

    return {
        headline: {
            score: healthScore,
            label: healthScore >= 80 ? 'Excellent' : healthScore >= 60 ? 'Good' : healthScore >= 40 ? 'Fair' : 'Needs Work',
            rating: quality.averageRating,
            totalReviews: volume.totalReviews
        },
        keyMetrics: [
            {
                label: 'Review Velocity',
                value: `${volume.last30Days} last 30 days`,
                trend: volume.velocityTrend,
                trendValue: volume.velocityChange
            },
            {
                label: 'Average Rating',
                value: quality.averageRating?.toFixed(1) || 'N/A',
                subValue: quality.trendDirection
            },
            {
                label: 'Response Rate',
                value: `${response.responseRate}%`,
                subValue: response.responseRateLabel
            },
            {
                label: '5-Star Rate',
                value: `${quality.distributionPct?.[5] || 0}%`,
                subValue: `${quality.distribution?.[5] || 0} reviews`
            }
        ],
        criticalIssues: insights.filter(i => i.type === 'critical'),
        opportunities: insights.filter(i => i.type === 'warning'),
        strengths: insights.filter(i => i.type === 'positive'),
        recommendation: response.recommendation
    };
}

module.exports = {
    parseReviews,
    calculateVolumeVelocity,
    calculateRatingQuality,
    calculateResponsePerformance,
    analyzeReviews,
    getPitchMetrics
};
