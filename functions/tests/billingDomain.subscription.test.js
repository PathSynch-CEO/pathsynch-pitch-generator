'use strict';
const { reduceSubscription, validateSubscription } = require('../services/billing/subscription');
const { selectBillingAuthority } = require('../services/billing/authoritySelection');
const f = require('./billingDomain.helpers.cjs');
const apply = events => f.feed(events);
const allOrders = values => f.permutations(values).map(events => [events.map(e => e.eventId).join(','), events]);

test('BILLING-004/006: receipt is separate; duplicate verified event is idempotent', () => {
  const e = f.event();
  const first = reduceSubscription(f.subscription(), e);
  const again = reduceSubscription(first.state, e, first.receipt);
  expect(again.state).toEqual(first.state);
  expect(again.receipt).toEqual(first.receipt);
  expect(again.action).toBe('duplicate');
  expect(first.state).not.toHaveProperty('receipt');
  expect(first.receipt).not.toHaveProperty('authority');
});
test('review: replay rejects malformed receipt actions and extra authority fields', () => {
  const event = f.event();
  const first = reduceSubscription(f.subscription(), event);
  const { action, ...missingAction } = first.receipt;
  for (const malformed of [missingAction, { ...first.receipt, action: 'authority_committed' },
    { ...first.receipt, action: 'superseded_receipted' },
    { ...first.receipt, authority: { planId: 'enterprise' } }]) {
    expect(() => reduceSubscription(first.state, event, malformed)).toThrow('RECEIPT_MISMATCH');
  }
});
test('reused event ID with different data fails, including external receipt replay', () => {
  const e = f.event(); const first = reduceSubscription(f.subscription(), e);
  const altered = f.event({ planId: 'enterprise' });
  expect(() => reduceSubscription(first.state, altered)).toThrow('EVENT_ID_REUSED');
  expect(() => reduceSubscription(first.state, altered, first.receipt)).toThrow('RECEIPT_MISMATCH');
});
test('review: persisted subscription semantics remain bound to retained provider evidence', () => {
  const state = apply([f.event({ status: 'canceled', planId: 'starter' })]);
  const semantic = { ...state.acceptedSemantic, status: 'active', planId: 'enterprise' };
  const observation = { ...state.observations[0], semantic, rank: 1 };
  const forged = { ...state, observations: [observation], tombstone: null,
    acceptedSemantic: semantic, acceptedRank: 1, lifecycleState: 'active', conflict: null };
  expect(() => validateSubscription(forged)).toThrow('UNTRUSTED_EVIDENCE');
});
test('review: malformed loaded observations raise a stable domain error', () => {
  const state = apply([f.event()]);
  for (const malformed of [null, 7, 'observation', {}, []]) {
    expect(() => validateSubscription({ ...state, observations: [malformed] })).toThrow('INVALID_OBSERVATION');
  }
});
test('review: irreversible terminal history cannot be omitted after a newer granting event', () => {
  const terminalEvent = f.event({ eventId: 'evt_terminal', status: 'canceled' });
  const terminal = reduceSubscription(f.subscription(), terminalEvent);
  const state = reduceSubscription(terminal.state,
    f.event({ eventId: 'evt_later', created: f.SECOND + 1 })).state;
  expect(state.tombstone.evidence).toEqual(terminalEvent.evidence);
  expect(state.observations[0].terminalEvidence).toEqual(terminalEvent.evidence);
  const forged = { ...state, tombstone: null, lifecycleState: 'active', conflict: null };
  expect(() => validateSubscription(forged)).toThrow('UNTRUSTED_EVIDENCE');
  expect(() => validateSubscription({ ...state,
    tombstone: { ...state.tombstone, status: 'incomplete_expired' } })).toThrow('INVALID_TOMBSTONE');
  expect(reduceSubscription(state, terminalEvent, terminal.receipt)).toMatchObject({
    state, receipt: terminal.receipt, action: 'duplicate', requiresAtomicCommit: false,
  });
});
test('stale webhook receipts without rolling current state backward', () => {
  const current = apply([f.event({ created: f.SECOND + 10 })]);
  const stale = reduceSubscription(current, f.event({ eventId: 'evt_older', status: 'incomplete', created: f.SECOND }));
  expect(stale.state).toEqual(current);
  expect(stale.action).toBe('stale');
  expect(stale.receipt.action).toBe('stale');
});
test.each(allOrders([f.event({ eventId: 'evt_1' }), f.event({ eventId: 'evt_2' }), f.event({ eventId: 'evt_3' })]))(
  'equivalent same-second events converge: %s', (_, events) => {
    const state = apply(events);
    expect(state).toEqual(apply([...events].reverse()));
    expect(state.lifecycleState).toBe('active');
    expect(state.conflict).toBeNull();
    expect(state.acceptedEventId).toBe('evt_3');
  });
const conflicts = [
  ['plan', { planId: 'growth' }],
  ['incomplete', { status: 'incomplete' }],
  ['scheduled cancellation', { cancelAtPeriodEnd: true, periodEnd: f.SECOND + 300 }],
  ['paused', { status: 'paused' }],
  ['unpaid', { status: 'unpaid' }],
];
test.each(conflicts)('conflicting %s same-second evidence reconciles in both orders', (_, override) => {
  const a = f.event({ eventId: 'evt_a' });
  const b = f.event({ eventId: 'evt_b', ...override });
  expect(apply([a, b])).toEqual(apply([b, a]));
  expect(apply([a, b]).conflict).toBe('same_second_conflict');
  expect(apply([a, b]).lifecycleState).toBe('reconciliation_required');
});
const triple = [f.event({ eventId: 'evt_z', status: 'active' }),
  f.event({ eventId: 'evt_a', status: 'incomplete' }),
  f.event({ eventId: 'evt_m', cancelAtPeriodEnd: true, periodEnd: f.SECOND + 600 })];
