# PRD — SynchIntro SynchGov MVP v1.2

**Subtitle:** Public-sector opportunity intelligence inside SynchIntro **Author:** Charles Berry / Claude **Date:** June 13, 2026 **Status:** Build-ready. Pending session-start verifications including AUTH OWNERSHIP BLOCKER (§18). **Repo:** pathsynch-pitch-generator (`functions/`) **Frontend repo:** synchintro-app (vanilla JS — NOT React) **Firebase project:** pathsynch-pitch-creation (same project as SynchIntro core) **User-facing name:** SynchGov (top-level sidebar section) **Internal codename:** govcapture (collections, routes, services) **Supersedes:** v1.1 (June 13). Changes marked **\[v1.2\]**.

---

## 0\. PR map (read this first)

| PR | Branch | Scope | Reviewer | Est. |
| :---- | :---- | :---- | :---- | :---- |
| PR \#1 | `feat/govcapture-foundation` | Schemas \+ composite indexes \+ flags \+ profile CRUD (soft-delete) \+ seeds \+ firestore.rules deny blocks \+ govChecklist \+ route mount in index \+ tests | Williams | 5h |
| PR \#2 | `feat/govcapture-sam-adapter` | SAM.gov adapter \+ multi-bucket queries \+ pagination \+ normalization \+ SourceRun \+ dedup \+ sync lock \+ manual sync endpoint \+ admin auth | Williams | 6h |
| **PR \#3 \[v1.2\]** | `feat/govcapture-scoring` | **Scoring engine Pass 1** \+ hard filters \+ weighted scorer (deterministic prefilter \+ Gemini semantic on top N) \+ fit labels \+ reason/risk codes \+ negative keywords \+ fixtures \+ rescore flag | Williams | 5h |
| **PR \#4 \[v1.2\]** | `feat/govcapture-usaspending` | **USAspending enrichment \+ Pass 2 integration.** Triggered by Pass 1 ≥ 45\. Writes awardContext. Calls rescoreWithAwardContext() for Pass 2\. govAwardCache. | Williams | 5h |
| **PR \#5 \[v1.2\]** | `feat/govcapture-manual-upload` | PDF/Word/text upload \+ URL paste (SSRF) \+ Gemini extraction via generateStructured() \+ Storage validation in route \+ opportunity creation \+ needs\_review | Williams | 5h |
| PR \#6 | `feat/govcapture-briefs` | AI bid/no-bid brief via generateStructured() \+ BidBrief \+ hallucination controls \+ human-review \+ cap statement \+ checklist \+ usageMetadata | Williams | 4h |
| PR \#7 | `feat/govcapture-digest` | Daily/weekly digest Cloud Function \+ settings \+ DigestLog \+ SendGrid \+ scheduler auth | Williams | 3h |
| PR \#8 | `feat/govcapture-dashboard` | synchintro-app: SynchGov sidebar \+ Inbox \+ Detail/Brief \+ Profiles \+ Upload \+ Settings \+ Pursuit board (vanilla JS) | Williams | 8h |

**\[v1.2\] Build order corrected:** \#1 → \#2 → **\#3 (scoring)** → **\#4 (USAspending \+ Pass 2\)** → \#5 → \#6 → \#7 → \#8. Sequential by default. PR \#5 and PR \#6 may run in parallel only if on separate branches with no shared file edits. If in doubt, sequential.

**Dependency rationale \[v1.2\]:** PR \#4 (USAspending) depends on PR \#3 (scoring) because enrichment is triggered by Pass 1 score ≥ 45\. PR \#3 exports `scoreOpportunity()` (Pass 1 only). PR \#4 imports it, runs Pass 1, enriches if threshold met, then calls `rescoreWithAwardContext()` for Pass 2\. This eliminates the v1.1 circular dependency.

**Total estimate: \~41h across 8 PRs, 8–10 calendar days.**

---

## 1\. Namespace & integration audit

### N-1 — Firestore collection namespace

