'use strict';

/**
 * PR-C5 — Proposal Evaluator: vault, Pass A deterministic matching, evaluation
 * orchestration, fix-first ack state, deletion right, readiness stamp.
 *
 * generateStructured is mocked (Pass A extraction + Pass B evaluator). The
 * PRD's named regression classes are covered: deliberately-omitted required
 * form caught (acceptance §8), criterion-linked reason codes (no naked
 * scores), prompt-scaffolding leak (PR #43 class), multi-tenant isolation
 * (PR #23 class).
 */

jest.mock('firebase-admin');
jest.mock('../services/structuredGeneration', () => ({
    generateStructured: jest.fn(),
}));

const admin = require('firebase-admin');
const { generateStructured } = require('../services/structuredGeneration');
const proposalService = require('../services/govcapture/govProposalService');
const evalService = require('../services/govcapture/govEvaluationService');

const U = 'merchant-a';
const INTRUDER = 'merchant-b';
const PURSUIT = 'pursuit-1';
const OPP = 'opp-1';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// RFP requires Form SF-1449 (deliberately omitted from the draft), a technical
// approach section (present), and a page limit statement (present).

const RFP_TEXT = `REQUEST FOR PROPOSAL
Submission instructions: submit via SAM.gov portal by the deadline.
Required: completed Form SF-1449 signed by an authorized representative.
Required: a Technical Approach section describing the solution.
Page limit: proposals shall not exceed 20 pages.`;

const DRAFT_TEXT = `ACME Corp Proposal.
Technical Approach: our asset tracking solution uses RFID scanning.
We confirm the proposal is within the 20 pages page limit as required.
Past performance: three similar contracts delivered on time.`;

const EXTRACTED_REQUIREMENTS = [
    { id: 'r1', category: 'required_forms',           text: 'Completed Form SF-1449 signed', keywords: ['sf-1449', 'form sf-1449'] },
    { id: 'r2', category: 'submission_instructions',  text: 'Technical Approach section',    keywords: ['technical approach'] },
    { id: 'r3', category: 'page_limits',              text: 'Not exceed 20 pages',           keywords: ['20 pages', 'page limit'] },
];

const PASS_B_RESULT = {
    score: 72,
    perCriterion: [
        { criterion: 'responsiveness', score: 60, reasonCode: 'MISSING_REQUIRED_FORM', evidence: 'No SF-1449 found in the draft.' },
        { criterion: 'technical_approach', score: 85, reasonCode: 'CLEAR_SOLUTION_FIT', evidence: 'RFID scanning approach described.' },
    ],
    fixFirst: [
        { title: 'Attach Form SF-1449', detail: 'The RFP requires a signed SF-1449; the draft has none.', criterion: 'responsiveness' },
        { title: 'Quantify past performance', detail: 'Add contract values and outcomes.', criterion: 'technical_approach' },
    ],
};

function txtFile(name, text) {
    return { originalname: name, mimetype: 'text/plain', buffer: Buffer.from(text, 'utf-8') };
}

function seedPursuitAndOpp(opts = {}) {
    admin._setMockCollection('govPursuits', {
        [PURSUIT]: { userId: U, stage: 'drafting', sourceOpportunityId: OPP, active: true, profileId: opts.profileId || null },
    });
    admin._setMockCollection('govOpportunities', {
        [OPP]: { userId: U, title: 'Asset Tracking RFP', description: RFP_TEXT, sourceRefs: [] },
    });
    if (opts.profileId) {
        admin._setMockCollection('govProfiles', {
            [opts.profileId]: {
                userId: U,
                credentials: { certifications: ['8(a)', 'SDVOSB'] },
                rankIdealSolutions: 'asset tracking automation',
            },
        });
    }
    if (opts.sellerProfile !== undefined) {
        // Firestore reads users/{uid} from the collections store (not the auth store).
        admin._setMockCollection('users', { [U]: { sellerProfile: opts.sellerProfile } });
    }
}

