'use strict';

const { requireThat, id, scope, sameIdentity, result } = require('./value');

function validateBindings(context) {
  const { accountId, providerScope, customerId, forward = null, reverse = null, bootstrap = null } = context;
  requireThat(id(accountId) && id(customerId) && scope(providerScope), 'INVALID_BINDING_CONTEXT');
  const valid = (binding, documentId) => binding && binding.version === 1 &&
    binding.documentId === documentId && binding.customerId === customerId && sameIdentity(binding, context);
  if (valid(forward, accountId) && valid(reverse, customerId)) return result({ status: 'consistent', allowed: true, issue: null });
  if (!forward && !reverse) {
    const trustedCreation = bootstrap && bootstrap.kind === 'trusted_customer_create_result' &&
      id(bootstrap.operationId) && id(bootstrap.attemptId) && bootstrap.customerId === customerId &&
      sameIdentity(bootstrap, context);
    return result({ status: trustedCreation ? 'bootstrap_required' : 'unproven',
      allowed: false, issue: trustedCreation ? null : 'legacy_unproven_lineage',
      mayCreatePairAtomically: !!trustedCreation });
  }
  return result({ status: 'unresolved', allowed: false, issue: 'binding_mismatch',
    missing: !forward ? 'forward' : !reverse ? 'reverse' : null });
}
module.exports = { validateBindings };
