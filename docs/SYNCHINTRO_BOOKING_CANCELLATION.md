# SYNCH-P2-0003 booking cancellation contract

Status: branch candidate only. No deployment, provider mutation, production cleanup, traffic change,
or merge is included.

## Authority and public contract

Cancellation is an extension of the existing durable booking operation, not an arbitrary provider
route. `POST /v1/booking-sessions/{sessionId}/cancellations` requires the original opaque
`X-SynchIntro-Session-Token`, a fresh stable cancellation `Idempotency-Key`, and this exact body:

```json
{ "booking_idempotency_key": "the-original-booking-operation-key" }
```

The raw session and idempotency keys remain browser-memory-only. Firestore contains only their
SHA-256 digests. The backend resolves the booking operation, workspace routing receipt, guest,
specialist, Scheduler booking ID, calendar event ID, and provider configuration from server-owned
state. Unknown fields are rejected, so a client cannot submit a provider event, organizer,
workspace, host, or provider override. A mismatched session or capability fails closed.

The public management capability has an immutable deadline (currently 30 days from the booking
operation). A cancellation validly claimed before that deadline retains the durable operation for a
fresh settlement window without extending public booking replay or authorizing a new cancellation.
Only the already-bound cancellation idempotency key, original session capability, and session may
resume unfinished cancellation or communication work during that retained window. A safely persisted
preflight failure or definitive provider rejection ends that attempt; any later retry is again governed
by the immutable public deadline. Capabilities are never placed in a URL, response body, log, analytics
event, or durable plaintext field. Legacy records pin their original retained deadline as the immutable
management deadline. A genuinely pre-field pending record receives one fresh settlement deadline on
its first safe resume; that deadline is then fixed across every later recovery.

## State and idempotency

Booking creation state remains `CONFIRMED`; its original result and provider evidence are immutable.
Cancellation is a separate lifecycle dimension:

`CONFIRMED → CANCELLATION_PENDING → CANCELLING → CANCELLED`

An uncertain provider or persistence outcome transitions to
`CANCELLATION_RECONCILIATION_REQUIRED`. `CANCELLED` is terminal. The cancellation operation key is
bound by digest to the booking. A pre-egress `CANCELLATION_PENDING` lease can be reclaimed safely;
after the atomic `CANCELLING` fence, no elapsed lease grants another provider mutation. Parallel or
different-key requests cannot obtain a second provider-cancel authority. Claim-token rotation and
state checks fence stale workers. The first valid claim also pins one cancellation-settlement
retention deadline; lease recovery reuses that deadline and cannot renew it. A provider or read-only
reconciliation lease is granted only when the complete lease fits strictly inside that fixed
deadline, so a near-expiry recovery cannot perform provider I/O that it cannot durably settle.

Same-operation replay returns the established cancelled result. A request for an already-cancelled
booking also returns that result without provider I/O. Original booking ID, event ID, routed host,
guest, attendee set, time, and confirmation evidence are preserved; cancellation adds rather than
replaces historical evidence.

Once cancellation leaves `CONFIRMED`, original booking replay cannot return a confirmed result and
the original confirmation-delivery claim/egress gates are revoked. An expired `CANCELLING` provider
lease moves the operation to reconciliation and clears the stale worker's claim; it never grants a
second DELETE.

Cancellation cannot start while an original confirmation send lease is active. If that delivery
lease has expired after egress began, the confirmation delivery moves to reconciliation and the
booking remains `CONFIRMED`; provider cancellation is not attempted until communication outcome is
resolved.

## Nylas boundary and recovery

Before mutation, the service re-reads the Scheduler Configuration and requires customer emails to
remain disabled. It then retrieves the durable Scheduler booking and provider event and verifies
their IDs, organizer, title, guest set, exact instant, duration, timezone, calendar, and confirmed
status against the stored booking.

The retained operation's provider name and Scheduler configuration must also match the active
server-owned provider binding before any provider request. A mismatch requires reconciliation and
does not probe or mutate a different provider configuration.

The supported mutation is:

`DELETE /v3/scheduling/bookings/{booking_id}?configuration_id={configuration_id}`

Nylas documents this operation as deleting the Scheduler booking and cancelling its associated
provider event. Direct event deletion is not used. The request path uses only the server-owned
booking ID and a fixed server-authored cancellation reason. A successful request ID is retained with
the exact expected booking/event IDs as evidence.