function mockAiCalls() {
    // Call 1 = Pass A extraction (SIMPLE), call 2 = Pass B evaluator (PRIMARY).
    generateStructured
        .mockResolvedValueOnce({
            result: { requirements: EXTRACTED_REQUIREMENTS },
            usageMetadata: { inputTokens: 100, outputTokens: 50, modelName: 'gemini-2.5-flash' },
        })
        .mockResolvedValueOnce({
            result: PASS_B_RESULT,
            usageMetadata: { inputTokens: 200, outputTokens: 120, modelName: 'gemini-3-flash-preview' },
        });
}

beforeEach(() => {
    admin._resetMockData();
    jest.clearAllMocks();
});

// ── Keyword extraction (deterministic) ───────────────────────────────────────

describe('PR-C5 extractKeywords', () => {
    test('frequency-ranked, stopwords excluded, short tokens excluded', () => {
        const kws = proposalService.extractKeywords('tracking tracking tracking rfid rfid the the the and to of a');
        expect(kws[0]).toBe('tracking');
        expect(kws[1]).toBe('rfid');
        expect(kws).not.toContain('the');
        expect(kws).not.toContain('and');
    });
    test('empty/invalid input → empty array', () => {
        expect(proposalService.extractKeywords('')).toEqual([]);
        expect(proposalService.extractKeywords(null)).toEqual([]);
    });
});

// ── Pass A matching (pure) ───────────────────────────────────────────────────

describe('PR-C5 matchRequirements — deterministic compliance', () => {
    test('finds the deliberately-omitted required form (acceptance §8)', () => {
        const checked = evalService.matchRequirements(EXTRACTED_REQUIREMENTS, DRAFT_TEXT);
        const form = checked.find(r => r.id === 'r1');
        expect(form.status).toBe('missing'); // SF-1449 nowhere in the draft
    });
    test('present requirement matched by keywords', () => {
        const checked = evalService.matchRequirements(EXTRACTED_REQUIREMENTS, DRAFT_TEXT);
        expect(checked.find(r => r.id === 'r2').status).toBe('present');
        expect(checked.find(r => r.id === 'r3').status).toBe('present');
    });
    test('partial keyword coverage → unclear', () => {
        const reqs = [{ id: 'x', category: 'other', text: 'X', keywords: ['alpha', 'beta', 'gamma'] }];
        const checked = evalService.matchRequirements(reqs, 'the draft mentions alpha only');
        expect(checked[0].status).toBe('unclear');
    });
    test('no keywords → at best unclear, never auto-present', () => {
        const reqs = [{ id: 'x', category: 'other', text: 'special clause', keywords: [] }];
        expect(evalService.matchRequirements(reqs, 'includes the special clause verbatim')[0].status).toBe('unclear');
        expect(evalService.matchRequirements(reqs, 'nothing relevant')[0].status).toBe('missing');
    });

    test('short keyword uses word boundaries — "nist" does not match "administrator" (Countifi corpus finding)', () => {
        const reqs = [{ id: 'n', category: 'certifications', text: 'NIST compliance', keywords: ['nist'] }];
        expect(evalService.matchRequirements(reqs, 'the administrator configured the system')[0].status).toBe('missing');
        expect(evalService.matchRequirements(reqs, 'aligned to NIST 800-53 controls')[0].status).toBe('present');
    });

    test('phrase keywords keep substring matching', () => {
        const reqs = [{ id: 'p', category: 'certifications', text: 'NIST 800-53', keywords: ['nist 800-53'] }];
        expect(evalService.matchRequirements(reqs, 'we implement nist 800-53 moderate baseline')[0].status).toBe('present');
        expect(evalService.matchRequirements(reqs, 'the administrator configured the system')[0].status).toBe('missing');
    });
});

// ── Vault: save / list / delete ──────────────────────────────────────────────

