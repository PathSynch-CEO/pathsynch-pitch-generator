/**
 * scoringProfiles.js
 * Per-industry scoring weight profiles for Market Intel.
 * The existing scorer picks weights from here instead of hardcoded values.
 */

const SCORING_PROFILES = {
  default_local_business: {
    reviewCeiling: 400,
    weights: {
      rating: 0.25,
      reviewVolume: 0.25,
      reviewVelocity: 0.15,
      websitePresence: 0.15,
      seoVisibility: 0.10,
      responseRate: 0.10
    },
    competitorLanguage: 'competitors',
    opportunityLanguage: 'opportunity gap'
  },
  b2b_services: {
    reviewCeiling: 150,
    weights: {
      rating: 0.15,
      reviewVolume: 0.10,
      reviewVelocity: 0.05,
      websitePresence: 0.25,
      seoVisibility: 0.20,
      portfolioVisibility: 0.15,
      socialProof: 0.10
    },
    competitorLanguage: 'competitors',
    opportunityLanguage: 'market positioning gap'
  },
  government_public_sector: {
    reviewCeiling: 75,
    weights: {
      rating: 0.05,
      reviewVolume: 0.05,
      websitePresence: 0.30,
      searchVisibility: 0.20,
      citizenEngagement: 0.20,
      serviceDiscoverability: 0.10,
      publicTrust: 0.10
    },
    competitorLanguage: 'peer entities',
    opportunityLanguage: 'public engagement gap'
  },
  nonprofit_association: {
    reviewCeiling: 150,
    weights: {
      rating: 0.10,
      reviewVolume: 0.10,
      websitePresence: 0.20,
      eventVisibility: 0.15,
      donorMemberEngagement: 0.15,
      communityTrust: 0.15,
      searchVisibility: 0.15
    },
    competitorLanguage: 'peer organizations',
    opportunityLanguage: 'community visibility gap'
  }
};

const PROXY_MAP = {
  searchVisibility: 'seoVisibility',
  citizenEngagement: 'websitePresence',
  serviceDiscoverability: 'seoVisibility',
  publicTrust: 'rating',
  eventVisibility: 'websitePresence',
  donorMemberEngagement: 'websitePresence',
  communityTrust: 'rating',
  portfolioVisibility: 'websitePresence',
  socialProof: 'reviewVolume'
};

function getScoringProfile(profileKey) {
  return SCORING_PROFILES[profileKey] || SCORING_PROFILES.default_local_business;
}

function resolveWeights(profile) {
  const resolved = {};
  for (const [key, weight] of Object.entries(profile.weights)) {
    const resolvedKey = PROXY_MAP[key] || key;
    resolved[resolvedKey] = (resolved[resolvedKey] || 0) + weight;
  }
  return resolved;
}

module.exports = { SCORING_PROFILES, getScoringProfile, resolveWeights };
