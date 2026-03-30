/**
 * AI Narrative Generator
 * Extracted from market.js — generates executive summary + competitor analysis via Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAIExecutiveSummary(city, industry, competitors, leads, news, benchmarks) {
    // Build data context for the prompt
    const marketLeader = competitors[0] || {};
    const topLead = leads[0] || {};
    const avgReviews = parseInt(benchmarks?.avgReviews) || 100;
    const avgRating = parseFloat(benchmarks?.avgRating) || 4.5;
    const leaderReviews = parseInt(marketLeader.reviewCount || marketLeader.reviews) || 0;
    const multiplier = avgReviews > 0 ? (leaderReviews / avgReviews).toFixed(1) : 'N/A';

    const summaryData = {
        geography: city,
        industry: industry,
        marketLeader: {
            name: marketLeader.name || 'Unknown',
            rating: marketLeader.rating || 0,
            reviews: leaderReviews
        },
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
Format: "[Market leader] dominates [geography] [industry] with [X] reviews — [X]x the market average of [Y]."

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
            return `${d.marketLeader.name} leads ${d.geography} ${d.industry} with ${d.marketLeader.reviews} reviews \u2014 ${d.multiplier}x the market average of ${d.benchmarks.avgReviews}. ${d.qualifiedLeadsCount} qualified leads identified with strong ratings and underdeveloped digital presence. The gap between reputation quality and online visibility represents a clear opportunity for targeted outreach. Start with ${d.topLead.name} \u2014 ${d.topLead.rating}\u2605, ${d.topLead.reviews} reviews, opportunity score ${d.topLead.opportunityScore}.`;
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

        const marketLeader = competitors[0] || {};
        const avgRating = parseFloat(benchmarks.avgRating) || 4.5;
        const avgReviews = parseInt(benchmarks.avgReviews) || 100;

        const competitorList = competitors.slice(0, 10)
            .map(c => `${c.name}: ${c.rating}\u2605, ${c.reviewCount || c.reviews || 0} reviews`)
            .join('\n');

        const prompt = `You are analyzing the competitive landscape for ${industry} in ${city}.

You have data on ${competitors.length} competitors:
${competitorList}

Market leader: ${marketLeader.name} (${marketLeader.rating}\u2605, ${marketLeader.reviewCount || marketLeader.reviews || 0} reviews)
Market average rating: ${avgRating.toFixed(2)}\u2605. Average review count: ${avgReviews}.

Write exactly TWO paragraphs of competitive analysis.

PARAGRAPH 1 \u2014 Market Structure:
Identify the 2-3 competitive archetypes present in this market.
Name specific businesses as examples of each archetype.
Describe what separates the market leader from the field \u2014 is it volume, quality, or both?
Is the market dominated by one player or fragmented?
DO NOT just restate the numbers. Interpret what they mean strategically.

PARAGRAPH 2 \u2014 The Opportunity Pattern:
Identify the specific gap pattern in this market.
Which businesses have the quality but not the presence?
What does the gap between the leader and the median suggest about where customer demand is not being captured?
End with one sentence a sales rep could use as a conversation opener.

CONSTRAINTS:
- Maximum 120 words per paragraph
- Name at least 3 specific businesses by name across both paragraphs
- No generic phrases like "high level of customer satisfaction"
- Write as if briefing a sales rep, not publishing a market report
- No bullet points \u2014 flowing prose only
- Output ONLY the two paragraphs. No headings, no labels.`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.warn('[MarketIntel] Competitor Analysis failed:', e.message);
        return null;
    }
}

module.exports = { generateAIExecutiveSummary, generateCompetitorAnalysis };
