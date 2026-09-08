'use strict';

const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');

const root = path.resolve(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).functions[0];

// Firebase Tools walks every directory with minimatch { matchBase: true, dot: true }.
// Exercise absolute file/ancestor paths: Git's ignored status is not an upload boundary.
function uploaded(relativeName) {
    const parts = relativeName.split('/');
    return !parts.some((_, index) => {
        const absolute = path.join(root, 'functions', ...parts.slice(0, index + 1));
        return config.ignore.some(pattern => minimatch(absolute, pattern, { matchBase: true, dot: true }));
    });
}

describe('Functions source upload boundary', () => {
    test.each([
        '.env', '.env.local', '.env.pathsynch-pitch-creation', '.env.example',
        '.secret.local', 'nested/.secret.local', 'nested/.env.local',
        'coverage/lcov.info', 'test-results/proof.json', 'scripts/audit-version-retention.cjs'
    ])('excludes local configuration or incident scratch: %s', file => {
        expect(uploaded(file)).toBe(false);
    });

    test.each([
        'index.js', 'package.json', 'package-lock.json', 'routes/bookingRoutes.js',
        'services/booking/nylasSchedulingProvider.js', 'services/booking/bookingPersistence.js',
        'utils/router.js'
    ])('retains required runtime source: %s', file => {
        expect(fs.existsSync(path.join(root, 'functions', file))).toBe(true);
        expect(uploaded(file)).toBe(true);
    });
});
