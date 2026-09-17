#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const DEFAULT_BASE_URL = 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1';
const COMMANDS = new Set(['inventory', 'inspect', 'dry-run', 'execute', 'receipt']);
const COMMAND_FLAGS = Object.freeze({
    inventory: new Set(),
    inspect: new Set(['reference']),
    'dry-run': new Set(['reference']),
    execute: new Set(['reference', 'recovery-operation-id', 'confirm']),
    receipt: new Set(['recovery-operation-id'])
});

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}

function argumentsMap(values) {
    const [command, ...rest] = values;
    const flags = {};
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
            throw new Error('Arguments must be supplied as --name value pairs');
        }
        const name = key.slice(2);
        if (Object.prototype.hasOwnProperty.call(flags, name)) {
            throw new Error(`Duplicate --${name} argument`);
        }
        flags[name] = value;
    }
    return { command, flags };
}

const CLASSIFICATIONS = new Set([
    'ALREADY_CLEAN',
    'CANCEL_REQUIRED',
    'PROVIDER_RECONCILIATION_REQUIRED',
    'COMMUNICATION_RECONCILIATION_REQUIRED',
    'STATE_AMBIGUOUS',
    'MANUAL_REVIEW_REQUIRED'
]);
const PLANNED_ACTIONS = new Set([
    'SCHEDULER_BOOKING_DELETE',
    'LOCAL_RECONCILIATION_ONLY',
    'SEND_CONTROLLED_SYNTHETIC_CANCELLATION',
    'COMMUNICATION_EVIDENCE_ONLY',
    'NONE'
]);
const PROVIDER_OUTCOMES = new Set([
    'ACTIVE',
    'ALREADY_CANCELLED',
    'AMBIGUOUS',
    'CANCELLED',
    'DEFINITIVE_REJECTION',
    'NOT_ATTEMPTED',
    'RECONCILED_CANCELLED',
    'RECONCILIATION_UNRESOLVED'
]);
const COMMUNICATION_OUTCOMES = new Set([
    'ALREADY_SENT',
    'ALREADY_SETTLED',
    'AMBIGUOUS',
    'NOT_ATTEMPTED',
    'NOT_CONFIGURED',
    'RECONCILIATION_REQUIRED',
    'RECONCILED_ACCEPTED',
    'RECONCILED_DELIVERED',
    'REPLAN_REQUIRED',
    'SENT'
]);
const DURABLE_TRANSITIONS = new Set([
    'CANCELLED',
    'MANUAL_REVIEW_REQUIRED',
    'RECONCILIATION_REQUIRED'
]);
const REPLAY_RESULTS = new Set(['FIRST_EXECUTION', 'IDEMPOTENT_REPLAY']);
const CLEAN_PROVIDER_OUTCOMES = new Set([
    'ALREADY_CANCELLED', 'CANCELLED', 'NOT_ATTEMPTED', 'RECONCILED_CANCELLED'
]);
const CLEAN_COMMUNICATION_OUTCOMES = new Set([
    'ALREADY_SENT', 'ALREADY_SETTLED', 'RECONCILED_ACCEPTED', 'RECONCILED_DELIVERED', 'SENT'
]);
const DIGEST = /^[a-f0-9]{64}$/;
const ATTENTION_CLASSIFICATIONS = new Set(['STATE_AMBIGUOUS', 'MANUAL_REVIEW_REQUIRED']);
const INSPECTION_ACTIONS = Object.freeze({
    ALREADY_CLEAN: new Set(['NONE']),
    CANCEL_REQUIRED: new Set(['SCHEDULER_BOOKING_DELETE']),
    PROVIDER_RECONCILIATION_REQUIRED: new Set(['LOCAL_RECONCILIATION_ONLY']),
    COMMUNICATION_RECONCILIATION_REQUIRED: new Set([
        'SEND_CONTROLLED_SYNTHETIC_CANCELLATION', 'COMMUNICATION_EVIDENCE_ONLY'
    ]),
    STATE_AMBIGUOUS: new Set(['NONE']),
    MANUAL_REVIEW_REQUIRED: new Set(['NONE'])
});
const RECEIPT_ACTIONS = Object.freeze({
    ...INSPECTION_ACTIONS,
    COMMUNICATION_RECONCILIATION_REQUIRED: new Set([
        ...INSPECTION_ACTIONS.COMMUNICATION_RECONCILIATION_REQUIRED,
        'NONE'
    ])
});

