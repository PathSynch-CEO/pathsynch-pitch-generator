'use strict';

const {
    RETENTION_POLICY,
    recoveryRetentionFields,
    receiptRetentionFields
} = require('../../services/booking/bookingRecoveryPersistence');

describe('governed synthetic recovery retention policy', () => {
    const completedAt = new Date('2026-09-17T12:00:00.000Z');

    test('does not expire active or unresolved workflow state', () => {
        expect(recoveryRetentionFields('CLAIMED', completedAt)).toEqual({});
        expect(recoveryRetentionFields('RECONCILIATION_REQUIRED', completedAt)).toEqual({});
        expect(recoveryRetentionFields('MANUAL_REVIEW_REQUIRED', completedAt)).toEqual({});
        expect(receiptRetentionFields('MANUAL_REVIEW_REQUIRED', completedAt)).toEqual({});
    });

    test('computes deterministic terminal workflow and immutable receipt retention', () => {
        expect(RETENTION_POLICY).toMatchObject({
            recovery_state_days: 90,
            audit_receipt_months: 24,
            actor_metadata_months: 24
        });
        expect(recoveryRetentionFields('COMPLETE', completedAt).retention_eligible_at.toISOString())
            .toBe('2026-12-16T12:00:00.000Z');
        expect(receiptRetentionFields('ALREADY_CLEAN', completedAt).retention_eligible_at.toISOString())
            .toBe('2028-09-17T12:00:00.000Z');
        expect(receiptRetentionFields('STATE_AMBIGUOUS', completedAt)).toEqual({});
    });
});
