'use strict';
jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn(() => { throw new Error('Email delivery forbidden in emulator tests'); }) }));
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { doc, setDoc } = require('firebase/firestore');
const { writeReportAndReceipt, persistRefresh: persistRefreshRaw } = require('../services/reportActivityPersistence');
// Explicit fixture quota; production callers must supply server-resolved policy.
const persistRefresh = (db, ref, generated, req, operationId, quota = { limit: 20 }) => persistRefreshRaw(db, ref, generated, req, operationId, quota);
const { recordLogin, eventId } = require('../services/operationalActivity');
const { projectActivity } = require('../services/activityAnalytics');
const hostPort = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!/^127\.0\.0\.1:\d+$/.test(hostPort)) throw new Error('Local emulator required');
process.env.FIRESTORE_EMULATOR_HOST = hostPort;
const projectId = 'demo-phase1-activity';
const app = admin.initializeApp({ projectId }, 'phase1-activity-emulator');
const db = getFirestore(app);
const defaultApp = admin.initializeApp({ projectId });
let env;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: Number(hostPort.split(':')[1]), rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') } }); });
afterEach(async () => env.clearFirestore());
afterAll(async () => { if (env) await env.cleanup(); await app.delete(); await defaultApp.delete(); });
const req = { userId: 'creator', workspaceId: 'workspace-a', workspaceRole: 'admin' };
const source = () => ({ userId: 'creator', createdByUid: 'creator', workspaceId: 'workspace-a', createdAt: FieldValue.serverTimestamp() });
test('browser cannot forge an operational receipt in the existing feed', async () => {
  await assertFails(setDoc(doc(env.authenticatedContext('creator').firestore(), 'users/creator/activityFeed/forged'), { schemaVersion: 2, userId: 'creator', eventType: 'market_report_created' }));
});
test('new report and receipt commit together and project only once', async () => {
  const ref = db.collection('marketReports').doc('fixture-report');
  await db.runTransaction(async tx => writeReportAndReceipt(tx, db, ref, source(), req));
  const saved = await ref.get(); const receipt = await db.collection('users').doc('creator').collection('activityFeed').get();
  expect(saved.exists).toBe(true); expect(receipt.size).toBe(1);
  const out = projectActivity({ req, memberships: [{ uid: 'creator', status: 'active', role: 'admin' }], reports: [{ ...saved.data(), id: saved.id }], events: receipt.docs.map(d => ({ ...d.data(), id: d.id })), identities: new Map([['creator', { displayName: 'Fixture' }]]), from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 10000) });
  expect(out.entries).toHaveLength(1); expect(out.members[0].reportCount).toBe(1); expect(out.members[0].verifiedReportCount).toBe(1);
});
test('aborted transaction leaves neither report nor receipt', async () => {
  const ref = db.collection('marketReports').doc('aborted');
  await expect(db.runTransaction(async tx => { writeReportAndReceipt(tx, db, ref, source(), req); throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
  expect((await ref.get()).exists).toBe(false); expect((await db.collection('users').doc('creator').collection('activityFeed').get()).size).toBe(0);
});
test('parallel login callbacks create exactly one protected event', async () => {
  const args = { userId: 'creator', workspaceId: 'workspace-a', authTime: Math.floor(Date.now() / 1000) };
  const results = await Promise.all([recordLogin(db, args), recordLogin(db, args), recordLogin(db, args)]);
  expect(results.filter(Boolean)).toHaveLength(1); expect((await db.collection('users').doc('creator').collection('activityFeed').get()).size).toBe(1);
});
test('one sign-in in two workspaces stays separately scoped', async () => {
  const args = { userId: 'creator', workspaceId: 'workspace-a', authTime: Math.floor(Date.now() / 1000) };
  await recordLogin(db, args); await recordLogin(db, { ...args, workspaceId: 'workspace-b' });
  expect(eventId('user_login', 'creator', 'workspace-a', String(args.authTime))).not.toBe(eventId('user_login', 'creator', 'workspace-b', String(args.authTime)));
});
test('manager refresh retains original creator and original creation time', async () => {
  const ref = db.collection('marketReports').doc('refresh'); const original = new Date('2026-01-01T00:00:00Z');
  await ref.set({ ...source(), createdAt: original });
  await persistRefresh(db, ref, { userId: 'manager', createdByUid: 'manager', workspaceId: 'workspace-a', createdAt: new Date() }, { ...req, userId: 'manager', workspaceRole: 'manager' });
  const data = (await ref.get()).data(); expect(data.userId).toBe('creator'); expect(data.createdByUid).toBe('creator'); expect(data.createdAt.toDate()).toEqual(original); expect(data.refreshedByUid).toBe('manager');
});
test('refresh receipts distinguish operations and deduplicate parallel persistence retries', async () => {
  const ref = db.collection('marketReports').doc('retry-refresh');
  const original = new Date('2026-01-01T00:00:00Z');
  await ref.set({ ...source(), createdAt: original, revision: 0 });
  const manager = { ...req, userId: 'manager', workspaceRole: 'manager' };
  await Promise.all([1, 2, 3].map(() => persistRefresh(db, ref, { revision: 1 }, manager, 'operation-one')));
  let events = await db.collection('users').doc('manager').collection('activityFeed').get();
  expect(events.size).toBe(1);
  const event = events.docs[0].data();
  expect(event).toMatchObject({ eventType: 'market_report_refreshed', userId: 'manager', subjectUserId: 'creator', workspaceId: 'workspace-a', entityId: ref.id });
  expect(event.createdAt.toDate()).toBeInstanceOf(Date);
  await persistRefresh(db, ref, { revision: 2 }, manager, 'operation-two');
  await persistRefresh(db, ref, { revision: 999 }, manager, 'operation-one');
  events = await db.collection('users').doc('manager').collection('activityFeed').get();
  expect(events.size).toBe(2);
  const saved = (await ref.get()).data();
  expect(saved.revision).toBe(2);
  expect(saved.createdAt.toDate()).toEqual(original);
  expect(saved.userId).toBe('creator'); expect(saved.createdByUid).toBe('creator');
});

test('refresh quota commits once per operation and rejects concurrent final-credit races', async () => {
  const ref = db.collection('marketReports').doc('quota-refresh');
  await ref.set({ ...source(), revision: 0 });
  const now = new Date(); const period = now.getFullYear() + '_' + String(now.getMonth() + 1).padStart(2, '0');
  const usage = db.collection('usage').doc('creator_' + period.replace('_', '-'));
  await usage.set({ marketReportsThisMonth: 1 });
  const results = await Promise.allSettled(['quota-a', 'quota-b'].map(operation => persistRefresh(db, ref, { revision: 1 }, req, operation, { limit: 2 })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.message).toBe('LIMIT_REACHED');
  const success = results.find(r => r.status === 'fulfilled').value;
  expect(success.creditInfo).toEqual({ used: 2, limit: 2, unlimited: false });
  expect((await usage.get()).data().marketReportsThisMonth).toBe(2);
  const receipt = await db.collection('users').doc('creator').collection('activityFeed').get();
  expect(receipt.size).toBe(1);
  const winner = results[0].status === 'fulfilled' ? 'quota-a' : 'quota-b';
  const repeated = await persistRefresh(db, ref, { revision: 999 }, req, winner, { limit: 2 });
  expect(repeated.creditInfo.used).toBe(2);
  expect((await ref.get()).data().revision).toBe(1);
  expect((await usage.get()).data().marketReportsThisMonth).toBe(2);
});

test('unlimited refresh still records usage and charges the actor rather than the report subject', async () => {
  const ref = db.collection('marketReports').doc('unlimited-refresh'); await ref.set(source());
  const manager = { ...req, userId: 'manager', workspaceRole: 'manager' };
  const saved = await persistRefresh(db, ref, { revision: 1 }, manager, 'unlimited-a', { limit: -1 });
  expect(saved.creditInfo).toEqual({ used: 1, limit: -1, unlimited: true });
  expect((await db.collection('usage').get()).docs.map(d => d.id.split('_')[0])).toEqual(['manager']);
});

test('failed refresh transaction commits neither report nor receipt', async () => {
  const ref = db.collection('marketReports').doc('failed-refresh');
  await ref.set({ ...source(), revision: 0 });
  const aborting = { runTransaction: callback => db.runTransaction(async tx => { await callback(tx); throw new Error('fixture abort'); }), collection: name => db.collection(name) };
  await expect(persistRefresh(aborting, ref, { revision: 1 }, req, 'aborted-operation')).rejects.toThrow('fixture abort');
  expect((await ref.get()).data().revision).toBe(0);
  expect((await db.collection('usage').get()).empty).toBe(true);
  expect((await db.collection('users').doc('creator').collection('activityFeed').get()).empty).toBe(true);
});

test.each([{ workspaceId: 'workspace-b' }, { workspaceId: null }, { userId: 'outsider', workspaceRole: 'contributor' }])('refresh fails closed for changed or unauthorized scope %s', async extra => {
  const ref = db.collection('marketReports').doc('scope'); await ref.set(source());
  await expect(persistRefresh(db, ref, source(), { ...req, ...extra })).rejects.toThrow();
});
test('deleted source cannot be resurrected by an in-flight refresh', async () => {
  const ref = db.collection('marketReports').doc('deleted'); await ref.set({ ...source(), deletedAt: new Date() });
  await expect(persistRefresh(db, ref, source(), req)).rejects.toThrow('Report deleted');
});
test('notification retention query cannot delete durable operational receipts', async () => {
  await recordLogin(db, { userId: 'creator', workspaceId: 'workspace-a', authTime: 1000000000 });
  const oldNotifications = await db.collection('users').doc('creator').collection('activityFeed').where('timestamp', '<', new Date('2100-01-01')).get();
  expect(oldNotifications.empty).toBe(true);
});

test('actual notification feed, digest summaries and cleanup ignore operational receipts', async () => {
  const notifications = require('../services/activityService');
  const digest = require('../scheduled/emailDigest');
  const dateKey = new Date().toISOString().slice(0, 10);
  const feed = db.collection('users').doc('creator').collection('activityFeed');
  await feed.doc('current-notification').set({ timestamp: new Date(), dateKey, type: 'view', pitchId: 'fixture-pitch', prospectBusiness: 'Fixture', isRead: false });
  await feed.doc('expired-notification').set({ timestamp: new Date('2000-01-01'), dateKey: '2000-01-01', type: 'share', pitchId: 'fixture-old', prospectBusiness: 'Fixture' });
  await recordLogin(db, { userId: 'creator', workspaceId: 'workspace-a', authTime: 1000000000 });
  const ref = db.collection('marketReports').doc('notification-boundary');
  await db.runTransaction(async tx => writeReportAndReceipt(tx, db, ref, source(), req));
  await persistRefresh(db, ref, source(), req);
  const receiptsBefore = (await feed.get()).docs.filter(d => d.data().schemaVersion === 2).map(d => d.id).sort();
  expect(receiptsBefore).toHaveLength(3);
  expect((await notifications.getActivityFeed('creator')).map(e => e.id).sort()).toEqual(['current-notification', 'expired-notification']);
  for (const summary of [await notifications.getDailySummary('creator', dateKey), await notifications.getWeeklySummary('creator'), await digest.getDailyActivitySummary('creator', dateKey), await digest.getWeeklyActivitySummary('creator')]) {
    expect(summary.totalViews).toBe(1); expect(summary.totalShares).toBe(0);
    expect(Object.keys(summary.topPitches)).toEqual(['fixture-pitch']);
  }
  expect(await notifications.cleanupOldActivities('creator')).toBe(1);
  const remaining = await feed.get();
  expect(remaining.docs.filter(d => d.data().schemaVersion === 2).map(d => d.id).sort()).toEqual(receiptsBefore);
  expect((await feed.doc('expired-notification').get()).exists).toBe(false);
  expect(require('@sendgrid/mail').send).not.toHaveBeenCalled();
});

// Real local HTTP dispatch + real workspace resolution/Firestore. Firebase Auth
// verification uses dedicated fixture identities; never a production token.
test('authenticated HTTP activity routes resolve live membership and persist login', async () => {
 const express = require('express'); const http = require('node:http');
 const { resolveWorkspace } = require('../middleware/workspaceResolver');
 const userRoutes = require('../routes/userRoutes'); const analyticsRoutes = require('../routes/analyticsRoutes');
 const identity = admin.auth();
 const getUser = jest.spyOn(identity, 'getUser').mockImplementation(async uid => ({ uid, disabled: false, metadata: { lastSignInTime: '2026-08-01T00:00:00Z' } }));
 const getUsers = jest.spyOn(identity, 'getUsers').mockImplementation(async ids => ({ users: ids.map(({ uid }) => ({ uid, displayName: 'Fixture', metadata: {} })) }));
 const verify = jest.spyOn(identity, 'verifyIdToken').mockResolvedValue({ uid: 'creator', auth_time: 1785542400 });
 await db.collection('workspaces').doc('workspace-a').set({ ownerId: 'workspace-owner' });
 await db.collection('workspaceMembers').doc('workspace-a_creator').set({ uid: 'creator', workspaceId: 'workspace-a', role: 'contributor', status: 'active' });
 await db.collection('workspaceMembers').doc('workspace-a_peer').set({ uid: 'peer', workspaceId: 'workspace-a', role: 'contributor', status: 'active' });
 await db.collection('marketReports').doc('own').set(source());
 await db.collection('marketReports').doc('peer').set({ ...source(), userId: 'peer', createdByUid: 'peer' });
 const api = express(); api.use(express.json());
 api.use(async (req, res) => {
   req.userId = req.headers.authorization ? 'creator' : null;
   try { await resolveWorkspace(req); if (await userRoutes.handle(req, res)) return; if (await analyticsRoutes.handle(req, res)) return; res.sendStatus(404); }
   catch (error) { res.status(error.statusCode || 500).json({ error: error.code }); }
 });
 const server = await new Promise(resolve => { const instance = api.listen(0, '127.0.0.1', () => resolve(instance)); });
 function request(path, method = 'GET', headers = { authorization: 'Bearer fixture-only' }) {
   return new Promise((resolve, reject) => { const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, res => { let body = ''; res.on('data', part => body += part); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })); }); r.on('error', reject); r.end(); });
 }
 try {
  const login = await request('/me/activity/login', 'POST'); expect(login.status).toBe(200); expect(verify).toHaveBeenCalledWith('fixture-only', true);
  const activity = await request('/analytics/activity?days=30'); expect(activity.status).toBe(200); expect(activity.body.data.scope).toBe('self'); expect(activity.body.data.members.map(m => m.uid)).toEqual(['creator']); expect(activity.body.data.members[0].reportCount).toBe(1);
  expect((await request('/analytics/activity', 'GET', {})).status).toBe(401);
  expect((await request('/analytics/activity', 'GET', { authorization: 'Bearer fixture-only', 'x-workspace-id': 'workspace-b' })).status).toBe(403);
  const countBeforeInvalid = (await db.collection('users').doc('creator').collection('activityFeed').get()).size;
  for (const code of ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-not-found']) {
    verify.mockRejectedValueOnce(Object.assign(new Error('fixture rejected token'), { code }));
    expect((await request('/me/activity/login', 'POST')).status).toBe(401);
  }
  verify.mockRejectedValueOnce(Object.assign(new Error('fixture disabled account'), { code: 'auth/user-disabled' }));
  expect((await request('/me/activity/login', 'POST')).status).toBe(403);
  verify.mockRejectedValueOnce(Object.assign(new Error('fixture provider unavailable'), { code: 'auth/internal-error' }));
  expect((await request('/me/activity/login', 'POST')).status).toBe(503);
  expect((await db.collection('users').doc('creator').collection('activityFeed').get()).size).toBe(countBeforeInvalid);
  getUser.mockResolvedValue({ uid: 'creator', disabled: true }); expect((await request('/analytics/activity')).status).toBe(403);
  expect((await request('/me/activity/login', 'POST')).status).toBe(403);
 } finally { await new Promise(resolve => server.close(resolve)); getUser.mockRestore(); getUsers.mockRestore(); verify.mockRestore(); }
}, 60000);
