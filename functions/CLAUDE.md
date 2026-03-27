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

### Session — March 27, 2026: Frontend Bug Fixes (synchintro-app repo)

**Bug: Pre-Call Forms page blank — syntax error**
File: `synchintro-app/js/pages/precallforms.js` line 3069
- Missing comma between `showToast()` and `initCompanyAutocomplete()` methods in object literal
- Prevented entire file from parsing → `window.PrecallFormsPage` was undefined
- Router found no module → page stayed blank with zero error UI
- Fix: added missing comma `}` → `},`

**Bug: Pre-Call Forms double-init race condition**
File: `synchintro-app/js/pages/precallforms.js` bottom of file
- `DOMContentLoaded` listener called `init()` on page load before auth was ready
- Set `_precallFormsInitialized = true`, blocking router from ever running init again
- Fix: removed the DOMContentLoaded auto-init block entirely — router handles init

**Bug: Pre-Call Forms init() unguarded**
File: `synchintro-app/js/pages/precallforms.js`
- No try/catch around init body → any error caused silent blank page
- `_precallFormsInitialized` flag set before try block → stuck true on error
- Fix: wrapped in try/catch, moved flag inside try, reset flag in catch

**Bug: Visitor Intel upgrade gate always firing**
File: `synchintro-app/js/pages/visitors.js` lines 38, 87
- Used `window.currentUser` which is NEVER defined in the codebase
- Tier always resolved to `'free'` → upgrade gate always shown
- Fix: changed to `await API.getCurrentUser()` in loadData(), `API._cachedUser` in render()

**Infra: Cache-busting for JS/CSS**
File: `synchintro-app/firebase.json` + `synchintro-app/index.html`
- Added `Cache-Control: no-cache, must-revalidate` headers for `/js/**` and `/css/**`
- Added `?v=1.0.0` query strings to all `js/pages/` script tags in index.html

### Known Patterns (IMPORTANT)

**1. window.currentUser does NOT exist in this codebase.**
The auth module sets `this.currentUser` on the Auth object, not `window.currentUser`.
Always use `await API.getCurrentUser()` for user data (reads from Firestore with 5-min cache).
For synchronous access after data is already loaded, use `API._cachedUser`.

**2. JS object literal methods must be comma-separated.**
Page modules (precallforms.js, visitors.js, etc.) are plain object literals, not classes.
A missing comma between methods causes a parse-time SyntaxError that prevents the entire
file from loading. The page goes blank with NO runtime error — only a console parse error.
Always run `node -c filename.js` after editing page modules to catch this.

**3. Firestore user documents have inconsistent subscription fields.**
Some users have `subscription: { plan: "scale", tier: "scale" }` (sub-object).
Some users have only top-level `tier: "scale"` and `plan: "scale"` (no subscription object).
Always use the multi-path pattern: `(user?.subscription?.plan || user?.subscription?.tier || user?.tier || 'free').toLowerCase()`

**4. Frontend is a separate repo.**
Backend: `C:\Users\tdh35\pathsynch-pitch-generator` (Cloud Functions)
Frontend: `C:\Users\tdh35\synchintro-app` (Firebase Hosting)
Both deploy to project `pathsynch-pitch-creation`.

### Planned (not built)
- Pitch Quality Agent (Vertex AI)
