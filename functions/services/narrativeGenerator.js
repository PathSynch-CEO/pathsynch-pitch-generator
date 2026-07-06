/**
 * AI Narrative Generator
 * Extracted from market.js — generates executive summary + competitor analysis via Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { identifyMarketLeader, getDominanceLanguage } = require('./opportunityScorer');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAIExecutiveSummary(city, industry, competitors, leads, news, benchmarks, profileGuidance = '') {
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

        const guidanceBlock = (profileGuidance && profileGuidance.trim())
            ? `\n\nREPORT GUIDANCE (apply silently — do NOT copy, quote, echo, or restate any of this text in your output):\n${profileGuidance.trim()}\n`
            : '';

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
${guidanceBlock}
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

/**
 * S3: Generate 3-5 institutional/strategic reference players that shape the market
 * but are unlikely to appear in local Google Places results.
 *
 * Uses gemini-2.5-flash (thinkingBudget:0, JSON output).
 * Returns [] on failure — reference players section is optional.
 */
async function generateReferenceCompetitors(city, industry, subIndustry, localNames) {
    const location = city || 'this market';
    const vertical = subIndustry || industry || 'this industry';
    const localNamesStr = (localNames || []).slice(0, 15).join(', ') || 'none identified';

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const prompt = `IMPORTANT: Output ONLY a valid JSON array. Start your response with [ and end with ]. Do not include any explanation or text outside the JSON.

You are building a competitive intelligence report for ${vertical} in ${location}.

The following businesses were already identified in local Google Places search results:
${localNamesStr}

Your task: identify 3-5 institutional, regional, or national players that STRATEGICALLY SHAPE this market but are NOT local storefronts that would appear in a Google Places search. Think of franchise brands, national chains, well-known regional leaders, or category-defining institutions in ${vertical}.

Do NOT include any of the already-identified local businesses above.

Return a JSON array:
[
  {
    "name": "Company or brand name",
    "description": "1-sentence explanation of why this player matters as strategic context for a local sales rep",
    "priceLevel": 1-4 (1=budget, 2=mid, 3=premium, 4=luxury),
    "threatLevel": "high|medium|low"
  }
]

Return exactly 3-5 objects. If this market has no well-known institutional players, return realistic placeholder names from similar markets.`;

        const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
        const text = result.response.text();
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start === -1 || end === -1) return [];
        const parsed = JSON.parse(text.substring(start, end + 1));
        if (!Array.isArray(parsed)) return [];
        // Validate shape
        return parsed
            .filter(p => p && typeof p.name === 'string' && p.name.trim())
            .map(p => ({
                name: p.name.trim(),
                description: p.description || '',
                priceLevel: typeof p.priceLevel === 'number' ? p.priceLevel : null,
                threatLevel: p.threatLevel || 'medium',
                isReferencePlayer: true,
                disclaimer: 'Strategic context only — not verified as a direct local search competitor.'
            }))
            .slice(0, 5);
    } catch (e) {
        console.warn('[MarketIntel] Reference competitors generation failed:', e.message);
        return [];
    }
}

async function generateCompetitorAnalysis(city, industry, competitors, benchmarks, seoLandscape, referenceCompetitors, profileGuidance = '') {
    // Market leader = composite score (40% rating + 60% volume)
    const marketLeader = identifyMarketLeader(competitors);
    const avgRating = parseFloat(benchmarks?.avgRating) || 4.5;
    const avgReviews = parseInt(benchmarks?.avgReviews) || 100;

    // Build seoTier lookup from seoLandscape.scored (keyed by name)
    const seoTierByName = {};
    if (seoLandscape?.scored?.length) {
        for (const sc of seoLandscape.scored) {
            if (sc.name) seoTierByName[sc.name] = sc.tier || 'unknown';
        }
    }

    // Build competitor JSON array (up to 20) with seoTier
    const competitorData = competitors.slice(0, 20).map(c => ({
        name: c.name,
        rating: c.rating || null,
        reviewCount: c.reviewCount || c.reviews || 0,
        seoTier: seoTierByName[c.name] || null
    }));

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        // S3: Include reference players context in the prompt when available
        const refPlayersCtx = (Array.isArray(referenceCompetitors) && referenceCompetitors.length > 0)
            ? `\n\nSTRATEGIC REFERENCE PLAYERS (institutional/national — NOT in local search results): ${referenceCompetitors.map(r => r.name).join(', ')}. When writing the narrative, briefly distinguish local competitors from these strategic-context players.`
            : '';

        const guidanceBlock = (profileGuidance && profileGuidance.trim())
            ? `\n\nREPORT GUIDANCE (apply silently — do NOT copy, quote, echo, or restate any of this text in your output):\n${profileGuidance.trim()}\n`
            : '';

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are analyzing the competitive landscape for ${industry} in ${city}.

You have data on ${competitorData.length} DIRECT LOCAL COMPETITORS (from Google Places): ${JSON.stringify(competitorData)}${refPlayersCtx}

The market leader is ${marketLeader.name} (${marketLeader.rating}\u2605, ${marketLeader.reviewCount || marketLeader.reviews || 0} reviews).
Market average rating: ${avgRating.toFixed(2)}. Average review count: ${avgReviews}.

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

NARRATIVE RULES (write exactly two paragraphs for the "narrative" field):

PARAGRAPH 1 \u2014 Market Structure:
Identify 2-3 competitive archetypes in this market. Name specific businesses as examples. Describe what separates the market leader from the field. Is the market dominated or fragmented? Do NOT restate numbers. Interpret them.

PARAGRAPH 2 \u2014 The Opportunity Pattern:
Identify the gap pattern. Which businesses have quality but not presence? What does the gap between leader and median suggest about uncaptured demand? End with one sentence a sales rep could use as a conversation opener.

NARRATIVE CONSTRAINTS:
- Maximum 120 words per paragraph
- Name at least 3 specific businesses across both paragraphs
- No generic phrases like "high level of customer satisfaction"
- Write as if briefing a sales rep, not publishing a report
- No bullet points \u2014 flowing prose only

COMPETITOR TYPES RULES (for the "competitorTypes" array):
- Identify 2-4 distinct competitive archetypes in this market
- Each type must have real business names from the data as examples (2-3 each)
- "opportunity" = "high" means these businesses are ideal targets for outreach
- "threat" = "high" means these are well-established competitors
- Be specific with typeName \u2014 not just "High Volume" but "Review Volume Leaders" or "Quality Boutiques"${guidanceBlock}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            const parsed = JSON.parse(text.substring(start, end + 1));
            if (parsed.narrative && parsed.competitorTypes) {
                return parsed;
            }
            if (parsed.narrative) {
                return { narrative: parsed.narrative, competitorTypes: [] };
            }
        }
        // Fallback: treat entire response as plain narrative
        return { narrative: text, competitorTypes: [] };
    } catch (e) {
        console.warn('[MarketIntel] Competitor Analysis failed:', e.message);
        // Static fallback so the section is never blank
        const fallbackNarrative = `${city} ${industry} shows ${competitors.length} competitors with ${marketLeader.name} leading the field. The gap between the leader and the median represents a clear opening for reputation-focused outreach.`;
        return { narrative: fallbackNarrative, competitorTypes: [] };
    }
}

module.exports = { generateAIExecutiveSummary, generateCompetitorAnalysis, generateReferenceCompetitors };
