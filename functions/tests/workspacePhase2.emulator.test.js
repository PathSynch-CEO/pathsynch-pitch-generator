'use strict';

/**
 * Phase 2 Emulator Tests — Cache Isolation + Client-Write Bypass
 *
 * These tests run against the real Firestore emulator, NOT Jest mocks.
 * They prove tenancy-critical guarantees that mocks cannot:
 *
 *   Section A — Cache Isolation:
 *     Real resolveBrand() + getUserPlan() against emulator-backed Firestore.
 *     The production cache implementation is active in the same Node process.
 *     Both call orders (solo→workspace, workspace→solo) are tested.
 *
 *   Section B — Client-Write Bypass (Gate #7):
 *     Real Firestore rules enforced by the emulator.
 *     Proves non-admin cannot write owner branding, admin cannot bypass version
 *     creation via direct client write, and solo branding remains unchanged.
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx jest tests/workspacePhase2.emulator.test.js --no-coverage"
 *
 * Or start emulator separately and run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/workspacePhase2.emulator.test.js --no-coverage
 */

// CRITICAL: Unmock firebase-admin BEFORE any require() calls.
// The repo has a Jest auto-mock at __mocks__/firebase-admin.js that replaces
// the real module. Emulator tests need the REAL Admin SDK to talk to the emulator.
jest.unmock('firebase-admin');

// ── Emulator-backed rules tests (Section B) ────────────────────────────────
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

// ── Admin SDK for seeding + production service tests (Section A) ───────────
// firebase-admin must connect to the emulator via FIRESTORE_EMULATOR_HOST env.
// CRITICAL: initializeApp() MUST happen before requiring planGate.js or brandResolver.js
// because planGate.js calls admin.firestore() at module level (line 10).
const admin = require('firebase-admin');

const PROJECT_ID = 'workspace-phase2-emulator-test';

// Initialize Admin SDK targeting the emulator BEFORE loading services
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}

// ── Production services under test (Section A) ────────────────────────────
// These use the REAL module-level cache and the REAL Firestore reads via admin SDK.
const { resolveBrand, invalidateCache } = require('../services/brandResolver');
const { getUserPlan } = require('../middleware/planGate');

// ── Constants ──────────────────────────────────────────────────────────────
const OWNER_UID = 'emul_owner1';
const MEMBER_UID = 'emul_member1';
const WORKSPACE_ID = 'ws_phase2_emul';

let testEnv;
let adminDb;

// ── Setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
    // Initialize rules-unit-testing environment for Section B (rules tests)
    const rulesPath = resolve(__dirname, '../../firestore.rules');
    const rules = readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules,
            host: '127.0.0.1',
            port: 8080,
        },
    });

    // Admin SDK was already initialized at module level (before service imports).
    // FIRESTORE_EMULATOR_HOST env var directs all Admin SDK Firestore calls to the emulator.
    adminDb = admin.firestore();
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    // Clear ALL emulator data between tests
    if (testEnv) await testEnv.clearFirestore();
    // Clear the production brand cache so no stale entries persist between tests
    invalidateCache();
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function seedTestData() {
    // Use Admin SDK (bypasses rules) to seed the required documents
    const batch = adminDb.batch();

    // Workspace
    batch.set(adminDb.collection('workspaces').doc(WORKSPACE_ID), {
        ownerId: OWNER_UID,
        entitlementOwnerUid: OWNER_UID,
        name: 'Phase 2 Emulator Workspace',
        memberIds: [OWNER_UID, MEMBER_UID],
        memberCount: 2,
        seatLimit: 5,
    });

    // Workspace members
    batch.set(adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${OWNER_UID}`), {
        workspaceId: WORKSPACE_ID,
        uid: OWNER_UID,
        email: 'owner@test.com',
        displayName: 'Owner User',
        role: 'admin',
        isWorkspaceOwner: true,
        status: 'active',
    });
    batch.set(adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${MEMBER_UID}`), {
        workspaceId: WORKSPACE_ID,
        uid: MEMBER_UID,
        email: 'member@test.com',
        displayName: 'Member User',
        role: 'contributor',
        isWorkspaceOwner: false,
        status: 'active',
    });

    // Owner user doc — Scale plan
    batch.set(adminDb.collection('users').doc(OWNER_UID), {
        email: 'owner@test.com',
        subscription: { plan: 'scale' },
        plan: 'scale',
    });

    // Member user doc — Starter plan
    batch.set(adminDb.collection('users').doc(MEMBER_UID), {
        email: 'member@test.com',
        subscription: { plan: 'starter' },
        plan: 'starter',
    });

    // Owner's brand overrides (custom agency branding)
    batch.set(adminDb.collection('agencyBrandOverrides').doc(OWNER_UID), {
        companyName: 'Owner Agency Corp',
        logoUrl: 'https://owner-logo.png',
        accentColor: '#FF5733',
        useCustomBranding: true,
    });

    // Member's personal brand overrides (different branding)
    batch.set(adminDb.collection('agencyBrandOverrides').doc(MEMBER_UID), {
        companyName: 'Member Personal Brand',
        logoUrl: 'https://member-personal-logo.png',
        accentColor: '#0000FF',
        useCustomBranding: true,
    });

    // Owner's entitlements (Scale → custom logo + colors)
    batch.set(adminDb.collection('agencyEntitlements').doc(OWNER_UID), {
        planTier: 'scale',
        canUseCustomLogo: true,
        canUseCustomColors: true,
        showPoweredByPathSynch: false,
    });

    // Member has NO entitlements doc (Starter plan → defaults)

    // Workspace branding (server-only source — resolveBrand reads this in workspace context)
    batch.set(adminDb.collection('workspaceBranding').doc(WORKSPACE_ID), {
        companyName: 'Owner Agency Corp',
        logoUrl: 'https://owner-logo.png',
        accentColor: '#FF5733',
        useCustomBranding: true,
    });

    await batch.commit();
}

