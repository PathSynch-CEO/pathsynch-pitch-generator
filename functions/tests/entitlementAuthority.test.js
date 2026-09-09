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

function unresolvedResponse() {
  const res = {
    statusCode: 200, body: null, headers: {}, writes: [], ended: false,
    status: jest.fn(code => { res.statusCode = code; return res; }),
    json: jest.fn(body => { res.body = body; return res; }),
    setHeader: jest.fn((name, value) => { res.headers[name] = value; }),
    write: jest.fn(chunk => { res.writes.push(chunk); }),
    end: jest.fn(() => { res.ended = true; }),
  };
  return res;
}

test.each([
  ['requireFeature', () => require('../middleware/planGate').requireFeature('pptExport')],
  ['checkUsageLimit', () => require('../middleware/planGate').checkUsageLimit('pitches')],
  ['requireFormatter', () => require('../middleware/planGate').requireFormatter('deck')],
  ['checkNarrativeLimit', () => require('../middleware/planGate').checkNarrativeLimit()],
])('%s preserves unresolved authority as 409', async (_label, createGuard) => {
  const res = unresolvedResponse();
  const next = jest.fn();
  await createGuard()({ userId: 'fixture-owner', body: {} }, res, next);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.body).toMatchObject({ success: false, code: 'ENTITLEMENT_UNRESOLVED' });
  expect(next).not.toHaveBeenCalled();
});

test.each([
  ['narrative generation', async (req, res) => require('../api/narratives').generateNarrative(req, res),
    { userId: 'fixture-owner', userEmail: 'fixture@example.test', body: {} }],
  ['narrative regeneration', async (req, res) => require('../api/narratives').regenerateNarrative(req, res),
    { userId: 'fixture-owner', params: { id: 'narrative' }, body: {} }],
  ['single formatter', async (req, res) => require('../api/formatterApi').formatNarrativeEndpoint(req, res),
    { userId: 'fixture-owner', params: { id: 'narrative', type: 'deck' }, body: {} }],
  ['batch formatter', async (req, res) => require('../api/formatterApi').batchFormatEndpoint(req, res),
    { userId: 'fixture-owner', params: { id: 'narrative' }, body: { assetTypes: ['deck'] } }],
  ['formatter listing', async (req, res) => require('../api/formatterApi').listFormatters(req, res),
    { userId: 'fixture-owner', body: {} }],
])('%s returns reconciliation 409 for unresolved authority', async (_label, invoke, req) => {
  const res = unresolvedResponse();
  await invoke(req, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.body).toMatchObject({ success: false, code: 'ENTITLEMENT_UNRESOLVED' });
});

test('streaming narrative rejects unresolved authority before opening SSE', async () => {
  const res = unresolvedResponse();
  await require('../api/narratives').streamNarrativeGeneration({
    userId: 'fixture-owner', userEmail: 'fixture@example.test', body: {},
  }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.body).toMatchObject({ success: false, code: 'ENTITLEMENT_UNRESOLVED' });
  expect(res.setHeader).not.toHaveBeenCalled();
  expect(res.write).not.toHaveBeenCalled();
});