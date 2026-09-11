'use strict';
const d = require('../services/billing/disposition');
const { createSubscription, validateSubscription, reduceSubscription } = require('../services/billing/subscription');
const { selectBillingAuthority } = require('../services/billing/authoritySelection');
const { hash } = require('../services/billing/value');
const f = require('./billingDomain.helpers.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const sub = (subscriptionId = 'sub_a') => f.feed([f.event({ subscriptionId })], f.subscription({ subscriptionId }));
const candidate = s => d.initializeDisposition(s, f.AT);
const effective = (s, epoch = 1) => f.dispositionStep(candidate(s), s, 'select', { selection: f.lineage(epoch) });
const quarantine = (p, s) => f.dispositionStep(p, s, 'quarantine', { reason: 'reconciliation_required' });
const replacementProof = (p, s) => ({ ...f.subIdentity(s), subscriptionRevision: s.revision,
  dispositionRevision: p.state.revision, dispositionHash: hash(p.state), lineage: p.state.lineage });
const supersede = (p, s, r = sub('sub_b'), rp = effective(r, 2)) =>
  f.dispositionStep(p, s, 'supersede', { replacement: replacementProof(rp, r) });
const choose = (s, p, selection = f.selectionProof(p, s), extra = {}) => selectBillingAuthority({
  ...f.context, subscriptions: [s], dispositions: [p], selection, at: f.AT, ...extra });
function refresh(p, s, event) {
  const next = reduceSubscription(s, event).state;
  return { s: next, p: f.dispositionStep(p, s, 'refresh', { event }, next) };
}

test.each(['candidate', 'effective', 'superseded', 'quarantined'])('BILLING-019: subscription rejects caller disposition %s', disposition => {
  expect(() => createSubscription({ ...f.subIdentity(sub()), disposition })).toThrow('INVALID_SUBSCRIPTION');
  expect(() => validateSubscription({ ...sub(), disposition })).toThrow('INVALID_SUBSCRIPTION');
});
test('BILLING-019: initialization is canonical candidate only, protected absence is mandatory', () => {
  const s = sub(), p = candidate(s);
  expect(p.state).toMatchObject({ status: 'candidate', revision: 1, previousHash: null, lineage: null });
  expect(() => d.initializeDisposition(s, f.AT, p.accepted)).toThrow('DISPOSITION_ALREADY_EXISTS');
  expect(() => d.validateDisposition({ ...p.state, status: 'effective', lineage: f.lineage() }, p.accepted, s)).toThrow();
});
test('BILLING-023: candidate becomes effective only with accepted selection lineage', () => {
  const s = sub(), p = effective(s);
  expect(choose(s, p).billing).toMatchObject({ subscriptionId: s.subscriptionId, planId: 'scale' });
  expect(choose(s, p, null).billing).toBeNull();
  expect(p.state).toMatchObject({ status: 'effective', revision: 2, lineage: f.lineage(), selectionFloor: 1 });
});
test.each([null, {}, { ...f.lineage(), epoch: 0 }, { ...f.lineage(), basis: 'client_profile' }])(
  'BILLING-023: invalid selection lineage %# cannot install effective', selection => {
    const s = sub();
    expect(() => f.dispositionStep(candidate(s), s, 'select', { selection })).toThrow('UNPROVEN_SELECTION_LINEAGE');
  });
test('effective without lineage cannot load even beside a matching claimed hash', () => {
  const s = sub(), p = copy(effective(s));
  p.state.lineage = null; p.accepted.stateHash = hash(p.state);
  expect(() => choose(s, p)).toThrow('UNPROVEN_DISPOSITION');
});
test('BILLING-020: hand-built effective cannot use an accepted candidate record', () => {
  const s = sub(), p = candidate(s), forged = effective(s).state;
  expect(() => choose(s, { state: forged, accepted: p.accepted })).toThrow('UNACCEPTED_DISPOSITION');
});
test('BILLING-020: accepted successor must equal transition replay, not an adjacent hash', () => {
  const s = sub(), p = candidate(s), cmd = f.dispositionCommand(p, s, 'select', { selection: f.lineage() });
  const next = d.reduceDisposition(p.accepted, p.state, cmd, s, s);
  expect(() => d.acceptDisposition(p.accepted, p.state, cmd, { ...next, selectionFloor: 99 }, s, s)).toThrow('DISPOSITION_SUCCESSOR_MISMATCH');
});
test.each(['candidate', 'effective'])('%s can enter quarantine only with transition evidence', initial => {
  const s = sub(), p = initial === 'candidate' ? candidate(s) : effective(s);
  const q = quarantine(p, s);
  expect(q.state.status).toBe('quarantined');
  expect(choose(s, q, null)).toMatchObject({ billing: null, checkoutBlocked: true });
  const cmd = f.dispositionCommand(p, s, 'quarantine', { reason: 'reconciliation_required' });
  delete cmd.evidence;
  expect(() => d.reduceDisposition(p.accepted, p.state, cmd, s, s)).toThrow('UNTRUSTED_DISPOSITION_EVIDENCE');
});
test('quarantine needs explicit resolution of this suppression and a newer selection', () => {
  const s = sub(), p = quarantine(effective(s), s);
  expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage(2) })).toThrow('INVALID_DISPOSITION_TRANSITION');
  expect(() => f.dispositionStep(p, s, 'resolve', { selection: f.lineage(2) })).toThrow('UNTRUSTED_DISPOSITION_EVIDENCE');
  expect(() => f.dispositionStep(p, s, 'resolve', { selection: f.lineage(), resolvesHash: hash(p.state.suppression) })).toThrow('UNPROVEN_SELECTION_LINEAGE');
  const next = f.dispositionStep(p, s, 'resolve', { selection: f.lineage(2), resolvesHash: hash(p.state.suppression) });
  expect(choose(s, next).billing).not.toBeNull();
});
test('effective becomes superseded only by a proven newer replacement', () => {
  const s = sub(), p = effective(s), next = supersede(p, s);
  expect(next.state).toMatchObject({ status: 'superseded', selectionFloor: 2, lineage: f.lineage() });
  expect(choose(s, next).billing).toBeNull();
  expect(() => f.dispositionStep(p, s, 'supersede', { replacement: { subscriptionId: 'sub_b' } })).toThrow();
  expect(() => supersede(p, s, s, effective(s, 2))).toThrow('UNPROVEN_REPLACEMENT');
  const r = sub('sub_b');
  expect(() => supersede(p, s, r, effective(r, 1))).toThrow('UNPROVEN_REPLACEMENT');
});
test('superseded reactivation requires newer explicit operator reconciliation', () => {
  const s = sub(), p = supersede(effective(s), s);
  expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage(3) })).toThrow('INVALID_DISPOSITION_TRANSITION');
  const payload = { selection: f.lineage(3), resolvesHash: hash(p.state.suppression) };
  expect(() => f.dispositionStep(p, s, 'operator_reselect', payload)).toThrow('UNPROVEN_SELECTION_LINEAGE');
  const next = f.dispositionStep(p, s, 'operator_reselect', { ...payload, selection: f.lineage(3, 'operator_reconciliation') });
  expect(choose(s, next).billing).not.toBeNull();
});
test.each(['candidate', 'effective', 'quarantined', 'superseded'])('BILLING-022: %s cannot reset to candidate', status => {
  const s = sub();
  const p = { candidate: () => candidate(s), effective: () => effective(s),
    quarantined: () => quarantine(effective(s), s), superseded: () => supersede(effective(s), s) }[status]();
  expect(() => f.dispositionStep(p, s, 'reset_candidate')).toThrow('INVALID_DISPOSITION_TRANSITION');
});
test.each([
  { accountId: 'another_account' }, { subscriptionId: 'sub_other' }, { customerId: 'cus_other' },
  { providerScope: { ...f.providerScope, mode: 'live' } },
])('BILLING-020: disposition cannot cross identity %#', changed => {
  const s = sub(), p = candidate(s), cmd = f.dispositionCommand(p, s, 'select', { selection: f.lineage() });
  expect(() => d.reduceDisposition(p.accepted, p.state, { ...cmd, ...changed }, s, s)).toThrow('DISPOSITION_IDENTITY_MISMATCH');
  expect(() => d.validateDisposition({ ...p.state, ...changed }, p.accepted, s)).toThrow('DISPOSITION_IDENTITY_MISMATCH');
});
test.each(['expectedRevision', 'previousHash', 'fromSubscriptionRevision', 'subscriptionRevision'])('BILLING-020: incorrect %s cannot transition', field => {
  const s = sub(), p = candidate(s), cmd = f.dispositionCommand(p, s, 'select', { selection: f.lineage() });
  cmd[field] = field === 'expectedRevision' ? 0 : '0'.repeat(64);
  expect(() => d.reduceDisposition(p.accepted, p.state, cmd, s, s)).toThrow('DISPOSITION_PREDECESSOR_MISMATCH');
});
test('stale sibling cannot replace the newly accepted successor', () => {
  const s = sub(), p = candidate(s), next = quarantine(p, s);
  const cmd = f.dispositionCommand(p, s, 'select', { selection: f.lineage() });
  const sibling = d.reduceDisposition(p.accepted, p.state, cmd, s, s);
  expect(() => d.acceptDisposition(next.accepted, p.state, cmd, sibling, s, s)).toThrow('UNACCEPTED_DISPOSITION');
  expect(() => choose(s, { state: sibling, accepted: next.accepted })).toThrow('UNACCEPTED_DISPOSITION');
});
test.each(['subscriptionRevision', 'dispositionRevision', 'dispositionHash', 'lineage'])('BILLING-021: selection binds exact %s', field => {
  const s = sub(), p = effective(s), proof = copy(f.selectionProof(p, s));
  proof[field] = field === 'dispositionRevision' ? 1 : field === 'lineage' ? f.lineage(2) : '0'.repeat(64);
  expect(() => choose(s, p, proof)).toThrow('UNPROVEN_SELECTION');
});
test('new semantic state invalidates both old disposition and old selection proof', () => {
  const s = sub(), p = effective(s), event = f.event({ eventId: 'evt_new', created: f.SECOND + 1, planId: 'growth' });
  const { s: next, p: accepted } = refresh(p, s, event);
  expect(() => choose(next, p)).toThrow('DISPOSITION_SEMANTIC_MISMATCH');
  expect(() => choose(next, accepted, f.selectionProof(p, s))).toThrow('UNPROVEN_SELECTION');
  expect(choose(next, accepted).billing.planId).toBe('growth');
});
test('refresh cannot substitute an older or sibling semantic ledger', () => {
  const s = sub(), p = effective(s), e = f.event({ eventId: 'evt_new', created: f.SECOND + 1 });
  const sibling = f.feed([f.event({ eventId: 'evt_sibling', planId: 'enterprise' })]);
  expect(() => f.dispositionStep(p, s, 'refresh', { event: e }, sibling)).toThrow('DISPOSITION_SEMANTIC_SUCCESSOR_MISMATCH');
  expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage(2) }, sibling)).toThrow('DISPOSITION_SEMANTIC_MISMATCH');
});
test('processing clock cannot move backwards', () => {
  const s = sub(), p = candidate(s);
  expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage() }, s, f.AT - 1)).toThrow('INVALID_DISPOSITION_CLOCK');
});
test('stale effective snapshot cannot defeat a newer quarantine anchor', () => {
  const s = sub(), p = effective(s), q = quarantine(p, s);
  expect(() => choose(s, { state: p.state, accepted: q.accepted })).toThrow('UNACCEPTED_DISPOSITION');
});
test.each(['quarantined', 'superseded'])('ordinary provider refresh preserves %s suppression and selection floor', status => {
  const s = sub(), p = status === 'quarantined' ? quarantine(effective(s), s) : supersede(effective(s), s);
  const n = refresh(p, s, f.event({ eventId: 'evt_new', created: f.SECOND + 1, planId: 'enterprise' }));
  expect(n.p.state).toMatchObject({ status, suppression: p.state.suppression, selectionFloor: p.state.selectionFloor });
  expect(choose(n.s, n.p).billing).toBeNull();
});
test('late terminal on superseded subscription cannot alter replacement disposition or grant', () => {
  const s = sub(), r = sub('sub_b'), rp = effective(r, 2), p = supersede(effective(s), s, r, rp);
  const n = refresh(p, s, f.event({ eventId: 'evt_terminal', created: f.SECOND + 1, status: 'canceled' }));
  expect(n.p.state.status).toBe('superseded');
  const decision = choose(r, rp, f.selectionProof(rp, r), { subscriptions: [n.s, r], dispositions: [n.p, rp] });
  expect(decision.billing.subscriptionId).toBe('sub_b');
  expect(rp).toEqual(effective(r, 2));
});
test.each(f.permutations(['select', 'conflict']))('same-second conflict is non-granting in either selection arrival order: %j', (a, b) => {
  let s = sub(), p = candidate(s);
  const e = f.event({ eventId: 'evt_conflict', planId: 'growth' });
  for (const step of [a, b]) {
    if (step === 'select' && !s.conflict) p = f.dispositionStep(p, s, 'select', { selection: f.lineage() });
    else if (step === 'select') expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage() })).toThrow('INVALID_DISPOSITION_TRANSITION');
    else ({ s, p } = refresh(p, s, e));
  }
  expect(choose(s, p, p.state.lineage ? f.selectionProof(p, s) : null).billing).toBeNull();
});
test.each(f.permutations(['incumbent', 'challenger']))('challenger/incumbent delivery %j requires the independent incumbent pointer', (a, b) => {
  const s = sub(), r = sub('sub_b'), p = effective(s), rp = candidate(r);
  const all = { incumbent: { s, p }, challenger: { s: r, p: rp } };
  const items = [all[a], all[b]];
  const extra = { subscriptions: items.map(x => x.s), dispositions: items.map(x => x.p) };
  expect(choose(s, p, f.selectionProof(p, s), extra)).toMatchObject({ billing: { subscriptionId: 'sub_a' } });
  expect(choose(s, p, null, extra).billing).toBeNull();
  expect(choose(r, rp, f.selectionProof(p, s))).toMatchObject({ billing: null, checkoutBlocked: true });
});
test('BILLING-024: retained terminal evidence cannot load active authority even if summary and revision are rewritten', () => {
  const s = f.feed([f.event({ status: 'canceled' })]);
  const forged = { ...s, lifecycleState: 'active' };
  const { revision, ...facts } = forged; forged.revision = hash(facts);
  expect(() => validateSubscription(forged)).toThrow('SUBSCRIPTION_TAMPERED');
});
test('BILLING-024: anchors are consistency proofs, not signatures or protection against whole-record substitution', () => {
  const s = sub(), p = effective(s);
  // A trusted complete snapshot is accepted. Authenticity/currentness cannot be inferred from JSON.
  expect(() => d.validateDisposition(copy(p.state), copy(p.accepted), copy(s))).not.toThrow();
  expect(() => d.validateDisposition(p.state, null, s)).toThrow('UNACCEPTED_DISPOSITION');
});

