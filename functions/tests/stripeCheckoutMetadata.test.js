'use strict';

process.env.STRIPE_SECRET_KEY = 'synthetic-test-key';
jest.mock('firebase-admin');
const mockSendSubscriptionEmail = jest.fn(async () => undefined);
jest.mock('../services/email', () => ({ sendSubscriptionEmail: mockSendSubscriptionEmail }));
const mockCreateCheckout = jest.fn(async () => ({ id: 'cs_fixture', url: 'https://checkout.example.test/session' }));
const mockCreateCustomer = jest.fn(async () => ({ id: 'cus_new_checkout' }));
const mockCreatePortal = jest.fn(async () => ({ url: 'https://portal.example.test/session' }));
jest.mock('stripe', () => jest.fn(() => ({
  customers: { create: mockCreateCustomer },
  checkout: { sessions: { create: mockCreateCheckout } },
  billingPortal: { sessions: { create: mockCreatePortal } },
  webhooks: { constructEvent: jest.fn() },
})));

const admin = require('firebase-admin');
const { createCheckoutSession, createPortalSession, _handleCheckoutComplete } = require('../api/stripe');
const { PLANS } = require('../config/stripe');

beforeEach(() => {
  admin._resetMockData();
  mockCreateCheckout.mockClear();
  mockCreateCustomer.mockClear();
  mockCreatePortal.mockClear();
  mockSendSubscriptionEmail.mockClear();
  admin._setMockCollection('users', { 'checkout-user': { stripeCustomerId: 'cus_checkout' } });
  admin._setMockCollection('billingAccountBindings', { 'checkout-user': {
    schemaVersion: 1, provider: 'stripe', providerCustomerId: 'cus_checkout', subjectUid: 'checkout-user',
  } });
});

test('checkout ignores a forged customer projection and requires protected reconciliation', async () => {
  admin._setMockCollection('billingAccountBindings', {});
  const req = { userId: 'checkout-user', body: { priceId: PLANS.scale.stripePriceId, planName: 'scale' }, headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createCheckoutSession(req, res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BILLING_BINDING_RECONCILIATION_REQUIRED' }));
  expect(mockCreateCustomer).not.toHaveBeenCalled();
  expect(mockCreateCheckout).not.toHaveBeenCalled();
});

test('new checkout creates protected account and customer bindings before using the customer', async () => {
  admin._setMockCollection('users', { 'checkout-user': { profile: { email: 'client-forged@example.test' } } });
  admin._setMockCollection('billingAccountBindings', {});
  const req = { userId: 'checkout-user', userEmail: 'auth@example.test', body: { priceId: PLANS.scale.stripePriceId, planName: 'scale' }, headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createCheckoutSession(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(mockCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ email: 'auth@example.test' }));
  expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_new_checkout' }));
  expect(admin._mockData.collections.billingAccountBindings['checkout-user']).toMatchObject({ subjectUid: 'checkout-user', providerCustomerId: 'cus_new_checkout' });
  expect(admin._mockData.collections.billingCustomerBindings.cus_new_checkout).toMatchObject({ subjectUid: 'checkout-user', providerCustomerId: 'cus_new_checkout' });
});

test('checkout propagates the authoritative uid to subscription lifecycle metadata', async () => {
  const req = {
    userId: 'checkout-user',
    body: { priceId: PLANS.scale.stripePriceId, planName: 'scale' },
    headers: { origin: 'https://app.synchintro.ai' },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createCheckoutSession(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
    customer: 'cus_checkout',
    mode: 'subscription',
    subscription_data: { metadata: { firebaseUserId: 'checkout-user', planName: 'scale' } },
  }));
});

test('checkout refuses to create a second active billing subscription', async () => {
  const now = new Date(Date.now() - 1000);
  admin._setMockCollection('accountPlanAssignments', { 'checkout-user': {
    schemaVersion: 2, subjectUid: 'checkout-user', revision: 1, authorities: {
      billing: {
        source: 'billing', authorityId: 'stripe:sub_active', subjectUid: 'checkout-user', planId: 'scale',
        status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_active', providerCustomerId: 'cus_checkout',
        providerStatus: 'active', lastEventId: 'evt_active', lastEventCreated: Math.floor(Date.now() / 1000) - 1,
        lastEventRank: 1, lastEventType: 'customer.subscription.updated',
        lastEventSemantic: 'customer.subscription.updated|active|scale|continue|effective|0', revision: 1,
        effectiveAt: now, expiresAt: null, revokedAt: null,
      },
    },
  } });
  const req = { userId: 'checkout-user', body: { priceId: PLANS.growth.stripePriceId, planName: 'growth' }, headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createCheckoutSession(req, res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACTIVE_SUBSCRIPTION_EXISTS' }));
  expect(mockCreateCheckout).not.toHaveBeenCalled();
});

test('checkout rejects a mismatched plan label before creating billing resources', async () => {
  const req = { userId: 'checkout-user', body: { priceId: PLANS.growth.stripePriceId, planName: 'scale' }, headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createCheckoutSession(req, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BILLING_PRICE_UNRESOLVED' }));
  expect(mockCreateCustomer).not.toHaveBeenCalled();
  expect(mockCreateCheckout).not.toHaveBeenCalled();
});

test('billing portal uses the protected account binding instead of the editable projection', async () => {
  admin._setMockCollection('users', { 'checkout-user': { stripeCustomerId: 'client-forged-customer' } });
  const req = { userId: 'checkout-user', headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

  await createPortalSession(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(mockCreatePortal).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_checkout' }));
});

test('checkout confirmation uses Auth identity rather than editable profile email', async () => {
  admin._setMockCollection('users', { 'checkout-user': { profile: { email: 'client-forged@example.test' } } });
  admin._setMockUser('checkout-user', { uid: 'checkout-user', email: 'auth@example.test', disabled: false });

  await _handleCheckoutComplete({ metadata: { firebaseUserId: 'checkout-user', planName: 'scale' }, amount_total: 1200 });

  expect(mockSendSubscriptionEmail).toHaveBeenCalledWith('auth@example.test', expect.objectContaining({ plan: 'scale' }));
});
