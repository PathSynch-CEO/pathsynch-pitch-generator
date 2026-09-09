'use strict';

const admin = require('firebase-admin');
const { instant, validId } = require('./entitlementAuthority');

const SCHEMA_VERSION = 1;
const FEATURES = Object.freeze(['custom_branding']);
const SOURCES = Object.freeze(['operator', 'promotion', 'legacy_migration']);
const MAX_GRANTS_PER_SCOPE = 20;

function grantCollection(db, scopeType, scopeId) {
  if (!['workspace', 'account'].includes(scopeType) || !validId(scopeId)) throw new Error('FEATURE_GRANT_SCOPE_INVALID');
  return db.collection(scopeType === 'workspace' ? 'workspaceFeatureGrants' : 'accountFeatureGrants')
    .doc(scopeId).collection('grants');
}

function activeGrant(data, docId, scopeType, scopeId, feature, now = new Date()) {
  const grantedAt = instant(data?.grantedAt), expiresAt = data?.expiresAt == null ? null : instant(data.expiresAt);
  const revokedAt = data?.revokedAt == null ? null : instant(data.revokedAt);
  if (!data || data.schemaVersion !== SCHEMA_VERSION || data.grantId !== docId || !validId(docId) ||
      data.scopeType !== scopeType || data.scopeId !== scopeId || data.feature !== feature ||
      !FEATURES.includes(feature) || !SOURCES.includes(data.source) || !validId(data.actorUid) ||
      typeof data.reason !== 'string' || !data.reason.trim() || !grantedAt || grantedAt > now || revokedAt ||
      (data.expiresAt != null && (!expiresAt || expiresAt <= now))) return null;
  return { grantId: docId, feature, source: data.source, grantedAt, expiresAt };
}

async function activeFeatureGrants(db = admin.firestore(), reader = null, scopeType, scopeId, feature, now = new Date()) {
  if (!FEATURES.includes(feature)) return [];
  const query = grantCollection(db, scopeType, scopeId).limit(MAX_GRANTS_PER_SCOPE + 1);
  const snapshot = await (reader && typeof reader.get === 'function' ? reader.get(query) : query.get());
  if (snapshot.size > MAX_GRANTS_PER_SCOPE) throw new Error('FEATURE_GRANT_RECONCILIATION_REQUIRED');
  const active = [];
  for (const doc of snapshot.docs) {
    const grant = activeGrant(doc.data(), doc.id, scopeType, scopeId, feature, now);
    if (grant) active.push(grant);
  }
  return active;
}

async function hasFeatureGrant(db, reader, scopeType, scopeId, feature, now = new Date()) {
  if (!FEATURES.includes(feature)) return false;
  return (await activeFeatureGrants(db, reader, scopeType, scopeId, feature, now)).length > 0;
}

module.exports = { SCHEMA_VERSION, FEATURES, SOURCES, MAX_GRANTS_PER_SCOPE, grantCollection, activeGrant, activeFeatureGrants, hasFeatureGrant };
