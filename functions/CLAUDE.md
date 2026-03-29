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

### Sprint 4 — Market Intel Full Enrichment (March 28, 2026)

**Commits:** e5c1170, 3738eeb — merged to main, deployed to production

**New File:**
- `functions/services/theOrgClient.js` — TheOrg API client for enterprise decision maker lookup.
  Searches organizations by name, fetches people, filters by decision-maker titles (C-Suite, VP,
  Director, etc.). Env: THEORG_API_KEY (Secret Manager only, NOT in .env).

**Modified Files:**

**functions/index.js**
- Added `THEORG_API_KEY` to secrets array. SERPER_API_KEY is already in `.env` — adding it to
  secrets causes deploy failure ("Secret environment variable overlaps non secret environment
  variable"). Only add secrets that are NOT in .env.

**functions/services/serperClient.js** — 4 new exported functions:
- `searchFastestGrowingCommunities(city, state, industry)` — 3 parallel Serper searches for
  growing neighborhoods/suburbs, population growth by zip, and industry demand. Returns top 5
  communities by mention frequency + growth signals for top 3.
- `searchAreaIncome(city, state)` — Median household income search, returns top 3 sources.
- `enrichLeadOwner(businessName, city)` — 3 sequential queries (owner, founder/operator,
  LinkedIn) to find business owner name, title, and LinkedIn URL. 200ms delay between queries.
- `searchMarketTrends(city, state, industry)` — 5 parallel searches: demand, new openings (news),
  closings (news), hiring, seasonal patterns. Returns categorized signal arrays.

**functions/api/market.js** — 2 new Gemini functions + enrichment pipeline:
- `generateSalesIntel()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON: topPainPoints,
  objectionResponses, entryWedge, bestTimeToCall, competitorVulnerability, talkingPoints.
- `generateRecommendations()` — gemini-2.5-flash with thinkingBudget:0. Generates JSON:
  priorityActions (rank/action/businessName/reason/openingLine/timing), weeklyGoal,
  sequenceRecommendation, expectedOutcome, quickWin.
- Lead owner enrichment: top 5 serperLeads enriched with ownerName/ownerTitle/linkedInUrl via
  Promise.allSettled before report document creation.
- Parallel AI block expanded: now runs 6 tasks in parallel — aiSummary, competitorAnalysis,
  demographicsCommunities, marketTrends, salesIntel, (placeholder). Recommendations run
  sequentially after salesIntel resolves (needs salesIntel.entryWedge).
- New fields on reportData.data: demographicsCommunities, trends, salesIntel, aiRecommendations.
- Library auto-save content updated with all 4 new data fields.

### Sprint — SEO Landscape (March 28, 2026)

**Commits:** 50c2c6f (bundled with SWOT) — deployed to production

**Modified: functions/api/market.js**
- `calculateSEOLandscape(competitors)` — scores top 10 competitors on rating (25pts),
  review volume (25pts), website presence (20pts), phone/GBP completeness (10pts),
  address (10pts), review response proxy (10pts). Returns tier (strong/moderate/weak),
  signals array, opportunity text, market insight summary.
- Called after benchmarks, before parallel AI block.
- `seoLandscape` included in reportData.data and Library auto-save content.

### Planned (not built)
- Pitch Quality Agent (Vertex AI)

---

## Session — March 29, 2026

**Commits:** Deployed to production (functions + hosting)

### New Files Created

| File | Purpose |
|------|---------|
| `functions/services/opportunityScorer.js` | 5-component opportunity score + Intel Signal generator |
| `functions/services/seoLandscape.js` | `calculateSEOLandscape()` (extracted from market.js) |
| `functions/services/swotGenerator.js` | `generateSWOT()` (extracted from market.js) |
| `functions/services/narrativeGenerator.js` | `generateAIExecutiveSummary()`, `generateCompetitorAnalysis()` |
| `functions/services/salesIntelGenerator.js` | `generateSalesIntel()`, `generateRecommendations()` |
| `functions/services/verticalConfigs.js` | 6 vertical configs + `detectVertical()` + `buildVerticalContext()` |
| `functions/services/verticalQuestions.js` | Dynamic pre-generation questions + fallback templates |

### API Endpoints Added

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/market/questions` | AI-generated precision targeting questions (gemini-2.5-flash, 3s timeout) |
| GET | `/market/questions/fallback` | Hardcoded vertical question templates |

### Key Architectural Decisions

- **ICP filter** is user-configurable toggle, NOT hardcoded (supports Countifi enterprise use case)
- **Opportunity Score v2** INVERTS review count: low reviews = high score (businesses that need PathSynch most)
- **Intel Signals** replace Pitch Hooks: data-specific gap observations for sales rep, not sales copy
- **Vertical configs** auto-detect and inject industry-specific context into all AI prompts
- **market.js** refactored from 1200+ lines to ~860 lines via service extraction
- **PDF export** moved to client-side html2pdf.js (Puppeteer unavailable in Cloud Functions 2nd Gen)
- **All exports fixed**: PDF, PPTX, Google Slides, Google Drive, OneDrive — `Toast.show()` → `API.showToast()` (26 instances)
- **Six Smart Mode cards** produce six visually distinct report types via card-specific system prompts + HTML templates
- **Positioning Matrix**: `positioningMatrix` data object on Market Intel report. SVG scatter plot (rating vs reviews) with opportunity zone, crosshairs, tooltips
- **News signal geographic filter**: state parameter + `isGeographicallyRelevant()` post-filter
- **Dynamic Pre-Generation Questions**: AI-generated via gemini-2.5-flash with hardcoded vertical fallback

### Opportunity Score v2 (5-component formula)

| Component | Range | Description |
|-----------|-------|-------------|
| A: Rating Quality Gap | 0-30 | How far above 4.0★ |
| B: Presence Gap | 0-30 | INVERTED — low review count = HIGH score |
| C: Review Velocity Gap | 0-20 | Recency of last review from DataForSEO |
| D: SEO Tier Gap | 0-10 | Below market average = more opportunity |
| E: Signal Bonus | 0-10 | Award/opening/hiring news triggers |

Interpretation: 80-100 Priority, 60-79 Strong, 40-59 Moderate, <40 Monitor

### Vertical Configs (6 verticals)

| Vertical | Review Ceiling | Key Fields |
|----------|---------------|------------|
| food_beverage | 400 | painPoints, pitchAngle, recommendedProducts, avgTicket, CLV, seasonalTriggers, icpSignals |
| professional_services | 150 | (same fields, industry-specific values) |
| automotive | 300 | " |
| health_beauty | 250 | " |
| retail | 200 | " |
| home_services | 350 | " |

Auto-detected via `detectVertical()` fuzzy-matching from industry/subIndustry/businessName keywords.
Injected into: pitchGenerator.js, market.js ICP filter, salesIntelGenerator.js, opportunityScorer.js.

### DataForSEO Integration

- `getGoogleReviews()` — Real review data (rating, count, 3-5 snippets) on top 5 Market Intel leads. Parallel `Promise.allSettled`. Graceful fallback.
- `getLocalSERPRankings()` — Google Maps pack rankings in SEO Landscape. Position, business name, rating, review count for up to 10 results.

### Six Smart Mode Card Types (CARD_SYSTEM_PROMPTS)

| Card | Focus | Schema |
|------|-------|--------|
| card1 | Competitor Landscape | competitors[], ratingGap, valueGap, pitchHooks |
| card2 | Reputation Health | reviewVelocity, responseRateGap, complaintPatterns, sentimentBreakdown |
| card3 | Market Opportunity | tamEstimate, opportunityScore, marketSaturation, growthRate |
| card4 | Pre-Call Brief | companySnapshot, meetingTrigger, talkingPoints[], objections[] |
| card5 | Referral Potential | currentMonthlyReferrals, potentialMonthlyReferrals, rewardStructure |
| card6 | GBP Audit | gbpScore, dimensions[], quickWins, fullOptimizationPlan |

### Firestore Index Created

- `events` collection: composite index (eventType ASC + timestamp DESC) for Smart Mode preferences query

---

## GEMINI MODEL RULES (Updated March 29, 2026)

### Model Hierarchy
- gemini-3-flash-preview — PRIMARY model for fast tasks (reasoning, synthesis, pitch gen, simple agents)
  Used in: geminiClient.js, geminiClientV2.js, agentRunner.js, config/gemini.js primary tier

- gemini-3.1-pro-preview — ADVANCED model for complex reasoning (multi-step analysis, intelligence synthesis, agentic orchestration)
  Note: "gemini-3.1-pro-preview-customtools" does NOT exist — use gemini-3.1-pro-preview

- gemini-2.5-flash — SIMPLE TASKS model (email, SVG, trigger extraction, question generation)
  Used in: shareEmailGenerator.js, geminiVisuals.js, index.js trigger extraction, config/gemini.js economy tier

- gemini-2.5-flash-lite — BUDGET model for high-volume low-complexity tasks
  Used in: config/gemini.js fallback tier

### Model Rules
- NEVER use gemini-1.5-pro or gemini-1.5-flash — DEAD (404)
- NEVER use gemini-2.0-flash — DEPRECATED, shuts down June 1 2026
- NEVER use gemini-2.0-flash-exp — DEPRECATED
- NEVER use gemini-3-pro-preview — SHUT DOWN March 9 2026
- When in doubt, use gemini-3-flash-preview
- gemini-3-flash-preview or higher = KEEP, never downgrade
- GEMINI_MODEL env var controls geminiClient.js default — currently set to gemini-3-flash-preview in .env

### JSON Output Rules (Critical for 3.x models)
- Gemini 3.x models have thinking enabled by default
- Thinking tokens leak before JSON output causing parse failures
- Always add thinkingBudget: 0 when expecting JSON output:
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
- Always extract JSON using indexOf('{') / lastIndexOf('}')
  NOT by stripping markdown fences alone
- Always start system prompt with:
  "IMPORTANT: Output ONLY a valid JSON object.
   Start your response with { and end with }.
   Do not include any explanation or text outside the JSON."
- Leave thinking ENABLED (no thinkingConfig) for:
  pitch synthesis, agent reasoning, pre-call briefs
