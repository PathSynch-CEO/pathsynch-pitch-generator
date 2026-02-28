/**
 * Gemini Agent Runner
 *
 * Runs a Gemini model with function-calling tools in an agentic loop.
 * The model decides which tools to call, in what order, and iterates
 * until it has enough information to produce a final response.
 *
 * This is the foundation for all PathSynch AI agents:
 * - News Intelligence Agent
 * - LinkedIn Research Agent
 * - Market Intelligence Agent (Phase 5)
 *
 * Pattern: Same agentic behavior as Vertex AI Agent Engine,
 * but runs inside existing Cloud Functions. Can migrate to
 * Agent Engine later without changing the calling interface.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL = 'gemini-2.0-flash';

let genAI = null;

/**
 * Get or initialize the Gemini client
 */
function getGenAI() {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is required');
        }
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

/**
 * Run an agent with tools in a loop
 *
 * The agent will:
 * 1. Receive the user message
 * 2. Decide which tools to call based on the system prompt
 * 3. Execute tools and receive results
 * 4. Iterate until it has enough information
 * 5. Return a final response
 *
 * @param {string} systemPrompt - Agent's system instruction (personality + output format)
 * @param {string} userMessage - The research request
 * @param {Array} toolDefinitions - Gemini function declarations (tool schemas)
 * @param {Object} toolImplementations - Map of functionName → async handler(args)
 * @param {Object} options - Optional configuration
 * @param {number} options.maxIterations - Max tool-calling rounds (default: 5)
 * @param {number} options.temperature - Model temperature (default: 0.7)
 * @param {boolean} options.verbose - Log detailed progress (default: true)
 * @returns {Promise<Object>} { response: string, toolCalls: Array, iterations: number }
 */
async function runAgent(systemPrompt, userMessage, toolDefinitions, toolImplementations, options = {}) {
    const {
        maxIterations = 5,
        temperature = 0.7,
        verbose = true,
    } = options;

    const startTime = Date.now();
    const toolCallLog = [];

    try {
        const model = getGenAI().getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: systemPrompt,
            tools: toolDefinitions.length > 0 ? [{ functionDeclarations: toolDefinitions }] : undefined,
            generationConfig: {
                temperature,
            },
        });

        const chat = model.startChat();
        let response = await chat.sendMessage(userMessage);
        let iterations = 0;

        while (iterations < maxIterations) {
            const candidate = response.response.candidates?.[0];
            if (!candidate) {
                if (verbose) console.warn('[AgentRunner] No candidate in response');
                break;
            }

            const parts = candidate.content?.parts || [];
            const functionCalls = parts.filter(p => p.functionCall);

            // No more tool calls — agent is done
            if (functionCalls.length === 0) {
                const textParts = parts.filter(p => p.text);
                const finalResponse = textParts.map(p => p.text).join('\n');

                if (verbose) {
                    const elapsed = Date.now() - startTime;
                    console.log(`[AgentRunner] Completed in ${elapsed}ms with ${toolCallLog.length} tool calls`);
                }

                return {
                    response: finalResponse,
                    toolCalls: toolCallLog,
                    iterations,
                    elapsed: Date.now() - startTime,
                };
            }

            // Execute each tool call
            const functionResponses = [];
            for (const part of functionCalls) {
                const { name, args } = part.functionCall;

                if (verbose) {
                    console.log(`[AgentRunner] Tool call #${iterations + 1}: ${name}(${JSON.stringify(args).substring(0, 100)}...)`);
                }

                const handler = toolImplementations[name];
                if (!handler) {
                    console.warn(`[AgentRunner] Unknown tool: ${name}`);
                    functionResponses.push({
                        functionResponse: {
                            name,
                            response: { error: `Unknown tool: ${name}` },
                        },
                    });
                    toolCallLog.push({ name, args, error: 'Unknown tool', iteration: iterations });
                    continue;
                }

                try {
                    const toolStartTime = Date.now();
                    const result = await handler(args);
                    const toolElapsed = Date.now() - toolStartTime;

                    functionResponses.push({
                        functionResponse: {
                            name,
                            response: { result: JSON.stringify(result) },
                        },
                    });

                    toolCallLog.push({
                        name,
                        args,
                        success: true,
                        elapsed: toolElapsed,
                        iteration: iterations,
                        resultSummary: summarizeResult(result),
                    });

                } catch (error) {
                    console.error(`[AgentRunner] Tool ${name} failed:`, error.message);

                    functionResponses.push({
                        functionResponse: {
                            name,
                            response: { error: error.message },
                        },
                    });

                    toolCallLog.push({
                        name,
                        args,
                        error: error.message,
                        iteration: iterations,
                    });
                }
            }

            // Send tool results back to Gemini for next iteration
            response = await chat.sendMessage(functionResponses);
            iterations++;
        }

        // Max iterations reached — return whatever text we have
        if (verbose) {
            console.warn(`[AgentRunner] Max iterations (${maxIterations}) reached`);
        }

        const finalParts = response.response.candidates?.[0]?.content?.parts || [];
        const finalResponse = finalParts.filter(p => p.text).map(p => p.text).join('\n');

        return {
            response: finalResponse,
            toolCalls: toolCallLog,
            iterations,
            elapsed: Date.now() - startTime,
            maxIterationsReached: true,
        };

    } catch (error) {
        console.error('[AgentRunner] Fatal error:', error.message);
        throw error;
    }
}

/**
 * Create a brief summary of a tool result for logging
 */
function summarizeResult(result) {
    if (!result) return 'null';
    if (result.error) return `error: ${result.error}`;
    if (result.articles) return `${result.articles.length} articles`;
    if (result.results) return `${result.results.length} results`;
    if (result.pagesChecked) return `${result.summary?.pagesFound || 0} pages found`;
    if (typeof result === 'string') return result.substring(0, 50);
    return 'data returned';
}

/**
 * Simple helper to run an agent and extract JSON from the response
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Array} toolDefinitions
 * @param {Object} toolImplementations
 * @param {Object} options
 * @returns {Promise<Object>} Parsed JSON or raw response
 */
async function runAgentAndParseJson(systemPrompt, userMessage, toolDefinitions, toolImplementations, options = {}) {
    const result = await runAgent(systemPrompt, userMessage, toolDefinitions, toolImplementations, options);

    // Try to parse JSON from the response
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                ...result,
                parsed,
                success: true,
            };
        } catch (parseError) {
            console.warn('[AgentRunner] Failed to parse JSON from response');
        }
    }

    return {
        ...result,
        parsed: null,
        success: false,
        raw: result.response,
    };
}

module.exports = {
    runAgent,
    runAgentAndParseJson,
    getGenAI,
};
