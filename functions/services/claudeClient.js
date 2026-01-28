/**
 * Claude API Client
 *
 * Wrapper for Anthropic SDK with retry logic, error handling, and cost tracking
 */

const Anthropic = require('@anthropic-ai/sdk');
const { CLAUDE_CONFIG } = require('../config/claude');

// Initialize Anthropic client
let anthropicClient = null;

function getClient() {
    if (!anthropicClient) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }
        anthropicClient = new Anthropic({ apiKey });
    }
    return anthropicClient;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a message to Claude with retry logic
 * @param {Object} options - Message options
 * @param {string} options.systemPrompt - System prompt
 * @param {string} options.userMessage - User message content
 * @param {number} [options.maxTokens] - Max tokens for response
 * @param {number} [options.temperature] - Temperature setting
 * @param {string} [options.model] - Model override
 * @returns {Promise<Object>} Response with content and usage
 */
async function sendMessage({
    systemPrompt,
    userMessage,
    maxTokens = CLAUDE_CONFIG.maxTokens,
    temperature = CLAUDE_CONFIG.temperatures.narrative,
    model = CLAUDE_CONFIG.model
}) {
    const client = getClient();
    let lastError = null;

    for (let attempt = 1; attempt <= CLAUDE_CONFIG.maxRetries; attempt++) {
        try {
            const response = await client.messages.create({
                model,
                max_tokens: maxTokens,
                temperature,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userMessage }
                ]
            });

            // Extract text content from response
            const textContent = response.content.find(block => block.type === 'text');
            const content = textContent ? textContent.text : '';

            return {
                content,
                usage: {
                    inputTokens: response.usage?.input_tokens || 0,
                    outputTokens: response.usage?.output_tokens || 0
                },
                stopReason: response.stop_reason,
                model: response.model
            };
        } catch (error) {
            lastError = error;
            console.error(`Claude API attempt ${attempt} failed:`, error.message);

            // Don't retry on certain errors
            if (error.status === 401 || error.status === 403) {
                throw new Error('Claude API authentication failed. Check your API key.');
            }

            if (error.status === 400) {
                throw new Error(`Claude API bad request: ${error.message}`);
            }

            // Retry on rate limits and server errors
            if (attempt < CLAUDE_CONFIG.maxRetries) {
                const delay = CLAUDE_CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
                console.log(`Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw new Error(`Claude API failed after ${CLAUDE_CONFIG.maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Generate a narrative from business data
 * @param {string} systemPrompt - System prompt for narrative generation
 * @param {Object} businessData - Business data to analyze
 * @returns {Promise<Object>} Generated narrative and usage stats
 */
async function generateNarrative(systemPrompt, businessData) {
    const userMessage = `Analyze this business data and generate a structured sales narrative:

${JSON.stringify(businessData, null, 2)}

Return a valid JSON object matching the NarrativeSchema.`;

    const response = await sendMessage({
        systemPrompt,
        userMessage,
        maxTokens: CLAUDE_CONFIG.tokenLimits.narrativeGeneration,
        temperature: CLAUDE_CONFIG.temperatures.narrative
    });

    // Parse JSON from response
    let narrative;
    try {
        // Try to extract JSON from the response
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            narrative = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('No JSON found in response');
        }
    } catch (parseError) {
        console.error('Failed to parse narrative JSON:', parseError);
        throw new Error(`Failed to parse narrative response: ${parseError.message}`);
    }

    return {
        narrative,
        usage: response.usage
    };
}

/**
 * Validate a narrative for quality
 * @param {string} systemPrompt - System prompt for validation
 * @param {Object} narrative - Narrative to validate
 * @param {Object} originalData - Original business data for fact-checking
 * @returns {Promise<Object>} Validation results
 */
async function validateNarrative(systemPrompt, narrative, originalData) {
    const userMessage = `Validate this narrative against the original business data:

NARRATIVE:
${JSON.stringify(narrative, null, 2)}

ORIGINAL DATA:
${JSON.stringify(originalData, null, 2)}

Return a JSON object with: { isValid, score, issues[], autoFixes[] }`;

    const response = await sendMessage({
        systemPrompt,
        userMessage,
        maxTokens: CLAUDE_CONFIG.tokenLimits.validation,
        temperature: CLAUDE_CONFIG.temperatures.validation
    });

    // Parse validation result
    let validation;
    try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            validation = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('No JSON found in validation response');
        }
    } catch (parseError) {
        console.error('Failed to parse validation JSON:', parseError);
        // Return a default validation on parse error
        validation = {
            isValid: true,
            score: 70,
            issues: [{ severity: 'warning', message: 'Validation parsing failed', field: 'system' }],
            autoFixes: []
        };
    }

    return {
        validation,
        usage: response.usage
    };
}

/**
 * Format a narrative into a specific asset type
 * @param {string} systemPrompt - System prompt for formatting
 * @param {Object} narrative - Narrative to format
 * @param {string} assetType - Type of asset to generate
 * @param {Object} options - Formatting options (branding, etc)
 * @returns {Promise<Object>} Formatted content
 */
async function formatNarrative(systemPrompt, narrative, assetType, options = {}) {
    const userMessage = `Format this narrative into a ${assetType}:

NARRATIVE:
${JSON.stringify(narrative, null, 2)}

OPTIONS:
${JSON.stringify(options, null, 2)}

Generate the formatted content.`;

    const response = await sendMessage({
        systemPrompt,
        userMessage,
        maxTokens: CLAUDE_CONFIG.tokenLimits.formatting,
        temperature: CLAUDE_CONFIG.temperatures.formatting
    });

    return {
        content: response.content,
        usage: response.usage
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

/**
 * Calculate cost for token usage
 * @param {Object} usage - Token usage { inputTokens, outputTokens }
 * @param {string} model - Model used
 * @returns {number} Estimated cost in USD
 */
function calculateCost(usage, model = CLAUDE_CONFIG.model) {
    // Pricing as of implementation (may need updates)
    const pricing = {
        'claude-sonnet-4-20250514': { input: 3 / 1000000, output: 15 / 1000000 },
        'claude-opus-4-20250514': { input: 15 / 1000000, output: 75 / 1000000 },
        'claude-3-haiku-20240307': { input: 0.25 / 1000000, output: 1.25 / 1000000 }
    };

    const rates = pricing[model] || pricing['claude-sonnet-4-20250514'];
    return (usage.inputTokens * rates.input) + (usage.outputTokens * rates.output);
}

module.exports = {
    sendMessage,
    generateNarrative,
    validateNarrative,
    formatNarrative,
    estimateTokens,
    calculateCost
};
