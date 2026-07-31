'use strict';

/**
 * Sanitized fixture reconstructed from the 2026-07-30 Junk Removal & Hauling / Atlanta GA report.
 * The 9 review counts are the real qualified-lead set; names, ratings and addresses are synthetic
 * (no real customer data). Market avg reviews (2431) is the real value that made every lead look
 * "below average". Junk Removal & Hauling review-score denominator is 800 (resolveReviewCeilings).
 */

const REVIEW_COUNTS = [9, 17, 29, 14, 73, 120, 594, 904, 1700];

const NAMES = [
    'Peachtree Junk Squad', 'Buckhead Debris Pros', 'Midtown Haul Away',
    'Decatur Junk Kings', 'Marietta Cleanout Crew', 'Sandy Springs Removal Co',
    'Atlanta Junk Luggers', 'Metro Hauling Group', 'Peach State Junk Removal',
];

const qualifiedLeads = REVIEW_COUNTS.map((rc, i) => ({
    name: NAMES[i],
    rating: 4.6,
    reviewCount: rc,
    address: `${100 + i} Main St, Atlanta, GA 3030${i % 10}`,
}));

const benchmarks = { avgReviews: 2431, avgRating: 4.4, topQuartileAvg: 4.8 };

// A competitor-inflated market so identifyMarketLeader has a clear leader.
const competitors = [
    { name: '1-800-GOT-JUNK Metro', rating: 4.5, reviewCount: 2431, website: 'https://x.com', phone: '404-555-0000', address: 'Atlanta, GA' },
];

const JUNK_REMOVAL_DENOMINATOR = 800;

module.exports = { REVIEW_COUNTS, NAMES, qualifiedLeads, benchmarks, competitors, JUNK_REMOVAL_DENOMINATOR };
