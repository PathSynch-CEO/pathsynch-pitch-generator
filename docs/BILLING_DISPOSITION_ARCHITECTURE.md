# Subscription disposition and authority provenance — local PR A decision

This replaces the disposition contract at local checkpoint
`92293e6474ab767ed0e1d113a85e17454b7b87fa`. It is a pure-domain correction, not
runtime integration, publication, or external-review approval.

## Root cause and previous authority path

At that checkpoint `subscription.js:createSubscription` accepted an optional
`disposition` argument, defaulting to `candidate`. `validateSubscription` called
that constructor, which checked only membership in the four-value enum. The
subscription reducer copied disposition across events and used `superseded` to
label receipts. There was no disposition transition API, predecessor, revision,
or selection provenance. Any in-process caller, including a future storage
adapter, could supply the value or spread-copy a different one into loaded state.

`authoritySelection.js:selectBillingAuthority` treated a subscription matching
the selection's subscription/customer as incumbent unless disposition was
`superseded` or `quarantined`. `candidate` and `effective` both admitted it.
The otherwise valid provider ledger and selection attestation did not attest
disposition. Rewriting quarantine to candidate therefore restored billing.
`replaceBillingAuthority` and the coordinator's dispatch guard called that same
selector and inherited the flaw. The receipt label did not itself grant authority.

Thus `effective` could be asserted without transition lineage; conversely, merely
asserting `effective` without any selection proof did not grant billing. The flaw
was an unproved eligibility veto that could be removed beside a valid proof.
Quarantine/supersession could regress in loaded data. Provider semantic validation
still denied terminal/conflicted ledgers, but a stale disposition could admit an
otherwise eligible newer ledger: no semantic revision bound the two dimensions.

## Architectural decision and limits

Keep three separate facts:

1. **Subscription semantics:** normalized provider observations, conflicts and
   irreversible terminal evidence. Its `revision` is a SHA-256 commitment to all
   normalized ledger facts, excluding the revision itself. This is a content
   revision, not an arrival counter: convergent event permutations have the same
   revision. A harmless stale receipt need not change it.
2. **Per-subscription disposition:** reducer-derived eligibility, accepted by
   replay against a separate current protected acceptance record.
3. **Account/provider selection:** an independently proven CURRENT incumbent
   pointer and selection epoch, bound to the exact semantic and disposition
   revisions. Effective disposition alone never selects an account's authority.

This separation is coherent only with explicit trust inputs. A caller can hash
any JSON, so an adjacent self-supplied digest is not proof of origin. A pure module
cannot distinguish a fabricated complete trusted input from an authentic one.
PR B/C must supply authentic, current acceptance records and selection evidence;
neither may come from request bodies, profiles, or the proposed successor itself.
The module checks consistency and transition legality relative to those inputs.
It does not claim to defeat simultaneous forgery or rollback of the entire trust
root. That is the same boundary as the existing coordinator's accepted snapshot.

## Record and acceptance contract

`initializeDisposition(subscription, at, accepted)` accepts protected absence
(`accepted === null`) and produces only canonical candidate state at revision 1.
The adapter must enforce create-only initialization and retain retired identities;
passing null is not a database absence proof.

Each disposition binds immutable account/provider/subscription/customer identity,
current semantic revision, integer disposition revision, predecessor hash,
created/updated processing clocks, status, last transition evidence, selection
lineage, a monotonic selection-epoch floor, and suppression evidence. Suppression
records retain their basis: provider semantics, explicit quarantine, or replacement.
This distinguishes suppression of old authority from unresolved checkout recovery.

The separately protected acceptance record contains scoped identity, accepted
revision, and the hash of the full disposition. It is updated only by accepting
the reducer result. `reduceDisposition` validates the previous snapshot against
that current record, exact expected revision/hash and semantic predecessor, and
the processing clock. `acceptDisposition` replays the command and requires exact
equality with the proposed successor before returning a replacement record.
A hand-built or stale sibling cannot use an existing accepted predecessor.
The adapter must compare-and-swap the accepted record atomically; pure replay
does not arbitrate two transactions that both read the same old record.

