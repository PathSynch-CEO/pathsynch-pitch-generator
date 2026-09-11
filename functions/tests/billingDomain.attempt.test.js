'use strict';
const { DAY, SETTLEMENT_MS, hash } = require('../services/billing/value');
const { verifyRetry, createOperation, validateOperation } = require('../services/billing/idempotency');
const { reduceAttempt, validateAttempt } = require('../services/billing/checkoutAttempt');
const { createCoordinator, reduceCoordinator, dispatchDecision } = require('../services/billing/coordinator');
const f = require('./billingDomain.helpers.cjs');
const dispatch = (pair, extra = {}) => dispatchDecision({ attempt: pair.a, coordinator: pair.c, ...f.dispatchGuards(),
  commitReceipt: f.commitReceipt(pair), at: f.AT, ...extra });

test('BILLING-001: dispatch needs matching confirmed commit, not just an in-memory transition', () => {
  const pair = f.claimedPair();
  expect(() => dispatch(pair, { commitReceipt: null })).toThrow('COMMIT_CONFIRMATION_REQUIRED');
  expect(dispatch(pair).operation).toEqual(pair.a.operation);
  expect(() => dispatch(pair, { commitReceipt: { ...f.commitReceipt(pair), generation: 999 } })).toThrow('COMMIT_CONFIRMATION_REQUIRED');
});
test.each(['at', 'retryUntil', 'settlementDeadline'])('invalid authorization %s fails without changing reserved state', field => {
  const a = f.attempt();
  const args = { at: f.AT, retryUntil: f.AT + 60000, settlementDeadline: a.sessionExpiresAt + SETTLEMENT_MS };
  args[field] = field === 'at' ? a.leaseUntil : 0;
  expect(() => f.step(a, 'authorize_dispatch', args)).toThrow();
  expect(a.providerState).toBe('not_started');
});
test('provider success plus local finalization failure leaves the durable long hold', () => {
  const durable = f.claimedPair();
  const remote = f.observe(durable.a, 'open');
  expect(remote.providerState).toBe('confirmed');
  // Simulated commit loss: restart from durable claim only, not closure variables.
  const restarted = JSON.parse(JSON.stringify(durable));
  expect(restarted.c.hold).toBe('settling');
  expect(restarted.c.settlementDeadline).toBeGreaterThanOrEqual(restarted.a.sessionExpiresAt + SETTLEMENT_MS);
  expect(dispatch(restarted).operation.providerKey).toBe(remote.operation.providerKey);
});
test('provider timeout preserves identity and supports only bounded same-key retry', () => {
  const pair = f.advance(f.claimedPair(), 'provider_unknown');
  expect(dispatch(pair).operation.providerKey).toBe(pair.a.operation.providerKey);
  expect(() => dispatch(pair, { at: pair.a.dispatch.retryUntil })).toThrow('DISPATCH_FORBIDDEN');
  expect(() => dispatch(pair, { at: f.AT + DAY })).toThrow('DISPATCH_FORBIDDEN');
});
test.each([0, 1, DAY, 30 * DAY])('BILLING-009/015: unknown outcome remains held deadline + %i ms', delta => {
  const unknown = f.advance(f.claimedPair(), 'provider_unknown');
  const later = f.advance(unknown, 'settlement_deadline', { at: unknown.a.settlementDeadline + delta });
  expect(later.a.resolution).toBe('reconciliation_required');
  expect(later.c.hold).toBe('reconciliation');
  expect(() => reduceCoordinator(later.c, f.coordCommand(later.c, later.a, 'release'))).toThrow();
});
test.each(['unknown', 'open', 'completed'])('elapsed seven days cannot release %s session', state => {
  let a = f.start();
  if (state !== 'unknown') a = f.observe(a, state);
  const next = f.step(a, 'settlement_deadline', { at: a.settlementDeadline });
  expect(next.resolution).toBe('reconciliation_required');
  expect(() => f.step(next, 'expire_reservation')).toThrow('DISPATCH_ALREADY_AUTHORIZED');
});
test('pre-dispatch expiry releases only never-authorized attempt and preserves history', () => {
  const pair = f.initialPair();
  const released = f.advance(pair, 'expire_reservation', { at: pair.a.leaseUntil }, 'release');
  expect(released.c.hold).toBe('released');
  expect(released.a.resolutionEvidence.kind).toBe('never_dispatched');
  expect(released.a.operation).toEqual(pair.a.operation);
  expect(() => f.step(released.a, 'authorize_dispatch')).toThrow('ATTEMPT_SETTLED');
});
test.each(['verified_no_purchase', 'operator_no_purchase'])('review: %s cannot bypass an undispatched reservation lease', kind => {
  const a = f.attempt();
  const evidence = f.evidence(a, kind, {
    dispatchQuiesced: true, noPayablePurchase: true, actorId: 'operator_fixture',
  });
  expect(() => f.step(a, 'settle_no_purchase', { evidence })).toThrow('DISPATCH_NOT_AUTHORIZED');
});
test('review: coordinator reserves only the canonical reducer-produced initial attempt', () => {
  const a = { ...f.attempt(), injected: 'not-domain-state' };
  const c = createCoordinator({ ...f.context, at: f.AT });
  expect(() => reduceCoordinator(c, f.coordCommand(c, a, 'reserve'))).toThrow('INVALID_INITIAL_ATTEMPT');
});
test('BILLING-012: completion resists stale worker and even fresh-revision progress downgrade', () => {
  const original = f.start();
  const staleCommand = f.command(original, 'provider_unknown');
  const completed = f.observe(original, 'completed');
  expect(() => reduceAttempt(completed, staleCommand)).toThrow('STALE_REVISION');
  expect(() => f.step(completed, 'provider_unknown')).toThrow('PROGRESS_REGRESSION');
  expect(() => f.observe(completed, 'open')).toThrow('PROGRESS_REGRESSION');
  expect(() => f.observe(completed, 'expired')).toThrow('PROGRESS_REGRESSION');
});
test('completion replay does not continually extend protection', () => {
  const a = f.observe(f.start(), 'completed');
  expect(f.observe(a, 'completed', { at: f.AT + DAY }).settlementDeadline).toBe(a.settlementDeadline);
});
test('late completed evidence enriches an attempt already held for reconciliation', () => {
  const started = f.start();
  const reconciling = f.step(started, 'settlement_deadline', { at: started.settlementDeadline });
  const completed = f.observe(reconciling, 'completed');
  expect(completed.resolution).toBe('reconciliation_required');
  expect(completed.sessionState).toBe('completed');
  expect(completed.settlementDeadline).toBe(reconciling.settlementDeadline);
});
test('verified completed authority releases matching hold, leaving retained attempt', () => {
  const pair = f.claimedPair();
  const completed = f.advance(pair, 'observe_session', { status: 'completed', sessionId: 'cs_fixture',
    evidence: f.evidence(pair.a, 'verified_provider_session', { sessionId: 'cs_fixture', status: 'completed' }) });
  const settled = f.advance(completed, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(completed.a, 'verified_authority_commit', { subscriptionId: 'sub_a', sessionId: 'cs_fixture' }) }, 'release');
  expect(settled.c.hold).toBe('released');
  expect(settled.a.resolution).toBe('authority_committed');
  expect(settled.a.sessionId).toBe('cs_fixture');
});
test.each(['verified_no_purchase', 'operator_no_purchase'])('explicit %s evidence settles ambiguity', kind => {
  const pair = f.advance(f.claimedPair(), 'provider_unknown');
  const args = { evidence: f.evidence(pair.a, kind, { dispatchQuiesced: true, noPayablePurchase: true, actorId: 'operator_fixture' }) };
  const settled = f.advance(pair, 'settle_no_purchase', args, 'release');
  expect(settled.c.hold).toBe('released');
  expect(settled.a.providerState).toBe('unknown'); // retain historical uncertainty, not invented provider rejection
});
test('verified no-purchase evidence may settle a completed session without erasing its history', () => {
  const a = f.observe(f.start(), 'completed');
  const settled = f.step(a, 'settle_no_purchase', { evidence: f.evidence(a, 'verified_no_purchase', {
    dispatchQuiesced: true, noPayablePurchase: true,
  }) });
  expect(settled.resolution).toBe('no_purchase');
  expect(settled.sessionState).toBe('completed');
  expect(settled.sessionId).toBe(a.sessionId);
});
test.each(['open', 'completed', 'expired'])('late %s evidence enriches a verified no-purchase settlement', status => {
  const a = f.start();
  const settled = f.step(a, 'settle_no_purchase', { evidence: f.evidence(a, 'verified_no_purchase', {
    dispatchQuiesced: true, noPayablePurchase: true,
  }) });
  const observed = f.observe(settled, status);
  expect(observed.resolution).toBe('no_purchase');
  expect(observed.resolutionEvidence).toEqual(settled.resolutionEvidence);
  expect(observed.settlementDeadline).toBe(settled.settlementDeadline);
  expect(observed.sessionState).toBe(status);
});
test('late session evidence cannot contradict verified operation-wide no effect', () => {
  const a = f.start();
  const settled = f.step(a, 'reject_provider', { evidence: f.evidence(a, 'verified_no_effect', {
    dispatchQuiesced: true, noPayablePurchase: true,
  }) });
  expect(() => f.observe(settled, 'expired')).toThrow('PROGRESS_REGRESSION');
});
test.each(['started', 'unknown'])('verified no-effect settlement rejects forged %s provider state', providerState => {
  const a = f.start();
  const settled = f.step(a, 'reject_provider', { evidence: f.evidence(a, 'verified_no_effect', {
    dispatchQuiesced: true, noPayablePurchase: true,
  }) });
  const forged = { ...settled, providerState };
  expect(() => validateAttempt(forged)).toThrow('INVALID_RESOLUTION');
});
test('late session evidence cannot attach to a never-dispatched settlement', () => {
  const a = f.attempt();
  const settled = f.step(a, 'expire_reservation', { at: a.leaseUntil });
  expect(() => f.observe(settled, 'expired')).toThrow('INVALID_SESSION');
});
test.each(['dispatchQuiesced', 'noPayablePurchase', 'actorId'])('operator resolution missing %s cannot release', key => {
  const a = f.start();
  const evidence = f.evidence(a, 'operator_no_purchase', { dispatchQuiesced: true, noPayablePurchase: true, actorId: 'operator_fixture' });
  delete evidence[key];
  expect(() => f.step(a, 'settle_no_purchase', { evidence })).toThrow('UNPROVEN_SETTLEMENT');
});
test('definitive provider rejection is distinct from timeout', () => {
  const a = f.start();
  expect(() => f.step(a, 'reject_provider', { evidence: f.evidence(a, 'transport_timeout') })).toThrow('UNTRUSTED_EVIDENCE');
  expect(f.step(a, 'reject_provider', { evidence: f.evidence(a, 'verified_no_effect', { dispatchQuiesced: true, noPayablePurchase: true }) }).resolution).toBe('no_purchase');
});
test('release from old attempt cannot overwrite newer coordinator generation', () => {
  const p = f.initialPair();
  const releaseCommand = f.command(p.a, 'expire_reservation', { at: p.a.leaseUntil });
  const oldRelease = reduceAttempt(p.a, releaseCommand);
  const c1 = reduceCoordinator(p.c, f.coordCommand(p.c, oldRelease, 'release', {
    previousAttempt: p.a, attemptCommand: releaseCommand,
  }));
  const a2 = f.attempt({ operation: f.operation({ attemptId: 'attempt_b', parameters: { ...f.operation().parameters, expires_at: f.SECOND + 63 * 60 } }), at: f.AT + 1, leaseUntil: f.AT + 31 * 60000 });
  const c2 = reduceCoordinator(c1, f.coordCommand(c1, a2, 'reserve', { at: c1.updatedAt }));
  expect(c2.generation).toBe(2);
  expect(() => reduceCoordinator(c2, f.coordCommand(p.c, oldRelease, 'release'))).toThrow('STALE_COORDINATOR');
  expect(() => reduceCoordinator(c2, f.coordCommand(c2, oldRelease, 'release'))).toThrow('STALE_ATTEMPT');
});
test.each(f.permutations(['a', 'b']))('logical claims serialize in order %j', (first, second) => {
  const empty = createCoordinator({ ...f.context, at: f.AT });
  const a = f.attempt({ operation: f.operation({ attemptId: 'attempt_' + first }) });
  const b = f.attempt({ operation: f.operation({ attemptId: 'attempt_' + second }) });
  const commandA = f.coordCommand(empty, a, 'reserve');
  const commandB = f.coordCommand(empty, b, 'reserve');
  const won = reduceCoordinator(empty, commandA);
  expect(() => reduceCoordinator(won, commandB)).toThrow('STALE_COORDINATOR');
  expect(() => reduceCoordinator(won, f.coordCommand(won, b, 'reserve'))).toThrow('CHECKOUT_BLOCKED');
  expect(won.attemptId).toBe(a.attemptId);
});
test('BILLING-002: same intent resumes same operation independent of object property order', () => {
  const op = f.operation();
  expect(verifyRetry(op, { ...op, parameters: { metadata: op.parameters.metadata, expires_at: op.parameters.expires_at,
    quantity: 1, price: op.parameters.price, customer: op.parameters.customer } })).toBe(op);
});
test.each(['customer', 'price', 'quantity', 'expires_at', 'metadata'])('changed intent %s cannot reuse provider identity', key => {
  const op = f.operation();
  const parameters = { ...op.parameters, [key]: key === 'metadata' ? { changed: true } : 'changed' };
  expect(() => verifyRetry(op, { ...op, parameters })).toThrow('CHANGED_INTENT');
});
test.each(['accountId', 'attemptId', 'providerScope', 'kind'])('BILLING-016: identity %s cannot change on retry', key => {
  const op = f.operation();
  const replacements = { accountId: 'other', attemptId: 'other', providerScope: { ...f.providerScope, mode: 'live' }, kind: 'customer_create' };
  expect(() => verifyRetry(op, { ...op, [key]: replacements[key] })).toThrow('CHANGED_INTENT');
});
test('customer and session operation keys are distinct and frozen', () => {
  const a = f.operation();
  const b = createOperation({ ...a, kind: 'customer_create', parameters: { owner: 'account_fixture' } });
  expect(a.providerKey).not.toBe(b.providerKey);
  expect(Object.isFrozen(a.parameters.metadata)).toBe(true);
  expect(() => { a.parameters.price = 'other'; }).toThrow();
  expect(() => validateOperation({ ...a, providerKey: b.providerKey })).toThrow('OPERATION_TAMPERED');
});
test.each([undefined, NaN, () => {}, new Date(f.AT), [,,]])('noncanonical request data %# rejected', invalid => {
  expect(() => f.operation({ parameters: { invalid } })).toThrow('NON_JSON_VALUE');
});
test('foreign attempt evidence cannot change progress', () => {
  const a = f.start();
  expect(() => f.observe(a, 'completed', { evidence: { ...f.evidence(a, 'verified_provider_session'), accountId: 'foreign' } })).toThrow('UNTRUSTED_EVIDENCE');
  expect(() => validateAttempt({ ...a, accountId: 'foreign' })).toThrow('IDENTITY_MISMATCH');
});
test('commit evidence is bound to both full snapshots', () => {
  const p = f.claimedPair();
  const receipt = f.commitReceipt(p);
  expect(receipt.stateHash).toBe(hash({ attempt: p.a, coordinator: p.c, ...f.dispatchGuards() }));
  expect(() => dispatch({ ...p, c: { ...p.c, generation: 2 } }, { commitReceipt: receipt })).toThrow('COMMIT_CONFIRMATION_REQUIRED');
});

