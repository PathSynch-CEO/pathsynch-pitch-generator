/**
 * Narrative Reasoner Service
 *
 * AI-powered narrative generation from business data
 */

const { generateNarrative } = require('./claudeClient');
const { NARRATIVE_REASONER_PROMPT } = require('./prompts/narrativeReasonerPrompt');
const { CLAUDE_CONFIG } = require('../config/claude');

/**
 * Prepare business data for narrative generation
 * Combines form data, review data, and ROI calculations
 */
function prepareBusinessData(inputs, reviewData, roiData) {
    return {
        // Core business info
        business: {
            name: inputs.businessName,
            contactName: inputs.contactName,
            industry: inputs.industry,
            subIndustry: inputs.subIndustry || null,
            address: inputs.address || null,
            website: inputs.websiteUrl || null
        },

        // Review/reputation data
        reputation: {
            googleRating: inputs.googleRating,
            reviewCount: inputs.numReviews,
            reviewAnalysis: reviewData || null
        },

        // Financial/operational metrics
        metrics: {
            monthlyVisits: inputs.monthlyVisits,
            averageTransaction: inputs.avgTransaction,
            repeatRate: inputs.repeatRate,
            statedProblem: inputs.statedProblem
        },

        // Calculated ROI data
        roi: roiData || null,

        // Additional context
        context: {
            pitchLevel: inputs.pitchLevel,
            customNotes: inputs.customNotes || null
        }
    };
}

/**
 * Generate a narrative from business data
 * @param {Object} inputs - Form inputs
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculations
 * @returns {Promise<Object>} Generated narrative with usage stats
 */
async function generate(inputs, reviewData, roiData) {
    // Check if AI narratives are enabled
    if (!CLAUDE_CONFIG.enableAiNarratives) {
        throw new Error('AI narratives are disabled');
    }

    // Prepare the business data
    const businessData = prepareBusinessData(inputs, reviewData, roiData);

    // Generate the narrative
    const result = await generateNarrative(NARRATIVE_REASONER_PROMPT, businessData);

    // Validate basic structure
    const narrative = validateNarrativeStructure(result.narrative);

    return {
        narrative,
        usage: result.usage
    };
}

/**
 * Validate that the narrative has the required structure
 * Throws if invalid, returns sanitized narrative if valid
 */
