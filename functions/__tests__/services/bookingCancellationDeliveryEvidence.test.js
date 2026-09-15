'use strict';

const crypto = require('crypto');
const {
    COLLECTION,
    createCancellationDeliveryEvidenceStore
} = require('../../services/booking/bookingCancellationDeliveryEvidence');

function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

class MemoryFirestore {
    constructor() {
        this.values = new Map();
        this.tail = Promise.resolve();
    }

    collection(name) {
        return {
            doc: (id) => ({
                key: `${name}/${id}`,
                get: async () => this.snapshot(`${name}/${id}`)
            })
        };
    }

    snapshot(key) {
        const value = this.values.get(key);
        return { exists: value !== undefined, data: () => clone(value) };
    }

    runTransaction(callback) {
        const run = async () => {
            let write;
            const transaction = {
                get: async (ref) => this.snapshot(ref.key),
                set: (ref, value) => { write = { key: ref.key, value: clone(value) }; }
            };
            const result = await callback(transaction);
            if (write) this.values.set(write.key, write.value);
            return result;
        };
        const result = this.tail.then(run, run);
        this.tail = result.catch(() => undefined);
        return result;
    }
}

function signedRequest(privateKey, timestamp, events) {
    const rawBody = Buffer.from(JSON.stringify(events));
    const signature = crypto.sign(
        'sha256',
        Buffer.concat([Buffer.from(timestamp), rawBody]),
        privateKey
    ).toString('base64');
    return {
        rawBody,
        headers: {
            'x-twilio-email-event-webhook-timestamp': timestamp,
            'x-twilio-email-event-webhook-signature': signature
        }
    };
}

describe('SendGrid cancellation delivery evidence', () => {
    let firestore;
    let clock;
    let privateKey;
    let publicKey;
    let store;

    beforeEach(() => {
        firestore = new MemoryFirestore();
        clock = new Date('2026-09-15T18:00:00.000Z');
        const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        privateKey = pair.privateKey;
        const jwk = pair.publicKey.export({ format: 'jwk' });
        publicKey = Buffer.concat([
            Buffer.from([4]),
            Buffer.from(jwk.x, 'base64url'),
            Buffer.from(jwk.y, 'base64url')
        ]).toString('base64');
        store = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey
        });
    });

    test('stores only signed opaque cancellation evidence and returns exact trusted binding', async () => {
        const attemptId = 'cda_attempt_123';
        const cancellationId = 'cnd_cancellation_123';
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            email: 'must-not-be-stored@example.com',
            sg_event_id: 'event_123',
            sg_message_id: 'message_123',
            synchintro_cancellation_id: cancellationId,
            synchintro_cancellation_delivery_attempt_id: attemptId
        }]);

        await expect(store.ingestSignedWebhook(request)).resolves.toEqual({ accepted: 1 });
        const stored = firestore.values.get(`${COLLECTION}/${attemptId}`);
        expect(stored).toMatchObject({
            provider: 'sendgrid',
            cancellation_delivery_id: cancellationId,
            cancellation_delivery_attempt_id: attemptId,
            provider_message_id: 'message_123',
            outcome: 'DELIVERED'
        });
        expect(JSON.stringify(stored)).not.toContain('must-not-be-stored@example.com');
        await expect(store.verify({ expected: {
            cancellation_delivery_id: cancellationId,
            cancellation_delivery_attempt_id: attemptId
        } })).resolves.toMatchObject({
            provider_message_id: 'message_123',
            outcome: 'DELIVERED',
            custom_args: {
                synchintro_cancellation_id: cancellationId,
                synchintro_cancellation_delivery_attempt_id: attemptId
            }
        });
    });

    test('rejects tampered payloads and never persists their claimed binding', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const request = signedRequest(privateKey, timestamp, [{
            event: 'processed',
            sg_event_id: 'event_123',
            sg_message_id: 'message_123',
            synchintro_cancellation_id: 'cnd_original',
            synchintro_cancellation_delivery_attempt_id: 'cda_original'
        }]);
        request.rawBody = Buffer.from(request.rawBody.toString('utf8').replace('cnd_original', 'cnd_tampered'));

        await expect(store.ingestSignedWebhook(request)).rejects.toMatchObject({ status: 401 });
        expect(firestore.values.size).toBe(0);
    });

    test('does not downgrade delivered evidence when a later processed event arrives', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const common = {
            sg_message_id: 'message_123',
            synchintro_cancellation_id: 'cnd_cancellation_123',
            synchintro_cancellation_delivery_attempt_id: 'cda_attempt_123'
        };
        await store.ingestSignedWebhook(signedRequest(privateKey, timestamp, [{
            ...common, event: 'delivered', sg_event_id: 'event_delivered'
        }]));
        await store.ingestSignedWebhook(signedRequest(privateKey, timestamp, [{
            ...common, event: 'processed', sg_event_id: 'event_processed'
        }]));

        expect(firestore.values.get(`${COLLECTION}/cda_attempt_123`).outcome).toBe('DELIVERED');
    });

    test('accepts provider-sized mixed batches and filters unrelated events before writing evidence', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const unrelated = Array.from({ length: 100 }, (_, index) => ({
            event: 'processed',
            email: `unrelated-${index}@example.com`,
            sg_event_id: `unrelated_event_${index}`,
            sg_message_id: `unrelated_message_${index}`
        }));
        const relevant = {
            event: 'delivered',
            email: 'must-not-be-stored@example.com',
            sg_event_id: 'event_mixed_batch',
            sg_message_id: 'message_mixed_batch',
            synchintro_cancellation_id: 'cnd_mixed_batch',
            synchintro_cancellation_delivery_attempt_id: 'cda_mixed_batch'
        };

        await expect(store.ingestSignedWebhook(
            signedRequest(privateKey, timestamp, [...unrelated, relevant])
        )).resolves.toEqual({ accepted: 1 });
        expect(firestore.values.size).toBe(1);
        expect(firestore.values.get(`${COLLECTION}/cda_mixed_batch`)).toMatchObject({
            cancellation_delivery_id: 'cnd_mixed_batch',
            provider_message_id: 'message_mixed_batch',
            outcome: 'DELIVERED'
        });
    });
});
