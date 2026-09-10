# Billing domain primitives — PR A

Status: local domain-only work based directly on main at
8725afd06a689a3bfd9ca3c0d699694d66f85b8f. No production handler imports these modules.
The four known integration regressions remain outside this PR and are deferred to PR B/C.

## Scope and trust boundary

These are deterministic reducers over normalized, trusted JSON values with explicit
integer clocks. They do not read Firestore, call Stripe, verify signatures, send
email, read environment variables, create UUIDs, or activate routes. Outputs are
deeply copied/frozen. Exceptions carry stable domain codes; they are not HTTP
responses and must not become an endless webhook exception loop in integration.

PR A makes no production API, Firebase rule/index, migration, persistence, provider,
or deployment change. It adds no runtime writer and activates no handler or route.

A value named verified_provider_event, verified_authority_commit, trusted customer
result, or committed receipt is an adapter attestation, NOT cryptographic proof.
The future adapter must derive it from authenticated/provider-verified evidence and
confirmed storage commits. Never accept these objects from request bodies.

The model can check commit evidence against exact state, binding and authority
snapshots. It cannot prove physical durability, snapshot freshness, complete
subscription inventory, external dispatch quiescence, or real Firestore
serializability. Those are mandatory PR B/C integration and emulator obligations.
A caller cannot safely fabricate an empty subscription inventory to permit dispatch.
Account/provider identity is derived by the adapter, never optional user profiles.

## Files and interfaces

- services/billing/value.js: deterministic JSON hashing/copying, immutable values,
  identity/time checks and shared constants. The only nonlocal dependency is the
  built-in SHA-256 implementation; it supplies no network capability.
- idempotency.js: createOperation, validateOperation, verifyRetry.
- checkoutAttempt.js: createAttempt, validateAttempt, reduceAttempt.
- coordinator.js: createCoordinator, validateCoordinator, reduceCoordinator,
  dispatchDecision.
- subscription.js: createSubscription, validateSubscription, reduceSubscription.
- authoritySelection.js: selectBillingAuthority, replaceBillingAuthority.
- bindings.js: validateBindings.
- reconciliation.js: reconciliationDecision, canAcknowledgeIssue.

Domain accountId identifies the authenticated payer UID. providerScope is the
Stripe provider account and test/live mode. Workspace identity is intentionally
absent: workspace entitlement still derives from protected owner membership and
the account assignment. No seat or branding catalog is changed.

## Immutable operation

One attempt ID, account and provider scope identify a logical purchase. Each kind
(customer_create or checkout_session) gets a separate versioned provider key.
The full frozen parameter object is canonically hashed. Retries must present the
same identity AND parameters. Changing a price, customer, absolute expiry, metadata,
or operation kind is not a same-intent retry.

Keys are reconstructible from immutable identity; key hashes alone cannot be sent
to Stripe. Actual keys, request parameters and provider URLs are internal values,
not log or frontend output. Pure customer-create identity support does not yet
implement a customer-creation workflow.

No new key is minted by reducers. Retry authorization has an explicit cutoff
strictly earlier than one day and earlier than the frozen session expiry.
The production adapter must choose a conservative cutoff/dispatch window that
also satisfies the provider's session-expiry constraints and possible key pruning.
This model does not authorize repeated POSTs throughout the seven-day hold.

## Attempt dimensions and transitions

The independent dimensions are:

| Dimension | Values |
|---|---|
| Provider operation | not_started, started, unknown, confirmed, rejected |
| Session observation | unknown, open, completed, expired |
| Resolution | pending, authority_committed, no_purchase, reconciliation_required |
| Coordinator hold | reserved, settling, reconciliation, released |

Attempt fields include immutable identity and operation, revision/timestamps,
short reservation lease, frozen session expiry, dispatch/retry window, settlement
deadline, known session/subscription IDs and explicit resolution evidence.

Every command includes account/provider/attempt identity, expected revision, and
an explicit processing clock. Stale revisions fail. Repeating a lost response uses
the persisted result/receipt; it does not bypass revision checks.

