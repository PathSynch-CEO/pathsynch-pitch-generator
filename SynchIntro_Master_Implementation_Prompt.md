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
