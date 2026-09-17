'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SCRIPT = resolve(__dirname, '../../scripts/synchintro-synthetic-recovery.cjs');
const TOKEN = 'operator-token-must-never-be-printed';
const FETCH_MOCK = resolve(__dirname, '../fixtures/bookingRecoveryCliFetchMock.cjs');

function run(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { SYNCHINTRO_OPERATOR_ID_TOKEN: TOKEN })
    });
}

function runWithResponse(args, response) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
            SYNCHINTRO_OPERATOR_ID_TOKEN: TOKEN,
            SYNCHINTRO_CLI_TEST_RESPONSE: JSON.stringify(response),
            NODE_OPTIONS: `--require=${FETCH_MOCK}`
        })
    });
}

describe('governed synthetic recovery CLI', () => {
    test('pins bearer-token requests to the production API and rejects destination overrides', () => {
        const result = run(['inventory', '--base-url', 'https://attacker.invalid']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Unsupported --base-url argument');
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
        const source = readFileSync(SCRIPT, 'utf8');
        expect(source).toContain("const DEFAULT_BASE_URL = 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1'");
        expect(source).not.toContain("flags['base-url']");
    });

    test('rejects duplicate flags and requires exact per-record execute confirmation', () => {
        const duplicate = run(['inspect', '--reference', 'ONE', '--reference', 'TWO']);
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toContain('Duplicate --reference argument');
        const mismatch = run([
            'execute',
            '--reference', 'SYNCH-P2-0001_INITIAL',
            '--recovery-operation-id', 'recovery-operation-0001',
            '--confirm', 'SYNCH-P2-0001_REPLACEMENT'
        ]);
        expect(mismatch.status).toBe(1);
        expect(mismatch.stderr).toContain('--confirm must exactly match --reference');
        expect(`${duplicate.stdout}${duplicate.stderr}${mismatch.stdout}${mismatch.stderr}`).not.toContain(TOKEN);
    });

    test('exits nonzero when a successful HTTP response is invalid JSON', () => {
        const result = runWithResponse(['inventory'], { status: 200, invalidJson: true });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('non-JSON');
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each([
        [{ status: 200, body: { success: false, error: 'application failure' } }, 'application failure'],
        [{ status: 200, body: { success: true } }, 'missing'],
        [{ status: 200, body: { success: true, data: { classification: 'STATE_AMBIGUOUS' } } }, 'STATE_AMBIGUOUS'],
        [{ status: 429, body: { success: false, error: 'Rate limit exceeded' } }, 'Rate limit exceeded']
    ])('exits nonzero for non-success operator result %#', (response, marker) => {
        const result = runWithResponse(['inventory'], response);
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain(marker);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each([
        [
            ['inventory'],
            { success: true, data: { count: -1, records: [{ classification: 'UNSUPPORTED' }] } }
        ],
        [
            ['inspect', '--reference', 'SYNCH-P2-0004_RECORD'],
            { success: true, data: { reference: 'SYNCH-P2-0004_RECORD', classification: 'UNSUPPORTED' } }
        ],
        [
            ['dry-run', '--reference', 'SYNCH-P2-0004_RECORD'],
            { success: true, data: { receipt: { final_classification: 'ALREADY_CLEAN' } } }
        ],
        [
            [
                'execute', '--reference', 'SYNCH-P2-0004_RECORD',
                '--recovery-operation-id', 'recovery-operation-0001',
                '--confirm', 'SYNCH-P2-0004_RECORD'
            ],
            {
                success: true,
                data: {
                    classification: 'ALREADY_CLEAN',
                    receipt: { schema: 'synchintro-synthetic-recovery-receipt/v1' }
                }
            }
        ],
        [
            [
                'execute', '--reference', 'SYNCH-P2-0004_RECORD',
                '--recovery-operation-id', 'recovery-operation-0001',
                '--confirm', 'SYNCH-P2-0004_RECORD'
            ],
            {
                success: true,
                data: {
                    classification: 'ALREADY_CLEAN',
                    receipt: {
                        schema: 'synchintro-synthetic-recovery-receipt/v1',
                        reference: 'SYNCH-P2-0004_RECORD',
                        planned_action: 'NONE',
                        provider_action_attempted: false,
                        provider_action_count: 0,
                        communication_action_attempted: false,
                        communication_action_count: 0,
                        final_classification: 'STATE_AMBIGUOUS',
                        redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
                    }
                }
            }
        ],
        [
            [
                'execute', '--reference', 'SYNCH-P2-0004_RECORD',
                '--recovery-operation-id', 'recovery-operation-0001',
                '--confirm', 'SYNCH-P2-0004_RECORD'
            ],
            {
                success: true,
                data: {
                    classification: 'ALREADY_CLEAN',
                    receipt: {
                        schema: 'synchintro-synthetic-recovery-receipt/v1',
                        work_package: 'SYNCH-P2-0004',
                        reference: 'SYNCH-P2-0004_RECORD',
                        pre_state_classification: 'CANCEL_REQUIRED',
                        planned_action: 'SCHEDULER_BOOKING_DELETE',
                        provider_action_attempted: true,
                        provider_action_count: 1,
                        provider_outcome: 'AMBIGUOUS',
                        durable_state_transition: 'RECONCILIATION_REQUIRED',
                        communication_action_attempted: true,
                        communication_action_count: 1,
                        communication_outcome: 'RECONCILIATION_REQUIRED',
                        replay_result: 'FIRST_EXECUTION',
                        final_classification: 'ALREADY_CLEAN',
                        redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS',
                        receipt_id: 'rrc_receipt'
                    }
                }
            }
        ]
    ])('exits nonzero for malformed or unsupported command payload %#', (args, body) => {
        const result = runWithResponse(args, { status: 200, body });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each((() => {
        const inspection = {
            reference: 'SYNCH-P2-0004_RECORD',
            allowlisted: true,
            classification: 'CANCEL_REQUIRED',
            planned_action: 'SCHEDULER_BOOKING_DELETE'
        };
        const terminalReceipt = {
            schema: 'synchintro-synthetic-recovery-receipt/v1',
            work_package: 'SYNCH-P2-0004',
            receipt_id: 'rrc_receipt',
            reference: inspection.reference,
            pre_state_classification: 'ALREADY_CLEAN',
            planned_action: 'NONE',
            provider_action_attempted: false,
            provider_action_count: 0,
            provider_outcome: 'ALREADY_CANCELLED',
            durable_state_transition: 'CANCELLED',
            communication_action_attempted: false,
            communication_action_count: 0,
            communication_outcome: 'ALREADY_SENT',
            replay_result: 'FIRST_EXECUTION',
            final_classification: 'ALREADY_CLEAN',
            redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
        };
        const acceptedEvidenceReceipt = Object.assign({}, terminalReceipt, {
            planned_action: 'COMMUNICATION_EVIDENCE_ONLY',
            communication_action_attempted: true,
            communication_action_count: 1,
            communication_outcome: 'RECONCILED_ACCEPTED'
        });
        return [
            [['inventory'], { success: true, data: { count: 1, records: [inspection] } }],
            [['inspect', '--reference', inspection.reference], { success: true, data: inspection }],
            [[
                'dry-run', '--reference', inspection.reference
            ], {
                success: true,
                data: {
                    plan: inspection,
                    receipt: {
                        schema: 'synchintro-synthetic-recovery-dry-run/v1',
                        reference: inspection.reference,
                        pre_state_classification: inspection.classification,
                        planned_action: inspection.planned_action,
                        provider_action_attempted: false,
                        communication_action_attempted: false,
                        final_classification: inspection.classification,
                        persisted: false,
                        redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
                    }
                }
            }],
            [[
                'execute', '--reference', inspection.reference,
                '--recovery-operation-id', 'recovery-operation-0001',
                '--confirm', inspection.reference
            ], { success: true, data: { classification: 'ALREADY_CLEAN', receipt: terminalReceipt } }],
            [[
                'receipt', '--recovery-operation-id', 'recovery-operation-0001'
            ], { success: true, data: terminalReceipt }],
            [[
                'receipt', '--recovery-operation-id', 'recovery-operation-0001'
            ], { success: true, data: acceptedEvidenceReceipt }]
        ];
    })())('exits zero only for a complete recognized command payload %#', (args, body) => {
        const result = runWithResponse(args, { status: 200, body });
        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });
});
