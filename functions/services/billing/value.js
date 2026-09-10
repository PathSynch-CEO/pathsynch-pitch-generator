'use strict';

const { createHash } = require('node:crypto');
const DAY = 24 * 60 * 60 * 1000;
const SETTLEMENT_MS = 7 * DAY;
const PLANS = Object.freeze(['starter', 'growth', 'scale', 'enterprise']);

function requireThat(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function id(value) { return typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value); }
function time(value) { return Number.isSafeInteger(value) && value >= 0; }
function scope(value) {
  return !!value && value.provider === 'stripe' && id(value.accountId) && ['test', 'live'].includes(value.mode);
}
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'NON_JSON_VALUE'); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    requireThat(Object.keys(value).length === value.length, 'NON_JSON_VALUE');
    return '[' + value.map(canonical).join(',') + ']';
  }
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'NON_JSON_VALUE');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function equal(a, b) { return canonical(a) === canonical(b); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function copy(value) { return JSON.parse(canonical(value)); }
function result(value) { return freeze(copy(value)); }
function identity(value) { return { accountId: value.accountId, providerScope: value.providerScope }; }
function sameIdentity(a, b) { return equal(identity(a), identity(b)); }
function envelope(state, command) {
  requireThat(command && sameIdentity(state, command) && command.attemptId === state.attemptId, 'IDENTITY_MISMATCH');
  requireThat(command.expectedRevision === state.revision, 'STALE_REVISION');
  requireThat(time(command.at) && command.at >= state.updatedAt, 'INVALID_CLOCK');
}
module.exports = { DAY, SETTLEMENT_MS, PLANS, requireThat, id, time, scope, canonical, hash, equal, copy, result, sameIdentity, envelope };
