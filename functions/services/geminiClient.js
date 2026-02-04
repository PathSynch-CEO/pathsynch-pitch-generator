/**
 * Google Gemini AI Client
 *
 * Wrapper for Google Generative AI SDK with retry logic and error handling
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuration
// Available models: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash-exp
// Note: Update to 'gemini-2.5-pro' when publicly available
const GEMINI_CONFIG = {
    model: process.env.GEMINI_MODEL || 'gemini-1.5-pro', // Most capable model
    maxRetries: 3,
    retryDelayMs: 1000,
    defaultMaxTokens: 2048,
    temperature: 0.3 // Lower for more consistent structured output
};

// Initialize client
let geminiClient = null;
let model = null;

function getClient() {
    if (!geminiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }
        geminiClient = new GoogleGenerativeAI(apiKey);
        model = geminiClient.getGenerativeModel({ model: GEMINI_CONFIG.model });
    }
    return model;
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
 * @param {number} [options.maxTokens] - Max tokens for response
 * @param {number} [options.temperature] - Temperature setting
 * @returns {Promise<Object>} Response with content
 */
async function sendMessage({
    systemPrompt,
    userMessage,
    maxTokens = GEMINI_CONFIG.defaultMaxTokens,
    temperature = GEMINI_CONFIG.temperature
}) {
    const gemini = getClient();
    let lastError = null;

    for (let attempt = 1; attempt <= GEMINI_CONFIG.maxRetries; attempt++) {
        try {
            // Combine system prompt and user message
            const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

            const result = await gemini.generateContent({
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature: temperature
                }
            });

            const response = await result.response;
            const content = response.text();

            return {
                content,
                usage: {
                    // Gemini doesn't always return token counts in the same way
                    inputTokens: response.usageMetadata?.promptTokenCount || 0,
                    outputTokens: response.usageMetadata?.candidatesTokenCount || 0
                },
                model: GEMINI_CONFIG.model
            };
        } catch (error) {
            lastError = error;
            console.error(`Gemini API attempt ${attempt} failed:`, error.message);

            // Don't retry on certain errors
            if (error.message?.includes('API key')) {
                throw new Error('Gemini API authentication failed. Check your API key.');
            }

            if (error.message?.includes('INVALID_ARGUMENT')) {
                throw new Error(`Gemini API bad request: ${error.message}`);
            }

            // Retry on rate limits and server errors
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
 * Generate structured JSON output from Gemini
 * @param {string} systemPrompt - System prompt describing the task
 * @param {string} userMessage - The content to analyze
 * @returns {Promise<Object>} Parsed JSON response
 */
async function generateJSON(systemPrompt, userMessage) {
    const response = await sendMessage({
        systemPrompt: systemPrompt + '\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.',
        userMessage,
        temperature: 0.2 // Even lower for JSON consistency
    });

    // Parse JSON from response
    try {
        // Try to extract JSON from the response
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
                usage: response.usage
            };
        } else {
            throw new Error('No JSON found in response');
        }
    } catch (parseError) {
        console.error('Failed to parse Gemini JSON response:', parseError);
        throw new Error(`Failed to parse response: ${parseError.message}`);
    }
}

module.exports = {
    sendMessage,
    generateJSON,
    GEMINI_CONFIG
};
