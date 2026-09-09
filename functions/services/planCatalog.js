'use strict';
// Catalog version changes whenever the authoritative team-seat contract changes.
const VERSION = 'synchintro-team-seats-v1';
const SEATS = Object.freeze({ starter: 1, growth: 3, scale: 5, enterprise: null });
function normalizePlan(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(SEATS, normalized) ? normalized : null;
}
function assertResolvedPlan(plan) {
  if (!normalizePlan(plan)) { const error = new (require('../middleware/errorHandler').ApiError)('ENTITLEMENT_UNRESOLVED', 'A verified plan is required before this operation.'); error.code = 'ENTITLEMENT_UNRESOLVED'; error.status = 409; error.statusCode = 409; throw error; }
  return plan;
}
function seatContract(plan) {
  const id = normalizePlan(plan);
  if (!id) return null;
  const limit = SEATS[id];
  return Object.freeze({ limit, status: limit === null ? 'unlimited' : 'limited', unlimited: limit === null });
}
function catalog() {
  return { version: VERSION, plans: Object.keys(SEATS).map(plan_id => ({ plan_id, team_seats: seatContract(plan_id),
    routing_members: { shared_pool: 'team_seats' }, scheduler_hosts: { shared_pool: 'team_seats' } })) };
}
module.exports = { VERSION, normalizePlan, assertResolvedPlan, seatContract, catalog };
