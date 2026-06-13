'use strict';

/**
 * reviewHealthAnalyzer.js — Pure function, zero external dependencies.
 *
 * Analyzes an array of review objects and produces a review health report.
 * Gates: ≥5 reviews AND ≥90-day data span, else insufficient_data.
 *
 * Grade composite: responseRate (40%) + velocity (30%) + recency (30%)
 *   A ≥ 80%  |  B ≥ 60%  |  C ≥ 40%  |  D ≥ 20%  |  F < 20%
 */

/**
 * @param {Array<{date: string, ownerResponse?: string|boolean|object}>} reviews
 * @param {Date} [now=new Date()] — injectable for testing
 * @returns {{ status: string, responseRate?, velocity?, lastReviewDate?,
 *             daysSinceLastReview?, reviewHealthGrade?, totalReviewsAnalyzed?,
 *             reviewsWithResponse?, reviewsInLast90Days?, dataSpanDays? }}
 */
function analyzeReviewHealth(reviews, now) {
    if (!Array.isArray(reviews) || reviews.length === 0) {
        return { status: 'insufficient_data' };
    }

    const currentDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();

    // Parse dates and filter valid entries
    const parsed = [];
    for (const r of reviews) {
        const d = _parseDate(r.date || r.datetime || r.time || r.review_datetime_utc);
        if (d) {
            parsed.push({ date: d, hasResponse: _hasOwnerResponse(r) });
        }
    }

    if (parsed.length < 5) {
        return { status: 'insufficient_data' };
    }

    // Sort by date ascending
    parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

    const earliest = parsed[0].date;
    const latest   = parsed[parsed.length - 1].date;
    const dataSpanDays = Math.floor((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24));

    if (dataSpanDays < 90) {
        return { status: 'insufficient_data' };
    }

    // Compute metrics
    const totalReviewsAnalyzed = parsed.length;
    const reviewsWithResponse  = parsed.filter(r => r.hasResponse).length;
    const responseRate          = totalReviewsAnalyzed > 0
        ? Math.round((reviewsWithResponse / totalReviewsAnalyzed) * 100) / 100
        : 0;

    const daysSinceLastReview = Math.floor(
        (currentDate.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24)
    );

    const ninetyDaysAgo = new Date(currentDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    const reviewsInLast90Days = parsed.filter(r => r.date >= ninetyDaysAgo).length;

    // Velocity: reviews per month over data span
    const dataSpanMonths = dataSpanDays / 30.44; // average days per month
    const velocity = dataSpanMonths > 0
        ? Math.round((totalReviewsAnalyzed / dataSpanMonths) * 100) / 100
        : 0;

    // Grade composite
    const reviewHealthGrade = _computeGrade(responseRate, velocity, daysSinceLastReview);

    return {
        status: 'complete',
        responseRate,
        velocity,
        lastReviewDate: latest.toISOString(),
        daysSinceLastReview,
        reviewHealthGrade,
        totalReviewsAnalyzed,
        reviewsWithResponse,
        reviewsInLast90Days,
        dataSpanDays,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

function _hasOwnerResponse(review) {
    if (review.ownerResponse) return true;
    if (review.owner_response) return true;
    if (review.response_text) return true;
    if (review.owner_answer) return true;
    if (review.hasOwnerResponse === true) return true;
    return false;
}

/**
 * Composite grade from three weighted signals:
 *   responseRate (40%): 0–1 mapped to 0–100
 *   velocity (30%): reviews/month, capped at 10/month = 100%
 *   recency (30%): daysSinceLastReview, 0d=100%, ≥180d=0%
 *
 * A ≥ 80  |  B ≥ 60  |  C ≥ 40  |  D ≥ 20  |  F < 20
 */
function _computeGrade(responseRate, velocity, daysSinceLastReview) {
    // Response rate component (40% weight): 0–1 → 0–100
    const responseScore = Math.min(100, responseRate * 100);

    // Velocity component (30% weight): reviews/month, 10/mo = 100%
    const velocityScore = Math.min(100, (velocity / 10) * 100);

    // Recency component (30% weight): 0 days = 100%, 180+ days = 0%
    const recencyScore = Math.max(0, Math.min(100, ((180 - daysSinceLastReview) / 180) * 100));

    const composite = (responseScore * 0.4) + (velocityScore * 0.3) + (recencyScore * 0.3);

    if (composite >= 80) return 'A';
    if (composite >= 60) return 'B';
    if (composite >= 40) return 'C';
    if (composite >= 20) return 'D';
    return 'F';
}

module.exports = {
    analyzeReviewHealth,
    // Exported for testing
    _computeGrade,
    _hasOwnerResponse,
    _parseDate,
};
