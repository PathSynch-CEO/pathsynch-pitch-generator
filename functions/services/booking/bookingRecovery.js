'use strict';

const crypto = require('node:crypto');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');
const { BookingVerificationError } = require('./bookingVerification');
const { NylasHttpError, ERROR_CATEGORIES } = require('./nylasHttpClient');
const { verifyCancellationTarget } = require('./bookingCancellationTarget');
const { storedDate } = require('./bookingPersistenceSchema');
const {
    digest,
    listRecoveryAllowlistEntries,
    resolveRecoveryAllowlistEntry
} = require('./bookingRecoveryAllowlist');

const CLASSIFICATIONS = Object.freeze({
    ALREADY_CLEAN: 'ALREADY_CLEAN',
    CANCEL_REQUIRED: 'CANCEL_REQUIRED',
    PROVIDER_RECONCILIATION_REQUIRED: 'PROVIDER_RECONCILIATION_REQUIRED',
    COMMUNICATION_RECONCILIATION_REQUIRED: 'COMMUNICATION_RECONCILIATION_REQUIRED',
    STATE_AMBIGUOUS: 'STATE_AMBIGUOUS',
    NOT_ALLOWLISTED: 'NOT_ALLOWLISTED',
    UNSUPPORTED: 'UNSUPPORTED',
    MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED'
});

function apiError(code, message, reason) {
    return new ApiError(code, message, reason ? { reason } : null);
}