DELETE timeouts, transport failures, 408/425/429/5xx responses, malformed success responses, and
post-provider persistence failures are ambiguous. They never become false `CANCELLED` results and
are never retried blindly. An exact-key replay can acquire one fenced read-only reconciliation lease
and re-read the retained Scheduler booking and event. It never issues another DELETE. A missing
Scheduler booking is accepted as already cancelled only when
the separately retrieved, exact durable event still matches organizer, title, attendees, calendar,
instant, duration, and timezone and has provider status `cancelled`. That exact evidence transitions
the operation from `CANCELLATION_PENDING` or `CANCELLATION_RECONCILIATION_REQUIRED` to `CANCELLED`
without recording or issuing a provider mutation. An active event, any other 404, an unavailable
read, or a preflight identity/status mismatch remains reconciliation-required. A lost
acknowledgement of the durable provider-attempt fence stops before provider I/O and is represented
conservatively.

Transient or throttled preflight reads restore safe retry without entering permanent
reconciliation. A definitive non-retryable provider DELETE 4xx rejection other than 404 is durably
recorded and restores `CONFIRMED`, allowing a deliberate later retry; if that local rejection
transition cannot be proved, reconciliation is required. DELETE 404 remains ambiguous because the
provider booking could have been cancelled between preflight verification and mutation, so it
requires reconciliation instead of asserting that the meeting remains confirmed.

## Communications

After `CANCELLED` is durable, SynchIntro sends one branded SendGrid cancellation message using the
persisted primary guest, specialist, original title, time, and timezone. Nylas customer emails must
remain disabled. Cancellation email delivery is an independent state dimension:

`PENDING → CLAIMED → SENDING → SENT`

An interruption before `SENDING` can reclaim a bounded lease. An interruption or error after
`SENDING` becomes `RECONCILIATION_REQUIRED` and cannot blindly resend. Email failure never rolls the
provider/calendar cancellation back; the public result remains cancelled and reports communication
reconciliation separately. A failure to read or claim cancellation delivery also returns the durable
cancelled result with communication reconciliation required rather than falsely representing the
booking as confirmed. The internal reconciliation transition is fenced to the retained delivery
attempt and requires an injected trusted provider-evidence verifier. Only the verifier's definitive
SendGrid `ACCEPTED` or `DELIVERED` result is used, and its authenticated custom arguments must bind the
stored cancellation-delivery ID and exact retained attempt ID. Caller-asserted outcome or message
identity never settles the record. The transition records the verified provider message and evidence
identifiers as `SENT` without granting another email send; absent, mismatched, or ambiguous evidence
remains reconciliation-required.

Production verification is wired to `POST /v1/sendgrid/events`. The route runs before Firebase user
authentication because the SendGrid ECDSA signature over the timestamp plus untouched `rawBody` is
its authority. It accepts only fresh, signed `processed` or `delivered` events with the two opaque
custom arguments emitted by the cancellation mailer, deduplicates by the retained delivery-attempt
identity, never stores recipient email or provider payloads, and never downgrades `DELIVERED` to
`ACCEPTED`. The non-secret `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` must be configured and SendGrid's
signed Event Webhook must target this route before production deployment; that later configuration
change is outside this branch-only work package and requires its own authorization.

## Drift and cleanup

Operational drift checks must compare durable cancellation state with Scheduler booking/event state
and compare cancellation delivery state with SendGrid evidence. `CANCELLED` plus an active provider
event, a provider-cancelled event plus local `CONFIRMED`, or `SENT` without `CANCELLED` is blocking.

Existing SYNCH-P2-0001/SYNCH-P2-0002 synthetic meetings must only be inventoried with redacted
references. After a separately authorized merge, deployment, and cleanup window, each applicable
meeting must be cancelled through this supported contract. A retained booking can use the public
contract only when its original raw capability and operation key remain available; a legacy record
with digest-only evidence must remain explicitly inapplicable until a separately authorized,
supported operator migration is approved. Direct Firestore deletion, direct event deletion, and
unsupported provider-console cleanup remain prohibited.

## Invariants

- CANCEL-001: `CANCELLED` is durable and terminal.
- CANCEL-002/003: replay is stable and one logical operation grants at most one provider mutation.
- CANCEL-004/008: provider success is bound to preserved booking/event evidence.
- CANCEL-005: stale workers cannot overwrite a newer terminal result.
- CANCEL-006: ambiguity never proves cancellation.
- CANCEL-007: already-cancelled requests return the established result.
- CANCEL-009: wrong booking/session/workspace authority is denied.
- CANCEL-010/011/012: communication is separately idempotent and cannot undo cancellation.
