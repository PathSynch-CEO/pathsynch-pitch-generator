# PRD — SynchGov Capture PR-C6: Master Proposals, Tailoring & Rubric Customization

**Version:** 1.2 (decisions stamped)
**Date:** 2026-07-17
**Author:** Claude (Countifi-corpus session), from Charles's direction + David Hailey's ask
**Status:** DRAFT — no code started. Blocked on PR-C5 merge (Gate 0).
**v1.0 → v1.1 changes:** deferred WS-C to the Gate 1a field inventory + Phase-2 wizard (was a
competing question set); moved tone/structure standards to the gov profile (single source);
dropped the `govProposalDrafts` collection (tailored drafts are vault entries); added feature
gates, coded-error convention, composite indexes, v2.2 AI-call rules, `versions[]` history.
**v1.1 → v1.2 changes:** Charles approved defaults for all seven open questions (§10 is now
"Decisions"); credit price set (150); PR-C6d (docx export) added to the delivery plan.

---

## 1. Summary

David Hailey (Countifi) confirmed he wants his reusable master government proposal used for **both**:

- **(a) Proposal generation tailoring** — SynchGov generates per-solicitation drafts starting
  from his master instead of a blank scaffold.
- **(b) Evaluator testing** — the master exercises the PR-C5 evaluator. *(Shipped: PR #61 —
  cleaned corpus + auto-activating Pass A tests, merged to main 2026-07-17.)*

Charles's architectural direction, which this PRD adopts: **do not replace the general
evaluator.** Countifi's specifics enter as *data* through the rubric-as-data architecture the
C5 session already ratified (Gate 1a addendum), and the *generic* lessons harvested from
Countifi's corpus roll into the scaffold (`generic-v2`) so **all** SynchGov customers benefit.
This PRD is deliberately downstream-compatible with `strategy-review-govcapture-c5-gate1a.md`
— where the two overlap, Gate 1a wins.

## 2. Goals

1. Per-customer **master proposal vault**: any SynchGov customer can upload a master;
   Countifi's cleaned master (already in-repo as a test fixture) seeds the first one.
2. A **tailoring engine**: master + opportunity/RFP → tailored draft in the existing proposal
   vault, with the master's per-solicitation gaps surfaced as an explicit checklist (never
   silently papered over).
3. **Rubric/tailoring customization** via the Gate 1a data model — no new competing question
   set; C6 adds only the master-specific preferences the Gate 1a inventory doesn't cover.
