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

### Tier 2 Sprint 1 — Lead Enrichment + Review Intelligence (March 29, 2026)

**New File:**
- `functions/services/decisionMakerEnricher.js` — Gemini-powered decision maker extraction.
  `serperQuickSearch()` (standalone lightweight Serper search) + `extractPersonFromSnippets()`
  (gemini-2.5-flash, thinkingBudget:0, temperature:0, maxOutputTokens:100).
  Two sources: direct owner/founder search, website about-page search.
  `enrichDecisionMaker(leadName, city, state, website)` → `{ name, title, source, confidence }`.
  3s timeout per lead via Promise.race. Graceful null return on failure.

**Modified Files:**

**functions/api/market.js** — Decision maker enrichment + review response rate:
- Removed old regex-based `enrichLeadOwner` block (was top 5 pre-ICP, Serper-only)
- Added Gemini-powered DM enrichment post-ICP/post-scoring on top 10 qualified leads
- Runs as `dmEnrichmentPromise` in parallel with AI block, awaited before Firestore save
- Sets `lead.decisionMaker` object + backward-compat `lead.ownerName`/`lead.ownerTitle`
- DataForSEO review mapping now calculates `responseRate` and `respondedCount` from
  individual review `ownerResponse` fields. Also passes `hasOwnerResponse` per review.

**functions/services/narrativeGenerator.js** — Competitor analysis prompt rewrite:
- Model: gemini-3-flash-preview (unchanged)
- Shows top 10 competitors (was top 5)
- Prompt completely rewritten: archetype-based structure
  - Paragraph 1: Market Structure — identify 2-3 competitive archetypes, name specific businesses,
    volume vs quality separation, dominated vs fragmented assessment
  - Paragraph 2: Opportunity Pattern — gap pattern, quality-without-presence businesses,
    ends with usable conversation opener for sales rep
- Constraints: 120 words/paragraph, 3+ named businesses, no generic data-description phrases

**functions/services/opportunityScorer.js** — Intel Signal enrichment:
- `generateIntelSignal()` gained 2 new lines (before existing review snippet):
  - Line 5: Review response rate — shown only when `responseRate < 30%`
    Format: `Response rate: X% — review engagement gap detected.`
  - Line 6: Review velocity alert — shown when last review > 60 days ago
    Format: `Review velocity alert: last review X days ago — dormant engagement.`

### Bug Fix — Positioning Matrix Syntax Error (March 29, 2026)

