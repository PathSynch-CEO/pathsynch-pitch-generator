'use strict';

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const crypto = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const {
    COLLECTIONS,
    RECOVERY_STATES,
    createBookingRecoveryPersistence
} = require('../services/booking/bookingRecoveryPersistence');
const { createBookingPersistence } = require('../services/booking/bookingPersistence');
const { digest, operationDocumentId } = require('../services/booking/bookingRecoveryAllowlist');

const PROJECT_ID = 'booking-recovery-persistence-emulator-test';
const START = new Date('2026-09-16T20:00:00.000Z');
const RECOVERY_ID = 'recovery-operation-emulator-0001';
const BOOKING_KEY = 'booking-operation-emulator-0001';
const CANCELLATION_KEY = 'cancellation-operation-emulator-0001';
const CAPABILITY = 'A'.repeat(43);
const actor = {
    uid: 'operator_uid', uid_digest: '1'.repeat(64), email_digest: '2'.repeat(64), role: 'super_admin'
};

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
let testEnv;
let clock;
let entry;

function exactDigest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function fixtureEntry() {
    const idempotencyDigest = exactDigest(BOOKING_KEY);
    const operationId = `op_${idempotencyDigest}`;
    const sessionId = 'bks_recovery_emulator';
    const workspaceId = 'workspace_recovery_emulator';
    const email = 'synthetic-recovery@example.com';
    const configurationId = 'configuration_recovery_emulator';
    return {
        reference: 'SYNCH-P2-EMULATOR_RECORD',
        work_package: 'SYNCH-P2-TEST',
        idempotency_key_digest: idempotencyDigest,
        operation_document_id_digest: digest(operationId),
        session_id_digest: digest(sessionId),
        workspace_id_digest: digest(workspaceId),
        synthetic_identity_digest: digest(email),
        provider_configuration_digest: digest(configurationId),
        intent: 'CANCEL_AND_RECONCILE',
        communication_policy: 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION',
        fixture: { operationId, sessionId, workspaceId, email, configurationId }
    };
}

async function seed(overrides = {}) {
    const value = entry.fixture;
    const confirmed = {
        booking_id: 'booking_recovery_emulator',
        event_id: 'event_recovery_emulator',
        status: 'confirmed',
        title: 'SynchIntro Strategy Call',
        organizer_email: 'hello@pathsynch.com',
        attendee_emails: [value.email],
        start: '2026-09-21T13:00:00.000Z',
        end: '2026-09-21T13:30:00.000Z',
        timezone: 'America/New_York',
        duration_minutes: 30
    };
    await db.collection(COLLECTIONS.SESSIONS).doc(value.sessionId).set({
        session_id: value.sessionId,
        booking_operation_id: value.operationId,
        routing_state: { workspace_id: value.workspaceId }
    });
    await db.collection(COLLECTIONS.OPERATIONS).doc(value.operationId).set(Object.assign({
        operation_id: value.operationId,
        idempotency_key_digest: entry.idempotency_key_digest,
        session_id: value.sessionId,
        state: 'CONFIRMED',
        cancellation_state: 'CONFIRMED',
        session_token_digest: exactDigest(CAPABILITY),
        confirmation_delivery_state: 'SENT',
        provider_booking_id: confirmed.booking_id,
        provider_event_id: confirmed.event_id,
        provider_reference: { provider: 'nylas', configuration_id: value.configurationId },
        confirmed_result: confirmed,
        confirmation_identity: {
            first_name: 'Synthetic', last_name: 'Recovery', email: value.email
        },
        specialist: {
            id: 'spc_charles', display_name: 'Charles Berry', title: 'Founder & CEO',
            avatar_url: null, initials: 'CB', timezone: 'America/New_York'
        },
        cancellation_attempt_count: 0,
        cancellation_delivery_attempt_count: 0,
        expires_at: Timestamp.fromDate(new Date(clock.getTime() + (30 * 24 * 60 * 60 * 1000))),
        created_at: Timestamp.fromDate(clock),
        updated_at: Timestamp.fromDate(clock)
    }, overrides));
}