function validateNarrativeStructure(narrative) {
    if (!narrative || typeof narrative !== 'object') {
        throw new Error('Invalid narrative: not an object');
    }

    // Required top-level fields
    const requiredFields = [
        'businessStory',
        'painPoints',
        'valueProps',
        'proofPoints',
        'roiStory',
        'solutionFit',
        'ctaHooks'
    ];

    for (const field of requiredFields) {
        if (!narrative[field]) {
            throw new Error(`Invalid narrative: missing ${field}`);
        }
    }

    // Validate businessStory structure
    if (!narrative.businessStory.headline || !narrative.businessStory.valueProposition) {
        throw new Error('Invalid narrative: businessStory missing required fields');
    }

    // Validate arrays have content
    if (!Array.isArray(narrative.painPoints) || narrative.painPoints.length === 0) {
        throw new Error('Invalid narrative: painPoints must be a non-empty array');
    }

    if (!Array.isArray(narrative.valueProps) || narrative.valueProps.length === 0) {
        throw new Error('Invalid narrative: valueProps must be a non-empty array');
    }

    if (!Array.isArray(narrative.ctaHooks) || narrative.ctaHooks.length === 0) {
        throw new Error('Invalid narrative: ctaHooks must be a non-empty array');
    }

    // Sanitize and return
    return {
        businessStory: {
            headline: String(narrative.businessStory.headline || ''),
            valueProposition: String(narrative.businessStory.valueProposition || ''),
            currentState: String(narrative.businessStory.currentState || ''),
            desiredState: String(narrative.businessStory.desiredState || '')
        },
        painPoints: narrative.painPoints.map(pp => ({
            category: validateCategory(pp.category),
            title: String(pp.title || ''),
            description: String(pp.description || ''),
            impact: String(pp.impact || '')
        })),
        valueProps: narrative.valueProps.map(vp => ({
            title: String(vp.title || ''),
            benefit: String(vp.benefit || ''),
            proof: String(vp.proof || ''),
            relevance: Math.min(10, Math.max(1, Number(vp.relevance) || 5))
        })),
        proofPoints: {
            sentiment: {
                positive: Number(narrative.proofPoints?.sentiment?.positive) || 0,
                neutral: Number(narrative.proofPoints?.sentiment?.neutral) || 0,
                negative: Number(narrative.proofPoints?.sentiment?.negative) || 0
            },
            topThemes: Array.isArray(narrative.proofPoints?.topThemes)
                ? narrative.proofPoints.topThemes.map(t => ({
                    theme: String(t.theme || ''),
                    quotes: Array.isArray(t.quotes) ? t.quotes.map(String) : []
                }))
                : [],
            differentiators: Array.isArray(narrative.proofPoints?.differentiators)
                ? narrative.proofPoints.differentiators.map(String)
                : []
        },
        roiStory: {
            headline: String(narrative.roiStory?.headline || ''),
            keyMetrics: Array.isArray(narrative.roiStory?.keyMetrics)
                ? narrative.roiStory.keyMetrics.map(m => ({
                    metric: String(m.metric || ''),
                    current: String(m.current || ''),
                    projected: String(m.projected || '')
                }))
                : []
        },
        solutionFit: {
            primaryProducts: Array.isArray(narrative.solutionFit?.primaryProducts)
                ? narrative.solutionFit.primaryProducts.map(String)
                : [],
            useCases: Array.isArray(narrative.solutionFit?.useCases)
                ? narrative.solutionFit.useCases.map(uc => ({
                    product: String(uc.product || ''),
                    useCase: String(uc.useCase || ''),
                    outcome: String(uc.outcome || '')
                }))
                : []
        },
        ctaHooks: narrative.ctaHooks.map(cta => ({
            type: validateCtaType(cta.type),
            headline: String(cta.headline || ''),
            action: String(cta.action || '')
        }))
    };
}

/**
 * Validate pain point category
 */
function validateCategory(category) {
    const validCategories = ['discovery', 'retention', 'insights'];
    return validCategories.includes(category) ? category : 'discovery';
}

/**
 * Validate CTA type
 */
function validateCtaType(type) {
    const validTypes = ['urgency', 'value', 'social_proof'];
    return validTypes.includes(type) ? type : 'value';
}

/**
 * Regenerate specific sections of a narrative
 * @param {Object} narrative - Existing narrative
 * @param {string[]} sections - Sections to regenerate
 * @param {Object} inputs - Original inputs
 * @param {Object} modifications - User modifications/feedback
 * @returns {Promise<Object>} Updated narrative
 */
async function regenerateSection(narrative, sections, inputs, modifications = {}) {
    const businessData = prepareBusinessData(inputs, null, null);

    // Create a focused prompt for section regeneration
    const sectionPrompt = `${NARRATIVE_REASONER_PROMPT}

REGENERATION REQUEST:
The user wants to regenerate the following sections: ${sections.join(', ')}

Current narrative (for context):
${JSON.stringify(narrative, null, 2)}

User feedback/modifications:
${JSON.stringify(modifications, null, 2)}

Generate ONLY the requested sections, maintaining consistency with the unchanged parts.
Return a JSON object with only the regenerated sections.`;

    const result = await generateNarrative(sectionPrompt, businessData);

    // Merge regenerated sections with existing narrative
    const updatedNarrative = { ...narrative };
    for (const section of sections) {
        if (result.narrative[section]) {
            updatedNarrative[section] = result.narrative[section];
        }
    }

    return {
        narrative: validateNarrativeStructure(updatedNarrative),
        usage: result.usage,
        regeneratedSections: sections
    };
}

module.exports = {
    generate,
    regenerateSection,
    prepareBusinessData,
    validateNarrativeStructure
};