| Command | Preconditions and result |
|---|---|
| authorize_dispatch | Pending, never dispatched, lease valid; stores started state and protection through at least session expiry plus seven days. Only an atomic adapter commit makes this dispatchable. |
| provider_unknown | Started/unknown with unknown session; retains key and all protection. Cannot erase confirmed/completed evidence. |
| observe_session | Verified attempt/operation evidence and matching session identity. Unknown/open may advance; completed/expired cannot regress or contradict each other. First completion can extend protection. |
| reject_provider | Verified operation-wide no-effect and dispatch-quiescence evidence; a single request error is insufficient. Resolves no outstanding purchase. |
| commit_authority | Verified matching account/customer/subscription/operation settlement. May precede session-completion delivery; does NOT invent a completed session observation. |
| settle_no_purchase | Explicit verified evidence or operator attestation that dispatch is quiesced and no payable purchase remains. Operator evidence requires an actor. |
| expire_reservation | Lease elapsed AND dispatch was never authorized. |
| settlement_deadline | Once dispatched, elapsed time moves to reconciliation_required; it never proves failed purchase. |

no_purchase means no outstanding payable purchase remains, not deletion of
historical provider/completion facts. A verified authority commit can release its
matching hold even if the HTTP response or completion webhook was lost. Later
session facts can enrich a settled attempt without recreating the released hold.
An expired-session/committed-authority contradiction must be quarantined by the
adapter; it must not be silently overwritten.

## Account coordinator and dispatch obligation

The coordinator stores account/provider identity, current attempt, generation,
revision, attempt revision and state hash, operation hash, hold, deadline and reconciliation flag.
reserve serializes logical claims. sync accepts only the next revision of the same
attempt/operation; stronger protection cannot reset to reserved or shorten.
release requires validated explicit settlement. It retains attempt identity/history;
it does not delete the attempt.

A fresh generation cannot be overwritten by an old finalizer, even if that
finalizer presents a newly read coordinator revision. A different purchase intent
cannot reserve while the current hold remains. The adapter must use create-only
attempt records so a retired ID can never be recycled after intervening generations.

dispatchDecision requires:
1. agreeing forward/reverse customer bindings;
2. a complete protected subscription/selection snapshot that permits checkout;
3. committed_dispatch_claim evidence bound to attempt/coordinator revisions and
   generation plus a hash of those snapshots and both guard inputs;
4. pending started/unknown state, a settling hold, matching immutable operation,
   and the bounded retry window.

Pure transition output is not commit evidence. Commit the prepared attempt and
coordinator atomically, confirm the committed read, then call the provider outside
the transaction, then reconcile with fresh snapshots. Never call dispatchDecision
on uncommitted state and manufacture its expected receipt in production.

Actual cancellation remains processable during the hold. A new active subscription
arriving after dispatch authorization cannot be made atomic with Stripe; preserve
both outcomes, withhold unsafe URL delivery, and create a collision issue. A stale
snapshot cannot recall a provider call. Quiescence and late-worker protection need
real integration tests before release.

## Subscription ordering and selection

Each ledger belongs to ONE subscription, account, customer and provider scope.
It stores the latest accepted created-second, deterministic representative event
and semantic/rank, current-second observations, irreversible termination evidence,
conflict state and disposition. Event receipts are separate return values.

The adapter normalizes verified provider objects into status, effective canonical
plan, period-end cancellation and period end. Price lookup, pending/scheduled-update
normalization, API-version differences and signature verification are not implemented
by this primitive. Those normalization contracts must preserve existing semantics
and be independently tested before handler integration.

- Exact receipt replay changes nothing; event-ID reuse with different data fails.
- Equivalent same-second events converge regardless of arrival order.
- Conflicting nonterminal semantics retain a conflict across a third same-second
  event. Lexical event IDs only choose a representative; they never prove chronology.
- Strictly newer coherent nonterminal evidence may resolve that one-subscription
  conflict. Different-subscription ownership is never decided by timestamps.
- canceled/incomplete_expired create irreversible termination evidence. An older
  terminal event cannot be ignored to let a later contradictory grant reopen it.
