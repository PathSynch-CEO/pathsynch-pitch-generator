/**
 * Jest Test Setup
 *
 * This file runs before each test file.
 * Sets up global mocks and test utilities.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@test.com,support@test.com';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://test.app';

// Suppress console logs during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
//   error: console.error
// };

// Global test utilities
global.testUtils = {
  /**
   * Create a mock Express request object
   */
  mockRequest: (overrides = {}) => ({
    method: 'GET',
    path: '/',
    params: {},
    query: {},
    body: {},
    headers: {},
    ip: '127.0.0.1',
    userId: null,
    userEmail: null,
    ...overrides
  }),

  /**
   * Create a mock Express response object
   */
  mockResponse: () => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      headersSent: false
    };

    res.status = jest.fn((code) => {
      res.statusCode = code;
      return res;
    });

    res.json = jest.fn((data) => {
      res.body = data;
      res.headersSent = true;
      return res;
    });

    res.send = jest.fn((data) => {
      res.body = data;
      res.headersSent = true;
      return res;
    });

    res.setHeader = jest.fn((name, value) => {
      res.headers[name] = value;
      return res;
    });

    return res;
  },

  /**
   * Wait for async operations
   */
  flushPromises: () => new Promise(resolve => setImmediate(resolve)),

  /**
   * Generate random test data
   */
  randomEmail: () => `test-${Date.now()}@example.com`,
  randomId: () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
};

// Extend Jest matchers
expect.extend({
  /**
   * Check if response is a success response
   */
  toBeSuccessResponse(received) {
    const pass = received.body?.success === true;
    return {
      pass,
      message: () =>
        pass
          ? `Expected response not to be a success response`
          : `Expected response to be a success response, got: ${JSON.stringify(received.body)}`
    };
  },

  /**
   * Check if response is an error response
   */
  toBeErrorResponse(received, expectedStatus) {
    const statusPass = expectedStatus ? received.statusCode === expectedStatus : received.statusCode >= 400;
    const bodyPass = received.body?.success === false;
    const pass = statusPass && bodyPass;

    return {
      pass,
      message: () =>
        pass
          ? `Expected response not to be an error response`
          : `Expected error response with status ${expectedStatus || '>=400'}, got status ${received.statusCode} with body: ${JSON.stringify(received.body)}`
    };
  }
});