test('orthogonal dimensions: subscription authority may commit before session completion delivery', () => {
  const pair = f.claimedPair();
  const settled = f.advance(pair, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(pair.a, 'verified_authority_commit', { subscriptionId: 'sub_a' }) }, 'release');
  expect(settled.a.resolution).toBe('authority_committed');
  expect(settled.a.sessionState).toBe('unknown');
  expect(settled.a.providerState).toBe('started');
  expect(settled.c.hold).toBe('released');
  const completed = f.observe(settled.a, 'completed');
  expect(completed.resolution).toBe('authority_committed');
  expect(() => reduceCoordinator(settled.c, f.coordCommand(settled.c, completed, 'sync'))).toThrow('STALE_ATTEMPT');
});
test('authority proof for another customer cannot settle the attempt', () => {
  const a = f.start();
  expect(() => f.step(a, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(a, 'verified_authority_commit', { subscriptionId: 'sub_a', customerId: 'cus_foreign' }) })).toThrow('INVALID_RESOLUTION');
});
test('one failed provider request is not proof that all authorized dispatches had no effect', () => {
  const a = f.start();
  expect(() => f.step(a, 'reject_provider', { evidence: f.evidence(a, 'verified_no_effect') })).toThrow('UNPROVEN_SETTLEMENT');
});

