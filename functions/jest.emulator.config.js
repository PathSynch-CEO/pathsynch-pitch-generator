/**
 * Jest config for emulator-backed rules tests (F-601).
 *
 * Runs ONLY *.emulator.test.js against a live Firestore emulator via
 * @firebase/rules-unit-testing. These suites assert the P0 onepager share-leak
 * prevention and the Gate #7 workspace tenant-isolation rules against the real
 * production `firestore.rules`.
 *
 * They are EXCLUDED from the default `npm test` (jest.config.js:19) because that
 * run mocks firebase-admin; each emulator suite calls jest.unmock('firebase-admin')
 * to talk to the real emulator, which requires FIRESTORE_EMULATOR_HOST — set by
 * `firebase emulators:exec`. Hence a separate config + run.
 *
 * Run: npm run test:emulator   (starts the Firestore emulator, then jest)
 */
module.exports = {
  testEnvironment: 'node',

  // Emulator suites only.
  testMatch: ['**/*.emulator.test.js'],

  // NOTE: intentionally omits the `\\.emulator\\.test\\.js$` ignore that jest.config.js
  // uses — this config exists precisely to run those files.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Same global setup as the unit suite (env vars, matchers). It does no mocking.
  setupFilesAfterEnv: ['./__tests__/setup.js'],

  moduleDirectories: ['node_modules', '<rootDir>'],

  // Emulator round-trips are slower than mocked unit tests.
  testTimeout: 30000,

  clearMocks: true,
  verbose: true,
};
