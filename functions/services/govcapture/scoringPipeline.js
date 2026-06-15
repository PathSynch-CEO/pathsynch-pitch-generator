'use strict';

/**
 * scoringPipeline.js — Two-pass scoring + USAspending enrichment pipeline.
 *
 * scoreAndEnrich OWNS all opportunity document writes.
 * The calling endpoint must NOT perform a duplicate write.
 */

const admin = require('firebase-admin');
const { scoreOpportunity, rescoreWithAwardContext } = require('./govScoringEngine');
const { enrichWithAwardContext } = require('./usaspendingService');

const ENRICHMENT_THRESHOLD = 45;

/**
 * Score an opportunity and optionally enrich with USAspending.
 *
 * @param {object} opportunity — normalized GovOpportunity (must include doc ref or id)
 * @param {object} profile — GovProfile
 * @param {object} [options={}]
 * @param {boolean} [options.allowSemantic=false]
 * @param {number|null} [options.rankWithinSync=null]
 * @param {boolean} [options.write=true] — write results to Firestore
 * @param {string} [options.oppDocId] — opportunity document ID for writes
 * @returns {Promise<{fit: object, awardContext: object|null, aiUsageMetadata: object|null}>}
 */
async function scoreAndEnrich(opportunity, profile, options = {}) {
    const { write = true, oppDocId } = options;

    // ── Pass 1 ───────────────────────────────────────────────────────────
    const pass1 = await scoreOpportunity(opportunity, profile, {
        allowSemantic:  options.allowSemantic || false,
        rankWithinSync: options.rankWithinSync ?? null,
    });

    // Short-circuit: below threshold or USAspending disabled
    if (pass1.score < ENRICHMENT_THRESHOLD
        || pass1.hardDisqualified
        || process.env.GOVCAPTURE_USASPENDING_ENABLED !== 'true') {

        if (write && oppDocId) {
            await _writeResult(oppDocId, pass1, null);
        }

        return {
            fit:             pass1,
            awardContext:    null,
            aiUsageMetadata: pass1.aiUsageMetadata,
        };
    }

    // ── Pass 2: Enrich + Rescore ─────────────────────────────────────────
    const awardContext = await enrichWithAwardContext(opportunity, profile);

    if (!awardContext) {
        // Enrichment failed or no data — Pass 1 is final
        if (write && oppDocId) {
            await _writeResult(oppDocId, pass1, null);
        }

        return {
            fit:             pass1,
            awardContext:    null,
            aiUsageMetadata: pass1.aiUsageMetadata,
        };
    }

    // Rescore with award context
    const pass2 = await rescoreWithAwardContext(opportunity, profile, awardContext);

    // SCORE CLAMPING: award context must never penalize.
    // The denominator shift from 90→100 can lower the normalized score
    // when award context earns 0 points. Math.max prevents this.
    const finalFit = {
        ...pass2,
        score: Math.max(pass1.score, pass2.score),
    };
    finalFit.label = _fitLabel(finalFit.score);

    if (write && oppDocId) {
        await _writeResult(oppDocId, finalFit, awardContext);
    }

    return {
        fit:             finalFit,
        awardContext,
        aiUsageMetadata: pass1.aiUsageMetadata,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _fitLabel(score) {
    if (score >= 85) return 'Strong Fit';
    if (score >= 65) return 'Possible Fit';
    if (score >= 45) return 'Stretch';
    if (score >= 20) return 'Poor Fit';
    return 'Disqualified';
}

async function _writeResult(oppDocId, fit, awardContext) {
    try {
        const db = admin.firestore();
        const updates = {
            fit,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (awardContext) {
            updates.awardContext = awardContext;
        }
        await db.collection('govOpportunities').doc(oppDocId).update(updates);
    } catch (err) {
        console.error(`[ScoringPipeline] Write failed for ${oppDocId}:`, err.message);
    }
}

module.exports = {
    scoreAndEnrich,
    ENRICHMENT_THRESHOLD,
};
