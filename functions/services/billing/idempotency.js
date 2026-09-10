'use strict';

const { requireThat, id, uid, scope, hash, equal, result } = require('./value');
const OPERATIONS = Object.freeze(['customer_create', 'checkout_session']);
function createOperation({ attemptId, accountId, providerScope, kind, parameters }) {
  requireThat(id(attemptId) && uid(accountId) && scope(providerScope) && OPERATIONS.includes(kind), 'INVALID_OPERATION_IDENTITY');
  requireThat(parameters && Object.getPrototypeOf(parameters) === Object.prototype, 'INVALID_PARAMETERS');
  const requestFingerprint = hash(parameters);
  const identity = { version: 1, attemptId, accountId, providerScope, kind };
  // Reconstructible identity; keys and request parameters must not enter logs/client projections.
  const providerKey = 'synchintro-v1-' + hash(identity);
  return result({ ...identity, parameters, requestFingerprint, providerKey, providerKeyHash: hash(providerKey) });
}
function validateOperation(operation) {
  requireThat(operation && equal(operation, createOperation(operation)), 'OPERATION_TAMPERED');
  return operation;
}
function verifyRetry(operation, proposed) {
  validateOperation(operation);
  requireThat(equal(createOperation(proposed), operation), 'CHANGED_INTENT');
  return operation;
}
module.exports = { createOperation, validateOperation, verifyRetry };
