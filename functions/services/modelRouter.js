/**
 * Model Router Service
 *
 * Intelligent model selection with A/B test integration,
 * fallback chain handling, and unified API for both Claude and Gemini.
 */

const {
    GEMINI_CONFIG,
    getRoutingConfig,
    getFormatterModelTier,
    shouldUseGemini,
    isFeatureEnabled,
    getFallbackChain
} = require('../config/gemini');
const { CLAUDE_CONFIG } = require('../config/claude');

// Import both clients
const claudeClient = require('./claudeClient');
const geminiClientV2 = require('./geminiClientV2');
const abTestingService = require('./abTestingService');

/**
 * Operation types for routing
 */
const OperationType = {
    NARRATIVE_GENERATION: 'narrativeGeneration',
    NARRATIVE_VALIDATION: 'narrativeValidation',
    PREMIUM_FORMATTING: 'premiumFormatting',
    BASIC_FORMATTING: 'basicFormatting',
    ONBOARDING: 'onboarding'
};

/**
 * Determine which model to use for an operation
 * Considers A/B tests, feature flags, and fallback configuration
 */
async function selectModel(operation, userId = null, context = {}) {
    // Check for active A/B test
    let abTestVariant = null;

    if (userId && isFeatureEnabled('enableAbTesting')) {
        const activeTest = await abTestingService.getActiveTestForOperation(operation);
        if (activeTest) {
            abTestVariant = await abTestingService.getVariantForUser(activeTest.testId, userId);
            if (abTestVariant) {
                return {
                    provider: abTestVariant.provider || 'gemini',
                    modelId: abTestVariant.modelId,
                    abTestVariant: {
                        testId: activeTest.testId,
                        variantId: abTestVariant.variantId,
                        variantName: abTestVariant.name
                    },
                    routing: getRoutingConfig(operation)
                };
            }
        }
    }

    // Check if Gemini should be used (based on feature flags and traffic %)
    if (shouldUseGemini()) {
        const routing = getRoutingConfig(operation);
        return {
            provider: 'gemini',
            modelId: routing.primary,
            abTestVariant: null,
            routing
        };
    }

    // Default to Claude
    return {
        provider: 'claude',
        modelId: CLAUDE_CONFIG.model,
        abTestVariant: null,
        routing: {
            temperature: CLAUDE_CONFIG.temperatures.narrative,
            maxTokens: CLAUDE_CONFIG.maxTokens
        }
    };
}

/**
 * Generate a narrative using the selected model
 * Unified interface for Claude and Gemini
 */
async function generateNarrative(systemPrompt, businessData, options = {}) {
    const { userId, stream = false, onProgress = null } = options;

    const modelSelection = await selectModel(OperationType.NARRATIVE_GENERATION, userId);
    const startTime = Date.now();

    let result;
    let fallbackUsed = false;

    try {
        if (modelSelection.provider === 'gemini') {
            result = await geminiClientV2.generateNarrative(systemPrompt, businessData, {
                modelId: modelSelection.modelId,
                stream,
                onProgress
            });
        } else {
            // Claude doesn't support streaming in this implementation
            result = await claudeClient.generateNarrative(systemPrompt, businessData);
        }
    } catch (error) {
        console.error(`Primary model (${modelSelection.provider}) failed:`, error.message);

        // Try fallback chain
        if (modelSelection.provider === 'gemini' && isFeatureEnabled('fallbackToClaude')) {
            console.log('Falling back to Claude...');
            try {
                result = await claudeClient.generateNarrative(systemPrompt, businessData);
                fallbackUsed = true;
            } catch (fallbackError) {
                console.error('Claude fallback failed:', fallbackError.message);
                throw error; // Throw original error
            }
        } else {
            throw error;
        }
    }

    const latencyMs = Date.now() - startTime;

    // Record A/B test event if applicable
    if (modelSelection.abTestVariant && userId) {
        await abTestingService.recordEvent(
            modelSelection.abTestVariant.testId,
            modelSelection.abTestVariant.variantId,
            userId,
            abTestingService.EventType.GENERATION,
            { latencyMs, qualityScore: 0 } // Quality score set later after validation
        );
    }

    return {
        ...result,
        provider: fallbackUsed ? 'claude' : modelSelection.provider,
        modelId: fallbackUsed ? CLAUDE_CONFIG.model : modelSelection.modelId,
        abTestVariant: modelSelection.abTestVariant,
        latencyMs,
        fallbackUsed
    };
}

