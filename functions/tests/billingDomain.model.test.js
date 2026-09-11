'use strict';
const { canonical } = require('../services/billing/value');
const f = require('./billingDomain.helpers.cjs');

// Exhaustively visit accepted and rejected short histories. This tests global safety
// properties independently of the command-specific happy-path assertions.
test('model walk: all four-step histories preserve identity, settled evidence, and dispatch monotonicity', () => {
  let transitions = 0, rejections = 0;
  const actions = [
    ['dispatch', a => f.step(a, 'authorize_dispatch', { retryUntil: f.AT + 60000, settlementDeadline: a.sessionExpiresAt + 7 * 86400000 })],
    ['timeout', a => f.step(a, 'provider_unknown')],
    ['completion', a => f.observe(a, 'completed')],
    ['deadline', a => f.step(a, 'settlement_deadline', { at: Math.max(a.updatedAt, a.settlementDeadline || a.leaseUntil) })],
    ['lease_expiry', a => f.step(a, 'expire_reservation', { at: Math.max(a.updatedAt, a.leaseUntil) })],
    ['verified_settlement', a => f.step(a, 'settle_no_purchase', { evidence: f.evidence(a, 'verified_no_purchase',
      { dispatchQuiesced: true, noPayablePurchase: true }) })],
  ];
  function visit(a, depth, path) {
    if (!depth) return;
    for (const [name, action] of actions) {
      const before = canonical(a);
      let next;
      try { next = action(a); } catch (error) {
        expect(typeof error.code).toBe('string');
        expect(canonical(a)).toBe(before);
        rejections++;
        continue;
      }
      transitions++;
      expect(canonical(a)).toBe(before);
      expect(next.operation).toEqual(a.operation);
      expect(next.attemptId).toBe(a.attemptId);
      expect(next.accountId).toBe(a.accountId);
      expect(next.providerScope).toEqual(a.providerScope);
      if (a.dispatch) expect(next.dispatch).toEqual(a.dispatch);
      if (a.sessionState === 'completed') expect(next.sessionState).toBe('completed');
      if (a.settlementDeadline !== null) expect(next.settlementDeadline).toBeGreaterThanOrEqual(a.settlementDeadline);
      if (next.resolution === 'no_purchase' && a.dispatch) {
        if (a.resolution === 'no_purchase') {
          expect(name).toBe('completion');
          expect(next.resolutionEvidence).toEqual(a.resolutionEvidence);
        } else expect(name).toBe('verified_settlement');
      }
      if (name === 'deadline') expect(next.resolution).toBe('reconciliation_required');
      visit(next, depth - 1, path.concat(name));
    }
  }
  visit(f.attempt(), 4, []);
  expect(transitions).toBeGreaterThan(30);
  expect(rejections).toBeGreaterThan(50);
});
