'use strict';

const crypto = require('node:crypto');
const allowlistEvidence = require('../../../docs/evidence/SYNCH-P2-0004-BYTE-EXACT-ALLOWLIST.json');

const {
    INTENT,
    emailAddressDigest,
    opaqueIdentifierDigest,
    operationDocumentId,
    resolveRecoveryAllowlistEntry,
    listRecoveryAllowlistEntries
} = require('../../services/booking/bookingRecoveryAllowlist');

describe('governed synthetic recovery allowlist', () => {
    test('contains exactly seven explicit governed records', () => {
        expect(listRecoveryAllowlistEntries()).toHaveLength(7);
    });

    test('uses unique operator-safe references and operation digests', () => {
        const entries = listRecoveryAllowlistEntries();
        expect(new Set(entries.map((entry) => entry.reference)).size).toBe(7);
        expect(new Set(entries.map((entry) => entry.idempotency_key_digest)).size).toBe(7);
    });

    test('binds every record to workspace, session, identity, operation, and provider digests', () => {
        for (const entry of listRecoveryAllowlistEntries()) {
            for (const key of [
                'idempotency_key_digest', 'operation_document_id_digest', 'session_id_digest',
                'workspace_id_digest', 'synthetic_identity_digest', 'provider_configuration_digest'
            ]) expect(entry[key]).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    test('derives only the canonical digest-addressed operation document', () => {
        for (const entry of listRecoveryAllowlistEntries()) {
            expect(operationDocumentId(entry)).toBe(`op_${entry.idempotency_key_digest}`);
            expect(entry.operation_document_id_digest)
                .toBe(opaqueIdentifierDigest(operationDocumentId(entry)));
        }
    });

    test('resolves references case-insensitively but never by heuristic', () => {
        expect(resolveRecoveryAllowlistEntry('synch-p2-0003_acceptance_2')?.reference)
            .toBe('SYNCH-P2-0003_ACCEPTANCE_2');
        expect(resolveRecoveryAllowlistEntry('hello+synch-p2-0003-test')).toBeNull();
        expect(resolveRecoveryAllowlistEntry('SYNCH-P2-0004_UNKNOWN')).toBeNull();
    });

    test('grants only the bounded cancellation-and-reconciliation intent', () => {
        expect(new Set(listRecoveryAllowlistEntries().map((entry) => entry.intent)))
            .toEqual(new Set([INTENT]));
    });

    test('contains no raw email, provider booking, event, or capability field', () => {
        const serialized = JSON.stringify(listRecoveryAllowlistEntries());
        expect(serialized).not.toMatch(/@|provider_booking_id|provider_event_id|session_token|capability/i);
    });

    test('returns immutable entries and a defensive list', () => {
        const first = listRecoveryAllowlistEntries();
        const second = listRecoveryAllowlistEntries();
        expect(first).not.toBe(second);
        expect(Object.isFrozen(first[0])).toBe(true);
    });

    test('preserves every byte of opaque identifiers', () => {
        const exact = 'Opaque-Id_Example';
        for (const variant of [
            exact.toUpperCase(),
            exact.toLowerCase(),
            ` ${exact}`,
            `${exact} `,
            'Opaque-Id_ Example',
            'Opaque-Id_Exampl\u0435',
            'opaque-id-e\u0301xample'
        ]) expect(opaqueIdentifierDigest(variant)).not.toBe(opaqueIdentifierDigest(exact));
        expect(opaqueIdentifierDigest(exact)).toMatch(/^[a-f0-9]{64}$/);
    });

    test('keeps established email canonicalization explicit', () => {
        expect(emailAddressDigest(' Synthetic.User@Example.COM '))
            .toBe(emailAddressDigest('synthetic.user@example.com'));
    });

    test('rejects the legacy generic canonicalizing digest for opaque substitutions', () => {
        const legacyDigest = (value) => crypto.createHash('sha256')
            .update(String(value || '').trim().toLowerCase()).digest('hex');
        const exact = 'Opaque-Authority-ID';
        const substituted = ' opaque-authority-id ';
        expect(legacyDigest(substituted)).toBe(legacyDigest(exact));
        expect(opaqueIdentifierDigest(substituted)).not.toBe(opaqueIdentifierDigest(exact));
        expect(require('../../services/booking/bookingRecoveryAllowlist')).not.toHaveProperty('digest');
    });

    test('keeps all seven redacted authority tuples distinct', () => {
        const entries = listRecoveryAllowlistEntries();
        const tuples = entries.map((entry) => [
            entry.operation_document_id_digest,
            entry.session_id_digest,
            entry.workspace_id_digest,
            entry.synthetic_identity_digest,
            entry.provider_configuration_digest
        ].join(':'));
        expect(new Set(tuples).size).toBe(7);
    });

    test('matches the deterministic seven-record byte-exact evidence artifact', () => {
        const fields = [
            'reference', 'work_package', 'idempotency_key_digest',
            'operation_document_id_digest', 'session_id_digest', 'workspace_id_digest',
            'synthetic_identity_digest', 'provider_configuration_digest'
        ];
        const project = (value) => Object.fromEntries(fields.map((field) => [field, value[field]]));
        expect(allowlistEvidence.record_count).toBe(7);
        expect(allowlistEvidence.records.map(project))
            .toEqual(listRecoveryAllowlistEntries().map(project));
        expect(allowlistEvidence.records.every((record) => record.matched_record_count === 1))
            .toBe(true);
        expect(allowlistEvidence.records.every(
            (record) => record.legacy_session_id_digest !== record.session_id_digest
        )).toBe(true);
        expect(JSON.stringify(allowlistEvidence)).not.toMatch(/@|provider_booking_id|provider_event_id|capability/i);
    });
});