/**
 * Validate a narrative using the selected model
 */
async function validateNarrative(systemPrompt, narrative, originalData, options = {}) {
    const { userId } = options;

    const modelSelection = await selectModel(OperationType.NARRATIVE_VALIDATION, userId);
    const startTime = Date.now();

    let result;

    try {
        if (modelSelection.provider === 'gemini') {
            result = await geminiClientV2.validateNarrative(
                systemPrompt,
                narrative,
                originalData,
                { modelId: modelSelection.modelId }
            );
        } else {
            result = await claudeClient.validateNarrative(systemPrompt, narrative, originalData);
        }
    } catch (error) {
        console.error(`Validation with ${modelSelection.provider} failed:`, error.message);

        // Try fallback
        if (modelSelection.provider === 'gemini' && isFeatureEnabled('fallbackToClaude')) {
            try {
                result = await claudeClient.validateNarrative(systemPrompt, narrative, originalData);
            } catch (fallbackError) {
                throw error;
            }
        } else {
            throw error;
        }
    }

    const latencyMs = Date.now() - startTime;

    // Record A/B test event
    if (modelSelection.abTestVariant && userId) {
        await abTestingService.recordEvent(
            modelSelection.abTestVariant.testId,
            modelSelection.abTestVariant.variantId,
            userId,
            abTestingService.EventType.GENERATION,
            { latencyMs, qualityScore: result.validation?.score || 0 }
        );
    }

    return {
        ...result,
        provider: modelSelection.provider,
        modelId: modelSelection.modelId,
        abTestVariant: modelSelection.abTestVariant,
        latencyMs
    };
}

/**
 * Format a narrative using the selected model
 * Automatically selects premium or basic formatting based on asset type
 */
async function formatNarrative(systemPrompt, narrative, assetType, options = {}) {
    const { userId, branding = {} } = options;

    // Determine operation type based on asset type
    const operationType = getFormatterModelTier(assetType);
    const modelSelection = await selectModel(operationType, userId);

    const startTime = Date.now();
    let result;

    try {
        if (modelSelection.provider === 'gemini') {
            result = await geminiClientV2.formatNarrative(
                systemPrompt,
                narrative,
                assetType,
                { modelId: modelSelection.modelId, branding }
            );
        } else {
            result = await claudeClient.formatNarrative(systemPrompt, narrative, assetType, { branding });
        }
    } catch (error) {
        console.error(`Formatting with ${modelSelection.provider} failed:`, error.message);

        // Try fallback
        if (modelSelection.provider === 'gemini' && isFeatureEnabled('fallbackToClaude')) {
            try {
                result = await claudeClient.formatNarrative(systemPrompt, narrative, assetType, { branding });
            } catch (fallbackError) {
                throw error;
            }
        } else {
            throw error;
        }
    }

    const latencyMs = Date.now() - startTime;

    return {
        ...result,
        provider: modelSelection.provider,
        modelId: modelSelection.modelId,
        abTestVariant: modelSelection.abTestVariant,
        latencyMs
    };
}

/**
 * Send a generic message using the selected model
 * For custom operations not covered by specific functions
 */
async function sendMessage(options = {}) {
    const {
        systemPrompt,
        userMessage,
        operation = OperationType.BASIC_FORMATTING,
        userId = null,
        maxTokens,
        temperature
    } = options;

    const modelSelection = await selectModel(operation, userId);
    const routing = modelSelection.routing;

    const messageOptions = {
        systemPrompt,
        userMessage,
        maxTokens: maxTokens || routing.maxTokens,
        temperature: temperature !== undefined ? temperature : routing.temperature
    };

    let result;

    try {
        if (modelSelection.provider === 'gemini') {
            result = await geminiClientV2.sendMessage({
                ...messageOptions,
                modelId: modelSelection.modelId
            });
        } else {
            result = await claudeClient.sendMessage(messageOptions);
        }
    } catch (error) {
        // Try fallback
        if (modelSelection.provider === 'gemini' && isFeatureEnabled('fallbackToClaude')) {
            try {
                result = await claudeClient.sendMessage(messageOptions);
            } catch (fallbackError) {
                throw error;
            }
        } else {
            throw error;
        }
    }

    return {
        ...result,
        provider: modelSelection.provider,
        modelId: modelSelection.modelId,
        abTestVariant: modelSelection.abTestVariant
    };
}