function exactDigest(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function validInspection(value, expectedReference = null) {
    return isRecord(value)
        && typeof value.reference === 'string' && value.reference.length > 0
        && (!expectedReference || value.reference === expectedReference)
        && value.allowlisted === true
        && CLASSIFICATIONS.has(value.classification)
        && PLANNED_ACTIONS.has(value.planned_action)
        && INSPECTION_ACTIONS[value.classification]?.has(value.planned_action) === true;
}

function validReceipt(value) {
    const structurallyValid = isRecord(value)
        && value.schema === 'synchintro-synthetic-recovery-receipt/v1'
        && value.work_package === 'SYNCH-P2-0004'
        && typeof value.receipt_id === 'string' && value.receipt_id.startsWith('rrc_')
        && typeof value.reference === 'string' && value.reference.length > 0
        && typeof value.source_work_package === 'string' && value.source_work_package.length > 0
        && DIGEST.test(value.operation_document_id_digest)
        && DIGEST.test(value.session_id_digest)
        && DIGEST.test(value.workspace_id_digest)
        && DIGEST.test(value.allowlist_identity_digest)
        && DIGEST.test(value.provider_configuration_digest)
        && value.allowlist_evidence === 'SERVER_AUTHORITATIVE_EXACT_BINDING'
        && value.intent === 'CANCEL_AND_RECONCILE'
        && DIGEST.test(value.recovery_operation_digest)
        && DIGEST.test(value.actor_uid_digest)
        && DIGEST.test(value.actor_email_digest)
        && value.actor_role === 'super_admin'
        && CLASSIFICATIONS.has(value.pre_state_classification)
        && PLANNED_ACTIONS.has(value.planned_action)
        && typeof value.provider_action_attempted === 'boolean'
        && Number.isSafeInteger(value.provider_action_count) && value.provider_action_count >= 0
        && value.provider_action_count === (value.provider_action_attempted ? 1 : 0)
        && PROVIDER_OUTCOMES.has(value.provider_outcome)
        && DURABLE_TRANSITIONS.has(value.durable_state_transition)
        && typeof value.communication_action_attempted === 'boolean'
        && Number.isSafeInteger(value.communication_action_count) && value.communication_action_count >= 0
        && value.communication_action_count === (value.communication_action_attempted ? 1 : 0)
        && COMMUNICATION_OUTCOMES.has(value.communication_outcome)
        && REPLAY_RESULTS.has(value.replay_result)
        && CLASSIFICATIONS.has(value.final_classification)
        && value.redaction_status === 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS';
    if (!structurallyValid) return false;
    if (RECEIPT_ACTIONS[value.pre_state_classification]?.has(value.planned_action) !== true) {
        return false;
    }
    if (value.pre_state_classification === 'ALREADY_CLEAN'
        && (value.planned_action !== 'NONE'
            || value.provider_action_attempted !== false
            || value.provider_action_count !== 0
            || value.provider_outcome !== 'ALREADY_CANCELLED'
            || value.communication_action_attempted !== false
            || value.communication_action_count !== 0
            || value.communication_outcome !== 'ALREADY_SETTLED')) {
        return false;
    }
    if (value.final_classification === 'ALREADY_CLEAN') {
        return value.durable_state_transition === 'CANCELLED'
            && CLEAN_PROVIDER_OUTCOMES.has(value.provider_outcome)
            && CLEAN_COMMUNICATION_OUTCOMES.has(value.communication_outcome);
    }
    if (value.final_classification === 'MANUAL_REVIEW_REQUIRED') {
        return value.durable_state_transition === 'MANUAL_REVIEW_REQUIRED';
    }
    if (value.final_classification === 'COMMUNICATION_RECONCILIATION_REQUIRED') {
        return value.durable_state_transition === 'CANCELLED';
    }
    return value.durable_state_transition === 'RECONCILIATION_REQUIRED';
}

function validDryRun(value) {
    return isRecord(value)
        && value.schema === 'synchintro-synthetic-recovery-dry-run/v1'
        && typeof value.reference === 'string' && value.reference.length > 0
        && CLASSIFICATIONS.has(value.pre_state_classification)
        && CLASSIFICATIONS.has(value.final_classification)
        && value.pre_state_classification === value.final_classification
        && PLANNED_ACTIONS.has(value.planned_action)
        && value.provider_action_attempted === false
        && value.communication_action_attempted === false
        && value.persisted === false
        && value.redaction_status === 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS';
}

function validationFailure(command, result, context = {}) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return 'Operator API returned a malformed response';
    }
    if (result.success !== true) {
        return String(result.error || 'Operator API reported application failure');
    }
    const data = result.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return 'Operator API response is missing required result data';
    }
    if (command === 'inventory') {
        if (!Number.isSafeInteger(data.count) || data.count < 0 || !Array.isArray(data.records)
            || data.count !== data.records.length
            || !data.records.every((record) => validInspection(record))) {
            return 'Operator inventory response is missing required result fields';
        }
        return null;
    }
    if (command === 'receipt') {
        if (!validReceipt(data)
            || data.recovery_operation_digest !== exactDigest(context.recoveryOperationId)) {
            return 'Operator receipt response is malformed or unsupported';
        }
        if (data.final_classification !== 'ALREADY_CLEAN') {
            return `Operator receipt requires attention: ${data.final_classification}`;
        }
        return null;
    }
    if (command === 'inspect') {
        if (!validInspection(data, context.reference)) {
            return 'Operator inspection response is malformed or unsupported';
        }
        return ATTENTION_CLASSIFICATIONS.has(data.classification)
            ? `Operator inspection requires attention: ${data.classification}`
            : null;
    }
    if (command === 'dry-run') {
        if (!validInspection(data.plan, context.reference) || !validDryRun(data.receipt)
            || data.plan.reference !== data.receipt.reference
            || data.plan.classification !== data.receipt.final_classification
            || data.plan.planned_action !== data.receipt.planned_action) {
            return 'Operator dry-run response is malformed or unsupported';
        }
        if (ATTENTION_CLASSIFICATIONS.has(data.plan.classification)) {
            return `Operator dry-run requires attention: ${data.plan.classification}`;
        }
        return null;
    }
    const classification = data.classification;
    if (!CLASSIFICATIONS.has(classification)) {
        return 'Operator response has a missing or unsupported classification';
    }
    if (command === 'execute') {
        if (!validReceipt(data.receipt)
            || data.receipt.final_classification !== classification
            || data.receipt.reference !== context.reference
            || data.receipt.recovery_operation_digest !== exactDigest(context.recoveryOperationId)) {
            return 'Operator execution response is missing required receipt fields';
        }
        if (classification !== 'ALREADY_CLEAN') {
            return `Operator execution requires attention: ${classification}`;
        }
    }
    return null;
}

