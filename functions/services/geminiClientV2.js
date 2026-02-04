/**
 * Enhanced Gemini API Client (V2)
 *
 * Wrapper for Google Generative AI SDK with:
 * - Streaming support via generateContentStream
 * - Context caching integration
 * - Fallback chain handling
 * - Retry logic with exponential backoff
 * - Cost tracking
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_CONFIG, getModelConfig, calculateCost } = require('../config/gemini');
const promptCache = require('./promptCache');

// Initialize clients cache (one per model)
const modelClients = new Map();

/**
 * Get or create a Gemini model client
 */
function getModelClient(modelId) {
    if (!modelClients.has(modelId)) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelConfig = getModelConfig(modelId);

        if (!modelConfig) {
            throw new Error(`Unknown model: ${modelId}`);
        }

        const client = genAI.getGenerativeModel({ model: modelConfig.id });
        modelClients.set(modelId, client);
    }

    return modelClients.get(modelId);
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a message to Gemini with retry logic
 * @param {Object} options - Message options
 * @param {string} options.systemPrompt - System instruction
 * @param {string} options.userMessage - User message content
 * @param {string} [options.modelId] - Model to use (default: gemini-3-flash)
 * @param {number} [options.maxTokens] - Max tokens for response
 * @param {number} [options.temperature] - Temperature setting
 * @param {boolean} [options.useCache] - Whether to use prompt caching
 * @param {string} [options.cacheKey] - Cache key for the prompt
 * @returns {Promise<Object>} Response with content and usage
 */
