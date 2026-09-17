'use strict';

const {
    COLLECTIONS,
    OPERATION_STATES,
    OPERATION_LEASE_MS,
    CONFIRMATION_DELIVERY_LEASE_MS,
    MAX_CONFIRMATION_DELIVERY_ATTEMPTS,
    CONFIRMATION_DELIVERY_STATES,
    RETENTION_MS,
    createBookingPersistence
} = require('../../services/booking/bookingPersistence');
const { bookingRequestFingerprint } = require('../../services/booking/bookingContract');
const { createBookingOrchestrator } = require('../../services/booking/bookingOrchestrator');
const { createNylasSchedulingProvider } = require('../../services/booking/nylasSchedulingProvider');
const { createBookingCancellationService } = require('../../services/booking/bookingCancellation');
const { NylasHttpError, ERROR_CATEGORIES } = require('../../services/booking/nylasHttpClient');

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

const serverContext = Object.freeze({
    timezone: 'America/New_York',
    routing_state: Object.freeze({
        owner_id: 'charles_berry_uid',
        workspace_id: 'pathsynch_workspace',
        source: 'qualification_rule',
        route_key: 'local_growth',
        rule_version: 'booking-routing-v1'
    }),
    specialist: Object.freeze({
        id: 'spc_charles_fixture',
        display_name: 'Charles Berry',
        title: 'Founder & CEO',
        avatar_url: null,
        initials: 'CB',
        timezone: 'America/New_York'
    })
});

const slot = {
    id: 'slot_20260908_0900',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T13:30:00.000Z',
    timezone: 'America/New_York'
};

const LARGE_AVAILABILITY_START_SECONDS = 1788739200;
const LARGE_AVAILABILITY_WINDOW = Object.freeze({
    start: '2026-09-07T00:00:00.000Z',
    end: '2026-09-13T00:00:00.000Z'
});

function normalizedAvailabilitySlots(count) {
    return Array.from({ length: count }, (_value, index) => {
        const startTime = LARGE_AVAILABILITY_START_SECONDS + (index * 15 * 60);
        return {
            id: `nyl_${String(index).padStart(32, '0')}`,
            start: new Date(startTime * 1000).toISOString(),
            end: new Date((startTime + (30 * 60)) * 1000).toISOString(),
            timezone: 'America/New_York'
        };
    });
}

function providerAvailabilitySlots(count) {
    return Array.from({ length: count }, (_value, index) => {
        const startTime = LARGE_AVAILABILITY_START_SECONDS + (index * 15 * 60);
        return {
            emails: ['organizer@example.invalid'],
            start_time: startTime,
            end_time: startTime + (30 * 60)
        };
    });
}

