'use strict';

function safeNumber(value, fallback) {
  if (fallback === undefined) fallback = 0;
  var n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safePercent(numerator, denominator, fallback) {
  if (fallback === undefined) fallback = 0;
  var num = safeNumber(numerator);
  var den = safeNumber(denominator);
  if (den <= 0) return fallback;
  return (num / den) * 100;
}

function normalizeReviewCount(business) {
  if (!business) return 0;
  return safeNumber(
    business.reviews !== undefined ? business.reviews :
    business.reviewCount !== undefined ? business.reviewCount :
    business.review_count !== undefined ? business.review_count :
    business.user_ratings_total !== undefined ? business.user_ratings_total :
    business.totalReviews
  );
}

module.exports = { safeNumber, safePercent, normalizeReviewCount };
