'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const {
    MAX_AVAILABILITY_SLOTS,
    isValidBookingNoticeMinutes,
    meetsBookingNotice
} = require('./bookingLimits');
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
    CANCELLATION_STATES,
    RETENTION_MS,
    OPERATION_LEASE_MS,
    CONFIRMATION_DELIVERY_LEASE_MS,
    MAX_CONFIRMATION_DELIVERY_ATTEMPTS,
    CONFIRMATION_DELIVERY_STATES,
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
    normalizeSpecialist,
    normalizeProviderReference,
    normalizeProviderIdentifier,
    normalizeAttendeeEmails,
    normalizeConfirmationIdentity,
    normalizeConfirmedResult,
    sanitizeOperation,
    availabilityReceiptId,
    assertFingerprint
} = require('./bookingPersistenceSchema');

function createBookingPersistence(options = {}) {
    const db = options.db || admin.firestore();
    const now = options.now || (() => new Date());
    const timestampFromDate = options.timestampFromDate || ((date) => Timestamp.fromDate(date));
    const idGenerator = options.idGenerator || ((prefix) => `${prefix}_${crypto.randomBytes(18).toString('base64url')}`);
    const claimTokenGenerator = options.claimTokenGenerator || (() => crypto.randomBytes(32).toString('base64url'));
    const sessionTokenGenerator = options.sessionTokenGenerator
        || (() => crypto.randomBytes(32).toString('base64url'));
    const verifyCancellationDeliveryEvidence = typeof options.verifyCancellationDeliveryEvidence === 'function'
        ? options.verifyCancellationDeliveryEvidence
        : null;

    function currentTime() {
        return normalizeDate(now(), 'now');
    }

    function isManagementExpired(record, at) {
        const deadline = record && (record.management_expires_at || record.expires_at);
        return storedDate(deadline, 'management_expires_at').getTime() <= at.getTime();
    }

    function retainedCancellationExpiry(record, at) {
        const currentExpiry = storedDate(record.expires_at, 'expires_at');
        const cancellationExpiry = new Date(at.getTime() + RETENTION_MS.BOOKING_OPERATION);
        return timestamp(currentExpiry.getTime() >= cancellationExpiry.getTime()
            ? currentExpiry
            : cancellationExpiry);
    }

    function assertCancellationLeaseWithinRetention(record, at) {
        const deadline = storedDate(
            record.cancellation_retention_expires_at || record.expires_at,
            'cancellation_retention_expires_at'
        );
        if (deadline.getTime() <= at.getTime() + OPERATION_LEASE_MS) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Cancellation settlement window is too short for provider work',
                { reason: 'cancellation_retention_deadline' }
            );
        }
        return deadline;
    }

    function assertCancellationClaimLeaseActive(record, at) {
        const deadline = storedDate(
            record.cancellation_claim_lease_expires_at,
            'cancellation_claim_lease_expires_at'
        );
        if (deadline.getTime() <= at.getTime()) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Cancellation claim lease has expired',
                { reason: 'cancellation_claim_expired' }
            );
        }
        return deadline;
    }

    function assertCancellationDeliveryLeaseWithinRetention(record, at) {
        const deadline = storedDate(
            record.cancellation_retention_expires_at || record.expires_at,
            'cancellation_retention_expires_at'
        );
        if (deadline.getTime() <= at.getTime() + CONFIRMATION_DELIVERY_LEASE_MS) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Cancellation settlement window is too short for communication delivery',
                { reason: 'cancellation_delivery_retention_deadline' }
            );
        }
        return deadline;
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
        if (!record) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found', { reason: 'session_not_found' });
        if (isExpired(record, at)) {
            throw apiError(ErrorCodes.EXPIRED, 'Booking session has expired', { reason: 'session_expired' });
        }
        if (record.status !== SESSION_STATES.ACTIVE) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking session is not active', { reason: 'session_not_active' });
        }
        if (expectedVersion !== undefined && record.session_version !== expectedVersion) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking session version is stale', {
                reason: 'stale_session_version'
            });
        }
    }

    function capabilityDigest(token) {
        const normalized = String(token || '').trim();
        if (!/^[a-zA-Z0-9_-]{43,128}$/.test(normalized)) {
            throw apiError(ErrorCodes.INVALID_SESSION_CAPABILITY, 'Invalid booking session capability');
        }
        return crypto.createHash('sha256').update(normalized).digest('hex');
    }

    function assertCapabilityDigest(storedDigest, token) {
        const supplied = Buffer.from(capabilityDigest(token), 'utf8');
        const stored = Buffer.from(String(storedDigest || ''), 'utf8');
        if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored)) {
            throw apiError(ErrorCodes.INVALID_SESSION_CAPABILITY, 'Invalid booking session capability');
        }
    }

    function assertMinimumBookingNotice(slot, at, noticeMinutes) {
        if (!isValidBookingNoticeMinutes(noticeMinutes)) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'minimum booking notice is invalid');
        }
        if (!meetsBookingNotice(slot.start, at, noticeMinutes)) {
            throw apiError(ErrorCodes.CONFLICT, 'Selected slot is no longer available', {
                reason: 'slot_minimum_notice_elapsed'
            });
        }
    }

    async function persistSession(input, capabilityDigest = null, initialContext = null) {
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
            timezone: initialContext && initialContext.timezone
                ? initialContext.timezone
                : validation.value.timezone,
            visitor_timezone: validation.value.timezone,
            attribution: validation.value.attribution,
            company: initialContext && initialContext.company ? initialContext.company : null,
            qualification: initialContext && initialContext.qualification ? initialContext.qualification : null,
            routing_state: initialContext ? normalizeRoutingState(initialContext.routing_state) : null,
            specialist: initialContext ? normalizeSpecialist(initialContext.specialist) : null,
            booking_operation_id: null,
            booking_slot_id: null,
            session_token_digest: capabilityDigest,
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

    async function createSession(input) {
        assertNoSecretFields(input);
        return persistSession(input);
    }

    async function createSessionWithCapability(input, serverContext = null) {
        assertNoSecretFields(input);
        input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        const allowed = new Set(['flow_id', 'identity', 'timezone', 'attribution', 'company', 'qualification']);
        if (Object.keys(input).some((key) => !allowed.has(key))) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Booking session contains an unsupported field');
        }
        const hasCompany = input.company !== undefined && input.company !== null;
        const hasQualification = input.qualification !== undefined && input.qualification !== null;
        if (hasCompany !== hasQualification) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'company and qualification must be supplied together');
        }
        let initialContext = {
            timezone: serverContext && serverContext.timezone,
            routing_state: serverContext && serverContext.routing_state,
            specialist: serverContext && serverContext.specialist
        };
        if (hasCompany) {
            const contextValidation = validateSessionUpdate({
                session_version: 1,
                company: input.company,
                qualification: input.qualification
            });
            if (!contextValidation.valid) {
                throw new ApiError(
                    ErrorCodes.VALIDATION_ERROR,
                    'Invalid booking session context',
                    contextValidation.errors
                );
            }
            initialContext = Object.assign(initialContext, {
                company: contextValidation.value.company,
                qualification: contextValidation.value.qualification
            });
        }
        if (!initialContext || !initialContext.routing_state || !initialContext.specialist) {
            throw apiError(ErrorCodes.INTERNAL_ERROR, 'Authoritative booking host could not be established');
        }
        const token = String(sessionTokenGenerator() || '');
        if (!/^[a-zA-Z0-9_-]{43,128}$/.test(token)) {
            throw apiError(ErrorCodes.INTERNAL_ERROR, 'Booking session capability could not be generated');
        }
        const digest = crypto.createHash('sha256').update(token).digest('hex');
        const record = await persistSession({
            flow_id: input.flow_id,
            identity: input.identity,
            timezone: input.timezone,
            attribution: input.attribution
        }, digest, initialContext);
        const session = Object.assign({}, record);
        delete session.session_token_digest;
        return { session, session_token: token };
    }

    async function authorizeSessionCapability(sessionId, token) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        const snapshot = await databaseCall(() => db.collection(COLLECTIONS.SESSIONS).doc(id).get());
        if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found');
        const record = snapshot.data();
        assertCapabilityDigest(record.session_token_digest, token);
        assertUsableSession(record, currentTime());
        const session = Object.assign({}, record);
        delete session.session_token_digest;
        return session;
    }

    async function authorizeBookingCapability(sessionId, idempotencyKey, token) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        const sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(id);
        const { ref: operationRef } = operationReference(idempotencyKey);
        const [sessionSnapshot, operationSnapshot] = await databaseCall(() => Promise.all([
            sessionRef.get(),
            operationRef.get()
        ]));
        const at = currentTime();
        const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
        const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
        const confirmedReplay = operation
            && operation.state === OPERATION_STATES.CONFIRMED
            && operation.session_id === id
            && !isManagementExpired(operation, at);

        if (session) {
            assertCapabilityDigest(session.session_token_digest, token);
            if (!isExpired(session, at) && session.status === SESSION_STATES.ACTIVE) {
                const authorized = Object.assign({}, session);
                delete authorized.session_token_digest;
                return authorized;
            }
            if (confirmedReplay) return { session_id: id, status: SESSION_STATES.BOOKED };
            assertUsableSession(session, at);
        }

        if (!confirmedReplay) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found');
        assertCapabilityDigest(operation.session_token_digest, token);
        return { session_id: id, status: SESSION_STATES.BOOKED };
    }

    async function readSession(sessionId, readOptions = {}) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        const snapshot = await databaseCall(() => db.collection(COLLECTIONS.SESSIONS).doc(id).get());
        if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking session not found');
        const record = snapshot.data();
        if (!readOptions.allowExpired && isExpired(record, currentTime())) {
            throw apiError(ErrorCodes.EXPIRED, 'Booking session has expired');
        }
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
        const hasRoutingUpdate = Object.prototype.hasOwnProperty.call(changes, 'routing_state');
        const routingState = hasRoutingUpdate ? normalizeRoutingState(changes.routing_state) : null;
        if (hasRoutingUpdate && !routingState) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Authoritative booking routing cannot be cleared');
        }
        const at = currentTime();
        const ref = db.collection(COLLECTIONS.SESSIONS).doc(id);
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists ? snapshot.data() : null;
            assertUsableSession(current, at, expectedVersion);
            if (current.booking_operation_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking session has an active booking operation');
            }
            if (hasRoutingUpdate) {
                if (!current.routing_state) {
                    throw apiError(ErrorCodes.CONFLICT, 'Booking session has no authoritative route to replace');
                }
                if (routingState.owner_id !== current.routing_state.owner_id
                    || routingState.workspace_id !== current.routing_state.workspace_id) {
                    throw apiError(ErrorCodes.CONFLICT, 'Booking routing does not match the authoritative host workspace', {
                        reason: 'booking_routing_authority_mismatch'
                    });
                }
            }
            const updated = Object.assign({}, current, {
                session_version: current.session_version + 1,
                company: validation.value.company,
                qualification: validation.value.qualification,
                routing_state: hasRoutingUpdate ? routingState : current.routing_state,
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
        if (!Array.isArray(input.slots) || input.slots.length > MAX_AVAILABILITY_SLOTS) {
            throw apiError(
                ErrorCodes.INVALID_INPUT,
                `slots must contain between 0 and ${MAX_AVAILABILITY_SLOTS} entries`
            );
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
            if (session.booking_operation_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking session has an active booking operation');
            }
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
        if (!receipt) {
            throw apiError(ErrorCodes.NOT_FOUND, 'Availability receipt not found', {
                reason: 'availability_not_found'
            });
        }
        if (isExpired(receipt, at)) {
            throw apiError(ErrorCodes.EXPIRED, 'Availability receipt has expired', {
                reason: 'availability_expired'
            });
        }
        if (receipt.session_id !== input.session_id) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt belongs to a different session', {
                reason: 'availability_session_mismatch'
            });
        }
        if (receipt.session_version !== input.session_version) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt session version is stale', {
                reason: 'stale_session_version'
            });
        }
        if (receipt.availability_version !== input.availability_version
            || session.availability_version !== input.availability_version) {
            throw apiError(ErrorCodes.CONFLICT, 'Availability receipt version is stale', {
                reason: 'stale_availability'
            });
        }
        if (input.provider_reference) {
            const receiptProvider = normalizeProviderReference(receipt.provider_reference);
            if (!receiptProvider
                || receiptProvider.provider !== input.provider_reference.provider
                || receiptProvider.configuration_id !== input.provider_reference.configuration_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Availability receipt provider configuration is stale');
            }
        }
        const slot = normalizeSlot(input.slot, receipt.timezone);
        const expected = receipt.slots.find((candidate) => candidate.id === slot.id);
        if (!expected || expected.start !== slot.start || expected.end !== slot.end || expected.timezone !== slot.timezone) {
            throw apiError(ErrorCodes.CONFLICT, 'Selected slot was not issued by this availability receipt', {
                reason: 'slot_not_issued'
            });
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
            && JSON.stringify(existing.attendee_emails) === JSON.stringify(request.attendee_emails)
            && existing.provider_reference
            && existing.provider_reference.provider === request.provider_reference.provider
            && existing.provider_reference.configuration_id === request.provider_reference.configuration_id;
        if (!sameRequest) {
            throw apiError(ErrorCodes.CONFLICT, 'Idempotency key was reused with different booking data', {
                reason: 'idempotency_conflict'
            });
        }
        if (existing.state === OPERATION_STATES.CONFIRMED) {
            return {
                action: 'replay',
                state: existing.state,
                booking: existing.confirmed_result,
                operation: sanitizeOperation(existing)
            };
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
        const confirmationIdentity = normalizeConfirmationIdentity(input && input.confirmation_identity);
        const specialist = normalizeSpecialist(input && input.specialist);
        const providerReference = normalizeProviderReference(input && input.provider_reference);
        const minimumNoticeMinutes = input && input.minimum_notice_minutes;
        if (!providerReference) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'provider_reference is required');
        }
        if (!isValidBookingNoticeMinutes(minimumNoticeMinutes)) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'minimum booking notice is invalid');
        }
        const claimToken = claimTokenGenerator();
        const claimTokenDigest = crypto.createHash('sha256').update(claimToken).digest('hex');
        const sessionRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
        const receiptRef = db.collection(COLLECTIONS.AVAILABILITY_RECEIPTS).doc(receiptId);

        return databaseCall(() => db.runTransaction(async (transaction) => {
            const [sessionSnapshot, receiptSnapshot, operationSnapshot] = await Promise.all([
                transaction.get(sessionRef),
                transaction.get(receiptRef),
                transaction.get(ref)
            ]);
            // Recompute on every transaction attempt so notice eligibility is checked at the
            // same authoritative boundary that grants provider-create authority.
            const at = currentTime();
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
                    attendee_emails: attendeeEmails,
                    provider_reference: providerReference
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
                        slot: input.slot,
                        provider_reference: providerReference
                    }, at);
                    assertMinimumBookingNotice(requestedSlot, at, minimumNoticeMinutes);
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
                slot: input.slot,
                provider_reference: providerReference
            }, at);
            assertMinimumBookingNotice(selectedSlot, at, minimumNoticeMinutes);
            if (session.booking_operation_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking session already has an active booking operation');
            }

            const operationExpiry = new Date(at.getTime() + RETENTION_MS.BOOKING_OPERATION);
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
                confirmation_identity: confirmationIdentity,
                specialist,
                provider_reference: providerReference,
                session_token_digest: session.session_token_digest || null,
                state: OPERATION_STATES.CLAIMED,
                cancellation_state: null,
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
                confirmation_delivery_state: null,
                delivery_token_digest: null,
                failure_code: null,
                created_at: timestamp(at),
                updated_at: timestamp(at),
                management_expires_at: timestamp(operationExpiry),
                expires_at: timestamp(operationExpiry)
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

    async function transitionOperation(
        input,
        allowedStates,
        nextState,
        fields = {},
        sessionTransition = null,
        validateOperation = null
    ) {
        assertNoSecretFields(input);
        if (typeof fields !== 'function') assertNoSecretFields(fields);
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
            if (validateOperation) validateOperation(current);
            const resolvedFields = typeof fields === 'function' ? fields(current) : fields;
            assertNoSecretFields(resolvedFields);
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
            const updated = Object.assign({}, current, resolvedFields, {
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

    async function recordProviderIdentifiers(input) {
        const providerBookingId = normalizeProviderIdentifier(
            input && input.provider_booking_id,
            'provider_booking_id'
        );
        const providerEventId = normalizeProviderIdentifier(
            input && input.provider_event_id,
            'provider_event_id'
        );
        return transitionOperation(
            input,
            [OPERATION_STATES.PROVIDER_PENDING],
            OPERATION_STATES.PROVIDER_PENDING,
            {
                provider_booking_id: providerBookingId,
                provider_event_id: providerEventId
            }
        );
    }

    async function confirmBookingOperation(input) {
        const result = normalizeConfirmedResult(input && input.confirmed_result);
        const validateConfirmation = (operation) => {
            const expectedSlot = operation.selected_slot;
            const expectedAttendees = [...(operation.attendee_emails || [])].sort();
            const actualAttendees = [...result.attendee_emails].sort();
            if (!expectedSlot
                || result.start !== expectedSlot.start
                || result.end !== expectedSlot.end
                || result.timezone !== expectedSlot.timezone
                || JSON.stringify(actualAttendees) !== JSON.stringify(expectedAttendees)) {
                throw apiError(ErrorCodes.CONFLICT, 'Confirmed booking does not match the claimed operation');
            }
        };
        return transitionOperation(
            input,
            [OPERATION_STATES.PROVIDER_PENDING, OPERATION_STATES.OUTCOME_UNKNOWN],
            OPERATION_STATES.CONFIRMED,
            (operation) => ({
                provider_booking_id: result.booking_id,
                provider_event_id: result.event_id,
                confirmed_result: result,
                cancellation_state: CANCELLATION_STATES.CONFIRMED,
                // Operations created before the branded-confirmation rollout have no durable
                // identity/specialist snapshot. Preserve their legacy classification instead of
                // attempting a new email that Nylas may already have sent.
                confirmation_delivery_state: operation.confirmation_identity && operation.specialist
                    ? CONFIRMATION_DELIVERY_STATES.PENDING
                    : null,
                confirmation_delivery_id: operation.confirmation_identity && operation.specialist
                    ? `cnf_${crypto.createHash('sha256').update(operation.operation_id).digest('hex')}`
                    : null,
                confirmation_delivery_attempt_count: 0,
                delivery_attempt_id: null,
                delivery_token_digest: null,
                delivery_lease_expires_at: null,
                delivery_provider_message_id: null,
                delivery_reconciliation_required: false,
                reconciliation_required: false,
                confirmed_at: timestamp(currentTime())
            }),
            'confirm',
            validateConfirmation
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

    function cancellationState(record) {
        if (record && record.cancellation_state) return record.cancellation_state;
        return record && record.state === OPERATION_STATES.CONFIRMED
            ? CANCELLATION_STATES.CONFIRMED
            : null;
    }

    function cancellationKeyDigest(value) {
        const key = normalizeIdempotencyKey(value);
        if (!key) throw apiError(ErrorCodes.INVALID_INPUT, 'Cancellation idempotency key is invalid');
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    function assertCancellationAuthority(record, sessionId, token, at, continuationKeyDigest = null) {
        if (!record || record.state !== OPERATION_STATES.CONFIRMED || !record.confirmed_result) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking is not cancellable');
        }
        const retainedContinuation = cancellationState(record) !== CANCELLATION_STATES.CONFIRMED
            && continuationKeyDigest
            && record.cancellation_idempotency_key_digest === continuationKeyDigest
            && !isExpired(record, at);
        if (isManagementExpired(record, at) && !retainedContinuation) {
            throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
        }
        if (record.session_id !== sessionId) {
            throw apiError(ErrorCodes.AUTHORIZATION_ERROR, 'Booking cancellation is not authorized');
        }
        assertCapabilityDigest(record.session_token_digest, token);
        if (!record.provider_booking_id || !record.provider_event_id || !record.provider_reference) {
            throw apiError(ErrorCodes.CONFLICT, 'Booking provider evidence is incomplete');
        }
    }

    async function authorizeCancellationCapability(
        sessionId,
        bookingIdempotencyKey,
        token,
        cancellationIdempotencyKey
    ) {
        const id = assertSafeDocumentId(sessionId, 'session_id');
        const { ref } = operationReference(bookingIdempotencyKey);
        const continuationKeyDigest = cancellationIdempotencyKey === undefined
            ? null
            : cancellationKeyDigest(cancellationIdempotencyKey);
        const snapshot = await databaseCall(() => ref.get());
        if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
        const record = snapshot.data();
        assertCancellationAuthority(record, id, token, currentTime(), continuationKeyDigest);
        return sanitizeOperation(record);
    }

    async function claimCancellationOperation(input) {
        assertNoSecretFields(input);
        const sessionId = assertSafeDocumentId(input && input.session_id, 'session_id');
        const { ref } = operationReference(input && input.booking_idempotency_key);
        const keyDigest = cancellationKeyDigest(input && input.cancellation_idempotency_key);
        const claimToken = claimTokenGenerator();
        const claimTokenDigest = crypto.createHash('sha256').update(claimToken).digest('hex');

        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            assertCancellationAuthority(current, sessionId, input.capability, at, keyDigest);
            const lifecycle = cancellationState(current);

            if ([
                'PROVIDER_ATTEMPTING',
                'RECONCILIATION_REQUIRED',
                'COMMUNICATION_PENDING'
            ].includes(current.synthetic_recovery_state)) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Governed synthetic recovery owns the cancellation mutation fence',
                    { reason: 'governed_recovery_in_progress' }
                );
            }

            if (lifecycle === CANCELLATION_STATES.CONFIRMED
                && [CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED, 'OUTCOME_UNKNOWN']
                    .includes(current.confirmation_delivery_state)) {
                return {
                    action: 'confirmation_reconcile',
                    cancellation_authorized: false,
                    operation: sanitizeOperation(current)
                };
            }

            if (lifecycle === CANCELLATION_STATES.CONFIRMED
                && current.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENDING) {
                const confirmationLeaseActive = current.delivery_lease_expires_at
                    && storedDate(current.delivery_lease_expires_at, 'delivery_lease_expires_at')
                        .getTime() > at.getTime();
                if (confirmationLeaseActive) {
                    return {
                        action: 'confirmation_in_progress',
                        cancellation_authorized: false,
                        operation: sanitizeOperation(current)
                    };
                }
                const update = {
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    delivery_token_digest: null,
                    delivery_lease_expires_at: null,
                    delivery_reconciliation_required: true,
                    delivery_reconciliation_reason: 'cancellation_blocked_on_stale_sending',
                    delivery_outcome_unknown_at: timestamp(at),
                    updated_at: timestamp(at)
                };
                transaction.update(ref, update);
                return {
                    action: 'confirmation_reconcile',
                    cancellation_authorized: false,
                    operation: sanitizeOperation(Object.assign({}, current, update))
                };
            }

            if (lifecycle !== CANCELLATION_STATES.CONFIRMED
                && current.cancellation_idempotency_key_digest !== keyDigest) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Cancellation idempotency key was already used for a different operation',
                    { reason: 'idempotency_conflict' }
                );
            }

            if (lifecycle === CANCELLATION_STATES.CANCELLED) {
                return { action: 'already_cancelled', cancellation_authorized: false, operation: sanitizeOperation(current) };
            }
            if (lifecycle === CANCELLATION_STATES.RECONCILIATION_REQUIRED) {
                const reconciliationLeaseActive = current.cancellation_claim_lease_expires_at
                    && storedDate(
                        current.cancellation_claim_lease_expires_at,
                        'cancellation_claim_lease_expires_at'
                    ).getTime() > at.getTime();
                if (reconciliationLeaseActive) {
                    return { action: 'in_progress', cancellation_authorized: false, operation: sanitizeOperation(current) };
                }
                assertCancellationLeaseWithinRetention(current, at);
                const update = {
                    cancellation_claim_token_digest: claimTokenDigest,
                    cancellation_claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                    cancellation_reconciliation_attempt_count: (current.cancellation_reconciliation_attempt_count || 0) + 1,
                    updated_at: timestamp(at)
                };
                transaction.update(ref, update);
                return {
                    action: 'reconcile',
                    cancellation_authorized: false,
                    reconciliation_authorized: true,
                    claim_token: claimToken,
                    operation: sanitizeOperation(Object.assign({}, current, update))
                };
            }
            if (lifecycle === CANCELLATION_STATES.CANCELLING) {
                const providerLeaseActive = current.cancellation_claim_lease_expires_at
                    && storedDate(
                        current.cancellation_claim_lease_expires_at,
                        'cancellation_claim_lease_expires_at'
                    ).getTime() > at.getTime();
                if (!providerLeaseActive) {
                    assertCancellationLeaseWithinRetention(current, at);
                    const update = {
                        cancellation_state: CANCELLATION_STATES.RECONCILIATION_REQUIRED,
                        cancellation_failure_code: 'booking.cancellation_stale_provider_attempt',
                        cancellation_claim_token_digest: claimTokenDigest,
                        cancellation_claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                        cancellation_reconciliation_attempt_count:
                            (current.cancellation_reconciliation_attempt_count || 0) + 1,
                        cancellation_reconciliation_required: true,
                        cancellation_reconciliation_required_at: timestamp(at),
                        updated_at: timestamp(at)
                    };
                    transaction.update(ref, update);
                    return {
                        action: 'reconcile',
                        cancellation_authorized: false,
                        reconciliation_authorized: true,
                        claim_token: claimToken,
                        operation: sanitizeOperation(Object.assign({}, current, update))
                    };
                }
                return { action: 'in_progress', cancellation_authorized: false, operation: sanitizeOperation(current) };
            }
            if (lifecycle === CANCELLATION_STATES.PENDING) {
                const activeLease = current.cancellation_claim_lease_expires_at
                    && storedDate(current.cancellation_claim_lease_expires_at, 'cancellation_claim_lease_expires_at')
                        .getTime() > at.getTime();
                if (activeLease) {
                    return { action: 'in_progress', cancellation_authorized: false, operation: sanitizeOperation(current) };
                }
                const retainedExpiry = current.cancellation_retention_expires_at
                    || (current.management_expires_at
                        ? current.expires_at
                        : retainedCancellationExpiry(current, at));
                assertCancellationLeaseWithinRetention(Object.assign({}, current, {
                    cancellation_retention_expires_at: retainedExpiry,
                    expires_at: retainedExpiry
                }), at);
                const update = {
                    cancellation_claim_token_digest: claimTokenDigest,
                    cancellation_claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                    management_expires_at: current.management_expires_at || current.expires_at,
                    cancellation_retention_expires_at: retainedExpiry,
                    expires_at: retainedExpiry,
                    cancellation_claim_recovery_count: (current.cancellation_claim_recovery_count || 0) + 1,
                    updated_at: timestamp(at)
                };
                transaction.update(ref, update);
                return {
                    action: 'resume',
                    cancellation_authorized: true,
                    claim_token: claimToken,
                    operation: sanitizeOperation(Object.assign({}, current, update))
                };
            }
            if (lifecycle !== CANCELLATION_STATES.CONFIRMED) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking is not cancellable');
            }

            const retainedExpiry = retainedCancellationExpiry(current, at);
            const update = {
                cancellation_state: CANCELLATION_STATES.PENDING,
                cancellation_idempotency_key_digest: keyDigest,
                cancellation_claim_token_digest: claimTokenDigest,
                cancellation_claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                management_expires_at: current.management_expires_at || current.expires_at,
                cancellation_retention_expires_at: retainedExpiry,
                expires_at: retainedExpiry,
                cancellation_claim_recovery_count: 0,
                cancellation_attempt_count: 0,
                cancellation_failure_code: null,
                cancellation_reconciliation_required: false,
                cancellation_requested_at: timestamp(at),
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return {
                action: 'cancel',
                cancellation_authorized: true,
                claim_token: claimToken,
                operation: sanitizeOperation(Object.assign({}, current, update))
            };
        }));
    }

    function assertCancellationClaim(current, input) {
        const suppliedKeyDigest = cancellationKeyDigest(input && input.cancellation_idempotency_key);
        if (current.cancellation_idempotency_key_digest !== suppliedKeyDigest) {
            throw apiError(ErrorCodes.CONFLICT, 'Cancellation operation identity does not match');
        }
        const digest = crypto.createHash('sha256').update(String(input && input.claim_token || '')).digest('hex');
        const expected = Buffer.from(String(current.cancellation_claim_token_digest || ''), 'utf8');
        const actual = Buffer.from(digest, 'utf8');
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
            throw apiError(ErrorCodes.CONFLICT, 'Cancellation operation is owned by another execution');
        }
    }

    async function transitionCancellation(input, allowedStates, nextState, fields = {}) {
        assertNoSecretFields(input);
        assertNoSecretFields(fields);
        const { ref } = operationReference(input && input.booking_idempotency_key);
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
            assertCancellationClaim(current, input);
            if (nextState === CANCELLATION_STATES.CANCELLING) {
                assertCancellationLeaseWithinRetention(current, at);
                assertCancellationClaimLeaseActive(current, at);
            }
            if (!allowedStates.includes(cancellationState(current))) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation operation cannot transition from its current state');
            }
            const update = Object.assign({}, fields, {
                cancellation_state: nextState,
                updated_at: timestamp(at)
            });
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function beginCancellationProviderAttempt(input) {
        const at = currentTime();
        return transitionCancellation(input, [CANCELLATION_STATES.PENDING], CANCELLATION_STATES.CANCELLING, {
            cancellation_attempt_count: 1,
            cancellation_provider_started_at: timestamp(at),
            cancellation_claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS))
        });
    }

    async function markBookingCancelled(input) {
        const providerBookingId = normalizeProviderIdentifier(input && input.provider_booking_id, 'provider_booking_id');
        const providerEventId = normalizeProviderIdentifier(input && input.provider_event_id, 'provider_event_id');
        const providerRequestId = normalizeProviderIdentifier(input && input.provider_request_id, 'provider_request_id');
        const { ref } = operationReference(input && input.booking_idempotency_key);
        assertNoSecretFields(input);
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
            assertCancellationClaim(current, input);
            if (cancellationState(current) !== CANCELLATION_STATES.CANCELLING) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation operation cannot be completed from its current state');
            }
            if (current.provider_booking_id !== providerBookingId || current.provider_event_id !== providerEventId) {
                throw apiError(ErrorCodes.CONFLICT, 'Provider cancellation evidence does not match the booking');
            }
            const cancellationDeliveryId = `cnd_${crypto.createHash('sha256').update(current.operation_id).digest('hex')}`;
            const update = {
                cancellation_state: CANCELLATION_STATES.CANCELLED,
                cancellation_provider_booking_id: providerBookingId,
                cancellation_provider_event_id: providerEventId,
                cancellation_provider_request_id: providerRequestId,
                cancellation_provider_succeeded_at: timestamp(at),
                cancellation_cancelled_at: timestamp(at),
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: false,
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING,
                cancellation_delivery_id: cancellationDeliveryId,
                cancellation_delivery_attempt_count: 0,
                cancellation_delivery_attempt_id: null,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                cancellation_delivery_provider_message_id: null,
                cancellation_delivery_reconciliation_required: false,
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function markBookingCancellationReconciled(input) {
        const providerBookingId = normalizeProviderIdentifier(input && input.provider_booking_id, 'provider_booking_id');
        const providerEventId = normalizeProviderIdentifier(input && input.provider_event_id, 'provider_event_id');
        const reconciliationEvidence = assertSafeCode(
            input && input.reconciliation_evidence,
            'cancellation_reconciliation_evidence'
        );
        const { ref } = operationReference(input && input.booking_idempotency_key);
        assertNoSecretFields(input);
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
            assertCancellationClaim(current, input);
            if (![CANCELLATION_STATES.PENDING, CANCELLATION_STATES.RECONCILIATION_REQUIRED]
                .includes(cancellationState(current))) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation reconciliation cannot complete from its current state');
            }
            if (current.provider_booking_id !== providerBookingId || current.provider_event_id !== providerEventId) {
                throw apiError(ErrorCodes.CONFLICT, 'Provider cancellation evidence does not match the booking');
            }
            const cancellationDeliveryId = `cnd_${crypto.createHash('sha256').update(current.operation_id).digest('hex')}`;
            const update = {
                cancellation_state: CANCELLATION_STATES.CANCELLED,
                cancellation_provider_booking_id: providerBookingId,
                cancellation_provider_event_id: providerEventId,
                cancellation_provider_request_id: null,
                cancellation_reconciliation_evidence: reconciliationEvidence,
                cancellation_provider_reconciled_at: timestamp(at),
                cancellation_cancelled_at: timestamp(at),
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: false,
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING,
                cancellation_delivery_id: cancellationDeliveryId,
                cancellation_delivery_attempt_count: 0,
                cancellation_delivery_attempt_id: null,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                cancellation_delivery_provider_message_id: null,
                cancellation_delivery_reconciliation_required: false,
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function markCancellationReconciliationRequired(input) {
        const failureCode = assertSafeCode(input && input.failure_code, 'cancellation_failure_code');
        return transitionCancellation(
            input,
            [CANCELLATION_STATES.PENDING, CANCELLATION_STATES.CANCELLING],
            CANCELLATION_STATES.RECONCILIATION_REQUIRED,
            {
                cancellation_failure_code: failureCode,
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: true,
                cancellation_reconciliation_required_at: timestamp(currentTime())
            }
        );
    }

    async function markCancellationPreflightFailed(input) {
        const failureCode = assertSafeCode(input && input.failure_code, 'cancellation_failure_code');
        return transitionCancellation(
            input,
            [CANCELLATION_STATES.PENDING],
            CANCELLATION_STATES.CONFIRMED,
            {
                cancellation_failure_code: failureCode,
                cancellation_idempotency_key_digest: null,
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: false,
                cancellation_preflight_failed_at: timestamp(currentTime())
            }
        );
    }

    async function markCancellationProviderRejected(input) {
        const failureCode = assertSafeCode(input && input.failure_code, 'cancellation_failure_code');
        return transitionCancellation(
            input,
            [CANCELLATION_STATES.CANCELLING],
            CANCELLATION_STATES.CONFIRMED,
            {
                cancellation_failure_code: failureCode,
                cancellation_idempotency_key_digest: null,
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: false,
                cancellation_provider_rejected_at: timestamp(currentTime())
            }
        );
    }

    async function claimCancellationDelivery(bookingIdempotencyKey) {
        const { ref } = operationReference(bookingIdempotencyKey);
        const deliveryToken = claimTokenGenerator();
        const deliveryTokenDigest = crypto.createHash('sha256').update(deliveryToken).digest('hex');
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
            if (cancellationState(current) !== CANCELLATION_STATES.CANCELLED) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is not ready');
            }
            if (current.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENT) {
                return { action: 'already_sent', delivery_authorized: false };
            }
            if (current.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED) {
                return {
                    action: 'reconcile',
                    delivery_authorized: false,
                    cancellation_delivery_id: current.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: current.cancellation_delivery_attempt_id
                };
            }
            const leaseActive = current.cancellation_delivery_lease_expires_at
                && storedDate(current.cancellation_delivery_lease_expires_at, 'cancellation_delivery_lease_expires_at')
                    .getTime() > at.getTime();
            if (current.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENDING) {
                if (!leaseActive) {
                    transaction.update(ref, {
                        cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                        cancellation_delivery_token_digest: null,
                        cancellation_delivery_lease_expires_at: null,
                        cancellation_delivery_reconciliation_required: true,
                        updated_at: timestamp(at)
                    });
                    return {
                        action: 'reconcile',
                        delivery_authorized: false,
                        cancellation_delivery_id: current.cancellation_delivery_id,
                        cancellation_delivery_attempt_id: current.cancellation_delivery_attempt_id
                    };
                }
                return { action: 'in_progress', delivery_authorized: false };
            }
            if (current.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.CLAIMED && leaseActive) {
                return { action: 'in_progress', delivery_authorized: false };
            }
            if (![CONFIRMATION_DELIVERY_STATES.PENDING, CONFIRMATION_DELIVERY_STATES.CLAIMED]
                .includes(current.cancellation_delivery_state)) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication state is invalid');
            }
            assertCancellationDeliveryLeaseWithinRetention(current, at);
            const attemptCount = current.cancellation_delivery_attempt_count || 0;
            if (!Number.isInteger(attemptCount) || attemptCount < 0
                || attemptCount >= MAX_CONFIRMATION_DELIVERY_ATTEMPTS) {
                transaction.update(ref, {
                    cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    cancellation_delivery_token_digest: null,
                    cancellation_delivery_lease_expires_at: null,
                    cancellation_delivery_reconciliation_required: true,
                    updated_at: timestamp(at)
                });
                return {
                    action: 'reconcile',
                    delivery_authorized: false,
                    cancellation_delivery_id: current.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: current.cancellation_delivery_attempt_id
                };
            }
            const attemptId = assertSafeDocumentId(idGenerator('cda'), 'cancellation_delivery_attempt_id');
            transaction.update(ref, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.CLAIMED,
                cancellation_delivery_attempt_count: attemptCount + 1,
                cancellation_delivery_attempt_id: attemptId,
                cancellation_delivery_token_digest: deliveryTokenDigest,
                cancellation_delivery_claimed_at: timestamp(at),
                cancellation_delivery_lease_expires_at: timestamp(new Date(at.getTime() + CONFIRMATION_DELIVERY_LEASE_MS)),
                cancellation_delivery_reconciliation_required: false,
                updated_at: timestamp(at)
            });
            return {
                action: 'prepare',
                delivery_prepare_authorized: true,
                delivery_token: deliveryToken,
                cancellation_delivery_id: current.cancellation_delivery_id,
                cancellation_delivery_attempt_id: attemptId
            };
        }));
    }

    async function beginCancellationDelivery(input) {
        assertNoSecretFields(input);
        const { ref } = operationReference(input && input.booking_idempotency_key);
        const digest = crypto.createHash('sha256').update(String(input && input.delivery_token || '')).digest('hex');
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            assertCancellationDeliveryLeaseWithinRetention(current, at);
            const expected = Buffer.from(String(current.cancellation_delivery_token_digest || ''), 'utf8');
            const actual = Buffer.from(digest, 'utf8');
            const leaseActive = current.cancellation_delivery_lease_expires_at
                && storedDate(current.cancellation_delivery_lease_expires_at, 'cancellation_delivery_lease_expires_at')
                    .getTime() > at.getTime();
            if (cancellationState(current) !== CANCELLATION_STATES.CANCELLED
                || current.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.CLAIMED
                || current.cancellation_delivery_attempt_id !== input.delivery_attempt_id
                || !leaseActive || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is owned by another execution');
            }
            transaction.update(ref, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENDING,
                cancellation_delivery_started_at: timestamp(at),
                cancellation_delivery_lease_expires_at: timestamp(new Date(at.getTime() + CONFIRMATION_DELIVERY_LEASE_MS)),
                updated_at: timestamp(at)
            });
            return {
                action: 'send',
                delivery_authorized: true,
                delivery_token: input.delivery_token,
                cancellation_delivery_id: current.cancellation_delivery_id,
                cancellation_delivery_attempt_id: current.cancellation_delivery_attempt_id
            };
        }));
    }

    async function transitionCancellationDelivery(input, nextState, fields = {}) {
        assertNoSecretFields(input);
        assertNoSecretFields(fields);
        const { ref } = operationReference(input && input.booking_idempotency_key);
        const digest = crypto.createHash('sha256').update(String(input && input.delivery_token || '')).digest('hex');
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            const expected = Buffer.from(String(current.cancellation_delivery_token_digest || ''), 'utf8');
            const actual = Buffer.from(digest, 'utf8');
            if (cancellationState(current) !== CANCELLATION_STATES.CANCELLED
                || current.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.SENDING
                || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is owned by another execution');
            }
            const update = Object.assign({}, fields, {
                cancellation_delivery_state: nextState,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                cancellation_delivery_reconciliation_required: nextState !== CONFIRMATION_DELIVERY_STATES.SENT,
                updated_at: timestamp(at)
            });
            if (nextState === CONFIRMATION_DELIVERY_STATES.SENT) {
                update.cancellation_delivery_sent_at = timestamp(at);
            } else {
                update.cancellation_delivery_outcome_unknown_at = timestamp(at);
            }
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function markCancellationDeliverySent(input) {
        const providerMessageId = input && input.provider_message_id
            ? normalizeProviderIdentifier(input.provider_message_id, 'provider_message_id')
            : null;
        return transitionCancellationDelivery(input, CONFIRMATION_DELIVERY_STATES.SENT, {
            cancellation_delivery_provider_message_id: providerMessageId
        });
    }

    async function markCancellationDeliveryOutcomeUnknown(input) {
        return transitionCancellationDelivery(input, CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED);
    }

    async function reconcileCancellationDelivery(input) {
        assertNoSecretFields(input);
        const { ref } = operationReference(input && input.booking_idempotency_key);
        const deliveryAttemptId = assertSafeDocumentId(
            input && input.delivery_attempt_id,
            'cancellation_delivery_attempt_id'
        );
        const requestedEvidenceId = input && input.reconciliation_evidence_id
            ? assertSafeDocumentId(
                input.reconciliation_evidence_id,
                'cancellation_delivery_reconciliation_evidence_id'
            )
            : null;
        const preflightAt = currentTime();
        const preflightSnapshot = await databaseCall(() => ref.get());
        if (!preflightSnapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
        const preflight = preflightSnapshot.data();
        if (isExpired(preflight, preflightAt)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
        if (cancellationState(preflight) !== CANCELLATION_STATES.CANCELLED
            || preflight.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
            || preflight.cancellation_delivery_attempt_id !== deliveryAttemptId) {
            throw apiError(ErrorCodes.CONFLICT, 'Cancellation delivery cannot be reconciled from its current state');
        }
        if (!verifyCancellationDeliveryEvidence) {
            throw apiError(ErrorCodes.CONFLICT, 'Trusted cancellation delivery evidence verification is required');
        }
        let verified;
        try {
            verified = await verifyCancellationDeliveryEvidence({
                provider: 'sendgrid',
                reconciliation_evidence_id: requestedEvidenceId,
                expected: {
                    cancellation_delivery_id: preflight.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: deliveryAttemptId
                }
            });
        } catch (_) {
            throw apiError(ErrorCodes.CONFLICT, 'Cancellation delivery evidence could not be verified');
        }
        assertNoSecretFields(verified);
        const outcome = assertSafeCode(verified && verified.outcome, 'cancellation_delivery_outcome');
        const providerMessageId = normalizeProviderIdentifier(
            verified && verified.provider_message_id,
            'provider_message_id'
        );
        const verifiedEvidenceId = assertSafeDocumentId(
            verified && verified.reconciliation_evidence_id,
            'cancellation_delivery_reconciliation_evidence_id'
        );
        const customArgs = verified && verified.custom_args;
        if (!['ACCEPTED', 'DELIVERED'].includes(outcome)
            || (requestedEvidenceId && verifiedEvidenceId !== requestedEvidenceId)
            || !customArgs || typeof customArgs !== 'object' || Array.isArray(customArgs)
            || customArgs.synchintro_cancellation_id !== preflight.cancellation_delivery_id
            || customArgs.synchintro_cancellation_delivery_attempt_id !== deliveryAttemptId) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Ambiguous cancellation delivery cannot be retried without definitive provider evidence'
            );
        }
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking not found');
            const current = snapshot.data();
            const at = currentTime();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking management capability has expired');
            if (cancellationState(current) !== CANCELLATION_STATES.CANCELLED
                || current.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                || current.cancellation_delivery_attempt_id !== deliveryAttemptId
                || current.cancellation_delivery_id !== preflight.cancellation_delivery_id) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation delivery cannot be reconciled from its current state');
            }
            const update = {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                cancellation_delivery_provider_message_id: providerMessageId,
                cancellation_delivery_reconciliation_evidence_id: verifiedEvidenceId,
                cancellation_delivery_reconciliation_outcome: outcome,
                cancellation_delivery_reconciliation_required: false,
                cancellation_delivery_reconciled_at: timestamp(at),
                cancellation_delivery_sent_at: current.cancellation_delivery_sent_at || timestamp(at),
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function claimConfirmationDelivery(idempotencyKey) {
        const { ref } = operationReference(idempotencyKey);
        const deliveryToken = claimTokenGenerator();
        const deliveryTokenDigest = crypto.createHash('sha256').update(deliveryToken).digest('hex');
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
            if (current.state !== OPERATION_STATES.CONFIRMED || !current.confirmed_result) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation is not ready for delivery');
            }
            if (cancellationState(current) !== CANCELLATION_STATES.CONFIRMED) {
                return {
                    action: 'suppressed_by_cancellation',
                    cancellation_state: cancellationState(current),
                    delivery_authorized: false
                };
            }
            if (current.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENT) {
                return { action: 'already_sent', delivery_authorized: false };
            }
            if (current.confirmation_delivery_state === null || current.confirmation_delivery_state === undefined) {
                return { action: 'legacy', delivery_authorized: false };
            }
            if (current.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                || current.confirmation_delivery_state === 'OUTCOME_UNKNOWN') {
                const confirmationDeliveryId = current.confirmation_delivery_id
                    || `cnf_${crypto.createHash('sha256').update(current.operation_id).digest('hex')}`;
                const deliveryAttemptId = current.delivery_attempt_id
                    || `dla_legacy_${crypto.createHash('sha256')
                        .update(`${current.operation_id}:confirmation-attempt`)
                        .digest('hex')}`;
                if (current.confirmation_delivery_state !== CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                    || !current.confirmation_delivery_id || !current.delivery_attempt_id) {
                    transaction.update(ref, {
                        confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                        confirmation_delivery_id: confirmationDeliveryId,
                        delivery_attempt_id: deliveryAttemptId,
                        delivery_token_digest: null,
                        delivery_lease_expires_at: null,
                        delivery_reconciliation_required: true,
                        updated_at: timestamp(at)
                    });
                }
                return {
                    action: 'reconcile',
                    delivery_authorized: false,
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    confirmation_delivery_id: confirmationDeliveryId,
                    delivery_attempt_id: deliveryAttemptId
                };
            }
            const lease = current.delivery_lease_expires_at;
            const leaseActive = lease
                && storedDate(lease, 'delivery_lease_expires_at').getTime() > at.getTime();
            if (current.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENDING) {
                if (leaseActive) return { action: 'in_progress', delivery_authorized: false };
                const confirmationDeliveryId = current.confirmation_delivery_id
                    || `cnf_${crypto.createHash('sha256').update(current.operation_id).digest('hex')}`;
                const deliveryAttemptId = current.delivery_attempt_id
                    || `dla_legacy_${crypto.createHash('sha256')
                        .update(`${current.operation_id}:confirmation-attempt`)
                        .digest('hex')}`;
                const reconciliation = {
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    confirmation_delivery_id: confirmationDeliveryId,
                    delivery_attempt_id: deliveryAttemptId,
                    delivery_token_digest: null,
                    delivery_lease_expires_at: null,
                    delivery_reconciliation_required: true,
                    delivery_outcome_unknown_at: timestamp(at),
                    updated_at: timestamp(at)
                };
                transaction.update(ref, reconciliation);
                return {
                    action: 'reconcile',
                    delivery_authorized: false,
                    confirmation_delivery_state: reconciliation.confirmation_delivery_state,
                    confirmation_delivery_id: confirmationDeliveryId,
                    delivery_attempt_id: deliveryAttemptId
                };
            }
            if (current.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.CLAIMED && leaseActive) {
                return { action: 'in_progress', delivery_authorized: false };
            }
            if (![CONFIRMATION_DELIVERY_STATES.PENDING, CONFIRMATION_DELIVERY_STATES.CLAIMED]
                .includes(current.confirmation_delivery_state)) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation delivery state is invalid');
            }
            const attemptCount = current.confirmation_delivery_attempt_count === undefined
                ? 0
                : current.confirmation_delivery_attempt_count;
            if (!Number.isInteger(attemptCount) || attemptCount < 0) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation delivery attempt count is invalid');
            }
            if (attemptCount >= MAX_CONFIRMATION_DELIVERY_ATTEMPTS) {
                const reconciliation = {
                    confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                    delivery_token_digest: null,
                    delivery_lease_expires_at: null,
                    delivery_reconciliation_required: true,
                    delivery_reconciliation_reason: 'pre_egress_attempt_limit',
                    updated_at: timestamp(at)
                };
                transaction.update(ref, reconciliation);
                return {
                    action: 'reconcile',
                    delivery_authorized: false,
                    confirmation_delivery_state: reconciliation.confirmation_delivery_state
                };
            }
            const deliveryAttemptId = assertSafeDocumentId(idGenerator('dla'), 'delivery_attempt_id');
            const confirmationDeliveryId = current.confirmation_delivery_id
                || `cnf_${crypto.createHash('sha256').update(current.operation_id).digest('hex')}`;
            transaction.update(ref, {
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.CLAIMED,
                confirmation_delivery_id: confirmationDeliveryId,
                confirmation_delivery_attempt_count: attemptCount + 1,
                delivery_attempt_id: deliveryAttemptId,
                delivery_token_digest: deliveryTokenDigest,
                delivery_claimed_at: timestamp(at),
                delivery_lease_expires_at: timestamp(new Date(at.getTime() + CONFIRMATION_DELIVERY_LEASE_MS)),
                delivery_reconciliation_required: false,
                updated_at: timestamp(at)
            });
            return {
                action: 'prepare',
                delivery_authorized: false,
                delivery_prepare_authorized: true,
                delivery_token: deliveryToken,
                confirmation_delivery_id: confirmationDeliveryId,
                delivery_attempt_id: deliveryAttemptId
            };
        }));
    }

    async function beginConfirmationDelivery(input) {
        assertNoSecretFields(input);
        const { ref } = operationReference(input && input.idempotency_key);
        const digest = crypto.createHash('sha256').update(String(input && input.delivery_token || '')).digest('hex');
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            const expected = Buffer.from(String(current.delivery_token_digest || ''), 'utf8');
            const actual = Buffer.from(digest, 'utf8');
            const leaseActive = current.delivery_lease_expires_at
                && storedDate(current.delivery_lease_expires_at, 'delivery_lease_expires_at').getTime() > at.getTime();
            if (current.state !== OPERATION_STATES.CONFIRMED
                || current.confirmation_delivery_state !== CONFIRMATION_DELIVERY_STATES.CLAIMED
                || !leaseActive
                || current.delivery_attempt_id !== input.delivery_attempt_id
                || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation delivery is owned by another execution');
            }
            if (cancellationState(current) !== CANCELLATION_STATES.CONFIRMED) {
                return {
                    action: 'suppressed_by_cancellation',
                    cancellation_state: cancellationState(current),
                    delivery_authorized: false
                };
            }
            const update = {
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENDING,
                delivery_started_at: timestamp(at),
                delivery_lease_expires_at: timestamp(new Date(at.getTime() + CONFIRMATION_DELIVERY_LEASE_MS)),
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return {
                action: 'send',
                delivery_authorized: true,
                delivery_token: input.delivery_token,
                confirmation_delivery_id: current.confirmation_delivery_id,
                delivery_attempt_id: current.delivery_attempt_id
            };
        }));
    }

    async function transitionConfirmationDelivery(idempotencyKey, deliveryToken, nextState, fields = {}) {
        assertNoSecretFields(fields);
        const { ref } = operationReference(idempotencyKey);
        const digest = crypto.createHash('sha256').update(String(deliveryToken || '')).digest('hex');
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            const expected = Buffer.from(String(current.delivery_token_digest || ''), 'utf8');
            const actual = Buffer.from(digest, 'utf8');
            if (current.state !== OPERATION_STATES.CONFIRMED
                || current.confirmation_delivery_state !== CONFIRMATION_DELIVERY_STATES.SENDING
                || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation delivery is owned by another execution');
            }
            const update = Object.assign({}, fields, {
                confirmation_delivery_state: nextState,
                delivery_token_digest: null,
                delivery_lease_expires_at: null,
                updated_at: timestamp(at)
            });
            if (nextState === CONFIRMATION_DELIVERY_STATES.SENT) {
                update.delivery_sent_at = timestamp(at);
                update.delivery_reconciliation_required = false;
            } else {
                update.delivery_outcome_unknown_at = timestamp(at);
                update.delivery_reconciliation_required = true;
            }
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    async function markConfirmationDeliverySent(input) {
        const providerMessageId = input && input.provider_message_id
            ? normalizeProviderIdentifier(input.provider_message_id, 'provider_message_id')
            : null;
        return transitionConfirmationDelivery(
            input.idempotency_key,
            input.delivery_token,
            CONFIRMATION_DELIVERY_STATES.SENT,
            { delivery_provider_message_id: providerMessageId }
        );
    }

    async function markConfirmationDeliveryOutcomeUnknown(input) {
        return transitionConfirmationDelivery(
            input.idempotency_key,
            input.delivery_token,
            CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
        );
    }

    async function reconcileConfirmationDelivery(input) {
        assertNoSecretFields(input);
        const { ref } = operationReference(input && input.idempotency_key);
        const deliveryAttemptId = assertSafeDocumentId(
            input && input.delivery_attempt_id,
            'delivery_attempt_id'
        );
        const evidenceId = assertSafeDocumentId(
            input && input.reconciliation_evidence_id,
            'reconciliation_evidence_id'
        );
        const providerMessageId = normalizeProviderIdentifier(
            input && input.provider_message_id,
            'provider_message_id'
        );
        const outcome = assertSafeCode(input && input.outcome, 'delivery_outcome');
        if (!['ACCEPTED', 'DELIVERED'].includes(outcome)) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Ambiguous confirmation delivery cannot be retried without definitive provider evidence'
            );
        }
        const at = currentTime();
        return databaseCall(() => db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Booking operation not found');
            const current = snapshot.data();
            if (isExpired(current, at)) throw apiError(ErrorCodes.EXPIRED, 'Booking operation retention window has expired');
            if (current.state !== OPERATION_STATES.CONFIRMED
                || ![CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED, 'OUTCOME_UNKNOWN']
                    .includes(current.confirmation_delivery_state)
                || current.delivery_attempt_id !== deliveryAttemptId) {
                throw apiError(ErrorCodes.CONFLICT, 'Booking confirmation delivery cannot be reconciled from its current state');
            }
            const update = {
                confirmation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                delivery_provider_message_id: providerMessageId,
                delivery_reconciliation_evidence_id: evidenceId,
                delivery_reconciliation_outcome: outcome,
                delivery_reconciliation_required: false,
                delivery_reconciled_at: timestamp(at),
                delivery_sent_at: current.delivery_sent_at || timestamp(at),
                delivery_token_digest: null,
                delivery_lease_expires_at: null,
                updated_at: timestamp(at)
            };
            transaction.update(ref, update);
            return Object.assign({}, sanitizeOperation(current), update);
        }));
    }

    return Object.freeze({
        createSession,
        createSessionWithCapability,
        authorizeSessionCapability,
        authorizeBookingCapability,
        readSession,
        updateSession,
        createAvailabilityReceipt,
        validateIssuedSlot,
        claimBookingOperation,
        beginProviderAttempt,
        recordProviderIdentifiers,
        confirmBookingOperation,
        markBookingFailed,
        markBookingOutcomeUnknown,
        claimBookingReconciliation,
        readBookingOperation,
        authorizeCancellationCapability,
        claimCancellationOperation,
        beginCancellationProviderAttempt,
        markBookingCancelled,
        markBookingCancellationReconciled,
        markCancellationReconciliationRequired,
        markCancellationPreflightFailed,
        markCancellationProviderRejected,
        claimCancellationDelivery,
        beginCancellationDelivery,
        markCancellationDeliverySent,
        markCancellationDeliveryOutcomeUnknown,
        reconcileCancellationDelivery,
        claimConfirmationDelivery,
        beginConfirmationDelivery,
        markConfirmationDeliverySent,
        markConfirmationDeliveryOutcomeUnknown,
        reconcileConfirmationDelivery
    });
}

module.exports = {
    COLLECTIONS,
    SESSION_STATES,
    OPERATION_STATES,
    CANCELLATION_STATES,
    RETENTION_MS,
    OPERATION_LEASE_MS,
    CONFIRMATION_DELIVERY_LEASE_MS,
    MAX_CONFIRMATION_DELIVERY_ATTEMPTS,
    CONFIRMATION_DELIVERY_STATES,
    createBookingPersistence
};
