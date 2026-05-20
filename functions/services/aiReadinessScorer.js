'use strict';

/**
 * aiReadinessScorer.js
 * AI Readiness Scoring Engine — AIsynch Phase 1A
 *
 * Scores a merchant's AI readiness across six pillars (0-100 total).
 * Operates in three modes:
 *   lead_magnet   — public data only (Places + Serper + PageSpeed)
 *   merchant_lite — above + GBP audit + review data
 *   merchant_full — all sources + widget signals + AI visibility + competitors
 *
 * Each sub-item tracks dataSource: 'real' | 'default' to drive confidence scoring.
 * llms.txt contributes max 1 point (out of 3) to aiCrawlReadiness.
 *
 * Schema: aiReadinessScores/{merchantId} (Section 1.1 of AIsynch Architecture v2)
 */

// ── Default market benchmarks (used when marketBenchmarks is null) ─────────────

var DEFAULT_BENCHMARKS = {
  avgRating: 4.3,
  avgReviewCount: 150,
  avgSeoScore: 55
};

// ── Product map — which PathSynch product drives each sub-item fix ─────────────

var PRODUCT_MAP = {
  reviewAuthority: {
    reviewCountVsMarket: 'PathConnect',
    averageRating: 'PathConnect',
    reviewRecency: 'PathConnect',
    responseRate: 'PathManager'
  },
  gbpCompleteness: {
    categoryAccuracy: 'LocalSynch',
    businessDescription: 'LocalSynch',
    contactInfo: 'LocalSynch',
    photos: 'LocalSynch',
    qAndA: 'LocalSynch',
    recentPosts: 'LocalSynch',
    servicesMenu: 'LocalSynch'
  },
  webPresence: {
    hasWebsite: null,
    mobileOptimized: null,
    pageLoadPerformance: null,
    schemaMarkup: 'AIsynch',
    aiCrawlReadiness: 'AIsynch',
    contentDepth: null
  },
  citationPresence: {
    majorDirectories: 'LocalSynch',
    napConsistency: 'LocalSynch',
    localAuthoritySites: null,
    backlinkStrength: null
  },
  aiVisibility: {
    mentionRate: 'AIsynch',
    sentiment: 'AIsynch',
    positionInResponse: 'AIsynch'
  },
  competitivePosition: {
    ratingVsMarket: 'PathConnect',
    reviewCountPercentile: 'PathConnect',
    digitalPresenceVsMedian: 'LocalSynch',
    uniqueDifferentiator: null
  }
};

// ── Action metadata ────────────────────────────────────────────────────────────

var ACTION_TITLES = {
  reviewAuthority: {
    reviewCountVsMarket: 'Generate more Google reviews',
    averageRating: 'Improve your average rating',
    reviewRecency: 'Get reviews from recent customers',
    responseRate: 'Respond to all customer reviews'
  },
  gbpCompleteness: {
    categoryAccuracy: 'Verify your primary GBP category',
    businessDescription: 'Write a complete GBP business description',
    contactInfo: 'Complete your GBP contact information',
    photos: 'Add photos to your Google Business Profile',
    qAndA: 'Add Q&A content to your GBP',
    recentPosts: 'Publish regular GBP posts',
    servicesMenu: 'Add your services menu to GBP'
  },
  webPresence: {
    hasWebsite: 'Build a professional website',
    mobileOptimized: 'Make your website mobile-friendly',
    pageLoadPerformance: 'Improve your website load speed',
    schemaMarkup: 'Add schema markup to your website',
    aiCrawlReadiness: 'Allow AI crawlers to access your site',
    contentDepth: 'Add more detailed content to your website'
  },
  citationPresence: {
    majorDirectories: 'Get listed in more business directories',
    napConsistency: 'Fix inconsistent business info across directories',
    localAuthoritySites: 'Get listed on local authority sites',
    backlinkStrength: 'Build backlinks from trusted sites'
  },
  aiVisibility: {
    mentionRate: 'Improve your AI mention rate',
    sentiment: 'Improve how AI models describe your business',
    positionInResponse: 'Appear earlier in AI recommendation responses'
  },
  competitivePosition: {
    ratingVsMarket: 'Raise your rating above the market average',
    reviewCountPercentile: 'Close the review count gap with competitors',
    digitalPresenceVsMedian: 'Expand your digital presence above median',
    uniqueDifferentiator: 'Develop a unique market differentiator'
  }
};

var ACTION_DIFFICULTY = {
  reviewAuthority: {
    reviewCountVsMarket: 'medium',
    averageRating: 'hard',
    reviewRecency: 'easy',
    responseRate: 'easy'
  },
  gbpCompleteness: {
    categoryAccuracy: 'easy',
    businessDescription: 'easy',
    contactInfo: 'easy',
    photos: 'easy',
    qAndA: 'medium',
    recentPosts: 'medium',
    servicesMenu: 'easy'
  },
  webPresence: {
    hasWebsite: 'hard',
    mobileOptimized: 'medium',
    pageLoadPerformance: 'medium',
    schemaMarkup: 'medium',
    aiCrawlReadiness: 'easy',
    contentDepth: 'medium'
  },
  citationPresence: {
    majorDirectories: 'easy',
    napConsistency: 'medium',
    localAuthoritySites: 'hard',
    backlinkStrength: 'hard'
  },
  aiVisibility: {
    mentionRate: 'hard',
    sentiment: 'hard',
    positionInResponse: 'hard'
  },
  competitivePosition: {
    ratingVsMarket: 'hard',
    reviewCountPercentile: 'medium',
    digitalPresenceVsMedian: 'medium',
    uniqueDifferentiator: 'hard'
  }
};

