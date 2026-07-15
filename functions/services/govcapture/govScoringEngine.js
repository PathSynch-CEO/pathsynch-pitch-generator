'use strict';

/**
 * govScoringEngine.js — Two-pass scoring for gov opportunities.
 *
 * Pass 1: 90 points (award context excluded, null-excluded).
 * Pass 2: 100 points (with award context from USAspending).
 *
 * Exports:
 *   scoreOpportunity(opportunity, profile, options) → Pass 1 result
 *   rescoreWithAwardContext(opportunity, profile, awardContext) → Pass 2 result
 *   rescoreAllForProfile(profileId, userId) → { rescored, failed }
 */

const admin = require('firebase-admin');
const { applyHardFilters } = require('./govHardFilters');
const { scoreRelevance }   = require('./govPrefilter');
const {
    DISAGREEMENT_DELTA,
    SCORING_VERSION_GATED,
    SCORING_VERSION_LEGACY,
    fitLabel,
    gateCap,
    rankFieldsEnabled,
} = require('./govScoreConstants');

// ── Semantic Scoring Schema ──────────────────────────────────────────────────

const SEMANTIC_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        relevanceScore: {
            type:        'number',
            description: 'Relevance score from 0 (no match) to 10 (perfect match)',
        },
        reasoning: {
            type:        'string',
            description: 'Brief explanation of the score',
        },
    },
    required: ['relevanceScore', 'reasoning'],
};

// (Fit-label mapping now lives in govScoreConstants.js — single source of truth, PR-C1.)

// ── Score Opportunity (Pass 1) ───────────────────────────────────────────────

/**
 * Score a single opportunity against a profile (Pass 1 — no award context).
 *
 * @param {object} opportunity — normalized GovOpportunity
 * @param {object} profile — GovProfile (must include .id or caller passes it)
 * @param {object} [options={}]
 * @param {boolean} [options.allowSemantic=false]
 * @param {number|null} [options.rankWithinSync=null]
 * @returns {Promise<object>} — fit result
 */
