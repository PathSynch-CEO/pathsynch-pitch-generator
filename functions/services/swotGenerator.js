/**
 * SWOT Analysis Generator
 * Extracted from market.js — generates SWOT via Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// A lead is "high opportunity" once it reaches the Strong band (opportunityScore >= 60),
// matching the interpretation bands in opportunityScorer.calculateOpportunityScore
// (>=80 Priority, >=60 Strong, >=40 Moderate). The previous magic `> 70` cutoff sat
// between Strong and Priority, so a market of Strong-but-sub-70 qualified leads reported
// "0 of N high-opportunity leads" — contradicting the report that lists them as qualified.
const HIGH_OPPORTUNITY_MIN_SCORE = 60;

/**
 * Count leads that meet the high-opportunity (Strong+) threshold.
 * Coerces opportunityScore defensively — unscored leads (undefined/NaN) do not count.
 * @param {Array} leads
 * @returns {number}
 */
function countHighOpportunityLeads(leads) {
    if (!Array.isArray(leads)) return 0;
    return leads.filter(l => {
        const score = Number(l && l.opportunityScore);
        return Number.isFinite(score) && score >= HIGH_OPPORTUNITY_MIN_SCORE;
    }).length;
}

async function generateSWOT(city, industry, competitors, benchmarks, leads, trends, profileGuidance = '') {
    try {
        const guidanceBlock = (profileGuidance && profileGuidance.trim())
            ? `\n\nREPORT GUIDANCE (apply silently — do NOT copy, quote, echo, or restate any of this text in your output):\n${profileGuidance.trim()}\n`
            : '';
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const top10 = competitors.slice(0, 10)
            .map(c => `${c.name}: ${c.rating || 'N/A'}\u2605, ${c.reviewCount || 0} reviews`)
            .join('; ');

        const highOpp = countHighOpportunityLeads(leads);

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a strategic business analyst. Generate a SWOT analysis for the ${industry} market in ${city} based on competitive data.

Market data:
- Top 10 competitors: ${top10}
- Market average rating: ${benchmarks?.avgRating}\u2605
- Market leader: ${benchmarks?.marketLeader} (${benchmarks?.marketLeaderRating}\u2605)
- High opportunity leads: ${highOpp} of ${leads.length}
- New openings detected: ${trends?.newOpenings?.length || 0}
- Hiring signals: ${trends?.hiringSignals?.length || 0}

Generate a JSON object with exactly these fields:
{
  "strengths": ["market strength 1 with specific data", "market strength 2", "market strength 3"],
  "weaknesses": ["market weakness 1 specific to this market", "market weakness 2", "market weakness 3"],
  "opportunities": ["specific opportunity for PathSynch sales", "opportunity 2 with data", "opportunity 3"],
  "threats": ["market threat 1", "threat 2", "threat 3"],
  "summaryInsight": "one sentence strategic insight for a sales rep entering this market"
}

Rules:
- Be specific, reference actual data and business names where relevant
- Opportunities should be framed as sales opportunities for PathSynch
- Keep each point to 15 words max
- Output ONLY valid JSON. Start with {${guidanceBlock}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        console.warn('[MarketIntel] SWOT failed:', e.message);
        return null;
    }
}

module.exports = { generateSWOT, countHighOpportunityLeads, HIGH_OPPORTUNITY_MIN_SCORE };