- paused/unpaid/incomplete deny access but can resume on newer evidence; they are
  not permanent tombstones and do not automatically permit another purchase.
- A superseded terminal event is receipted without modifying a replacement's ledger
  or account selection.

Current-second observation lists and receipts are model values, not an instruction
to append unbounded arrays to a Firestore document. PR B/C must persist normalized
event evidence separately, bound storage/work, and quarantine overflow without
losing the conservative conflict result. No storage schema or writer is activated.

selectBillingAuthority requires independently verified selection lineage
(settled checkout, operator reconciliation, or protected legacy import). No proof
means no guessed billing authority. A second active subscription creates an explicit
issue while preserving a proven valid incumbent. A canceled incumbent never
automatically promotes a challenger. Missing selected ledger evidence blocks
checkout. Reversible inactive subscriptions also block a fresh purchase.

replaceBillingAuthority takes selection inputs (subscriptions, lineage, and clock), recomputes selection within the same pure call, checks account/provider identity, and changes only the
billing slot. Existing independent operator/promotion/legacy slots are copied
unchanged; it does not resolve their ranking or reinterpret grant provenance.
The existing protected composite-authority validator/resolver remains responsible
for those records. Feature grants are outside the billing model entirely.

## Binding and reconciliation

The shared validator checks both document keys and provider/account/customer
identity. Missing halves or mismatches deny protected use. Both absent requires
a trusted customer-create result before the adapter may atomically bootstrap;
even that result does not itself permit portal/session access. Legacy profile
or signed metadata hints alone cannot bootstrap. Profile presence is irrelevant.

Reconciliation decisions contain a stable issue ID, scoped resource IDs, reason,
blocking effect, preserved billing authority, automation/operator policy and a
recovery ownership/path obligation. automaticResolutionAllowed is permission to
evaluate later verified evidence, never permission to release on time alone.
Operator resolution/UI and automated recovery are not implemented here.

canAcknowledgeIssue requires a matching commit attestation for both the issue and
the exact event receipt, including recovery ownership/path. Acknowledgement without
actual durable storage and a working recovery path is forbidden in integration.

## Invariant evidence

| Invariant | Domain test evidence |
|---|---|
| BILLING-001 | Commit-bound dispatch, minimum hold, lost finalization/restart |
| BILLING-002 | Frozen request, identity-specific keys, changed-intent rejection |
| BILLING-003 | Subscription/account/customer/provider-scope rejection |
| BILLING-004 | Separate receipt, observation, selection and projection boundary |
| BILLING-005 | Superseded terminal cannot change replacement selection |
| BILLING-006 | Duplicate, equivalent and harmless stale receipts |
| BILLING-007 | Deleted/forged optional profile has no binding effect |
| BILLING-008 | Both binding directions required by actual dispatch decision |
| BILLING-009 | Unknown outcome retains hold until explicit settlement |
| BILLING-010 | Challenger issues with/without proven incumbent |
| BILLING-011 | AST dependency/capability confinement for every domain module |
| BILLING-012 | Stale revisions, stronger completion, operation hash/generation |
| BILLING-013 | Selection proof separated from event order/history |
| BILLING-014 | Independent authority slots preserved; existing grant tests retained |
| BILLING-015 | Pre-dispatch versus after-dispatch/seven-day expiry |
| BILLING-016 | Immutable account and provider scope in retries/events |
| BILLING-017 | Issue/event-specific commit and recovery obligation |
| BILLING-018 | Paused/unpaid recovery versus irreversible termination |

Tests include all three-event permutations for equivalent/conflicting/terminal
histories, both two-claim orders, explicit boundary tables and exhaustive accepted/
rejected four-step model histories. These are model guarantees, not emulator proof.

## Preserved integration evidence and next gates

The four known red integration cases remain in the paused integration work and are
not part of this direct-to-main PR. They must remain red until PR B/C:
persistent post-provider Firestore failure, missing reverse portal binding, optional
profile deletion blocking cancellation, and old terminal subscription collision.

PR A requires domain, model and purity tests plus syntax and diff checks. No
rule/index/migration/collection activation is required. No external review,
publication, merge, deployment or production data access is included.

