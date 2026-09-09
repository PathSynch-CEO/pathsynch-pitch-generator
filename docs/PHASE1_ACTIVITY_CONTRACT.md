# Phase 1: activity and stored-report contract

Governance: YELLOW (authenticated identity, privacy, workspace scope, paired frontend/backend contract). Branch-only; merge and deployment need separate authorization.

## Source authority

The checked-in rules allow clients to create marketReports and userActivityLog and to update their own user profile. Neither a marker in those documents nor Last Login in the profile establishes server provenance. Synthetic local emulator checks reproduced these boundaries. A read-only GET of the deployed Firestore release on 2026-09-08 verified its rules are identical to the checked-in rules after newline normalization: ruleset a3f869bb-ae3e-492c-98be-9ba0350b8ee6, SHA-256 0de3cc11c62c24b3e0c5861c0377b8f89fef978d1b7ff504adcf7620c9b40a49. Rules were not changed. Reverify this boundary before a separately authorized deployment.

The operator explicitly approved showing historical reports as stored inventory with unverified legacy provenance, while using protected server receipts for new verified activity. No rules change or historical attestation is implied.

- Stored reports: distinct existing marketReports document IDs, excluding soft-deleted records. userId is the ownership anchor; a present createdByUid must agree. Missing creator can fall back to userId, but names/emails are never identity keys. Conflicting identities are unassigned and disclosed. No workspace is inferred from current membership.
- Verified reports: distinct market_report_created receipts committed atomically with report and usage. A deleted inventory record can still have a genuine historical generation receipt. These two metrics intentionally measure different things.
- Last Login in Admin and solo analytics: Firebase Authentication lastSignInTime, not users.lastLoginAt or the old client counter.
- Team Last Login: authenticatedAt from a verified session observed in that workspace. Authentication may predate workspace entry or membership. Last Login uses the latest valid observation independently of the selected timeline range. Receipt createdAt separately records server observation; the timeline says session observed, not that authentication occurred in the workspace at that time.
- Stored pitches retain inventory semantics. Library metrics are unavailable rather than zero because the legacy personal library lacks reliable workspace attribution.

## Protected operational schema

Reuse users/{uid}/activityFeed; do not create a parallel ledger. schemaVersion=2 has id, eventType, userId (actor), subjectUserId, workspaceId, actorType, entityType, entityId, createdAt and an allowlisted metadata object. Creation/login metadata is empty; refresh metadata contains only the committed usagePeriod and usageUsed snapshot for retry responses. Login also has authenticatedAt from the verified Firebase token. No token, raw session identifier, name, email, report title, or report contents are stored in the receipt. Deterministic SHA-256 IDs bind type, actor, workspace and operation/entity. Login retries use auth_time only to derive the ID, then discard its raw entity value.

Operational createdAt is deliberately distinct from legacy notification timestamp. Existing notification reads, digests and 30-day notification cleanup therefore do not consume/delete durable receipts. Operational receipts persist; this change adds no deletion, cleanup, backfill or retention job. Any future operational-data deletion/retention procedure must include this schema. Existing notification behavior is unchanged.

## API

POST /me/activity/login takes no identity, workspace or event data from the body. The existing resolver chooses an active workspace; the endpoint re-verifies the token with revocation checking and checks disabled status. A transaction suppresses duplicate callbacks. Failure is explicit and does not block ordinary sign-in.

GET /analytics/activity?days=30 supports days=1..366 or explicit from/to. Supplying both explicit endpoints takes precedence over days; partial ranges still validate days. UTC intervals are [from,to); the UI converts an inclusive selected end date to next midnight. schemaVersion=1 returns workspaceId, scope (workspace/self; solo is self), from, to, members, warnings, entries and provenance. Managers/admins see their workspace; staff/contributors see self only. Disabled callers fail. Former/disabled/deleted members retain attributed history with neutral labels and no current profile PII.

No browser userActivityLog rows enter this projection. A generation receipt replaces the equivalent legacy feed row by report ID; source counts never depend on view actions. Current inventory and per-period counts are distinct. Stable ordering uses event time then ID. Missing creation dates do not fabricate activity.

Reads are bounded: 200 member identities, 5,000 records per source collection, 20,000 operational events. Exceeding a bound returns an explicit error, never truncated counts. Source collection queries are scoped before reading; contributor/staff ownership is filtered before applying inventory limits; only existing single-field indexes are used. Admin totals use the same ownership predicate; an admin global user total includes all workspaces and solo inventory, whereas a workspace total includes only that workspace. Unassigned history is not quietly added to a member. Both global admin inventory surfaces share the same 5,000-record bound: above it, reportInventoryStatus=limit_exceeded and report counts are null/unavailable, while sign-in/pitch data and the rest of the dashboard remain available. No truncated or fabricated zero report counts are returned. Operational feed queries filter the selected workspace (or explicit solo null scope) before the event cap and remain serial and bounded; high-volume workspaces require separate latency/scaling validation.

Report refresh rechecks current scope/deletion in its transaction, preserves original owner/workspace/creation timestamp, and records refreshedByUid/refreshedAt separately. The internal refresh marker cannot be supplied in a JSON generation body. Preserved identity is propagated to downstream consumers. Each refresh persistence operation also atomically creates a market_report_refreshed receipt: actor is the refresher, subject is the original creator. A server-generated operation ID is stable across transaction retries; reusing an explicit internal operation ID does not replay stale content. Separate HTTP refresh invocations are separate generation operations, not deduplicated HTTP requests. The existing per-actor monthly usage policy is enforced and incremented atomically with refresh/report/receipt persistence; plan definitions are unchanged, and response creditInfo uses committed usage. Early refresh preflight rejects already-deleted or wrong-scope records before provider work.

## Release order and limitations

Deploy compatible backend endpoints/receipts before this frontend in a separately authorized task. An old/unavailable backend produces an unavailable/retry state rather than zero counts. Runtime credentials need the existing Firebase Auth user lookup permission; no IAM/config change is made here. Hosting asset boundaries and Functions packaging guards remain in force.

No production users/reports were queried, no report generation with external providers was invoked for validation, and no booking, email, merge, deployment or traffic change is part of this phase. Tests use fixtures and a local emulator.

Historical generated/completed status cannot be reconstructed from legacy records without additional evidence. No claim of complete historical login events is made. Only observed new sessions are in the protected ledger; global Auth supplies the last authentication time for Admin/solo. Missing workspace identity requires a separately bounded reconciliation decision, not an automatic backfill.

Review corrections also preserve profile-fallback login delivery, map known revoked/invalid credentials to 401 (disabled 403; service failure 503), paginate all returned feed entries with member filtering, normalize serialized timestamps for rendering, and expose selected admin activity controls with aria-pressed. The obsolete admin loginCount field remains legacy/unreliable and is not used for activity metrics.