var ACTION_WHY = {
  reviewAuthority: {
    reviewCountVsMarket: 'AI models rank businesses higher when they have more reviews than competitors. More reviews signal trustworthiness to AI recommendation engines.',
    averageRating: 'A below-average rating reduces the likelihood that AI models will recommend your business. AI assistants filter out lower-rated businesses in competitive markets.',
    reviewRecency: 'AI models consider recency when ranking local businesses. Recent reviews signal an active, trustworthy business.',
    responseRate: 'Responding to reviews signals professionalism. AI models are trained on review data where response rates correlate with business quality.'
  },
  gbpCompleteness: {
    categoryAccuracy: 'Your GBP category tells AI models what type of business you are. An inaccurate or missing category means AI assistants may not surface you for relevant queries.',
    businessDescription: 'AI models use your GBP description to decide whether to recommend you. Without one, models skip you for competitors who describe their services clearly.',
    contactInfo: 'Complete contact information helps AI models verify your business identity and recommend you with confidence.',
    photos: 'Businesses with photos are more likely to be cited by AI models. Photos signal an active, established business.',
    qAndA: 'Q&A content gives AI models additional context about your services, increasing the chance they include you in recommendation responses.',
    recentPosts: 'Regular GBP posts signal an active business and provide AI models with up-to-date service information.',
    servicesMenu: 'A structured services menu helps AI models match your business to specific service queries.'
  },
  webPresence: {
    hasWebsite: 'Without a website, AI models have no authoritative source of information about your business. A website is the primary way AI learns what you offer.',
    mobileOptimized: 'AI crawlers simulate mobile browsing. A non-mobile-optimized site may not be fully indexed, reducing your AI visibility.',
    pageLoadPerformance: 'Slow-loading pages are less likely to be crawled and cited by AI models. Fast sites signal technical quality.',
    schemaMarkup: 'Schema markup helps AI models understand your business type, location, and services — directly improving AI citation frequency.',
    aiCrawlReadiness: 'AI crawlers need explicit permission to access your site. Blocking them prevents your content from appearing in AI responses.',
    contentDepth: 'AI models cite pages with substantial, useful content. Thin pages are rarely surfaced in AI recommendation responses.'
  },
  citationPresence: {
    majorDirectories: 'AI models learn about local businesses from directory listings. More directory presence means more data points for AI to reference you.',
    napConsistency: 'Inconsistent name, address, and phone data across the web confuses AI models and reduces citation confidence.',
    localAuthoritySites: 'Citations from local authority sites (chambers of commerce, local news) strongly influence AI recommendation scores.',
    backlinkStrength: 'Backlinks from trusted sites give AI models confidence that your business is established and reputable.'
  },
  aiVisibility: {
    mentionRate: 'Your business is not appearing in AI recommendation responses for relevant queries. Early movers who optimize now capture the AI visibility gap.',
    sentiment: 'How AI models describe your business affects whether users trust the recommendation. Improving your online presence improves AI sentiment.',
    positionInResponse: 'Businesses mentioned first in AI responses capture significantly more attention. Position matters as much as presence.'
  },
  competitivePosition: {
    ratingVsMarket: 'Your rating is below the market average. AI models prefer to recommend businesses with above-average ratings in competitive markets.',
    reviewCountPercentile: 'Competitors have more reviews, making them more visible to AI models. Closing this gap is the highest-impact action for AI visibility.',
    digitalPresenceVsMedian: 'Your digital footprint is below the market median. AI models use digital presence as a proxy for business quality.',
    uniqueDifferentiator: 'Competitors have stronger differentiators in AI responses. Communicating your unique value improves AI recommendation frequency.'
  }
};

var ACTION_CATEGORIES = {
  reviewAuthority: {
    reviewCountVsMarket: 'review_growth',
    averageRating: 'review_growth',
    reviewRecency: 'review_growth',
    responseRate: 'review_growth'
  },
  gbpCompleteness: {
    categoryAccuracy: 'gbp_optimization',
    businessDescription: 'gbp_optimization',
    contactInfo: 'gbp_optimization',
    photos: 'gbp_optimization',
    qAndA: 'gbp_optimization',
    recentPosts: 'gbp_optimization',
    servicesMenu: 'gbp_optimization'
  },
  webPresence: {
    hasWebsite: 'website_structure',
    mobileOptimized: 'website_structure',
    pageLoadPerformance: 'website_structure',
    schemaMarkup: 'website_structure',
    aiCrawlReadiness: 'ai_crawl_readiness',
    contentDepth: 'content_gap'
  },
  citationPresence: {
    majorDirectories: 'citation_gap',
    napConsistency: 'citation_gap',
    localAuthoritySites: 'citation_gap',
    backlinkStrength: 'citation_gap'
  },
  aiVisibility: {
    mentionRate: 'ai_crawl_readiness',
    sentiment: 'ai_crawl_readiness',
    positionInResponse: 'ai_crawl_readiness'
  },
  competitivePosition: {
    ratingVsMarket: 'competitor_gap',
    reviewCountPercentile: 'competitor_gap',
    digitalPresenceVsMedian: 'competitor_gap',
    uniqueDifferentiator: 'competitor_gap'
  }
};

