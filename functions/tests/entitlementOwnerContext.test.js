'use strict';
jest.mock('../services/workspaceService', () => ({
  getActiveWorkspacesForUser: async () => [{ id: 'fixture-workspace', ownerId: 'forged-payer', entitlementOwnerUid: 'forged-payer' }],
  getMembership: async () => ({ uid: 'fixture-owner', workspaceId: 'fixture-workspace', status: 'active', role: 'admin', isWorkspaceOwner: true })
}));
jest.mock('../services/workspaceEntitlements', () => ({ workspaceOwner: jest.fn(async () => 'fixture-owner') }));
const { resolveWorkspace } = require('../middleware/workspaceResolver');
test('editable workspace payer fields cannot replace protected owner identity on the request', async () => {
  const req = { userId: 'fixture-owner', headers: { 'x-workspace-id': 'fixture-workspace' } };
  await resolveWorkspace(req);
  expect(req.entitlementOwnerUid).toBe('fixture-owner');
});