async function scoreOpportunity(opportunity, profile, options = {}) {
    const now = new Date().toISOString();
    const profileId = profile.id || profile._id || 'unknown';

    // Hard filter short-circuit
    const hardResult = applyHardFilters(opportunity, profile);
    if (!hardResult.passed) {
        return {
            score:                 0,
            label:                 'Disqualified',
            reasonCodes:           [hardResult.disqualifyReason],
            riskCodes:             [],
            pass:                  1,
            scoringVersion:        rankFieldsEnabled() ? SCORING_VERSION_GATED : SCORING_VERSION_LEGACY,
            hardDisqualified:      true,
            scoredAt:              now,
            scoredAgainstProfileId: profileId,
            aiUsageMetadata:       null,
            prefilterScore:        0,
        };
    }

    // Deterministic prefilter
    const prefilter = scoreRelevance(opportunity, profile);
    const reasonCodes = [...prefilter.signals];
    const riskCodes   = [];

    // Check for negative keyword risk
    if (prefilter.signals.some(s => s.startsWith('NEGATIVE_KEYWORD:'))) {
        riskCodes.push('RISK_NEGATIVE_KEYWORD_MATCH');
    }

    // ── Weighted Dimensions ──────────────────────────────────────────────

    // 1. Solution match (30 pts) — semantic gate
    let solutionScore = 0;
    let aiUsageMetadata = null;
    let semanticRelevance = null;   // 0–10 when a real semantic read occurred, else null
    let semanticAvailable = false;  // did the Gemini semantic call actually succeed?
    const deterministicSolutionScore = Math.round((prefilter.score / 9) * 30);

    const shouldCallGemini = prefilter.score >= 2
        || options.allowSemantic === true
        || (options.rankWithinSync != null && options.rankWithinSync <= 100);

    if (shouldCallGemini) {
        try {
            const semantic = await _semanticSolutionMatch(opportunity, profile);
            semanticRelevance = semantic.relevanceScore;
            semanticAvailable = true;
            solutionScore = Math.round((semanticRelevance / 10) * 30);
            aiUsageMetadata = semantic.usageMetadata || null;
            if (semanticRelevance >= 7) reasonCodes.push('SEMANTIC_STRONG_MATCH');
        } catch (err) {
            console.warn('[GovScoring] Semantic scoring failed, using deterministic fallback:', err.message);
            solutionScore = deterministicSolutionScore; // semanticAvailable stays false
        }
    } else {
        // Deterministic fallback — scale 0-9 → 0-30 (no semantic read)
        solutionScore = deterministicSolutionScore;
    }

    // 2. NAICS/PSC match (15 pts)
    let naicsScore = 0;
    const naicsExact = prefilter.signals.includes('MATCH_NAICS_EXACT');
    if (naicsExact) {
        naicsScore = 15;
        if (!reasonCodes.includes('MATCH_NAICS_EXACT')) reasonCodes.push('MATCH_NAICS_EXACT');
    } else {
        // Partial: keyword overlap with NAICS-related terms
        const keywordHits = prefilter.signals.filter(s => s.startsWith('KEYWORD_HIT:')).length;
        naicsScore = keywordHits > 0 ? Math.min(8, keywordHits * 3) : 0;
    }

    // 3. Buyer type fit (15 pts)
    let buyerScore = 0;
    const priorityBuyers = profile.filters?.buyerTypes || [];
    if (priorityBuyers.length > 0 && opportunity.buyerName) {
        const buyerLower = opportunity.buyerName.toLowerCase();
        if (priorityBuyers.some(bt => buyerLower.includes(bt.toLowerCase()))) {
            buyerScore = 15;
            reasonCodes.push('BUYER_TYPE_MATCH');
        } else {
            buyerScore = 5; // Known buyer, not priority
        }
    }

    // 4. Geography fit (10 pts)
    let geoScore = 0;
    const priorityGeo = profile.filters?.geographyPriority || [];
    if (opportunity.location?.state && priorityGeo.length > 0) {
        const state = opportunity.location.state.toUpperCase().trim();
        if (priorityGeo.map(g => g.toUpperCase()).includes(state)) {
            geoScore = 10;
            reasonCodes.push('GEO_PRIORITY_MATCH');
        } else {
            geoScore = 3; // Known location, not priority
        }
    }

    // 5. Deadline feasibility (10 pts)
    let deadlineScore = 0;
    if (opportunity.dueDate) {
        const due = new Date(opportunity.dueDate);
        if (!isNaN(due.getTime())) {
            const daysLeft = (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
            if (daysLeft > 30)      deadlineScore = 10;
            else if (daysLeft > 14) deadlineScore = 6;
            else                    deadlineScore = 3;
        }
    }

    // 6. Certifications/eligibility (10 pts)
    let certScore = 0;
    if (opportunity.setAside) {
        const certs = profile.credentials?.certifications || [];
        if (certs.length > 0) {
            certScore = 7; // Has certifications
        }
        // Small business set-aside is generally accessible
        if (/small business/i.test(opportunity.setAside)) {
            certScore = Math.max(certScore, 5);
        }
    } else {
        certScore = 10; // No set-aside restriction = fully accessible
    }

    // ── Total (Pass 1: 90 pts available) ─────────────────────────────────
    const earned    = solutionScore + naicsScore + buyerScore + geoScore + deadlineScore + certScore;
    const available = 90; // Award context excluded in Pass 1
    const normalized = Math.round((earned / available) * 100);

    // ── PR-C1 solution-relevance gate (flag-gated; MVP-identical when off) ─
    let finalScore = normalized;
    let scoringVersion = SCORING_VERSION_LEGACY;
    if (rankFieldsEnabled()) {
        scoringVersion = SCORING_VERSION_GATED;
        const { cap, reasonCode } = gateCap(semanticAvailable, semanticRelevance);
        if (reasonCode) reasonCodes.push(reasonCode);
        if (cap !== null) finalScore = Math.min(normalized, cap);
        // Rule-vs-semantic disagreement: swap the semantic solution score for the
        // deterministic one and see if the composite label would move materially.
        if (semanticAvailable) {
            const ruleComposite = Math.round(((earned - solutionScore + deterministicSolutionScore) / available) * 100);
            if (Math.abs(normalized - ruleComposite) >= DISAGREEMENT_DELTA) {
                riskCodes.push('RISK_RULE_SEMANTIC_DISAGREEMENT');
            }
        }
    }

    return {
        score:                  finalScore,
        label:                  fitLabel(finalScore),
        reasonCodes,
        riskCodes,
        pass:                   1,
        scoringVersion,
        hardDisqualified:       false,
        scoredAt:               now,
        scoredAgainstProfileId: profileId,
        aiUsageMetadata,
        prefilterScore:         prefilter.score,
        fiat: {
            fit:    solutionScore + naicsScore, // capability / solution match
            intent: buyerScore,                 // buyer-type & set-aside priority
            access: geoScore + certScore,       // eligibility (geography, certifications)
            timing: deadlineScore,              // deadline feasibility
        },
        _raw: { solutionScore, naicsScore, buyerScore, geoScore, deadlineScore, certScore, earned, available },
        _gateInputs: { semanticAvailable, semanticRelevance, deterministicSolutionScore },
    };
}

// ── Rescore with Award Context (Pass 2) ──────────────────────────────────────

/**
 * @param {object} opportunity
 * @param {object} profile
 * @param {object} awardContext — from USAspending enrichment
 * @returns {Promise<object>} — Pass 2 fit result
 */
async function rescoreWithAwardContext(opportunity, profile, awardContext) {
    // Run Pass 1 first to get base scores
    const pass1 = await scoreOpportunity(opportunity, profile, { allowSemantic: true });

    if (pass1.hardDisqualified) {
        return { ...pass1, pass: 2 };
    }

    // Award context fit (10 pts)
    let awardScore = 0;
    const awardReasons = [];

    if (awardContext) {
        if (awardContext.similarAwardsFound) {
            awardScore += 5;
            awardReasons.push('AWARD_SIMILAR_FOUND');
        }
        if (awardContext.incumbentVendors && awardContext.incumbentVendors.length > 0) {
            awardScore += 3;
            awardReasons.push('AWARD_INCUMBENT_IDENTIFIED');
        }
        if (awardContext.pastPerformanceRelevant) {
            awardScore += 2;
            awardReasons.push('AWARD_PAST_PERF_RELEVANT');
        }
    }

    // Recalculate with 100-point model
    const earned    = pass1._raw.earned + awardScore;
    const available = 100;
    const normalized = Math.round((earned / available) * 100);

    // ── PR-C1 gate re-applied on the Pass 2 composite ────────────────────
    // Pass 2 rebuilds from pass1._raw.earned (pre-cap points) + award, so the
    // Pass 1 gate would otherwise be bypassed here. Re-apply the same numeric
    // cap. Reason/risk codes already flow through from pass1 (spread below).
    let finalScore = normalized;
    const scoringVersion = pass1.scoringVersion || SCORING_VERSION_LEGACY;
    if (rankFieldsEnabled()) {
        const gi = pass1._gateInputs || {};
        const { cap } = gateCap(gi.semanticAvailable, gi.semanticRelevance);
        if (cap !== null) finalScore = Math.min(normalized, cap);
    }

    return {
        score:                  finalScore,
        label:                  fitLabel(finalScore),
        reasonCodes:            [...pass1.reasonCodes, ...awardReasons],
        riskCodes:              pass1.riskCodes,
        pass:                   2,
        scoringVersion,
        hardDisqualified:       false,
        scoredAt:               new Date().toISOString(),
        scoredAgainstProfileId: pass1.scoredAgainstProfileId,
        aiUsageMetadata:        pass1.aiUsageMetadata,
        prefilterScore:         pass1.prefilterScore,
        fiat:                   pass1.fiat,
    };
}

// ── Semantic Solution Match (Gemini) ─────────────────────────────────────────

async function _semanticSolutionMatch(opportunity, profile) {
    const { generateStructured } = require('../structuredGeneration');

    const solutions = (profile.solutions || []).map(s =>
        `${s.name}: ${(s.keywords || []).slice(0, 15).join(', ')}`
    ).join('\n');

    // PR-C1: inject the seller's Rank guidance when the rank layer is enabled.
    // Byte-identical prompt when GOVCAPTURE_RANK_FIELDS_ENABLED is off.
    let rankBlock = '';
    if (rankFieldsEnabled()) {
        const parts = [];
        if (profile.rankIdealSolutions) parts.push(`Ideal solutions: ${profile.rankIdealSolutions}`);
        if (profile.rankIdealCustomer)  parts.push(`Ideal customer: ${profile.rankIdealCustomer}`);
        if (profile.rankIdealGeography) parts.push(`Ideal geography: ${profile.rankIdealGeography}`);
        if (profile.rankAvoid)          parts.push(`AVOID — score these LOW: ${profile.rankAvoid}`);
        if (parts.length) rankBlock = `\n\nSeller ranking guidance (weight heavily):\n${parts.join('\n')}`;
    }

    const systemPrompt = `You are a government contract relevance analyst. Score how well an opportunity matches a company's solutions and capabilities.

Company Solutions:
${solutions}${rankBlock}

Score from 0 (no match) to 10 (perfect match). Consider:
- Direct product/service alignment
- Industry and domain relevance
- Technical capability fit
- Scope and scale appropriateness${rankBlock ? '\n- Alignment with the seller ranking guidance above (an opportunity matching an AVOID item should score low)' : ''}`;

    const userPrompt = `Opportunity Title: ${opportunity.title || 'Unknown'}
Description: ${(opportunity.description || '').substring(0, 2000)}
NAICS: ${(opportunity.naicsCodes || []).join(', ')}
Buyer: ${opportunity.buyerName || 'Unknown'}
Set-Aside: ${opportunity.setAside || 'None'}`;

    const response = await generateStructured({
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: SEMANTIC_RESPONSE_SCHEMA,
        model:          'gemini-2.5-flash',
        temperature:    0.3,
        maxOutputTokens: 256,
        returnMetadata: true,
    });

    return {
        relevanceScore: Math.min(10, Math.max(0, response.result.relevanceScore || 0)),
        reasoning:      response.result.reasoning || '',
        usageMetadata:  response.usageMetadata,
    };
}

// ── Rescore All For Profile ──────────────────────────────────────────────────

async function rescoreAllForProfile(profileId, userId) {
    const db = admin.firestore();

    // Load and verify profile ownership
    const profileDoc = await db.collection('govProfiles').doc(profileId).get();
    if (!profileDoc.exists) throw new Error('Profile not found');
    if (profileDoc.data().userId !== userId) throw new Error('Access denied');

    const profile = { id: profileDoc.id, ...profileDoc.data() };

    // Query non-archived opportunities for this profile
    const snap = await db.collection('govOpportunities')
        .where('profileIds', 'array-contains', profileId)
        .where('archived', '==', false)
        .get();

    let rescored = 0;
    let failed   = 0;

    for (const doc of snap.docs) {
        try {
            const opp = doc.data();
            const fit = await scoreOpportunity(opp, profile, { allowSemantic: true });

            await doc.ref.update({
                fit,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            rescored++;
        } catch (err) {
            console.warn(`[GovScoring] Rescore failed for ${doc.id}:`, err.message);
            failed++;
        }
    }

    // Clear rescoreNeeded AFTER loop completes
    await db.collection('govProfiles').doc(profileId).update({
        rescoreNeeded: false,
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    return { rescored, failed };
}

module.exports = {
    scoreOpportunity,
    rescoreWithAwardContext,
    rescoreAllForProfile,
};
