/**
 * Gemini API Configuration
 *
 * Configuration for Google Gemini API integration with model routing,
 * A/B testing support, and feature flags for gradual migration from Claude.
 */

const GEMINI_CONFIG = {
    // Model definitions with their capabilities
    models: {
        'gemini-3-pro': {
            id: 'gemini-3-pro',
            displayName: 'Gemini 3 Pro',
            tier: 'premium',
            maxTokens: 8192,
            contextWindow: 1000000,
            supportsStreaming: true,
            supportsCaching: true,
            pricing: { input: 1.25 / 1000000, output: 5 / 1000000 }
        },
        'gemini-3-flash': {
            id: 'gemini-3-flash',
            displayName: 'Gemini 3 Flash',
            tier: 'standard',
            maxTokens: 8192,
            contextWindow: 1000000,
            supportsStreaming: true,
            supportsCaching: true,
            pricing: { input: 0.075 / 1000000, output: 0.30 / 1000000 }
        },
        'gemini-2.5-flash': {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            tier: 'economy',
            maxTokens: 8192,
            contextWindow: 1000000,
            supportsStreaming: true,
            supportsCaching: true,
            pricing: { input: 0.075 / 1000000, output: 0.30 / 1000000 }
        }
    },

    // Operation-based model routing (Quality-First approach)
    modelRouting: {
        // Narrative generation - highest quality requirement
        narrativeGeneration: {
            primary: 'gemini-3-pro',
            fallback: 'gemini-3-flash',
            temperature: 0.7,
            maxTokens: 4096
        },
        // Narrative validation - deterministic, accuracy-focused
        narrativeValidation: {
            primary: 'gemini-3-pro',
            fallback: 'gemini-3-flash',
            temperature: 0.2,
            maxTokens: 2048
        },
        // Premium formatters (deck, proposal, executive summary)
        premiumFormatting: {
            primary: 'gemini-3-pro',
            fallback: 'gemini-3-flash',
            temperature: 0.5,
            maxTokens: 3000
        },
        // Basic formatters (sales pitch, one-pager, email, linkedin)
        basicFormatting: {
            primary: 'gemini-3-flash',
            fallback: null,
            temperature: 0.5,
            maxTokens: 3000
        },
        // Website analysis and onboarding
        onboarding: {
            primary: 'gemini-2.5-flash',
            fallback: 'gemini-3-flash',
            temperature: 0.3,
            maxTokens: 2048
        }
    },

    // Formatter to model tier mapping
    formatterModelTier: {
        sales_pitch: 'basicFormatting',
        one_pager: 'basicFormatting',
        email_sequence: 'basicFormatting',
        linkedin: 'basicFormatting',
        executive_summary: 'premiumFormatting',
        deck: 'premiumFormatting',
        proposal: 'premiumFormatting'
    },

    // Retry and timeout settings
    maxRetries: 3,
    retryDelayMs: 1000,
    timeout: 60000,

    // Streaming configuration
    streaming: {
        enabled: true,
        chunkSize: 100, // Approximate tokens per chunk
        progressUpdateInterval: 500 // ms between progress updates
    },

    // Context caching configuration
    caching: {
        enabled: true,
        systemPromptTtl: 60 * 60 * 1000, // 1 hour in ms
        contextTtl: 5 * 60 * 1000, // 5 minutes in ms
        maxCachedTokens: 32000
    },

    // Cost management
    dailyBudgetUsd: parseFloat(process.env.GEMINI_DAILY_BUDGET_USD) || 50,

    // Feature flags for gradual migration
    featureFlags: {
        // Master switch for Gemini usage
        enableGemini: process.env.ENABLE_GEMINI === 'true',
        // Use Claude as fallback when Gemini fails
        fallbackToClaude: process.env.FALLBACK_TO_CLAUDE !== 'false',
        // Fall back to templates if all AI fails
        fallbackToTemplates: process.env.FALLBACK_TO_TEMPLATES !== 'false',
        // Enable A/B testing
        enableAbTesting: process.env.ENABLE_AB_TESTING === 'true',
        // Enable user feedback collection
        enableFeedback: process.env.ENABLE_FEEDBACK === 'true',
        // Enable streaming for narrative generation
        enableStreaming: process.env.ENABLE_STREAMING === 'true',
        // Enable prompt caching
        enablePromptCaching: process.env.ENABLE_PROMPT_CACHING === 'true',
        // Percentage of traffic to route to Gemini (0-100)
        geminiTrafficPercent: parseInt(process.env.GEMINI_TRAFFIC_PERCENT, 10) || 0
    },

    // Rollback thresholds
    rollbackThresholds: {
        errorRatePercent: 5, // > 5% error rate triggers concern
        p95LatencyMs: 30000, // > 30 second P95 triggers concern
        feedbackScoreDropPercent: 20 // > 20% drop in feedback score triggers concern
    }
};

/**
 * Get model configuration by model ID
 */
function getModelConfig(modelId) {
    return GEMINI_CONFIG.models[modelId] || null;
}

/**
 * Get routing configuration for an operation
 */
function getRoutingConfig(operation) {
    return GEMINI_CONFIG.modelRouting[operation] || GEMINI_CONFIG.modelRouting.basicFormatting;
}

/**
 * Get model tier for a formatter type
 */
function getFormatterModelTier(formatterType) {
    return GEMINI_CONFIG.formatterModelTier[formatterType] || 'basicFormatting';
}

/**
 * Check if Gemini is enabled and should be used
 */
function shouldUseGemini() {
    if (!GEMINI_CONFIG.featureFlags.enableGemini) {
        return false;
    }

    // Traffic percentage routing
    const trafficPercent = GEMINI_CONFIG.featureFlags.geminiTrafficPercent;
    if (trafficPercent <= 0) {
        return false;
    }
    if (trafficPercent >= 100) {
        return true;
    }

    // Random traffic split
    return Math.random() * 100 < trafficPercent;
}

/**
 * Check if a feature flag is enabled
 */
function isFeatureEnabled(featureName) {
    return GEMINI_CONFIG.featureFlags[featureName] === true;
}

/**
 * Calculate cost for Gemini token usage
 */
function calculateCost(usage, modelId = 'gemini-3-flash') {
    const model = GEMINI_CONFIG.models[modelId];
    if (!model) {
        return 0;
    }
    return (usage.inputTokens * model.pricing.input) + (usage.outputTokens * model.pricing.output);
}

/**
 * Get the fallback chain for an operation
 * Returns array of model IDs to try in order
 */
function getFallbackChain(operation) {
    const routing = getRoutingConfig(operation);
    const chain = [routing.primary];

    if (routing.fallback) {
        chain.push(routing.fallback);
    }

    // Add Claude fallback if enabled
    if (GEMINI_CONFIG.featureFlags.fallbackToClaude) {
        chain.push('claude'); // Special marker for Claude fallback
    }

    // Add template fallback if enabled
    if (GEMINI_CONFIG.featureFlags.fallbackToTemplates) {
        chain.push('template'); // Special marker for template fallback
    }

    return chain;
}

module.exports = {
    GEMINI_CONFIG,
    getModelConfig,
    getRoutingConfig,
    getFormatterModelTier,
    shouldUseGemini,
    isFeatureEnabled,
    calculateCost,
    getFallbackChain
};
