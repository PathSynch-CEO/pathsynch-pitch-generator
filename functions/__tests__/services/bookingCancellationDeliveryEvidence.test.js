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
        this.runTransactionCalls = 0;
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
        this.runTransactionCalls += 1;
        const run = async () => {
            const writes = [];
            const transaction = {
                get: async (ref) => this.snapshot(ref.key),
                getAll: async (...refs) => refs.map((ref) => this.snapshot(ref.key)),
                set: (ref, value) => { writes.push({ key: ref.key, value: clone(value) }); }
            };
            const result = await callback(transaction);
            writes.forEach((write) => this.values.set(write.key, write.value));
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

    test('admits a valid signed batch through the provider limiter before Firestore work', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const observedTransactionCounts = [];
        const enforceWebhookRateLimit = jest.fn(async () => {
            observedTransactionCounts.push(firestore.runTransactionCalls);
            return { allowed: true };
        });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });

        await expect(limitedStore.ingestSignedWebhook(signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_limited_valid',
            sg_message_id: 'message_limited_valid',
            synchintro_cancellation_id: 'cnd_limited_valid',
            synchintro_cancellation_delivery_attempt_id: 'cda_limited_valid'
        }]))).resolves.toEqual({ accepted: 1 });

        expect(enforceWebhookRateLimit).toHaveBeenCalledTimes(1);
        expect(observedTransactionCounts).toEqual([0]);
        expect(firestore.runTransactionCalls).toBe(1);
    });

    test('rejects invalid signatures before the provider limiter or Firestore work', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn().mockResolvedValue({ allowed: true });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_invalid_signature',
            sg_message_id: 'message_invalid_signature',
            synchintro_cancellation_id: 'cnd_invalid_signature',
            synchintro_cancellation_delivery_attempt_id: 'cda_invalid_signature'
        }]);
        request.headers['x-twilio-email-event-webhook-signature'] = 'invalid-signature';

        await expect(limitedStore.ingestSignedWebhook(request)).rejects.toMatchObject({ status: 401 });
        expect(enforceWebhookRateLimit).not.toHaveBeenCalled();
        expect(firestore.runTransactionCalls).toBe(0);
    });

    test('rejects an unsigned request before the provider limiter or Firestore work', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn().mockResolvedValue({ allowed: true });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });

        await expect(limitedStore.ingestSignedWebhook({
            rawBody: Buffer.from('[{"event":"delivered"}]'),
            headers: { 'x-twilio-email-event-webhook-timestamp': timestamp }
        })).rejects.toMatchObject({ status: 401 });
        expect(enforceWebhookRateLimit).not.toHaveBeenCalled();
        expect(firestore.runTransactionCalls).toBe(0);
    });

    test('rejects an oversized request before signature work, admission, or transaction fanout', async () => {
        const enforceWebhookRateLimit = jest.fn().mockResolvedValue({ allowed: true });
        const signatureVerifier = jest.fn().mockReturnValue(true);
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            signatureVerifier,
            enforceWebhookRateLimit
        });

        await expect(limitedStore.ingestSignedWebhook({
            rawBody: Buffer.alloc((768 * 1024) + 1, 32),
            headers: {}
        })).rejects.toMatchObject({ status: 400 });
        expect(signatureVerifier).not.toHaveBeenCalled();
        expect(enforceWebhookRateLimit).not.toHaveBeenCalled();
        expect(firestore.runTransactionCalls).toBe(0);
    });

    test('rejects an excessive signed event count before the limiter or transaction fanout', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn().mockResolvedValue({ allowed: true });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });
        const excessiveBatch = Array.from({ length: 4097 }, () => ({}));

        await expect(limitedStore.ingestSignedWebhook(
            signedRequest(privateKey, timestamp, excessiveBatch)
        )).rejects.toMatchObject({ status: 400 });
        expect(enforceWebhookRateLimit).not.toHaveBeenCalled();
        expect(firestore.runTransactionCalls).toBe(0);
    });

    test('returns a retryable failure on limiter exhaustion without mutating evidence', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn().mockResolvedValue({
            allowed: false,
            retryAfterSeconds: 29
        });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_limiter_exhausted',
            sg_message_id: 'message_limiter_exhausted',
            synchintro_cancellation_id: 'cnd_limiter_exhausted',
            synchintro_cancellation_delivery_attempt_id: 'cda_limiter_exhausted'
        }]);

        await expect(limitedStore.ingestSignedWebhook(request)).rejects.toMatchObject({
            status: 503,
            retryAfterSeconds: 29
        });
        expect(firestore.runTransactionCalls).toBe(0);
        expect(firestore.values.size).toBe(0);
    });

    test('fails closed when the limiter is unavailable and processes a later provider retry', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn()
            .mockRejectedValueOnce(new Error('limiter unavailable'))
            .mockResolvedValueOnce({ allowed: true });
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_limiter_retry',
            sg_message_id: 'message_limiter_retry',
            synchintro_cancellation_id: 'cnd_limiter_retry',
            synchintro_cancellation_delivery_attempt_id: 'cda_limiter_retry'
        }]);

        await expect(limitedStore.ingestSignedWebhook(request)).rejects.toMatchObject({ status: 503 });
        expect(firestore.runTransactionCalls).toBe(0);
        await expect(limitedStore.ingestSignedWebhook(request)).resolves.toEqual({ accepted: 1 });
        expect(firestore.runTransactionCalls).toBe(1);
        expect(firestore.values.size).toBe(1);
    });

    test('does not log webhook signature or payload material when admission fails', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const enforceWebhookRateLimit = jest.fn().mockRejectedValue(new Error('limiter unavailable'));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const limitedStore = createCancellationDeliveryEvidenceStore({
            db: firestore,
            now: () => new Date(clock.getTime()),
            publicKey,
            enforceWebhookRateLimit
        });
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_log_sentinel',
            sg_message_id: 'message_log_sentinel',
            synchintro_cancellation_id: 'cnd_log_sentinel',
            synchintro_cancellation_delivery_attempt_id: 'cda_log_sentinel'
        }]);

        try {
            await expect(limitedStore.ingestSignedWebhook(request)).rejects.toMatchObject({ status: 503 });
            expect(errorSpy).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    test('keeps an identical signed provider retry idempotent', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const request = signedRequest(privateKey, timestamp, [{
            event: 'delivered',
            sg_event_id: 'event_identical_retry',
            sg_message_id: 'message_identical_retry',
            synchintro_cancellation_id: 'cnd_identical_retry',
            synchintro_cancellation_delivery_attempt_id: 'cda_identical_retry'
        }]);

        await expect(store.ingestSignedWebhook(request)).resolves.toEqual({ accepted: 1 });
        await expect(store.ingestSignedWebhook(request)).resolves.toEqual({ accepted: 1 });
        expect(firestore.values.size).toBe(1);
        expect(firestore.values.get(`${COLLECTION}/cda_identical_retry`)).toMatchObject({
            cancellation_delivery_id: 'cnd_identical_retry',
            provider_message_id: 'message_identical_retry',
            outcome: 'DELIVERED'
        });
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

    test('coalesces one attempt inside a signed batch without downgrading delivered evidence', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const common = {
            sg_message_id: 'message_same_batch',
            synchintro_cancellation_id: 'cnd_same_batch',
            synchintro_cancellation_delivery_attempt_id: 'cda_same_batch'
        };
        await expect(store.ingestSignedWebhook(signedRequest(privateKey, timestamp, [
            { ...common, event: 'processed', sg_event_id: 'event_same_batch_processed' },
            { ...common, event: 'delivered', sg_event_id: 'event_same_batch_delivered' }
        ]))).resolves.toEqual({ accepted: 2 });

        expect(firestore.runTransactionCalls).toBe(1);
        expect(firestore.values.get(`${COLLECTION}/cda_same_batch`)).toMatchObject({
            cancellation_delivery_id: 'cnd_same_batch',
            provider_message_id: 'message_same_batch',
            outcome: 'DELIVERED'
        });
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

    test('persists a provider-sized relevant batch with bounded Firestore transactions', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const relevant = Array.from({ length: 401 }, (_, index) => ({
            event: index % 2 ? 'processed' : 'delivered',
            sg_event_id: `event_bulk_${index}`,
            sg_message_id: `message_bulk_${index}`,
            synchintro_cancellation_id: `cnd_bulk_${index}`,
            synchintro_cancellation_delivery_attempt_id: `cda_bulk_${index}`
        }));

        await expect(store.ingestSignedWebhook(
            signedRequest(privateKey, timestamp, relevant)
        )).resolves.toEqual({ accepted: relevant.length });
        expect(firestore.values.size).toBe(relevant.length);
        expect(firestore.values.get(`${COLLECTION}/cda_bulk_400`)).toMatchObject({
            cancellation_delivery_id: 'cnd_bulk_400',
            provider_message_id: 'message_bulk_400',
            outcome: 'DELIVERED'
        });
        expect(firestore.runTransactionCalls).toBe(3);
    });

    test('waits for started workers and stops assigning chunks before rejecting', async () => {
        const timestamp = String(Math.floor(clock.getTime() / 1000));
        const relevant = Array.from({ length: 1001 }, (_, index) => ({
            event: 'delivered',
            sg_event_id: `event_failure_${index}`,
            sg_message_id: `message_failure_${index}`,
            synchintro_cancellation_id: `cnd_failure_${index}`,
            synchintro_cancellation_delivery_attempt_id: `cda_failure_${index}`
        }));
        const releases = [];
        const expectedError = new Error('transaction unavailable');
        const controlledDb = {
            transactionCalls: 0,
            collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}` }) }),
            runTransaction: async (callback) => {
                const call = controlledDb.transactionCalls++;
                await callback({
                    getAll: async (...refs) => refs.map(() => ({ exists: false })),
                    set: () => undefined
                });
                if (call === 0) throw expectedError;
                if (call < 4) await new Promise((resolve) => releases.push(resolve));
            }
        };
        const controlledStore = createCancellationDeliveryEvidenceStore({
            db: controlledDb,
            now: () => new Date(clock.getTime()),
            publicKey
        });

        let settled = false;
        const ingestion = controlledStore.ingestSignedWebhook(
            signedRequest(privateKey, timestamp, relevant)
        ).then(
            (value) => { settled = true; return { value }; },
            (error) => { settled = true; return { error }; }
        );
        await new Promise((resolve) => setImmediate(resolve));
        const settledBeforeRelease = settled;
        releases.splice(0).forEach((release) => release());
        const result = await ingestion;
        await new Promise((resolve) => setImmediate(resolve));

        expect(result.error).toBe(expectedError);
        expect(settledBeforeRelease).toBe(false);
        expect(controlledDb.transactionCalls).toBe(4);
    });
});