test.each(allOrders(triple))('third event cannot erase same-second conflict: %s', (_, events) => {
  expect(apply(events)).toEqual(apply(triple));
  expect(apply(events).conflict).toBe('same_second_conflict');
});
test.each(['paused', 'unpaid'])('BILLING-018: %s can recover with strictly newer active evidence', status => {
  const a = f.event({ status, eventId: 'evt_older' });
  const b = f.event({ eventId: 'evt_newer', created: f.SECOND + 1 });
  const state = apply([a, b]);
  expect(state.lifecycleState).toBe('active');
  expect(state.tombstone).toBeNull();
  expect(state).toEqual(apply([b, a]));
});
test('strictly newer coherent nonterminal evidence resolves same-subscription conflict', () => {
  const state = apply([...triple, f.event({ eventId: 'evt_later', created: f.SECOND + 1, planId: 'growth' })]);
  expect(state.conflict).toBeNull();
  expect(state.lifecycleState).toBe('active');
  expect(state.acceptedSemantic.planId).toBe('growth');
});
test.each(['canceled', 'incomplete_expired'])('irreversible %s dominates same-second granting in either order', status => {
  const a = f.event({ eventId: 'evt_terminal', status });
  const b = f.event({ eventId: 'evt_granting' });
  expect(apply([a, b])).toEqual(apply([b, a]));
  expect(apply([a, b]).lifecycleState).toBe('terminated');
});
const resurrection = [f.event({ eventId: 'evt_terminal', status: 'canceled', created: f.SECOND + 1 }),
  f.event({ eventId: 'evt_later', created: f.SECOND + 2 }),
  f.event({ eventId: 'evt_initial', created: f.SECOND })];
test.each(allOrders(resurrection))('terminal never reopens despite out-of-order resurrection: %s', (_, events) => {
  expect(apply(events)).toEqual(apply(resurrection));
  expect(apply(events).lifecycleState).toBe('terminated');
  expect(apply(events).conflict).toBe('terminal_resurrection');
});
test('BILLING-005: terminal receipt updates only its subscription, never the replacement selection', () => {
  const old = f.subscription();
  const received = reduceSubscription(old, f.event({ status: 'canceled' }));
  expect(received.action).toBe('observed');
  expect(received.state).not.toHaveProperty('disposition');
  const replacement = f.feed([f.event({ subscriptionId: 'sub_new' })], f.subscription({ subscriptionId: 'sub_new' }));
  const intent = { subscriptionId: 'sub_new' };
  const before = selectBillingAuthority(f.authorityInput([replacement], intent));
  const after = selectBillingAuthority(f.authorityInput([replacement, received.state], intent));
  expect(after).toEqual(before);
});
test.each([
  { accountId: 'foreign' }, { customerId: 'cus_foreign' }, { subscriptionId: 'sub_foreign' },
  { providerScope: { ...f.providerScope, mode: 'live' } },
  { providerScope: { ...f.providerScope, accountId: 'acct_foreign' } },
])('BILLING-003/016: observation cannot cross binding/provider scope %#', change => {
  expect(() => reduceSubscription(f.subscription(), f.event(change))).toThrow('SUBSCRIPTION_IDENTITY_MISMATCH');
});
test('unsigned normalized evidence is rejected', () => {
  const e = f.event(); delete e.evidence;
  expect(() => reduceSubscription(f.subscription(), e)).toThrow('UNTRUSTED_EVIDENCE');
});
test.each([
  { subscriptionId: 'sub_foreign' },
  { customerId: 'cus_foreign' },
])('verified event evidence cannot attest a different provider object %#', evidenceChange => {
  const e = f.event();
  e.evidence = { ...e.evidence, subscriptionId: e.subscriptionId, customerId: e.customerId, ...evidenceChange };
  expect(() => reduceSubscription(f.subscription(), e)).toThrow('UNTRUSTED_EVIDENCE');
});
test.each([
  { status: 'canceled' },
  { planId: 'enterprise' },
  { cancelAtPeriodEnd: true, periodEnd: f.SECOND + 300 },
  { periodEnd: f.SECOND + 300 },
  { created: f.SECOND + 1 },
])('verified event evidence cannot be paired with changed semantics %#', semanticChange => {
  const verified = f.event();
  const tampered = { ...verified, ...semanticChange, evidence: verified.evidence };
  expect(() => reduceSubscription(f.subscription(), tampered)).toThrow('UNTRUSTED_EVIDENCE');
});
test('tampered summary cannot invent active state', () => {
  const state = apply([f.event({ status: 'canceled' })]);
  expect(() => validateSubscription({ ...state, lifecycleState: 'active', tombstone: null })).toThrow('UNTRUSTED_EVIDENCE');
});
test('deterministic period-end cutoff is represented without a system clock', () => {
  const state = apply([f.event({ cancelAtPeriodEnd: true, periodEnd: f.SECOND + 100 })]);
  expect(state.acceptedSemantic.periodEnd).toBe(f.SECOND + 100);
});
