'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { RETENTION_MS } = require('./bookingPersistenceSchema');

const COLLECTION = 'synchintroSendGridCancellationEvidence';
// SendGrid batches for roughly 30 seconds or until a request reaches 768 KiB.
// Keep the provider's documented request boundary here and filter the signed
// batch before performing any cancellation-evidence writes.
const MAX_WEBHOOK_BYTES = 768 * 1024;
const MAX_EVIDENCE_PER_TRANSACTION = 200;
const MAX_TRANSACTION_CONCURRENCY = 4;
const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

class CancellationDeliveryEvidenceError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'CancellationDeliveryEvidenceError';
        this.status = status;
    }
}

function safeId(value, field) {
    const normalized = String(value || '').trim();
    if (!SAFE_ID.test(normalized)) {
        throw new CancellationDeliveryEvidenceError(400, `${field} is invalid`);
    }
    return normalized;
}

function safeProviderId(value, field) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new CancellationDeliveryEvidenceError(400, `${field} is invalid`);
    }
    return normalized;
}

function sendGridPublicKey(value) {
    const encoded = String(value || '').trim();
    if (!encoded || encoded.length > 512 || !/^[a-zA-Z0-9+/=_-]+$/.test(encoded)) {
        throw new CancellationDeliveryEvidenceError(503, 'SendGrid event verification is not configured');
    }
    const raw = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    try {
        let key;
        if (raw.length === 65 && raw[0] === 4) {
            key = crypto.createPublicKey({
                key: Buffer.concat([P256_SPKI_PREFIX, raw]), format: 'der', type: 'spki'
            });
        } else {
            key = crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
        }
        if (key.asymmetricKeyType !== 'ec'
            || !key.asymmetricKeyDetails
            || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') {
            throw new Error('unexpected SendGrid signing key type');
        }
        return key;
    } catch (_) {
        throw new CancellationDeliveryEvidenceError(503, 'SendGrid event verification is not configured');
    }
}

function verifySendGridSignature({ publicKey, payload, signature, timestamp }) {
    const rawPayload = Buffer.isBuffer(payload) ? payload : null;
    const normalizedTimestamp = String(timestamp || '').trim();
    const normalizedSignature = String(signature || '').trim();
    if (!rawPayload || !/^\d{10,13}$/.test(normalizedTimestamp)
        || !normalizedSignature || normalizedSignature.length > 512) {
        return false;
    }
    let signatureBytes;
    try {
        signatureBytes = Buffer.from(normalizedSignature, 'base64');
    } catch (_) {
        return false;
    }
    if (!signatureBytes.length) return false;
    try {
        return crypto.verify(
            'sha256',
            Buffer.concat([Buffer.from(normalizedTimestamp, 'utf8'), rawPayload]),
            publicKey,
            signatureBytes
        );
    } catch (_) {
        return false;
    }
}

function webhookHeader(req, name) {
    if (req && typeof req.get === 'function') return req.get(name);
    return req && req.headers ? req.headers[name.toLowerCase()] : undefined;
}

function outcomeForEvent(event) {
    if (event === 'delivered') return 'DELIVERED';
    if (event === 'processed') return 'ACCEPTED';
    return null;
}

function eventBinding(event) {
    const customArgs = event && event.custom_args && typeof event.custom_args === 'object'
        ? event.custom_args
        : event;
    return {
        cancellationId: safeId(customArgs && customArgs.synchintro_cancellation_id, 'cancellation id'),
        attemptId: safeId(
            customArgs && customArgs.synchintro_cancellation_delivery_attempt_id,
            'cancellation delivery attempt id'
        )
    };
}