4. **generic-v2 evaluator bump**: fold the corpus findings into the scaffold every customer
   gets (this is Gate 1a's "David decomposition protocol, step 1" — C5 session owns it).

## 3. Non-goals

- Replacing or forking the generic scaffold per customer (Gate 1a hard rule: customers never
  author raw prompt text; customer input reaches the model only as validated structured data).
- Duplicating the Gate 1a Phase-2 confirm-and-fill wizard — C6 consumes its fields, does not
  redefine them.
- Auto-submitting or exporting tailored proposals to portals.
- Frontend settings UI build (scoped separately in `synchintro-app` once backend fields are fixed).

## 4. Current state (verified read-only against the C5 WIP, 2026-07-17)

| Piece | State |
|---|---|
| `govProposalService.js` | **Vault only** — `saveProposal` (validate → extract ≤200k chars → deterministic keywords → Storage `govProposals/{userId}/…` + `govProposalDocs`), `listProposals`, `deleteProposal`, `getProposal`. **No generation/tailoring exists anywhere** (confirmed against v2.2 too — WS-B is net-new). |
| `manualUploadService.js` | **Modified in C5 WIP**: extractors accept per-call caps (`extractTextFromPdf(buffer, maxChars, maxPages)`, `extractTextFromDocx(buffer, maxChars)`). `ALLOWED_MIMES` = pdf, docx, **text/plain** (25 MB cap, signature-validated). C6 reuses as-is — no extractor changes needed. |
| `govEvaluationService.js` | Pass A (SIMPLE extraction → deterministic `matchRequirements`) + Pass B (PRIMARY, `generic-v1` scaffold + delimited merchant-rubric block). `DRAFT_TEXT_CAP = 30000`. `runEvaluation` requires `proposal.pursuitId === pursuitId`. |
| `govRubricAssembler.js` | Gate 1a Phase 1: assembles rubric **data** from existing profile/sellerProfile fields + `rubricNotes` (the ≤1-new-field rule; `criterionWeights` is the anticipated Phase-2 delta). Sanitized, delimited, length-capped; `rubricVersion` content-hash stamped per evaluation. |
| `govcaptureRoutes.js` (WIP) | Conventions C6 must match: routes behind `featureGate` **+ per-feature env gates** (`GOVCAPTURE_PURSUITS_ENABLED`, `GOVCAPTURE_EVALUATOR_ENABLED` → 404 when off); coded service errors mapped via an `_…ErrorStatus(code)` switch; inline multer memory-storage with `MAX_FILE_SIZE` limit; `extractedText` never echoed in responses. |
| `firestore.rules` / indexes (WIP) | `govProposalDocs`, `govEvaluations`: `allow read, write: if false`. Composite indexes: `govProposalDocs(userId, uploadedAt DESC)`, `(userId, pursuitId, uploadedAt DESC)`, `govEvaluations(userId, pursuitId, createdAt DESC)`. |
| Gate 1a addendum | Ratified 3-layer prompt architecture (scaffold / RFP criteria / merchant rubric-as-data); field inventory of existing rubric sources incl. **custom checklist questions** (→ Pass A extensions), `solutions[]`, `lossReason`, `avgContractValue`; Phase-2 wizard = the only place new customer questions get asked (weights, loss history, **tone/structure standards**); David decomposition protocol (email sent 2026-07-16). |
| Countifi corpus (main) | `functions/tests/fixtures/govcapture/countifi-master/` + `tests/govCorpusCountifi.test.js` (7 integrity tests live; 10 Pass A tests auto-activate when C5 lands). Known findings: 30k draft cap truncates the ~50.7k master (9/16 sections unseen by Pass B); Pass A substring false-positives (`nist` ⊂ "administrator"). |

## 5. Architecture — four workstreams

### WS-A: Master proposal vault (`govMasterProposals`)

Mirror the `govProposalDocs` vault pattern, keyed per customer (profile-level, not pursuit-level).

**Firestore `govMasterProposals/{docId}`** (CF-only, deny rule like the proposal vault):

```
userId              string
profileId           string?  — govProfiles link
title               string
storagePath         string   — CURRENT version: govMasterProposals/{userId}/{ts}-{safeName}
versions            array    — [{version, storagePath, sizeBytes, uploadedAt}] — full history;
                               re-upload appends + bumps `version` (see open question #3 for pruning)
filename / mimeType / sizeBytes / version (int, current)
extractedText       string   — ≤ MAX_STORED_TEXT_CHARS (200k), same extractors, current version
extractedKeywords   string[] — extractKeywords() (reuse)
sections            array    — [{n, title, offset}] — deterministic heading split (§7.1)
knownGaps           array    — [{id, summary}] — deterministic gap scan at ingest (§7.2)
tailoringPrefs      object?  — MASTER-SPECIFIC only: {alwaysIncludeSections[], neverIncludeSections[],
                               notes ≤800 chars} — sanitized (_sanitize posture), validated in schemas.js
                               like rubricNotes. Tone/structure standards do NOT live here — they are
                               gov-profile data per Gate 1a Phase 2 (single source; read by both
                               evaluator rubric AND tailoring engine).
status              'active' | 'archived'
createdAt / updatedAt
```

**Endpoints** (in `govcaptureRoutes.js`, matching C5 conventions — `featureGate` + new env gate
`GOVCAPTURE_MASTERS_ENABLED` → 404 when off; coded errors via an `_masterErrorStatus` switch;
inline multer memory-storage; `extractedText` stripped from list responses):

- `POST /govcapture/master-proposals` — multipart upload (field `file`); `validateFile`;
  extract; section-split; gap-scan; persist. Re-upload with `?masterId=` = new version.
- `PATCH /govcapture/master-proposals/:id` — title / status / tailoringPrefs only.
- `GET /govcapture/master-proposals` · `GET …/:id` · `DELETE …/:id` (doc + ALL version
  objects; tailored drafts already in the proposal vault survive, same survivability rule as
  evaluations; activity-feed entry like `deleteProposal`).

**Config:** `firestore.rules` deny block; composite index `govMasterProposals(userId, updatedAt DESC)`;
`.env.example` entry for `GOVCAPTURE_MASTERS_ENABLED`.

### WS-B: Tailoring engine (net-new — `govTailoringService.js`)

`tailorProposal(userId, pursuitId, masterProposalId)`:

1. **Ownership gates first** (pursuit + master; same order as `runEvaluation` — P0 share-leak class).
2. **RFP text** via the evaluator's `_getRfpText` resolution (export it from
   `govEvaluationService` rather than duplicating).