**File: synchintro-app/js/pages/market.js (line 1719)**
- DataForSEO review block was OUTSIDE the `.map()` callback scope
- `.map()` closed at line 1701, then `${lead.dataForSEO ? ...}` referenced `lead` (out of scope)
- Orphaned `` `).join('')} `` at line 1719 caused `SyntaxError: Unexpected token ')'`
- Fix: moved DataForSEO block back inside `.map()` return template before callback closes
- Market Intel page was completely broken — now fixed

### Known Issues (March 29, 2026)

- **Executive summary leader misidentification**: AI summary sometimes picks first competitor
  as "market leader" instead of actual highest-rated. Narrative prompt may need to explicitly
  receive the market leader object rather than relying on Gemini to identify it from the data.
- **ICP filter vertical ceiling not applying for all verticals**: Nashville Salon report showed
  leads with 1,100+ reviews passing through a 250-review ceiling. Investigate whether
  `detectVertical()` is matching "Salon & Beauty" to the `health_beauty` config.
- **L4 may still render as L2** (from March 28): `isL4` requires both `pitchLevel === 4` AND
  `useCustomLibrary` to be true. If `generateLibraryEnhancedContent()` returns null, silent
  fallback to generic L2 template.

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

---

## Session — March 30, 2026

**Deployed to production (functions + hosting). Market Intelligence Report — FEATURE COMPLETE.**

### Pre-Tier 3 Fixes (Items 1-4)

**1. ICP ceiling hard exclusion**
File: `services/verticalConfigs.js`, `api/market.js`
- Added missing keywords to `health_beauty` vertical config
- Added `else if (verticalConfig)` branch that enforces ceiling even without explicit ICP toggle
- Fix for Nashville Salon report showing 1,100+ review leads passing 250-review ceiling

**2. Market leader identification (initial fix)**
Files: `services/narrativeGenerator.js` (2 locations), `api/market.js`
- Replaced `competitors[0]` with proper sort by rating (desc) then review count (desc)
- Applied in `calculateMarketBenchmarks()` and both narrative generator leader selections
- Later superseded by composite score in item 22

**3. News signal → Opportunity Score cross-reference**
File: `api/market.js`
- Cross-reference loop matching `newsSignals` to `serperLeads` by business name BEFORE `scoreLeads()` runs
- `classifySignalType()` helper categorizes signals (award, opening, hiring, expansion)
- Matching signals boost Opportunity Score component E (Signal Bonus)

**4. News signal deduplication**
File: `api/market.js`
- Deduplicates signals by title (case-insensitive) after Serper fetch
- Prevents same news article appearing multiple times from different search queries

### Sprint 2A — Demographics Enrichment (Item 5)

**New File:**
- `functions/services/demographicsEnricher.js` — US Census ACS API (free, no key required).
  `enrichDemographics(city, state)` fetches population, median income, median home value.
  `parseGrowthFromSnippets()` extracts growth %, population gains from Serper editorial snippets.
  Returns `{ population, medianIncome, medianHomeValue, growthIndicators[] }`.

**Modified:** `api/market.js` — Wired into parallel enrichment block. Demographics data stored
on `reportData.data.demographics`. Frontend renders City Demographics card, community pills
with green growth badges, growth signal cards with structured data.

### Sprint 2B — Share of Voice (Item 6)

**Modified:** `api/market.js`, `services/opportunityScorer.js`
- Share of voice: `reviews / totalMarketReviews × 100` for all competitors + leads
- Added to: Competitors table (Voice column), Market Benchmarks (Leader Voice Share card),
  Intel Signals (<1% share line), positioning matrix tooltips, leads table (color-coded badges)
- Fixed positioning matrix rendering which was getting undefined data from missing voice values

### Sprint 2C — PathManager Benchmark Feed (Item 7)

**Modified:** `api/market.js`, `index.js`
- `writeMarketBenchmark()` writes to `marketBenchmarks` Firestore collection on every report generation
- 30-day TTL via Firestore TTL policy
- Benchmark document includes: avg rating, reviews, market leader, ICP median, share of voice,
  SEO landscape tier, Census demographics, market saturation index
- Two new read endpoints (public, no auth required):
  - `GET /benchmarks/:industry/:city/:state` — exact match
  - `GET /benchmarks/search` — fuzzy search with query params

**New Firestore Collection:**
- `marketBenchmarks/{industry}_{city}_{state}` — cross-product benchmark data (30-day TTL)
- Firestore rules: public read, admin-only write
- Composite indexes for search queries

### Tier 3 Part A Fixes (Items 8-11)

**8. Duplicate business deduplication**
File: `api/market.js`
- `normalizeBusinessName()` — strips Inc/LLC/Corp suffixes, lowercases, trims
- `deduplicateLeads()` — merges duplicates, keeps higher-scoring instance
- `deduplicateCompetitors()` — same logic for competitor array
- Runs after Places API fetch, before scoring

**9. News signal hard reject list**
File: `api/market.js`
- 13 source domains rejected (IndexBox, GlobeNewsWire, MarketWatch press releases, etc.)
- Global market patterns rejected ("CAGR", "2030-2035", "market size", "forecast")
- Off-topic patterns rejected (national chains, stock market, unrelated industries)

**10. Award signal business name match required**
File: `api/market.js`
- `matchSignalToLead()` — scores signal relevance per lead
- Business name exact match = 10pts, industry keyword = 3pts, geography alone = 0pts
- Signals with 0pts are not attributed to any lead

**11. Precision questions driven by Sub-Industry**
Files: `services/verticalQuestions.js`, frontend
- `onSubIndustryChange()` fires questions based on sub-industry selection
- 16 sub-industry templates added to `verticalQuestions.js` (was 6 vertical-level only)
- Questions are more specific: "Thai restaurant" gets different questions than "Pizza shop"

### Tier 3 Sprint 1 — Enhancements (Items 12-15)

**12. Pre-Call Form trigger from leads**
File: `api/market.js` (endpoint), frontend
- Per-lead button navigates to `/#precall` with data pre-filled
- Passes: businessName, contactName (from decisionMaker), industry, location, website
- `createPreCallFromLead()` frontend handler

