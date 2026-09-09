'use strict';
const admin = require('firebase-admin');
const { normalizeRole, requireRole } = require('../middleware/workspaceRoleGuard');
const { authenticationUsers, toDate } = require('./operationalActivity');
const MAX_RECORDS = 5000, MAX_MEMBERS = 200, MAX_EVENTS = 20000;
function fail(message, statusCode = 422) { const error = new Error(message); error.statusCode = statusCode; return error; }
function dateRange(query = {}, now = new Date()) {
  const explicit = query.from !== undefined && query.to !== undefined;
  const days = Number(query.days ?? 30);
  if (!explicit && (!Number.isInteger(days) || days < 1 || days > 366)) throw fail('Choose a range of 1–366 days.', 400);
  const from = explicit || query.from ? toDate(query.from) : new Date(now.getTime() - days * 86400000);
  const to = explicit || query.to ? toDate(query.to) : now;
  if (!from || !to || to <= from || to - from > 366 * 86400000 || to > new Date(now.getTime() + 86400000)) throw fail('Invalid activity date range.', 400);
  return { from, to };
}
function creator(record) {
  if (typeof record.userId !== 'string' || !record.userId) return null;
  if (record.createdByUid && record.createdByUid !== record.userId) return null;
  return record.userId;
}
function sameScope(record, req) {
  return req.workspaceId ? record.workspaceId === req.workspaceId : !record.workspaceId && record.userId === req.userId;
}
function projectActivity({ req, memberships, reports, pitches = [], events, identities, from, to, now = new Date() }) {
  const manager = !req.workspaceId || requireRole(req, 'manager');
  const memberMap = new Map();
  const warnings = { unassignedReports: 0, missingReportDates: 0 };
  for (const m of memberships) {
    if (typeof m.uid !== 'string' || !m.uid || (!manager && m.uid !== req.userId)) continue;
    const auth = identities.get(m.uid);
    const active = m.status === 'active' && auth && !auth.disabled;
    memberMap.set(m.uid, { uid: m.uid, role: normalizeRole(m.role), status: m.status !== 'active' ? m.status : !auth ? 'deleted' : auth.disabled ? 'disabled' : m.status,
      name: active ? auth.displayName || 'Member' : 'Former or disabled member',
      email: active ? auth.email || '' : '', reportCount: 0, storedReportTotal: 0, verifiedReportCount: 0,
      pitchCount: 0, libraryCount: null, lastLoginAt: null });
  }
  function member(uid) {
    if (!memberMap.has(uid)) memberMap.set(uid, { uid, name: 'Former member', email: '', role: 'contributor', status: 'removed', reportCount: 0, storedReportTotal: 0, verifiedReportCount: 0, pitchCount: 0, libraryCount: null, lastLoginAt: null });
    return memberMap.get(uid);
  }
  const entries = new Map();
  const inRange = d => d && d >= from && d < to;
  // Protected records only. Projection never accepts browser userActivityLog.
  for (const e of events) {
    if (e.schemaVersion !== 2 || !sameScope(e, req) || (!manager && e.userId !== req.userId)) continue;
    if (!['user_login', 'market_report_created', 'market_report_refreshed'].includes(e.eventType)) continue;
    const d = toDate(e.createdAt);
    if (!d || d > now || !e.id || !e.userId) continue;
    const m = member(e.userId);
    const authenticatedAt = toDate(e.authenticatedAt);
    if (e.eventType === 'user_login' && authenticatedAt && authenticatedAt <= d && (!m.lastLoginAt || authenticatedAt > new Date(m.lastLoginAt))) m.lastLoginAt = authenticatedAt.toISOString();
    if (!inRange(d)) continue;
    const key = e.eventType === 'market_report_created' ? 'report:' + e.entityId : e.id;
    if (entries.has(key)) continue;
    if (e.eventType === 'market_report_created') m.verifiedReportCount++;
    entries.set(key, { id: e.id, userId: e.userId, workspaceId: e.workspaceId || null, actorType: 'user', subjectUserId: e.subjectUserId,
      action: e.eventType, resourceType: e.entityType, resourceId: e.eventType === 'user_login' ? null : e.entityId,
      resourceName: null, userName: m.name, createdAt: d.toISOString(), provenance: 'server_receipt' });
  }
  for (const [records, type] of [[reports, 'report'], [pitches, 'pitch']]) {
    const seen = new Set();
    for (const r of records) {
      if (!sameScope(r, req) || r.deletedAt || seen.has(r.id)) continue;
      seen.add(r.id);
      const uid = creator(r);
      if (!uid) { if (type === 'report' && manager) warnings.unassignedReports++; continue; }
      if (!manager && uid !== req.userId) continue;
      const m = member(uid), d = toDate(r.createdAt);
      if (type === 'report') m.storedReportTotal++;
      if (!d) { if (type === 'report') warnings.missingReportDates++; continue; }
      if (!inRange(d)) continue;
      if (type === 'report') m.reportCount++; else m.pitchCount++;
      // Historical inventory is explicitly not a verified generation event.
      const key = type + ':' + r.id;
      if (!entries.has(key)) entries.set(key, { id: 'stored:' + key, userId: uid, workspaceId: r.workspaceId || null,
        actorType: 'unknown', subjectUserId: uid, action: type === 'report' ? 'stored_report' : 'stored_pitch',
        resourceType: type, resourceId: r.id, resourceName: null, userName: m.name, createdAt: d.toISOString(), provenance: 'legacy_stored_record' });
    }
  }
  // Solo login is global Firebase Auth metadata. Team login is workspace-observed
  // protected evidence only; a sign-in in another workspace must not leak here.
  if (!req.workspaceId && memberMap.has(req.userId)) {
    const d = toDate(identities.get(req.userId)?.metadata?.lastSignInTime);
    memberMap.get(req.userId).lastLoginAt = d ? d.toISOString() : null;
  }
  return { schemaVersion: 1, workspaceId: req.workspaceId || null, scope: req.workspaceId && manager ? 'workspace' : 'self',
    from: from.toISOString(), to: to.toISOString(), members: [...memberMap.values()], warnings,
    entries: [...entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
    provenance: { storedReports: 'Stored inventory; legacy generation is unverified.', verifiedReports: 'Server-only generation receipts.', lastLogin: req.workspaceId ? 'Authentication time of a verified session observed in this workspace; session may originate elsewhere' : 'Firebase Authentication last sign-in', library: 'Unavailable: legacy library records lack workspace identity.' } };
}
async function bounded(query, limit, label) {
  const snap = await query.limit(limit + 1).get();
  if (snap.size > limit) throw fail(`${label} exceeds the supported activity window; no partial counts returned.`);
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
async function loadActivity(req) {
  if (!req.userId || req.userId === 'anonymous') throw fail('Authentication required.', 401);
  const db = admin.firestore(), auth = admin.auth();
  const caller = await auth.getUser(req.userId);
  if (caller.disabled) throw fail('Account disabled.', 403);
  const now = new Date();
  const { from, to } = dateRange(req.query, now);
  let memberships = req.workspaceId ? await bounded(db.collection('workspaceMembers').where('workspaceId', '==', req.workspaceId), MAX_MEMBERS, 'Workspace membership') : [{ uid: req.userId, status: 'active', role: 'admin' }];
  if (req.workspaceId && !memberships.some(m => m.uid === req.userId && m.status === 'active')) throw fail('Active workspace membership required.', 403);
  if (req.workspaceId) req = { ...req, workspaceRole: normalizeRole(memberships.find(m => m.uid === req.userId).role) };
  const manager = !req.workspaceId || requireRole(req, 'manager');
  if (!manager) memberships = memberships.filter(m => m.uid === req.userId);
  const source = collection => {
    let q = db.collection(collection);
    // Equality only: existing single-field indexes suffice. Never fetch an
    // unscoped collection and then filter it into a workspace.
    q = req.workspaceId ? q.where('workspaceId', '==', req.workspaceId) : q.where('userId', '==', req.userId);
    if (req.workspaceId && !manager) q = q.where('userId', '==', req.userId);
    return bounded(q.select('userId', 'createdByUid', 'workspaceId', 'createdAt', 'deletedAt'), MAX_RECORDS, collection);
  };
  const [reports, pitches] = await Promise.all([source('marketReports'), source('pitches')]);
  // Include historical members by stable source UID, without exposing their
  // current profile. A record with no workspace never gets assigned here.
  const ids = [...new Set([...memberships.map(m => m.uid), ...reports.map(creator), ...pitches.map(creator)].filter(uid => uid && (manager || uid === req.userId)))];
  if (ids.length > MAX_MEMBERS) throw fail('Activity membership exceeds the supported window.');
  const identities = await authenticationUsers(auth, memberships.filter(m => m.status === 'active').map(m => m.uid));
  const events = [];
  for (const uid of ids) {
    const query = db.collection('users').doc(uid).collection('activityFeed')
      .where('schemaVersion', '==', 2).where('workspaceId', '==', req.workspaceId || null);
    const rows = await bounded(query, MAX_EVENTS - events.length, 'Operational activity');
    for (const row of rows) if (row.userId === uid) events.push(row);
  }
  return projectActivity({ req, memberships, reports, pitches, events, identities, from, to, now });
}
module.exports = { creator, dateRange, projectActivity, loadActivity, bounded };