3. **Requirements checklist**: reuse Pass A `extractRequirements(rfpText)` — one extractor,
   not two. Additionally merge the profile's **custom checklist questions** (Gate 1a
   inventory) into the checklist. The compliance matrix in the draft is regenerated **against
   actual RFP requirements** — never the master's self-declared generic matrix.
4. **Section-wise generation** via `generateStructured` — per v2.2 carry-forward rules:
   **`model` passed explicitly every call** (PRIMARY tier; the default is the expensive
   ADVANCED tier), **`usageMetadata` logged** with a `tailoringPromptVersion`. Prompt inputs:
   master section text + RFP context + gov-profile tone/structure standards + rubric-style
   delimited blocks with the same guardrail language (master text is *reference data* — the
   Gate 1a injection posture applies to it exactly as to rubric text).
   - Section-wise generation is also the structural answer to the 30k-cap class of problem:
     no single prompt carries the whole document.
5. **Gap checklist on output** — master `knownGaps` + Pass A misses + unclaimed
   certifications the profile holds (Gate 1a: "flag drafts that fail to claim certifications
   the merchant holds — deterministic, high-value"): blank fields, named past performance,
   certifications, pricing. Rendered as a "before you submit" list, never silently dropped.
6. **Persist INTO the existing proposal vault** — no new drafts collection. The rendered
   draft is written to Storage as text and saved through `saveProposal`-equivalent internals
   as a `govProposalDocs` entry with additive optional fields:
   `source: 'tailored'`, `masterProposalId`, `masterVersion`, `gapChecklist[]`, `sections[]`,
   `tailoringPromptVersion`, `usageMetadata`. Consequences, all free: evaluator works with
   **zero changes** (`runEvaluation` takes any vault doc), v2.2 deletion right inherited,
   existing rules + indexes cover it, drafts list beside uploads (`source` disambiguates).
7. **Cost rule**: runs only on explicit user request (§8.6 posture). **Credit price: 150**
   (anchored to L2 smart-card generations at 145; tailoring is ~6–8 PRIMARY calls vs. an
   evaluation's 2). Revisit once C6b's logged `usageMetadata` shows real per-run cost (§10.4).

**Endpoint:** `POST /govcapture/pursuits/:pursuitId/tailor` — body `{masterProposalId}`;
gated by `featureGate` + `GOVCAPTURE_PURSUITS_ENABLED` + `GOVCAPTURE_MASTERS_ENABLED`
(mirrors how `evaluatorGate` requires both flags).

**Artifact guard (hard rule):** tailored output must never contain the two removed master
artifacts. Corpus tests already pin the fixture; a C6 test asserts generated drafts too, and
the ingest gap-scan flags chat-artifact-looking paragraphs on any future dirty upload (§7.2).

### WS-C: Customization — consume Gate 1a, don't compete with it

Gate 1a's field inventory already covers the "answers in the settings" layer; its Phase-2
wizard is the designated home for **new** customer questions (criterion weights, loss
history, tone/structure standards). C6 therefore:

1. **Adds no rubric fields and no questions of its own.** The one C6 data addition is
   `govMasterProposals.tailoringPrefs` (§WS-A) — master-specific include/exclude prefs that
   are properties of a *document*, not of the customer.
2. **Reads tone/structure standards from the gov profile** (once Phase 2 lands) in the
   tailoring prompt — the same single source the evaluator rubric uses. Until Phase 2
   exists, tailoring runs without tone standards (acceptable degradation; do not
   front-run the wizard with a stopgap field).
3. **Countifi rollout** = the Gate 1a David decomposition protocol, extended one step:
   his email answers + prompt map onto rubric fields (C5 session's step 2), his master is
   uploaded to WS-A, and his `tailoringPrefs` set from the same conversation.

| Customer input | Home | Owner |
|---|---|---|
| Certifications, set-asides, past performance, USPs, rank fields, `rubricNotes`, custom checklist questions, `lossReason`, `avgContractValue` | Existing profile/settings fields (Gate 1a inventory) | C5 |
| Criterion weights, loss history, tone/structure standards | Gate 1a Phase-2 wizard | C5 fast-follow |
| Master document + per-master include/exclude prefs | `govMasterProposals` (WS-A) | **C6** |

### WS-D: generic-v2 evaluator bump (C5 session owns; tracked here for one-place visibility)

This is Gate 1a's decomposition protocol **step 1** ("whatever generalizes → scaffold v2
candidates") applied to the corpus findings (relayed to the C5 session 2026-07-17):

1. ~~**Draft cap**~~ **DONE in C5 WIP (verified 2026-07-20)**: `DRAFT_TEXT_CAP` raised
   30000 → 100000 and `draftTruncated` stamped on the eval doc.
2. ~~**Keyword specificity**~~ **DONE in C5 WIP (verified 2026-07-20)**: word-boundary
   matching for short keywords, with a regression test citing the Countifi corpus finding.
3. **New scaffold criteria** with reason codes: `NO_NAMED_PAST_PERFORMANCE`,
   `NO_CERTIFICATIONS_NAMED`, `SELF_DECLARED_COMPLIANCE_MATRIX`, `BLANK_SOLICITATION_FIELDS`
   — the four expected findings the merged corpus manifest encodes, so tests exist the day
   the criteria do. (Past-performance and certification checks get sharper still when rubric
   data is present — Gate 1a already specs that cross-check.)
4. Ship as `promptVersion: 'generic-v2'` — the mechanism C5 built for exactly this.

## 6. Firestore & Storage summary (new in C6)

| Path | Access | Index | Notes |
|---|---|---|---|
| `govMasterProposals/{id}` | CF-only (deny rule) | `(userId, updatedAt DESC)` composite | WS-A |
| Storage `govMasterProposals/{userId}/…` | default-deny (already) | — | versioned originals |
| `govProposalDocs` additive fields | unchanged (deny rule stands) | existing indexes suffice | `source`, `masterProposalId`, `gapChecklist`, … |

No `govProposalDrafts` collection (v1.0 had one; dropped in v1.1 — see WS-B step 6).

## 7. Ingest processing details

### 7.1 Section split (deterministic, no AI on upload — vault philosophy)
Heading regex over extracted text (`/^\d{1,2}\.\s+.+$/m`, first-occurrence de-dup) →
`sections[]` with offsets. The corpus manifest's section table is the reference fixture.

### 7.2 Gap scan at ingest (deterministic)
Keyword probes over extracted text (same technique as the corpus manifest probes):
certifications absent, past-performance phrases absent, blank-field labels present,
"Compliant"-matrix pattern, **chat-artifact heuristic** (meta-language paragraphs about "the
proposal" — flag for review, never auto-delete). Results → `knownGaps[]`, shown in the vault
UI and fed to the tailoring gap checklist.

## 8. Testing plan (builds on merged corpus)

- **Ingest round-trip**: fixture docx through `POST /master-proposals` (mocked Storage) →
  `extractedText` equals the corpus .txt; `sections` match the manifest; `knownGaps` contains
  the four expected findings.
- **Tailoring**: mocked `generateStructured` → compliance matrix keyed to Pass A
  requirements; gap checklist present incl. unclaimed-certification entries; **removed
  artifacts absent from output**; vault doc carries `source: 'tailored'` + backrefs; model
  passed explicitly on every call (assert on the mock).
- **Injection containment**: hostile master text (delimiter forgery, embedded instructions)
  cannot alter the output contract — same test style as the Gate 1a rubric containment tests.
- **Vault**: version bump appends to `versions[]`; delete removes all version objects;
  tailored drafts survive master deletion.
- **generic-v2** (C5-side): corpus Pass A probes keep passing (they encode statuses, not
  prompt versions); new criteria tests assert the four reason codes fire on the corpus.

## 9. Delivery plan

| Gate | What | Depends on |
|---|---|---|
| **Gate 0** | PR-C5 merges | C5 session |
| **PR-C6a** | WS-A master vault: service + routes + gate flag + rules + index + ingest tests | Gate 0 |
| **PR-C6b** | WS-B tailoring engine + vault integration + gap checklist + artifact/injection guards | C6a |
| **PR-C6c** | WS-C: `tailoringPrefs` validation (schemas.js, rubricNotes pattern) + Countifi data entry; frontend vault/tailor UI scoped in `synchintro-app` | C6a; tone standards arrive with Gate 1a Phase 2 |
| **PR-C6d** | Branded .docx export of tailored drafts (docx-js render) — polish, deliberately last | C6b; David's branding input |
| **generic-v2** | WS-D — recommended as a small dedicated follow-up PR immediately after C5 merges (not inside C5; §10.7) | C5 session's confirmation |

Posture per standing rules: build in a dedicated worktree from `origin/main`, PR per gate,
Charles merges, deploy only on explicit "deploy" (backend `firebase deploy --only
functions:api` from a tree with `functions/.env` present — verify "Loaded environment
variables from .env").

## 10. Decisions (approved by Charles, 2026-07-17)

1. **Tailored-draft format — text/Markdown first (C6b); branded .docx export as PR-C6d.**
   Text drafts are evaluator-ready via the vault the moment they're generated; docx render is
   polish, deliberately sequenced last. *Docx timing/branding detail pending David's input.*
2. **Workspace scope — owner writes, workspace members read.** A master is a company asset
   (same logic as existing workspace inheritance); member read lets a contributor run
   tailoring on a pursuit they work.
3. **Version pruning — keep all versions.** ~83KB files, a handful per customer; storage cost
   ≈ 0, and "what did the master say when that draft was generated?" must stay answerable.
   Revisit only on abuse.
4. **Credit price — 150 per tailoring run** (anchor: L2 smart-card generations at 145;
   tailoring is ~6–8 PRIMARY calls vs. an evaluation's 2). Recalibrate from logged
   `usageMetadata` once C6b measures real per-run cost.
5. **Pursuit stage tie-in — stamp `lastTailoredAt` on the pursuit; stage transitions stay
   user-driven.** Stage mirroring to `pursuitStatus` already exists and must not get a second
   writer; David manages stages by hand ("this one's still in planning…"). Signal, don't drive.
6. **Gap copy — verbatim findings in the "before you submit" checklist framing.** The gaps
   are factual and David is a power user; the checklist framing is the softening. *Confirm
   with David at rollout; a sensitivity tweak later is copy, not design.*
7. **generic-v2 placement — small dedicated follow-up PR immediately after C5 merges, not
   inside C5.** C5 is large and unopened; nothing in the corpus tests requires simultaneity.
   *C5 session confirms.*

## 11. Risks

- **Injection surface widens**: tailoring feeds RFP + master text into PRIMARY prompts.
  Mitigation: the Gate 1a posture generalized — delimited blocks, guardrail lines, schema
  enforcement, containment tests (§8).
- **Dirty master re-upload** (original with artifacts) → ingest gap-scan flag +
  artifact-absence test on tailored output.
- **Two writers on tone/structure** was a v1.0 design risk — resolved in v1.1 by making the
  gov profile (Gate 1a Phase 2) the single source; masters carry only document-specific prefs.
- **Countifi-shaped overfit**: every §7 heuristic must be exercised against a second,
  structurally different master before it's called generic (action: request one from another
  design partner when available).
