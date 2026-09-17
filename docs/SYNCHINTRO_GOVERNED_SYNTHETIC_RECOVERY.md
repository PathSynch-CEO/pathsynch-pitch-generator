# SYNCH-P2-0004 Governed Synthetic Booking Recovery

Status: design approved for bounded implementation; no merge, deployment, or production cleanup authority.

## Evidence and scope

A fresh read-only inventory on 2026-09-16 found exactly seven governed synthetic booking operations. Every operation retains a canonical session, workspace routing binding, Nylas configuration binding, provider booking/event identity, and confirmed booking result. The provider/configuration and workspace bindings match the currently deployed SynchIntro booking authority. The current classifications are:

- four `CANCEL_REQUIRED`;
- one `PROVIDER_RECONCILIATION_REQUIRED` (provider cancelled, local state confirmed);
- two `ALREADY_CLEAN`.

The inventory emitted only stable digests and redacted state. It did not change Firestore, Nylas, SendGrid, Firebase configuration, or traffic. Production records remain read-only throughout implementation and review.

This package adds a backend-only operator recovery surface. It does not change the customer cancellation route, customer capability contract, frontend, Nylas configuration, SendGrid configuration, or general admin behavior.

## Operator authority

The API reuses the existing Firebase identity and `admins` collection. Recovery requires all of the following:

1. a valid Firebase ID token verified by the existing central authentication path, issued no earlier than the Firebase user's current revocation boundary;
2. a verified email address;
3. a Firestore `admins/{normalizedEmail}` record (the environment-email fallback is not accepted);
4. exact `super_admin` role, an admin record that is not disabled, and an enabled Firebase user;
5. a recent `auth_time` (15 minutes maximum age);
6. the server-side route permission `synchintro.synthetic_recovery` implied only by this exact role and route;
7. an operation in the compiled, server-authoritative SYNCH-P2 allowlist.

The actor UID and normalized-email digest are bound into the recovery operation and audit receipt. The raw email is not persisted in recovery evidence. Ordinary admins, workspace roles, public booking clients, static shared secrets, and customer session capabilities cannot invoke recovery.

## Explicit allowlist

The allowlist is immutable application configuration in the private backend source. Each entry has a stable operator-safe reference and binds:

- work package/provenance;
- booking idempotency digest, from which the canonical operation document is derived;
- operation-document digest;
- session digest;
- workspace digest;
- synthetic attendee identity digest;
- provider configuration digest;
- allowed intent, always `CANCEL_AND_RECONCILE`.

The operator supplies only the safe reference. The server derives the operation document; free-form session, workspace, provider booking, provider event, attendee, or configuration identifiers are rejected because they are not request fields. Every durable value is re-hashed and compared with the allowlist before provider I/O or mutation. Email/title/time heuristics never grant authority.

Adding a record requires a reviewed source change and a new exact-head candidate. The seven-entry allowlist is therefore both bounded and expiring by code replacement; it cannot become arbitrary booking authority.

## Operator surface

The initial surface is an authenticated admin API plus a CLI. There is no customer-facing UI and no broad admin dashboard.

- `GET /admin/synchintro/synthetic-recovery` — bounded inventory of allowlisted references.
- `GET /admin/synchintro/synthetic-recovery/:reference` — inspect one record.
- `POST /admin/synchintro/synthetic-recovery/:reference/dry-run` — deterministic plan and non-persisted audit receipt; no Firestore/provider/email mutation.
- `POST /admin/synchintro/synthetic-recovery/:reference/execute` — one record and one recovery operation identity.
- `GET /admin/synchintro/synthetic-recovery/receipts/:recoveryOperationId` — sanitized immutable receipt lookup for the authenticated actor.

The CLI accepts a fresh Firebase ID token through an environment variable, never prints it, and requires an explicit safe reference. Its destination is pinned to the production SynchIntro API; arbitrary base-URL overrides are rejected so the bearer token cannot be redirected. Execution additionally requires an operator-supplied recovery operation ID and confirmation of the same safe reference. It performs one record per invocation.

## Dry-run and classification

