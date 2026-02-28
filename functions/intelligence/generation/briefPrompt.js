/**
 * Brief Generation Prompt Builder
 *
 * Builds the prompt for LLM Call 2: Brief Generation
 * This call takes structured insights and produces the user-facing brief.
 */

const { BANNED_PHRASES, MEETING_TYPES } = require('../constants');

const PROMPT_VERSION = '1.1.0'; // Updated for AI Agent support

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

    const prompt = `ROLE: You are writing a pre-call brief for a sales rep about to get on a call. Write in direct, actionable language. The rep has 5 minutes to read this before the call.

PROSPECT: ${prospectCompany}${prospectWebsite ? ` (${prospectWebsite})` : ''}
INDUSTRY: ${prospectIndustry || 'Unknown'}
CONTACT: ${contactName || 'Unknown'}${contactTitle ? `, ${contactTitle}` : ''}

MEETING TYPE: ${meetingConfig.label}
Meeting Emphasis: ${meetingConfig.emphasis}

ANALYTICAL INSIGHTS (from intelligence analysis):
${formattedInsights}
${newsSection}${contactSection}${linkedinSection}${marketSection}
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
    - Adapt the communication style based on the profile's communicationStyle field`;

    return {
        version: PROMPT_VERSION,
        prompt,
    };
}

module.exports = {
    PROMPT_VERSION,
    buildBriefPrompt,
};
