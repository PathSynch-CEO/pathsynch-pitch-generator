# PathSynch / SynchIntro — Changelog

---

## [2026-04-04] — Tier 2 Sprint 1 + L2 Style Suite + David Feedback Fixes

### Critical Bug Fixes (Health Check Audit)
- Fixed: pitchRoutes.handle() wired into dispatch chain — kanban status changes work (C8)
- Fixed: Visitor Intel plan gate — Scale users no longer downgraded to starter (H1)
- Fixed: Toast.show() → API.showToast() in visitors.js — 7 replacements (C3)
- Fixed: Session-expired redirect /login.html → / (C4)
- Fixed: l2OnePagerRenderer.js tracked in git (C1)
- Fixed: puppeteer-core migration — 300MB lighter deploys (C7)
- Fixed: Cost tracking model string gemini-3-flash → gemini-3-flash-preview (M8)
- Fixed: --radius-md CSS variable added to :root (H3)
- Fixed: DataForSEO review snippet teal border (H6)
- Fixed: Market report delete ownership check (H4)
- Fixed: gemini-2.5-flash-lite → gemini-2.5-flash in all fallbacks (H5)
- Fixed: Firestore rules added for websiteVisitors, ipCache collections (M9)
- Fixed: pitchAnalytics ownership check in Firestore rules (H7)
- Fixed: .env.tmp deleted (M1)
- Fixed: Stale Gemini model references in comments (M7)
- Fixed: npm audit — 9 low-severity vulns remain (firebase-admin chain)
- Fixed: Credit gate fallback — passes prospect data when credits insufficient
- Fixed: User credits reset (Charles Berry + David Hailey both had -5)

### Tier 2 Sprint 1 — Market Intelligence Enhancements
- NEW: Decision maker enrichment with buyer/check-writer lookup (Item 1)
  - Owner + buyer Serper queries in parallel per qualified lead
  - Buyer search fires for businesses with 50+ reviews
  - Multiple contacts support (up to 3 owners/partners)
  - Department fuzzy matching with DEPARTMENT_ALIASES mapping
- NEW: Competitor Analysis AI narrative (Item 2)
  - Gemini-generated strategic prose replaces auto-generated text
  - 20 competitors with seoTier data, two-paragraph format
  - Static fallback so section is never blank
- NEW: Review response rate calculation + display (Item 3)
  - Calculated from DataForSEO owner_answer field
  - Intel Signal: <20% critical, 20-50% moderate, >50% omit
  - Opportunity Score +5 bonus for <20% response rate
  - SEO Landscape table: new "Resp. Rate" column (red/amber/green)
- NEW: Review recency badge (Item 4)
  - daysSinceLastReview, velocityStatus computed per lead
  - Badges: none (<14d), amber Slowing (14-30d), amber Low (30-90d), red Dormant (>90d)
  - Intel Signal velocity alert at 90 days

### David Hailey Feedback Fixes
- Fixed: Generate Pitch from lead card data pass-through (contact, rating, reviews)
- Fixed: Pre-call brief timeout — 8s per-call wrapper, graceful degradation
- Fixed: Pre-call brief wiring from Market Intel lead cards
- Fixed: News dates visible in card titles with 90-day staleness indicator
- Fixed: Seller branding pulls from sellerProfile (logo, colors)
- Fixed: L3 "Quantify the Solution" JSON extraction — bracket counter + 4096 tokens
- Fixed: "Back to Report" navigation from Create Pitch and Pre-Call Brief
- NEW: Market Intel report auto-selects in Import Context when arriving from lead
- NEW: Website pass-through from leads to Create Pitch
- NEW: Auto-trigger Logo Fetch when website is present
- NEW: Market intelligence context injected into pitch generation prompt

### L2 One-Pager Style Suite
- NEW: Executive Brief renderer (executiveBriefRenderer.js)
  - Boardroom layout: teal header, alert box, headline, stat cards,
    complaint patterns, customer loves, solution block, pricing, urgency badge, CTA
- NEW: ROI Snapshot renderer (roiSnapshotRenderer.js)
  - Numbers-forward: current state, cost of inaction, 90-day projection,
    ROI calculation, payback period, solution + pricing
