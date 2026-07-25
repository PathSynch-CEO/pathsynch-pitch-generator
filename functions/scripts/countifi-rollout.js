'use strict';
/**
 * Countifi rollout (2026-07-20, Charles: "Deploy — flip the flags and run the
 * Countifi rollout").
 *
 * Phase A — end-to-end acceptance under Charles's account: TEST-labeled
 *   opportunity (realistic RFP text) → pursuit → Countifi cleaned master into
 *   the vault → tailorProposal (real Gemini) → runEvaluation (real Gemini).
 * Phase B — the real deliverable: the cleaned Countifi master uploaded into
 *   David Hailey's vault (profile fields await his Gate-1a answers).
 *
 * Test artifacts are titled "TEST — …" and left in place for UI inspection.
 */

const fs = require('fs');
for (const line of fs.readFileSync('C:/Users/tdh35/pathsynch-pitch-generator/functions/.env', 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const admin = require('firebase-admin');
admin.initializeApp({
    credential: admin.credential.cert('C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json'),
    storageBucket: 'pathsynch-pitch-creation.firebasestorage.app',
});
const db = admin.firestore();

const CHARLES = 'dehiyRBCXcUUM72O211S27lfXbl1';
const DAVID   = 'IQaKauAsYnbRFmwKNQPTZj1FqsL2';
const DOCX    = 'C:/Users/tdh35/pathsynch-pitch-generator/functions/tests/fixtures/govcapture/countifi-master/countifi-master-cleaned.docx';

const RFP_TEXT = `REQUEST FOR PROPOSAL — RFP-TEST-2026-OI-001
TEST — Rollout Acceptance Agency, Office of Operations
Solicitation: Operational Intelligence and Asset Verification Platform

1. BACKGROUND. The Agency manages distributed facilities, vehicle fleets, and
warehouse inventory across multiple sites and requires a technology-enabled
operational intelligence platform to improve visibility, accountability, and
audit readiness.

2. SCOPE. The Contractor shall provide a configurable cloud platform providing:
inventory verification and reconciliation; computer-vision-assisted asset
identification; mobile field data collection; exception management workflows;
role-based dashboards; and reporting exportable to PDF and Excel. The platform
shall integrate with existing enterprise systems via secure RESTful APIs.

3. SUBMISSION INSTRUCTIONS. Proposals shall be submitted electronically through
the Agency portal no later than the response deadline. A completed Form SF-1449,
signed by an authorized representative, is required. Proposals shall not exceed
25 pages excluding appendices. Late submissions will not be accepted.

4. SECURITY REQUIREMENTS. The solution shall be hosted in a FedRAMP-authorized
environment or demonstrate an active FedRAMP authorization pathway. The offeror
shall describe alignment with NIST 800-53 controls, data encryption in transit
and at rest, role-based access control, and audit logging.

5. PAST PERFORMANCE. Offerors shall provide three (3) past performance
references for projects of similar size and scope within the last five years,
including client name, period of performance, and outcomes.

6. EVALUATION CRITERIA. Proposals will be evaluated on: (a) technical approach
and solution fit, 35 points; (b) past performance, 25 points; (c) security and
compliance posture, 20 points; (d) implementation approach and schedule, 10
points; (e) price reasonableness, 10 points.

7. DELIVERABLES AND SCHEDULE. Implementation shall follow a phased methodology
with user acceptance testing prior to production deployment, administrator and
end-user training, and a post-deployment support period. A project management
plan and risk register shall be maintained throughout.

8. QUESTIONS. Questions regarding this solicitation shall be submitted in
writing no later than ten (10) business days before the response deadline.`;

(async () => {
    const masterService    = require('../services/govcapture/govMasterProposalService');
    const pursuitService   = require('../services/govcapture/govPursuitService');
    const tailoringService = require('../services/govcapture/govTailoringService');
    const evalService      = require('../services/govcapture/govEvaluationService');

    const docxBuffer = fs.readFileSync(DOCX);
    const docxFile = (name) => ({
        originalname: name,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxBuffer,
    });

    // Charles's gov profile id (programmatic — avoids I/l ambiguity).
    const profSnap = await db.collection('govProfiles').where('userId', '==', CHARLES).limit(1).get();
    const profileId = profSnap.docs.length ? profSnap.docs[0].id : null;
    console.log('[1] Charles profileId:', profileId);

    // ── Phase A ──────────────────────────────────────────────────────────────

    // A1. TEST opportunity with real RFP text.
    const due = new Date(Date.now() + 45 * 24 * 3600 * 1000);
    const oppRef = await db.collection('govOpportunities').add({
        userId: CHARLES,
        profileIds: profileId ? [profileId] : [],
        title: 'TEST — Countifi Rollout Acceptance — Operational Intelligence Platform RFP',
        description: RFP_TEXT,
        buyerName: 'TEST — Rollout Acceptance Agency',
        agencyName: 'TEST — Rollout Acceptance Agency',
        solicitationNumber: 'RFP-TEST-2026-OI-001',
        dueDate: due.toISOString(),
        primarySource: 'manual_upload',
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('[2] TEST opportunity:', oppRef.id);

    // A2. Pursuit.
    const { pursuit } = await pursuitService.createPursuit(CHARLES, oppRef.id);
    console.log('[3] Pursuit:', pursuit.id, 'stage:', pursuit.stage, 'profileId:', pursuit.profileId);

    // A3. Master into Charles's vault (acceptance copy).
    const masterA = await masterService.saveMaster(CHARLES, docxFile('Countifi Master Government Proposal 2026.docx'), {
        title: 'TEST — Countifi Master (rollout acceptance)',
        profileId: profileId || undefined,
    });
    console.log('[4] Master (Charles):', masterA.id, 'v' + masterA.version,
        'sections:', masterA.sections.length, 'gaps:', masterA.knownGaps.map(g => g.id).join(','));

    // A4. Tailor (real Gemini).
    console.log('[5] Tailoring… (section-wise generation, real model calls)');
    const t0 = Date.now();
    const draft = await tailoringService.tailorProposal(CHARLES, pursuit.id, masterA.id);
    console.log('[5] Tailored in', Math.round((Date.now() - t0) / 1000) + 's:',
        draft.id, draft.filename, 'sections:', draft.sectionCount, 'draftLength:', draft.draftLength);
    console.log('    gapChecklist:', draft.gapChecklist.map(g => `${g.source}:${g.id}`).join(' | '));

    // A5. Evaluate the tailored draft (real Gemini).
    console.log('[6] Evaluating…');
    const t1 = Date.now();
    const evaluation = await evalService.runEvaluation(CHARLES, pursuit.id, draft.id);
    console.log('[6] Evaluated in', Math.round((Date.now() - t1) / 1000) + 's:',
        'PassA', JSON.stringify(evaluation.passA.summary),
        'PassB score', evaluation.passB.score,
        'rubric', evaluation.rubricVersion);
    console.log('    fixFirst:', evaluation.passB.fixFirst.map(f => f.title).join(' | '));

    // ── Phase B — the real deliverable ───────────────────────────────────────

    const masterB = await masterService.saveMaster(DAVID, docxFile('Countifi Master Government Proposal 2026.docx'), {
        title: 'Countifi Master Government Proposal 2026',
    });
    console.log('[7] Master (David/Countifi):', masterB.id, 'v' + masterB.version,
        'sections:', masterB.sections.length, 'gaps:', masterB.knownGaps.map(g => g.id).join(','));

    console.log('DONE');
    process.exit(0);
})().catch(e => { console.error('ROLLOUT FAIL:', e.code || '', e.message); process.exit(1); });
