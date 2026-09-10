'use strict';

const { requireThat, id, uid, time, scope, hash, equal, result, sameIdentity } = require('./value');
const { createAttempt, validateAttempt, reduceAttempt } = require('./checkoutAttempt');
const { validateBindings } = require('./bindings');
const { selectBillingAuthority } = require('./authoritySelection');

function createCoordinator({ accountId, providerScope, at }) {
  requireThat(uid(accountId) && scope(providerScope) && time(at), 'INVALID_COORDINATOR');
  return result({ version: 1, accountId, providerScope, revision: 1, generation: 0,
    attemptId: null, attemptRevision: null, attemptStateHash: null, operationHash: null, hold: 'released', settlementDeadline: null,
    reconciliationRequired: false, updatedAt: at });
}
function validateCoordinator(c) {
  requireThat(c && c.version === 1 && uid(c.accountId) && scope(c.providerScope) &&
    Number.isSafeInteger(c.revision) && c.revision >= 1 && Number.isSafeInteger(c.generation) && c.generation >= 0 &&
    time(c.updatedAt) && ['reserved', 'settling', 'reconciliation', 'released'].includes(c.hold) &&
    typeof c.reconciliationRequired === 'boolean', 'INVALID_COORDINATOR');
  requireThat(c.generation === 0 ? c.attemptId === null && c.attemptStateHash === null && c.hold === 'released' :
    id(c.attemptId) && Number.isSafeInteger(c.attemptRevision) && c.attemptRevision >= 1 &&
    typeof c.attemptStateHash === 'string' && /^[a-f0-9]{64}$/.test(c.attemptStateHash) && typeof c.operationHash === 'string' && /^[a-f0-9]{64}$/.test(c.operationHash), 'INVALID_COORDINATOR');
  if (['settling', 'reconciliation'].includes(c.hold)) requireThat(time(c.settlementDeadline), 'INVALID_HOLD');
  requireThat(c.reconciliationRequired === (c.hold === 'reconciliation'), 'INVALID_HOLD');
  return c;
}
function reduceCoordinator(previous, command) {
  validateCoordinator(previous);
  requireThat(command && sameIdentity(previous, command), 'IDENTITY_MISMATCH');
  requireThat(command.expectedRevision === previous.revision && command.expectedGeneration === previous.generation, 'STALE_COORDINATOR');
  requireThat(time(command.at) && command.at >= previous.updatedAt, 'INVALID_CLOCK');
  const a = validateAttempt(command.attempt);
  requireThat(command.at >= a.updatedAt, 'INVALID_CLOCK');
  requireThat(sameIdentity(previous, a), 'IDENTITY_MISMATCH');
  const c = { ...previous };
  if (command.type === 'reserve') {
    const canonicalInitial = createAttempt({ operation: a.operation, at: a.createdAt, leaseUntil: a.leaseUntil });
    requireThat(equal(a, canonicalInitial), 'INVALID_INITIAL_ATTEMPT');
    requireThat(c.hold === 'released' && a.providerState === 'not_started' && a.resolution === 'pending' &&
      a.revision === 1 && a.attemptId !== c.attemptId && command.at < a.leaseUntil &&
      command.at < a.sessionExpiresAt, 'CHECKOUT_BLOCKED');
    c.generation++; c.attemptId = a.attemptId; c.attemptRevision = a.revision; c.operationHash = hash(a.operation);
    c.hold = 'reserved'; c.settlementDeadline = null;
  } else {
    requireThat(c.hold !== 'released' && c.attemptId === a.attemptId &&
      a.revision === c.attemptRevision + 1, 'STALE_ATTEMPT');
    requireThat(c.operationHash === hash(a.operation), 'CHANGED_INTENT');
    requireThat(c.settlementDeadline === null || (a.dispatch &&
      a.settlementDeadline >= c.settlementDeadline), 'PROGRESS_REGRESSION');
    requireThat(a.previousStateHash === c.attemptStateHash, 'ATTEMPT_ANCESTRY_MISMATCH');
    requireThat(command.previousAttempt && command.attemptCommand, 'ATTEMPT_TRANSITION_REQUIRED');
    const predecessor = validateAttempt(command.previousAttempt);
    requireThat(hash(predecessor) === c.attemptStateHash, 'ATTEMPT_ANCESTRY_MISMATCH');
    const expectedAttempt = reduceAttempt(predecessor, command.attemptCommand);
    requireThat(equal(expectedAttempt, a), 'INVALID_ATTEMPT_TRANSITION');
    requireThat(!(predecessor.dispatch === null && a.dispatch !== null) ||
      command.at < predecessor.leaseUntil, 'RESERVATION_EXPIRED');
    c.attemptRevision = a.revision;
    if (command.type === 'sync') {
      requireThat(!['authority_committed', 'no_purchase'].includes(a.resolution), 'USE_SETTLEMENT_TRANSITION');
      requireThat(!(c.hold === 'reconciliation' && a.resolution !== 'reconciliation_required'), 'PROGRESS_REGRESSION');
      c.hold = a.resolution === 'reconciliation_required' ? 'reconciliation' : a.dispatch ? 'settling' : 'reserved';
      c.settlementDeadline = a.settlementDeadline;
    } else if (command.type === 'release') {
      requireThat(['authority_committed', 'no_purchase'].includes(a.resolution), 'UNPROVEN_SETTLEMENT');
      c.hold = 'released'; c.settlementDeadline = a.settlementDeadline;
    } else requireThat(false, 'UNKNOWN_TRANSITION');
  }
  c.attemptStateHash = hash(a);
  c.reconciliationRequired = c.hold === 'reconciliation';
  const next = result({ ...c, revision: c.revision + 1, updatedAt: command.at });
  validateCoordinator(next);
  return next;
}
// The adapter must supply this evidence only from a confirmed atomic commit/read.
// Pure code can validate its binding, not prove that a real datastore commit happened.
function dispatchDecision({ attempt, coordinator, bindings, authority, commitReceipt, at }) {
  validateAttempt(attempt); validateCoordinator(coordinator);
  requireThat(time(at) && at >= attempt.updatedAt && at >= coordinator.updatedAt, 'INVALID_CLOCK');
  requireThat(bindings && authority, 'DISPATCH_GUARDS_REQUIRED');
  const bindingDecision = validateBindings({ accountId: attempt.accountId, providerScope: attempt.providerScope,
    customerId: attempt.operation.parameters.customer, forward: bindings.forward, reverse: bindings.reverse });
  requireThat(bindingDecision.allowed, 'BILLING_BINDING_UNRESOLVED');
  const selected = selectBillingAuthority({ accountId: attempt.accountId, providerScope: attempt.providerScope,
    subscriptions: authority.subscriptions, selection: authority.selection, at });
  requireThat(!selected.checkoutBlocked, 'BILLING_AUTHORITY_UNAVAILABLE');
  const expected = { kind: 'committed_dispatch_claim', accountId: attempt.accountId, providerScope: attempt.providerScope,
    attemptId: attempt.attemptId, generation: coordinator.generation, attemptRevision: attempt.revision,
    coordinatorRevision: coordinator.revision, stateHash: hash({ attempt, coordinator, bindings, authority }) };
  requireThat(commitReceipt && equal(commitReceipt, expected), 'COMMIT_CONFIRMATION_REQUIRED');
  requireThat(sameIdentity(attempt, coordinator) && coordinator.attemptId === attempt.attemptId &&
    coordinator.attemptRevision === attempt.revision && coordinator.attemptStateHash === hash(attempt) && coordinator.operationHash === hash(attempt.operation) && coordinator.hold === 'settling' &&
    attempt.resolution === 'pending' && ['started', 'unknown'].includes(attempt.providerState) &&
    attempt.sessionState === 'unknown' && time(at) && at >= attempt.dispatch.at && at < attempt.dispatch.retryUntil &&
    coordinator.settlementDeadline === attempt.settlementDeadline, 'DISPATCH_FORBIDDEN');
  return result({ allowed: true, operation: attempt.operation });
}
module.exports = { createCoordinator, validateCoordinator, reduceCoordinator, dispatchDecision };