/**
 * Stream narrative generation (Gemini only, Claude fallback is non-streaming)
 */
async function streamNarrative(systemPrompt, businessData, options = {}) {
    const { userId, onProgress } = options;

    // Streaming only available with Gemini
    if (!isFeatureEnabled('enableStreaming') || !shouldUseGemini()) {
        // Fall back to non-streaming
        return generateNarrative(systemPrompt, businessData, { userId });
    }

    const modelSelection = await selectModel(OperationType.NARRATIVE_GENERATION, userId);

    if (modelSelection.provider !== 'gemini') {
        // Fall back to non-streaming for Claude
        return generateNarrative(systemPrompt, businessData, { userId });
    }

    const startTime = Date.now();

    try {
        const result = await geminiClientV2.generateNarrative(systemPrompt, businessData, {
            modelId: modelSelection.modelId,
            stream: true,
            onProgress
        });

        const latencyMs = Date.now() - startTime;

        // Record A/B test event
        if (modelSelection.abTestVariant && userId) {
            await abTestingService.recordEvent(
                modelSelection.abTestVariant.testId,
                modelSelection.abTestVariant.variantId,
                userId,
                abTestingService.EventType.GENERATION,
                { latencyMs }
            );
        }

        return {
            ...result,
            provider: 'gemini',
            modelId: modelSelection.modelId,
            abTestVariant: modelSelection.abTestVariant,
            latencyMs,
            streamed: true
        };
    } catch (error) {
        console.error('Streaming failed, falling back to non-streaming:', error.message);

        // Record error event
        if (modelSelection.abTestVariant && userId) {
            await abTestingService.recordEvent(
                modelSelection.abTestVariant.testId,
                modelSelection.abTestVariant.variantId,
                userId,
                abTestingService.EventType.ERROR,
                { error: error.message }
            );
        }

        // Fall back to non-streaming
        return generateNarrative(systemPrompt, businessData, { userId });
    }
}

/**
 * Estimate tokens for a text
 */
function estimateTokens(text) {
    // Use the same estimation logic
    return Math.ceil(text.length / 4);
}

/**
 * Calculate cost based on provider
 */
function calculateCost(usage, provider = 'gemini', modelId = null) {
    if (provider === 'gemini') {
        return geminiClientV2.calculateCost(usage, modelId || 'gemini-3-flash');
    }
    return claudeClient.calculateCost(usage);
}

/**
 * Get current model routing status
 * Useful for debugging and monitoring
 */
function getRoutingStatus() {
    return {
        geminiEnabled: isFeatureEnabled('enableGemini'),
        geminiTrafficPercent: GEMINI_CONFIG.featureFlags.geminiTrafficPercent,
        abTestingEnabled: isFeatureEnabled('enableAbTesting'),
        streamingEnabled: isFeatureEnabled('enableStreaming'),
        fallbackToClaude: isFeatureEnabled('fallbackToClaude'),
        fallbackToTemplates: isFeatureEnabled('fallbackToTemplates'),
        primaryModels: {
            narrativeGeneration: GEMINI_CONFIG.modelRouting.narrativeGeneration.primary,
            narrativeValidation: GEMINI_CONFIG.modelRouting.narrativeValidation.primary,
            premiumFormatting: GEMINI_CONFIG.modelRouting.premiumFormatting.primary,
            basicFormatting: GEMINI_CONFIG.modelRouting.basicFormatting.primary,
            onboarding: GEMINI_CONFIG.modelRouting.onboarding.primary
        }
    };
}

module.exports = {
    OperationType,
    selectModel,
    generateNarrative,
    validateNarrative,
    formatNarrative,
    sendMessage,
    streamNarrative,
    estimateTokens,
    calculateCost,
    getRoutingStatus
};
