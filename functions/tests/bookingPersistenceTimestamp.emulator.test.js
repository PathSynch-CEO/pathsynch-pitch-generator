'use strict';

/**
 * SynchIntro booking persistence — Firestore Timestamp emulator regression.
 *
 * The Functions emulator does not guarantee the legacy
 * admin.firestore.Timestamp namespace static. Keep it unavailable here so the
 * session lifecycle exercises the supported modular Timestamp export against
 * real Firestore.
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { createHash, generateKeyPairSync, sign } = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');

const PROJECT_ID = 'booking-persistence-timestamp-emulator-test';
const SESSION_TOKEN = 'T'.repeat(43);
const START = new Date('2026-09-07T14:00:00.000Z');

const admin = require('firebase-admin');
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const firestoreNamespace = admin.firestore;
const adminDb = firestoreNamespace();
const namespaceTimestamp = firestoreNamespace.Timestamp;

const {
    COLLECTIONS,
    RETENTION_MS,
    CANCELLATION_STATES,
    CONFIRMATION_DELIVERY_LEASE_MS,
    CONFIRMATION_DELIVERY_STATES,
    createBookingPersistence
} = require('../services/booking/bookingPersistence');
const {
    COLLECTION: CANCELLATION_EVIDENCE_COLLECTION,
    createCancellationDeliveryEvidenceStore
} = require('../services/booking/bookingCancellationDeliveryEvidence');

const createInput = {
    flow_id: 'synchintro_progressive',
    identity: {
        email: 'buyer@example.com',
        provider: 'email',
        first_name: 'Buyer',
        last_name: 'Example'
    },
    timezone: 'America/New_York',
    attribution: { utm_source: 'emulator-regression' }
};

const company = {
    name: 'Example Co',
    domain: 'example.com',
    website: 'https://example.com',
    description: null,
    description_source: 'identity_domain',
    confidence: 'medium',
    source: 'identity_domain',
    match_status: 'confirmed',
    verified_at: '2026-09-07T14:00:00.000Z'
};

const qualification = {
    goal: 'Generate more qualified leads',
    category: 'Professional Services',
    team_size: '2–10'
};
const serverContext = {
    timezone: 'America/New_York',
    routing_state: {
        owner_id: 'charles_uid', workspace_id: 'pathsynch_workspace',
        source: 'qualification_rule', route_key: 'local_growth', rule_version: 'booking-routing-v1'
    },
    specialist: {
        id: 'spc_charles_fixture', display_name: 'Charles Berry', title: 'Founder & CEO',
        avatar_url: null, initials: 'CB', timezone: 'America/New_York'
    }
};

let testEnv;
let clock;

beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: 8080 }
    });
}, 30000);

afterAll(async () => {
    firestoreNamespace.Timestamp = namespaceTimestamp;
    delete admin.firestore;
    if (testEnv) await testEnv.cleanup();
}, 10000);

beforeEach(() => {
    // initializeTestEnvironment may load Firestore modules during setup, so
    // remove the compatibility namespace immediately before exercising the
    // booking runtime.
    firestoreNamespace.Timestamp = undefined;
    Object.defineProperty(admin, 'firestore', {
        value: firestoreNamespace,
        writable: true,
        configurable: true,
        enumerable: true
    });
    clock = new Date(START.getTime());
});

afterEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
}, 10000);

describe('SynchIntro booking persistence Timestamp compatibility (Firestore emulator)', () => {
    test('creates, reads, versions, and expires a digest-only session without the namespace static', async () => {
        expect(admin.firestore.Timestamp).toBeUndefined();

        const persistence = createBookingPersistence({
            now: () => new Date(clock.getTime()),
            idGenerator: () => 'bks_timestamp_emulator',
            sessionTokenGenerator: () => SESSION_TOKEN
        });
        const sessionRef = adminDb.collection(COLLECTIONS.SESSIONS).doc('bks_timestamp_emulator');

        expect((await sessionRef.get()).exists).toBe(false);

        const created = await persistence.createSessionWithCapability(createInput, serverContext);
        expect(created.session_token).toBe(SESSION_TOKEN);
        expect(created.session.session_version).toBe(1);

        const firstSnapshot = await sessionRef.get();
        expect(firstSnapshot.exists).toBe(true);
        const first = firstSnapshot.data();
        expect(first.created_at).toBeInstanceOf(Timestamp);
        expect(first.updated_at).toBeInstanceOf(Timestamp);
        expect(first.expires_at).toBeInstanceOf(Timestamp);
        expect(first.created_at.toMillis()).toBe(START.getTime());
        expect(first.updated_at.toMillis()).toBe(START.getTime());
        expect(first.expires_at.toMillis() - first.created_at.toMillis()).toBe(RETENTION_MS.SESSION);
        expect(first.session_token_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(first).not.toHaveProperty('session_token');
        expect(JSON.stringify(first)).not.toContain(SESSION_TOKEN);
        expect(JSON.stringify(first)).not.toMatch(/NYLAS_API_KEY|api[_-]?key|authorization/i);

        await expect(persistence.readSession(created.session.session_id)).resolves.toMatchObject({
            session_id: created.session.session_id,
            session_version: 1,
            status: 'ACTIVE'
        });

        clock = new Date(START.getTime() + 1000);
        const updated = await persistence.updateSession(created.session.session_id, 1, {
            company,
            qualification
        });
        expect(updated.session_version).toBe(2);
        expect(updated.routing_state).toEqual(serverContext.routing_state);
        expect(updated.specialist).toEqual(serverContext.specialist);

        const second = (await sessionRef.get()).data();
        expect(second.created_at).toBeInstanceOf(Timestamp);
        expect(second.updated_at).toBeInstanceOf(Timestamp);
        expect(second.expires_at).toBeInstanceOf(Timestamp);
        expect(second.created_at.toMillis()).toBe(START.getTime());
        expect(second.updated_at.toMillis()).toBe(START.getTime() + 1000);
        expect(second.expires_at.toMillis()).toBe(START.getTime() + RETENTION_MS.SESSION);

        clock = new Date(START.getTime() + RETENTION_MS.SESSION + 1);
        await expect(persistence.readSession(created.session.session_id))
            .rejects.toMatchObject({ code: 'EXPIRED' });
        await expect(persistence.readSession(created.session.session_id, { allowExpired: true }))
            .resolves.toMatchObject({ session_id: created.session.session_id, session_version: 2 });

        const sessions = await adminDb.collection(COLLECTIONS.SESSIONS).get();
        expect(sessions.size).toBe(1);
    });

    test('durably fences and reconciles an interrupted confirmation delivery', async () => {
        const idempotencyKey = 'booking_emulator_confirmation_12345';
        const operationId = `op_${createHash('sha256').update(idempotencyKey).digest('hex')}`;
        const operationRef = adminDb.collection(COLLECTIONS.BOOKING_OPERATIONS).doc(operationId);
        const persistence = createBookingPersistence({
            now: () => new Date(clock.getTime()),
            idGenerator: (prefix) => `${prefix}_timestamp_emulator`,
            claimTokenGenerator: () => 'D'.repeat(43)
        });
        await operationRef.set({
            operation_id: operationId,
            state: 'CONFIRMED',
            confirmed_result: { status: 'confirmed' },
            confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING,
            confirmation_delivery_id: 'cnf_timestamp_emulator',
            confirmation_delivery_attempt_count: 0,
            delivery_attempt_id: null,
            delivery_token_digest: null,
            delivery_lease_expires_at: null,
            created_at: Timestamp.fromDate(clock),
            updated_at: Timestamp.fromDate(clock),
            expires_at: Timestamp.fromDate(new Date(clock.getTime() + RETENTION_MS.BOOKING_OPERATION))
        });

        const claim = await persistence.claimConfirmationDelivery(idempotencyKey);
        expect(claim).toMatchObject({ action: 'prepare', delivery_prepare_authorized: true });
        await persistence.beginConfirmationDelivery({
            idempotency_key: idempotencyKey,
            delivery_token: claim.delivery_token,
            delivery_attempt_id: claim.delivery_attempt_id
        });
        clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
        await expect(persistence.claimConfirmationDelivery(idempotencyKey)).resolves.toMatchObject({
            action: 'reconcile',
            confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
            delivery_attempt_id: claim.delivery_attempt_id
        });
        await expect(persistence.reconcileConfirmationDelivery({
            idempotency_key: idempotencyKey,
            delivery_attempt_id: claim.delivery_attempt_id,
            provider_message_id: 'sendgrid_emulator_message_1',
            reconciliation_evidence_id: 'sendgrid_emulator_receipt_1',
            outcome: 'ACCEPTED'
        })).resolves.toMatchObject({
            confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
            delivery_provider_message_id: 'sendgrid_emulator_message_1'
        });

        const stored = (await operationRef.get()).data();
        expect(stored.confirmation_delivery_state).toBe(CONFIRMATION_DELIVERY_STATES.SENT);
        expect(stored.delivery_token_digest).toBeNull();
        expect(stored.delivery_provider_message_id).toBe('sendgrid_emulator_message_1');
    });

    test('durably fences one cancellation and replays its terminal result without raw capabilities', async () => {
        const bookingIdempotencyKey = 'booking_emulator_cancellation_12345';
        const cancellationIdempotencyKey = 'cancel_emulator_operation_12345';
        const sessionId = 'bks_cancellation_emulator';
        const operationId = `op_${createHash('sha256').update(bookingIdempotencyKey).digest('hex')}`;
        const operationRef = adminDb.collection(COLLECTIONS.BOOKING_OPERATIONS).doc(operationId);
        const confirmedResult = {
            booking_id: 'booking_emulator_1',
            event_id: 'event_emulator_1',
            status: 'confirmed',
            title: 'SynchIntro Strategy Call',
            organizer_email: 'hello@pathsynch.com',
            attendee_emails: ['buyer@example.com'],
            start: '2026-09-21T13:00:00.000Z',
            end: '2026-09-21T13:30:00.000Z',
            timezone: 'America/New_York',
            duration_minutes: 30
        };
        const persistence = createBookingPersistence({
            now: () => new Date(clock.getTime()),
            idGenerator: (prefix) => `${prefix}_cancellation_emulator`,
            claimTokenGenerator: () => 'C'.repeat(43),
            verifyCancellationDeliveryEvidence: async ({ expected, reconciliation_evidence_id }) => ({
                provider_message_id: 'sendgrid_cancellation_emulator_message_1',
                reconciliation_evidence_id,
                outcome: 'ACCEPTED',
                custom_args: {
                    synchintro_cancellation_id: expected.cancellation_delivery_id,
                    synchintro_cancellation_delivery_attempt_id: expected.cancellation_delivery_attempt_id
                }
            })
        });
        await operationRef.set({
            operation_id: operationId,
            session_id: sessionId,
            state: 'CONFIRMED',
            cancellation_state: CANCELLATION_STATES.CONFIRMED,
            confirmed_result: confirmedResult,
            provider_booking_id: confirmedResult.booking_id,
            provider_event_id: confirmedResult.event_id,
            provider_reference: { provider: 'nylas', configuration_id: 'configuration_emulator' },
            session_token_digest: createHash('sha256').update(SESSION_TOKEN).digest('hex'),
            confirmation_identity: createInput.identity,
            specialist: serverContext.specialist,
            created_at: Timestamp.fromDate(clock),
            updated_at: Timestamp.fromDate(clock),
            expires_at: Timestamp.fromDate(new Date(clock.getTime() + RETENTION_MS.BOOKING_OPERATION))
        });

        const input = {
            session_id: sessionId,
            booking_idempotency_key: bookingIdempotencyKey,
            cancellation_idempotency_key: cancellationIdempotencyKey,
            capability: SESSION_TOKEN
        };
        const claim = await persistence.claimCancellationOperation(input);
        expect(claim).toMatchObject({ action: 'cancel', cancellation_authorized: true });
        const claimed = (await operationRef.get()).data();
        expect(claimed.cancellation_retention_expires_at).toBeInstanceOf(Timestamp);
        expect(claimed.cancellation_retention_expires_at.toMillis()).toBe(claimed.expires_at.toMillis());
        await persistence.beginCancellationProviderAttempt({
            booking_idempotency_key: bookingIdempotencyKey,
            cancellation_idempotency_key: cancellationIdempotencyKey,
            claim_token: claim.claim_token
        });
        await persistence.markBookingCancelled({
            booking_idempotency_key: bookingIdempotencyKey,
            cancellation_idempotency_key: cancellationIdempotencyKey,
            claim_token: claim.claim_token,
            provider_booking_id: confirmedResult.booking_id,
            provider_event_id: confirmedResult.event_id,
            provider_request_id: 'request_emulator_1'
        });

        await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
            action: 'already_cancelled',
            cancellation_authorized: false,
            operation: {
                state: 'CONFIRMED',
                cancellation_state: CANCELLATION_STATES.CANCELLED,
                confirmed_result: confirmedResult
            }
        });
        const delivery = await persistence.claimCancellationDelivery(bookingIdempotencyKey);
        const sending = await persistence.beginCancellationDelivery({
            booking_idempotency_key: bookingIdempotencyKey,
            delivery_token: delivery.delivery_token,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id
        });
        await persistence.markCancellationDeliveryOutcomeUnknown({
            booking_idempotency_key: bookingIdempotencyKey,
            delivery_token: sending.delivery_token
        });
        await expect(persistence.reconcileCancellationDelivery({
            booking_idempotency_key: bookingIdempotencyKey,
            delivery_attempt_id: delivery.cancellation_delivery_attempt_id,
            provider_message_id: 'sendgrid_cancellation_emulator_message_1',
            reconciliation_evidence_id: 'sendgrid_cancellation_emulator_receipt_1',
            outcome: 'ACCEPTED'
        })).resolves.toMatchObject({
            cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
            cancellation_delivery_reconciliation_required: false
        });
        const stored = (await operationRef.get()).data();
        expect(stored.cancellation_attempt_count).toBe(1);
        expect(stored.cancellation_delivery_state).toBe(CONFIRMATION_DELIVERY_STATES.SENT);
        expect(stored.cancellation_delivery_provider_message_id)
            .toBe('sendgrid_cancellation_emulator_message_1');
        expect(stored.cancellation_claim_token_digest).toBeNull();
        expect(stored.cancellation_idempotency_key_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(stored)).not.toContain(SESSION_TOKEN);
        expect(JSON.stringify(stored)).not.toContain(cancellationIdempotencyKey);
        expect(JSON.stringify(stored)).not.toContain(claim.claim_token);
    });

    test('persists and verifies signed SendGrid cancellation evidence with native Firestore timestamps', async () => {
        const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const jwk = pair.publicKey.export({ format: 'jwk' });
        const publicKey = Buffer.concat([
            Buffer.from([4]),
            Buffer.from(jwk.x, 'base64url'),
            Buffer.from(jwk.y, 'base64url')
        ]).toString('base64');
        const store = createCancellationDeliveryEvidenceStore({
            db: adminDb,
            now: () => new Date(clock.getTime()),
            publicKey
        });
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const rawBody = Buffer.from(JSON.stringify([{
            event: 'delivered',
            email: 'must-not-be-stored@example.com',
            sg_event_id: 'event_emulator_1',
            sg_message_id: 'message_emulator_1',
            synchintro_cancellation_id: 'cnd_emulator_1',
            synchintro_cancellation_delivery_attempt_id: 'cda_emulator_1'
        }]));
        const signature = sign(
            'sha256',
            Buffer.concat([Buffer.from(timestamp), rawBody]),
            pair.privateKey
        ).toString('base64');

        await expect(store.ingestSignedWebhook({
            rawBody,
            headers: {
                'x-twilio-email-event-webhook-timestamp': timestamp,
                'x-twilio-email-event-webhook-signature': signature
            }
        })).resolves.toEqual({ accepted: 1 });
        await expect(store.verify({ expected: {
            cancellation_delivery_id: 'cnd_emulator_1',
            cancellation_delivery_attempt_id: 'cda_emulator_1'
        } })).resolves.toMatchObject({
            provider_message_id: 'message_emulator_1',
            outcome: 'DELIVERED'
        });

        const evidence = (await adminDb.collection(CANCELLATION_EVIDENCE_COLLECTION)
            .doc('cda_emulator_1').get()).data();
        expect(evidence.received_at).toBeInstanceOf(Timestamp);
        expect(evidence.expires_at).toBeInstanceOf(Timestamp);
        expect(JSON.stringify(evidence)).not.toContain('must-not-be-stored@example.com');
    });
});
