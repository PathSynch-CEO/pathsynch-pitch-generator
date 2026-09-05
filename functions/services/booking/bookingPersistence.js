'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const {
    validateCreateSession,
    validateSessionUpdate,
    normalizeIdempotencyKey
} = require('./bookingContract');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');
const {
    COLLECTIONS,
    SESSION_STATES,
    OPERATION_STATES,
    RETENTION_MS,
    OPERATION_LEASE_MS,
    apiError,
    assertNoSecretFields,
    assertSafeDocumentId,
    assertPositiveInteger,
    assertSafeCode,
    isIanaTimezone,
    normalizeDate,
    storedDate,
    isExpired,
    normalizeSlot,
    normalizeRoutingState,
    normalizeProviderReference,
    normalizeProviderIdentifier,
    normalizeAttendeeEmails,
    normalizeConfirmedResult,
    sanitizeOperation,
    availabilityReceiptId,
    assertFingerprint
} = require('./bookingPersistenceSchema');

function createBookingPersistence(options = {}) {
    const db = options.db || admin.firestore();
    const now = options.now || (() => new Date());
    const timestampFromDate = options.timestampFromDate || ((date) => admin.firestore.Timestamp.fromDate(date));
    const idGenerator = options.idGenerator || ((prefix) => `${prefix}_${crypto.randomBytes(18).toString('base64url')}`);
    const claimTokenGenerator = options.claimTokenGenerator || (() => crypto.randomBytes(32).toString('base64url'));

    function currentTime() {
        return normalizeDate(now(), 'now');
    }

    function timestamp(date) {
        return timestampFromDate(new Date(date.getTime()));
    }

    async function databaseCall(callback) {
        try {
            return await callback();
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw apiError(ErrorCodes.DATABASE_ERROR, 'Booking persistence is temporarily unavailable');
        }
    }

    function assertUsableSession(record, at, expectedVersion) {
        if (!record) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found');
        if (isExpired(record, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking session has expired');
        if (record.status !== SESSION_STATES.ACTIVE) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking session is not active');
        }
        if (expectedVersion !== undefined && record.session_version !== expectedVersion) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking session version is stale');
        }
    }

    async function createSession(input) {
        assertNoSecretFields(input);
        const validation = validateCreateSession(input);
        if (!validation.valid) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking session', validation.errors);
        }
        const at = currentTime();
        const sessionId = assertSafeDocumentId(idGenerator('bks'), 'session_id');
        const record = {
            session_id: sessionId,
            flow_id: validation.value.flow_id,
            session_version: 1,
            availability_version: 0,
            status: SESSION_STATES.ACTIVE,
            identity: validation.value.identity,
            timezone: validation.value.timezone,
            attribution: validation.value.attribution,
            company: null,
            qualification: null,
            routing_state: null,
            booking_operation_id: null,
            booking_slot_id: null,
            created_at: timestamp(at),
            updated_at: timestamp(at),
            expires_at: timestamp(new Date(at.getTime() + RETENTION_MS.SESSION))
        };
        const ref = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
        await databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (snapshot.exists) throw apiError(ErrorCodes.CONFLICT, 'Generated booking session ID already exists');
            transaction.set(ref, record);
        }));
        return record;
    }

    async function readSession(sessionId) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        const snapshot = await databaseCall(() => db.collection(COLLECTIONS.SESSIONS).doc(id).get());
        if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found');
        const record = snapshot.data();
        if (isExpired(record, currentTime())) throw apiError(ErrorCodes.EXPIRED, 'Booking session has expired');
        return record;
    }

    async function updateSession(sessionId, expectedVersion, changes) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        assertPositiveInteger(expectedVersion, 'session_version');
        assertNoSecretFields(changes);
        const allowed = new Set(['company', 'qualification', 'routing_state']);
        if (!changes || Object.keys(changes).some((key) => !allowed.has(key))) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Booking session update contains an unsupported field');
        }
        const validation = validateSessionUpdate({
            session_version: expectedVersion,
            company: changes.company,
            qualification: changes.qualification
        });
        if (!validation.valid) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid booking session update', validation.errors);
        }
        const routingState = normalizeRoutingState(changes.routing_state);
        const at = currentTime();
        const ref = db.collection(COLLECTIONS.SESSIONS).doc(id);
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists ? snapshot.data() : null;
            assertUsableSession(current, at, expectedVersion);
            const updated = Object.assign({}, current, {
                session_version: current.session_version + 1,
                company: validation.value.company,
                qualification: validation.value.qualification,
                routing_state: routingState,
                updated_at: timestamp(at)
            });
            transaction.set(ref, updated);
            return updated;
        }));
    }

    async function createAvailabilityReceipt(input) {
        assertNoSecretFields(input);
        input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        const sessionId = assertSafeDocumentId(input && input.session_id, 'session_id');
        const sessionVersion = assertPositiveInteger(input && input.session_version, 'session_version');
        const timezone = String((input && input.timezone) || '').trim();
        if (!isIanaTimezone(timezone)) throw apiError(ErrorCodes.INVALID_INPUT, 'timezone is invalid');
        if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > 200) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'slots must contain between 1 and 200 entries');
        }
        const normalizedSlots = input.slots.map((slot) => normalizeSlot(slot, timezone));
        if (new Set(normalizedSlots.map((slot) => slot.id)).size !== normalizedSlots.length) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'slot IDs must be unique');
        }
        const providerReference = normalizeProviderReference(input.provider_reference);
        const at = currentTime();
        const sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);

        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(sessionRef);
            const session = snapshot.exists ? snapshot.data() : null;
            assertUsableSession(session, at, sessionVersion);
            if (session.timezone !== timezone) {
                throw apiError(ErrorCodes.CONFLICT, 'Availability timezone does not match the booking session');
            }
            const availabilityVersion = (session.availability_version || 0) + 1;
            const receiptId = availabilityReceiptId(sessionId, availabilityVersion);
            const receiptRef = db.collection(COLLECTIONS.AVAILABILITY_RECEIPTS).doc(receiptId);
            const sessionExpiry = storedDate(session.expires_at, 'expires_at');
            const receiptExpiry = new Date(Math.min(
                at.getTime() + RETENTION_MS.AVAILABILITY_RECEIPT,
                sessionExpiry.getTime()
            ));
            const record = {
                receipt_id: receiptId,
                session_id: sessionId,
                session_version: sessionVersion,
                availability_version: availabilityVersion,
                timezone,
                slots: normalizedSlots.map((slot) => Object.assign({}, slot, {
                    availability_version: availabilityVersion
                })),
                provider_reference: providerReference,
                created_at: timestamp(at),
                expires_at: timestamp(receiptExpiry)
            };
            transaction.update(sessionRef, {
                availability_version: availabilityVersion,
                updated_at: timestamp(at)
            });
            transaction.set(receiptRef, record);
            return record;
        }));
    }

    function assertIssuedSlot(session, receipt, input, at) {
        assertUsableSession(session, at, input.session_version);
        if (!receipt) throw apiError(ErrorCodes.NOT_FOUND, 'Availability receipt not found');
        if (isExpired(receipt, at)) throw apiError(ErrorCodes.EXPIRED, 'Availability receipt has expired');
        if (receipt.session_id !== input.session_id) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt belongs to a different session');
        }
        if (receipt.session_version !== input.session_version) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt session version is stale');
        }
        if (receipt.availability_version !== input.availability_version
            || session.availability_version !== input.availability_version) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt version is stale');
        }
        const slot = normalizeSlot(input.slot, receipt.timezone);
        const expected = receipt.slots.find((candidate) => candidate.id === slot.id);
        if (!expected || expected.start !== slot.start || expected.end !== slot.end || expected.timezone !== slot.timezone) {
            throw apiError(ErrorCodes.CONFLICT, 'Selected slot was not issued by this availability receipt');
        }
        return Object.assign({}, expected);
    }

    async function validateIssuedSlot(input) {
        assertNoSecretFields(input);
        const sessionId = assertSafeDocumentId(input && input.session_id, 'session_id');
        const sessionVersion = assertPositiveInteger(input && input.session_version, 'session_version');
        const availabilityVersion = assertPositiveInteger(
            input && input.slot && input.slot.availability_version,
            'slot.availability_version'
        );
        const receiptId = availabilityReceiptId(sessionId, availabilityVersion);
        const at = currentTime();
        const sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
        const receiptRef = db.collection(COLLECTIONS.AVAILABILITY_RECEIPTS).doc(receiptId);

        return databaseCall(() => db.runTransaction(async (transaction) => {
            const [sessionSnapshot, receiptSnapshot] = await Promise.all([
                transaction.get(sessionRef),
                transaction.get(receiptRef)
            ]);
            const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
            const receipt = receiptSnapshot.exists ? receiptSnapshot.data() : null;
            return assertIssuedSlot(session, receipt, {
                session_id: sessionId,
                session_version: sessionVersion,
                availability_version: availabilityVersion,
                slot: input.slot
            }, at);
        }));
    }

    function operationReference(idempotencyKey) {
        const key = normalizeIdempotencyKey(idempotencyKey);
        if (!key) throw apiError(ErrorCodes.INVALID_INPUT, 'Idempotency key is invalid');
        const digest = crypto.createHash('sha256').update(key).digest('hex');
        return {
            digest,
            ref: db.collection(COLLECTIONS.BOOKING_OPERATIONS).doc(`op_${digest}`)
        };
    }

    function claimDecision(existing, request, at) {
        if (isExpired(existing, at)) {
            throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
        }
        const sameRequest = existing.request_fingerprint === request.request_fingerprint
            && existing.session_id === request.session_id
            && existing.session_version === request.session_version
            && existing.availability_version === request.availability_version
            && existing.receipt_id === request.receipt_id
            && existing.slot_id === request.slot_id
            && existing.selected_slot
            && existing.selected_slot.id === request.selected_slot.id
            && existing.selected_slot.start === request.selected_slot.start
            && existing.selected_slot.end === request.selected_slot.end
            && existing.selected_slot.timezone === request.selected_slot.timezone
            && JSON.stringify(existing.attendee_emails) === JSON.stringify(request.attendee_emails);
        if (!sameRequest) {
            throw apiError(ErrorCodes.CONFLICT, 'Idempotency key was reused with different booking data');
        }
        if (existing.state === OPERATION_STATES.CONFIRMED) {
            return { action: 'replay', state: existing.state, booking: existing.confirmed_result };
        }
        if (existing.state === OPERATION_STATES.OUTCOME_UNKNOWN) {
            return { action: 'reconcile', state: existing.state, provider_create_authorized: false };
        }
        if (existing.state === OPERATION_STATES.FAILED) {
            return { action: 'failed', state: existing.state, provider_create_authorized: false };
        }
        return { action: 'in_progress', state: existing.state, provider_create_authorized: false };
    }

    async function claimBookingOperation(input) {
        assertNoSecretFields(input);
        const { digest, ref } = operationReference(input && input.idempotency_key);
        const fingerprint = assertFingerprint(input && input.request_fingerprint);
        const sessionId = assertSafeDocumentId(input && input.session_id, 'session_id');
        const sessionVersion = assertPositiveInteger(input && input.session_version, 'session_version');
        const availabilityVersion = assertPositiveInteger(
            input && input.slot && input.slot.availability_version,
            'slot.availability_version'
        );
        const receiptId = availabilityReceiptId(sessionId, availabilityVersion);
        const slotId = assertSafeDocumentId(input && input.slot && input.slot.id, 'slot.id');
        const slotTimezone = String((input && input.slot && input.slot.timezone) || '').trim();
        const requestedSlot = normalizeSlot(input && input.slot, slotTimezone);
        const attendeeEmails = normalizeAttendeeEmails(input && input.attendee_emails);
        const claimToken = claimTokenGenerator();
        const claimTokenDigest = crypto.createHash('sha256').update(claimToken).digest('hex');
        const at = currentTime();
        const sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
        const receiptRef = db.collection(COLLECTIONS.AVAILABILITY_RECEIPTS).doc(receiptId);

        return databaseCall(() => db.runTransaction(async (transaction) => {
            const [sessionSnapshot, receiptSnapshot, operationSnapshot] = await Promise.all([
                transaction.get(sessionRef),
                transaction.get(receiptRef),
                transaction.get(ref)
            ]);
            if (operationSnapshot.exists) {
                const existing = operationSnapshot.data();
                const decision = claimDecision(existing, {
                    request_fingerprint: fingerprint,
                    session_id: sessionId,
                    session_version: sessionVersion,
                    availability_version: availabilityVersion,
                    receipt_id: receiptId,
                    slot_id: slotId,
                    selected_slot: requestedSlot,
                    attendee_emails: attendeeEmails
                }, at);
                if (existing.state === OPERATION_STATES.CLAIMED
                    && existing.claim_lease_expires_at
                    && storedDate(existing.claim_lease_expires_at, 'claim_lease_expires_at').getTime() <= at.getTime()) {
                    const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
                    const receipt = receiptSnapshot.exists ? receiptSnapshot.data() : null;
                    if (!session || session.booking_operation_id !== ref.id) {
                        throw apiError(ErrorCodes.CONFLICT, 'Booking session reservation does not match this operation');
                    }
                    assertIssuedSlot(session, receipt, {
                        session_id: sessionId,
                        session_version: sessionVersion,
                        availability_version: availabilityVersion,
                        slot: input.slot
                    }, at);
                    transaction.update(ref, {
                        claim_token_digest: claimTokenDigest,
                        claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                        claim_recovery_count: (existing.claim_recovery_count || 0) + 1,
                        updated_at: timestamp(at)
                    });
                    return {
                        action: 'resume',
                        state: OPERATION_STATES.CLAIMED,
                        operation_id: existing.operation_id,
                        claim_token: claimToken,
                        provider_create_authorized: true
                    };
                }
                return decision;
            }
            const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
            const receipt = receiptSnapshot.exists ? receiptSnapshot.data() : null;
            const selectedSlot = assertIssuedSlot(session, receipt, {
                session_id: sessionId,
                session_version: sessionVersion,
                availability_version: availabilityVersion,
                slot: input.slot
            }, at);
            if (session.booking_operation_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking session already has an active booking operation');
            }

            const record = {
                operation_id: ref.id,
                idempotency_key_digest: digest,
                request_fingerprint: fingerprint,
                session_id: sessionId,
                session_version: sessionVersion,
                availability_version: availabilityVersion,
                receipt_id: receiptId,
                slot_id: slotId,
                selected_slot: selectedSlot,
                attendee_emails: attendeeEmails,
                state: OPERATION_STATES.CLAIMED,
                attempt_count: 0,
                claim_recovery_count: 0,
                claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                reconciliation_attempt_count: 0,
                reconciliation_lease_expires_at: null,
                reconciliation_required: false,
                claim_token_digest: claimTokenDigest,
                provider_booking_id: null,
                provider_event_id: null,
                confirmed_result: null,
                failure_code: null,
                created_at: timestamp(at),
                updated_at: timestamp(at),
                expires_at: timestamp(new Date(at.getTime() + RETENTION_MS.BOOKING_OPERATION))
            };
            transaction.update(sessionRef, {
                booking_operation_id: record.operation_id,
                booking_slot_id: slotId,
                updated_at: timestamp(at)
            });
            transaction.set(ref, record);
            return {
                action: 'create',
                state: record.state,
                operation_id: record.operation_id,
                claim_token: claimToken,
                provider_create_authorized: true
            };
        }));
    }

    function assertClaimToken(record, claimToken) {
        const digest = crypto.createHash('sha256').update(String(claimToken || '')).digest('hex');
        const expected = Buffer.from(record.claim_token_digest || '', 'utf8');
        const actual = Buffer.from(digest, 'utf8');
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking operation is owned by another execution');
        }
    }

    async function transitionOperation(input, allowedStates, nextState, fields = {}, sessionTransition = null) {
        assertNoSecretFields(input);
        assertNoSecretFields(fields);
        const { ref } = operationReference(input && input.idempotency_key);
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
            assertClaimToken(current, input.claim_token);
            if (!allowedStates.includes(current.state)) {
                throw apiError(ErrorCodes.CONFLICT, `Booking operation cannot transition from ${current.state}`);
            }
            let sessionRef = null;
            let session = null;
            if (sessionTransition) {
                sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(current.session_id);
                const sessionSnapshot = await transaction.get(sessionRef);
                session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
                if (session && session.booking_operation_id !== current.operation_id) {
                    throw apiError(ErrorCodes.CONFLICT, 'Booking session reservation does not match this operation');
                }
            }
            const updated = Object.assign({}, current, fields, {
                state: nextState,
                updated_at: timestamp(at)
            });
            transaction.set(ref, updated);
            if (session && sessionTransition === 'confirm') {
                transaction.update(sessionRef, {
                    status: SESSION_STATES.BOOKED,
                    updated_at: timestamp(at)
                });
            }
            if (session && sessionTransition === 'release') {
                if (session.status !== SESSION_STATES.ACTIVE) {
                    throw apiError(ErrorCodes.CONFLICT, 'Booked session reservation cannot be released');
                }
                transaction.update(sessionRef, {
                    booking_operation_id: null,
                    booking_slot_id: null,
                    updated_at: timestamp(at)
                });
            }
            return sanitizeOperation(updated);
        }));
    }

    async function beginProviderAttempt(input) {
        return transitionOperation(input, [OPERATION_STATES.CLAIMED], OPERATION_STATES.PROVIDER_PENDING, {
            attempt_count: 1,
            provider_attempt_started_at: timestamp(currentTime()),
            provider_attempt_lease_expires_at: timestamp(new Date(currentTime().getTime() + OPERATION_LEASE_MS))
        });
    }

    async function confirmBookingOperation(input) {
        const result = normalizeConfirmedResult(input && input.confirmed_result);
        return transitionOperation(
            input,
            [OPERATION_STATES.PROVIDER_PENDING, OPERATION_STATES.OUTCOME_UNKNOWN],
            OPERATION_STATES.CONFIRMED,
            {
                provider_booking_id: result.booking_id,
                provider_event_id: result.event_id,
                confirmed_result: result,
                reconciliation_required: false,
                confirmed_at: timestamp(currentTime())
            },
            'confirm'
        );
    }

    async function markBookingFailed(input) {
        const failureCode = assertSafeCode(input && input.failure_code, 'failure_code');
        return transitionOperation(
            input,
            [OPERATION_STATES.CLAIMED, OPERATION_STATES.PROVIDER_PENDING, OPERATION_STATES.OUTCOME_UNKNOWN],
            OPERATION_STATES.FAILED,
            { failure_code: failureCode, reconciliation_required: false },
            'release'
        );
    }

    async function markBookingOutcomeUnknown(input) {
        const failureCode = assertSafeCode(input && input.failure_code, 'failure_code');
        const providerBookingId = input && input.provider_booking_id
            ? normalizeProviderIdentifier(input.provider_booking_id, 'provider_booking_id')
            : null;
        const providerEventId = input && input.provider_event_id
            ? normalizeProviderIdentifier(input.provider_event_id, 'provider_event_id')
            : null;
        return transitionOperation(input, [OPERATION_STATES.PROVIDER_PENDING], OPERATION_STATES.OUTCOME_UNKNOWN, {
            failure_code: failureCode,
            provider_booking_id: providerBookingId,
            provider_event_id: providerEventId,
            reconciliation_required: true
        });
    }

    async function claimBookingReconciliation(idempotencyKey) {
        const { ref } = operationReference(idempotencyKey);
        const reconciliationToken = claimTokenGenerator();
        const reconciliationTokenDigest = crypto.createHash('sha256').update(reconciliationToken).digest('hex');
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
            if (![OPERATION_STATES.PROVIDER_PENDING, OPERATION_STATES.OUTCOME_UNKNOWN].includes(current.state)) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking operation does not require reconciliation');
            }
            const activeLease = current.state === OPERATION_STATES.PROVIDER_PENDING
                ? current.provider_attempt_lease_expires_at
                : current.reconciliation_lease_expires_at;
            if (activeLease && storedDate(activeLease, 'operation_lease').getTime() > at.getTime()) {
                return {
                    action: 'in_progress',
                    state: current.state,
                    provider_create_authorized: false,
                    reconciliation_authorized: false
                };
            }
            const updated = Object.assign({}, current, {
                state: OPERATION_STATES.OUTCOME_UNKNOWN,
                claim_token_digest: reconciliationTokenDigest,
                reconciliation_required: true,
                reconciliation_attempt_count: (current.reconciliation_attempt_count || 0) + 1,
                reconciliation_started_at: timestamp(at),
                reconciliation_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            });
            transaction.set(ref, updated);
            return {
                action: 'reconcile',
                state: updated.state,
                operation: sanitizeOperation(updated),
                claim_token: reconciliationToken,
                provider_create_authorized: false,
                reconciliation_authorized: true
            };
        }));
    }

    async function readBookingOperation(idempotencyKey) {
        const { ref } = operationReference(idempotencyKey);
        const snapshot = await databaseCall(() => ref.get());
        if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
        const record = snapshot.data();
        if (isExpired(record, currentTime())) {
            throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
        }
        return sanitizeOperation(record);
    }

    return Object.freeze({
        createSession,
        readSession,
        updateSession,
        createAvailabilityReceipt,
        validateIssuedSlot,
        claimBookingOperation,
        beginProviderAttempt,
        confirmBookingOperation,
        markBookingFailed,
        markBookingOutcomeUnknown,
        claimBookingReconciliation,
        readBookingOperation
    });
}

module.exports = {
    COLLECTIONS,
    SESSION_STATES,
    OPERATION_STATES,
    RETENTION_MS,
    OPERATION_LEASE_MS,
    createBookingPersistence
};
