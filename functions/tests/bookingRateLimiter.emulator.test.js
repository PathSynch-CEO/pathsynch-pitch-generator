'use strict';

/**
 * SynchIntro booking rate limiter — Firestore emulator regression.
 *
 * The Functions emulator does not guarantee the legacy
 * admin.firestore.FieldValue namespace static. Keep it unavailable here so this
 * suite exercises the same runtime shape while using real Firestore transactions.
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

const PROJECT_ID = 'booking-rate-limiter-emulator-test';
const RAW_SESSION_ID = 'bks_emulator_sensitive_session';

const admin = require('firebase-admin');
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const adminDb = admin.firestore();
const namespaceFieldValue = admin.firestore.FieldValue;
admin.firestore.FieldValue = undefined;

const {
    LIMITS,
    digestIdentifier,
    createBookingApiRateLimiter
} = require('../services/booking/bookingApiRateLimiter');

let testEnv;

beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules, host: '127.0.0.1', port: 8080 }
    });
}, 30000);

afterAll(async () => {
    admin.firestore.FieldValue = namespaceFieldValue;
    if (testEnv) await testEnv.cleanup();
}, 10000);

afterEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
}, 10000);

describe('SynchIntro booking rate limiter (Firestore emulator)', () => {
    test('creates, increments, and enforces an opaque session counter without the namespace static', async () => {
        const limiter = createBookingApiRateLimiter();
        const digest = digestIdentifier('availability_session', RAW_SESSION_ID);
        const docId = `${digest}_synchintro_availability_session`;
        const docRef = adminDb.collection('rateLimits').doc(docId);

        expect((await docRef.get()).exists).toBe(false);

        await expect(limiter.enforceAvailabilitySession(RAW_SESSION_ID)).resolves.toMatchObject({
            allowed: true,
            count: 1
        });

        const first = await docRef.get();
        expect(first.exists).toBe(true);
        expect(first.data()).toMatchObject({
            identifier: digest,
            type: 'synchintro_availability_session',
            count: 1
        });
        expect(first.data().lastRequest).toBeInstanceOf(admin.firestore.Timestamp);

        await expect(limiter.enforceAvailabilitySession(RAW_SESSION_ID)).resolves.toMatchObject({
            allowed: true,
            count: 2
        });

        const second = await docRef.get();
        expect(second.data().count).toBe(2);
        expect(second.data().lastRequest).toBeInstanceOf(admin.firestore.Timestamp);

        for (let count = 3; count <= LIMITS.availability_session.requests; count += 1) {
            await limiter.enforceAvailabilitySession(RAW_SESSION_ID);
        }

        await expect(limiter.enforceAvailabilitySession(RAW_SESSION_ID)).rejects.toMatchObject({
            code: 'RATE_LIMIT',
            status: 429,
            details: { scope: 'availability_session' }
        });

        const finalSnapshot = await docRef.get();
        expect(finalSnapshot.data().count).toBe(LIMITS.availability_session.requests);

        const allCounters = await adminDb.collection('rateLimits').get();
        expect(allCounters.size).toBe(1);
        expect(allCounters.docs[0].id).not.toContain(RAW_SESSION_ID);
        expect(JSON.stringify(allCounters.docs[0].data())).not.toContain(RAW_SESSION_ID);
        expect(allCounters.docs[0].data().identifier).toMatch(/^[a-f0-9]{64}$/);
    });
});