All prefixed `gov`: `govProfiles`, `govOpportunities` (+ subcollections `/briefs`, `/documents`), `govSourceRuns`, `govDigestLogs`, `govChecklist`, `govAwardCache`, `govSyncLocks`.

### N-2 — Route namespace

All routes at `/api/govcapture/*` in new `functions/routes/govcaptureRoutes.js`. **\[v1.2\]** One integration change permitted in `functions/routes/index.js` and/or `functions/index.js` solely to mount `govcaptureRoutes`. Do not modify existing domain route files (`prospectIntelRoutes.js`, etc.). Same pattern used when Prospect Intel routes were added.

### N-3 — No shared scoring

`govScoringEngine.js` fully separate from `calculateFitScore` in `prospectIntelService.js`.

### N-4 — Prior-art fence

Do not modify or integrate with: `prospectIntelService.js`, `prospectIntelRoutes.js`, `enrichmentJobProcessor.js`, `pitchEnricher.js`, `scoringProfiles.js`, `agents/prospectResearchAgent.js`.

### N-5 — Shared infrastructure (reuse, don't modify)

- Firebase Auth (canonical identity — see AUTH BLOCKER §18)  
- `buildSourceAttribution()` for provenance envelopes  
- **\[v1.2\]** `generateStructured()` from `functions/services/structuredGeneration.js` for all new structured AI outputs. Verify at session start: exists, supports SIMPLE tier, note signature. If unsupported, fall back to `indexOf('{')` with documented exception.  
- Gemini SIMPLE tier (`gemini-2.5-flash`, `thinkingBudget: 0`)  
- Feature flag pattern (`.env` \+ `.env.example`)  
- firestore.rules deny-block convention (S8)

### N-6 — firestore.rules deny blocks

```
match /govProfiles/{doc} { allow read, write: if false; }
match /govOpportunities/{doc=**} { allow read, write: if false; }
match /govSourceRuns/{doc} { allow read, write: if false; }
match /govDigestLogs/{doc} { allow read, write: if false; }
match /govChecklist/{doc} { allow read, write: if false; }
match /govAwardCache/{doc} { allow read, write: if false; }
match /govSyncLocks/{doc} { allow read, write: if false; }
```

**\[v1.2\] Branch preflight:** confirm PR \#18 / latest firestore.rules security changes are merged into `main` before branching for PR \#1. If not merged, rebase from the current reviewed rules branch or wait for merge. Editing firestore.rules on a stale base risks merge conflicts with the June 8 security tightening work.

### N-7 — Firebase Storage rules

Path: `govcapture-uploads/{userId}/{filename}`. No public reads. No client-side writes (Admin SDK only). **\[v1.2\]** Storage rules are deny-by-default safety net only. Actual enforcement (size, MIME, sanitization) happens in the upload route handler before Admin SDK write (§4C).

### N-8 — Admin endpoint auth

Scheduled/admin endpoints never publicly callable. Cloud Scheduler: OIDC or `X-Scheduler-Secret`. Manual admin: Firebase admin claim. **\[v1.2\]** Verify at session start which admin auth pattern SynchIntro Cloud Functions use. The PathManager EC2 backend uses `x-admin-key` — that is a different product, do not reuse that pattern.

---

## 2\. Business case & competitive positioning

### 2A. Business case — unchanged from v1.1

David Hailey / Countifi actively trialing JustWin (trial expires June 22). "Let me know if your system can do this." Countifi: CAGE 9FQ89, UEI H5M4DURV6586, five NAICS codes, past performance Emirates/Delta/DukeHealth/Clark Atlanta/NC A\&T. PathSynch: APS RFP active, MBE pending. 14-day dogfood success gate.

### 2B. Competitive positioning — unchanged from v1.1

JustWin weakness: 127K ingested → 0 in Pursuits. False-positive noise (PPE, welcome kits). SynchGov differentiates: scoring transparency, USAspending sales intelligence, DFY delivery model.

### 2C. Scope fence — unchanged

Not a JustWin clone / proposal writer / FOIA engine / document chat / CRM / grants platform / SLED crawler.

