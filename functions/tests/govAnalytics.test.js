'use strict';

/**
 * PR-C3 — analytics aggregation + the two validator additions.
 *
 * Deterministic clock via options.nowMs. Uses the shared transaction-aware
 * firebase-admin mock. Key assertions: scored distribution reconciles via the
 * shared inboxTab bands; pursuit figures come from govPursuits ONLY (a mirrored
 * pursuitStatus on an opportunity must never move a pursuit count).
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const { computeAnalytics, PURSUIT_FETCH_CAP } = require('../services/govcapture/govAnalyticsService');
const { validateProfileInput } = require('../services/govcapture/schemas');
const { validateStageTransitionInput } = require('../services/govcapture/govPursuits');

const U = 'user-c3';
const NOW = Date.parse('2026-07-15T00:00:00.000Z');
const DAY = 86400000;
const daysAgo = n => new Date(NOW - n * DAY);
const isoDaysAgo = n => new Date(NOW - n * DAY).toISOString();

function opp(id, fields) {
    return { [id]: { userId: U, archived: false, profileIds: ['profA'], createdAt: daysAgo(2), ...fields } };
}

function seed({ opps = {}, pursuits = {}, profiles = {} } = {}) {
    admin._resetMockData();
    admin._setMockCollection('govOpportunities', opps);
    admin._setMockCollection('govPursuits', pursuits);
    admin._setMockCollection('govProfiles', profiles);
}

beforeEach(() => admin._resetMockData());

// ── Full aggregate ───────────────────────────────────────────────────────────

describe('PR-C3 computeAnalytics — full aggregate', () => {
    beforeEach(() => {
        seed({
            opps: {
                ...opp('o1', { fit: { score: 75, hardDisqualified: false } }),                 // Hot, qualified
                ...opp('o2', { fit: { score: 50, hardDisqualified: false } }),                 // Warm, qualified
                ...opp('o3', { fit: { score: 30, hardDisqualified: false } }),                 // Review
                ...opp('o4', { fit: { score: 90, hardDisqualified: true } }),                  // Review (DQ)
                ...opp('o5', { fit: { score: 80 }, archived: true }),                          // ingested, not active
                ...opp('o6', { fit: { score: 88 }, createdAt: daysAgo(40) }),                  // out of period
            },
            pursuits: {
                p1: { userId: U, stage: 'planning' },
                p2: { userId: U, stage: 'drafting' },
                p3: { userId: U, stage: 'submitted', submittedAt: isoDaysAgo(2) },             // recent
                p4: { userId: U, stage: 'submitted', submittedAt: isoDaysAgo(10) },            // old
                p5: { userId: U, stage: 'won',  outcome: 'won' },
                p6: { userId: U, stage: 'lost', outcome: 'lost' },
            },
            profiles: {
                profA: { userId: U, avgContractValue: 100000, weeklySubmissionGoal: 5 },
            },
        });
    });

    test('opportunities ingested = period set (archived counts, out-of-period excluded)', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.opportunitiesIngested).toBe(5); // o1..o5; o6 out of period
    });

    test('scored distribution reconciles via inboxTab bands (active only)', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.scoredDistribution).toEqual({ Hot: 1, Warm: 1, Review: 2 }); // o5 archived excluded
    });

    test('qualified count = active, score >= WARM, not DQ', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.qualifiedCount).toBe(2); // o1 + o2
    });

    test('pursuits by stage counts come from govPursuits', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.pursuitsByStage).toMatchObject({
            planning: 1, drafting: 1, submitted: 2, won: 1, lost: 1, no_bid: 0,
            compliance_check: 0, ready_to_submit: 0, awaiting_result: 0,
        });
    });

    test('win/loss from outcomes', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.winLoss).toEqual({ won: 1, lost: 1, no_bid: 0, hasOutcomes: true });
    });

    test('submissions counts only the 7-day window; goal from profile', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.submissions).toEqual({ count: 1, windowDays: 7, goal: 5 }); // p3 in, p4 out
    });

    test('pipeline value = avgContractValue x per-profile qualified', async () => {
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.pipelineValueSurfaced.value).toBe(200000); // 2 qualified x 100000
        expect(a.pipelineValueSurfaced.qualifiedCount).toBe(2);
    });
});

// ── Reconciliation: govPursuits is the source, NOT the mirror ─────────────────

describe('PR-C3 reconciliation — ignores mirrored pursuitStatus', () => {
    test('a won pursuitStatus on an opportunity with no pursuit doc does NOT count as a win', async () => {
        seed({
            opps: { ...opp('o1', { fit: { score: 60 }, pursuitStatus: 'won', pursuitActive: false }) },
            pursuits: {}, // no govPursuits docs at all
        });
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.winLoss.won).toBe(0);
        expect(a.winLoss.hasOutcomes).toBe(false);
        expect(a.pursuitsByStage.won).toBe(0);
    });
});

// ── Zero-state + gating ──────────────────────────────────────────────────────

describe('PR-C3 zero-state + field gating', () => {
    test('no data → clean zeros, null goal, null pipeline', async () => {
        seed({});
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.opportunitiesIngested).toBe(0);
        expect(a.scoredDistribution).toEqual({ Hot: 0, Warm: 0, Review: 0 });
        expect(a.qualifiedCount).toBe(0);
        expect(a.winLoss.hasOutcomes).toBe(false);
        expect(a.submissions).toEqual({ count: 0, windowDays: 7, goal: null });
        expect(a.pipelineValueSurfaced).toBeNull();
        expect(a.truncated).toBe(false);
    });

    test('pipeline null when no profile sets avgContractValue', async () => {
        seed({
            opps: { ...opp('o1', { fit: { score: 80 } }) },
            profiles: { profA: { userId: U, weeklySubmissionGoal: 3 } }, // goal but no avg
        });
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.pipelineValueSurfaced).toBeNull();
        expect(a.submissions.goal).toBe(3);
    });

    test('days clamps: 0 → default 30, huge → 365', async () => {
        seed({});
        expect((await computeAnalytics(U, { nowMs: NOW, days: 0 })).periodDays).toBe(30);
        expect((await computeAnalytics(U, { nowMs: NOW, days: 9999 })).periodDays).toBe(365);
    });

    test('pursuit fetch cap sets truncated flag', async () => {
        const pursuits = {};
        for (let i = 0; i < PURSUIT_FETCH_CAP + 5; i++) {
            pursuits[`p${i}`] = { userId: U, stage: 'planning' };
        }
        seed({ pursuits });
        const a = await computeAnalytics(U, { nowMs: NOW });
        expect(a.truncated).toBe(true);
        expect(a.pursuitsByStage.planning).toBe(PURSUIT_FETCH_CAP);
    });
});

// ── Validator additions ──────────────────────────────────────────────────────

describe('PR-C3 profile numeric-field validation', () => {
    test('accepts non-negative avgContractValue + weeklySubmissionGoal', () => {
        expect(validateProfileInput({ profileName: 'X', avgContractValue: 50000, weeklySubmissionGoal: 5 }).valid).toBe(true);
    });
    test('accepts null (clearing the field)', () => {
        expect(validateProfileInput({ profileName: 'X', avgContractValue: null }).valid).toBe(true);
    });
    test('rejects negative', () => {
        expect(validateProfileInput({ profileName: 'X', avgContractValue: -1 }).valid).toBe(false);
    });
    test('rejects non-number', () => {
        expect(validateProfileInput({ profileName: 'X', weeklySubmissionGoal: '5' }).valid).toBe(false);
    });
});

describe('PR-C3 submittedAt validation on stage transitions', () => {
    test('accepts a valid ISO submittedAt', () => {
        expect(validateStageTransitionInput({ toStage: 'submitted', submittedAt: '2026-07-15T00:00:00.000Z' }).valid).toBe(true);
    });
    test('rejects a non-parseable submittedAt', () => {
        expect(validateStageTransitionInput({ toStage: 'submitted', submittedAt: 'not-a-date' }).valid).toBe(false);
    });
    test('rejects a non-string submittedAt', () => {
        expect(validateStageTransitionInput({ toStage: 'submitted', submittedAt: 123 }).valid).toBe(false);
    });
});
