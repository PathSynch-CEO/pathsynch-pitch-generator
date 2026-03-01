/**
 * Brief Generation Prompt Builder
 *
 * Builds the prompt for LLM Call 2: Brief Generation
 * This call takes structured insights and produces the user-facing brief.
 */

const { BANNED_PHRASES, MEETING_TYPES } = require('../constants');

const PROMPT_VERSION = '1.2.0'; // Added seller context and anti-hallucination guardrails

/**
 * Build the brief generation prompt from insights
 * @param {object} params - Parameters for brief generation
 * @returns {object} Prompt object with version and text
 */
function buildBriefPrompt(params) {
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
        // Market intelligence
        marketContext,
        // Seller context for product accuracy
        sellerCompany,
        sellerIndustry,
        sellerProducts,
        selectedProduct,
    } = params;

    const meetingConfig = MEETING_TYPES[meetingType] || MEETING_TYPES.discovery;

    // Format insights for the prompt
    const formattedInsights = JSON.stringify(insights, null, 2);

    // Format news signals if available
    let newsSection = '';
    if (newsIntelligence && newsIntelligence.signals && newsIntelligence.signals.length > 0) {
        const topSignals = newsIntelligence.signals
            .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
            .slice(0, 5);

        newsSection = `
RECENT NEWS & TRIGGER EVENTS (prioritize these for conversation openers):
${topSignals.map(s => `- [${s.type.toUpperCase()}] ${s.headline}
  Summary: ${s.summary}
  Source: ${s.source} (${s.date || 'Recent'})
  Suggested Use: ${s.suggestedUse}
  Ready-to-use talking point: "${s.talkingPoint}"`).join('\n')}
${newsIntelligence.industryContext?.recentTrends?.length > 0 ? `
Industry Trends: ${newsIntelligence.industryContext.recentTrends.join('; ')}` : ''}
${newsIntelligence.industryContext?.competitorMoves?.length > 0 ? `
Competitor Activity: ${newsIntelligence.industryContext.competitorMoves.join('; ')}` : ''}
`;
    }

    // Format contact intelligence if available
    let contactSection = '';
    if (contactIntelligence && contactIntelligence.profile) {
        const profile = contactIntelligence.profile;
        contactSection = `
CONTACT INTELLIGENCE (from AI research):
- Communication Style: ${profile.communicationStyle || 'Professional'} ${profile.styleEvidence ? `(Evidence: ${profile.styleEvidence})` : ''}
${profile.recentActivity?.length > 0 ? `- Recent Activity: ${profile.recentActivity.slice(0, 3).join('; ')}` : ''}
${contactIntelligence.conversationStarters?.length > 0 ? `- AI-Generated Conversation Starters:\n  ${contactIntelligence.conversationStarters.map(s => `• ${s}`).join('\n  ')}` : ''}
${contactIntelligence.doNotMention?.length > 0 ? `
*** CRITICAL: DO NOT MENTION THESE TOPICS ***
${contactIntelligence.doNotMention.map(t => `  - ${t}`).join('\n')}
*** Avoid at all costs - these are sensitive topics ***` : ''}
`;
    }

    // Format LinkedIn match if available
    let linkedinSection = '';
    if (linkedinMatch && linkedinMatch.success && linkedinMatch.rapportHooks?.length > 0) {
        linkedinSection = `
LINKEDIN PROFILE MATCH (seller-to-contact connections):
- Match Score: ${linkedinMatch.comparison?.matchScore || 0}/10
${linkedinMatch.rapportHooks.map(h => `- ${h}`).join('\n')}
`;
    }

    // Format market intelligence if available
    let marketSection = '';
    if (marketContext && marketContext.competitorCount > 0) {
        const formatCurrency = (num) => num ? `$${(num / 1000).toFixed(0)}K` : 'N/A';
        const formatNumber = (num) => num ? num.toLocaleString() : 'N/A';

        marketSection = `
MARKET INTELLIGENCE (from attached market report):
- Location: ${marketContext.location?.city || 'Unknown'}, ${marketContext.location?.state || ''}
- Industry: ${marketContext.industry?.display || marketContext.industry || 'Unknown'}
- Total Competitors in Market: ${marketContext.competitorCount}
- Average Competitor Rating: ${marketContext.avgRating ? `${marketContext.avgRating}/5 stars` : 'N/A'}
- Market Saturation: ${marketContext.saturation || 'Unknown'} (Score: ${marketContext.saturationScore || 'N/A'}/100)
- Market Growth Rate: ${marketContext.growthRate ? `${marketContext.growthRate}% annually` : 'N/A'}
${marketContext.opportunityScore ? `- Opportunity Score: ${marketContext.opportunityScore}/100 (${marketContext.opportunityLevel || 'N/A'})` : ''}
${marketContext.opportunityFactors?.length > 0 ? `- Key Opportunity Factors: ${marketContext.opportunityFactors.join(', ')}` : ''}
${marketContext.demographics?.medianIncome ? `- Demographics: Median Income ${formatCurrency(marketContext.demographics.medianIncome)}, Population ${formatNumber(marketContext.demographics.population)}` : ''}
${marketContext.demandSignals?.trendDirection ? `- Demand Trend: ${marketContext.demandSignals.trendDirection} (${marketContext.demandSignals.yoyChange > 0 ? '+' : ''}${marketContext.demandSignals.yoyChange}% YoY)` : ''}
${marketContext.topCompetitors?.length > 0 ? `
Top Local Competitors:
${marketContext.topCompetitors.slice(0, 3).map(c => `  - ${c.name}${c.rating ? ` (${c.rating}★, ${c.reviews || 0} reviews)` : ''}`).join('\n')}` : ''}

Use this market data to:
1. Reference competitive landscape in objection prep
2. Frame opportunity based on market saturation/growth
3. Use demographic data to tailor value proposition
4. Reference specific competitors if relevant
`;
    }

    // Format seller context with product grounding
    let sellerSection = '';
    if (sellerCompany || sellerProducts?.length > 0 || selectedProduct) {
        const productDescription = selectedProduct?.description ||
            (sellerProducts?.length > 0 ? sellerProducts.map(p => `${p.name}: ${p.description || 'No description'}`).join('; ') : null);

        sellerSection = `
=============================================================================
SELLER CONTEXT (CRITICAL - READ CAREFULLY)
=============================================================================
- Seller Company: ${sellerCompany || 'Not provided'}
- Seller Industry: ${sellerIndustry || 'Not provided'}
${selectedProduct ? `
PRODUCT BEING PITCHED:
- Product Name: ${selectedProduct.name || 'Not provided'}
- Product Description: ${selectedProduct.description || 'Not provided'}
${selectedProduct.features?.length > 0 ? `- Key Features: ${selectedProduct.features.join(', ')}` : ''}
${selectedProduct.useCases?.length > 0 ? `- Use Cases: ${selectedProduct.useCases.join(', ')}` : ''}
` : sellerProducts?.length > 0 ? `
SELLER PRODUCTS/SERVICES:
${sellerProducts.map(p => `- ${p.name}${p.isPrimary ? ' (Primary)' : ''}: ${p.description || 'No description'}`).join('\n')}
` : '- Product Description: Not provided'}

*** CRITICAL PRODUCT ACCURACY RULES ***
1. You MUST only reference features and capabilities that exist in the product description above. Do NOT invent, assume, or hallucinate product features.
2. Every "Solution" in talking points MUST map to a real capability from the seller's product description. If the product doesn't have a feature relevant to a pain point, acknowledge the pain point but frame the solution around what the product ACTUALLY does.
3. The seller is NOT selling industry-specific tools (e.g., not selling auto repair software to auto shops). The seller is selling THEIR product to businesses in that industry. Frame accordingly.
4. When describing solutions, explain how the seller's actual product solves the prospect's pain points. Be creative about the connection, but NEVER fabricate features.
5. If the product description is missing or vague, focus on discovery rather than solution-pitching.

COMPETITOR WATCH RULES:
- Only list competitors to the SELLER'S product, not companies in the prospect's industry
- If no competitor information is available, output: "Research needed — identify prospect's current solutions during the discovery call"
- Never guess or hallucinate competitor names
=============================================================================
`;
    }

    const prompt = `ROLE: You are writing a pre-call brief for a sales rep about to get on a call. Write in direct, actionable language. The rep has 5 minutes to read this before the call.

PROSPECT: ${prospectCompany}${prospectWebsite ? ` (${prospectWebsite})` : ''}
INDUSTRY: ${prospectIndustry || 'Unknown'}
CONTACT: ${contactName || 'Unknown'}${contactTitle ? `, ${contactTitle}` : ''}

MEETING TYPE: ${meetingConfig.label}
Meeting Emphasis: ${meetingConfig.emphasis}

ANALYTICAL INSIGHTS (from intelligence analysis):
${formattedInsights}
${newsSection}${contactSection}${linkedinSection}${marketSection}${sellerSection}
USER TIER: ${userTier || 'starter'}

OUTPUT FORMAT - Return ONLY this JSON, no additional text or markdown:
{
    "companySnapshot": "<2-3 sentence overview of the company, their business model, and market position. Be specific to THIS company.>",
    "contactSnapshot": "<2-3 sentence overview of the contact person, their role, and likely priorities. Reference specific details if available.>",
    "tamFitSummary": "<One sentence summary of how well this prospect fits the ideal customer profile, with key match/gap points>",
    "whyTheyTookMeeting": "<1-2 sentences hypothesizing why they agreed to meet based on available data. Be specific, not generic.>",
    "suggestedOpener": "<A specific, personalized opening line. Must reference something specific about THEM - a recent post, company news, hiring activity, etc. Never open with generic company praise.>",
    "callStrategy": "<2-3 sentences describing the recommended approach for this call based on TAM fit and urgency. Should reference specific insights.>",
    "painPointHypotheses": [
        {
            "painPoint": "<specific pain point>",
            "evidence": "<why we believe this>",
            "talkingPoint": "<how to address this in the conversation>"
        }
    ],
    "customSignals": [
        {
            "signal": "<notable intelligence signal>",
            "implication": "<what this means for the deal>",
            "action": "<how to use this in the call>"
        }
    ],
    "talkingPoints": [
        "<Each point must connect a specific prospect pain to a specific capability. No generic value props. Format: Pain → Solution → Benefit>"
    ],
    "discoveryQuestions": [
        "<Question — [Tests hypothesis: X]>"
    ],
    "objectionPrep": [
        {
            "objection": "<likely objection based on insights>",
            "category": "<price | timing | competition | need | authority | trust>",
            "response": "<suggested response that addresses the specific concern with proof points>",
            "proactiveStrategy": "<how to preempt this objection before they raise it>"
        }
    ],
    "industryBridge": "<if seller and prospect are in different industries, how to bridge the gap and speak their language>",
    "productFocus": {
        "product": "<which seller product/service to emphasize>",
        "keyFeatures": ["<2-3 features most relevant to this prospect>"],
        "valueProposition": "<specific value statement for THIS prospect>"
    },
    "rapportHooks": [
        "<specific conversation starters based on shared interests, education, background, etc.>"
    ],
    "urgencyAssessment": "<Assessment of deal urgency based on signals. Include specific timing indicators if available.>",
    "riskFactors": [
        "<specific risks to the deal with mitigation suggestions>"
    ],
    "competitorWatch": [
        "<competitors they might be considering with differentiation points>"
    ],
    "recommendedNextSteps": "<What should the next step be after this meeting. Be specific based on meeting type and insights.>",
    "doNotMention": [
        "<topics or references to avoid based on any signals - e.g., recent layoffs, negative news, sensitive topics>"
    ]
}

CRITICAL RULES:

1. SUGGESTED OPENER: Must reference a SPECIFIC signal from the insights. Examples of good openers:
   - "I noticed you recently posted about scaling your outbound team..."
   - "Congratulations on the Series B - that's exciting growth..."
   - "I saw you're hiring 4 SDRs - sounds like pipeline generation is a focus..."
   NEVER use generic openers like "Thanks for taking the time" or "I've been following your company..."

2. DISCOVERY QUESTIONS: Each question should map to a pain point hypothesis. Format as:
   "Question text — [Tests hypothesis: brief hypothesis description]"

3. TALKING POINTS: Each point must follow the Pain → Solution → Benefit structure.
   Bad: "We help companies improve their sales process"
   Good: "Your team is doing manual prospect research (pain) → Our pre-call briefs automate intelligence gathering (solution) → Your reps spend time selling instead of researching (benefit)"

4. BANNED PHRASES - Do not use ANY of these:
   ${BANNED_PHRASES.map(p => `"${p}"`).join(', ')}

5. CALL STRATEGY must reference:
   - The TAM fit score/label from insights
   - Urgency indicators
   - Recommend specific approach: aggressive close vs. deep discovery vs. qualification-first

6. Keep the entire brief CONCISE. Reps don't read novels. Each section should be scannable.

7. If insights indicate LOW DATA MODE or missing intelligence:
   - Acknowledge gaps honestly
   - Emphasize discovery over pitching
   - Include more open-ended questions
   - Suggest gathering specific information during the call

8. Be SPECIFIC throughout. Reference the actual company name, their actual industry, actual signals.
   Generic briefs are useless briefs.

9. OBJECTIONS - Generate AT LEAST 4-5 objections. Use the likelyObjections from insights and:
   - Include a mix of categories: price, timing, competition, need, authority, trust
   - Each response MUST include specific proof points, not generic reassurances
   - Include proactive strategies to preempt objections before they're raised
   - Consider the prospect's company size, industry, and likely budget constraints

10. INDUSTRY BRIDGE - If the seller's industry differs from the prospect's:
    - Include an industryBridge field explaining how to translate value
    - Note terminology differences to be aware of
    - Reference cross-industry success stories if mentioned in insights

11. PRODUCT FOCUS - If seller product info is available:
    - Highlight the most relevant product/features for THIS prospect
    - Create a specific value proposition connecting product to prospect's pains
    - CRITICAL: Only mention features that exist in the SELLER CONTEXT section
    - NEVER invent features that "sound relevant" to the prospect's industry

12. NEWS SIGNALS - If RECENT NEWS & TRIGGER EVENTS section is provided:
    - PRIORITIZE these for the suggestedOpener - news is the best conversation starter
    - Include relevant news signals in customSignals array
    - Use the ready-to-use talking points provided
    - If there's funding news, acknowledge it positively
    - If there's expansion/hiring news, connect it to growth challenges you can help with
    - Industry trends should inform your urgencyAssessment

13. DO NOT MENTION - If the contact intelligence includes a "DO NOT MENTION" section:
    - CRITICAL: Include ALL items in your doNotMention array
    - Never reference these topics in openers, talking points, or questions
    - These are sensitive topics identified through research - violating this can kill the deal
    - Examples: recent layoffs, lawsuits, executive departures, failed projects

14. CONTACT INTELLIGENCE - If AI-generated conversation starters are provided:
    - Use them in your rapportHooks section
    - These are research-backed, not generic - they reference real information about the contact
    - Adapt the communication style based on the profile's communicationStyle field

15. PRODUCT ACCURACY (CRITICAL - VIOLATION WILL CAUSE SALES FAILURE):
    - ONLY reference features explicitly described in the SELLER CONTEXT section
    - NEVER invent industry-specific tools (e.g., inventory management, diagnostic tools, training systems) unless explicitly in the product description
    - If the seller sells "forms and surveys", solutions should be about forms and surveys - not about unrelated capabilities
    - For talking points: If you cannot connect the seller's actual product to a pain point, DO NOT force-fit a fake solution. Instead, focus on discovery questions.
    - For competitorWatch: ONLY list competitors to the seller's actual product. Do NOT list companies in the prospect's industry as competitors.
      Example: If seller sells forms/surveys, competitors are Typeform, JotForm, SurveyMonkey - NOT industry software like Shopmonkey or Mitchell1
    - If no competitor info is available, output: "Research needed — identify prospect's current solutions during discovery"

16. EXAMPLE OF CORRECT vs INCORRECT:
    Seller product: "PathConnect Forms — a no-code form, quiz and survey ecosystem"
    Prospect: Auto repair shop

    INCORRECT (hallucinated features):
    - "Our inventory management tools help control costs" ❌
    - "Our diagnostic tools help technicians" ❌
    - Competitors: "Shopmonkey, Mitchell 1, ALLDATA" ❌

    CORRECT (uses actual product):
    - "PathConnect Forms can capture post-service customer feedback, helping you identify issues before they become negative reviews" ✓
    - "Our quiz builder can help qualify leads on your website before they call" ✓
    - Competitors: "Google Forms, Typeform, JotForm" ✓ (or "Research needed" if unknown)`;

    return {
        version: PROMPT_VERSION,
        prompt,
    };
}

module.exports = {
    PROMPT_VERSION,
    buildBriefPrompt,
};
