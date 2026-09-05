# SynchIntro booking backend foundation

Status: contracts, server-only persistence, Nylas v3 REST orchestration, and the minimum public
booking-session API boundary. No live test call, Attio write, email, rule/index/TTL configuration,
frontend change, or deployment is included.

## What is implemented

- `functions/services/booking/bookingContract.js` validates and normalizes booking-session creation,
  final company/qualification context, selected slots, and up to three guest emails.
- The server allow-lists the same UTM/campaign keys as the browser and drops attribution values that
  resemble an email address or phone number.
- The standard manual campaign contract includes `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_id`, `utm_term`, and `utm_content`; internal campaign and landing identifiers remain separate.
- `bookingRequestFingerprint()` and `assessIdempotency()` define double-submit behavior without
  retaining raw request data as the lookup key.
- `functions/services/booking/bookingRouting.js` encodes the approved owner precedence: schedulable
  existing Attio owner → approved campaign owner → deterministic qualification owner → round robin →
  explicit fallback. It fails closed if no schedulable owner exists.
- `functions/services/booking/schedulingProvider.js` defines the calendar-adapter surface and returns
  an explicit `PROVIDER_NOT_CONFIGURED` error until Nylas is configured.
- `functions/services/booking/bookingPersistence.js` provides injected Firebase Admin/Firestore
  persistence for booking sessions, exact issued-slot receipts, and idempotent booking operations.
  It is not mounted on an HTTP route.
- `functions/services/booking/nylasHttpClient.js` is a small server-only `fetch` client with a
  15-second timeout, a 1 MiB response limit, deterministic HTTP/transport classification, and no
  logging or raw-response propagation.
- `functions/services/booking/nylasSchedulingProvider.js` implements Scheduler availability,
  booking creation/retrieval, and primary-calendar event retrieval behind the provider boundary.
- `functions/services/booking/bookingOrchestrator.js` issues durable availability receipts, fences
  the one authorized provider create, verifies the resulting Nylas booking and event, persists only
  normalized confirmation data, and exposes an internal reconciliation operation.
- `functions/routes/bookingRoutes.js` mounts only session creation, availability, and booking. It
  delegates provider and idempotency behavior to the existing orchestrator.
- `functions/services/booking/bookingOriginPolicy.js` and `bookingApiRateLimiter.js` enforce an
  exact booking-origin allow-list plus fail-closed Firestore-backed IP/session limits.

The browser is never allowed to choose a host, owner, campaign mapping, routing-rule version,
provider configuration, or Attio identifier.

## Contract invariants

- Identity email is normalized to lowercase and the timezone must be a valid IANA identifier.
- Unknown top-level or nested request fields are rejected, except attribution: non-allow-listed
  attribution keys and PII-like attribution values are deliberately discarded.
- Company domain and URL are structurally validated; matching and enrichment remain separate work.
- Goal, category, and team size are bounded enums. Catch-all detail is required only for
  `Something else` and `Other`.
- Slots carry both `session_version` and `availability_version`. Runtime persistence must verify the
  selected slot was issued for both current versions before calling the provider.
- Guests are normalized, unique, limited to three, and cannot repeat the prospect's email.
- An idempotency key must be 16–128 URL-safe identifier characters. Reusing it with the same
  normalized request fingerprint replays the original response; reusing it with different data
  conflicts.
- Fingerprints are computed only after successful normalization and validation.

## Server-only Firestore records

All three collections are accessed through the Firebase Admin SDK. Browser clients receive no
direct Firestore access, and this slice does not change security rules.

### `synchintroBookingSessions/{sessionId}`

The server generates an opaque `bks_*` identifier. A record retains only normalized session
continuity data: `flow_id`, `session_version`, current `availability_version`, status, normalized
identity, timezone, allow-listed attribution, normalized company and qualification context,
minimal routing state (`owner_id`, source, and rule version), and timestamps. Updates compare the
expected version in a Firestore transaction and increment `session_version`. Expiry and a non-active
status fail closed. An opaque booking-operation reservation serializes claims across different
idempotency keys; definitive failure releases it, while confirmation marks the session `BOOKED`.
Session-context updates and newer availability receipts are rejected while that reservation is
active, so a claimed slot cannot be invalidated before the provider attempt begins.
Public sessions additionally contain only a SHA-256 digest of a random
capability token. The raw token is returned once at creation, is presented only in
`X-SynchIntro-Session-Token`, and is never stored or returned by normal session reads.

### `synchintroAvailabilityReceipts/{receiptId}`

The server derives an opaque `avr_*` identifier by hashing the server session ID and monotonically
issued `availability_version`. This makes the receipt directly addressable from the existing booking
contract without a query, index, or new client field. Issuing a receipt transactionally increments
the session version counter and stores the exact normalized slots, session/version binding, timezone,
and optional non-secret provider/configuration reference. Slot acceptance requires an exact
ID/start/end/timezone match and the current session and availability versions. A new receipt
supersedes older receipts, and a relevant session update invalidates them through `session_version`.

