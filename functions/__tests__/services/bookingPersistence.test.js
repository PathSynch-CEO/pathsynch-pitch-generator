'use strict';

const {
    COLLECTIONS,
    OPERATION_STATES,
    OPERATION_LEASE_MS,
    RETENTION_MS,
    createBookingPersistence
} = require('../../services/booking/bookingPersistence');
const { bookingRequestFingerprint } = require('../../services/booking/bookingContract');

function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

class StrictSnapshot {
    constructor(id, data) {
        this.id = id;
        this.exists = data !== undefined;
        this.value = data;
    }

    data() {
        return clone(this.value);
    }
}

class StrictDocumentReference {
    constructor(firestore, collectionName, id) {
        this.firestore = firestore;
        this.collectionName = collectionName;
        this.id = id;
    }

    async get() {
        return this.firestore.snapshot(this);
    }

    async set(value) {
        this.firestore.write(this, value);
    }
}

class StrictTransaction {
    constructor(firestore) {
        this.firestore = firestore;
        this.writes = [];
        this.writeStarted = false;
    }

    async get(reference) {
        if (this.writeStarted) throw new Error('Firestore transactions must read before writing');
        return this.firestore.snapshot(reference);
    }

    set(reference, value) {
        this.writeStarted = true;
        this.writes.push({ type: 'set', reference, value: clone(value) });
    }

    update(reference, value) {
        this.writeStarted = true;
        this.writes.push({ type: 'update', reference, value: clone(value) });
    }

    commit() {
        for (const write of this.writes) {
            if (write.type === 'set') {
                this.firestore.write(write.reference, write.value);
            } else {
                const current = this.firestore.read(write.reference);
                if (current === undefined) throw new Error('Cannot update a missing document');
                this.firestore.write(write.reference, Object.assign({}, current, write.value));
            }
        }
    }
}

class StrictFirestore {
    constructor() {
        this.collections = new Map();
        this.transactionTail = Promise.resolve();
    }

    collection(name) {
        return { doc: (id) => new StrictDocumentReference(this, name, id) };
    }

    read(reference) {
        return this.collections.get(reference.collectionName)?.get(reference.id);
    }

    snapshot(reference) {
        return new StrictSnapshot(reference.id, clone(this.read(reference)));
    }

    write(reference, value) {
        if (!this.collections.has(reference.collectionName)) {
            this.collections.set(reference.collectionName, new Map());
        }
        this.collections.get(reference.collectionName).set(reference.id, clone(value));
    }

    runTransaction(callback) {
        const execute = async () => {
            const transaction = new StrictTransaction(this);
            const result = await callback(transaction);
            transaction.commit();
            return result;
        };
        const result = this.transactionTail.then(execute, execute);
        this.transactionTail = result.catch(() => undefined);
        return result;
    }

    documents(collectionName) {
        return [...(this.collections.get(collectionName)?.values() || [])].map(clone);
    }
}

const createInput = {
    flow_id: 'synchintro_progressive',
    identity: {
        email: 'Buyer@Example.com',
        provider: 'email',
        first_name: 'Test',
        last_name: 'Buyer'
    },
    timezone: 'America/New_York',
    attribution: {
        utm_source: 'sandbox',
        utm_campaign: 'booking-proof'
    }
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
    verified_at: '2026-09-05T12:00:00.000Z'
};

const qualification = {
    goal: 'Generate more qualified leads',
    category: 'Professional Services',
    team_size: '2–10'
};

const slot = {
    id: 'slot_20260908_0900',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T13:30:00.000Z',
    timezone: 'America/New_York'
};

const confirmedResult = {
    booking_id: '842becf5-eab6-4cb9-87ca-5638c31ba56e',
    event_id: 'abpo51c4pkks5tv31m0bcstbdk',
    status: 'confirmed',
    title: 'SynchIntro Strategy Call',
    organizer_email: 'hello@pathsynch.com',
    attendee_emails: ['buyer@example.com'],
    start: slot.start,
    end: slot.end,
    timezone: slot.timezone,
    duration_minutes: 30
};

