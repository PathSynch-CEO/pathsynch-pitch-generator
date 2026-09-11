'use strict';
const { hash } = require('../services/billing/value');
const { validateBindings } = require('../services/billing/bindings');
const { selectBillingAuthority, replaceBillingAuthority } = require('../services/billing/authoritySelection');
const { reconciliationDecision, canAcknowledgeIssue } = require('../services/billing/reconciliation');
const d = require('../services/billing/disposition');
const f = require('./billingDomain.helpers.cjs');
const binding = documentId => ({ version: 1, ...f.context, documentId, customerId: 'cus_fixture' });
const pair = () => ({ ...f.context, customerId: 'cus_fixture', forward: binding(f.context.accountId), reverse: binding('cus_fixture') });
const sub = (subscriptionId, eventOverrides = {}, stateOverrides = {}) => f.feed(
  [f.event({ subscriptionId, ...eventOverrides })], f.subscription({ subscriptionId, ...stateOverrides }));
const proof = subscriptionId => ({ ...f.context, kind: 'verified_selection', subscriptionId,
  customerId: 'cus_fixture', evidenceId: 'trusted_lineage', basis: 'settled_checkout' });
const select = (subscriptions, selection = null, extra = {}) => selectBillingAuthority({ ...f.authorityInput(subscriptions, selection), ...extra });

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
test.each(['superseded', 'quarantined'])('%s subscription cannot become incumbent from arrival', status => {
  const s = sub('sub_a');
  let pair = f.selectedDisposition(s);
  const replacementSub = sub('sub_b');
  const replacement = f.dispositionStep(d.initializeDisposition(replacementSub, f.AT), replacementSub, 'select', { selection: f.lineage(2) });
  const payload = status === 'quarantined' ? { reason: 'semantic_conflict' } : { replacement: {
    ...f.subIdentity(replacementSub), subscriptionRevision: replacementSub.revision,
    dispositionRevision: replacement.state.revision, dispositionHash: hash(replacement.state), lineage: replacement.state.lineage } };
  pair = f.dispositionStep(pair, s, status === 'quarantined' ? 'quarantine' : 'supersede', payload);
  expect(selectBillingAuthority({ ...f.context, subscriptions: [s], dispositions: [pair],
    selection: f.selectionProof(pair, s), at: f.AT }).billing).toBeNull();
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
  const next = replaceBillingAuthority({ ...f.context, authorities: old }, f.authorityInput([sub('sub_a', { status: 'canceled' })], proof('sub_a')));
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

test.each([
  { accountId: 'foreign' },
  { providerScope: { ...f.providerScope, mode: 'live' } },
  { subscriptionId: '' },
  { customerId: '' },
  { planId: 'invented_plan' },
  { selectionEvidenceId: '' },
])('review: nested billing authority must be valid and scoped %#', changed => {
  const decision = select([sub('sub_a')], proof('sub_a'));
  expect(() => replaceBillingAuthority({ ...f.context, authorities: {} },
    { ...decision, billing: { ...decision.billing, ...changed } })).toThrow('INVALID_SELECTION_CONTEXT');
});
test('review: valid selected billing slot preserves independent grants', () => {
  const decision = select([sub('sub_a')], proof('sub_a'));
  const independent = { operator: { source: 'operator', planId: 'enterprise' } };
  expect(replaceBillingAuthority({ ...f.context, authorities: independent }, f.authorityInput([sub('sub_a')], proof('sub_a')))).toEqual({
    ...independent, billing: decision.billing,
  });
});
test('review: mismatched selection customer rejects the unproven selection', () => {
  expect(() => select([sub('sub_a')], { ...proof('sub_a'), customerId: 'cus_other' })).toThrow('UNPROVEN_SELECTION');
});

test('review: fabricated billing result is not an authority-selection input', () => {
  const forged = { ...f.context, billing: { source: 'billing', planId: 'enterprise',
    subscriptionId: 'sub_fake', customerId: 'cus_fake' } };
  expect(() => replaceBillingAuthority({ ...f.context, authorities: {} }, forged)).toThrow();
});

test('review: forged billing beside empty selection inputs cannot grant authority', () => {
  const input = { ...f.context, subscriptions: [], selection: null, at: f.AT,
    billing: { source: 'billing', planId: 'enterprise', subscriptionId: 'sub_fake', customerId: 'cus_fake' } };
  expect(replaceBillingAuthority({ ...f.context, authorities: {} }, input)).toEqual({});
});
test('review: combined replacement validates ledger account and selection customer', () => {
  const input = f.authorityInput([sub('sub_a')], proof('sub_a'));
  expect(() => replaceBillingAuthority({ ...f.context, authorities: {} },
    { ...input, subscriptions: [{ ...input.subscriptions[0], accountId: 'foreign' }] })).toThrow('SELECTION_IDENTITY_MISMATCH');
  expect(() => replaceBillingAuthority({ ...f.context, authorities: {} },
    { ...input, selection: { ...input.selection, customerId: 'cus_other' } })).toThrow('UNPROVEN_SELECTION');
});

test('review: malformed subscription entries raise a domain error', () => {
  for (const malformed of [null, 7, 'subscription', {}, []]) {
    expect(() => select([malformed])).toThrow('SELECTION_IDENTITY_MISMATCH');
  }
});

test.each(['tenant.user', 'tenant+user', 'tenant/user', 'fixture_\u7528\u6237', 'u'.repeat(128)])('review: custom Firebase UID %s remains a scoped account identity', accountId => {
  const context = { ...f.context, accountId };
  const { createOperation } = require('../services/billing/idempotency');
  const { createAttempt } = require('../services/billing/checkoutAttempt');
  const { createCoordinator, reduceCoordinator } = require('../services/billing/coordinator');
  const op = createOperation({ ...f.operation(), accountId });
  const a = createAttempt({ operation: op, at: f.AT, leaseUntil: f.AT + 1000 });
  const empty = createCoordinator({ ...context, at: f.AT });
  const c = reduceCoordinator(empty, { ...context, type: 'reserve', expectedRevision: 1,
    expectedGeneration: 0, attempt: a, at: f.AT });
  expect(c.accountId).toBe(accountId);
  const b = documentId => ({ ...context, version: 1, documentId, customerId: 'cus_fixture' });
  expect(validateBindings({ ...context, customerId: 'cus_fixture', forward: b(accountId), reverse: b('cus_fixture') }).allowed).toBe(true);
  const event = f.event({ accountId });
  const s = f.feed([{ ...event, evidence: { ...event.evidence, accountId } }], f.subscription({ accountId }));
  const selected = selectBillingAuthority({ ...f.authorityInput([s], proof('sub_a')), ...context });
  expect(selected.billing.accountId).toBe(accountId);
  expect(reconciliationDecision({ ...context, reason: 'unresolved_attempt', resourceIds: ['attempt_a'] }).accountId).toBe(accountId);
  expect(() => selectBillingAuthority({ ...f.context, subscriptions: [s], selection: null, at: f.AT })).toThrow('SELECTION_IDENTITY_MISMATCH');
});
test.each(['', 'u'.repeat(129), null, 42])('review: invalid Firebase UID %# is rejected', accountId => {
  expect(() => f.operation({ accountId })).toThrow('INVALID_OPERATION_IDENTITY');
});

test('review: operator UID uses the account grammar while provider IDs remain constrained', () => {
  const a = f.start();
  expect(f.step(a, 'settle_no_purchase', { evidence: f.evidence(a, 'operator_no_purchase',
    { actorId: 'operator.fixture', dispatchQuiesced: true, noPayablePurchase: true }) }).resolution).toBe('no_purchase');
  expect(() => f.operation({ providerScope: { ...f.providerScope, accountId: 'invalid.provider' } })).toThrow('INVALID_OPERATION_IDENTITY');
});
