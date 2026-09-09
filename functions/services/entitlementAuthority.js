'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { normalizePlan } = require('./planCatalog');

const SCHEMA_VERSION = 2;
const SOURCES = Object.freeze(['billing', 'operator', 'promotion', 'legacy_migration']);
const PLAN_RANK = Object.freeze({ starter: 0, growth: 1, scale: 2, enterprise: 3 });
// Only breaks ties between equal plans. It never lets a lower plan suppress a higher active grant.
const SOURCE_TIE_BREAK = Object.freeze({ operator: 4, promotion: 3, legacy_migration: 2, billing: 1 });

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !value.includes('/');
}

function instant(value) {
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return value != null && Number.isFinite(date.getTime()) ? date : null;
}

function legacyOperatorAuthority(data, uid) {
  if (!data || data.schemaVersion !== 1 || data.subjectUid !== uid || data.source !== 'operator') return null;
  return {
    source: 'operator', authorityId: 'operator', subjectUid: uid, planId: data.planId,
    status: data.status, actorUid: data.actorUid, effectiveAt: data.effectiveAt,
    expiresAt: data.expiresAt ?? null, revokedAt: data.revokedAt ?? null,
    revision: data.revision,
  };
}

function authoritiesFromRecord(data, uid) {
  if (!data) return {};
  if (data.schemaVersion === 1) {
    const legacy = legacyOperatorAuthority(data, uid);
    return legacy ? { operator: legacy } : {};
  }
  if (data.schemaVersion !== SCHEMA_VERSION || data.subjectUid !== uid || !data.authorities ||
      typeof data.authorities !== 'object' || Array.isArray(data.authorities)) return {};
  return data.authorities;
}

function authorityShapeValid(authority, key, uid, recordRevision) {
  if (!authority || authority.source !== key || !SOURCES.includes(key) || authority.subjectUid !== uid ||
      !validId(authority.authorityId) || !['active', 'revoked'].includes(authority.status) ||
      !Number.isSafeInteger(authority.revision) || authority.revision < 1 || authority.revision > recordRevision ||
      !normalizePlan(authority.planId) || !instant(authority.effectiveAt) ||
      (authority.expiresAt != null && !instant(authority.expiresAt)) ||
      (authority.revokedAt != null && !instant(authority.revokedAt))) return false;
  if (authority.status === 'active' && authority.revokedAt != null) return false;
  if (authority.status === 'revoked' && !instant(authority.revokedAt)) return false;
  if (key === 'billing') return authority.provider === 'stripe' && validId(authority.providerSubscriptionId) &&
    validId(authority.providerCustomerId) && validId(authority.lastEventId) &&
    Number.isSafeInteger(authority.lastEventCreated) && authority.lastEventCreated > 0 &&
    Number.isSafeInteger(authority.lastEventRank) && authority.lastEventRank >= 1 && authority.lastEventRank <= 3 &&
    validId(authority.lastEventType) && validId(authority.lastEventSemantic);
  return validId(authority.actorUid);
}

function recordShapeValid(data, uid) {
  if (!data) return true;
  if (!Number.isSafeInteger(data.revision) || data.revision < 1 || data.subjectUid !== uid) return false;
  if (data.schemaVersion === 1) {
    const authority = legacyOperatorAuthority(data, uid);
    return !!authority && authorityShapeValid(authority, 'operator', uid, data.revision);
  }
  if (data.schemaVersion !== SCHEMA_VERSION || !data.authorities || typeof data.authorities !== 'object' ||
      Array.isArray(data.authorities)) return false;
  const entries = Object.entries(data.authorities);
  return entries.length > 0 && entries.every(([key, authority]) =>
    SOURCES.includes(key) && authorityShapeValid(authority, key, uid, data.revision));
}

function validateAuthority(authority, key, uid, now = new Date()) {
  if (!authority || authority.source !== key || !SOURCES.includes(key) || authority.subjectUid !== uid ||
      !validId(authority.authorityId) || authority.status !== 'active' ||
      !Number.isSafeInteger(authority.revision) || authority.revision < 1) return null;
  const planId = normalizePlan(authority.planId);
  const effectiveAt = instant(authority.effectiveAt);
  const expiresAt = authority.expiresAt == null ? null : instant(authority.expiresAt);
  const revokedAt = authority.revokedAt == null ? null : instant(authority.revokedAt);
  if (!planId || !effectiveAt || effectiveAt > now || revokedAt ||
      (authority.expiresAt != null && (!expiresAt || expiresAt <= now))) return null;
  if (key === 'billing') {
    if (authority.provider !== 'stripe' || !validId(authority.providerSubscriptionId) ||
        !validId(authority.providerCustomerId) || !validId(authority.lastEventId) ||
        !Number.isSafeInteger(authority.lastEventCreated) || authority.lastEventCreated < 1 ||
        !Number.isSafeInteger(authority.lastEventRank) || authority.lastEventRank < 1 || authority.lastEventRank > 3 ||
        !validId(authority.lastEventType) || !validId(authority.lastEventSemantic)) return null;
  } else if (!validId(authority.actorUid)) return null;
  return { ...authority, planId, effectiveAt, expiresAt };
}