function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function createCancellationDeliveryEvidenceStore(options = {}) {
    const db = options.db || admin.firestore();
    const now = options.now || (() => new Date());
    const configuredPublicKey = options.publicKey === undefined
        ? process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY
        : options.publicKey;
    const signatureVerifier = options.signatureVerifier || verifySendGridSignature;

    async function ingestSignedWebhook(req) {
        const payload = req && Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
        if (!payload || payload.length < 2 || payload.length > MAX_WEBHOOK_BYTES) {
            throw new CancellationDeliveryEvidenceError(400, 'SendGrid event payload is invalid');
        }
        const timestamp = String(webhookHeader(req, 'X-Twilio-Email-Event-Webhook-Timestamp') || '').trim();
        const signature = String(webhookHeader(req, 'X-Twilio-Email-Event-Webhook-Signature') || '').trim();
        const timestampSeconds = Number(timestamp);
        const at = now();
        if (!/^\d{10}$/.test(timestamp) || !Number.isFinite(timestampSeconds)
            || Math.abs(at.getTime() - (timestampSeconds * 1000)) > SIGNATURE_MAX_SKEW_MS) {
            throw new CancellationDeliveryEvidenceError(401, 'SendGrid event signature is invalid');
        }
        const publicKey = sendGridPublicKey(configuredPublicKey);
        if (!signatureVerifier({ publicKey, payload, signature, timestamp })) {
            throw new CancellationDeliveryEvidenceError(401, 'SendGrid event signature is invalid');
        }
        let events;
        try {
            events = JSON.parse(payload.toString('utf8'));
        } catch (_) {
            throw new CancellationDeliveryEvidenceError(400, 'SendGrid event payload is invalid');
        }
        if (!Array.isArray(events) || events.length < 1) {
            throw new CancellationDeliveryEvidenceError(400, 'SendGrid event payload is invalid');
        }

        let accepted = 0;
        const evidenceByAttemptId = new Map();
        for (const event of events) {
            const outcome = outcomeForEvent(event && event.event);
            const hasCancellationBinding = event && (
                event.synchintro_cancellation_id
                || (event.custom_args && event.custom_args.synchintro_cancellation_id)
            );
            if (!outcome || !hasCancellationBinding) continue;
            const binding = eventBinding(event);
            const eventId = safeProviderId(event.sg_event_id, 'SendGrid event id');
            const providerMessageId = safeProviderId(event.sg_message_id, 'SendGrid message id');
            const evidenceId = `sge_${crypto.createHash('sha256').update(eventId).digest('hex')}`;
            const current = evidenceByAttemptId.get(binding.attemptId);
            if (current && (current.binding.cancellationId !== binding.cancellationId
                || current.providerMessageId !== providerMessageId)) {
                throw new CancellationDeliveryEvidenceError(409, 'SendGrid event binding conflicts within signed batch');
            }
            if (!current || current.outcome !== 'DELIVERED' || outcome === 'DELIVERED') {
                evidenceByAttemptId.set(binding.attemptId, {
                    binding, providerMessageId, evidenceId, outcome
                });
            }
            accepted += 1;
        }

        const evidenceChunks = chunks(
            Array.from(evidenceByAttemptId.values()),
            MAX_EVIDENCE_PER_TRANSACTION
        );
        let nextChunk = 0;
        let firstPersistenceError = null;
        async function persistNextChunks() {
            while (!firstPersistenceError && nextChunk < evidenceChunks.length) {
                const chunk = evidenceChunks[nextChunk];
                nextChunk += 1;
                const refs = chunk.map((item) => db.collection(COLLECTION).doc(item.binding.attemptId));
                try {
                    await db.runTransaction(async (transaction) => {
                        const snapshots = typeof transaction.getAll === 'function'
                            ? await transaction.getAll(...refs)
                            : await Promise.all(refs.map((ref) => transaction.get(ref)));
                        chunk.forEach((item, index) => {
                            const { binding, providerMessageId, evidenceId, outcome } = item;
                            const ref = refs[index];
                            const snapshot = snapshots[index];
                            const current = snapshot.exists ? snapshot.data() : null;
                            if (current && (current.cancellation_delivery_id !== binding.cancellationId
                                || current.cancellation_delivery_attempt_id !== binding.attemptId
                                || current.provider_message_id !== providerMessageId)) {
                                throw new CancellationDeliveryEvidenceError(
                                    409,
                                    'SendGrid event binding conflicts with durable evidence'
                                );
                            }
                            if (current && current.outcome === 'DELIVERED' && outcome === 'ACCEPTED') return;
                            transaction.set(ref, {
                                provider: 'sendgrid',
                                cancellation_delivery_id: binding.cancellationId,
                                cancellation_delivery_attempt_id: binding.attemptId,
                                provider_message_id: providerMessageId,
                                reconciliation_evidence_id: evidenceId,
                                outcome,
                                received_at: current ? current.received_at : at,
                                updated_at: at,
                                expires_at: current
                                    ? current.expires_at
                                    : new Date(at.getTime() + RETENTION_MS.BOOKING_OPERATION)
                            });
                        });
                    });
                } catch (error) {
                    if (!firstPersistenceError) firstPersistenceError = error;
                    return;
                }
            }
        }
        await Promise.all(Array.from(
            { length: Math.min(MAX_TRANSACTION_CONCURRENCY, evidenceChunks.length) },
            persistNextChunks
        ));
        if (firstPersistenceError) throw firstPersistenceError;
        return { accepted };
    }

    async function verify(input) {
        const expected = input && input.expected;
        const cancellationId = safeId(expected && expected.cancellation_delivery_id, 'cancellation id');
        const attemptId = safeId(
            expected && expected.cancellation_delivery_attempt_id,
            'cancellation delivery attempt id'
        );
        const snapshot = await db.collection(COLLECTION).doc(attemptId).get();
        if (!snapshot.exists) throw new CancellationDeliveryEvidenceError(404, 'Cancellation delivery evidence was not found');
        const evidence = snapshot.data();
        const at = now();
        const expiresAt = evidence.expires_at && typeof evidence.expires_at.toDate === 'function'
            ? evidence.expires_at.toDate()
            : new Date(evidence.expires_at);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= at.getTime()
            || evidence.provider !== 'sendgrid'
            || evidence.cancellation_delivery_id !== cancellationId
            || evidence.cancellation_delivery_attempt_id !== attemptId
            || !['ACCEPTED', 'DELIVERED'].includes(evidence.outcome)) {
            throw new CancellationDeliveryEvidenceError(409, 'Cancellation delivery evidence is not definitive');
        }
        if (input.reconciliation_evidence_id
            && evidence.reconciliation_evidence_id !== input.reconciliation_evidence_id) {
            throw new CancellationDeliveryEvidenceError(409, 'Cancellation delivery evidence identity does not match');
        }
        return {
            provider_message_id: evidence.provider_message_id,
            reconciliation_evidence_id: evidence.reconciliation_evidence_id,
            outcome: evidence.outcome,
            custom_args: {
                synchintro_cancellation_id: evidence.cancellation_delivery_id,
                synchintro_cancellation_delivery_attempt_id: evidence.cancellation_delivery_attempt_id
            }
        };
    }

    return Object.freeze({ ingestSignedWebhook, verify });
}

let singleton;
function getCancellationDeliveryEvidenceStore() {
    if (!singleton) singleton = createCancellationDeliveryEvidenceStore();
    return singleton;
}

module.exports = {
    COLLECTION,
    MAX_WEBHOOK_BYTES,
    MAX_EVIDENCE_PER_TRANSACTION,
    MAX_TRANSACTION_CONCURRENCY,
    SIGNATURE_MAX_SKEW_MS,
    CancellationDeliveryEvidenceError,
    sendGridPublicKey,
    verifySendGridSignature,
    createCancellationDeliveryEvidenceStore,
    getCancellationDeliveryEvidenceStore
};
