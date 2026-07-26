# Gate 1 Strategy Review — PR-C5 Proposal Evaluator (SynchGov Capture)

**Spec:** `PRD-synchgov-capture-01-v2.2.md` §8 (+ §12 AI-call standards, §13 data model, §10 metrics). **Track B, ships first — manual-upload mode, no C4 dependency** (v2.2 inversion). **Merge:** Williams (product code + **firestore.rules change → manual-approval**). Paired backend + frontend PRs (§13).

**Status: DRAFTED AHEAD OF THE BLOCKER.** The PRD requires David's shared evaluator prompt (Brian's template lineage) "reviewed as input to the evaluator rubric **before build**" and attached to this packet. Architecture below is approvable now; **Pass B's rubric content finalizes via a short Gate 1a addendum when the prompt lands.** Recommended sequencing lets ~80% of the build start without it (see Build plan).

---

## Session-start findings (code-grounded)

| Area | Current state |
|---|---|
| Upload plumbing | `manualUploadService` already ships `extractTextFromPdf` (pdf-parse), `extractTextFromDocx` (mammoth), `validateFile`, `sanitizeFilename`, `MAX_FILE_SIZE`; multer memory-storage pattern at `govcaptureRoutes.js:596`. The proposal upload **reuses this service** — no new parse dependencies (§8.1). |
| F-301 (multer) | `multer ^2.1.1` sits at the HIGH advisory ceiling; §8.1 mandates a bump past 2.1.1 in/immediately before C5 since this PR expands the upload surface. |
| Pursuit hook | `govPursuits.proposalReadiness` already exists (C2: validated numeric 0–100, currently written by no feature) — C5 is what activates it. The C2 frontend fast-follow list already flags it as a dormant field. |
| AI plumbing | `generateStructured()` with response schemas + `usageMetadata` capture is the established pattern (`_semanticSolutionMatch`, `briefGenerator`). Pass A = SIMPLE (`gemini-2.5-flash`), Pass B = PRIMARY (`gemini-3-flash-preview`), per §12. |
| Checklist surface | Opportunities detail has a Checklist tab (`govChecklist` per profile). Pass A **extends** it rather than adding a new surface (§8.2). |
| Data model (§13) | `govProposalDocs/{docId}`: `userId, pursuitId (nullable), storagePath, extractedKeywords[], evaluations[] (refs), uploadedAt` — deny rule + `userId + uploadedAt DESC` index specified. §13 references evaluation **refs** but defines no evaluations collection — proposed below (Gate-1 decision #2). |
| Regression classes named by the PRD | Prompt-scaffolding leak (PR #43), multi-tenant share leak (PR #23) — both get dedicated tests. |

---

## Scope — backend PR + paired frontend PR

### Backend

1. **Deps pre-step (F-301):** bump `multer` past 2.1.1 as a **separate tiny deps PR (Charles self-merge, like #54)** immediately before the C5 branch; re-run upload smoke tests. Keeps C5 reviewable.

2. **Proposal upload** — `POST /govcapture/pursuits/:pursuitId/proposal` (multipart): reuse `manualUploadService` validation/extraction (25 MB cap, allowed MIME: PDF/DOCX/TXT — N-7). Persist the original to **Cloud Storage** under `govProposals/{userId}/{docId}` (Admin SDK writes only) + a `govProposalDocs` doc (§13 shape + `filename`, `mimeType`, `sizeBytes`, `extractedTextLength`). Extracted text stored server-side for evaluation; keywords extracted on upload (deterministic tokenization first; no AI call on upload — evaluation is user-requested only, §8.6 cost rule).

3. **Pass A — Compliance check (deterministic-first)** — `POST /govcapture/pursuits/:pursuitId/evaluate`:
   - Step 1 (SIMPLE, `generateStructured`): extract the RFP's stated requirements (submission instructions, required forms/sections, page limits, certifications, deadlines) into a normalized requirements checklist.
   - Step 2 (deterministic): mark each requirement **present / missing / unclear** in the draft via string/section matching; only `unclear` items may consult the model. Output extends the existing Checklist surface data shape.

4. **Pass B — Evaluator score** (same endpoint, sequenced after Pass A): PRIMARY-tier `generateStructured` call that role-plays the awarding evaluator against the RFP's own evaluation criteria where stated (**generic-rubric fallback** where not), returning `{ score 0–100, perCriterion[] {criterion, score, reasonCode, evidence}, fixFirst[] ranked }`. **No naked scores** — every dimension carries a criterion-linked reason code (acceptance §8). **Rubric content = David's prompt (Gate 1a addendum).** `promptVersion` stamped on every result.

5. **Evaluation persistence — proposed new collection `govEvaluations/{evalId}`** (Gate-1 decision #2): `userId, pursuitId, proposalDocId, passA {requirements[], summary}, passB {score, perCriterion[], fixFirst[]}, promptVersion, usageMetadata, createdAt`. Rationale: §13's `evaluations[] (refs)` implies referenced docs; fix-first **ack toggles need per-item updates** and the §10 trust metric needs queryability — neither works well inline on the proposal doc, and results must **survive proposal deletion** (§8.5), which forbids storing them only on the doc. CF-only deny rule + `userId + pursuitId + createdAt DESC` index.

6. **Fix-first acknowledgment state (v2.2):** each `fixFirst[]` item carries `ackState: open | acknowledged | addressed` + `ackAt` + `ackByUid`, toggled via `PUT /govcapture/evaluations/:evalId/fix-first/:index/ack`. This is the instrumentation behind §10 "evaluator trusted ≥60% ack" — without it the metric is unmeasurable.

7. **Re-rank hook:** on evaluation completion, stamp `proposalReadiness` (= Pass B score) + `latestEvaluationId` onto the pursuit (transaction; the field + validation already exist from C2). Feeds the C2 board card and the C3 cards with zero further work.

8. **Deletion right (v2.2):** `DELETE /govcapture/proposals/:docId` — removes doc + Storage object + extracted keywords/text, logs to activity feed. `govEvaluations` survive (their `proposalDocId` goes stale by design); `proposalReadiness` on the pursuit persists.

9. **Rules / indexes / flags:** deny blocks for `govProposalDocs` + `govEvaluations` (Williams manual-approval); indexes `govProposalDocs(userId + uploadedAt DESC)` + `govEvaluations(userId + pursuitId + createdAt DESC)`; **Cloud Storage rules** for the `govProposals/` path (deny client; verify whether the repo carries `storage.rules` — build-time check). Flag `GOVCAPTURE_EVALUATOR_ENABLED` (default off; endpoints 404 when off, requires `GOVCAPTURE_PURSUITS_ENABLED` — evaluations hang off pursuits).

10. **Tests:** the PRD's named fixtures — an RFP/draft pair with a **deliberately-omitted required form** (Pass A must catch it); criterion-linked reason codes on every dimension; **prompt-scaffolding-leak regression** (PR #43 class — assert no system-prompt text in stored/returned output); **multi-tenant isolation** (PR #23 class — merchant A's proposals/evaluations unreachable as merchant B, unit + emulator deny assertions); ack-state transitions; deletion right (doc+storage+keywords gone, evaluation survives); `proposalReadiness` stamp; flag-off 404s. Full suite ≥ current baseline **1,784**.

### Frontend (paired)
11. **Pursuit detail — Evaluator panel** (this becomes the C2 fast-follow "detail drawer"): upload draft → "Run evaluation" (explicit user action, cost-gated) → Pass A checklist (present/missing/unclear) → Pass B score + per-criterion reasons + **fix-first list with ack toggles** (open/acknowledged/addressed). `proposalReadiness` badge on the pursuit card (field already flows). Proposal vault list with delete (confirm dialog naming the deletion-right semantics).
12. Probe-gated like Pursuits/Analytics (`GOVCAPTURE_EVALUATOR_ENABLED` off → invisible). **This PR also replaces the C2 `window.prompt` capture with the inline panel pattern** where they collide (partial payment on the embedded-mode fast-follow).

---

## Gate 1 decisions for Williams
1. **Two-pass architecture** — deterministic-first Pass A extending the Checklist surface; PRIMARY-tier Pass B with criterion-linked reason codes; evaluation only on explicit user request. Approve?
2. **`govEvaluations` as a dedicated CF-only collection** (rationale in #5 — §13 implies refs but doesn't define the container). Approve the §13 clarification?
3. **Multer bump as a separate self-merge deps PR** immediately before C5 (F-301). OK?
4. **Blocker handling** — approve the architecture now; Pass A + upload + persistence + ack plumbing build immediately; **Pass B's rubric prompt slots in last via a Gate 1a addendum when David's prompt arrives** (it is the acceptance-criteria gate for opening the PR). Accept this sequencing?
5. **Storage surface** — Cloud Storage path `govProposals/{userId}/…`, Admin-SDK-only, plus whatever `storage.rules` state the repo has (verified at build). Approve the storage approach?

## Blast radius
Two new collections + one Storage path + 4 endpoints + 2 deny blocks + 2 indexes + 1 flag + the Evaluator panel. All behind `GOVCAPTURE_EVALUATOR_ENABLED` (off). Touches the existing upload surface only via the multer bump (its own PR). No change to scoring, pursuits, or analytics behavior; the only cross-feature write is the `proposalReadiness` stamp — a field C2 already validates and C3 already ignores gracefully.

## What could go wrong + mitigations
| Risk | Mitigation |
|---|---|
| Evaluator scores read as authoritative | Reason codes + evidence per criterion; `promptVersion` on every result; §10 pause criterion (<20% ack → revisit rubric with David before iterating). |
| Prompt scaffolding leaks (PR #43 class) | Dedicated regression test on stored + returned output. |
| Cross-tenant proposal access (PR #23 class) | Owner-scope on every endpoint; CF-only deny rules; unit + emulator isolation tests; Storage path is per-user and Admin-SDK-only. |
| Cost creep (two-pass AI on big docs) | Evaluation user-requested only; Pass A deterministic-first (model only for `unclear`); SIMPLE/PRIMARY split; `usageMetadata` on every call vs the §7 guardrail. |
| David's prompt never arrives | Generic-rubric fallback is spec'd (§8.3) — ship Pass B on the fallback with `promptVersion: generic-v1`, swap in David's rubric as a prompt-version bump. Flagged as a decision, not assumed. |
| 25 MB parse blows function memory/time | Existing N-7 cap + `manualUploadService` limits; extraction happens once at upload, not per evaluation. |

## Rollback
`GOVCAPTURE_EVALUATOR_ENABLED=false` hides everything. Collections/rules/indexes/Storage path are inert additions. Full revert = revert both PRs; uploaded proposals are user-deletable via the deletion right regardless.

## Build plan (after approval — blocker-aware ordering)
1. Deps PR: multer bump (self-merge) → upload smoke green.
2. Backend branch `feat/govcapture-c5-evaluator`: upload + `govProposalDocs` + Storage + deletion right → Pass A (extract + deterministic match) → `govEvaluations` + ack endpoints → `proposalReadiness` stamp → rules/indexes/flag → tests. **Everything except the Pass B rubric prompt.**
3. **Gate 1a (when David's prompt lands):** attach prompt, confirm rubric mapping, finalize Pass B schema/prompt. If it hasn't landed by backend-complete: decision point — hold, or ship on the generic rubric.
4. Gate 2 (backend), STOP → PR → Williams. Then frontend Evaluator panel → smoke → Gate 2 → PR.

## Merge routing
Product code + rules → **Williams**. Deps bump → Charles self-merge. Backend first, then frontend. I do not merge.

---

**STOP — approval needed on the five Gate-1 decisions.** Note decision #4 explicitly: architecture approval now does **not** start the Pass B rubric until David's prompt is attached (or you elect the generic-rubric-first path).
