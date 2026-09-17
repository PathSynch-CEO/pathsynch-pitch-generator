'use strict';

const { createBookingRecoveryService, CLASSIFICATIONS } = require('../../services/booking/bookingRecovery');
const { digest } = require('../../services/booking/bookingRecoveryAllowlist');
const { NylasHttpError, ERROR_CATEGORIES } = require('../../services/booking/nylasHttpClient');

const entry = Object.freeze({
    reference: 'SYNCH-P2-TEST_RECORD',
    work_package: 'SYNCH-P2-TEST',
    idempotency_key_digest: 'a'.repeat(64),
    operation_document_id_digest: 'b'.repeat(64),
    session_id_digest: 'c'.repeat(64),
    workspace_id_digest: 'd'.repeat(64),
    synthetic_identity_digest: 'e'.repeat(64),
    provider_configuration_digest: digest('configuration_1'),
    intent: 'CANCEL_AND_RECONCILE',
    communication_policy: 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION'
});
const actor = Object.freeze({
    uid: 'operator_uid', uid_digest: '1'.repeat(64), email_digest: '2'.repeat(64), role: 'super_admin'
});
const recoveryId = 'recovery-operation-0001';
const booking = Object.freeze({
    booking_id: 'booking_1',
    event_id: 'event_1',
    status: 'confirmed',
    title: 'SynchIntro Strategy Call',
    organizer_email: 'hello@pathsynch.com',
    attendee_emails: ['synthetic@example.com'],
    start: '2026-09-21T13:00:00.000Z',
    end: '2026-09-21T13:30:00.000Z',
    timezone: 'America/New_York',
    duration_minutes: 30
});

function operation(overrides = {}) {
    return Object.assign({
        operation_id: `op_${entry.idempotency_key_digest}`,
        idempotency_key_digest: entry.idempotency_key_digest,
        state: 'CONFIRMED',
        cancellation_state: 'CONFIRMED',
        provider_booking_id: booking.booking_id,
        provider_event_id: booking.event_id,
        provider_reference: { provider: 'nylas', configuration_id: 'configuration_1' },
        confirmed_result: booking,
        confirmation_identity: {
            first_name: 'Synthetic', last_name: 'Guest', email: 'synthetic@example.com'
        },
        specialist: {
            id: 'spc_charles', display_name: 'Charles Berry', title: 'Founder & CEO',
            avatar_url: null, initials: 'CB', timezone: 'America/New_York'
        },
        attempt_count: 1,
        confirmation_delivery_state: 'SENT',
        confirmation_delivery_attempt_count: 1,
        cancellation_attempt_count: 0,
        cancellation_delivery_attempt_count: 0
    }, overrides);
}

function provider() {
    return {
        name: 'nylas',
        configuration: {
            calendarId: 'primary', configurationId: 'configuration_1',
            organizerEmail: booking.organizer_email, timezone: booking.timezone,
            durationMinutes: 30, title: booking.title
        },
        getBooking: jest.fn().mockResolvedValue({
            booking_id: booking.booking_id, event_id: booking.event_id, status: 'confirmed'
        }),
        getEvent: jest.fn().mockResolvedValue({
            event_id: booking.event_id,
            title: booking.title,
            status: 'confirmed',
            organizer_email: booking.organizer_email,
            participant_emails: booking.attendee_emails,
            calendar_id: 'primary',
            start: booking.start,
            end: booking.end,
            start_timezone: booking.timezone,
            end_timezone: booking.timezone
        }),
        assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true }),
        cancelBooking: jest.fn().mockResolvedValue({ booking_id: booking.booking_id, request_id: 'request_1' })
    };
}

