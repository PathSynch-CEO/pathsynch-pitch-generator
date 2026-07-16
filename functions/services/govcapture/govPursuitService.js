'use strict';

/**
 * govPursuitService.js — Pursuit lifecycle (PR-C2, v2.2 §5.3, §13).
 *
 * govPursuits is the source of truth for pursuit state. Each mutation mirrors a
 * coarse status onto the source govOpportunities doc (see govPursuits.stageToPursuitStatus)
 * so the existing inbox/filter keeps working, and links the two docs so the direct
 * `PUT /opportunities/:oppId/status` endpoint can 409 when a pursuit owns the state.
 *
 * Idempotency (approved §Gate-1 #4): at most one ACTIVE (non-terminal) pursuit per
 * (userId, opportunity). The opportunity doc is the transaction guard — its
 * `activePursuitId` pointer is read inside the create transaction, so a concurrent
 * double-promote returns the same pursuit rather than creating two. After a terminal
 * outcome the pointer is cleared, so the opportunity may be re-pursued later.
 *
 * All writes go through admin SDK (gov* collections are CF-only, deny in rules).
 */

const admin = require('firebase-admin');
const {
    INITIAL_STAGE,
    isTerminalStage,
    isValidTransition,
    stageToPursuitStatus,
    MAX_STAGE_HISTORY,
} = require('./govPursuits');

function _db() {
    return admin.firestore();
}