### `synchintroBookingOperations/{idempotencyKeyHash}`

The document ID is `op_` plus SHA-256 of the normalized caller idempotency key. The raw key is never
stored. A Firestore transaction gives provider-create authority to exactly one claimant and stores
the normalized request fingerprint plus its session, receipt, availability, and slot binding.
A normalized selected-slot and attendee snapshot remains on the operation so reconciliation does not
depend on the shorter-lived session or availability receipt.
A random claim token is returned only to the winning server execution; only its digest is stored.
Claims use a five-minute lease. A `CLAIMED` operation may be safely resumed after that lease because
no external create was authorized until the atomic `PROVIDER_PENDING` transition; rotating the
digest fences the earlier execution.

The operation state machine is:

`CLAIMED` → `PROVIDER_PENDING` → `CONFIRMED`

Definitive failures may transition from `CLAIMED` or `PROVIDER_PENDING` to `FAILED`. If a provider
may have accepted the request but confirmation is incomplete, `PROVIDER_PENDING` transitions to
`OUTCOME_UNKNOWN`. Both `PROVIDER_PENDING` and `OUTCOME_UNKNOWN` deny another provider create.
`OUTCOME_UNKNOWN` retains provider booking/event identifiers when known and is marked for later
reconciliation. Provider and reconciliation attempts use five-minute leases. Once a provider lease
expires, exactly one reconciliation claimant receives a rotated token that authorizes verification
and a terminal transition but explicitly does not authorize another provider create. This design
does not claim atomic or exactly-once behavior across Firestore and an external scheduling provider.

Confirmed same-key/same-request calls replay the stored normalized result. Reuse with another
fingerprint, session, version, receipt, or slot conflicts. Expired operations fail closed rather than
being restarted in place. Both an initial claim and a resumed `CLAIMED` lease atomically revalidate
the exact current receipt-backed slot and its provider/configuration binding before provider-create
authority is returned.
Confirmation must have a booked/confirmed status and exactly match the operation's selected times,
timezone, and attendee set before the operation or session can become confirmed/booked.

Each operation also stores the exact normalized selected-slot and attendee-email intent snapshot.
This is the minimum non-secret data needed to verify a known provider booking during reconciliation
without depending on a session or availability receipt's shorter retention window.

## Nylas runtime configuration

The adapter reads the credential only from `NYLAS_API_KEY`. It requires these non-secret values:

- `NYLAS_GRANT_ID=6bdacd32-9d31-442e-ab19-100e5dec2b24`
- `NYLAS_SCHEDULER_CONFIGURATION_ID=deee6623-a154-4a86-9085-163aa0e58a67`
- `NYLAS_EXPECTED_ORGANIZER=hello@pathsynch.com`
- `NYLAS_EXPECTED_TIMEZONE=America/New_York`
- `NYLAS_EXPECTED_DURATION_MINUTES=30`
- `NYLAS_EXPECTED_EVENT_TITLE=SynchIntro Strategy Call`
- `NYLAS_BOOKING_CALENDAR_ID=primary` (optional; only `primary` is accepted by this slice)

No secret is exposed through provider metadata, errors, logs, persisted records, or normalized
client results. Tests inject strict `fetch` and provider fakes and make no live Nylas calls.

`NYLAS_API_KEY` is bound to the API function as an environment-only Firebase secret. The value must
never be placed in a client environment, source file, log, or request.

The REST adapter uses:

- `GET /v3/scheduling/availability` with `start_time`, `end_time`, and `configuration_id`.
- `POST /v3/scheduling/bookings` with the configuration/timezone query and documented booking body.
- `GET /v3/scheduling/bookings/{booking_id}` with `configuration_id`.
- `GET /v3/grants/{grant_id}/events/{event_id}` with `calendar_id=primary`.

Successful booking creation is not enough to return success. The orchestrator retrieves both the
Scheduler booking and its provider event, then verifies identifiers, organizer, title, exact time
range, duration, primary-calendar lookup, participant presence, timezone where returned, and
confirmation status. Only then does it persist `CONFIRMED`.

An explicit 4xx create response may become `FAILED`. A POST timeout, transport failure, 429, 5xx,
oversized/malformed success body, or any failure after a create may have reached Nylas becomes
`OUTCOME_UNKNOWN`. Known booking/event IDs are retained when available. Reconciliation can verify
those IDs and transition to `CONFIRMED`; it never issues another create and remains fail-closed when
no identifiers exist or the provider cannot prove the intended event.

## Retention and future TTL fields

- Booking sessions: `expires_at`, default 24 hours.
- Availability receipts: `expires_at`, default 60 minutes and never later than their session.
- Booking operations: `expires_at`, default 30 days.

These timestamps are suitable for eventual Firestore TTL cleanup. No TTL policy or scheduled cleanup
job is created by this slice; expiration is enforced on reads and transactional mutations even while
expired records remain stored.

Secret-like fields, credentials, raw provider payloads, and unsafe document IDs are rejected. The
persistence module emits no logs and maps unexpected Firestore failures to the repository's safe
`ApiError` database convention.

