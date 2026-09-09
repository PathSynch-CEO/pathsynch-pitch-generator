'use strict';

// Operational events extend users/{uid}/activityFeed. Unlike the notification
// schema they use createdAt, so the notification feed/digest and its timestamp-
// based 30-day cleanup do not consume or delete durable operational receipts.
const { createHash } = require('node:crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const TYPES = Object.freeze({ user_login: 'user', market_report_created: 'report', market_report_refreshed: 'report' });
function eventId(type, userId, workspaceId, entityId) {
  return 'op_' + createHash('sha256').update(JSON.stringify([type, userId, workspaceId || null, entityId])).digest('hex');
}
function eventRecord({ type, userId, workspaceId = null, entityId, subjectUserId = userId }) {
  if (!TYPES[type] || typeof userId !== 'string' || !userId || typeof entityId !== 'string' || !entityId) throw new Error('Invalid operational event');
  const id = eventId(type, userId, workspaceId, entityId);
  return { id, schemaVersion: 2, eventType: type, userId, workspaceId, actorType: 'user', subjectUserId,
    entityType: TYPES[type], entityId, createdAt: FieldValue.serverTimestamp(), metadata: {} };
}
function eventRef(db, event) { return db.collection('users').doc(event.userId).collection('activityFeed').doc(event.id); }
async function recordLogin(db, { userId, workspaceId, authTime }) {
  if (!Number.isSafeInteger(authTime) || authTime <= 0 || authTime > Math.floor(Date.now() / 1000) + 60) throw new Error('Invalid authenticated sign-in time');
  // Only the already verified Firebase token supplies authTime; never the body.
  const event = eventRecord({ type: 'user_login', userId, workspaceId, entityId: String(authTime) });
  // Do not retain the raw token-session identifier in the document.
  event.entityId = userId;
  event.authenticatedAt = Timestamp.fromMillis(authTime * 1000);
  return db.runTransaction(async tx => {
    const ref = eventRef(db, event);
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    tx.create(ref, event);
    return true;
  });
}
async function authenticationUsers(auth, ids) {
  const result = new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const response = await auth.getUsers(unique.slice(i, i + 100).map(uid => ({ uid })));
    for (const user of response.users) result.set(user.uid, user);
  }
  return result;
}
function toDate(value) {
  if (value == null) return null;
  const seconds = value._seconds ?? value.seconds;
  const d = typeof value.toDate === 'function' ? value.toDate() : Number.isFinite(seconds) ? new Date(seconds * 1000 + (value._nanoseconds ?? value.nanoseconds ?? 0) / 1e6) : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
async function withVerifiedLogins(rows, auth, timestamps = false) {
  const identities = await authenticationUsers(auth, rows.map(row => row.id));
  const { Timestamp } = require('firebase-admin/firestore');
  return rows.map(row => {
    const d = toDate(identities.get(row.id)?.metadata?.lastSignInTime);
    return { ...row, lastLoginAt: d ? (timestamps ? Timestamp.fromDate(d) : d) : null, lastLoginSource: 'firebase_auth' };
  });
}
module.exports = { eventId, eventRecord, eventRef, recordLogin, authenticationUsers, withVerifiedLogins, toDate };
