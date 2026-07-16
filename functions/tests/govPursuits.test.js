'use strict';

/**
 * PR-C2 — Pursuits pipeline: constants/validation + service lifecycle.
 *
 * Uses the shared __mocks__/firebase-admin.js (transaction-aware). The
 * opportunity doc is the transaction guard for one-active-pursuit idempotency,
 * so all assertions are deterministic without a live emulator.
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const {
    PURSUIT_STAGES,
    NON_TERMINAL_STAGES,
    TERMINAL_STAGES,
    isTerminalStage,
    isValidTransition,
    stageToPursuitStatus,
    validateStageTransitionInput,
    validateOutcomeInput,
} = require('../services/govcapture/govPursuits');
const govPursuitService = require('../services/govcapture/govPursuitService');

const USER = 'user-c2';
const OPP  = 'opp-1';

function seedOpp(overrides = {}) {
    admin._setMockCollection('govOpportunities', {
        [OPP]: {
            userId:        USER,
            primarySource: 'sam_gov',
            profileIds:    ['prof-1'],
            title:         'RFID Asset Tracking',
            buyerName:     'Defense Logistics Agency',
            fit:           { score: 82, label: 'Possible Fit' },
            pursuitStatus: 'new',
            archived:      false,
            ...overrides,
        },
    });
}

beforeEach(() => {
    admin._resetMockData();
});

// ── Pure constants / predicates ──────────────────────────────────────────────

describe('PR-C2 govPursuits constants', () => {
    test('stage vocabulary is planning→…→terminal', () => {
        expect(NON_TERMINAL_STAGES[0]).toBe('planning');
        expect(TERMINAL_STAGES).toEqual(['won', 'lost', 'no_bid']);
        expect(PURSUIT_STAGES).toHaveLength(9);
    });

    test('isTerminalStage', () => {
        expect(isTerminalStage('won')).toBe(true);
        expect(isTerminalStage('no_bid')).toBe(true);
        expect(isTerminalStage('planning')).toBe(false);
    });

    test('mirror map → pursuitStatus', () => {
        expect(stageToPursuitStatus('planning')).toBe('pursuing');
        expect(stageToPursuitStatus('drafting')).toBe('pursuing');
        expect(stageToPursuitStatus('compliance_check')).toBe('pursuing');
        expect(stageToPursuitStatus('ready_to_submit')).toBe('pursuing');
        expect(stageToPursuitStatus('submitted')).toBe('bid_submitted');
        expect(stageToPursuitStatus('awaiting_result')).toBe('bid_submitted');
        expect(stageToPursuitStatus('won')).toBe('won');
        expect(stageToPursuitStatus('lost')).toBe('lost');
        expect(stageToPursuitStatus('no_bid')).toBe('no_bid');
        expect(stageToPursuitStatus('nonsense')).toBeNull();
    });

    test('isValidTransition — forward, skip, terminal, rejects', () => {
        expect(isValidTransition('planning', 'drafting')).toBe(true);      // forward
        expect(isValidTransition('planning', 'submitted')).toBe(true);     // skip ahead
        expect(isValidTransition('planning', 'won')).toBe(true);           // → terminal
        expect(isValidTransition('awaiting_result', 'lost')).toBe(true);
        expect(isValidTransition('drafting', 'planning')).toBe(false);     // backward
        expect(isValidTransition('planning', 'planning')).toBe(false);     // no-op
        expect(isValidTransition('won', 'lost')).toBe(false);              // leave terminal
        expect(isValidTransition('won', 'planning')).toBe(false);
        expect(isValidTransition('planning', 'bogus')).toBe(false);        // unknown target
    });
});

describe('PR-C2 validation', () => {
    test('validateStageTransitionInput accepts a good body', () => {
        expect(validateStageTransitionInput({ toStage: 'drafting', note: 'kickoff' }).valid).toBe(true);
    });
    test('rejects unknown toStage', () => {
        expect(validateStageTransitionInput({ toStage: 'nope' }).valid).toBe(false);
    });
    test('rejects negative awardValue', () => {
        expect(validateStageTransitionInput({ toStage: 'won', awardValue: -5 }).valid).toBe(false);
    });
    test('rejects proposalReadiness out of range', () => {
        expect(validateStageTransitionInput({ toStage: 'drafting', proposalReadiness: 150 }).valid).toBe(false);
    });
    test('rejects over-long note', () => {
        expect(validateStageTransitionInput({ toStage: 'drafting', note: 'z'.repeat(1001) }).valid).toBe(false);
    });
    test('validateOutcomeInput requires a terminal outcome', () => {
        expect(validateOutcomeInput({ outcome: 'won', awardValue: 1000 }).valid).toBe(true);
        expect(validateOutcomeInput({ outcome: 'drafting' }).valid).toBe(false);
    });
});

// ── createPursuit ────────────────────────────────────────────────────────────

describe('PR-C2 createPursuit', () => {
    test('promotes an opportunity and mirrors onto the opp doc', async () => {
        seedOpp();
        const { pursuit, created } = await govPursuitService.createPursuit(USER, OPP);

        expect(created).toBe(true);
        expect(pursuit.stage).toBe('planning');
        expect(pursuit.active).toBe(true);
        expect(pursuit.fitScoreAtPromotion).toBe(82);
        expect(pursuit.sourceProvider).toBe('sam_gov');
        expect(pursuit.profileId).toBe('prof-1');
        expect(pursuit.stageHistory).toHaveLength(1);

        const opp = admin._mockData.collections.govOpportunities[OPP];
        expect(opp.pursuitStatus).toBe('pursuing');
        expect(opp.pursuitActive).toBe(true);
        expect(opp.activePursuitId).toBe(pursuit.id);
        expect(opp.pursuitId).toBe(pursuit.id);
    });

    test('is idempotent — a second promote returns the existing pursuit, no duplicate', async () => {
        seedOpp();
        const first  = await govPursuitService.createPursuit(USER, OPP);
        const second = await govPursuitService.createPursuit(USER, OPP);

        expect(second.created).toBe(false);
        expect(second.pursuit.id).toBe(first.pursuit.id);
        expect(Object.keys(admin._mockData.collections.govPursuits)).toHaveLength(1);
    });

    test('rejects cross-tenant promotion', async () => {
        seedOpp({ userId: 'someone-else' });
        await expect(govPursuitService.createPursuit(USER, OPP)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('throws when the opportunity does not exist', async () => {
        await expect(govPursuitService.createPursuit(USER, 'ghost')).rejects.toMatchObject({ code: 'OPP_NOT_FOUND' });
    });

    test('re-pursuit allowed after a terminal outcome cleared the pointer', async () => {
        seedOpp();
        const first = await govPursuitService.createPursuit(USER, OPP);
        await govPursuitService.updateOutcome(first.pursuit.id, USER, { outcome: 'lost', lossReason: 'price' });

        // Pointer cleared by the terminal transition → a new pursuit can be created.
        const second = await govPursuitService.createPursuit(USER, OPP);
        expect(second.created).toBe(true);
        expect(second.pursuit.id).not.toBe(first.pursuit.id);
        expect(Object.keys(admin._mockData.collections.govPursuits)).toHaveLength(2);
    });
});

// ── transitionStage + mirror ─────────────────────────────────────────────────

describe('PR-C2 transitionStage', () => {
    async function promoted() {
        seedOpp();
        const { pursuit } = await govPursuitService.createPursuit(USER, OPP);
        return pursuit;
    }

    test('advances forward and appends stageHistory; mirror stays pursuing', async () => {
        const p = await promoted();
        const updated = await govPursuitService.transitionStage(p.id, USER, 'drafting');

        expect(updated.stage).toBe('drafting');
        expect(updated.active).toBe(true);
        expect(updated.stageHistory).toHaveLength(2);

        const opp = admin._mockData.collections.govOpportunities[OPP];
        expect(opp.pursuitStatus).toBe('pursuing');
        expect(opp.pursuitActive).toBe(true);
    });

    test('submitted stage records submittedAt + portalName and mirrors bid_submitted', async () => {
        const p = await promoted();
        const updated = await govPursuitService.transitionStage(p.id, USER, 'submitted', { portalName: 'SAM.gov' });

        expect(updated.stage).toBe('submitted');
        expect(updated.submittedAt).toBeTruthy();
        expect(updated.portalName).toBe('SAM.gov');
        expect(admin._mockData.collections.govOpportunities[OPP].pursuitStatus).toBe('bid_submitted');
    });

    test('rejects an invalid (backward) transition with INVALID_TRANSITION', async () => {
        const p = await promoted();
        await govPursuitService.transitionStage(p.id, USER, 'drafting');
        await expect(govPursuitService.transitionStage(p.id, USER, 'planning'))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    test('terminal transition sets outcome, deactivates, clears opp pointer', async () => {
        const p = await promoted();
        const updated = await govPursuitService.transitionStage(p.id, USER, 'won', { awardValue: 250000 });

        expect(updated.outcome).toBe('won');
        expect(updated.active).toBe(false);
        expect(updated.awardValue).toBe(250000);

        const opp = admin._mockData.collections.govOpportunities[OPP];
        expect(opp.pursuitStatus).toBe('won');
        expect(opp.pursuitActive).toBe(false);
        expect(opp.activePursuitId).toBeNull();
    });

    test('rejects cross-tenant stage change', async () => {
        const p = await promoted();
        await expect(govPursuitService.transitionStage(p.id, 'intruder', 'drafting'))
            .rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('throws when the pursuit does not exist', async () => {
        await expect(govPursuitService.transitionStage('ghost', USER, 'drafting'))
            .rejects.toMatchObject({ code: 'PURSUIT_NOT_FOUND' });
    });
});

// ── updateOutcome ────────────────────────────────────────────────────────────

describe('PR-C2 updateOutcome', () => {
    test('records lost + lossReason and deactivates', async () => {
        seedOpp();
        const { pursuit } = await govPursuitService.createPursuit(USER, OPP);
        const updated = await govPursuitService.updateOutcome(pursuit.id, USER, { outcome: 'lost', lossReason: 'incumbent renewed' });

        expect(updated.outcome).toBe('lost');
        expect(updated.active).toBe(false);
        expect(updated.lossReason).toBe('incumbent renewed');
        expect(admin._mockData.collections.govOpportunities[OPP].pursuitStatus).toBe('lost');
    });
});