describe('SynchIntro booking persistence', () => {
    let firestore;
    let clock;
    let sequence;
    let persistence;

    beforeEach(() => {
        firestore = new StrictFirestore();
        clock = new Date('2026-09-05T14:00:00.000Z');
        sequence = 0;
        persistence = createBookingPersistence({
            db: firestore,
            now: () => new Date(clock.getTime()),
            timestampFromDate: (date) => new Date(date.getTime()),
            idGenerator: (prefix) => `${prefix}_${++sequence}`,
            claimTokenGenerator: () => `claim_token_${++sequence}_abcdefghijklmnopqrstuvwxyz`,
            sessionTokenGenerator: () => 'S'.repeat(43)
        });
    });

    async function createReadySession() {
        const session = await persistence.createSession(createInput);
        const updated = await persistence.updateSession(session.session_id, 1, {
            company,
            qualification,
            routing_state: {
                owner_id: 'hello_pathsynch',
                source: 'sandbox_configuration',
                rule_version: 'booking-routing-v1'
            }
        });
        const receipt = await persistence.createAvailabilityReceipt({
            session_id: session.session_id,
            session_version: updated.session_version,
            timezone: updated.timezone,
            slots: [slot],
            provider_reference: {
                provider: 'nylas',
                configuration_id: 'deee6623-a154-4a86-9085-163aa0e58a67'
            }
        });
        return { session: updated, receipt };
    }

    function claimInput(ready, overrides = {}) {
        return Object.assign({
            idempotency_key: 'booking_key_1234567890',
            request_fingerprint: bookingRequestFingerprint({
                session_version: ready.session.session_version,
                slot: ready.receipt.slots[0]
            }),
            session_id: ready.session.session_id,
            session_version: ready.session.session_version,
            slot: ready.receipt.slots[0],
            attendee_emails: [ready.session.identity.email],
            provider_reference: ready.receipt.provider_reference
        }, overrides);
    }

    describe('booking sessions', () => {
        test('returns a capability once and stores only its digest', async () => {
            const created = await persistence.createSessionWithCapability(createInput);
            const stored = firestore.documents(COLLECTIONS.SESSIONS)[0];

            expect(created.session_token).toBe('S'.repeat(43));
            expect(created.session).not.toHaveProperty('session_token_digest');
            expect(stored.session_token_digest).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(stored)).not.toContain(created.session_token);
            await expect(persistence.authorizeSessionCapability(
                created.session.session_id,
                created.session_token
            )).resolves.toMatchObject({ session_id: created.session.session_id });
        });

        test('rejects missing and incorrect capabilities without exposing stored data', async () => {
            const created = await persistence.createSessionWithCapability(createInput);

            await expect(persistence.authorizeSessionCapability(created.session.session_id, ''))
                .rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
            await expect(persistence.authorizeSessionCapability(created.session.session_id, 'W'.repeat(43)))
                .rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
        });

        test('rejects a capability after its session expires', async () => {
            const created = await persistence.createSessionWithCapability(createInput);
            clock = new Date(clock.getTime() + RETENTION_MS.SESSION);

            await expect(persistence.authorizeSessionCapability(
                created.session.session_id,
                'W'.repeat(43)
            )).rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
            await expect(persistence.authorizeSessionCapability(
                created.session.session_id,
                created.session_token
            )).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('creates optional company and qualification context atomically', async () => {
            const created = await persistence.createSessionWithCapability(Object.assign({}, createInput, {
                company,
                qualification
            }));

            expect(created.session).toMatchObject({
                session_version: 1,
                company,
                qualification
            });
        });

        test('rejects client-owned authority fields before writing', async () => {
            await expect(persistence.createSessionWithCapability(Object.assign({}, createInput, {
                provider_id: 'client-selected-provider'
            }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
            expect(firestore.documents(COLLECTIONS.SESSIONS)).toHaveLength(0);
        });

        test('allow-lists attribution and strips PII-like values', async () => {
            const created = await persistence.createSessionWithCapability(Object.assign({}, createInput, {
                attribution: {
                    utm_source: 'safe-source',
                    utm_campaign: 'buyer@example.com',
                    untrusted_owner: 'hello_pathsynch'
                }
            }));

            expect(created.session.attribution).toEqual({ utm_source: 'safe-source' });
        });

        test('creates and reads a minimized, opaque, expiring session', async () => {
            const created = await persistence.createSession(createInput);
            const read = await persistence.readSession(created.session_id);

            expect(read).toMatchObject({
                session_id: 'bks_1',
                session_version: 1,
                availability_version: 0,
                status: 'ACTIVE',
                identity: { email: 'buyer@example.com', provider: 'email' },
                timezone: 'America/New_York',
                company: null,
                qualification: null
            });
            expect(read.expires_at.getTime() - read.created_at.getTime()).toBe(RETENTION_MS.SESSION);
        });

        test('applies an optimistic versioned update', async () => {
            const created = await persistence.createSession(createInput);
            const updated = await persistence.updateSession(created.session_id, 1, {
                company,
                qualification,
                routing_state: {
                    owner_id: 'owner_1',
                    source: 'qualification_rule',
                    rule_version: 'booking-routing-v1'
                }
            });

            expect(updated.session_version).toBe(2);
            expect(updated.company.domain).toBe('example.com');
            expect(updated.routing_state).toEqual({
                owner_id: 'owner_1',
                source: 'qualification_rule',
                rule_version: 'booking-routing-v1'
            });
        });

        test('rejects a stale session version', async () => {
            const created = await persistence.createSession(createInput);
            await persistence.updateSession(created.session_id, 1, { company, qualification });

            await expect(persistence.updateSession(created.session_id, 1, { company, qualification }))
                .rejects.toMatchObject({
                    code: 'CONFLICT',
                    message: 'Booking session version is stale',
                    details: { reason: 'stale_session_version' }
                });
        });

        test('rejects an expired session', async () => {
            const created = await persistence.createSession(createInput);
            clock = new Date(clock.getTime() + RETENTION_MS.SESSION);

            await expect(persistence.readSession(created.session_id))
                .rejects.toMatchObject({ code: 'EXPIRED' });
            await expect(persistence.readSession(created.session_id, { allowExpired: true }))
                .resolves.toMatchObject({ session_id: created.session_id });
        });
    });

    describe('availability receipts', () => {
        test('persists an empty availability receipt safely', async () => {
            const session = await persistence.createSession(createInput);
            const receipt = await persistence.createAvailabilityReceipt({
                session_id: session.session_id,
                session_version: session.session_version,
                timezone: session.timezone,
                slots: [],
                provider_reference: {
                    provider: 'nylas',
                    configuration_id: 'deee6623-a154-4a86-9085-163aa0e58a67'
                }
            });
            expect(receipt.slots).toEqual([]);
            expect(receipt.availability_version).toBe(1);
        });

        test('persists and validates the exact normalized slot issued', async () => {
            const ready = await createReadySession();
            const issued = await persistence.validateIssuedSlot({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                slot: ready.receipt.slots[0]
            });

            expect(issued).toEqual(Object.assign({}, slot, { availability_version: 1 }));
            expect(ready.receipt.expires_at.getTime() - ready.receipt.created_at.getTime())
                .toBe(RETENTION_MS.AVAILABILITY_RECEIPT);
        });

        test('rejects a receipt used with the wrong session', async () => {
            const ready = await createReadySession();
            const other = await persistence.createSession(createInput);

            await expect(persistence.validateIssuedSlot({
                session_id: other.session_id,
                session_version: other.session_version,
                slot: ready.receipt.slots[0]
            })).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('receipt') });
        });

        test('rejects a receipt after the session version changes', async () => {
            const ready = await createReadySession();
            const updated = await persistence.updateSession(ready.session.session_id, ready.session.session_version, {
                company,
                qualification
            });

            await expect(persistence.validateIssuedSlot({
                session_id: updated.session_id,
                session_version: updated.session_version,
                slot: ready.receipt.slots[0]
            })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('session version') });
        });

        test('rejects an expired receipt', async () => {
            const ready = await createReadySession();
            clock = new Date(clock.getTime() + RETENTION_MS.AVAILABILITY_RECEIPT);

            await expect(persistence.validateIssuedSlot({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                slot: ready.receipt.slots[0]
            })).rejects.toMatchObject({ code: 'EXPIRED', message: expect.stringContaining('receipt') });
        });

        test('rejects a superseded availability version', async () => {
            const ready = await createReadySession();
            await persistence.createAvailabilityReceipt({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                timezone: ready.session.timezone,
                slots: [Object.assign({}, slot, { id: 'slot_new' })]
            });

            await expect(persistence.validateIssuedSlot({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                slot: ready.receipt.slots[0]
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                message: expect.stringContaining('version is stale'),
                details: { reason: 'stale_availability' }
            });
        });

        test('rejects tampered slot times', async () => {
            const ready = await createReadySession();

            await expect(persistence.validateIssuedSlot({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                slot: Object.assign({}, ready.receipt.slots[0], { end: '2026-09-08T14:00:00.000Z' })
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                message: expect.stringContaining('not issued'),
                details: { reason: 'slot_not_issued' }
            });
        });

        test('rejects null slot timestamps instead of coercing them to the Unix epoch', async () => {
            const session = await persistence.createSession(createInput);

            await expect(persistence.createAvailabilityReceipt({
                session_id: session.session_id,
                session_version: session.session_version,
                timezone: session.timezone,
                slots: [Object.assign({}, slot, { start: null })]
            })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'slot.start is invalid' });
            expect(firestore.documents(COLLECTIONS.AVAILABILITY_RECEIPTS)).toHaveLength(0);
        });
    });

    describe('booking operation idempotency', () => {
        test('atomically gives only the first concurrent claimant provider-create authority', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const [first, second] = await Promise.all([
                persistence.claimBookingOperation(input),
                persistence.claimBookingOperation(input)
            ]);

            expect([first.action, second.action].sort()).toEqual(['create', 'in_progress']);
            expect([first, second].filter((result) => result.provider_create_authorized)).toHaveLength(1);
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(1);
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                selected_slot: ready.receipt.slots[0],
                attendee_emails: [ready.session.identity.email]
            });
        });

        test('serializes concurrent claims that use different idempotency keys', async () => {
            const ready = await createReadySession();
            const firstInput = claimInput(ready);
            const secondInput = claimInput(ready, { idempotency_key: 'booking_key_abcdefghij' });
            const results = await Promise.allSettled([
                persistence.claimBookingOperation(firstInput),
                persistence.claimBookingOperation(secondInput)
            ]);

            const winner = results.find((result) => result.status === 'fulfilled');
            const blocked = results.find((result) => result.status === 'rejected');
            expect(winner.value).toMatchObject({ action: 'create', provider_create_authorized: true });
            expect(blocked.reason).toMatchObject({
                code: 'CONFLICT',
                message: 'Booking session already has an active booking operation'
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(1);
            expect(firestore.documents(COLLECTIONS.SESSIONS)[0]).toMatchObject({
                booking_operation_id: winner.value.operation_id,
                booking_slot_id: ready.receipt.slots[0].id
            });
        });

        test('freezes session and availability mutations while a booking claim is active', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);

            await expect(persistence.updateSession(
                ready.session.session_id,
                ready.session.session_version,
                { company, qualification }
            )).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('active booking operation') });
            await expect(persistence.createAvailabilityReceipt({
                session_id: ready.session.session_id,
                session_version: ready.session.session_version,
                timezone: ready.session.timezone,
                slots: [Object.assign({}, slot, { id: 'slot_new' })]
            })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('active booking operation') });
            await expect(persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            })).resolves.toMatchObject({ state: OPERATION_STATES.PROVIDER_PENDING });
        });

        test('rejects a claim when a prior session mutation invalidated its receipt', async () => {
            const ready = await createReadySession();
            await persistence.updateSession(
                ready.session.session_id,
                ready.session.session_version,
                { company, qualification }
            );

            await expect(persistence.claimBookingOperation(claimInput(ready)))
                .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('session version') });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(0);
        });

        test('replays the confirmed normalized result for the same key and fingerprint', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });

            const replay = await persistence.claimBookingOperation(input);
            expect(replay).toEqual({
                action: 'replay',
                state: OPERATION_STATES.CONFIRMED,
                booking: confirmedResult
            });
        });

        test('replays a confirmed result after the short-lived session expires', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });
            clock = new Date(clock.getTime() + RETENTION_MS.SESSION);

            await expect(persistence.claimBookingOperation(input)).resolves.toMatchObject({
                action: 'replay',
                booking: confirmedResult
            });
        });

        test('rejects the same key with a different fingerprint', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            await persistence.claimBookingOperation(input);

            await expect(persistence.claimBookingOperation(Object.assign({}, input, {
                request_fingerprint: 'a'.repeat(64)
            }))).rejects.toMatchObject({
                code: 'CONFLICT',
                message: expect.stringContaining('different booking data'),
                details: { reason: 'idempotency_conflict' }
            });
        });

        test('binds the durable attendee snapshot to the idempotent request', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            await persistence.claimBookingOperation(input);

            await expect(persistence.claimBookingOperation(Object.assign({}, input, {
                attendee_emails: ['different@example.com']
            }))).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('different booking data') });
        });

        test('does not claim an operation for a tampered slot', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready, {
                slot: Object.assign({}, ready.receipt.slots[0], { end: '2026-09-08T14:00:00.000Z' })
            });

            await expect(persistence.claimBookingOperation(input))
                .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('not issued') });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(0);
        });

        test('does not claim a slot issued by another provider configuration', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready, {
                provider_reference: {
                    provider: 'nylas',
                    configuration_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                }
            });

            await expect(persistence.claimBookingOperation(input))
                .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('configuration') });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(0);
        });

        test('rejects reuse across sessions even when a supplied fingerprint matches', async () => {
            const first = await createReadySession();
            const input = claimInput(first);
            await persistence.claimBookingOperation(input);
            const second = await createReadySession();

            await expect(persistence.claimBookingOperation(claimInput(second, {
                idempotency_key: input.idempotency_key,
                request_fingerprint: input.request_fingerprint
            }))).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('different booking data') });
        });

        test('does not authorize a second create while provider outcome is pending', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });

            await expect(persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.claimBookingOperation(input)).resolves.toMatchObject({
                action: 'in_progress',
                state: OPERATION_STATES.PROVIDER_PENDING,
                provider_create_authorized: false
            });
        });

        test('durably records normalized provider identifiers while preserving the pending fence', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });

            await expect(persistence.recordProviderIdentifiers({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id
            })).resolves.toMatchObject({
                state: OPERATION_STATES.PROVIDER_PENDING,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id
            });
            await expect(persistence.claimBookingOperation(input)).resolves.toMatchObject({
                action: 'in_progress',
                provider_create_authorized: false
            });
        });

        test('fences and safely resumes a CLAIMED operation only after its lease expires', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const first = await persistence.claimBookingOperation(input);

            await expect(persistence.claimBookingOperation(input)).resolves.toMatchObject({
                action: 'in_progress',
                provider_create_authorized: false
            });
            clock = new Date(clock.getTime() + OPERATION_LEASE_MS);
            const resumed = await persistence.claimBookingOperation(input);
            expect(resumed).toMatchObject({ action: 'resume', provider_create_authorized: true });
            await expect(persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: first.claim_token
            })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('another execution') });
            await expect(persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: resumed.claim_token
            })).resolves.toMatchObject({ state: OPERATION_STATES.PROVIDER_PENDING });
        });

        test('does not resume an expired session even when its CLAIMED lease elapsed', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            await persistence.claimBookingOperation(input);
            clock = new Date(clock.getTime() + RETENTION_MS.SESSION);

            await expect(persistence.claimBookingOperation(input))
                .rejects.toMatchObject({ code: 'EXPIRED', message: expect.stringContaining('session') });
        });

        test('fails closed and requires reconciliation for an unknown provider outcome', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.markBookingOutcomeUnknown({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'verification_timeout',
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id
            });

            await expect(persistence.claimBookingOperation(input)).resolves.toEqual({
                action: 'reconcile',
                state: OPERATION_STATES.OUTCOME_UNKNOWN,
                provider_create_authorized: false
            });
            await expect(persistence.readBookingOperation(input.idempotency_key)).resolves.toMatchObject({
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                selected_slot: ready.receipt.slots[0],
                attendee_emails: [ready.session.identity.email],
                reconciliation_required: true
            });
        });

        test('keeps verification inputs durable after the session and receipt expire', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.markBookingOutcomeUnknown({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'verification_timeout'
            });
            clock = new Date(clock.getTime() + RETENTION_MS.SESSION);

            const reconciliation = await persistence.claimBookingReconciliation(input.idempotency_key);
            expect(reconciliation).toMatchObject({
                action: 'reconcile',
                reconciliation_authorized: true,
                operation: {
                    selected_slot: ready.receipt.slots[0],
                    attendee_emails: [ready.session.identity.email]
                }
            });
        });

        test('releases a failed reservation and marks a confirmed session booked', async () => {
            const firstReady = await createReadySession();
            const firstInput = claimInput(firstReady);
            const firstClaim = await persistence.claimBookingOperation(firstInput);
            await persistence.markBookingFailed({
                idempotency_key: firstInput.idempotency_key,
                claim_token: firstClaim.claim_token,
                failure_code: 'provider_rejected'
            });
            await expect(persistence.claimBookingOperation(claimInput(firstReady, {
                idempotency_key: 'booking_key_retry_12345'
            }))).resolves.toMatchObject({ action: 'create', provider_create_authorized: true });

            const secondReady = await createReadySession();
            const secondInput = claimInput(secondReady, { idempotency_key: 'booking_key_confirm_123' });
            const secondClaim = await persistence.claimBookingOperation(secondInput);
            await persistence.beginProviderAttempt({
                idempotency_key: secondInput.idempotency_key,
                claim_token: secondClaim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: secondInput.idempotency_key,
                claim_token: secondClaim.claim_token,
                confirmed_result: confirmedResult
            });

            await expect(persistence.readSession(secondReady.session.session_id))
                .resolves.toMatchObject({ status: 'BOOKED' });
            await expect(persistence.claimBookingOperation(claimInput(secondReady, {
                idempotency_key: 'booking_key_duplicate_1'
            }))).rejects.toMatchObject({ code: 'CONFLICT', message: 'Booking session is not active' });
        });

        test('rejects null confirmation timestamps without mutating the operation', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });

            await expect(persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: Object.assign({}, confirmedResult, { start: null })
            })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'confirmed_result.start is invalid' });
            await expect(persistence.readBookingOperation(input.idempotency_key))
                .resolves.toMatchObject({ state: OPERATION_STATES.PROVIDER_PENDING });
        });

        test.each([
            ['a different slot', { start: '2026-09-08T14:00:00.000Z', end: '2026-09-08T14:30:00.000Z' }],
            ['a different timezone', { timezone: 'America/Chicago' }],
            ['different attendees', { attendee_emails: ['different@example.com'] }]
        ])('rejects confirmation for %s', async (_label, changes) => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });

            await expect(persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: Object.assign({}, confirmedResult, changes)
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                message: 'Confirmed booking does not match the claimed operation'
            });
            await expect(persistence.readBookingOperation(input.idempotency_key))
                .resolves.toMatchObject({ state: OPERATION_STATES.PROVIDER_PENDING });
        });

        test('rejects a non-confirmed provider status', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });

            await expect(persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: Object.assign({}, confirmedResult, { status: 'cancelled' })
            })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'confirmed_result.status is invalid' });
            await expect(persistence.readBookingOperation(input.idempotency_key))
                .resolves.toMatchObject({ state: OPERATION_STATES.PROVIDER_PENDING });
        });

        test('serializes reconciliation claims and permits verification without another create', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            clock = new Date(clock.getTime() + OPERATION_LEASE_MS);

            const [first, second] = await Promise.all([
                persistence.claimBookingReconciliation(input.idempotency_key),
                persistence.claimBookingReconciliation(input.idempotency_key)
            ]);
            const winner = [first, second].find((result) => result.reconciliation_authorized);
            expect([first.action, second.action].sort()).toEqual(['in_progress', 'reconcile']);
            expect(winner).toMatchObject({
                provider_create_authorized: false,
                reconciliation_authorized: true
            });
            await expect(persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: winner.claim_token,
                confirmed_result: confirmedResult
            })).resolves.toMatchObject({
                state: OPERATION_STATES.CONFIRMED,
                confirmed_result: confirmedResult
            });
        });

        test('makes operation retention expiry deterministic and does not restart it', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            await persistence.claimBookingOperation(input);
            clock = new Date(clock.getTime() + RETENTION_MS.BOOKING_OPERATION);

            await expect(persistence.readBookingOperation(input.idempotency_key))
                .rejects.toMatchObject({ code: 'EXPIRED', message: expect.stringContaining('retention window') });
        });

        test('stores only key/token digests and never their raw values', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            const stored = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];

            expect(stored.idempotency_key_digest).toMatch(/^[a-f0-9]{64}$/);
            expect(stored.claim_token_digest).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(stored)).not.toContain(input.idempotency_key);
            expect(JSON.stringify(stored)).not.toContain(claim.claim_token);
            expect(JSON.stringify(firestore.documents(COLLECTIONS.SESSIONS)[0]))
                .not.toContain(input.idempotency_key);
            expect(await persistence.readBookingOperation(input.idempotency_key))
                .not.toHaveProperty('claim_token_digest');
        });
    });

    describe('security and failure behavior', () => {
        test('rejects unsafe IDs and secret-bearing fields without persisting them', async () => {
            await expect(persistence.createSession(Object.assign({}, createInput, {
                api_key: 'must-not-be-stored'
            }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
            expect(firestore.documents(COLLECTIONS.SESSIONS)).toHaveLength(0);

            await expect(persistence.readSession('../unsafe/path'))
                .rejects.toMatchObject({ code: 'INVALID_INPUT' });
        });

        test('does not log stored data or rejected secret values', async () => {
            const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

            await expect(persistence.createSession(Object.assign({}, createInput, {
                oauth_secret: 'never-log-this-value'
            }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });

            expect(log).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        });

        test('sanitizes Firestore failures into an ApiError without raw details', async () => {
            const broken = createBookingPersistence({
                db: {
                    collection: () => ({ doc: () => ({ set: async () => { throw new Error('credential=secret'); } }) })
                },
                now: () => clock,
                timestampFromDate: (date) => date,
                idGenerator: () => 'bks_safe'
            });

            await expect(broken.createSession(createInput)).rejects.toMatchObject({
                code: 'DATABASE_ERROR',
                message: 'Booking persistence is temporarily unavailable',
                details: null
            });
        });
    });
});
