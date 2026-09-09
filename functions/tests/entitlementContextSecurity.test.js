'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { resolveWorkspaceContext } = require('../services/memberContextService');
const { getWorkspaceById } = require('../services/workspaceService');
beforeEach(() => {
  admin._resetMockData();
  admin._setMockCollection('users', { owner: { subscription: { plan: 'enterprise' }, sellerProfile: { company: 'Correct' } }, victim: { sellerProfile: { company: 'Unrelated private profile' } } });
  admin._setMockCollection('workspaces', { ws: { ownerId: 'owner', entitlementOwnerUid: 'victim', id: 'forged-id' } });
  admin._setMockCollection('workspaceMembers', { ws_owner: { uid: 'owner', workspaceId: 'ws', isWorkspaceOwner: true, status: 'active', role: 'admin' } });
  admin._setMockCollection('accountPlanAssignments', { owner: { schemaVersion: 1, subjectUid: 'owner', planId: 'scale', status: 'active', revision: 1, source: 'operator', actorUid: 'operator', effectiveAt: new Date('2026-01-01'), expiresAt: null } });
});
test('editable workspace id cannot replace Firestore identity', async () => {
  expect((await getWorkspaceById('ws')).id).toBe('ws');
});
test('workspace context uses protected owner and canonical plan for client presentation', async () => {
  const result = await resolveWorkspaceContext('owner');
  expect(result.ownerUid).toBe('owner');
  expect(result.workspaceId).toBe('ws');
  expect(result.sellerProfile).toEqual({ company: 'Correct' });
  expect(result.plan).toBe('scale');
  expect(result.subscription?.plan).not.toBe('enterprise');
});
