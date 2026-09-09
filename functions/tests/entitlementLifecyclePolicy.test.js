'use strict';

process.env.STRIPE_SECRET_KEY = 'synthetic-test-key';
jest.mock('firebase-admin');
jest.unmock('stripe');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const stripeApi = require('../api/stripe');
const { PLANS } = require('../config/stripe');
const { resolveAuthority } = require('../services/entitlementAuthority');
const { hasFeatureGrant } = require('../services/featureGrants');
const { resolveBrand } = require('../services/brandResolver');
const { assignment, seed } = require('./helpers/entitlementFixtures');
const { workspaceState } = require('../services/workspaceEntitlements');

const UID = 'billing-owner';
const CUSTOMER = 'cus_fixture';
const SUBSCRIPTION = 'sub_fixture';
const BASE = Math.floor(Date.now() / 1000) - 300;

function subscription(plan = 'scale', overrides = {}) {
  return {
    id: SUBSCRIPTION, customer: CUSTOMER, status: 'active', cancel_at_period_end: false,
    current_period_start: BASE - 1000, current_period_end: BASE + 3600,
    metadata: { firebaseUserId: UID },
    items: { data: [{ price: { id: PLANS[plan].stripePriceId } }] },
    ...overrides,
  };
}

function event(id, created, plan = 'scale', overrides = {}, type = 'customer.subscription.updated') {
  return { id, created, type, data: { object: subscription(plan, overrides) } };
}

function record() { return admin._mockData.collections.accountPlanAssignments?.[UID]; }
function effective(at = BASE + 1000) { return resolveAuthority(record(), UID, new Date(at * 1000)); }
function grant(scope = 'workspace-a', overrides = {}) {
  return {
    schemaVersion: 1, grantId: 'branding-1', scopeType: 'workspace', scopeId: scope,
    feature: 'custom_branding', source: 'operator', actorUid: 'fixture-operator',
    grantedAt: new Date((BASE - 100) * 1000), expiresAt: null, revokedAt: null,
    reason: 'Contract exception', ...overrides,
  };
}
function nonBillingAuthority(source, planId, revision, authorityId = source) {
  return { source, authorityId, subjectUid: UID, planId, status: 'active', actorUid: 'fixture-operator',
    revision, effectiveAt: new Date((BASE - 100) * 1000), expiresAt: null, revokedAt: null };
}

beforeEach(() => {
  admin._resetMockData();
  admin._setMockCollection('users', { [UID]: { stripeCustomerId: CUSTOMER, email: 'billing@example.test' } });
});

test('verified billing upgrade creates and revises only billing authority', async () => {
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_001', BASE, 'growth').data.object, event('evt_001', BASE, 'growth'));
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_002', BASE + 10, 'scale').data.object, event('evt_002', BASE + 10, 'scale'));
  expect(effective().plan).toBe('scale');
  expect(record().authorities.billing).toMatchObject({ source: 'billing', provider: 'stripe', planId: 'scale', lastEventId: 'evt_002' });
  expect(record().revision).toBe(2);
  expect(Object.keys(admin._mockData.collections[`accountPlanAssignments/${UID}/history`])).toEqual(['1', '2']);
});

