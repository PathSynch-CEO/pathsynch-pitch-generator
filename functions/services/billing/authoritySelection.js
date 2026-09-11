'use strict';

const { requireThat, id, uid, time, scope, sameIdentity, result } = require('./value');
const { validateSubscription } = require('./subscription');
const { validateDisposition, validateSelection, eligible } = require('./disposition');
const { reconciliationDecision } = require('./reconciliation');

function selectBillingAuthority({ accountId, providerScope, subscriptions, dispositions = [], selection = null, at }) {
  requireThat(uid(accountId) && scope(providerScope) && time(at) && Array.isArray(subscriptions), 'INVALID_SELECTION_CONTEXT');
  const context = { accountId, providerScope };
  const seen = new Set();
  for (const sub of subscriptions) {
    requireThat(sub && typeof sub === 'object' && !Array.isArray(sub) &&
      uid(sub.accountId) && scope(sub.providerScope) && sameIdentity(context, sub) &&
      !seen.has(sub.subscriptionId), 'SELECTION_IDENTITY_MISMATCH');
    validateSubscription(sub);
    seen.add(sub.subscriptionId);
  }
  requireThat(Array.isArray(dispositions) && dispositions.length === subscriptions.length, 'MISSING_DISPOSITION');
  const byId = new Map();
  for (const pair of dispositions) {
    const sub = subscriptions.find(s => s.subscriptionId === pair?.state?.subscriptionId);
    requireThat(sub && !byId.has(sub.subscriptionId), 'DISPOSITION_IDENTITY_MISMATCH');
    validateDisposition(pair.state, pair.accepted, sub);
    requireThat(pair.state.updatedAt <= at, 'INVALID_SELECTION_CLOCK');
    byId.set(sub.subscriptionId, pair.state);
  }
  const active = sub => eligible(sub, at);
  if (selection) requireThat(selection.kind === 'verified_selection' && sameIdentity(selection, context) &&
    id(selection.subscriptionId) && id(selection.customerId), 'UNPROVEN_SELECTION');
  // Missing incumbent never elects a challenger. Existing incumbent requires an exact current proof.
  const incumbent = selection && subscriptions.find(s => s.subscriptionId === selection.subscriptionId);
  if (incumbent) validateSelection(selection, byId.get(incumbent.subscriptionId), incumbent);
  const billing = incumbent && byId.get(incumbent.subscriptionId).status === 'effective' && active(incumbent) ? {
    source: 'billing', accountId, providerScope, subscriptionId: incumbent.subscriptionId,
    customerId: incumbent.customerId, planId: incumbent.acceptedSemantic.planId, selectionEvidenceId: selection.lineage.evidenceId,
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
  for (const [subscriptionId, disposition] of byId) if (disposition.status === 'quarantined' &&
    !subscriptions.find(s => s.subscriptionId === subscriptionId).conflict) issue('legacy_unproven_lineage', [subscriptionId]);
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
