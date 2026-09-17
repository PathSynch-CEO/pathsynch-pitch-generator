'use strict';

const {
    INTENT,
    digest,
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
        const entry = listRecoveryAllowlistEntries()[0];
        expect(operationDocumentId(entry)).toBe(`op_${entry.idempotency_key_digest}`);
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

    test('normalizes digests consistently', () => {
        expect(digest(' Example ')).toBe(digest('example'));
        expect(digest('example')).toMatch(/^[a-f0-9]{64}$/);
    });
});