test('real Stripe signature verification applies a signed subscription update', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'synthetic-webhook-secret';
  const verified = event('evt_signed', BASE, 'scale');
  const payload = JSON.stringify(verified);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await stripeApi.handleWebhook({ headers: { 'stripe-signature': signature }, rawBody: Buffer.from(payload) }, res);
  expect(res.status).toHaveBeenCalledWith(200); expect(effective().plan).toBe('scale');
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('provider-scheduled downgrade retains the current plan until Stripe emits the effective object', async () => {
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_010', BASE, 'scale').data.object, event('evt_010', BASE, 'scale'));
  const scheduled = event('evt_011', BASE + 10, 'scale', { schedule: 'sub_sched_fixture' });
  await stripeApi._applyBillingAuthorityEvent(UID, scheduled.data.object, scheduled);
  expect(effective(BASE + 20).plan).toBe('scale');
  const effectiveEvent = event('evt_012', BASE + 100, 'growth', { schedule: 'sub_sched_fixture' });
  await stripeApi._applyBillingAuthorityEvent(UID, effectiveEvent.data.object, effectiveEvent);
  expect(effective(BASE + 101).plan).toBe('growth');
  expect(record().authorities.billing.effectiveAt.toDate().getTime()).toBe((BASE + 100) * 1000);
});

test('pending update cannot change authority before Stripe confirms it', async () => {
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_020', BASE, 'scale').data.object, event('evt_020', BASE, 'scale'));
  const pending = event('evt_021', BASE + 1, 'growth', { pending_update: { expires_at: BASE + 500 } });
  expect((await stripeApi._applyBillingAuthorityEvent(UID, pending.data.object, pending)).action).toBe('pending');
  expect(effective().plan).toBe('scale');
});

test('cancel at period end retains access until the provider end and then expires', async () => {
  const end = BASE + 600;
  const scheduled = event('evt_030', BASE, 'scale', { cancel_at_period_end: true, current_period_end: end });
  await stripeApi._applyBillingAuthorityEvent(UID, scheduled.data.object, scheduled);
  expect(effective(end - 1).plan).toBe('scale');
  expect(effective(end).plan).toBeNull();
});

test('terminal cancellation revokes billing authority but preserves operator authority', async () => {
  admin._setMockCollection('accountPlanAssignments', { [UID]: assignment(UID, 'enterprise') });
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_040', BASE, 'scale').data.object, event('evt_040', BASE, 'scale'));
  const deleted = event('evt_041', BASE + 5, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  await stripeApi._applyBillingAuthorityEvent(UID, deleted.data.object, deleted);
  expect(effective().plan).toBe('enterprise');
  expect(record().authorities.operator.status).toBe('active');
  expect(record().authorities.billing.status).toBe('revoked');
  expect(admin._mockData.collections.users[UID].plan).toBe('enterprise');
});

test('terminal cancellation removes paid access when billing is the only authority', async () => {
  await stripeApi._applyBillingAuthorityEvent(UID, event('evt_045', BASE, 'scale').data.object, event('evt_045', BASE, 'scale'));
  const deleted = event('evt_046', BASE + 5, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  await stripeApi._applyBillingAuthorityEvent(UID, deleted.data.object, deleted);
  expect(effective().plan).toBeNull();
});

test('past_due is grace state and does not prematurely revoke paid access', async () => {
  const pastDue = event('evt_050', BASE, 'scale', { status: 'past_due' });
  await stripeApi._applyBillingAuthorityEvent(UID, pastDue.data.object, pastDue);
  expect(effective().plan).toBe('scale');
});

test('invoice payment failure alone cannot mutate plan authority or legacy status', async () => {
  const active = event('evt_050_active', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, active.data.object, active);
  const before = JSON.parse(JSON.stringify(admin._mockData.collections.users[UID]));
  process.env.STRIPE_WEBHOOK_SECRET = 'synthetic-webhook-secret';
  const failed = { id: 'evt_invoice_failed', created: BASE + 1, type: 'invoice.payment_failed',
    data: { object: { id: 'in_fixture', customer: CUSTOMER } } };
  const payload = JSON.stringify(failed);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await stripeApi.handleWebhook({ headers: { 'stripe-signature': signature }, rawBody: Buffer.from(payload) }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(record().revision).toBe(1); expect(effective().plan).toBe('scale');
  expect(JSON.parse(JSON.stringify(admin._mockData.collections.users[UID]))).toEqual(before);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('duplicate and replayed event are idempotent and preserve one revision history entry', async () => {
  const upgrade = event('evt_060', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, upgrade.data.object, upgrade);
  expect((await stripeApi._applyBillingAuthorityEvent(UID, upgrade.data.object, upgrade)).action).toBe('duplicate');
  expect(record().revision).toBe(1);
  expect(Object.keys(admin._mockData.collections[`accountPlanAssignments/${UID}/history`])).toEqual(['1']);
});

test('stale event cannot supersede newer billing revision', async () => {
  const newer = event('evt_071', BASE + 20, 'growth'), older = event('evt_070', BASE + 10, 'enterprise');
  await stripeApi._applyBillingAuthorityEvent(UID, newer.data.object, newer);
  expect((await stripeApi._applyBillingAuthorityEvent(UID, older.data.object, older)).action).toBe('stale');
  expect(effective().plan).toBe('growth');
  expect(record().revision).toBe(1);
});

test('out-of-order events converge to the same provider-timestamp result', async () => {
  const older = event('evt_080', BASE, 'enterprise'), newer = event('evt_081', BASE + 10, 'growth');
  await stripeApi._applyBillingAuthorityEvent(UID, newer.data.object, newer);
  await stripeApi._applyBillingAuthorityEvent(UID, older.data.object, older);
  const reversePlan = effective().plan;
  admin._resetMockData(); admin._setMockCollection('users', { [UID]: { stripeCustomerId: CUSTOMER } });
  await stripeApi._applyBillingAuthorityEvent(UID, older.data.object, older);
  await stripeApi._applyBillingAuthorityEvent(UID, newer.data.object, newer);
  expect(effective().plan).toBe(reversePlan); expect(reversePlan).toBe('growth');
});

test('same-second conflicting plan updates converge to denied reconciliation state', async () => {
  const lower = event('evt_same_a', BASE, 'enterprise'), higher = event('evt_same_b', BASE, 'growth');
  await stripeApi._applyBillingAuthorityEvent(UID, higher.data.object, higher);
  await stripeApi._applyBillingAuthorityEvent(UID, lower.data.object, lower);
  const reversePlan = effective().plan;
  const reverseAuthority = record().authorities.billing;
  admin._resetMockData(); admin._setMockCollection('users', { [UID]: { stripeCustomerId: CUSTOMER } });
  await stripeApi._applyBillingAuthorityEvent(UID, lower.data.object, lower);
  await stripeApi._applyBillingAuthorityEvent(UID, higher.data.object, higher);
  expect(effective().plan).toBe(reversePlan); expect(reversePlan).toBeNull();
  expect(record().authorities.billing).toMatchObject({ status: 'revoked', providerStatus: 'reconciliation_required' });
  expect(record().authorities.billing).toMatchObject({
    planId: reverseAuthority.planId, lastEventId: reverseAuthority.lastEventId,
    lastEventSemantic: 'ambiguous_same_second',
  });
});

test.each([
  ['created then updated', 'customer.subscription.created', 'evt_equivalent_a', 'customer.subscription.updated', 'evt_equivalent_b'],
  ['updated then created', 'customer.subscription.updated', 'evt_equivalent_b', 'customer.subscription.created', 'evt_equivalent_a'],
])('same-second equivalent lifecycle state remains active: %s', async (_label, firstType, firstId, secondType, secondId) => {
  const first = event(firstId, BASE, 'scale', {}, firstType);
  const second = event(secondId, BASE, 'scale', {}, secondType);
  await stripeApi._applyBillingAuthorityEvent(UID, first.data.object, first);
  await stripeApi._applyBillingAuthorityEvent(UID, second.data.object, second);
  expect(effective().plan).toBe('scale');
  expect(record().authorities.billing).toMatchObject({ status: 'active', providerStatus: 'active' });
});

test('reconciliation-required state stays denied through further same-class events in that provider second', async () => {
  const first = event('evt_same_a', BASE, 'enterprise');
  const second = event('evt_same_b', BASE, 'growth');
  const third = event('evt_same_c', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, first.data.object, first);
  await stripeApi._applyBillingAuthorityEvent(UID, second.data.object, second);
  expect((await stripeApi._applyBillingAuthorityEvent(UID, third.data.object, third)).action).toBe('stale');
  expect(effective().plan).toBeNull();
  expect(record().authorities.billing).toMatchObject({ status: 'revoked', providerStatus: 'reconciliation_required' });
});

test('same-second rank-2 cancellation schedule cannot reopen reconciliation-required authority', async () => {
  const first = event('evt_rank_a', BASE, 'enterprise');
  const conflicting = event('evt_rank_b', BASE, 'growth');
  const scheduledCancellation = event('evt_rank_c', BASE, 'scale', { cancel_at_period_end: true });
  await stripeApi._applyBillingAuthorityEvent(UID, first.data.object, first);
  await stripeApi._applyBillingAuthorityEvent(UID, conflicting.data.object, conflicting);
  expect((await stripeApi._applyBillingAuthorityEvent(UID, scheduledCancellation.data.object, scheduledCancellation)).action).toBe('stale');
  expect(effective().plan).toBeNull();
  expect(record().authorities.billing).toMatchObject({ status: 'revoked', providerStatus: 'reconciliation_required' });
});
test('same-second terminal state wins over granting state in either delivery order', async () => {
  const active = event('evt_same_z_active', BASE, 'scale');
  const canceled = event('evt_same_a_canceled', BASE, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  await stripeApi._applyBillingAuthorityEvent(UID, canceled.data.object, canceled);
  await stripeApi._applyBillingAuthorityEvent(UID, active.data.object, active);
  expect(effective().plan).toBeNull();
  admin._resetMockData(); admin._setMockCollection('users', { [UID]: { stripeCustomerId: CUSTOMER } });
  await stripeApi._applyBillingAuthorityEvent(UID, active.data.object, active);
  await stripeApi._applyBillingAuthorityEvent(UID, canceled.data.object, canceled);
  expect(effective().plan).toBeNull();
  expect(record().authorities.billing.lastEventId).toBe('evt_same_a_canceled');
});

test('operator and billing grants coexist; highest active canonical plan wins without overwrite', async () => {
  admin._setMockCollection('accountPlanAssignments', { [UID]: assignment(UID, 'enterprise') });
  const billing = event('evt_090', BASE, 'starter');
  await stripeApi._applyBillingAuthorityEvent(UID, billing.data.object, billing);
  expect(effective().plan).toBe('enterprise');
  expect(Object.keys(record().authorities).sort()).toEqual(['billing', 'operator']);
  expect(admin._mockData.collections.users[UID].plan).toBe('enterprise');
});

test('promotion and legacy-migration authorities retain provenance under explicit plan precedence', () => {
  const protectedRecord = { schemaVersion: 2, subjectUid: UID, revision: 3, authorities: {
    operator: nonBillingAuthority('operator', 'scale', 1),
    promotion: nonBillingAuthority('promotion', 'enterprise', 2, 'promotion:fixture'),
    legacy_migration: nonBillingAuthority('legacy_migration', 'growth', 3, 'legacy:fixture'),
  } };
  const resolved = resolveAuthority(protectedRecord, UID, new Date((BASE + 1) * 1000));
  expect(resolved.plan).toBe('enterprise');
  expect(resolved.selected.source).toBe('promotion');
  expect(Object.keys(protectedRecord.authorities)).toEqual(['operator', 'promotion', 'legacy_migration']);
  protectedRecord.authorities.operator.planId = 'enterprise';
  expect(resolveAuthority(protectedRecord, UID, new Date((BASE + 1) * 1000)).selected.source).toBe('operator');
});

test('billing cancellation cannot revoke an independent branding grant', async () => {
  admin._setMockCollection('workspaceFeatureGrants/workspace-a/grants', { 'branding-1': grant() });
  const billing = event('evt_100', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, billing.data.object, billing);
  const deleted = event('evt_101', BASE + 1, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  await stripeApi._applyBillingAuthorityEvent(UID, deleted.data.object, deleted);
  expect(await hasFeatureGrant(admin.firestore(), null, 'workspace', 'workspace-a', 'custom_branding')).toBe(true);
});

test('cross-account billing metadata cannot mutate another subject', async () => {
  admin._setMockCollection('users', { [UID]: { stripeCustomerId: CUSTOMER }, victim: { stripeCustomerId: 'cus_victim' } });
  admin._setMockCollection('billingCustomerBindings', { [CUSTOMER]: {
    schemaVersion: 1, provider: 'stripe', providerCustomerId: CUSTOMER, subjectUid: UID,
  } });
  admin._setMockCollection('billingAccountBindings', { [UID]: {
    schemaVersion: 1, provider: 'stripe', providerCustomerId: CUSTOMER, subjectUid: UID,
  } });
  const forged = event('evt_110', BASE, 'enterprise', { metadata: { firebaseUserId: 'victim' } });
  await expect(stripeApi._handleSubscriptionUpdate(forged)).rejects.toThrow('BILLING_SUBJECT_MISMATCH');
  expect(record()).toBeUndefined();
});

test('client-editable customer projection cannot block or redirect a signed subject', async () => {
  admin._setMockCollection('users', { [UID]: { stripeCustomerId: 'client-forged-customer' } });
  const verified = event('evt_110_projection', BASE, 'scale');
  await stripeApi._handleSubscriptionUpdate(verified);
  expect(effective().plan).toBe('scale');
  expect(admin._mockData.collections.billingCustomerBindings[CUSTOMER]).toMatchObject({
    providerCustomerId: CUSTOMER, subjectUid: UID, provider: 'stripe',
  });
  expect(admin._mockData.collections.billingAccountBindings[UID]).toMatchObject({
    providerCustomerId: CUSTOMER, subjectUid: UID, provider: 'stripe',
  });
});

test('verified event without immutable subscription subject metadata cannot create authority', async () => {
  const unbound = event('evt_111', BASE, 'enterprise', { metadata: {} });
  await expect(stripeApi._handleSubscriptionUpdate(unbound)).rejects.toThrow('BILLING_SUBJECT_UNRESOLVED');
  expect(record()).toBeUndefined();
});

test('unverified webhook cannot create authority', async () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await stripeApi.handleWebhook({ headers: {}, rawBody: Buffer.from('{}') }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(admin._mockData.collections.accountPlanAssignments).toBeUndefined();
});

test('invalid nonempty Stripe signature cannot create authority', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'synthetic-webhook-secret';
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await stripeApi.handleWebhook({ headers: { 'stripe-signature': 't=1,v1=invalid' }, rawBody: Buffer.from(JSON.stringify(event('evt_invalid_sig', BASE))) }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(admin._mockData.collections.accountPlanAssignments).toBeUndefined();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('unknown Stripe price fails closed without assignment or history', async () => {
  const unknown = event('evt_120', BASE, 'scale'); unknown.data.object.items.data[0].price.id = 'price_unknown';
  await expect(stripeApi._applyBillingAuthorityEvent(UID, unknown.data.object, unknown)).rejects.toThrow('BILLING_PLAN_UNRESOLVED');
  expect(record()).toBeUndefined();
});

test('protected dynamic pricing map resolves an existing monthly price to its canonical plan', async () => {
  admin._setMockCollection('platformConfig', { pricing: { tiers: {
    growth: { stripe: { prices: { monthly: 'price_dynamic_growth', annual: 'price_dynamic_growth_annual' } } },
  } } });
  const dynamic = event('evt_120_dynamic', BASE, 'growth');
  dynamic.data.object.items.data[0].price.id = 'price_dynamic_growth';
  await stripeApi._applyBillingAuthorityEvent(UID, dynamic.data.object, dynamic);
  expect(effective().plan).toBe('growth');
});

test('matching static and protected price maps resolve one canonical plan', async () => {
  const price = PLANS.scale.stripePriceId;
  admin._setMockCollection('platformConfig', { pricing: { tiers: {
    scale: { stripe: { prices: { monthly: price } } },
  } } });
  const matching = event('evt_120_matching', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, matching.data.object, matching);
  expect(effective().plan).toBe('scale');
});

test('duplicate static price mappings fail closed instead of selecting the first plan', async () => {
  const original = PLANS.growth.stripePriceId;
  PLANS.growth.stripePriceId = PLANS.scale.stripePriceId;
  try {
    const ambiguous = event('evt_120_static_ambiguous', BASE, 'scale');
    await expect(stripeApi._applyBillingAuthorityEvent(UID, ambiguous.data.object, ambiguous)).rejects.toThrow('BILLING_PLAN_UNRESOLVED');
    expect(record()).toBeUndefined();
  } finally {
    PLANS.growth.stripePriceId = original;
  }
});

test('malformed optional pricing map cannot disable a recognized static price', async () => {
  admin._setMockCollection('platformConfig', { pricing: { tiers: 'malformed' } });
  const known = event('evt_120_static', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, known.data.object, known);
  expect(effective().plan).toBe('scale');
});

test('conflicting protected price mappings fail closed', async () => {
  const price = PLANS.scale.stripePriceId;
  admin._setMockCollection('platformConfig', { pricing: { tiers: {
    growth: { stripe: { prices: { monthly: price } } },
  } } });
  const ambiguous = event('evt_120_ambiguous', BASE, 'scale');
  await expect(stripeApi._applyBillingAuthorityEvent(UID, ambiguous.data.object, ambiguous)).rejects.toThrow('BILLING_PLAN_UNRESOLVED');
  expect(record()).toBeUndefined();
});

test('billing mutation revalidates signed subject metadata inside the transaction', async () => {
  const mismatched = event('evt_120_subject', BASE, 'scale', { metadata: { firebaseUserId: 'victim' } });
  await expect(stripeApi._applyBillingAuthorityEvent(UID, mismatched.data.object, mismatched)).rejects.toThrow('BILLING_SUBJECT_MISMATCH');
  expect(record()).toBeUndefined();
});

test('a second active subscription cannot overwrite the current billing authority', async () => {
  const first = event('evt_120_first_sub', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, first.data.object, first);
  const second = event('evt_120_second_sub', BASE + 1, 'growth', { id: 'sub_second' });
  await expect(stripeApi._applyBillingAuthorityEvent(UID, second.data.object, second)).rejects.toThrow('BILLING_SUBSCRIPTION_COLLISION');
  expect(effective().plan).toBe('scale'); expect(record().revision).toBe(1);
});

test('a new subscription may establish billing authority after the prior one is revoked', async () => {
  const first = event('evt_120_old_sub', BASE, 'scale');
  await stripeApi._applyBillingAuthorityEvent(UID, first.data.object, first);
  const canceled = event('evt_120_old_sub_cancel', BASE + 1, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  await stripeApi._applyBillingAuthorityEvent(UID, canceled.data.object, canceled);
  const replacement = event('evt_120_new_sub', BASE + 2, 'growth', { id: 'sub_replacement' });
  await stripeApi._applyBillingAuthorityEvent(UID, replacement.data.object, replacement);
  expect(effective().plan).toBe('growth'); expect(record().authorities.billing.providerSubscriptionId).toBe('sub_replacement');
});

test('terminal event with no known current or provider plan fails closed', async () => {
  const unknown = event('evt_121', BASE, 'scale', { status: 'canceled' }, 'customer.subscription.deleted');
  unknown.data.object.items.data[0].price.id = 'price_unknown';
  await expect(stripeApi._applyBillingAuthorityEvent(UID, unknown.data.object, unknown)).rejects.toThrow('BILLING_PLAN_UNRESOLVED');
  expect(record()).toBeUndefined();
});

test('billing refuses to replace a malformed composite record', async () => {
  const malformed = { schemaVersion: 2, subjectUid: UID, revision: 1, authorities: {
    operator: { source: 'profile', authorityId: 'operator', subjectUid: UID, planId: 'enterprise', status: 'active',
      actorUid: 'fixture-operator', revision: 1, effectiveAt: new Date((BASE - 10) * 1000), expiresAt: null, revokedAt: null },
  } };
  admin._setMockCollection('accountPlanAssignments', { [UID]: malformed });
  const upgrade = event('evt_122', BASE, 'scale');
  await expect(stripeApi._applyBillingAuthorityEvent(UID, upgrade.data.object, upgrade)).rejects.toThrow('ASSIGNMENT_UNRESOLVED');
  expect(record()).toEqual(malformed);
});

test('one malformed provenance slot makes the entire composite record unresolved', () => {
  const composite = { schemaVersion: 2, subjectUid: UID, revision: 2, authorities: {
    operator: nonBillingAuthority('operator', 'enterprise', 1),
    billing: { source: 'billing', authorityId: 'stripe:sub_fixture', subjectUid: UID, planId: 'scale', status: 'active',
      revision: 2, provider: 'stripe', providerSubscriptionId: SUBSCRIPTION, providerCustomerId: CUSTOMER,
      providerStatus: 'active', lastEventId: 'evt_missing_order_fields', lastEventCreated: BASE,
      effectiveAt: new Date((BASE - 10) * 1000), expiresAt: null, revokedAt: null },
  } };
  expect(resolveAuthority(composite, UID, new Date((BASE + 1) * 1000)).plan).toBeNull();
});

test('Scale plan alone enables branding and Growth alone disables it', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'scale', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store.workspaceBranding = { 'workspace-a': { logoUrl: 'https://example.com/logo.png', accentColor: '#123456' } };
  expect((await resolveBrand(UID, { workspaceId: 'workspace-a' })).canUseCustomLogo).toBe(true);
  store.accountPlanAssignments[UID] = assignment(UID, 'growth');
  expect((await resolveBrand(UID, { workspaceId: 'workspace-a' })).canUseCustomLogo).toBe(false);
});

test('independent grant survives downgrade; expiry and revocation remove it', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'scale', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store.workspaceBranding = { 'workspace-a': { logoUrl: 'https://example.com/logo.png', accentColor: '#123456' } };
  store['workspaceFeatureGrants/workspace-a/grants'] = { 'branding-1': grant() };
  store.accountPlanAssignments[UID] = assignment(UID, 'growth');
  expect((await resolveBrand(UID, { workspaceId: 'workspace-a' })).canUseCustomLogo).toBe(true);
  store['workspaceFeatureGrants/workspace-a/grants']['branding-1'] = grant('workspace-a', { expiresAt: new Date((BASE - 1) * 1000) });
  expect((await resolveBrand(UID, { workspaceId: 'workspace-a' })).canUseCustomLogo).toBe(false);
  store['workspaceFeatureGrants/workspace-a/grants']['branding-1'] = grant('workspace-a', { revokedAt: new Date(BASE * 1000) });
  expect((await resolveBrand(UID, { workspaceId: 'workspace-a' })).canUseCustomLogo).toBe(false);
});

test('plan upgrade does not destroy grant provenance and projection omits administrative fields', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'growth', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store.workspaceBranding = { 'workspace-a': { logoUrl: 'https://example.com/logo.png' } };
  store['workspaceFeatureGrants/workspace-a/grants'] = { 'branding-1': grant() };
  store.accountPlanAssignments[UID] = assignment(UID, 'scale');
  const projected = await resolveBrand(UID, { workspaceId: 'workspace-a' });
  expect(projected.canUseCustomLogo).toBe(true);
  expect(store['workspaceFeatureGrants/workspace-a/grants']['branding-1']).toMatchObject({ source: 'operator', reason: 'Contract exception' });
  expect(JSON.stringify(projected)).not.toMatch(/grantId|actorUid|reason|source/);
});

test('cross-workspace grant is rejected by its protected scope identity', async () => {
  const wrong = grant('workspace-b');
  admin._setMockCollection('workspaceFeatureGrants/workspace-a/grants', { 'branding-1': wrong });
  expect(await hasFeatureGrant(admin.firestore(), null, 'workspace', 'workspace-a', 'custom_branding')).toBe(false);
});

test('promotion and legacy-migration feature grant sources use the same protected primitive', async () => {
  for (const source of ['promotion', 'legacy_migration']) {
    admin._setMockCollection('workspaceFeatureGrants/workspace-a/grants', { 'branding-1': grant('workspace-a', { source }) });
    expect(await hasFeatureGrant(admin.firestore(), null, 'workspace', 'workspace-a', 'custom_branding')).toBe(true);
  }
});

test('branding grant reconciliation failure denies branding without breaking workspace seats', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'growth', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store['workspaceFeatureGrants/workspace-a/grants'] = Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [`branding-${index}`, grant('workspace-a', { grantId: `branding-${index}` })])
  );
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const state = await workspaceState(admin.firestore(), null, 'workspace-a', UID);
    expect(state.plan).toBe('growth');
    expect(state.snapshot.team_seats.limit).toBe(3);
    expect(state.snapshot.capabilities.custom_branding).toBe(false);
  } finally { log.mockRestore(); }
});

test('owner account branding grant remains effective in workspace context', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'growth', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store.workspaceBranding = { 'workspace-a': { logoUrl: 'https://example.test/logo.png' } };
  store[`accountFeatureGrants/${UID}/grants`] = { 'branding-1': grant(UID, { scopeType: 'account', scopeId: UID }) };
  const brand = await resolveBrand(UID, { workspaceId: 'workspace-a' });
  expect(brand.canUseCustomLogo).toBe(true);
  expect(brand.logoUrl).toBe('https://example.test/logo.png');
});

test('one malformed grant scope cannot suppress a valid grant in the other scope', async () => {
  const store = admin._mockData.collections;
  seed(store, { ownerUid: UID, plan: 'growth', workspaceId: 'workspace-a' });
  store.workspaces = { 'workspace-a': { ownerId: UID } };
  store['workspaceFeatureGrants/workspace-a/grants'] = Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [`branding-${index}`, grant('workspace-a', { grantId: `branding-${index}` })])
  );
  store[`accountFeatureGrants/${UID}/grants`] = { 'branding-1': grant(UID, { scopeType: 'account', scopeId: UID }) };
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const state = await workspaceState(admin.firestore(), null, 'workspace-a', UID);
    expect(state.snapshot.capabilities.custom_branding).toBe(true);
  } finally { log.mockRestore(); }
});
