'use strict';

/**
 * govPursuits.js — Pursuit pipeline constants + validation (PR-C2, v2.2 §5.3, §13).
 *
 * A "pursuit" is a promoted opportunity moving through a bid-preparation pipeline.
 * govPursuits is the source of truth for pursuit state; the coarse
 * `govOpportunities.pursuitStatus` field is a mirror (see stageToPursuitStatus).
 *
 * Stage model (§5.3):
 *   planning → drafting → compliance_check → ready_to_submit → submitted
 *            → awaiting_result → won | lost | no_bid
 *
 * Transitions: forward-only among non-terminal stages (skipping ahead allowed),
 * plus any non-terminal → any terminal (a rep may mark no_bid/lost at any point).
 * Terminal stages are final — no transition leaves them.
 */

// ── Stage vocabulary ─────────────────────────────────────────────────────────

const NON_TERMINAL_STAGES = [
    'planning',
    'drafting',
    'compliance_check',
    'ready_to_submit',
    'submitted',
    'awaiting_result',
];

const TERMINAL_STAGES = ['won', 'lost', 'no_bid'];

const PURSUIT_STAGES = [...NON_TERMINAL_STAGES, ...TERMINAL_STAGES];

const INITIAL_STAGE = 'planning';

// ── Mirror map → govOpportunities.pursuitStatus (§13) ────────────────────────
// Must only produce values in schemas.PURSUIT_STATUSES.

const STAGE_TO_STATUS = {
    planning:        'pursuing',
    drafting:        'pursuing',
    compliance_check:'pursuing',
    ready_to_submit: 'pursuing',
    submitted:       'bid_submitted',
    awaiting_result: 'bid_submitted',
    won:             'won',
    lost:            'lost',
    no_bid:          'no_bid',
};

// ── Field length caps ─────────────────────────────────────────────────────────

const MAX_LOSS_REASON_LEN = 1000;
const MAX_PORTAL_LEN      = 200;
const MAX_NOTE_LEN        = 1000;
const MAX_STAGE_HISTORY   = 200; // hard bound to keep the array small

// ── Pure predicates ───────────────────────────────────────────────────────────

function isTerminalStage(stage) {
    return TERMINAL_STAGES.includes(stage);
}

/**
 * Coarse status mirrored onto the opportunity for a given pursuit stage.
 * Returns null for an unknown stage (caller should treat as no-op).
 */
function stageToPursuitStatus(stage) {
    return STAGE_TO_STATUS[stage] || null;
}

/**
 * Is a stage transition allowed?
 *   - Cannot leave a terminal stage.
 *   - No-op (same stage) is not a valid transition.
 *   - Any non-terminal → any terminal is allowed.
 *   - Among non-terminal stages, only forward moves (later index) are allowed.
 */
function isValidTransition(fromStage, toStage) {
    if (!PURSUIT_STAGES.includes(toStage)) return false;
    if (!PURSUIT_STAGES.includes(fromStage)) return false;
    if (isTerminalStage(fromStage)) return false;
    if (toStage === fromStage) return false;
    if (isTerminalStage(toStage)) return true;
    // Both non-terminal: forward only.
    return NON_TERMINAL_STAGES.indexOf(toStage) > NON_TERMINAL_STAGES.indexOf(fromStage);
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a stage-transition request body.
 * Returns { valid: true } or { valid: false, error }.
 */
function validateStageTransitionInput(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Request body required' };
    }
    if (!data.toStage || !PURSUIT_STAGES.includes(data.toStage)) {
        return { valid: false, error: `toStage must be one of: ${PURSUIT_STAGES.join(', ')}` };
    }
    if (data.note !== undefined) {
        if (typeof data.note !== 'string') return { valid: false, error: 'note must be a string' };
        if (data.note.length > MAX_NOTE_LEN) return { valid: false, error: `note exceeds ${MAX_NOTE_LEN} characters` };
    }
    if (data.portalName !== undefined) {
        if (typeof data.portalName !== 'string') return { valid: false, error: 'portalName must be a string' };
        if (data.portalName.length > MAX_PORTAL_LEN) return { valid: false, error: `portalName exceeds ${MAX_PORTAL_LEN} characters` };
    }
    if (data.lossReason !== undefined) {
        if (typeof data.lossReason !== 'string') return { valid: false, error: 'lossReason must be a string' };
        if (data.lossReason.length > MAX_LOSS_REASON_LEN) return { valid: false, error: `lossReason exceeds ${MAX_LOSS_REASON_LEN} characters` };
    }
    if (data.awardValue !== undefined && data.awardValue !== null) {
        if (typeof data.awardValue !== 'number' || !Number.isFinite(data.awardValue) || data.awardValue < 0) {
            return { valid: false, error: 'awardValue must be a non-negative number' };
        }
    }
    if (data.proposalReadiness !== undefined && data.proposalReadiness !== null) {
        const r = data.proposalReadiness;
        if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 100) {
            return { valid: false, error: 'proposalReadiness must be a number between 0 and 100' };
        }
    }
    return { valid: true };
}

/**
 * Validate an outcome update (terminal transition shortcut).
 */
function validateOutcomeInput(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Request body required' };
    }
    if (!data.outcome || !TERMINAL_STAGES.includes(data.outcome)) {
        return { valid: false, error: `outcome must be one of: ${TERMINAL_STAGES.join(', ')}` };
    }
    // Reuse the shared field validators (toStage aliased to outcome).
    return validateStageTransitionInput({ ...data, toStage: data.outcome });
}

module.exports = {
    PURSUIT_STAGES,
    NON_TERMINAL_STAGES,
    TERMINAL_STAGES,
    INITIAL_STAGE,
    STAGE_TO_STATUS,
    MAX_LOSS_REASON_LEN,
    MAX_PORTAL_LEN,
    MAX_NOTE_LEN,
    MAX_STAGE_HISTORY,
    isTerminalStage,
    stageToPursuitStatus,
    isValidTransition,
    validateStageTransitionInput,
    validateOutcomeInput,
};
