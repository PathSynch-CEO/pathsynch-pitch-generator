/**
 * Tier Gating Utility
 *
 * Checks if a merchant's plan meets the minimum tier for a feature.
 * Matches the existing planGate.js local array pattern from SynchIntro.
 */

const { PLAN_HIERARCHY, TIER_CHANNEL_LIMITS, EVENT_TYPE_MIN_TIER } = require('../config/constants');

/**
 * Check if userPlan meets the minimum required tier.
 *
 * @param {string} userPlan - The user's current plan (e.g., 'growth')
 * @param {string} minimumTier - The minimum required tier (e.g., 'scale')
 * @returns {boolean}
 */
function meetsMinTier(userPlan, minimumTier) {
    const planHierarchy = PLAN_HIERARCHY;
    const userIndex = planHierarchy.indexOf(userPlan);
    const requiredIndex = planHierarchy.indexOf(minimumTier);

    // Unknown plan or unknown required tier — deny access (fail closed)
    if (userIndex === -1 || requiredIndex === -1) {
        return false;
    }

    return userIndex >= requiredIndex;
}

/**
 * Get the channel limit for a plan tier.
 *
 * @param {string} plan - Plan name
 * @returns {number} Maximum channels allowed (Infinity for enterprise)
 */
function getChannelLimit(plan) {
    return TIER_CHANNEL_LIMITS[plan] ?? TIER_CHANNEL_LIMITS.starter;
}

/**
 * Check if a merchant's plan allows receiving a specific event type.
 *
 * @param {string} userPlan - The user's current plan
 * @param {string} eventType - The event type to check
 * @returns {boolean}
 */
function canReceiveEventType(userPlan, eventType) {
    const minTier = EVENT_TYPE_MIN_TIER[eventType];
    if (!minTier) {
        // Unknown event type — allow by default (fail open for event types
        // not yet in the gating matrix, since they may be Phase 3+)
        return true;
    }
    return meetsMinTier(userPlan, minTier);
}

module.exports = { meetsMinTier, getChannelLimit, canReceiveEventType };
