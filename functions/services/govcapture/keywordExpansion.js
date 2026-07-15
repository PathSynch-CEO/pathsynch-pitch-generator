'use strict';

/**
 * keywordExpansion.js — PR-C1 (v2.2 §4.3).
 *
 * Expand one profile solution into 40–60 candidate government-contracting search
 * keywords the user prunes before save. SIMPLE tier via generateStructured();
 * model passed explicitly (never rely on the ADVANCED default — v2.2 §12).
 * Expanded keywords are SCORING-ONLY, never query-grade (v2.2 §4.3).
 */

const { generateStructured } = require('../structuredGeneration');
const { MAX_KEYWORDS_PER_SOLUTION } = require('./schemas');

const EXPANSION_SCHEMA = {
    type: 'object',
    properties: {
        keywords: {
            type:        'array',
            items:       { type: 'string' },
            description: '40 to 60 concise keyword phrases',
        },
    },
    required: ['keywords'],
};

/**
 * @param {object} solution — { name|solutionName, description?, keywords?[] }
 * @returns {Promise<{ keywords: string[], usageMetadata: object|null }>}
 */
async function expandSolutionKeywords(solution) {
    const name = solution.name || solution.solutionName || '';
    const desc = solution.description || '';
    const seed = Array.isArray(solution.keywords) ? solution.keywords.join(', ') : '';

    const systemInstruction = `You expand a company's solution offering into government-contracting search keywords.
Return 40 to 60 concise keyword phrases (1–4 words each) that a federal or SLED contracting officer might use in a solicitation title or description for this kind of work.
Include synonyms, adjacent capabilities, common acronyms, and NAICS/PSC-adjacent terminology.
Do not include the company name. Do not include generic filler words. Return distinct phrases only.`;

    const userPrompt = `Solution: ${name}
Description: ${desc}
Existing seed keywords: ${seed || '(none)'}`;

    const response = await generateStructured({
        systemInstruction,
        userPrompt,
        responseSchema:  EXPANSION_SCHEMA,
        model:           'gemini-2.5-flash', // SIMPLE tier — explicit (v2.2 §12)
        temperature:     0.4,
        maxOutputTokens: 1024,
        returnMetadata:  true,
    });

    const raw = Array.isArray(response.result.keywords) ? response.result.keywords : [];
    const seen = new Set();
    const keywords = [];
    for (const k of raw) {
        const kw = String(k || '').trim();
        if (!kw || kw.length > 60) continue;
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        keywords.push(kw);
        if (keywords.length >= MAX_KEYWORDS_PER_SOLUTION) break;
    }

    return { keywords, usageMetadata: response.usageMetadata || null };
}

module.exports = { expandSolutionKeywords };