test('coordinator refuses a rewritten operation even if its hashes were recomputed', () => {
  const pair = f.initialPair();
  const changed = { ...f.start(pair.a), operation: f.operation({ parameters: { ...pair.a.operation.parameters, price: 'price_other' } }) };
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, changed, 'sync'))).toThrow('CHANGED_INTENT');
});
test('an already expired provider session request cannot acquire a fresh account hold', () => {
  const pair = f.initialPair();
  const c = createCoordinator({ ...f.context, at: pair.a.sessionExpiresAt });
  expect(() => reduceCoordinator(c, f.coordCommand(c, pair.a, 'reserve'))).toThrow('CHECKOUT_BLOCKED');
});

test('BILLING-008: dispatch is impossible with missing reverse binding even with a committed claim', () => {
  const pair = f.claimedPair(); const guards = f.dispatchGuards(); guards.bindings.reverse = null;
  expect(() => dispatch(pair, { ...guards, commitReceipt: f.commitReceipt(pair, guards) })).toThrow('BILLING_BINDING_UNRESOLVED');
});
test('dispatch cannot bypass an active incumbent or unproven subscription', () => {
  const pair = f.claimedPair(); const guards = f.dispatchGuards();
  guards.authority = f.authorityInput([f.feed([f.event()])]);
  expect(() => dispatch(pair, { ...guards, commitReceipt: f.commitReceipt(pair, guards) })).toThrow('BILLING_AUTHORITY_UNAVAILABLE');
});
test('dispatch guard snapshots are part of the confirmed commit identity', () => {
  const pair = f.claimedPair(); const guards = f.dispatchGuards();
  guards.bindings.forward.establishedBy = 'new_binding_revision';
  expect(() => dispatch(pair, guards)).toThrow('COMMIT_CONFIRMATION_REQUIRED');
});