function store(overrides = {}) {
    const op = operation();
    return Object.assign({
        loadBoundOperation: jest.fn().mockResolvedValue({
            operation: op,
            session: { routing_state: { workspace_id: 'workspace_1' } },
            binding: {
                operation_document_id_digest: entry.operation_document_id_digest,
                session_id_digest: entry.session_id_digest,
                workspace_id_digest: entry.workspace_id_digest,
                synthetic_identity_digest: entry.synthetic_identity_digest,
                provider_configuration_digest: entry.provider_configuration_digest
            }
        }),
        getExecutionReplay: jest.fn().mockResolvedValue({ action: 'missing' }),
        claimExecution: jest.fn().mockResolvedValue({
            action: 'claim', claim_token: 'claim_token',
            recovery: { pre_state_classification: CLASSIFICATIONS.CANCEL_REQUIRED }
        }),
        beginProviderAttempt: jest.fn().mockResolvedValue({ provider_cancellation_authorized: true }),
        markProviderAmbiguous: jest.fn().mockResolvedValue(undefined),
        markProviderRejected: jest.fn().mockResolvedValue(undefined),
        markTerminalCancelled: jest.fn().mockResolvedValue(operation({
            cancellation_state: 'CANCELLED', cancellation_delivery_state: 'PENDING'
        })),
        markAlreadyClean: jest.fn().mockResolvedValue(undefined),
        claimDelivery: jest.fn().mockResolvedValue({
            action: 'prepare', delivery_token: 'delivery_token',
            cancellation_delivery_id: 'cnd_1', cancellation_delivery_attempt_id: 'cda_1'
        }),
        beginDelivery: jest.fn().mockResolvedValue({ action: 'send' }),
        markDeliverySent: jest.fn().mockResolvedValue(undefined),
        markDeliveryOutcomeUnknown: jest.fn().mockResolvedValue(undefined),
        settleDeliveryFromEvidence: jest.fn().mockResolvedValue({ action: 'settled' }),
        createReceipt: jest.fn().mockImplementation(async ({ receipt }) => receipt),
        readReceipt: jest.fn().mockResolvedValue({ final_classification: CLASSIFICATIONS.ALREADY_CLEAN })
    }, overrides);
}

function cancelledProvider(p) {
    p.getBooking.mockResolvedValue({
        booking_id: booking.booking_id, event_id: booking.event_id, status: 'cancelled'
    });
    p.getEvent.mockResolvedValue(Object.assign({}, p.getEvent(), {
        event_id: booking.event_id,
        title: booking.title,
        status: 'cancelled',
        organizer_email: booking.organizer_email,
        participant_emails: booking.attendee_emails,
        calendar_id: 'primary',
        start: booking.start,
        end: booking.end,
        start_timezone: booking.timezone,
        end_timezone: booking.timezone
    }));
    return p;
}

function service(options = {}) {
    const persistence = options.persistence || store();
    const schedulingProvider = options.provider || provider();
    const mailer = options.mailer || {
        sendCancellation: jest.fn().mockResolvedValue({ provider_message_id: 'message_1' })
    };
    return {
        persistence,
        provider: schedulingProvider,
        mailer,
        recovery: createBookingRecoveryService({
            persistence,
            provider: schedulingProvider,
            mailer,
            evidenceStore: options.evidenceStore,
            resolveEntry: (reference) => reference === entry.reference ? entry : null,
            listEntries: () => [entry],
            now: () => new Date('2026-09-16T20:00:00.000Z')
        })
    };
}

