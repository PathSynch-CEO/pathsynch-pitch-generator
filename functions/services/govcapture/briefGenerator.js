'use strict';

/**
 * briefGenerator.js — Pure AI bid/no-bid brief generation.
 *
 * No Firestore writes. No status updates. The persistence wrapper does that.
 * Model: gemini-2.5-flash (SIMPLE tier) via generateStructured().
 */

const PROMPT_VERSION = '1.0';

const HUMAN_REVIEW_WARNING = 'AI-generated bid briefs are decision-support outputs, not final compliance reviews. Deadlines, eligibility requirements, submission instructions, and mandatory attachments must be verified by a human before pursuing or submitting.';

const BID_RECOMMENDATIONS = ['pursue', 'pass', 'investigate', 'watch'];
const CONFIDENCE_LEVELS   = ['high', 'medium', 'low'];

// ── Output Schema ────────────────────────────────────────────────────────────

const BRIEF_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        summary:              { type: 'string' },
        fitSummary:           { type: 'string' },
        whyItFits:            { type: 'array', items: { type: 'string' } },
        whyItMayNotFit:       { type: 'array', items: { type: 'string' } },
        keyRequirements:      { type: 'array', items: { type: 'string' } },
        requiredDocuments:    { type: 'array', items: { type: 'string' } },
        submissionInstructions: { type: 'string', nullable: true },
        deadlineRisk:         { type: 'string' },
        eligibilityRisks:     { type: 'array', items: { type: 'string' } },
        suggestedNextSteps:   { type: 'array', items: { type: 'string' } },
        bidRecommendation:    { type: 'string' },
        confidence:           { type: 'string' },
        checklistAnswers:     { type: 'object' },
    },
    required: ['summary', 'bidRecommendation', 'confidence'],
};

// ── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate a bid/no-bid brief for a government opportunity.
 *
 * @param {object} opportunity — GovOpportunity
 * @param {object} profile — GovProfile
 * @param {object} [options={}]
 * @param {object} [options.checklist] — govChecklist document data
 * @returns {Promise<{brief: object|null, aiUsageMetadata: object|null, error: string|null}>}
 */
async function generateBidBrief(opportunity, profile, options = {}) {
    try {
        const { generateStructured } = require('../structuredGeneration');

        const systemPrompt = _buildSystemPrompt(profile);
        const userPrompt   = _buildUserPrompt(opportunity, profile, options.checklist);

        const response = await generateStructured({
            systemInstruction: systemPrompt,
            userPrompt,
            responseSchema:    BRIEF_RESPONSE_SCHEMA,
            model:             'gemini-2.5-flash',
            temperature:       0.4,
            maxOutputTokens:   4096,
            returnMetadata:    true,
        });

        const raw   = response.result;
        const usage = response.usageMetadata;

        // Constrain outputs
        const brief = {
            summary:                raw.summary || 'Brief generation produced no summary.',
            fitSummary:             raw.fitSummary || '',
            whyItFits:              Array.isArray(raw.whyItFits) ? raw.whyItFits : [],
            whyItMayNotFit:         Array.isArray(raw.whyItMayNotFit) ? raw.whyItMayNotFit : [],
            keyRequirements:        Array.isArray(raw.keyRequirements) ? raw.keyRequirements : [],
            requiredDocuments:      Array.isArray(raw.requiredDocuments) ? raw.requiredDocuments : [],
            submissionInstructions: raw.submissionInstructions || null,
            deadlineRisk:           raw.deadlineRisk || 'Unknown',
            eligibilityRisks:       Array.isArray(raw.eligibilityRisks) ? raw.eligibilityRisks : [],
            suggestedNextSteps:     Array.isArray(raw.suggestedNextSteps) ? raw.suggestedNextSteps : [],
            bidRecommendation:      _constrainEnum(raw.bidRecommendation, BID_RECOMMENDATIONS, 'investigate'),
            confidence:             _constrainEnum(raw.confidence, CONFIDENCE_LEVELS, 'low'),
            checklistAnswers:       _sanitizeChecklistAnswers(raw.checklistAnswers),
            capStatementUsed:       !!(profile.credentials?.capStatementText),
            humanReviewRequired:    true, // HARDCODED — never AI-determined
        };

        const aiUsageMetadata = usage ? {
            inputTokens:   usage.inputTokens  || 0,
            outputTokens:  usage.outputTokens || 0,
            estimatedCost: _estimateCost(usage),
            modelName:     'gemini-2.5-flash',
            promptVersion: PROMPT_VERSION,
            generatedAt:   new Date().toISOString(),
        } : null;

        return { brief, aiUsageMetadata, error: null };

    } catch (err) {
        console.error('[BriefGenerator] Generation failed:', err.message);
        return {
            brief: null,
            aiUsageMetadata: null,
            error: err.message || 'generation_failed',
        };
    }
}

// ── Prompt Builders ──────────────────────────────────────────────────────────

