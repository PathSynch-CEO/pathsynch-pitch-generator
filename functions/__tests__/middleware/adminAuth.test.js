/**
 * Admin Auth Middleware Tests
 */

// Mock firebase-admin before requiring the module
jest.mock('firebase-admin');

const admin = require('firebase-admin');
const {
  requireAdmin,
  checkIsAdmin,
  isAdminEmail,
  getAdminEmails,
  refreshAdminEmails
} = require('../../middleware/adminAuth');

describe('Admin Auth Middleware', () => {
  beforeEach(() => {
    // Reset environment variable
    process.env.ADMIN_EMAILS = 'admin@test.com,support@test.com';
    // Reset mocks
    jest.clearAllMocks();
    admin._resetMockData();
  });

  describe('isAdminEmail', () => {
    it('should return true for admin emails', () => {
      expect(isAdminEmail('admin@test.com')).toBe(true);
      expect(isAdminEmail('support@test.com')).toBe(true);
    });

    it('should return false for non-admin emails', () => {
      expect(isAdminEmail('user@test.com')).toBe(false);
      expect(isAdminEmail('random@example.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAdminEmail('ADMIN@TEST.COM')).toBe(true);
      expect(isAdminEmail('Admin@Test.Com')).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(isAdminEmail(null)).toBe(false);
      expect(isAdminEmail(undefined)).toBe(false);
      expect(isAdminEmail('')).toBe(false);
    });
  });

  describe('getAdminEmails', () => {
    it('should return copy of admin emails array', () => {
      const emails = getAdminEmails();

      expect(emails).toContain('admin@test.com');
      expect(emails).toContain('support@test.com');
    });

    it('should return a copy, not the original array', () => {
      const emails1 = getAdminEmails();
      const emails2 = getAdminEmails();

      emails1.push('modified@test.com');

      expect(emails2).not.toContain('modified@test.com');
    });
  });

  describe('refreshAdminEmails', () => {
    it('should refresh admin emails from environment', () => {
      // Change the env variable
      process.env.ADMIN_EMAILS = 'new@test.com';

      const count = refreshAdminEmails();

      expect(count).toBe(1);
      expect(isAdminEmail('new@test.com')).toBe(true);
      expect(isAdminEmail('admin@test.com')).toBe(false);

      // Reset for other tests
      process.env.ADMIN_EMAILS = 'admin@test.com,support@test.com';
      refreshAdminEmails();
    });
  });

  describe('requireAdmin middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = global.testUtils.mockRequest();
      res = global.testUtils.mockResponse();
      next = jest.fn();
    });

    it('should return 401 if not authenticated', async () => {
      req.userId = null;

      await requireAdmin(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 for anonymous users', async () => {
      req.userId = 'anonymous';

      await requireAdmin(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 if user has no email', async () => {
      req.userId = 'user123';

      admin._setMockUser('user123', {
        uid: 'user123',
        email: null
      });

      await requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('verified email');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 if user is not admin', async () => {
      req.userId = 'user123';

      admin._setMockUser('user123', {
        uid: 'user123',
        email: 'regular@test.com'
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('admin privileges');
      expect(consoleSpy).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should call next() for admin users', async () => {
      req.userId = 'admin123';

      admin._setMockUser('admin123', {
        uid: 'admin123',
        email: 'admin@test.com'
      });

      await requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.isAdmin).toBe(true);
      expect(req.adminEmail).toBe('admin@test.com');
    });

    it('should handle Firebase auth errors gracefully', async () => {
      req.userId = 'user123';

      admin.auth().getUser.mockRejectedValueOnce(new Error('Auth service error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await requireAdmin(req, res, next);

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Authentication error');
      expect(next).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('checkIsAdmin', () => {
    it('should return false for null userId', async () => {
      const result = await checkIsAdmin(null);
      expect(result).toBe(false);
    });

    it('should return false for anonymous', async () => {
      const result = await checkIsAdmin('anonymous');
      expect(result).toBe(false);
    });

    it('should return false for non-admin users', async () => {
      admin._setMockUser('user123', {
        uid: 'user123',
        email: 'regular@test.com'
      });

      const result = await checkIsAdmin('user123');
      expect(result).toBe(false);
    });

    it('should return true for admin users', async () => {
      admin._setMockUser('admin123', {
        uid: 'admin123',
        email: 'admin@test.com'
      });

      const result = await checkIsAdmin('admin123');
      expect(result).toBe(true);
    });

    it('should return false on auth error', async () => {
      admin.auth().getUser.mockRejectedValueOnce(new Error('Error'));

      const result = await checkIsAdmin('user123');
      expect(result).toBe(false);
    });
  });

  describe('Environment variable parsing', () => {
    it('should handle missing ADMIN_EMAILS env var', () => {
      const originalEnv = process.env.ADMIN_EMAILS;
      delete process.env.ADMIN_EMAILS;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      refreshAdminEmails();

      expect(getAdminEmails()).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ADMIN_EMAILS environment variable not set')
      );

      consoleSpy.mockRestore();
      process.env.ADMIN_EMAILS = originalEnv;
      refreshAdminEmails();
    });

    it('should trim whitespace from emails', () => {
      process.env.ADMIN_EMAILS = '  admin@test.com  ,  support@test.com  ';

      refreshAdminEmails();

      expect(isAdminEmail('admin@test.com')).toBe(true);
      expect(isAdminEmail('support@test.com')).toBe(true);

      process.env.ADMIN_EMAILS = 'admin@test.com,support@test.com';
      refreshAdminEmails();
    });

    it('should filter out invalid emails', () => {
      process.env.ADMIN_EMAILS = 'admin@test.com,invalid,support@test.com,';

      refreshAdminEmails();

      const emails = getAdminEmails();
      expect(emails).toContain('admin@test.com');
      expect(emails).toContain('support@test.com');
      expect(emails).not.toContain('invalid');
      expect(emails).not.toContain('');

      process.env.ADMIN_EMAILS = 'admin@test.com,support@test.com';
      refreshAdminEmails();
    });
  });
});
