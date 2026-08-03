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

// ── Keep'N it Tidy name-collision case (2026-08 live report defect) ───────────
// The qualified-lead card mixed two different businesses that share a similar
// name in Atlanta. The card header showed the Places record (business A):
// 5.0★ / 257 reviews. The scored row / velocity alert / review quote came from a
// name-keyed DataForSEO lookup that returned a lookalike (business B): 3★ / 2
// reviews, plus a stale "last review 1398 days ago" alert next to a fresh quote.
//
// keepNItTidyLead      — the correct Places lead (card header, business A).
// collidingReview      — the mis-joined enrichment (lookalike business B).
// goodReview           — a correct enrichment for business A (should still attach).

const keepNItTidyLead = {
    rank: 1,
    name: "Keep'N it Tidy",
    address: '742 Cleanup Ave, Atlanta, GA 30305',
    rating: 5.0,
    reviewCount: 257,
    phone: '404-555-0142',
    website: 'https://keepnittidy.example',
    // Serper Places identifier for business A
    cid: '111111111111111111',
    placeId: null,
};

// Business B — different Google identifier, similar name, contradictory numbers.
const keepNItTidyCollidingReview = {
    matchedName: "Keep'N It Tidy Services",
    cid: '999999999999999999',
    placeId: null,
    rating: 3.0,
    reviewCount: 2,
    reviews: [
        { text: 'Great job, fast and friendly!', rating: 5, date: '2026-07-30T00:00:00Z', authorName: 'A. Smith', ownerResponse: null },
    ],
};

// Business A — same identity, consistent numbers (legitimate enrichment).
const keepNItTidyGoodReview = {
    matchedName: "Keep'N it Tidy",
    cid: '111111111111111111',
    placeId: null,
    rating: 4.9,
    reviewCount: 251,
    reviews: [
        { text: 'On time and thorough.', rating: 5, date: '2026-07-28T00:00:00Z', authorName: 'B. Jones', ownerResponse: 'Thank you!' },
    ],
};

module.exports = {
    REVIEW_COUNTS, NAMES, qualifiedLeads, benchmarks, competitors, JUNK_REMOVAL_DENOMINATOR,
    keepNItTidyLead, keepNItTidyCollidingReview, keepNItTidyGoodReview,
};
