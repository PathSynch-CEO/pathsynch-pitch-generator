'use strict';

const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');
const {
    CONFIRMATION_DELIVERY_STATES,
    CANCELLATION_STATES,
    OPERATION_LEASE_MS,
    normalizeProviderIdentifier,
    sanitizeOperation,
    storedDate
} = require('./bookingPersistenceSchema');
const {
    digest,
    operationDocumentId
} = require('./bookingRecoveryAllowlist');

const COLLECTIONS = Object.freeze({
    OPERATIONS: 'synchintroBookingOperations',
    SESSIONS: 'synchintroBookingSessions',
    RECOVERIES: 'synchintroSyntheticRecoveryOperations',
    RECEIPTS: 'synchintroSyntheticRecoveryReceipts'
});
const RECOVERY_STATES = Object.freeze({
    CLAIMED: 'CLAIMED',
    PROVIDER_ATTEMPTING: 'PROVIDER_ATTEMPTING',
    PROVIDER_CANCELLED: 'PROVIDER_CANCELLED',
    COMMUNICATION_PENDING: 'COMMUNICATION_PENDING',
    COMPLETE: 'COMPLETE',
    RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
    MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED'
});
const RETENTION_POLICY = Object.freeze({
    recovery_state_days: 90,
    audit_receipt_months: 24,
    actor_metadata_months: 24
});
const PLANNED_ACTIONS = new Set([
    'SCHEDULER_BOOKING_DELETE',
    'LOCAL_RECONCILIATION_ONLY',
    'SEND_CONTROLLED_SYNTHETIC_CANCELLATION',
    'COMMUNICATION_EVIDENCE_ONLY',
    'NONE'
]);
const RECOVERY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const RECEIPT_FIELDS = new Set([
    'schema', 'work_package', 'reference', 'source_work_package',
    'operation_document_id_digest', 'session_id_digest', 'workspace_id_digest',
    'allowlist_identity_digest', 'allowlist_evidence', 'intent',
    'pre_state_classification', 'planned_action', 'provider_action_attempted',
    'provider_action_count', 'provider_outcome', 'durable_state_transition',
    'communication_action_attempted', 'communication_action_count',
    'communication_outcome', 'replay_result', 'final_classification'
]);

function apiError(code, message, reason) {
    return new ApiError(code, message, reason ? { reason } : null);
}

