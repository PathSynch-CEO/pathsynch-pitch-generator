# Progressive booking production acceptance — September 8, 2026

Status: **FULL END-TO-END ACCEPTANCE PASSED**, bounded production proof completed
17:27 UTC. Closeout baseline refreshed at **2026-09-08T17:47:45.214Z**.
This records acceptance of the deployed implementation. It does not authorize another
booking, cancellation, deployment, traffic change, or merge of subsequent hardening.

## Accepted source and live baseline

| Field | Verified value |
| --- | --- |
| Backend source | `30acc3229b85ec8f83479710f95ddbe591dfc8fd` |
| Frontend source | `bb315915852ff76a0de84bafbb37761ba70deb86` |
| Project / region / function | `pathsynch-pitch-creation / us-central1 / api` |
| Serving revision | `api-00416-hoc` |
| Desired / observed traffic | Explicit `api-00416-hoc=100%` / `api-00416-hoc=100%` |
| Latest-created / latest-ready | `api-00416-hoc` / `api-00416-hoc` |
| Service generation / observedGeneration | `419 / 419` |
| Revision UID | `128f8c88-2ee4-49b1-8102-cda61565506a` |
| Revision creation | `2026-09-08T15:20:18.458302Z` |
| Build (SUCCESS) | `projects/796921234100/locations/us-central1/builds/ca6f5952-2937-4594-ad94-b0bb3adc42ca` |
| Immutable source | `gs://gcf-v2-sources-796921234100-us-central1/api/function-source.zip#1788880755948413` |
| Image digest | `sha256:da20102bbc6ea77105cac0480237d0024982ece5561814a5c7787ef6bb308a8a` |
| Hosting release | `projects/pathsynch-pitch-creation/sites/pathsynch-pitch-creation/channels/live/releases/1788872698948000` |
| Hosting version | `projects/pathsynch-pitch-creation/sites/pathsynch-pitch-creation/versions/487f44c5fbc8f7a8` |
| Backend health / production booking page | HTTP 200 / HTTP 200 |
| Required notice | `NYLAS_MIN_BOOKING_NOTICE_MINUTES=60` |

The deployed archive has 588 entries. All contents matched the approved predeploy archive
byte for byte; ZIP container bytes differed. 586 tracked files matched authorized source
with line-ending normalization; two explicitly reviewed ignored files matched saved approved
bytes. Git SHA attribution rests on that comparison and deployment evidence, not a Git SHA
embedded by Cloud Run. Raw deployed archive SHA256:
`61e1e469003e0d5cc0a913f81963ec34f638fb77dacca3bd63d48dee247caf65`.

Required configuration names were present and unchanged: NYLAS_GRANT_ID,
NYLAS_SCHEDULER_CONFIGURATION_ID, NYLAS_EXPECTED_ORGANIZER, NYLAS_EXPECTED_EVENT_TITLE,
NYLAS_EXPECTED_TIMEZONE, NYLAS_EXPECTED_DURATION_MINUTES, SYNCHINTRO_ALLOWED_ORIGINS.
Secret **bindings**, not payloads: IMAGEN_API_ENDPOINT, THEORG_API_KEY, SPYFU_API_KEY,
NYLAS_API_KEY; each bound to version 1. The closeout did not access secret payloads.

## Controlled acceptance evidence

| Check | Result |
| --- | --- |
| Health | 200, expected healthy JSON |
| Session | One fresh POST, 201 |
| Availability | One seven-day GET, 200, 306 valid slots |
| Selected slot | September 8, 2026, 5:30–6:00 PM EDT / 21:30–22:00 UTC |
| Title / organizer | SynchIntro Strategy Call / hello@pathsynch.com |
| Sole attendee | demo@pathsynch.com |
| Duration / timezone | 30 minutes / America/New_York |
| Initial booking | One POST, 200; persisted operation CONFIRMED |
| Provider create / event count | 1 / 1 |
| Authorized replay | One identical-key/body POST, 200, same result |
| Total booking HTTP POSTs | 2: initial plus replay; only one resulting booking |
| Duplicate check | Matching event counts 0 before, 1 after confirmation, 1 after replay |
| Browser to Nylas | 0 |
| Capability / idempotency privacy | Memory-only; absent from browser storage, cookies, URLs, UI state and analytics |
| Frozen intent | Selected receipt slot, versions, attendees, body and key matched |
| Runtime / browser errors | 0 observed in the bounded logs / 0 console or page errors |

Exact test identifiers are retained in the operator-controlled acceptance record, not published to this public repository:
- Booking: `[retained in controlled acceptance record]`
- Google/Nylas event: `[retained in controlled acceptance record]`
- Operation: `[retained in controlled acceptance record]`

