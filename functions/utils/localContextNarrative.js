'use strict';

/**
 * Local Context Narrative Generator
 *
 * Translates PathManager local intelligence data (events, weather, foot traffic)
 * into actionable sales narratives.
 *
 * Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE task — short structured output).
 */

const { generateStructured } = require('../services/structuredGeneration');

const LOCAL_CONTEXT_SCHEMA = {
    type: 'object',
    properties: {
        trafficDriverSummary: { type: 'string' },
        campaignOpportunity:  { type: 'string' },
        weatherImpact:        { type: 'string' },
        bestTimeToPitch:      { type: 'string' }
    },
    required: ['trafficDriverSummary', 'campaignOpportunity', 'weatherImpact', 'bestTimeToPitch']
};

/**
 * @param {Object} localContext - Output from getLocalContext()
 * @param {Object} prospectData - { businessName, category, city, state }
 * @returns {Promise<Object>} { trafficDriverSummary, campaignOpportunity, weatherImpact, bestTimeToPitch }
 */
async function generateLocalContextNarrative(localContext, prospectData) {
    const { events, weather, footTraffic } = localContext;

    // Build data sections for prompt
    const eventsText = events
        ? `${events.count} events nearby (density: ${events.eventDensity}). Venues: ${(events.venueTypes || []).join(', ') || 'various'}. Top events: ${(events.upcoming || []).slice(0, 3).map(e => e.name + (e.date ? ` (${new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : '')).join(', ')}`
        : 'No local event data available';

    const weatherText = weather
        ? `${weather.currentTemp !== null ? weather.currentTemp + '°F' : 'temp N/A'}, ${weather.currentCondition || 'conditions N/A'}. 72hr avg: ${weather.avgTemp72hr !== null ? weather.avgTemp72hr + '°F' : 'N/A'}. Sensitivity: ${weather.weatherSensitivity}`
        : 'No weather data available';

    const trafficText = footTraffic
        ? `Peak hours: ${footTraffic.peakHours || 'N/A'}. Busiest day: ${footTraffic.busiestDay || 'N/A'}. Quietest day: ${footTraffic.quietestDay || 'N/A'}`
        : 'No foot traffic data available';

    const systemInstruction = `You are a local market intelligence analyst writing for a B2B sales rep who sells marketing and reputation software to small businesses. Be specific — reference named events, venues, temperatures, or days where available. Short sentences. No em dashes. No generic observations.`;

    const userPrompt = `Business: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Location: ${prospectData.city}, ${prospectData.state}

Local Events: ${eventsText}

Weather: ${weatherText}

Foot Traffic Patterns: ${trafficText}

Generate all four fields using only the data above. If a field is N/A, write a general but plausible statement specific to ${prospectData.city}.

trafficDriverSummary: 2-3 sentences. What drives foot traffic to this area and when? Reference specific events, venues, or peak patterns if available.

campaignOpportunity: 1-2 sentences. A specific campaign this business could run tied to local events, traffic patterns, or seasons. Think: event-triggered offers, peak-hour specials, weather-based messaging. Name a specific event or day if available.

weatherImpact: 1 sentence. How do current or typical weather conditions affect foot traffic for this business type in ${prospectData.city}?

bestTimeToPitch: 1 sentence. Best time for a sales rep to visit this business based on foot traffic. If quietest day is available, cite it. Otherwise give a general recommendation.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: LOCAL_CONTEXT_SCHEMA,
        model: 'gemini-2.5-flash',
        temperature: 0.6,
        maxOutputTokens: 700
    });
}

module.exports = { generateLocalContextNarrative };
