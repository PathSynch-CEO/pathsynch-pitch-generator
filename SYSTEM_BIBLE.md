# PathSynch / SynchIntro — System Bible

> **Version**: 1.4 | **Last Updated**: February 10, 2026
> **Platform**: Firebase (Hosting + Cloud Functions v2) | **Region**: us-central1
> **Firebase Project**: `pathsynch-pitch-creation`

---

## Changelog

### v1.4 — February 10, 2026
- **Trigger Event Feature**: Add news/social URLs to personalize pitch openings with timely hooks
  - New endpoint: `POST /extract-trigger-event` — AI extracts headline, summary, key points using Gemini
  - Supported sources: News articles, LinkedIn, Twitter/X, press releases, business journals
  - Integration in all pitch levels: Level 1 (email subject/opening), Level 2 (green card), Level 3 (dedicated slide)
  - Trigger data saved with pitch document for reference
- **Pitch Limit Enforcement**: Tier-based monthly pitch limits now enforced
  - Backend: `checkPitchLimit()` returns 403 `PITCH_LIMIT_REACHED` when exceeded
  - Frontend: Pre-submission check with upgrade modal
  - Usage tracking: `pitchesThisMonth`, `totalPitches`, `lastPitchAt` on user document
  - Limits: Free=5, Starter=25, Growth=100, Scale/Enterprise=Unlimited
- **Admin Pricing Editor**: Added `onepagerLimit` field to tier configuration
- **Discount Code Sync**: BESTFRD and new codes now sync to Stripe as coupon + promotion code

### v1.3 — February 10, 2026
- **Admin Console**: Added standalone admin dashboard (`admin.html`) with pricing management, Stripe sync
- **Pricing Alignment**: Updated all tiers - Starter $19, Growth $49, Scale $99, Enterprise $89
- **Team Members Limit**: Added `teamMembersLimit` field to all tiers (1, 3, 3, 5)
- **New Firestore Collections**: `platformConfig`, `discountCodes`, `codeRedemptions`, `admins`
- **New Backend Service**: `pricingService.js` with Stripe metadata sync
- **Marketing Site**: Moved to AWS Amplify (synchintro-website repo)

### v1.2 — February 7, 2026
- **SEC EDGAR Integration**: Public company financial data in market reports
- **USPTO Integration**: Patent data (pending API key PVS-5062)
- **Executive Summary**: AI-generated narrative for market reports
- **Tier-Gated Features**: Enterprise analytics, Growth+ batch pitches & notifications
- **Hosting Consolidation**: Single Firebase deployment for app.synchintro.ai
- **One-Pagers Fixes**: Firestore indexes, save error fixes

### v1.1 — February 5, 2026
- **Workspaces**: Organize pitches into workspaces (tier-based limits)
- **Smart Logo Fetch**: Backend logo discovery service
- **Font Selection**: 10 Google Fonts options in onboarding

