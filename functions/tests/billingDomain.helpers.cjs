'use strict';
const { hash, SETTLEMENT_MS } = require('../services/billing/value');
const { createOperation } = require('../services/billing/idempotency');
const { createAttempt, reduceAttempt } = require('../services/billing/checkoutAttempt');
const { createCoordinator, reduceCoordinator } = require('../services/billing/coordinator');
const { createSubscription, reduceSubscription } = require('../services/billing/subscription');
const d = require('../services/billing/disposition');

const AT = 1800000000000;
const SECOND = AT / 1000;
const providerScope = Object.freeze({ provider: 'stripe', accountId: 'acct_test_fixture', mode: 'test' });
const context = Object.freeze({ accountId: 'account_fixture', providerScope });
function operation(overrides = {}) {
  return createOperation({ ...context, attemptId: 'attempt_a', kind: 'checkout_session',
    parameters: { customer: 'cus_fixture', price: 'price_scale_fixture', quantity: 1, expires_at: SECOND + 31 * 60,
      metadata: { accountId: context.accountId, attemptId: 'attempt_a' } }, ...overrides });
}
function attempt(overrides = {}) { return createAttempt({ operation: operation(), at: AT, leaseUntil: AT + 30 * 60000, ...overrides }); }
function command(a, type, extra = {}) {
  return { ...context, attemptId: a.attemptId, expectedRevision: a.revision, at: a.updatedAt, type, ...extra };
}
function step(a, type, extra = {}) { return reduceAttempt(a, command(a, type, extra)); }
function evidence(a, kind, extra = {}) { return { ...context, attemptId: a.attemptId, kind, id: 'evidence_fixture', requestFingerprint: a.operation.requestFingerprint,
  providerKeyHash: a.operation.providerKeyHash, customerId: a.operation.parameters.customer, ...(kind === 'verified_authority_commit' ? { sessionId: 'cs_fixture' } : {}), ...extra }; }
function start(a = attempt()) {
  return step(a, 'authorize_dispatch', { retryUntil: AT + 60000, settlementDeadline: a.sessionExpiresAt + SETTLEMENT_MS });
}
function observe(a, status, extra = {}) {
  return step(a, 'observe_session', { sessionId: 'cs_fixture', status, evidence: evidence(a, 'verified_provider_session', { sessionId: 'cs_fixture', status }), ...extra });
}
function coordCommand(c, a, type, extra = {}) {
  return { ...context, expectedRevision: c.revision, expectedGeneration: c.generation, attempt: a,
    at: Math.max(c.updatedAt, a.updatedAt), type, ...extra };
}
function initialPair() {
  const a = attempt();
  const empty = createCoordinator({ ...context, at: AT });
  const c = reduceCoordinator(empty, coordCommand(empty, a, 'reserve'));
  return { a, c };
}
function advance(pair, type, extra = {}, coordinatorType = 'sync') {
  const attemptCommand = command(pair.a, type, extra);
  const a = reduceAttempt(pair.a, attemptCommand);
  const c = reduceCoordinator(pair.c, coordCommand(pair.c, a, coordinatorType, {
    previousAttempt: pair.a, attemptCommand,
  }));
  return { a, c };
}
function claimedPair() {
  const pair = initialPair();
  return advance(pair, 'authorize_dispatch', { retryUntil: AT + 60000, settlementDeadline: pair.a.sessionExpiresAt + SETTLEMENT_MS });
}
function dispatchGuards() {
  const b = documentId => ({ version: 1, ...context, documentId, customerId: 'cus_fixture' });
  return { bindings: { forward: b(context.accountId), reverse: b('cus_fixture') },
    authority: { subscriptions: [], dispositions: [], selection: null } };
}
function commitReceipt({ a, c }, guards = dispatchGuards()) {
  return { kind: 'committed_dispatch_claim', ...context, attemptId: a.attemptId, generation: c.generation,
    attemptRevision: a.revision, coordinatorRevision: c.revision, stateHash: hash({ attempt: a, coordinator: c, ...guards }) };
}
function subscription(overrides = {}) {
  return createSubscription({ ...context, customerId: 'cus_fixture', subscriptionId: 'sub_a', ...overrides });
}
function event(overrides = {}) {
  const e = { ...context, customerId: 'cus_fixture', subscriptionId: 'sub_a', eventId: 'evt_a',
    created: SECOND, status: 'active', planId: 'scale', cancelAtPeriodEnd: false, periodEnd: null, ...overrides };
  return { ...e, evidence: { ...context, eventId: e.eventId, subscriptionId: e.subscriptionId,
    customerId: e.customerId, created: e.created, status: e.status, planId: e.planId,
    cancelAtPeriodEnd: e.cancelAtPeriodEnd, periodEnd: e.periodEnd, kind: 'verified_provider_event' } };
}
function feed(events, initial = subscription()) {
  return events.reduce((state, e) => reduceSubscription(state, e).state, initial);
}
function permutations(values) {
  return values.length ? values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(tail => [v, ...tail])) : [[]];
}
// Fixtures simulate the future trusted adapter; no production path manufactures these proofs.
const subIdentity = s => ({ accountId: s.accountId, providerScope: s.providerScope,
  subscriptionId: s.subscriptionId, customerId: s.customerId });