function timingSafeDigestEqual(actual, expected) {
    const left = Buffer.from(String(actual || ''), 'utf8');
    const right = Buffer.from(String(expected || ''), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function exactDigest(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeRecoveryOperationId(value) {
    const normalized = String(value || '').trim();
    if (!RECOVERY_ID.test(normalized)) {
        throw apiError(ErrorCodes.INVALID_INPUT, 'Recovery operation ID is invalid', 'invalid_recovery_operation_id');
    }
    return normalized;
}

function addUtcMonths(date, months) {
    const result = new Date(date.getTime());
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
}

function recoveryRetentionFields(state, completedAt) {
    if (state !== RECOVERY_STATES.COMPLETE) return {};
    return {
        retention_eligible_at: new Date(
            completedAt.getTime() + RETENTION_POLICY.recovery_state_days * 24 * 60 * 60 * 1000
        )
    };
}

function receiptRetentionFields(finalClassification, completedAt) {
    if (finalClassification !== 'ALREADY_CLEAN') return {};
    return { retention_eligible_at: addUtcMonths(completedAt, RETENTION_POLICY.audit_receipt_months) };
}

function defaultPlannedAction(classification) {
    if (classification === 'CANCEL_REQUIRED') return 'SCHEDULER_BOOKING_DELETE';
    if (classification === 'PROVIDER_RECONCILIATION_REQUIRED') return 'LOCAL_RECONCILIATION_ONLY';
    if (classification === 'COMMUNICATION_RECONCILIATION_REQUIRED') {
        return 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION';
    }
    return 'NONE';
}

function createBookingRecoveryPersistence(options = {}) {
    const db = options.db || admin.firestore();
    const now = options.now || (() => new Date());
    const timestampFromDate = options.timestampFromDate || ((date) => Timestamp.fromDate(date));
    const tokenGenerator = options.tokenGenerator || (() => crypto.randomBytes(32).toString('base64url'));
    const idGenerator = options.idGenerator || ((prefix) => `${prefix}_${crypto.randomBytes(18).toString('base64url')}`);

    const timestamp = (date) => timestampFromDate(new Date(date.getTime()));
    const currentTime = () => new Date(now().getTime());
    const operationRef = (entry) => db.collection(COLLECTIONS.OPERATIONS).doc(operationDocumentId(entry));
    const recoveryDigest = (id) => exactDigest(normalizeRecoveryOperationId(id));
    const recoveryRef = (id) => db.collection(COLLECTIONS.RECOVERIES).doc(`rec_${recoveryDigest(id)}`);
    const receiptRef = (id) => db.collection(COLLECTIONS.RECEIPTS).doc(`rrc_${recoveryDigest(id)}`);

    function validateBoundDocuments(entry, operation, session) {
        const operationId = operationDocumentId(entry);
        const workspaceId = session?.routing_state?.workspace_id;
        if (!operation || operation.operation_id !== operationId
            || operation.idempotency_key_digest !== entry.idempotency_key_digest
            || !timingSafeDigestEqual(digest(operationId), entry.operation_document_id_digest)
            || !operation.session_id
            || !timingSafeDigestEqual(digest(operation.session_id), entry.session_id_digest)
            || !session || session.booking_operation_id !== operationId
            || !workspaceId
            || !timingSafeDigestEqual(digest(workspaceId), entry.workspace_id_digest)
            || !operation.confirmation_identity?.email
            || !timingSafeDigestEqual(digest(operation.confirmation_identity.email), entry.synthetic_identity_digest)
            || operation.provider_reference?.provider !== 'nylas'
            || !timingSafeDigestEqual(
                digest(operation.provider_reference?.configuration_id),
                entry.provider_configuration_digest
            )
            || operation.state !== 'CONFIRMED'
            || !operation.confirmed_result
            || operation.confirmed_result.booking_id !== operation.provider_booking_id
            || operation.confirmed_result.event_id !== operation.provider_event_id) {
            throw apiError(
                ErrorCodes.AUTHORIZATION_ERROR,
                'Governed synthetic binding does not match durable state',
                'synthetic_allowlist_binding_mismatch'
            );
        }
        return {
            operation: sanitizeOperation(operation),
            session: {
                session_id: session.session_id,
                booking_operation_id: session.booking_operation_id,
                routing_state: session.routing_state
            },
            binding: {
                operation_document_id_digest: digest(operationId),
                session_id_digest: digest(operation.session_id),
                workspace_id_digest: digest(workspaceId),
                synthetic_identity_digest: digest(operation.confirmation_identity.email),
                provider_configuration_digest: digest(operation.provider_reference.configuration_id)
            }
        };
    }

    async function loadBoundOperation(entry) {
        const opRef = operationRef(entry);
        const opSnapshot = await opRef.get();
        if (!opSnapshot.exists) {
            throw apiError(ErrorCodes.NOT_FOUND, 'Governed synthetic booking not found', 'allowlisted_operation_missing');
        }
        const operation = opSnapshot.data();
        const sessionSnapshot = await db.collection(COLLECTIONS.SESSIONS).doc(operation.session_id).get();
        return validateBoundDocuments(entry, operation, sessionSnapshot.exists ? sessionSnapshot.data() : null);
    }

    function assertExecutionBinding(record, entry, actor, recoveryOperationId) {
        const expectedDigest = recoveryDigest(recoveryOperationId);
        if (!record
            || record.recovery_operation_digest !== expectedDigest
            || record.reference !== entry.reference
            || record.operation_document_id !== operationDocumentId(entry)
            || record.intent !== entry.intent
            || record.actor_uid_digest !== actor.uid_digest
            || record.actor_email_digest !== actor.email_digest) {
            throw apiError(ErrorCodes.CONFLICT, 'Recovery operation identity was reused', 'recovery_idempotency_conflict');
        }
    }

    function assertClaim(record, claimToken) {
        const supplied = exactDigest(claimToken);
        if (!record.claim_token_digest || !timingSafeDigestEqual(supplied, record.claim_token_digest)) {
            throw apiError(ErrorCodes.CONFLICT, 'Recovery execution is owned by another worker', 'recovery_claim_mismatch');
        }
    }

    function assertDeliveryExecutionEpoch(record, executionEpoch) {
        const currentEpoch = record && Number.isSafeInteger(record.claim_epoch)
            ? record.claim_epoch
            : 0;
        if (!Number.isSafeInteger(executionEpoch)
            || executionEpoch < 0
            || executionEpoch !== currentEpoch
            || record.receipt_id) {
            throw apiError(
                ErrorCodes.CONFLICT,
                'Cancellation communication execution is stale',
                'recovery_delivery_writer_stale'
            );
        }
    }

    async function claimExecution({ entry, recovery_operation_id: recoveryOperationId, actor, classification,
        planned_action: suppliedPlannedAction }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        const claimToken = tokenGenerator();
        const claimTokenDigest = exactDigest(claimToken);
        const plannedAction = suppliedPlannedAction || defaultPlannedAction(classification);
        if (!PLANNED_ACTIONS.has(plannedAction)) {
            throw apiError(ErrorCodes.INVALID_INPUT, 'Recovery planned action is invalid');
        }
        return db.runTransaction(async (transaction) => {
            const [operationSnapshot, existingSnapshot] = await Promise.all([
                transaction.get(opRef),
                transaction.get(recRef)
            ]);
            if (!operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Governed synthetic booking not found');
            }
            const operation = operationSnapshot.data();
            const sessionSnapshot = await transaction.get(
                db.collection(COLLECTIONS.SESSIONS).doc(operation.session_id)
            );
            validateBoundDocuments(entry, operation, sessionSnapshot.exists ? sessionSnapshot.data() : null);
            const currentCancellation = operation.cancellation_state || CANCELLATION_STATES.CONFIRMED;
            const expectsTerminal = ['ALREADY_CLEAN', 'COMMUNICATION_RECONCILIATION_REQUIRED']
                .includes(classification);
            if ((expectsTerminal && currentCancellation !== CANCELLATION_STATES.CANCELLED)
                || (!expectsTerminal && currentCancellation !== CANCELLATION_STATES.CONFIRMED)) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Booking cancellation state changed during recovery planning',
                    'recovery_pre_state_changed'
                );
            }
            const at = currentTime();
            if (existingSnapshot.exists) {
                const existing = existingSnapshot.data();
                assertExecutionBinding(existing, entry, actor, normalizedId);
                if (!PLANNED_ACTIONS.has(existing.planned_action)) {
                    throw apiError(ErrorCodes.CONFLICT, 'Recovery planned action is unavailable', 'recovery_action_unbound');
                }
                if (existing.receipt_id) {
                    return { action: 'replay', recovery: existing };
                }
                if ([RECOVERY_STATES.COMPLETE, RECOVERY_STATES.MANUAL_REVIEW_REQUIRED]
                    .includes(existing.state)) {
                    return { action: 'finalize_receipt', recovery: existing };
                }
                const leaseActive = existing.claim_lease_expires_at
                    && storedDate(existing.claim_lease_expires_at, 'claim_lease_expires_at').getTime() > at.getTime();
                const deliveryLeaseActive = [
                    CONFIRMATION_DELIVERY_STATES.CLAIMED,
                    CONFIRMATION_DELIVERY_STATES.SENDING
                ].includes(operation.cancellation_delivery_state)
                    && operation.cancellation_delivery_lease_expires_at
                    && storedDate(
                        operation.cancellation_delivery_lease_expires_at,
                        'cancellation_delivery_lease_expires_at'
                    ).getTime() > at.getTime();
                const reconciliationRequired = [
                    RECOVERY_STATES.PROVIDER_ATTEMPTING,
                    RECOVERY_STATES.RECONCILIATION_REQUIRED,
                    RECOVERY_STATES.COMMUNICATION_PENDING
                ].includes(existing.state) || existing.provider_attempt_count > 0;
                if (reconciliationRequired) {
                    if (leaseActive || deliveryLeaseActive) {
                        return { action: 'in_progress', recovery: existing };
                    }
                    const update = {
                        state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                        claim_token_digest: claimTokenDigest,
                        claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                        claim_recovery_count: (existing.claim_recovery_count || 0) + 1,
                        claim_epoch: (existing.claim_epoch || 0) + 1,
                        updated_at: timestamp(at)
                    };
                    transaction.update(recRef, update);
                    transaction.update(opRef, {
                        synthetic_recovery_state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                        synthetic_recovery_updated_at: timestamp(at)
                    });
                    return {
                        action: 'reconcile',
                        claim_token: claimToken,
                        recovery: Object.assign({}, existing, update)
                    };
                }
                if (leaseActive || deliveryLeaseActive) {
                    return { action: 'in_progress', recovery: existing };
                }
                const update = {
                    claim_token_digest: claimTokenDigest,
                    claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                    claim_recovery_count: (existing.claim_recovery_count || 0) + 1,
                    claim_epoch: (existing.claim_epoch || 0) + 1,
                    updated_at: timestamp(at)
                };
                transaction.update(recRef, update);
                return {
                    action: 'resume',
                    claim_token: claimToken,
                    recovery: Object.assign({}, existing, update)
                };
            }
            const recDigest = recoveryDigest(normalizedId);
            let predecessorRecoveryDigest = null;
            if (operation.synthetic_recovery_operation_digest
                && operation.synthetic_recovery_operation_digest !== recDigest) {
                predecessorRecoveryDigest = operation.synthetic_recovery_operation_digest;
                const predecessorSnapshot = await transaction.get(
                    db.collection(COLLECTIONS.RECOVERIES).doc(`rec_${predecessorRecoveryDigest}`)
                );
                const predecessor = predecessorSnapshot.exists ? predecessorSnapshot.data() : null;
                const continuationClassification = [
                    'PROVIDER_RECONCILIATION_REQUIRED',
                    'COMMUNICATION_RECONCILIATION_REQUIRED',
                    'ALREADY_CLEAN'
                ].includes(classification);
                if (!predecessor
                    || predecessor.state !== RECOVERY_STATES.RECONCILIATION_REQUIRED
                    || !predecessor.receipt_id
                    || predecessor.recovery_operation_digest !== predecessorRecoveryDigest
                    || predecessor.reference !== entry.reference
                    || predecessor.operation_document_id !== operationDocumentId(entry)
                    || predecessor.intent !== entry.intent
                    || !continuationClassification
                    || (predecessor.provider_attempt_count || 0) > 1) {
                    throw apiError(
                        ErrorCodes.CONFLICT,
                        'Governed synthetic booking is bound to another recovery operation',
                        'record_recovery_identity_conflict'
                    );
                }
            }
            const record = {
                schema_version: 1,
                work_package: 'SYNCH-P2-0004',
                recovery_operation_digest: recDigest,
                reference: entry.reference,
                source_work_package: entry.work_package,
                operation_document_id: operationDocumentId(entry),
                operation_document_id_digest: entry.operation_document_id_digest,
                session_id_digest: entry.session_id_digest,
                workspace_id_digest: entry.workspace_id_digest,
                synthetic_identity_digest: entry.synthetic_identity_digest,
                provider_configuration_digest: entry.provider_configuration_digest,
                intent: entry.intent,
                actor_uid_digest: actor.uid_digest,
                actor_email_digest: actor.email_digest,
                actor_role: actor.role,
                state: RECOVERY_STATES.CLAIMED,
                pre_state_classification: classification,
                planned_action: plannedAction,
                provider_attempt_count: 0,
                provider_outcome: classification === 'COMMUNICATION_RECONCILIATION_REQUIRED'
                    ? 'ALREADY_CANCELLED'
                    : null,
                communication_attempt_count: 0,
                claim_token_digest: claimTokenDigest,
                claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                claim_recovery_count: 0,
                claim_epoch: 0,
                predecessor_recovery_operation_digest: predecessorRecoveryDigest,
                continuation_mode: predecessorRecoveryDigest ? 'READ_ONLY_RECONCILIATION' : null,
                receipt_id: null,
                retention_policy: 'TERMINAL_STATE_90_DAYS',
                retention_hold: false,
                created_at: timestamp(at),
                updated_at: timestamp(at)
            };
            transaction.set(recRef, record);
            transaction.update(opRef, {
                synthetic_recovery_operation_digest: recDigest,
                synthetic_recovery_reference: entry.reference,
                synthetic_recovery_state: RECOVERY_STATES.CLAIMED,
                synthetic_recovery_updated_at: timestamp(at)
            });
            return { action: 'claim', claim_token: claimToken, recovery: record };
        });
    }

    async function beginProviderAttempt({ entry, recovery_operation_id: recoveryOperationId, actor, claim_token: claimToken }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [snapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!snapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const current = snapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(current, entry, actor, normalizedId);
            assertClaim(current, claimToken);
            const at = currentTime();
            const providerAttemptBound = !current.continuation_mode
                && (operation.cancellation_state || CANCELLATION_STATES.CONFIRMED)
                    === CANCELLATION_STATES.CONFIRMED
                && operation.confirmation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENT
                && operation.synthetic_recovery_operation_digest === current.recovery_operation_digest
                && storedDate(current.claim_lease_expires_at, 'claim_lease_expires_at').getTime() > at.getTime();
            if (current.state === RECOVERY_STATES.PROVIDER_ATTEMPTING
                && current.provider_attempt_count === 1
                && providerAttemptBound) {
                return { provider_cancellation_authorized: true };
            }
            if (current.state !== RECOVERY_STATES.CLAIMED || current.provider_attempt_count !== 0
                || !providerAttemptBound) {
                throw apiError(ErrorCodes.CONFLICT, 'Provider recovery attempt is not authorized', 'provider_attempt_fenced');
            }
            transaction.update(recRef, {
                state: RECOVERY_STATES.PROVIDER_ATTEMPTING,
                provider_attempt_count: 1,
                provider_attempt_started_at: timestamp(at),
                claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            });
            transaction.update(opRef, {
                synthetic_recovery_state: RECOVERY_STATES.PROVIDER_ATTEMPTING,
                synthetic_recovery_provider_attempt_count: 1,
                synthetic_recovery_updated_at: timestamp(at)
            });
            return { provider_cancellation_authorized: true };
        });
    }

    async function markProviderAmbiguous({ entry, recovery_operation_id: recoveryOperationId, actor,
        claim_token: claimToken, failure_code: failureCode }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [snapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!snapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const current = snapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(current, entry, actor, normalizedId);
            assertClaim(current, claimToken);
            const at = currentTime();
            if (current.state !== RECOVERY_STATES.PROVIDER_ATTEMPTING
                || current.provider_attempt_count !== 1
                || operation.synthetic_recovery_operation_digest !== current.recovery_operation_digest
                || (operation.cancellation_state || CANCELLATION_STATES.CONFIRMED)
                    !== CANCELLATION_STATES.CONFIRMED
                || storedDate(current.claim_lease_expires_at, 'claim_lease_expires_at').getTime() <= at.getTime()) {
                throw apiError(ErrorCodes.CONFLICT, 'Provider ambiguity cannot be recorded from this state');
            }
            const update = {
                state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                provider_outcome: 'AMBIGUOUS',
                failure_code: String(failureCode || 'provider_outcome_unknown'),
                claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            };
            transaction.update(recRef, update);
            transaction.update(opRef, {
                synthetic_recovery_state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                synthetic_recovery_failure_code: update.failure_code,
                synthetic_recovery_updated_at: timestamp(at)
            });
            return update;
        });
    }

    async function markProviderRejected({ entry, recovery_operation_id: recoveryOperationId, actor,
        claim_token: claimToken, failure_code: failureCode }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [snapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!snapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const current = snapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(current, entry, actor, normalizedId);
            assertClaim(current, claimToken);
            const at = currentTime();
            if (current.state !== RECOVERY_STATES.PROVIDER_ATTEMPTING
                || current.provider_attempt_count !== 1
                || operation.synthetic_recovery_operation_digest !== current.recovery_operation_digest
                || (operation.cancellation_state || CANCELLATION_STATES.CONFIRMED)
                    !== CANCELLATION_STATES.CONFIRMED
                || storedDate(current.claim_lease_expires_at, 'claim_lease_expires_at').getTime() <= at.getTime()) {
                throw apiError(ErrorCodes.CONFLICT, 'Provider rejection cannot be recorded from this state');
            }
            const update = {
                state: RECOVERY_STATES.MANUAL_REVIEW_REQUIRED,
                provider_outcome: 'DEFINITIVE_REJECTION',
                failure_code: String(failureCode || 'provider_rejected'),
                claim_token_digest: null,
                claim_lease_expires_at: null,
                updated_at: timestamp(at)
            };
            transaction.update(recRef, update);
            transaction.update(opRef, {
                synthetic_recovery_state: RECOVERY_STATES.MANUAL_REVIEW_REQUIRED,
                synthetic_recovery_failure_code: update.failure_code,
                synthetic_recovery_updated_at: timestamp(at)
            });
            return update;
        });
    }

    async function markTerminalCancelled(input) {
        const { entry, actor } = input;
        const normalizedId = normalizeRecoveryOperationId(input.recovery_operation_id);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!recoverySnapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const recovery = recoverySnapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertClaim(recovery, input.claim_token);
            if (typeof input.provider_attempted !== 'boolean'
                || !['CANCELLED', 'RECONCILED_CANCELLED'].includes(input.provider_outcome)
                || (!input.provider_attempted && input.provider_outcome !== 'RECONCILED_CANCELLED')) {
                throw apiError(ErrorCodes.INVALID_INPUT, 'Recovery provider outcome is invalid');
            }
            const at = currentTime();
            const allowed = input.provider_attempted
                ? [RECOVERY_STATES.PROVIDER_ATTEMPTING, RECOVERY_STATES.RECONCILIATION_REQUIRED]
                    .includes(recovery.state) && recovery.provider_attempt_count === 1
                : [RECOVERY_STATES.CLAIMED, RECOVERY_STATES.RECONCILIATION_REQUIRED].includes(recovery.state);
            if (!allowed
                || (operation.cancellation_state || CANCELLATION_STATES.CONFIRMED)
                    !== CANCELLATION_STATES.CONFIRMED
                || operation.synthetic_recovery_operation_digest !== recovery.recovery_operation_digest
                || operation.provider_booking_id !== operation.confirmed_result?.booking_id
                || operation.provider_event_id !== operation.confirmed_result?.event_id
                || storedDate(recovery.claim_lease_expires_at, 'claim_lease_expires_at').getTime() <= at.getTime()) {
                throw apiError(ErrorCodes.CONFLICT, 'Terminal recovery transition is fenced');
            }
            const deliveryId = operation.cancellation_delivery_id
                || `cnd_${crypto.createHash('sha256').update(operation.operation_id).digest('hex')}`;
            const providerRequestId = input.provider_request_id
                ? normalizeProviderIdentifier(input.provider_request_id, 'provider_request_id')
                : null;
            const operationUpdate = {
                cancellation_state: CANCELLATION_STATES.CANCELLED,
                cancellation_provider_booking_id: operation.provider_booking_id,
                cancellation_provider_event_id: operation.provider_event_id,
                cancellation_provider_request_id: providerRequestId,
                cancellation_reconciliation_evidence: input.reconciliation_evidence,
                cancellation_cancelled_at: timestamp(at),
                cancellation_claim_token_digest: null,
                cancellation_claim_lease_expires_at: null,
                cancellation_reconciliation_required: false,
                cancellation_attempt_count: input.provider_attempted ? 1 : (operation.cancellation_attempt_count || 0),
                cancellation_delivery_state: operation.cancellation_delivery_state
                    || CONFIRMATION_DELIVERY_STATES.PENDING,
                cancellation_delivery_id: deliveryId,
                cancellation_delivery_attempt_count: operation.cancellation_delivery_attempt_count || 0,
                cancellation_delivery_attempt_id: operation.cancellation_delivery_attempt_id || null,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                cancellation_delivery_reconciliation_required: false,
                synthetic_recovery_state: RECOVERY_STATES.COMMUNICATION_PENDING,
                synthetic_recovery_updated_at: timestamp(at),
                updated_at: timestamp(at)
            };
            transaction.update(opRef, operationUpdate);
            transaction.update(recRef, {
                state: RECOVERY_STATES.COMMUNICATION_PENDING,
                provider_outcome: input.provider_outcome,
                provider_reconciliation_evidence: input.reconciliation_evidence,
                claim_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            });
            return sanitizeOperation(Object.assign({}, operation, operationUpdate));
        });
    }

    async function markAlreadyClean({ entry, recovery_operation_id: recoveryOperationId, actor, claim_token: claimToken }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [snapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!snapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const current = snapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(current, entry, actor, normalizedId);
            assertClaim(current, claimToken);
            if (current.state !== RECOVERY_STATES.CLAIMED || current.provider_attempt_count !== 0
                || operation.cancellation_state !== CANCELLATION_STATES.CANCELLED
                || operation.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.SENT
                || operation.synthetic_recovery_operation_digest !== current.recovery_operation_digest) {
                throw apiError(ErrorCodes.CONFLICT, 'Already-clean transition is fenced');
            }
            const at = currentTime();
            transaction.update(recRef, {
                state: RECOVERY_STATES.COMPLETE,
                provider_outcome: 'ALREADY_CANCELLED',
                communication_outcome: 'ALREADY_SETTLED',
                claim_token_digest: null,
                claim_lease_expires_at: null,
                completed_at: timestamp(at),
                updated_at: timestamp(at)
            });
            transaction.update(opRef, {
                synthetic_recovery_state: RECOVERY_STATES.COMPLETE,
                synthetic_recovery_updated_at: timestamp(at)
            });
        });
    }

    async function claimDelivery({ entry, recovery_operation_id: recoveryOperationId, actor,
        execution_epoch: executionEpoch }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        const deliveryToken = tokenGenerator();
        const deliveryTokenDigest = exactDigest(deliveryToken);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            if (!recoverySnapshot.exists || !operationSnapshot.exists) {
                throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            }
            const recovery = recoverySnapshot.data();
            const operation = operationSnapshot.data();
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertDeliveryExecutionEpoch(recovery, executionEpoch);
            if (operation.cancellation_state !== CANCELLATION_STATES.CANCELLED) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is not ready');
            }
            if (operation.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENT) {
                if (recovery.state !== RECOVERY_STATES.COMPLETE) {
                    const at = currentTime();
                    transaction.update(recRef, {
                        state: RECOVERY_STATES.COMPLETE,
                        communication_outcome: 'ALREADY_SENT',
                        claim_token_digest: null,
                        claim_lease_expires_at: null,
                        completed_at: timestamp(at),
                        updated_at: timestamp(at)
                    });
                    transaction.update(opRef, {
                        synthetic_recovery_state: RECOVERY_STATES.COMPLETE,
                        synthetic_recovery_updated_at: timestamp(at),
                        updated_at: timestamp(at)
                    });
                }
                return { action: 'already_sent' };
            }
            const at = currentTime();
            const deliveryState = operation.cancellation_delivery_state;
            const leaseActive = operation.cancellation_delivery_lease_expires_at
                && storedDate(
                    operation.cancellation_delivery_lease_expires_at,
                    'cancellation_delivery_lease_expires_at'
                ).getTime() > at.getTime();
            if ([CONFIRMATION_DELIVERY_STATES.CLAIMED, CONFIRMATION_DELIVERY_STATES.SENDING]
                .includes(deliveryState) && leaseActive) {
                return { action: 'in_progress' };
            }
            if (deliveryState === CONFIRMATION_DELIVERY_STATES.CLAIMED) {
                const attemptId = idGenerator('cda');
                transaction.update(opRef, {
                    cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.CLAIMED,
                    cancellation_delivery_attempt_count: 1,
                    cancellation_delivery_attempt_id: attemptId,
                    cancellation_delivery_token_digest: deliveryTokenDigest,
                    cancellation_delivery_claimed_at: timestamp(at),
                    cancellation_delivery_started_at: null,
                    cancellation_delivery_lease_expires_at: timestamp(
                        new Date(at.getTime() + OPERATION_LEASE_MS)
                    ),
                    updated_at: timestamp(at)
                });
                transaction.update(recRef, {
                    communication_attempt_count: 1,
                    communication_outcome: 'CLAIMED',
                    updated_at: timestamp(at)
                });
                return {
                    action: 'prepare',
                    delivery_token: deliveryToken,
                    cancellation_delivery_id: operation.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: attemptId
                };
            }
            if ([
                CONFIRMATION_DELIVERY_STATES.SENDING,
                CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
            ].includes(deliveryState) || (operation.cancellation_delivery_attempt_count || 0) > 0) {
                if (deliveryState !== CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED) {
                    transaction.update(opRef, {
                        cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED,
                        cancellation_delivery_token_digest: null,
                        cancellation_delivery_lease_expires_at: null,
                        cancellation_delivery_reconciliation_required: true,
                        cancellation_delivery_outcome_unknown_at: timestamp(at),
                        synthetic_recovery_state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                        updated_at: timestamp(at)
                    });
                }
                if (recovery.state !== RECOVERY_STATES.RECONCILIATION_REQUIRED) {
                    transaction.update(recRef, {
                        state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                        communication_outcome: 'RECONCILIATION_REQUIRED',
                        updated_at: timestamp(at)
                    });
                }
                return {
                    action: 'reconcile',
                    cancellation_delivery_id: operation.cancellation_delivery_id,
                    cancellation_delivery_attempt_id: operation.cancellation_delivery_attempt_id
                };
            }
            if (operation.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.PENDING) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication state is invalid');
            }
            const attemptId = idGenerator('cda');
            transaction.update(opRef, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.CLAIMED,
                cancellation_delivery_attempt_count: 1,
                cancellation_delivery_attempt_id: attemptId,
                cancellation_delivery_token_digest: deliveryTokenDigest,
                cancellation_delivery_claimed_at: timestamp(at),
                cancellation_delivery_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            });
            transaction.update(recRef, {
                communication_attempt_count: 1,
                communication_outcome: 'CLAIMED',
                updated_at: timestamp(at)
            });
            return {
                action: 'prepare',
                delivery_token: deliveryToken,
                cancellation_delivery_id: operation.cancellation_delivery_id,
                cancellation_delivery_attempt_id: attemptId
            };
        });
    }

    async function beginDelivery(input) {
        const { entry, actor } = input;
        const normalizedId = normalizeRecoveryOperationId(input.recovery_operation_id);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            const recovery = recoverySnapshot.exists ? recoverySnapshot.data() : null;
            const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertDeliveryExecutionEpoch(recovery, input.execution_epoch);
            const expected = operation?.cancellation_delivery_token_digest;
            const at = currentTime();
            if (!operation
                || ![
                    CONFIRMATION_DELIVERY_STATES.CLAIMED,
                    CONFIRMATION_DELIVERY_STATES.SENDING
                ].includes(operation.cancellation_delivery_state)
                || operation.cancellation_delivery_attempt_id !== input.delivery_attempt_id
                || !timingSafeDigestEqual(exactDigest(input.delivery_token), expected)
                || storedDate(operation.cancellation_delivery_lease_expires_at, 'delivery_lease_expires_at')
                    .getTime() <= at.getTime()) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is owned by another worker');
            }
            if (operation.cancellation_delivery_state === CONFIRMATION_DELIVERY_STATES.SENDING) {
                return { action: 'send' };
            }
            transaction.update(opRef, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENDING,
                cancellation_delivery_started_at: timestamp(at),
                cancellation_delivery_lease_expires_at: timestamp(new Date(at.getTime() + OPERATION_LEASE_MS)),
                updated_at: timestamp(at)
            });
            transaction.update(recRef, { communication_outcome: 'SENDING', updated_at: timestamp(at) });
            return { action: 'send' };
        });
    }

    async function releaseDeliveryBeforeEgress(input) {
        const { entry, actor } = input;
        const normalizedId = normalizeRecoveryOperationId(input.recovery_operation_id);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            const recovery = recoverySnapshot.exists ? recoverySnapshot.data() : null;
            const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertDeliveryExecutionEpoch(recovery, input.execution_epoch);
            if (!operation
                || operation.cancellation_state !== CANCELLATION_STATES.CANCELLED
                || operation.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.CLAIMED
                || operation.cancellation_delivery_attempt_count !== 1
                || operation.cancellation_delivery_attempt_id !== input.delivery_attempt_id
                || !timingSafeDigestEqual(
                    exactDigest(input.delivery_token),
                    operation.cancellation_delivery_token_digest
                )) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Cancellation communication can no longer be released before egress',
                    'recovery_delivery_release_fenced'
                );
            }
            const at = currentTime();
            transaction.update(opRef, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.PENDING,
                cancellation_delivery_attempt_count: 0,
                cancellation_delivery_attempt_id: null,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_claimed_at: null,
                cancellation_delivery_lease_expires_at: null,
                updated_at: timestamp(at)
            });
            transaction.update(recRef, {
                state: RECOVERY_STATES.COMMUNICATION_PENDING,
                communication_attempt_count: 0,
                communication_outcome: 'NOT_ATTEMPTED',
                claim_token_digest: null,
                claim_lease_expires_at: null,
                updated_at: timestamp(at)
            });
            return { action: 'released' };
        });
    }

    async function finishDelivery(input, sent) {
        const { entry, actor } = input;
        const normalizedId = normalizeRecoveryOperationId(input.recovery_operation_id);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            const recovery = recoverySnapshot.exists ? recoverySnapshot.data() : null;
            const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertDeliveryExecutionEpoch(recovery, input.execution_epoch);
            if (!operation || operation.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.SENDING
                || !timingSafeDigestEqual(
                    exactDigest(input.delivery_token),
                    operation.cancellation_delivery_token_digest
                )) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is owned by another worker');
            }
            const at = currentTime();
            const nextState = sent
                ? CONFIRMATION_DELIVERY_STATES.SENT
                : CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED;
            const opUpdate = {
                cancellation_delivery_state: nextState,
                cancellation_delivery_token_digest: null,
                cancellation_delivery_lease_expires_at: null,
                cancellation_delivery_reconciliation_required: !sent,
                updated_at: timestamp(at)
            };
            if (sent) {
                opUpdate.cancellation_delivery_provider_message_id = input.provider_message_id
                    ? normalizeProviderIdentifier(input.provider_message_id, 'provider_message_id')
                    : null;
                opUpdate.cancellation_delivery_sent_at = timestamp(at);
                opUpdate.synthetic_recovery_state = RECOVERY_STATES.COMPLETE;
            } else {
                opUpdate.cancellation_delivery_outcome_unknown_at = timestamp(at);
                opUpdate.synthetic_recovery_state = RECOVERY_STATES.RECONCILIATION_REQUIRED;
            }
            transaction.update(opRef, opUpdate);
            transaction.update(recRef, {
                state: sent ? RECOVERY_STATES.COMPLETE : RECOVERY_STATES.RECONCILIATION_REQUIRED,
                communication_outcome: sent ? 'SENT' : 'AMBIGUOUS',
                claim_token_digest: null,
                claim_lease_expires_at: null,
                completed_at: sent ? timestamp(at) : null,
                updated_at: timestamp(at)
            });
        });
    }

    const markDeliverySent = (input) => finishDelivery(input, true);
    const markDeliveryOutcomeUnknown = (input) => finishDelivery(input, false);

    async function settleDeliveryFromEvidence(input) {
        const { entry, actor, evidence } = input;
        const normalizedId = normalizeRecoveryOperationId(input.recovery_operation_id);
        const recRef = recoveryRef(normalizedId);
        const opRef = operationRef(entry);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, operationSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(opRef)
            ]);
            const recovery = recoverySnapshot.exists ? recoverySnapshot.data() : null;
            const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            assertDeliveryExecutionEpoch(recovery, input.execution_epoch);
            if (!operation
                || operation.cancellation_state !== CANCELLATION_STATES.CANCELLED
                || operation.cancellation_delivery_state !== CONFIRMATION_DELIVERY_STATES.RECONCILIATION_REQUIRED
                || evidence?.custom_args?.synchintro_cancellation_id !== operation.cancellation_delivery_id
                || evidence?.custom_args?.synchintro_cancellation_delivery_attempt_id
                    !== operation.cancellation_delivery_attempt_id
                || !['ACCEPTED', 'DELIVERED'].includes(evidence.outcome)) {
                throw apiError(ErrorCodes.CONFLICT, 'Cancellation delivery evidence does not match');
            }
            const at = currentTime();
            transaction.update(opRef, {
                cancellation_delivery_state: CONFIRMATION_DELIVERY_STATES.SENT,
                cancellation_delivery_provider_message_id: normalizeProviderIdentifier(
                    evidence.provider_message_id,
                    'provider_message_id'
                ),
                cancellation_delivery_reconciliation_evidence_id: String(
                    evidence.reconciliation_evidence_id || ''
                ),
                cancellation_delivery_reconciliation_outcome: evidence.outcome,
                cancellation_delivery_reconciliation_required: false,
                cancellation_delivery_sent_at: timestamp(at),
                synthetic_recovery_state: RECOVERY_STATES.COMPLETE,
                updated_at: timestamp(at)
            });
            transaction.update(recRef, {
                state: RECOVERY_STATES.COMPLETE,
                communication_outcome: `RECONCILED_${evidence.outcome}`,
                claim_token_digest: null,
                claim_lease_expires_at: null,
                completed_at: timestamp(at),
                updated_at: timestamp(at)
            });
            return { action: 'settled', outcome: evidence.outcome };
        });
    }

    async function readExecution(recoveryOperationId) {
        const snapshot = await recoveryRef(recoveryOperationId).get();
        return snapshot.exists ? snapshot.data() : null;
    }

    async function getExecutionReplay({ entry, recovery_operation_id: recoveryOperationId, actor }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, receiptSnapshot] = await Promise.all([
                transaction.get(recoveryRef(normalizedId)),
                transaction.get(receiptRef(normalizedId))
            ]);
            if (!recoverySnapshot.exists) return { action: 'missing' };
            const recovery = recoverySnapshot.data();
            assertExecutionBinding(recovery, entry, actor, normalizedId);
            if (receiptSnapshot.exists) {
                if (recovery.receipt_id !== receiptSnapshot.id) {
                    throw apiError(ErrorCodes.CONFLICT, 'Recovery receipt binding is inconsistent');
                }
                return { action: 'replay', recovery, receipt: receiptSnapshot.data() };
            }
            if ([RECOVERY_STATES.COMPLETE, RECOVERY_STATES.MANUAL_REVIEW_REQUIRED]
                .includes(recovery.state)) {
                return { action: 'finalize_receipt', recovery };
            }
            return { action: 'pending', recovery };
        });
    }

    async function createReceipt({ recovery_operation_id: recoveryOperationId, actor,
        execution_epoch: executionEpoch, receipt }) {
        const normalizedId = normalizeRecoveryOperationId(recoveryOperationId);
        const recRef = recoveryRef(normalizedId);
        const auditRef = receiptRef(normalizedId);
        return db.runTransaction(async (transaction) => {
            const [recoverySnapshot, receiptSnapshot] = await Promise.all([
                transaction.get(recRef), transaction.get(auditRef)
            ]);
            if (!recoverySnapshot.exists) throw apiError(ErrorCodes.NOT_FOUND, 'Recovery operation not found');
            const recovery = recoverySnapshot.data();
            if (recovery.actor_uid_digest !== actor.uid_digest
                || recovery.actor_email_digest !== actor.email_digest) {
                throw apiError(ErrorCodes.AUTHORIZATION_ERROR, 'Recovery receipt access denied');
            }
            if (receiptSnapshot.exists) return receiptSnapshot.data();
            if (!Number.isSafeInteger(executionEpoch)
                || executionEpoch !== (recovery.claim_epoch || 0)) {
                throw apiError(
                    ErrorCodes.CONFLICT,
                    'Recovery receipt writer is stale',
                    'recovery_receipt_writer_stale'
                );
            }
            if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
                || Object.keys(receipt).some((key) => !RECEIPT_FIELDS.has(key))) {
                throw apiError(ErrorCodes.INVALID_INPUT, 'Recovery receipt is invalid', 'unsafe_receipt_field');
            }
            const terminalState = [
                RECOVERY_STATES.COMPLETE,
                RECOVERY_STATES.MANUAL_REVIEW_REQUIRED
            ].includes(recovery.state);
            let authoritativeReceipt = receipt;
            if (terminalState) {
                const preClassification = recovery.pre_state_classification;
                const providerAttempted = (recovery.provider_attempt_count || 0) > 0;
                const communicationAttempted = (recovery.communication_attempt_count || 0) > 0;
                const finalClassification = recovery.state === RECOVERY_STATES.MANUAL_REVIEW_REQUIRED
                    ? 'MANUAL_REVIEW_REQUIRED'
                    : 'ALREADY_CLEAN';
                const plannedAction = recovery.planned_action;
                if (!PLANNED_ACTIONS.has(plannedAction)) {
                    throw apiError(ErrorCodes.CONFLICT, 'Recovery planned action is unavailable', 'recovery_action_unbound');
                }
                authoritativeReceipt = Object.assign({}, receipt, {
                    pre_state_classification: preClassification,
                    planned_action: plannedAction,
                    provider_action_attempted: providerAttempted,
                    provider_action_count: providerAttempted ? 1 : 0,
                    provider_outcome: recovery.provider_outcome || 'NOT_ATTEMPTED',
                    durable_state_transition: recovery.state === RECOVERY_STATES.MANUAL_REVIEW_REQUIRED
                        ? 'MANUAL_REVIEW_REQUIRED'
                        : 'CANCELLED',
                    communication_action_attempted: communicationAttempted,
                    communication_action_count: communicationAttempted ? 1 : 0,
                    communication_outcome: recovery.communication_outcome || 'NOT_ATTEMPTED',
                    final_classification: finalClassification
                });
            }
            const at = currentTime();
            const reconciliationReceipt = [
                'STATE_AMBIGUOUS',
                'PROVIDER_RECONCILIATION_REQUIRED',
                'COMMUNICATION_RECONCILIATION_REQUIRED'
            ].includes(authoritativeReceipt.final_classification);
            const receiptRetention = recovery.retention_hold === true
                ? {}
                : receiptRetentionFields(authoritativeReceipt.final_classification, at);
            const stored = Object.assign({}, authoritativeReceipt, {
                receipt_id: auditRef.id,
                recovery_operation_digest: recovery.recovery_operation_digest,
                actor_uid_digest: actor.uid_digest,
                actor_email_digest: actor.email_digest,
                actor_role: actor.role,
                created_at: timestamp(at),
                retention_policy: 'IMMUTABLE_AUDIT_AND_ACTOR_METADATA_24_MONTHS',
                retention_hold: recovery.retention_hold === true,
                redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
            }, receiptRetention.retention_eligible_at ? {
                retention_eligible_at: timestamp(receiptRetention.retention_eligible_at)
            } : {});
            const recoveryRetention = !reconciliationReceipt && recovery.retention_hold !== true
                ? recoveryRetentionFields(recovery.state, at)
                : {};
            transaction.create(auditRef, stored);
            transaction.update(recRef, Object.assign({
                receipt_id: auditRef.id,
                updated_at: timestamp(at)
            }, recoveryRetention.retention_eligible_at ? {
                retention_eligible_at: timestamp(recoveryRetention.retention_eligible_at)
            } : {}, reconciliationReceipt ? {
                state: RECOVERY_STATES.RECONCILIATION_REQUIRED,
                claim_token_digest: null,
                claim_lease_expires_at: null
            } : {}));
            return stored;
        });
    }

    async function readReceipt(recoveryOperationId, actor) {
        const [recoverySnapshot, receiptSnapshot] = await Promise.all([
            recoveryRef(recoveryOperationId).get(), receiptRef(recoveryOperationId).get()
        ]);
        if (!recoverySnapshot.exists || !receiptSnapshot.exists) {
            throw apiError(ErrorCodes.NOT_FOUND, 'Recovery receipt not found');
        }
        const recovery = recoverySnapshot.data();
        if (recovery.actor_uid_digest !== actor.uid_digest
            || recovery.actor_email_digest !== actor.email_digest) {
            throw apiError(ErrorCodes.AUTHORIZATION_ERROR, 'Recovery receipt access denied');
        }
        return receiptSnapshot.data();
    }

    return Object.freeze({
        loadBoundOperation,
        claimExecution,
        beginProviderAttempt,
        markProviderAmbiguous,
        markProviderRejected,
        markTerminalCancelled,
        markAlreadyClean,
        claimDelivery,
        releaseDeliveryBeforeEgress,
        beginDelivery,
        markDeliverySent,
        markDeliveryOutcomeUnknown,
        settleDeliveryFromEvidence,
        readExecution,
        getExecutionReplay,
        createReceipt,
        readReceipt
    });
}

module.exports = {
    COLLECTIONS,
    RECOVERY_STATES,
    RETENTION_POLICY,
    recoveryRetentionFields,
    receiptRetentionFields,
    RECOVERY_ID,
    normalizeRecoveryOperationId,
    createBookingRecoveryPersistence
};