function nylasResponse(payload) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        text: async () => JSON.stringify(payload)
    };
}

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
        const created = await persistence.createSessionWithCapability(createInput, serverContext);
        const session = created.session;
        const updated = await persistence.updateSession(session.session_id, 1, {
            company,
            qualification
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
            confirmation_identity: ready.session.identity,
            specialist: ready.session.specialist,
            provider_reference: ready.receipt.provider_reference,
            minimum_notice_minutes: 0
        }, overrides);
    }

    async function createConfirmedBooking() {
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
        return { ready, input, capability: 'S'.repeat(43) };
    }

    describe('booking sessions', () => {
        test('returns a capability once and stores only its digest', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            const stored = firestore.documents(COLLECTIONS.SESSIONS)[0];

            expect(created.session_token).toBe('S'.repeat(43));
            expect(created.session).not.toHaveProperty('session_token_digest');
            expect(created.session).toMatchObject({ company: null, qualification: null });
            expect(Object.values(stored)).not.toContain(undefined);
            expect(stored.session_token_digest).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(stored)).not.toContain(created.session_token);
            await expect(persistence.authorizeSessionCapability(
                created.session.session_id,
                created.session_token
            )).resolves.toMatchObject({ session_id: created.session.session_id });
        });

        test('rejects missing and incorrect capabilities without exposing stored data', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);

            await expect(persistence.authorizeSessionCapability(created.session.session_id, ''))
                .rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
            await expect(persistence.authorizeSessionCapability(created.session.session_id, 'W'.repeat(43)))
                .rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
        });

        test('rejects a capability after its session expires', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
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

        test('authorizes an exact confirmed replay after the session document is deleted', async () => {
            const created = await persistence.createSessionWithCapability(Object.assign({}, createInput, {
                company,
                qualification
            }), serverContext);
            const session = created.session;
            const receipt = await persistence.createAvailabilityReceipt({
                session_id: session.session_id,
                session_version: session.session_version,
                timezone: session.timezone,
                slots: [slot],
                provider_reference: {
                    provider: 'nylas',
                    configuration_id: 'deee6623-a154-4a86-9085-163aa0e58a67'
                }
            });
            const ready = { session, receipt };
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

            await expect(persistence.authorizeBookingCapability(
                session.session_id,
                input.idempotency_key,
                created.session_token
            )).resolves.toMatchObject({ session_id: session.session_id, status: 'BOOKED' });

            const storedOperation = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            expect(storedOperation.session_token_digest).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(storedOperation)).not.toContain(created.session_token);
            firestore.collections.get(COLLECTIONS.SESSIONS).delete(session.session_id);

            await expect(persistence.authorizeBookingCapability(
                session.session_id,
                input.idempotency_key,
                created.session_token
            )).resolves.toMatchObject({ session_id: session.session_id });
            await expect(persistence.authorizeBookingCapability(
                session.session_id,
                input.idempotency_key,
                'W'.repeat(43)
            )).rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
            await expect(persistence.readBookingOperation(input.idempotency_key))
                .resolves.not.toHaveProperty('session_token_digest');
        });

        test('creates optional company and qualification context atomically', async () => {
            const created = await persistence.createSessionWithCapability(Object.assign({}, createInput, {
                company,
                qualification
            }), serverContext);

            expect(created.session).toMatchObject({
                session_version: 1,
                company,
                qualification
            });
        });

        test('rejects client-owned authority fields before writing', async () => {
            await expect(persistence.createSessionWithCapability(Object.assign({}, createInput, {
                provider_id: 'client-selected-provider'
            }), serverContext)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
            expect(firestore.documents(COLLECTIONS.SESSIONS)).toHaveLength(0);
        });

        test('allow-lists attribution and strips PII-like values', async () => {
            const created = await persistence.createSessionWithCapability(Object.assign({}, createInput, {
                attribution: {
                    utm_source: 'safe-source',
                    utm_campaign: 'buyer@example.com',
                    untrusted_owner: 'hello_pathsynch'
                }
            }), serverContext);

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
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            const updated = await persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: {
                    owner_id: serverContext.routing_state.owner_id,
                    workspace_id: serverContext.routing_state.workspace_id,
                    source: 'fallback',
                    route_key: null,
                    rule_version: 'booking-routing-v2'
                }
            });

            expect(updated.session_version).toBe(2);
            expect(updated.company.domain).toBe('example.com');
            expect(updated.routing_state).toEqual({
                owner_id: serverContext.routing_state.owner_id,
                workspace_id: serverContext.routing_state.workspace_id,
                source: 'fallback',
                route_key: null,
                rule_version: 'booking-routing-v2'
            });
        });

        test('preserves authoritative routing when routing is omitted', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);

            const updated = await persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification
            });

            expect(updated.routing_state).toEqual(serverContext.routing_state);
        });

        test('preserves the routed specialist receipt when routing is omitted', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);

            const updated = await persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification
            });

            expect(updated.specialist).toEqual(serverContext.specialist);
        });

        test('rejects an explicit routing clear', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            await expect(persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: null
            })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        });

        test('rejects a partial routing replacement without erasing stored authority', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            await expect(persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: { owner_id: serverContext.routing_state.owner_id }
            })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
            await expect(persistence.readSession(created.session.session_id))
                .resolves.toMatchObject({ routing_state: serverContext.routing_state });
        });

        test('rejects stale routing input after a newer route was accepted', async () => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            await persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: Object.assign({}, serverContext.routing_state, {
                    source: 'fallback', route_key: null, rule_version: 'booking-routing-v2'
                })
            });
            await expect(persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: serverContext.routing_state
            })).rejects.toMatchObject({
                code: 'CONFLICT', details: { reason: 'stale_session_version' }
            });
        });

        test.each([
            ['host', { owner_id: 'different_owner' }],
            ['workspace', { workspace_id: 'different_workspace' }]
        ])('rejects a %s mismatch in a routing replacement', async (_label, mismatch) => {
            const created = await persistence.createSessionWithCapability(createInput, serverContext);
            await expect(persistence.updateSession(created.session.session_id, 1, {
                company,
                qualification,
                routing_state: Object.assign({}, serverContext.routing_state, mismatch)
            })).rejects.toMatchObject({
                code: 'CONFLICT', details: { reason: 'booking_routing_authority_mismatch' }
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

        test.each([319, 512])('persists and binds all %i normalized availability slots', async (count) => {
            const session = await persistence.createSession(createInput);
            const slots = normalizedAvailabilitySlots(count);
            const receipt = await persistence.createAvailabilityReceipt({
                session_id: session.session_id,
                session_version: session.session_version,
                timezone: session.timezone,
                slots,
                provider_reference: {
                    provider: 'nylas',
                    configuration_id: 'deee6623-a154-4a86-9085-163aa0e58a67'
                }
            });

            expect(receipt.slots).toHaveLength(count);
            expect(receipt.slots[count - 1]).toEqual(Object.assign({}, slots[count - 1], {
                availability_version: 1
            }));
            await expect(persistence.validateIssuedSlot({
                session_id: session.session_id,
                session_version: session.session_version,
                slot: receipt.slots[count - 1]
            })).resolves.toEqual(receipt.slots[count - 1]);
            await expect(persistence.readSession(session.session_id)).resolves.toMatchObject({
                availability_version: 1
            });

            const stored = firestore.documents(COLLECTIONS.AVAILABILITY_RECEIPTS)[0];
            expect(stored.slots).toHaveLength(count);
            if (count === 512) {
                expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThan(1024 * 1024);
            }
        });

        test('rejects 513 availability slots without writing or advancing the session', async () => {
            const session = await persistence.createSession(createInput);

            await expect(persistence.createAvailabilityReceipt({
                session_id: session.session_id,
                session_version: session.session_version,
                timezone: session.timezone,
                slots: normalizedAvailabilitySlots(513),
                provider_reference: {
                    provider: 'nylas',
                    configuration_id: 'deee6623-a154-4a86-9085-163aa0e58a67'
                }
            })).rejects.toMatchObject({
                code: 'INVALID_INPUT',
                message: 'slots must contain between 0 and 512 entries'
            });

            expect(firestore.documents(COLLECTIONS.AVAILABILITY_RECEIPTS)).toHaveLength(0);
            await expect(persistence.readSession(session.session_id)).resolves.toMatchObject({
                availability_version: 0
            });
        });

        test('normalizes a 319-slot Nylas response through orchestration into one durable receipt', async () => {
            const session = await persistence.createSession(createInput);
            const fetchImpl = jest.fn().mockResolvedValue(nylasResponse({
                request_id: 'req_cross_layer_319',
                data: { time_slots: providerAvailabilitySlots(319) }
            }));
            const provider = createNylasSchedulingProvider({
                fetchImpl,
                config: {
                    apiKey: 'unit-test-key-never-log',
                    grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
                    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                    organizerEmail: 'organizer@example.invalid',
                    timezone: 'America/New_York',
                    durationMinutes: 30,
                    minimumNoticeMinutes: 0,
                    noticeSafetyMarginMinutes: 0,
                    title: 'SynchIntro Strategy Call',
                    calendarId: 'primary'
                }
            });
            const result = await createBookingOrchestrator({
                provider,
                persistence,
                now: () => new Date('2026-09-06T23:00:00.000Z')
            }).getAvailability({
                sessionId: session.session_id,
                start: LARGE_AVAILABILITY_WINDOW.start,
                end: LARGE_AVAILABILITY_WINDOW.end
            });

            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject({
                session_version: session.session_version,
                availability_version: 1,
                timezone: session.timezone
            });
            expect(result.slots).toHaveLength(81);
            expect(result.slots[80]).toEqual(expect.objectContaining({
                id: expect.stringMatching(/^nyl_[a-f0-9]{32}$/),
                timezone: session.timezone,
                availability_version: 1
            }));
            const receipts = firestore.documents(COLLECTIONS.AVAILABILITY_RECEIPTS);
            expect(receipts).toHaveLength(1);
            expect(receipts[0].slots).toEqual(result.slots);
            expect(JSON.stringify(result)).not.toContain('organizer@example.invalid');
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
        test.each([
            ['more than 60 minutes', '2026-09-08T11:59:59.000Z'],
            ['exactly 60 minutes', '2026-09-08T12:00:00.000Z']
        ])('grants create authority when the slot is %s away', async (_label, at) => {
            clock = new Date(at);
            const ready = await createReadySession();

            await expect(persistence.claimBookingOperation(claimInput(ready, {
                minimum_notice_minutes: 60
            }))).resolves.toMatchObject({ action: 'create', provider_create_authorized: true });
        });

        test('rejects a slot 59:59 away before any operation and rejects the same retry identically', async () => {
            clock = new Date('2026-09-08T12:00:01.000Z');
            const ready = await createReadySession();
            const input = claimInput(ready, { minimum_notice_minutes: 60 });

            for (let attempt = 0; attempt < 2; attempt += 1) {
                await expect(persistence.claimBookingOperation(input)).rejects.toMatchObject({
                    code: 'CONFLICT',
                    status: 409,
                    details: { reason: 'slot_minimum_notice_elapsed' }
                });
            }
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(0);
            expect(firestore.documents(COLLECTIONS.SESSIONS)[0]).toMatchObject({
                booking_operation_id: null,
                booking_slot_id: null
            });
        });

        test('prevents a safely issued slot from obtaining create authority after it ages inside 60 minutes', async () => {
            clock = new Date('2026-09-08T11:54:00.000Z');
            const createdSession = (await persistence.createSessionWithCapability(createInput, serverContext)).session;
            const provider = {
                name: 'nylas',
                configured: true,
                configuration: {
                    grantId: '6bdacd32-9d31-442e-ab19-100e5dec2b24',
                    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                    organizerEmail: 'hello@pathsynch.com',
                    timezone: 'America/New_York',
                    durationMinutes: 30,
                    minimumNoticeMinutes: 60,
                    noticeSafetyMarginMinutes: 5,
                    title: 'SynchIntro Strategy Call',
                    calendarId: 'primary'
                },
                getAvailability: jest.fn().mockResolvedValue([slot]),
                assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true }),
                createBooking: jest.fn(),
                getBooking: jest.fn(),
                getEvent: jest.fn(),
                rescheduleBooking: jest.fn(),
                cancelBooking: jest.fn(),
                verifyWebhook: jest.fn()
            };
            const service = createBookingOrchestrator({
                provider,
                persistence,
                now: () => new Date(clock.getTime())
            });
            const availability = await service.getAvailability({
                sessionId: createdSession.session_id,
                start: '2026-09-08T11:54:00.000Z',
                end: '2026-09-09T00:00:00.000Z'
            });
            expect(availability.slots).toHaveLength(1);

            clock = new Date('2026-09-08T12:00:01.000Z');
            await expect(service.createBooking({
                sessionId: createdSession.session_id,
                idempotencyKey: 'booking_key_notice_toctou',
                request: {
                    session_version: createdSession.session_version,
                    slot: availability.slots[0],
                    guests: []
                }
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'slot_minimum_notice_elapsed' }
            });

            expect(provider.createBooking).not.toHaveBeenCalled();
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)).toHaveLength(0);
        });

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
            expect(replay).toMatchObject({
                action: 'replay',
                state: OPERATION_STATES.CONFIRMED,
                booking: confirmedResult,
                operation: {
                    confirmation_identity: {
                        first_name: 'Test', last_name: 'Buyer', email: 'buyer@example.com'
                    },
                    specialist: serverContext.specialist
                }
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

        test('grants confirmation email delivery authority only once', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });

            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            expect(delivery).toMatchObject({
                action: 'prepare', delivery_authorized: false, delivery_prepare_authorized: true
            });
            expect(delivery.delivery_token).not.toBeFalsy();
            expect(JSON.stringify(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]))
                .not.toContain(delivery.delivery_token);
            const authorization = await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            expect(authorization).toMatchObject({
                action: 'send', delivery_authorized: true,
                confirmation_delivery_id: delivery.confirmation_delivery_id,
                delivery_attempt_id: delivery.delivery_attempt_id
            });

            await persistence.markConfirmationDeliverySent({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                provider_message_id: 'sendgrid_message_1'
            });
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toEqual({ action: 'already_sent', delivery_authorized: false });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                confirmation_delivery_attempt_count: 1,
                delivery_attempt_id: delivery.delivery_attempt_id,
                delivery_provider_message_id: 'sendgrid_message_1'
            });
        });

        test('preserves legacy delivery classification when old operations lack confirmation context', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const [operationId] = operations.keys();
            const legacyOperation = operations.get(operationId);
            delete legacyOperation.confirmation_identity;
            delete legacyOperation.specialist;
            delete legacyOperation.confirmation_delivery_state;
            operations.set(operationId, legacyOperation);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });

            await expect(persistence.readBookingOperation(input.idempotency_key))
                .resolves.toMatchObject({
                    state: OPERATION_STATES.CONFIRMED,
                    confirmation_delivery_state: null
                });
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toEqual({ action: 'legacy', delivery_authorized: false });
        });

        test('marks an ambiguous confirmation send without granting retry authority', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            await persistence.markConfirmationDeliveryOutcomeUnknown({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token
            });
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toMatchObject({
                    action: 'reconcile',
                    delivery_authorized: false,
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                });
        });

        test('moves an interrupted stale SENDING delivery to explicit reconciliation without resending', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);

            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toMatchObject({
                    action: 'reconcile',
                    delivery_authorized: false,
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    delivery_attempt_id: delivery.delivery_attempt_id
                });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0])
                .toMatchObject({
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    delivery_reconciliation_required: true
                });
        });

        test('adopts a blocked-head SENDING record into reconciliation with stable legacy identity', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token
            });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key,
                claim_token: claim.claim_token,
                confirmed_result: confirmedResult
            });
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const [operationId] = operations.keys();
            const blockedHeadRecord = operations.get(operationId);
            blockedHeadRecord.confirmation_delivery_state = 'SENDING';
            delete blockedHeadRecord.confirmation_delivery_id;
            delete blockedHeadRecord.confirmation_delivery_attempt_count;
            delete blockedHeadRecord.delivery_attempt_id;
            delete blockedHeadRecord.delivery_lease_expires_at;
            operations.set(operationId, blockedHeadRecord);

            const first = await persistence.claimConfirmationDelivery(input.idempotency_key);
            const second = await persistence.claimConfirmationDelivery(input.idempotency_key);

            expect(first).toMatchObject({
                action: 'reconcile',
                delivery_authorized: false,
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
            });
            expect(first.confirmation_delivery_id).toMatch(/^cnf_[a-f0-9]{64}$/);
            expect(first.delivery_attempt_id).toMatch(/^dla_legacy_[a-f0-9]{64}$/);
            expect(second).toMatchObject({
                action: 'reconcile',
                confirmation_delivery_id: first.confirmation_delivery_id,
                delivery_attempt_id: first.delivery_attempt_id
            });
        });

        test('finishes stale SENDING reconciliation only from exact definitive provider evidence', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
            await persistence.claimConfirmationDelivery(input.idempotency_key);

            await expect(persistence.reconcileConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_attempt_id: delivery.delivery_attempt_id,
                provider_message_id: 'sendgrid_message_reconciled_1',
                reconciliation_evidence_id: 'provider_receipt_1',
                outcome: 'ACCEPTED'
            })).resolves.toMatchObject({
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                delivery_provider_message_id: 'sendgrid_message_reconciled_1',
                delivery_reconciliation_evidence_id: 'provider_receipt_1',
                delivery_reconciliation_required: false
            });
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toEqual({ action: 'already_sent', delivery_authorized: false });
        });

        test('keeps an ambiguous reconciliation fail-closed without granting another send', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            await persistence.markConfirmationDeliveryOutcomeUnknown({
                idempotency_key: input.idempotency_key, delivery_token: delivery.delivery_token
            });

            await expect(persistence.reconcileConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_attempt_id: delivery.delivery_attempt_id,
                provider_message_id: 'sendgrid_message_unknown_1',
                reconciliation_evidence_id: 'provider_receipt_unknown_1',
                outcome: 'UNKNOWN'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toMatchObject({ action: 'reconcile', delivery_authorized: false });
        });

        test('recovers an expired pre-egress claim and fences the stale worker', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const first = await persistence.claimConfirmationDelivery(input.idempotency_key);
            clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
            const recovered = await persistence.claimConfirmationDelivery(input.idempotency_key);

            expect(recovered).toMatchObject({
                action: 'prepare', delivery_prepare_authorized: true, delivery_authorized: false
            });
            expect(recovered.delivery_attempt_id).not.toBe(first.delivery_attempt_id);
            await expect(persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: first.delivery_token,
                delivery_attempt_id: first.delivery_attempt_id
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: recovered.delivery_token,
                delivery_attempt_id: recovered.delivery_attempt_id
            })).resolves.toMatchObject({ action: 'send', delivery_authorized: true });
        });

        test('bounds recoverable pre-egress claims before requiring reconciliation', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            for (let attempt = 0; attempt < MAX_CONFIRMATION_DELIVERY_ATTEMPTS; attempt += 1) {
                const result = await persistence.claimConfirmationDelivery(input.idempotency_key);
                expect(result.action).toBe('prepare');
                clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
            }
            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .resolves.toMatchObject({
                    action: 'reconcile',
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                });
        });

        test('a stale delivery worker cannot overwrite a newer SENT state', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            await persistence.markConfirmationDeliverySent({
                idempotency_key: input.idempotency_key, delivery_token: delivery.delivery_token
            });
            await expect(persistence.markConfirmationDeliveryOutcomeUnknown({
                idempotency_key: input.idempotency_key, delivery_token: delivery.delivery_token
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0])
                .toMatchObject({ confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT });
        });

        test('confirmation recovery preserves the confirmed booking idempotency result', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const delivery = await persistence.claimConfirmationDelivery(input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
            await persistence.claimConfirmationDelivery(input.idempotency_key);

            await expect(persistence.claimBookingOperation(input)).resolves.toMatchObject({
                action: 'replay', state: OPERATION_STATES.CONFIRMED, booking: confirmedResult
            });
        });

        test('rejects malformed confirmation state without authorizing egress', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            const claim = await persistence.claimBookingOperation(input);
            await persistence.beginProviderAttempt({ idempotency_key: input.idempotency_key, claim_token: claim.claim_token });
            await persistence.confirmBookingOperation({
                idempotency_key: input.idempotency_key, claim_token: claim.claim_token, confirmed_result: confirmedResult
            });
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const [operationId] = operations.keys();
            operations.get(operationId).confirmation_delivery_state = 'CORRUPT';

            await expect(persistence.claimConfirmationDelivery(input.idempotency_key))
                .rejects.toMatchObject({ code: 'CONFLICT' });
        });

        test('suppresses original confirmation delivery when governed recovery owns the record', async () => {
            const confirmed = await createConfirmedBooking();
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const [operationId] = operations.keys();
            operations.get(operationId).synthetic_recovery_state = 'RECONCILIATION_REQUIRED';

            await expect(persistence.claimConfirmationDelivery(confirmed.input.idempotency_key))
                .resolves.toMatchObject({
                    action: 'suppressed_by_recovery',
                    delivery_authorized: false
                });
        });

        test('revokes a claimed original confirmation when governed recovery wins before egress', async () => {
            const confirmed = await createConfirmedBooking();
            const delivery = await persistence.claimConfirmationDelivery(confirmed.input.idempotency_key);
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const [operationId] = operations.keys();
            operations.get(operationId).synthetic_recovery_state = 'PROVIDER_ATTEMPTING';

            await expect(persistence.beginConfirmationDelivery({
                idempotency_key: confirmed.input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            })).resolves.toMatchObject({
                action: 'suppressed_by_recovery',
                delivery_authorized: false
            });
        });
    });

    describe('booking cancellation lifecycle', () => {
        function cancellationInput(confirmed, overrides = {}) {
            return Object.assign({
                session_id: confirmed.ready.session.session_id,
                booking_idempotency_key: confirmed.input.idempotency_key,
                cancellation_idempotency_key: 'cancel_key_1234567890',
                capability: confirmed.capability
            }, overrides);
        }

        test('derives authority from the durable booking and rejects wrong session or capability', async () => {
            const confirmed = await createConfirmedBooking();
            await expect(persistence.authorizeCancellationCapability(
                confirmed.ready.session.session_id,
                confirmed.input.idempotency_key,
                confirmed.capability
            )).resolves.toMatchObject({ provider_booking_id: confirmedResult.booking_id });
            await expect(persistence.authorizeCancellationCapability(
                'bks_other_workspace',
                confirmed.input.idempotency_key,
                confirmed.capability
            )).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
            await expect(persistence.authorizeCancellationCapability(
                confirmed.ready.session.session_id,
                confirmed.input.idempotency_key,
                'W'.repeat(43)
            )).rejects.toMatchObject({ code: 'INVALID_SESSION_CAPABILITY' });
        });

        test('rejects a booking that has not reached the confirmed state', async () => {
            const ready = await createReadySession();
            const input = claimInput(ready);
            await persistence.claimBookingOperation(input);

            await expect(persistence.claimCancellationOperation({
                session_id: ready.session.session_id,
                booking_idempotency_key: input.idempotency_key,
                cancellation_idempotency_key: 'cancel_key_1234567890',
                capability: 'S'.repeat(43)
            })).rejects.toMatchObject({ code: 'CONFLICT', message: 'Booking is not cancellable' });
        });

        test('serializes concurrent cancellation claims and resumes only before provider egress', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const [first, second] = await Promise.all([
                persistence.claimCancellationOperation(input),
                persistence.claimCancellationOperation(input)
            ]);
            expect([first, second].filter((claim) => claim.cancellation_authorized)).toHaveLength(1);
            expect([first.action, second.action].sort()).toEqual(['cancel', 'in_progress']);

            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);
            const resumed = await persistence.claimCancellationOperation(input);
            expect(resumed).toMatchObject({ action: 'resume', cancellation_authorized: true });
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: resumed.claim_token
            });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'in_progress', cancellation_authorized: false
            });
            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);
            const stale = await persistence.claimCancellationOperation(input);
            expect(stale).toMatchObject({
                action: 'reconcile',
                cancellation_authorized: false,
                reconciliation_authorized: true,
                claim_token: expect.any(String),
                operation: {
                    cancellation_state: 'CANCELLATION_RECONCILIATION_REQUIRED',
                    cancellation_failure_code: 'booking.cancellation_stale_provider_attempt',
                    cancellation_reconciliation_required: true
                }
            });
            await expect(persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: resumed.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'stale_request'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
        });

        test('reconciles an expired provider attempt in the same replay without another DELETE', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);

            const cancellationProvider = {
                name: 'nylas',
                configured: true,
                configuration: {
                    calendarId: 'primary',
                    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                    organizerEmail: confirmedResult.organizer_email,
                    timezone: confirmedResult.timezone,
                    durationMinutes: confirmedResult.duration_minutes,
                    minimumNoticeMinutes: 0,
                    noticeSafetyMarginMinutes: 0,
                    title: confirmedResult.title
                },
                getAvailability: jest.fn(),
                assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true }),
                createBooking: jest.fn(),
                getBooking: jest.fn().mockRejectedValue(new NylasHttpError(
                    ERROR_CATEGORIES.REJECTED,
                    'get_booking',
                    { status: 404 }
                )),
                getEvent: jest.fn().mockResolvedValue({
                    event_id: confirmedResult.event_id,
                    title: confirmedResult.title,
                    status: 'cancelled',
                    organizer_email: confirmedResult.organizer_email,
                    participant_emails: confirmedResult.attendee_emails,
                    calendar_id: 'primary',
                    start: confirmedResult.start,
                    end: confirmedResult.end,
                    start_timezone: confirmedResult.timezone,
                    end_timezone: confirmedResult.timezone
                }),
                rescheduleBooking: jest.fn(),
                cancelBooking: jest.fn(),
                verifyWebhook: jest.fn()
            };
            const service = createBookingCancellationService({
                persistence,
                provider: cancellationProvider
            });

            await expect(service.cancelBooking({
                sessionId: input.session_id,
                bookingIdempotencyKey: input.booking_idempotency_key,
                cancellationIdempotencyKey: input.cancellation_idempotency_key,
                capability: input.capability
            })).resolves.toMatchObject({
                status: 'cancelled',
                communication_status: 'pending'
            });
            expect(cancellationProvider.getBooking).toHaveBeenCalledTimes(1);
            expect(cancellationProvider.getEvent).toHaveBeenCalledTimes(1);
            expect(cancellationProvider.cancelBooking).not.toHaveBeenCalled();
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                cancellation_state: 'CANCELLED',
                cancellation_attempt_count: 1,
                cancellation_reconciliation_attempt_count: 1,
                cancellation_reconciliation_required: false
            });
        });

        test('settles an authorized near-expiry cancellation without extending public management authority', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const beforeClaim = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            const originalExpiry = beforeClaim.expires_at;
            clock = new Date(originalExpiry.getTime() - 1);

            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });

            clock = new Date(originalExpiry.getTime() + 1);
            await expect(persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_near_expiry'
            })).resolves.toMatchObject({
                cancellation_state: 'CANCELLED',
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING
            });

            const stored = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            expect(stored.management_expires_at).toEqual(originalExpiry);
            expect(stored.expires_at.getTime()).toBeGreaterThan(originalExpiry.getTime());
            await expect(persistence.claimCancellationDelivery(input.booking_idempotency_key))
                .resolves.toMatchObject({ action: 'prepare', delivery_prepare_authorized: true });
            await expect(persistence.authorizeCancellationCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability
            )).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('allows only the bound cancellation operation to finish during retained settlement', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const originalExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;
            clock = new Date(originalExpiry.getTime() - 1);

            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            clock = new Date(originalExpiry.getTime() + 1);
            await persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_retained_replay'
            });

            await expect(persistence.authorizeCancellationCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability,
                input.cancellation_idempotency_key
            )).resolves.toMatchObject({ cancellation_state: 'CANCELLED' });
            await expect(persistence.claimCancellationOperation(input))
                .resolves.toMatchObject({ action: 'already_cancelled', cancellation_authorized: false });
            await expect(persistence.claimCancellationDelivery(input.booking_idempotency_key))
                .resolves.toMatchObject({ action: 'prepare', delivery_prepare_authorized: true });

            const wrongKey = 'different_cancel_key_1234';
            await expect(persistence.authorizeCancellationCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability,
                wrongKey
            )).rejects.toMatchObject({ code: 'EXPIRED' });
            await expect(persistence.claimCancellationOperation(cancellationInput(confirmed, {
                cancellation_idempotency_key: wrongKey
            }))).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('recovers a bound pre-provider cancellation after authority expires without granting a new claim', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const originalExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;
            clock = new Date(originalExpiry.getTime() - 1);
            await persistence.claimCancellationOperation(input);

            clock = new Date(originalExpiry.getTime() + OPERATION_LEASE_MS + 1);
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'resume', cancellation_authorized: true
            });
            await expect(persistence.claimCancellationOperation(cancellationInput(confirmed, {
                cancellation_idempotency_key: 'different_cancel_key_1234'
            }))).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('keeps the retained cancellation settlement deadline fixed across repeated recovery', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const originalExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;
            clock = new Date(originalExpiry.getTime() - 1);

            await persistence.claimCancellationOperation(input);
            const retainedExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;

            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'resume', cancellation_authorized: true
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at)
                .toEqual(retainedExpiry);

            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'resume', cancellation_authorized: true
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at)
                .toEqual(retainedExpiry);
        });

        test('rejects an expired pre-egress claim at the durable provider-attempt fence', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);

            await expect(persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'cancellation_claim_expired' }
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                cancellation_state: 'CANCELLATION_PENDING',
                cancellation_attempt_count: 0
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]
                .cancellation_provider_started_at).toBeUndefined();

            const recovered = await persistence.claimCancellationOperation(input);
            expect(recovered).toMatchObject({ action: 'resume', cancellation_authorized: true });
            expect(recovered.claim_token).not.toBe(claim.claim_token);
            await expect(persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: recovered.claim_token
            })).resolves.toMatchObject({
                cancellation_state: 'CANCELLING',
                cancellation_attempt_count: 1
            });
        });

        test('recovers when provider preflight outlives the cancellation claim without issuing DELETE', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const request = {
                sessionId: input.session_id,
                bookingIdempotencyKey: input.booking_idempotency_key,
                cancellationIdempotencyKey: input.cancellation_idempotency_key,
                capability: input.capability
            };
            let expireDuringPreflight = true;
            const cancellationProvider = {
                name: 'nylas',
                configured: true,
                configuration: {
                    calendarId: 'primary',
                    configurationId: 'deee6623-a154-4a86-9085-163aa0e58a67',
                    organizerEmail: confirmedResult.organizer_email,
                    timezone: confirmedResult.timezone,
                    durationMinutes: confirmedResult.duration_minutes,
                    minimumNoticeMinutes: 0,
                    noticeSafetyMarginMinutes: 0,
                    title: confirmedResult.title
                },
                getAvailability: jest.fn(),
                assertCustomerEmailsDisabled: jest.fn().mockResolvedValue({ customer_emails_disabled: true }),
                createBooking: jest.fn(),
                getBooking: jest.fn().mockResolvedValue({
                    booking_id: confirmedResult.booking_id,
                    event_id: confirmedResult.event_id,
                    status: 'confirmed'
                }),
                getEvent: jest.fn().mockImplementation(async () => {
                    if (expireDuringPreflight) {
                        expireDuringPreflight = false;
                        clock = new Date(clock.getTime() + OPERATION_LEASE_MS + 1);
                    }
                    return {
                        event_id: confirmedResult.event_id,
                        title: confirmedResult.title,
                        status: 'confirmed',
                        organizer_email: confirmedResult.organizer_email,
                        participant_emails: confirmedResult.attendee_emails,
                        calendar_id: 'primary',
                        start: confirmedResult.start,
                        end: confirmedResult.end,
                        start_timezone: confirmedResult.timezone,
                        end_timezone: confirmedResult.timezone
                    };
                }),
                rescheduleBooking: jest.fn(),
                cancelBooking: jest.fn().mockResolvedValue({
                    booking_id: confirmedResult.booking_id,
                    request_id: 'request_after_claim_recovery'
                }),
                verifyWebhook: jest.fn()
            };
            const service = createBookingCancellationService({
                persistence,
                provider: cancellationProvider
            });

            await expect(service.cancelBooking(request)).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'cancellation_claim_expired' }
            });
            expect(cancellationProvider.cancelBooking).not.toHaveBeenCalled();
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                cancellation_state: 'CANCELLATION_PENDING',
                cancellation_attempt_count: 0
            });

            await expect(service.cancelBooking(request)).resolves.toMatchObject({
                status: 'cancelled',
                communication_status: 'pending'
            });
            expect(cancellationProvider.cancelBooking).toHaveBeenCalledTimes(1);
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                cancellation_state: 'CANCELLED',
                cancellation_attempt_count: 1
            });
        });

        test('refuses a recovered provider claim that cannot finish inside the fixed retention deadline', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            await persistence.claimCancellationOperation(input);
            const stored = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            const retainedExpiry = stored.cancellation_retention_expires_at;
            stored.cancellation_claim_lease_expires_at = new Date(clock.getTime() - 1);
            clock = new Date(retainedExpiry.getTime() - OPERATION_LEASE_MS + 1);

            await expect(persistence.claimCancellationOperation(input)).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'cancellation_retention_deadline' }
            });
            expect(stored.cancellation_state).toBe('CANCELLATION_PENDING');
            expect(stored.cancellation_claim_token_digest).toBeTruthy();
            expect(stored.cancellation_retention_expires_at).toEqual(retainedExpiry);
        });

        test('rechecks the fixed retention deadline at the durable provider-attempt fence', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            const stored = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            const retainedExpiry = stored.cancellation_retention_expires_at;
            clock = new Date(retainedExpiry.getTime() - OPERATION_LEASE_MS + 1);

            await expect(persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'cancellation_retention_deadline' }
            });
            expect(firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0]).toMatchObject({
                cancellation_state: 'CANCELLATION_PENDING',
                cancellation_attempt_count: 0,
                cancellation_retention_expires_at: retainedExpiry
            });
        });

        test('does not extend public booking replay authority while retaining cancellation settlement', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const originalExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;
            clock = new Date(originalExpiry.getTime() - 1);

            const claim = await persistence.claimCancellationOperation(input);
            clock = new Date(originalExpiry.getTime() + 1);
            await persistence.markCancellationPreflightFailed({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'nylas.cancellation_preflight_failed'
            });

            await expect(persistence.authorizeBookingCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability
            )).rejects.toMatchObject({ code: 'EXPIRED' });
            await expect(persistence.authorizeCancellationCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability
            )).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('protects settlement retention when resuming a legacy pending cancellation', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            await persistence.claimCancellationOperation(input);
            const operations = firestore.collections.get(COLLECTIONS.BOOKING_OPERATIONS);
            const stored = Array.from(operations.values())[0];
            const legacyExpiry = new Date(clock.getTime() + OPERATION_LEASE_MS + 2);
            delete stored.management_expires_at;
            delete stored.cancellation_retention_expires_at;
            stored.expires_at = legacyExpiry;
            stored.cancellation_claim_lease_expires_at = new Date(clock.getTime() - 1);
            clock = new Date(legacyExpiry.getTime() - 1);

            const resumed = await persistence.claimCancellationOperation(input);
            expect(resumed).toMatchObject({ action: 'resume', cancellation_authorized: true });
            const retained = Array.from(operations.values())[0];
            expect(retained.management_expires_at).toEqual(legacyExpiry);
            expect(retained.cancellation_retention_expires_at).toEqual(retained.expires_at);
            expect(retained.expires_at.getTime()).toBeGreaterThan(legacyExpiry.getTime());
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: resumed.claim_token
            });

            clock = new Date(legacyExpiry.getTime() + 1);
            await expect(persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: resumed.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_legacy_resume'
            })).resolves.toMatchObject({ cancellation_state: 'CANCELLED' });
        });

        test('durably fences an ambiguous near-expiry provider outcome after authority expires', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const originalExpiry = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0].expires_at;
            clock = new Date(originalExpiry.getTime() - 1);

            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            clock = new Date(originalExpiry.getTime() + 1);

            await expect(persistence.markCancellationReconciliationRequired({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'nylas.cancellation_outcome_unknown'
            })).resolves.toMatchObject({
                cancellation_state: 'CANCELLATION_RECONCILIATION_REQUIRED',
                cancellation_reconciliation_required: true
            });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'reconcile', cancellation_authorized: false
            });
            await expect(persistence.authorizeCancellationCapability(
                input.session_id,
                input.booking_idempotency_key,
                input.capability
            )).rejects.toMatchObject({ code: 'EXPIRED' });
        });

        test('persists terminal cancellation once, preserves booking history, and fences stale workers', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            const cancelled = await persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_cancel_1'
            });
            expect(cancelled).toMatchObject({
                state: OPERATION_STATES.CONFIRMED,
                cancellation_state: 'CANCELLED',
                confirmed_result: confirmedResult,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                cancellation_attempt_count: 1,
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING
            });
            await expect(persistence.claimConfirmationDelivery(input.booking_idempotency_key))
                .resolves.toMatchObject({ action: 'suppressed_by_cancellation', delivery_authorized: false });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'already_cancelled', cancellation_authorized: false
            });
            await expect(persistence.claimCancellationOperation(cancellationInput(confirmed, {
                cancellation_idempotency_key: 'different_cancel_key_1234'
            }))).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'idempotency_conflict' }
            });
            await expect(persistence.markCancellationReconciliationRequired({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'stale.worker'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
        });

        test('revokes a claimed original confirmation before provider email egress when cancellation starts', async () => {
            const confirmed = await createConfirmedBooking();
            const delivery = await persistence.claimConfirmationDelivery(confirmed.input.idempotency_key);
            const input = cancellationInput(confirmed);
            await persistence.claimCancellationOperation(input);

            await expect(persistence.beginConfirmationDelivery({
                idempotency_key: input.booking_idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            })).resolves.toMatchObject({
                action: 'suppressed_by_cancellation',
                cancellation_state: 'CANCELLATION_PENDING',
                delivery_authorized: false
            });
        });

        test('blocks cancellation while original confirmation egress is active and reconciles a stale send', async () => {
            const confirmed = await createConfirmedBooking();
            const delivery = await persistence.claimConfirmationDelivery(confirmed.input.idempotency_key);
            await persistence.beginConfirmationDelivery({
                idempotency_key: confirmed.input.idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.delivery_attempt_id
            });
            const input = cancellationInput(confirmed);

            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'confirmation_in_progress', cancellation_authorized: false
            });
            clock = new Date(clock.getTime() + CONFIRMATION_DELIVERY_LEASE_MS + 1);
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'confirmation_reconcile', cancellation_authorized: false,
                operation: {
                    cancellation_state: 'CONFIRMED',
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    delivery_reconciliation_required: true
                }
            });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'confirmation_reconcile', cancellation_authorized: false,
                operation: {
                    cancellation_state: 'CONFIRMED',
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                }
            });
        });

        test('a definitive provider cancellation rejection restores confirmed state and fences the worker', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            const restored = await persistence.markCancellationProviderRejected({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'nylas.cancellation_provider_rejected'
            });
            expect(restored).toMatchObject({
                cancellation_state: 'CONFIRMED',
                cancellation_failure_code: 'nylas.cancellation_provider_rejected',
                cancellation_reconciliation_required: false
            });
            await expect(persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'stale_request'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'cancel', cancellation_authorized: true
            });
        });

        test('reconciles exact provider-cancelled evidence without recording a provider attempt', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            const cancelled = await persistence.markBookingCancellationReconciled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                reconciliation_evidence: 'nylas.cancellation_already_cancelled'
            });
            expect(cancelled).toMatchObject({
                state: OPERATION_STATES.CONFIRMED,
                cancellation_state: 'CANCELLED',
                cancellation_attempt_count: 0,
                cancellation_provider_request_id: null,
                cancellation_reconciliation_evidence: 'nylas.cancellation_already_cancelled',
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING
            });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'already_cancelled', cancellation_authorized: false
            });
        });

        test('requires reconciliation after provider egress ambiguity and never grants another attempt', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.markCancellationReconciliationRequired({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                failure_code: 'nylas.cancellation_outcome_unknown'
            });
            await expect(persistence.claimCancellationOperation(input)).resolves.toMatchObject({
                action: 'reconcile', cancellation_authorized: false
            });
            await expect(persistence.claimCancellationOperation(cancellationInput(confirmed, {
                cancellation_idempotency_key: 'different_cancel_key_1234'
            }))).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'idempotency_conflict' }
            });
        });

        test('serializes read-only reconciliation and terminally adopts exact provider-cancelled evidence', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const original = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: original.claim_token
            });
            await persistence.markCancellationReconciliationRequired({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: original.claim_token,
                failure_code: 'nylas.cancellation_outcome_unknown'
            });

            const [first, second] = await Promise.all([
                persistence.claimCancellationOperation(input),
                persistence.claimCancellationOperation(input)
            ]);
            const winner = [first, second].find((claim) => claim.reconciliation_authorized);
            expect([first.action, second.action].sort()).toEqual(['in_progress', 'reconcile']);
            expect(winner).toMatchObject({
                action: 'reconcile',
                cancellation_authorized: false,
                reconciliation_authorized: true
            });
            await expect(persistence.markBookingCancellationReconciled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: winner.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                reconciliation_evidence: 'nylas.cancellation_already_cancelled'
            })).resolves.toMatchObject({
                cancellation_state: 'CANCELLED',
                cancellation_reconciliation_required: false,
                cancellation_attempt_count: 1
            });
        });

        test('fences cancellation communication and reconciles only from exact definitive provider evidence', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_cancel_2'
            });
            const delivery = await persistence.claimCancellationDelivery(input.booking_idempotency_key);
            const sending = await persistence.beginCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id
            });
            await persistence.markCancellationDeliveryOutcomeUnknown({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_token: sending.delivery_token
            });
            await expect(persistence.claimCancellationDelivery(input.booking_idempotency_key))
                .resolves.toMatchObject({ action: 'reconcile', delivery_authorized: false });
            await expect(persistence.reconcileCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id,
                provider_message_id: 'sendgrid_cancellation_unknown_1',
                reconciliation_evidence_id: 'provider_receipt_cancellation_unknown_1',
                outcome: 'UNKNOWN'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.reconcileCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_attempt_id: 'cda_stale_attempt',
                provider_message_id: 'sendgrid_cancellation_reconciled_1',
                reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                outcome: 'DELIVERED'
            })).rejects.toMatchObject({ code: 'CONFLICT' });
            await expect(persistence.reconcileCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id,
                provider_message_id: 'sendgrid_cancellation_reconciled_1',
                reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                outcome: 'DELIVERED'
            })).rejects.toMatchObject({ code: 'CONFLICT' });

            const unboundPersistence = createBookingPersistence({
                db: firestore,
                now: () => new Date(clock.getTime()),
                timestampFromDate: (date) => new Date(date.getTime()),
                verifyCancellationDeliveryEvidence: async () => ({
                    provider_message_id: 'sendgrid_cancellation_reconciled_1',
                    reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                    outcome: 'DELIVERED',
                    custom_args: {
                        synchintro_cancellation_id: sending.cancellation_delivery_id,
                        synchintro_cancellation_delivery_attempt_id: 'cda_different_attempt'
                    }
                })
            });
            await expect(unboundPersistence.reconcileCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id,
                reconciliation_evidence_id: 'provider_receipt_cancellation_1'
            })).rejects.toMatchObject({ code: 'CONFLICT' });

            const verifyCancellationDeliveryEvidence = jest.fn().mockResolvedValue({
                provider_message_id: 'sendgrid_cancellation_reconciled_1',
                reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                outcome: 'DELIVERED',
                custom_args: {
                    synchintro_cancellation_id: sending.cancellation_delivery_id,
                    synchintro_cancellation_delivery_attempt_id: delivery.cancellation_delivery_attempt_id
                }
            });
            const trustedPersistence = createBookingPersistence({
                db: firestore,
                now: () => new Date(clock.getTime()),
                timestampFromDate: (date) => new Date(date.getTime()),
                idGenerator: (prefix) => `${prefix}_${++sequence}`,
                claimTokenGenerator: () => `claim_token_${++sequence}_abcdefghijklmnopqrstuvwxyz`,
                sessionTokenGenerator: () => 'S'.repeat(43),
                verifyCancellationDeliveryEvidence
            });
            await expect(trustedPersistence.reconcileCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id,
                provider_message_id: 'untrusted_caller_value',
                reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                outcome: 'ACCEPTED'
            })).resolves.toMatchObject({
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                cancellation_delivery_provider_message_id: 'sendgrid_cancellation_reconciled_1',
                cancellation_delivery_reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                cancellation_delivery_reconciliation_required: false
            });
            expect(verifyCancellationDeliveryEvidence).toHaveBeenCalledWith(expect.objectContaining({
                provider: 'sendgrid',
                reconciliation_evidence_id: 'provider_receipt_cancellation_1',
                expected: {
                    cancellation_delivery_id: sending.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: delivery.cancellation_delivery_attempt_id
                }
            }));
            await expect(persistence.claimCancellationDelivery(input.booking_idempotency_key))
                .resolves.toEqual({ action: 'already_sent', delivery_authorized: false });
        });

        test('never authorizes new cancellation-email egress without a full retained delivery lease', async () => {
            const confirmed = await createConfirmedBooking();
            const input = cancellationInput(confirmed);
            const claim = await persistence.claimCancellationOperation(input);
            await persistence.beginCancellationProviderAttempt({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token
            });
            await persistence.markBookingCancelled({
                booking_idempotency_key: input.booking_idempotency_key,
                cancellation_idempotency_key: input.cancellation_idempotency_key,
                claim_token: claim.claim_token,
                provider_booking_id: confirmedResult.booking_id,
                provider_event_id: confirmedResult.event_id,
                provider_request_id: 'request_cancel_delivery_retention'
            });
            const delivery = await persistence.claimCancellationDelivery(input.booking_idempotency_key);
            const stored = firestore.documents(COLLECTIONS.BOOKING_OPERATIONS)[0];
            clock = new Date(
                stored.cancellation_retention_expires_at.getTime()
                - CONFIRMATION_DELIVERY_LEASE_MS
                + 1
            );

            await expect(persistence.beginCancellationDelivery({
                booking_idempotency_key: input.booking_idempotency_key,
                delivery_token: delivery.delivery_token,
                delivery_attempt_id: delivery.cancellation_delivery_attempt_id
            })).rejects.toMatchObject({
                code: 'CONFLICT',
                details: { reason: 'cancellation_delivery_retention_deadline' }
            });
            expect(stored).toMatchObject({
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.CLAIMED,
                cancellation_delivery_attempt_count: 1
            });

            stored.cancellation_delivery_state = CONFIRMATION_DELIVERY_STATES.PENDING;
            stored.cancellation_delivery_token_digest = null;
            stored.cancellation_delivery_lease_expires_at = null;
            await expect(persistence.claimCancellationDelivery(input.booking_idempotency_key))
                .rejects.toMatchObject({
                    code: 'CONFLICT',
                    details: { reason: 'cancellation_delivery_retention_deadline' }
                });
            expect(stored.cancellation_delivery_attempt_count).toBe(1);
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