function dispositionCommand(pair, previousSub, type, payload = {}, nextSub = previousSub, at = AT) {
  const common = { ...subIdentity(previousSub), type, expectedRevision: pair.state.revision,
    previousHash: hash(pair.state), fromSubscriptionRevision: previousSub.revision, subscriptionRevision: nextSub.revision, at };
  return { ...common, ...(type === 'refresh' ? payload : { evidence: {
    ...common, kind: 'verified_disposition_transition', evidenceId: 'transition_fixture', ...payload } }) };
}
function dispositionStep(pair, previousSub, type, payload = {}, nextSub = previousSub, at = AT) {
  const cmd = dispositionCommand(pair, previousSub, type, payload, nextSub, at);
  const proposed = d.reduceDisposition(pair.accepted, pair.state, cmd, previousSub, nextSub);
  return d.acceptDisposition(pair.accepted, pair.state, cmd, proposed, previousSub, nextSub);
}
function lineage(epoch = 1, basis = 'settled_checkout') {
  return { selectionId: 'selection_' + epoch, epoch, basis, evidenceId: 'lineage_' + epoch,
    ...(basis === 'operator_reconciliation' ? { actorId: 'operator_fixture' } : {}) };
}
function selectionProof(pair, s) {
  return { ...subIdentity(s), kind: 'verified_selection', subscriptionRevision: s.revision,
    dispositionRevision: pair.state.revision, dispositionHash: hash(pair.state), lineage: pair.state.lineage };
}
function selectedDisposition(s) {
  if (d.eligible(s, AT)) return dispositionStep(d.initializeDisposition(s, AT), s, 'select', { selection: lineage() });
  // Produce an incumbent BEFORE cancellation/conflict; replay retained facts to obtain the exact target.
  const seedEvent = event({ ...subIdentity(s), eventId: 'evt_seed', created: SECOND - 100 });
  seedEvent.evidence = { ...seedEvent.evidence, ...subIdentity(s) };
  let prior = feed([seedEvent], subscription(subIdentity(s)));
  let pair = dispositionStep(d.initializeDisposition(prior, AT), prior, 'select', { selection: lineage() });
  const observations = [...s.observations.map(o => o.evidence)];
  if (s.tombstone && !observations.some(e => e.eventId === s.tombstone.eventId)) observations.unshift(s.tombstone.evidence);
  for (const evidence of observations) {
    const e = { ...evidence, evidence };
    const next = reduceSubscription(prior, e).state;
    pair = dispositionStep(pair, prior, 'refresh', { event: e }, next);
    prior = next;
  }
  if (hash(prior) !== hash(s)) throw new Error('Fixture failed to reproduce exact subscription');
  return pair;
}
function authorityInput(subscriptions, intent = null, at = AT) {
  const dispositions = subscriptions.map(s => intent && s && s.subscriptionId === intent.subscriptionId ?
    selectedDisposition(s) : s && s.revision ? d.initializeDisposition(s, AT) : null);
  const i = subscriptions.findIndex(s => s?.subscriptionId === intent?.subscriptionId);
  const selection = intent && i >= 0 ? { ...selectionProof(dispositions[i], subscriptions[i]),
    ...(intent.customerId ? { customerId: intent.customerId } : {}) } : intent;
  return { ...context, subscriptions, dispositions, selection, at };
}
module.exports = { AT, SECOND, providerScope, context, operation, attempt, command, step, evidence, start, observe,
  coordCommand, initialPair, advance, claimedPair, commitReceipt, dispatchGuards, subscription, event, feed, permutations,
  subIdentity, dispositionCommand, dispositionStep, lineage, selectionProof, selectedDisposition, authorityInput };
