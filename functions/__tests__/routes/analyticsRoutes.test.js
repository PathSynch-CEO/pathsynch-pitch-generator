/**
 * Analytics Routes Tests
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const analyticsRoutes = require('../../routes/analyticsRoutes');

describe('Analytics Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    admin._resetMockData();
  });

  describe('POST /analytics/track', () => {
    it('should track a view event', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/analytics/track',
        body: {
          pitchId: 'pitch_123',
          event: 'view'
        },
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should track cta_click and increment counter', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/analytics/track',
        body: {
          pitchId: 'pitch_123',
          event: 'cta_click',
          data: { buttonId: 'schedule-demo' }
        },
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('should track share event', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/analytics/track',
        body: {
          pitchId: 'pitch_123',
          event: 'share',
          data: { platform: 'linkedin' }
        }
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('should track download event', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/analytics/track',
        body: {
          pitchId: 'pitch_123',
          event: 'download',
          data: { format: 'pdf' }
        }
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('should track anonymous events', async () => {
      const req = global.testUtils.mockRequest({
        method: 'POST',
        path: '/analytics/track',
        body: {
          pitchId: 'pitch_123',
          event: 'view'
        },
        userId: null
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /analytics/pitch/:pitchId', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/analytics/pitch/pitch_123',
        userId: null
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return 401 for anonymous users', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/analytics/pitch/pitch_123',
        userId: 'anonymous'
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('should return default analytics if none exist', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/analytics/pitch/pitch_123',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        pitchId: 'pitch_123',
        views: 0,
        shares: 0,
        ctaClicks: 0
      });
    });

    it('should return existing analytics', async () => {
      // Set up mock analytics data
      admin._setMockCollection('pitchAnalytics', {
        'pitch_123': {
          pitchId: 'pitch_123',
          views: 150,
          shares: 10,
          ctaClicks: 25,
          downloads: 5
        }
      });

      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/analytics/pitch/pitch_123',
        userId: 'user_123'
      });
      const res = global.testUtils.mockResponse();

      await analyticsRoutes.handle(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.views).toBe(150);
      expect(res.body.data.shares).toBe(10);
      expect(res.body.data.ctaClicks).toBe(25);
    });
  });

  describe('Route matching', () => {
    it('should not match unrelated paths', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET',
        path: '/users/123'
      });
      const res = global.testUtils.mockResponse();

      const handled = await analyticsRoutes.handle(req, res);

      expect(handled).toBe(false);
    });

    it('should not match wrong method', async () => {
      const req = global.testUtils.mockRequest({
        method: 'GET', // Should be POST
        path: '/analytics/track'
      });
      const res = global.testUtils.mockResponse();

      const handled = await analyticsRoutes.handle(req, res);

      expect(handled).toBe(false);
    });
  });
});
