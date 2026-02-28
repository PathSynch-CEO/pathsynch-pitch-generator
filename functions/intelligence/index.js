/**
 * Intelligence Engine
 *
 * Main entry point for the intelligence pipeline.
 * Exports the orchestrator and supporting utilities.
 */

const { generateIntelligentBrief, extractBasicSignals } = require('./orchestrator');
const { synthesizeInsights } = require('./synthesis/insightSynthesizer');
const { generateBrief } = require('./generation/briefGenerator');
const { getTierConfig, isFeatureEnabled, getEnabledCollectors, getMaxSignals } = require('./tierGate');
const { BANNED_PHRASES, SIGNAL_CATEGORIES, MEETING_TYPES, genericityTest } = require('./constants');

module.exports = {
    // Main orchestrator
    generateIntelligentBrief,
    extractBasicSignals,

    // Individual pipeline stages (for testing/debugging)
    synthesizeInsights,
    generateBrief,

    // Tier gating
    getTierConfig,
    isFeatureEnabled,
    getEnabledCollectors,
    getMaxSignals,

    // Constants and utilities
    BANNED_PHRASES,
    SIGNAL_CATEGORIES,
    MEETING_TYPES,
    genericityTest,
};