/** Coded error so routes can map to the right HTTP status. */
function _err(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

/**
 * Fire-and-forget activity entry for a pursuit stage change.
 * Reuses the users/{uid}/activityFeed collection; never throws.
 */
async function _logPursuitActivity(userId, pursuit, fromStage, toStage) {
    try {
        await _db().collection('users').doc(userId)
            .collection('activityFeed').add({
                timestamp:  admin.firestore.FieldValue.serverTimestamp(),
                type:       'gov_pursuit_stage',
                pursuitId:  pursuit.id,
                opportunityId: pursuit.sourceOpportunityId || null,
                fromStage:  fromStage || null,
                toStage,
                title:      pursuit.title || 'Pursuit',
                isRead:     false,
                metadata:   {},
            });
    } catch (err) {
        console.warn('[GovPursuit] activity log failed:', err.message);
    }
}

// ── createPursuit ──────────────────────────────────────────────────────────────

/**
 * Promote an opportunity to a pursuit. Idempotent: returns the existing active
 * pursuit if one already exists for this opportunity.
 *
 * @param {string} userId
 * @param {string} oppId
 * @param {object} [opts]
 * @param {string} [opts.workspaceId]
 * @returns {Promise<{ pursuit: object, created: boolean }>}
 */
async function createPursuit(userId, oppId, opts = {}) {
    const db      = _db();
    const oppRef  = db.collection('govOpportunities').doc(oppId);
    // Pre-allocate the pursuit ref so its id is known inside the transaction.
    const newRef  = db.collection('govPursuits').doc();
    const now     = admin.firestore.FieldValue.serverTimestamp();

    const result = await db.runTransaction(async (t) => {
        const oppSnap = await t.get(oppRef);
        if (!oppSnap.exists) throw _err('OPP_NOT_FOUND', 'Opportunity not found');

        const opp = oppSnap.data();
        if (opp.userId !== userId) throw _err('FORBIDDEN', 'Access denied');

        // Idempotency: an active pursuit already exists → return it.
        if (opp.activePursuitId) {
            const existingRef  = db.collection('govPursuits').doc(opp.activePursuitId);
            const existingSnap  = await t.get(existingRef);
            if (existingSnap.exists && existingSnap.data().active) {
                return { pursuit: { id: existingSnap.id, ...existingSnap.data() }, created: false };
            }
            // Pointer is stale (pursuit deleted or already terminal) — fall through to create.
        }

        const fitScore = (opp.fit && typeof opp.fit.score === 'number') ? opp.fit.score : null;

        const pursuit = {
            userId,
            workspaceId:         opts.workspaceId || opp.workspaceId || null,
            profileId:           Array.isArray(opp.profileIds) ? (opp.profileIds[0] || null) : (opp.profileId || null),
            sourceOpportunityId: oppId,
            sourceProvider:      opp.primarySource || null,
            title:               opp.title || null,
            buyerName:           opp.buyerName || null,
            fitScoreAtPromotion: fitScore,
            stage:               INITIAL_STAGE,
            stageHistory:        [{ stage: INITIAL_STAGE, at: new Date(), byUid: userId }],
            outcome:             null,
            awardValue:          null,
            lossReason:          null,
            proposalReadiness:   null,
            portalName:          null,
            submittedAt:         null,
            active:              true,
            createdAt:           now,
            updatedAt:           now,
        };

        t.set(newRef, pursuit);
        t.update(oppRef, {
            pursuitStatus:    stageToPursuitStatus(INITIAL_STAGE),
            pursuitStage:     INITIAL_STAGE,
            pursuitId:        newRef.id,
            activePursuitId:  newRef.id,
            pursuitActive:    true,
            pursuitUpdatedAt: now,
            updatedAt:        now,
        });

        return { pursuit: { id: newRef.id, ...pursuit }, created: true };
    });

    if (result.created) {
        await _logPursuitActivity(userId, result.pursuit, null, INITIAL_STAGE);
    }
    return result;
}

// ── transitionStage ─────────────────────────────────────────────────────────────

/**
 * Advance a pursuit to a new stage. Validates the transition, appends stageHistory,
 * mirrors the coarse status to the opportunity, and (on terminal stages) records the
 * outcome and clears the active-pursuit pointer.
 *
 * @param {string} pursuitId
 * @param {string} userId
 * @param {string} newStage
 * @param {object} [opts] — { note, awardValue, lossReason, proposalReadiness, portalName, submittedAt }
 * @returns {Promise<object>} the updated pursuit
 */
async function transitionStage(pursuitId, userId, newStage, opts = {}) {
    const db         = _db();
    const pursuitRef = db.collection('govPursuits').doc(pursuitId);
    const now        = admin.firestore.FieldValue.serverTimestamp();

    const { updated, fromStage } = await db.runTransaction(async (t) => {
        const snap = await t.get(pursuitRef);
        if (!snap.exists) throw _err('PURSUIT_NOT_FOUND', 'Pursuit not found');

        const pursuit = snap.data();
        if (pursuit.userId !== userId) throw _err('FORBIDDEN', 'Access denied');

        const from = pursuit.stage;
        if (!isValidTransition(from, newStage)) {
            throw _err('INVALID_TRANSITION', `Cannot transition from '${from}' to '${newStage}'`);
        }

        const terminal = isTerminalStage(newStage);

        const history = Array.isArray(pursuit.stageHistory) ? pursuit.stageHistory.slice() : [];
        history.push({ stage: newStage, at: new Date(), byUid: userId });
        // Keep the array bounded (defensive — real pipelines are far shorter).
        const boundedHistory = history.length > MAX_STAGE_HISTORY
            ? history.slice(history.length - MAX_STAGE_HISTORY)
            : history;

        const updates = {
            stage:        newStage,
            stageHistory: boundedHistory,
            active:       !terminal,
            updatedAt:    now,
        };
        if (terminal) {
            updates.outcome = newStage;
            if (opts.awardValue !== undefined && opts.awardValue !== null) updates.awardValue = opts.awardValue;
            if (opts.lossReason !== undefined && opts.lossReason !== null) updates.lossReason = opts.lossReason;
        }
        if (newStage === 'submitted') {
            updates.submittedAt = opts.submittedAt || new Date().toISOString();
            if (opts.portalName !== undefined && opts.portalName !== null) updates.portalName = opts.portalName;
        }
        if (opts.proposalReadiness !== undefined && opts.proposalReadiness !== null) {
            updates.proposalReadiness = opts.proposalReadiness;
        }

        t.update(pursuitRef, updates);

        // Mirror coarse status to the source opportunity (best-effort blind update).
        if (pursuit.sourceOpportunityId) {
            const oppRef = db.collection('govOpportunities').doc(pursuit.sourceOpportunityId);
            const oppUpdates = {
                pursuitStatus:    stageToPursuitStatus(newStage),
                pursuitStage:     newStage,
                pursuitActive:    !terminal,
                pursuitUpdatedAt: now,
                updatedAt:        now,
            };
            if (terminal) oppUpdates.activePursuitId = null;
            t.update(oppRef, oppUpdates);
        }

        return { updated: { id: pursuitId, ...pursuit, ...updates }, fromStage: from };
    });

    await _logPursuitActivity(userId, updated, fromStage, newStage);
    return updated;
}

// ── updateOutcome ────────────────────────────────────────────────────────────────

/**
 * Record a terminal outcome. Thin wrapper over transitionStage to a terminal stage.
 *
 * @param {string} pursuitId
 * @param {string} userId
 * @param {object} data — { outcome ('won'|'lost'|'no_bid'), awardValue?, lossReason? }
 * @returns {Promise<object>} the updated pursuit
 */
async function updateOutcome(pursuitId, userId, data = {}) {
    return transitionStage(pursuitId, userId, data.outcome, {
        awardValue: data.awardValue,
        lossReason: data.lossReason,
    });
}

module.exports = {
    createPursuit,
    transitionStage,
    updateOutcome,
};
