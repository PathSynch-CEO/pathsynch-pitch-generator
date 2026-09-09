'use strict';
jest.mock('firebase-admin');
jest.mock('../middleware/planGate', () => ({
  ...jest.requireActual('../middleware/planGate'),
  getUserPlanForRequest: jest.fn(async () => { throw new Error('Stopped before generation'); })
}));
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
const admin = require('firebase-admin');
const { getUserPlanForRequest } = require('../middleware/planGate');
const { refreshReport } = require('../api/market');

const stored = { userId: 'creator', createdByUid: 'creator', workspaceId: 'workspace-a' };
beforeEach(() => admin._resetMockData());

test.each([
  ['former member in solo mode', stored, { userId: 'creator', workspaceId: null }, 403],
  ['soft-deleted report', { ...stored, deletedAt: new Date() }, { userId: 'creator', workspaceId: 'workspace-a', workspaceRole: 'contributor' }, 404],
  ['other workspace', stored, { userId: 'manager', workspaceId: 'workspace-b', workspaceRole: 'manager' }, 403],
  ['other contributor', stored, { userId: 'other', workspaceId: 'workspace-a', workspaceRole: 'contributor' }, 403]
])('refresh rejects %s before plan lookup or generation', async (_label, report, caller, status) => {
  admin._setMockCollection('marketReports', { report });
  const req = { ...caller, params: { reportId: 'report' }, body: {} };
  const res = testUtils.mockResponse();
  await refreshReport(req, res);
  expect(res.statusCode).toBe(status);
  expect(getUserPlanForRequest).not.toHaveBeenCalled();
  expect(req.marketRefresh).toBeUndefined();
});

test.each([
  ['solo owner', { ...stored, workspaceId: null }, { userId: 'creator', workspaceId: null }],
  ['workspace manager', stored, { userId: 'manager', workspaceId: 'workspace-a', workspaceRole: 'manager' }]
])('refresh permits %s through preflight', async (_label, report, caller) => {
  admin._setMockCollection('marketReports', { report });
  const res = testUtils.mockResponse();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await refreshReport({ ...caller, params: { reportId: 'report' }, body: {} }, res);
    expect(getUserPlanForRequest).toHaveBeenCalledTimes(1);
    expect(res.body.message).toBe('Stopped before generation');
  } finally { log.mockRestore(); }
});
