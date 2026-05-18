/**
 * Deterministic 90-Day Outcome Calculator
 *
 * Replaces AI-generated "What Changes in 90 Days" cards with
 * weighted-average math and velocity-based review targets.
 *
 * No AI. No async. Pure math.
 */

/**
 * Parse Google-style relative date labels into approximate days ago.
 * Conservative: "3 months ago" is excluded (returns null) unless exact timestamp exists.
 *
 * @param {string} label - e.g. "a week ago", "2 months ago", "23 hours ago"
 * @returns {number|null} - days ago, or null if unparseable/excluded
 */
function parseRelativeDateLabel(label) {
    if (!label || typeof label !== 'string') return null;
    const l = label.trim().toLowerCase();

    // Hours
    const hoursMatch = l.match(/^(\d+)\s*hours?\s*ago$/);
    if (hoursMatch) return 0; // same day
    if (l === 'an hour ago') return 0;

    // Days
    if (l === 'a day ago' || l === '1 day ago' || l === 'yesterday') return 1;
    const daysMatch = l.match(/^(\d+)\s*days?\s*ago$/);
    if (daysMatch) return parseInt(daysMatch[1]);

    // Weeks
    if (l === 'a week ago' || l === '1 week ago') return 7;
    const weeksMatch = l.match(/^(\d+)\s*weeks?\s*ago$/);
    if (weeksMatch) return parseInt(weeksMatch[1]) * 7;

    // Months — only include up to 2 months
    if (l === 'a month ago' || l === '1 month ago') return 30;
    if (l === '2 months ago') return 60;

    // "3 months ago" is imprecise — could be 75-95 days. Exclude conservatively.
    // "4 months ago" and beyond are definitely outside 90 days.
    // Return null for these — the caller should check exact timestamps if available.
    if (l.match(/^[3-9]\s*months?\s*ago$/) || l.match(/^\d{2,}\s*months?\s*ago$/)) return null;
    if (l.match(/years?\s*ago/)) return null;

    // "New" or "Edited X ago" — treat as very recent
    if (l === 'new') return 0;
    const editedMatch = l.match(/^edited\s+(.+)$/);
    if (editedMatch) return parseRelativeDateLabel(editedMatch[1]);

    return null;
}

/**
 * Count reviews from the last 90 days using available date information.
 *
 * @param {Array} reviews - array of { createdAt?, relativeDateLabel?, rating? }
 * @returns {{ count: number, usedExactTimestamps: boolean, excludedImpreciseThreeMonthReviews: boolean, confidence: string }}
 */
function calculateReviewsLast90Days(reviews) {
    if (!Array.isArray(reviews) || reviews.length === 0) {
        return { count: 0, usedExactTimestamps: false, excludedImpreciseThreeMonthReviews: false, confidence: 'low' };
    }

    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    let count = 0;
    let usedExactTimestamps = false;
    let excludedImprecise = false;

    for (const review of reviews) {
        // Path 1: exact timestamp
        if (review.createdAt) {
            const ts = new Date(review.createdAt).getTime();
            if (!isNaN(ts) && (now - ts) <= ninetyDaysMs) {
                count++;
                usedExactTimestamps = true;
                continue;
            }
            // Valid timestamp but older than 90 days — skip
            if (!isNaN(ts)) continue;
        }

        // Path 2: relative date label
        if (review.relativeDateLabel || review.date) {
            const label = review.relativeDateLabel || review.date;
            const daysAgo = parseRelativeDateLabel(String(label));
            if (daysAgo !== null && daysAgo <= 90) {
                count++;
            } else if (daysAgo === null && /3\s*months?\s*ago/i.test(String(label))) {
                excludedImprecise = true;
            }
        }
    }

    // Confidence: high if exact timestamps used, medium if relative labels, low if no data
    let confidence = 'low';
    if (count > 0) {
        confidence = usedExactTimestamps ? 'high' : 'medium';
    }

    return { count, usedExactTimestamps, excludedImpreciseThreeMonthReviews: excludedImprecise, confidence };
}