### v1.0 — Initial Release
- Core pitch generation (Level 1/2/3)
- Narrative pipeline with formatters
- Market intelligence reports
- Stripe billing integration

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Backend Architecture](#2-backend-architecture)
3. [API Endpoint Reference](#3-api-endpoint-reference)
4. [Services Layer](#4-services-layer)
5. [Configuration Files](#5-configuration-files)
6. [Formatters & Prompts](#6-formatters--prompts)
7. [Middleware](#7-middleware)
8. [Pitch Levels](#8-pitch-levels)
9. [Market Reports](#9-market-reports)
10. [External API Integrations](#10-external-api-integrations)
11. [Firestore Collections](#11-firestore-collections)
12. [Firebase Storage](#12-firebase-storage)
13. [Security](#13-security)
14. [Environment Variables](#14-environment-variables)
15. [Billing & Plans](#15-billing--plans)
16. [Frontend — SynchIntro App](#16-frontend--synchintro-app)
17. [Frontend — Admin Console](#17-frontend--admin-console)
18. [Frontend — Legacy Pages](#18-frontend--legacy-pages)
19. [PathManager Integration](#19-pathmanager-integration)
20. [NAICS Industry Taxonomy](#20-naics-industry-taxonomy)
21. [Key Data Flows](#21-key-data-flows)
22. [Marketing Website](#22-marketing-website)

---

## 1. System Overview

### What Is PathSynch / SynchIntro?

PathSynch is an AI-powered sales pitch generation platform. It takes seller profile data and prospect information, then uses AI (Claude / Gemini) to generate personalized sales assets — pitches, one-pagers, email sequences, executive summaries, LinkedIn posts, decks, and proposals.

**SynchIntro** is the primary frontend SPA that sellers use to create pitches, view analytics, run market intelligence reports, and manage their account.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ SynchIntro   │  │ Legacy Pages │  │ PathManager (iframe)  │  │
│  │ (SPA)        │  │ (HTML)       │  │                       │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Firebase Hosting                              │
│                   (static files)                                │
└─────────────────────────┬───────────────────────────────────────┘
                          │ /api/** rewrite
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Functions v2 — exports.api                   │
│              512MB · 120s timeout · 10 max instances             │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Pitches  │ │Narratives│ │ Market   │ │ Stripe   │  ...      │
│  │ API      │ │ API      │ │ API      │ │ API      │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │             │            │             │                 │
│  ┌────┴─────────────┴────────────┴─────────────┴──────────┐     │
│  │                   Services Layer                        │     │
│  │  Claude · Gemini · Google Places · CoreSignal           │     │
│  │  Census · CBP · Google Trends · SendGrid · Stripe       │     │
│  └────────────────────────┬───────────────────────────────┘     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Firestore (26 collections)                  │
│                     Firebase Storage (logos, assets)             │
└─────────────────────────────────────────────────────────────────┘
```

### Three Codebases

| Codebase | Path | Purpose |
|---|---|---|
| `pathsynch-pitch-generator` | `C:\Users\tdh35\pathsynch-pitch-generator\` | Cloud Functions backend + legacy HTML frontend |
| `synchintro-app` | `C:\Users\tdh35\synchintro-app\` | Primary SPA frontend |
| `PathManager_frontend` | External (not local) | Partner CRM that embeds SynchIntro via iframe |

### Deployment

- **Hosting**: Firebase Hosting serves static files from `public/`
- **Functions**: Cloud Functions v2, region `us-central1`
- **API Rewrite**: `firebase.json` rewrites `/api/**` → `api` Cloud Function
- **Project ID**: `pathsynch-pitch-creation`
- **API Base URL**: `https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1`

---

## 2. Backend Architecture

**Entry point**: `functions/index.js`

### Cloud Function Export

```
exports.api — single HTTP Cloud Function
  Region: us-central1
  Memory: 512MB
  Timeout: 120 seconds
  Max instances: 10
```

### Request Pipeline

1. **CORS** — Allowed origins from `ALLOWED_ORIGINS` env var + defaults (`app.synchintro.ai`, Firebase hosting domains). Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS. Credentials enabled.
2. **Auth** — `verifyAuth(req)` extracts Bearer token, verifies Firebase ID token, attaches `userId`, `userEmail`, `user.plan`. Falls back to `anonymous` if no token.
3. **Rate Limiting** — `rateLimiter()` middleware, plan-based (anonymous/starter/growth/scale), per-user and per-IP tracking in Firestore.
4. **Path Normalization** — `normalizePath()` strips `/api/v1/`, `/v1/` prefixes for consistent route matching.
5. **Route Matching** — `if/else` chain (not Express Router) matching normalized path.
6. **Handler** — Dispatches to API module or inline handler.

### Key Utility Functions (index.js)

| Function | Purpose |
|---|---|
| `verifyAuth(req)` | Firebase ID token verification, attaches user to request |
| `ensureUserExists(userId, email)` | Creates user doc if missing, sends welcome email |
| `checkAndUpdateUsage(userId)` | Tracks monthly plan usage |
| `incrementUsage(userId, field)` | Increments pitch count / stats |
| `trackPitchView(pitchId, viewerId, context)` | Analytics event tracking |
| `normalizePath(path)` | Strips API version prefix |
| `getCurrentPeriod()` | Returns `YYYY-MM` format string |

### API Module Files

| File | Module | Endpoints Handled |
|---|---|---|
| `api/pitchGenerator.js` | Pitch generation | `POST /generate-pitch`, `GET /pitch/:id`, `GET /pitch/share/:shareId` |
| `api/narratives.js` | Narrative pipeline | `POST /narratives/generate`, `GET /narratives`, `GET /narratives/:id`, `POST /narratives/:id/regenerate`, `DELETE /narratives/:id` |
| `api/formatterApi.js` | Formatter system | `GET /formatters`, `POST /narratives/:id/format/:type`, `POST /narratives/:id/format-batch`, `GET /narratives/:id/assets`, `GET /assets/:assetId`, `DELETE /assets/:assetId` |
| `api/market.js` | Market intelligence | `POST /market/report` |
| `api/bulk.js` | Bulk upload | `GET /bulk/template`, `POST /bulk/upload` |
| `api/stripe.js` | Billing | `POST /stripe/checkout`, `POST /stripe/webhook` |
| `api/admin.js` | Admin dashboard | `GET /admin/stats`, `GET /admin/users` |
| `api/onboarding.js` | Onboarding | `POST /onboarding/analyze-website` |
| `api/feedback.js` | Feedback | `POST /feedback`, `GET /feedback/my` |
| `api/abTests.js` | A/B testing | `POST /admin/ab-tests`, `GET /admin/ab-tests` |
| `api/leads.js` | Lead capture | Mini report generation with lead data |
| `api/export.js` | PPT export | `POST /export/ppt/:pitchId` |
| `routes/userRoutes.js` | User management | `GET /user`, `PUT /user/settings` |
| `routes/teamRoutes.js` | Team management | `/team/*` routes |
| `routes/analyticsRoutes.js` | Analytics | `POST /analytics/track`, `GET /analytics/pitch/:pitchId` |
| `routes/pitchRoutes.js` | Pitch CRUD | `GET /pitches`, `PUT /pitch/:id`, `DELETE /pitch/:id` |

---

## 3. API Endpoint Reference

### Pitch Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/generate-pitch` | Optional | Any | Generate a pitch (Level 1/2/3) with ROI calculation |
| GET | `/pitch/:id` | Optional | Any | Retrieve pitch by ID (tracks view event) |
| GET | `/pitch/share/:shareId` | None | Any | Retrieve pitch by share link (anonymous view) |
| GET | `/pitches` | Required | Any | List user's pitches with filtering/pagination |
| PUT | `/pitch/:id` | Required | Any | Update pitch metadata (name, industry, shared) |
| DELETE | `/pitch/:id` | Required | Any | Delete pitch + cascading analytics delete |

### Narrative Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/narratives/generate` | Required | Any (usage-limited) | Generate AI narrative from business data |
| GET | `/narratives` | Required | Any | List all user narratives |
| GET | `/narratives/:id` | Required | Any | Retrieve specific narrative |
| POST | `/narratives/:id/regenerate` | Required | Any | Regenerate specific narrative sections |
| DELETE | `/narratives/:id` | Required | Any | Delete narrative |

### Formatter Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| GET | `/formatters` | Required | Any | List available formatters for user's plan |
| POST | `/narratives/:id/format/:type` | Required | Varies | Convert narrative to specific asset type |
| POST | `/narratives/:id/format-batch` | Required | Growth+ | Batch format to multiple types simultaneously |
| GET | `/narratives/:id/assets` | Required | Any | List formatted assets for a narrative |
| GET | `/assets/:assetId` | Required | Any | Get a single formatted asset |
| DELETE | `/assets/:assetId` | Required | Any | Delete a formatted asset |

### Market Intelligence Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/market/report` | Required | Growth+ | Generate market intelligence report |

### Bulk Upload Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| GET | `/bulk/template` | None | Any | Download CSV template |
| POST | `/bulk/upload` | Required | Growth+ | Upload CSV for batch pitch generation |

### Stripe/Billing Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/stripe/checkout` | Required | Any | Create Stripe checkout session |
| POST | `/stripe/webhook` | None | N/A | Stripe webhook handler (signature-verified) |

### Admin Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| GET | `/admin/stats` | Admin | N/A | Dashboard stats (users, pitches, MRR/ARR) |
| GET | `/admin/users` | Admin | N/A | List/search users with pagination |
| POST | `/admin/ab-tests` | Admin | N/A | Create A/B test |
| GET | `/admin/ab-tests` | Admin | N/A | List A/B tests |

### Onboarding Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/onboarding/analyze-website` | Required | Any | Auto-extract seller profile from website via Gemini |

### User/Team Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| GET | `/user` | Required | Any | Get user profile |
| PUT | `/user/settings` | Required | Any | Update user settings |
| GET | `/usage` | Required | Any | Get current period usage with limits |
| GET | `/templates` | Required | Any | List system + user templates |
| * | `/team/*` | Required | Any | Team management (create, invite, manage roles) |

### Analytics Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/analytics/track` | None | Any | Track event (view, cta_click, share, download, time_on_page) |
| GET | `/analytics/pitch/:pitchId` | Required | Any | Get analytics for a pitch |

### Feedback Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/feedback` | Optional | Any | Submit feedback (rating, category, comment) |
| GET | `/feedback/my` | Required | Any | Get user's feedback history |

### Export Endpoints

| Method | Path | Auth | Plan | Description |
|---|---|---|---|---|
| POST | `/export/ppt/:pitchId` | Required | Scale | Generate PowerPoint from Level 3 pitch |

---

## 4. Services Layer

### AI Services

| Service File | External API | Purpose |
|---|---|---|
| `services/claudeClient.js` | Anthropic Claude API | Core AI text generation. Retry with exponential backoff. Token usage tracking. Model: `claude-3-5-sonnet-20241022` (configurable). |
| `services/geminiClient.js` | Google Gemini API | Alternative AI provider. Website analysis. Model: `gemini-1.5-pro` (configurable). |
| `services/modelRouter.js` | — | Routes requests to Claude or Gemini based on config (`GEMINI_TRAFFIC_PERCENT`). Calculates token costs. Fallback chain: Gemini → Claude → Templates. |

### Narrative Services

| Service File | Purpose |
|---|---|
| `services/narrativeReasoner.js` | Generates business narratives using AI. Takes business inputs, seller context, and ROI data. |
| `services/narrativeValidator.js` | Validates generated narratives for completeness, accuracy, consistency. Auto-fixes issues. |

### Cache Services

| Service File | Firestore Collection | Purpose |
|---|---|---|
| `services/narrativeCache.js` | `narrativeCache` | Caches narratives to reduce AI API calls. Key generation, hit count tracking. |
| `services/marketCache.js` | `marketCache` | Caches market research data (Google Places results, Census data). |
| `services/promptCache.js` | — | Caches AI prompts and responses for performance. |

### Market Data Services

| Service File | External API | Purpose |
|---|---|---|
| `services/googlePlaces.js` | Google Places API | Search competitors by location/industry. Extract ratings, reviews, contact info. |
| `services/coresignal.js` | CoreSignal API | B2B company intelligence — hiring data, company size, revenue. |
| `services/census.js` | US Census Bureau API | Demographic data — age, education, income distributions, commute patterns. |
| `services/cbp.js` | Census Bureau CBP | Business establishment counts by location and NAICS code. |
| `services/geography.js` | — | Geographic/FIPS code lookups for Census queries. |
| `services/marketMetrics.js` | — | Opportunity scoring, establishment trends, market size estimation. |
| `services/googleTrends.js` | SerpAPI | Google Trends search volume and keyword analysis. |

### Other Services

| Service File | External API | Purpose |
|---|---|---|
| `services/email.js` | SendGrid API | Email delivery — welcome emails, bulk results, market reports. |
| `services/reviewAnalytics.js` | — | Review sentiment analysis and data extraction. |
| `services/feedbackService.js` | — | Feedback collection, rating aggregation, issue tracking. |
| `services/abTestingService.js` | — | A/B test creation, variant assignment, performance tracking. |
| `services/pricingService.js` | Stripe API | Dynamic pricing management with Stripe metadata sync. |
| `services/secEdgar.js` | SEC EDGAR API | Public company financial data (revenue, margins, employees). |
| `services/logoFetch.js` | Multiple | Multi-source logo discovery (Clearbit, scraping, favicons). |

### Pricing Service (`services/pricingService.js`)

Manages dynamic pricing stored in Firestore with optional Stripe synchronization.

**Exports:**
- `getPricing()` — Fetch current pricing from Firestore (with defaults fallback)
- `updatePricing(pricing, updatedBy)` — Update pricing in Firestore
- `updatePricingWithStripeSync(pricing, updatedBy)` — Update pricing and sync metadata to Stripe products
- `DEFAULT_PRICING` — Hardcoded default pricing structure

**Stripe Metadata Sync:**
When pricing is updated via Admin Console, metadata is synced to Stripe products:
```javascript
// Metadata added to each Stripe product
{
  pitchLimit: "25",      // or "unlimited"
  icpLimit: "1",
  workspacesLimit: "2",
  teamMembersLimit: "1",
  features: "Basic analytics, Link sharing, Email support"
}
```

### Utilities

| File | Purpose |
|---|---|
| `utils/roiCalculator.js` | ROI calculation for pitches — computes projected returns. |
| `templates/pptTemplate.js` | PowerPoint generation using PptxGenJS library. |

---

## 5. Configuration Files

### `config/stripe.js` — Plans & Billing

Defines plan tiers, limits, feature matrices, team roles. See [Section 15](#15-billing--plans) for full details.

### `config/claude.js` — Claude AI Configuration

| Setting | Value |
|---|---|
| Model | `claude-3-5-sonnet-20241022` (configurable via `CLAUDE_MODEL`) |
| Max Tokens | 2048 (configurable via `CLAUDE_MAX_TOKENS`) |
| Temperature | 0.7 (narrative), 0.3 (structured output) |
| Max Retries | 3 |
| Retry Delay | 1000ms |
| Fallback | Template-based narratives |

**Exports**: `CLAUDE_CONFIG`, `canGenerateNarrative(plan, count)`, `canRegenerate(plan, count)`, `canBatchFormat(plan, count)`, `isFormatterAvailable(type, plan)`, `getFormatterRequirements()`

### `config/gemini.js` — Gemini AI & Feature Flags

| Setting | Default |
|---|---|
| Model | `gemini-1.5-pro` (configurable) |
| Traffic Percent | `GEMINI_TRAFFIC_PERCENT` env var (0-100) |
| Daily Budget | `GEMINI_DAILY_BUDGET_USD` env var |

**Feature Flags** (all via env vars):
- `ENABLE_FEEDBACK` — Feedback collection
- `ENABLE_AB_TESTING` — A/B test system
- `ENABLE_GEMINI` — Gemini AI service
- `ENABLE_PROMPT_CACHING` — Prompt caching
- `ENABLE_STREAMING` — Streaming responses
- `FALLBACK_TO_CLAUDE` — Fallback if Gemini fails

### `config/rateLimits.js` — Rate Limiting

**Time Windows**: SECOND (1), MINUTE (60), HOUR (3600), DAY (86400)

| Plan | Global Limit | Generate Pitch | Notes |
|---|---|---|---|
| Anonymous | 20/hour | 3/hour | IP-based |
| Starter | 100/hour | Per plan | User-based |
| Growth | 500/hour | Per plan | User-based |
| Scale | 2000/hour | Per plan | User-based |

**IP Limits** (unauthenticated): 30/hour global, 10/minute burst.

### `config/coresignal.js` — CoreSignal API

API configuration and industry-specific query templates. Controlled by `ENABLE_CORESIGNAL` and `CORESIGNAL_API_KEY`.

### `config/naics.js` — NAICS Industry Taxonomy

Full NAICS code mapping with display categories, Google Places search terms, spending rates, growth rates, density benchmarks. See [Section 19](#19-naics-industry-taxonomy).

### `config/industryIntelligence.js` — Sales Intelligence

Per-industry/sub-industry intelligence data:
- **Decision maker titles** — who to target
- **Pain points** — key challenges
- **Primary KPIs** — what they measure
- **Top channels** — where they market
- **Prospecting data** — best/worst months, buyer mindset, approach tips
- **Calendar data** — buying cycles, contract renewals, key events, budget planning months, decision timelines

---

## 6. Formatters & Prompts

### 7 Formatters

| Formatter | Asset Type | Min Plan | Output |
|---|---|---|---|
| Sales Pitch | `sales_pitch` | Starter | Persuasive 3-4 paragraph sales pitch |
| One Pager | `one_pager` | Starter | Single-page executive summary |
| Email Sequence | `email_sequence` | Growth | 3-5 email campaign with subject lines |
| LinkedIn | `linkedin` | Growth | LinkedIn post/article content |
| Executive Summary | `executive_summary` | Growth | C-suite focused summary |
| Deck | `deck` | Scale | Presentation slide structure with content |
| Proposal | `proposal` | Scale | Formal business proposal document |

**Base Class**: `formatters/baseFormatter.js` — abstract class all formatters extend.

Methods: `getAssetType()`, `getPlanRequirement()`, `getSystemPrompt()`, `format(narrative, options)`, `toHtml()`, `toPlainText()`, `toMarkdown()`, `getMetadata()`, `countWords()`

**Registry**: `formatters/formatterRegistry.js` — manages formatter instances.

Exports: `getFormatter(type)`, `formatNarrative(type, narrative, options)`, `batchFormat(narrative, types, options)`, `validateFormatterAccess(plan, type)`, `getAllFormattersWithAvailability(plan)`

### Plan Access Matrix

| Formatter | Starter | Growth | Scale |
|---|---|---|---|
| sales_pitch | Yes | Yes | Yes |
| one_pager | Yes | Yes | Yes |
| email_sequence | — | Yes | Yes |
| linkedin | — | Yes | Yes |
| executive_summary | — | Yes | Yes |
| deck | — | — | Yes |
| proposal | — | — | Yes |
| Batch format | — | Up to 3 | Unlimited |

### 9 Prompt Templates

All exported from `services/prompts/index.js`:

| Prompt | File | Purpose |
|---|---|---|
| `NARRATIVE_REASONER_PROMPT` | `narrativeReasonerPrompt.js` | Generate structured business narrative from inputs |
| `NARRATIVE_VALIDATOR_PROMPT` | `narrativeValidatorPrompt.js` | Validate/fix narrative completeness and accuracy |
| `SALES_PITCH_PROMPT` | `salesPitchPrompt.js` | Format narrative into persuasive sales pitch |
| `ONE_PAGER_PROMPT` | `onePagerPrompt.js` | Format narrative into one-page summary |
| `EMAIL_SEQUENCE_PROMPT` | `emailSequencePrompt.js` | Format narrative into multi-email campaign |
| `LINKEDIN_PROMPT` | `linkedInPrompt.js` | Format narrative into LinkedIn content |
| `EXECUTIVE_SUMMARY_PROMPT` | `executiveSummaryPrompt.js` | Format narrative into exec summary |
| `DECK_PROMPT` | `deckPrompt.js` | Format narrative into slide deck outline |
| `PROPOSAL_PROMPT` | `proposalPrompt.js` | Format narrative into formal proposal |

---

## 7. Middleware

### `middleware/validation.js` — Request Validation

Uses **Joi** for schema validation. Exports `validate(schemaName)` middleware factory and `sanitizeString()` for XSS prevention.

**Schemas**: `generatePitch`, `generateNarrative`, `teamInvite`, `marketReport`, `savedSearch`, `analyticsTrack`, `userSettings`, `pitchUpdate`, `emailContent`, `stripeCheckout`, `teamCreate`, `acceptInvite`, `roleUpdate`, `formatNarrative`, `batchFormat`, `miniReport`

### `middleware/adminAuth.js` — Admin Access

Email-based whitelist from `ADMIN_EMAILS` env var (comma-separated). Requires Firebase Auth verified email.

Exports: `requireAdmin(req, res, next)`, `checkIsAdmin(userId)`, `isAdminEmail(email)`

### `middleware/planGate.js` — Plan Enforcement

Enforces subscription tiers and usage quotas.

**Plan hierarchy**: `starter < growth < scale < enterprise`

Exports: `getUserPlan(userId)`, `getUserUsage(userId)`, `requireFeature(featureName)`, `checkUsageLimit(usageType)`, `requirePlan(minimumPlan)`, `requireFormatter(formatterType)`, `checkNarrativeLimit()`

### `middleware/rateLimiter.js` — Rate Limiting

Window-based rate limiting stored in Firestore `rateLimits` collection. Per-user and per-IP tracking. Returns `X-RateLimit-*` headers.

Exports: `rateLimiter(options)`, `checkRateLimit(identifier, type, limit)`, `getRateLimitStatus(userId, plan)`, `cleanupRateLimits(maxAgeSeconds)`

### `middleware/errorHandler.js` — Error Handling

Custom `ApiError` class with standardized error codes and HTTP status mapping.

**Error Codes**:

| Code | HTTP Status |
|---|---|
| VALIDATION_ERROR | 400 |
| BAD_REQUEST | 400 |
| AUTHENTICATION_ERROR | 401 |
| AUTHORIZATION_ERROR | 403 |
| NOT_FOUND | 404 |
| CONFLICT | 409 |
| RATE_LIMIT | 429 |
| INTERNAL_ERROR | 500 |
| EXTERNAL_SERVICE_ERROR | 503 |

Exports: `ApiError`, `ErrorCodes`, `handleError(error, res, context)`, `asyncHandler(fn, context)`, `mapError(error)`, `createErrorResponse(error, includeDetails)`

---

## 8. Pitch Levels

### Level 1 — Outreach Email

- **Purpose**: Quick email-style pitch for cold outreach
- **Data sources**: Seller profile, prospect info (name, industry, rating, reviews)
- **Output**: HTML email with personalized messaging, ROI projections, CTA
- **AI**: Optional (can use templates)
- **Plan**: All plans

### Level 2 — One-Pager

- **Purpose**: Single-page branded pitch document
- **Data sources**: Level 1 data + review analytics, industry intelligence, product suite info
- **Output**: Branded HTML document with sections: problem, solution, ROI, product details, CTA
- **AI**: Used for narrative generation
- **Plan**: All plans

### Level 3 — Enterprise Deck

- **Purpose**: Full multi-slide presentation deck
- **Data sources**: Level 2 data + market data, competitive analysis, detailed ROI modeling
- **Output**: Multi-section HTML deck or PowerPoint (Scale plan). Sections: Discovery, Market Analysis, Solution Pillars, ROI, Implementation Timeline
- **AI**: Used heavily for narrative and formatting
- **Plan**: All plans (PPT export: Scale only)
- **PathSynch Products Referenced**: PathConnect, LocalSynch, Forms, QRSynch, SynchMate, PathManager

---

## 9. Market Reports

### Data Pipeline

```
User Input (city, state, zip, industry, radius, companySize)
    │
    ├──→ Google Places API → Competitor discovery (nearby businesses)
    ├──→ CoreSignal API → B2B company intelligence (hiring, size, revenue)
    ├──→ Census Bureau API → Demographics (age, education, income, commute)
    ├──→ Census CBP API → Business establishment counts by NAICS
    ├──→ Geography Service → FIPS codes, census tract lookup
    ├──→ SerpAPI → Google Trends search volume data
    ├──→ NAICS Config → Industry spending rates, growth rates, benchmarks
    └──→ Industry Intelligence → Pain points, KPIs, channels
            │
            ▼
    Market Report Document (stored in Firestore `marketReports`)
```

### Report Structure by Plan

| Section | Growth | Scale |
|---|---|---|
| Competitor discovery | Yes | Yes |
| Demographic analysis | Yes | Yes |
| Establishment trends | Yes | Yes |
| Opportunity scoring | Yes | Yes |
| Google Trends data | Yes | Yes |
| Saturation analysis | Yes | Yes |
| PDF export | — | Yes |
| Pitch integration | — | Yes |

### Monthly Limits

| Plan | Reports/Month |
|---|---|
| Starter | 0 (not available) |
| Growth | 5 |
| Scale | 20 |

### Opportunity Scoring

Combines multiple signals: competitor density, demographic fit (income sweet spot, education levels), establishment growth trends, market saturation, and Google Trends velocity into a composite opportunity score.

---

## 10. External API Integrations

| Service | API | Env Variable | Service File | Purpose |
|---|---|---|---|---|
| Anthropic Claude | Claude API | `ANTHROPIC_API_KEY` | `services/claudeClient.js` | AI narrative generation, formatting |
| Google Gemini | Gemini API | `GEMINI_API_KEY` | `services/geminiClient.js` | AI generation, website analysis |
| Google Places | Places API | `GOOGLE_PLACES_API_KEY` | `services/googlePlaces.js` | Competitor discovery by location |
| CoreSignal | CoreSignal API | `CORESIGNAL_API_KEY` | `services/coresignal.js` | B2B company intelligence data |
| US Census | Census API | `CENSUS_API_KEY` | `services/census.js` | Demographics, population data |
| Census CBP | CBP API | `CENSUS_API_KEY` | `services/cbp.js` | Business establishment counts |
| SerpAPI | SerpAPI | `SERPAPI_KEY` | `services/googleTrends.js` | Google Trends search data |
| SendGrid | SendGrid API | `SENDGRID_API_KEY` | `services/email.js` | Transactional email delivery |
| Stripe | Stripe API | `STRIPE_SECRET_KEY` | `api/stripe.js` | Payments, subscriptions, webhooks |

---

## 11. Firestore Collections

### User & Account

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **users** | `/users/{userId}` | `name, email, emailVerified, tier, pitchesCreated, pitchesThisMonth, onboardingCompleted, onboardingStep, sellerProfile{}, createdAt, updatedAt` | index.js, admin.js, stripe.js, planGate.js, teamRoutes.js, pitchRoutes.js, userRoutes.js | index.js (ensureUserExists), stripe.js (plan updates), userRoutes.js, auth.js (frontend) |
| **usage** | `/usage/{userId}_{YYYY-MM}` | `userId, period, pitchCount, narrativeCount, marketReportCount, bulkUploadCount, lastUpdated` | admin.js, planGate.js, userRoutes.js, pitchRoutes.js | index.js (incrementUsage), market.js, narratives.js, bulk.js |
| **subscriptions** | `/subscriptions/{userId}` | `stripeCustomerId, stripeSubscriptionId, plan, status, currentPeriodEnd, cancelAtPeriodEnd` | admin.js, stripe.js | stripe.js (webhook handler) |

### Content

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **pitches** | `/pitches/{pitchId}` | `userId, businessName, contactName, industry, subIndustry, level, htmlContent, shareId, shared, statedProblem, createdAt, updatedAt` | pitchGenerator.js, pitchRoutes.js, admin.js, export.js, bulk.js | pitchGenerator.js, pitchRoutes.js, bulk.js |
| **narratives** | `/narratives/{narrativeId}` | `userId, businessData, sellerContext, narrative{}, validation{}, model, tokenUsage, cost, createdAt` | narratives.js, formatterApi.js | narratives.js |
| **formattedAssets** | `/formattedAssets/{assetId}` | `userId, narrativeId, assetType, content, html, plainText, metadata, createdAt` | formatterApi.js | formatterApi.js |
| **templates** | `/templates/{templateId}` | `name, description, type, content, isSystem, userId, createdAt` | userRoutes.js, index.js | Admin console |

### Analytics & Tracking

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **pitchAnalytics** | `/pitchAnalytics/{pitchId}` | `views, shares, ctaClicks, downloads, avgTimeOnPage, lastViewedAt` | analyticsRoutes.js, pitchRoutes.js, export.js | index.js (trackPitchView), analyticsRoutes.js |
| **pitchAnalytics/events** | `/pitchAnalytics/{pitchId}/events/{eventId}` | `type, viewerId, context, timestamp` | analyticsRoutes.js | index.js, analyticsRoutes.js |
| **pitchOutcomes** | `/pitchOutcomes/{pitchId}` | `outcome, notes, updatedAt` | pitchOutcomeRoutes.js | pitchOutcomeRoutes.js |

### Market Intelligence

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **marketReports** | `/marketReports/{reportId}` | `userId, city, state, zipCode, industry, subIndustry, radius, competitors[], demographics{}, establishments{}, trends{}, opportunityScore, createdAt` | market.js, admin.js | market.js |
| **marketCache** | `/marketCache/{cacheKey}` | `dataType, data, cachedAt, expiresAt, hitCount` | marketCache.js | marketCache.js |
| **customSubIndustries** | `/customSubIndustries/{id}` | `userId, industry, subIndustry, naicsCode` | market.js | market.js |

### Teams

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **teams** | `/teams/{teamId}` | `name, ownerId, createdAt, settings{}` | teamRoutes.js | teamRoutes.js |
| **teamMembers** | `/teamMembers/{membershipId}` | `teamId, userId, email, role, joinedAt` | teamRoutes.js | teamRoutes.js |
| **teamInvites** | `/teamInvites/{inviteId}` | `teamId, email, role, invitedBy, status, createdAt, expiresAt` | teamRoutes.js | teamRoutes.js |

### Caching & AI

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **narrativeCache** | `/narrativeCache/{cacheKey}` | `inputs, narrative, validation, hitCount, cachedAt` | narrativeCache.js | narrativeCache.js |
| **abTests** | `/abTests/{testId}` | `name, description, variants[], status, metrics, createdAt` | abTestingService.js | abTestingService.js |
| **abTestAssignments** | `/abTestAssignments/{userId}_{testId}` | `userId, testId, variant, assignedAt` | abTestingService.js | abTestingService.js |
| **abTestEvents** | `/abTestEvents/{eventId}` | `testId, userId, variant, eventType, data, timestamp` | abTestingService.js | abTestingService.js |

### Feedback & Leads

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **feedback** | `/feedback/{feedbackId}` | `userId, pitchId, narrativeId, assetType, rating, category, comment, createdAt` | feedbackService.js | feedbackService.js |
| **feedbackAggregates** | `/feedbackAggregates/{key}` | `totalRating, count, averageRating, categories{}, updatedAt` | feedbackService.js | feedbackService.js |
| **leads** | `/leads/{leadId}` | `email, name, company, industry, source, createdAt` | leads.js | leads.js |
| **leadEvents** | `/leadEvents/{eventId}` | `leadId, eventType, data, timestamp` | — | leads.js |

### Operations

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **bulkJobs** | `/bulkJobs/{jobId}` | `userId, status, totalRows, processedRows, pitchLevel, results[], createdAt, completedAt` | admin.js, bulk.js | bulk.js |
| **savedSearches** | `/savedSearches/{searchId}` | `userId, filters{}, name, createdAt` | index.js | index.js |
| **rateLimits** | `/rateLimits/{key}` | `identifier, type, count, windowStart, windowEnd` | rateLimiter.js | rateLimiter.js |

### Admin & Platform Config

| Collection | Path | Schema | Read By | Written By |
|---|---|---|---|---|
| **platformConfig** | `/platformConfig/{docId}` | Varies by doc (see below) | Public read for pricing, Admin for others | Admin Console |
| **admins** | `/admins/{email}` | `email, role, addedBy, addedAt` | adminAuth.js | Super admins only |
| **discountCodes** | `/discountCodes/{codeId}` | `code, type, value, appliesToTiers[], maxRedemptions, redemptionCount, expiresAt, isActive, createdBy, createdAt` | Admin Console | Admin Console |
| **codeRedemptions** | `/codeRedemptions/{redemptionId}` | `codeId, code, userId, userEmail, appliedToTier, discountAmount, redeemedAt` | Admin Console | Checkout flow |

#### platformConfig Documents

| Document | Schema | Purpose |
|---|---|---|
| `platformConfig/pricing` | `tiers{}, updatedAt, updatedBy` | Dynamic pricing for all tiers (see Section 15) |

#### admins Collection Roles

| Role | Permissions |
|---|---|
| `super_admin` | Full access — manage admins, all settings |
| `admin` | Manage users, pricing, discount codes |
| `support` | View users, view metrics (read-only) |

#### discountCodes Schema

```javascript
{
  code: "BETA50",              // Uppercase code
  type: "percent",             // percent | fixed | trial_extension
  value: 50,                   // 50% off, or $50 off, or 30 days
  appliesToTiers: ["growth", "scale"],  // or ["all"]
  maxRedemptions: 100,         // -1 for unlimited
  redemptionCount: 23,
  expiresAt: timestamp,
  isActive: true,
  createdBy: "admin@synchintro.ai",
  createdAt: timestamp
}
```

---

## 12. Firebase Storage

### Bucket Paths

| Path | Purpose | Size Limit | Allowed Types |
|---|---|---|---|
| `/logos/{userId}/{fileName}` | User logo uploads | 2MB | PNG, JPG, SVG, WebP |
| `/pitches/{pitchId}/{fileName}` | Pitch assets (images, attachments) | 5MB | Any |

### Storage Bucket

`pathsynch-pitch-creation.firebasestorage.app`

### Access Rules

- **Logos**: Read by any authenticated user. Write/delete by owner only.
- **Pitch assets**: Read/write by authenticated users.
- **Default**: All other paths denied.

---

## 13. Security

### Firestore Rules Summary

| Collection | Read | Write |
|---|---|---|
| `users/{userId}` | Owner only | Owner only |
| `pitches/{pitchId}` | Owner OR shared=true | Owner (create/update/delete) |
| `usage/{usageId}` | Owner (matching userId prefix) | Cloud Functions only |
| `templates/{templateId}` | System templates (public) + user's own | Owner (not system templates) |
| `pitchAnalytics/{pitchId}` | Authenticated users | Cloud Functions only |
| `contacts/{userId}/contacts/{contactId}` | Owner only | Owner only |
| `sequences/{userId}/sequences/{sequenceId}` | Owner only | Owner only |
| `prd/{document}` | Authenticated users | Admin only (console) |
| `settings/{document}` | Authenticated users | Admin only |
| `workspaces/{workspaceId}` | Owner or members | Owner (create/update/delete) |
| `marketReports/{reportId}` | Owner only | Owner (create/delete) |

### Storage Rules Summary

| Path | Read | Write | Constraints |
|---|---|---|---|
| `/logos/{userId}/*` | Authenticated | Owner | Max 2MB, images only |
| `/pitches/{pitchId}/*` | Authenticated | Authenticated | Max 5MB |
| Default | Denied | Denied | — |

### CORS Configuration

- Origins: `ALLOWED_ORIGINS` env var + `https://app.synchintro.ai`, `https://synchintro.ai`, Firebase hosting domains
- Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Headers: `Content-Type, Authorization, X-Requested-With`
- Credentials: Enabled

### Rate Limiting Tiers

| Tier | Global | Burst (IP) | Notes |
|---|---|---|---|
| Anonymous | 20/hr | 10/min | IP-based only |
| Starter | 100/hr | — | User-based |
| Growth | 500/hr | — | User-based |
| Scale | 2000/hr | — | User-based |

---

## 14. Environment Variables

| Variable | Used In | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `services/claudeClient.js` | Claude AI API authentication |
| `CLAUDE_MODEL` | `config/claude.js` | Claude model selection (default: claude-3-5-sonnet-20241022) |
| `CLAUDE_MAX_TOKENS` | `config/claude.js` | Max tokens per Claude request |
| `CLAUDE_DAILY_BUDGET_USD` | `config/claude.js` | Daily spending limit for Claude |
| `GEMINI_API_KEY` | `services/geminiClient.js` | Google Gemini API authentication |
| `GEMINI_MODEL` | `services/geminiClient.js` | Gemini model selection (default: gemini-1.5-pro) |
| `GEMINI_TRAFFIC_PERCENT` | `config/gemini.js` | Percentage of traffic routed to Gemini (0-100) |
| `GEMINI_DAILY_BUDGET_USD` | `config/gemini.js` | Daily spending limit for Gemini |
| `GOOGLE_PLACES_API_KEY` | `services/googlePlaces.js` | Google Places API for competitor discovery |
| `CORESIGNAL_API_KEY` | `config/coresignal.js` | CoreSignal B2B data API |
| `CORESIGNAL_CREDIT_WARNING` | `config/coresignal.js` | Credit warning threshold |
| `CENSUS_API_KEY` | `services/census.js`, `services/cbp.js` | US Census Bureau API |
| `SERPAPI_KEY` | `services/googleTrends.js` | SerpAPI for Google Trends |
| `SENDGRID_API_KEY` | `services/email.js` | SendGrid email delivery |
| `STRIPE_SECRET_KEY` | `api/stripe.js`, `services/pricingService.js` | Stripe payments API + metadata sync |
| `STRIPE_WEBHOOK_SECRET` | `api/stripe.js` | Stripe webhook signature verification |
| `STRIPE_PRICE_STARTER` | `config/stripe.js` | Stripe price ID for Starter plan |
| `STRIPE_PRICE_GROWTH` | `config/stripe.js` | Stripe price ID for Growth plan |
| `STRIPE_PRICE_SCALE` | `config/stripe.js` | Stripe price ID for Scale plan |
| `STRIPE_PRICE_ENTERPRISE` | `config/stripe.js` | Stripe price ID for Enterprise plan |
| `PATENTSVIEW_API_KEY` | `services/uspto.js` | USPTO PatentsView API (pending - ticket PVS-5062) |
| `ALLOWED_ORIGINS` | `index.js` | CORS allowed origins (comma-separated) |
| `ADMIN_EMAILS` | `middleware/adminAuth.js` | Admin email whitelist (comma-separated) |
| `NODE_ENV` | `middleware/errorHandler.js`, `index.js` | Environment (production/development/test) |
| `ENABLE_AI_NARRATIVES` | `config/claude.js`, `config/gemini.js`, `index.js` | Feature flag: AI narrative generation |
| `ENABLE_GEMINI` | `config/gemini.js` | Feature flag: Gemini AI service |
| `ENABLE_CORESIGNAL` | `config/coresignal.js` | Feature flag: CoreSignal service |
| `ENABLE_FEEDBACK` | `config/gemini.js` | Feature flag: feedback collection |
| `ENABLE_AB_TESTING` | `config/gemini.js` | Feature flag: A/B testing |
| `ENABLE_PROMPT_CACHING` | `config/gemini.js` | Feature flag: prompt caching |
| `ENABLE_STREAMING` | `config/gemini.js` | Feature flag: streaming responses |
| `FALLBACK_TO_CLAUDE` | `config/gemini.js` | Fallback to Claude if Gemini fails |
| `FALLBACK_TO_TEMPLATES` | `config/claude.js`, `config/gemini.js`, `index.js` | Fallback to template-based generation |

---

## 15. Billing & Plans

### Plan Tiers (Aligned February 2026)

| Feature | Starter ($19/mo) | Growth ($49/mo) | Scale ($99/mo) | Enterprise ($89/mo) |
|---|---|---|---|---|
| **Pitches/month** | 25 | 100 | Unlimited | Unlimited |
| **ICP Personas** | 1 | 3 | 6 | Unlimited |
| **Workspaces** | 2 | 10 | Unlimited | Unlimited |
| **Team members** | 1 | 3 | 3 | 5 |
| Narratives/month | 5 | 25 | Unlimited | Unlimited |
| Bulk upload rows | — | 50 | 100 | Unlimited |
| Market reports/month | — | 5 | 20 | Unlimited |
| Formatters | 2 (sales_pitch, one_pager) | 5 + batch (3) | All 7 + unlimited batch | All |
| Smart Logo Fetch | — | Yes | Yes | Yes |
| White-label | — | Yes | Yes | Yes |
| PPT export | — | — | Yes | Yes |
| PDF market reports | — | — | Yes | Yes |
| Pre-call forms | — | — | — | Yes |
| Investor updates | — | — | — | Yes |
| SSO/SAML | — | — | — | Yes |
| API access | — | — | — | Yes |

### Annual Pricing

| Tier | Monthly | Annual (per month) | Annual Savings |
|---|---|---|---|
| Starter | $19 | $15 | 21% |
| Growth | $49 | $39 | 20% |
| Scale | $99 | $79 | 20% |
| Enterprise | $89 | $71 | 20% |

### Dynamic Pricing (Firestore)

Pricing is stored in Firestore at `platformConfig/pricing` and can be updated via the Admin Console. The marketing website (`synchintro.ai/pricing.html`) fetches from this document.

```javascript
// platformConfig/pricing document structure
{
  tiers: {
    starter: {
      name: "Starter",
      monthlyPrice: 19,
      annualPrice: 15,
      pitchLimit: 25,
      icpLimit: 1,
      workspacesLimit: 2,
      teamMembersLimit: 1,
      features: ["Basic analytics", "Link sharing", "Email support"]
    },
    growth: {
      name: "Growth",
      monthlyPrice: 49,
      annualPrice: 39,
      pitchLimit: 100,
      icpLimit: 3,
      workspacesLimit: 10,
      teamMembersLimit: 3,
      popular: true,
      features: ["Advanced analytics", "PDF download", "Priority support"]
    },
    scale: {
      name: "Scale",
      monthlyPrice: 99,
      annualPrice: 79,
      pitchLimit: -1,  // -1 = unlimited
      icpLimit: 6,
      workspacesLimit: -1,
      teamMembersLimit: 3,
      features: ["Team features", "CRM integrations", "Custom templates"]
    },
    enterprise: {
      name: "Enterprise",
      monthlyPrice: 89,
      annualPrice: 71,
      pitchLimit: -1,
      icpLimit: -1,
      workspacesLimit: -1,
      teamMembersLimit: 5,
      features: ["Pre-call forms", "Investor updates", "SSO/SAML", "API access"]
    }
  },
  updatedAt: timestamp,
  updatedBy: string  // admin email
}
```

### Stripe Integration

- **Checkout**: `POST /stripe/checkout` creates a Stripe Checkout Session with the selected `priceId` and `planName`
- **Portal**: Billing management via Stripe Customer Portal
- **Webhooks**: `POST /stripe/webhook` handles `charge.succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` events
- **Plan Updates**: Webhook handler updates `users/{userId}.tier` and `subscriptions/{userId}` on subscription changes

### Team Roles & Permissions

| Role | Permissions |
|---|---|
| **owner** | Full access — manage settings, members, billing, all pitches |
| **admin** | Manage settings and pitches, invite members |
| **manager** | Create and manage pitches, view team data |
| **member** | View and create pitches only |

---

## 16. Frontend — SynchIntro App

**Location**: `C:\Users\tdh35\synchintro-app\`

### Architecture

- **Type**: Vanilla JavaScript SPA (no framework, no build tools)
- **Routing**: Hash-based (`/#dashboard`, `/#create`, etc.)
- **State**: No centralized store — each page manages local state; shared state via `localStorage`/`sessionStorage` and Firestore listeners
- **Styling**: Single CSS file with CSS custom properties (design tokens)
- **Dependencies**: Firebase SDK (CDN), JSZip, Playwright (testing)

### File Structure

```
synchintro-app/
├── index.html                    # Main app shell
├── admin.html                    # Admin console entry point
├── p/index.html                  # Pitch viewer/share page
├── pricing.html                  # Pricing page
├── terms.html                    # Terms of service
├── privacy.html                  # Privacy policy
├── accessibility.html            # Accessibility statement
├── cookies.html                  # Cookie policy
├── js/
│   ├── config.js                 # Tiers, industries, fonts, API config
│   ├── firebase-config.js        # Firebase init + emulator support
│   ├── auth.js                   # Auth module (Google OAuth, email/pwd)
│   ├── router.js                 # Hash-based SPA router
│   ├── api.js                    # Firestore + API client
│   ├── app.js                    # Main app init + PathManager comms
│   ├── share.js                  # Social sharing + tier gating
│   ├── pitchViewer.js            # Pitch modal viewer
│   ├── pages/
│   │   ├── onboarding.js         # 5-step onboarding wizard
│   │   ├── dashboard.js          # Dashboard overview
│   │   ├── pitches.js            # Pitch list & management
│   │   ├── create.js             # Pitch creation form
│   │   ├── analytics.js          # Analytics dashboard
│   │   ├── settings.js           # Account settings
│   │   └── market.js             # Market intelligence
│   └── admin/                    # Admin console modules
│       ├── adminApp.js           # Admin initialization
│       ├── adminAuth.js          # Admin access verification
│       ├── adminRouter.js        # Admin page routing
│       ├── adminApi.js           # Admin API client
│       └── pages/
│           ├── adminDashboard.js # Platform metrics
│           ├── adminUsers.js     # User management
│           ├── adminCodes.js     # Discount codes
│           └── adminPricing.js   # Pricing editor
├── css/
│   ├── app.css                   # Main design system
│   └── admin.css                 # Admin-specific styles
├── tests/
│   ├── e2e/                      # Playwright E2E tests
│   ├── fixtures/                 # Test data
│   └── utils/                    # Test helpers
├── package.json
├── firebase.json
└── playwright.config.js
```

### Core Modules

**`config.js`** — Centralized configuration: Firebase credentials, API base URL, subscription tier definitions (prices, limits, Stripe price IDs), pitch level definitions, industry/sub-industry taxonomy (19 industries, 100+ sub-categories), font options.

**`firebase-config.js`** — Firebase initialization with optional emulator support. Detects emulators via URL params or localStorage. Adds visual badge in emulator mode.

**`auth.js`** — Complete auth flow: Google OAuth popup, email/password with validation, email verification with resend, password reset, password strength indicator (4-level). Auto-creates Firestore user doc on first sign-in.

**`router.js`** — Hash-based client-side router. 6 routes: `dashboard`, `pitches`, `create`, `analytics`, `market`, `settings`. Updates nav active state, shows/hides page divs, calls `PageModule.render()`.

**`api.js`** — All data operations organized by domain:
- **User**: `getCurrentUser()`, `updateUser()`, `getSubscription()`, `updateSellerProfile()`
- **Pitches**: `getPitches()`, `getPitch()`, `createPitch()`, `updatePitch()`, `deletePitch()`, `savePitchDirect()`
- **Analytics**: `getAnalytics()`, `getPitchAnalytics()`, `trackShare()`, `getShareAnalyticsByPlatform()`
- **Workspaces**: `getWorkspaces()`, `createWorkspace()`, `updateWorkspace()`, `deleteWorkspace()`, `addWorkspaceMember()`, `removeWorkspaceMember()`
- **Subscriptions**: `createCheckoutSession()`, `createPortalSession()`, `openCheckout()`, `openBillingPortal()`
- **Market**: `generateMarketReport()`, `getMarketReports()`, `getMarketReport()`, `deleteMarketReport()`
- **Onboarding**: `updateOnboardingStep()`, `completeOnboarding()`, `uploadLogo()`, `analyzeWebsite()`

**`app.js`** — Main app initialization. Embedded mode detection. PathManager postMessage communication. Sidebar management. Logout handling.

**`share.js`** — Social sharing with tier gating. Enterprise users: Facebook, Twitter, LinkedIn, WhatsApp, Email. Non-enterprise: Email only.

### Authentication Flow

```
User arrives
    │
    ├─ Google OAuth ─→ Popup ─→ Firebase Auth ─→ emailVerified=true ─→ Skip verification
    │
    └─ Email/Password ─→ Firebase Auth ─→ Send verification email
                                             │
                                             ▼
                                       Verification Screen
                                       (check status, resend)
                                             │
                                             ▼ (verified)
                                       Check onboardingCompleted
                                             │
                                    ┌────────┴────────┐
                                    │                 │
                                  false              true
                                    │                 │
                                    ▼                 ▼
                              Onboarding          Dashboard
                              Wizard (5 steps)
```

### Onboarding Wizard (5 Steps)

1. **Company Profile** — Company name, industry, size, years in business, website, address
2. **Products** — Product name, description, pricing, primary flag
3. **ICP** — Target industries, company sizes, pain points, decision makers
4. **Value Proposition** — USPs, key benefits, differentiator statement
5. **Branding** — Logo upload, primary/accent colors, tone, font

**Profile Completeness**: Company (25%) + Products (25%) + ICP (20%) + Value Prop (15%) + Branding (15%) = 0-100%

### Page Modules

**Dashboard** — Stats grid (pitches created, views, shares, CTA clicks, CTR), plan usage bar, recent pitches list, upgrade banner for free users.

**Create** — Pitch level selector (L1/L2/L3), prospect info form (business name, address, industry, sub-industry, website, Google rating/reviews), contact info, product selection from seller profile, CTA text, custom instructions, workspace assignment. Smart logo fetch for Growth+.

**Pitches** — Workspace filter, level/status/sort filters, search, pitch cards with actions (view, edit, duplicate, share, delete, mark status). Bulk operations for Growth+.

**Analytics** — Overview stats (6 cards), breakdowns by pitch level / industry / location / time period, share analytics by platform, top performers.

**Market** — Search form (city, state, industry, sub-industry, radius, company size), results list with business cards, previous reports list, export.

**Settings** — Profile editing, seller profile accordion (read-only display with edit links), subscription info with upgrade/manage billing, workspace management, danger zone (delete account).

### Script Loading Order

```html
1. config.js            <!-- Configuration first -->
2. firebase-config.js   <!-- Firebase setup -->
3. auth.js              <!-- Auth before app -->
4. router.js            <!-- Router setup -->
5. api.js               <!-- API client -->
6. share.js             <!-- Sharing module -->
7. pitchViewer.js       <!-- Pitch viewer -->
8. pages/onboarding.js  <!-- Page modules -->
9. pages/dashboard.js
10. pages/pitches.js
11. pages/create.js
12. pages/analytics.js
13. pages/settings.js
14. pages/market.js
15. app.js              <!-- Main init (DOMContentLoaded) -->
```

---

## 17. Frontend — Admin Console

**Location**: `C:\Users\tdh35\synchintro-app\`
**Entry Point**: `admin.html`
**URL**: `https://app.synchintro.ai/admin.html`

### Overview

A standalone admin dashboard for managing users, viewing platform metrics, creating discount codes, and dynamically updating pricing. Uses the same Firebase project as the main SynchIntro app but with separate authentication checks.

### Architecture

- **Entry Point**: `admin.html` (separate from `index.html`)
- **Auth Check**: Verifies user email exists in `admins` Firestore collection
- **Routing**: Hash-based (`#dashboard`, `#users`, `#codes`, `#pricing`)
- **API**: Reuses existing backend admin endpoints + new pricing endpoints

### File Structure

```
synchintro-app/
├── admin.html                      # Admin SPA entry point
├── js/
│   └── admin/
│       ├── adminApp.js             # Admin app initialization
│       ├── adminAuth.js            # Admin access verification
│       ├── adminRouter.js          # Admin page routing
│       ├── adminApi.js             # Admin API calls
│       └── pages/
│           ├── adminDashboard.js   # Platform metrics overview
│           ├── adminUsers.js       # User management
│           ├── adminCodes.js       # Discount codes management
│           └── adminPricing.js     # Dynamic pricing editor
├── css/
│   └── admin.css                   # Admin-specific styles
```

### Admin Auth Flow

```javascript
// adminAuth.js
const AdminAuth = {
  async checkAccess() {
    const user = firebase.auth().currentUser;
    if (!user) return { allowed: false, reason: 'not_logged_in' };

    const adminDoc = await firebase.firestore()
      .collection('admins')
      .doc(user.email.toLowerCase())
      .get();

    if (!adminDoc.exists) return { allowed: false, reason: 'not_admin' };

    return {
      allowed: true,
      role: adminDoc.data().role,  // super_admin, admin, support
      email: user.email
    };
  }
};
```

### Admin Pages

#### Dashboard (`#dashboard`)
- **Stats Cards**: Total Users, Active Users (7d), Total Pitches, MRR
- **User Breakdown**: Pie chart by tier
- **Pitch Activity**: Line chart (last 30 days)
- **Quick Actions**: View Users, Create Code

#### User Management (`#users`)
- **User List**: Search, filter by tier, pagination
- **User Detail Modal**: Profile, usage stats, pitches, subscription
- **Actions**: Change tier, Grant free months, Add notes

#### Discount Codes (`#codes`)
- **Create Code Form**: Code, type, value, tiers, expiry, max uses
- **Code List**: Active/expired codes with redemption counts
- **Actions**: Toggle active/inactive, view redemption history

#### Pricing Editor (`#pricing`)
- **Tier Cards**: Display current pricing with limits
- **Edit Form**: Prices, limits (pitches, ICPs, workspaces, team members), features
- **Actions**:
  - **Save**: Updates Firestore + syncs metadata to Stripe
  - **Reset to Defaults**: Restores hardcoded default pricing
  - **Sync to Stripe**: Force metadata sync to all Stripe products

### Admin API Methods (`adminApi.js`)

```javascript
const AdminAPI = {
  // Pricing
  getPricing(),
  updatePricing(pricingData),
  getDefaultPricing(),
  syncStripeMetadata(),

  // Users (future)
  getUsers(filters),
  updateUser(userId, data),

  // Discount Codes (future)
  createDiscountCode(code),
  getDiscountCodes(),
  toggleCodeStatus(codeId),

  // Metrics (future)
  getPlatformMetrics()
};
```

### Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Admin Shell & Auth | ✅ Complete | admin.html, adminAuth.js, adminRouter.js |
| Pricing Editor | ✅ Complete | View, edit, save with Stripe sync |
| Reset to Defaults | ✅ Complete | One-click reset |
| Dashboard Metrics | 🔲 Pending | Phase 2 |
| User Management | 🔲 Pending | Phase 3 |
| Discount Codes | 🔲 Pending | Phase 4 |

---

## 18. Frontend — Legacy Pages

**Location**: `C:\Users\tdh35\pathsynch-pitch-generator\public\`

### HTML Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page — redirects to `login.html` with PostHog analytics |
| `login.html` | Auth page — email/password + Google OAuth, redirects to onboarding or dashboard |
| `onboarding.html` | 4-step setup wizard: industry selection, brand setup, first pitch, success |
| `dashboard.html` | Main user hub — pitches list, usage metrics, recent activity |
| `create-pitch.html` | Single pitch creation form |
| `pitch.html` | Pitch viewer — displays generated pitch with PDF export (html2pdf.js), outcome tracking |
| `settings.html` | Account settings, branding preferences, notifications |
| `pricing.html` | 3-tier pricing page: Starter (free), Growth ($49), Scale ($149) with Stripe checkout |
| `analytics.html` | Analytics dashboard — pitch performance, engagement stats |
| `bulk-upload.html` | CSV batch upload — generates multiple pitches, shows job status/progress |
| `free-report.html` | Lead magnet — free market intelligence report form, captures leads |
| `market-report.html` | Market intelligence — detailed analysis with Chart.js charts and Leaflet maps |
| `join-team.html` | Team invite handler — displays role and team details |

### Admin Pages (`public/admin/`)

| File | Purpose |
|---|---|
| `admin/index.html` | Admin dashboard — system-wide metrics |
| `admin/users.html` | User management — filter, search, manage users |
| `admin/revenue.html` | Revenue analytics — subscription metrics |

### Relation to SynchIntro

The legacy pages are the predecessor to the SynchIntro SPA. They use inline `<script type="module">` blocks that import Firebase SDKs from CDN directly. The SynchIntro app replaces this with a consolidated SPA architecture. Both share the same Firebase project and API backend.

### External Libraries (Legacy)

- Firebase SDKs v10.7.1 (Auth, Firestore, Storage)
- html2pdf.js — PDF export
- Chart.js — Analytics charts
- Leaflet — Map visualization
- PostHog — Product analytics (`/js/posthog.js`)

---

## 19. PathManager Integration

### How It Works

PathManager is a separate CRM/prospecting application that embeds SynchIntro as an iframe. This allows PathManager users to generate pitches directly within their workflow.

### Embedded Mode Activation

Three detection methods (any triggers embedded mode):

1. URL parameter: `?embedded=true`
2. Hash parameter: `#page?embedded=true`
3. Auto-detect: `window.self !== window.top` (running inside iframe)

**UI Changes in Embedded Mode**:
- Sidebar hidden (PathManager provides navigation)
- Main content expanded to full width
- `embedded-mode` class added to `<body>`

### PostMessage Protocol

**Allowed Origins**:
- `https://pathmanager.pathsynch.com`
- `https://app.pathsynch.com`
- `http://localhost:5173` (dev)
- `http://localhost:3000` (dev)

#### Messages FROM PathManager → SynchIntro

| Message Type | Payload | Purpose |
|---|---|---|
| `PATHMANAGER_CONTEXT` | `{ prospectName, prospectWebsite, prospectIndustry, contactName, userTier, ... }` | Send prospect data and user context |
| `NAVIGATE` | `{ page: 'create' }` | Trigger page navigation |

#### Messages FROM SynchIntro → PathManager

| Message Type | Payload | Purpose |
|---|---|---|
| `SYNCHINTRO_READY` | `{ version: '1.0.0' }` | Signal that SynchIntro has loaded |

### Context Flow

```
PathManager                          SynchIntro (iframe)
    │                                     │
    │── postMessage(PATHMANAGER_CONTEXT) ──▶│
    │                                     │── Store in sessionStorage
    │                                     │── Dispatch 'pathmanager-context-updated' event
    │                                     │── Pages pre-fill forms from context
    │                                     │
    │◀── postMessage(SYNCHINTRO_READY) ───│
    │                                     │
    │── postMessage(NAVIGATE, {page}) ────▶│
    │                                     │── Router.navigate(page)
```

### Auth / Session Passing

- SynchIntro uses **Firebase Auth** natively (not PathManager's JWT)
- PathManager context is stored in `sessionStorage` for cross-page access
- Pages access context via `App.getPathManagerContext()` or `sessionStorage.getItem('pathManagerContext')`
- JWT-to-Firebase custom token conversion would be a backend responsibility (not implemented in current frontend code)

### Enterprise Plan Gating

PathManager integration enables enterprise-tier features:
- All social sharing platforms (Facebook, Twitter, LinkedIn, WhatsApp)
- Branded subdomains
- Unlimited workspaces
- Smart logo fetch
- SSO/SAML authentication
- API access
- Dedicated account management

---

## 20. NAICS Industry Taxonomy

### 15 Display Categories, 57 Sub-Industries

| # | Category | Sub-Industries | Data Source |
|---|---|---|---|
| 1 | **Food & Beverage** | Full Service Restaurant, Fast Casual, Coffee & Cafe, Bar & Nightlife | places |
| 2 | **Automotive** | Auto Repair, Body Shop, Car Dealership | places |
| 3 | **Health & Wellness** | Gym & Fitness, Medical Practice, Dental Practice, Chiropractic, Spa & Massage | places |
| 4 | **Home Services** | Plumbing & HVAC, Electrical, Roofing, Landscaping | places |
| 5 | **Professional Services** | Legal, Accounting, Real Estate, Insurance | places/limited |
| 6 | **Salon & Beauty** | Hair Salon, Beauty Salon, Nail Salon | places |
| 7 | **Retail** | General Merchandise, Clothing, Electronics | places |
| 8 | **Technology & SaaS** | Software Development, IT Services, Cloud & Hosting, SaaS Products, Tech Consulting | manual |
| 9 | **Finance & Banking** | Commercial Banking, Credit Union, Investment Banking, Financial Advisory, Payment Processing | limited/manual |
| 10 | **Manufacturing** | Machine Shop, Industrial Equipment, Food Manufacturing, General Manufacturing | manual |
| 11 | **Transportation & Logistics** | Commercial Aviation, Charter Aviation, Aviation Services, Freight & Trucking, Warehousing | manual |
| 12 | **Energy & Utilities** | Power Generation, Utility Construction, Water Utilities | manual |
| 13 | **Agriculture** | Crop Farming, Livestock, Forestry | manual |
| 14 | **Commercial Real Estate** | Commercial Property, Property Management | limited |
| 15 | **Education & Training** | Higher Education, Corporate Training, Specialty Training | limited |
| — | **Other** | Custom Industry | manual |

### Data Source Types

| Type | Description | Google Places Support |
|---|---|---|
| `places` | Full Google Places support — local businesses with ratings, reviews | Full competitor discovery |
| `limited` | Partial Places support — may not return useful competitor data | Limited results |
| `manual` | No Places support — B2B/enterprise industries | Requires manual competitor input |

### Per-Industry NAICS Metadata

Each NAICS entry includes:

| Field | Description |
|---|---|
| `code` | 6-digit NAICS code |
| `level` | NAICS hierarchy level |
| `sectorCode` | 2-digit sector code |
| `title` | Official NAICS title |
| `displayCategory` | PathSynch category name |
| `displaySubcategory` | PathSynch sub-industry name |
| `placesKeyword` | Google Places search query |
| `placesTypes` | Google Places type filters |
| `spendingRate` | Consumer spending rate for market sizing |
| `baseGrowthRate` | Industry base growth rate (%) |
| `seasonalityPattern` | Pattern type (holiday_peak, stable, weekend_peak, etc.) |
| `incomeSweetSpot` | `{ min, ideal, max }` — target household income range |
| `densityBenchmark` | `{ low, medium, high }` — businesses per 1000 population |
| `avgTransaction` | Average transaction value ($) |
| `monthlyCustomers` | Typical monthly customer count |

### Industry Intelligence (per sub-industry)

Each sub-industry in `industryIntelligence.js` includes:

| Field | Description |
|---|---|
| `decisionMakers` | Target titles (Owner, GM, Marketing Director, etc.) |
| `painPoints` | 4 key business challenges |
| `primaryKPIs` | Metrics they track |
| `topChannels` | Marketing channels they use |
| `prospecting.bestMonths` | Optimal months to reach out |
| `prospecting.worstMonths` | Months to avoid |
| `prospecting.buyerMindset` | Current purchasing mindset |
| `prospecting.approachTip` | Sales approach recommendation |
| `calendar.buyingCycle` | Purchase cycle timing |
| `calendar.contractRenewal` | Renewal period |
| `calendar.keyEvents` | Industry trade shows and events |
| `calendar.budgetPlanningMonths` | When budgets are set |
| `calendar.decisionTimeline` | Typical time from first meeting to decision |

---

## 21. Key Data Flows

### Generating a Pitch

```
1. User fills Create Pitch form (prospect info, level, product)
       │
2. Frontend calls POST /generate-pitch
       │
3. index.js:
       ├── verifyAuth(req) → attach userId, plan
       ├── validate('generatePitch') → schema check
       ├── checkAndUpdateUsage(userId) → enforce plan limits
       │
4. pitchGenerator.generatePitch(req, res):
       ├── buildSellerContext(sellerProfile)
       ├── Look up industryIntelligence for prospect industry
       ├── Calculate ROI via roiCalculator
       ├── If Level 2/3: fetch reviewAnalytics for Google reviews
       ├── Generate HTML pitch content (template-based with AI enhancement)
       ├── Generate shareId for sharing
       │
5. Write to Firestore:
       ├── pitches/{pitchId} — full pitch document
       ├── usage/{userId}_{period} — increment pitchCount
       │
6. Return pitch data to frontend
       │
7. Frontend navigates to pitch viewer
```

### Generating a Market Report

```
1. User fills Market search form (city, state, industry, radius)
       │
2. Frontend calls POST /market/report
       │
3. index.js:
       ├── verifyAuth(req)
       ├── requirePlan('growth') → enforce Growth+ plan
       ├── checkUsageLimit('marketReport') → enforce monthly limit
       │
4. market.js.generateReport(req, res):
       │
       ├── Check marketCache for existing data
       │
       ├── If cache miss, fetch in parallel:
       │   ├── googlePlaces.search(industry, location, radius) → competitors
       │   ├── geography.getCensusGeography(city, state, zip) → FIPS codes
       │   ├── census.getDemographics(fips) → age, income, education, commute
       │   ├── cbp.getEstablishments(fips, naicsCode) → business counts
       │   ├── googleTrends.getInterest(industry, location) → search trends
       │   └── coresignal.query(industry, location) → B2B intelligence (if enabled)
       │
       ├── marketMetrics.calculateOpportunity(allData) → opportunity score
       ├── Cache results in marketCache
       │
5. Write to Firestore:
       ├── marketReports/{reportId} — full report document
       ├── usage/{userId}_{period} — increment marketReportCount
       │
6. Return report data to frontend
```

### Onboarding / Website Analysis

```
1. User enters website URL in onboarding Step 1
       │
2. Frontend calls POST /onboarding/analyze-website
       │
3. onboarding.js.analyzeWebsite(req, res):
       ├── Fetch website HTML content
       ├── Clean/parse HTML (remove scripts, styles)
       ├── Send to Gemini AI with analysis prompt
       ├── Extract structured data:
       │   ├── Company name, industry, description
       │   ├── Products/services offered
       │   ├── Target audience
       │   ├── Value propositions
       │   └── Brand tone/style
       │
4. Return extracted profile to frontend
       │
5. Frontend pre-fills onboarding form fields
       │
6. User reviews/edits, completes remaining steps
       │
7. Frontend saves sellerProfile to users/{userId}
       │
8. Mark onboardingCompleted = true
```

### Narrative → Formatted Asset Pipeline

```
1. User selects narrative + formatter type
       │
2. Frontend calls POST /narratives/{id}/format/{type}
       │
3. formatterApi.formatNarrativeEndpoint(req, res):
       ├── verifyAuth(req)
       ├── requireFormatter(type) → check plan access
       ├── Fetch narrative from Firestore
       │
4. formatterRegistry.formatNarrative(type, narrative, options):
       ├── Get formatter instance from registry
       ├── formatter.getSystemPrompt() → AI formatting instructions
       ├── formatter.format(narrative, options):
       │   ├── Build prompt with narrative data + system prompt
       │   ├── Call modelRouter.selectModel('format') → Claude or Gemini
       │   ├── Send to AI for formatting
       │   ├── Parse structured response
       │   └── Generate HTML, plain text, markdown versions
       │
5. Write to Firestore:
       ├── formattedAssets/{assetId} — formatted content + metadata
       │
6. Return formatted asset to frontend
```

---

## 22. Marketing Website

### Overview

The marketing website (`synchintro.ai`) is a separate static site hosted on AWS Amplify.

| Property | Value |
|----------|-------|
| **Domain** | `synchintro.ai`, `www.synchintro.ai` |
| **Hosting** | AWS Amplify |
| **Repository** | `github.com/PathSynch-CEO/synchintro-website` |
| **Branch** | `main` |
| **Auto-deploy** | Yes (on push to main) |

### Repository Location

```
C:\Users\tdh35\synchintro-website\
├── index.html              # Homepage
├── pricing.html            # Pricing page (hardcoded, matches Firestore)
├── faq.html                # FAQ page
├── vs-storydoc.html        # Competitor comparison pages
├── vs-gamma.html
├── vs-pitch.html
├── vs-pitches-ai.html
├── vs-beautiful-ai.html
├── css/
│   ├── styles.css
│   └── comparison.css
```

### Pricing Page (`pricing.html`)

The pricing page displays hardcoded tier information that should match the `platformConfig/pricing` Firestore document:

| Tier | Price | Pitches | ICPs | Workspaces | Team Members |
|------|-------|---------|------|------------|--------------|
| Starter | $19/mo | 25 | 1 | 2 | 1 |
| Growth | $49/mo | 100 | 3 | 10 | 3 |
| Scale | $99/mo | Unlimited | 6 | Unlimited | 3 |
| Enterprise | $89/mo | Unlimited | Unlimited | Unlimited | 5 |

**Note:** When pricing changes in Admin Console, `pricing.html` must be manually updated and pushed to GitHub for changes to appear on the marketing site.

### Deployment

```bash
# From synchintro-website directory
git add .
git commit -m "Update pricing"
git push origin main
# Amplify auto-deploys on push
```

### Known Issue (February 2026)

The custom domain `synchintro.ai` was not connected to the Amplify app. It's connected to a different/older Amplify app. To resolve:

1. Find the other Amplify app in AWS Console that has `synchintro.ai` connected
2. Either update that app to use the correct GitHub repo, OR
3. Remove domain from old app and add to the `synchintro-website` app (App ID: `d353x2fheaw5ti`)

See `C:\Users\tdh35\Desktop\synchintro-amplify-issue.md` for detailed developer notes.

---

## Appendix: Firestore Indexes

| Collection | Fields | Purpose |
|---|---|---|
| `pitches` | `userId` ASC, `createdAt` DESC | List user's pitches by date |
| `pitches` | `userId` ASC, `workspaceId` ASC, `createdAt` DESC | List workspace pitches |
| `workspaces` | `ownerId` ASC, `createdAt` DESC | List owner's workspaces |
| `marketReports` | `userId` ASC, `createdAt` DESC | List user's reports |
| `marketCache` | `dataType` ASC, `cachedAt` ASC | Cache query optimization |
| `onepagers` | `userId` ASC, `createdAt` DESC | List user's one-pagers |
| `discountCodes` | `isActive` ASC, `expiresAt` ASC | Active codes query |
| `codeRedemptions` | `codeId` ASC, `redeemedAt` DESC | Redemption history by code |

---

## Appendix: Firebase Project Configuration

```json
{
  "projectId": "pathsynch-pitch-creation",
  "authDomain": "pathsynch-pitch-creation.firebaseapp.com",
  "storageBucket": "pathsynch-pitch-creation.firebasestorage.app",
  "messagingSenderId": "796921234100"
}
```

**firebase.json hosting config**:
```json
{
  "hosting": {
    "public": "public",
    "rewrites": [{ "source": "/api/**", "function": "api" }]
  },
  "functions": [{ "source": "functions", "codebase": "default" }]
}
```