test.each([null, undefined, {}, { kind: 'never_dispatched', at: f.AT }])('malformed settled snapshot cannot release protection %#', invalid => {
  const pair = f.claimedPair();
  const forged = { ...pair.a, revision: pair.a.revision + 1, resolution: 'no_purchase', resolutionEvidence: invalid };
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, forged, 'release'))).toThrow();
});
test('coordinator detects a reset-to-reserved snapshot even with matching operation identity', () => {
  const pair = f.claimedPair();
  const reset = { ...f.attempt(), revision: pair.a.revision + 1, previousStateHash: hash(pair.a) };
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, reset, 'sync'))).toThrow('PROGRESS_REGRESSION');
});
test('expired session and committed authority are contradictory facts', () => {
  const expired = f.observe(f.start(), 'expired');
  expect(() => f.step(expired, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(expired, 'verified_authority_commit', { subscriptionId: 'sub_a', sessionId: 'cs_fixture' }) })).toThrow('INVALID_RESOLUTION');
  const a = f.start();
  const settled = f.step(a, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(a, 'verified_authority_commit', { subscriptionId: 'sub_a' }) });
  expect(() => f.observe(settled, 'expired')).toThrow('PROGRESS_REGRESSION');
});

test('review: committed timeout cannot rewind the dispatch decision clock', () => {
  const pair = f.advance(f.claimedPair(), 'provider_unknown', { at: f.AT + 120000 });
  expect(() => dispatch(pair, { at: f.AT + 1000 })).toThrow('INVALID_CLOCK');
});
test('review: dispatch clock cannot precede the coordinator commit', () => {
  const pair = f.claimedPair();
  const later = { ...pair, c: { ...pair.c, updatedAt: f.AT + 2000 } };
  expect(() => dispatch(later, { at: f.AT + 1000 })).toThrow('INVALID_CLOCK');
});
test.each([
  { sessionId: 'cs_other', status: 'open' },
  { sessionId: 'cs_fixture', status: 'completed' },
  { sessionId: 'cs_fixture', status: 'open', customerId: 'cus_other' },
])('review: session facts must match verified observation %#', facts => {
  const a = f.start();
  const proof = f.evidence(a, 'verified_provider_session', {
    sessionId: 'cs_fixture', status: 'open',
  });
  expect(() => f.step(a, 'observe_session', { sessionId: 'cs_fixture', status: 'open',
    ...facts, evidence: { ...proof, ...(facts.customerId ? { customerId: facts.customerId } : {}) } })).toThrow('UNTRUSTED_EVIDENCE');
});
test('review: loaded authority cannot certify a different session', () => {
  const a = f.observe(f.start(), 'completed');
  const settled = f.step(a, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(a, 'verified_authority_commit', { subscriptionId: 'sub_a', sessionId: 'cs_fixture' }) });
  expect(() => validateAttempt({ ...settled, resolutionEvidence: { ...settled.resolutionEvidence, sessionId: 'cs_other' } })).toThrow('INVALID_RESOLUTION');
});
test('review: late session delivery must agree with already committed authority', () => {
  const a = f.start();
  const settled = f.step(a, 'commit_authority', { subscriptionId: 'sub_a',
    evidence: f.evidence(a, 'verified_authority_commit', { subscriptionId: 'sub_a', sessionId: 'cs_expected' }) });
  expect(() => f.observe(settled, 'completed')).toThrow('INVALID_RESOLUTION');
});