const deliveries = [
  f.event({ eventId: 'evt_conflict_a', created: f.SECOND + 1, planId: 'growth' }),
  f.event({ eventId: 'evt_conflict_b', created: f.SECOND + 1, planId: 'enterprise' }),
  f.event({ eventId: 'evt_newer', created: f.SECOND + 2, planId: 'scale' }),
];
test.each(['quarantined', 'superseded'].flatMap(status => f.permutations(deliveries).map(events =>
  [status, events.map(e => e.eventId).join(','), events])))('BILLING-022: %s survives provider permutation %s', (status, _, events) => {
  let s = sub(), p = status === 'quarantined' ? quarantine(effective(s), s) : supersede(effective(s), s);
  const suppression = p.state.suppression, floor = p.state.selectionFloor;
  for (const event of events) {
    const next = reduceSubscription(s, event).state;
    if (next.revision !== s.revision) p = f.dispositionStep(p, s, 'refresh', { event }, next);
    s = next;
    expect(p.state.status).toBe(status);
    expect(p.state.suppression).toEqual(suppression);
    expect(p.state.selectionFloor).toBe(floor);
    expect(choose(s, p).billing).toBeNull();
  }
  expect(s.lifecycleState).toBe('active');
});
test.each(f.permutations(['select', 'quarantine', 'refresh']))('selection/quarantine/provider model rejects silent recovery in order %j', (a, b, c) => {
  let s = sub(), p = candidate(s), suppressionSeen = false;
  for (const action of [a, b, c]) {
    if (action === 'quarantine') { p = quarantine(p, s); suppressionSeen = true; }
    else if (action === 'refresh') ({ s, p } = refresh(p, s, deliveries[2]));
    else if (suppressionSeen) expect(() => f.dispositionStep(p, s, 'select', { selection: f.lineage() })).toThrow('INVALID_DISPOSITION_TRANSITION');
    else p = f.dispositionStep(p, s, 'select', { selection: f.lineage() });
    if (suppressionSeen) expect(choose(s, p, p.state.lineage ? f.selectionProof(p, s) : null).billing).toBeNull();
  }
  expect(p.state.status).toBe('quarantined');
});
test.each(['status', 'revision', 'previousHash', 'subscriptionRevision', 'lineage', 'selectionFloor', 'suppression', 'transition'])(
  'loaded disposition mutation %s cannot use the current accepted record', field => {
    const s = sub(), p = effective(s), forged = copy(p.state);
    forged[field] = field === 'status' ? 'candidate' : field === 'revision' || field === 'selectionFloor' ? 99 :
      field === 'previousHash' || field === 'subscriptionRevision' ? '0'.repeat(64) : field === 'suppression' ? {} : null;
    expect(() => choose(s, { state: forged, accepted: p.accepted })).toThrow();
  });
