'use strict';

const { requireThat, id, uid, time, hash, equal, result, PLANS, sameIdentity } = require('./value');
const { validateSubscription, reduceSubscription } = require('./subscription');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = s => ({ accountId: s.accountId, providerScope: s.providerScope,
  subscriptionId: s.subscriptionId, customerId: s.customerId });
const matches = (a, b) => !!a && !!b && sameIdentity(a, b) &&
  a.subscriptionId === b.subscriptionId && a.customerId === b.customerId;
const eligible = (s, at) => !s.conflict && !s.tombstone &&
  ['active', 'trialing', 'past_due'].includes(s.lifecycleState) && PLANS.includes(s.acceptedSemantic?.planId) &&
  (!s.acceptedSemantic.cancelAtPeriodEnd || s.acceptedSemantic.periodEnd * 1000 > at);
const bases = ['settled_checkout', 'operator_reconciliation', 'protected_legacy_import'];
function validLineage(l) {
  return l && id(l.selectionId) && id(l.evidenceId) && Number.isSafeInteger(l.epoch) && l.epoch > 0 &&
    bases.includes(l.basis) && (l.basis !== 'operator_reconciliation' || uid(l.actorId)) &&
    equal(l, { selectionId: l.selectionId, evidenceId: l.evidenceId, epoch: l.epoch, basis: l.basis,
      ...(l.basis === 'operator_reconciliation' ? { actorId: l.actorId } : {}) });
}
function anchor(state) {
  return result({ kind: 'accepted_disposition', ...identity(state), revision: state.revision, stateHash: hash(state) });
}
// `accepted` is the CURRENT protected persistence record, never request data.
// A digest is a consistency check, not a signature, freshness proof, or proof of absence.
function validateDisposition(state, accepted, subscription) {
  validateSubscription(subscription);
  requireThat(matches(state, subscription), 'DISPOSITION_IDENTITY_MISMATCH');
  requireThat(state.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 1 &&
    time(state.createdAt) && time(state.updatedAt) && state.updatedAt >= state.createdAt &&
    ['candidate', 'effective', 'superseded', 'quarantined'].includes(state.status) &&
    digest(state.subscriptionRevision) && Number.isSafeInteger(state.selectionFloor) && state.selectionFloor >= 0 &&
    (state.lineage === null || validLineage(state.lineage)) &&
    (!state.lineage || state.selectionFloor >= state.lineage.epoch), 'INVALID_DISPOSITION');
  requireThat(state.subscriptionRevision === subscription.revision, 'DISPOSITION_SEMANTIC_MISMATCH');
  requireThat(state.status !== 'effective' || (validLineage(state.lineage) && state.suppression === null), 'UNPROVEN_DISPOSITION');
  requireThat(!['superseded', 'quarantined'].includes(state.status) ||
    (state.suppression && id(state.suppression.evidenceId) && digest(state.suppression.evidenceHash)), 'UNPROVEN_DISPOSITION');
  requireThat(state.revision === 1 ? state.previousHash === null && state.transition === null && state.status === 'candidate' &&
    state.lineage === null && state.suppression === null && state.selectionFloor === 0 && state.updatedAt === state.createdAt :
    digest(state.previousHash) && state.transition && state.transition.previousHash === state.previousHash &&
    state.transition.expectedRevision === state.revision - 1 && state.transition.subscriptionRevision === state.subscriptionRevision &&
    state.transition.at === state.updatedAt && matches(state.transition, state), 'INVALID_DISPOSITION_LINEAGE');
  requireThat(accepted && equal(accepted, anchor(state)), 'UNACCEPTED_DISPOSITION');
  return state;
}
function initializeDisposition(subscription, at, accepted = null) {
  validateSubscription(subscription);
  requireThat(time(at) && accepted === null, 'DISPOSITION_ALREADY_EXISTS');
  const state = result({ version: 1, ...identity(subscription), revision: 1, previousHash: null,
    subscriptionRevision: subscription.revision, createdAt: at, updatedAt: at, status: 'candidate',
    lineage: null, selectionFloor: 0, suppression: null, transition: null });
  return result({ state, accepted: anchor(state) });
}
function reduceDisposition(accepted, previous, command, previousSubscription, subscription) {
  validateDisposition(previous, accepted, previousSubscription);
  validateSubscription(subscription);
  requireThat(matches(previous, subscription) && matches(previous, command), 'DISPOSITION_IDENTITY_MISMATCH');
  requireThat(command.expectedRevision === previous.revision && command.previousHash === hash(previous) &&
    command.fromSubscriptionRevision === previous.subscriptionRevision && command.subscriptionRevision === subscription.revision,
  'DISPOSITION_PREDECESSOR_MISMATCH');
  requireThat(time(command.at) && command.at >= previous.updatedAt, 'INVALID_DISPOSITION_CLOCK');
  const { type, at } = command;
  const types = ['select', 'quarantine', 'resolve', 'supersede', 'operator_reselect', 'refresh'];
  requireThat(types.includes(type), 'INVALID_DISPOSITION_TRANSITION');
  // Non-refresh transitions cannot silently bundle a provider update with a selection decision.
  requireThat(type === 'refresh' || subscription.revision === previous.subscriptionRevision, 'DISPOSITION_SEMANTIC_MISMATCH');
  const common = { kind: 'verified_disposition_transition', ...identity(previous), type,
    expectedRevision: previous.revision, previousHash: hash(previous), fromSubscriptionRevision: previous.subscriptionRevision,
    subscriptionRevision: subscription.revision, at };
  let status = previous.status, lineage = previous.lineage, selectionFloor = previous.selectionFloor, suppression = previous.suppression;
  let transition;
  if (type === 'refresh') {
    requireThat(subscription.revision !== previous.subscriptionRevision && command.evidence === undefined, 'INVALID_DISPOSITION_REFRESH');
    // New semantic snapshots must extend the accepted ledger, not swap in an older/sibling snapshot.
    // Replay the provider event through the subscription reducer, including its protected receipt if any.
    const replay = reduceSubscription(previousSubscription, command.event, command.priorReceipt || null);
    requireThat(equal(replay.state, subscription), 'DISPOSITION_SEMANTIC_SUCCESSOR_MISMATCH');
    transition = { ...common, kind: 'derived_semantic_refresh', evidenceId: hash(command.event) };
    if (status === 'effective' && !eligible(subscription, at)) {
      status = 'quarantined';
      suppression = { evidenceId: transition.evidenceId, evidenceHash: hash(transition) };
    }
  } else {
    const e = command.evidence;
    requireThat(e && id(e.evidenceId), 'UNTRUSTED_DISPOSITION_EVIDENCE');
    let payload;
    if (['select', 'resolve', 'operator_reselect'].includes(type)) {
      const expectedStatus = { select: 'candidate', resolve: 'quarantined', operator_reselect: 'superseded' }[type];
      requireThat(status === expectedStatus && eligible(subscription, at), 'INVALID_DISPOSITION_TRANSITION');
      requireThat(validLineage(e.selection) && e.selection.epoch > selectionFloor &&
        (type !== 'operator_reselect' || e.selection.basis === 'operator_reconciliation'), 'UNPROVEN_SELECTION_LINEAGE');
      payload = { selection: e.selection, ...(type !== 'select' ? { resolvesHash: hash(previous.suppression) } : {}) };
      lineage = e.selection; selectionFloor = lineage.epoch; status = 'effective'; suppression = null;
    } else if (type === 'quarantine') {
      requireThat(['candidate', 'effective'].includes(status) &&
        ['identity_conflict', 'semantic_conflict', 'reconciliation_required'].includes(e.reason), 'INVALID_DISPOSITION_TRANSITION');
      payload = { reason: e.reason }; status = 'quarantined';
    } else {
      const r = e.replacement;
      requireThat(status === 'effective' && r && sameIdentity(r, previous) && id(r.subscriptionId) &&
        r.subscriptionId !== previous.subscriptionId && id(r.customerId) && digest(r.subscriptionRevision) &&
        Number.isSafeInteger(r.dispositionRevision) && r.dispositionRevision > 1 && digest(r.dispositionHash) &&
        validLineage(r.lineage) && r.lineage.epoch > selectionFloor, 'UNPROVEN_REPLACEMENT');
      payload = { replacement: { ...identity(r), subscriptionRevision: r.subscriptionRevision,
        dispositionRevision: r.dispositionRevision, dispositionHash: r.dispositionHash, lineage: r.lineage } };
      selectionFloor = r.lineage.epoch; status = 'superseded';
    }
    transition = { ...common, evidenceId: e.evidenceId, ...payload };
    requireThat(equal(e, transition), 'UNTRUSTED_DISPOSITION_EVIDENCE');
    if (['quarantine', 'supersede'].includes(type)) suppression = { evidenceId: e.evidenceId, evidenceHash: hash(e) };
  }
  return result({ ...previous, revision: previous.revision + 1, previousHash: hash(previous),
    subscriptionRevision: subscription.revision, updatedAt: at, status, lineage, selectionFloor, suppression, transition });
}
function acceptDisposition(accepted, previous, command, proposed, previousSubscription, subscription) {
  const replay = reduceDisposition(accepted, previous, command, previousSubscription, subscription);
  requireThat(equal(proposed, replay), 'DISPOSITION_SUCCESSOR_MISMATCH');
  const next = anchor(replay);
  validateDisposition(replay, next, subscription);
  return result({ state: replay, accepted: next });
}
function validateSelection(selection, disposition, subscription) {
  requireThat(selection && selection.kind === 'verified_selection' && matches(selection, subscription) &&
    selection.subscriptionRevision === subscription.revision && selection.dispositionRevision === disposition.revision &&
    selection.dispositionHash === hash(disposition) && validLineage(selection.lineage) &&
    equal(selection.lineage, disposition.lineage) && equal(selection, {
      kind: 'verified_selection', ...identity(subscription), subscriptionRevision: subscription.revision,
      dispositionRevision: disposition.revision, dispositionHash: hash(disposition), lineage: disposition.lineage }), 'UNPROVEN_SELECTION');
  return selection;
}
module.exports = { initializeDisposition, validateDisposition, reduceDisposition, acceptDisposition, validateSelection, eligible };
