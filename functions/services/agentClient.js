/**
 * Vertex AI Agent Client
 *
 * Universal client for invoking PathSynch AI agents.
 * Currently routes to local agentRunner.js implementations.
 * After Phase 4, routes to deployed Vertex AI Agent Engine instances.
 *
 * Usage (same interface regardless of backend):
 *   const { invokeAgent } = require('./agentClient');
 *   const result = await invokeAgent('news-intelligence', {
 *     companyName: 'Kenmore Air',
 *     industry: 'Aviation',
 *     location: 'Seattle, WA'
 *   });
 */

// Agent registry — maps friendly names to implementations
const AGENT_REGISTRY = {
    'news-intelligence': {
        module: './newsIntelligenceAgent',
        method: 'researchNews',
        description: 'Researches recent news, press releases, and company updates',
        timeout: 60000,
        // Phase 4: Add vertexResourceName here after deploying to Agent Engine
        vertexResourceName: null,
    },
    'linkedin-research': {
        module: './linkedinResearchAgent',
        method: 'researchContact',
        description: 'Researches contacts via LinkedIn and public sources',
        timeout: 45000,
        vertexResourceName: null,
    },
    'market-intelligence': {
        module: null, // Phase 5
        method: null,
        description: 'Analyzes market opportunity, competition, and demographics',
        timeout: 90000,
        vertexResourceName: null,
    },
};

/**
 * Invoke a PathSynch AI agent
 *
 * @param {string} agentName - Friendly name from AGENT_REGISTRY
 * @param {Object} input - Input data for the agent
 * @param {Object} options - Optional overrides
 * @returns {Promise<Object>} Standardized response: { success, data, agent, elapsed }
 */
async function invokeAgent(agentName, input, options = {}) {
    const agentConfig = AGENT_REGISTRY[agentName];
    if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(AGENT_REGISTRY).join(', ')}`);
    }

    const startTime = Date.now();
    console.log(`[AgentClient] Invoking ${agentName}`);

    try {
        let result;

        if (agentConfig.vertexResourceName) {
            // Phase 4: Route to Vertex AI Agent Engine
            result = await callVertexAgent(agentConfig, input, options);
        } else if (agentConfig.module) {
            // Current: Route to local agent implementation
            const agentModule = require(agentConfig.module);
            result = await agentModule[agentConfig.method](input);
        } else {
            throw new Error(`Agent ${agentName} not yet implemented`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`[AgentClient] ${agentName} completed in ${elapsed}ms`);

        return {
            success: result.success !== false,
            data: result,
            agent: agentName,
            elapsed,
        };
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[AgentClient] ${agentName} failed after ${elapsed}ms:`, error.message);

        return {
            success: false,
            error: error.message,
            agent: agentName,
            elapsed,
            data: null,
        };
    }
}

/**
 * Invoke multiple agents in parallel
 *
 * @param {Array<{agent: string, input: Object}>} requests - Array of agent requests
 * @returns {Promise<Object>} Results keyed by agent name
 */
async function invokeAgentsParallel(requests) {
    const startTime = Date.now();
    console.log(`[AgentClient] Running ${requests.length} agents in parallel`);

    const promises = requests.map(({ agent, input, options }) =>
        invokeAgent(agent, input, options)
            .then(result => ({ agent, result }))
            .catch(error => ({ agent, result: { success: false, error: error.message } }))
    );

    const results = await Promise.all(promises);

    const elapsed = Date.now() - startTime;
    console.log(`[AgentClient] Parallel execution completed in ${elapsed}ms`);

    // Convert to object keyed by agent name
    const resultMap = {};
    for (const { agent, result } of results) {
        resultMap[agent] = result;
    }

    return {
        results: resultMap,
        elapsed,
        totalAgents: requests.length,
        successfulAgents: results.filter(r => r.result.success).length,
    };
}

/**
 * Phase 4: Call a deployed Vertex AI Agent Engine instance
 * Stub — implement after enabling Vertex AI API and deploying agents
 */
async function callVertexAgent(agentConfig, input, options) {
    // const { AgentsClient } = require('@google-cloud/aiplatform').v1beta1;
    // const client = new AgentsClient();
    //
    // const request = {
    //     name: agentConfig.vertexResourceName,
    //     userInput: { text: JSON.stringify(input) },
    // };
    //
    // const [response] = await client.converse(request);
    // return JSON.parse(response.agentOutput.text);

    throw new Error('Vertex AI Agent Engine not yet deployed. See Phase 4 migration plan.');
}

/**
 * Get list of available agents
 */
function getAvailableAgents() {
    return Object.entries(AGENT_REGISTRY).map(([name, config]) => ({
        name,
        description: config.description,
        implemented: !!config.module,
        vertexDeployed: !!config.vertexResourceName,
    }));
}

module.exports = {
    invokeAgent,
    invokeAgentsParallel,
    getAvailableAgents,
    AGENT_REGISTRY,
};