/**
 * Select the velocity multiplier band based on competitor data or fallback logic.
 *
 * @param {number} currentMonthlyReviews
 * @param {number|null} competitorMedianMonthly
 * @param {number|null} competitorP75Monthly
 * @param {number|null} recentNegativeReviewRate - decimal (0.10 = 10%)
 * @param {number|null} manualOverride - manual multiplier between 1.2 and 3.0
 * @returns {{ multiplier: number, band: string }}
 */
function selectVelocityBand(currentMonthlyReviews, competitorMedianMonthly, competitorP75Monthly, recentNegativeReviewRate, manualOverride) {
    // Manual override
    if (manualOverride && manualOverride >= 1.2 && manualOverride <= 3.0) {
        return { multiplier: manualOverride, band: 'manual_override' };
    }

    let multiplier;
    let band;

    if (competitorMedianMonthly && competitorP75Monthly) {
        // Competitor-based banding
        if (currentMonthlyReviews >= competitorP75Monthly) {
            multiplier = 1.2; band = 'maintain';
        } else if (currentMonthlyReviews >= competitorMedianMonthly) {
            multiplier = 1.5; band = 'light_lift';
        } else if (currentMonthlyReviews >= competitorMedianMonthly * 0.65) {
            multiplier = 2.0; band = 'growth';
        } else if (currentMonthlyReviews >= competitorMedianMonthly * 0.35) {
            multiplier = 2.5; band = 'catch_up';
        } else {
            multiplier = 3.0; band = 'aggressive_sprint';
        }
    } else {
        // Fallback banding — no competitor data
        const reviewsLast90 = currentMonthlyReviews * 3;
        if (reviewsLast90 >= 20) {
            multiplier = 2.0; band = 'fallback';
        } else if (reviewsLast90 >= 10) {
            multiplier = 2.5; band = 'fallback';
        } else {
            multiplier = 3.0; band = 'fallback';
        }
    }

    // Reputation adjustment
    const negRate = recentNegativeReviewRate || 0;
    if (negRate >= 0.20) {
        multiplier = Math.min(multiplier, 2.0);
    } else if (negRate >= 0.10 && multiplier < 2.0) {
        multiplier = 2.0;
    }

    return { multiplier, band };
}

/**
 * Compute velocity trend by comparing first half vs second half of the 90-day window.
 *
 * @param {Array} reviews - array of review objects with date info
 * @returns {string} - 'accelerating' | 'stable' | 'decelerating'
 */
function computeVelocityTrend(reviews) {
    if (!Array.isArray(reviews) || reviews.length < 6) return 'stable';

    const now = Date.now();
    const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    let firstHalf = 0; // days 46-90 ago
    let secondHalf = 0; // days 0-45 ago (most recent)

    for (const review of reviews) {
        let daysAgo = null;

        if (review.createdAt) {
            const ts = new Date(review.createdAt).getTime();
            if (!isNaN(ts)) {
                daysAgo = (now - ts) / (24 * 60 * 60 * 1000);
            }
        }

        if (daysAgo === null) {
            const label = review.relativeDateLabel || review.date;
            if (label) daysAgo = parseRelativeDateLabel(String(label));
        }

        if (daysAgo === null || daysAgo > 90) continue;

        if (daysAgo <= 45) {
            secondHalf++;
        } else {
            firstHalf++;
        }
    }

    // Need at least 3 reviews in each half to make a meaningful comparison
    if (firstHalf < 3 || secondHalf < 3) return 'stable';

    const ratio = secondHalf / firstHalf;
    if (ratio >= 1.3) return 'accelerating';
    if (ratio <= 0.7) return 'decelerating';
    return 'stable';
}

