'use strict';

/**
 * Member Workspace-Context — Firestore Emulator Tests
 *
 * Validates the fix against REAL Firestore (transactions + queries):
 *   - acceptInviteByVerifiedEmail creates membership atomically and mirrors to teams
 *   - resolveWorkspaceContext resolves an active member's owner plan + seller profile
 *   - verified-email auto-accept self-heals a never-accepted invitee
 *   - unverified email and expired invites are NOT auto-accepted
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest tests/memberContext.emulator.test.js --config jest.emulator.config.js --forceExit
 */

jest.unmock('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

const PROJECT_ID = 'membercontext-emulator-test';

const admin = require('firebase-admin');
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const adminDb = admin.firestore();

const { acceptInviteByVerifiedEmail } = require('../services/workspaceInviteService');
const { resolveWorkspaceContext } = require('../services/memberContextService');

let testEnv;

const WORKSPACE_ID = 'ws_mc_emu';
const OWNER_UID = 'owner_mc_emu';
const OWNER_EMAIL = 'owner@test.com';
const MEMBER_UID = 'member_mc_emu';
const MEMBER_EMAIL = 'member@test.com';
const OWNER_SELLER_PROFILE = { companyProfile: { companyName: 'Owner Co' }, profileCompleteness: 95 };

beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: 8080 },
    });
}, 30000);

afterAll(async () => { if (testEnv) await testEnv.cleanup(); }, 10000);
afterEach(async () => { if (testEnv) await testEnv.clearFirestore(); }, 10000);

async function seedWorkspaceAndOwner() {
    await adminDb.collection('workspaces').doc(WORKSPACE_ID).set({
        ownerId: OWNER_UID, entitlementOwnerUid: OWNER_UID, name: "Owner's Workspace",
        memberIds: [OWNER_UID], memberCount: 1, seatLimit: 5,
    });
    await adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${OWNER_UID}`).set({
        workspaceId: WORKSPACE_ID, uid: OWNER_UID, email: OWNER_EMAIL,
        role: 'admin', isWorkspaceOwner: true, status: 'active',
    });
    await adminDb.collection('teams').doc(OWNER_UID).set({
        ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL, memberUids: [OWNER_UID],
        members: [{ uid: OWNER_UID, email: OWNER_EMAIL, role: 'admin', status: 'active' }],
        createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now(),
    });
    await adminDb.collection('users').doc(OWNER_UID).set({
        email: OWNER_EMAIL, displayName: 'Owner User',
        plan: 'enterprise', tier: 'enterprise',
        subscription: { plan: 'enterprise', tier: 'enterprise' },
        sellerProfile: OWNER_SELLER_PROFILE,
    });
    await adminDb.collection('users').doc(MEMBER_UID).set({
        email: MEMBER_EMAIL, displayName: 'Member User', tier: 'FREE',
    });
}

function offsetTimestamp(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return admin.firestore.Timestamp.fromDate(d);
}

async function seedInvite(id, { email = MEMBER_EMAIL, days = 5, status = 'pending' } = {}) {
    await adminDb.collection('teamInvitations').doc(id).set({
        teamOwnerUid: OWNER_UID, inviteeEmail: email, role: 'contributor', status,
        createdAt: offsetTimestamp(-1), expiresAt: offsetTimestamp(days),
        acceptedAt: null, acceptedByUid: null, tokenHash: 'h_' + id,
        workspaceId: WORKSPACE_ID, inviterUid: OWNER_UID,
    });
}

describe('acceptInviteByVerifiedEmail (emulator)', () => {
    test('creates active membership and mirrors to teams', async () => {
        await seedWorkspaceAndOwner();
        await seedInvite('inv1');

        const result = await acceptInviteByVerifiedEmail('inv1', MEMBER_UID, MEMBER_EMAIL, 'Member User');
        expect(result.workspaceId).toBe(WORKSPACE_ID);

        const member = await adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${MEMBER_UID}`).get();
        expect(member.exists).toBe(true);
        expect(member.data().status).toBe('active');
        expect(member.data().joinMethod).toBe('verified-email');

        const team = await adminDb.collection('teams').doc(OWNER_UID).get();
        expect(team.data().memberUids).toContain(MEMBER_UID);

        const invite = await adminDb.collection('teamInvitations').doc('inv1').get();
        expect(invite.data().status).toBe('accepted');
        expect(invite.data().acceptedVia).toBe('verified-email');
    });

    test('rejects when email does not match', async () => {
        await seedWorkspaceAndOwner();
        await seedInvite('inv1', { email: MEMBER_EMAIL });
        await expect(
            acceptInviteByVerifiedEmail('inv1', 'someone', 'other@test.com', 'Other')
        ).rejects.toThrow(/does not match/i);
    });
});

describe('resolveWorkspaceContext (emulator)', () => {
    test('active member inherits owner plan + seller profile', async () => {
        await seedWorkspaceAndOwner();
        await adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${MEMBER_UID}`).set({
            workspaceId: WORKSPACE_ID, uid: MEMBER_UID, email: MEMBER_EMAIL,
            role: 'contributor', isWorkspaceOwner: false, status: 'active',
        });

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });
        expect(ctx.isWorkspaceMember).toBe(true);
        expect(ctx.plan).toBe('enterprise');
        expect(ctx.sellerProfile).toEqual(OWNER_SELLER_PROFILE);
        expect(ctx.role).toBe('contributor');
    });

    test('verified-email invitee is auto-accepted and inherits owner plan', async () => {
        await seedWorkspaceAndOwner();
        await seedInvite('inv1');

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });
        expect(ctx.autoAccepted).toBe(true);
        expect(ctx.isWorkspaceMember).toBe(true);
        expect(ctx.plan).toBe('enterprise');

        const member = await adminDb.collection('workspaceMembers').doc(`${WORKSPACE_ID}_${MEMBER_UID}`).get();
        expect(member.exists).toBe(true);
    });

    test('does NOT auto-accept when email unverified', async () => {
        await seedWorkspaceAndOwner();
        await seedInvite('inv1');

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: false });
        expect(ctx.autoAccepted).toBe(false);
        expect(ctx.isWorkspaceMember).toBe(false);
        expect(ctx.plan).toBeNull();
    });

    test('does NOT auto-accept an expired invite', async () => {
        await seedWorkspaceAndOwner();
        await seedInvite('inv1', { days: -1 });

        const ctx = await resolveWorkspaceContext(MEMBER_UID, { email: MEMBER_EMAIL, emailVerified: true });
        expect(ctx.autoAccepted).toBe(false);
        expect(ctx.isWorkspaceMember).toBe(false);
    });
});
