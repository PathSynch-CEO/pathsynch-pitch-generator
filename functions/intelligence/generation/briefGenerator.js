/**
 * Brief Generator
 *
 * LLM Call 2: Takes structured insights and produces the user-facing brief.
 * This is the second pass of the two-pass generation pipeline.
 */

const { buildBriefPrompt, PROMPT_VERSION } = require('./briefPrompt');
const { genericityTest } = require('../constants');

/**
 * Generate a brief from insights using LLM
 * @param {object} params - Generation parameters
 * @param {object} geminiClient - Gemini client for LLM calls
 * @returns {object} Generated brief
 */
async function generateBrief(params, geminiClient) {
    const {
        insights,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        contactName,
        contactTitle,
        meetingType,
        userTier,
        customSalesLibrary,
        linkedinMatch,
        // AI Agent Intelligence
        newsIntelligence,
        contactIntelligence,
    } = params;

    const startTime = Date.now();

    // Build the generation prompt
    const { prompt } = buildBriefPrompt({
        insights,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        contactName,
        contactTitle,
        meetingType,
        userTier,
        customSalesLibrary,
        linkedinMatch,
        newsIntelligence,
        contactIntelligence,
    });

    console.log(`[Generation] Starting brief generation for ${prospectCompany}`);

    try {
        // Call Gemini for brief generation
        const response = await geminiClient.sendMessage({
            systemPrompt: 'You are a sales brief writer. Return only valid JSON, no markdown formatting.',
            userMessage: prompt,
            maxTokens: 3000,
            temperature: 0.6, // Slightly higher for more natural language
        });

        // Parse the response
        let brief;
        try {
            const content = response.content || response.text || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                brief = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in generation response');
            }
        } catch (parseError) {
            console.error('[Generation] Failed to parse LLM response:', parseError.message);
            console.error('[Generation] Raw response:', (response.content || '').substring(0, 500));
            // Return a minimal valid brief
            brief = getDefaultBrief(prospectCompany, contactName, contactTitle, insights, contactIntelligence);
        }

        // Run genericity test
        const briefText = JSON.stringify(brief);
        const qualityCheck = genericityTest(briefText);
        if (!qualityCheck.passed) {
            console.warn(`[Generation] Brief contains ${qualityCheck.violations.length} banned phrases:`, qualityCheck.violations);
        }

        const latencyMs = Date.now() - startTime;
        console.log(`[Generation] Completed in ${latencyMs}ms (quality: ${qualityCheck.passed ? 'PASS' : 'WARN'})`);

        return {
            ...brief,
            _meta: {
                promptVersion: PROMPT_VERSION,
                latencyMs,
                qualityCheck: {
                    passed: qualityCheck.passed,
                    violations: qualityCheck.violations,
                },
                timestamp: new Date().toISOString(),
            },
        };

    } catch (error) {
        console.error('[Generation] LLM call failed:', error.message);

        // Return default brief on failure
        return {
            ...getDefaultBrief(prospectCompany, contactName, contactTitle, insights, contactIntelligence),
            _meta: {
                promptVersion: PROMPT_VERSION,
                error: error.message,
                timestamp: new Date().toISOString(),
            },
        };
    }
}

/**
 * Get default brief structure when generation fails
 * @param {string} prospectCompany - Company name
 * @param {string} contactName - Contact name
 * @param {string} contactTitle - Contact title
 * @param {object} insights - Insights from synthesis (may be partial)
 * @returns {object} Default brief structure
 */
function getDefaultBrief(prospectCompany, contactName, contactTitle, insights, contactIntelligence = null) {
    const contact = contactName || 'the contact';
    const title = contactTitle ? `, ${contactTitle}` : '';

    return {
        companySnapshot: `${prospectCompany} - Additional research recommended before the call.`,
        contactSnapshot: `${contact}${title}. Review their LinkedIn profile for background context.`,
        tamFitSummary: insights?.tamFit?.note || 'Fit assessment pending - use discovery to qualify.',
        whyTheyTookMeeting: 'Unable to determine from available data. Ask during the call what prompted their interest.',
        suggestedOpener: `Hi ${contactName || 'there'}, thank you for making time today. Before I share anything about us, I'd love to understand what prompted you to take this meeting.`,
        callStrategy: insights?.callStrategy?.rationale || 'Focus on discovery and understanding their situation before presenting solutions.',
        painPointHypotheses: insights?.painPointHypotheses?.map(h => ({
            painPoint: h.hypothesis,
            evidence: h.evidence,
            talkingPoint: `Ask about ${h.hypothesis.toLowerCase()} to validate`,
        })) || [],
        customSignals: [],
        talkingPoints: [
            'Focus on understanding their current challenges before presenting solutions',
            'Ask about their evaluation criteria and timeline',
            'Identify who else is involved in the decision process',
        ],
        discoveryQuestions: [
            'What are the biggest challenges your team faces today? — [Tests hypothesis: general pain points]',
            'How are you currently handling this? — [Tests hypothesis: current solution/process]',
            'What would success look like for you? — [Tests hypothesis: desired outcomes]',
            'What prompted you to look at solutions now? — [Tests hypothesis: urgency/trigger]',
            'Who else would be involved in evaluating this? — [Tests hypothesis: decision process]',
        ],
        objectionPrep: insights?.likelyObjections?.map(o => ({
            objection: o.objection,
            category: o.category,
            response: o.response,
            proactiveStrategy: o.proactiveStrategy,
        })) || [],
        industryBridge: insights?.industryAlignment?.sellerRelevance || null,
        productFocus: insights?.productFit ? {
            product: insights.productFit.primaryProduct,
            keyFeatures: insights.productFit.keyFeatures || [],
            valueProposition: insights.productFit.valueProposition,
        } : null,
        rapportHooks: insights?.rapportHooks?.map(h => h.hook) || [],
        urgencyAssessment: insights?.urgencyIndicators?.[0]?.implication || 'Unknown - determine timeline during the call.',
        riskFactors: insights?.riskFactors?.map(r => `${r.risk}: ${r.mitigation}`) || [],
        competitorWatch: insights?.competitivePositioning?.likelyAlternatives || [],
        recommendedNextSteps: 'Based on discovery, propose a follow-up demo or technical deep-dive with relevant stakeholders.',
        doNotMention: contactIntelligence?.doNotMention || [],
    };
}

module.exports = {
    generateBrief,
    getDefaultBrief,
};
