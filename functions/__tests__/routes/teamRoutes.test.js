/**
 * Team Routes Tests — Schema B
 *
 * Schema B: teams/{ownerUid} with embedded members[] + memberUids[]
 *           teamInvitations/{autoId} for pending invites
 *
 * Valid roles: 'admin', 'contributor', 'viewer'
 */

jest.mock('firebase-admin');
jest.mock('../../services/email', () => ({
  sendTeamInviteEmail: jest.fn().mockResolvedValue(true)
}));

const admin = require('firebase-admin');
const teamRoutes = require('../../routes/teamRoutes');
const emailService = require('../../services/email');

/** Seed a Schema B team owned by 'user_123' with one contributor member 'user_456' */
function seedTeamWithMember() {
  admin._setMockCollection('teams', {
    'user_123': {
      ownerUid:        'user_123',
      ownerEmail:      'owner@test.com',
      ownerDisplayName: 'Team Owner',
      members: [
        { uid: 'user_456', email: 'member@test.com', displayName: 'Member', role: 'contributor', status: 'active' }
      ],
      memberUids: ['user_456'],
      createdAt: { toDate: () => new Date() },
      updatedAt: { toDate: () => new Date() }
    }
  });
}

describe('Team Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
  });

  // ─── GET /team ─────────────────────────────────────────────────────────────

  describe('GET /team', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({ method: 'GET', path: '/team', userId: null });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return solo mode (null data) for users without team', async () => {
      // No teams collection set up — user has no team in Schema B
      const req = global.testUtils.mockRequest({ method: 'GET', path: '/team', userId: 'user_123' });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('should return team info for team owner', async () => {
      seedTeamWithMember();

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/team', userId: 'user_123' });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ownerUid).toBe('user_123');
      expect(res.body.data.isOwner).toBe(true);
      expect(res.body.data.members.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── POST /team/invite ─────────────────────────────────────────────────────
  // In Schema B there is no POST /team endpoint; team docs are lazy-initialised
  // the first time the owner sends an invitation.

  describe('POST /team/invite', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/team/invite',
        userId: null,
        body: { email: 'invite@test.com', role: 'contributor' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return 403 if caller is a member but not the owner', async () => {
      // teams/{user_123} does not exist — user_456 is not an owner
      admin._setMockCollection('teams', {
        'user_123': {
          ownerUid:   'user_123',
          ownerEmail: 'owner@test.com',
          members:    [{ uid: 'user_456', email: 'member@test.com', role: 'contributor' }],
          memberUids: ['user_456']
        }
      });

      const req = global.testUtils.mockRequest({
        method:  'POST',
        path:    '/team/invite',
        userId:  'user_456',   // member, not owner
        userEmail: 'member@test.com',
        body:    { email: 'newperson@test.com', role: 'contributor' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(403);
    });

    it('should return 403 if user has no team and is not an owner', async () => {
      // teams/{user_123} does not exist — no team at all
      const req = global.testUtils.mockRequest({
        method:    'POST',
        path:      '/team/invite',
        userId:    'user_123',
        userEmail: 'owner@test.com',
        body:      { email: 'newperson@test.com', role: 'contributor' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      // Caller is not an owner (no teams/{userId} doc) and not a member of any team
      expect(res.statusCode).toBe(403);
    });

    it('should send invite successfully when caller owns a team', async () => {
      seedTeamWithMember();
      // Ensure no prior invite exists
      admin._setMockCollection('teamInvitations', {});

      const req = global.testUtils.mockRequest({
        method:    'POST',
        path:      '/team/invite',
        userId:    'user_123',
        userEmail: 'owner@test.com',
        body:      { email: 'newmember@test.com', role: 'contributor' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitationId).toBeDefined();
      expect(emailService.sendTeamInviteEmail).toHaveBeenCalled();
    });

    it('should return 409 if email is already pending', async () => {
      seedTeamWithMember();
      admin._setMockCollection('teamInvitations', {
        'invite_1': {
          teamOwnerUid: 'user_123',
          inviteeEmail: 'existing@test.com',
          status:       'pending'
        }
      });

      const req = global.testUtils.mockRequest({
        method:    'POST',
        path:      '/team/invite',
        userId:    'user_123',
        userEmail: 'owner@test.com',
        body:      { email: 'existing@test.com', role: 'contributor' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(409);
    });
  });

  // ─── POST /team/accept ─────────────────────────────────────────────────────

  describe('POST /team/accept', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path:   '/team/accept',
        userId: null,
        body:   { invitationId: 'invite_abc' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return 400 without invitationId', async () => {
      const req = global.testUtils.mockRequest({
        method:    'POST',
        path:      '/team/accept',
        userId:    'user_456',
        userEmail: 'invitee@test.com',
        body:      {}
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(400);
    });

    it('should accept invite successfully', async () => {
      seedTeamWithMember();
      const futureDate = new Date(Date.now() + 86400000);
      admin._setMockCollection('teamInvitations', {
        'invite_abc': {
          teamOwnerUid: 'user_123',
          inviteeEmail: 'newuser@test.com',
          role:         'contributor',
          status:       'pending',
          expiresAt:    { toDate: () => futureDate }
        }
      });
      admin._setMockCollection('users', {
        'user_789': { displayName: 'New User' }
      });

      const req = global.testUtils.mockRequest({
        method:    'POST',
        path:      '/team/accept',
        userId:    'user_789',
        userEmail: 'newuser@test.com',
        body:      { invitationId: 'invite_abc' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teamOwnerUid).toBe('user_123');
    });
  });

  // ─── POST /team/remove ─────────────────────────────────────────────────────

  describe('POST /team/remove', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path:   '/team/remove',
        userId: null,
        body:   { memberUid: 'user_456' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return 404 if caller has no team (not an owner)', async () => {
      // No teams/{user_123} doc — caller is not an owner
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path:   '/team/remove',
        userId: 'user_123',
        body:   { memberUid: 'user_456' }
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(404);
    });

    it('should not allow removing yourself', async () => {
      seedTeamWithMember();

      const req = global.testUtils.mockRequest({
        method: 'POST',
        path:   '/team/remove',
        userId: 'user_123',
        body:   { memberUid: 'user_123' } // same as caller
      });
      const res = global.testUtils.mockResponse();

      await teamRoutes.handle(req, res);

      expect(res.statusCode).toBe(400);
    });
  });
});
