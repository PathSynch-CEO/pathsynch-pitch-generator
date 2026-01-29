/**
 * Error Handler Middleware Tests
 */

const {
  ErrorCodes,
  ErrorMessages,
  ApiError,
  isOperationalError,
  createErrorResponse,
  handleError,
  asyncHandler,
  mapError
} = require('../../middleware/errorHandler');

describe('Error Handler Middleware', () => {
  describe('ErrorCodes', () => {
    it('should have all required error codes', () => {
      const requiredCodes = [
        'VALIDATION_ERROR',
        'AUTHENTICATION_ERROR',
        'AUTHORIZATION_ERROR',
        'NOT_FOUND',
        'RATE_LIMIT',
        'CONFLICT',
        'INTERNAL_ERROR',
        'EXTERNAL_SERVICE_ERROR',
        'BAD_REQUEST'
      ];

      requiredCodes.forEach(code => {
        expect(ErrorCodes[code]).toBeDefined();
      });
    });

    it('should have corresponding messages for all codes', () => {
      Object.values(ErrorCodes).forEach(code => {
        expect(ErrorMessages[code]).toBeDefined();
      });
    });
  });

  describe('ApiError', () => {
    it('should create error with code and default message', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND);

      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe(ErrorMessages[ErrorCodes.NOT_FOUND]);
      expect(error.status).toBe(404);
      expect(error.isOperational).toBe(true);
    });

    it('should create error with custom message', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND, 'User not found');

      expect(error.message).toBe('User not found');
    });

    it('should create error with details', () => {
      const details = [{ field: 'email', message: 'Invalid email' }];
      const error = new ApiError(ErrorCodes.VALIDATION_ERROR, null, details);

      expect(error.details).toEqual(details);
    });

    it('should have correct status codes', () => {
      expect(new ApiError(ErrorCodes.VALIDATION_ERROR).status).toBe(400);
      expect(new ApiError(ErrorCodes.AUTHENTICATION_ERROR).status).toBe(401);
      expect(new ApiError(ErrorCodes.AUTHORIZATION_ERROR).status).toBe(403);
      expect(new ApiError(ErrorCodes.NOT_FOUND).status).toBe(404);
      expect(new ApiError(ErrorCodes.RATE_LIMIT).status).toBe(429);
      expect(new ApiError(ErrorCodes.CONFLICT).status).toBe(409);
      expect(new ApiError(ErrorCodes.INTERNAL_ERROR).status).toBe(500);
      expect(new ApiError(ErrorCodes.EXTERNAL_SERVICE_ERROR).status).toBe(503);
    });

    it('should be instance of Error', () => {
      const error = new ApiError(ErrorCodes.INTERNAL_ERROR);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('isOperationalError', () => {
    it('should return true for ApiError', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND);
      expect(isOperationalError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isOperationalError(error)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isOperationalError(null)).toBe(false);
      expect(isOperationalError(undefined)).toBe(false);
    });
  });

  describe('createErrorResponse', () => {
    it('should create response for ApiError', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND, 'Resource not found');
      const response = createErrorResponse(error);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Resource not found');
      expect(response.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('should include details in response', () => {
      const details = [{ field: 'email', message: 'Required' }];
      const error = new ApiError(ErrorCodes.VALIDATION_ERROR, 'Validation failed', details);
      const response = createErrorResponse(error);

      expect(response.details).toEqual(details);
    });

    it('should hide internal details in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Internal database error');
      const response = createErrorResponse(error);

      expect(response.error).toBe(ErrorMessages[ErrorCodes.INTERNAL_ERROR]);
      expect(response.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(response.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should include stack trace in development when requested', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Test error');
      const response = createErrorResponse(error, true);

      expect(response.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('handleError', () => {
    it('should send proper response for ApiError', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND, 'Not found');
      const res = global.testUtils.mockResponse();

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      handleError(error, res, 'TestContext');

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Not found');

      consoleSpy.mockRestore();
    });

    it('should send 500 for unknown errors', () => {
      const error = new Error('Unknown error');
      const res = global.testUtils.mockResponse();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      handleError(error, res, 'TestContext');

      expect(res.statusCode).toBe(500);

      consoleSpy.mockRestore();
    });

    it('should log error with context', () => {
      const error = new Error('Test error');
      const res = global.testUtils.mockResponse();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      handleError(error, res, 'MyEndpoint');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[MyEndpoint] Error:',
        expect.objectContaining({ message: 'Test error' })
      );

      consoleSpy.mockRestore();
    });
  });

  describe('asyncHandler', () => {
    it('should call handler normally when no error', async () => {
      const handler = async (req, res) => {
        res.status(200).json({ success: true });
      };

      const wrapped = asyncHandler(handler);
      const req = global.testUtils.mockRequest();
      const res = global.testUtils.mockResponse();

      await wrapped(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should catch and handle errors', async () => {
      const handler = async () => {
        throw new Error('Async error');
      };

      const wrapped = asyncHandler(handler, 'TestHandler');
      const req = global.testUtils.mockRequest();
      const res = global.testUtils.mockResponse();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await wrapped(req, res);

      expect(res.statusCode).toBe(500);

      consoleSpy.mockRestore();
    });

    it('should catch and handle ApiError', async () => {
      const handler = async () => {
        throw new ApiError(ErrorCodes.NOT_FOUND, 'Item not found');
      };

      const wrapped = asyncHandler(handler);
      const req = global.testUtils.mockRequest();
      const res = global.testUtils.mockResponse();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await wrapped(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Item not found');

      consoleSpy.mockRestore();
    });
  });

  describe('mapError', () => {
    it('should map Firebase auth errors', () => {
      const error = new Error('Auth error');
      error.code = 'auth/invalid-token';

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.AUTHENTICATION_ERROR);
    });

    it('should map Firestore permission-denied', () => {
      const error = new Error('Permission denied');
      error.code = 'permission-denied';

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.AUTHORIZATION_ERROR);
    });

    it('should map Firestore not-found', () => {
      const error = new Error('Not found');
      error.code = 'not-found';

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('should map Stripe errors', () => {
      const error = new Error('Stripe error');
      error.type = 'StripeCardError';

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    });

    it('should map Joi validation errors', () => {
      const error = new Error('Validation error');
      error.isJoi = true;
      error.details = [{ path: ['email'], message: '"email" is required' }];

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(mapped.details).toHaveLength(1);
    });

    it('should return ApiError unchanged', () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND, 'Custom message');

      const mapped = mapError(error);

      expect(mapped).toBe(error);
    });

    it('should wrap unknown errors', () => {
      const error = new Error('Unknown error');

      const mapped = mapError(error);

      expect(mapped.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });
  });
});
