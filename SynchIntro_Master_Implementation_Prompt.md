# SynchIntro — Master Implementation Prompt
## Version: March 26, 2026 | Based on SynchIntro_Strategy_March2026_v6.docx

---

## ⚠️ READ THIS FIRST — BEFORE DOING ANYTHING

**Step 0 — Diagnose the current break BEFORE implementing anything new.**

```
Read functions/CLAUDE.md, functions/SYSTEM_BIBLE.md, and 
functions/api/pitchGenerator.js.

Then run a full diagnostic:
1. Check if functions/services/pitchEnricher.js imports are resolving correctly
2. Check if functions/agents/prospectResearchAgent.js has any syntax errors
3. Check if functions/services/vertexSearch.js has any missing env var references
   that would throw at module load time (not just at call time)
4. Check functions/package.json — are all dependencies used in the three new 
   files (node-fetch, etc.) listed?
5. Run: firebase functions:log --project pathsynch-pitch-creation
   and show me the last 20 log lines

DO NOT touch any existing files until you have shown me the diagnostic output.
Report what you find. I will confirm before you proceed.
```

---

## ARCHITECTURE REFERENCE

```
Frontend repo:   C:\Users\tdh35\synchintro-app
Backend repo:    C:\Users\tdh35\pathsynch-pitch-generator\functions
Firebase:        pathsynch-pitch-creation
Deploy frontend: firebase deploy --only hosting --project pathsynch-pitch-creation
Deploy backend:  firebase deploy --only functions --project pathsynch-pitch-creation
PowerShell:      sequential commands only — NEVER && chaining
First paying customer: Countifi / David Hailey (UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2)
```

---

## PHASE 0 — Fix Current Break (Do This First)

Once diagnostic is complete, fix whatever broke in the PR #5 deploy.
Most likely issues:
- Missing dependency in package.json
- Import failing at module load time (crashes all functions, not just enrichment)
- Unhandled promise rejection in pitchEnricher.js killing pitch generation

**Fix rule:** The enrichment pipeline must fail GRACEFULLY. If any of the three
enrichment sources (prospectResearchAgent, newsAgent, vertexSearch) fail, pitch
generation must continue with standard output. The fix is almost certainly adding
a try/catch around the pitchEnricher.enrichProspect() call in pitchGenerator.js
and ensuring failure returns null rather than throwing.

Branch: fix/sprint3-enrichment-stability
Commit: fix: graceful degradation on enrichment pipeline — never block pitch generation
PR: fix/sprint3-enrichment-stability → main

---

## PHASE 1 — Create Pitch UX Redesign
### Prerequisite: Phase 0 complete and deployed

**IMPORTANT: Keep the existing Create Pitch form as "Classic mode."**
The new UX is additive. A toggle at the top of the Create Pitch page reads:
  "New: Smart mode  |  Classic mode"
Default: Smart mode for new users, Classic mode preserved for existing users
who have used the product (check if user has > 0 pitches in Firestore).

### Smart Mode — New UX

**Text box with toolbar chips (inside the box, below the textarea):**

| Chip | Options |
|------|---------|
| + (Add) | From local files, Google Drive, Paste URL, From Library |
| Outreach type | L1 Outreach Sequence, L2 One-Pager, L3 Slide Deck, L4 Library One-Pager (Scale only) |
| ICP | Default ICP + user's saved ICPs from Settings |
| Goal | Book a Call, Book a Meeting, Demo Request, Close Deal, Other |
| Visual style | None, Data-driven (+35cr), Cinematic (+35cr), Both (+60cr) |

Visual style chip: hidden / locked to None when L1 is selected.

**6 Sample Analysis Cards (below text box):**
Cards 3, 4, 5 show "saves to Library" badge. All show credit cost.

| Card | Pre-fill prompt | Credits |
|------|----------------|---------|
| Analyze competitor landscape and positioning | Top 3 competitors, ratings gap, positioning map, where PathSynch wins | 85 cr |
| Research review profile and reputation health | Star rating, velocity, top complaints, response rate, reputation gaps | 85 cr |
| Build a local market opportunity analysis | TAM, saturation score, opportunity score, growth rate · saves to Library | 85 cr |
| Generate a pre-call intelligence brief | Who they are, trigger events, talking points, objections · saves to Library | 85 cr |
| Analyze referral potential and customer journey | LTV calc, referral ROI, reward structure · saves to Library | 85 cr |
| Research GBP completeness and local SEO gaps | GBP score 0-100, ranking lift estimate, LocalSynch recommendation | 85 cr |

**Inject panel (below sample cards):**
Shows Library items relevant to current prompt context.
Toggle on/off. Each injected item = 0 credits. Shows "free" badge.
Auto-suggests based on city/industry extracted from prompt text.

**cardType parameter:**
Pass selected card as cardType (card1-card6 or standard) in the API call.
Standard pitch when no card selected or when user types freely.

Files to modify:
- js/pages/create.js — Smart mode UI, mode toggle, toolbar chips, sample cards, inject panel
- functions/api/pitchGenerator.js — accept cardType + visualStyle parameters

Branch: feature/create-pitch-ux-v2
Commit: feat: Smart mode Create Pitch — toolbar chips, sample cards, inject panel, mode toggle
PR to main.

---

## PHASE 2 — Card-Specific Synthesis Prompts + Referral Calculator
### Prerequisite: Phase 1 complete

**New files:**

**functions/services/synthesisPromptRouter.js**
Export: getSynthesisPrompt(cardType)
Returns card-specific Claude system instructions for each cardType:
- card1: Competitor positioning map, rating gap, PathConnect/LocalSynch recommendation
- card2: Review velocity, response rate gap, top complaint patterns, reputation health score
- card3: TAM + opportunity score lead, revenue upside calculation, full PathSynch suite positioning
- card4: Pre-call brief format (company snapshot, opener, 3 talking points, discovery Qs, objections, competitor watch)
- card5: Referral potential format (uses referralCalculator output — see below)
- card6: GBP score breakdown across 9 dimensions, ranking lift estimate, LocalSynch recommendation
- standard: Default pitch generation (existing behavior)

**functions/services/referralCalculator.js**
Export: calculateReferralPotential(marketData)
Input: { estimatedMonthlyCustomers, avgTransaction, medianIncome, industry }
Industry referral rates: restaurant 0.08, healthcare 0.12, fitness 0.15,
  retail 0.06, home_services 0.18, professional_services 0.14, default 0.10
LTV = avgTransaction × 12 × 2.5
Reward: if ltv > 500 → "$25 credit per referral" else "10% off next purchase"
Returns: { currentMonthlyReferrals, potentialMonthlyReferrals, annualRevenueUnlocked,
           ltvUplift, recommendedRewardStructure, paybackPeriod }

**Modify functions/api/pitchGenerator.js:**
- If cardType === card5: run referralCalculator before synthesis, inject result as structured JSON
- Load card-specific synthesis prompt from synthesisPromptRouter
- Inject as additional context alongside existing PROSPECT_INTELLIGENCE block

**Auto-save to Library:**
Cards 3, 4, 5 outputs automatically saved to Firestore library collection:
library/{userId}/{itemId} with type=intel, subType=(market|brief|referral)

Branch: feature/card-synthesis-prompts
Commit: feat: card-specific synthesis prompts + referral LTV calculator + Library auto-save
PR to main.

---

## PHASE 3 — Unified Library Tab
### Prerequisite: Phase 2 complete

**Replace current Sales Library standalone tab with unified Library tab.**

**Firestore collection:** library/{userId}/{itemId}
Fields: type (intel|sales|template), subType, title, industry, city,
        content, fileUrl, creditsUsed, usageCount, createdAt

**Visual differentiation:**
- Intel items: 3px left border #185FA5 (blue), blue icon tint
- Sales items: 3px left border #534AB7 (purple), purple icon tint  
- Template items: 3px left border #F59E0B (amber), amber icon tint

**Filter chips (flat list — no sub-navigation):**
All | Intel (blue dot) | Sales (purple dot) | Templates (amber dot) |
Market reports | Briefs | Case studies

**Item types:**
- Intel: market report (card3), pre-call brief (card4), referral analysis (card5)
- Sales: case study, sales asset (user uploaded — migrate from existing salesLibrary)
- Template: prompt template, structure template, uploaded pitch

**Template types:**
- Prompt template: saved text with {placeholders} that pre-fills Create Pitch text box
- Structure template: saved section outline that runs before enrichment
- Uploaded pitch: reference PDF/PPTX/HTML used as format example for L4 generation

**Nav changes:**
- Remove: Sales Library standalone tab, Market Intel tab, Pre-Call Briefs tab
- Add: Library tab (replaces all three)
- Keep: Visitor Intel, Pre-Call Forms (unchanged — different products)

**Migrate existing Sales Library documents** to new library collection
with type=sales on first load (Firestore migration script or lazy migration on read).

Files:
- functions/api/library/index.js — NEW: unified CRUD endpoints
- js/pages/library.js — NEW: unified Library tab page
- js/app.js — update nav (remove 3 items, add Library)
- firestore.rules — add library collection rules

Branch: feature/library-unified
Commit: feat: unified Library tab — Intel/Sales/Templates with color differentiation
PR to main.

---

## PHASE 4 — Visual Engine Sprint (Nano Banana + Imagen 3)
### Prerequisite: Phase 2 complete (needs cardType + visualStyle parameters)

**Visual style toggle (already added to toolbar in Phase 1):**
None (0cr) | Data-driven (+35cr) | Cinematic (+35cr) | Both (+60cr)

**Three visual layers (Layer 1 already exists — do not touch):**
- Layer 1: HTML/CSS template + brand blob SVG (existing — keep as is)
- Layer 2: Nano Banana / Gemini 3 Pro data visualizations (NEW)
- Layer 3: Imagen 3 hero photography (NEW)

**New files:**

**functions/services/visualEngine.js**
Orchestrator. Takes { cardType, visualStyle, enrichmentData, pitchContent }
Routes to geminiVisuals and/or imagenHero based on visualStyle.
Returns { dataViz: imageUrl|null, heroImage: imageUrl|null }
Graceful degradation: if either engine fails, continue without that layer.

**functions/services/geminiVisuals.js**
Calls Gemini image generation API for data visualizations.
Uses existing GEMINI_API_KEY env var.
Card-to-visual mapping:
- card1 → competitor positioning map (price vs quality quadrant)
- card2 → rating timeline + response rate bar vs benchmark
- card3 → TAM pie + saturation gauge + opportunity score dial
- card5 → referral flywheel + LTV uplift bar
- card6 → GBP radar chart across 9 dimensions
- standard/L2/L3/L4 → ratings comparison bar + revenue opportunity callout

Prompt template:
"Generate a [chart type] infographic for a business pitch. Data: [JSON].
Style: professional, clean, flat design, teal #0D9488 and amber #F59E0B palette,
white background. Text must render accurately. Output as PNG."

**functions/services/imagenHero.js**
Calls Imagen 3 via Vertex AI.
Env var needed: IMAGEN_API_ENDPOINT (add to .env)
  = https://us-central1-aiplatform.googleapis.com/v1/projects/pathconnect-442522/
    locations/us-central1/publishers/google/models/imagen-3.0-generate-001:predict