function resolveAuthority(data, uid, now = new Date()) {
  if (!recordShapeValid(data, uid)) return { plan: null, selected: null, active: [], recordRevision: null };
  const authorities = authoritiesFromRecord(data, uid);
  const active = Object.entries(authorities).map(([key, value]) => validateAuthority(value, key, uid, now)).filter(Boolean);
  active.sort((a, b) => PLAN_RANK[b.planId] - PLAN_RANK[a.planId] ||
    SOURCE_TIE_BREAK[b.source] - SOURCE_TIE_BREAK[a.source] || a.authorityId.localeCompare(b.authorityId));
  const selected = active[0] || null;
  return {
    plan: selected?.planId || null,
    selected,
    active,
    recordRevision: Number.isSafeInteger(data?.revision) && data.revision > 0 ? data.revision : selected?.revision || null,
  };
}

function nextRecord(previous, uid, source, authority) {
  if (!SOURCES.includes(source) || !recordShapeValid(previous, uid)) throw new Error('ASSIGNMENT_UNRESOLVED');
  const oldRevision = previous?.schemaVersion === 1 ? previous.revision : previous?.revision || 0;
  if (!Number.isSafeInteger(oldRevision) || oldRevision < 0) throw new Error('ASSIGNMENT_UNRESOLVED');
  if (authority?.revision !== oldRevision + 1 || !authorityShapeValid(authority, source, uid, oldRevision + 1)) {
    throw new Error('ASSIGNMENT_UNRESOLVED');
  }
  const authorities = { ...authoritiesFromRecord(previous, uid), [source]: authority };
  return {
    schemaVersion: SCHEMA_VERSION,
    subjectUid: uid,
    revision: oldRevision + 1,
    authorities,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function operatorAuthority(uid, planId, actorUid, revision, now = Timestamp.now()) {
  return {
    source: 'operator', authorityId: 'operator', subjectUid: uid, planId, status: 'active',
    actorUid, revision, effectiveAt: now, expiresAt: null, revokedAt: null,
  };
}

function billingEventRank(event, subscription) {
  if (event?.type === 'customer.subscription.deleted' ||
      ['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(subscription?.status)) return 3;
  if (subscription?.status === 'incomplete' || subscription?.cancel_at_period_end === true) return 2;
  if (['active', 'trialing', 'past_due'].includes(subscription?.status)) return 1;
  return null;
}

function eventOrder(event, subscription) {
  const rank = billingEventRank(event, subscription);
  if (!validId(event?.id) || !Number.isSafeInteger(event?.created) || event.created < 1) return null;
  return rank ? { created: event.created, rank, id: event.id } : null;
}

function compareEventOrder(a, b) {
  if (a.created !== b.created) return a.created - b.created;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id.localeCompare(b.id);
}

function billingEventSemantic(event, subscription, planId) {
  const plan = normalizePlan(planId) || 'unresolved';
  const periodEnd = Number.isSafeInteger(subscription?.current_period_end) ? subscription.current_period_end : 0;
  return [event?.type, subscription?.status, plan, subscription?.cancel_at_period_end === true ? 'cancel' : 'continue',
    subscription?.pending_update ? 'pending' : 'effective', periodEnd].join('|');
}

function billingDecision(previous, uid, event, subscription, planId) {
  const order = eventOrder(event, subscription);
  if (!order || !validId(subscription?.id) || !validId(subscription?.customer)) throw new Error('BILLING_EVENT_UNRESOLVED');
  const status = subscription.status;
  const granting = ['active', 'trialing', 'past_due'].includes(status);
  const terminal = event.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(status);
  if (!granting && !terminal && status !== 'incomplete') throw new Error('BILLING_STATUS_UNRESOLVED');
  const old = authoritiesFromRecord(previous, uid).billing || null;
  if (old?.lastEventId === event.id) return { action: 'duplicate', authority: old, order };
  const semantic = billingEventSemantic(event, subscription, planId);
  if (old?.lastEventCreated === order.created && old.lastEventRank === order.rank && old.lastEventId !== event.id &&
      old.providerSubscriptionId === subscription.id && old.providerStatus !== 'reconciliation_required' &&
      old.lastEventSemantic !== semantic) {
    const revision = (Number.isSafeInteger(previous?.revision) ? previous.revision : old.revision || 0) + 1;
    const currentWinsTie = event.id.localeCompare(old.lastEventId) > 0;
    const stablePlan = currentWinsTie ? (normalizePlan(planId) || old.planId) : old.planId;
    return { action: 'ambiguous', authority: { ...old, planId: stablePlan, status: 'revoked',
      providerStatus: 'reconciliation_required', revision,
      lastEventId: currentWinsTie ? event.id : old.lastEventId, lastEventCreated: order.created,
      lastEventRank: order.rank, lastEventType: 'billing.reconciliation_required',
      lastEventSemantic: 'ambiguous_same_second', expiresAt: null,
      revokedAt: Timestamp.fromMillis(event.created * 1000) }, order };
  }
  if (old?.lastEventCreated) {
    const oldOrder = { created: old.lastEventCreated, rank: old.lastEventRank, id: old.lastEventId };
    if (compareEventOrder(order, oldOrder) <= 0) return { action: 'stale', authority: old, order };
  }
  if (old && old.providerCustomerId !== subscription.customer) throw new Error('BILLING_CUSTOMER_MISMATCH');
  if (old && old.providerSubscriptionId !== subscription.id) {
    const oldExpiry = old.expiresAt == null ? null : instant(old.expiresAt);
    const oldInactive = old.status === 'revoked' || (oldExpiry && oldExpiry <= new Date(event.created * 1000));
    if (!oldInactive) throw new Error('BILLING_SUBSCRIPTION_COLLISION');
  }
  if (old && subscription.pending_update && planId && planId !== old.planId) {
    const revision = (Number.isSafeInteger(previous?.revision) ? previous.revision : old.revision || 0) + 1;
    return { action: 'pending', authority: { ...old, revision, lastEventId: event.id, lastEventCreated: event.created,
      lastEventRank: order.rank, lastEventType: event.type, lastEventSemantic: semantic }, order };
  }
  const revision = (Number.isSafeInteger(previous?.revision) ? previous.revision : old?.revision || 0) + 1;
  const base = {
    source: 'billing', authorityId: `stripe:${subscription.id}`, subjectUid: uid,
    provider: 'stripe', providerSubscriptionId: subscription.id, providerCustomerId: subscription.customer,
    providerStatus: status, lastEventId: event.id, lastEventCreated: event.created,
    lastEventRank: order.rank, lastEventType: event.type, lastEventSemantic: semantic, revision,
  };
  if (terminal || status === 'incomplete') {
    const terminalPlan = normalizePlan(old?.planId || planId);
    if (!terminalPlan) throw new Error('BILLING_PLAN_UNRESOLVED');
    return { action: terminal ? 'revoked' : 'inactive', authority: { ...base, planId: terminalPlan,
      status: 'revoked', effectiveAt: old?.effectiveAt || Timestamp.fromMillis(event.created * 1000),
      expiresAt: null, revokedAt: Timestamp.fromMillis(event.created * 1000) }, order };
  }
  if (!normalizePlan(planId)) throw new Error('BILLING_PLAN_UNRESOLVED');
  const periodEnd = Number.isSafeInteger(subscription.current_period_end) && subscription.current_period_end > event.created
    ? Timestamp.fromMillis(subscription.current_period_end * 1000) : null;
  if (subscription.cancel_at_period_end && !periodEnd) throw new Error('BILLING_EFFECTIVE_END_UNRESOLVED');
  return { action: 'applied', authority: { ...base, planId: normalizePlan(planId), status: 'active',
    effectiveAt: Timestamp.fromMillis(event.created * 1000), expiresAt: subscription.cancel_at_period_end ? periodEnd : null,
    revokedAt: null }, order };
}

module.exports = {
  SCHEMA_VERSION, SOURCES, PLAN_RANK, validId, instant, authoritiesFromRecord, validateAuthority,
  authorityShapeValid, recordShapeValid, resolveAuthority, nextRecord, operatorAuthority, billingEventRank,
  eventOrder, compareEventOrder, billingEventSemantic, billingDecision,
};
