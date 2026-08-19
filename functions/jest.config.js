/**
 * Jest Configuration
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/*.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    // Never scan sibling git worktrees created by the agent harness under .claude/ — they are full
    // repo copies whose duplicate test files and manual mocks otherwise collide with this suite.
    '/\\.claude/',
    '\\.emulator\\.test\\.js$'
  ],
  // Same guard for jest-haste-map, which crawls for package.json/__mocks__ and would otherwise report
  // "duplicate manual mock" collisions from the worktree copies.
  modulePathIgnorePatterns: [
    '/\\.claude/'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!jest.config.js',
    '!**/__tests__/**',
    '!**/__mocks__/**'
  ],

  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },

  coverageReporters: ['text', 'lcov', 'html'],

  // Setup files
  setupFilesAfterEnv: ['./__tests__/setup.js'],

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Timeout for tests
  testTimeout: 10000,

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true
};
