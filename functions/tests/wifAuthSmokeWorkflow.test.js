'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    '.github',
    'workflows',
    'wif-auth-smoke.yml'
);

const EXPECTED_PROVIDER =
    'projects/796921234100/locations/global/workloadIdentityPools/github-actions/providers/pathsynch-pitch-generator';
const EXPECTED_SERVICE_ACCOUNT =
    'gh-synchintro-functions@pathsynch-pitch-creation.iam.gserviceaccount.com';

function readWorkflow() {
    return fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n');
}

describe('WIF authentication smoke workflow safety contract', () => {
    let workflow;

    beforeAll(() => {
        workflow = readWorkflow();
    });

    test('is manual-only and grants only the permissions required for OIDC', () => {
        const triggerBlock = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m);
        const permissionsBlock = workflow.match(/^permissions:\n([\s\S]*?)\njobs:/m);

        expect(triggerBlock).not.toBeNull();
        expect(triggerBlock[1].trim()).toBe('workflow_dispatch:');
        expect(permissionsBlock).not.toBeNull();
        expect(permissionsBlock[1].trim().split('\n').map((line) => line.trim())).toEqual([
            'contents: read',
            'id-token: write'
        ]);
    });

    test('cannot authenticate from a pull-request or feature-branch ref', () => {
        expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' }}");
        expect(workflow).not.toMatch(/pull_request\s*:/);
        expect(workflow).not.toMatch(/push\s*:/);
    });

    test('uses the approved WIF provider, deploy service account, and project', () => {
        expect(workflow).toContain('uses: actions/checkout@v7');
        expect(workflow).toContain('uses: google-github-actions/auth@v3');
        expect(workflow).toContain('project_id: pathsynch-pitch-creation');
        expect(workflow).toContain(`workload_identity_provider: ${EXPECTED_PROVIDER}`);
        expect(workflow).toContain(`service_account: ${EXPECTED_SERVICE_ACCOUNT}`);
        expect(workflow).toContain('create_credentials_file: true');
        expect(workflow).toContain('export_environment_variables: true');
    });

    test('contains only read-only proof commands and no deploy or legacy-token path', () => {
        const forbidden = [
            { label: 'deployment command or action', pattern: /\bdeploy(?:ment)?\b/i },
            { label: 'legacy Firebase token', pattern: /FIREBASE_TOKEN|firebase\s+login:ci|--token\b/i },
            { label: 'IAM mutation', pattern: /add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy/i },
            { label: 'resource mutation', pattern: /\bgcloud\s+[^\n]*(?:create|update|delete|remove|set)\b/i },
            { label: 'credential disclosure', pattern: /print-access-token|cat\s+[^\n]*GOOGLE_APPLICATION_CREDENTIALS|auth_token|credentials_file_path/i }
        ];

        for (const { label, pattern } of forbidden) {
            expect({ label, match: workflow.match(pattern)?.[0] || null }).toEqual({
                label,
                match: null
            });
        }

        expect(workflow).toContain("gcloud auth list --filter=status:ACTIVE --format='value(account)'");
        expect(workflow).toContain('gcloud config get-value project');
        expect(workflow).toContain('gcloud functions list');
    });
});