Commands bind source and target semantic revisions, previous disposition revision
and hash, identity, type, evidence, and processing clock. Non-refresh transitions
cannot bundle an unnoticed semantic update. Refresh additionally replays the
provider event through `reduceSubscription` from the exact prior ledger; a valid
but older/sibling ledger is not an acceptable successor. An optional protected
receipt is compared with the exact receipt from that replay. It is not passed as
a duplicate receipt to the predecessor reducer, which would suppress the required
transition. Duplicate/stale events
whose semantic revision does not change need only their ordinary event receipt,
not a new disposition revision. A first-seen stale event still requires its receipt
to be committed; unchanged semantic revision is not permission to skip durability.
A retried disposition commit must recover the
persisted result; it must not bypass predecessor validation.

## Transition table

| From | Command → result | Required evidence / restrictions |
|---|---|---|
| candidate | select → effective | Granting, coherent semantics; independently verified selection lineage with epoch above the floor. |
| candidate/effective | quarantine → quarantined | Exact scoped conflict/reconciliation transition attestation with reason and evidence ID. |
| effective | supersede → superseded | Proven distinct replacement selection, exact replacement identity, semantic revision, disposition revision/hash, and newer selection lineage. |
| quarantined | resolve → effective | Granting coherent semantics, explicit resolution bound to this suppression hash, and a newer selection epoch. An ordinary select is rejected. |
| superseded | operator_reselect → effective | Explicit resolution of this suppression and a newer operator-reconciliation selection with authenticated actor identity. Ordinary select/resolve is rejected. |
| any | refresh → same status | Exact replayed semantic successor. Suppression, lineage and epoch floor survive. |
| effective | refresh → quarantined | Replayed semantics are conflicted, terminal, inactive, or no longer granting at the processing clock. No automatic subsequent reactivation. |
| any | reset to candidate | Forbidden. Initialization cannot overwrite a protected record. |

Selection lineage contains selection ID, evidence ID, account-scoped monotonically
increasing epoch, and basis (`settled_checkout`, `operator_reconciliation`, or
`protected_legacy_import`). Operator basis additionally requires actor identity.
The future adapter verifies the actor's permission and evidence authenticity.
The disposition transition attestation repeats exact identity, type, predecessor,
source/target semantic revisions, clock and payload; extra or mismatched fields
are rejected. Resolve/reselect must name the exact suppression commitment.
Supersession evidence must attest an actually accepted replacement, not merely a
subscription ID. Account selection epochs and replacement acceptance must be
verified/committed together by PR B/C, never inferred from event arrival.

## Authority-selection contract

`selectBillingAuthority` requires validated subscription ledgers and one unique
accepted disposition pair for each ledger. Disposition must match exact immutable
identity and semantic revision, and must not be dated after the selection clock.
The independent selection pointer must bind exact subscription revision,
disposition revision/hash, and the disposition's retained selection lineage.
A stale or mismatched proof rejects the selection call. A valid pointer to a
quarantined/superseded subscription grants nothing. Candidate state cannot acquire
authority via a pointer because it has no accepted selection lineage.

Two active subscriptions without a pointer elect neither. With a valid incumbent,
the challenger creates reconciliation while the incumbent is preserved. Missing
incumbent inventory does not promote the challenger. Missing/malformed disposition
inventory is an error, not empty authority. The dispatch guard consumes these same
inputs, and its existing commit hash includes them. No runtime handler imports
the domain modules.

