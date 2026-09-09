'use strict';
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { VERSION, normalizePlan, seatContract } = require('./planCatalog');
function failure(code, message, status = 409) { const error = new (require('../middleware/errorHandler').ApiError)(code, message); error.code = code; error.status = status; error.statusCode = status; return error; }
function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/'); }
function instant(value) { const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value); return value != null && Number.isFinite(date.getTime()) ? date : null; }
function assignmentPlan(data, uid, now = new Date()) {
  const effective = instant(data?.effectiveAt), expiry = data?.expiresAt == null ? null : instant(data.expiresAt);
  const plan = normalizePlan(data?.planId);
  if (!data || data.schemaVersion !== 1 || data.subjectUid !== uid || data.status !== 'active' ||
      data.source !== 'operator' || !validId(data.actorUid) || !Number.isSafeInteger(data.revision) || data.revision < 1 ||
      !effective || effective > now || (data.expiresAt != null && (!expiry || expiry <= now)) || !plan) return null;
  return plan;
}
async function accountPlan(uid, reader = admin.firestore(), now = new Date()) {
  if (!validId(uid)) return null;
  const ref = admin.firestore().collection('accountPlanAssignments').doc(uid);
  const snap = await (typeof reader.get === 'function' ? reader.get(ref) : ref.get());
  const data = snap.exists ? snap.data() : null;
  return { data, plan: assignmentPlan(data, uid, now) };
}
function membershipState(snapshot, workspaceId) {
  const members = new Map();
  for (const doc of snapshot.docs) {
    const m = doc.data();
    if (m.workspaceId !== workspaceId || !validId(m.uid) || doc.id !== `${workspaceId}_${m.uid}` ||
        !['active', 'disabled', 'removed', 'invited', 'offboarding'].includes(m.status) || members.has(m.uid)) {
      throw failure('MEMBERSHIP_UNRESOLVED', 'Workspace membership requires operator reconciliation.');
    }
    members.set(m.uid, m);
  }
  const owners = [...members.values()].filter(m => m.isWorkspaceOwner === true && m.status === 'active');
  if (owners.length !== 1) throw failure('OWNER_UNRESOLVED', 'Workspace ownership requires operator reconciliation.');
  return { members, ownerUid: owners[0].uid, used: [...members.values()].filter(m => m.status === 'active').length };
}
async function workspaceOwner(db, workspaceId) {
  if (!validId(workspaceId)) throw failure('INVALID_WORKSPACE', 'Invalid workspace identity.', 400);
  const rows = await db.collection('workspaceMembers').where('workspaceId', '==', workspaceId).get();
  const owners = rows.docs.filter(doc => doc.data().status === 'active' && doc.data().isWorkspaceOwner === true);
  if (owners.length !== 1 || !validId(owners[0].data().uid) || owners[0].id !== workspaceId + '_' + owners[0].data().uid) throw failure('OWNER_UNRESOLVED', 'Workspace ownership requires reconciliation.');
  return owners[0].data().uid;
}
async function workspaceState(db, tx, workspaceId, callerUid = null, now = new Date()) {
  if (!validId(workspaceId)) throw failure('INVALID_WORKSPACE', 'Invalid workspace identity.', 400);
  const read = ref => tx ? tx.get(ref) : ref.get();
  const wsRef = db.collection('workspaces').doc(workspaceId);
  const snapshotRef = db.collection('workspaceEntitlements').doc(workspaceId);
  const [ws, membership, previous] = await Promise.all([read(wsRef), read(db.collection('workspaceMembers').where('workspaceId', '==', workspaceId)), read(snapshotRef)]);
  if (!ws.exists) throw failure('WORKSPACE_NOT_FOUND', 'Workspace not found.', 404);
  const state = membershipState(membership, workspaceId);
  if (callerUid && state.members.get(callerUid)?.status !== 'active') throw failure('MEMBERSHIP_REQUIRED', 'Active workspace membership required.', 403);
  const assignmentRef = db.collection('accountPlanAssignments').doc(state.ownerUid);
  const assignmentSnap = await read(assignmentRef);
  const assignment = assignmentSnap.exists ? assignmentSnap.data() : null;
  const plan = assignmentPlan(assignment, state.ownerUid, now);
  const seats = plan ? seatContract(plan) : null;
  const snapshot = { schema_version: 1, workspace_id: workspaceId, owner_uid: state.ownerUid,
    status: plan ? 'resolved' : 'unresolved', plan_id: plan, plan_version: VERSION,
    assignment_revision: plan ? assignment.revision : null,
    team_seats: seats, routing_members: { shared_pool: 'team_seats' }, scheduler_hosts: { shared_pool: 'team_seats' },
    usage: { team_seats: state.used }, effective_at: plan ? instant(assignment.effectiveAt).toISOString() : null,
    computed_at: now.toISOString(), source: plan ? 'operator_assignment' : 'operator_reconciliation_required' };
  return { ...state, wsRef, snapshotRef, previous: previous.exists ? previous.data() : null, snapshot, plan, assignment };
}
function enforceAdmission(state, uid) {
  if (!validId(uid)) throw failure('INVALID_USER', 'Invalid member identity.', 400);
  const existing = state.members.get(uid);
  // Existing accepted users keep membership; repeating a role operation cannot consume another seat.
  if (existing?.status === 'active') return false;
  if (existing?.status === 'offboarding') throw failure('OFFBOARDING_IN_PROGRESS', 'Member removal is still in progress.');
  if (!state.plan) throw failure('ENTITLEMENT_UNRESOLVED', 'New admissions require a verified workspace plan.');
  const seats = state.snapshot.team_seats;
  if (!seats.unlimited && state.used >= seats.limit) throw failure('TEAM_SEAT_LIMIT_REACHED', 'Workspace seat limit reached', 403);
  return true;
}
function writeSnapshot(tx, state, admitted) {
  // Every admission writes the same protected document, serializing concurrent query snapshots.
  tx.set(state.snapshotRef, { ...state.snapshot, usage: { team_seats: state.used + (admitted ? 1 : 0) }, updated_at: FieldValue.serverTimestamp() });
}
async function effectivePlan(uid, workspaceId = null) {
  const db = admin.firestore();
  if (workspaceId) return (await workspaceState(db, null, workspaceId, uid)).plan;
  return (await accountPlan(uid, db))?.plan || null;
}
async function displayEntitlements(req) {
  if (!validId(req.userId) || req.userId === 'anonymous') throw failure('AUTH_REQUIRED', 'Authentication required.', 401);
  const identity = await admin.auth().getUser(req.userId);
  if (identity.disabled) throw failure('ACCOUNT_DISABLED', 'Account disabled.', 403);
  if (!req.workspaceId) return { schema_version: 1, workspace_id: null, status: 'no_workspace', plan_id: await effectivePlan(req.userId), team_seats: null, usage: null };
  return (await workspaceState(admin.firestore(), null, req.workspaceId, req.userId)).snapshot;
}
async function grantFromAdminRequest(req, subjectUid, planValue, legacyUpdates) {
  const token = (req.headers?.authorization || '').replace(/^Bearer /, '');
  const decoded = await admin.auth().verifyIdToken(token, true);
  const actor = await admin.auth().getUser(decoded.uid);
  const { checkIsAdmin } = require('../middleware/adminAuth');
  if (actor.disabled || !actor.emailVerified || !(await checkIsAdmin(decoded.uid))) throw failure('OPERATOR_REQUIRED', 'Verified active operator required.', 403);
  if (!validId(subjectUid)) throw failure('INVALID_SUBJECT', 'Invalid subject.', 400);
  const planId = normalizePlan(planValue);
  if (!planId) throw failure('UNKNOWN_PLAN', 'A recognized canonical plan is required.', 400);
  const db = admin.firestore(), ref = db.collection('accountPlanAssignments').doc(subjectUid), userRef = db.collection('users').doc(subjectUid);
  return db.runTransaction(async tx => {
    const [previous, user] = await Promise.all([tx.get(ref), tx.get(userRef)]);
    if (!user.exists) throw failure('USER_NOT_FOUND', 'User not found.', 404);
    const oldRevision = previous.exists ? previous.data().revision : 0;
    if (!Number.isSafeInteger(oldRevision) || oldRevision < 0) throw failure('ASSIGNMENT_UNRESOLVED', 'Assignment requires reconciliation.');
    const grant = { schemaVersion: 1, subjectUid, planId, revision: oldRevision + 1, status: 'active', source: 'operator',
      actorUid: decoded.uid, effectiveAt: Timestamp.now(), expiresAt: null, updatedAt: FieldValue.serverTimestamp() };
    tx.set(ref, grant);
    tx.create(ref.collection('history').doc(String(grant.revision)), grant);
    tx.update(userRef, legacyUpdates);
    return { plan_id: planId, revision: grant.revision };
  });
}
module.exports = { workspaceOwner, assignmentPlan, accountPlan, membershipState, workspaceState, enforceAdmission, writeSnapshot, effectivePlan, displayEntitlements, grantFromAdminRequest, failure };
