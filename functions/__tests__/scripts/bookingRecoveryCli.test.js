'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SCRIPT = resolve(__dirname, '../../scripts/synchintro-synthetic-recovery.cjs');
const TOKEN = 'operator-token-must-never-be-printed';
const FETCH_MOCK = resolve(__dirname, '../fixtures/bookingRecoveryCliFetchMock.cjs');
const RECOVERY_OPERATION_ID = 'recovery-operation-0001';

function exactDigest(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function terminalReceipt(overrides = {}) {
    return Object.assign({
        schema: 'synchintro-synthetic-recovery-receipt/v1',
        work_package: 'SYNCH-P2-0004',
        receipt_id: 'rrc_receipt',
        reference: 'SYNCH-P2-0004_RECORD',
        source_work_package: 'SYNCH-P2-0003',
        operation_document_id_digest: '1'.repeat(64),
        session_id_digest: '2'.repeat(64),
        workspace_id_digest: '3'.repeat(64),
        allowlist_identity_digest: '4'.repeat(64),
        provider_configuration_digest: '5'.repeat(64),
        allowlist_evidence: 'SERVER_AUTHORITATIVE_EXACT_BINDING',
        intent: 'CANCEL_AND_RECONCILE',
        recovery_operation_digest: exactDigest(RECOVERY_OPERATION_ID),
        actor_uid_digest: '6'.repeat(64),
        actor_email_digest: '7'.repeat(64),
        actor_role: 'super_admin',
        pre_state_classification: 'ALREADY_CLEAN',
        planned_action: 'NONE',
        provider_action_attempted: false,
        provider_action_count: 0,
        provider_outcome: 'ALREADY_CANCELLED',
        durable_state_transition: 'CANCELLED',
        communication_action_attempted: false,
        communication_action_count: 0,
        communication_outcome: 'ALREADY_SETTLED',
        replay_result: 'FIRST_EXECUTION',
        final_classification: 'ALREADY_CLEAN',
        redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
    }, overrides);
}

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

    test('accepts a multi-record inventory when every record is independently valid', () => {
        const records = [
            { reference: 'SYNCH-P2-0004_RECORD_1', allowlisted: true,
                classification: 'CANCEL_REQUIRED', planned_action: 'SCHEDULER_BOOKING_DELETE' },
            { reference: 'SYNCH-P2-0004_RECORD_2', allowlisted: true,
                classification: 'ALREADY_CLEAN', planned_action: 'NONE' }
        ];
        const result = runWithResponse(['inventory'], {
            status: 200,
            body: { success: true, data: { count: records.length, records } }
        });
        expect(result.status).toBe(0);
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
        const receipt = terminalReceipt({ reference: inspection.reference });
        const acceptedEvidenceReceipt = Object.assign({}, receipt, {
            pre_state_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED',
            planned_action: 'COMMUNICATION_EVIDENCE_ONLY',
            communication_action_attempted: true,
            communication_action_count: 1,
            communication_outcome: 'RECONCILED_ACCEPTED'
        });
        const externallySettledReceipt = Object.assign({}, receipt, {
            pre_state_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED',
            planned_action: 'NONE',
            communication_outcome: 'ALREADY_SENT'
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
            ], { success: true, data: { classification: 'ALREADY_CLEAN', receipt } }],
            [[
                'receipt', '--recovery-operation-id', 'recovery-operation-0001'
            ], { success: true, data: receipt }],
            [[
                'receipt', '--recovery-operation-id', 'recovery-operation-0001'
            ], { success: true, data: acceptedEvidenceReceipt }],
            [[
                'receipt', '--recovery-operation-id', 'recovery-operation-0001'
            ], { success: true, data: externallySettledReceipt }]
        ];
    })())('exits zero only for a complete recognized command payload %#', (args, body) => {
        const result = runWithResponse(args, { status: 200, body });
        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each([
        [
            { reference: 'SYNCH-P2-0004_OTHER', allowlisted: true,
                classification: 'CANCEL_REQUIRED', planned_action: 'SCHEDULER_BOOKING_DELETE' },
            'another reference'
        ],
        [
            { reference: 'SYNCH-P2-0004_RECORD', allowlisted: true,
                classification: 'ALREADY_CLEAN', planned_action: 'SCHEDULER_BOOKING_DELETE' },
            'impossible action'
        ],
        [
            { reference: 'SYNCH-P2-0004_RECORD', allowlisted: true,
                classification: 'STATE_AMBIGUOUS', planned_action: 'NONE' },
            'ambiguous state'
        ],
        [
            { reference: 'SYNCH-P2-0004_RECORD', allowlisted: true,
                classification: 'MANUAL_REVIEW_REQUIRED', planned_action: 'NONE' },
            'manual review state'
        ]
    ])('rejects an inspect result for %s (%s)', (inspection) => {
        const result = runWithResponse([
            'inspect', '--reference', 'SYNCH-P2-0004_RECORD'
        ], { status: 200, body: { success: true, data: inspection } });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each([
        [
            ['execute', '--reference', 'SYNCH-P2-0004_RECORD',
                '--recovery-operation-id', RECOVERY_OPERATION_ID,
                '--confirm', 'SYNCH-P2-0004_RECORD'],
            { success: true, data: { classification: 'ALREADY_CLEAN',
                receipt: terminalReceipt({ reference: 'SYNCH-P2-0004_OTHER' }) } }
        ],
        [
            ['execute', '--reference', 'SYNCH-P2-0004_RECORD',
                '--recovery-operation-id', RECOVERY_OPERATION_ID,
                '--confirm', 'SYNCH-P2-0004_RECORD'],
            { success: true, data: { classification: 'ALREADY_CLEAN',
                receipt: terminalReceipt({ recovery_operation_digest: '8'.repeat(64) }) } }
        ],
        [
            ['receipt', '--recovery-operation-id', RECOVERY_OPERATION_ID],
            { success: true, data: terminalReceipt({ recovery_operation_digest: '8'.repeat(64) }) }
        ]
    ])('rejects a terminal receipt not bound to the CLI invocation %#', (args, body) => {
        const result = runWithResponse(args, { status: 200, body });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });

    test.each([
        terminalReceipt({ planned_action: 'SCHEDULER_BOOKING_DELETE' }),
        terminalReceipt({
            provider_action_attempted: true,
            provider_action_count: 1,
            provider_outcome: 'CANCELLED'
        }),
        terminalReceipt({
            pre_state_classification: 'PROVIDER_RECONCILIATION_REQUIRED',
            planned_action: 'SCHEDULER_BOOKING_DELETE',
            provider_action_attempted: true,
            provider_action_count: 1,
            provider_outcome: 'CANCELLED'
        }),
        terminalReceipt({
            pre_state_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED',
            planned_action: 'SCHEDULER_BOOKING_DELETE',
            provider_action_attempted: true,
            provider_action_count: 1,
            provider_outcome: 'CANCELLED'
        })
    ])('rejects a receipt with an impossible pre-state action %#', (receipt) => {
        const result = runWithResponse([
            'execute', '--reference', 'SYNCH-P2-0004_RECORD',
            '--recovery-operation-id', RECOVERY_OPERATION_ID,
            '--confirm', 'SYNCH-P2-0004_RECORD'
        ], { status: 200, body: { success: true, data: {
            classification: 'ALREADY_CLEAN', receipt
        } } });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    });
});