## Public booking API

Both `/v1` and the repository's `/api/v1` compatibility prefix normalize to the same handlers.
The frontend should use one base consistently.

### Create session

`POST /v1/booking-sessions` with `Content-Type: application/json` accepts:

```json
{
  "flow_id": "synchintro_progressive",
  "identity": {
    "email": "buyer@example.com",
    "provider": "email",
    "first_name": "Buyer",
    "last_name": "Example"
  },
  "timezone": "America/New_York",
  "attribution": { "utm_source": "campaign" }
}
```

`company` and `qualification` may also be included, but they must be supplied together and conform
to the established contract. The response is `201` with `success`, client-safe session fields, and
`session_token`. The frontend must retain the token in memory for this flow; it is not recoverable
from a later API read.

### Read availability

`GET /v1/booking-sessions/{sessionId}/availability?start={ISO}&end={ISO}` requires
`X-SynchIntro-Session-Token`. A `200` response contains exactly:

```json
{
  "success": true,
  "data": {
    "session_version": 1,
    "availability_version": 1,
    "timezone": "America/New_York",
    "slots": []
  }
}
```

Issued slots additionally contain `id`, `start`, `end`, `timezone`, and `availability_version`.
Empty slots are a successful result.

### Create booking

`POST /v1/booking-sessions/{sessionId}/bookings` requires `Content-Type: application/json`,
`X-SynchIntro-Session-Token`, and a new 16–128 character URL-safe `Idempotency-Key` generated once
per user booking intent. The body is:

```json
{
  "session_version": 1,
  "slot": {
    "id": "issued-slot-id",
    "start": "2026-09-08T13:00:00.000Z",
    "end": "2026-09-08T13:30:00.000Z",
    "timezone": "America/New_York",
    "availability_version": 1
  },
  "guests": []
}
```

A `200` is returned only after Nylas booking and primary-calendar event verification. The normalized
result includes booking/event IDs, confirmation status, title, organizer and attendee emails,
start/end, timezone, and duration. The same key plus the same normalized request replays that result;
reuse with different booking data returns `409`.

JSON bodies are limited to 16 KiB. Unknown query/body fields, unsupported content types, invalid or
oversized session capabilities, malformed/oversized idempotency keys, and more than three guests are
rejected by the route or existing contract.

## Origin and abuse policy

`SYNCHINTRO_ALLOWED_ORIGINS` is a comma-separated, non-secret exact allow-list for these routes. If
unset, the production booking defaults are `https://app.synchintro.ai` and
`https://synchintro.ai`. A `*` entry is never honored for booking endpoints. Localhost origins and
requests without `Origin` are allowed only when `NODE_ENV` is `test`/`development` or
`FUNCTIONS_EMULATOR=true`; production booking requests without `Origin` are rejected. Absence of
`Origin` is not authentication. A future production server-to-server caller requires a separately
approved authentication policy.

The booking API reuses the repository's distributed Firestore transaction counter, stores only
hashed booking-specific identifiers, derives the network client from Google's appended
`<client-ip>,<load-balancer-ip>` suffix instead of a caller-supplied forwarded prefix, and fails
closed when the counter is unavailable:

- Session creation: 5 requests per IP per 10 minutes.
- Availability: 60 per IP and 30 per authorized session per 5 minutes.
- Booking: 10 per IP and 5 per authorized session per hour.

## Why the integration stays server-side

Nylas supports API-managed configurations, private scheduling sessions, availability, bookings, and
booking lifecycle operations. The SynchIntro UI is already custom, so the intended implementation is
the Scheduler API behind SynchIntro's own short-lived booking session rather than exposing API keys or
trusted routing inputs to the browser. See [Nylas Scheduler](https://developer.nylas.com/docs/v3/scheduler/)
and [booking lifecycle operations](https://developer.nylas.com/docs/cookbook/use-cases/build/manage-bookings/).

Attio workflows can start from record/list changes or incoming webhooks and then branch into record,
task, notification, and integration steps. That supports the CRM automation while keeping calendar
confirmation independent from Attio. See the [Attio workflow block library](https://attio.com/help/reference/automations/workflows/workflows-block-library)
and [Attio V2 webhook guidance](https://docs.attio.com/rest-api/guides/webhooks).

## Remaining integration sequence

1. Configure the production allow-list and documented Nylas runtime values in the target environment.
2. Wire the progressive frontend to the three public endpoints and keep the capability and
   idempotency key out of URLs, analytics, and logs.
3. Verify signed provider webhooks and enforce version ordering before enabling reschedule/cancel.

## Deliberately not implemented

- No mock adapter is used as a production fallback. All provider fakes are test-injected.
- No Firestore security rule, index, TTL policy, or cleanup job is introduced. The new collections
  are server-only and their retention timestamps are documented above.
- No endpoint beyond session creation, availability, and booking is mounted.
- No owner mapping is hard-coded; IDs must come from trusted configuration.
- No Attio workflow or workspace object is changed by this branch.
