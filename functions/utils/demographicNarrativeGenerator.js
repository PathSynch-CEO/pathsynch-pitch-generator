'use strict';

/**
 * Demographic Narrative Generator
 *
 * Translates raw ZIP-level Census data into two sales narratives:
 * 1. demandSnapshot — local market size + quality
 * 2. demographicFit — who lives here and why it matters for this business
 *
 * Uses generateStructured() per CLAUDE.md rules.
 * Model: gemini-2.5-flash (SIMPLE task — short structured output).
 */

const { generateStructured } = require('../services/structuredGeneration');

const INDUSTRY_MAP = {
    restaurant: {
        focus: 'dining demand, foot traffic patterns, and disposable income',
        highValueFields: ['medianHouseholdIncome', 'population', 'walkRate', 'renterRate']
    },
    home_services: {
        focus: 'homeownership concentration, property investment capacity, and service demand',
        highValueFields: ['homeownershipRate', 'medianHouseholdIncome', 'medianAge']
    },
    healthcare: {
        focus: 'patient base size, age distribution, and insurance coverage likelihood',
        highValueFields: ['population', 'medianAge', 'medianHouseholdIncome']
    },
    retail: {
        focus: 'customer base density, spending power, and accessibility',
        highValueFields: ['population', 'medianHouseholdIncome', 'vehicleOwnershipRate', 'walkRate']
    },
    fitness: {
        focus: 'health-conscious demographic density and membership capacity',
        highValueFields: ['population', 'medianAge', 'collegeDegreeRate', 'medianHouseholdIncome']
    },
    auto: {
        focus: 'vehicle ownership rates, household income, and homeowner base',
        highValueFields: ['vehicleOwnershipRate', 'medianHouseholdIncome', 'homeownershipRate']
    },
    beauty: {
        focus: 'disposable income, demographic mix, and renter/owner balance',
        highValueFields: ['medianHouseholdIncome', 'medianAge', 'population']
    },
    default: {
        focus: 'local market size, spending power, and household density',
        highValueFields: ['population', 'medianHouseholdIncome', 'totalHouseholds']
    }
};

const NARRATIVE_SCHEMA = {
    type: 'object',
    properties: {
        demandSnapshot:  { type: 'string' },
        demographicFit:  { type: 'string' },
        keyInsight:      { type: 'string' },
        messagingAngle:  { type: 'string' }
    },
    required: ['demandSnapshot', 'demographicFit', 'keyInsight', 'messagingAngle']
};

/**
 * @param {Object} demoData - Output from getDemographicData() — { zipCode, profile }
 * @param {Object} prospectData - { businessName, category, city, state }
 * @returns {Promise<Object>} { demandSnapshot, demographicFit, keyInsight, messagingAngle }
 */
async function generateDemographicNarrative(demoData, prospectData) {
    const profile = demoData.profile;
    const zip = demoData.zipCode;
    const industryKey = mapIndustry(prospectData.category);
    const industryConfig = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.default;
    const d = profile.display;

    const systemInstruction = `You are a local market intelligence analyst writing for a B2B sales rep who sells marketing software to small businesses. Be specific — reference actual numbers from the data. No generic language. Short sentences. No em dashes.`;

    const userPrompt = `Business: ${prospectData.businessName}
Category: ${prospectData.category || 'Local business'}
Location: ${prospectData.city}, ${prospectData.state} (ZIP ${zip})
Industry focus: ${industryConfig.focus}

Census ACS 2023 — ZIP ${zip}:
Population: ${d.population}
Median Household Income: ${d.medianIncome}
Median Age: ${d.medianAge}
Homeownership Rate: ${d.homeownership}
Renter Rate: ${d.renter}
Family Households: ${d.familyHouseholds}
College Degree Rate: ${d.collegeDegree}
Vehicle Ownership: ${d.vehicleOwnership}
Non-English Speakers: ${d.nonEnglish}
Work From Home Rate: ${d.wfh}
Walk Commuters: ${d.walkRate}
Total Households: ${d.totalHouseholds}

Generate all four fields. Every sentence must reference a specific number from the data above. Do not use generic phrases like "this area has good demographics." If a data point is N/A, skip it.

demandSnapshot: 2-3 sentences. Local market size and quality relevant to this business type. Reference population, income, and growth signals.

demographicFit: 2-3 sentences. Translate the demographics into a customer fit narrative for ${prospectData.businessName}. Explain who lives here and why that matters for this category.

keyInsight: 1 sentence. The single most actionable demographic insight for the sales rep. Must reference a specific number.

messagingAngle: 1 sentence. A messaging angle the rep can use based on these demographics. Specific to this business category.`;

    return await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema: NARRATIVE_SCHEMA,
        model: 'gemini-2.5-flash',
        temperature: 0.6,
        maxOutputTokens: 800
    });
}

function mapIndustry(category) {
    if (!category) return 'default';
    const s = category.toLowerCase();
    if (s.includes('restaurant') || s.includes('food') || s.includes('cafe') || s.includes('bar') || s.includes('bakery') || s.includes('pizza') || s.includes('sushi') || s.includes('diner')) return 'restaurant';
    if (s.includes('plumb') || s.includes('hvac') || s.includes('roof') || s.includes('landscap') || s.includes('electr') || s.includes('clean') || s.includes('pest') || s.includes('paint') || s.includes('handyman')) return 'home_services';
    if (s.includes('doctor') || s.includes('dent') || s.includes('medical') || s.includes('health') || s.includes('chiro') || s.includes('therapy') || s.includes('clinic') || s.includes('vet') || s.includes('optom')) return 'healthcare';
    if (s.includes('gym') || s.includes('fitness') || s.includes('yoga') || s.includes('pilates') || s.includes('crossfit') || s.includes('martial')) return 'fitness';
    if (s.includes('auto') || s.includes('car') || s.includes('tire') || s.includes('mechanic') || s.includes('detailing')) return 'auto';
    if (s.includes('salon') || s.includes('spa') || s.includes('nail') || s.includes('barber') || s.includes('beauty') || s.includes('hair')) return 'beauty';
    if (s.includes('shop') || s.includes('store') || s.includes('retail') || s.includes('boutique')) return 'retail';
    return 'default';
}

module.exports = { generateDemographicNarrative };