/**
 * Main calculation function. Pure math, no AI.
 *
 * @param {Object} inputs
 * @param {number} inputs.currentReviewCount
 * @param {number} inputs.currentRating
 * @param {number} inputs.currentDisplayedRating
 * @param {Array}  [inputs.reviews] - review objects with createdAt or relativeDateLabel
 * @param {number} [inputs.competitorMedianMonthlyReviews]
 * @param {number} [inputs.competitorP75MonthlyReviews]
 * @param {number} [inputs.recentNegativeReviewRate] - decimal
 * @param {number} [inputs.expectedNewReviewAverage] - default 5.0
 * @param {number} [inputs.manualReviewTargetMultiplier]
 * @returns {Object} - full calculation output (see Section 13 of spec)
 */
function calculateDeterministicOutcomes(inputs) {
    const {
        currentReviewCount,
        currentRating,
        currentDisplayedRating,
        reviews = [],
        competitorMedianMonthlyReviews = null,
        competitorP75MonthlyReviews = null,
        recentNegativeReviewRate = null,
        expectedNewReviewAverage = 5.0,
        manualReviewTargetMultiplier = null
    } = inputs;

    // Step 1: Count reviews in last 90 days
    const reviewCount90 = calculateReviewsLast90Days(reviews);
    let reviewsLast90Days = reviewCount90.count;
    let reviewTargetConfidence = reviewCount90.confidence;

    // Fallback if fewer than ~3 months of data
    if (reviewsLast90Days < 3) {
        // Not enough data for velocity calculation — use conservative default
        const defaultTarget = Math.max(10, Math.round((currentReviewCount || 0) * 0.015));
        const displayTarget = Math.ceil(defaultTarget / 5) * 5;

        // Rating projection with default target
        const projectedRating = currentReviewCount > 0
            ? ((currentReviewCount * currentRating) + (displayTarget * expectedNewReviewAverage)) / (currentReviewCount + displayTarget)
            : currentRating || 0;
        const projectedRatingRounded = Math.round(projectedRating * 100) / 100;

        const nextDisplayedRating = (currentDisplayedRating || 0) + 0.1;
        const nextDisplayThreshold = (currentDisplayedRating || 0) + 0.05;

        let reviewsNeededForNextRating = null;
        if (expectedNewReviewAverage > nextDisplayThreshold && currentReviewCount > 0) {
            reviewsNeededForNextRating = Math.ceil(
                ((nextDisplayThreshold - currentRating) * currentReviewCount) /
                (expectedNewReviewAverage - nextDisplayThreshold)
            );
        }

        const ratingTargetLabel = projectedRating >= nextDisplayThreshold
            ? `${nextDisplayedRating.toFixed(1)} Rating Target`
            : `${(currentDisplayedRating || 0).toFixed(1)} Protected`;

        const ratingTargetSubtext = `Projected lift: ${(currentRating || 0).toFixed(2)} → ${projectedRatingRounded.toFixed(2)}`;

        return {
            reviewsLast90Days: 0,
            averageMonthlyReviews: 0,
            min90DayTarget: null,
            max90DayTarget: null,
            selectedMultiplier: null,
            selectedBand: 'insufficient_data',
            selected90DayReviewTarget: defaultTarget,
            displayReviewTarget: displayTarget,
            currentReviewCount: currentReviewCount || 0,
            currentRating: currentRating || 0,
            currentDisplayedRating: currentDisplayedRating || 0,
            expectedNewReviewAverage,
            projectedRating,
            projectedRatingRounded,
            nextDisplayedRating: Math.round(nextDisplayedRating * 10) / 10,
            nextDisplayThreshold,
            reviewsNeededForNextRating,
            ratingTargetLabel,
            ratingTargetSubtext,
            reviewTargetConfidence: 'low',
            reviewVelocityTrend: 'stable',
            usedExactTimestamps: reviewCount90.usedExactTimestamps,
            excludedImpreciseThreeMonthReviews: reviewCount90.excludedImpreciseThreeMonthReviews
        };
    }

    // Step 2: Compute averages and bounds
    const averageMonthlyReviews = reviewsLast90Days / 3;
    const min90DayTarget = Math.ceil(reviewsLast90Days * 1.2);
    const max90DayTarget = Math.ceil(reviewsLast90Days * 3.0);

    // Step 3: Select velocity band
    const { multiplier: selectedMultiplier, band: selectedBand } = selectVelocityBand(
        averageMonthlyReviews,
        competitorMedianMonthlyReviews,
        competitorP75MonthlyReviews,
        recentNegativeReviewRate,
        manualReviewTargetMultiplier
    );

    // Step 4: Calculate and clamp target
    let selected90DayReviewTarget = Math.ceil(reviewsLast90Days * selectedMultiplier);
    selected90DayReviewTarget = Math.min(Math.max(selected90DayReviewTarget, min90DayTarget), max90DayTarget);

    // Step 5: Display rounding — nearest 5, ceiling
    const displayReviewTarget = Math.ceil(selected90DayReviewTarget / 5) * 5;

    // Step 6: Rating impact math
    const projectedRating = currentReviewCount > 0
        ? ((currentReviewCount * currentRating) + (displayReviewTarget * expectedNewReviewAverage)) / (currentReviewCount + displayReviewTarget)
        : currentRating || 0;
    const projectedRatingRounded = Math.round(projectedRating * 100) / 100;

    // Step 7: Next displayed rating threshold
    const nextDisplayedRating = Math.round(((currentDisplayedRating || 0) + 0.1) * 10) / 10;
    const nextDisplayThreshold = (currentDisplayedRating || 0) + 0.05;

    // Step 8: Reviews needed for next displayed rating
    let reviewsNeededForNextRating = null;
    if (expectedNewReviewAverage > nextDisplayThreshold && currentReviewCount > 0) {
        reviewsNeededForNextRating = Math.ceil(
            ((nextDisplayThreshold - currentRating) * currentReviewCount) /
            (expectedNewReviewAverage - nextDisplayThreshold)
        );
    }

    // Step 9: Determine label
    const ratingReachable = projectedRating >= nextDisplayThreshold;
    const ratingTargetLabel = ratingReachable
        ? `${nextDisplayedRating.toFixed(1)} Rating Target`
        : `${(currentDisplayedRating || 0).toFixed(1)} Protected`;

    const ratingTargetSubtext = `Projected lift: ${(currentRating || 0).toFixed(2)} → ${projectedRatingRounded.toFixed(2)}`;

    // Step 10: Velocity trend
    const reviewVelocityTrend = computeVelocityTrend(reviews);

    return {
        reviewsLast90Days,
        averageMonthlyReviews: Math.round(averageMonthlyReviews * 1000) / 1000,
        min90DayTarget,
        max90DayTarget,
        selectedMultiplier,
        selectedBand,
        selected90DayReviewTarget,
        displayReviewTarget,
        currentReviewCount: currentReviewCount || 0,
        currentRating: currentRating || 0,
        currentDisplayedRating: currentDisplayedRating || 0,
        expectedNewReviewAverage,
        projectedRating: Math.round(projectedRating * 1000) / 1000,
        projectedRatingRounded,
        nextDisplayedRating,
        nextDisplayThreshold,
        reviewsNeededForNextRating,
        ratingTargetLabel,
        ratingTargetSubtext,
        reviewTargetConfidence,
        reviewVelocityTrend,
        usedExactTimestamps: reviewCount90.usedExactTimestamps,
        excludedImpreciseThreeMonthReviews: reviewCount90.excludedImpreciseThreeMonthReviews
    };
}

module.exports = {
    calculateDeterministicOutcomes,
    calculateReviewsLast90Days,
    selectVelocityBand,
    computeVelocityTrend,
    parseRelativeDateLabel
};