### 2D. Cost design — amended \[v1.2\]

1. Gemini SIMPLE tier only. **Use `generateStructured()` for all new structured outputs** (briefs, extraction, checklist, semantic scoring). Legacy `indexOf('{')` only if `generateStructured()` doesn't support the SIMPLE model path.  
2. **\[v1.2\] Deterministic prefilter before Gemini.** Run hard filters \+ NAICS exact match \+ keyword relevance \+ negative keyword exclusion before any Gemini call. Only send the **top 100 candidates** (or those above a deterministic threshold) per profile per sync to Gemini for semantic solution-match scoring. 500 SAM.gov records should NOT each burn a Gemini call.  
3. Context caching on profile (solutions \+ credentials \+ cap statement cached; opportunity fields variable).  
4. SAM.gov and USAspending are free APIs.  
5. Feature flags gate every surface.  
6. Auto-archive past-due opportunities.  
7. **\[v1.2\]** Log `usageMetadata` on every AI output for cost visibility even during pilot.

---

## 3\. Firestore data model

### 3A. `govProfiles/{profileId}` — unchanged from v1.1

Soft-delete (`status: 'archived'`). `rescoreNeeded` flag. Solutions ≤10 with keywords ≤60 (top 10 query-grade, rest scoring-only). Negative keywords for scoring only. Credentials with UEI, CAGE, NAICS, certifications, pastPerformance, capStatementText. Filters, digest settings, autoArchiveDays.

### 3B. `govOpportunities/{oppId}` — unchanged from v1.1

Two-pass `fit` object with `pass: 1|2`. `rawDates` \+ `dateParseStatus`. `awardContext`. `checklistAnswers`. Pursuit status. Archive lifecycle.

### 3C. `govOpportunities/{oppId}/briefs/{briefId}` — amended \[v1.2\]

All fields from v1.1 plus:

```javascript
usageMetadata: {
  inputTokens,
  outputTokens,
  estimatedCost,
  modelName,
  promptVersion,
  generatedAt
}
```

### 3D–3F. Supporting collections — unchanged

`govSourceRuns`, `govDigestLogs`, `govChecklist` (5 default questions).

### 3G. `govAwardCache/{cacheKey}` — unchanged. TTL 30d. Deny-rule protected.

### 3H. `govSyncLocks/{lockKey}` — unchanged. 10-minute lease. Transaction-guarded.

### 3I. Composite indexes (PR \#1) — unchanged from v1.1

```
govOpportunities: userId + archived + fit.label + createdAt DESC
govOpportunities: userId + archived + pursuitStatus + createdAt DESC
govOpportunities: userId + archived + primarySource + createdAt DESC
govOpportunities: userId + profileIds (array-contains) + archived + createdAt DESC
govSourceRuns: profileId + createdAt DESC
govDigestLogs: profileId + sentAt DESC
```

---

## 4\. Source adapters

### 4A. SAM.gov adapter — unchanged from v1.1

Multi-bucket queries (NAICS-first, high-intent phrases, sources sought). ≤10 queries, ≤500 records per profile per sync. Sync lock. SourceRun logging. Rate limit 500ms. Dedup by canonicalKey.

### 4B. USAspending enrichment — **\[v1.2\] now PR \#4, depends on PR \#3**

