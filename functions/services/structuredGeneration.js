/**
 * Structured Generation Helper
 *
 * Uses @google/generative-ai with responseMimeType: 'application/json' + responseSchema
 * to guarantee schema-compliant JSON output from Gemini — no more "indexOf('{') and hope".
 *
 * This is the RECOMMENDED pattern for any Gemini call that needs structured output.
 * See brewhouseResponseSchema.js as the canonical schema example.
 *
 * Usage:
 *   const result = await generateStructured({
 *     systemInstruction: '...',
 *     userPrompt: '...',
 *     responseSchema: mySchema,
 *     model: 'gemini-3.1-pro-preview',
 *     temperature: 0.7,
 *     maxOutputTokens: 4096
 *   });
 *   // result is a parsed JS object guaranteed to match the schema
 *
 * On failure: throws (do NOT silently fall back — failure means a bug to fix).
 *
 * SDK: @google/generative-ai (existing dependency, v0.24.1+)
 * Auth: GEMINI_API_KEY env var (same as rest of codebase)
 *
 * Note on Vertex AI SDK: @google/generative-ai v0.24.1 supports responseSchema
 * natively via the Google AI Studio API. @google-cloud/vertexai is not required —
 * it would add a new dependency, a different auth path, and different model name conventions.
 * If Vertex AI is needed for other reasons (e.g., Vertex Search, tuned models), use
 * the existing google-auth-library + Vertex AI REST API pattern in vertexSearch.js.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Generate structured output from Gemini using responseSchema controlled generation.
 *
 * @param {Object}  options
 * @param {string}  options.systemInstruction - System-level instruction for the model
 * @param {string}  options.userPrompt        - The user-facing content/request
 * @param {Object}  options.responseSchema    - OpenAPI-compatible schema object (see brewhouseResponseSchema.js)
 * @param {string}  [options.model]           - Gemini model ID (default: gemini-3.1-pro-preview)
 * @param {number}  [options.temperature]     - Generation temperature (default: 0.7)
 * @param {number}  [options.maxOutputTokens] - Max tokens in response (default: 4096)
 * @returns {Promise<Object>} Parsed JS object matching the schema
 * @throws {Error} On API failure or unexpected response shape
 */
async function generateStructured({
    systemInstruction,
    userPrompt,
    responseSchema,
    model = 'gemini-3.1-pro-preview',
    temperature = 0.7,
    maxOutputTokens = 4096
}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('[structuredGeneration] GEMINI_API_KEY not configured');

    if (!responseSchema) throw new Error('[structuredGeneration] responseSchema is required');
    if (!userPrompt) throw new Error('[structuredGeneration] userPrompt is required');

    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemInstruction || undefined,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
            temperature,
            maxOutputTokens
        }
    });

    let result;
    try {
        result = await genModel.generateContent(userPrompt);
    } catch (err) {
        console.error('[structuredGeneration] API call failed:', {
            model,
            error: err.message,
            promptLength: userPrompt.length
        });
        throw new Error(`[structuredGeneration] Gemini API error: ${err.message}`);
    }

    const text = result.response.text();

    if (!text || text.trim() === '') {
        console.error('[structuredGeneration] Empty response from Gemini', { model });
        throw new Error('[structuredGeneration] Empty response from Gemini controlled generation');
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        console.error('[structuredGeneration] JSON parse failed — controlled generation returned non-JSON:', {
            model,
            responsePreview: text.substring(0, 400)
        });
        throw new Error(`[structuredGeneration] JSON parse error: ${err.message}`);
    }
}

module.exports = { generateStructured };