**functions/services/industryAtmosphere.js**
Lookup table: industry → atmosphere descriptor string
restaurant: "warm interior lighting, upscale dining atmosphere"
healthcare: "clean modern medical office exterior, professional"
fitness: "bright modern gym interior with natural light"
retail: "well-lit retail storefront, inviting entrance"
home_services: "clean suburban home exterior, professional service vehicle"
auto: "modern auto repair shop, professional service bay"
default: "professional local business environment, clean and inviting"

Dynamic prompt template:
"A professional hero image for a {industry} business called {businessName}
located in {city}, {state}. Brand colors are {primaryColor} and {accentColor}.
{atmosphereDescriptor}. Cinematic lighting, realistic photography, no text,
no logos, no people. Suitable for a business pitch cover page."

**Modify functions/api/pitchGenerator.js:**
- After synthesis complete, if visualStyle !== none: call visualEngine
- Embed returned image URLs in pitch HTML output
- Add visualStyle credits to pitch metadata (35/35/60/0)
- L1 hard lock: force visualStyle = none for outreach sequences

**Credit tracking:**
Add to pitch Firestore document:
pitchMetadata.visualStyle: string
pitchMetadata.visualCreditsUsed: number (0/35/60)
pitchMetadata.totalCreditsUsed: enrichmentCredits + visualCreditsUsed

Branch: feature/visual-engines
Commit: feat: Nano Banana data viz + Imagen 3 hero imagery with visual style toggle
PR to main.

---

## PHASE 5 — Parallel Implementation (can run after Phase 0)
### These do not depend on Phases 1-4

**5A — Export Menu**
Add to pitch output view: PPTX, PDF, Google Slides, Google Drive, OneDrive
This is the highest-ROI single sprint — removes the PDF-only dealbreaker.
Branch: feature/export-menu

**5B — My Pitches view toggle**
Add list/search view alongside existing kanban.
Toggle between Pipeline view (kanban: Draft/Sent/Viewed/Replied)
and Library view (grid with search, filter, thumbnails, share links).
Branch: feature/pitches-view-toggle

**5C — Outline-first generation (Decktopus pattern)**
After user submits prompt, show section outline before rendering.
User can reorder, rename, add sections. Credits committed only on confirmation.
Branch: feature/outline-first

---

## DEPLOY SEQUENCE

Always in this order:
```
1. git pull origin main
2. (make changes on feature branch)
3. firebase deploy --only functions --project pathsynch-pitch-creation
4. Test on app.synchintro.ai
5. Confirm working
6. Merge PR to main
7. firebase deploy --only hosting --project pathsynch-pitch-creation
```

NEVER deploy hosting before testing functions. NEVER use && in PowerShell.
NEVER merge to main without testing first on the deployed functions URL.

---

## KEY CONSTRAINTS

- Countifi (David Hailey, UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2) is a paying pilot.
  Any change that breaks existing pitch generation is a customer incident.
- Enrichment pipeline must ALWAYS fail gracefully — never block pitch generation.
- All credit costs must be tracked in Firestore pitch metadata.
- L1 (Outreach Sequence) never uses visual engines.
- Visual style chip hidden when L1 selected.
- Classic mode preserved — existing users keep their workflow.
- Cards 3, 4, 5 auto-save to Library. Cards 1, 2, 6 do not.
- PowerShell: sequential commands only, never &&.
- Always read CLAUDE.md + SYSTEM_BIBLE.md before writing any code.

GEMINI MODEL CONSTRAINTS:
- Primary model: gemini-3-flash-preview (reasoning tasks)
- Simple tasks: gemini-2.5-flash
- Never use: gemini-1.5-x, gemini-2.0-x (deprecated/dead)
- JSON from Gemini 3.x: always use thinkingBudget:0 + extract via indexOf('{') not markdown stripping
- GEMINI_MODEL env var = gemini-3-flash-preview

---

## REFERENCE FILES

```
functions/CLAUDE.md
functions/SYSTEM_BIBLE.md
functions/api/pitchGenerator.js
functions/services/pitchEnricher.js
functions/agents/prospectResearchAgent.js
functions/services/vertexSearch.js
js/pages/create.js
js/pages/library.js (if exists)
js/app.js
```

---

## ENV VARS NEEDED FOR PHASE 4

Add to functions/.env before running Phase 4:
```
IMAGEN_API_ENDPOINT=https://us-central1-aiplatform.googleapis.com/v1/projects/pathconnect-442522/locations/us-central1/publishers/google/models/imagen-3.0-generate-001:predict
```

Existing env vars already in place:
GEMINI_API_KEY, GOOGLE_PLACES_API_KEY, GOOGLE_SEARCH_API_KEY,
GOOGLE_SEARCH_CX, VERTEX_SEARCH_DATA_STORE_ID,
GOOGLE_APPLICATION_CREDENTIALS, MONGODB_URI, STRIPE_SECRET_KEY

---

*Strategy document: SynchIntro_Strategy_March2026_v6.docx*
*Session date: March 26, 2026*
*PathSynch Labs — Confidential*

---

## Session — April 19, 2026

Visitor Intel Sprints 1–6 complete and deployed. Full pipeline: ps-core.js snippet → visitorSignalService → Account360 → threshold alerts → Account Workspace → Attio push → Instantly sequence trigger. Entity360 bridge wired for PathConnect merchants. Merchant behavior sync running weekly. All 6 sprints committed to main on both pathsynch-pitch-generator and synchintro-app repos.

---

## Monolith Extraction — May 21, 2026

`functions/index.js` reduced from 4,138 → 3,707 lines across 3 extraction sessions.

**New modules created:**

| Module | Exports |
|--------|---------|
| `functions/lib/shared.js` | `normalizePath`, `verifyAuth`, `getCurrentPeriod`, `db` (lazy Proxy) |
| `functions/services/pitchMetrics.js` | `ensureUserExists`, `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` |
| `functions/api/prospectIntel.js` | `onProspectBatchCreated`, `processProspectTask` |
| `functions/api/billing.js` | `checkCredits`, `deductCredits` (canonical — replaces 3 divergent copies) |

**Billing consolidation:** Three private `deductCredits` implementations (in `templateEnrichment.js`, `intentSignalService.js`, `opportunityBriefService.js`) removed and replaced with `api/billing.js`. All credit writes now go to the `creditLedger` collection. Dependency rule: `api/billing.js` imports only `firebase-admin`; all services import from it.

**`lib/shared.js` import order rule:** Must be required after `admin.initializeApp()` in `index.js`. Uses a Proxy for `db` so Firestore access is deferred until first property access.

**`processProspectTask` pattern:** Always returns HTTP 200 (even on error) to prevent Cloud Tasks retry storms.

---

## Session — April 20, 2026

**PathSynch Admin Panel v1 — new cross-product capability shipped.**

A read-only internal admin dashboard for PathSynch Labs is now live. It is a **separate product** on separate infrastructure — not part of this Firebase project.

- Backend: 4 Express routes at `/api/admin` on PathManager EC2 backend (`src/v1_0/api/admin/adminRoutes.js`)
- Frontend: standalone `index.html` in `pathsynch-admin` repo, deployed to AWS Amplify with basic auth
- Auth: `x-admin-key` header auth (independent of Firebase Auth)
- Capabilities: merchant list/detail, stats, spam detection (score 0-100), Stripe subscription/charge lookup
- Database: reads from PathManager's `col_users` MongoDB collection — **not Firestore**
- Status: backend live on EC2, frontend deployed to Amplify; DNS CNAME and EC2 security group port opening pending

**Admin Panel does NOT interact with SynchIntro Firebase functions, Firestore, or Firebase Auth.**

---

## Session — April 22, 2026 (Evening)

**Product pricing overhaul + PDF capture fix + multi-location/integrations inputs — deployed to hosting and functions.**

### What shipped

**Pricing calculator (pitchGenerator.js):**
- `per_unit` integrations exception: products named "integration" skip the per-product loop addition; their cost is handled by a dedicated `integrationCount` post-loop block
- `integrationCount × perUnitPrice` added to `totalMonthly` before location multiplier
- Pricing order: per-product loop → integrations add-on → location multiply → output

**Frontend inputs (create.js):**
- `locationCount` number input — multiplies all pricing by number of locations
- `integrationCount` number input — grayed out, activates when integrations product checked; first 3 free, $19/mo each additional

**Template resolver (templateSectionResolver.js):**
- `product_line_items` now prefers `dataContext.pitch.selectedProducts` over AI-generated product names — eliminates hallucination in the Solution section

**PDF export (pitchViewer.js):**
- Same-origin temp iframe approach: write HTML to `<iframe>`, wait 1500ms + images, capture `iframeDoc.body` with html2canvas. White overlay hides the iframe from user view. Eliminates blank PDF from div approach.

**Shareable link (p/index.html):**
- `applyResponsiveOverrides()` now window-width-aware (32/48px desktop, 20/24px tablet, 12/8px mobile)
- First-child loop only overrides children that still have a non-100% inline max-width


---

## Session — April 24, 2026

**Prospect Intel M1-1 through M1-3 shipped and live in production.**

### Frontend (synchintro-app)

js/pages/prospectIntel.js (~3200 lines) handles the complete UI:
- Empty state: Chat bar, drag-drop CSV zone, Market Intel cards with Location/Vertical filters, ICP selector, Product Focus multi-select, suggestion cards
- CSV parser: 7-format auto-detection (Instantly, Apollo, Lemlist, Smartlead, Salesforge, Skylead, Generic). 9 target field mappings. _buildInitialMappings() auto-fills from format signatures.
- Column mapping screen: 5-row preview table, exclude-no-email checkbox (checked by default), live row count, "Start Enrichment" button
- Table view: Stats bar, filter tabs (All/Needs Review/Needs Fix/Approved/Sent/DQ), search, sort, expanded row with 4 tabs (Business Details/Top Services/Buying Signals/Actions), floating action bar, kebab menu

Nav: prospect-intel route in router.js, Intel group in index.html.

API methods added: getProspectBatch, getProspectBatchProspects, retryProspect, rescoreProspects.

**3 bugs fixed today:**
1. Table not showing after enrichment -- _confirmMapping() now calls _renderTableView() immediately after batch creation, without waiting for completed status
2. Refresh returns to empty state -- loadData() now restores currentBatchId from the most recent completed/in_progress batch
3. Market Intel dropdowns showed [object Object] -- _locationStr() and _industryStr() helpers extract strings from Firestore object shapes. _industryStr reads ind.display (the actual field name in the backend schema, not ind.name or ind.label)
4. Checkbox not checked by default -- added checked attribute

### Backend (pathsynch-pitch-generator/functions)