Provider-create count is supported by persisted attempt_count=1, unchanged confirmed
operation on replay, deployed no-retry create behavior, and independent booking/event
verification. It is not a packet-level provider trace or an unlimited exactly-once guarantee.

Evidence retained in the operator's controlled local incident directory:
`C:/Users/tdh35/AppData/Local/Temp/synchintro-availability-incident-20260908/`.
Relevant subdirectories: `revision-416-readonly`, `revision-416-health-tag`,
`revision-416-promotion`, `revision-416-final-booking`.
The latter contains final-report.md, browser-smoke.json, runtime-logs.json and final-gate.json.
The complete controlled acceptance record, including exact booking/event/operation IDs, is retained locally as synchintro-closeout-20260908/controlled-production-acceptance.md. Do not upload that controlled record, raw authentication material or raw provider responses. Temporary files need
separate retention management; this committed summary preserves the essential sanitized evidence.

## Incident causal chain

1. Frontend Hosting deployment succeeded.
2. Production availability returned 503 SCHEDULING_PROVIDER_UNAVAILABLE.
3. The serving old adapter rejected fractional-second timestamps as
   INVALID_PROVIDER_INPUT: start is invalid **before calling Nylas**.
4. The production backend source was stale relative to merged main.
5. Main already contained #159 modular FieldValue, #160 modular Timestamp,
   #161 inward millisecond-to-second normalization, #162 minimum notice enforcement,
   and #163 attendee verification semantics.
6. Required minimum-notice configuration was also absent from that stale revision.
7. The authorized Firebase functions:api deployment created corrected api-00416-hoc.
8. Existing explicit allocation api-00413-feq=100% persisted.
9. The new revision received no ordinary traffic and its unused infrastructure retired.
   Image import / Ready with RETIRED reason was not startup health proof.
10. A separately authorized temporary revision tag established direct startup and health
    for api-00416-hoc, while the ordinary traffic allocation remained unchanged.
11. Separately authorized explicit promotion moved production to api-00416-hoc=100%.
12. Session/availability recovery passed.
13. The final separately authorized real booking and identical-key replay passed.

**Root cause A:** stale deployed booking source.

**Root cause B:** an explicit Cloud Run revision traffic pin persisted across a later
Firebase deployment, preventing the corrected revision from becoming ordinary production.

**Secondary prerequisite:** the actual Firebase environment loader must include
NYLAS_MIN_BOOKING_NOTICE_MINUTES=60, and the created revision must retain it.

Audit evidence records a September 6 20:22:06.692918Z traffic update assigning
api-00413-feq=100%, authenticated as hello@pathsynch.com using gcloud.run.services.update-traffic.
September 8 FirebaseCLI/15.22.3 UpdateFunction and service-agent replacements retained that
allocation; the update mask omitted allTrafficOnLatestRevision. Account/client attribution
does not establish who was at the keyboard or their intent. No intent is inferred.

## Synthetic meeting cleanup — prepared, NOT executed

The event remains scheduled. Cancellation requires Charles's separate authorization naming
the exact booking and event in the controlled acceptance record; this record is not that authorization.

1. Preserve this record and sanitized pre-cleanup booking/event status, time, organizer,
   attendee, operation state and attempt count in controlled evidence. Do not retain tokens.
2. Re-read the exact Scheduler booking and exact primary-calendar event through an authorized
   operator integration. Require both IDs, organizer, sole attendee, title and original slot
   to match. If changed, missing, or already cancelled, stop and report; do not search-and-delete
   arbitrary events or create a replacement.
3. Use the Nylas **Scheduler booking cancellation** operation for this exact booking and its
   verified configuration, following the current documented contract. Prefer this lifecycle
   operation to deleting the Google event independently, which can leave Scheduler state stale.
   Establish notification behavior and any required cancellation reason with the approved
   cleanup plan. No cancellation endpoint exists in the current SynchIntro public API.
4. After separately authorized execution, read back booking cancellation and event
   cancelled/absent state. A provider timeout or ambiguous response requires read-only
   reconciliation before any retry; never issue a blind second mutation.
5. Append cleanup timestamp, result and sanitized provider references. Retain original
   acceptance and operation evidence; do not manually rewrite CONFIRMED or delete Firestore
   evidence. This records that confirmation succeeded before an authorized lifecycle cleanup.

Reference: [Nylas booking lifecycle](https://developer.nylas.com/docs/cookbook/use-cases/build/manage-bookings/).
The closeout task performs no cancellation or new provider/application mutation.
