'use strict';
const { canAccessResource } = require('../middleware/workspaceRoleGuard');
const { FieldValue } = require('firebase-admin/firestore');
async function persistRefresh(db, ref, generated, req) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Report no longer exists');
    const old = snap.data();
    if (old.deletedAt) throw new Error('Report deleted');
    const allowed = req.workspaceId ? old.workspaceId === req.workspaceId && canAccessResource(req, old.createdByUid) : !old.workspaceId && old.userId === req.userId;
    if (!allowed) throw new Error('Report scope changed');
    const next = { ...generated, userId: old.userId, workspaceId: old.workspaceId || null,
      createdByUid: old.createdByUid || old.userId, refreshedByUid: req.userId, refreshedAt: FieldValue.serverTimestamp() };
    if (old.createdAt != null) next.createdAt = old.createdAt; else delete next.createdAt;
    tx.set(ref, next);
    return next;
  });
}
function writeReportAndReceipt(tx, db, ref, data, req) {
  const { eventRecord, eventRef } = require('./operationalActivity');
  const receipt = eventRecord({ type: 'market_report_created', userId: req.userId, workspaceId: req.workspaceId || null, entityId: ref.id });
  tx.set(ref, data);
  tx.create(eventRef(db, receipt), receipt);
}
module.exports = { persistRefresh, writeReportAndReceipt };
