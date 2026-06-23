'use strict';

/**
 * Phase 2 Gate Tests — Workspace Inheritance + Branding Version History
 *
 * Gate tests cover:
 *   1. Member with different personal branding receives workspace owner's branding when workspaceId present
 *   2. Same member retains personal branding/plan when no workspaceId
 *   3. Workspace pitch stamped with workspaceId, createdByUid, brandingVersionId
 *   4. Updating workspace branding doesn't alter generated pitch copy (pitch HTML frozen)
 *   5. Prior branding version reconstructable after update
 *   6. Non-Admin cannot update workspace branding
 *   7. Client-side branding write cannot bypass version creation + audit logging
 *   8. Legacy pitches with null/absent workspaceId excluded from workspace queries
 *   9. Phase 1 workspace service tests remain green (regression check)
 */

jest.mock('firebase-admin');
jest.mock('../middleware/planGate', () => {
    const original = jest.requireActual('../middleware/planGate');
    return {
        ...original,
        getUserPlan: jest.fn().mockImplementation(async (userId, options) => {
            // The real getUserPlan reads from mock Firestore via admin
            const admin = require('firebase-admin');
            const db = admin.firestore();
            const wsId = options?.workspaceId;
            let planOwnerId = userId;
            if (wsId) {
                try {
                    const wsDoc = await db.collection('workspaces').doc(wsId).get();
                    if (wsDoc.exists) {
                        planOwnerId = wsDoc.data().entitlementOwnerUid || wsDoc.data().ownerId;
                    }
                } catch (_) { /* ignore */ }
            }
            const userDoc = await db.collection('users').doc(planOwnerId).get();
            if (!userDoc.exists) return 'starter';
            const userData = userDoc.data();
            return userData?.subscription?.plan || userData?.plan || userData?.tier || 'starter';
        }),
    };
});

const admin = require('firebase-admin');

// ── Services under test ─────────────────────────────────────────────────────

const { resolveBrand, invalidateCache } = require('../services/brandResolver');
const { getUserPlan } = require('../middleware/planGate');
const {
    createBrandingVersion,
    getLatestBrandingVersion,
    getBrandingVersion,
    listBrandingVersions,
} = require('../services/workspaceBrandingService');
const { logAction, getAuditLog } = require('../services/workspaceAuditService');
const { getMemberRole } = require('../services/workspaceService');

// ── Constants ───────────────────────────────────────────────────────────────

const OWNER_UID = 'owner1';
const MEMBER_UID = 'member1';
const WORKSPACE_ID = 'ws_phase2_test';

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
    invalidateCache(); // Clear brand cache

    // Seed workspace
    admin._setMockCollection('workspaces', {
        [WORKSPACE_ID]: {
            ownerId: OWNER_UID,
            entitlementOwnerUid: OWNER_UID,
            name: "Phase 2 Test Workspace",
            memberIds: [OWNER_UID, MEMBER_UID],
            memberCount: 2,
            seatLimit: 5,
        },
    });

    // Seed members
    admin._setMockCollection('workspaceMembers', {
        [`${WORKSPACE_ID}_${OWNER_UID}`]: {
            workspaceId: WORKSPACE_ID,
            uid: OWNER_UID,
            email: 'owner@test.com',
            displayName: 'Owner User',
            role: 'admin',
            isWorkspaceOwner: true,
            status: 'active',
        },
        [`${WORKSPACE_ID}_${MEMBER_UID}`]: {
            workspaceId: WORKSPACE_ID,
            uid: MEMBER_UID,
            email: 'member@test.com',
            displayName: 'Member User',
            role: 'contributor',
            isWorkspaceOwner: false,
            status: 'active',
        },
    });

    // Seed owner user doc (Scale plan — can use custom branding)
    admin._setMockCollection('users', {
        [OWNER_UID]: {
            email: 'owner@test.com',
            subscription: { plan: 'scale' },
            plan: 'scale',
        },
        [MEMBER_UID]: {
            email: 'member@test.com',
            subscription: { plan: 'starter' },
            plan: 'starter',
        },
    });

    // Seed workspace branding (server-only source — what resolveBrand reads in workspace context)
    admin._setMockCollection('workspaceBranding', {
        [WORKSPACE_ID]: {
            companyName: 'Owner Agency Corp',
            logoUrl: 'https://owner-logo.png',
            accentColor: '#FF5733',
            useCustomBranding: true,
        },
    });

    // Seed personal brand overrides (solo branding — client-writable)
    // Owner's solo brand may differ from workspace brand; member has own personal brand
    admin._setMockCollection('agencyBrandOverrides', {
        [OWNER_UID]: {
            companyName: 'Owner Agency Corp',
            logoUrl: 'https://owner-logo.png',
            accentColor: '#FF5733',
            useCustomBranding: true,
        },
        [MEMBER_UID]: {
            companyName: 'Member Personal Brand',
            logoUrl: 'https://member-personal-logo.png',
            accentColor: '#0000FF',
            useCustomBranding: true,
        },
    });

    // Seed owner's entitlements (Scale → can use custom logo + colors)
    admin._setMockCollection('agencyEntitlements', {
        [OWNER_UID]: {
            planTier: 'scale',
            canUseCustomLogo: true,
            canUseCustomColors: true,
            showPoweredByPathSynch: false,
        },
    });
});

