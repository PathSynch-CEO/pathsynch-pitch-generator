/**
 * Synthesis Prompt Builder
 *
 * Builds the prompt for LLM Call 1: Insight Synthesis
 * This call analyzes signals and produces structured analytical insights.
 */

const { BANNED_PHRASES, MEETING_TYPES } = require('../constants');

const PROMPT_VERSION = '1.0.0';

/**
 * Build the synthesis prompt from signal data
 * @param {object} params - Parameters for synthesis
 * @returns {object} Prompt object with version and text
 */
function buildSynthesisPrompt(params) {
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
    } = params;

    const meetingConfig = MEETING_TYPES[meetingType] || MEETING_TYPES.discovery;
    const signalCount = signals?.length || 0;
    const lowDataMode = signalCount < 3;

    // Format signals for the prompt
    const formattedSignals = signals && signals.length > 0
        ? JSON.stringify(signals, null, 2)
        : 'No structured signals available. Use general industry knowledge.';

    // Format seller context
    let sellerContext = '';

    // Basic seller info
    if (sellerCompany || sellerIndustry || sellerProducts?.length > 0) {
        sellerContext = `
SELLER COMPANY CONTEXT:
- Seller Company: ${sellerCompany || 'Not provided'}
- Seller Industry: ${sellerIndustry || 'Not provided'}
`;

        if (selectedProduct) {
            sellerContext += `
FOCUS PRODUCT (pitch this specific product):
- Product Name: ${selectedProduct.name || 'Not provided'}
- Description: ${selectedProduct.description || 'Not provided'}
- Key Features: ${selectedProduct.features?.join(', ') || 'Not provided'}
- Primary Use Cases: ${selectedProduct.useCases?.join(', ') || 'Not provided'}
`;
        } else if (sellerProducts?.length > 0) {
            sellerContext += `
SELLER PRODUCTS/SERVICES:
${sellerProducts.map(p => `- ${p.name}${p.isPrimary ? ' (Primary)' : ''}: ${p.description || 'No description'}`).join('\n')}
`;
        }
    }

    // Custom sales library (advanced features)
    if (customSalesLibrary) {
        sellerContext += `
CUSTOM SALES LIBRARY:
- ICP Definition: ${customSalesLibrary.icpDefinition || 'Not defined'}
- Key Differentiators: ${customSalesLibrary.differentiators?.join(', ') || 'Not defined'}
- ROI Framework: ${customSalesLibrary.roiFramework || 'Not defined'}
- Relevant Case Studies: ${customSalesLibrary.caseStudies?.join('; ') || 'None provided'}
- Competitive Positioning: ${customSalesLibrary.competitivePositioning || 'Not defined'}
`;
    }

    const prompt = `ROLE: You are a sales intelligence analyst. Your job is to analyze signal data about a prospect and produce structured analytical insights. You are NOT writing a sales brief - you are producing the analytical foundation that a brief will be built from.

PROSPECT INFORMATION:
- Company: ${prospectCompany}
- Website: ${prospectWebsite || 'Not provided'}
- Industry: ${prospectIndustry || 'Unknown'}
- Location: ${prospectLocation || 'Not provided'}

CONTACT INFORMATION:
- Name: ${contactName || 'Not provided'}
- Title: ${contactTitle || 'Not provided'}

MEETING TYPE: ${meetingConfig.label}
Meeting Emphasis: ${meetingConfig.emphasis}

SIGNAL DATA (${signalCount} signals available):
${formattedSignals}
${sellerContext}
${lowDataMode ? `
LOW DATA MODE ACTIVE: Only ${signalCount} signals available.
- Limit pain point hypotheses to 1-2 (clearly marked as speculative)
- Expand discovery questions to compensate for missing intelligence
- Set urgency to "Unknown - insufficient data"
- Note what data is missing and why
` : ''}

REQUIRED OUTPUT - Return ONLY this JSON structure, no additional text:
{
    "tamFit": {
        "score": <number 0-100 or null if insufficient data>,
        "label": "<Strong Fit | Good Fit | Moderate Fit | Weak Fit | Unknown>",
        "matches": ["<specific attribute that matches ICP>"],
        "gaps": ["<specific attribute that doesn't match ICP>"],
        "note": "<any important qualification about the fit assessment>"
    },
    "industryAlignment": {
        "sellerRelevance": "<how the seller's industry/products relate to the prospect's needs>",
        "crossIndustryInsights": "<relevant trends or patterns from seller's industry that apply here>",
        "terminologyGaps": "<industry jargon differences to be aware of>"
    },
    "productFit": {
        "primaryProduct": "<which seller product is most relevant and why>",
        "keyFeatures": ["<specific features that address prospect's likely needs>"],
        "valueProposition": "<specific value this product delivers to THIS prospect>"
    },
    "painPointHypotheses": [
        {
            "hypothesis": "<specific pain point this prospect likely has>",
            "evidence": "<cite specific signal(s) from the data above>",
            "confidence": <0.0-1.0>,
            "testQuestion": "<discovery question to validate this hypothesis>",
            "productConnection": "<how seller's product addresses this pain>"
        }
    ],
    "likelyObjections": [
        {
            "objection": "<specific objection this prospect is likely to raise>",
            "reason": "<why they would raise this based on their context>",
            "category": "<price | timing | competition | need | authority | trust>",
            "response": "<recommended response with specific proof points>",
            "proactiveStrategy": "<how to preempt this objection>"
        }
    ],
    "competitivePositioning": {
        "likelyAlternatives": ["<competitors or alternatives they may consider>"],
        "differentiators": ["<how seller can differentiate against these>"],
        "risks": ["<competitive risks to be aware of>"],
        "battleCards": ["<key talking points against each competitor>"]
    },
    "rapportHooks": [
        {
            "hook": "<specific detail that could build rapport>",
            "source": "<where this came from - education, shared interest, etc.>",
            "usage": "<how to naturally bring this up>"
        }
    ],
    "urgencyIndicators": [
        {
            "indicator": "<signal suggesting urgency or timing>",
            "implication": "<what this means for the deal>",
            "confidence": <0.0-1.0>
        }
    ],
    "riskFactors": [
        {
            "risk": "<potential obstacle or red flag>",
            "mitigation": "<how to address or work around this>",
            "severity": "<high | medium | low>"
        }
    ],
    "callStrategy": {
        "approach": "<aggressive close | consultative discovery | qualification-first | relationship-building>",
        "rationale": "<why this approach based on the signals>",
        "keyObjective": "<primary goal for this call>"
    },
    "missingIntelligence": ["<data that would improve this analysis if available>"]
}

CRITICAL RULES:
1. Every painPointHypothesis MUST cite specific signals from the data above. If you cannot cite a signal, do NOT include the hypothesis.
2. BANNED PHRASES - Do not use ANY of these anywhere in your response:
   ${BANNED_PHRASES.slice(0, 15).map(p => `"${p}"`).join(', ')}
3. Rate confidence 0-1 for each hypothesis. Below 0.5 = speculative.
4. Be SPECIFIC. Reference the prospect's actual company name, their specific industry context, their specific situation.
5. Do NOT invent data. Only use what is provided in the signal data above.
6. If a section has no relevant data, return an empty array or null rather than making something up.
7. The analysis should be actionable - every insight should inform how the seller approaches the call.

OBJECTION REQUIREMENTS:
8. Generate AT LEAST 3-5 likely objections. Consider:
   - Price/budget objections (especially for smaller companies or certain industries)
   - Timing objections (why now? why not later?)
   - Competition objections (why not use X instead?)
   - Need objections (do we really need this?)
   - Authority objections (I need to check with my boss)
   - Trust/risk objections (is this proven? what if it fails?)
9. Each objection response MUST include specific proof points, not generic reassurances.
10. Connect pain points to the seller's specific products/features where possible.

INDUSTRY ALIGNMENT:
11. If seller industry differs from prospect industry, identify bridge points and translation opportunities.
12. Consider how the seller's experience in their industry applies to the prospect's challenges.`;

    return {
        version: PROMPT_VERSION,
        prompt,
        lowDataMode,
        signalCount,
    };
}

module.exports = {
    PROMPT_VERSION,
    buildSynthesisPrompt,
};
