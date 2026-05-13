'use strict';

/**
 * Competitive Gap Narrative Generator
 *
 * Produces an AI-written gap analysis from the competitive landscape matrix.
 * Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE task — short structured output).
 */

const { generateStructured } = require('../services/structuredGeneration');

const GAP_NARRATIVE_SCHEMA = {
    type: 'object',
    properties: {
        marketPosition:   { type: 'string' },
        topThreat:        { type: 'string' },
        keyGap:           { type: 'string' },
        opportunityAngle: { type: 'string' }
    },
    required: ['marketPosition', 'topThreat', 'keyGap', 'opportunityAngle']
};

/**
 * @param {Object} landscape   - Output from buildCompetitiveLandscape()
 * @param {Object} prospectData - { businessName, category, city, state }
 * @returns {Promise<Object>} { marketPosition, topThreat, keyGap, opportunityAngle }
 */
async function generateCompetitiveGapNarrative(landscape, prospectData) {
    const { prospect, matrix, prospectPosition, competitorCount } = landscape;

    const highThreats = matrix.filter(r => r.threatLevel === 'HIGH');
    const topThreatEntry = highThreats[0] || matrix[0];
    const topThreatName = topThreatEntry?.name || 'top competitor';
    const topThreatRating = topThreatEntry?.rating || 0;
    const topThreatReviews = topThreatEntry?.reviewCount || 0;

    const systemInstruction = `You are a competitive intelligence analyst writing a brief market position summary for a B2B sales rep who sells reputation and marketing software to local businesses. Be specific — reference actual numbers and named businesses. Short sentences. No em dashes. No generic phrases like "the competitive landscape is challenging."`;

    const userPrompt = `Business: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Location: ${prospectData.city}, ${prospectData.state}

Prospect stats: ${prospect.rating}★ / ${prospect.reviewCount} reviews
Rating rank: #${prospectPosition.ratingRank} of ${competitorCount + 1} (${prospectPosition.ratingPercentile}th percentile)
Review rank: #${prospectPosition.reviewRank} of ${competitorCount + 1} (${prospectPosition.reviewPercentile}th percentile)

Competitive field (${competitorCount} competitors analyzed):
HIGH threats: ${prospectPosition.highThreats}
MEDIUM threats: ${prospectPosition.mediumThreats}

Competitor matrix (name: rating / reviews / threat):
${matrix.slice(0, 8).map((c, i) => `${i + 1}. ${c.name}: ${c.rating}★ / ${c.reviewCount} reviews — ${c.threatLevel}`).join('\n')}

Generate all four fields. Every sentence must reference specific numbers or named businesses from the data above. Do not use em dashes.

marketPosition: 2 sentences. Where does this business stand in the competitive field? Reference their exact rating rank and how many competitors outperform them.

topThreat: 1 sentence. Name ${topThreatName} specifically and explain why they are the top threat. Cite rating (${topThreatRating}★) and review count (${topThreatReviews}).

keyGap: 1 sentence. The most specific competitive gap this business needs to close. Must cite a number (review count delta, rating gap, etc.).

opportunityAngle: 1 sentence. How a sales rep can open a conversation using this competitive context. Specific to ${prospectData.category || 'this business category'}.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: GAP_NARRATIVE_SCHEMA,
        model: 'gemini-2.5-flash',
        temperature: 0.5,
        maxOutputTokens: 600
    });
}

module.exports = { generateCompetitiveGapNarrative };
