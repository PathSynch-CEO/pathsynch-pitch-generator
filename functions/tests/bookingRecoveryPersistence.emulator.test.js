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
const { digest, operationDocumentId } = require('../services/booking/bookingRecoveryAllowlist');

const PROJECT_ID = 'booking-recovery-persistence-emulator-test';
const START = new Date('2026-09-16T20:00:00.000Z');
const RECOVERY_ID = 'recovery-operation-emulator-0001';
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
    const idempotencyDigest = 'a'.repeat(64);
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
        await expect(store.beginProviderAttempt({
            entry, recovery_operation_id: RECOVERY_ID, actor, claim_token: claim.claim_token
        })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'provider_attempt_fenced' } });
        clock = new Date(clock.getTime() + 10 * 60 * 1000);
        await expect(store.claimExecution({
            entry, recovery_operation_id: RECOVERY_ID, actor, classification: 'CANCEL_REQUIRED'
        })).resolves.toMatchObject({ action: 'reconcile' });

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
            provider_request_id: null,
            reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
        });
        const operation = (await db.collection(COLLECTIONS.OPERATIONS)
            .doc(operationDocumentId(entry)).get()).data();
        expect(operation.cancellation_state).toBe('CANCELLED');
        expect(operation.cancellation_attempt_count).toBe(0);
        expect(operation.cancellation_delivery_state).toBe('PENDING');

        const delivery = await store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor
        });
        await store.beginDelivery({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await store.markDeliveryOutcomeUnknown({
            entry,
            recovery_operation_id: RECOVERY_ID,
            actor,
            delivery_token: delivery.delivery_token
        });
        await expect(store.claimDelivery({
            entry, recovery_operation_id: RECOVERY_ID, actor
        })).resolves.toMatchObject({ action: 'reconcile' });

        await expect(store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
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
            receipt: {
                schema: 'synchintro-synthetic-recovery-receipt/v1',
                final_classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
            }
        });
        const replay = await store.createReceipt({
            recovery_operation_id: RECOVERY_ID,
            actor,
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
        await expect(store.claimExecution({
            entry,
            recovery_operation_id: continuationId,
            actor,
            classification: 'COMMUNICATION_RECONCILIATION_REQUIRED'
        })).resolves.toMatchObject({
            action: 'claim',
            recovery: {
                continuation_mode: 'READ_ONLY_RECONCILIATION',
                predecessor_recovery_operation_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
                provider_attempt_count: 0
            }
        });
    });
});
