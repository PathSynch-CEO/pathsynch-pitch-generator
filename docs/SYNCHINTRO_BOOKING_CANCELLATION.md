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

The management capability expires with the retained booking operation (currently 30 days). It is
replay-safe and is never placed in a URL, response body, log, analytics event, or durable plaintext
field. Bookings created before this change remain eligible while the retained operation exists and
the original capability/key evidence is available.

## State and idempotency

Booking creation state remains `CONFIRMED`; its original result and provider evidence are immutable.
Cancellation is a separate lifecycle dimension:

`CONFIRMED → CANCELLATION_PENDING → CANCELLING → CANCELLED`

An uncertain provider or persistence outcome transitions to
`CANCELLATION_RECONCILIATION_REQUIRED`. `CANCELLED` is terminal. The cancellation operation key is
bound by digest to the booking. A pre-egress `CANCELLATION_PENDING` lease can be reclaimed safely;
after the atomic `CANCELLING` fence, no elapsed lease grants another provider mutation. Parallel or
different-key requests cannot obtain a second provider-cancel authority. Claim-token rotation and
state checks fence stale workers.

Same-operation replay returns the established cancelled result. A request for an already-cancelled
booking also returns that result without provider I/O. Original booking ID, event ID, routed host,
guest, attendee set, time, and confirmation evidence are preserved; cancellation adds rather than
replaces historical evidence.

## Nylas boundary and recovery

Before mutation, the service re-reads the Scheduler Configuration and requires customer emails to
remain disabled. It then retrieves the durable Scheduler booking and provider event and verifies
their IDs, organizer, title, guest set, exact instant, duration, timezone, calendar, and confirmed
status against the stored booking.

The supported mutation is:

`DELETE /v3/scheduling/bookings/{booking_id}?configuration_id={configuration_id}`

Nylas documents this operation as deleting the Scheduler booking and cancelling its associated
provider event. Direct event deletion is not used. The request path uses only the server-owned
booking ID and a fixed server-authored cancellation reason. A successful request ID is retained with
the exact expected booking/event IDs as evidence.

DELETE timeouts, transport failures, 408/425/429/5xx responses, malformed success responses, and
post-provider persistence failures are ambiguous. They never become false `CANCELLED` results and
are never retried blindly. A missing Scheduler booking is accepted as already cancelled only when
the separately retrieved, exact durable event still matches organizer, title, attendees, calendar,
instant, duration, and timezone and has provider status `cancelled`. That exact evidence transitions
the operation from `CANCELLATION_PENDING` to `CANCELLED` without recording or issuing a provider
mutation. Any other 404 or preflight identity/status mismatch requires reconciliation. A lost
acknowledgement of the durable provider-attempt fence stops before provider I/O and is represented
conservatively.

## Communications

After `CANCELLED` is durable, SynchIntro sends one branded SendGrid cancellation message using the
persisted primary guest, specialist, original title, time, and timezone. Nylas customer emails must
remain disabled. Cancellation email delivery is an independent state dimension:

`PENDING → CLAIMED → SENDING → SENT`

An interruption before `SENDING` can reclaim a bounded lease. An interruption or error after
`SENDING` becomes `RECONCILIATION_REQUIRED` and cannot blindly resend. Email failure never rolls the
provider/calendar cancellation back; the public result remains cancelled and reports communication
reconciliation separately.

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
