'use strict';

const { requireThat, id, uid, scope, hash, result, equal } = require('./value');
const REASONS = Object.freeze({
  second_active_subscription: { automaticResolutionAllowed: false, operatorRequired: true, suspendUnprovenBilling: true },
  binding_mismatch: { automaticResolutionAllowed: false, operatorRequired: true, suspendUnprovenBilling: true },
  same_second_conflict: { automaticResolutionAllowed: true, operatorRequired: false, suspendUnprovenBilling: true },
  terminal_resurrection: { automaticResolutionAllowed: false, operatorRequired: true, suspendUnprovenBilling: true },
  unknown_provider_outcome: { automaticResolutionAllowed: true, operatorRequired: false, suspendUnprovenBilling: false },
  unresolved_attempt: { automaticResolutionAllowed: false, operatorRequired: true, suspendUnprovenBilling: false },
  legacy_unproven_lineage: { automaticResolutionAllowed: false, operatorRequired: true, suspendUnprovenBilling: true },
});
function reconciliationDecision({ reason, accountId, providerScope, resourceIds, preservedAuthority = null }) {
  requireThat(Object.hasOwn(REASONS, reason) && uid(accountId) && scope(providerScope) &&
    Array.isArray(resourceIds) && resourceIds.length > 0 && resourceIds.every(id), 'INVALID_RECONCILIATION');
  const resources = [...new Set(resourceIds)].sort();
  const identity = { reason, accountId, providerScope, resourceIds: resources };
  return result({ issueId: 'issue_' + hash(identity), ...identity, ...REASONS[reason],
    blockingEffect: 'block_new_checkout', preservedAuthority,
    recovery: { owner: 'billing_operations', path: 'verified_evidence_reconciliation' } });
}
function canAcknowledgeIssue(issue, event, commitReceipt) {
  // Represents a commit obligation. No reducer can establish storage durability itself.
  requireThat(issue && equal(issue, reconciliationDecision(issue)), 'RECOVERY_REQUIRED');
  requireThat(event && id(event.eventId) && typeof event.eventHash === 'string' && /^[a-f0-9]{64}$/.test(event.eventHash), 'EVENT_RECEIPT_REQUIRED');
  return !!commitReceipt && equal(commitReceipt, { kind: 'committed_issue_and_event_receipt',
    issueId: issue.issueId, issueHash: hash(issue), eventId: event.eventId, eventHash: event.eventHash, recovery: issue.recovery });
}
module.exports = { reconciliationDecision, canAcknowledgeIssue };