Dry-run loads the exact operation and session, validates every allowlist binding, verifies the runtime provider configuration, and performs Nylas Scheduler booking/event reads through the existing adapter. It returns one of:

- `ALREADY_CLEAN`;
- `CANCEL_REQUIRED`;
- `PROVIDER_RECONCILIATION_REQUIRED`;
- `COMMUNICATION_RECONCILIATION_REQUIRED`;
- `STATE_AMBIGUOUS`;
- `NOT_ALLOWLISTED`;
- `UNSUPPORTED`;
- `MANUAL_REVIEW_REQUIRED`.

The dry-run receipt is returned to the operator with a deterministic content digest but is not written to Firestore, because dry-run must perform no database mutation. It contains no capability, raw provider identifier, secret, or customer identity.

## Recovery state machine and fencing

Each execution uses a separate `synchintroSyntheticRecoveryOperations` document keyed by the SHA-256 digest of the recovery operation ID. It binds the actor, safe reference, durable operation, workspace, intent, and pre-state fingerprint. The booking operation also stores the bound recovery digest, preventing a second logical recovery identity from acquiring authority.

States are:

`CLAIMED -> PROVIDER_ATTEMPTING -> PROVIDER_CANCELLED -> COMMUNICATION_PENDING -> COMPLETE`

with fail-closed branches to `RECONCILIATION_REQUIRED` or `MANUAL_REVIEW_REQUIRED`. `ALREADY_CLEAN` can transition directly to `COMPLETE` after exact verification.

The claim transaction creates one winner and a short lease. A second worker with the same identity remains `in_progress` while that lease is live; it can replay or reconcile only after the durable state permits it. A changed actor, record, or intent under the same key is rejected. A different key for an already-bound record is rejected. Before provider egress, a second transaction changes `provider_attempt_count` from zero to one and records `PROVIDER_ATTEMPTING`. That transaction also fences the canonical booking operation. The customer cancellation route checks the same operation-document fence, so recovery and customer cancellation cannot both obtain provider-mutation authority. No recovery path can authorize a second provider attempt.

When a provider-attempt lease expires, the next same-operation claimant atomically adopts the record into `RECONCILIATION_REQUIRED`, rotates the claim token and lease, and increments a monotonic claim epoch. Every later provider settlement requires the current token and a live lease, while immutable receipt creation requires the current epoch. The superseded worker therefore cannot persist `CANCELLED`, rejection, ambiguity, or a contradictory receipt after adoption. The adopted worker has read-only provider reconciliation authority only.

Recovery will not acquire provider authority while the original booking confirmation is unsettled. The original `confirmation_delivery_state` must be exactly `SENT`; an active or ambiguous original-confirmation send fails closed for reconciliation before any provider mutation.

Each attempt is terminally audited. If an attempt ends in `RECONCILIATION_REQUIRED`, its same-operation replay returns the immutable result and cannot perform another side effect. A fresh recovery operation identity may replace that binding only when the prior recovery has an immutable receipt, remains explicitly in `RECONCILIATION_REQUIRED`, and a fresh inspection classifies the record as provider reconciliation, communication reconciliation, or already clean. Such a continuation is stamped `READ_ONLY_RECONCILIATION`; it cannot re-enter `CANCEL_REQUIRED` and therefore cannot issue a second provider mutation.

## Provider behavior

Target verification is shared with customer cancellation: canonical confirmed result, exact organizer/title/time/duration/attendees, stored provider booking/event identities, and configured Scheduler identity must all agree.

For `CANCEL_REQUIRED`, the fenced winner:

1. confirms Scheduler customer emails are disabled;
2. verifies the booking and event using the shared cancellation target verifier;
3. records the provider-attempt fence;
4. calls only Nylas Scheduler booking `DELETE` through `provider.cancelBooking`;
5. verifies/persists the provider result or marks ambiguity.

Direct event deletion is not implemented.

For `PROVIDER_RECONCILIATION_REQUIRED`, the shared verifier must prove that the Scheduler booking is absent/cancelled and that the retained event is cancelled with exact identity. The service then reconciles local terminal truth without issuing `DELETE`.