- NEW: Competitive Battlecard renderer (battlecardRenderer.js)
  - Positioning matrix scatter plot (Chart.js 4 + chartjs-plugin-annotation),
    head-to-head comparison table, wins/gaps with fix pills, SEO insight,
    3-step closing-the-gap action plan
- NEW: Visual Summary renderer (visualSummaryRenderer.js)
  - Zero-prose infographic: KPI icons, market gauge, strengths/gaps,
    horizontal bar chart, complaint donut, outcome cards
- IMPROVED: Standard renderer — teal header bar, focused solution block,
  smart rating target, urgency badge, closing CTA, footer
- All 5 styles wired via l2Style parameter in templateOnePager.js

### L3 Data Analyst Slide Deck
- NEW: dataAnalystDeckRenderer.js — 10-slide PPTX via PptxGenJS
  - Slides: title, reputation snapshot, positioning matrix (shape-based),
    head-to-head table, voice of customer, cost of inaction, competitive
    narrative, gap-to-solution map, investment + ROI, next steps
- NEW: renderDataAnalystHTML() — HTML preview for in-app pitch viewer
- Fixed: Data Analyst style no longer renders blank (was using empty roiData fields)
- Wired into export.js generatePPT and prepareCloudExport for PPTX download

### News & Signals
- NEW: News classified as local vs. industry-wide (serperClient.js classifyNewsScope())
- NEW: Two-section display: "Local Market News — [City]" and "Industry Trends"
- Backward compatible — existing reports default to industry

### Create Pitch UX
- NEW: Enterprise analysis cards (tech spend, MD&A, procurement mapping)
  - Only shown for enterprise/B2B industries
- NEW: Outline preview executive/detail toggle
- NEW: Landing Page modal — pitch viewer closes before modal opens
- Fixed: Landing Page Firestore index fallback for generation error

### Infrastructure
- IPINFO_TOKEN added to .env (Lite plan, IP-to-company resolution)
- Firestore rules updated: websiteVisitors, ipCache, pitchAnalytics, marketBenchmarks
- All Gemini model strings validated: gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash only

---

## [2026-03-30] — Market Intelligence Feature Complete

See CLAUDE.md Session — March 30, 2026 for full details.

- Attio CRM push (attioClient.js)
- Instantly market intel push (instantlyClient.js — separate from per-user integration)
- Report refresh endpoint (POST /market/refresh/:reportId)
- PathManager benchmark feed (marketBenchmarks collection)
- Demographics enrichment (Census ACS)
- Review sentiment extraction (sentimentExtractor.js)
- Decision maker enrichment (decisionMakerEnricher.js)
- GBP Completeness signals
- Market leader composite score (identifyMarketLeader())
- High-Impact Moves for all verticals
- Competitor archetypes in PDF export

---

## [2026-03-29] — Market Intelligence v2 + SEO Landscape

See CLAUDE.md Session — March 29, 2026 for full details.

- Opportunity Score v2 (5-component, inverted presence gap)
- Intel Signals replace Pitch Hooks
- 6 vertical configs (verticalConfigs.js)
- Dynamic pre-generation questions
- Positioning Matrix SVG scatter plot
- DataForSEO review + SERP ranking data
- Six Smart Mode card types
- PDF export moved to client-side html2pdf.js
- market.js refactored from 1200+ to ~860 lines

---

## [2026-03-28] — Sprint 3+4 Enrichment + Market Intel Enhancements

See CLAUDE.md Session — March 28, 2026 for full details.

- Parallel prospect enrichment pipeline (pitchEnricher.js)
- TheOrg API client (theOrgClient.js)
- Serper client expanded (4 new functions)
- Sales intel + recommendations (salesIntelGenerator.js)
- SEO Landscape (seoLandscape.js)
- SWOT generator (swotGenerator.js)
- Lead owner enrichment

---

## [2026-03-26] — Sprint 3+4 Prospect Enrichment

- Prospect Research Agent (agents/prospectResearchAgent.js)
- pitchEnricher.js parallel runner
- vertexSearch.js Discovery Engine client
- Enrichment wired into generatePitch()

---

## [2026-03-19] — L4 + Auth Fixes

- L4 one-pager generation fix (case 4 in switch)
- L4 system prompt differentiation in generateLibraryEnhancedContent()
- onUserCreated welcome email fixed (firebase-functions/v1 import)