test('review: a stale sibling branch cannot replace the accepted predecessor', () => {
  const pair = f.claimedPair();
  const observeCommand = f.command(pair.a, 'observe_session', { sessionId: 'cs_fixture', status: 'completed',
    evidence: f.evidence(pair.a, 'verified_provider_session', { sessionId: 'cs_fixture', status: 'completed' }) });
  const completed = reduceAttempt(pair.a, observeCommand);
  const accepted = reduceCoordinator(pair.c, f.coordCommand(pair.c, completed, 'sync', {
    previousAttempt: pair.a, attemptCommand: observeCommand,
  }));
  const expiredSibling = f.observe(pair.a, 'expired');
  const fork = f.step(expiredSibling, 'settlement_deadline', { at: expiredSibling.settlementDeadline });
  expect(() => reduceCoordinator(accepted, f.coordCommand(accepted, fork, 'sync'))).toThrow('ATTEMPT_ANCESTRY_MISMATCH');
});

test.each(['reserve', 'sync'])('review: %s cannot accept a future attempt snapshot', type => {
  if (type === 'reserve') {
    const a = f.attempt({ at: f.AT + 2000 });
    const c = createCoordinator({ ...f.context, at: f.AT });
    expect(() => reduceCoordinator(c, f.coordCommand(c, a, type, { at: f.AT + 1000 }))).toThrow('INVALID_CLOCK');
  } else {
    const pair = f.claimedPair();
    const a = f.step(pair.a, 'provider_unknown', { at: f.AT + 2000 });
    expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, a, type, { at: f.AT + 1000 }))).toThrow('INVALID_CLOCK');
  }
});