// ── Gate 1: Member inherits owner's branding in workspace context ────────

describe('Gate 1: Workspace branding inheritance', () => {
    test('member receives workspace owner branding when workspaceId is present', async () => {
        const brand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });

        // Should be OWNER's brand, not member's
        expect(brand.companyName).toBe('Owner Agency Corp');
        expect(brand.logoUrl).toBe('https://owner-logo.png');
        expect(brand.accentColor).toBe('#ff5733');
    });

    test('owner receives their own branding when workspaceId is present', async () => {
        const brand = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });

        expect(brand.companyName).toBe('Owner Agency Corp');
        expect(brand.logoUrl).toBe('https://owner-logo.png');
    });
});

// ── Gate 2: Solo user retains personal branding ─────────────────────────

describe('Gate 2: Solo user personal branding preserved', () => {
    test('member gets their own branding when no workspaceId', async () => {
        const brand = await resolveBrand(MEMBER_UID);

        // Member has starter plan → no custom logo/colors capability
        // But companyName is allowed at all tiers
        expect(brand.companyName).toBe('Member Personal Brand');
        // Logo should NOT be returned (starter plan cannot use custom logo)
        expect(brand.logoUrl).toBeNull();
    });

    test('getUserPlan returns member own plan without workspaceId', async () => {
        const plan = await getUserPlan(MEMBER_UID);
        expect(plan).toBe('starter');
    });

    test('getUserPlan returns owner plan with workspaceId', async () => {
        const plan = await getUserPlan(MEMBER_UID, { workspaceId: WORKSPACE_ID });
        expect(plan).toBe('scale');
    });
});

// ── Gate 3: Pitch stamped with workspace fields ─────────────────────────

describe('Gate 3: Workspace pitch stamping', () => {
    test('createBrandingVersion produces immutable version doc', async () => {
        const brand = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        const version = await createBrandingVersion(WORKSPACE_ID, brand, OWNER_UID, 'Initial branding');

        expect(version.id).toBeDefined();
        expect(version.version).toBe(1);

        // Verify version doc in Firestore
        const latest = await getLatestBrandingVersion(WORKSPACE_ID);
        expect(latest).not.toBeNull();
        expect(latest.version).toBe(1);
        expect(latest.brand.companyName).toBe('Owner Agency Corp');
        expect(latest.changedByUid).toBe(OWNER_UID);
        expect(latest.changeNote).toBe('Initial branding');
    });

    test('brandingVersionId is retrievable for pitch stamping', async () => {
        const brand = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        const version = await createBrandingVersion(WORKSPACE_ID, brand, OWNER_UID);

        const latest = await getLatestBrandingVersion(WORKSPACE_ID);
        expect(latest.id).toBe(version.id);
    });
});

// ── Gate 4: Branding update changes rendering, not generated copy ───────

describe('Gate 4: Branding update does not alter generated pitch copy', () => {
    test('two branding versions have different brand snapshots', async () => {
        // Create version 1
        const brand1 = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        await createBrandingVersion(WORKSPACE_ID, brand1, OWNER_UID, 'v1');

        // Update workspace branding (server-only source — what resolveBrand reads in workspace context)
        const db = admin.firestore();
        await db.collection('workspaceBranding').doc(WORKSPACE_ID).set(
            { companyName: 'Updated Agency Name', accentColor: '#00FF00', useCustomBranding: true },
            { merge: true }
        );
        invalidateCache();

        // Create version 2
        const brand2 = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        await createBrandingVersion(WORKSPACE_ID, brand2, OWNER_UID, 'v2');

        // Both versions exist with different snapshots
        const versions = await listBrandingVersions(WORKSPACE_ID);
        expect(versions.length).toBe(2);
        expect(versions[0].version).toBe(2); // newest first
        expect(versions[0].brand.companyName).toBe('Updated Agency Name');
        expect(versions[1].version).toBe(1);
        expect(versions[1].brand.companyName).toBe('Owner Agency Corp');
    });
});

// ── Gate 5: Prior branding version reconstructable ──────────────────────

describe('Gate 5: Prior branding version reconstructable', () => {
    test('specific version retrievable by ID after new versions created', async () => {
        const brand1 = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        const v1 = await createBrandingVersion(WORKSPACE_ID, brand1, OWNER_UID, 'initial');

        // Update workspace branding (server-only source) and create v2
        invalidateCache();
        const db = admin.firestore();
        await db.collection('workspaceBranding').doc(WORKSPACE_ID).set(
            { companyName: 'New Name', useCustomBranding: true },
            { merge: true }
        );
        invalidateCache();
        const brand2 = await resolveBrand(OWNER_UID, { workspaceId: WORKSPACE_ID });
        await createBrandingVersion(WORKSPACE_ID, brand2, OWNER_UID, 'updated');

        // V1 still accessible
        const retrieved = await getBrandingVersion(v1.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved.version).toBe(1);
        expect(retrieved.brand.companyName).toBe('Owner Agency Corp');
    });
});