var ACTION_CTA = {
  reviewAuthority: {
    reviewCountVsMarket: '/pathconnect/review-requests',
    averageRating: '/pathconnect/review-requests',
    reviewRecency: '/pathconnect/review-requests',
    responseRate: '/pathmanager/reviews'
  },
  gbpCompleteness: {
    categoryAccuracy: '/localsynch/gbp-audit',
    businessDescription: '/localsynch/gbp-audit',
    contactInfo: '/localsynch/gbp-audit',
    photos: '/localsynch/gbp-audit',
    qAndA: '/localsynch/gbp-audit',
    recentPosts: '/localsynch/gbp-audit',
    servicesMenu: '/localsynch/gbp-audit'
  },
  webPresence: {
    hasWebsite: null,
    mobileOptimized: null,
    pageLoadPerformance: null,
    schemaMarkup: '/aisynch/schema-setup',
    aiCrawlReadiness: '/aisynch/crawl-settings',
    contentDepth: null
  },
  citationPresence: {
    majorDirectories: '/localsynch/citation-builder',
    napConsistency: '/localsynch/citation-builder',
    localAuthoritySites: null,
    backlinkStrength: null
  },
  aiVisibility: {
    mentionRate: '/aisynch/visibility-report',
    sentiment: '/aisynch/visibility-report',
    positionInResponse: '/aisynch/visibility-report'
  },
  competitivePosition: {
    ratingVsMarket: '/pathconnect/review-requests',
    reviewCountPercentile: '/pathconnect/review-requests',
    digitalPresenceVsMedian: '/localsynch/citation-builder',
    uniqueDifferentiator: null
  }
};

// ── Confidence helpers ─────────────────────────────────────────────────────────

function calculatePillarConfidence(breakdown) {
  var items = Object.keys(breakdown).map(function(k) { return breakdown[k]; });
  var realCount = items.filter(function(i) { return i.dataSource === 'real'; }).length;
  var ratio = realCount / items.length;
  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}

function calculateConfidence(pillars, merchantData) {
  var totalSubItems = 0;
  var realDataItems = 0;
  var defaultedItems = 0;
  var missingDataSources = [];

  var pillarNames = Object.keys(pillars);
  for (var pi = 0; pi < pillarNames.length; pi++) {
    var pillarData = pillars[pillarNames[pi]];
    var subNames = Object.keys(pillarData.breakdown);
    for (var si = 0; si < subNames.length; si++) {
      totalSubItems++;
      if (pillarData.breakdown[subNames[si]].dataSource === 'real') {
        realDataItems++;
      } else {
        defaultedItems++;
      }
    }
  }

  // Collect missing source names
  if (!merchantData.gbpAuditData) missingDataSources.push('gbpAudit');
  if (!merchantData.reviewData) missingDataSources.push('reviewData');
  if (!merchantData.pageSpeedData) missingDataSources.push('pageSpeed');
  if (!merchantData.widgetSignals) missingDataSources.push('widgetSignals');
  if (!merchantData.aiVisibilityData) missingDataSources.push('aiVisibility');
  if (!merchantData.competitorData) missingDataSources.push('competitorData');

  var completenessPercent = totalSubItems > 0
    ? Math.round((realDataItems / totalSubItems) * 100)
    : 0;

  // Overall confidence from pillar-level confidences
  var pillarConfidences = pillarNames.map(function(n) { return pillars[n].confidence; });
  var overallConfidence, confidenceLabel;

  if (pillarConfidences.every(function(c) { return c === 'high'; })) {
    overallConfidence = 'high';
    confidenceLabel = 'Verified';
  } else if (pillarConfidences.filter(function(c) { return c === 'low'; }).length >= 3) {
    overallConfidence = 'low';
    confidenceLabel = 'Estimated from public data';
  } else {
    overallConfidence = 'medium';
    confidenceLabel = 'Partially verified — connect more data sources for full accuracy';
  }

  return {
    confidenceLevel: overallConfidence,
    confidenceLabel: confidenceLabel,
    dataCompleteness: {
      totalSubItems: totalSubItems,
      realDataItems: realDataItems,
      defaultedItems: defaultedItems,
      completenessPercent: completenessPercent,
      missingDataSources: missingDataSources
    }
  };
}

// ── Pillar 1 — Review Authority (max 25) ──────────────────────────────────────

