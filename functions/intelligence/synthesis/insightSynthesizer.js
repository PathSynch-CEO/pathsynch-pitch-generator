/**
 * Insight Synthesizer
 *
 * LLM Call 1: Takes raw signals and produces structured analytical insights.
 * This is the first pass of the two-pass generation pipeline.
 */

const { buildSynthesisPrompt, PROMPT_VERSION } = require('./synthesisPrompt');

/**
 * Synthesize insights from signal data using LLM
 * @param {object} params - Synthesis parameters
 * @param {object} geminiClient - Gemini client for LLM calls
 * @returns {object} Structured insights
 */
async function synthesizeInsights(params, geminiClient) {
    const {
        signals,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        meetingType,
        customSalesLibrary,
        // Seller context
        sellerCompany,
        sellerIndustry,
        sellerProducts,
        selectedProduct,
        // AI Agent Intelligence
        newsIntelligence,
        contactIntelligence,
    } = params;

    const startTime = Date.now();

    // Build the synthesis prompt
    const { prompt, lowDataMode, signalCount } = buildSynthesisPrompt({
        signals,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        meetingType,
        customSalesLibrary,
        sellerCompany,
        sellerIndustry,
        sellerProducts,
        selectedProduct,
        newsIntelligence,
        contactIntelligence,
    });

    console.log(`[Synthesis] Starting insight synthesis for ${prospectCompany} (${signalCount} signals, lowDataMode: ${lowDataMode})`);

    try {
        // Call Gemini for synthesis
        const response = await geminiClient.sendMessage({
            systemPrompt: 'You are a sales intelligence analyst. Return only valid JSON, no markdown formatting.',
            userMessage: prompt,
            maxTokens: 2048,
            temperature: 0.4, // Lower temperature for more consistent analytical output
        });

        // Parse the response
        let insights;
        try {
            // Extract JSON from response
            const content = response.content || response.text || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                insights = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in synthesis response');
            }
        } catch (parseError) {
            console.error('[Synthesis] Failed to parse LLM response:', parseError.message);
            console.error('[Synthesis] Raw response:', (response.content || '').substring(0, 500));
            // Return a minimal valid structure
            insights = getDefaultInsights(prospectCompany, contactName, lowDataMode);
        }

        const latencyMs = Date.now() - startTime;
        console.log(`[Synthesis] Completed in ${latencyMs}ms`);

        return {
            ...insights,
            _meta: {
                promptVersion: PROMPT_VERSION,
                signalCount,
                lowDataMode,
                latencyMs,
                timestamp: new Date().toISOString(),
            },
        };

    } catch (error) {
        console.error('[Synthesis] LLM call failed:', error.message);

        // Return default insights on failure
        return {
            ...getDefaultInsights(prospectCompany, contactName, true),
            _meta: {
                promptVersion: PROMPT_VERSION,
                signalCount,
                lowDataMode: true,
                error: error.message,
                timestamp: new Date().toISOString(),
            },
        };
    }
}

/**
 * Get default insights structure when synthesis fails or has insufficient data
 * @param {string} prospectCompany - Company name
 * @param {string} contactName - Contact name
 * @param {boolean} lowDataMode - Whether in low data mode
 * @returns {object} Default insights structure
 */
function getDefaultInsights(prospectCompany, contactName, lowDataMode) {
    return {
        tamFit: {
            score: null,
            label: 'Unknown',
            matches: [],
            gaps: [],
            note: 'Insufficient data for TAM assessment. Prioritize discovery.',
        },
        painPointHypotheses: [
            {
                hypothesis: `${prospectCompany} may be looking to improve their sales efficiency`,
                evidence: 'General industry pattern - requires validation',
                confidence: 0.3,
                testQuestion: 'What are the biggest challenges your sales team faces today?',
            },
        ],
        competitivePositioning: {
            likelyAlternatives: [],
            differentiators: [],
            risks: ['Unknown competitive landscape - probe during discovery'],
        },
        rapportHooks: [],
        urgencyIndicators: [
            {
                indicator: 'Unknown - insufficient data',
                implication: 'Cannot assess deal urgency. Focus on understanding timeline.',
                confidence: 0.0,
            },
        ],
        riskFactors: [
            {
                risk: 'Limited pre-call intelligence available',
                mitigation: 'Use discovery questions to gather context during the call',
                severity: 'medium',
            },
        ],
        callStrategy: {
            approach: 'consultative discovery',
            rationale: 'Limited intelligence requires open-ended discovery approach',
            keyObjective: 'Understand their current situation, challenges, and priorities',
        },
        missingIntelligence: [
            'Company tech stack',
            'Recent company news or funding',
            'Contact LinkedIn activity',
            'Hiring patterns',
        ],
    };
}

module.exports = {
    synthesizeInsights,
    getDefaultInsights,
};