function stableHash(value) {
    const normalized = JSON.stringify(value, Object.keys(value).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function publicOperationState(operation) {
    return {
        booking_state: operation.state,
        cancellation_state: operation.cancellation_state || 'CONFIRMED',
        booking_confirmation_state: operation.confirmation_delivery_state || 'UNKNOWN',
        cancellation_delivery_state: operation.cancellation_delivery_state || 'NOT_STARTED',
        provider_create_attempt_count: operation.attempt_count || 0,
        provider_cancel_attempt_count: operation.cancellation_attempt_count || 0,
        cancellation_delivery_attempt_count: operation.cancellation_delivery_attempt_count || 0
    };
}

function createBookingRecoveryService(options = {}) {
    const persistence = options.persistence;
    const provider = options.provider;
    const mailer = options.mailer || null;
    const evidenceStore = options.evidenceStore || null;
    const now = options.now || (() => new Date());
    const resolveEntry = options.resolveEntry || resolveRecoveryAllowlistEntry;
    const listEntries = options.listEntries || listRecoveryAllowlistEntries;
    if (!persistence || !provider || typeof provider.getBooking !== 'function'
        || typeof provider.getEvent !== 'function' || typeof provider.cancelBooking !== 'function') {
        throw new Error('Governed recovery dependencies are incomplete');
    }

    function entryFor(reference) {
        const entry = resolveEntry(reference);
        if (!entry) {
            throw apiError(
                ErrorCodes.AUTHORIZATION_ERROR,
                'Booking is not allowlisted for governed synthetic recovery',
                'not_allowlisted'
            );
        }
        return entry;
    }

    async function inspectBound(entry) {
        const bound = await persistence.loadBoundOperation(entry);
        const operation = bound.operation;
        if (provider.name !== 'nylas'
            || !provider.configuration
            || digest(provider.configuration.configurationId) !== entry.provider_configuration_digest
            || operation.provider_reference?.configuration_id !== provider.configuration.configurationId) {
            return {
                entry, bound, target: null,
                classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
                reason: 'provider_configuration_mismatch'
            };
        }
        if (operation.confirmation_delivery_state !== 'SENT') {
            return {
                entry,
                bound,
                target: null,
                classification: CLASSIFICATIONS.STATE_AMBIGUOUS,
                reason: 'original_confirmation_not_settled'
            };
        }
        let target;
        try {
            target = await verifyCancellationTarget(provider, operation);
        } catch (error) {
            return {
                entry,
                bound,
                target: null,
                classification: error instanceof BookingVerificationError
                    ? CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
                    : CLASSIFICATIONS.STATE_AMBIGUOUS,
                reason: error instanceof BookingVerificationError
                    ? error.reason
                    : 'provider_read_unavailable'
            };
        }
        const cancellationState = operation.cancellation_state || 'CONFIRMED';
        let classification;
        let reason;
        if (cancellationState === 'CANCELLED') {
            if (target.action !== 'already_cancelled') {
                classification = CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED;
                reason = 'local_cancelled_provider_active';
            } else if (operation.cancellation_delivery_state === 'SENT') {
                classification = CLASSIFICATIONS.ALREADY_CLEAN;
                reason = 'terminal_provider_local_communication';
            } else {
                classification = CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED;
                reason = 'terminal_provider_local_communication_unsettled';
            }
        } else if (cancellationState !== 'CONFIRMED') {
            classification = CLASSIFICATIONS.STATE_AMBIGUOUS;
            reason = 'existing_cancellation_lifecycle_nonterminal';
        } else if (target.action === 'already_cancelled') {
            classification = CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED;
            reason = 'provider_cancelled_local_confirmed';
        } else if (target.action === 'active') {
            classification = CLASSIFICATIONS.CANCEL_REQUIRED;
            reason = 'provider_booked_local_confirmed';
        } else {
            classification = CLASSIFICATIONS.UNSUPPORTED;
            reason = 'unsupported_provider_state';
        }
        return { entry, bound, target, classification, reason };
    }

    function publicInspection(inspection) {
        const operation = inspection.bound.operation;
        const cancellationDeliveryPending = operation.cancellation_delivery_state === 'PENDING'
            && (operation.cancellation_delivery_attempt_count || 0) === 0;
        const deliveryLease = operation.cancellation_delivery_lease_expires_at;
        const deliveryLeaseExpiry = deliveryLease
            ? storedDate(deliveryLease, 'cancellation_delivery_lease_expires_at')
            : null;
        const cancellationDeliveryClaimReclaimable = operation.cancellation_delivery_state === 'CLAIMED'
            && (!deliveryLease || (deliveryLeaseExpiry && deliveryLeaseExpiry.getTime() <= now().getTime()));
        const cancellationDeliveryMaySend = cancellationDeliveryPending
            || cancellationDeliveryClaimReclaimable;
        return {
            reference: inspection.entry.reference,
            source_work_package: inspection.entry.work_package,
            intent: inspection.entry.intent,
            allowlisted: true,
            classification: inspection.classification,
            reason: inspection.reason,
            binding: inspection.bound.binding,
            durable: publicOperationState(inspection.bound.operation),
            provider: {
                configuration_bound: inspection.reason !== 'provider_configuration_mismatch',
                booking_state: inspection.target?.action === 'active' ? 'BOOKED'
                    : (inspection.target?.action === 'already_cancelled' ? 'CANCELLED' : 'UNKNOWN'),
                event_state: inspection.target?.action === 'active' ? 'CONFIRMED'
                    : (inspection.target?.action === 'already_cancelled' ? 'CANCELLED' : 'UNKNOWN')
            },
            planned_action: inspection.classification === CLASSIFICATIONS.CANCEL_REQUIRED
                ? 'SCHEDULER_BOOKING_DELETE'
                : (inspection.classification === CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED
                    ? 'LOCAL_RECONCILIATION_ONLY'
                    : (inspection.classification === CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                        ? (cancellationDeliveryMaySend
                            ? 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION'
                            : 'COMMUNICATION_EVIDENCE_ONLY')
                        : 'NONE')),
            dry_run_safe: true,
            production_mutation_performed: false
        };
    }

    async function inspect(reference) {
        return publicInspection(await inspectBound(entryFor(reference)));
    }

    async function inventory() {
        const rows = [];
        for (const entry of listEntries()) {
            rows.push(publicInspection(await inspectBound(entry)));
        }
        return {
            work_package: 'SYNCH-P2-0004',
            count: rows.length,
            records: rows,
            production_mutation_performed: false
        };
    }

    async function dryRun(reference, actor) {
        const inspection = await inspectBound(entryFor(reference));
        const plan = publicInspection(inspection);
        const semantic = {
            schema: 'synchintro-synthetic-recovery-dry-run/v1',
            work_package: 'SYNCH-P2-0004',
            actor_uid_digest: actor.uid_digest,
            actor_email_digest: actor.email_digest,
            actor_role: actor.role,
            reference: inspection.entry.reference,
            operation_document_id_digest: inspection.entry.operation_document_id_digest,
            workspace_id_digest: inspection.entry.workspace_id_digest,
            allowlist_evidence: inspection.entry.work_package,
            pre_state_classification: inspection.classification,
            planned_action: plan.planned_action,
            provider_action_attempted: false,
            communication_action_attempted: false,
            final_classification: inspection.classification,
            redaction_status: 'NO_SECRETS_CAPABILITIES_OR_PROVIDER_IDENTIFIERS'
        };
        return {
            plan,
            receipt: Object.assign({}, semantic, {
                receipt_digest: stableHash(semantic),
                generated_at: now().toISOString(),
                persisted: false
            })
        };
    }

    async function deliverCancellation(entry, recoveryOperationId, actor, operation, executionEpoch) {
        if (!mailer || typeof mailer.sendCancellation !== 'function') {
            return {
                outcome: 'NOT_CONFIGURED', attempted: false,
                classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
            };
        }
        const claim = await persistence.claimDelivery({
            entry, recovery_operation_id: recoveryOperationId, actor,
            execution_epoch: executionEpoch
        });
        if (claim.action === 'already_sent') return { outcome: 'ALREADY_SENT', attempted: false };
        if (claim.action === 'in_progress') {
            throw apiError(ErrorCodes.CONFLICT, 'Cancellation communication is in progress', 'communication_in_progress');
        }
        if (claim.action === 'reconcile') {
            if (!evidenceStore || typeof evidenceStore.verify !== 'function') {
                return {
                    outcome: 'RECONCILIATION_REQUIRED', attempted: false,
                    classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                };
            }
            let evidence;
            try {
                evidence = await evidenceStore.verify({
                    expected: {
                        cancellation_delivery_id: claim.cancellation_delivery_id,
                        cancellation_delivery_attempt_id: claim.cancellation_delivery_attempt_id
                    }
                });
                await persistence.settleDeliveryFromEvidence({
                    entry, recovery_operation_id: recoveryOperationId, actor, evidence,
                    execution_epoch: executionEpoch
                });
                return { outcome: `RECONCILED_${evidence.outcome}`, attempted: false };
            } catch (_) {
                try {
                    const durable = await persistence.getExecutionReplay({
                        entry,
                        recovery_operation_id: recoveryOperationId,
                        actor
                    });
                    if (durable.recovery?.state === 'COMPLETE') {
                        return {
                            outcome: durable.recovery.communication_outcome
                                || `RECONCILED_${evidence.outcome}`,
                            attempted: (durable.recovery.communication_attempt_count || 0) > 0
                        };
                    }
                } catch (_) {
                    // Fail closed to evidence-only reconciliation when durable readback is unavailable.
                }
                return {
                    outcome: 'RECONCILIATION_REQUIRED', attempted: false,
                    classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                };
            }
        }
        try {
            await provider.assertCustomerEmailsDisabled();
        } catch (error) {
            try {
                await persistence.releaseDeliveryBeforeEgress({
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor,
                    execution_epoch: executionEpoch,
                    delivery_token: claim.delivery_token,
                    delivery_attempt_id: claim.cancellation_delivery_attempt_id
                });
            } catch (_) {
                throw apiError(
                    ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                    'Cancellation communication preflight could not be released safely',
                    'configuration_preflight_release_failed'
                );
            }
            throw error;
        }
        const deliveryStart = {
            entry,
            recovery_operation_id: recoveryOperationId,
            actor,
            execution_epoch: executionEpoch,
            delivery_token: claim.delivery_token,
            delivery_attempt_id: claim.cancellation_delivery_attempt_id
        };
        try {
            await persistence.beginDelivery(deliveryStart);
        } catch (_) {
            // The transition is idempotent for this exact token/attempt. Retry only
            // the durable pre-egress fence; never retry the SendGrid call here.
            await persistence.beginDelivery(deliveryStart);
        }
        let delivery;
        try {
            delivery = await mailer.sendCancellation({
                booking: operation.confirmed_result,
                identity: operation.confirmation_identity,
                specialist: operation.specialist,
                delivery: {
                    confirmation_id: claim.cancellation_delivery_id,
                    attempt_id: claim.cancellation_delivery_attempt_id
                }
            });
        } catch (_) {
            try {
                await persistence.markDeliveryOutcomeUnknown({
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor,
                    execution_epoch: executionEpoch,
                    delivery_token: claim.delivery_token
                });
            } catch (_) {
                // The send may have occurred. No path grants another send.
            }
            return {
                outcome: 'AMBIGUOUS', attempted: true,
                classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
            };
        }
        const settlement = {
            entry,
            recovery_operation_id: recoveryOperationId,
            actor,
            execution_epoch: executionEpoch,
            delivery_token: claim.delivery_token,
            provider_message_id: delivery?.provider_message_id
        };
        try {
            await persistence.markDeliverySent(settlement);
            return { outcome: 'SENT', attempted: true };
        } catch (_) {
            try {
                const durable = await persistence.getExecutionReplay({
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor
                });
                if (durable.recovery?.state === 'COMPLETE') {
                    return {
                        outcome: durable.recovery.communication_outcome || 'SENT',
                        attempted: true
                    };
                }
                await persistence.markDeliverySent(settlement);
                return { outcome: 'SENT', attempted: true };
            } catch (_) {
                try {
                    await persistence.markDeliveryOutcomeUnknown({
                        entry,
                        recovery_operation_id: recoveryOperationId,
                        actor,
                        execution_epoch: executionEpoch,
                        delivery_token: claim.delivery_token
                    });
                } catch (_) {
                    // The send may have settled. No path grants another send.
                }
                return {
                    outcome: 'AMBIGUOUS', attempted: true,
                    classification: CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                };
            }
        }
    }

    async function writeReceipt({ entry, recoveryOperationId, actor, preClassification, finalClassification,
        providerAttempted, providerOutcome, communicationAttempted, communicationOutcome, replay,
        executionEpoch, durableCancellationState, plannedAction }) {
        return persistence.createReceipt({
            recovery_operation_id: recoveryOperationId,
            actor,
            execution_epoch: executionEpoch,
            receipt: {
                schema: 'synchintro-synthetic-recovery-receipt/v1',
                work_package: 'SYNCH-P2-0004',
                reference: entry.reference,
                source_work_package: entry.work_package,
                operation_document_id_digest: entry.operation_document_id_digest,
                session_id_digest: entry.session_id_digest,
                workspace_id_digest: entry.workspace_id_digest,
                allowlist_identity_digest: entry.synthetic_identity_digest,
                allowlist_evidence: 'SERVER_AUTHORITATIVE_EXACT_BINDING',
                intent: entry.intent,
                pre_state_classification: preClassification,
                planned_action: plannedAction || (preClassification === CLASSIFICATIONS.CANCEL_REQUIRED
                    ? 'SCHEDULER_BOOKING_DELETE'
                    : (preClassification === CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED
                        ? 'LOCAL_RECONCILIATION_ONLY'
                        : (preClassification === CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                            ? (communicationAttempted
                                ? 'SEND_CONTROLLED_SYNTHETIC_CANCELLATION'
                                : 'COMMUNICATION_EVIDENCE_ONLY')
                            : 'NONE'))),
                provider_action_attempted: providerAttempted,
                provider_action_count: providerAttempted ? 1 : 0,
                provider_outcome: providerOutcome,
                durable_state_transition: finalClassification === CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
                    ? 'MANUAL_REVIEW_REQUIRED'
                    : (durableCancellationState === 'CANCELLED' || [
                        CLASSIFICATIONS.ALREADY_CLEAN,
                        CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED
                    ].includes(finalClassification) ? 'CANCELLED' : 'RECONCILIATION_REQUIRED'),
                communication_action_attempted: communicationAttempted,
                communication_action_count: communicationAttempted ? 1 : 0,
                communication_outcome: communicationOutcome,
                replay_result: replay ? 'IDEMPOTENT_REPLAY' : 'FIRST_EXECUTION',
                final_classification: finalClassification
            }
        });
    }

    async function execute({ reference, recovery_operation_id: recoveryOperationId, actor }) {
        const entry = entryFor(reference);
        const prior = await persistence.getExecutionReplay({
            entry,
            recovery_operation_id: recoveryOperationId,
            actor
        });
        if (prior.action === 'replay') {
            return {
                replay: true,
                classification: prior.receipt.final_classification,
                receipt: prior.receipt
            };
        }
        const finalizeReceipt = async (recovery) => {
            const finalClassification = recovery.state === 'MANUAL_REVIEW_REQUIRED'
                ? CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
                : CLASSIFICATIONS.ALREADY_CLEAN;
            const receipt = await writeReceipt({
                entry,
                recoveryOperationId,
                actor,
                preClassification: recovery.pre_state_classification,
                finalClassification,
                providerAttempted: (recovery.provider_attempt_count || 0) > 0,
                providerOutcome: recovery.provider_outcome || 'NOT_ATTEMPTED',
                communicationAttempted: (recovery.communication_attempt_count || 0) > 0,
                communicationOutcome: recovery.communication_outcome || 'NOT_ATTEMPTED',
                replay: true,
                executionEpoch: recovery.claim_epoch || 0,
                plannedAction: recovery.planned_action
            });
            return { replay: true, classification: finalClassification, receipt };
        };
        if (prior.action === 'finalize_receipt') return finalizeReceipt(prior.recovery);
        let inspection = await inspectBound(entry);
        const executable = new Set([
            CLASSIFICATIONS.CANCEL_REQUIRED,
            CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED,
            CLASSIFICATIONS.COMMUNICATION_RECONCILIATION_REQUIRED,
            CLASSIFICATIONS.ALREADY_CLEAN
        ]);
        if (!executable.has(inspection.classification)) {
            throw apiError(
                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                'Governed synthetic recovery requires manual review',
                inspection.reason
            );
        }
        const plannedAction = publicInspection(inspection).planned_action;
        const claimed = await persistence.claimExecution({
            entry,
            recovery_operation_id: recoveryOperationId,
            actor,
            classification: inspection.classification,
            planned_action: plannedAction
        });
        if (claimed.action === 'replay') {
            const receipt = await persistence.readReceipt(recoveryOperationId, actor);
            return { replay: true, classification: receipt.final_classification, receipt };
        }
        if (claimed.action === 'finalize_receipt') return finalizeReceipt(claimed.recovery);
        if (claimed.action === 'in_progress') {
            throw apiError(ErrorCodes.CONFLICT, 'Governed synthetic recovery is in progress', 'recovery_in_progress');
        }

        const executionEpoch = claimed.recovery?.claim_epoch || 0;
        const selectedAction = claimed.recovery?.planned_action || plannedAction;
        const recoveryReplay = ['reconcile', 'resume'].includes(claimed.action);
        let providerAttempted = (claimed.recovery?.provider_attempt_count || 0) > 0;
        let providerOutcome = inspection.target?.action === 'already_cancelled' ? 'ALREADY_CANCELLED' : 'ACTIVE';
        let operation = inspection.bound.operation;
        if (claimed.recovery?.continuation_mode === 'READ_ONLY_RECONCILIATION'
            && inspection.target?.action !== 'already_cancelled') {
            const receipt = await writeReceipt({
                entry, recoveryOperationId, actor,
                preClassification: claimed.recovery.pre_state_classification,
                finalClassification: CLASSIFICATIONS.STATE_AMBIGUOUS,
                providerAttempted,
                providerOutcome: 'RECONCILIATION_UNRESOLVED',
                communicationAttempted: false,
                communicationOutcome: 'NOT_ATTEMPTED',
                replay: recoveryReplay,
                executionEpoch,
                plannedAction: selectedAction
            });
            return { replay: recoveryReplay, classification: CLASSIFICATIONS.STATE_AMBIGUOUS, receipt };
        }
        if (claimed.action === 'reconcile') {
            inspection = await inspectBound(entry);
            if (inspection.target?.action !== 'already_cancelled') {
                const receipt = await writeReceipt({
                    entry, recoveryOperationId, actor,
                    preClassification: claimed.recovery.pre_state_classification,
                    finalClassification: CLASSIFICATIONS.STATE_AMBIGUOUS,
                    providerAttempted,
                    providerOutcome: claimed.recovery.provider_outcome || 'RECONCILIATION_UNRESOLVED',
                    communicationAttempted: (claimed.recovery.communication_attempt_count || 0) > 0,
                    communicationOutcome: claimed.recovery.communication_outcome || 'NOT_ATTEMPTED',
                    replay: true,
                    executionEpoch,
                    durableCancellationState: operation.cancellation_state,
                    plannedAction: selectedAction
                });
                return { replay: true, classification: CLASSIFICATIONS.STATE_AMBIGUOUS, receipt };
            }
            operation = inspection.bound.operation;
            providerOutcome = claimed.recovery.provider_outcome === 'CANCELLED'
                ? 'CANCELLED'
                : 'RECONCILED_CANCELLED';
            if ((operation.cancellation_state || 'CONFIRMED') !== 'CANCELLED') {
                operation = await persistence.markTerminalCancelled({
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor,
                    claim_token: claimed.claim_token,
                    provider_attempted: providerAttempted,
                    provider_outcome: providerOutcome,
                    provider_request_id: null,
                    reconciliation_evidence: providerAttempted
                        ? 'nylas.recovery_after_ambiguous_attempt'
                        : 'nylas.recovery_provider_cancelled_local_confirmed'
                });
            }
        } else if (inspection.classification === CLASSIFICATIONS.CANCEL_REQUIRED) {
            await provider.assertCustomerEmailsDisabled();
            const reverified = await verifyCancellationTarget(provider, operation);
            if (reverified.action !== 'active') {
                operation = await persistence.markTerminalCancelled({
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor,
                    claim_token: claimed.claim_token,
                    provider_attempted: false,
                    provider_outcome: 'RECONCILED_CANCELLED',
                    provider_request_id: null,
                    reconciliation_evidence: 'nylas.recovery_pre_egress_already_cancelled'
                });
                providerOutcome = 'RECONCILED_CANCELLED';
            } else {
                const providerStart = {
                    entry,
                    recovery_operation_id: recoveryOperationId,
                    actor,
                    claim_token: claimed.claim_token
                };
                try {
                    await persistence.beginProviderAttempt(providerStart);
                } catch (_) {
                    // The transition is idempotent for this exact live claim. Retry
                    // only the durable pre-egress fence; never retry Scheduler DELETE.
                    await persistence.beginProviderAttempt(providerStart);
                }
                providerAttempted = true;
                let cancelled = null;
                try {
                    cancelled = await provider.cancelBooking({ bookingId: operation.provider_booking_id });
                } catch (error) {
                    const definitiveRejection = error instanceof NylasHttpError
                        && error.category === ERROR_CATEGORIES.REJECTED
                        && error.status !== 404;
                    if (definitiveRejection) {
                        await persistence.markProviderRejected({
                            entry,
                            recovery_operation_id: recoveryOperationId,
                            actor,
                            claim_token: claimed.claim_token,
                            failure_code: 'nylas.recovery_provider_rejected'
                        });
                        const receipt = await writeReceipt({
                            entry, recoveryOperationId, actor,
                            preClassification: claimed.recovery.pre_state_classification,
                            finalClassification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
                            providerAttempted: true,
                            providerOutcome: 'DEFINITIVE_REJECTION',
                            communicationAttempted: false,
                            communicationOutcome: 'NOT_ATTEMPTED',
                            replay: false,
                            executionEpoch,
                            plannedAction: selectedAction
                        });
                        return {
                            replay: false,
                            classification: CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
                            receipt
                        };
                    }
                    await persistence.markProviderAmbiguous({
                        entry,
                        recovery_operation_id: recoveryOperationId,
                        actor,
                        claim_token: claimed.claim_token,
                        failure_code: 'nylas.recovery_outcome_unknown'
                    });
                    const reconciled = await inspectBound(entry);
                    if (reconciled.target?.action === 'already_cancelled') {
                        operation = await persistence.markTerminalCancelled({
                            entry,
                            recovery_operation_id: recoveryOperationId,
                            actor,
                            claim_token: claimed.claim_token,
                            provider_attempted: true,
                            provider_outcome: 'RECONCILED_CANCELLED',
                            provider_request_id: null,
                            reconciliation_evidence: 'nylas.recovery_immediate_readback_cancelled'
                        });
                        providerOutcome = 'RECONCILED_CANCELLED';
                    } else {
                        const receipt = await writeReceipt({
                            entry, recoveryOperationId, actor,
                            preClassification: claimed.recovery.pre_state_classification,
                            finalClassification: CLASSIFICATIONS.STATE_AMBIGUOUS,
                            providerAttempted: true,
                            providerOutcome: 'AMBIGUOUS',
                            communicationAttempted: false,
                            communicationOutcome: 'NOT_ATTEMPTED',
                            replay: false,
                            executionEpoch,
                            plannedAction: selectedAction
                        });
                        return { replay: false, classification: CLASSIFICATIONS.STATE_AMBIGUOUS, receipt };
                    }
                }
                if (cancelled) {
                    const terminalInput = {
                        entry,
                        recovery_operation_id: recoveryOperationId,
                        actor,
                        claim_token: claimed.claim_token,
                        provider_attempted: true,
                        provider_outcome: 'CANCELLED',
                        provider_request_id: cancelled.request_id,
                        reconciliation_evidence: 'nylas.scheduler_booking_delete'
                    };
                    try {
                        operation = await persistence.markTerminalCancelled(terminalInput);
                    } catch (_) {
                        try {
                            const durable = await persistence.loadBoundOperation(entry);
                            if ((durable.operation.cancellation_state || 'CONFIRMED') === 'CANCELLED') {
                                operation = durable.operation;
                            } else {
                                operation = await persistence.markTerminalCancelled(terminalInput);
                            }
                        } catch (_) {
                            throw apiError(
                                ErrorCodes.BOOKING_RECONCILIATION_REQUIRED,
                                'Successful provider cancellation could not be settled durably',
                                'provider_success_persistence_unsettled'
                            );
                        }
                    }
                    providerOutcome = 'CANCELLED';
                }
            }
        } else if (inspection.classification === CLASSIFICATIONS.PROVIDER_RECONCILIATION_REQUIRED) {
            operation = await persistence.markTerminalCancelled({
                entry,
                recovery_operation_id: recoveryOperationId,
                actor,
                claim_token: claimed.claim_token,
                provider_attempted: false,
                provider_outcome: 'RECONCILED_CANCELLED',
                provider_request_id: null,
                reconciliation_evidence: 'nylas.recovery_provider_cancelled_local_confirmed'
            });
            providerOutcome = 'RECONCILED_CANCELLED';
        } else if (inspection.classification === CLASSIFICATIONS.ALREADY_CLEAN) {
            await persistence.markAlreadyClean({
                entry,
                recovery_operation_id: recoveryOperationId,
                actor,
                claim_token: claimed.claim_token
            });
            const receipt = await writeReceipt({
                entry, recoveryOperationId, actor,
                preClassification: claimed.recovery.pre_state_classification,
                finalClassification: CLASSIFICATIONS.ALREADY_CLEAN,
                providerAttempted: false,
                providerOutcome: 'ALREADY_CANCELLED',
                communicationAttempted: false,
                communicationOutcome: 'ALREADY_SENT',
                replay: false,
                executionEpoch,
                plannedAction: selectedAction
            });
            return { replay: false, classification: CLASSIFICATIONS.ALREADY_CLEAN, receipt };
        }

        const communication = await deliverCancellation(
            entry,
            recoveryOperationId,
            actor,
            operation,
            executionEpoch
        );
        const communicationAttempted = communication.attempted === true
            || (claimed.recovery?.communication_attempt_count || 0) > 0;
        const finalClassification = communication.classification
            || CLASSIFICATIONS.ALREADY_CLEAN;
        if (finalClassification !== CLASSIFICATIONS.ALREADY_CLEAN) {
            const receipt = await writeReceipt({
                entry, recoveryOperationId, actor,
                preClassification: claimed.recovery.pre_state_classification,
                finalClassification,
                providerAttempted,
                providerOutcome,
                communicationAttempted,
                communicationOutcome: communication.outcome,
                replay: recoveryReplay,
                executionEpoch,
                plannedAction: selectedAction
            });
            return {
                replay: recoveryReplay,
                classification: receipt.final_classification || finalClassification,
                receipt
            };
        }
        const receipt = await writeReceipt({
            entry, recoveryOperationId, actor,
            preClassification: claimed.recovery.pre_state_classification,
            finalClassification,
            providerAttempted,
            providerOutcome,
            communicationAttempted,
            communicationOutcome: communication.outcome,
            replay: recoveryReplay,
            executionEpoch,
            plannedAction: selectedAction
        });
        return {
            replay: recoveryReplay,
            classification: receipt.final_classification || finalClassification,
            receipt
        };
    }

    return Object.freeze({ inventory, inspect, dryRun, execute, entryFor });
}

module.exports = { CLASSIFICATIONS, createBookingRecoveryService };