function _buildSystemPrompt(profile) {
    const solutions = (profile.solutions || []).map(s =>
        `${s.name}: ${(s.keywords || []).slice(0, 15).join(', ')}`
    ).join('\n');

    const pastPerf = (profile.credentials?.pastPerformance || []).map(pp =>
        `- ${pp.client}: ${pp.description}`
    ).join('\n');

    const capStatement = profile.credentials?.capStatementText
        ? `\n\nCapability Statement:\n${profile.credentials.capStatementText.substring(0, 2000)}`
        : '';

    return `You are a government contracting bid/no-bid analyst. Analyze opportunities against this company profile.

Company: ${profile.profileName || 'Unknown'}
Solutions:
${solutions || 'Not specified'}

Past Performance:
${pastPerf || 'None documented'}
${capStatement}

CRITICAL RULES:
- Never invent due dates, submission portals, contact details, or certifications
- If information is not found in the source text, respond with "Not found in source document"
- bidRecommendation must be one of: pursue, pass, investigate, watch
- confidence must be one of: high, medium, low
- For checklist answers: if the answer is "Not found in source document", confidence MUST be "low"`;
}

function _buildUserPrompt(opportunity, profile, checklist) {
    const fit = opportunity.fit || {};
    const award = opportunity.awardContext || {};

    let prompt = `Analyze this government opportunity:

Title: ${opportunity.title || 'Unknown'}
Description: ${(opportunity.description || '').substring(0, 3000)}

Buyer: ${opportunity.buyerName || 'Unknown'}
Agency: ${opportunity.agencyName || ''} / Department: ${opportunity.departmentName || ''}
Due Date: ${opportunity.dueDate || 'Not specified'}
Posted: ${opportunity.postedDate || 'Not specified'}
NAICS: ${(opportunity.naicsCodes || []).join(', ') || 'Not specified'}
Set-Aside: ${opportunity.setAside || 'None'}
Estimated Value: ${opportunity.estimatedValue ? `$${opportunity.estimatedValue.toLocaleString()}` : 'Not specified'}
Location: ${opportunity.location ? `${opportunity.location.city || ''}, ${opportunity.location.state || ''}` : 'Not specified'}

Fit Score: ${fit.score || 'Not scored'} (${fit.label || 'Unknown'})
Reason Codes: ${(fit.reasonCodes || []).join(', ') || 'None'}
Risk Codes: ${(fit.riskCodes || []).join(', ') || 'None'}`;

    if (award.similarAwardsFound) {
        prompt += `\n\nAward Context:
Similar Awards Found: ${award.similarAwardCount || 0}
Total Award Value: $${(award.totalSimilarAwardValue || 0).toLocaleString()}
Incumbent Vendors: ${(award.incumbentVendors || []).join(', ') || 'None identified'}
Confidence: ${award.confidence || 'low'}`;
    }

    // Checklist questions
    const questions = _getChecklistQuestions(checklist);
    if (questions.length > 0) {
        prompt += '\n\nAnswer these checklist questions based on the opportunity details:';
        for (const q of questions) {
            prompt += `\n- ${q.id}: ${q.question}`;
        }
        prompt += '\n\nFor each question, provide: answer (string), confidence (high/medium/low). If the answer cannot be determined, set answer to "Not found in source document" and confidence to "low".';
    }

    return prompt;
}

function _getChecklistQuestions(checklist) {
    if (checklist && Array.isArray(checklist.questions)) {
        return checklist.questions;
    }
    // Fall back to default questions
    const { DEFAULT_CHECKLIST_QUESTIONS } = require('./schemas');
    return DEFAULT_CHECKLIST_QUESTIONS.map((q, i) => ({
        id: `q${i + 1}`,
        question: q,
        required: true,
    }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _constrainEnum(value, allowed, fallback) {
    if (typeof value === 'string' && allowed.includes(value.toLowerCase())) {
        return value.toLowerCase();
    }
    return fallback;
}

function _sanitizeChecklistAnswers(raw) {
    if (!raw || typeof raw !== 'object') return {};

    const sanitized = {};
    for (const [key, val] of Object.entries(raw)) {
        if (!val || typeof val !== 'object') continue;

        const answer     = val.answer || 'Not found in source document';
        let   confidence = _constrainEnum(val.confidence, CONFIDENCE_LEVELS, 'low');

        // Enforce: "Not found" → confidence MUST be low
        if (answer === 'Not found in source document') {
            confidence = 'low';
        }

        sanitized[key] = { answer, confidence };

        // Include sourceEvidence if present
        if (val.sourceEvidence && typeof val.sourceEvidence === 'object') {
            sanitized[key].sourceEvidence = {
                quote: (val.sourceEvidence.quote || '').substring(0, 240),
                field: val.sourceEvidence.field || 'unknown',
            };
        }
    }
    return sanitized;
}

function _estimateCost(usage) {
    // gemini-2.5-flash approximate pricing: $0.15/1M input, $0.60/1M output
    const inputCost  = ((usage.inputTokens  || 0) / 1000000) * 0.15;
    const outputCost = ((usage.outputTokens || 0) / 1000000) * 0.60;
    return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
}

module.exports = {
    generateBidBrief,
    PROMPT_VERSION,
    HUMAN_REVIEW_WARNING,
    BID_RECOMMENDATIONS,
    CONFIDENCE_LEVELS,
    BRIEF_RESPONSE_SCHEMA,
    // Exported for testing
    _buildSystemPrompt,
    _buildUserPrompt,
    _constrainEnum,
    _sanitizeChecklistAnswers,
    _estimateCost,
};