function persistence() {
    let token = 0;
    let id = 0;
    return createBookingRecoveryPersistence({
        db,
        now: () => new Date(clock.getTime()),
        tokenGenerator: () => `Token_${String(++token).padStart(40, 'X')}`,
        idGenerator: (prefix) => `${prefix}_emulator_${++id}`
    });
}

beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: 8080 }
    });
}, 30000);

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
}, 10000);

beforeEach(async () => {
    clock = new Date(START.getTime());
    entry = fixtureEntry();
    await seed();
});

afterEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
}, 10000);

describe('governed recovery Firestore fencing', () => {
    test('loads only an exact allowlist/session/workspace/provider binding', async () => {
        const store = persistence();
        await expect(store.loadBoundOperation(entry)).resolves.toMatchObject({
            operation: { operation_id: entry.fixture.operationId },
            binding: {
                workspace_id_digest: entry.workspace_id_digest,
                synthetic_identity_digest: entry.synthetic_identity_digest
            }
        });
        await expect(store.loadBoundOperation(Object.assign({}, entry, {
            workspace_id_digest: 'f'.repeat(64)
        }))).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    });

    test('creates one native-timestamp claim and rejects actor/key/record substitution', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        expect(claim.action).toBe('claim');
        const recovery = (await db.collection(COLLECTIONS.RECOVERIES)
            .doc(`rec_${exactDigest(RECOVERY_ID)}`).get()).data();
        expect(recovery.created_at).toBeInstanceOf(Timestamp);
        expect(recovery.claim_lease_expires_at).toBeInstanceOf(Timestamp);
        expect(recovery).not.toHaveProperty('claim_token');
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor: Object.assign({}, actor, { uid_digest: '3'.repeat(64) }),
            classification: 'CANCEL_REQUIRED'
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'recovery_idempotency_conflict' } });
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: 'different-recovery-operation-0002',
            actor,
            classification: 'CANCEL_REQUIRED'
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'record_recovery_identity_conflict' } });
    });

    test('grants one provider attempt, fences concurrent/stale workers, and detects customer-route races', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        await expect(store.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: claim.claim_token
        })).resolves.toEqual({ provider_cancellation_authorized: true });
        const fencedOperation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(fencedOperation).toMatchObject({
            cancellation_state: 'CONFIRMED',
            cancellation_attempt_count: 0,
            synthetic_recovery_state: RECOVERY_STATES.PROVIDER_ATTEMPTING
        });
        const customerStore = createBookingPersistence({
            db,
            now: () => new Date(clock.getTime()),
            claimTokenGenerator: () => 'CustomerClaimToken_123456789012345678901234'
        });
        await expect(customerStore.claimCancellationOperation({
            session_id: entry.fixture.sessionId,
            booking_idempotency_key: BOOKING_KEY,
            cancellation_idempotency_key: CANCELLATION_KEY,
            capability: CAPABILITY
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'governed_recovery_in_progress' }
        });
        await expect(store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        })).resolves.toMatchObject({ action: 'in_progress' });
        await expect(store.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: claim.claim_token
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'provider_attempt_fenced' } });
        clock = new Date(clock.getTime() + 10 * 60 * 1000);
        const staleAdoption = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        expect(staleAdoption).toMatchObject({
            action: 'reconcile',
            claim_token: expect.any(String)
        });
        const adoptedRecovery = (await db.collection(COLLECTIONS.RECOVERIES)
            .doc(`rec_${exactDigest(RECOVERY_ID)}`).get()).data();
        expect(adoptedRecovery).toMatchObject({
            state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
            claim_token_digest: exactDigest(staleAdoption.claim_token)
        });
        await expect(store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: true,
            provider_outcome: 'CANCELLED',
            provider_request_id: 'stale_request',
            reconciliation_evidence: 'stale_worker'
        })).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(store.markProviderAmbiguous({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            failure_code: 'stale_worker'
        })).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            receipt: { final_classification: 'STATE_AMBIGUOUS' }
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'recovery_receipt_writer_stale' }
        });
        await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: staleAdoption.recovery.claim_epoch,
            receipt: { final_classification: 'STATE_AMBIGUOUS' }
        });
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: `${RECOVERY_ID}-continuation`,
            actor,
            classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        })).resolves.toMatchObject({
            action: 'claim',
            recovery: {
                continuation_mode: 'READ_ONLY_RECONCILIATION',
                predecessor_recovery_operation_digest: exactDigest(RECOVERY_ID)
            }
        });

        await testEnv.clearFirestore();
        clock = new Date(START.getTime());
        await seed();
        const racing = persistence();
        const racingClaim = await racing.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        await db.collection(COLLECTIONS.OPERATIONS).doc(operationDocumentId(entry)).update({
            cancellation_state: 'PENDING'
        });
        await expect(racing.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: racingClaim.claim_token
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'provider_attempt_fenced' } });
    });

    test('records a definitive provider rejection as terminal manual review with no replacement authority', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        await store.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: claim.claim_token
        });
        await store.markProviderRejected({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            failure_code: 'nylas.recovery_provider_rejected'
        });
        const recovery = (await db.collection(COLLECTIONS.RECOVERIES)
            .doc(`rec_${exactDigest(RECOVERY_ID)}`).get()).data();
        const operation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(recovery).toMatchObject({
            state: RECOVERY_STATES.MANUAL_REVIEW_REQUIRED,
            provider_attempt_count: 1,
            provider_outcome: 'DEFINITIVE_REJECTION'
        });
        expect(operation).toMatchObject({
            cancellation_state: 'CONFIRMED',
            synthetic_recovery_state: RECOVERY_STATES.MANUAL_REVIEW_REQUIRED
        });
        const customerStore = createBookingPersistence({
            db,
            now: () => new Date(clock.getTime()),
            claimTokenGenerator: () => 'CustomerClaimToken_123456789012345678901234'
        });
        await expect(customerStore.claimCancellationOperation({
            session_id: entry.fixture.sessionId,
            booking_idempotency_key: BOOKING_KEY,
            cancellation_idempotency_key: CANCELLATION_KEY,
            capability: CAPABILITY
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'governed_recovery_in_progress' }
        });
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: `${RECOVERY_ID}-replacement`,
            actor,
            classification: 'CANCEL_REQUIRED'
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'record_recovery_identity_conflict' }
        });
    });

    test('promotes an expired communication send to reconciliation before settling trusted evidence', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        })).resolves.toMatchObject({ action: 'in_progress' });
        clock = new Date(clock.getTime() + 10 * 60 * 1000);
        const reconcile = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        expect(reconcile).toMatchObject({ action: 'reconcile' });
        const reconcilingRecovery = (await db.collection(COLLECTIONS.RECOVERIES)
            .doc(`rec_${exactDigest(RECOVERY_ID)}`).get()).data();
        expect(reconcilingRecovery.state).toBe(RECOVERY_STATES.RECONCILIATION_REQUIRED);
        const promoted = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(promoted.cancellation_delivery_state).toBe('RECONCILIATION_REQUIRED');
        await expect(store.settleDeliveryFromEvidence({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            evidence: {
                provider_message_id: 'message_reconciled',
                reconciliation_evidence_id: 'evidence_reconciled',
                outcome: 'DELIVERED',
                custom_args: {
                    synchintro_cancellation_id: promoted.cancellation_delivery_id,
                    synchintro_cancellation_delivery_attempt_id: promoted.cancellation_delivery_attempt_id
                }
            }
        })).resolves.toMatchObject({ action: 'settled', outcome: 'DELIVERED' });
    });

    test('fences a stale communication worker after same-operation adoption and receipt creation', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        clock = new Date(clock.getTime() + 10 * 60 * 1000);
        const adopted = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        });
        expect(adopted).toMatchObject({ action: 'reconcile', recovery: { claim_epoch: 1 } });
        await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: adopted.recovery.claim_epoch,
            receipt: { final_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED' }
        });
        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'recovery_delivery_writer_stale' }
        });
    });

    test('releases an exact pre-egress delivery claim without consuming the only send attempt', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await expect(store.releaseDeliveryBeforeEgress({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        })).resolves.toEqual({ action: 'released' });
        const releasedOperation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(releasedOperation).toMatchObject({
            cancellation_delivery_state: 'PENDING',
            cancellation_delivery_attempt_count: 0,
            cancellation_delivery_attempt_id: null,
            cancellation_delivery_token_digest: null,
            cancellation_delivery_lease_expires_at: null
        });
        const resumed = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        });
        expect(resumed).toMatchObject({ action: 'reconcile', recovery: { claim_epoch: 1 } });
        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            execution_epoch: resumed.recovery.claim_epoch
        })).resolves.toMatchObject({ action: 'prepare' });
    });

    test('safely reclaims an expired pre-egress delivery without consuming another send attempt', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const expired = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        clock = new Date(clock.getTime() + 10 * 60 * 1000);
        const reclaimed = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        expect(reclaimed).toMatchObject({ action: 'prepare' });
        expect(reclaimed.cancellation_delivery_attempt_id)
            .not.toBe(expired.cancellation_delivery_attempt_id);
        const operation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(operation.cancellation_delivery_attempt_count).toBe(1);
        await expect(store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: expired.delivery_token,
            delivery_attempt_id: expired.cancellation_delivery_attempt_id
        })).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: reclaimed.delivery_token,
            delivery_attempt_id: reclaimed.cancellation_delivery_attempt_id
        })).resolves.toEqual({ action: 'send' });
    });

    test('idempotently acknowledges the same fenced delivery start', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        const input = {
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        };

        await expect(store.beginDelivery(input)).resolves.toEqual({ action: 'send' });
        await expect(store.beginDelivery(input)).resolves.toEqual({ action: 'send' });
    });

    test('completes recovery when it adopts an already-sent cancellation delivery', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        await db.collection(COLLECTIONS.OPERATIONS).doc(operationDocumentId(entry)).update({
            cancellation_delivery_state: 'SENT',
            cancellation_delivery_attempt_count: 1,
            synthetic_recovery_state: 'COMMUNICATION_PENDING'
        });

        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        })).resolves.toEqual({ action: 'already_sent' });
        await expect(store.getExecutionReplay({
            entry, recovery_operation_id: RECOVERY_ID, actor
        })).resolves.toMatchObject({
            action: 'finalize_receipt',
            recovery: { state: RECOVERY_STATES.COMPLETE, communication_outcome: 'ALREADY_SENT' }
        });
        const operation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(operation.synthetic_recovery_state).toBe(RECOVERY_STATES.COMPLETE);
    });

    test('preserves the execution epoch while an email delivery lease is active', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await db.collection(COLLECTIONS.RECOVERIES).doc(`rec_${exactDigest(RECOVERY_ID)}`).update({
            claim_lease_expires_at: Timestamp.fromDate(new Date(clock.getTime() - 1000))
        });
        await expect(store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        })).resolves.toMatchObject({ action: 'in_progress', recovery: { claim_epoch: 0 } });
        await expect(store.markDeliverySent({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            provider_message_id: 'message_live_worker'
        })).resolves.toBeUndefined();
    });

    test('preserves a communication-only execution epoch while its email lease is active', async () => {
        await db.collection(COLLECTIONS.OPERATIONS).doc(operationDocumentId(entry)).update({
            cancellation_state: 'CANCELLED',
            cancellation_delivery_state: 'PENDING',
            cancellation_delivery_attempt_count: 0,
            cancellation_delivery_id: 'cnd_communication_only'
        });
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        });
        expect(claim).toMatchObject({ action: 'claim', recovery: { claim_epoch: 0 } });
        clock = new Date(clock.getTime() + 4 * 60 * 1000);
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        clock = new Date(clock.getTime() + 60 * 1000);
        await expect(store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        })).resolves.toMatchObject({ action: 'in_progress', recovery: { claim_epoch: 0 } });
        await expect(store.markDeliverySent({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            provider_message_id: 'message_communication_only_worker'
        })).resolves.toBeUndefined();
    });

    test('recovers a missing terminal receipt without live provider state', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        });
        await store.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: claim.claim_token
        });
        await store.markProviderAmbiguous({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            failure_code: 'nylas.recovery_outcome_unknown'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: true,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await store.markDeliverySent({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            provider_message_id: 'message_complete'
        });
        await expect(store.getExecutionReplay({
            entry, recovery_operation_id: RECOVERY_ID, actor
        })).resolves.toMatchObject({
            action: 'finalize_receipt',
            recovery: {
                state: RECOVERY_STATES.COMPLETE,
                provider_outcome: 'RECONCILED_CANCELLED'
            }
        });
    });

    test('does not let an ambiguous fallback receipt downgrade committed delivery success', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor,
            classification: 'CANCEL_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await store.markDeliverySent({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            provider_message_id: 'message_ack_lost'
        });

        const receipt = await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            receipt: {
                schema: 'synchintro-synthetic-recovery-receipt/v1',
                pre_state_classification: 'CANCEL_REQUIRED',
                planned_action: 'SCHEDULER_BOOKING_DELETE',
                provider_action_attempted: false,
                provider_action_count: 0,
                provider_outcome: 'RECONCILED_CANCELLED',
                durable_state_transition: 'CANCELLED',
                communication_action_attempted: true,
                communication_action_count: 1,
                communication_outcome: 'AMBIGUOUS',
                replay_result: 'FIRST_EXECUTION',
                final_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
            }
        });

        expect(receipt).toMatchObject({
            final_classification: 'ALREADY_CLEAN',
            communication_outcome: 'SENT',
            communication_action_attempted: true,
            communication_action_count: 1,
            planned_action: 'SCHEDULER_BOOKING_DELETE'
        });
        await expect(store.getExecutionReplay({
            entry, recovery_operation_id: RECOVERY_ID, actor
        })).resolves.toMatchObject({
            action: 'replay',
            recovery: { state: RECOVERY_STATES.COMPLETE },
            receipt: { final_classification: 'ALREADY_CLEAN', communication_outcome: 'SENT' }
        });
    });

    test('reconciles terminal state, fences communication, and writes one immutable redacted receipt', async () => {
        const store = persistence();
        const claim = await store.claimExecution({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            classification: 'PROVIDER_RECONCILIATION_REQUIRED'
        });
        await store.markTerminalCancelled({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            claim_token: claim.claim_token,
            provider_attempted: false,
            provider_outcome: 'RECONCILED_CANCELLED',
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const operation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(operation.cancellation_state).toBe('CANCELLED');
        expect(operation.cancellation_attempt_count).toBe(0);
        expect(operation.cancellation_delivery_state).toBe('PENDING');

        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await store.markDeliveryOutcomeUnknown({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            delivery_token: delivery.delivery_token
        });
        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor, execution_epoch: 0
        })).resolves.toMatchObject({ action: 'reconcile' });

        await expect(store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            receipt: {
                schema: 'synchintro-synthetic-recovery-receipt/v1',
                final_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED',
                customer_email: 'must-not-persist@example.invalid'
            }
        })).rejects.toMatchObject({
            code: 'INVALID_INPUT', details: { reason: 'unsafe_receipt_field' }
        });

        const first = await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            receipt: {
                schema: 'synchintro-synthetic-recovery-receipt/v1',
                final_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
            }
        });
        const replay = await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
            execution_epoch: 0,
            receipt: { final_classification: 'TAMPERED', capability: 'must-not-persist' }
        });
        expect(replay.final_classification).toBe(first.final_classification);
        expect(replay).not.toHaveProperty('capability');
        expect(JSON.stringify(replay)).not.toMatch(/session_token|api[_-]?key|provider_booking_id/i);
        expect(await store.readReceipt(RECOVERY_ID, actor)).toEqual(replay);

        const continuationId = `${RECOVERY_ID}-reconcile`;
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: continuationId,
            actor,
            classification: 'CANCEL_REQUIRED'
        })).rejects.toMatchObject({
            code: 'CONFLICT'
        });
        const continuation = await store.claimExecution({
            entry,
            recovery_operation_id: continuationId,
            actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        });
        expect(continuation).toMatchObject({
            action: 'claim',
            recovery: {
                continuation_mode: 'READ_ONLY_RECONCILIATION',
                predecessor_recovery_operation_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
                provider_attempt_count: 0
            }
        });
        await expect(store.beginProviderAttempt({
            entry,
            recovery_operation_id: continuationId,
            actor,
            claim_token: continuation.claim_token
        })).rejects.toMatchObject({
            code: 'CONFLICT',
            details: { reason: 'provider_attempt_fenced' }
        });
    });
});