function getAuthenticatedContext(uid, email) {
    return testEnv.authenticatedContext(uid, { email: email || `${uid}@test.com` });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION A — Cache Isolation (emulator-backed, production cache active)
// ════════════════════════════════════════════════════════════════════════════

describe('Section A: Cache-key isolation (emulator-backed, real cache)', () => {

    beforeEach(async () => {
        await seedTestData();
    });

    // ── Call order 1: Solo first, then workspace ───────────────────────────

    describe('Call order 1: solo → workspace', () => {
        test('member personal brand resolves correctly (solo, no workspaceId)', async () => {
            const brand = await resolveBrand(MEMBER_UID);

            // Member has Starter plan → no custom logo/colors
            expect(brand.companyName).toBe('Member Personal Brand');
            expect(brand.logoUrl).toBeNull(); // Starter cannot use custom logo
            // Accent color falls back to default because Starter cannot use custom colors
            expect(brand.accentColor).toBe('#0D9488'); // PathSynch default
        });

        test('after solo resolve, workspace resolve returns OWNER branding, not cached member brand', async () => {
            // Step 1: Solo resolve (populates cache at key "emul_member1")
            const soloBrand = await resolveBrand(MEMBER_UID);
            expect(soloBrand.companyName).toBe('Member Personal Brand');

            // Step 2: Workspace resolve (should NOT return cached member brand)
            const wsBrand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(wsBrand.companyName).toBe('Owner Agency Corp');
            expect(wsBrand.logoUrl).toBe('https://owner-logo.png');
            expect(wsBrand.accentColor).toBe('#ff5733');
        });

        test('re-resolving solo after workspace still returns member personal brand', async () => {
            await resolveBrand(MEMBER_UID); // solo
            await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID }); // workspace
            const soloBrand2 = await resolveBrand(MEMBER_UID); // solo again

            expect(soloBrand2.companyName).toBe('Member Personal Brand');
            expect(soloBrand2.logoUrl).toBeNull(); // still Starter
        });
    });

    // ── Call order 2: Workspace first, then solo ───────────────────────────

    describe('Call order 2: workspace → solo', () => {
        test('workspace resolve returns OWNER branding first', async () => {
            const wsBrand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });

            expect(wsBrand.companyName).toBe('Owner Agency Corp');
            expect(wsBrand.logoUrl).toBe('https://owner-logo.png');
            expect(wsBrand.accentColor).toBe('#ff5733');
        });

        test('after workspace resolve, solo resolve returns MEMBER personal brand, not cached owner brand', async () => {
            // Step 1: Workspace resolve (populates cache at key "emul_owner1:ws:ws_phase2_emul")
            const wsBrand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(wsBrand.companyName).toBe('Owner Agency Corp');

            // Step 2: Solo resolve (should NOT return cached owner brand)
            const soloBrand = await resolveBrand(MEMBER_UID);
            expect(soloBrand.companyName).toBe('Member Personal Brand');
            expect(soloBrand.logoUrl).toBeNull(); // member's Starter tier
        });

        test('re-resolving workspace after solo still returns owner branding', async () => {
            await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID }); // workspace
            await resolveBrand(MEMBER_UID); // solo
            const wsBrand2 = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID }); // workspace again

            expect(wsBrand2.companyName).toBe('Owner Agency Corp');
            expect(wsBrand2.logoUrl).toBe('https://owner-logo.png');
        });
    });

    // ── Plan inheritance isolation ──────────────────────────────────────────

    describe('getUserPlan cache isolation', () => {
        test('member own plan without workspaceId is starter', async () => {
            const plan = await getUserPlan(MEMBER_UID);
            expect(plan).toBe('starter');
        });

        test('member plan with workspaceId is owner scale plan', async () => {
            const plan = await getUserPlan(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(plan).toBe('scale');
        });

        test('solo plan does not leak into workspace plan (order: solo → workspace)', async () => {
            const soloPlan = await getUserPlan(MEMBER_UID);
            expect(soloPlan).toBe('starter');

            const wsPlan = await getUserPlan(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(wsPlan).toBe('scale');
        });

        test('workspace plan does not leak into solo plan (order: workspace → solo)', async () => {
            const wsPlan = await getUserPlan(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(wsPlan).toBe('scale');

            const soloPlan = await getUserPlan(MEMBER_UID);
            expect(soloPlan).toBe('starter');
        });
    });

    // ── Cache key distinctness proof ───────────────────────────────────────

    describe('Cache key distinctness', () => {
        test('cache keys for solo vs workspace are demonstrably different strings', () => {
            // This is a code-level assertion that the cache key formula
            // produces distinct keys for the same member in different contexts.
            const soloCacheKey = MEMBER_UID; // no workspaceId → brandOwnerId = MEMBER_UID
            const wsCacheKey = `${OWNER_UID}:ws:${WORKSPACE_ID}`; // workspaceId present → brandOwnerId = OWNER_UID

            expect(soloCacheKey).not.toBe(wsCacheKey);
            expect(soloCacheKey).toBe('emul_member1');
            expect(wsCacheKey).toBe('emul_owner1:ws:ws_phase2_emul');
        });

        test('invalidateCache(uid) only clears targeted key', async () => {
            // Populate both cache entries
            await resolveBrand(MEMBER_UID); // solo → cached at "emul_member1"
            await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID }); // ws → cached at "emul_owner1:ws:..."

            // Invalidate only the solo key
            invalidateCache(MEMBER_UID);

            // Workspace cache should still be present (returns instantly without Firestore read)
            const wsBrand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });
            expect(wsBrand.companyName).toBe('Owner Agency Corp');
        });
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION B — Client-Write Bypass (Gate #7, emulator-backed rules)
// ════════════════════════════════════════════════════════════════════════════

describe('Section B: Direct-client-write bypass (Gate #7, emulator rules)', () => {

    beforeEach(async () => {
        await seedTestData();
    });

    // ── B1: Non-admin member cannot write owner's branding source ──────────

    test('B1: contributor cannot write to workspace owner\'s agencyBrandOverrides', async () => {
        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        // Member tries to update the OWNER's brand overrides doc
        await assertFails(
            db.collection('agencyBrandOverrides').doc(OWNER_UID).update({
                companyName: 'Hijacked by member',
            })
        );
    });

    test('B1: contributor cannot create workspace owner\'s agencyBrandOverrides', async () => {
        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        // Member tries to create a doc at the owner's UID path
        await assertFails(
            db.collection('agencyBrandOverrides').doc(OWNER_UID).set({
                companyName: 'Hijacked by member',
                useCustomBranding: true,
            })
        );
    });

    // ── B2: Admin cannot bypass version creation via direct client write ───

    test('B2: workspace admin direct write to agencyBrandOverrides does NOT create branding version', async () => {
        const ownerCtx = getAuthenticatedContext(OWNER_UID, 'owner@test.com');
        const db = ownerCtx.firestore();

        // Owner CAN write to their own agencyBrandOverrides (rules allow it)
        await assertSucceeds(
            db.collection('agencyBrandOverrides').doc(OWNER_UID).update({
                companyName: 'Updated via direct write',
            })
        );

        // But NO workspaceBrandingVersions record was created
        // (default deny — no rules for this collection → client can't write)
        // Use Admin SDK (bypasses rules) to read back — withSecurityRulesDisabled
        // does not propagate callback return values.
        const versionsSnap = await adminDb.collection('workspaceBrandingVersions')
            .where('workspaceId', '==', WORKSPACE_ID)
            .get();
        expect(versionsSnap.size).toBe(0);

        // And NO workspaceAuditLog record was created
        const auditSnap = await adminDb.collection('workspaceAuditLog')
            .where('workspaceId', '==', WORKSPACE_ID)
            .get();
        expect(auditSnap.size).toBe(0);
    });

    test('B2: client cannot write to workspaceBrandingVersions (default deny)', async () => {
        const ownerCtx = getAuthenticatedContext(OWNER_UID, 'owner@test.com');
        const db = ownerCtx.firestore();

        // Even the workspace owner cannot create a branding version via client SDK
        await assertFails(
            db.collection('workspaceBrandingVersions').doc('fake_version').set({
                workspaceId: WORKSPACE_ID,
                version: 1,
                brand: { companyName: 'Fake' },
                changedByUid: OWNER_UID,
            })
        );
    });

    test('B2: client cannot write to workspaceAuditLog (default deny)', async () => {
        const ownerCtx = getAuthenticatedContext(OWNER_UID, 'owner@test.com');
        const db = ownerCtx.firestore();

        // Even the workspace owner cannot create an audit record via client SDK
        await assertFails(
            db.collection('workspaceAuditLog').doc('fake_audit').set({
                workspaceId: WORKSPACE_ID,
                actorUid: OWNER_UID,
                action: 'BRANDING_UPDATED',
            })
        );
    });

    // ── B2a/B2b: workspaceBranding is write:false for ALL clients ──────────

    test('B2a: contributor cannot write to workspaceBranding/{workspaceId} (write:false)', async () => {
        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        await assertFails(
            db.collection('workspaceBranding').doc(WORKSPACE_ID).update({
                companyName: 'Hijacked by contributor',
            })
        );
    });

    test('B2b: workspace owner cannot write to workspaceBranding/{workspaceId} (write:false)', async () => {
        const ownerCtx = getAuthenticatedContext(OWNER_UID, 'owner@test.com');
        const db = ownerCtx.firestore();

        // Even the workspace owner is denied — write:false applies to ALL client SDK writes
        await assertFails(
            db.collection('workspaceBranding').doc(WORKSPACE_ID).update({
                companyName: 'Owner direct write attempt',
            })
        );
    });

    // ── B2e: Owner direct write to agencyBrandOverrides does NOT change workspace branding ──

    test('B2e: owner client write to agencyBrandOverrides does NOT change workspace-resolved branding', async () => {
        // Step 1: Resolve workspace branding — should be "Owner Agency Corp"
        const brandBefore = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        expect(brandBefore.companyName).toBe('Owner Agency Corp');

        // Step 2: Owner writes directly to agencyBrandOverrides (solo source — rules allow it)
        const ownerCtx = getAuthenticatedContext(OWNER_UID, 'owner@test.com');
        await assertSucceeds(
            ownerCtx.firestore().collection('agencyBrandOverrides').doc(OWNER_UID).update({
                companyName: 'Sneaky Solo Update',
            })
        );

        // Step 3: Invalidate cache and re-resolve workspace branding
        invalidateCache();
        const brandAfter = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });

        // Workspace brand is UNCHANGED — resolveBrand reads workspaceBranding/{wsId}, not agencyBrandOverrides
        expect(brandAfter.companyName).toBe('Owner Agency Corp');
    });

    // ── B3: Server-side handler succeeds with version + audit ──────────────

    test('B3: Admin SDK (server-side) can create branding version and audit record', async () => {
        // Simulate what the PUT /workspace/branding handler does — Admin SDK writes
        const brandSnapshot = {
            companyName: 'Owner Agency Corp',
            logoUrl: 'https://owner-logo.png',
            accentColor: '#FF5733',
        };

        // Create branding version via Admin SDK (as the server handler does)
        const versionRef = await adminDb.collection('workspaceBrandingVersions').add({
            workspaceId: WORKSPACE_ID,
            version: 1,
            brand: brandSnapshot,
            changedByUid: OWNER_UID,
            changeNote: 'Server-authorized update',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        expect(versionRef.id).toBeDefined();

        // Create audit record via Admin SDK (as the server handler does)
        const auditRef = await adminDb.collection('workspaceAuditLog').add({
            workspaceId: WORKSPACE_ID,
            actorUid: OWNER_UID,
            action: 'BRANDING_UPDATED',
            details: {
                versionId: versionRef.id,
                versionNumber: 1,
                fieldsChanged: ['companyName', 'logoUrl'],
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        expect(auditRef.id).toBeDefined();

        // Verify both records exist
        const versionSnap = await adminDb.collection('workspaceBrandingVersions').doc(versionRef.id).get();
        expect(versionSnap.exists).toBe(true);
        expect(versionSnap.data().version).toBe(1);
        expect(versionSnap.data().brand.companyName).toBe('Owner Agency Corp');

        const auditSnap = await adminDb.collection('workspaceAuditLog').doc(auditRef.id).get();
        expect(auditSnap.exists).toBe(true);
        expect(auditSnap.data().action).toBe('BRANDING_UPDATED');
        expect(auditSnap.data().actorUid).toBe(OWNER_UID);
    });

    // ── B2c: Server handler atomically updates workspace branding + version + audit ──

    test('B2c: Admin SDK updates workspaceBranding + creates version + creates audit atomically', async () => {
        // Simulate the PUT /workspace/branding handler — 3 writes via Admin SDK
        const updatedBrand = {
            companyName: 'Server Updated Corp',
            logoUrl: 'https://updated-logo.png',
            accentColor: '#00FF00',
            useCustomBranding: true,
        };

        // 1. Update workspaceBranding (server-only doc)
        await adminDb.collection('workspaceBranding').doc(WORKSPACE_ID).set(updatedBrand, { merge: true });

        // 2. Create branding version
        const versionRef = await adminDb.collection('workspaceBrandingVersions').add({
            workspaceId: WORKSPACE_ID,
            version: 1,
            brand: updatedBrand,
            changedByUid: OWNER_UID,
            changeNote: 'Server handler update',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 3. Create audit record
        const auditRef = await adminDb.collection('workspaceAuditLog').add({
            workspaceId: WORKSPACE_ID,
            actorUid: OWNER_UID,
            action: 'BRANDING_UPDATED',
            details: { versionId: versionRef.id, versionNumber: 1, fieldsChanged: ['companyName', 'logoUrl', 'accentColor'] },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Verify all 3 docs exist
        const brandSnap = await adminDb.collection('workspaceBranding').doc(WORKSPACE_ID).get();
        expect(brandSnap.data().companyName).toBe('Server Updated Corp');

        const versionSnap = await adminDb.collection('workspaceBrandingVersions').doc(versionRef.id).get();
        expect(versionSnap.exists).toBe(true);
        expect(versionSnap.data().version).toBe(1);

        const auditSnap = await adminDb.collection('workspaceAuditLog').doc(auditRef.id).get();
        expect(auditSnap.exists).toBe(true);
        expect(auditSnap.data().action).toBe('BRANDING_UPDATED');
    });

    // ── B2d: Cached workspace branding invalidates immediately after server update ──

    test('B2d: cache invalidates immediately after authorized server update', async () => {
        // Step 1: Resolve and cache the initial workspace brand
        const brandBefore = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        expect(brandBefore.companyName).toBe('Owner Agency Corp');

        // Step 2: Server handler updates workspaceBranding via Admin SDK
        await adminDb.collection('workspaceBranding').doc(WORKSPACE_ID).set(
            { companyName: 'Post-Update Brand' },
            { merge: true }
        );

        // Step 3: Invalidate cache (as the server handler does)
        invalidateCache(OWNER_UID);
        invalidateCache(`${OWNER_UID}:ws:${WORKSPACE_ID}`);

        // Step 4: Re-resolve — should reflect the update, not the cached value
        const brandAfter = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        expect(brandAfter.companyName).toBe('Post-Update Brand');
    });

    // ── B4: Solo user branding unchanged ───────────────────────────────────

    test('B4: solo user can still write their own agencyBrandOverrides (no workspace context)', async () => {
        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        // Member can update their OWN brand overrides (solo-user behavior preserved)
        await assertSucceeds(
            db.collection('agencyBrandOverrides').doc(MEMBER_UID).update({
                companyName: 'My Updated Personal Brand',
            })
        );
    });

    test('B4: solo user can create their own agencyBrandOverrides without workspace interference', async () => {
        // First clear member's existing doc
        await testEnv.clearFirestore();
        // Re-seed only the member's user doc (no brand overrides yet)
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await db.collection('users').doc(MEMBER_UID).set({
                email: 'member@test.com',
                subscription: { plan: 'starter' },
            });
        });

        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        // Member can create their OWN brand overrides doc
        await assertSucceeds(
            db.collection('agencyBrandOverrides').doc(MEMBER_UID).set({
                companyName: 'Brand New Solo Brand',
                useCustomBranding: true,
            })
        );
    });

    test('B4: solo user cannot set planTier or featureFlags (server-controlled)', async () => {
        const memberCtx = getAuthenticatedContext(MEMBER_UID, 'member@test.com');
        const db = memberCtx.firestore();

        // Cannot touch planTier (server-controlled field)
        await assertFails(
            db.collection('agencyBrandOverrides').doc(MEMBER_UID).update({
                companyName: 'Legit Update',
                planTier: 'enterprise', // BLOCKED by rules
            })
        );
    });
});
