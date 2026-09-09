# Server-owned entitlement foundation

Status: candidate implementation; YELLOW. No merge, deployment or production migration authorized.

## Contract

`services/planCatalog.js` is the versioned team-seat catalog: Starter 1, Growth 3, Scale 5, Enterprise `{limit:null,unlimited:true,status:"unlimited"}`. Routing-member and scheduler-host concepts share the team pool; a unique accepted active UID uses one seat. Pending invitations do not reserve seats. Disabled, removed and offboarding membership do not consume seats. Offboarding cannot be readmitted until removal completes. Firebase-disabled accounts cannot be added/reactivated.

The backend resolves a workspace owner through the protected `workspaceMembers/{workspaceId}_{uid}` active owner flag, never editable workspace owner/limit/counter fields. Exactly one owner is required. Its plan comes from `accountPlanAssignments/{ownerUid}` with schemaVersion 1, matching subjectUid, canonical planId, active status, operator source, actorUid, positive revision, effectiveAt and optional expiresAt. Case/whitespace aliases normalize only after provenance checks. Unknown, missing, malformed, future or expired assignments remain unresolved.

Admission and invitation acceptance transact across the protected assignment, membership query, shared `workspaceEntitlements/{workspaceId}` snapshot, membership mutation and legacy team mirrors. The snapshot is a computed result, not an independent grant. Each admission recomputes usage and writes the same snapshot, serializing final-seat races. Active repeated acceptance consumes no extra seat. Owner-writable legacy counters are never admission input. Existing over-limit memberships are retained; new admissions stop until usage is below the limit. No automatic deletion/demotion is performed.

Safe frontend endpoints: `GET /entitlements/catalog` and authenticated `GET /me/entitlements`. The latter rechecks caller membership and account status. Its response includes schema_version, workspace_id, owner_uid, status, plan_id, plan_version, assignment_revision, typed team_seats, shared-pool routing_members/scheduler_hosts, usage.team_seats, effective_at, computed_at and source. Internal credentials, billing customer IDs and provider mappings are absent. Settings and Admin render this contract; stale/malformed/unavailable values cannot enable admission.

Non-seat feature/quota **values are unchanged**. Their plan selection uses protected authority; unresolved accounts cannot acquire a default paid quota. Visitor/transcript gates deny unresolved plans, and destructive version retention skips unresolved/error cases. Branding retains existing protected agency capability overrides; editable profile plans no longer elevate them. Workspace branding owner resolution and capability reads are fresh before returning a result.

## Administrative assignment and legacy rollout

The explicit PUT admin plan-change routes write a protected operator assignment, immutable revision history, and legacy display fields atomically. The issuer separately verifies the bearer token with revocation checking, active Auth account, verified email and internal-admin membership. This is an operator attestation, not Stripe proof. It does not create, cancel, charge or update a subscription. Historical overrides remain untrusted because their provenance was stored only in owner-writable profiles. The obsolete PATCH plan field returns 409 and directs the operator to the protected PUT route; it cannot report a profile-only plan change as success. Operator assignments persist until explicitly replaced or revoked; automated billing synchronization is not established by this candidate.

Historical `subscriptions` storage is protected, but existing attribution can originate from editable customer mappings and unknown-price fallbacks; those rows are not auto-attested. A profile `FREE` marker is not converted into a paid plan. Existing membership/login is retained, but unresolved paid operations/new admissions require reconciliation. **Do not deploy before a separately authorized, bounded account reconciliation and review of the operator-assignment lifecycle.** No live records were read for this implementation. Reconciliation must include protected workspace membership as well as account assignments: a resolved solo/legacy team owner without protected workspace membership receives `no_workspace` with null seats/usage, so the UI cannot offer invitations.

Offline dry-run diagnostic (synthetic/local snapshot only):

```
node functions/scripts/plan-entitlement-reconciliation.cjs --input <local-snapshot.json> 100
```

Input: `workspaces[]` containing workspaceId, members[] (documentId, workspaceId, uid, status, isWorkspaceOwner), and optional protectedAssignment with the above provenance fields and ISO effectiveAt/expiresAt. Maximum 500 workspaces, 5,000 memberships per workspace and 2 MiB input. Output lists readiness/status/counts only. No Firebase initialization, network calls, writes, migration execution or automatic grants exist in the tool. Operators must independently attest plan ownership from trustworthy evidence under separate authorization; legacy hints alone are insufficient.

## Residual boundaries

Current rules still allow legacy users/workspaces metadata writes. Protected assignments/history/snapshots are denied by the existing implicit default-deny rules. No rules/indexes/IAM/WIF/workflow/governance changes are part of this candidate. The source matrix records historical billing/pricing metadata copies, which are not admission authority. Scheduling algorithms, provider configuration, billing prices, plan quotas, communications and production data are unchanged.

Frontend and backend branches depend on the merged Phase 1 main baselines listed in ENTITLEMENT_SOURCE_MATRIX.md. Deploy backend contract before its frontend consumer under a separate future approval, after legacy reconciliation; UI failure is explicit and does not invent seat capacity. Rollback/deployment authorization is outside this implementation review.

## Validation and reviews

Required local evidence: real Firestore transaction/rules tests for forgery, concurrency, lifecycle, override authorization and isolation; route/unit compatibility tests; frontend typed-seat tests and browser/axe journeys; syntax and package inventory. External Claude cold, Devin exact-head and GitHub Codex exact-head reviews remain mandatory before the foundation gate. Historical or interim reviews are not final-head approval. Phase 2 has not started.

## External-review clarifications

- A workspace with active members but no single conformant protected owner anchor can fail workspace resolution for those authenticated members (HTTP500). A malformed membership row can deny entitlement/context resolution (HTTP409). Reconciliation must validate every row, every active owner anchor and every assignment before rollout; merely seeding assignments is insufficient.
- Automatic workspace creation refuses protected team backlinks, existing target IDs or legacy owner-linked workspace evidence when protected discovery finds no workspace. Legacy evidence is denial-only: it neither grants ownership/access nor selects a paid plan. Because editable hints can force this provisioning denial, recovery remains an operator reconciliation action rather than automatic repair.
- Persisted workspaceEntitlements documents capture the last admission and serialize concurrent admissions. Removals/offboarding do not refresh them; no reader may treat stored usage as current. The API recomputes current protected membership/assignment state. Offline diagnostics also recompute from input memberships, not persisted usage.
- Owner-only lookup filters workspaceId, active status and protected owner flag, limited to two candidates to detect ambiguity. Equality-only queries support automatic index merging ([Firebase documentation](https://firebase.google.com/docs/firestore/query-data/index-overview#use_index_merging)); checked-in fieldOverrides is empty. No index changes are included. Live configuration validation remains a future deployment gate.
- Frontend profile caching is metadata-only: every returned plan/tier projection is overlaid with a fresh protected entitlement result, including cache/error paths. Settings shares one entitlement response between plan and seats. Credits and pitch-generation checks preserve unresolved state. Member names remain plain text through actual role-change success/error toasts.
- Existing rules deny unmatched protected paths implicitly; there is no explicit catch-all block.

Initial provisioning is atomic: the protected teams/{ownerUid} record serializes concurrent first invitations; workspace, owner membership, branding and backlink commit together. A backlink cannot authorize reuse without exactly one matching protected owner anchor. Legacy/foreign/dangling evidence still requires reconciliation. No new collection, rule or index is introduced.
