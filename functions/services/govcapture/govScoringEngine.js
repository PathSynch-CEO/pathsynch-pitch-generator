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

// ── Fit Labels ───────────────────────────────────────────────────────────────

function _fitLabel(normalizedScore) {
    if (normalizedScore >= 85) return 'Strong Fit';
    if (normalizedScore >= 65) return 'Possible Fit';
    if (normalizedScore >= 45) return 'Stretch';
    if (normalizedScore >= 20) return 'Poor Fit';
    return 'Disqualified';
}

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

    const shouldCallGemini = prefilter.score >= 2
        || options.allowSemantic === true
        || (options.rankWithinSync != null && options.rankWithinSync <= 100);

    if (shouldCallGemini) {
        try {
            const semantic = await _semanticSolutionMatch(opportunity, profile);
            solutionScore = Math.round((semantic.relevanceScore / 10) * 30);
            aiUsageMetadata = semantic.usageMetadata || null;
            if (semantic.relevanceScore >= 7) reasonCodes.push('SEMANTIC_STRONG_MATCH');
        } catch (err) {
            console.warn('[GovScoring] Semantic scoring failed, using deterministic fallback:', err.message);
            solutionScore = Math.round((prefilter.score / 9) * 30);
        }
    } else {
        // Deterministic fallback — scale 0-9 → 0-30
        solutionScore = Math.round((prefilter.score / 9) * 30);
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

    return {
        score:                  normalized,
        label:                  _fitLabel(normalized),
        reasonCodes,
        riskCodes,
        pass:                   1,
        hardDisqualified:       false,
        scoredAt:               now,
        scoredAgainstProfileId: profileId,
        aiUsageMetadata,
        prefilterScore:         prefilter.score,
        _raw: { solutionScore, naicsScore, buyerScore, geoScore, deadlineScore, certScore, earned, available },
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

    return {
        score:                  normalized,
        label:                  _fitLabel(normalized),
        reasonCodes:            [...pass1.reasonCodes, ...awardReasons],
        riskCodes:              pass1.riskCodes,
        pass:                   2,
        hardDisqualified:       false,
        scoredAt:               new Date().toISOString(),
        scoredAgainstProfileId: pass1.scoredAgainstProfileId,
        aiUsageMetadata:        pass1.aiUsageMetadata,
        prefilterScore:         pass1.prefilterScore,
    };
}

// ── Semantic Solution Match (Gemini) ─────────────────────────────────────────

async function _semanticSolutionMatch(opportunity, profile) {
    const { generateStructured } = require('../structuredGeneration');

    const solutions = (profile.solutions || []).map(s =>
        `${s.name}: ${(s.keywords || []).slice(0, 15).join(', ')}`
    ).join('\n');

    const systemPrompt = `You are a government contract relevance analyst. Score how well an opportunity matches a company's solutions and capabilities.

Company Solutions:
${solutions}

Score from 0 (no match) to 10 (perfect match). Consider:
- Direct product/service alignment
- Industry and domain relevance
- Technical capability fit
- Scope and scale appropriateness`;

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