Coherent terminal-only inventory no longer blocks a replacement purchase merely
because the old authority was automatically suppressed by provider semantics.
This applies with or without a retained exact selection pointer. The old
disposition stays quarantined and its evidence/epoch remain unchanged; it does not
regain authority. Resumable states, semantic conflicts, missing selected inventory,
and explicit quarantine continue to block. A selected superseded disposition is
an observable pointer/replacement contradiction and always produces a recovery
issue, including when its own subscription is terminal. Switching that pointer
atomically remains PR B/C work.

Ordinary provider arrivals cannot lower the selection floor or clear suppression.
Even a newer coherent active event after a same-second conflict cannot clear an
already accepted quarantine. An explicit resolution creates a newer selection.
If coherent newer provider state arrived before the older same-second conflict,
the subscription reducer may treat that older event as stale; no conflict was
accepted in that history. This is conservative evidence handling, not a claim
that all disposition histories have identical revisions. Already suppressed
histories remain suppressed across all tested delivery permutations.
An old superseded subscription's terminal receipt only updates its own ledger and
disposition. It cannot modify the replacement or account selection.

## Invariants and evidence

| Invariant | Enforced contract |
|---|---|
| BILLING-019 | Embedded disposition is rejected; canonical initialization and accepted reducer transitions derive eligibility. |
| BILLING-020 | Every successor uses exact accepted predecessor identity/revision/hash and replay. Stale siblings cannot commit against a newer record. |
| BILLING-021 | Selection binds exact semantic and disposition revisions, disposition hash and independent lineage. |
| BILLING-022 | Ordinary events cannot reset quarantine/supersession or lower the selection floor. Explicit resolution/reselection is required. |
| BILLING-023 | Effective state requires accepted selection lineage; even effective state cannot grant without the independent account pointer. |
| BILLING-024 | Pure validators do not prove storage completeness/authenticity/freshness. Complete retained terminal evidence always prevents active authority. |

`billingDomain.disposition.test.js` covers forged effective/candidate values,
missing lineage, all permitted transitions and forbidden resets, exact evidence
binding, wrong identities, stale/sibling predecessors, hand-built successors,
semantic revision changes, proof revision mutations, late terminal receipts,
incumbent/challenger ordering, missing incumbent, clocks and operator identity.
It includes all six selection/quarantine/refresh permutations, all six provider
delivery permutations for each suppressed status, and both selection/conflict
orders. Existing subscription permutation, coordinator-history, binding and
capability-confinement tests remain part of validation.

The two bounded prior corrections are retained: malformed observations raise
stable domain errors; replayed receipts must have the exact schema and a supported
reducer action. The old `superseded_receipted` action is removed because subscription
reduction no longer owns disposition. Extra authority fields, missing actions,
and unsupported actions are tested separately. There is no deployed schema to
migrate: PR A has never been activated.

## Mandatory PR B/C obligations; not implemented here

- Authentic current account selection/epoch and complete subscription inventory,
  including absent/retired resources; profile documents remain non-authoritative.
- Create-only disposition registration, retained accepted predecessor/evidence
  records, compare-and-swap revision checks, atomic semantic/disposition/selection
  and receipt updates, and real concurrent transaction/failure tests.
- Verify selection/transition/operator/provider attestations from trusted sources;
  refresh the exact pointer after a semantic or disposition change. Never bless a
  loaded state merely by recomputing its hash. A semantic mismatch must be recovered
  by replaying evidence, not by editing revision strings.
- Persistent terminal-event completeness independent of the mutable snapshot.
  Deleting both a tombstone and its mirrored evidence cannot be disproved by pure
  JSON validation. Preserve that separate finding and test the integrity check in
  persistence. Bounded compaction must not discard terminal/suppression provenance.
- Safe cross-resource replacement ordering: accept new selection, supersede old
  disposition, and switch the account pointer atomically. Guard against stale
  account epochs, old workers, deletion, restore/rollback, retries and lost commits.
- Existing provider-outside-retryable-transaction, binding, receipt durability,
  migration/compatibility and rollback gates still apply. No provider, Firestore,
  route, rules/index, workflow, frontend, migration or production change is made.