function scoreReviewAuthority(placeData, reviewData, benchmarks) {
  var breakdown = {};

  // reviewCountVsMarket (max 10)
  if (placeData && typeof placeData.user_ratings_total === 'number') {
    var count = placeData.user_ratings_total;
    var ratio = benchmarks.avgReviewCount > 0 ? count / benchmarks.avgReviewCount : 0;
    var rcScore;
    if (ratio >= 2)    rcScore = 10;
    else if (ratio >= 1.5) rcScore = 8;
    else if (ratio >= 1)   rcScore = 6;
    else if (ratio >= 0.5) rcScore = 4;
    else if (ratio >= 0.25) rcScore = 2;
    else if (ratio >= 0.1)  rcScore = 1;
    else rcScore = 0;
    breakdown.reviewCountVsMarket = {
      score: rcScore, max: 10,
      detail: count + ' reviews (' + Math.round(ratio * 100) + '% of market average)',
      dataSource: 'real'
    };
  } else {
    breakdown.reviewCountVsMarket = { score: 2, max: 10, detail: 'Review count unavailable', dataSource: 'default' };
  }

  // averageRating (max 8)
  if (placeData && typeof placeData.rating === 'number') {
    var rating = placeData.rating;
    var rScore;
    if (rating >= 4.8)     rScore = 8;
    else if (rating >= 4.5) rScore = 7;
    else if (rating >= 4.3) rScore = 6;
    else if (rating >= 4.0) rScore = 5;
    else if (rating >= 3.5) rScore = 3;
    else if (rating >= 3.0) rScore = 1;
    else rScore = 0;
    breakdown.averageRating = {
      score: rScore, max: 8,
      detail: rating.toFixed(1) + ' star average',
      dataSource: 'real'
    };
  } else {
    breakdown.averageRating = { score: 4, max: 8, detail: 'Rating unavailable', dataSource: 'default' };
  }

  // reviewRecency (max 4)
  if (reviewData && typeof reviewData.recentReviewCount === 'number') {
    var recent = reviewData.recentReviewCount;
    var recScore;
    if (recent >= 10) recScore = 4;
    else if (recent >= 5) recScore = 3;
    else if (recent >= 2) recScore = 2;
    else if (recent >= 1) recScore = 1;
    else recScore = 0;
    breakdown.reviewRecency = {
      score: recScore, max: 4,
      detail: recent + ' reviews in the last 90 days',
      dataSource: 'real'
    };
  } else {
    breakdown.reviewRecency = { score: 1, max: 4, detail: 'Review recency data unavailable', dataSource: 'default' };
  }

  // responseRate (max 3)
  if (reviewData && typeof reviewData.responseRate === 'number') {
    var respRate = reviewData.responseRate;
    var rrScore;
    if (respRate >= 80) rrScore = 3;
    else if (respRate >= 50) rrScore = 2;
    else if (respRate >= 20) rrScore = 1;
    else rrScore = 0;
    breakdown.responseRate = {
      score: rrScore, max: 3,
      detail: respRate + '% of reviews responded to',
      dataSource: 'real'
    };
  } else {
    breakdown.responseRate = { score: 1, max: 3, detail: 'Response rate data unavailable', dataSource: 'default' };
  }

  var total = breakdown.reviewCountVsMarket.score + breakdown.averageRating.score +
              breakdown.reviewRecency.score + breakdown.responseRate.score;

  return {
    score: Math.min(25, total),
    max: 25,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Pillar 2 — GBP Completeness (max 20) ──────────────────────────────────────

function scoreGbpCompleteness(placeData, gbpAuditData) {
  var breakdown = {};

  // categoryAccuracy (max 4)
  if (gbpAuditData) {
    breakdown.categoryAccuracy = { score: 4, max: 4, detail: 'GBP categories verified', dataSource: 'real' };
  } else if (placeData && placeData.types && placeData.types.length > 0) {
    breakdown.categoryAccuracy = { score: 2, max: 4, detail: 'Category from Places API: ' + placeData.types[0], dataSource: 'real' };
  } else {
    breakdown.categoryAccuracy = { score: 0, max: 4, detail: 'Category data unavailable', dataSource: 'default' };
  }

  // businessDescription (max 4)
  var desc = (gbpAuditData && gbpAuditData.description) ||
             (placeData && placeData.editorial_summary && placeData.editorial_summary.overview) || null;
  if (desc) {
    var descScore;
    if (desc.length > 200) descScore = 4;
    else if (desc.length > 50) descScore = 2;
    else descScore = 1;
    breakdown.businessDescription = {
      score: descScore, max: 4,
      detail: desc.length + ' character description',
      dataSource: 'real'
    };
  } else {
    breakdown.businessDescription = { score: 0, max: 4, detail: 'No business description found', dataSource: 'default' };
  }

  // contactInfo (max 3)
  if (placeData) {
    var hasPhone = !!(placeData.formatted_phone_number || placeData.international_phone_number);
    var hasWebsite = !!placeData.website;
    var ciScore;
    if (hasPhone && hasWebsite) ciScore = 3;
    else if (hasPhone || hasWebsite) ciScore = 2;
    else ciScore = 0;
    breakdown.contactInfo = {
      score: ciScore, max: 3,
      detail: (hasPhone ? 'Phone' : '') + (hasPhone && hasWebsite ? ' + ' : '') + (hasWebsite ? 'Website' : '') || 'No contact info',
      dataSource: 'real'
    };
  } else {
    breakdown.contactInfo = { score: 0, max: 3, detail: 'Contact info unavailable', dataSource: 'default' };
  }

  // photos (max 3)
  var photoCount = 0;
  if (gbpAuditData && typeof gbpAuditData.photoCount === 'number') {
    photoCount = gbpAuditData.photoCount;
  } else if (placeData && Array.isArray(placeData.photos)) {
    photoCount = placeData.photos.length;
  }
  var hasPhotoData = (gbpAuditData && typeof gbpAuditData.photoCount === 'number') ||
                     (placeData && Array.isArray(placeData.photos));
  if (hasPhotoData) {
    var pScore;
    if (photoCount >= 10) pScore = 3;
    else if (photoCount >= 5) pScore = 2;
    else if (photoCount >= 1) pScore = 1;
    else pScore = 0;
    breakdown.photos = {
      score: pScore, max: 3,
      detail: photoCount + ' photos on profile',
      dataSource: 'real'
    };
  } else {
    breakdown.photos = { score: 0, max: 3, detail: 'Photo data unavailable', dataSource: 'default' };
  }

  // qAndA (max 2) — requires gbpAuditData
  if (gbpAuditData) {
    breakdown.qAndA = {
      score: gbpAuditData.hasQAndA ? 2 : 0, max: 2,
      detail: gbpAuditData.hasQAndA ? 'Q&A content present' : 'No Q&A content',
      dataSource: 'real'
    };
  } else {
    breakdown.qAndA = { score: 0, max: 2, detail: 'Q&A data unavailable (connect GBP)', dataSource: 'default' };
  }

  // recentPosts (max 2) — requires gbpAuditData
  if (gbpAuditData) {
    breakdown.recentPosts = {
      score: gbpAuditData.hasRecentPosts ? 2 : 0, max: 2,
      detail: gbpAuditData.hasRecentPosts ? 'Recent GBP posts found' : 'No recent GBP posts',
      dataSource: 'real'
    };
  } else {
    breakdown.recentPosts = { score: 0, max: 2, detail: 'GBP post data unavailable (connect GBP)', dataSource: 'default' };
  }

  // servicesMenu (max 2) — requires gbpAuditData
  if (gbpAuditData) {
    breakdown.servicesMenu = {
      score: gbpAuditData.hasServices ? 2 : 0, max: 2,
      detail: gbpAuditData.hasServices ? 'Services menu present' : 'No services menu',
      dataSource: 'real'
    };
  } else {
    breakdown.servicesMenu = { score: 0, max: 2, detail: 'Services data unavailable (connect GBP)', dataSource: 'default' };
  }

  var total = breakdown.categoryAccuracy.score + breakdown.businessDescription.score +
              breakdown.contactInfo.score + breakdown.photos.score +
              breakdown.qAndA.score + breakdown.recentPosts.score + breakdown.servicesMenu.score;

  return {
    score: Math.min(20, total),
    max: 20,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Pillar 3 — Web Presence (max 20) ──────────────────────────────────────────

function scoreAiCrawlReadiness(widgetSignals) {
  if (!widgetSignals) {
    return { score: 1, max: 3, detail: 'AI crawl readiness data unavailable', dataSource: 'default' };
  }

  var score = 0;
  var summary = widgetSignals.webPresenceSummary;

  // robots.txt / AI crawler access (0-2 points)
  if (summary && summary.blocksAiCrawlers === false) {
    score += 2;
  } else if (summary && summary.blocksAiCrawlers === true) {
    score += 0;
  } else {
    score += 1; // unknown — assume partial access
  }

  // llms.txt presence (0-1 point max — Section 2.4)
  if (summary && summary.hasLlmsTxt) {
    score += 1;
  }

  var detail;
  if (summary && summary.blocksAiCrawlers) {
    detail = 'AI crawlers are blocked by robots.txt';
  } else if (summary && summary.hasLlmsTxt) {
    detail = 'AI crawlers can access your site and llms.txt is present';
  } else {
    detail = 'AI crawlers can access your site';
  }

  return { score: Math.min(score, 3), max: 3, detail: detail, dataSource: 'real' };
}

function scoreWebPresence(placeData, pageSpeedData, widgetSignals) {
  var breakdown = {};

  // hasWebsite (max 3)
  if (placeData) {
    breakdown.hasWebsite = {
      score: placeData.website ? 3 : 0, max: 3,
      detail: placeData.website ? 'Website found: ' + placeData.website : 'No website detected',
      dataSource: 'real'
    };
  } else {
    breakdown.hasWebsite = { score: 1, max: 3, detail: 'Website data unavailable', dataSource: 'default' };
  }

  // mobileOptimized (max 3)
  if (pageSpeedData) {
    var mobScore = typeof pageSpeedData.mobileScore === 'number' ? pageSpeedData.mobileScore : null;
    // Also accept categories.performance.score (0-1 scale) × 100
    if (mobScore === null && pageSpeedData.mobile && pageSpeedData.mobile.categories &&
        pageSpeedData.mobile.categories.performance) {
      mobScore = Math.round(pageSpeedData.mobile.categories.performance.score * 100);
    }
    if (mobScore !== null) {
      var moScore;
      if (mobScore >= 90) moScore = 3;
      else if (mobScore >= 70) moScore = 2;
      else if (mobScore >= 50) moScore = 1;
      else moScore = 0;
      breakdown.mobileOptimized = {
        score: moScore, max: 3,
        detail: 'Mobile performance score: ' + mobScore,
        dataSource: 'real'
      };
    } else {
      breakdown.mobileOptimized = { score: 1, max: 3, detail: 'Mobile score not available', dataSource: 'default' };
    }
  } else {
    breakdown.mobileOptimized = { score: 1, max: 3, detail: 'PageSpeed data unavailable', dataSource: 'default' };
  }

  // pageLoadPerformance (max 4)
  if (pageSpeedData) {
    var perfScore = typeof pageSpeedData.score === 'number' ? pageSpeedData.score : null;
    if (perfScore === null && pageSpeedData.categories && pageSpeedData.categories.performance) {
      perfScore = Math.round(pageSpeedData.categories.performance.score * 100);
    }
    if (perfScore !== null) {
      var plScore;
      if (perfScore >= 90) plScore = 4;
      else if (perfScore >= 75) plScore = 3;
      else if (perfScore >= 60) plScore = 2;
      else if (perfScore >= 40) plScore = 1;
      else plScore = 0;
      breakdown.pageLoadPerformance = {
        score: plScore, max: 4,
        detail: 'Performance score: ' + perfScore,
        dataSource: 'real'
      };
    } else {
      breakdown.pageLoadPerformance = { score: 1, max: 4, detail: 'Performance score not available', dataSource: 'default' };
    }
  } else {
    breakdown.pageLoadPerformance = { score: 1, max: 4, detail: 'PageSpeed data unavailable', dataSource: 'default' };
  }

  // schemaMarkup (max 4)
  if (widgetSignals && widgetSignals.webPresenceSummary) {
    breakdown.schemaMarkup = {
      score: widgetSignals.webPresenceSummary.hasSchemaMarkup ? 4 : 0, max: 4,
      detail: widgetSignals.webPresenceSummary.hasSchemaMarkup ? 'Schema markup detected' : 'No schema markup detected',
      dataSource: 'real'
    };
  } else {
    breakdown.schemaMarkup = { score: 0, max: 4, detail: 'Schema markup data unavailable', dataSource: 'default' };
  }

  // aiCrawlReadiness (max 3) — uses dedicated function per Section 2.4
  breakdown.aiCrawlReadiness = scoreAiCrawlReadiness(widgetSignals);

  // contentDepth (max 3)
  if (widgetSignals && widgetSignals.webPresenceSummary &&
      typeof widgetSignals.webPresenceSummary.contentWordCount === 'number') {
    var words = widgetSignals.webPresenceSummary.contentWordCount;
    var cdScore;
    if (words >= 1500) cdScore = 3;
    else if (words >= 750) cdScore = 2;
    else if (words >= 200) cdScore = 1;
    else cdScore = 0;
    breakdown.contentDepth = {
      score: cdScore, max: 3,
      detail: words + ' words of content detected',
      dataSource: 'real'
    };
  } else {
    breakdown.contentDepth = { score: 1, max: 3, detail: 'Content depth data unavailable', dataSource: 'default' };
  }

  var total = breakdown.hasWebsite.score + breakdown.mobileOptimized.score +
              breakdown.pageLoadPerformance.score + breakdown.schemaMarkup.score +
              breakdown.aiCrawlReadiness.score + breakdown.contentDepth.score;

  return {
    score: Math.min(20, total),
    max: 20,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Pillar 4 — Citation Presence (max 15) ─────────────────────────────────────

function scoreCitationPresence(serperResults, placeData) {
  var breakdown = {};

  // majorDirectories (max 5)
  if (serperResults && typeof serperResults.directoryCount === 'number') {
    var dirs = serperResults.directoryCount;
    var mdScore;
    if (dirs >= 8) mdScore = 5;
    else if (dirs >= 6) mdScore = 4;
    else if (dirs >= 4) mdScore = 3;
    else if (dirs >= 2) mdScore = 2;
    else if (dirs >= 1) mdScore = 1;
    else mdScore = 0;
    breakdown.majorDirectories = {
      score: mdScore, max: 5,
      detail: dirs + ' directory listings found',
      dataSource: 'real'
    };
  } else {
    breakdown.majorDirectories = { score: 1, max: 5, detail: 'Directory data unavailable', dataSource: 'default' };
  }

  // napConsistency (max 4)
  if (serperResults && typeof serperResults.napConsistency === 'number') {
    var nap = serperResults.napConsistency;
    var napScore;
    if (nap >= 90) napScore = 4;
    else if (nap >= 60) napScore = 3;
    else if (nap >= 40) napScore = 2;
    else if (nap >= 20) napScore = 1;
    else napScore = 0;
    breakdown.napConsistency = {
      score: napScore, max: 4,
      detail: nap + '% NAP consistency across listings',
      dataSource: 'real'
    };
  } else {
    breakdown.napConsistency = { score: 1, max: 4, detail: 'NAP consistency data unavailable', dataSource: 'default' };
  }

  // localAuthoritySites (max 3)
  if (serperResults && typeof serperResults.localAuthoritySiteCount === 'number') {
    var las = serperResults.localAuthoritySiteCount;
    var lasScore;
    if (las >= 3) lasScore = 3;
    else if (las >= 2) lasScore = 2;
    else if (las >= 1) lasScore = 1;
    else lasScore = 0;
    breakdown.localAuthoritySites = {
      score: lasScore, max: 3,
      detail: las + ' local authority site mentions',
      dataSource: 'real'
    };
  } else {
    breakdown.localAuthoritySites = { score: 0, max: 3, detail: 'Local authority data unavailable', dataSource: 'default' };
  }

  // backlinkStrength (max 3)
  if (serperResults && typeof serperResults.backlinkCount === 'number') {
    var bl = serperResults.backlinkCount;
    var blScore;
    if (bl >= 50) blScore = 3;
    else if (bl >= 20) blScore = 2;
    else if (bl >= 5) blScore = 1;
    else blScore = 0;
    breakdown.backlinkStrength = {
      score: blScore, max: 3,
      detail: bl + ' backlinks detected',
      dataSource: 'real'
    };
  } else {
    breakdown.backlinkStrength = { score: 0, max: 3, detail: 'Backlink data unavailable', dataSource: 'default' };
  }

  var total = breakdown.majorDirectories.score + breakdown.napConsistency.score +
              breakdown.localAuthoritySites.score + breakdown.backlinkStrength.score;

  return {
    score: Math.min(15, total),
    max: 15,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Pillar 5 — AI Visibility (max 10) ─────────────────────────────────────────

function scoreAiVisibility(aiVisibilityData) {
  var breakdown = {};

  if (!aiVisibilityData || aiVisibilityData.status === 'unavailable') {
    breakdown.mentionRate = { score: 1, max: 5, detail: 'AI visibility data unavailable', dataSource: 'default' };
    breakdown.sentiment = { score: 1, max: 3, detail: 'Sentiment data unavailable', dataSource: 'default' };
    breakdown.positionInResponse = { score: 0, max: 2, detail: 'Position data unavailable', dataSource: 'default' };
    return {
      score: 2, max: 10,
      confidence: 'low',
      breakdown: breakdown
    };
  }

  // mentionRate (max 5)
  var avgRate = (aiVisibilityData.marketSummary && typeof aiVisibilityData.marketSummary.avgMentionRate === 'number')
    ? aiVisibilityData.marketSummary.avgMentionRate : 0;
  var mrScore;
  if (avgRate >= 70) mrScore = 5;
  else if (avgRate >= 50) mrScore = 4;
  else if (avgRate >= 30) mrScore = 3;
  else if (avgRate >= 15) mrScore = 2;
  else if (avgRate > 0) mrScore = 1;
  else mrScore = 0;
  breakdown.mentionRate = {
    score: mrScore, max: 5,
    detail: avgRate + '% average AI mention rate',
    dataSource: 'real'
  };

  // sentiment (max 3) — derived from lead verdicts
  var leadScores = aiVisibilityData.leadScores || [];
  var frequently = leadScores.filter(function(l) { return l.verdict === 'frequently_mentioned'; }).length;
  var sometimes = leadScores.filter(function(l) { return l.verdict === 'sometimes_mentioned'; }).length;
  var sentScore;
  if (frequently > 0 && frequently >= leadScores.length / 2) sentScore = 3;
  else if (sometimes > 0 || frequently > 0) sentScore = 2;
  else if (avgRate > 0) sentScore = 1;
  else sentScore = 0;
  breakdown.sentiment = {
    score: sentScore, max: 3,
    detail: frequently + ' leads frequently mentioned, ' + sometimes + ' sometimes mentioned',
    dataSource: 'real'
  };

  // positionInResponse (max 2)
  var posScore;
  if (avgRate >= 50) posScore = 2;
  else if (avgRate > 0) posScore = 1;
  else posScore = 0;
  breakdown.positionInResponse = {
    score: posScore, max: 2,
    detail: avgRate >= 50 ? 'Mentioned consistently — likely appears early in responses' : 'Mentioned occasionally',
    dataSource: 'real'
  };

  var total = breakdown.mentionRate.score + breakdown.sentiment.score + breakdown.positionInResponse.score;

  return {
    score: Math.min(10, total),
    max: 10,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Pillar 6 — Competitive Position (max 10) ──────────────────────────────────

function scoreCompetitivePosition(placeData, competitorData, benchmarks) {
  var breakdown = {};

  // ratingVsMarket (max 3)
  if (placeData && typeof placeData.rating === 'number') {
    var rating = placeData.rating;
    var rvmScore;
    if (rating >= benchmarks.avgRating + 0.4) rvmScore = 3;
    else if (rating >= benchmarks.avgRating) rvmScore = 2;
    else if (rating >= benchmarks.avgRating - 0.3) rvmScore = 1;
    else rvmScore = 0;
    breakdown.ratingVsMarket = {
      score: rvmScore, max: 3,
      detail: rating.toFixed(1) + ' vs market avg ' + benchmarks.avgRating,
      dataSource: 'real'
    };
  } else {
    breakdown.ratingVsMarket = { score: 1, max: 3, detail: 'Rating data unavailable', dataSource: 'default' };
  }

  // reviewCountPercentile (max 3)
  if (placeData && typeof placeData.user_ratings_total === 'number') {
    var count = placeData.user_ratings_total;
    var pctRatio = benchmarks.avgReviewCount > 0 ? count / benchmarks.avgReviewCount : 0;
    var rcpScore;
    if (pctRatio >= 1.5) rcpScore = 3;
    else if (pctRatio >= 1) rcpScore = 2;
    else if (pctRatio >= 0.5) rcpScore = 1;
    else rcpScore = 0;
    breakdown.reviewCountPercentile = {
      score: rcpScore, max: 3,
      detail: count + ' reviews vs market avg ' + benchmarks.avgReviewCount,
      dataSource: 'real'
    };
  } else {
    breakdown.reviewCountPercentile = { score: 1, max: 3, detail: 'Review count unavailable', dataSource: 'default' };
  }

  // digitalPresenceVsMedian (max 2)
  // We derive this from placeData.website + any passed-in serperResults via placeData._directoryCount
  // The caller can pass directoryCount via placeData._directoryCount as a convenience
  var hasWebsite = !!(placeData && placeData.website);
  var dirCount = (placeData && typeof placeData._directoryCount === 'number') ? placeData._directoryCount : 0;
  if (placeData) {
    var dpScore;
    if (hasWebsite && dirCount >= 3) dpScore = 2;
    else if (hasWebsite || dirCount >= 2) dpScore = 1;
    else dpScore = 0;
    breakdown.digitalPresenceVsMedian = {
      score: dpScore, max: 2,
      detail: (hasWebsite ? 'Has website' : 'No website') + ', ' + dirCount + ' directories',
      dataSource: 'real'
    };
  } else {
    breakdown.digitalPresenceVsMedian = { score: 0, max: 2, detail: 'Digital presence data unavailable', dataSource: 'default' };
  }

  // uniqueDifferentiator (max 2)
  if (competitorData && competitorData.competitors && competitorData.competitors.length > 0) {
    var merchantRating = placeData ? (placeData.rating || 0) : 0;
    var compRatings = competitorData.competitors
      .filter(function(c) { return typeof c.rating === 'number'; })
      .map(function(c) { return c.rating; });
    if (compRatings.length > 0) {
      var avgCompRating = compRatings.reduce(function(s, r) { return s + r; }, 0) / compRatings.length;
      var udScore;
      if (merchantRating >= avgCompRating + 0.3) udScore = 2;
      else if (merchantRating >= avgCompRating) udScore = 1;
      else udScore = 0;
      breakdown.uniqueDifferentiator = {
        score: udScore, max: 2,
        detail: merchantRating.toFixed(1) + ' rating vs competitor avg ' + avgCompRating.toFixed(1),
        dataSource: 'real'
      };
    } else {
      breakdown.uniqueDifferentiator = { score: 0, max: 2, detail: 'Competitor rating data unavailable', dataSource: 'default' };
    }
  } else {
    breakdown.uniqueDifferentiator = { score: 0, max: 2, detail: 'Competitor data unavailable', dataSource: 'default' };
  }

  var total = breakdown.ratingVsMarket.score + breakdown.reviewCountPercentile.score +
              breakdown.digitalPresenceVsMedian.score + breakdown.uniqueDifferentiator.score;

  return {
    score: Math.min(10, total),
    max: 10,
    confidence: calculatePillarConfidence(breakdown),
    breakdown: breakdown
  };
}

// ── Action generation ──────────────────────────────────────────────────────────

function generateActions(pillars, maxActions) {
  var allActions = [];
  var pillarNames = Object.keys(pillars);

  for (var pi = 0; pi < pillarNames.length; pi++) {
    var pillarName = pillarNames[pi];
    var pillarData = pillars[pillarName];
    var subNames = Object.keys(pillarData.breakdown);

    for (var si = 0; si < subNames.length; si++) {
      var subName = subNames[si];
      var subData = pillarData.breakdown[subName];
      var gap = subData.max - subData.score;

      if (gap > 0) {
        var impact;
        if (gap >= 4) impact = 'high';
        else if (gap >= 2) impact = 'medium';
        else impact = 'low';

        allActions.push({
          pillar:          pillarName,
          category:        (ACTION_CATEGORIES[pillarName] && ACTION_CATEGORIES[pillarName][subName]) || 'content_gap',
          title:           (ACTION_TITLES[pillarName] && ACTION_TITLES[pillarName][subName]) || ('Improve ' + subName),
          whyItMatters:    (ACTION_WHY[pillarName] && ACTION_WHY[pillarName][subName]) || ('Improving ' + subName + ' increases your AI readiness score.'),
          impact:          impact,
          difficulty:      (ACTION_DIFFICULTY[pillarName] && ACTION_DIFFICULTY[pillarName][subName]) || 'medium',
          pointsAvailable: gap,
          linkedProduct:   (PRODUCT_MAP[pillarName] && PRODUCT_MAP[pillarName][subName]) !== undefined
                             ? PRODUCT_MAP[pillarName][subName] : null,
          ctaTarget:       (ACTION_CTA[pillarName] && ACTION_CTA[pillarName][subName]) || null,
          status:          'open'
        });
      }
    }
  }

  // Sort: impact (high→low), then pointsAvailable (desc)
  var impactOrder = { high: 0, medium: 1, low: 2 };
  allActions.sort(function(a, b) {
    if (impactOrder[a.impact] !== impactOrder[b.impact]) {
      return impactOrder[a.impact] - impactOrder[b.impact];
    }
    return b.pointsAvailable - a.pointsAvailable;
  });

  return allActions.slice(0, maxActions);
}

// ── Main export ────────────────────────────────────────────────────────────────

async function scoreAiReadiness(merchantData, mode, options) {
  if (!options) options = {};

  var placeData       = merchantData.placeData       || null;
  var gbpAuditData    = merchantData.gbpAuditData    || null;
  var reviewData      = merchantData.reviewData      || null;
  var pageSpeedData   = merchantData.pageSpeedData   || null;
  var serperResults   = merchantData.serperResults   || null;
  var widgetSignals   = merchantData.widgetSignals   || null;
  var aiVisibilityData = merchantData.aiVisibilityData || null;
  var competitorData  = merchantData.competitorData  || null;
  var marketBenchmarks = merchantData.marketBenchmarks || null;

  var benchmarks = marketBenchmarks || DEFAULT_BENCHMARKS;

  // Inject directoryCount into placeData for competitivePosition pillar
  if (placeData && serperResults && typeof serperResults.directoryCount === 'number') {
    placeData = Object.assign({}, placeData, { _directoryCount: serperResults.directoryCount });
  }

  var reviewAuthority    = scoreReviewAuthority(placeData, reviewData, benchmarks);
  var gbpCompleteness    = scoreGbpCompleteness(placeData, gbpAuditData);
  var webPresence        = scoreWebPresence(placeData, pageSpeedData, widgetSignals);
  var citationPresence   = scoreCitationPresence(serperResults, placeData);
  var aiVisibility       = scoreAiVisibility(aiVisibilityData);
  var competitivePosition = scoreCompetitivePosition(placeData, competitorData, benchmarks);

  var pillars = {
    reviewAuthority:    reviewAuthority,
    gbpCompleteness:    gbpCompleteness,
    webPresence:        webPresence,
    citationPresence:   citationPresence,
    aiVisibility:       aiVisibility,
    competitivePosition: competitivePosition
  };

  var totalScore = Object.keys(pillars).reduce(function(sum, k) {
    return sum + pillars[k].score;
  }, 0);

  var confidence = calculateConfidence(pillars, merchantData);

  var maxActions = mode === 'lead_magnet' ? 3 : 5;
  var actions = generateActions(pillars, maxActions);

  // Tier mapping from mode
  var tierMap = { lead_magnet: 'lead_magnet', merchant_lite: 'lite', merchant_full: 'growth' };
  var aisynchTier = (options && options.tier) || tierMap[mode] || 'lead_magnet';

  return {
    totalScore: Math.min(100, Math.max(0, totalScore)),
    schemaVersion: '1.0',
    mode: mode,
    aisynchTier: aisynchTier,
    confidenceLevel: confidence.confidenceLevel,
    confidenceLabel: confidence.confidenceLabel,
    dataCompleteness: confidence.dataCompleteness,
    pillars: pillars,
    actions: actions,
    dataSources: {
      placesApiUsed:    !!placeData,
      gbpAuditUsed:     !!gbpAuditData,
      pageSpeedUsed:    !!pageSpeedData,
      serperUsed:       !!serperResults,
      aiVisibilityUsed: !!aiVisibilityData,
      widgetSignalsUsed: !!widgetSignals
    },
    scoredAt: new Date().toISOString()
  };
}

module.exports = { scoreAiReadiness };