No auth. Triggered by **Pass 1 score ≥ 45** (requires scoring engine from PR \#3). Calls `scoreOpportunity()` (exported by PR \#3) for Pass 1\. If ≥ 45 and `GOVCAPTURE_USASPENDING_ENABLED`: enriches via USAspending API → writes `awardContext` → calls `rescoreWithAwardContext()` for Pass 2\.

Cache: `govAwardCache/{cacheKey}`, TTL 30d.

Endpoints: `POST /api/v2/search/spending_by_award/`, `POST /api/v2/search/spending_by_category/recipient/`.

### 4C. Manual upload — **\[v1.2\] amended: route-level validation**

Accepts PDF, DOCX, text, URL paste.

**\[v1.2\] Upload validation enforced in the route handler, not storage.rules** (Admin SDK bypasses storage.rules):

- File size ≤ 25 MB → 413 if exceeded  
- MIME whitelist: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain` → 415 if rejected  
- Filename sanitized (strip path separators, null bytes, control chars)  
- Reject executables, HTML, scripts by extension \+ MIME  
- Storage rules remain deny-by-default as secondary safety net

**URL paste SSRF guard:** HTTPS only, reject private ranges/localhost/metadata host, ≤3 redirects re-validated, 8s timeout, 5MB cap, no credentials, store final URL, `sourceConfidence: 'low'` if incomplete.

**Extraction:** **\[v1.2\]** uses `generateStructured()` (not `indexOf('{')`) → structured JSON `{ title, buyerName, dueDate, description, location, naicsCodes, setAside, estimatedValue }`. Logs `usageMetadata`. Failure → create with `needs_review`.

### 4D. RFPMart — deferred to post-MVP. Architecture ready, no implementation.

### 4E. Email alert parser — V2, out of scope.

---

## 5\. Scoring engine — `functions/services/govcapture/govScoringEngine.js` — **\[v1.2\] now PR \#3**

### 5A. Two-pass architecture — unchanged from v1.1

Pass 1 (90 pts, no award context) → if ≥45 trigger USAspending (PR \#4) → Pass 2 (100 pts with award context). Null-exclusion on award dimension in Pass 1\.

**\[v1.2\] PR \#3 exports:** `scoreOpportunity(opportunity, profile)` → Pass 1 result. `rescoreWithAwardContext(opportunity, profile, awardContext)` → Pass 2 result. PR \#4 calls both.

### 5B. Hard filters — unchanged from v1.1

Past due, insufficient lead time, geography mismatch, buyer type mismatch, set-aside exclusion, below/above contract value.

### 5C. Weighted scoring — amended \[v1.2\]

| Dimension | Weight | Method |
| :---- | :---- | :---- |
| Solution match | 30 | **\[v1.2\] Deterministic prefilter first, then Gemini on top N only** |
| NAICS/PSC match | 15 | Exact match \= full; partial keyword \= half |
| Buyer/customer type fit | 15 | Priority \= full; required \= partial |
| Geography fit | 10 | Priority \= full; required \= partial |
| Award context fit | 10 | Pass 2 only. Null-excluded in Pass 1\. |
| Deadline feasibility | 10 | \>30d full, 14–30 partial, \<14 low |
| Certifications/eligibility | 10 | Set-aside \+ certifications match |

**\[v1.2\] Deterministic prefilter for solution match (30 pts):** Before any Gemini call, score each opportunity deterministically:

1. Exact NAICS/PSC match against profile solutions → \+3 deterministic points  
2. Query-grade keyword hits in title/description → \+1 per hit, cap 5  
3. Negative keyword hit → \-3  
4. Buyer type in priority list → \+1  
5. Total deterministic relevance score 0–9

**Gemini gate:** only opportunities with deterministic relevance ≥ 2, OR in the top 100 by deterministic score per profile per sync, get sent to Gemini for semantic solution-match scoring (0–10 → 0–30). All others receive the deterministic score scaled to 0–30 (rougher but costs $0).

This prevents 500 SAM.gov records from each burning a Gemini call. Expected Gemini calls per sync: ≤100 (vs. up to 500 without the gate).

### 5D. Reason and risk codes — unchanged from v1.1. Plus `RISK_NEGATIVE_KEYWORD_MATCH`.

### 5E. Rescore — unchanged. Profile edit → `rescoreNeeded: true` → cleared after rescore.

---

## 6\. AI bid/no-bid brief — `functions/services/govcapture/briefGenerator.js`

**Model:** `gemini-2.5-flash` (SIMPLE). **\[v1.2\]** Uses `generateStructured()` for output, not `indexOf('{')`. Verify at session start that `generateStructured()` supports the SIMPLE model path.

**Context caching:** profile fields cached. Per-opportunity fields variable.

**Custom checklist:** questions from `govChecklist/{profileId}`.

**Hallucination controls:** never invent dates/portals/contacts/certifications. Missing → "Not found in source document." `humanReviewRequired: true` always.

**\[v1.2\] usageMetadata:** every brief logs `{ inputTokens, outputTokens, estimatedCost, modelName, promptVersion, generatedAt }`.

**Human-review warning:**

AI-generated bid briefs are decision-support outputs, not final compliance reviews. Deadlines, eligibility requirements, submission instructions, and mandatory attachments must be verified by a human before pursuing or submitting.

---

## 7\. Routes — `functions/routes/govcaptureRoutes.js`

All routes require Firebase Auth. Profile ownership: canonical identity field (see AUTH BLOCKER §18).

```
// Profiles
GET    /api/govcapture/profiles
POST   /api/govcapture/profiles
GET    /api/govcapture/profiles/:profileId
PUT    /api/govcapture/profiles/:profileId
DELETE /api/govcapture/profiles/:profileId          // soft-delete → archived

// Opportunities
GET    /api/govcapture/opportunities?profileId=&fitLabel=&source=&buyerType=&status=&archived=false
GET    /api/govcapture/opportunities/:oppId
PUT    /api/govcapture/opportunities/:oppId/status
POST   /api/govcapture/opportunities/:oppId/score
POST   /api/govcapture/opportunities/:oppId/generate-brief
POST   /api/govcapture/opportunities/:oppId/archive

// Sources
POST   /api/govcapture/sources/:source/sync
GET    /api/govcapture/source-runs?profileId=

// Manual Upload
POST   /api/govcapture/manual-upload
POST   /api/govcapture/manual-upload/:oppId/confirm

// Checklist
GET    /api/govcapture/checklist/:profileId
PUT    /api/govcapture/checklist/:profileId

// Digest
GET    /api/govcapture/digest-settings/:profileId
PUT    /api/govcapture/digest-settings/:profileId
POST   /api/govcapture/digests/send-test

// Admin — [v1.2] verified auth pattern (OIDC / scheduler secret / admin claim)
POST   /api/admin/govcapture/run-daily-sync
POST   /api/admin/govcapture/run-digest
```

---

## 8\. Frontend — synchintro-app (vanilla JS) — unchanged from v1.1

Sidebar: **SynchGov** (top-level, after Intel, before Analytics) → Opportunities · Profiles · Upload · Settings.

8A Inbox (Hot/Warm/Review tabs), 8B Detail/Brief, 8C Pursuit Board (kanban), 8D Profile Management, 8E Manual Upload, 8F Settings (digest, sources, archive, checklist).

---

## 9\. Scheduled functions — unchanged from v1.1

`govDailySync` (6 AM ET): sync → normalize → dedup → prefilter → score Pass 1 → enrich if ≥45 → Pass 2 → auto-archive. Auth: OIDC/secret.

`govDigestSend` (daily 7 AM / weekly Monday 7 AM): query → compose → SendGrid → DigestLog.

---

## 10\. Feature flags — unchanged from v1.1

`GOVCAPTURE_ENABLED`, `_SAM_ENABLED`, `_USASPENDING_ENABLED`, `_RFPMART_ENABLED` (false), `_MANUAL_UPLOAD_ENABLED`, `_AI_BRIEFS_ENABLED`, `_DIGESTS_ENABLED`, `_AUTO_ARCHIVE_ENABLED`. Missing \= `false`.

---

## 11\. Env vars — unchanged from v1.1

`SAM_GOV_API_KEY`, `GOVCAPTURE_SCHEDULER_SECRET`, `GOVCAPTURE_SENDGRID_API_KEY`, `GOVCAPTURE_DIGEST_FROM_EMAIL`, all flags.

---

## 12\. Acceptance criteria

**PR \#1 — Foundation**

- [ ] Profile CRUD; DELETE → `status: 'archived'` (soft-delete)  
- [ ] Seed PathSynch \+ Countifi profiles (Countifi: NAICS 541614/561990/541511/541512/611420, UEI H5M4DURV6586, CAGE 9FQ89, past performance Emirates/Delta/DukeHealth/Clark Atlanta/NC A\&T)  
- [ ] `GOVCAPTURE_ENABLED=false` → all routes 404  
- [ ] **\[v1.2\]** Route mounted in `index.js` — single integration line, no other route file changes  
- [ ] **\[v1.2\]** Firestore.rules branch preflight: PR \#18 / latest security changes merged before editing  
- [ ] Deny rules compile for all gov\* collections including govAwardCache \+ govSyncLocks  
- [ ] Composite indexes defined (§3I)  
- [ ] govChecklist with 5 default questions per seed profile  
- [ ] Full suite green

**PR \#2 — SAM.gov Adapter**

- [ ] Multi-bucket queries: NAICS-first \+ high-intent phrases \+ notice-type filter  
- [ ] Pagination beyond 100; dedup by canonicalKey  
- [ ] Sync lock: concurrent → 409  
- [ ] ≤10 queries, ≤500 records per profile per sync  
- [ ] SourceRun logged; admin endpoint validates auth  
- [ ] `GOVCAPTURE_SAM_ENABLED=false` → 409

**PR \#3 — Scoring Engine \[v1.2 — was PR \#5\]**

- [ ] Exports `scoreOpportunity()` (Pass 1\) and `rescoreWithAwardContext()` (Pass 2\)  
- [ ] **\[v1.2\] Deterministic prefilter:** NAICS match \+ keyword hits \+ negative keywords scored before Gemini. Gemini called on top 100 or deterministic ≥ 2 only.  
- [ ] **\[v1.2\] Gemini calls use `generateStructured()`** for semantic scoring. `usageMetadata` logged.  
- [ ] **Fixture: `positive-rfid-asset-management.json`** \+ Countifi → Strong Fit, `MATCH_NAICS_EXACT`  
- [ ] **Fixture: `positive-asset-shipment-tracking-fema.json`** → Possible/Strong Fit  
- [ ] **Fixture: `negative-welcome-kit-production.json`** \+ Countifi → Poor Fit / Disqualified (JustWin false-positive regression)  
- [ ] **Fixture: `negative-ppe-vendor-management.json`** → Stretch / Poor Fit  
- [ ] **Fixture: `near-miss-warehouse-supplies.json`** → Stretch  
- [ ] Hard filters: past-due disqualified, geo mismatch disqualified  
- [ ] Negative keyword → `RISK_NEGATIVE_KEYWORD_MATCH`  
- [ ] Profile edit → `rescoreNeeded: true`; rescore clears flag  
- [ ] Pass 1 uses 90-point model (award dimension null-excluded)

**PR \#4 — USAspending \+ Pass 2 \[v1.2 — was PR \#3\]**

- [ ] Imports `scoreOpportunity()` from PR \#3; runs Pass 1  
- [ ] Pass 1 ≥ 45 → USAspending enrichment → `awardContext` written  
- [ ] Calls `rescoreWithAwardContext()` → Pass 2 score with 100-point model, `fit.pass = 2`  
- [ ] Pass 1 \< 45 → no enrichment, `fit.pass = 1`, award dimension null-excluded  
- [ ] "No similar awards" → `similarAwardsFound: false`, not error  
- [ ] govAwardCache: hit skips API (30d TTL)  
- [ ] `GOVCAPTURE_USASPENDING_ENABLED=false` → enrichment skipped, Pass 1 is final

**PR \#5 — Manual Upload \[v1.2 — was PR \#4\]**

- [ ] PDF/DOCX/text → extracts title, buyer, dueDate, description  
- [ ] URL paste → SSRF guard (reject private IPs, localhost, metadata)  
- [ ] **\[v1.2\]** Upload route validates: size ≤25MB (413), MIME whitelist (415), filename sanitized, executables/HTML rejected — BEFORE Admin SDK write  
- [ ] **\[v1.2\]** Extraction uses `generateStructured()`. `usageMetadata` logged.  
- [ ] Failure → opportunity created `needs_review`, no crash  
- [ ] User edits extracted fields via confirm endpoint

**PR \#6 — AI Brief**

- [ ] **\[v1.2\]** Uses `generateStructured()`. `usageMetadata` logged on every brief.  
- [ ] `humanReviewRequired: true` always  
- [ ] Missing info → "Not found in source document"  
- [ ] Checklist answers extracted; cap statement used when present  
- [ ] Failure → `analysisStatus: 'failed'`, not crash

**PR \#7 — Digest**

- [ ] Daily/weekly sends at configured frequency  
- [ ] Empty → no email or configurable "no new fits"  
- [ ] DigestLog per send; scheduler auth validated

**PR \#8 — Dashboard**

- [ ] SynchGov sidebar (top-level) with Opportunities/Profiles/Upload/Settings  
- [ ] Inbox: Hot/Warm/Review tabs, correct filtering, archive action  
- [ ] Detail: all fields, award context, brief, pursuit buttons  
- [ ] Pursuit board: kanban or table toggle  
- [ ] Manual upload with SSRF-guarded URL paste  
- [ ] Existing SynchIntro pages → zero regressions  
- [ ] `GOVCAPTURE_ENABLED=false` → sidebar hidden

---

## 13\. Integration tests — unchanged from v1.1

Eight post-merge tests including SAM.gov live sync, JustWin false-positive regression, USAspending enrichment, manual upload extraction, brief generation, digest, auto-archive, and flag-off behavior.

---

## 14\. Success & kill criteria — unchanged

14-day gate: ≥10 relevant, ≥3 serious, ≥1 realistic pursuit, ≥3 useful briefs. Kill: zero serious → pause.

---

## 15\. Scope boundaries — NOT in this build — unchanged

No FOIA, proposal writer, document chat, collaboration, CRM, grants, SLED crawler, billing integration, public pages, RFPMart implementation, email alert parser, PathManager integration, changes to existing SynchIntro features.

---

## 16\. Carry-forward rules

1. SynchGov is a SynchIntro module. Same auth, same project, same conventions.  
2. AI briefs advisory only. `humanReviewRequired: true` always. No auto-submission.  
3. Never invent dates, portals, contacts, certifications.  
4. Scoring is two-pass. Award dimension null-excluded in Pass 1\.  
5. Source failures degrade independently.  
6. RFPMart internal-only until terms verified.  
7. USAspending is enrichment, not primary source.  
8. Auto-archive, not delete.  
9. Feature flags gate every surface. Missing \= `false`.  
10. All gov\* collections CF-only with deny rules.  
11. Gemini SIMPLE tier with context caching.  
12. Countifi seed uses real credentials.  
13. Negative keywords in scoring only, never source queries.  
14. Admin/scheduled endpoints require auth. Never publicly callable.  
15. URL paste SSRF-guarded (Prospect Intel C-9 standard).  
16. Profiles soft-deleted, never hard-deleted.  
17. Sync locks prevent concurrent syncs (10-min lease).  
18. **\[v1.2\]** `generateStructured()` for all new structured AI outputs. Legacy `indexOf('{')` only if session-start audit proves `generateStructured()` unsupported for SIMPLE tier.  
19. **\[v1.2\]** Deterministic prefilter before Gemini. Never send \>100 opportunities per sync to LLM.  
20. **\[v1.2\]** `usageMetadata` on every AI output, even during pilot.  
21. **\[v1.2\]** Upload validation in route handler, not storage.rules (Admin SDK bypasses rules).  
22. **\[v1.2\]** Route mount is one line in index.js. No existing domain route files modified.

---

## 17\. Seed profiles — unchanged from v1.1

PathSynch Labs (NAICS TBD) and Countifi (full credentials, query-grade \+ scoring-only keywords, negative keywords).

---

## 18\. Claude Code kickoff prompt

Pre-flight: PRD copied to repo root as `PRD-synchgov-v1.md`; terminal in `pathsynch-pitch-generator`; plan mode ON.

```
Read these files completely before doing anything else, in this order:
1. functions/CLAUDE.md
2. functions/SYSTEM_BIBLE.md
3. PRD-synchgov-v1.md (repo root — the spec for everything that follows)

We are building SynchIntro SynchGov MVP. The PRD is the build spec.
SYSTEM_BIBLE wins any doc conflict.

AUTH OWNERSHIP BLOCKER — resolve before ANY implementation:

Before PR #1 implementation begins, verify the authenticated identity contract.

Required finding:
- req.user.sub MUST equal the Firebase Auth UID used by Firestore ownership
  fields such as users/{uid}, pitches.userId, and request.auth.uid.

If req.user.sub equals Firebase Auth UID:
  → Proceed with PR #1.
  → Use userId as the canonical owner field on all gov* documents.
  → Ownership checks use doc.userId === req.user.sub.

If req.user.sub does NOT equal Firebase Auth UID:
  → STOP. This is a PR #1 BLOCKER, not a PR #1 fix.
  → Do not create schemas, routes, indexes, seed profiles, or tests.
  → Report:
    1. What req.user.sub contains
    2. Where it is assigned
    3. Whether Firebase Auth UID is available elsewhere on req.user
    4. Which existing collections use Firebase UID vs mapped ID
    5. Recommended ownership model for SynchGov
  → No SynchGov implementation may proceed until Charles confirms the
    canonical ownership model.

SESSION-START VERIFICATIONS (report findings, then pause for confirmation):
a. List all top-level Firestore collections (from firestore.rules or indexes).
   Confirm no existing collection uses the gov* prefix.
b. List all route files in functions/routes/. Confirm no existing route uses
   /api/govcapture. Identify functions/routes/index.js for the mount point.
c. Confirm buildSourceAttribution() exists — location and signature.
d. Confirm generateStructured() exists in functions/services/structuredGeneration.js.
   Note its signature, supported models, and whether it accepts SIMPLE tier.
   If it does not exist or does not support SIMPLE: note for PRD exception
   (fall back to indexOf('{') with documented rationale).
e. Confirm firestore.rules has no permissive catch-all exposing gov* collections.
   Confirm PR #18 / latest security rules are merged into main.
f. Note .env.example location and format convention.
g. Resolve AUTH OWNERSHIP BLOCKER above.
h. Confirm admin auth pattern used by existing SynchIntro Cloud Functions
   (Firebase admin claim? OIDC? scheduler secret? x-admin-key is PathManager
   EC2 only — do not reuse).

PRIOR-ART FENCE: prospectIntelService.js, prospectIntelRoutes.js,
enrichmentJobProcessor.js, pitchEnricher.js, scoringProfiles.js, and
agents/prospectResearchAgent.js are DIFFERENT features. Do not modify them,
do not use them as integration points. PRD §1 (N-4) lists all exclusions.

TODAY'S UNIT OF WORK: PR #1 ONLY — branch feat/govcapture-foundation,
scope per PRD §0 (PR #1 row), acceptance criteria per §12 (PR #1 section).
Nothing from PR #2–8.

Deliverables for PR #1:
1. functions/services/govcapture/ directory structure
2. Firestore schema definitions (§3A, §3D, §3E, §3F)
3. Composite indexes (§3I)
4. functions/routes/govcaptureRoutes.js — profile CRUD only (soft-delete)
5. One-line mount in functions/routes/index.js or functions/index.js
6. Seed script for PathSynch + Countifi profiles (§17)
7. firestore.rules deny blocks for ALL gov* collections (§N-6)
8. Feature flag GOVCAPTURE_ENABLED wired, documented in .env.example
9. govChecklist with 5 default questions per seed profile
10. Tests per §12 PR #1 checklist; full suite green

Run the test suite before and after. Show me the plan first.
```

Subsequent sessions swap the unit-of-work block for PR \#2 / \#3 / \#4 / \#5 / \#6 / \#7 / \#8 with their §12 sections.  
