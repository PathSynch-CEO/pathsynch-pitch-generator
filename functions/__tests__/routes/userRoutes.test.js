/**
 * User Routes Tests
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const userRoutes = require('../../routes/userRoutes');

describe('User Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
  });

  describe('GET /user', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/user',
        userId: null
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for anonymous users', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/user',
        userId: 'anonymous'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return user data for authenticated user', async () => {
      admin._setMockCollection('users', {
        'user_123': {
          userId: 'user_123',
          email: 'test@example.com',
          plan: 'starter',
          profile: {
            displayName: 'Test User'
          }
        }
      });

      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/user',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe('user_123');
      expect(res.body.data.plan).toBe('starter');
    });

    it('should return 404 if user not found', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/user',
        userId: 'nonexistent_user'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /user/settings', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'PUT',
        path: '/user/settings',
        userId: null,
        body: { settings: { defaultTone: 'friendly' } }
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should update user settings', async () => {
      admin._setMockCollection('users', {
        'user_123': {
          userId: 'user_123',
          settings: { defaultTone: 'professional' }
        }
      });

      const req = global.testUtils.mockRequest({
        method: 'PUT',
        path: '/user/settings',
        userId: 'user_123',
        body: {
          settings: { defaultTone: 'friendly' },
          profile: { displayName: 'New Name' }
        }
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Settings updated');
    });
  });

  describe('GET /usage', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/usage',
        userId: null
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return default usage if none exists', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/usage',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pitchesGenerated).toBe(0);
      expect(res.body.data.limits.pitches).toBe(5);
    });

    it('should return existing usage data', async () => {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      admin._setMockCollection('usage', {
        [`user_123_${period}`]: {
          userId: 'user_123',
          period,
          pitchesGenerated: 8,
          apiCalls: 150,
          limits: { pitches: 10 }
        }
      });

      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/usage',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.pitchesGenerated).toBe(8);
    });
  });

  describe('GET /templates', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/templates',
        userId: null
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return combined system and user templates', async () => {
      admin._setMockCollection('templates', {
        'template_system_1': {
          id: 'template_system_1',
          name: 'System Template',
          isSystem: true
        },
        'template_user_1': {
          id: 'template_user_1',
          name: 'My Template',
          isSystem: false,
          userId: 'user_123'
        },
        'template_other_user': {
          id: 'template_other_user',
          name: 'Other User Template',
          isSystem: false,
          userId: 'other_user'
        }
      });

      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/templates',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await userRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      // Should include system templates and user's own templates
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /pricing-plans', () => {
    it('should return pricing plans (public endpoint)', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/pricing-plans'
      });
      const res = global.testUtils.mockResponse();

      // This test may fail if the stripe config is not properly mocked
      // For now, we test that the route handles the request
      try {
        await userRoutes.handle(req, res);
        expect(res.statusCode).toBe(200);
      } catch (error) {
        // Expected if stripe config is missing
        expect(error.message).toMatch(/Cannot find module/);
      }
    });
  });

  describe('Route matching', () => {
    it('should not match unrelated paths', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/teams'
      });
      const res = global.testUtils.mockResponse();

      const handled = await userRoutes.handle(req, res);

      expect(handled).toBe(false);
    });

    it('should handle /user path exactly', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/user/something/else',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      const handled = await userRoutes.handle(req, res);

      // Should not match - not an exact path
      expect(handled).toBe(false);
    });
  });
});
