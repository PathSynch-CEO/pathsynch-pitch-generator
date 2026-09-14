# SYNCH-P2-0001 booking authority and rollout

Status: branch candidate only. No deployment, Scheduler mutation, secret mutation, or traffic change.

## Authority contract

The public session route resolves its host before persistence. Stable authority is the configured
SynchIntro user UID plus workspace ID. The server verifies all of the following on every session route
and again when availability or booking is requested:

- Firebase Auth user exists and is not disabled.
- `users/{uid}` exists and supplies the canonical display profile.
- `workspaceMembers/{workspaceId}_{uid}` exists, matches both identifiers, and is active.
- Server-owned routing and scheduling flags are enabled.
- The Auth email maps to the configured Nylas organizer. Email validates the provider mapping; it is
  not the permanent routing identity.

The browser receives only a hashed public specialist reference and display-safe profile fields. It
cannot submit a host, workspace, organizer, grant, configuration, policy, or template override.

The current pilot intentionally maps every approved qualification route to one canonical configured
host. For Charles's pilot, the canonical profile must resolve to `Charles Berry`; later multi-host or
admin UI work is deferred.

## Scheduling and identity contract

SynchIntro enforces Monday-Friday, 09:00 through 16:00, in `America/New_York`. A meeting must start
and end on an allowed local day and be fully contained within that window. Provider results outside
the policy are filtered before receipt issuance, and a tampered or stale request is rejected again
before Nylas create. The accepted 30-minute duration and minimum-notice rules are unchanged.

First name, last name, and email are required at identity capture and stored in the server booking
session. Nylas booking creation derives the primary guest from that stored session identity; arbitrary
booking-step identity fields are neither accepted nor trusted.

## Communications contract

Before claiming a booking operation or calling the provider, the backend reads the referenced Nylas
Scheduler Configuration and requires `event_booking.disable_emails` (or the group equivalent) to be
exactly `true`. Otherwise the request fails closed. After the provider booking and calendar event are
verified and durably confirmed, SynchIntro sends one branded SendGrid message to the persisted primary
guest. A Firestore delivery claim prevents confirmed replay from sending a second message. An
ambiguous SendGrid outcome is held for reconciliation rather than retried blindly.

Legacy booking operations created before durable confirmation identity and specialist snapshots
retain a null delivery classification during reconciliation. Provider evidence may confirm the
booking, but SynchIntro deliberately does not send a new message because Nylas may already have sent
the original confirmation. Only operations created under the new contract may enter the branded
`PENDING -> SENDING -> SENT` delivery state machine.

Cancel/reschedule links are not exposed by the current normalized provider result, so they are
deliberately deferred instead of fabricating an unsafe link.

## Founder-controlled production decision

Required before rollout; not executed by this branch.

Exact mutation:

1. Read the full live Scheduler Configuration and retain a redacted rollback snapshot.
2. Issue Nylas `PUT /v3/grants/{grant_id}/scheduling/configurations/{configuration_id}` with the full
   existing nested objects preserved, while setting:
   - `availability.availability_rules.default_open_hours` to days `[1,2,3,4,5]`, timezone
     `America/New_York`, start `09:00`, end `16:00`;
   - `event_booking.timezone` to `America/New_York`;
   - `event_booking.disable_emails` to `true`.
3. Configure `SYNCHINTRO_BOOKING_HOST_USER_ID` to Charles's stable SynchIntro UID and
   `SYNCHINTRO_BOOKING_WORKSPACE_ID` to the canonical PathSynch workspace. Keep both host flags true.
4. Verify `SENDGRID_API_KEY` is bound to the deployed API runtime and the approved sender is active.
5. Deploy only after separate authorization, then run the exact acceptance journey and verify one
   event plus one branded customer email.

Why: Nylas sends Scheduler confirmations by default; server-side filtering alone cannot remove that
duplicate. Aligning Nylas open hours also reduces drift even though SynchIntro remains the enforcing
authority.

Risk: YELLOW. Nylas Configuration updates replace nested objects, so a partial body could erase
participants, conferencing, reminders, or other accepted settings. Incorrect UID/workspace values
would fail closed and make the public scheduler unavailable. An unverified SendGrid sender would leave
a confirmed booking with an ambiguous email outcome.

Rollback: restore the redacted pre-change Configuration snapshot with a full PUT, restore the prior
runtime environment values, and roll back the application revisions. Keep traffic on the current
revision until post-deploy acceptance is complete.

Evidence: unit and integration tests cover server host resolution, disabled/cross-workspace denial,
Eastern policy boundaries and DST, exact Nylas guest payload, provider email-suppression preflight,
provider/event verification, durable booking idempotency, and single confirmation delivery authority.
A live read was attempted on 2026-09-13 but the available Firebase CLI credential required reauthentication;
no secret, provider identifier, or production setting was printed or changed.

Recommendation: approve the configuration change only with the full current Configuration snapshot in
hand, then apply it immediately before the authorized backend deployment. Do not deploy this code while
Nylas confirmation email suppression or the canonical host configuration is absent, because it is
designed to fail closed.
