# Changelog — May 20, 2026

## Market Report: Competitor Filtering & Validation Layer (v2)

**Branch:** `fix/competitor-filtering-validation`
**Priority:** P0 — Blocked benchmark accuracy, opportunity scores, lead quality, and all downstream report sections

### Problem Fixed

The Market Intelligence Report was including businesses that are not actual competitors: corporate offices, warehouses, distribution centers, B2B software companies, and wrong-category retailers. These false positives were corrupting every downstream metric — average rating, review count, Share of Voice, SEO landscape scores, competitive archetypes, SWOT analysis, and Gemini narratives.

Confirmed false positives from Charlotte, NC — Retail (Home Goods & Decor) report:
- Lowe's Tower (23-story corporate office building)
- Retail Architects (B2B software / POS systems for furniture retailers)
- Ross Stores Distribution Center (warehouse/logistics)
- It's Fashion Corporate Office (corporate HQ, not storefront)
- Publix Charlotte Division Headquarters (corporate HQ)

### Solution: Three-Layer Validation with Three-State Relevance

Every competitor result is now classified as `direct`, `adjacent`, or `invalid` before entering benchmarks or scoring.

**Layer 1 — Deterministic (instant, no API cost)**
- Type blocklist: corporate_office, warehouse, distribution_center, school, etc.
- Name blocklist: "corporate office", "headquarters", "distribution center", etc.
- Category allowlist match → `direct` (high confidence)
- Keyword match in business name → `direct` (medium confidence, before adjacent check)
- Adjacent type match → `adjacent` (medium confidence)
- No match → `unknown` (passes to Layer 2)

**Layer 2 — Gemini sweep (best-effort, 5s timeout)**
- One `gemini-3-flash-preview` call with `thinkingBudget: 0`
- Evaluates all ambiguous candidates (unknown from Layer 1)
- Returns `direct`, `adjacent`, or `invalid` per candidate
- On failure/timeout: defaults all unknowns to `adjacent` — report continues normally

**Layer 3 — Geographic flag (informational only)**
- Cross-border businesses (e.g., Fort Mill, SC for a Charlotte, NC report) are flagged with `crossBorderState`
- Does NOT change relevance — cross-border competitors are common in metro areas

### Impact

| State | Benchmarks | Report Section |
|-------|-----------|----------------|
| `direct` | Yes | Main Competitors |
| `adjacent` | No | Adjacent Market Context (future UI section) |
| `invalid` | No | `rejectedCompetitors[]` audit trail only |

Every benchmark and score now recalculates from `direct` competitors only: average rating, average review count, Share of Voice, SEO landscape average, Opportunity Score denominators.

### Minimum Threshold Protection

- `direct >= 10` → `full` mode (normal report)
- `direct < 10` but `direct + adjacent >= 15` → `thin_market` mode (notice shown, benchmarks still use direct only)
- `direct + adjacent < 15` → `fallback` mode (combined set used, directional-data warning)

### New Files

| File | Purpose |
|------|---------|
| `functions/config/competitorValidation.json` | BLOCKLIST_TYPES, NAME_BLOCKLIST_PATTERNS, CATEGORY_ALLOWLISTS for 8 top-level industries |
| `functions/services/competitorValidator.js` | Three-layer validation pipeline, all exported functions |
| `functions/tests/competitorValidator.test.js` | 49 unit tests (all passing) |

### Modified Files

| File | Change |
|------|--------|
| `functions/api/market.js` | Added `validateCompetitors()` call after enrichments, before saturation/benchmark calc. Stores `adjacentCompetitors`, `rejectedCompetitors`, `validationMetadata`, `validationNotice` in reportData. Adds validation log write (feature-flagged by `ENABLE_COMPETITOR_VALIDATION_LOGGING`). |
| `functions/utils/reportFieldResolver.js` | Added `getAdjacentCompetitors()`, `getRejectedCompetitors()`, `getValidationMetadata()` resolvers |

### New Firestore Fields

Added to `marketReports/{id}.data`:
- `adjacentCompetitors[]` — adjacent businesses (valid retail, wrong sub-industry)
- `rejectedCompetitors[]` — invalid entities with reason + layer
- `validationMetadata` — mode, counts, geminiStatus, rejectionBreakdown, validatedAt
- `validationNotice` — human-readable notice when threshold protection triggers

### New Environment Variable

`ENABLE_COMPETITOR_VALIDATION_LOGGING=true` — when set, writes rejection audit to `competitorValidationLogs` Firestore collection for allowlist tuning (recommended for first 30 days after deploy).

### Category Allowlists Built (Phase 1)

- **Retail:** Home Goods & Decor, Clothing & Apparel, Electronics, Sporting Goods, _default
- **Restaurant / Food:** Full Service, Fast Casual, Cafe/Coffee, Bakery, Bar, _default
- **Home Services:** Plumbing, HVAC, Electrical, Roofing, Landscaping, _default
- **Medical / Health:** Dental, Chiropractic, Optometry, Dermatology, Physical Therapy, _default
- **Beauty / Salon:** Hair, Nails, Med Spa, Barbershop, Massage, _default
- **Professional Services:** Legal, Accounting, Real Estate, Consulting, _default
- **Automotive:** Repair, Dealership, Car Wash, _default
- **Fitness:** Gym, Yoga, CrossFit, Martial Arts, Personal Training, _default

### Test Coverage

49 unit tests added to `functions/tests/competitorValidator.test.js`:
- Layer 1 name blocklist (5 tests)
- Layer 1 type blocklist (4 tests)
- Layer 1 direct type classification (6 tests)
- Layer 1 adjacent type classification (2 tests)
- Layer 1 keyword classification / keyword-beats-adjacent-type rule (4 tests)
- Layer 1 unknown pass-through (3 tests)
- Layer 1 _default fallback (1 test)
- Layer 3 geo boundary check (4 tests)
- JSON parsing (8 tests)
- Minimum threshold mode determination (6 tests)
- Known Charlotte NC false positives (5 tests)
- Lionel Retail Store (adjacent, not invalid) (1 test)

Full suite: **661 tests passing, 0 failing** (up from 574 baseline).