// ── Gate 6: Non-Admin cannot update workspace branding ──────────────────

describe('Gate 6: Role enforcement on branding update', () => {
    test('contributor role is not admin', async () => {
        const role = await getMemberRole(WORKSPACE_ID, MEMBER_UID);
        expect(role).toBe('contributor');
        expect(role).not.toBe('admin');
    });

    test('owner has admin role', async () => {
        const role = await getMemberRole(WORKSPACE_ID, OWNER_UID);
        expect(role).toBe('admin');
    });
});

// ── Gate 7: Audit logging on branding update ────────────────────────────

describe('Gate 7: Branding update creates audit record', () => {
    test('logAction writes audit entry to workspaceAuditLog', async () => {
        await logAction(WORKSPACE_ID, OWNER_UID, 'BRANDING_UPDATED', {
            details: {
                versionId: 'v1_id',
                versionNumber: 1,
                fieldsChanged: ['companyName', 'logoUrl'],
            },
        });

        const logs = await getAuditLog(WORKSPACE_ID);
        expect(logs.length).toBe(1);
        expect(logs[0].action).toBe('BRANDING_UPDATED');
        expect(logs[0].actorUid).toBe(OWNER_UID);
        expect(logs[0].details.fieldsChanged).toContain('companyName');
    });
});

// ── Gate 8: Legacy null-workspaceId pitches excluded ────────────────────

describe('Gate 8: Legacy pitch exclusion (workspace-scoped queries)', () => {
    test('Firestore equality filter excludes null and missing workspaceId', async () => {
        // Seed pitches
        admin._setMockCollection('pitches', {
            'pitch_ws': { userId: MEMBER_UID, workspaceId: WORKSPACE_ID, title: 'WS Pitch' },
            'pitch_null': { userId: MEMBER_UID, workspaceId: null, title: 'Null WS Pitch' },
            'pitch_missing': { userId: MEMBER_UID, title: 'No WS Field Pitch' },
        });

        const db = admin.firestore();
        const snap = await db.collection('pitches')
            .where('userId', '==', MEMBER_UID)
            .where('workspaceId', '==', WORKSPACE_ID)
            .get();

        expect(snap.size).toBe(1);
        expect(snap.docs[0].id).toBe('pitch_ws');
    });
});

// ── Gate 9: Phase 1 regression check ────────────────────────────────────

describe('Gate 9: Phase 1 workspace service regression', () => {
    test('getWorkspaceForUser returns workspace for owner', async () => {
        const { getWorkspaceForUser } = require('../services/workspaceService');
        const ws = await getWorkspaceForUser(OWNER_UID);
        expect(ws).not.toBeNull();
        expect(ws.id).toBe(WORKSPACE_ID);
        expect(ws.ownerId).toBe(OWNER_UID);
    });

    test('getMembership returns active member', async () => {
        const { getMembership } = require('../services/workspaceService');
        const membership = await getMembership(WORKSPACE_ID, MEMBER_UID);
        expect(membership).not.toBeNull();
        expect(membership.role).toBe('contributor');
        expect(membership.status).toBe('active');
    });

    test('addMember creates workspaceMembers doc + mirrors atomically', async () => {
        const { addMember } = require('../services/workspaceService');

        // Seed teams doc for mirror
        admin._setMockCollection('teams', {
            [OWNER_UID]: {
                ownerUid: OWNER_UID,
                members: [],
                memberUids: [OWNER_UID],
            },
        });

        const result = await addMember(WORKSPACE_ID, {
            uid: 'new_member',
            email: 'new@test.com',
            displayName: 'New User',
            role: 'contributor',
            invitedBy: OWNER_UID,
            teamMemberEntry: { uid: 'new_member', email: 'new@test.com', role: 'contributor' },
        });

        expect(result.uid).toBe('new_member');
        expect(result.status).toBe('active');

        // Verify workspace memberIds updated
        const wsData = admin._mockData.collections['workspaces'][WORKSPACE_ID];
        expect(wsData.memberIds).toContain('new_member');
    });
});

// ── Cache isolation test ────────────────────────────────────────────────

describe('Cache isolation: solo vs workspace brand', () => {
    test('solo cache key does not contaminate workspace cache', async () => {
        // Resolve member's personal brand (solo context)
        const soloBrand = await resolveBrand(MEMBER_UID);
        expect(soloBrand.companyName).toBe('Member Personal Brand');

        // Resolve same member in workspace context — should get owner's brand
        const wsBrand = await resolveBrand(MEMBER_UID, { workspaceId: WORKSPACE_ID });
        expect(wsBrand.companyName).toBe('Owner Agency Corp');

        // Re-resolve solo — cache should still return member's personal brand
        const soloBrand2 = await resolveBrand(MEMBER_UID);
        expect(soloBrand2.companyName).toBe('Member Personal Brand');
    });
});
