## Session — March 19, 2026

### Bugs Fixed & Deployed

**Bug: L4 One-Pager generation broken**
File: functions/api/pitchGenerator.js | Commits: 77adfc4 → merged to main a3d32c3
- No case 4 in switch — pitchLevel === 4 fell through to default → generateLevel3()
  (10-12 slide enterprise deck instead of one-pager)
- Fix: added case 4 to generatePitch() switch (line 576)
- Fix: added case 4 to generatePitchDirect() switch (bulk upload path)
- Fix: added generateLevel4() — validates Sales Library has docs, delegates to
  generateLevel2() with salesLibraryContext already populated upstream
- Fix: generateLibraryEnhancedContent() — level === 4 now uses one-pager prompt
  (was using enterprise deck prompt via else branch)
- Sales Library context is fetched upstream in generatePitch() before the switch,
  so generateLevel4() does NOT re-fetch from Firestore

**Bonus: onUserCreated had never deployed**
File: functions/api/auth/welcomeEmail.js
- Importing 'firebase-functions' instead of 'firebase-functions/v1'
- Crashed every deploy silently — welcome emails never sent to any new user
- Fix: corrected import to firebase-functions/v1
- onUserCreated now live for the first time

### Architecture Notes Confirmed
- All pitch logic: exports.api → POST /generate-pitch → pitchGenerator.js
- Formatter (separate path): POST /api/v1/narratives/:id/format/one_pager → formatterApi.js
- Firestore collections: salesDocuments, customerLibraryConfig, pitches
- User logo: users/{uid}.sellerProfile.branding.logoUrl
- generatePitchDirect() — bulk upload switch (now also has case 4)

### Sprint 3+4 — Parallel Prospect Enrichment Pipeline (March 26, 2026)
**PR #5 merged March 26, 2026** — branch `feature/prospect-enrichment`

**New Files:**
- `functions/agents/prospectResearchAgent.js` (560 lines) — Vertex AI Deep Search agent
  (5 tools: google_places_lookup, competitor_scan, website_scrape, news_search,
  gbp_completeness_check). Model: gemini-2.0-flash via agentRunner.js.
  Returns structured PROSPECT_INTELLIGENCE JSON.
- `functions/services/pitchEnricher.js` (225 lines) — Promise.allSettled parallel runner.
  3 sources: prospectResearchAgent, newsIntelligenceAgent, vertexSearch.
  8s timeout per source. Graceful degradation — never blocks pitch generation.
- `functions/services/vertexSearch.js` (127 lines) — Discovery Engine API client.
  Data store: synchintro-knowledge-base_1774560525810 (project pathconnect-442522).
  Methods: searchKnowledgeBase(), groundedSearch().

**Modified Files:**
- `functions/api/pitchGenerator.js` — Wired enrichment pipeline into generatePitch().
  Places enrichment + deep enrichment run in parallel via Promise.allSettled.
  PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt.
  pitchMetadata.enrichment stored on pitch Firestore document.
- `functions/.env` — Added GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX, VERTEX_SEARCH_DATA_STORE_ID

**New Env Vars:**
- `GOOGLE_SEARCH_API_KEY` — for news_search tool (graceful skip if missing)
- `GOOGLE_SEARCH_CX` — Custom Search Engine ID: c0887a1e024af4f45
- `VERTEX_SEARCH_DATA_STORE_ID` — full Discovery Engine data store resource path

**CRITICAL: DO NOT add GOOGLE_APPLICATION_CREDENTIALS to functions/.env**
This crashes ALL Firestore access in Cloud Functions production.
Cloud Functions authenticates automatically via the default service account.
GOOGLE_APPLICATION_CREDENTIALS is only needed for LOCAL DEVELOPMENT and
should be set in your local shell environment, never in the .env file.
Local dev: `$env:GOOGLE_APPLICATION_CREDENTIALS="./pathconnect-442522-ec919d9337b8.json"`

**Architecture:**
- Create Pitch now runs 3 enrichment sources in parallel BEFORE AI synthesis:
  1. Prospect Research Agent (Google Places + competitors + GBP score + website + news)
  2. News Intelligence Agent (already existed in services/newsIntelligenceAgent.js)
  3. Vertex AI Search (knowledge base grounding)
