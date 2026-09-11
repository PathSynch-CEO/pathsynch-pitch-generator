'use strict';

const { requireThat, id, uid, time, scope, PLANS, sameIdentity, result } = require('./value');
const { validateSubscription } = require('./subscription');
const { reconciliationDecision } = require('./reconciliation');

function selectBillingAuthority({ accountId, providerScope, subscriptions, selection = null, at }) {
  requireThat(uid(accountId) && scope(providerScope) && time(at) && Array.isArray(subscriptions), 'INVALID_SELECTION_CONTEXT');
  const context = { accountId, providerScope };
  const seen = new Set();
  for (const sub of subscriptions) {
    requireThat(sameIdentity(context, sub) && !seen.has(sub.subscriptionId), 'SELECTION_IDENTITY_MISMATCH');
    validateSubscription(sub);
    seen.add(sub.subscriptionId);
  }
  const active = sub => !sub.conflict && !sub.tombstone &&
    ['active', 'trialing', 'past_due'].includes(sub.lifecycleState) && PLANS.includes(sub.acceptedSemantic.planId) &&
    (!sub.acceptedSemantic.cancelAtPeriodEnd || sub.acceptedSemantic.periodEnd * 1000 > at);
  if (selection) requireThat(selection.kind === 'verified_selection' && sameIdentity(selection, context) &&
    id(selection.subscriptionId) && id(selection.customerId) && id(selection.evidenceId) &&
    ['settled_checkout', 'operator_reconciliation', 'protected_legacy_import'].includes(selection.basis), 'UNPROVEN_SELECTION');
  const incumbent = selection && subscriptions.find(s => s.subscriptionId === selection.subscriptionId &&
    s.customerId === selection.customerId && !['superseded', 'quarantined'].includes(s.disposition));
  const billing = incumbent && active(incumbent) ? {
    source: 'billing', accountId, providerScope, subscriptionId: incumbent.subscriptionId,
    customerId: incumbent.customerId, planId: incumbent.acceptedSemantic.planId, selectionEvidenceId: selection.evidenceId,
  } : null;
  const issues = [];
  const issue = (reason, ids) => issues.push(reconciliationDecision({ ...context, reason, resourceIds: ids, preservedAuthority: billing }));
  const activeSubscriptions = subscriptions.filter(active);
  const challenger = activeSubscriptions.filter(s => s.subscriptionId !== incumbent?.subscriptionId);
  if (activeSubscriptions.length > 1 || (incumbent && challenger.length)) {
    issue('second_active_subscription', [incumbent?.subscriptionId, ...activeSubscriptions.map(s => s.subscriptionId)].filter(Boolean));
  } else if ((!incumbent && (subscriptions.length || selection)) || (challenger.length && !billing)) {
    issue('legacy_unproven_lineage', [...subscriptions.map(s => s.subscriptionId), ...(selection ? [selection.subscriptionId] : [])]);
  }
  for (const sub of subscriptions) if (sub.conflict) issue(sub.conflict, [sub.subscriptionId]);
  return result({ accountId, providerScope, billing, selectedSubscriptionId: billing?.subscriptionId || null, issues,
    checkoutBlocked: !!billing || issues.length > 0 || subscriptions.some(s => !s.tombstone) });
}
function replaceBillingAuthority({ accountId, providerScope, authorities }, selectionInput) {
  requireThat(selectionInput && sameIdentity({ accountId, providerScope }, selectionInput), 'SELECTION_IDENTITY_MISMATCH');
  // Recompute inside this pure boundary; a caller-supplied billing slot is never authority.
  const selectionDecision = selectBillingAuthority(selectionInput);
  requireThat(authorities && typeof authorities === 'object' && !Array.isArray(authorities) &&
    Object.keys(authorities).every(k => ['billing', 'operator', 'promotion', 'legacy_migration'].includes(k)), 'INVALID_AUTHORITIES');
  requireThat(selectionDecision && (selectionDecision.billing === null || selectionDecision.billing.source === 'billing'), 'INVALID_BILLING_SLOT');
  const next = { ...authorities };
  if (selectionDecision.billing) next.billing = selectionDecision.billing;
  else delete next.billing;
  return result(next);
}
module.exports = { selectBillingAuthority, replaceBillingAuthority };