services/prospectIntelService.js -- complete enrichment pipeline:
- processOneProspect(): reads Firestore prospect doc, calls research agent, applies Google Places fallback, runs Fit Score, writes enriched doc with provenance attribution on every field, increments batch counters
- Fit Score: 7 buying signals (low_rating 25, low_reviews 20, incomplete_gbp 15, outdated_website 15, no_review_response 15, owner_title 10, industry_match 10); 3 disqualification checks
- Source attribution: agent:gbp (rating/reviews), agent (other fields), google_places (fallback, confidence: medium)
- deductProspectCredits(): 15 credits/prospect, idempotent via creditLedger collection
- enqueueProspectTask(): Cloud Tasks enqueue via GCP REST API with OAuth2 token

routes/prospectIntelRoutes.js -- 6 endpoints:
POST /prospect-intel/batch, GET /batch/:id, GET /batch/:id/prospects, POST /batch/:id/prospects/:id/retry, POST /batch/:id/rescore, GET /icp-profiles

Cloud Functions: onProspectBatchCreated (Firestore trigger -> fan-out tasks), processProspectTask (HTTP handler for Cloud Tasks queue)

Google Places fallback (googlePlaces.js -- new lookupProspectPlace export):
textSearch + getPlaceDetails. Fires only when agent returns null for rating or website. Max 2 API calls per prospect. Non-blocking.

### Agent (PathSynch_Agents/prospect-research)

Cloud Run at https://prospect-research-218613212853.us-central1.run.app
POST /api/research -- returns structured business intelligence from web search + GBP Knowledge Panel extraction.

### Infrastructure

