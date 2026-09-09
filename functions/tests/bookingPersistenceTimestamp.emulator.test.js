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
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Local emulator required');

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
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
    createBookingPersistence
} = require('../services/booking/bookingPersistence');

const createInput = {
    flow_id: 'synchintro_progressive',
    identity: {
        email: 'buyer@example.com',
        provider: 'email'
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

let testEnv;
let clock;

beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]) }
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

        const created = await persistence.createSessionWithCapability(createInput);
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
            qualification,
            routing_state: {
                owner_id: 'hello_pathsynch',
                source: 'sandbox_configuration',
                rule_version: 'booking-routing-v1'
            }
        });
        expect(updated.session_version).toBe(2);

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
});
