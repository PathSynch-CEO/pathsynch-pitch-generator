'use strict';

const { requireThat, id, uid, time, scope, PLANS, hash, equal, result, sameIdentity } = require('./value');
const STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'paused', 'unpaid', 'canceled', 'incomplete_expired'];
const RECEIPT_ACTIONS = ['duplicate', 'stale', 'reconciliation_required', 'observed'];
const terminal = status => ['canceled', 'incomplete_expired'].includes(status);
const rank = status => terminal(status) ? 3 : ['incomplete', 'paused', 'unpaid'].includes(status) ? 2 : 1;

function providerEvidence(state, eventId, created, semantic) {
  return result({ kind: 'verified_provider_event', accountId: state.accountId,
    providerScope: state.providerScope, eventId, subscriptionId: state.subscriptionId,
    customerId: state.customerId, created, status: semantic.status, planId: semantic.planId,
    cancelAtPeriodEnd: semantic.cancelAtPeriodEnd, periodEnd: semantic.periodEnd });
}
function eventFact(observation) {
  return { eventId: observation.eventId, created: observation.created,
    semantic: observation.semantic, rank: observation.rank, evidence: observation.evidence };
}

function semanticRevision(state) {
  const { revision, ...facts } = state;
  return hash(facts);
}
function createSubscription(input) {
  requireThat(input && !Object.hasOwn(input, 'disposition'), 'INVALID_SUBSCRIPTION');
  const { accountId, providerScope, subscriptionId, customerId } = input;
  requireThat(uid(accountId) && scope(providerScope) && id(subscriptionId) && id(customerId), 'INVALID_SUBSCRIPTION');
  const state = { version: 1, accountId, providerScope, subscriptionId, customerId,
    lastAcceptedCreated: null, acceptedEventId: null, acceptedSemantic: null, acceptedRank: null,
    observations: [], tombstone: null, conflict: null, lifecycleState: 'unobserved' };
  return result({ ...state, revision: semanticRevision(state) });
}
function normalizeEvent(state, event) {
  requireThat(event && sameIdentity(state, event) && event.subscriptionId === state.subscriptionId &&
    event.customerId === state.customerId, 'SUBSCRIPTION_IDENTITY_MISMATCH');
  requireThat(id(event.eventId) && time(event.created) && event.created > 0 && STATUSES.includes(event.status) &&
    (event.planId === null || PLANS.includes(event.planId)) && typeof event.cancelAtPeriodEnd === 'boolean' &&
    (event.periodEnd === null || (time(event.periodEnd) && event.periodEnd > 0)), 'INVALID_SUBSCRIPTION_EVENT');
  requireThat(!event.cancelAtPeriodEnd || event.periodEnd > event.created, 'INVALID_PERIOD_END');
  const semantic = { status: event.status, planId: event.planId,
    cancelAtPeriodEnd: event.cancelAtPeriodEnd, periodEnd: event.periodEnd };
  // Retain only the bounded normalized attestation. Loaded state can then prove
  // that its authority-bearing semantic was not rewritten after reduction.
  const retainedEvidence = providerEvidence(state, event.eventId, event.created, semantic);
  requireThat(event.evidence && equal(event.evidence, retainedEvidence), 'UNTRUSTED_EVIDENCE');
  return result({ eventId: event.eventId, created: event.created, semantic,
    rank: rank(event.status), evidence: retainedEvidence,
    terminalEvidence: state.tombstone?.evidence || null });
}
function summarize(observations, tombstone) {
  if (!observations.length) return { acceptedEventId: null, acceptedSemantic: null, acceptedRank: null,
    lastAcceptedCreated: null, lifecycleState: 'unobserved', conflict: null };
  const chosen = observations[observations.length - 1];
  const hasLaterResurrection = tombstone && chosen.created > tombstone.created &&
    observations.some(o => !terminal(o.semantic.status));
  let conflict = null;
  let lifecycleState;
  if (tombstone) {
    lifecycleState = 'terminated';
    if (hasLaterResurrection) conflict = 'terminal_resurrection';
  } else if (new Set(observations.map(o => hash(o.semantic))).size > 1) {
    conflict = 'same_second_conflict'; lifecycleState = 'reconciliation_required';
  } else lifecycleState = chosen.semantic.status;
  return { acceptedEventId: chosen.eventId, acceptedSemantic: chosen.semantic, acceptedRank: chosen.rank,
    lastAcceptedCreated: chosen.created, lifecycleState, conflict };
}
function validateSubscription(state) {
  requireThat(!!state, 'INVALID_SUBSCRIPTION');
  createSubscription(state);
  requireThat(state.version === 1 && Array.isArray(state.observations), 'INVALID_SUBSCRIPTION');
  if (state.tombstone) {
    const evidence = state.tombstone.evidence;
    requireThat(id(state.tombstone.eventId) && time(state.tombstone.created) &&
      state.tombstone.created > 0 && state.tombstone.created <= state.lastAcceptedCreated &&
      terminal(state.tombstone.status) && evidence && evidence.status === state.tombstone.status &&
      terminal(evidence.status) && (evidence.planId === null || PLANS.includes(evidence.planId)) &&
      typeof evidence.cancelAtPeriodEnd === 'boolean' &&
      (evidence.periodEnd === null || (time(evidence.periodEnd) && evidence.periodEnd > 0)) &&
      (!evidence.cancelAtPeriodEnd || evidence.periodEnd > evidence.created) &&
      equal(evidence, providerEvidence(state, state.tombstone.eventId, state.tombstone.created, evidence)),
    'INVALID_TOMBSTONE');
  }
  for (let i = 0; i < state.observations.length; i++) {
    const o = state.observations[i];
    requireThat(o && typeof o === 'object' && !Array.isArray(o) &&
      o.semantic && typeof o.semantic === 'object' && !Array.isArray(o.semantic) &&
      id(o.eventId) && time(o.created) && o.created > 0 &&
      o.created === state.lastAcceptedCreated && STATUSES.includes(o.semantic?.status) &&
      (o.semantic.planId === null || PLANS.includes(o.semantic.planId)) && typeof o.semantic.cancelAtPeriodEnd === 'boolean' &&
      (o.semantic.periodEnd === null || (time(o.semantic.periodEnd) && o.semantic.periodEnd > 0)) &&
      (!o.semantic.cancelAtPeriodEnd || o.semantic.periodEnd > o.created) && o.rank === rank(o.semantic.status) &&
      (i === 0 || state.observations[i - 1].eventId < o.eventId), 'INVALID_OBSERVATION');
    requireThat(o.evidence && equal(o.evidence,
      providerEvidence(state, o.eventId, o.created, o.semantic)), 'UNTRUSTED_EVIDENCE');
    requireThat(equal(o.terminalEvidence, state.tombstone?.evidence || null), 'UNTRUSTED_EVIDENCE');
  }
  const expected = summarize(state.observations, state.tombstone);
  requireThat(Object.entries(expected).every(([key, value]) => equal(value, state[key])), 'SUBSCRIPTION_TAMPERED');
  requireThat(state.revision === semanticRevision(state), 'SUBSCRIPTION_REVISION_MISMATCH');
  return state;
}
function reduceSubscription(previous, event, priorReceipt = null) {
  validateSubscription(previous);
  const observation = normalizeEvent(previous, event);
  const eventHash = hash({ accountId: previous.accountId, providerScope: previous.providerScope,
    subscriptionId: previous.subscriptionId, customerId: previous.customerId,
    observation: eventFact(observation) });
  const receipt = action => result({ version: 1, accountId: previous.accountId, providerScope: previous.providerScope,
    subscriptionId: previous.subscriptionId, eventId: event.eventId, eventHash, action });
  if (priorReceipt) {
    requireThat(RECEIPT_ACTIONS.includes(priorReceipt.action) &&
      equal(priorReceipt, receipt(priorReceipt.action)), 'RECEIPT_MISMATCH');
    return result({ state: previous, receipt: priorReceipt, action: 'duplicate', requiresAtomicCommit: false });
  }
  const existing = previous.observations.find(o => o.eventId === event.eventId);
  if (existing) {
    requireThat(equal(existing, observation), 'EVENT_ID_REUSED');
    return result({ state: previous, receipt: receipt('duplicate'), action: 'duplicate', requiresAtomicCommit: true });
  }
  let observations = previous.observations;
  if (previous.lastAcceptedCreated === null || observation.created > previous.lastAcceptedCreated) observations = [observation];
  else if (observation.created === previous.lastAcceptedCreated) observations = [...observations, observation].sort((a, b) => a.eventId < b.eventId ? -1 : 1);
  let tombstone = previous.tombstone;
  if (terminal(observation.semantic.status)) {
    const candidate = { eventId: observation.eventId, created: observation.created,
      status: observation.semantic.status, evidence: observation.evidence };
    if (!tombstone || candidate.created < tombstone.created ||
      (candidate.created === tombstone.created && candidate.eventId < tombstone.eventId)) tombstone = candidate;
  }
  observations = observations.map(current => result({ ...current,
    terminalEvidence: tombstone?.evidence || null }));
  const next = { ...previous, observations, tombstone, ...summarize(observations, tombstone) };
  const state = result({ ...next, revision: semanticRevision(next) });
  validateSubscription(state);
  const action = equal(state, previous) ? 'stale' : state.conflict ? 'reconciliation_required' : 'observed';
  return result({ state, receipt: receipt(action), action, requiresAtomicCommit: true });
}
module.exports = { createSubscription, validateSubscription, reduceSubscription };