test('review: reserved attempt cannot forge reconciliation without an authorized dispatch', () => {
  const pair = f.initialPair();
  const forged = { ...pair.a, revision: pair.a.revision + 1, previousStateHash: hash(pair.a),
    resolution: 'reconciliation_required' };
  expect(() => validateAttempt(forged)).toThrow('INVALID_RESOLUTION');
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, forged, 'sync'))).toThrow('INVALID_RESOLUTION');
});

test('review: reservation lease cannot outlive its provider session', () => {
  expect(() => f.attempt({ leaseUntil: f.AT + DAY })).toThrow('INVALID_DEADLINE');
});

test('review: unobserved attempt cannot carry an injected provider session ID', () => {
  const initial = f.attempt();
  expect(() => validateAttempt({ ...initial, sessionId: 'cs_injected' })).toThrow('INVALID_SESSION');
});

test('review: coordinator accepts only a reducer-produced successor of its stored predecessor', () => {
  const pair = f.initialPair();
  const attemptCommand = f.command(pair.a, 'authorize_dispatch', {
    retryUntil: f.AT + 60000,
    settlementDeadline: pair.a.sessionExpiresAt + SETTLEMENT_MS,
  });
  const legitimate = reduceAttempt(pair.a, attemptCommand);
  const forged = { ...legitimate, leaseUntil: legitimate.leaseUntil + 1 };
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, forged, 'sync', {
    previousAttempt: pair.a,
    attemptCommand,
  }))).toThrow('INVALID_ATTEMPT_TRANSITION');
});

test('review: coordinator cannot commit dispatch authorization after the reservation lease', () => {
  const pair = f.initialPair();
  const attemptCommand = f.command(pair.a, 'authorize_dispatch', {
    retryUntil: f.AT + 60000,
    settlementDeadline: pair.a.sessionExpiresAt + SETTLEMENT_MS,
  });
  const authorized = reduceAttempt(pair.a, attemptCommand);
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, authorized, 'sync', {
    at: pair.a.leaseUntil,
    previousAttempt: pair.a,
    attemptCommand,
  }))).toThrow('RESERVATION_EXPIRED');
});

test('review: coordinator cannot commit dispatch authorization at the retry cutoff', () => {
  const pair = f.initialPair();
  const retryUntil = f.AT + 60000;
  const attemptCommand = f.command(pair.a, 'authorize_dispatch', {
    retryUntil,
    settlementDeadline: pair.a.sessionExpiresAt + SETTLEMENT_MS,
  });
  const authorized = reduceAttempt(pair.a, attemptCommand);
  expect(() => reduceCoordinator(pair.c, f.coordCommand(pair.c, authorized, 'sync', {
    at: retryUntil,
    previousAttempt: pair.a,
    attemptCommand,
  }))).toThrow('DISPATCH_WINDOW_EXPIRED');
});