**13. Lead color palette system**
- 4px left border + tier label on lead cards
- Priority (green #10B981), Strong (teal #14B8A6), Moderate (amber #F59E0B), Monitor (gray #6B7280)
- `getLeadTier()` maps Opportunity Score ranges to tier names

**14. Competitor Types visual section**
Files: `services/salesIntelGenerator.js`, frontend
- Gemini generates `competitorTypes[]` array (2-4 archetypes per market)
- Each archetype: name, description, exampleBusinesses[], opportunityLevel
- Rendered as cards with "PathSynch ICP" badge on high-opportunity types
- Positioned between Competitor Analysis and SEO Landscape sections

**15. High-Impact Moves**
File: `services/salesIntelGenerator.js`
- `generateHighImpactMoves()` — gemini-3-flash-preview generates 3-5 sequenced strategic moves
- Each move: title, context, action, timing, expectedOutcome
- Replaces old Recommendations section when present (true fallback pattern)
- Data-driven: references specific leads, scores, and Intel Signal gaps

### Sprint 2B Session 1 — GBP + Sentiment (Items 16-17)

**16. GBP Completeness Signals**
File: `api/market.js`
- `getBusinessInfo()` calls DataForSEO `/business_data/google/my_business_info/live`
- `calculateGBPCompleteness()` scoring: photos (30pts), hours (20pts), claimed (20pts),
  website (15pts), phone (15pts)
- Intel Signal lines added for GBP gaps (missing photos, no hours, unclaimed)
- Stored in `services/opportunityScorer.js` via `calculateGBPCompleteness()`
- Exported from `opportunityScorer.js`, called in `adjustSEOScoreForPhotos()`

**17. Review Sentiment Extraction**
**New File:** `functions/services/sentimentExtractor.js`
- Gemini extracts from review text: `praiseThemes[]`, `complaintThemes[]`, `standoutPhrase`
- Model: gemini-3-flash-preview with thinkingBudget:0
- Called per lead (top 10 qualified) with DataForSEO review snippets as input
- Frontend: CUSTOMERS SAY section (praise pills green, complaint pills red, standout quote teal)

### Sprint 2B Session 2 — Operational Layer (Items 18-21)

**18. Report Refresh**
Files: `api/market.js`, `index.js`
- `POST /market/refresh/:reportId` — re-runs full enrichment pipeline on existing report
- 50 credits per refresh
- Updates existing Firestore document in place (preserves reportId, shareId)
- Freshness badges: green (≤14d), amber (≤30d), red (>30d)
- Refresh button appears at 15+ days, stale banner at 30+ days

**19. LinkedIn URL Enrichment**
File: `services/decisionMakerEnricher.js`
- `findLinkedInURL()` — two-query Serper search (company + person name)
- Returns LinkedIn profile URL or null
- Blue LinkedIn badge on lead cards (links to profile)

**20. Time in Business Signal**
File: `services/decisionMakerEnricher.js`, `services/opportunityScorer.js`
- `findTimeInBusiness()` — Serper search for founding date / years in business
- `classifyVelocity()` — Reviews/year: High velocity (≥30), Moderate (≥10), Low (≥5), Stalled (<5)
- Intel Signal LINE 10: "Est. X years — Y reviews/year (velocity classification)"

**21. Pre-Call Brief Auto-Attach**
Files: `api/market.js`, `index.js`
- `GET /market/match` — scores existing reports by city + state + industry
- Returns matching report when similarity score ≥ 50
- Pre-Call Form auto-attaches market intelligence from matched report

### Sprint 4 Session 1 — Rendering Fixes (Items 22-25)

**22. Market leader composite score**
Files: `services/opportunityScorer.js`, `services/narrativeGenerator.js` (2x),
`services/salesIntelGenerator.js`, `api/market.js`
- `identifyMarketLeader(competitors)` — composite: `((rating - minRating) / ratingRange) * 0.4 + (reviews / maxReviews) * 0.6`
- `getDominanceLanguage(leader, marketAvgReviews)` — ratio ≥3: "dominates", ≥1.5: "leads", else: "edges out the field in"
- Replaced rating-first sort in 4 locations (narrativeGenerator.js ×2, salesIntelGenerator.js ×1, market.js ×1)
- Executive summary prompt uses dynamic `dominanceVerb`

**23. Signal cross-reference tightening**
File: `api/market.js`
- `getIndustryKeywords()` upgraded from single-word to multi-word terms
  (e.g., 'food' → 'food service', 'restaurant opening')
- `trendBonusAwarded` flag — industry trend bonus applied to FIRST matching lead only
- Prevents score inflation from one industry trend boosting all leads

**24. High-Impact Moves for all verticals**
Files: `services/salesIntelGenerator.js`, frontend `js/pages/market.js`
- Confirmed backend already calls HIM unconditionally (no vertical gating)
- Frontend changed: HIM takes priority over Recommendations (true fallback)
- If HIM exists → render HIM. If not → fall back to Recommendations.

**25. Competitor Types + HIM in PDF export**
File: frontend `js/pages/market.js`
- Added Competitive Archetypes table to `downloadReport()` HTML builder
- Added High-Impact Moves section with styled cards
- HIM replaces Recommendations in PDF when present (same fallback pattern as UI)

### Sprint 4 Session 2 — CRM Integration / FINAL SPRINT (Items 26-27)

**26. Attio CRM Push**
**New File:** `functions/services/attioClient.js` (~173 lines)
- Uses Attio V2 REST API (`https://api.attio.com/v2`) with native `fetch` (Node 22)
- `pushLeadToAttio(lead, report)` — Creates Company record + Person record + Intel Signal note
- `pushAllLeadsToAttio(leads, report)` — Bulk push with concurrency limit of 3, 500ms delay
- `buildAttioNote(lead, report)` — Multi-line plaintext note with full enrichment data
- Routes: `POST /attio/push-lead`, `POST /attio/push-all`
- Env: `ATTIO_API_KEY` in `.env` (NOT in secrets[])

**27. Instantly Sequence Trigger**
**New File:** `functions/services/instantlyClient.js` (~100 lines)
- Uses Instantly V1 API (`https://api.instantly.ai/api/v1`) with native `fetch`
- **SEPARATE** from existing `instantlyService.js` (which uses per-user API keys for pre-call brief flow)
- `getInstantlyCampaigns()` — Fetches up to 20 campaigns
- `pushLeadToInstantly(lead, campaignId, report)` — 7 custom variables from Intel Signal
- `pushLeadsToInstantly(leads, campaignId, report)` — Sequential with added/skipped/failed tracking
- Routes: `GET /instantly-market/campaigns`, `POST /instantly-market/push-leads`
- Route prefix: `/instantly-market/*` to avoid collision with existing `/instantly/*`
- Env: `INSTANTLY_API_KEY` in `.env` (NOT in secrets[])

### New Files Summary (March 30)

| File | Purpose |
|------|---------|
| `functions/services/demographicsEnricher.js` | Census ACS API enrichment (population, income, home value, growth) |
| `functions/services/sentimentExtractor.js` | Gemini review sentiment extraction (praise, complaints, standout) |
| `functions/services/attioClient.js` | Attio V2 CRM client (Company + Person + Intel Signal note) |
| `functions/services/instantlyClient.js` | Instantly V1 market intel client (campaigns + lead push) |

### New Env Vars (March 30)

| Var | Location | Purpose |
|-----|----------|---------|
| `ATTIO_API_KEY` | `.env` only (NOT secrets[]) | Attio CRM API authentication |
| `INSTANTLY_API_KEY` | `.env` only (NOT secrets[]) | Instantly market intel push (separate from per-user Instantly integration) |

### New API Endpoints (March 30)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/market/refresh/:reportId` | Report refresh (50 credits) |
| GET | `/market/match` | Pre-call brief auto-match by city/state/industry |
| GET | `/benchmarks/:industry/:city/:state` | PathManager benchmark read |
| GET | `/benchmarks/search` | Benchmark fuzzy search |
| POST | `/attio/push-lead` | Single lead CRM push to Attio |
| POST | `/attio/push-all` | Bulk lead CRM push to Attio |
| GET | `/instantly-market/campaigns` | List Instantly campaigns (market intel) |
| POST | `/instantly-market/push-leads` | Push leads to Instantly sequence |

### New Firestore Collections (March 30)

| Collection | Key | TTL | Purpose |
|------------|-----|-----|---------|
| `marketBenchmarks/{industry}_{city}_{state}` | industry + city + state | 30 days | Cross-product benchmark data for PathManager |

### Known Issues Resolved (March 30)

| Issue | Resolution |
|-------|-----------|
| Executive summary leader misidentification | Fixed by `identifyMarketLeader()` composite score (item 22) |
| ICP vertical ceiling bypass | Fixed by hard exclusion branch (item 1) |

### Architecture Notes (March 30)

- **Two Instantly integrations coexist:** `instantlyService.js` (per-user API keys, pre-call brief flow, `/instantly/*` routes) and `instantlyClient.js` (global API key, market intel push, `/instantly-market/*` routes). Do NOT merge them.
- **Native fetch preferred:** New services (`attioClient.js`, `instantlyClient.js`) use Node 22 built-in `fetch`. Older services use axios or node-fetch. Do not refactor existing services to match.
- **Market Intelligence is FEATURE COMPLETE** as of this session. No further sprints planned. Next priorities: Chrome Extension, Universal Onboarding, Multi-agent pipeline refactor.
