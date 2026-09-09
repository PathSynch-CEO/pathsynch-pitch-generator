'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { removeMember } = require('../services/workspaceService');
test('editable owner pointer cannot redirect protected team removal to another workspace', async () => {
 admin._resetMockData();
 require('./helpers/entitlementFixtures').seed(admin._mockData.collections, { ownerUid: 'attacker', plan: 'scale', workspaceId: 'ws', memberUids: ['member'] });
 admin._setMockCollection('workspaces', { ws: { ownerId: 'victim', entitlementOwnerUid: 'victim', memberIds: ['attacker','member'], memberCount: 2 } });
 admin._setMockCollection('teams', { attacker: { members: [{ uid: 'member' }], memberUids: ['attacker','member'] }, victim: { members: [{ uid: 'victim-member' }], memberUids: ['victim','victim-member'] } });
 await removeMember('ws', 'member', { updatedTeamMembers: [] });
 expect(admin._mockData.collections.teams.victim.members).toEqual([{ uid: 'victim-member' }]);
 expect(admin._mockData.collections.teams.attacker.memberUids).not.toContain('member');
});
