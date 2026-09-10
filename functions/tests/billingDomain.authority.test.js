'use strict';
const { hash } = require('../services/billing/value');
const { validateBindings } = require('../services/billing/bindings');
const { selectBillingAuthority, replaceBillingAuthority } = require('../services/billing/authoritySelection');
const { reconciliationDecision, canAcknowledgeIssue } = require('../services/billing/reconciliation');
const f = require('./billingDomain.helpers.cjs');
const binding = documentId => ({ version: 1, ...f.context, documentId, customerId: 'cus_fixture' });
const pair = () => ({ ...f.context, customerId: 'cus_fixture', forward: binding(f.context.accountId), reverse: binding('cus_fixture') });
const sub = (subscriptionId, eventOverrides = {}, stateOverrides = {}) => f.feed(
  [f.event({ subscriptionId, ...eventOverrides })], f.subscription({ subscriptionId, ...stateOverrides }));
const proof = subscriptionId => ({ ...f.context, kind: 'verified_selection', subscriptionId,
  customerId: 'cus_fixture', evidenceId: 'trusted_lineage', basis: 'settled_checkout' });
const select = (subscriptions, selection = null, extra = {}) => selectBillingAuthority({ ...f.context, subscriptions, selection, at: f.AT, ...extra });

test('BILLING-007/008: optional profile is irrelevant to agreeing protected pair', () => {
  expect(validateBindings(pair()).allowed).toBe(true);
  for (const profile of [null, {}, { stripeCustomerId: 'cus_foreign', plan: 'enterprise' }]) {
    expect(validateBindings({ ...pair(), profile })).toEqual(validateBindings(pair()));
  }
});
test.each(['forward', 'reverse'])('missing %s fails protected access', direction => {
  const b = pair(); delete b[direction];
  expect(validateBindings(b)).toMatchObject({ allowed: false, issue: 'binding_mismatch', missing: direction });
});
test.each(['forward', 'reverse'])('cross-account %s binding cannot be reused', direction => {
  const b = pair(); b[direction].accountId = 'foreign';
  expect(validateBindings(b).allowed).toBe(false);
});
test.each(['forward', 'reverse'])('wrong document ID or scope in %s is not a valid pair', direction => {
  const b = pair(); b[direction].documentId = 'wrong';
  expect(validateBindings(b).allowed).toBe(false);
  b[direction] = { ...binding(direction === 'forward' ? f.context.accountId : 'cus_fixture'), providerScope: { ...f.providerScope, mode: 'live' } };
  expect(validateBindings(b).allowed).toBe(false);
});
test('trusted new-customer result permits atomic bootstrap, not immediate provider access', () => {
  const context = { ...f.context, customerId: 'cus_fixture' };
  expect(validateBindings(context)).toMatchObject({ allowed: false, issue: 'legacy_unproven_lineage' });
  const bootstrap = { ...context, kind: 'trusted_customer_create_result', operationId: 'op_fixture', attemptId: 'attempt_fixture' };
  expect(validateBindings({ ...context, bootstrap })).toMatchObject({ allowed: false, mayCreatePairAtomically: true });
  expect(validateBindings({ ...context, bootstrap: { ...bootstrap, accountId: 'foreign' } }).mayCreatePairAtomically).toBe(false);
});
test('signed legacy metadata alone does not bootstrap missing protected pair', () => {
  expect(validateBindings({ ...f.context, customerId: 'cus_fixture', bootstrap: {
    ...f.context, kind: 'verified_provider_event', operationId: 'evt_fixture', attemptId: 'attempt_fixture', customerId: 'cus_fixture' },
  }).allowed).toBe(false);
});
test('one proven incumbent is selected by lineage, not plan rank', () => {
  const decision = select([sub('sub_a', { planId: 'growth' })], proof('sub_a'));
  expect(decision.billing).toMatchObject({ subscriptionId: 'sub_a', planId: 'growth' });
});
test.each(f.permutations(['a', 'b']))('BILLING-010/013: challenger order %j preserves proven incumbent', (first, second) => {
  const byId = { a: sub('sub_a', { planId: 'growth', created: f.SECOND - 1, eventId: 'evt_aaa' }),
    b: sub('sub_b', { planId: 'enterprise', created: f.SECOND + 10, eventId: 'evt_zzz' }) };
  const decision = select([byId[first], byId[second]], proof('sub_a'));
  expect(decision.billing).toMatchObject({ subscriptionId: 'sub_a', planId: 'growth' });
  expect(decision.issues[0].reason).toBe('second_active_subscription');
  expect(decision.issues[0].operatorRequired).toBe(true);
});
test.each(f.permutations(['a', 'b']))('two active subscriptions without proven incumbent never choose first: %j', (first, second) => {
  const decision = select([sub('sub_' + first), sub('sub_' + second)]);
  expect(decision.billing).toBeNull();
  expect(decision.issues[0].reason).toBe('second_active_subscription');
});
test('a single active subscription without lineage is reconciliation, not guessed authority', () => {
  expect(select([sub('sub_a')])).toMatchObject({ billing: null, checkoutBlocked: true });
});
test('canceled incumbent cannot silently promote active challenger', () => {
  const decision = select([sub('sub_a', { status: 'canceled' }), sub('sub_b')], proof('sub_a'));
  expect(decision.billing).toBeNull();
  expect(decision.issues[0].reason).toBe('second_active_subscription');
});
test('same-subscription conflicted evidence cannot grant even with valid ownership proof', () => {
  const conflict = f.feed([f.event(), f.event({ eventId: 'evt_b', planId: 'growth' })]);
  const decision = select([conflict], proof('sub_a'));
  expect(decision.billing).toBeNull();
  expect(decision.issues.map(i => i.reason)).toContain('same_second_conflict');
});
test.each(['superseded', 'quarantined'])('%s subscription cannot become incumbent from arrival', disposition => {
  expect(select([sub('sub_a', {}, { disposition })], proof('sub_a')).billing).toBeNull();
});
test('period-end cancellation revokes billing at the boundary', () => {
  const state = sub('sub_a', { cancelAtPeriodEnd: true, periodEnd: f.SECOND + 30 });
  expect(select([state], proof('sub_a'), { at: f.AT + 29999 }).billing).not.toBeNull();
  expect(select([state], proof('sub_a'), { at: f.AT + 30000 }).billing).toBeNull();
});
test('BILLING-014: billing cancellation preserves every independent authority and branding grant', () => {
  const independent = { operator: { source: 'operator', planId: 'enterprise', actorId: 'operator_fixture' },
    promotion: { source: 'promotion', planId: 'scale' }, legacy_migration: { source: 'legacy_migration', planId: 'growth' } };
  const old = { ...independent, billing: { source: 'billing', planId: 'scale' } };
  const branding = Object.freeze({ grantId: 'branding_fixture', source: 'operator', feature: 'custom_branding' });
  const next = replaceBillingAuthority({ ...f.context, authorities: old }, select([sub('sub_a', { status: 'canceled' })], proof('sub_a')));
  expect(next).toEqual(independent);
  expect(branding).toEqual({ grantId: 'branding_fixture', source: 'operator', feature: 'custom_branding' });
  expect(old.billing.planId).toBe('scale');
});
test('foreign selection cannot mutate the account billing slot', () => {
  const foreign = { ...select([], null), accountId: 'foreign' };
  expect(() => replaceBillingAuthority({ ...f.context, authorities: {} }, foreign)).toThrow('SELECTION_IDENTITY_MISMATCH');
});
test.each(['second_active_subscription', 'binding_mismatch', 'same_second_conflict', 'unknown_provider_outcome',
  'unresolved_attempt', 'legacy_unproven_lineage', 'terminal_resurrection'])('reconciliation %s has deterministic ownership and blocking policy', reason => {
  const a = reconciliationDecision({ ...f.context, reason, resourceIds: ['sub_b', 'sub_a', 'sub_a'] });
  const b = reconciliationDecision({ ...f.context, reason, resourceIds: ['sub_a', 'sub_b'] });
  expect(a).toEqual(b);
  expect(a.blockingEffect).toBe('block_new_checkout');
  expect(a.recovery.owner).toBe('billing_operations');
});
test('BILLING-017: unresolved event acknowledgment requires a receipt for this issue AND event', () => {
  const issue = reconciliationDecision({ ...f.context, reason: 'unknown_provider_outcome', resourceIds: ['attempt_a'] });
  const event = { eventId: 'evt_fixture', eventHash: hash({ fixture: true }) };
  const proofOfCommit = { kind: 'committed_issue_and_event_receipt', issueId: issue.issueId,
    issueHash: hash(issue), ...event, recovery: issue.recovery };
  expect(canAcknowledgeIssue(issue, event, null)).toBe(false);
  expect(canAcknowledgeIssue(issue, event, proofOfCommit)).toBe(true);
  expect(canAcknowledgeIssue(issue, { ...event, eventId: 'evt_other' }, proofOfCommit)).toBe(false);
});

test('missing selected subscription ledger blocks checkout rather than inferring no active subscription', () => {
  expect(select([], proof('sub_missing'))).toMatchObject({ billing: null, checkoutBlocked: true });
});
test.each(['paused', 'unpaid', 'incomplete'])('non-granting %s still represents a potentially resumable purchase', status => {
  expect(select([sub('sub_a', { status })], proof('sub_a'))).toMatchObject({ billing: null, checkoutBlocked: true });
});
