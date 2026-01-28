/**
 * Claude API Configuration
 *
 * Configuration for Anthropic Claude API integration
 */

const CLAUDE_CONFIG = {
    // Model settings
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS, 10) || 4096,

    // Temperature settings for different use cases
    temperatures: {
        narrative: 0.7,      // Creative but consistent
        validation: 0.2,     // More deterministic
        formatting: 0.5      // Balanced
    },

    // Cost management
    dailyBudgetUsd: parseFloat(process.env.CLAUDE_DAILY_BUDGET_USD) || 50,

    // Feature flags
    enableAiNarratives: process.env.ENABLE_AI_NARRATIVES !== 'false',
    fallbackToTemplates: process.env.FALLBACK_TO_TEMPLATES !== 'false',

    // Retry settings
    maxRetries: 3,
    retryDelayMs: 1000,

    // Timeout settings (in ms)
    timeout: 60000,

    // Token limits per operation
    tokenLimits: {
        narrativeGeneration: 4096,
        validation: 2048,
        formatting: 3000
    }
};

// Formatter availability by plan
const FORMATTER_PLAN_ACCESS = {
    sales_pitch: ['starter', 'growth', 'scale'],
    one_pager: ['starter', 'growth', 'scale'],
    email_sequence: ['growth', 'scale'],
    linkedin: ['growth', 'scale'],
    executive_summary: ['growth', 'scale'],
    deck: ['scale'],
    proposal: ['scale']
};

// Plan limits for narrative features
const NARRATIVE_LIMITS = {
    starter: {
        narrativesPerMonth: 5,
        formatters: ['sales_pitch', 'one_pager'],
        batchFormat: false,
        aiRegenerations: 2
    },
    growth: {
        narrativesPerMonth: 25,
        formatters: ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary'],
        batchFormat: 3, // Max 3 types at once
        aiRegenerations: 10
    },
    scale: {
        narrativesPerMonth: -1, // Unlimited
        formatters: ['sales_pitch', 'one_pager', 'email_sequence', 'linkedin', 'executive_summary', 'deck', 'proposal'],
        batchFormat: true, // All types
        aiRegenerations: -1 // Unlimited
    }
};

/**
 * Check if a formatter is available for a plan
 */
function isFormatterAvailable(formatterType, plan) {
    const allowedPlans = FORMATTER_PLAN_ACCESS[formatterType];
    if (!allowedPlans) return false;
    return allowedPlans.includes(plan);
}

/**
 * Get available formatters for a plan
 */
function getAvailableFormatters(plan) {
    const planConfig = NARRATIVE_LIMITS[plan] || NARRATIVE_LIMITS.starter;
    return planConfig.formatters;
}

/**
 * Check if user can generate more narratives
 */
function canGenerateNarrative(plan, currentCount) {
    const planConfig = NARRATIVE_LIMITS[plan] || NARRATIVE_LIMITS.starter;
    if (planConfig.narrativesPerMonth === -1) return true;
    return currentCount < planConfig.narrativesPerMonth;
}

/**
 * Check if user can use batch formatting
 */
function canBatchFormat(plan, requestedCount) {
    const planConfig = NARRATIVE_LIMITS[plan] || NARRATIVE_LIMITS.starter;
    if (planConfig.batchFormat === false) return false;
    if (planConfig.batchFormat === true) return true;
    return requestedCount <= planConfig.batchFormat;
}

/**
 * Check if user can regenerate with AI
 */
function canRegenerate(plan, currentRegenerations) {
    const planConfig = NARRATIVE_LIMITS[plan] || NARRATIVE_LIMITS.starter;
    if (planConfig.aiRegenerations === -1) return true;
    return currentRegenerations < planConfig.aiRegenerations;
}

module.exports = {
    CLAUDE_CONFIG,
    FORMATTER_PLAN_ACCESS,
    NARRATIVE_LIMITS,
    isFormatterAvailable,
    getAvailableFormatters,
    canGenerateNarrative,
    canBatchFormat,
    canRegenerate
};
