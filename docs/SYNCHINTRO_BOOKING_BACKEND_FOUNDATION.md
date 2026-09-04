# SynchIntro booking backend foundation

Status: contract-only starter; no public route, persistence, Nylas call, Attio write, email, or
deployment is included.

## What is implemented

- `functions/services/booking/bookingContract.js` validates and normalizes booking-session creation,
  final company/qualification context, selected slots, and up to three guest emails.
- The server allow-lists the same UTM/campaign keys as the browser and drops attribution values that
  resemble an email address or phone number.
- `bookingRequestFingerprint()` and `assessIdempotency()` define double-submit behavior without
  retaining raw request data as the lookup key.
- `functions/services/booking/bookingRouting.js` encodes the approved owner precedence: schedulable
  existing Attio owner → approved campaign owner → deterministic qualification owner → round robin →
  explicit fallback. It fails closed if no schedulable owner exists.
- `functions/services/booking/schedulingProvider.js` defines the calendar-adapter surface and returns
  an explicit `PROVIDER_NOT_CONFIGURED` error until Nylas is configured.

The browser is never allowed to choose a host, owner, campaign mapping, routing-rule version,
provider configuration, or Attio identifier.

## Contract invariants

- Identity email is normalized to lowercase and the timezone must be a valid IANA identifier.
- Unknown top-level or nested request fields are rejected.
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

## Next implementation after Charles creates Nylas

1. Confirm the region, Nylas application/client ID, organizer grant IDs, and one Scheduler
   configuration per eligible specialist or routing group.
2. Store API keys and webhook secrets in the approved secret manager; never in tracked files or
   browser configuration.
3. Implement the Nylas adapter behind `schedulingProvider.js` with a non-production calendar and
   provider-level contract tests.
4. Add persistent booking sessions, current-version availability receipts, idempotency records, and
   an outbox for email/Attio work.
5. Add rate limiting and abuse controls before mounting any unauthenticated public route.
6. Verify signed provider webhooks and enforce version ordering for reschedule/cancel events.
7. Connect the frontend adapter only after double-submit, stale-slot, provider-timeout, webhook-
   replay, and Attio-outage tests pass.

## Deliberately not implemented

- No mock adapter is used as a production fallback.
- No Firestore collection or security rule is introduced before the retention, access, and cleanup
  policy is reviewed.
- No public endpoint is mounted before rate limiting, origin policy, token/session design, and abuse
  tests are agreed.
- No owner mapping is hard-coded; IDs must come from trusted configuration.
- No Attio workflow or workspace object is changed by this branch.
