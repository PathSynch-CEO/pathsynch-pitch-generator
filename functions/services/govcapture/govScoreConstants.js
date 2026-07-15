'use strict';

/**
 * govScoreConstants.js — Single source of truth for SynchGov scoring bands,
 * the PR-C1 solution-relevance gate, and the fit-label mapping.
 *
 * PR-C1 (prd-synchgov-capture-01 v2.2, §4.4):
 *   - `fitLabel()` was previously duplicated in govScoringEngine.js AND
 *     scoringPipeline.js. It now lives here only; both import it.
 *   - Gate parameters are CODE CONSTANTS (not env vars, §4.4-7): they change
 *     only with fixture evidence in a reviewed PR.
 *
 * The gate itself is applied only when GOVCAPTURE_RANK_FIELDS_ENABLED is true
 * (see rankFieldsEnabled()); with the flag off, scoring is byte-identical to
 * the shipped MVP.
 */

// ── Gate parameters (code constants — §4.4-7) ────────────────────────────────
const LOW_RELEVANCE_MAX  = 3;   // semantic relevance ≤ this → low-relevance gate
const GATE_CAP           = 39;  // capped composite when the low-relevance gate trips (→ Poor Fit / Review)
const UNAVAILABLE_CAP    = 44;  // capped composite when no semantic read occurred (→ stays below Warm)
const DISAGREEMENT_DELTA = 20;  // normalized-point gap between rule-only and semantic composites → risk flag

// ── Inbox band thresholds (recalibrated, §4.4) ───────────────────────────────
const WARM_THRESHOLD = 45;
const HOT_THRESHOLD  = 70;

// ── Scoring version (drives the one-time rescore sweep, §4.4-6) ──────────────
const SCORING_VERSION_LEGACY = 1; // ungated formula
const SCORING_VERSION_GATED  = 2; // gated formula (flag on)

/**
 * Fit label from a 0–100 normalized score. The ONLY implementation.
 */
function fitLabel(normalizedScore) {
    if (normalizedScore >= 85) return 'Strong Fit';
    if (normalizedScore >= 65) return 'Possible Fit';
    if (normalizedScore >= 45) return 'Stretch';
    if (normalizedScore >= 20) return 'Poor Fit';
    return 'Disqualified';
}

/**
 * Inbox tab (Hot / Warm / Review) from a score. Hard-disqualified always Review.
 */
function inboxTab(score, hardDisqualified) {
    if (hardDisqualified) return 'Review';
    if (score >= HOT_THRESHOLD) return 'Hot';
    if (score >= WARM_THRESHOLD) return 'Warm';
    return 'Review';
}

/**
 * The solution-relevance gate as a pure function.
 * Returns the numeric cap to apply (or null) and the reason code (or null).
 *   - no semantic read      → cap at UNAVAILABLE_CAP, 'SEMANTIC_UNAVAILABLE'
 *   - semantic relevance ≤3  → cap at GATE_CAP, 'GATE_LOW_SOLUTION_RELEVANCE'
 *   - otherwise              → no cap
 *
 * @param {boolean} semanticAvailable
 * @param {number|null} semanticRelevance  0–10, or null when unavailable
 */
function gateCap(semanticAvailable, semanticRelevance) {
    if (!semanticAvailable) {
        return { cap: UNAVAILABLE_CAP, reasonCode: 'SEMANTIC_UNAVAILABLE' };
    }
    if (typeof semanticRelevance === 'number' && semanticRelevance <= LOW_RELEVANCE_MAX) {
        return { cap: GATE_CAP, reasonCode: 'GATE_LOW_SOLUTION_RELEVANCE' };
    }
    return { cap: null, reasonCode: null };
}

/**
 * Is the PR-C1 rank layer + gate active? Flag-gated so production scoring stays
 * byte-identical to the MVP until opt-in.
 */
function rankFieldsEnabled() {
    return process.env.GOVCAPTURE_RANK_FIELDS_ENABLED === 'true';
}

module.exports = {
    LOW_RELEVANCE_MAX,
    GATE_CAP,
    UNAVAILABLE_CAP,
    DISAGREEMENT_DELTA,
    WARM_THRESHOLD,
    HOT_THRESHOLD,
    SCORING_VERSION_LEGACY,
    SCORING_VERSION_GATED,
    fitLabel,
    inboxTab,
    gateCap,
    rankFieldsEnabled,
};
