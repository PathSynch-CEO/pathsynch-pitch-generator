'use strict';
// Explicit synthetic authority fixtures. Never derive assignments from profile fields.
function assignment(uid, plan) { return { schemaVersion: 1, subjectUid: uid, planId: plan, status: 'active', source: 'operator', actorUid: 'fixture-operator', revision: 1, effectiveAt: new Date('2020-01-01'), expiresAt: null }; }
function seed(store, { ownerUid, plan, workspaceId = null, memberUids = [] }) {
  store.accountPlanAssignments ||= {}; store.accountPlanAssignments[ownerUid] = assignment(ownerUid, plan);
  if (!workspaceId) return;
  store.workspaceMembers ||= {};
  for (const uid of new Set([ownerUid, ...memberUids])) store.workspaceMembers[workspaceId + '_' + uid] = { uid, workspaceId, status: 'active', isWorkspaceOwner: uid === ownerUid, role: uid === ownerUid ? 'admin' : 'contributor' };
}
function query(store, name, filters = []) { return {
  where(field, op, value) { return query(store, name, [...filters, [field, op, value]]); },
  async get() { const docs = Object.entries(store[name] || {}).filter(([, d]) => filters.every(([field, op, value]) => op === '==' ? d[field] === value : op === 'in' ? value.includes(d[field]) : false)).map(([id, d]) => ({ id, exists: true, data: () => d })); return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) }; }
}; }
module.exports = { assignment, seed, query };
