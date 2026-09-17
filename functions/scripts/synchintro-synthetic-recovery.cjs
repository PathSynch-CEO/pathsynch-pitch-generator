#!/usr/bin/env node
'use strict';

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
    'NOT_ALLOWLISTED',
    'UNSUPPORTED',
    'MANUAL_REVIEW_REQUIRED'
]);

function validationFailure(command, result) {
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
        if (!Number.isSafeInteger(data.count) || !Array.isArray(data.records)) {
            return 'Operator inventory response is missing required result fields';
        }
        return null;
    }
    if (command === 'receipt') {
        if (data.schema !== 'synchintro-synthetic-recovery-receipt/v1'
            || !CLASSIFICATIONS.has(data.final_classification)) {
            return 'Operator receipt response is malformed or unsupported';
        }
        return null;
    }
    const classification = command === 'dry-run'
        ? data.plan?.classification || data.receipt?.final_classification
        : data.classification;
    if (!CLASSIFICATIONS.has(classification)) {
        return 'Operator response has a missing or unsupported classification';
    }
    if (command === 'execute') {
        if (!data.receipt || data.receipt.schema !== 'synchintro-synthetic-recovery-receipt/v1') {
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
    const applicationFailure = validationFailure(command, result);
    if (!response.ok || applicationFailure) {
        fail(applicationFailure || `Operator API request failed with HTTP ${response.status}`);
    }
}

main().catch((error) => fail(String(error?.message || 'Operator command failed')));