describe('governed synthetic booking recovery orchestration', () => {
    test('inventories only explicit entries and performs no mutation', async () => {
        const fixture = service();
        const result = await fixture.recovery.inventory();
        expect(result.count).toBe(1);
        expect(result.records[0].classification).toBe(CLASSIFICATIONS.CANCEL_REQUIRED);
        expect(fixture.persistence.claimExecution).not.toHaveBeenCalled();
        expect(fixture.provider.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('classifies an active provider booking as cancellation required', async () => {
        await expect(service().recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.CANCEL_REQUIRED,
            planned_action: 'SCHEDULER_BOOKING_DELETE'
        });
    });

    test('classifies provider-cancelled/local-confirmed drift as reconciliation only', async () => {
        const p = cancelledProvider(provider());
        await expect(service({ provider: p }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED,
            planned_action: 'LOCAL_RECONCILIATION_ONLY'
        });
    });

    test('classifies terminal provider/local/communication state as already clean', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.loadBoundOperation.mockResolvedValue(Object.assign(
            {}, await persistence.loadBoundOperation(),
            { operation: operation({ cancellation_state: 'CANCELLED', cancellation_delivery_state: 'SENT' }) }
        ));
        await expect(service({ provider: p, persistence }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.ALREADY_CLEAN
        });
    });

    test('classifies unsettled terminal communication independently', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.loadBoundOperation.mockResolvedValue(Object.assign(
            {}, await persistence.loadBoundOperation(),
            { operation: operation({ cancellation_state: 'CANCELLED', cancellation_delivery_state: 'RECONCILIATION_REQUIRED' }) }
        ));
        await expect(service({ provider: p, persistence }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
        });
    });

    test('dry-run discloses a first controlled cancellation email when terminal delivery is pending', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.loadBoundOperation.mockResolvedValue(Object.assign(
            {}, await persistence.loadBoundOperation(),
            { operation: operation({
                cancellation_state: 'CANCELLED',
                cancellation_delivery_state: 'PENDING',
                cancellation_delivery_attempt_count: 0
            }) }
        ));
        await expect(service({ provider: p, persistence }).recovery.dryRun(entry.reference, actor))
            .resolves.toMatchObject({
                plan: { planned_action: 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION' },
                receipt: { planned_action: 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION' }
            });
    });

    test('rejects any non-allowlisted reference before persistence or provider I/O', async () => {
        const fixture = service();
        await expect(fixture.recovery.inspect('SYNCH-P2-OTHER')).rejects.toMatchObject({
            code: 'AUTHORIZATION_ERROR', details: { reason: 'not_allowlisted' }
        });
        expect(fixture.persistence.loadBoundOperation).not.toHaveBeenCalled();
        expect(fixture.provider.getBooking).not.toHaveBeenCalled();
    });

    test('fails closed on runtime provider configuration drift', async () => {
        const p = provider();
        p.configuration.configurationId = 'configuration_other';
        await expect(service({ provider: p }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
            reason: 'provider_configuration_mismatch'
        });
        expect(p.getBooking).not.toHaveBeenCalled();
    });

    test('fails closed on exact provider identity mismatch', async () => {
        const p = provider();
        p.getBooking.mockResolvedValue({ booking_id: 'different', event_id: booking.event_id, status: 'confirmed' });
        await expect(service({ provider: p }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
        });
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('classifies unavailable provider read as ambiguous', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new Error('offline'));
        await expect(service({ provider: p }).recovery.inspect(entry.reference)).resolves.toMatchObject({
            classification: CLASSIFICATIONS.STATE_AMBIGUOUS
        });
    });

    test('dry-run is deterministic and performs no database/provider/email mutation', async () => {
        const fixture = service();
        const first = await fixture.recovery.dryRun(entry.reference, actor);
        const second = await fixture.recovery.dryRun(entry.reference, actor);
        expect(first.receipt.receipt_digest).toBe(second.receipt.receipt_digest);
        expect(first.receipt.persisted).toBe(false);
        expect(fixture.persistence.claimExecution).not.toHaveBeenCalled();
        expect(fixture.provider.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('dry-run receipt contains redacted actor and operation bindings only', async () => {
        const result = await service().recovery.dryRun(entry.reference, actor);
        const serialized = JSON.stringify(result);
        expect(serialized).toContain(actor.uid_digest);
        expect(serialized).not.toContain(actor.uid);
        expect(serialized).not.toContain(booking.booking_id);
        expect(serialized).not.toContain('synthetic@example.com');
    });

    test('executes exactly one Scheduler cancellation and one SendGrid cancellation', async () => {
        const fixture = service();
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.ALREADY_CLEAN);
        expect(fixture.provider.assertCustomerEmailsDisabled).toHaveBeenCalledTimes(1);
        expect(fixture.provider.cancelBooking).toHaveBeenCalledTimes(1);
        expect(fixture.provider.cancelBooking).toHaveBeenCalledWith({ bookingId: booking.booking_id });
        expect(fixture.persistence.beginProviderAttempt).toHaveBeenCalledTimes(1);
        expect(fixture.mailer.sendCancellation).toHaveBeenCalledTimes(1);
        expect(fixture.persistence.createReceipt).toHaveBeenCalledWith(expect.objectContaining({
            execution_epoch: 0
        }));
    });

    test('returns an established receipt on same-operation replay without side effects', async () => {
        const persistence = store();
        persistence.claimExecution.mockResolvedValue({ action: 'replay', recovery: { state: 'COMPLETE' } });
        const fixture = service({ persistence });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.replay).toBe(true);
        expect(fixture.provider.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('returns an exact stored receipt before provider readback on completed replay', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new Error('provider offline'));
        p.getEvent.mockRejectedValue(new Error('provider offline'));
        const persistence = store();
        persistence.getExecutionReplay.mockResolvedValue({
            action: 'replay',
            receipt: { final_classification: CLASSIFICATIONS.ALREADY_CLEAN }
        });
        const fixture = service({ provider: p, persistence });
        await expect(fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        })).resolves.toEqual({
            replay: true,
            classification: CLASSIFICATIONS.ALREADY_CLEAN,
            receipt: { final_classification: CLASSIFICATIONS.ALREADY_CLEAN }
        });
        expect(p.getBooking).not.toHaveBeenCalled();
        expect(p.getEvent).not.toHaveBeenCalled();
        expect(persistence.claimExecution).not.toHaveBeenCalled();
    });

    test('reconstructs a missing terminal receipt without provider readback or side effects', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new Error('provider offline'));
        p.getEvent.mockRejectedValue(new Error('provider offline'));
        const persistence = store();
        persistence.getExecutionReplay.mockResolvedValue({
            action: 'finalize_receipt',
            recovery: {
                pre_state_classification: CLASSIFICATIONS.CANCEL_REQUIRED,
                state: 'COMPLETE',
                provider_attempt_count: 1,
                provider_outcome: 'CANCELLED',
                communication_attempt_count: 1,
                communication_outcome: 'SENT'
            }
        });
        const fixture = service({ provider: p, persistence });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result).toMatchObject({ replay: true, classification: CLASSIFICATIONS.ALREADY_CLEAN });
        expect(result.receipt).toMatchObject({
            provider_action_attempted: true,
            communication_action_attempted: true,
            replay_result: 'IDEMPOTENT_REPLAY'
        });
        expect(p.getBooking).not.toHaveBeenCalled();
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('repairs provider-cancelled/local-confirmed drift without DELETE', async () => {
        const p = cancelledProvider(provider());
        const fixture = service({ provider: p });
        await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.persistence.beginProviderAttempt).not.toHaveBeenCalled();
        expect(fixture.persistence.markTerminalCancelled).toHaveBeenCalledWith(expect.objectContaining({
            provider_attempted: false,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        }));
    });

    test('verifies an already-clean record without provider or communication mutation', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.loadBoundOperation.mockResolvedValue(Object.assign(
            {}, await persistence.loadBoundOperation(),
            { operation: operation({ cancellation_state: 'CANCELLED', cancellation_delivery_state: 'SENT' }) }
        ));
        const fixture = service({ provider: p, persistence });
        await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
        expect(persistence.markAlreadyClean).toHaveBeenCalledTimes(1);
    });

    test('rejects a concurrent active recovery claimant', async () => {
        const persistence = store();
        persistence.claimExecution.mockResolvedValue({ action: 'in_progress', recovery: { state: 'CLAIMED' } });
        await expect(service({ persistence }).recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'recovery_in_progress' } });
    });

    test('never retries provider DELETE while ambiguous recovery still reads active', async () => {
        const persistence = store();
        persistence.claimExecution.mockResolvedValue({
            action: 'reconcile', recovery: { pre_state_classification: CLASSIFICATIONS.CANCEL_REQUIRED }
        });
        const fixture = service({ persistence });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.STATE_AMBIGUOUS);
        expect(result.receipt).toMatchObject({ final_classification: CLASSIFICATIONS.STATE_AMBIGUOUS });
        expect(fixture.provider.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
        expect(persistence.createReceipt).toHaveBeenCalledTimes(1);
    });

    test('settles ambiguous provider outcome by readback without a second DELETE', async () => {
        const p = provider();
        let reads = 0;
        p.getBooking.mockImplementation(async () => {
            reads += 1;
            if (reads < 3) return { booking_id: booking.booking_id, event_id: booking.event_id, status: 'confirmed' };
            return { booking_id: booking.booking_id, event_id: booking.event_id, status: 'cancelled' };
        });
        p.getEvent.mockImplementation(async () => ({
            event_id: booking.event_id, title: booking.title,
            status: reads < 3 ? 'confirmed' : 'cancelled',
            organizer_email: booking.organizer_email, participant_emails: booking.attendee_emails,
            calendar_id: 'primary', start: booking.start, end: booking.end,
            start_timezone: booking.timezone, end_timezone: booking.timezone
        }));
        p.cancelBooking.mockRejectedValue(new Error('timeout'));
        const fixture = service({ provider: p });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.ALREADY_CLEAN);
        expect(p.cancelBooking).toHaveBeenCalledTimes(1);
        expect(fixture.persistence.markProviderAmbiguous).toHaveBeenCalledWith(expect.objectContaining({
            claim_token: 'claim_token'
        }));
        expect(fixture.persistence.markTerminalCancelled).toHaveBeenCalledWith(expect.objectContaining({
            claim_token: 'claim_token',
            provider_attempted: true,
            reconciliation_evidence: 'nylas.recovery_immediate_readback_cancelled'
        }));
    });

    test('preserves ambiguity and sends no email when readback remains active', async () => {
        const p = provider();
        p.cancelBooking.mockRejectedValue(new Error('timeout'));
        const fixture = service({ provider: p });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.STATE_AMBIGUOUS);
        expect(result.receipt).toMatchObject({ final_classification: CLASSIFICATIONS.STATE_AMBIGUOUS });
        expect(p.cancelBooking).toHaveBeenCalledTimes(1);
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
        expect(fixture.persistence.createReceipt).toHaveBeenCalledTimes(1);
    });

    test('classifies definitive provider rejection without retrying or sending email', async () => {
        const p = provider();
        p.cancelBooking.mockRejectedValue(new NylasHttpError(
            ERROR_CATEGORIES.REJECTED,
            'cancel_booking',
            { status: 409 }
        ));
        const fixture = service({ provider: p });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result).toMatchObject({
            replay: false,
            classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
            receipt: {
                provider_outcome: 'DEFINITIVE_REJECTION',
                final_classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
            }
        });
        expect(p.cancelBooking).toHaveBeenCalledTimes(1);
        expect(fixture.persistence.markProviderRejected).toHaveBeenCalledWith(expect.objectContaining({
            claim_token: 'claim_token',
            failure_code: 'nylas.recovery_provider_rejected'
        }));
        expect(fixture.persistence.markProviderAmbiguous).not.toHaveBeenCalled();
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('same-operation provider reconciliation completes later without a second DELETE', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.claimExecution.mockResolvedValue({
            action: 'reconcile',
            claim_token: 'reconcile_token',
            recovery: {
                pre_state_classification: CLASSIFICATIONS.CANCEL_REQUIRED,
                provider_attempt_count: 1,
                claim_epoch: 2
            }
        });
        const fixture = service({ persistence, provider: p });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.ALREADY_CLEAN);
        expect(result.replay).toBe(true);
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(persistence.markTerminalCancelled).toHaveBeenCalledWith(expect.objectContaining({
            claim_token: 'reconcile_token',
            provider_attempted: true,
            reconciliation_evidence: 'nylas.recovery_after_ambiguous_attempt'
        }));
        expect(persistence.createReceipt).toHaveBeenCalledWith(expect.objectContaining({
            execution_epoch: 2
        }));
    });

    test('does not resend when communication is already fenced for reconciliation', async () => {
        const persistence = store();
        persistence.claimDelivery.mockResolvedValue({
            action: 'reconcile', cancellation_delivery_id: 'cnd_1',
            cancellation_delivery_attempt_id: 'cda_1'
        });
        const fixture = service({ persistence });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED);
        expect(result.receipt).toMatchObject({
            final_classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
        });
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
        expect(persistence.createReceipt).toHaveBeenCalledTimes(1);
    });

    test('uses signed SendGrid evidence to settle communication without resend', async () => {
        const persistence = store();
        persistence.claimDelivery.mockResolvedValue({
            action: 'reconcile', cancellation_delivery_id: 'cnd_1',
            cancellation_delivery_attempt_id: 'cda_1'
        });
        const evidenceStore = { verify: jest.fn().mockResolvedValue({
            provider_message_id: 'message_1', reconciliation_evidence_id: 'evidence_1', outcome: 'DELIVERED',
            custom_args: {
                synchintro_cancellation_id: 'cnd_1',
                synchintro_cancellation_delivery_attempt_id: 'cda_1'
            }
        }) };
        const fixture = service({ persistence, evidenceStore });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.ALREADY_CLEAN);
        expect(persistence.settleDeliveryFromEvidence).toHaveBeenCalledTimes(1);
        expect(fixture.mailer.sendCancellation).not.toHaveBeenCalled();
    });

    test('marks an ambiguous SendGrid send and never reports a clean communication result', async () => {
        const mailer = { sendCancellation: jest.fn().mockRejectedValue(new Error('timeout')) };
        const fixture = service({ mailer });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result.classification).toBe(CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED);
        expect(result.receipt).toMatchObject({
            final_classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED,
            communication_action_attempted: true,
            communication_action_count: 1
        });
        expect(fixture.persistence.markDeliveryOutcomeUnknown).toHaveBeenCalledTimes(1);
        expect(mailer.sendCancellation).toHaveBeenCalledTimes(1);
        expect(fixture.persistence.createReceipt).toHaveBeenCalledTimes(1);
    });

    test('refuses provider mutation while original confirmation delivery is still active', async () => {
        const persistence = store();
        persistence.loadBoundOperation.mockResolvedValue({
            operation: operation({ confirmation_delivery_state: 'SENDING' }),
            session: { routing_state: { workspace_id: 'workspace_1' } },
            binding: {
                operation_document_id_digest: entry.operation_document_id_digest,
                session_id_digest: entry.session_id_digest,
                workspace_id_digest: entry.workspace_id_digest,
                synthetic_identity_digest: entry.synthetic_identity_digest,
                provider_configuration_digest: entry.provider_configuration_digest
            }
        });
        const fixture = service({ persistence });
        await expect(fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        })).rejects.toMatchObject({
            code: 'BOOKING_RECONCILIATION_REQUIRED',
            details: { reason: 'original_confirmation_not_settled' }
        });
        expect(persistence.claimExecution).not.toHaveBeenCalled();
        expect(fixture.provider.cancelBooking).not.toHaveBeenCalled();
    });

    test('communication-only replay settles evidence without reapplying provider state', async () => {
        const p = cancelledProvider(provider());
        const persistence = store();
        persistence.claimExecution.mockResolvedValue({
            action: 'reconcile',
            recovery: {
                pre_state_classification: CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED,
                provider_attempt_count: 0,
                communication_attempt_count: 1
            }
        });
        persistence.loadBoundOperation.mockResolvedValue({
            operation: operation({
                cancellation_state: 'CANCELLED',
                cancellation_delivery_state: 'RECONCILIATION_REQUIRED',
                cancellation_delivery_attempt_count: 1,
                cancellation_delivery_id: 'cnd_1',
                cancellation_delivery_attempt_id: 'cda_1'
            }),
            session: { routing_state: { workspace_id: 'workspace_1' } },
            binding: {
                operation_document_id_digest: entry.operation_document_id_digest,
                session_id_digest: entry.session_id_digest,
                workspace_id_digest: entry.workspace_id_digest,
                synthetic_identity_digest: entry.synthetic_identity_digest,
                provider_configuration_digest: entry.provider_configuration_digest
            }
        });
        persistence.claimDelivery.mockResolvedValue({
            action: 'reconcile', cancellation_delivery_id: 'cnd_1',
            cancellation_delivery_attempt_id: 'cda_1'
        });
        const evidenceStore = { verify: jest.fn().mockResolvedValue({
            provider_message_id: 'message_1', reconciliation_evidence_id: 'evidence_1', outcome: 'DELIVERED',
            custom_args: {
                synchintro_cancellation_id: 'cnd_1',
                synchintro_cancellation_delivery_attempt_id: 'cda_1'
            }
        }) };
        const fixture = service({ persistence, provider: p, evidenceStore });
        const result = await fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        });
        expect(result).toMatchObject({ replay: true, classification: CLASSIFICATIONS.ALREADY_CLEAN });
        expect(result.receipt).toMatchObject({
            communication_action_attempted: true,
            communication_action_count: 1
        });
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(persistence.markTerminalCancelled).not.toHaveBeenCalled();
        expect(persistence.settleDeliveryFromEvidence).toHaveBeenCalledTimes(1);
        expect(persistence.createReceipt).toHaveBeenCalledTimes(1);
    });

    test('does not grant provider mutation if Scheduler emails cannot be proven disabled', async () => {
        const p = provider();
        p.assertCustomerEmailsDisabled.mockRejectedValue(new Error('configuration unavailable'));
        const fixture = service({ provider: p });
        await expect(fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        })).rejects.toThrow('configuration unavailable');
        expect(p.cancelBooking).not.toHaveBeenCalled();
        expect(fixture.persistence.beginProviderAttempt).not.toHaveBeenCalled();
    });

    test('rejects a non-executable manual-review classification before claim', async () => {
        const p = provider();
        p.getEvent.mockResolvedValue(Object.assign({}, await p.getEvent(), {
            participant_emails: ['other@example.com']
        }));
        const fixture = service({ provider: p });
        await expect(fixture.recovery.execute({
            reference: entry.reference, recovery_operation_id: recoveryId, actor
        })).rejects.toMatchObject({ code: 'BOOKING_RECONCILIATION_REQUIRED' });
        expect(fixture.persistence.claimExecution).not.toHaveBeenCalled();
        expect(p.cancelBooking).not.toHaveBeenCalled();
    });

    test('treats fulfilled cancelled provider responses as exact reconciliation evidence', async () => {
        const p = cancelledProvider(provider());
        const result = await service({ provider: p }).recovery.inspect(entry.reference);
        expect(result.provider).toEqual({
            configuration_bound: true, booking_state: 'CANCELLED', event_state: 'CANCELLED'
        });
    });

    test('also supports Scheduler 404 plus exact cancelled event reconciliation', async () => {
        const p = provider();
        p.getBooking.mockRejectedValue(new NylasHttpError(
            ERROR_CATEGORIES.REJECTED, 'get_booking', { status: 404 }
        ));
        p.getEvent.mockResolvedValue(Object.assign({}, await p.getEvent(), { status: 'cancelled' }));
        const result = await service({ provider: p }).recovery.inspect(entry.reference);
        expect(result.classification).toBe(CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED);
    });
});
