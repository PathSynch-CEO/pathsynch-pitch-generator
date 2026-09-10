'use strict';

const { DAY, SETTLEMENT_MS, requireThat, id, time, scope, result, hash, sameIdentity, envelope } = require('./value');
const { validateOperation } = require('./idempotency');
function validateAttempt(a) {
  requireThat(a && a.version === 1 && id(a.attemptId) && id(a.accountId) && scope(a.providerScope) &&
    Number.isSafeInteger(a.revision) && a.revision >= 1 && time(a.createdAt) && time(a.updatedAt) && a.updatedAt >= a.createdAt,
  'INVALID_ATTEMPT');
  requireThat(a.revision === 1 ? a.previousStateHash === null :
    typeof a.previousStateHash === 'string' && /^[a-f0-9]{64}$/.test(a.previousStateHash), 'INVALID_ATTEMPT');
  validateOperation(a.operation);
  requireThat(sameIdentity(a, a.operation) && a.operation.attemptId === a.attemptId && a.operation.kind === 'checkout_session', 'IDENTITY_MISMATCH');
  requireThat(['not_started', 'started', 'confirmed', 'unknown', 'rejected'].includes(a.providerState) &&
    ['unknown', 'open', 'completed', 'expired'].includes(a.sessionState) &&
    ['pending', 'authority_committed', 'no_purchase', 'reconciliation_required'].includes(a.resolution), 'INVALID_ATTEMPT_STATE');
  requireThat(time(a.leaseUntil) && a.leaseUntil > a.createdAt && time(a.sessionExpiresAt) &&
    a.operation.parameters.expires_at * 1000 === a.sessionExpiresAt, 'INVALID_DEADLINE');
  requireThat(a.sessionId === null || id(a.sessionId), 'INVALID_SESSION');
  requireThat(a.sessionState === 'unknown' || id(a.sessionId), 'INVALID_SESSION');
  if (a.providerState === 'not_started') {
    requireThat(a.dispatch === null && a.sessionState === 'unknown', 'INVALID_DISPATCH_STATE');
  } else {
    requireThat(a.dispatch && time(a.dispatch.at) && a.dispatch.at >= a.createdAt &&
      time(a.dispatch.retryUntil) && a.dispatch.retryUntil > a.dispatch.at &&
      a.dispatch.retryUntil < a.dispatch.at + DAY && a.dispatch.retryUntil < a.sessionExpiresAt &&
      time(a.settlementDeadline) && a.settlementDeadline >= a.sessionExpiresAt + SETTLEMENT_MS, 'INVALID_DISPATCH_STATE');
  }
  if (a.providerState === 'confirmed') requireThat(id(a.sessionId), 'INVALID_SESSION');
  if (a.resolution === 'authority_committed') {
    requireThat(!!a.dispatch && a.providerState !== 'rejected' && a.sessionState !== 'expired' &&
      id(a.authoritySubscriptionId), 'INVALID_RESOLUTION');
    evidence(a, a.resolutionEvidence, 'verified_authority_commit');
    requireThat(a.resolutionEvidence.subscriptionId === a.authoritySubscriptionId &&
      a.resolutionEvidence.customerId === a.operation.parameters.customer &&
      id(a.resolutionEvidence.sessionId) &&
      (a.sessionId === null || a.resolutionEvidence.sessionId === a.sessionId), 'INVALID_RESOLUTION');
  } else if (a.resolution === 'no_purchase') {
    const e = a.resolutionEvidence;
    requireThat(e && a.authoritySubscriptionId === null, 'INVALID_RESOLUTION');
    if (e.kind === 'never_dispatched') {
      requireThat(a.providerState === 'not_started' && time(e.at) && e.at >= a.leaseUntil && e.at <= a.updatedAt, 'INVALID_RESOLUTION');
    } else {
      requireThat(['verified_no_effect', 'verified_no_purchase', 'operator_no_purchase'].includes(e.kind), 'INVALID_RESOLUTION');
      evidence(a, e, e.kind);
      requireThat(e.dispatchQuiesced === true && e.noPayablePurchase === true &&
        (e.kind !== 'operator_no_purchase' || id(e.actorId)), 'UNPROVEN_SETTLEMENT');
    }
  } else requireThat(a.resolutionEvidence === null && a.authoritySubscriptionId === null, 'INVALID_RESOLUTION');
  return a;
}
function createAttempt({ operation, at, leaseUntil }) {
  validateOperation(operation);
  const a = result({ version: 1, attemptId: operation.attemptId, accountId: operation.accountId,
    providerScope: operation.providerScope, operation, revision: 1, previousStateHash: null, createdAt: at, updatedAt: at,
    leaseUntil, sessionExpiresAt: operation.parameters.expires_at * 1000,
    providerState: 'not_started', sessionState: 'unknown', resolution: 'pending',
    sessionId: null, dispatch: null, settlementDeadline: null, authoritySubscriptionId: null, resolutionEvidence: null });
  validateAttempt(a); requireThat(a.sessionExpiresAt > at, 'INVALID_DEADLINE');
  return a;
}
function evidence(a, e, kind) {
  requireThat(e && e.kind === kind && id(e.id) && e.attemptId === a.attemptId && sameIdentity(a, e) && e.requestFingerprint === a.operation.requestFingerprint &&
    e.providerKeyHash === a.operation.providerKeyHash, 'UNTRUSTED_EVIDENCE');
}
function reduceAttempt(previous, command) {
  validateAttempt(previous); envelope(previous, command);
  const a = { ...previous };
  requireThat(a.resolution !== 'no_purchase' &&
    (a.resolution !== 'authority_committed' || command.type === 'observe_session'), 'ATTEMPT_SETTLED');
  switch (command.type) {
    case 'authorize_dispatch':
      requireThat(a.providerState === 'not_started' && a.resolution === 'pending' && command.at < a.leaseUntil, 'DISPATCH_FORBIDDEN');
      requireThat(time(command.retryUntil) && command.retryUntil > command.at && command.retryUntil < command.at + DAY &&
        command.retryUntil < a.sessionExpiresAt && time(command.settlementDeadline) &&
        command.settlementDeadline >= a.sessionExpiresAt + SETTLEMENT_MS, 'INSUFFICIENT_HOLD');
      a.providerState = 'started'; a.dispatch = { at: command.at, retryUntil: command.retryUntil };
      a.settlementDeadline = command.settlementDeadline;
      break;
    case 'provider_unknown':
      requireThat(['started', 'unknown'].includes(a.providerState) && a.sessionState === 'unknown', 'PROGRESS_REGRESSION');
      a.providerState = 'unknown';
      break;
    case 'observe_session':
      evidence(a, command.evidence, 'verified_provider_session');
      requireThat(command.evidence.sessionId === command.sessionId && command.evidence.status === command.status &&
        command.evidence.customerId === a.operation.parameters.customer, 'UNTRUSTED_EVIDENCE');
      requireThat(a.dispatch && ['open', 'completed', 'expired'].includes(command.status) && id(command.sessionId), 'INVALID_SESSION');
      requireThat(a.sessionId === null || a.sessionId === command.sessionId, 'SESSION_MISMATCH');
      requireThat(a.providerState !== 'rejected' &&
        !(a.resolution === 'authority_committed' && command.status === 'expired'), 'PROGRESS_REGRESSION');
      requireThat(a.sessionState === 'unknown' || a.sessionState === 'open' || a.sessionState === command.status, 'PROGRESS_REGRESSION');
      a.providerState = 'confirmed'; a.sessionId = command.sessionId; a.sessionState = command.status;
      if (command.status === 'completed' && previous.sessionState !== 'completed') {
        a.settlementDeadline = Math.max(a.settlementDeadline, command.at + SETTLEMENT_MS);
      }
      break;
    case 'reject_provider':
      evidence(a, command.evidence, 'verified_no_effect');
      requireThat(['started', 'unknown'].includes(a.providerState) && a.sessionState === 'unknown', 'PROGRESS_REGRESSION');
      requireThat(command.evidence.dispatchQuiesced === true && command.evidence.noPayablePurchase === true, 'UNPROVEN_SETTLEMENT');
      a.providerState = 'rejected'; a.resolution = 'no_purchase'; a.resolutionEvidence = command.evidence;
      break;
    case 'commit_authority':
      evidence(a, command.evidence, 'verified_authority_commit');
      requireThat(a.dispatch && a.providerState !== 'rejected' && a.sessionState !== 'expired' && id(command.subscriptionId) &&
        command.evidence.subscriptionId === command.subscriptionId &&
        command.evidence.customerId === a.operation.parameters.customer &&
        (a.sessionId === null || command.evidence.sessionId === a.sessionId), 'INVALID_RESOLUTION');
      a.resolution = 'authority_committed'; a.authoritySubscriptionId = command.subscriptionId; a.resolutionEvidence = command.evidence;
      break;
    case 'settle_no_purchase':
      requireThat(command.evidence && ['verified_no_purchase', 'operator_no_purchase'].includes(command.evidence.kind), 'UNTRUSTED_EVIDENCE');
      evidence(a, command.evidence, command.evidence.kind);
      requireThat(command.evidence.dispatchQuiesced === true && command.evidence.noPayablePurchase === true &&
        (command.evidence.kind !== 'operator_no_purchase' || id(command.evidence.actorId)), 'UNPROVEN_SETTLEMENT');
      a.resolution = 'no_purchase'; a.resolutionEvidence = command.evidence;
      break;
    case 'expire_reservation':
      requireThat(a.providerState === 'not_started' && command.at >= a.leaseUntil, 'DISPATCH_ALREADY_AUTHORIZED');
      a.resolution = 'no_purchase'; a.resolutionEvidence = { kind: 'never_dispatched', at: command.at };
      break;
    case 'settlement_deadline':
      requireThat(a.dispatch && command.at >= a.settlementDeadline, 'DEADLINE_NOT_REACHED');
      a.resolution = 'reconciliation_required';
      break;
    default: throw Object.assign(new Error('UNKNOWN_TRANSITION'), { code: 'UNKNOWN_TRANSITION' });
  }
  const next = result({ ...a, revision: a.revision + 1, previousStateHash: hash(previous), updatedAt: command.at });
  validateAttempt(next);
  return next;
}
module.exports = { createAttempt, validateAttempt, reduceAttempt };
