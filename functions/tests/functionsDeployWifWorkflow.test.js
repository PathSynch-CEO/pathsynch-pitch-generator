'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const FIREBASE_PATH = path.join(ROOT, 'firebase.json');
const DEPLOY_GUARD_PATH = path.join(ROOT, 'scripts', 'assert-clean-deploy.cjs');

const EXPECTED_PROJECT = 'pathsynch-pitch-creation';
const EXPECTED_PROVIDER =
    'projects/796921234100/locations/global/workloadIdentityPools/github-actions/providers/pathsynch-pitch-generator';
const EXPECTED_SERVICE_ACCOUNT =
    'gh-synchintro-functions@pathsynch-pitch-creation.iam.gserviceaccount.com';
const EXPECTED_DEPLOY_COMMAND =
    'npx firebase-tools deploy --only functions --project pathsynch-pitch-creation --non-interactive';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function workflowFiles() {
    const workflowDir = path.join(ROOT, '.github', 'workflows');
    return fs.readdirSync(workflowDir)
        .filter(name => /\.ya?ml$/i.test(name))
        .map(name => `.github/workflows/${name}`);
}

function activeSurfaceFiles() {
    return [
        ...workflowFiles(),
        '.firebaserc',
        'firebase.json',
        'package.json',
        'functions/package.json',
        'scripts/assert-clean-deploy.cjs'
    ];
}

function executableContent(relativePath) {
    const source = read(relativePath);
    if (/\.ya?ml$/i.test(relativePath)) return JSON.stringify(yaml.load(source));
    if (/\.json$/i.test(relativePath) || relativePath === '.firebaserc') {
        return JSON.stringify(JSON.parse(source));
    }
    return source;
}

function deployJobBlock(source) {
    const match = source.match(/^  deploy:\n([\s\S]*)$/m);
    if (!match) throw new Error('deploy job is missing from .github/workflows/ci.yml');
    return match[0];
}

describe('disabled Functions deploy WIF/ADC contract', () => {
    let ciSource;
    let ci;
    let deploy;

    beforeAll(() => {
        ciSource = fs.readFileSync(CI_PATH, 'utf8').replace(/\r\n/g, '\n');
        ci = yaml.load(ciSource);
        deploy = ci.jobs.deploy;
    });

    test('production deploy remains hard-disabled by literal if: false', () => {
        const block = deployJobBlock(ciSource);
        expect(block.match(/^    if: false$/gm) || []).toHaveLength(1);
        expect(deploy.if).toBe(false);
    });

    test('deploy job has only the permissions required for WIF', () => {
        expect(deploy.permissions).toEqual({
            contents: 'read',
            'id-token': 'write'
        });
        expect(ci.permissions).toEqual({ contents: 'read' });
    });

    test('pins the approved WIF identity and current action versions', () => {
        const checkout = deploy.steps.find(step => step.uses && step.uses.startsWith('actions/checkout@'));
        const auth = deploy.steps.find(step => step.uses && step.uses.startsWith('google-github-actions/auth@'));
        const setupNode = deploy.steps.find(step => step.uses && step.uses.startsWith('actions/setup-node@'));

        expect(checkout.uses).toBe('actions/checkout@v7');
        expect(setupNode.uses).toBe('actions/setup-node@v7');
        expect(auth.uses).toBe('google-github-actions/auth@v3');
        expect(auth.with).toEqual({
            project_id: EXPECTED_PROJECT,
            workload_identity_provider: EXPECTED_PROVIDER,
            service_account: EXPECTED_SERVICE_ACCOUNT,
            create_credentials_file: true,
            export_environment_variables: true
        });
    });

    test('preserves disabled deploy behavior, project, scope, dependencies, and timeout', () => {
        const deployStep = deploy.steps.find(step => step.run && step.run.includes('firebase-tools deploy'));

        expect(deploy.needs).toEqual(['test']);
        expect(deploy['timeout-minutes']).toBe(20);
        expect(deploy.environment).toBe('production');
        expect(deployStep.run).toBe(EXPECTED_DEPLOY_COMMAND);
        expect(JSON.stringify(deploy)).not.toMatch(/FIREBASE_TOKEN/i);
    });

    test('rejects legacy Firebase refresh-token auth from active CI/deploy/config surfaces', () => {
        const forbidden = [
            { label: 'FIREBASE_TOKEN', pattern: /FIREBASE_TOKEN/i },
            { label: 'firebase login:ci', pattern: /firebase\s+login:ci/i },
            { label: 'Firebase CLI --token auth', pattern: /firebase(?:-tools)?[^\n]*--token(?:\s|=|$)/i },
            { label: 'legacy Firebase refresh token', pattern: /firebase(?:_|-|\s)?refresh(?:_|-|\s)?token/i },
            { label: 'firebaseToken setting', pattern: /firebaseToken/i }
        ];
        const violations = [];

        for (const file of activeSurfaceFiles()) {
            const executable = executableContent(file);
            for (const { label, pattern } of forbidden) {
                const match = executable.match(pattern);
                if (match) violations.push({ file, label, match: match[0] });
            }
        }

        expect(violations).toEqual([]);
    });

    test('keeps the existing clean-source deploy guard wired first', () => {
        const firebase = JSON.parse(fs.readFileSync(FIREBASE_PATH, 'utf8'));
        const functionsConfig = Array.isArray(firebase.functions) ? firebase.functions[0] : firebase.functions;

        expect(functionsConfig.predeploy[0]).toBe('node ./scripts/assert-clean-deploy.cjs');
        expect(fs.existsSync(DEPLOY_GUARD_PATH)).toBe(true);
    });
});
