/**
 * AI Narrative Generator
 * Extracted from market.js — generates executive summary + competitor analysis via Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { identifyMarketLeader, getDominanceLanguage } = require('./opportunityScorer');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAIExecutiveSummary(city, industry, competitors, leads, news, benchmarks) {
    // Build data context for the prompt
    // Market leader = composite score (40% rating + 60% volume)
    const marketLeader = identifyMarketLeader(competitors);
    const topLead = leads[0] || {};
    const avgReviews = parseInt(benchmarks?.avgReviews) || 100;
    const avgRating = parseFloat(benchmarks?.avgRating) || 4.5;
    const leaderReviews = parseInt(marketLeader.reviewCount || marketLeader.reviews) || 0;
    const multiplier = avgReviews > 0 ? (leaderReviews / avgReviews).toFixed(1) : 'N/A';

    const dominanceVerb = getDominanceLanguage(marketLeader, avgReviews);

    const summaryData = {
        geography: city,
        industry: industry,
        marketLeader: {
            name: marketLeader.name || 'Unknown',
            rating: marketLeader.rating || 0,
            reviews: leaderReviews
        },
        dominanceVerb: dominanceVerb,
        benchmarks: {
            avgRating: avgRating,
            avgReviews: avgReviews,
            totalCompetitors: competitors.length,
            topQuartileAvg: benchmarks?.topQuartileAvg || avgRating
        },
        qualifiedLeadsCount: leads.length,
        topLead: {
            name: topLead.name || 'Unknown',
            rating: topLead.rating || 0,
            reviews: parseInt(topLead.reviewCount || topLead.reviews) || 0,
            opportunityScore: topLead.opportunityScore || 0,
            label: topLead.opportunityLabel || ''
        },
        multiplier: multiplier
    };

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const prompt = `Write a 4-sentence executive summary for this Market Intelligence Report.

This is a strategic briefing for a SALES REP — not a pitch to a prospect. Not a data description. Not a textbook.

SENTENCE 1 — The thesis:
Open with the single most important insight. Name the market leader explicitly. State their dominant metric.
Use the dominanceVerb from the data (e.g. "dominates", "leads", "edges out the field in") — do NOT always say "dominates".
Format: "[Market leader] [dominanceVerb] [geography] [industry] with [X] reviews — [X]x the market average of [Y]."

SENTENCE 2 — The gap:
Quantify the opportunity. Reference the qualified leads count and their profile.
Format: "[N] qualified leads identified — all with [rating]+ stars and fewer than [ceiling] reviews, meaning strong quality with underdeveloped digital presence."

SENTENCE 3 — The white space:
Describe the strategic opening. What pattern do the qualified leads share?
Format: "The high-reputation, low-presence quadrant is populated — businesses with the ratings to compete but not the review volume to be found."

SENTENCE 4 — The action:
One specific action. Name the top-ranked lead by name with their key stats.
Format: "Start with [top lead] — [rating]\u2605, [N] reviews, opportunity score [X] — highest-scoring lead in this market."

RULES:
- NEVER open with "The market exhibits..." or "The [industry] market in [city] is..." or similar data-description language.
- NEVER use phrases like "as evidenced by", "suggesting a generally", "indicating a", "characterized by".
- NEVER address a prospect directly. This is internal intelligence.
- ALWAYS name at least two specific businesses by name.
- ALWAYS include at least three specific numbers.
- ALWAYS end with a specific action referencing the #1 ranked lead.
- Keep it to exactly 4 sentences. No more.
- Write in active voice. Be direct. Be specific.
- Output ONLY the 4 sentences. No headings, no labels, no markdown.

DATA:
${JSON.stringify(summaryData, null, 2)}`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.warn('[MarketIntel] AI Summary failed:', e.message);

        // Fallback: template-based summary
        try {
            const d = summaryData;
            return `${d.marketLeader.name} ${d.dominanceVerb} ${d.geography} ${d.industry} with ${d.marketLeader.reviews} reviews \u2014 ${d.multiplier}x the market average of ${d.benchmarks.avgReviews}. ${d.qualifiedLeadsCount} qualified leads identified with strong ratings and underdeveloped digital presence. The gap between reputation quality and online visibility represents a clear opportunity for targeted outreach. Start with ${d.topLead.name} \u2014 ${d.topLead.rating}\u2605, ${d.topLead.reviews} reviews, opportunity score ${d.topLead.opportunityScore}.`;
        } catch (fallbackErr) {
            return null;
        }
    }
}

async function generateCompetitorAnalysis(city, industry, competitors, benchmarks) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        // Market leader = composite score (40% rating + 60% volume)
        const marketLeader = identifyMarketLeader(competitors);
        const avgRating = parseFloat(benchmarks.avgRating) || 4.5;
        const avgReviews = parseInt(benchmarks.avgReviews) || 100;

        const competitorList = competitors.slice(0, 10)
            .map(c => `${c.name}: ${c.rating}\u2605, ${c.reviewCount || c.reviews || 0} reviews`)
            .join('\n');

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are analyzing the competitive landscape for ${industry} in ${city}.

You have data on ${competitors.length} competitors:
${competitorList}

Market leader: ${marketLeader.name} (${marketLeader.rating}\u2605, ${marketLeader.reviewCount || marketLeader.reviews || 0} reviews)
Market average rating: ${avgRating.toFixed(2)}\u2605. Average review count: ${avgReviews}.

Return a JSON object with two fields:

{
  "narrative": "Two paragraphs of competitive analysis separated by \\n\\n",
  "competitorTypes": [
    {
      "typeName": "archetype label (2-4 words)",
      "description": "1-sentence description of this archetype",
      "examples": ["Business Name 1", "Business Name 2"],
      "priceRange": "Budget|Mid|Premium",
      "threat": "high|medium|low",
      "opportunity": "high|medium|low"
    }
  ]
}

NARRATIVE RULES (for the "narrative" field):
PARAGRAPH 1 \u2014 Market Structure: Identify 2-3 competitive archetypes. Name specific businesses. What separates the leader from the field? Dominated or fragmented?
PARAGRAPH 2 \u2014 Opportunity Pattern: Gap pattern. Quality-without-presence businesses. End with a conversation opener for a sales rep.
- Max 120 words per paragraph. Name 3+ businesses. No generic phrases. Flowing prose, no bullet points.

COMPETITOR TYPES RULES (for the "competitorTypes" array):
- Identify 2-4 distinct competitive archetypes in this market
- Each type must have real business names from the data as examples (2-3 each)
- "opportunity" = "high" means these businesses are ideal targets for outreach
- "threat" = "high" means these are well-established competitors
- Be specific with typeName — not just "High Volume" but "Review Volume Leaders" or "Quality Boutiques"`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            const parsed = JSON.parse(text.substring(start, end + 1));
            if (parsed.narrative && parsed.competitorTypes) {
                return parsed;
            }
            // If only narrative, wrap it
            if (parsed.narrative) {
                return { narrative: parsed.narrative, competitorTypes: [] };
            }
        }
        // Fallback: treat as plain text narrative
        return { narrative: text, competitorTypes: [] };
    } catch (e) {
        console.warn('[MarketIntel] Competitor Analysis failed:', e.message);
        return null;
    }
}

module.exports = { generateAIExecutiveSummary, generateCompetitorAnalysis };
