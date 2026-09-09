'use strict';
jest.mock('firebase-admin', () => ({ firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ subscription: { plan: 'enterprise' }, plan: 'enterprise', tier: 'enterprise' }) }) }) }) }) }));
const { getUserPlan } = require('../middleware/planGate');
test('client-authored profile plan cannot create paid entitlement authority', async () => {
  expect(await getUserPlan('fixture-owner')).not.toBe('enterprise');
});

test('unresolved plan cannot acquire fallback Starter runtime limits', () => {
  const { getPlanLimits } = require('../config/stripe');
  expect(() => getPlanLimits('unresolved')).toThrow();
});
