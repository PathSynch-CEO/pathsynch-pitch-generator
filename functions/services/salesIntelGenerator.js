/**
 * Sales Intelligence & Recommendations Generator
 * Extracted from market.js — generates sales intel + recommendations via Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { identifyMarketLeader } = require('./opportunityScorer');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateSalesIntel(city, industry, competitors, leads, trends, benchmarks, news, verticalConfig) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const topLeads = leads.slice(0, 3).map(l =>
            `${l.name} (${l.rating || 'N/A'}\u2605, ${l.reviewCount || 0} reviews, score: ${l.opportunityScore})`
        ).join('; ');

        const newsThemes = (news || []).slice(0, 5).map(n => n.title).join('; ');

        // Build vertical pain context if available
        let verticalPainContext = '';
        if (verticalConfig) {
            verticalPainContext = `\nKey pain points for ${verticalConfig.industryName} businesses:
${verticalConfig.painPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Pitch angle: ${verticalConfig.pitchAngle}

Use these known vertical pain points to ground the sales intel. Reference them where they match the market data.
`;
        }

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a sales intelligence analyst for PathSynch, a local business reputation platform. Generate sales intelligence for a rep selling PathSynch to ${industry} businesses in ${city}.

Market data:
- Market average rating: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader}
- Top opportunity leads: ${topLeads}
- Recent market news: ${newsThemes}
- New openings detected: ${trends?.newOpenings?.length || 0}
${verticalPainContext}
Generate a JSON object with exactly these fields:
{
  "topPainPoints": [
    "specific pain point 1 for this market",
    "specific pain point 2",
    "specific pain point 3"
  ],
  "objectionResponses": [
    {
      "objection": "they will say this",
      "response": "you say this with specific data"
    },
    {
      "objection": "second common objection",
      "response": "your data-backed response"
    }
  ],
  "entryWedge": "single best opening line for cold outreach referencing the ${benchmarks?.avgRating}\u2605 market average",
  "bestTimeToCall": "specific recommendation based on ${industry} business patterns",
  "competitorVulnerability": "name one specific competitor and their key weakness",
  "talkingPoints": [
    "data-backed talking point 1",
    "data-backed talking point 2",
    "data-backed talking point 3"
  ]
}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] Sales intel failed:', e.message);
        return null;
    }
}

async function generateRecommendations(city, industry, leads, benchmarks, salesIntel, trends) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const top5 = leads.slice(0, 5).map((l, i) =>
            `${i + 1}. ${l.name}: ${l.rating || 'N/A'}\u2605, ${l.reviewCount || 0} reviews, score: ${l.opportunityScore}/100${l.ownerName ? ', Owner: ' + l.ownerName : ''}`
        ).join('\n');

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a sales strategy advisor for PathSynch. Create a prioritized action plan for a sales rep targeting ${industry} businesses in ${city}.

Top leads:
${top5}

Context:
- Market average: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader}
- Entry wedge: ${salesIntel?.entryWedge || 'not available'}
- Market trend: ${(trends?.newOpenings?.length || 0) > 2 ? 'growing' : 'stable'}

Generate a JSON object with exactly these fields:
{
  "priorityActions": [
    {
      "rank": 1,
      "action": "specific action to take",
      "businessName": "name from leads",
      "reason": "why this is #1 priority",
      "openingLine": "exact words to say or write",
      "timing": "when to reach out"
    },
    { "rank": 2, "action": "...", "businessName": "...", "reason": "...", "openingLine": "...", "timing": "..." },
    { "rank": 3, "action": "...", "businessName": "...", "reason": "...", "openingLine": "...", "timing": "..." }
  ],
  "weeklyGoal": "specific measurable goal for this market this week",
  "sequenceRecommendation": "which Instantly.ai sequence type to use for this vertical",
  "expectedOutcome": "realistic 30-day outcome with data basis",
  "quickWin": "single fastest path to a demo booking in this market"
}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] Recommendations failed:', e.message);
        return null;
    }
}

async function generateHighImpactMoves(city, industry, competitors, leads, benchmarks, news, verticalConfig) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        // Market leader = composite score (40% rating + 60% volume)
        const marketLeader = identifyMarketLeader(competitors);

        const topLead = leads[0] || {};
        const avgRating = parseFloat(benchmarks?.avgRating) || 4.5;
        const avgReviews = parseInt(benchmarks?.avgReviews) || 100;
        const newsHeadlines = (news || []).slice(0, 3).map(n => n.title || '').filter(Boolean).join('; ') || 'None';
        const seasonalTriggers = verticalConfig?.seasonalTriggers?.join(', ') || 'None';

        const top5 = leads.slice(0, 5).map(l =>
            `${l.name}: ${l.rating || 'N/A'}\u2605, ${l.reviewCount || l.reviews || 0} reviews, score ${l.opportunityScore}/100${l.decisionMaker?.name ? ', DM: ' + l.decisionMaker.name : ''}`
        ).join('\n');

        const prompt = `IMPORTANT: Output ONLY a valid JSON array. Start your response with [ and end with ]. Do not include any explanation or text outside the JSON.

Generate 3-5 High-Impact Moves for a sales rep pitching PathSynch to ${industry} businesses in ${city}.

MARKET DATA:
- Market leader: ${marketLeader.name || 'Unknown'} (${marketLeader.rating || 0}\u2605, ${marketLeader.reviewCount || marketLeader.reviews || 0} reviews)
- Market avg: ${avgRating}\u2605, ${avgReviews} reviews
- Top leads:
${top5}
- Seasonal context: ${seasonalTriggers}
- News signals: ${newsHeadlines}

Each move MUST have:
- "title": Action-oriented, 5-8 words, verb-first (e.g. "Target the quality-without-presence gap")
- "context": 1-2 sentences explaining WHY this move matters NOW using specific data from above
- "action": The specific thing the sales rep does. Name a business from the leads.
- "timing": When to execute and why (e.g. "This week — before tax season ends")
- "expectedOutcome": Realistic 30-day result (e.g. "2-3 demo meetings booked")

RULES:
- Moves should be SEQUENCED — Move 1 creates the condition for Move 2
- Every move references at least one specific data point or business name
- Max 80 words per move total
- Be specific, not generic. "Call Delerme CPA" not "Reach out to prospects"
- Return as JSON array of objects`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            const parsed = JSON.parse(text.substring(start, end + 1));
            if (Array.isArray(parsed) && parsed.length >= 2) {
                return parsed.slice(0, 5);
            }
        }
        return null;
    } catch (e) {
        console.warn('[MarketIntel] High-Impact Moves failed:', e.message);
        return null;
    }
}

module.exports = { generateSalesIntel, generateRecommendations, generateHighImpactMoves };
