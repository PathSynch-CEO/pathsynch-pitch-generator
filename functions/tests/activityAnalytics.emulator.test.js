'use strict';
jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { doc, setDoc } = require('firebase/firestore');
const { writeReportAndReceipt, persistRefresh } = require('../services/reportActivityPersistence');
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
  getUser.mockResolvedValue({ uid: 'creator', disabled: true }); expect((await request('/analytics/activity')).status).toBe(403);
  expect((await request('/me/activity/login', 'POST')).status).toBe(403);
 } finally { await new Promise(resolve => server.close(resolve)); getUser.mockRestore(); getUsers.mockRestore(); verify.mockRestore(); }
}, 60000);