Next: publication review of this isolated domain contract under separate authorization.
Do not begin provider/persistence integration in this task. PR B/C must prove actual
atomic commits, complete protected inventory, real concurrent transactions, failure
recovery, bounded provider retries, receipt durability, adapter normalization,
compatible old/new writers and rollback before activation.

## Local adversarial review disposition

Fresh Astra self-review resolved these domain-contract gaps before the local
checkpoint:

- Authority settlement was initially coupled to completion delivery. The model
  now preserves orthogonal facts and accepts independently verified lifecycle
  settlement before completion, without inventing session observations.
- A non-granting resumable subscription or missing selected ledger initially
  risked being interpreted as checkout availability. Both now block checkout.
- Dispatch now requires the actual binding and selection guards, with guard
  snapshots included in the confirmed commit identity.
- A recomputed changed request and malformed settlement snapshot cannot bypass
  coordinator identity/progress checks.
- A single failed provider request cannot prove operation-wide no effect.
  Explicit dispatch quiescence/no-payable-purchase evidence is required.
- Expired-session/committed-authority contradictions and stale state resets are
  rejected; the later adapter must durably quarantine contradictory evidence.

No unresolved architectural contradiction was found within this pure-model scope.
This is self-review of local PR A, not an external reviewer approval or validation
of actual provider/Firestore integration.

Direct-to-main replay validation: 172 domain tests passed across five domain, model
and purity suites after removing the unrelated PR #167 plan-catalog assertion.
Syntax and diff checks passed. Full native CI remains a publication gate and is not
claimed by this local replay.

## PR A cold-review corrections

- Attempt successors carry the canonical predecessor hash. The coordinator stores
  the accepted attempt hash and requires the next attempt to descend from that
  exact snapshot, so a same-operation, next-revision stale sibling cannot replace
  an accepted completion.
- Dispatch decisions reject clocks earlier than either committed snapshot.
- Normalized provider-session evidence must certify the command's exact session,
  status, and frozen customer. Authority settlement evidence includes a session ID;
  both loaded settled snapshots and late session delivery must agree with it.
- Billing replacement accepts selection inputs and derives the result internally.
  It never trusts a caller-supplied billing slot, even beside otherwise valid inputs.
- Claude's reported missing customer-mismatch issue was not reproduced: the existing
  legacy_unproven_lineage issue blocks checkout. A deterministic test preserves this.

These are pure contract corrections only. Signature verification, atomic persistence,
normalization from provider payloads, and quarantine remain PR B/C adapter obligations.
The two preserved integration regression files remain outside this PR.

### Follow-up review boundary clarification

Coordinator acceptance clocks must also be at or after the supplied attempt's
updatedAt, including reserve, sync, and release.

Mixed canceled/incomplete_expired observations converge to the same deterministic
terminal ledger in either arrival order. Both deny billing authority. The chosen
terminal representative is not a refund, payment-success, or proration decision;
those financial interpretations are outside this access-authority model.

verified_authority_commit attests the originating session's association with this
exact attempt, frozen request fingerprint, provider-key hash, customer, and
subscription. An adapter must establish that association from trusted evidence;
matching only a customer is insufficient. A session-completion observation need
not already be stored, but the attested originating session ID must be known.
The reducer checks these supplied identities and later session consistency; it
cannot detect a lying adapter that relabels unrelated evidence as this attempt.

The snapshot hash binds the claimed input values, not independent proof of
datastore freshness. Consistent transactional reads and bounded event-evidence
storage remain explicit PR B/C obligations. No arbitrary storage cap or provider
financial interpretation is introduced in PR A.
Account and operator identities use the Firebase Auth UID contract: a string of
1-128 characters, with no provider-ID character whitelist. Provider/domain resource
IDs retain their separate constrained grammar. UIDs remain opaque values and are
not interpolated into filesystem/datastore paths by these pure functions. Future
adapters must map opaque UIDs safely to persistence keys without changing identity.
Source: https://firebase.google.com/docs/auth/admin/manage-users#create_a_user
