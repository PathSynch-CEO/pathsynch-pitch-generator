'use strict';

process.env.STRIPE_SECRET_KEY = 'synthetic-test-key';
jest.mock('firebase-admin');
const mockCreateCheckout = jest.fn(async () => ({ id: 'cs_fixture', url: 'https://checkout.example.test/session' }));
jest.mock('stripe', () => jest.fn(() => ({
  customers: { create: jest.fn() },
  checkout: { sessions: { create: mockCreateCheckout } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
})));

const admin = require('firebase-admin');
const { createCheckoutSession } = require('../api/stripe');
const { PLANS } = require('../config/stripe');

beforeEach(() => {
  admin._resetMockData();
  mockCreateCheckout.mockClear();
  admin._setMockCollection('users', { 'checkout-user': { stripeCustomerId: 'cus_checkout' } });
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
