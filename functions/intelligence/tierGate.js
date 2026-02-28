/**
 * Tier Gating for Intelligence Features
 *
 * Controls which collectors and features are available
 * based on the user's subscription tier.
 */

/**
 * Feature configuration by tier
 * Phase 1: All tiers get two-pass generation with existing data sources
 * Later phases will differentiate more significantly
 */
const TIER_FEATURES = {
    starter: {
        collectors: ['websiteAnalysis', 'googlePlaces'],
        maxSignals: 5,
        twoPassGeneration: true,
        painPointHypotheses: true,
        customSignals: false,
        tamScoring: false,
        engagementSignals: false,
    },
    growth: {
        collectors: ['websiteAnalysis', 'googlePlaces', 'contactEnrichment'],
        maxSignals: 10,
        twoPassGeneration: true,
        painPointHypotheses: true,
        customSignals: true,
        tamScoring: false,
        engagementSignals: false,
    },
    scale: {
        collectors: ['websiteAnalysis', 'googlePlaces', 'contactEnrichment'],
        maxSignals: 15,
        twoPassGeneration: true,
        painPointHypotheses: true,
        customSignals: true,
        tamScoring: true,
        engagementSignals: false,
    },
    enterprise: {
        collectors: ['websiteAnalysis', 'googlePlaces', 'contactEnrichment'],
        maxSignals: 20,
        twoPassGeneration: true,
        painPointHypotheses: true,
        customSignals: true,
        tamScoring: true,
        engagementSignals: true,
    },
};

/**
 * Get tier configuration for a user
 * @param {string} userTier - User's subscription tier
 * @returns {object} Tier configuration
 */
function getTierConfig(userTier) {
    const tier = (userTier || 'starter').toLowerCase();
    return TIER_FEATURES[tier] || TIER_FEATURES.starter;
}

/**
 * Check if a specific feature is enabled for a tier
 * @param {string} userTier - User's subscription tier
 * @param {string} feature - Feature name to check
 * @returns {boolean} Whether feature is enabled
 */
function isFeatureEnabled(userTier, feature) {
    const config = getTierConfig(userTier);
    return config[feature] === true;
}

/**
 * Get list of enabled collectors for a tier
 * @param {string} userTier - User's subscription tier
 * @returns {string[]} List of collector names
 */
function getEnabledCollectors(userTier) {
    const config = getTierConfig(userTier);
    return config.collectors || [];
}

/**
 * Get maximum number of signals to include in synthesis
 * @param {string} userTier - User's subscription tier
 * @returns {number} Maximum signal count
 */
function getMaxSignals(userTier) {
    const config = getTierConfig(userTier);
    return config.maxSignals || 5;
}

module.exports = {
    TIER_FEATURES,
    getTierConfig,
    isFeatureEnabled,
    getEnabledCollectors,
    getMaxSignals,
};