- Cloud Tasks queue: prospect-enrichment (us-central1, pathconnect-442522)
- IAM: 796921234100-compute@developer.gserviceaccount.com needs roles/cloudtasks.enqueuer
- Firestore rules deployed for: prospectIntel, prospectIntel/*/prospects, icpProfiles, creditLedger
- New env vars: PROSPECT_AGENT_URL, PROSPECT_TASK_HANDLER_URL, PROSPECT_TASK_SECRET

---

## Session — April 25, 2026

**Prospect Intel M1-3 bug sweep + M2-1 NemoClaw integration (SynchIntro side) complete. Backend + frontend deployed.**

### What shipped

**11 UI bug fixes in `js/pages/prospectIntel.js`:**
1. "Exclude rows with no email" checkbox now unchecked by default + amber warning count when active + Start Enrichment disabled with tooltip when 0 rows
2. Instantly headerless: `contactLastName: []` and `state: []` added to FORMAT_SIGNATURES to prevent spurious auto-mapping
3. Sample values showed "—" on initial column mapping render — fixed by calling `_onMappingChange()` immediately after attaching change listeners
4. Delete batch button silent (onclick double-quote injection from JSON.stringify) — fixed with single-quote JS string + `&#39;` escaping
5. Contact name deduplication: "Archie Lappin Archie Lappin" → "Archie Lappin" via 6-rule dedup guard in `_buildProspectRowHTML()`
6. "Approve All Strong Fit" button in toolbar: threshold dropdown (50/60/70/80/90, default 70), batch approve via `_updateProspectStatus()`
7. Export CSV: filename uses `sourceLabel`, full-format columns reordered, Top Services and Buying Signals as separate semicolon-joined columns
8. Industry fallback: `_inferIndustryFromName()` with 16 regex rules — shown when agent returned no industry
9. "Enriching (12/48)" badge CSS clipping fixed (`flex-wrap: nowrap; overflow: visible` on parent + `flex-shrink: 0` on badge)
10. Failed prospects now appear in Needs Fix tab with correct count; red left border row style; Retry button in expanded Actions; error message in red banner
11. Delete batch from Recent Lists: trash icon + confirmation modal + `_deleteBatch()` calling new `DELETE /prospect-intel/batch/:batchId` endpoint

**NemoClaw integration (M2-1 SynchIntro side):**
- Frontend: `sendToNemoClaw()` validation → `_confirmSendToNemoClaw()` modal → `_executeNemoClawSend()` API call + local state update
- `sent_to_nemoclaw` workflow status: orange badge, Sent tab counts, checkbox disabled, expanded Actions shows sent time + batch ID + Campaign Drafts link
- Backend: `sendProspectsToNemoClaw()` in `prospectIntelService.js` — builds nemoProspects payload from enriched Firestore data, POSTs to `https://pathsynch.com/api/v1/campaigns/generate` with `X-Service-Key` header, updates all prospect docs in 499-doc batches
- Route: `POST /prospect-intel/send-to-nemoclaw` — auth + ownership + max 100 + 502 on NemoClaw error
- `_serializeProspect()`: added `nemoClawSentAt` + `nemoClawBatchId` fields

**New env var:** `NEMOCLAW_SERVICE_KEY` in `functions/.env`

### Status after this session

| Milestone | Status |
|-----------|--------|
| M1-1: Frontend scaffolding | ✅ Complete |
| M1-2: Enrichment pipeline + Fit Score | ✅ Complete |
| M1-3: Table UI, filters, actions, recent lists | ✅ Complete |
| M1-3 bug sweep: 11 fixes | ✅ Complete (this session) |
| M2-1: NemoClaw send (SynchIntro side) | ✅ Complete (this session) |
| M2-1: NemoClaw PathManager backend | External (PathManager team) |
| M1-4 backlog: Generate Pitch from row | Pending |
| M1-4 backlog: ICP profile CRUD UI | Pending |

---

## Session — April 26, 2026

**Opportunity Brief feature: full implementation and deployment complete.**

### What shipped

New 7th smart card on Create Pitch: "Generate Opportunity Brief" — a standalone multi-section business case report pipeline, separate from `pitchGenerator.js`.

**Card ID:** `opportunity_brief` (NOT `card7` — that ID is already taken by `enterpriseCards` for the tech stack research card). Always use `opportunity_brief` as both the card ID and `cardType` parameter.

**Credit cost:** 145 (vs 85 for standard analysis cards). Deducted in `opportunityBriefService.js`, not via `pitchGenerator.js`.

**New backend files:**
- `functions/services/opportunityBriefService.js` — dual-model Gemini pipeline; `gemini-2.5-flash` (thinkingBudget:0 + responseMimeType:'application/json' + responseSchema) for structured data sections; `gemini-3-flash-preview` (thinking enabled, no thinkingBudget:0, indexOf extraction) for narrative prose. Intel collection from marketReports → salesDocuments → fallback benchmarks. 6 vertical industry configs. Share token generation. Analytics tracking.
- `functions/routes/opportunityBriefRoutes.js` — 5 route handlers. Public route registered BEFORE /:briefId to prevent param collision.

**Modified backend files:**
- `functions/routes/index.js` — added opportunityBriefRoutes + 5 AVAILABLE_ENDPOINTS entries
- `functions/index.js` — `path.startsWith('/opportunity-brief')` dispatch block after `/prospect-intel`

**Firestore:**
- New collection: `opportunityBriefs/{briefId}` — fields: userId, businessName, industry, location, sections{}, brandColors{}, shareToken, shared, createdAt, updatedAt, analytics{}
- Rules: owner-scoped create/update/delete, isAuthenticated() for read

**New frontend files:**
- `synchintro-app/js/pages/opportunityBriefViewer.js` — full-screen modal, brand-color CSS custom props, IntersectionObserver section analytics (revenue_impact_viewed, competitor_section_viewed, section_viewed), html2pdf.js PDF export, share link to `/p/brief/{shareToken}`, Calendly CTA tracking. Exposed as `window.OpportunityBriefViewer`.
- `synchintro-app/p/brief/index.html` — public shareable page. Extracts shareToken from pathname. Fires report_viewed + return_visit_detected (localStorage `ob_rv_{shareToken}`). Brand-colored simplified renderer.

**Modified frontend files:**
- `synchintro-app/js/pages/create.js` — 7th card in `sampleCards` array; `submitSmartMode()` intercepts `opportunity_brief` BEFORE Phase 5C outline check; `_executeOpportunityBrief()` method calls API + opens viewer
- `synchintro-app/js/api.js` — 4 new methods: generateOpportunityBrief, getOpportunityBrief, refreshOpportunityBrief, trackBriefEvent
- `synchintro-app/index.html` — `<script src="js/pages/opportunityBriefViewer.js?v=1.0.0">` before app.js

### Deployment status
- Functions deployed: commit `0960228` — `firebase deploy --only functions --project pathsynch-pitch-creation`
- Hosting deployed: commit `f5e6f6f` — `firebase deploy --only hosting --project pathsynch-pitch-creation`
- Firestore rules deployed: `firebase deploy --only firestore:rules --project pathsynch-pitch-creation`

---

## Session — April 27, 2026

**Opportunity Brief v2 polish — 5 fixes deployed.**

### What shipped

**Fix 1 — Missing competitor bars:**
- `opportunityBriefService.js`: added `fetchCompetitorsFromGooglePlaces()` — Places Text Search API fallback when `verifiedCompetitors` is empty. Returns name, score, reviews, velocity label, haversine distance, category, isYou flag. Wired in `collectIntelData()` after report + library query.
- `opportunityBriefViewer.js`: competitor bars now use `ob-bar-label-col` (200px) + `ob-bar-sublabel` (distance · category on second line) + `ob-bar-meta-col` (score + review count stacked).
- `p/brief/index.html`: same bar layout on public page.

**Fix 2 — Cover page:**
- `opportunityBriefViewer.js` + public page: new `ob-cover` / `pub-cover` section at top of report body (before Executive Summary). Content: SYNCHINTRO brand label (accent color), "Opportunity Brief" eyebrow, "A Personalized Growth Case for [Name]" title, description text, footer with "Prepared for" block + Report Date + Report ID (format: `OB-YYYYMMDD-INITIALS`).
- Added `_formatReportId(brief)` helper.
- Cover has `page-break-after: always` for PDF.

**Fix 3 — Brand color extraction:**
- Added `INDUSTRY_BRAND_PALETTES` (6 verticals: restaurant, home_services, healthcare, auto_repair, professional_services, dental + default dark navy).
- Added `extractBrandColorsFromWebsite(websiteUrl, industryVertical)` — fetches homepage HTML (5s timeout, 60KB cap), regex extracts hex colors, `gemini-2.5-flash` classifies into primary/secondary/accent/light/dark. Falls back to industry palette on any failure.
- Resolution order in `collectIntelData()`: `params.brandColors` → website extraction → `INDUSTRY_BRAND_PALETTES[vertical]` → default.

**Fix 4 — Evidence table clipping:**
- Evidence `.ob-card` / `.pub-card`: `page-break-inside: avoid` + `padding-bottom: 32px` + `overflow: visible`.

**Fix 5 — Empty last page:**
- `ob-body` bottom padding reduced from `80px` to `32px`.
- Added `ob-report-footer` / `pub-report-footer` inside the PDF-captured body: "Generated by SynchIntro" (left) + "Confidential — Prepared exclusively for [Name]" (right). Small gray text, provides visual closure on last page.
- PDF export `pagebreak` mode updated to `['avoid-all', 'css', 'legacy']`.

### Files modified
- `functions/services/opportunityBriefService.js` (backend) — commit `83be0bb`
- `synchintro-app/js/pages/opportunityBriefViewer.js` → v1.1.0 (frontend) — commit `83fa98f`
- `synchintro-app/p/brief/index.html` (frontend) — commit `83fa98f`
- `synchintro-app/index.html` — script tag bumped to `v=1.1.0`

### Auth note
Firebase auth expired during deploy. Re-auth required: `firebase login --reauth`
| M1-4 backlog: Prospect history + versioning | Pending |

---

## Session — April 28, 2026

**NFC Card Smart Destination — PathManager backend + frontend.**

This session was PathManager work only (not SynchIntro Firebase). Documented here for cross-product awareness.

### What shipped

- Replaced deprecated Bitly with QRsynch (`qrsyn.ch`) for all NFC card tracking links
- GBP OAuth callback in PathManager now auto-populates Google review link as default NFC card destination (fire-and-forget, never blocks OAuth)
- New endpoint: `GET /api/v1/cards/:merchantId/gbp-status` — returns GBP connection state, placeId, Google review URL
- Frontend: NFC Cards table shows `qrsyn.ch` links with copy button, business names instead of MongoDB ObjectIds; new Destination column
- Edit modal: Destination Type selector, read-only short link with copy button
- Add modal: defaults to Google Review if GBP connected

### PRs

- Backend: `PathSynch-CEO/PathManager_backend` — branch `feature/nfc-card-smart-destination`
- Frontend: `PathSynch-CEO/PathManager_frontend` — branch `feature/nfc-card-smart-destination`

### Status

| Item | Status |
|------|--------|
| NFC Card model schema update | ✅ Complete |
| QRsynch integration (backend) | ✅ Complete |
| GBP OAuth auto-populate hook | ✅ Complete |
| gbp-status endpoint | ✅ Complete |
| Frontend table + modals | ✅ Complete |
| PRs pushed | ✅ Ready for Charles to review |

---

## Session — May 13, 2026

**10-phase platform audit. Audit score: 79/100 (B+). All actionable findings fixed and deployed.**

### What shipped

**Backend (pathsynch-pitch-generator) — committed `964815b`, pushed to main:**

| File | Change |
|------|--------|
| `functions/middleware/planGate.js` | Fixed stale `userData.tier` — full Stripe-aware priority chain |
| `functions/index.js` | Global error handlers + X-Admin-Key auth on admin endpoints |
| `functions/routes/teamRoutes.js` | Wired `sendTeamInviteEmail()` (was empty TODO since April 28) |
| `functions/services/agentLogger.js` | Deleted (zero imports — dead code) |
| `README.md` | Redacted hardcoded `sk_live_xxx` key |
| `.github/workflows/ci.yml` | Added deploy job with `needs: [test]` |
| `.github/workflows/deploy.yml` | Deleted (was bypassing CI gate) |
| `SYNCHINTRO_AUDIT_REPORT_2026-05-13.md` | Created full audit report |

**Frontend (synchintro-app) — committed `97d4681`, pushed to main:**

| File | Change |
|------|--------|
| `firestore.rules` | Added `userActivityLog` rules (P0 fix) + 5 missing collections |
| `firestore.indexes.json` | Added `userActivityLog` composite index |
| `js/auth.js` | Sentry guard fix (typeof check before calling setUser) |

### Carry-forward constraints

- `subscription.plan` MUST come before `userData.tier` in ALL plan extraction chains across both repos. Root cause: Stripe writes to `subscription.plan` but `users/{uid}` is created with `tier:'FREE'` and never updated. Violation = paying users treated as free.
- CI deploy gate: `needs:` only works within the same workflow file. Keep deploy job inside `ci.yml`.
- `X-Admin-Key` required for `backfillConfidenceFields` + `calibrateMerchant` admin endpoints.

### Pending

- Frontend `fix/opportunity-brief-v2-polish` branch has stashed uncommitted changes (git stash pop to restore)
- SendGrid `SENDGRID_API_KEY` not set — team invite emails wired but silently failing

---

## Session — May 13, 2026 (Industry Taxonomy Sprints 1–3)

**Deployed to production. 3-sprint industry taxonomy system — canonical JSON, per-industry scoring/report profiles, integration metadata pass-through.**

### Sprint 1 — Industry Taxonomy Config + UI

**Backend:**
- `functions/config/industryTaxonomy.json` — canonical taxonomy, 22 industries
- `functions/config/industryTaxonomy.js` — backend wrapper with `findIndustry()`, `normalizeTaxonomyKey()`, `buildSearchQueries()`
- `scripts/sync-taxonomy.cjs` — sync script (`.cjs` for ESM-root repo)
- `functions/services/verticalQuestions.js` — Professional Services 5→14, 6 new templates

**Frontend:**
- `config/industryTaxonomy.json` — synced copy at hosting root
- `js/config/industryTaxonomy.js` — `window.IndustryTaxonomy` IIFE
- `index.html` — script tag before market.js
- `js/pages/market.js` — dropdown from taxonomy, `updateSearchPreview()`, PostHog events

### Sprint 2 — Market Intel Intelligence Upgrade

**Backend (pathsynch-pitch-generator):**
- `functions/config/scoringProfiles.js` — 4 profiles, `getScoringProfile()`, `resolveWeights()`
- `functions/config/reportProfiles.js` — 4 profiles, `getReportProfile()`, prompt injection
- `functions/api/market.js` — surgical: profile weight selection, Gemini prompt append, query templates, 10 taxonomy fields on report docs, backward compat `resolveTaxonomyForReport()`

### Sprint 3 — Integration Metadata Pass-Through

**Backend (pathsynch-pitch-generator):**
- `functions/services/enrichmentWaterfall.js` — TODO stubs for Apollo, PDL, Clay, HubSpot
- `functions/utils/entity360Service.js` — `taxonomyMetadata` on sync payload
- `functions/services/attioClient.js` — 11 taxonomy fields + analytics event
- `functions/services/instantlyClient.js` — 7 `custom_*` vars (Market Intel only) + analytics event
- `functions/services/prospectIntelService.js` — `taxonomyCampaignContext` on NemoClaw handoff
- `functions/services/opportunityBriefService.js` — `BRIEF_TITLES` map, profile prompt injection, analytics event

**Frontend (synchintro-app):**
- `js/pages/opportunityBriefViewer.js` + `p/brief/index.html` — read `brief.title || 'Opportunity Brief'`

### Carry-Forward Constraints

- **NEVER edit** `synchintro-app/config/industryTaxonomy.json` directly — always edit `functions/config/industryTaxonomy.json` then run `node scripts/sync-taxonomy.cjs`
- **22 industries** (not 23) — the spec said 23 but existing codebase already had Professional Services, making the new count 22
- `normalizeTaxonomyKey()` is the canonical matching function — use it for all taxonomy lookups
- `resolveTaxonomyForReport()` must be called for any old report read before using taxonomy fields
- Government + Nonprofit: never use "competitors", "Review Velocity", or "Promotional Offers"
- Two Instantly integrations remain SEPARATE — Market Intel (`instantlyClient.js`) vs per-user Instantly in Settings

### Commits

| Repo | Commit | Sprint |
|------|--------|--------|
| pathsynch-pitch-generator | `56bedd5` | Sprint 1 |
| synchintro-app | `bcd64d7` | Sprint 1 |
| pathsynch-pitch-generator | `a5f8edb` | Sprint 2 |
| pathsynch-pitch-generator | `942125e` | Sprint 3 |
| synchintro-app | `57e8f0a` | Sprint 3 |

---

## Hotfix — May 13, 2026

**Three production bugs fixed after Taxonomy Sprints 1–3.**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| P0: Agencies report returned restaurants as competitors | `fetchCompetitors` used NAICS fallback keyword `'restaurant'` — `primaryTaxonomyQuery` was never passed in | `taxonomyQuery` param added to `fetchCompetitors`; overrides NAICS keyword |
| P1: Sub-industry labels wrong in dropdown | `industryTaxonomy.json` had stale Sprint 1 labels | Labels corrected in canonical JSON, re-synced to frontend |
| P1: Crime score missing from reports | `safetyContextService.js` existed but was never called in `market.js` | Non-blocking call added before Firestore save; requires `ENABLE_CRIME_DATA_ENRICHMENT=true` in `.env` |

**Commits:** backend `2ea3848`, frontend `1f55399`

---

## Hotfix 2 — May 13, 2026

**Three issues fixed after Taxonomy Sprints 1–3 + Hotfix 1.**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| P1: Review Velocity suppressed in B2B reports | `"Review Velocity"` in `b2b_services.avoidSections` → Gemini hard-suppressed the section | Removed from `avoidSections`; moved to `promptInjection` as de-emphasis language |
| P1: Product Recommendations table showed "undefined" | `renderProductRecommendations()` used `p.name`/`p.price` — backend uses varied field names | Multi-field fallback chain + null guard in `js/pages/market.js` |
| P2: No logging when crime data flag is off | Silent when `ENABLE_CRIME_DATA_ENRICHMENT` not set | Added `console.log` in `safetyContextService.js` |

**New file: `functions/utils/numericSafety.js`** — `safeNumber`, `safePercent`, `normalizeReviewCount` utilities to prevent NaN in scoring math.

**Key rule:** `avoidSections` = hard Gemini suppression. Use only for truly inapplicable sections. For "less important" sections use `promptInjection` language instead.

**Known non-issues:**
- Enhanced Overview Score / Growth Factors: `opportunityScoreEngine.js` exists but is not wired into `market.js` — future sprint
- Competitive Activity / Aggregated Velocity: intentional "v2 coming soon" placeholders in Intent Signals tab

---

## Sprint — May 13, 2026 (Strategic Depth Upgrade)

**Additive-only. No existing sections, prompts, or data fields modified.**

**Backend commit `427b8a9` | Frontend commit `a17b90a`**

### New report sections

| Section | Source | Storage field |
|---------|--------|--------------|
| Strategic Market Thesis | Gemini structured JSON | `strategicMarketThesis` `{ title, thesis, gapLabel }` |
| Strategic Roadmap | Gemini structured JSON | `strategicRoadmap` `[ { phase, name, timeframe, focus, actions[], milestone, pathsynchProduct } ]` |
| KPI Scorecard | Deterministic + Gemini interpretation | `kpiScorecard` `[ { kpi, currentValue, benchmark, status, target, whyItMatters } ]` |

### Implementation pattern

Single non-blocking Gemini enhancement call (`gemini-3-flash-preview`, `thinkingBudget:0`, `indexOf('{')`) after all existing data is assembled. Returns one JSON object with `strategicMarketThesis`, `strategicRoadmap`, `kpiInterpretations`. KPI current values are computed deterministically from `marketBenchmarks` / `seoLandscape` / `qualifiedLeads` — Gemini only provides `target` + `whyItMatters`.

### Frontend upgrades

- Competitive Archetypes: table → visual cards with color-coded threat/opportunity pills
- Positioning Matrix: `gapLabel` pill overlaid on Opportunity Zone SVG (fallback: "Opportunity Zone")
- All 3 new sections added to PDF export
- ~230 lines of CSS added with dark mode + responsive breakpoints

### Key rules introduced

- `gapLabel` is always an explicit field — never extract from thesis text
- `avoidSections` = hard Gemini suppression (use sparingly). `promptInjection` = guidance/de-emphasis
- KPI scorecard renders even if Gemini interpretation fails — deterministic values always present
- All new sections conditional: absent fields = no render, old reports unaffected

---

## Sprint A/B — May 13–14, 2026 (Report Quality + Pitch Context Bridge)

**Backend Part A `baa7769` | Backend Part B `6c586fa` | Frontend Part B `cba830e`**

### Part A — 7 Report Quality Fixes
- Voice % back-filled onto competitor objects after SOV computation
- `buildTieredResponse()` now includes thesis/kpiScorecard/roadmap/productRecommendations in baseResponse
- `deriveGapLabelFromProfile()` — profile-aware gapLabel fallbacks
- KPI scorecard deterministic fallback computed BEFORE enhancement try block
- `deriveRoadmapFromHighImpactMoves()` — roadmap fallback from existing high-impact moves
- `filterRelevantNews()` — relevance scoring against industry + subIndustry + city
- `DEFAULT_PATHSYNCH_PRODUCTS` fallback catalog for all industries

### Part B — Pitch Context Bridge
**New services:** `marketIntelPitchContext.js` (context builder, 0 credits) + `pitchCompanionMd.js` (deterministic Markdown, no Gemini)
**New endpoints:** `/market-intel/pitch-context-preview` + `/market-intel/pitch-companion-md`
**Pitch generator:** Non-blocking context fetch → prompt injection → source metadata on pitch doc
**Frontend:** "Generate Pitch" + "📄 Pitch Companion" buttons on lead cards; `marketIntelRef` sessionStorage; Market Intel badge on Create Pitch

**Critical:** `report.data.benchmarks` is correct path — NOT `report.marketBenchmarks`. Use `getBenchmarks(report)` resolver.

---

## Hotfix — May 14, 2026 (10-Issue Cleanup)

**Backend `3fd125c` | Frontend `e2cf36d`**

### New: `functions/utils/reportFieldResolver.js`
Resolvers for inconsistent field paths across `report.data`, `report.reportData`, `report`. Use `getBenchmarks()`, `getStrategicMarketThesis()`, etc. — never access these paths directly.

| Fix | What |
|-----|------|
| Thesis not rendering (P0) | Fallback `thesis: ''` silently blocked render; `buildFallbackThesis()` generates real text |
| gapLabel on Matrix | Updated to use `_mktGetStrategicMarketThesis()` resolver |
| NAICS 722511 for Agencies | `naicsCode`/`naicsLabel` added to all 22 industries in taxonomy JSON; backend reads from `industryConfig` |
| Growth Factors NaN | `_mktSafeNum()` guards; section hidden if all values zero |
| Growth Signals noise | `filterGrowthSignals()` with noise term list applied before Firestore write |
| Create Pitch industry | `industry` added to `marketIntelRef`; create.js auto-selects `#prospect-industry` |
| KPI targets empty | Numeric target examples added to enhancement prompt |
| Contact name prefill | `contactName`/`contactTitle` added to `prefillPitchData` from lead fields |

---

## Sprint — May 14, 2026 (Tier 1 Public Data Enrichment)

**Backend `2a030f6` | Frontend `e000273`**

Additive only. Feature-flagged. Non-blocking. Standard verticals unaffected.

### New service: `functions/services/publicDataEnrichmentService.js`

| Provider | Vertical | Feature Flag | Free? |
|----------|---------|-------------|-------|
| USAspending.gov | Government | `ENABLE_USASPENDING_ENRICHMENT` | Yes, no auth |
| ProPublica Nonprofit Explorer | Nonprofit | `ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT` | Yes, no auth |
| IRS EO BMF (Firestore cache) | Nonprofit | `ENABLE_IRS_BMF_ENRICHMENT` | Yes — requires seed script |

All flags default `false`. Enable one at a time. IRS BMF requires `seed-irs-bmf.js` to run first.

### New Firestore report fields

| Field | Vertical | Key data |
|-------|---------|---------|
| `publicSectorIntelligence` | government_public_sector | `{ federalFunding: { totalAwardsAmount, awardCount, grantsAmount, contractsAmount, topAwardingAgencies[], recentAwards[] }, pitchImplication, confidence }` |
| `nonprofitFinancialIntelligence` | nonprofit_association | `{ leadMatches[{ ein, revenue, expenses, netAssets, nteeCode, matchConfidence, pitchImplication }], marketSummary }` |

### New Firestore collections
- `publicDataEnrichmentCache` — 72h TTL, Cloud Functions write only
- `irsBmfCache` — seeded by `scripts/seed-irs-bmf.js`

### Pitch Context Bridge additions
- Government: `context.publicSectorIntelligence` (total awards, agencies, pitch implication)
- Nonprofit: `context.nonprofitFinancialIntelligence` (revenue band, NTEE, pitch implication — never exact amounts)

### Sensitivity rules (permanent)
1. NEVER extract/store/display `pct_compnsatncurrofcr` (executive comp) from ProPublica
2. Revenue bands in all pitch copy — `"$5M–$10M"` not `"$7,234,567"`
3. Source attribution required on all enrichment sections
4. Confidence: `high`=dual source, `medium`=ProPublica, `low`=BMF only

### Confirmed API field names
- ProPublica filings: `totrevenue`, `totfuncexpns`, `totassetsend`, `tax_prd_yr`, `pdf_url`; `filings_with_data` is TOP LEVEL
- USAspending: Title Case keys — `Award Amount`, `Recipient Name`, `Awarding Agency`

---

## Hotfix — May 14, 2026 (4-Issue Hotfix)

**Backend commit `5d1307a` | Frontend commit `d96bc5b`**

### Fix 1 (P0) — NAICS code shows 722511 for Agencies

**`functions/api/market.js`** — `industry` object in report document:

```javascript
naicsCode: industryConfig?.naicsCode || naicsCode,
naicsTitle: industryConfig?.naicsLabel || industryDetails?.title || displayIndustryName,
```

Root cause: `naicsCode` variable used the old NAICS lookup which fell back to `722511` (restaurant). Taxonomy value (`541810` for Agencies) was stored separately as `taxonomyNaicsCode` but never used as the primary `naicsCode`. Now taxonomy takes priority; old NAICS lookup is the fallback only.

### Fix 4 (P2) — KPI Scorecard target values missing

**`functions/api/market.js`** — `computeKpiScorecard()` now adds deterministic `target` fields:

| KPI | Deterministic target |
|-----|---------------------|
| Average Rating | `topQuartileAvg★` or `4.5★` |
| Share of Voice | `15%` |
| Avg Review Count | `1.5 × avgReviews reviews` or `30 reviews` |
| SEO / Digital Authority | `80/100` |
| Total Competitors | `null` (info only) |
| Qualified Leads Found | `5+ per market` |

`mergeKpiScorecard()` updated: Gemini target only overrides when non-empty and not `'See roadmap'`. Deterministic targets are the permanent fallback.

### Fix 2 (P1) — gapLabel missing from PDF Positioning Matrix

**`synchintro-app/js/pages/market.js`** — `renderPositioningMatrixPDF()`:
- Now reads `gapLabel` from `_mktGetStrategicMarketThesis(this.currentReport)`
- Renders amber pill badge (matching live app)
- Removes hardcoded `'Opportunity Zone'` text

### Notes

- Fix 2 live app and Fix 3 (Archetypes → visual cards) were already done in the 10-Issue Hotfix (`e2cf36d`)
- All 4 originally listed issues are now resolved

---

## Crime/Safety Section — End-to-End Trace & Fix — May 14, 2026

**Backend commit `febd1e3` · Frontend commit `bc94841`**

### Diagnostic Summary

| Step | Result | Detail |
|------|--------|--------|
| env var | PASS | `ENABLE_CRIME_DATA_ENRICHMENT=true` |
| `safetyContextService.js` | PASS | `functions/utils/safetyContextService.js` — 2-provider (Zyla + FBI CDE) |
| `market.js` call | PASS | Called at line 1654, result → `reportData.safetyContext` |
| `buildTieredResponse` | **FAIL (root cause)** | `safetyContext` omitted from `baseResponse` |
| Firestore write | PASS | `safetyContext` written with `reportData` |
| `reportFieldResolver` | PASS | `getSafetyContextData()` exists |
| Frontend render | PASS | `renderSafetyContext()` at market.js:2118, Overview tab |
| PDF export | **FAIL** | `downloadReport()` had no safety section |
| External API keys | PARTIAL | Both keys set; Zyla Labs validity unconfirmed |

### Root Cause

`buildTieredResponse()` in `functions/api/market.js` did not include `safetyContext` in `baseResponse`. The service ran, the data was written to Firestore, the frontend render function existed — but the API response never carried the field. Fresh generation set `this.currentReport = result` (API response) which had no `safetyContext`, so `renderSafetyContext` always returned `''`.

Viewing an existing report (loaded from Firestore via `getMarketReport`) would return `safetyContext` correctly IF the API keys were functional at generation time.

### What Was Fixed

1. **`functions/api/market.js`** — `safetyContext: reportData.safetyContext || null` added to `baseResponse` in `buildTieredResponse()`
2. **`functions/services/marketIntelPitchContext.js`** — block 10a: neutral `safetyProfile` string derived and stored as `context.safetyContext`
3. **`functions/services/pitchCompanionMd.js`** — "Community Safety Profile" section added (neutral language, no raw crime rates)
4. **`synchintro-app/js/pages/market.js`** — `downloadReport()` PDF section added after KPI Scorecard

### Current Status

Feature is fully wired end-to-end. If Zyla Labs API key is active, safety data will appear on all fresh reports. Old reports without `safetyContext` render cleanly (section hidden). PDF includes the section when data is present, with required data-use disclaimer.

Zyla Labs API validity needs to be confirmed by checking console logs during a fresh report generation.

---

## Gemini Payload + Safety ZIP Hotfix — May 14, 2026

**Backend commit `c9dcdff`** | Frontend: no changes

### Bug A (P0) — Gemini 400 Bad Request
`generateContent([{ role, parts }])` array form treats input as `Part[]` not `Content[]` in SDK v0.24.1 → `role` lands at `contents[0].parts[0]`. Fixed both call sites (enhancement + AI questions) to `generateContent({ contents: [{ role, parts }] })` object form. **Permanent rule: always use object form.**

### Bug B (P1) — Safety service no ZIP
`req.body.zipCode` is empty when user inputs city+state. Added ZIP regex extraction from competitor/lead addresses (`/\b(\d{5})(?:-\d{4})?\b/`) before safety service call. Log: `[MarketIntel] Safety ZIP resolved: XXXXX`.

### Gemini Payload Format Rule (carry forward)
```javascript
// CORRECT — always use this:
model.generateContent({ contents: [{ role: 'user', parts: [{ text: '...' }] }] })
// WRONG — never pass array directly:
model.generateContent([{ role: 'user', parts: [{ text: '...' }] }])
```

---

## IRS BMF Seed Script — May 14, 2026

**Script:** `functions/scripts/seed-irs-bmf.js`

Seeds IRS BMF CSV exports to Firestore `irsBmfCache`. CLI: `node scripts/seed-irs-bmf.js --state GA --file data/eo_bmf_ga.csv`. Requires `GOOGLE_APPLICATION_CREDENTIALS`. Skips rows missing EIN or NAME. Batch size 490. Uses `csv-parse` (already in package.json). Doc ID: `{name_underscored}_{state}`.

---

## Nashville Dental Bug Fixes — May 14, 2026

**Commits: `9bfe3e8` (keyword priority + ZIP state filter) + prior (NAICS + taxonomy)**

### 3 Bugs Fixed

**Bug 1 — NAICS shows parent 621 instead of 621210:**
- Added `naicsCode: "621210"`, `naicsLabel: "Offices of Dentists"` to `dental_practice` in `functions/config/industryTaxonomy.json`
- Updated priority chain in `market.js`: `subIndustryConfig?.naicsCode` now comes before `industryConfig?.naicsCode`
- Sync frontend: `node scripts/sync-taxonomy.cjs` after taxonomy changes

**Bug 2 — Only 1 qualified lead in 20-competitor dental market:**
- Root cause: `dental` mapped to `health_beauty` (ceiling 250); Nashville dental practices have 300–600+ reviews → filtered out
- Root cause 2: `"wellness"` (8 chars) sorted before `"dental"` (6 chars) in `detectVertical()` length-sorted KEYWORD_MAP
- Fix: New `dental_medical` vertical (ceiling 500) in `verticalConfigs.js`; dental keywords remapped; long multi-word entries added (`"dental practice"` = 15 chars) to win sort priority

**Bug 3 — Safety ZIP resolver grabs wrong-state ZIP:**
- Root cause: ZIP extracted from any competitor address, regardless of state
- Fix: State validation added — only accept ZIP from address if it contains `, STATE` or ` STATE ` pattern

### Carry-Forward Rules

1. **Sub-industry NAICS always takes precedence** — `subIndustryConfig?.naicsCode || industryConfig?.naicsCode` (never reverse this order)
2. **Vertical keyword priority** — multi-word keywords sort before single-word in `detectVertical()`; when adding new vertical keywords, ensure they're longer than any competing keyword that could fire on the same search string
3. **Safety ZIP resolver validates state** — ZIP must be from an address containing the target state abbreviation

---

## Visibility Enrichment Layer — May 14, 2026

4 non-blocking phases added to Market Intel report generation. Same pattern as `publicDataEnrichmentService.js`.

### New Backend Files

`functions/services/visibilityEnrichmentService.js` (orchestrator), `providers/mapPackProvider.js` (Phase 1A — DataForSEO Maps SERP), `providers/adSpendProvider.js` (Phase 1B — DataForSEO Organic SERP), `providers/websiteSignalsProvider.js` (Phase 2 — PageSpeed Insights), `providers/aiVisibilityProvider.js` (Phase 3 — Gemini + Perplexity), `providers/visibilityCache.js`, `providers/visibilityQueryBuilder.js`, `providers/visibilityMatcher.js`.

Test scripts: `scripts/test-dataforseo-maps.cjs`, `test-dataforseo-organic.cjs`, `test-pagespeed.cjs`, `test-ai-visibility.cjs`.

### Modified Backend Files

- `market.js` — `enrichVisibility()` call after public data enrichment; 4 new fields in `buildTieredResponse()`
- `reportFieldResolver.js` — 4 new resolvers (`getMapPackIntelligence`, `getAdSpendIntelligence`, `getWebsiteConversionSignals`, `getAiVisibilityIntelligence`)
- `marketIntelPitchContext.js` — 4 new context blocks via resolver helpers
- `pitchCompanionMd.js` — 4 conditional Markdown sections

### Frontend (`synchintro-app/js/pages/market.js`)

4 resolver helpers (`_mktGetMapPackIntelligence`, `_mktGetAdSpendIntelligence`, `_mktGetWebsiteConversionSignals`, `_mktGetAiVisibilityIntelligence`), new "Visibility" tab, `renderVisibilitySnapshot()` on Overview tab, phase-specific render methods, PDF export section, 60+ `.vis-*` CSS lines.

### Env Vars (add to `functions/.env`)

`ENABLE_MAP_PACK_ENRICHMENT`, `ENABLE_AD_SPEND_ENRICHMENT`, `ENABLE_WEBSITE_SIGNALS_ENRICHMENT`, `ENABLE_AI_VISIBILITY_ENRICHMENT`, `GOOGLE_PSI_API_KEY`

### Carry-Forward Rules

1. Always use resolver helpers — never access `report.mapPackIntelligence` directly
2. AI visibility field is `mentionRate` — never `aiVisibilityScore`; verdicts are `frequently_mentioned` / `sometimes_mentioned` / `not_mentioned_in_sample`; confidence always `"directional"`
3. Mandatory UI/PDF disclaimer on AI visibility: *"Results are directional only — AI responses vary by model, time, and query."*
4. Map Pack and Ad Spend are separate SERP surfaces with separate feature flags — never merge
5. Run test scripts to verify API field names before modifying providers

Note: Bugs A (Gemini payload) and B (safety ZIP) were already fixed in commit `c9dcdff` — confirmed still in place.

---

## Session — May 15, 2026 (Audit Workflow + Repo Hygiene + Decomposition Sprint)

### Audit Workflow Fixes

**`pathsynch-pitch-generator/.github/workflows/weekday-health-audit.yml`**

Two bugs fixed in the same file:

1. **Gate was decorative** — "Stop if not scheduled audit window" used `exit 0` which only exits that step, not the job. All 8 heavy steps always ran. Fix: deleted the stop step; added `if: steps.gate.outputs.run_audit == 'true'` to all 8 heavy steps.

2. **`has_npm_script()` path resolution** — `require('${dir}/package.json')` resolves relative to Node's process cwd (CI workspace root), not the shell's pwd. Fix: `JSON.parse(require('fs').readFileSync('${dir}/package.json', 'utf8'))`.

Commit: `4a31853`

### Repo Hygiene

- 18 dated `CHANGELOG_2026-*.md` files moved from repo root → `changelogs/` directory. Commit: `19ce781`
- Root `SYSTEM_BIBLE.md` → single-line pointer to `functions/SYSTEM_BIBLE.md`. Commit: `768d586`
- `synchintro-app/package-lock.json` added to git (removed from `.gitignore`). Commit: `af5496c`

### Security — npm Dependencies

**`pathsynch-pitch-generator` root:** 6 vulnerabilities resolved via `npm audit fix`:
- `dompurify` (high — XSS), `flatted` (high — prototype pollution), `picomatch` (high — ReDoS), `postcss` (high — path traversal), `vite` (high — path traversal/file read), `brace-expansion` (ReDoS)
- `html2pdf.js` (high — XSS) still open — `0.14.0` is semver-major, needs PDF export regression test before upgrade

Commit: `5dae584`

**`synchintro-app`:** 16 known vulnerabilities now visible after lockfile tracked. No fixes applied yet.

### index.js Decomposition Sprint

**New doc: `docs/INDEX_JS_DECOMPOSITION_PLAN.md`** (commit `1432604`)
- Full inventory: 20 route groups, line ranges, extracted file, clean-cut assessment
- 12 groups are clean-cut (safe to extract now), 3 partial, 2 blocked
- Shared helpers blocking pitch group: `checkAndUpdateUsage`, `incrementUsage`, `trackPitchView`, `extractTriggerEventContent` — suggest `services/pitchMetrics.js`

**Dead-code deletion: commit `24f4292` — 648 lines removed (4,786 → 4,138)**

| Block | Why Dead |
|-------|---------|
| Stale user routes (`GET /user`, `PUT /user/settings`) | `userRoutes.handle()` at line 598 intercepts first |
| Stale analytics handlers (`POST /analytics/track`, `GET /analytics/pitch/:id`) | `analyticsRoutes.handle()` at line 626 intercepts first |
| Team Schema A — 8 handlers using `teamMembers`/`teamInvites` | `teamRoutes.handle()` at line 601 intercepts; also wrong schema (Schema A vs live Schema B) |

`node --check` passes. Replacement modules confirmed mounted.

### Outstanding P0 Items

- `INSTANTLY_ENCRYPTION_KEY` missing from `functions/.env` on EC2 — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `NODE_ENV=production` missing from `functions/.env` on EC2 — CORS bypass without it
- `html2pdf.js` upgrade to `0.14.0` — test PDF export first

### Outstanding P1–P2 Items

- Tighten `pitchAnalytics` Firestore rules (over-permissive: any auth'd user can read)
- Tighten `icpProfiles` rules (any auth'd user can overwrite defaults)
- Wire `SENDGRID_API_KEY` so team invite emails actually send
- Extract 12 clean-cut route groups per decomposition plan
- Move shared pitch helpers to `services/pitchMetrics.js` to unblock pitch group extraction

---

## Session Update — May 18, 2026

### Shipped

**1. No-GBP Detection & LocalSynch Upsell**
Tri-state `gbpStatus: 'found' | 'not_found' | 'unknown'` model flows through all L2 one-pager pipeline stages. `'not_found'` = DataForSEO ran and returned nothing → amber banner + GBP-acquisition outcome cards. `'unknown'` = source not run → silent strip, never banner. `buildDefaultAnalysis()` now returns honest nulls instead of fabricated review data. `templateSectionResolver` skips complaint/love sections when no review evidence. Gemini prompts guarded with `CRITICAL — NO REVIEW DATA AVAILABLE`. `renderNoGBPBanner()` in templateOnePager.js renders LocalSynch Local Growth ($199/mo + $299 setup) and Local Authority ($329/mo + $599 setup) upsell. Frontend `_noGBPBanner()` in l2OnePagerRenderer.js; `.op-no-gbp-*` CSS added to app.css with dark mode. Commits: d63cb1f (backend) / 86dbe96 (frontend) / b432f35 (frontend) / 853c4a2 (CSS).

**2. No-GBP Outcome Cards Override**
Step 3c in templateOnePager.js overrides `projectedOutcomes` BEFORE `resolveAllSections()` when `gbpStatus === 'not_found'`. Four outcome cards: GBP CLAIMED & OPTIMIZED, 4.8+ RATING TARGET, 100% REVIEW RESPONSE RATE, 18+ NEW REVIEWS IN 90 DAYS. Commit: 0861e39.

**3. Test Suite — 574 passing, 0 failing**
Was 561 passed, 19 failed. Fixes: teamRoutes.test.js rewritten for Schema B, firebase-admin mock extended, validation.js pitchLevel .default(1), geminiLeadEnricher.test.js wrapped in Jest test(). Commit: 0861e39.

**4. Debug Log Cleanup**
[L2 STAT DEBUG] removed from templateSectionResolver.js. [TemplateOnePager DEBUG] statCards block removed from templateOnePager.js. Commit: 0861e39.

**5. Security**
synchintro-app: protobufjs critical (CVSS 9.8) + 15 other vulnerabilities resolved via `npm audit fix` → 0 vulnerabilities. Commit: 853c4a2. functions/.env: NODE_ENV=production confirmed (CORS hardening), INSTANTLY_ENCRYPTION_KEY confirmed present.

**6. Market Intel Fixes**
- Crime/Safety: geocoding fallback added to market.js — city+state → Google Geocoding API → postal_code extraction (uses GOOGLE_PLACES_API_KEY). Commit: f610035.
- Component C (velocity): opportunityScorer.js now scans all recentReviews for best valid date, skips null/NaN, falls back to daysSinceLastReview. Commit: f610035.
- Component E (signal bonus): 13 industry keyword entries added to getIndustryKeywords(). SIGNAL_STOPWORDS set (40+ words). matchSignalToLead() requires ≥1 meaningful word OR ≥2 total word overlap; industry match → bonus:3. Commit: f610035.

### Personnel Change
Williams (`dev1@pathsynch.com`) replaces Fayzan as solutions architect. Williams reviews `pathsynch-pitch-generator` PRs.

### Open Issues (Assigned to Williams)
- DataForSEO 404 on reviews endpoint — all review enrichment blocked
- Census API key invalid (`missing_key.html` response)
- Missing Firestore composite index: `marketReports` `location.city + userId + createdAt`
- Safety geocoding fallback needs log verification

---

## Session Update — May 19, 2026

### Shipped

**1. Growth Snapshot — Backend + Frontend Live**
`growth_snapshot` L2 style renderer deployed via PR #14 merge. Frontend card (`id: growth_snapshot`, 145 credits, `l2Style: 'growth_snapshot'`) was already committed (de9b08e) — hosting deploy pushed it live today.

**2. Date Extraction Fix — "New" Badge Removed from Pattern**
`dateLabelPattern` in `templateOnePager.js` Step 3f was matching Google's "New" UI badge as a date timestamp. Diagnostic confirmed: 1258 lines in pasted text, 203 matched labels vs ~90 expected. Fix: removed `|New` from regex. Review velocity targets and CTA copy now reflect accurate 90-day counts.

**3. executiveBriefRenderer.js Parity Fixes**
Smith's Olde Bar confirmed routing through `l2Style: 'executive_brief'` → `executiveBriefRenderer.js`, which bypasses `renderStatCards`/`renderOnePagerHtml`. Two fixes ported:
- `renderStatStrip()`: Response rate "%" suffix (bare digits + RESPONSE RATE label guard)
- `renderSolution()`: Methodology footnote below product pills (styled for teal background)

**4. Diagnostic Log Cleanup**
3 temporary diagnostic `console.log` lines removed (2× DIAGNOSTIC, 1× RENDERER) before deploy.

### Architecture Rule Added
`executiveBriefRenderer.js` is a parallel render path to `renderOnePagerHtml`. Any fix to stat card display or solution section annotations in `templateOnePager.js` must be evaluated for porting. See SYSTEM_BIBLE.md — "executiveBriefRenderer.js Parity Rules."

### Modified Files (deploy-only, no new commits)
- `functions/api/pitch/templateOnePager.js`
- `functions/services/executiveBriefRenderer.js`

---

## May 19, 2026 — Citation Source Intelligence (Phases 1 + 2)

### What Was Built

Full citation URL extraction and classification layer on the AI Visibility enrichment pipeline. Surfaces which websites AI assistants cite most often for a given market/vertical, and where the lead has citation gaps.

### Carry-Forward Rules

- `citationIntelligence` is **nested inside** `aiVisibilityIntelligence` — NOT a top-level field. Always access via `getCitationIntelligence(report)` resolver.
- `report.aiVisibilityIntelligence` is top-level on the Firestore document (NOT under `report.data`) — same as `mapPackIntelligence`, `adSpendIntelligence`, `websiteConversionSignals`.
- Gap analysis only surfaces UGC, Reference, and Editorial domains. Do not surface Institutional/Corporate/Other as gaps.
- `_checkMentionsLead()` skips names shorter than 4 characters — prevents false positive common-word matches.
- Gemini citation extraction uses multi-path defensive check (`groundingMetadata` or `grounding_metadata`, `groundingChunks` or `grounding_chunks`). Always wrap in try/catch.
- Perplexity citations: check `data.citations` first, then `data.choices[0].message.citations`. Items may be strings or `{url, title}` objects.
- `DEBUG_CITATIONS` env var = logging only. Never gates functionality.

### Key Files

| File | Change |
|------|--------|
| `functions/services/providers/aiVisibilityProvider.js` | Full rewrite — citation extraction, classification, gap analysis |
| `functions/utils/reportFieldResolver.js` | `getCitationIntelligence()` resolver added |
| `functions/services/marketIntelPitchContext.js` | Block 11: `context.citationInsight` |
| `functions/services/pitchCompanionMd.js` | "AI Citation Sources" Markdown section |
| `synchintro-app/js/pages/market.js` | `renderCitationIntelligenceSection()` + CSS + PDF |

---

## May 19, 2026 — Visibility All 4 Phases + Operational Notes

All 4 visibility enrichment phases confirmed active:
- Phase 1A (Map Pack, 30s) / 1B (Ad Spend, 30s) / 2 (Website Signals, 35s) / 3 (AI Visibility, 25s)
- Perplexity API key env var: `PERPLEXITY_API_KEY` — key named `PathSynch_AI_Visibility`
- DataForSEO creds (`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`) shared by Phase 1A + 1B
- ~33 Serper credits per Market Intel report — monitor balance

### Full Carry-Forward Rules (12)

1. "Detected" language — never claim absolutes about ad presence
2. Domain classifier is deterministic — extend lists in `aiVisibilityProvider.js`, no AI calls
3. `citationIntelligence` nested INSIDE `aiVisibilityIntelligence` — use `getCitationIntelligence(report)` resolver
4. `report.aiVisibilityIntelligence` top-level on Firestore (NOT under `report.data`)
5. Gap analysis: UGC/Reference/Editorial only — Corporate/Institutional/Other excluded
6. Short names (<4 chars) skipped in `_checkMentionsLead()`
7. `DEBUG_CITATIONS` = logging only, never a feature gate
8. Perplexity key name: `PathSynch_AI_Visibility`
9. DataForSEO creds shared by Phase 1A + 1B (separate flags, same credentials)
10. Citation Rate column: hide if all values null
11. Gemini grounding: multi-path defensive check + always try/catch
12. Perplexity citations: `data.citations` first, then `data.choices[0].message.citations`

### Peec AI — Competitive Context

SynchIntro now matches Peec AI's citation intelligence. Remaining Peec advantage: daily persistence tracking. **Next priority:** daily AI visibility cron → PathManager merchant dashboard card.

Brian Hampton (King Digital Services / kingseoservice.com) — switched from Peec to SynchIntro. His Peec account showed Brilliant Smiles (Grovetown GA) at 16.7% ChatGPT visibility, 0% Perplexity, only 1 of 25 prompts configured. Benchmark for what a well-configured SynchIntro account should beat.

### Roadmap (Not Built)

| Item | Notes |
|------|-------|
| Daily AI visibility tracking cron | Next priority — enables trend lines + PathManager card |
| Multi-model split (Gemini vs Perplexity) | Half-day build |
| Trend lines | Depends on daily cron |
| Claude via AWS Bedrock | Third AI model, free AWS credits |
| PathManager merchant AI Visibility card | Show merchants citation standing |
| Custom prompt library | Agency tier, Q3/Q4 |

---

## AIsynch Phase 1A — Complete (May 20-21, 2026)

### What Was Built

Full Phase 1A of AIsynch — AI Readiness scoring and merchant intelligence product. Runs as standalone Cloud Functions separate from the SynchIntro pitch pipeline.

**Components shipped:**

| Component | File(s) | Lines | Tests |
|-----------|---------|-------|-------|
| AI Readiness Scoring Engine | `functions/services/aiReadinessScorer.js` | 1,087 | 68 |
| Free Scan Endpoint | `functions/api/aiReadinessScan.js` | 438 | 34 |
| Stripe Billing | `functions/services/aisynchBilling.js` | 335 | 27 |
| Cloud Function API Bridge | `functions/api/aisynchDashboard.js` | 402 | 8 |
| PathManager EC2 Proxy | `PathManager_backend/src/v1_0/api/aisynch/index.js` | 197 | — |
| React Dashboard Components (7) | `PathManager_frontend/src/components/AIsynch/` | 455 | — |

**Test suite:** 574 → 790 passing, 0 failing.

**Production validation:** KEM Health scored 43/100 in live end-to-end test.

**Cloud Function URLs:**
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aiReadinessScan`
- `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/aisynchDashboard`

**Phase 0 prerequisites shipped first:**
- Exported `aiVisibilityProvider` internal functions
- Citation grounding domain bug fix
- Gemini model override support in `generateStructured()`
- Capped `citationRatePct` at 100
- Added 9 Firestore composite indexes

### AIsynch Build Status (as of May 21, 2026)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Pre-work (aiVisibilityProvider exports, indexes) | ✅ Done | |
| Phase 1A — Scoring engine + free scan + billing + Cloud Function bridge | ✅ Done | 790 tests |
| Phase 1B-1 — Persistent monitoring cron (`aiVisibilityMonitor.js`) | ✅ Done | 872 tests |
| Phase 1B-2 — Trend chart + heatmap + citations + report modal | ✅ Done | PR open for Williams review |
| Phase 2 — Mount components in PathManager dashboard routing | ⏳ Next | Components built, not yet wired into routing |
| Free scan widget for pathsynch.com | ⏳ Blocked | Remove dev bypass first |

### What's Next

**Phase 2 — PathManager Dashboard Card Integration**
- Mount `AIsynchCard.jsx` in the PathManager merchant dashboard layout
- Gated by merchant AIsynch tier (`aisynchSubscriptions/{merchantId}`)
- All 11 React components are built and in `src/components/AIsynch/`

**P0 Blockers Before Production**
- Add `PATHMANAGER_JWT_SECRET` to PathManager backend EC2 `.env` — blocks all dashboard endpoints
- Remove dev Turnstile bypass: delete `turnstileToken === 'test'` condition and `AISYNCH_ALLOW_TEST_TOKEN` check from `aiReadinessScan.js`

**Free Scan Widget for pathsynch.com**
- `aiReadinessScan` Cloud Function is ready — blocked on P0 bypass removal above
- Widget needs Cloudflare Turnstile, sends `businessName` + `businessAddress` + `turnstileToken`

**Seed Test Data for Trend Chart**
- `AIsynchTrendChart` renders empty state until `aiVisibilitySnapshots` docs exist for a merchant
- Fastest path: set `ENABLE_AISYNCH_MONITORING=true` and let the 3 AM cron run 5 days, OR create Firestore docs directly

### Carry-Forward Rules for AIsynch Work

1. **`AISYNCH_PRICE_IDs` read at call time** — never at module load. Required for Jest to override via env vars.
2. **Billing flow is `subscriptionItems.create`** — NOT `checkout.sessions.create`. AIsynch attaches to existing PathManager Stripe subscription.
3. **`bundledFree: true`** in `LOCALSYNCH_BUNDLE_MAP` = no Stripe item. Do not charge separately when merchant is on `local_growth` or `local_authority`.
4. **JWT auth**: PathManager EC2 signs the token with `PATHMANAGER_JWT_SECRET`; `aisynchDashboard` Cloud Function verifies. Secret must be present in BOTH environments.
5. **`PATHMANAGER_JWT_SECRET` is PENDING on EC2** — add to PathManager backend `.env` before dashboard endpoints can be used in production.
6. **Dev bypass must be removed** before production free scan launch: delete `turnstileToken === 'test'` condition and `AISYNCH_ALLOW_TEST_TOKEN` env var check from `aiReadinessScan.js`.
7. **Global scan cap** (`aisynchRateLimits/global`) uses Firestore atomic transaction — never increment with a plain `set` or `update`.
8. **Scoring engine is data-driven** — input is the enriched market report / enrichment result. The 6 pillar scores are computed from existing SynchIntro enrichment data, not new API calls.
9. **`aisynchSubscriptions/{merchantId}`** is the single source of truth for a merchant's AIsynch tier. Billing service writes here; dashboard reads from here.
10. **Monitoring cron calls providers directly** — `queryGeminiGrounded()` + `queryPerplexity()` in parallel. Does NOT call `enrichAiVisibility()`. These are different invocation patterns.
11. **Chart.js cleanup** — always call `chartInstance.current.destroy()` in the `useEffect` cleanup function. Skipping this causes "Canvas is already in use" errors on re-render.
12. **`AIsynchDetailView` tier gating** — uses `TIER_RANK = { lite:0, starter:1, growth:2, scale:3 }` numeric comparison, not string equality. Always use this pattern.

---

## Session — May 26, 2026 (Market Intel v4 — S0-S6)

**Sprint: market-intel-v4-sales-enablement. All 7 stories deployed to production on `feat/market-intel-v4` branch.**

### What Shipped

**S0 — Credibility Guardrails & Report QA Sanitizer**
New `functions/utils/reportSanitizer.js` with 8 independent checks (each own try/catch). Wired in `functions/api/market.js` before `buildTieredResponse`. Checks: unknown market leader, empty competitors, SEO zeroes, ads contradiction, stale timing strings, N/A KPI rows, market avg reviews, market avg rating. Log format: `[Sanitizer] Fixed: {description}`.

**S1 — Market Definition & Query Transparency**
New `functions/utils/marketDefinitionBuilder.js` — 35+ sub-industry lookup table + 19 industry fallbacks. `buildMarketDefinition()` produces confidence badge (high/medium/low), definition sentence, query pills, included/excluded business types. Supplements `taxonomyQueries` to ensure 4-8 queries per report. Frontend: `renderMarketDefinition()` card above KPI Scorecard in Overview tab + PDF export.

**S2 — PathSynch Product Wedge per Lead**
`computeProductWedge(lead, benchmarks)` function in `market.js` — 7-condition priority chain produces product name + pitch text. Every condition guards `!= null`. Attached to every `serperLead.productWedge`; never competitors or referenceCompetitors. Frontend: product wedge column in leads table + `renderProductFitTable()` in AI Sales Intel tab.

**S3 — Qualified Lead / Competitor / Reference Player Separation**
New `generateReferenceCompetitors()` export in `narrativeGenerator.js` — gemini-2.5-flash, returns 3-5 institutional/national players with `isReferencePlayer: true`. Sequential call before `Promise.allSettled`. Dedup by 6-char normalized prefix. Frontend: `renderReferenceCompetitors()` with indigo accent + disclaimer banner. Qualified Leads tab relabeled "Qualified Leads (Sales Prospects)".

**S4 — Competitive Weakness Themes**
`generateWeaknessThemes()` in `market.js` computes aggregate stats across all leads+competitors, calls gemini-2.5-flash, returns 5-7 ranked `{rank, theme, whyItMatters}` items. Frontend: `renderWeaknessThemes()` red-accented card in Competitors tab + PDF table.

**S5 — Economic / Demographic Fit**
`generateDemographicBusinessMeaning()` in `market.js` — gemini-2.5-flash, returns 4-6 `{dataPoint, businessMeaning, salesUse}` items. Only runs when Census `cityDemographics` exists. Frontend: inline cyan-accented block after Census City Demographics card in Demographics tab + PDF table.

**S6 — Website Conversion Audit Pass 1 (Lighthouse Deep Extract)**
`buildLighthouseAudit()` in `websiteSignalsProvider.js` — extracts 13 Lighthouse signals from existing PSI response, no new API calls. Verdict: "Captures demand" / "Leaks demand" / "Not converting local intent". `auditPass()` returns null (not false) for missing audits. Frontend: `renderWebsiteSignalsSection()` rebuilt with 13-signal checklist table + verdict badge per lead + PDF per-lead audit table.

### New Files
- `functions/utils/reportSanitizer.js`
- `functions/utils/marketDefinitionBuilder.js`

### Modified Files
- `functions/api/market.js` — all 7 stories wired here
- `functions/services/narrativeGenerator.js` — S3 reference competitors
- `functions/services/providers/websiteSignalsProvider.js` — S6 Lighthouse audit
- `synchintro-app/js/pages/market.js` — all frontend renders S0-S6

### Key Rules Established
- Stripe must stay at v14.x — Firebase CLI deploy subprocess does NOT inherit shell env vars; v22+ throws at module init on undefined key
- Reference competitor call must be sequential before Promise.allSettled
- `auditPass()` null = not evaluated, excluded from verdict denominator
- `cityDemographics` has exactly 3 fields: population, medianIncome, medianHomeValue

---

## Session — May 24, 2026 (Credit Deduction Double-Spend Fix)

**Reviewed by Arthur Morrissette (Focal AI). Commit: `8f11d05` on main. Deployed to Firebase (pathsynch-pitch-creation).**

### What Shipped

Three new billing helpers added to `functions/api/billing.js` after `deductCredits`. `checkCredits` and `deductCredits` retained.

- **`checkAndDeductCredits(userId, required, reason, options)`** — atomic Firestore transaction, eliminates double-spend. FAILS CLOSED: returns `{ allowed: false, error: 'BILLING_TRANSACTION_FAILED' }` on transaction error. Routes return **503** (not 402) on this error.
- **`refundCredits(userId, amount, reason, options)`** — restores credits + writes positive ledger entry. Non-blocking.
- **`writeCreditLedger(userId, amount, reason, service)`** — shared ledger writer. Fire-and-forget.

### Billing Patterns

| Pattern | Service | Rule |
|---------|---------|------|
| Fixed-cost | Opportunity Brief | Atomic deduct in ROUTE before work; refund on failure |
| Variable-cost | Template Enrichment | Reserve max upfront; refund unused delta after work |
| Guard-before-work | Intent Signals | Atomic check+deduct BEFORE `fetchAndComputeSignals`; `creditBlocked` return |
| creditBlocked handling | `market.js` | `intentSignalsResult.creditBlocked` → null (omit from report) |

### Files Changed

- `functions/api/billing.js` — 3 new helpers + updated `module.exports`
- `functions/services/templateEnrichment.js` — reserve-max + partial-refund pattern
- `functions/routes/opportunityBriefRoutes.js` — atomic deduct + 503 path + failure refund (both endpoints)
- `functions/services/opportunityBriefService.js` — `deductCredits` removed (billing now in route)
- `functions/services/intentSignalService.js` — credit guard before work, `creditBlocked` return
- `functions/api/market.js` — `creditBlocked` null check after `generateIntentSignals`
- `functions/__mocks__/firebase-admin.js` — `_increment` handling in `MockDocumentReference.update()`
- `functions/tests/billing.test.js` — NEW: 10 billing tests

**Test count:** 882 passing, 0 failing.

### Infrastructure Note — QRsynch (Cross-Product)

QRsynch Pages backend confirmed live on GCP VM (`34.73.146.195`), NOT PathManager EC2. PathManager backend now proxies all QRsynch API calls server-side — API key never reaches the browser. See PathManager_backend CLAUDE.md for full infrastructure details.

### Gemini Model Note

`LEGACY` note in MEMORY.md regarding `thinkingBudget:0 + indexOf('{')` extraction for Gemini 3.x JSON: always use `generateStructured()` from `functions/services/structuredGeneration.js` for any new Gemini call that needs structured output. `indexOf('{')` pattern remains only in legacy code not yet migrated.

## May 24, 2026 — No SynchIntro changes. PathManager Forms Sprint 1 shipped (7 backend PRs #165-#171, 3 frontend PRs). AI form generation now injects merchant Knowledge Base from meta.knowledgeBox. Merchant lookup fixed (tenantId→getMerchantByIdRaw). No SynchIntro code was modified.

## June 1-2, 2026 — SynchIntro esc() fix deployed. 36 hardened esc() helpers in `js/pages/market.js` (commit `9ed05c5`). Prevents TypeError on Market Intel PDF download when data fields contain numbers/objects. Full HTML entity escaping added (&, <, >, ", '). PathManager session: billing CastError fixes (PRs #219-#221), Plans & Billing page v3, sidebar profile dropdown, content area widened to 1600px. Account corrections: David (56B8DE) pmgrowth, demo@ (96E9FE) pmenterprise, hello@ (D598E2) pmenterprise + SynchIntro enterprise. New architecture: one Stripe subscription per product line, per-product interval toggles, Figma color palette codified in SYSTEM_BIBLE.md Law 5. SynchIntro plan keys `si_starter`/`si_growth`/`si_scale`/`si_enterprise` declared. LocalSynch plan keys `ls_launch`/`ls_growth`/`ls_authority` declared.

## June 5, 2026 — PathManager Tier Gating Sprint (No SynchIntro Changes)

No SynchIntro code shipped today. All work was PathManager.

**Key architecture finalized (cross-platform):**

Plan tier normalization is now canonical across the platform. `normalizePlanTier()` (frontend) and `normalizePlan()` (backend) both follow Law 6 in `functions/SYSTEM_BIBLE.md`: input trim + lowercase, `_yearly` suffix stripping for `pm*` keys only, `pmadmin → agency`, fail-closed on unknown inputs. `meetsMinTier()` fail-closed on unknown `requiredTier` (typos deny, not grant).

**PathManager PRs shipped:** #176 (sidebar labels), #177 (auth headers), #178 (useMemo normalization), #179 (service-layer unwrapArray), #181–184 (planTierUtils canonical utility), #232–234 (backend normalizePlan parity).

**PathManager deploy pipeline documented:** GitHub Actions → `npm install --legacy-peer-deps` → clean build → zip → swap deploy dir → nginx reload. Nginx rewritten: index.html no-store, /assets/ immutable 1y, / SPA fallback no-cache.

**Outstanding items:** QRsynch SSL cert exp. June 10 (Williams), VertexAI migration June 24 (4 files), demo@ re-onboard, SynchIntro/LocalSynch cross-system plan detection deferred.

**Prompt engineering patterns refined (8 iterations today):** phased with investigation-first, preflight checklist, structured investigation tables forcing file+line+expression+crash-risk analysis before code, service-layer normalization over component scatter guards, fail-closed defaults, table-driven regression tests, Codex review follow-up loop until clean, deploy separated from code.