describe('PR-C5 proposal vault', () => {
    test('saveProposal persists storage object + doc with keywords', async () => {
        seedPursuitAndOpp();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        expect(p.userId).toBe(U);
        expect(p.pursuitId).toBe(PURSUIT);
        expect(p.extractedKeywords.length).toBeGreaterThan(0);
        expect(p.storagePath).toMatch(/^govProposals\/merchant-a\//);
        expect(admin._mockData.storageFiles[p.storagePath]).toBeDefined();
    });

    test('cross-tenant upload rejected (PR #23 class)', async () => {
        seedPursuitAndOpp();
        await expect(proposalService.saveProposal(INTRUDER, PURSUIT, txtFile('x.txt', 'hi there world')))
            .rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('cross-tenant read rejected (PR #23 class)', async () => {
        seedPursuitAndOpp();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        await expect(proposalService.getProposal(INTRUDER, p.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        // And listProposals is owner-scoped by query.
        const list = await proposalService.listProposals(INTRUDER, {});
        expect(list).toHaveLength(0);
    });

    test('deletion right: doc + storage object gone; evaluations survive', async () => {
        seedPursuitAndOpp();
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);

        await proposalService.deleteProposal(U, p.id);

        expect(admin._mockData.collections.govProposalDocs[p.id]).toBeUndefined();
        expect(admin._mockData.storageFiles[p.storagePath]).toBeUndefined();
        // Evaluation survives (results outlive the document, §8.5).
        expect(admin._mockData.collections.govEvaluations[ev.id]).toBeDefined();
        // Readiness stamp on the pursuit survives too.
        expect(admin._mockData.collections.govPursuits[PURSUIT].proposalReadiness).toBe(72);
    });

    test('cross-tenant delete rejected', async () => {
        seedPursuitAndOpp();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        await expect(proposalService.deleteProposal(INTRUDER, p.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
});

// ── Evaluation orchestration ─────────────────────────────────────────────────

describe('PR-C5 runEvaluation', () => {
    test('full run: Pass A summary + Pass B score + ack-augmented fixFirst + readiness stamp', async () => {
        seedPursuitAndOpp();
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);

        // Pass A caught the omitted form.
        expect(ev.passA.summary).toEqual({ total: 3, present: 2, unclear: 0, missing: 1 });
        // Pass B — criterion-linked reason codes on every dimension (no naked scores).
        expect(ev.passB.score).toBe(72);
        for (const c of ev.passB.perCriterion) {
            expect(c.reasonCode).toBeTruthy();
            expect(c.criterion).toBeTruthy();
        }
        // fixFirst items initialized to open ack state.
        expect(ev.passB.fixFirst.every(f => f.ackState === 'open')).toBe(true);
        expect(ev.promptVersion).toBe('generic-v1');
        expect(ev.usageMetadata.passA).toBeTruthy();
        expect(ev.usageMetadata.passB).toBeTruthy();

        // Readiness stamped onto the pursuit (re-rank hook).
        const pursuit = admin._mockData.collections.govPursuits[PURSUIT];
        expect(pursuit.proposalReadiness).toBe(72);
        expect(pursuit.latestEvaluationId).toBe(ev.id);
    });

    test('merchant rubric is assembled and injected into Pass B; rubricVersion stamped', async () => {
        seedPursuitAndOpp({ profileId: 'prof-1', sellerProfile: { valueProposition: { differentiator: 'sub-24h deploy' } } });
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);

        // rubricVersion recorded (not 'none') + sources listed.
        expect(ev.rubricVersion).not.toBe('none');
        expect(ev.rubricSources).toEqual(expect.arrayContaining(['certifications', 'rankFields', 'valueProposition']));

        // Pass B (2nd generateStructured call) received the rubric block + guardrail.
        const passBCall = generateStructured.mock.calls[1][0];
        expect(passBCall.userPrompt).toContain('MERCHANT_RUBRIC');
        expect(passBCall.userPrompt).toContain('8(a)');
        expect(passBCall.userPrompt).toContain('sub-24h deploy');
        expect(passBCall.systemInstruction).toContain('reference data');
    });

    test('inputStats stamped: small inputs not truncated; >100k draft flags draftTruncated', async () => {
        seedPursuitAndOpp();
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);
        expect(ev.inputStats).toEqual({
            rfpChars: expect.any(Number),
            draftChars: DRAFT_TEXT.length,
            rfpTruncated: false,
            draftTruncated: false,
        });

        // A >100k-char draft (real proposals reach ~50k+; cap is 100k) flags truncation.
        admin._resetMockData();
        seedPursuitAndOpp();
        mockAiCalls();
        const bigDraft = DRAFT_TEXT + '\n' + 'x'.repeat(100001);
        const p2 = await proposalService.saveProposal(U, PURSUIT, txtFile('big.txt', bigDraft));
        const ev2 = await evalService.runEvaluation(U, PURSUIT, p2.id);
        expect(ev2.inputStats.draftTruncated).toBe(true);
    });

    test('no profile → generic rubric (rubricVersion none, no MERCHANT_RUBRIC block)', async () => {
        seedPursuitAndOpp(); // no profileId, no sellerProfile
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);

        expect(ev.rubricVersion).toBe('none');
        const passBCall = generateStructured.mock.calls[1][0];
        expect(passBCall.userPrompt).not.toContain('MERCHANT_RUBRIC');
    });

    test('prompt scaffolding does not leak into stored output (PR #43 class)', async () => {
        seedPursuitAndOpp();
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        const ev = await evalService.runEvaluation(U, PURSUIT, p.id);

        const stored = JSON.stringify(admin._mockData.collections.govEvaluations[ev.id]);
        // Distinctive system-prompt phrases must not appear in persisted output.
        expect(stored).not.toContain('Role-play the awarding evaluator');
        expect(stored).not.toContain('You extract the stated requirements');
    });

    test('cross-tenant evaluation rejected (PR #23 class)', async () => {
        seedPursuitAndOpp();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        await expect(evalService.runEvaluation(INTRUDER, PURSUIT, p.id))
            .rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(generateStructured).not.toHaveBeenCalled(); // gate fires BEFORE any AI spend
    });

    test('proposal belonging to a different pursuit rejected', async () => {
        seedPursuitAndOpp();
        admin._mockData.collections.govPursuits['pursuit-2'] = { userId: U, stage: 'drafting', sourceOpportunityId: OPP, active: true };
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        await expect(evalService.runEvaluation(U, 'pursuit-2', p.id))
            .rejects.toMatchObject({ code: 'PROPOSAL_MISMATCH' });
    });

    test('no RFP text → NO_RFP_TEXT (never a silent empty evaluation)', async () => {
        admin._setMockCollection('govPursuits', {
            [PURSUIT]: { userId: U, stage: 'drafting', sourceOpportunityId: 'ghost-opp', active: true },
        });
        admin._setMockCollection('govOpportunities', {});
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        await expect(evalService.runEvaluation(U, PURSUIT, p.id))
            .rejects.toMatchObject({ code: 'NO_RFP_TEXT' });
    });
});

// ── Fix-first ack state ──────────────────────────────────────────────────────

describe('PR-C5 fix-first acknowledgment (§10 instrumentation)', () => {
    async function evaluated() {
        seedPursuitAndOpp();
        mockAiCalls();
        const p = await proposalService.saveProposal(U, PURSUIT, txtFile('draft.txt', DRAFT_TEXT));
        return evalService.runEvaluation(U, PURSUIT, p.id);
    }

    test('toggles open → acknowledged → addressed with timestamps', async () => {
        const ev = await evaluated();
        const r1 = await evalService.updateFixFirstAck(U, ev.id, 0, 'acknowledged');
        expect(r1.item.ackState).toBe('acknowledged');
        expect(r1.item.ackAt).toBeTruthy();
        expect(r1.item.ackByUid).toBe(U);

        const r2 = await evalService.updateFixFirstAck(U, ev.id, 0, 'addressed');
        expect(r2.item.ackState).toBe('addressed');

        const stored = admin._mockData.collections.govEvaluations[ev.id];
        expect(stored.passB.fixFirst[0].ackState).toBe('addressed');
        expect(stored.passB.fixFirst[1].ackState).toBe('open'); // untouched sibling
    });

    test('rejects invalid ack state and out-of-range index', async () => {
        const ev = await evaluated();
        await expect(evalService.updateFixFirstAck(U, ev.id, 0, 'done'))
            .rejects.toMatchObject({ code: 'INVALID_ACK_STATE' });
        await expect(evalService.updateFixFirstAck(U, ev.id, 99, 'acknowledged'))
            .rejects.toMatchObject({ code: 'INVALID_INDEX' });
    });

    test('cross-tenant ack rejected', async () => {
        const ev = await evaluated();
        await expect(evalService.updateFixFirstAck(INTRUDER, ev.id, 0, 'acknowledged'))
            .rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
});
