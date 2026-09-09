'use strict';
const { canAccessResource } = require('../middleware/workspaceRoleGuard');
const { FieldValue } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { eventRecord, eventRef, eventId } = require('./operationalActivity');
// One identifier per completed generation/persistence operation, allocated outside
// the transaction callback. Reuse it when explicitly retrying that operation;
// a separate refresh invocation gets a new receipt even for the same report.
async function persistRefresh(db, ref, generated, req, operationId = randomUUID(), quota) {
  if (typeof operationId !== 'string' || !operationId || operationId.length > 128) throw new Error('Invalid refresh operation');
  if (!quota || !Number.isSafeInteger(quota.limit) || quota.limit < -1) throw new Error('Invalid refresh quota');
  const unlimited = quota.limit === -1;
  // Match the existing per-actor monthly usage policy. This period is stable
  // across Firestore transaction retries; plan limits come from server policy.
  const now = new Date();
  const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const usageRef = db.collection('usage').doc(req.userId + '_' + period);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Report no longer exists');
    const old = snap.data();
    if (old.deletedAt) throw new Error('Report deleted');
    const allowed = req.workspaceId ? old.workspaceId === req.workspaceId && canAccessResource(req, old.createdByUid) : !old.workspaceId && old.userId === req.userId;
    if (!allowed) throw new Error('Report scope changed');
    const receipt = eventRecord({ type: 'market_report_refreshed', userId: req.userId, workspaceId: old.workspaceId || null,
      entityId: ref.id, subjectUserId: old.createdByUid || old.userId });
    receipt.id = eventId(receipt.eventType, receipt.userId, receipt.workspaceId, JSON.stringify([ref.id, operationId]));
    const receiptRef = eventRef(db, receipt);
    const prior = await tx.get(receiptRef);
    // A retry must not overwrite a newer refresh with stale generated content.
    const usage = await tx.get(usageRef);
    const used = usage.data()?.marketReportsThisMonth || 0;
    if (!Number.isSafeInteger(used) || used < 0) throw new Error('Invalid report usage');
    if (prior.exists) return { report: old, creditInfo: { used: prior.data().metadata?.usageUsed ?? used, limit: quota.limit, unlimited } };
    if (!unlimited && used >= quota.limit) throw new Error('LIMIT_REACHED');
    receipt.metadata = { usagePeriod: period, usageUsed: used + 1 };
    const next = { ...generated, userId: old.userId, workspaceId: old.workspaceId || null,
      createdByUid: old.createdByUid || old.userId, refreshedByUid: req.userId, refreshedAt: FieldValue.serverTimestamp() };
    if (old.createdAt != null) next.createdAt = old.createdAt; else delete next.createdAt;
    tx.set(ref, next);
    tx.create(receiptRef, receipt);
    tx.set(usageRef, { marketReportsThisMonth: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { report: next, creditInfo: { used: used + 1, limit: quota.limit, unlimited } };
  });
}
function writeReportAndReceipt(tx, db, ref, data, req) {
  const receipt = eventRecord({ type: 'market_report_created', userId: req.userId, workspaceId: req.workspaceId || null, entityId: ref.id });
  tx.set(ref, data);
  tx.create(eventRef(db, receipt), receipt);
}
module.exports = { persistRefresh, writeReportAndReceipt };