async function sendMessage({
    systemPrompt,
    userMessage,
    modelId = 'gemini-3-flash',
    maxTokens = 2048,
    temperature = 0.5,
    useCache = false,
    cacheKey = null
}) {
    const model = getModelClient(modelId);
    let lastError = null;

    // Check cache first if enabled
    if (useCache && cacheKey && GEMINI_CONFIG.featureFlags.enablePromptCaching) {
        const cached = await promptCache.get(cacheKey);
        if (cached) {
            return {
                content: cached.content,
                usage: cached.usage || { inputTokens: 0, outputTokens: 0 },
                model: modelId,
                cached: true
            };
        }
    }

    for (let attempt = 1; attempt <= GEMINI_CONFIG.maxRetries; attempt++) {
        try {
            // Combine system prompt and user message
            const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature: temperature
                }
            });

            const response = await result.response;
            const content = response.text();

            const usage = {
                inputTokens: response.usageMetadata?.promptTokenCount || 0,
                outputTokens: response.usageMetadata?.candidatesTokenCount || 0
            };

            const responseData = {
                content,
                usage,
                model: modelId,
                cost: calculateCost(usage, modelId)
            };

            // Cache the response if caching is enabled
            if (useCache && cacheKey && GEMINI_CONFIG.featureFlags.enablePromptCaching) {
                await promptCache.set(cacheKey, responseData, GEMINI_CONFIG.caching.contextTtl);
            }

            return responseData;
        } catch (error) {
            lastError = error;
            console.error(`Gemini API attempt ${attempt} failed (${modelId}):`, error.message);

            // Don't retry on certain errors
            if (error.message?.includes('API key') || error.message?.includes('API_KEY')) {
                throw new Error('Gemini API authentication failed. Check your API key.');
            }

            if (error.message?.includes('INVALID_ARGUMENT')) {
                throw new Error(`Gemini API bad request: ${error.message}`);
            }

            if (error.message?.includes('RESOURCE_EXHAUSTED')) {
                // Rate limit - wait longer
                if (attempt < GEMINI_CONFIG.maxRetries) {
                    const delay = GEMINI_CONFIG.retryDelayMs * Math.pow(3, attempt - 1);
                    console.log(`Rate limited, retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }
            }

            // Retry on other errors
            if (attempt < GEMINI_CONFIG.maxRetries) {
                const delay = GEMINI_CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
                console.log(`Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw new Error(`Gemini API failed after ${GEMINI_CONFIG.maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Stream content generation from Gemini
 * @param {Object} options - Stream options
 * @param {string} options.systemPrompt - System instruction
 * @param {string} options.userMessage - User message content
 * @param {string} [options.modelId] - Model to use
 * @param {number} [options.maxTokens] - Max tokens for response
 * @param {number} [options.temperature] - Temperature setting
 * @param {Function} options.onChunk - Callback for each chunk (content, done, progress)
 * @returns {Promise<Object>} Final response with full content and usage
 */
async function streamMessage({
    systemPrompt,
    userMessage,
    modelId = 'gemini-3-flash',
    maxTokens = 4096,
    temperature = 0.7,
    onChunk
}) {
    const model = getModelClient(modelId);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

    let fullContent = '';
    let chunkCount = 0;
    const startTime = Date.now();

    try {
        const result = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: temperature
            }
        });

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullContent += chunkText;
            chunkCount++;

            // Calculate approximate progress (rough estimate based on expected length)
            const estimatedProgress = Math.min(95, (fullContent.length / (maxTokens * 4)) * 100);

            if (onChunk) {
                onChunk({
                    content: chunkText,
                    fullContent,
                    done: false,
                    progress: Math.round(estimatedProgress),
                    chunkNumber: chunkCount
                });
            }
        }

        // Get final response for usage metadata
        const response = await result.response;

        const usage = {
            inputTokens: response.usageMetadata?.promptTokenCount || 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount || 0
        };

        // Send final chunk
        if (onChunk) {
            onChunk({
                content: '',
                fullContent,
                done: true,
                progress: 100,
                chunkNumber: chunkCount + 1
            });
        }

        return {
            content: fullContent,
            usage,
            model: modelId,
            cost: calculateCost(usage, modelId),
            streamStats: {
                chunks: chunkCount,
                durationMs: Date.now() - startTime
            }
        };
    } catch (error) {
        console.error('Streaming error:', error.message);

        // Notify of error via callback
        if (onChunk) {
            onChunk({
                content: '',
                fullContent,
                done: true,
                progress: 100,
                error: error.message
            });
        }

        throw error;
    }
}

/**
 * Generate content with fallback chain
 * Tries each model in sequence until one succeeds
 * @param {Object} options - Generation options
 * @param {string} options.systemPrompt - System instruction
 * @param {string} options.userMessage - User message content
 * @param {string[]} options.fallbackChain - Array of model IDs to try
 * @param {number} [options.maxTokens] - Max tokens for response
 * @param {number} [options.temperature] - Temperature setting
 * @returns {Promise<Object>} Response with content, model used, and fallback info
 */
async function sendMessageWithFallback({
    systemPrompt,
    userMessage,
    fallbackChain,
    maxTokens = 2048,
    temperature = 0.5
}) {
    const errors = [];

    for (const modelId of fallbackChain) {
        // Skip special markers
        if (modelId === 'claude' || modelId === 'template') {
            continue;
        }

        try {
            const result = await sendMessage({
                systemPrompt,
                userMessage,
                modelId,
                maxTokens,
                temperature
            });

            return {
                ...result,
                fallbackUsed: modelId !== fallbackChain[0],
                modelsAttempted: errors.map(e => e.model).concat([modelId])
            };
        } catch (error) {
            console.error(`Model ${modelId} failed:`, error.message);
            errors.push({ model: modelId, error: error.message });
        }
    }

    // All Gemini models failed
    const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('; ');
    throw new Error(`All Gemini models failed: ${errorSummary}`);
}

/**
 * Generate structured JSON output from Gemini
 * @param {string} systemPrompt - System prompt describing the task
 * @param {string} userMessage - The content to analyze
 * @param {string} [modelId] - Model to use
 * @returns {Promise<Object>} Parsed JSON response
 */
async function generateJSON(systemPrompt, userMessage, modelId = 'gemini-3-flash') {
    const response = await sendMessage({
        systemPrompt: systemPrompt + '\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.',
        userMessage,
        modelId,
        temperature: 0.2 // Lower for JSON consistency
    });

    // Parse JSON from response
    try {
        let content = response.content.trim();

        // Remove markdown code blocks if present
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return {
                data: JSON.parse(jsonMatch[0]),
                usage: response.usage,
                model: response.model,
                cost: response.cost
            };
        } else {
            throw new Error('No JSON found in response');
        }
    } catch (parseError) {
        console.error('Failed to parse Gemini JSON response:', parseError);
        throw new Error(`Failed to parse response: ${parseError.message}`);
    }
}

/**
 * Generate a narrative from business data
 * @param {string} systemPrompt - System prompt for narrative generation
 * @param {Object} businessData - Business data to analyze
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated narrative and usage stats
 */
async function generateNarrative(systemPrompt, businessData, options = {}) {
    const {
        modelId = 'gemini-3-pro',
        stream = false,
        onProgress = null
    } = options;

    const userMessage = `Analyze this business data and generate a structured sales narrative:

${JSON.stringify(businessData, null, 2)}

Return a valid JSON object matching the NarrativeSchema.`;

    if (stream && onProgress) {
        let fullContent = '';

        const response = await streamMessage({
            systemPrompt,
            userMessage,
            modelId,
            maxTokens: GEMINI_CONFIG.modelRouting.narrativeGeneration.maxTokens,
            temperature: GEMINI_CONFIG.modelRouting.narrativeGeneration.temperature,
            onChunk: (chunk) => {
                fullContent = chunk.fullContent;
                onProgress({
                    progress: chunk.progress,
                    done: chunk.done,
                    error: chunk.error
                });
            }
        });

        // Parse JSON from streamed content
        const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in streamed response');
        }

        return {
            narrative: JSON.parse(jsonMatch[0]),
            usage: response.usage,
            model: response.model,
            cost: response.cost,
            streamStats: response.streamStats
        };
    }

    // Non-streaming generation
    const response = await sendMessage({
        systemPrompt,
        userMessage,
        modelId,
        maxTokens: GEMINI_CONFIG.modelRouting.narrativeGeneration.maxTokens,
        temperature: GEMINI_CONFIG.modelRouting.narrativeGeneration.temperature
    });

    // Parse JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('No JSON found in response');
    }

    return {
        narrative: JSON.parse(jsonMatch[0]),
        usage: response.usage,
        model: response.model,
        cost: response.cost
    };
}

/**
 * Validate a narrative for quality
 * @param {string} systemPrompt - System prompt for validation
 * @param {Object} narrative - Narrative to validate
 * @param {Object} originalData - Original business data for fact-checking
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} Validation results
 */
async function validateNarrative(systemPrompt, narrative, originalData, options = {}) {
    const { modelId = 'gemini-3-pro' } = options;

    const userMessage = `Validate this narrative against the original business data:

NARRATIVE:
${JSON.stringify(narrative, null, 2)}

ORIGINAL DATA:
${JSON.stringify(originalData, null, 2)}

Return a JSON object with: { isValid, score, breakdown, issues[], autoFixes[], summary }`;

    const response = await sendMessage({
        systemPrompt,
        userMessage,
        modelId,
        maxTokens: GEMINI_CONFIG.modelRouting.narrativeValidation.maxTokens,
        temperature: GEMINI_CONFIG.modelRouting.narrativeValidation.temperature
    });

    // Parse validation result
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        // Return default validation on parse error
        return {
            validation: {
                isValid: true,
                score: 70,
                issues: [{ severity: 'warning', message: 'Validation parsing failed', field: 'system' }],
                autoFixes: []
            },
            usage: response.usage,
            model: response.model,
            cost: response.cost
        };
    }

    return {
        validation: JSON.parse(jsonMatch[0]),
        usage: response.usage,
        model: response.model,
        cost: response.cost
    };
}

/**
 * Format a narrative into a specific asset type
 * @param {string} systemPrompt - System prompt for formatting
 * @param {Object} narrative - Narrative to format
 * @param {string} assetType - Type of asset to generate
 * @param {Object} options - Formatting options
 * @returns {Promise<Object>} Formatted content
 */
async function formatNarrative(systemPrompt, narrative, assetType, options = {}) {
    const { modelId = 'gemini-3-flash', branding = {} } = options;

    const userMessage = `Format this narrative into a ${assetType}:

NARRATIVE:
${JSON.stringify(narrative, null, 2)}

OPTIONS:
${JSON.stringify({ branding }, null, 2)}

Generate the formatted content as JSON.`;

    const response = await sendMessage({
        systemPrompt,
        userMessage,
        modelId,
        maxTokens: GEMINI_CONFIG.modelRouting.basicFormatting.maxTokens,
        temperature: GEMINI_CONFIG.modelRouting.basicFormatting.temperature
    });

    return {
        content: response.content,
        usage: response.usage,
        model: response.model,
        cost: response.cost
    };
}

/**
 * Estimate token count for a string (rough estimate)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4);
}

module.exports = {
    sendMessage,
    streamMessage,
    sendMessageWithFallback,
    generateJSON,
    generateNarrative,
    validateNarrative,
    formatNarrative,
    estimateTokens,
    calculateCost
};
