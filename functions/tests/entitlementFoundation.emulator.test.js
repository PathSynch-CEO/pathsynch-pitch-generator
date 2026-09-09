'use strict';
jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
jest.mock('../middleware/adminAuth', () => ({ checkIsAdmin: jest.fn(async uid => uid === 'operator') }));
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const fs = require('fs'), path = require('path');
const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(address || '')) throw Error('Local emulator explicitly required');
const projectId = 'demo-entitlement-foundation';
const app = admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();
jest.spyOn(auth, 'getUser').mockImplementation(async uid => ({ uid, emailVerified: true, disabled: uid === 'disabled-auth' }));
jest.spyOn(auth, 'verifyIdToken').mockImplementation(async token => ({ uid: token }));
const { workspaceState, enforceAdmission, writeSnapshot, effectivePlan, displayEntitlements, grantFromAdminRequest } = require('../services/workspaceEntitlements');
const { addMember, reactivateMember } = require('../services/workspaceService');
const { createInvite, acceptInviteByVerifiedEmail } = require('../services/workspaceInviteService');
let env;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: Number(address.split(':')[1]), rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8') } }); });
afterEach(async () => env.clearFirestore());
afterAll(async () => { await env.cleanup(); await app.delete(); });
async function seed(plan = 'scale', count = 1, ws = 'workspace-a') {
  const owner = ws + '-owner';
  await db.collection('users').doc(owner).set({ plan: 'starter' });
  await db.collection('workspaces').doc(ws).set({ ownerId: owner, entitlementOwnerUid: owner, seatLimit: -1, memberCount: 0, memberIds: [owner] });
  await db.collection('teams').doc(owner).set({ ownerUid: owner, memberUids: [owner], members: [] });
  if (plan) await db.collection('accountPlanAssignments').doc(owner).set({ schemaVersion: 1, subjectUid: owner, planId: plan, revision: 1, status: 'active', source: 'operator', actorUid: 'operator', effectiveAt: Timestamp.fromMillis(Date.now() - 1000), expiresAt: null });
  for (let i = 0; i < count; i++) { const uid = i ? ws + '-member-' + i : owner; await db.collection('workspaceMembers').doc(ws + '_' + uid).set({ workspaceId: ws, uid, status: 'active', isWorkspaceOwner: i === 0, role: i === 0 ? 'admin' : 'contributor' }); }
  return owner;
}
const add = (uid, ws = 'workspace-a') => addMember(ws, { uid, role: 'contributor', displayName: 'Fixture', email: 'fixture@example.com' });
test('owner can forge legacy fields but not protected assignments or snapshots', async () => {
  const owner = await seed(); const client = env.authenticatedContext(owner).firestore();
  await assertSucceeds(updateDoc(doc(client, 'users', owner), { plan: 'enterprise', subscription: { plan: 'enterprise' } }));
  await assertSucceeds(updateDoc(doc(client, 'workspaces', 'workspace-a'), { seatLimit: -1, memberCount: -100, entitlementOwnerUid: 'different-owner' }));
  await assertFails(setDoc(doc(client, 'accountPlanAssignments', owner), { planId: 'enterprise' }));
  await assertFails(setDoc(doc(client, 'workspaceEntitlements', 'workspace-a'), { plan_id: 'enterprise' }));
  expect(await effectivePlan(owner, 'workspace-a')).toBe('scale');
});
test('Scale counts the owner, admits seats two through five and rejects six', async () => {
  const owner = await seed();
  for (let i = 2; i <= 5; i++) await add('seat-' + i);
  await expect(add('seat-6')).rejects.toMatchObject({ code: 'TEAM_SEAT_LIMIT_REACHED' });
  const data = await displayEntitlements({ userId: owner, workspaceId: 'workspace-a' });
  expect(data.usage.team_seats).toBe(5); expect(data.team_seats).toEqual({ limit: 5, status: 'limited', unlimited: false });
});
test('Enterprise admits beyond five and never serializes a fake ceiling', async () => {
  const owner = await seed('enterprise'); for (let i = 2; i <= 7; i++) await add('seat-' + i);
  const data = await displayEntitlements({ userId: owner, workspaceId: 'workspace-a' });
  expect(data.usage.team_seats).toBe(7); expect(data.team_seats).toEqual({ limit: null, status: 'unlimited', unlimited: true });
});
test('concurrent last-seat admission has exactly one winner', async () => {
  await seed('scale', 4);
  const outcomes = await Promise.allSettled([add('last-a'), add('last-b')]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find(r => r.status === 'rejected').reason.code).toBe('TEAM_SEAT_LIMIT_REACHED');
});
test('duplicate admission and routing/host roles for one person count once', async () => {
  await seed(); await add('person'); await add('person');
  await db.collection('workspaceMembers').doc('workspace-a_person').update({ routingEnabled: true, bookingEnabled: true });
  const state = await workspaceState(db, null, 'workspace-a'); expect(state.used).toBe(2);
  expect(enforceAdmission(state, 'person')).toBe(false);
});
test('disabled and removed membership do not consume seats; deliberate reactivation consumes one', async () => {
  await seed('scale', 5); const ref = db.collection('workspaceMembers').doc('workspace-a_workspace-a-member-1');
  await ref.update({ status: 'disabled' }); expect((await workspaceState(db, null, 'workspace-a')).used).toBe(4);
  await reactivateMember('workspace-a', 'workspace-a-member-1'); expect((await workspaceState(db, null, 'workspace-a')).used).toBe(5);
  await ref.update({ status: 'removed' }); await add('replacement'); await expect(reactivateMember('workspace-a', 'workspace-a-member-1')).rejects.toMatchObject({ code: 'TEAM_SEAT_LIMIT_REACHED' });
});
test('Firebase disabled user cannot be admitted', async () => { await seed(); await expect(add('disabled-auth')).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' }); });
test('forged workspace selection cannot read another workspace entitlement', async () => {
  const owner = await seed(); await seed('enterprise', 1, 'workspace-b');
  await expect(displayEntitlements({ userId: owner, workspaceId: 'workspace-b' })).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
});
test('stale or forged snapshot is never used as admission authority', async () => {
  await seed('scale', 5);
  await db.collection('workspaceEntitlements').doc('workspace-a').set({ plan_id: 'enterprise', team_seats: { unlimited: true, limit: null }, assignment_revision: 0 });
  await expect(add('extra')).rejects.toMatchObject({ code: 'TEAM_SEAT_LIMIT_REACHED' });
});
for (const plan of [null, 'unknown', 'FREE']) test('unresolved assignment '+String(plan)+' preserves members but rejects new admissions', async () => {
  await seed(plan); const state = await workspaceState(db, null, 'workspace-a'); expect(state.plan).toBeNull();
  await expect(add('extra')).rejects.toMatchObject({ code: 'ENTITLEMENT_UNRESOLVED' });
  expect(enforceAdmission(state, 'workspace-a-owner')).toBe(false);
});
test('known case/whitespace alias normalizes only from protected assignment', async () => { const owner = await seed(' SCALE '); expect(await effectivePlan(owner, 'workspace-a')).toBe('scale'); });
test('future or expired assignment fails closed', async () => {
  const owner = await seed(); const ref = db.collection('accountPlanAssignments').doc(owner);
  await ref.update({ effectiveAt: Timestamp.fromMillis(Date.now() + 60000) }); await expect(add('extra')).rejects.toMatchObject({ code: 'ENTITLEMENT_UNRESOLVED' });
  await ref.update({ effectiveAt: Timestamp.fromMillis(Date.now() - 60000), expiresAt: Timestamp.fromMillis(Date.now() - 1000) }); await expect(add('extra')).rejects.toMatchObject({ code: 'ENTITLEMENT_UNRESOLVED' });
});
test('operator grant is protected, audited and cannot be forged by workspace owner', async () => {
  const owner = await seed(null);
  await expect(grantFromAdminRequest({ headers: { authorization: 'Bearer '+owner } }, owner, 'enterprise', { plan: 'enterprise' })).rejects.toMatchObject({ code: 'OPERATOR_REQUIRED' });
  await grantFromAdminRequest({ headers: { authorization: 'Bearer operator' } }, owner, 'scale', { plan: 'scale' });
  expect(await effectivePlan(owner, 'workspace-a')).toBe('scale');
  expect((await db.collection('accountPlanAssignments').doc(owner).collection('history').get()).size).toBe(1);
});
test('invite acceptance uses canonical limits and invitations do not reserve seats', async () => {
  const owner = await seed('scale', 4);
  const a = await createInvite('workspace-a', owner, 'a@example.com', 'contributor');
  const b = await createInvite('workspace-a', owner, 'b@example.com', 'contributor');
  expect((await workspaceState(db, null, 'workspace-a')).used).toBe(4);
  const result = await Promise.allSettled([acceptInviteByVerifiedEmail(a.invitationId, 'a', 'a@example.com', 'A'), acceptInviteByVerifiedEmail(b.invitationId, 'b', 'b@example.com', 'B')]);
  if (result.every(r => r.status === 'rejected')) throw result[0].reason;
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
});


test('offboarding member is excluded from usage and cannot be readmitted mid-removal', async () => {
  await seed('scale', 5);
  await db.collection('workspaceMembers').doc('workspace-a_workspace-a-member-4').update({ status: 'offboarding' });
  const state = await workspaceState(db, null, 'workspace-a');
  expect(state.used).toBe(4);
  await expect(add('workspace-a-member-4')).rejects.toMatchObject({ code: 'OFFBOARDING_IN_PROGRESS' });
  await add('replacement');
  expect((await workspaceState(db, null, 'workspace-a')).used).toBe(5);
});
test('operator grant rejects unverified, disabled and revoked identities without writes', async () => {
  const owner = await seed(null);
  for (const change of [{ emailVerified: false }, { disabled: true }]) {
    auth.getUser.mockResolvedValueOnce({ uid: 'operator', emailVerified: true, disabled: false, ...change });
    await expect(grantFromAdminRequest({ headers: { authorization: 'Bearer operator' } }, owner, 'enterprise', {})).rejects.toMatchObject({ code: 'OPERATOR_REQUIRED' });
  }
  auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error('Revoked'), { code: 'auth/id-token-revoked' }));
  await expect(grantFromAdminRequest({ headers: { authorization: 'Bearer operator' } }, owner, 'enterprise', {})).rejects.toMatchObject({ code: 'auth/id-token-revoked' });
  expect((await db.collection('accountPlanAssignments').doc(owner).get()).exists).toBe(false);
  expect(auth.verifyIdToken).toHaveBeenCalledWith('operator', true);
});
for (const status of ['disabled', 'removed']) test('canonical Staff role reactivates from '+status+' within the seat pool', async () => {
  await seed('scale', 1);
  await db.collection('workspaceMembers').doc('workspace-a_staff-user').set({workspaceId:'workspace-a',uid:'staff-user',role:'staff',status,isWorkspaceOwner:false});
  await reactivateMember('workspace-a','staff-user');
  const state=await workspaceState(db,null,'workspace-a');expect(state.used).toBe(2);expect(state.members.get('staff-user')).toMatchObject({role:'staff',status:'active'});
});

test('concurrent initial provisioning returns one workspace and one protected owner', async () => {
  const create = require('../services/workspaceService').createWorkspace;
  const results = await Promise.all([create('new-owner', { ownerEmail: 'fixture@example.test' }), create('new-owner', { ownerEmail: 'fixture@example.test' })]);
  expect(results[0].id).toBe(results[1].id);
  expect((await db.collection('workspaces').get()).size).toBe(1);
  expect((await db.collection('workspaceMembers').get()).size).toBe(1);
  expect((await db.collection('teams').doc('new-owner').get()).data().workspaceId).toBe(results[0].id);
});
test('failed owner payload commits no partial workspace and valid retry succeeds', async () => {
  const create = require('../services/workspaceService').createWorkspace;
  await expect(create('new-owner', { ownerEmail: 42 })).rejects.toThrow();
  expect((await db.collection('workspaces').get()).size).toBe(0);
  expect((await db.collection('workspaceMembers').get()).size).toBe(0);
  expect((await db.collection('teams').get()).size).toBe(0);
  const result = await create('new-owner', { ownerEmail: 'fixture@example.test' });
  expect((await db.collection('workspaceMembers').doc(result.id + '_new-owner').get()).data().isWorkspaceOwner).toBe(true);
});