A timeout, malformed response, 404 after egress, or persistence uncertainty never grants another provider mutation. Replay performs provider GET reconciliation only. A definitive non-404 provider rejection is recorded distinctly as `MANUAL_REVIEW_REQUIRED`, restores no cleanup authority, sends no communication, and cannot be replaced by a new cancellation operation.

## Durable cancellation and communication

Recovery uses the existing cancellation field contract on the booking operation. The terminal transition sets `cancellation_state=CANCELLED`, retains the original provider identities, creates the established deterministic cancellation-delivery identity, and never fabricates a customer capability.

Communication remains SendGrid-only and uses the established cancellation mailer and cancellation-delivery fields. A transaction grants at most one send attempt. An active `CLAIMED` or `SENDING` lease returns `in_progress`. Because `CLAIMED` is still pre-egress, an expired `CLAIMED` lease can be reclaimed with a new fenced token and attempt identity; `SENDING` is the irreversible egress boundary, so an expired `SENDING` lease is durably promoted to `RECONCILIATION_REQUIRED` and never grants resend authority. `SENT`, an expired/unknown outcome, and signed delivery-evidence reconciliation likewise never grant resend authority. Nylas customer emails must still be disabled. Communication failure cannot reopen provider cancellation truth, and an ambiguous or interrupted send is audited from durable same-operation history as one attempted communication rather than as no attempt.

Dry-run distinguishes a terminal cancellation whose delivery remains pristine `PENDING` (the plan discloses one controlled SendGrid cancellation) from an attempted or uncertain delivery (the plan is evidence-only reconciliation). This keeps the operator plan aligned with the executable state machine without granting resend authority.

The current seven entries bind only to previously governed synthetic identities. Before any future live execution, a fresh dry-run must confirm recipient classification; production execution still requires separate per-record founder authority.

## Audit receipt

Every execution attempt creates one immutable `synchintroSyntheticRecoveryReceipts` document. Receipt creation is bound to the current claim epoch, so a superseded worker cannot win the audit transaction after a recovery claimant is adopted. Same-operation replay reads and returns the established exact receipt before any provider readback. If a worker committed terminal recovery state but stopped before the receipt transaction, replay deterministically reconstructs the missing receipt from durable recovery metadata without provider I/O or another side effect. A separately identified read-only reconciliation continuation, when required, creates its own predecessor-bound receipt. The receipt contains:

- recovery operation digest and work package;
- actor UID digest, email digest, and role;
- timestamp;
- safe reference and operation/session/workspace binding digests;
- allowlist provenance and intent;
- pre-state classification and planned action;
- provider action attempted/count/outcome;
- durable transition;
- communication action/count/outcome;
- replay/idempotency result;
- final classification;
- explicit redaction status.

It never contains raw session capabilities, idempotency keys, customer email/name, provider booking/event IDs, API keys, bearer tokens, signing material, or unrestricted credentials.

## Security boundaries

- Recovery routing occurs after Firebase authentication, outside the public capability routes.
- The environment-admin fallback is deliberately insufficient.
- Only `super_admin` with recent verified, non-revoked authentication for an enabled Firebase user is accepted.
- The request cannot nominate provider/customer/workspace identities.
- Exact allowlist and durable binding checks occur before any side effect.
- Inventory and dry-run are read-only.
- Execution is one record, one stable intent, and one fenced provider attempt.
- Provider ambiguity fails closed into read-only reconciliation.
- Audit and API responses are allowlisted/sanitized projections.
- No migration, new credential, third-party configuration, frontend, deployment, or production mutation is required for the candidate.

## Acceptance and later authority

Implementation tests cover authority, allowlist substitution, dry-run non-mutation, deterministic classification, single-winner execution, stale fencing, Scheduler-only cancellation, provider ambiguity, provider-cancelled/local-confirmed repair, communication at-most-once, signed evidence reconciliation, terminal truth, audit redaction/immutability, native Firestore timestamps, tenant isolation, and route/runtime composition.

After merge and a separately authorized deployment, operators must run a fresh read-only inventory. Each production record then requires explicit founder cleanup authority for its exact safe reference, current classification, planned provider action, and communication plan. This document grants none of those actions.