async function main() {
    const { command, flags } = argumentsMap(process.argv.slice(2));
    if (!COMMANDS.has(command)) {
        throw new Error('Command must be inventory, inspect, dry-run, execute, or receipt');
    }
    const unexpected = Object.keys(flags).find((name) => !COMMAND_FLAGS[command].has(name));
    if (unexpected) throw new Error(`Unsupported --${unexpected} argument for ${command}`);
    const token = String(process.env.SYNCHINTRO_OPERATOR_ID_TOKEN || '').trim();
    if (!token) throw new Error('SYNCHINTRO_OPERATOR_ID_TOKEN is required');
    const reference = String(flags.reference || '').trim().toUpperCase();
    const recoveryOperationId = String(flags['recovery-operation-id'] || '').trim();
    let method = 'GET';
    let path = '/admin/synchintro/synthetic-recovery';
    let body;
    if (command === 'inspect') {
        if (!reference) throw new Error('--reference is required');
        path += `/${encodeURIComponent(reference)}`;
    } else if (command === 'dry-run') {
        if (!reference) throw new Error('--reference is required');
        method = 'POST';
        path += `/${encodeURIComponent(reference)}/dry-run`;
        body = {};
    } else if (command === 'execute') {
        if (!reference || !recoveryOperationId) {
            throw new Error('--reference and --recovery-operation-id are required');
        }
        if (String(flags.confirm || '').trim().toUpperCase() !== reference) {
            throw new Error('--confirm must exactly match --reference');
        }
        method = 'POST';
        path += `/${encodeURIComponent(reference)}/execute`;
        body = { recovery_operation_id: recoveryOperationId };
    } else if (command === 'receipt') {
        if (!recoveryOperationId) throw new Error('--recovery-operation-id is required');
        path += `/receipts/${encodeURIComponent(recoveryOperationId)}`;
    }
    const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60_000)
    });
    const result = await response.json().catch(() => ({
        success: false,
        error: 'Operator API returned a non-JSON response'
    }));
    process.stdout.write(`${JSON.stringify({ http_status: response.status, result }, null, 2)}\n`);
    const applicationFailure = validationFailure(command, result, { reference, recoveryOperationId });
    if (!response.ok || applicationFailure) {
        fail(applicationFailure || `Operator API request failed with HTTP ${response.status}`);
    }
}

main().catch((error) => fail(String(error?.message || 'Operator command failed')));
