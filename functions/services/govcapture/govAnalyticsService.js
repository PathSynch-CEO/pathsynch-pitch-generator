'use strict';

/**
 * govAnalyticsService.js — SynchGov analytics card set (PR-C3, v2.2 §6).
 *
 * Computed on-read; no stored counters, no new collection. Two owner-scoped
 * reads:
 *   1. govOpportunities (userId, createdAt >= periodStart) — ingested, scored
 *      distribution, qualified count.
 *   2. govPursuits (userId) — pursuits-by-stage, win/loss, submissions.
 * Plus a small govProfiles (userId) read for avgContractValue + weekly goal.
 *
 * Reconciliation rules (§6.3):
 *   - Pursuit figures derive ONLY from govPursuits, never the mirrored
 *     govOpportunities.pursuitStatus field.
 *   - Scored distribution reuses inboxTab() (the exact bands the inbox uses),
 *     so the numbers reconcile with the board.
 *   - Submissions count = user-attested `submitted` transitions only, via the
 *     top-level submittedAt stamp (a skipped `submitted` stage is deliberately
 *     not counted — that transition is the attestation event, §5.3).
 */

const admin = require('firebase-admin');
const { inboxTab, WARM_THRESHOLD } = require('./govScoreConstants');

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const SUBMISSION_WINDOW_DAYS = 7;
const PURSUIT_FETCH_CAP = 1000;

const STAGES = [
    'planning', 'drafting', 'compliance_check', 'ready_to_submit',
    'submitted', 'awaiting_result', 'won', 'lost', 'no_bid',
];

function _db() {
    return admin.firestore();
}

/**
 * Compute the analytics card set for a user.
 *
 * @param {string} userId
 * @param {object} [options]
 * @param {number} [options.days=30]  — period window for ingest/scored/qualified
 * @param {number} [options.nowMs]    — clock override (tests); defaults to Date.now()
 * @returns {Promise<object>} aggregate card data
 */
async function computeAnalytics(userId, options = {}) {
    const db  = _db();
    const now = options.nowMs || Date.now();

    let days = parseInt(options.days, 10);
    if (!Number.isFinite(days) || days < 1) days = DEFAULT_DAYS;
    if (days > MAX_DAYS) days = MAX_DAYS;

    const periodStart      = new Date(now - days * 86400000);
    const submissionCutoff = new Date(now - SUBMISSION_WINDOW_DAYS * 86400000).toISOString();

    // ── Reads ────────────────────────────────────────────────────────────────
    const [oppsSnap, pursuitsSnap, profilesSnap] = await Promise.all([
        db.collection('govOpportunities')
            .where('userId', '==', userId)
            .where('createdAt', '>=', periodStart)
            .get(),
        db.collection('govPursuits')
            .where('userId', '==', userId)
            .limit(PURSUIT_FETCH_CAP + 1)
            .get(),
        db.collection('govProfiles')
            .where('userId', '==', userId)
            .get(),
    ]);

    const opps = oppsSnap.docs.map(d => d.data());

    let pursuits = pursuitsSnap.docs.map(d => d.data());
    const truncated = pursuits.length > PURSUIT_FETCH_CAP;
    if (truncated) pursuits = pursuits.slice(0, PURSUIT_FETCH_CAP);

    const profiles = profilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── Opportunity-level metrics ─────────────────────────────────────────────
    const opportunitiesIngested = opps.length;
    const active = opps.filter(o => o.archived !== true);

    const scoredDistribution = { Hot: 0, Warm: 0, Review: 0 };
    for (const o of active) {
        const fit = o.fit || {};
        const tab = inboxTab(Number(fit.score) || 0, fit.hardDisqualified === true);
        if (scoredDistribution[tab] !== undefined) scoredDistribution[tab] += 1;
    }

    const qualifiedOpps = active.filter(o => {
        const fit = o.fit || {};
        return (Number(fit.score) || 0) >= WARM_THRESHOLD && fit.hardDisqualified !== true;
    });
    const qualifiedCount = qualifiedOpps.length;

    // ── Pursuit-level metrics (govPursuits only) ──────────────────────────────
    const pursuitsByStage = {};
    for (const s of STAGES) pursuitsByStage[s] = 0;
    for (const p of pursuits) {
        if (pursuitsByStage[p.stage] !== undefined) pursuitsByStage[p.stage] += 1;
    }

    const winLoss = {
        won:    pursuitsByStage.won,
        lost:   pursuitsByStage.lost,
        no_bid: pursuitsByStage.no_bid,
        hasOutcomes: (pursuitsByStage.won + pursuitsByStage.lost + pursuitsByStage.no_bid) > 0,
    };

    const submissionCount = pursuits.filter(
        p => typeof p.submittedAt === 'string' && p.submittedAt >= submissionCutoff
    ).length;

    // ── Profile-derived fields (avgContractValue, weekly goal) ────────────────
    let goalSum = 0, hasGoal = false;
    const avgByProfile = {};
    let hasAvg = false;
    for (const prof of profiles) {
        if (Number.isFinite(prof.weeklySubmissionGoal) && prof.weeklySubmissionGoal >= 0) {
            goalSum += prof.weeklySubmissionGoal;
            hasGoal = true;
        }
        if (Number.isFinite(prof.avgContractValue) && prof.avgContractValue > 0) {
            avgByProfile[prof.id] = prof.avgContractValue;
            hasAvg = true;
        }
    }

    const submissions = {
        count: submissionCount,
        windowDays: SUBMISSION_WINDOW_DAYS,
        goal: hasGoal ? goalSum : null,
    };

    // Pipeline value: sum over qualified opps of the avgContractValue of each
    // capture profile the opp belongs to (multi-profile safe; single-profile
    // reduces to avgContractValue × qualifiedCount). Honest-theater assumption.
    let pipelineValueSurfaced = null;
    if (hasAvg) {
        let value = 0;
        for (const o of qualifiedOpps) {
            const pids = Array.isArray(o.profileIds) ? o.profileIds : [];
            for (const pid of pids) {
                if (avgByProfile[pid]) value += avgByProfile[pid];
            }
        }
        pipelineValueSurfaced = {
            value,
            qualifiedCount,
            assumption: 'Estimated: average contract value (per capture profile) × qualified opportunities.',
        };
    }

    return {
        periodDays: days,
        opportunitiesIngested,
        scoredDistribution,
        qualifiedCount,
        pursuitsByStage,
        winLoss,
        submissions,
        pipelineValueSurfaced,
        truncated,
    };
}

module.exports = {
    computeAnalytics,
    DEFAULT_DAYS,
    MAX_DAYS,
    SUBMISSION_WINDOW_DAYS,
    PURSUIT_FETCH_CAP,
    STAGES,
};