test.each(['at', 'subscriptionRevision', 'previousHash', 'expectedRevision', 'type', 'customerId'])(
  'transition attestation binds exact %s', field => {
    const s = sub(), p = candidate(s), cmd = f.dispositionCommand(p, s, 'select', { selection: f.lineage() });
    cmd.evidence[field] = field === 'at' || field === 'expectedRevision' ? 0 : 'other';
    expect(() => d.reduceDisposition(p.accepted, p.state, cmd, s, s)).toThrow('UNTRUSTED_DISPOSITION_EVIDENCE');
  });
test('operator re-selection requires a named authenticated actor attestation', () => {
  const s = sub(), p = supersede(effective(s), s), selection = f.lineage(3, 'operator_reconciliation');
  delete selection.actorId;
  expect(() => f.dispositionStep(p, s, 'operator_reselect', { selection, resolvesHash: hash(p.state.suppression) })).toThrow('UNPROVEN_SELECTION_LINEAGE');
});
test('selection cannot consume a future disposition snapshot', () => {
  const s = sub(), p = f.dispositionStep(candidate(s), s, 'select', { selection: f.lineage() }, s, f.AT + 1);
  expect(() => choose(s, p)).toThrow('INVALID_SELECTION_CLOCK');
});

test('review: protected receipt can accompany an exact semantic refresh replay', () => {
  const s = sub(), p = effective(s), event = f.event({ eventId: 'evt_growth', created: f.SECOND + 1, planId: 'growth' });
  const observed = reduceSubscription(s, event);
  const next = f.dispositionStep(p, s, 'refresh', { event, priorReceipt: observed.receipt }, observed.state);
  expect(choose(observed.state, next).billing.planId).toBe('growth');
  for (const receipt of [{ ...observed.receipt, action: 'authority_committed' },
    { ...observed.receipt, authority: 'enterprise' }, { ...observed.receipt, eventHash: '0'.repeat(64) }]) {
    expect(() => f.dispositionStep(p, s, 'refresh', { event, priorReceipt: receipt }, observed.state)).toThrow('RECEIPT_MISMATCH');
  }
});
test('review: pointer selecting a superseded disposition requires explicit recovery', () => {
  const s = sub(), p = supersede(effective(s), s);
  expect(choose(s, p)).toMatchObject({ billing: null, checkoutBlocked: true,
    issues: [ { reason: 'legacy_unproven_lineage', recovery: { owner: 'billing_operations' } } ] });
});
test.each(['canceled', 'incomplete_expired'].flatMap(status => [true, false].map(pointer => [status, pointer])))(
  'review: coherent %s inventory permits replacement checkout; pointer=%s', (status, retainedPointer) => {
  const s = sub(), p = effective(s);
  const n = refresh(p, s, f.event({ eventId: 'evt_cancel', created: f.SECOND + 1, status }));
  expect(n.p.state.status).toBe('quarantined');
  expect(choose(n.s, n.p, retainedPointer ? f.selectionProof(n.p, n.s) : null)).toMatchObject({ billing: null, checkoutBlocked: false, issues: [] });
});
test('review: terminal evidence cannot silently clear an explicitly attested identity quarantine', () => {
  const s = sub(), p = f.dispositionStep(effective(s), s, 'quarantine', { reason: 'identity_conflict' });
  const n = refresh(p, s, f.event({ eventId: 'evt_cancel', created: f.SECOND + 1, status: 'canceled' }));
  expect(n.p.state.suppression).toEqual(p.state.suppression);
  expect(choose(n.s, n.p)).toMatchObject({ billing: null, checkoutBlocked: true });
});
test('review: terminal closure after reversible provider suppression permits checkout without reactivating authority', () => {
  const s = sub(), p = effective(s);
  let n = refresh(p, s, f.event({ eventId: 'evt_pause', created: f.SECOND + 1, status: 'paused' }));
  expect(choose(n.s, n.p).checkoutBlocked).toBe(true);
  const suppression = n.p.state.suppression;
  n = refresh(n.p, n.s, f.event({ eventId: 'evt_cancel', created: f.SECOND + 2, status: 'canceled' }));
  expect(n.p.state).toMatchObject({ status: 'quarantined', suppression });
  expect(choose(n.s, n.p)).toMatchObject({ billing: null, checkoutBlocked: false });
});
