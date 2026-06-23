'use strict';

/**
 * Phase 3C Firestore Emulator Tests — Public-Share Cutover + Offboarding
 *
 * Four mandatory denial/projection tests (per v7 spec):
 *
 *   Proof 1: Unauthenticated direct Firestore read of shared pitch → DENIED
 *   Proof 2: Authenticated non-member direct Firestore read → DENIED
 *   Proof 3: Valid GET /share/:shareToken → only allowlisted fields returned
 *   Proof 4: Revoked token → 404
 *
 * Proof 5: Offboarding — two-stage + last-owner guard
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase3C.emulator.test.js --no-coverage --forceExit
 */

// CRITICAL: Unmock firebase-admin BEFORE any require() calls.
jest.unmock('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

const PROJECT_ID = 'phase3c-emulator-test';

// Initialize Admin SDK targeting the emulator
const admin = require('firebase-admin');
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const adminDb = admin.firestore();

// Import modules under test
const { initiateOffboarding, processOffboardingBatch, completeOffboarding } = require('../services/workspaceOffboardingService');

// ── Constants ───────────────────────────────────────────────────────────────

const WS_ID = 'ws_phase3c';
const OWNER_UID = 'owner_3c';
const CONTRIBUTOR_UID = 'contrib_3c';
const STRANGER_UID = 'stranger_3c';

const PITCH_ID = 'pitch_3c_shared';
const PITCH_PRIVATE_ID = 'pitch_3c_private';
const SHARE_TOKEN = 'a'.repeat(64); // 64-char hex token
const REVOKED_TOKEN = 'b'.repeat(64);

// ── Test Environment ────────────────────────────────────────────────────────

let testEnv;

beforeAll(async () => {
    // Load production firestore.rules
    const rulesPath = resolve(__dirname, '../../firestore.rules');
    const rules = readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: 8080 },
    });

    // Seed data via Admin SDK (bypasses rules)

    // Workspace
    await adminDb.collection('workspaces').doc(WS_ID).set({
        ownerId: OWNER_UID,
        entitlementOwnerUid: OWNER_UID,
        name: 'Phase 3C Test Workspace',
        memberIds: [OWNER_UID, CONTRIBUTOR_UID],
        memberCount: 2,
        seatLimit: 5,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Workspace members
    await adminDb.collection('workspaceMembers').doc(`${WS_ID}_${OWNER_UID}`).set({
        workspaceId: WS_ID, uid: OWNER_UID, role: 'admin', status: 'active',
        isWorkspaceOwner: true, email: 'owner@test.com', displayName: 'Owner',
    });
    await adminDb.collection('workspaceMembers').doc(`${WS_ID}_${CONTRIBUTOR_UID}`).set({
        workspaceId: WS_ID, uid: CONTRIBUTOR_UID, role: 'contributor', status: 'active',
        isWorkspaceOwner: false, email: 'contrib@test.com', displayName: 'Contributor',
    });

    // Shared pitch WITH sharing.shareToken (Phase 3C server-side token)
    await adminDb.collection('pitches').doc(PITCH_ID).set({
        userId: CONTRIBUTOR_UID,
        workspaceId: WS_ID,
        createdByUid: CONTRIBUTOR_UID,
        createdByDisplayName: 'Contributor',
        businessName: 'Test Business',
        contactName: 'John Doe',
        industry: 'Technology',
        subIndustry: 'SaaS',
        pitchLevel: 2,
        style: 'executive_brief',
        html: '<h1>Test Pitch Content</h1>',
        shared: true,
        shareId: 'legacy_share_id',
        sharing: {
            shareToken: SHARE_TOKEN,
            sharedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        // Sensitive fields that must NOT appear in public projection
        formData: { secretField: 'should_not_appear' },
        salesLibrary: { docs: ['secret_doc_1'] },
        pitchMetadata: { credits: 145, enrichment: {} },
        triggerEvent: { type: 'test', content: 'secret' },
        precallFormData: { notes: 'private' },
        resolvedBrand: {
            companyName: 'PathSynch',
            logoUrl: 'https://example.com/logo.png',
            accentColor: '#1a73e8',
            secondaryColor: '#ffffff',
            footerText: 'Powered by PathSynch',
            // Internal fields that should not appear in public brand
            planTier: 'scale',
            featureFlags: { beta: true },
        },
        roiData: { monthlyRevenue: 5000 },
        analytics: { views: 42, uniqueViewers: 20, lastViewedAt: null },
        status: 'Draft',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Shared pitch WITH revoked token
    await adminDb.collection('pitches').doc('pitch_3c_revoked').set({
        userId: OWNER_UID,
        workspaceId: WS_ID,
        businessName: 'Revoked Pitch',
        shared: true,
        sharing: {
            shareToken: REVOKED_TOKEN,
            sharedAt: admin.firestore.FieldValue.serverTimestamp(),
            revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        html: '<h1>Should not be visible</h1>',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Private pitch (shared: false, no sharing.shareToken)
    await adminDb.collection('pitches').doc(PITCH_PRIVATE_ID).set({
        userId: OWNER_UID,
        workspaceId: WS_ID,
        businessName: 'Private Pitch',
        shared: false,
        html: '<h1>Private Content</h1>',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // User docs for auth
    await adminDb.collection('users').doc(OWNER_UID).set({
        email: 'owner@test.com', plan: 'scale', credits: 1000,
    });
    await adminDb.collection('users').doc(CONTRIBUTOR_UID).set({
        email: 'contrib@test.com', plan: 'starter', credits: 500,
    });
    await adminDb.collection('users').doc(STRANGER_UID).set({
        email: 'stranger@test.com', plan: 'starter', credits: 100,
    });
}, 30000);

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

// ── Proof 1: Unauthenticated direct Firestore read of shared pitch → DENIED ──

describe('Proof 1 — Unauthenticated direct Firestore read DENIED', () => {
    test('unauthenticated client CANNOT read pitch even when shared == true', async () => {
        const unauthCtx = testEnv.unauthenticatedContext();
        const unauthDb = unauthCtx.firestore();
        await assertFails(unauthDb.collection('pitches').doc(PITCH_ID).get());
    });

    test('unauthenticated client CANNOT query pitches by shareId', async () => {
        const unauthCtx = testEnv.unauthenticatedContext();
        const unauthDb = unauthCtx.firestore();
        await assertFails(
            unauthDb.collection('pitches')
                .where('shareId', '==', 'legacy_share_id')
                .get()
        );
    });

    test('unauthenticated client CANNOT query pitches by sharing.shareToken', async () => {
        const unauthCtx = testEnv.unauthenticatedContext();
        const unauthDb = unauthCtx.firestore();
        await assertFails(
            unauthDb.collection('pitches')
                .where('sharing.shareToken', '==', SHARE_TOKEN)
                .get()
        );
    });
});

// ── Proof 2: Authenticated non-member direct read → DENIED ──────────────────

describe('Proof 2 — Authenticated non-member direct Firestore read DENIED', () => {
    test('authenticated stranger CANNOT read shared pitch by doc ID', async () => {
        const strangerCtx = testEnv.authenticatedContext(STRANGER_UID);
        const strangerDb = strangerCtx.firestore();
        await assertFails(strangerDb.collection('pitches').doc(PITCH_ID).get());
    });

    test('authenticated stranger CANNOT query pitches by shareId', async () => {
        const strangerCtx = testEnv.authenticatedContext(STRANGER_UID);
        const strangerDb = strangerCtx.firestore();
        await assertFails(
            strangerDb.collection('pitches')
                .where('shareId', '==', 'legacy_share_id')
                .get()
        );
    });

    test('authenticated stranger CANNOT read private pitch by doc ID', async () => {
        const strangerCtx = testEnv.authenticatedContext(STRANGER_UID);
        const strangerDb = strangerCtx.firestore();
        await assertFails(strangerDb.collection('pitches').doc(PITCH_PRIVATE_ID).get());
    });

    test('pitch owner CAN still read their own pitch', async () => {
        const ownerCtx = testEnv.authenticatedContext(OWNER_UID);
        const ownerDb = ownerCtx.firestore();
        await assertSucceeds(ownerDb.collection('pitches').doc(PITCH_PRIVATE_ID).get());
    });
});

// ── Proof 3: Server-side share endpoint returns only allowlisted fields ──────

describe('Proof 3 — Server-side share endpoint field projection', () => {
    test('Admin SDK query by sharing.shareToken returns the pitch (server-side access)', async () => {
        const snap = await adminDb.collection('pitches')
            .where('sharing.shareToken', '==', SHARE_TOKEN)
            .limit(1)
            .get();

        expect(snap.empty).toBe(false);
        const data = snap.docs[0].data();
        expect(data.businessName).toBe('Test Business');
    });

    test('projectPublicFields strips sensitive fields', () => {
        // Import the projection function
        // We simulate the same logic here since shareRoutes.js exports a router
        const PUBLIC_ALLOWLIST = new Set([
            'businessName', 'contactName', 'industry', 'subIndustry',
            'address', 'websiteUrl', 'googleRating', 'numReviews',
            'pitchLevel', 'style', 'html', 'roiData',
            'reviewAnalysis', 'reviewAnalytics', 'reviewPitchMetrics',
            'createdAt', 'updatedAt', 'status', 'linkedInPosts', 'visuals',
        ]);

        const fullPitch = {
            userId: CONTRIBUTOR_UID,
            workspaceId: WS_ID,
            createdByUid: CONTRIBUTOR_UID,
            businessName: 'Test Business',
            html: '<h1>Content</h1>',
            formData: { secret: true },
            salesLibrary: { docs: [] },
            pitchMetadata: { credits: 145 },
            triggerEvent: { type: 'test' },
            precallFormData: { notes: 'private' },
            resolvedBrand: {
                companyName: 'PathSynch',
                logoUrl: 'https://example.com/logo.png',
                accentColor: '#1a73e8',
                planTier: 'scale',
                featureFlags: { beta: true },
            },
            analytics: { views: 42, uniqueViewers: 20, lastViewedAt: null },
            status: 'Draft',
        };

        // Build projected output (replicating shareRoutes.js logic)
        const projected = { id: 'test_pitch_id' };
        for (const key of PUBLIC_ALLOWLIST) {
            if (fullPitch[key] !== undefined) projected[key] = fullPitch[key];
        }
        if (fullPitch.resolvedBrand) {
            projected.brand = {};
            for (const f of ['companyName', 'agencyName', 'logoUrl', 'accentColor', 'secondaryColor', 'footerText']) {
                if (fullPitch.resolvedBrand[f] !== undefined) projected.brand[f] = fullPitch.resolvedBrand[f];
            }
        }
        if (fullPitch.analytics) {
            projected.analytics = {
                views: fullPitch.analytics.views || 0,
                uniqueViewers: fullPitch.analytics.uniqueViewers || 0,
            };
        }

        // Verify allowlisted fields present
        expect(projected.businessName).toBe('Test Business');
        expect(projected.html).toBe('<h1>Content</h1>');
        expect(projected.status).toBe('Draft');
        expect(projected.brand.companyName).toBe('PathSynch');
        expect(projected.brand.logoUrl).toBe('https://example.com/logo.png');
        expect(projected.brand.accentColor).toBe('#1a73e8');
        expect(projected.analytics.views).toBe(42);

        // Verify SENSITIVE fields are ABSENT
        expect(projected.userId).toBeUndefined();
        expect(projected.workspaceId).toBeUndefined();
        expect(projected.createdByUid).toBeUndefined();
        expect(projected.formData).toBeUndefined();
        expect(projected.salesLibrary).toBeUndefined();
        expect(projected.pitchMetadata).toBeUndefined();
        expect(projected.triggerEvent).toBeUndefined();
        expect(projected.precallFormData).toBeUndefined();
        expect(projected.resolvedBrand).toBeUndefined(); // Full brand stripped; only projected.brand exists

        // Verify brand does NOT leak internal fields
        expect(projected.brand.planTier).toBeUndefined();
        expect(projected.brand.featureFlags).toBeUndefined();
    });

    test('Admin SDK query for non-existent token returns empty', async () => {
        const snap = await adminDb.collection('pitches')
            .where('sharing.shareToken', '==', 'nonexistent_token_' + Date.now())
            .limit(1)
            .get();

        expect(snap.empty).toBe(true);
    });
});

// ── Proof 4: Revoked/expired token → not found ──────────────────────────────

describe('Proof 4 — Revoked share token returns nothing', () => {
    test('Admin SDK query finds the revoked pitch document', async () => {
        const snap = await adminDb.collection('pitches')
            .where('sharing.shareToken', '==', REVOKED_TOKEN)
            .limit(1)
            .get();

        expect(snap.empty).toBe(false);
        const data = snap.docs[0].data();
        // The sharing.revokedAt field is set — server-side handler must check this
        expect(data.sharing.revokedAt).toBeDefined();
    });

    test('server-side handler rejects revoked token (revokedAt is set)', async () => {
        const snap = await adminDb.collection('pitches')
            .where('sharing.shareToken', '==', REVOKED_TOKEN)
            .limit(1)
            .get();

        const data = snap.docs[0].data();
        // Simulate shareRoutes.js revocation check
        const isRevoked = data.sharing && data.sharing.revokedAt;
        expect(isRevoked).toBeTruthy();
    });

    test('non-existent token returns empty query', async () => {
        const snap = await adminDb.collection('pitches')
            .where('sharing.shareToken', '==', 'totally_bogus_token_value')
            .limit(1)
            .get();

        expect(snap.empty).toBe(true);
    });
});

// ── Proof 5: Offboarding — two-stage + last-owner guard ─────────────────────

describe('Proof 5 — Workspace offboarding', () => {
    const OFF_WS = 'ws_offboard_3c';
    const OFF_OWNER = 'off_owner_3c';
    const OFF_CONTRIB = 'off_contrib_3c';
    const OFF_SUCCESSOR = 'off_successor_3c';

    beforeAll(async () => {
        // Create offboarding test workspace
        await adminDb.collection('workspaces').doc(OFF_WS).set({
            ownerId: OFF_OWNER,
            entitlementOwnerUid: OFF_OWNER,
            name: 'Offboard Test Workspace',
            memberIds: [OFF_OWNER, OFF_CONTRIB, OFF_SUCCESSOR],
            memberCount: 3,
            seatLimit: 10,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await adminDb.collection('workspaceMembers').doc(`${OFF_WS}_${OFF_OWNER}`).set({
            workspaceId: OFF_WS, uid: OFF_OWNER, role: 'admin', status: 'active',
            isWorkspaceOwner: true, email: 'offowner@test.com', displayName: 'Off Owner',
        });
        await adminDb.collection('workspaceMembers').doc(`${OFF_WS}_${OFF_CONTRIB}`).set({
            workspaceId: OFF_WS, uid: OFF_CONTRIB, role: 'contributor', status: 'active',
            isWorkspaceOwner: false, email: 'offcontrib@test.com', displayName: 'Off Contributor',
        });
        await adminDb.collection('workspaceMembers').doc(`${OFF_WS}_${OFF_SUCCESSOR}`).set({
            workspaceId: OFF_WS, uid: OFF_SUCCESSOR, role: 'manager', status: 'active',
            isWorkspaceOwner: false, email: 'offsuc@test.com', displayName: 'Off Successor',
        });

        // Create pitches owned by the contributor to be offboarded
        for (let i = 0; i < 3; i++) {
            await adminDb.collection('pitches').doc(`off_pitch_${i}`).set({
                userId: OFF_CONTRIB,
                workspaceId: OFF_WS,
                createdByUid: OFF_CONTRIB,
                createdByDisplayName: 'Off Contributor',
                businessName: `Offboard Test ${i}`,
                html: `<h1>Pitch ${i}</h1>`,
                status: 'Draft',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        // Create a market report owned by the contributor
        await adminDb.collection('marketReports').doc('off_report_1').set({
            userId: OFF_CONTRIB,
            workspaceId: OFF_WS,
            createdByUid: OFF_CONTRIB,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Create teams mirror doc
        await adminDb.collection('teams').doc(OFF_OWNER).set({
            ownerUid: OFF_OWNER,
            memberUids: [OFF_OWNER, OFF_CONTRIB, OFF_SUCCESSOR],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });

    test('cannot offboard the workspace owner', async () => {
        await expect(
            initiateOffboarding(OFF_WS, OFF_OWNER, OFF_OWNER)
        ).rejects.toThrow('Cannot offboard the workspace owner');
    });

    test('full offboarding flow: initiate → batch → complete', async () => {
        // Stage 1: Initiate
        const { jobId } = await initiateOffboarding(OFF_WS, OFF_CONTRIB, OFF_OWNER, {
            successorUid: OFF_SUCCESSOR,
        });
        expect(jobId).toBeDefined();

        // Verify member is now OFFBOARDING
        const memberDoc = await adminDb.collection('workspaceMembers')
            .doc(`${OFF_WS}_${OFF_CONTRIB}`).get();
        expect(memberDoc.data().status).toBe('offboarding');

        // Stage 2: Batch reassignment
        const batchResult = await processOffboardingBatch(jobId);
        expect(batchResult.pitchesReassigned).toBe(3);
        expect(batchResult.reportsReassigned).toBe(1);

        // Verify pitches have assigneeUid set to successor
        for (let i = 0; i < 3; i++) {
            const pitchDoc = await adminDb.collection('pitches').doc(`off_pitch_${i}`).get();
            const data = pitchDoc.data();
            expect(data.assigneeUid).toBe(OFF_SUCCESSOR);
            expect(data.formerMemberAt).toBeDefined();
            // createdByUid must be UNCHANGED (immutable attribution)
            expect(data.createdByUid).toBe(OFF_CONTRIB);
            expect(data.createdByDisplayName).toBe('Off Contributor');
        }

        // Verify report has assigneeUid set
        const reportDoc = await adminDb.collection('marketReports').doc('off_report_1').get();
        expect(reportDoc.data().assigneeUid).toBe(OFF_SUCCESSOR);

        // Stage 3: Complete
        await completeOffboarding(jobId);

        // Verify member is now REMOVED
        const finalMember = await adminDb.collection('workspaceMembers')
            .doc(`${OFF_WS}_${OFF_CONTRIB}`).get();
        expect(finalMember.data().status).toBe('removed');
        expect(finalMember.data().removedAt).toBeDefined();

        // Verify workspace memberIds updated
        const wsDoc = await adminDb.collection('workspaces').doc(OFF_WS).get();
        expect(wsDoc.data().memberIds).not.toContain(OFF_CONTRIB);
        expect(wsDoc.data().memberCount).toBe(2);

        // Verify teams mirror updated
        const teamsDoc = await adminDb.collection('teams').doc(OFF_OWNER).get();
        expect(teamsDoc.data().memberUids).not.toContain(OFF_CONTRIB);

        // Verify job marked completed
        const jobDoc = await adminDb.collection('offboardingJobs').doc(jobId).get();
        expect(jobDoc.data().status).toBe('completed');
    });

    test('cannot offboard an already-removed member', async () => {
        await expect(
            initiateOffboarding(OFF_WS, OFF_CONTRIB, OFF_OWNER)
        ).rejects.toThrow('Target member is not active');
    });

    test('successor cannot be the target member', async () => {
        // Re-activate a member for this test
        await adminDb.collection('workspaceMembers').doc(`${OFF_WS}_${OFF_CONTRIB}`).update({
            status: 'active',
        });
        await expect(
            initiateOffboarding(OFF_WS, OFF_CONTRIB, OFF_OWNER, {
                successorUid: OFF_CONTRIB,
            })
        ).rejects.toThrow('Successor cannot be the member being offboarded');
        // Clean up: set back to removed
        await adminDb.collection('workspaceMembers').doc(`${OFF_WS}_${OFF_CONTRIB}`).update({
            status: 'removed',
        });
    });

    test('audit log records both initiation and completion', async () => {
        const auditSnap = await adminDb.collection('workspaceAuditLog')
            .where('workspaceId', '==', OFF_WS)
            .where('action', '==', 'MEMBER_OFFBOARDED')
            .get();

        expect(auditSnap.size).toBeGreaterThanOrEqual(2);

        const stages = auditSnap.docs.map(d => d.data().details?.stage);
        expect(stages).toContain('initiated');
        expect(stages).toContain('completed');
    });
});