- All run via Promise.allSettled() with 8s timeout per source
- PROSPECT_INTELLIGENCE block injected into generateLibraryEnhancedContent() prompt
- Enrichment metadata stored in pitchMetadata.enrichment on pitch Firestore doc
- Credit tracking: prospect_research=50, news_intel=25, kb_search=10

**Bug Fix:**
- Visitor Intel plan gate: `visitors.js` line 70 used `user?.tier || user?.plan` — missed
  `subscription.plan`/`subscription.tier`, blocking Scale users. Fixed to comprehensive pattern.

### Session — March 28, 2026

**Commits:** 19d78c7, b95cd9b — merged to main, deployed to production

**Bug 1 (CRITICAL): Card synthesis prompts silently dropped**
File: functions/api/pitchGenerator.js
- `generateLibraryEnhancedContent()` had two bail-out guards (lines 72, 95) that returned
  null when no Sales Library docs AND no RAG chunks — even when card synthesis instructions
  were present in `prospectIntelBlock`.
- None of the HTML level generators read `options.prospectIntelligenceBlock` directly.
- Fix: Added `hasCardInstructions` check to both guards. Added third fallback branch in
  `generatePitch()` that calls `generateLibraryEnhancedContent()` when card instructions
  exist but no library/RAG.

**Bug 2 (HIGH): generatePitchDirect() missing salesLibraryContext**
File: functions/api/pitchGenerator.js
- Bulk upload path never called `fetchSalesLibraryContext()`. L4 via bulk always threw
  "Your Sales Library is empty."
- Fix: Added fetch + early return for L4 without docs + `generateLibraryEnhancedContent()`
  call before switch. Options now include salesLibraryContext, libraryEnhancedContent,
  useCustomLibrary.

**Bug 3 (ROOT CAUSE for L4): fetchSalesLibraryContext crash on missing config**
File: functions/api/pitch/dataEnricher.js
- `configDoc.data()` returned undefined when `customerLibraryConfig/{userId}` didn't exist.
  `config.companyName` threw TypeError. Catch returned null. Charles Berry had 5 ready docs
  but no config doc — all invisible.
- Fix: `const config = configDoc.exists ? configDoc.data() : {};` + null-coalesce fields.

**Bug 4 (HIGH): L4 output identical to L2**
Files: functions/api/pitchGenerator.js, functions/api/pitch/level2Generator.js
- `generateLibraryEnhancedContent()` used identical system prompt for L2 and L4
  (`else if (level === 2 || level === 4)`).
- `generateLevel4()` just called `generateLevel2()` with zero differentiation.
- Fix: L4 has its own system prompt branch in `generateLibraryEnhancedContent()` that
  instructs AI to use Sales Library as PRIMARY source and returns seller-specific fields:
  sellerProductName, sellerMethodology, proofPoints, caseStudyName, caseStudyResult,
  sellerDifferentiators, solutionOverview, callToAction.
- Fix: `generateLevel4()` passes `pitchLevel: 4` in options.
- Fix: `level2Generator.js` checks `isL4 = options.pitchLevel === 4 && useCustomLibrary`
  and renders L4-specific sections (proof points stats, methodology/differentiators,
  case study block, key benefits grid, seller CTA, "Sales Library Powered" badges).

**KNOWN ISSUE — L4 may still render as L2:**
- The `isL4` check requires BOTH `options.pitchLevel === 4` AND `useCustomLibrary` to be true.
- `useCustomLibrary = options.useCustomLibrary && libraryContent` — if `generateLibraryEnhancedContent()`
  returns null (Gemini call fails, JSON parse fails, etc.), `useCustomLibrary` is false and `isL4`
  is false, causing silent fallback to generic L2 template.
- Debug next session: check if `generateLibraryEnhancedContent()` is actually returning valid JSON
  for level 4 with the new prompt. Check Cloud Functions logs for errors.
- Charles Berry UID: dehiyRBCXcUUM72O211S27lfXbl1 — 5 ready docs, NO customerLibraryConfig doc.

### Planned (not built)
- Pitch Quality Agent (Vertex AI)