The deeper domain separation remains coherent with these explicit roots of trust.
It is not an independent storage-integrity solution or proof of deployability.
The next candidate requires separate publication authorization and fresh exact-head
review. This local architectural correction is not a YELLOW merge approval.

## Original architectural checkpoint (27f0d05)

- Domain/model/purity: 285 tests across six suites, including 82 new disposition
  cases and confinement coverage for the new ninth domain module.
- Existing-main billing: 10 tests passed; Functions provider/datastore dependencies
  are mocked by that existing suite. No production service was contacted.
- Syntax: all nine domain modules passed; diff whitespace checks passed.
- Overall PR scope: 19 domain/test/doc paths (the previous 16 plus this decision,
  the disposition module and its test suite). Replacement delta: 12 paths.
- Runtime importers: zero. Credential-pattern scan across all 19 paths: zero
  findings. Frontend remains at c93d2ced87485a75387522b5cc08a4abade62477.
- The original disposition reproduction was rerun against exported original
  92293e6 source and failed as expected by granting billing. Its saved SHA-256
  remains BD8A1ABEE2F225ED08B8122A4B8DEF44131B210A60457F60D6F1B125BD13451D.
  The separate terminal-absence reproduction remains unchanged at SHA-256
  5AE16D518D48AB7ED45DD8D3C22A0C2BDE31ACEE6290053C36E98B6FFF9B3452.
- These scoped runs exited normally. The previously disclosed combined-runner
  lingering-handle warning remains historical evidence, not an observed warning
  in these runs and not a claim that its cause has been fixed.
- Native CI/emulator and external reviews were not rerun or claimed for this local
  correction. No push, PR mutation, merge, deployment or migration occurred.

## Exact-head external review and local recovery correction

27f0d05 was subsequently published under explicit authorization. Native Test &
Audit and Emulator Tests passed; Deploy to Firebase was skipped. Fresh Devin and
GitHub Codex reviews produced three independently reproduced pure-domain issues:

- P1 semantic recovery: supplying a protected event receipt to refresh returned
  the old semantic predecessor instead of replaying the event, rejecting the newer
  target. The correction derives the successor first and validates receipt equality
  separately, including malformed/foreign receipt rejection.
- P1 replacement availability: ordinary cancellation quarantined the old authority
  and generated a synthetic lineage issue forever. The selector now distinguishes
  coherent irreversible closure from resumable or independently attested quarantine.
  Tests cover both terminal statuses, pointer presence/absence, retained suppression,
  explicit identity quarantine, and the actual pure dispatch decision.
- P2 recovery visibility: a current pointer selecting a superseded ledger blocked
  checkout with no issue/owner/path. That contradiction now produces reconciliation.

These are bounded recovery/projection defects, not evidence that subscription,
disposition and account selection should be recombined. No storage or provider
integration is introduced. The pre-correction regression snapshot is preserved
outside the PR with SHA-256
89FC878DD7E5F2DDB34C628B5450CC0264131BC8286A1F018F80C9C3B3EB7D9B.

One authorized Claude cold review covered exactly 27f0d05 using a sanitized
186,975-byte payload, SHA-256
3ba02b3a28b1cb314a205c60d0403d16c6841069b54912905935b8120bfe3d18.
It reported no P0/P1/P2 and independently noted the superseded-pointer issue as P3.
Astra assigns P2 because the reproduced blocked state lacks the required recovery
path; the evidence resolves the severity difference. Claude's stale-receipt
documentation observation is clarified above. Its result is not approval of the
subsequent local correction. No follow-up payload has been transmitted.

Local correction validation: 295 domain/model/purity tests across six suites. The
new local HEAD requires renewed exact-head publication authorization; remote review
and CI success on 27f0d05 do not apply to the replacement. No merge, deployment,
migration, runtime activation, or production mutation is authorized or performed.
