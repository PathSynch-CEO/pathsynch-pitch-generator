# Refactoring Plan: pitchGenerator.js

**File:** `functions/api/pitchGenerator.js`
**Original Size:** 3,066 lines
**Final Size:** 683 lines (77% reduction)
**Version:** 3.2.0
**Date:** February 11, 2026
**Status:** ✅ COMPLETE

## Completion Summary

The refactoring has been successfully completed. The original 3,066-line monolithic file has been modularized into:

| Module | Lines | Purpose |
|--------|-------|---------|
| `pitch/validators.js` | ~75 | Pitch limits and quota checking |
| `pitch/dataEnricher.js` | ~150 | Seller context, pre-call form data |
| `pitch/htmlBuilder.js` | ~80 | Color adjustment, text truncation |
| `pitch/level1Generator.js` | ~350 | Outreach Sequences HTML |
| `pitch/level2Generator.js` | ~590 | One-Pager HTML |
| `pitch/level3Generator.js` | ~1,170 | Enterprise Deck HTML |
| `pitchGenerator.js` | 683 | API handlers + re-exports |

**Total Test Coverage:** 398 tests passing (including 93 new module-specific tests)

---

## Executive Summary

This document outlines a safe, incremental strategy to refactor `pitchGenerator.js` from a monolithic 3,066-line file into modular components. Each step can be deployed independently without breaking production.

---

## 1. Target Module Structure

After refactoring, the `functions/api/pitch/` directory will contain:

```
functions/api/pitch/
├── index.js              # API handlers (main entry point)
├── level1Generator.js    # Level 1: Outreach Sequences
├── level2Generator.js    # Level 2: One-Pager
├── level3Generator.js    # Level 3: Enterprise Deck
├── htmlBuilder.js        # Shared HTML/CSS utilities
├── dataEnricher.js       # Data transformation & enrichment
└── validators.js         # Limits, auth, input validation
```

**Estimated Total Lines by Module:**
- `index.js`: ~300 lines
- `level1Generator.js`: ~350 lines
- `level2Generator.js`: ~650 lines
- `level3Generator.js`: ~1,250 lines
- `htmlBuilder.js`: ~200 lines
- `dataEnricher.js`: ~250 lines
- `validators.js`: ~150 lines

---

## 2. Module Definitions

### 2.1 `validators.js` - Validation & Limits

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `checkPitchLimit(userId)` | 58-93 | Check monthly pitch quota |
| `incrementPitchCount(userId)` | 99-106 | Increment user's pitch count |
| `PITCH_LIMITS` constant | 45-51 | Tier limit configuration |

**Exports:**
```javascript
module.exports = {
    PITCH_LIMITS,
    checkPitchLimit,
    incrementPitchCount
};
```

**Dependencies:**
- `firebase-admin` (for Firestore access)
- None on other pitch modules

**Why separate:** These are pure validation functions with no HTML concerns. They're also potentially reusable by other features (quotas, analytics, etc.).

---

### 2.2 `dataEnricher.js` - Data Transformation

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `buildSellerContext(sellerProfile, icpId)` | 114-219 | Normalize seller profile to context |
| `getPrecallFormEnhancement(precallFormId, userId)` | 227-274 | Fetch pre-call form data |
| `enhanceInputsWithPrecallData(inputs, precallData)` | 282-314 | Merge pre-call data into inputs |

**Exports:**
```javascript
module.exports = {
    buildSellerContext,
    getPrecallFormEnhancement,
    enhanceInputsWithPrecallData
};
```

**Dependencies:**
- `firebase-admin` (for Firestore)
- `../services/precallForm` (existing service)

**Why separate:** These functions transform and enrich data before it reaches the generators. They don't produce HTML.

---

### 2.3 `htmlBuilder.js` - Shared HTML Utilities

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `adjustColor(hex, percent)` | 317-333 | Darken/lighten hex colors |
| `truncateText(text, maxLength, suffix)` | 336-346 | Truncate with ellipsis |
| `CONTENT_LIMITS` constant | 349-356 | Max lengths for content |

**New functions to extract (from level generators):**

```javascript
// CSS Variables block (appears in all 3 levels)
function buildCssVariables(options) {
    const primaryColor = options.primaryColor || '#3A6746';
    const accentColor = options.accentColor || '#D4A847';
    return `
        :root {
            --color-primary: ${primaryColor};
            --color-primary-dark: ${primaryColor}dd;
            --color-accent: ${accentColor};
            --color-secondary: #6B4423;
            --color-bg: #ffffff;
            --color-bg-light: #f8f9fa;
            --color-text: #333333;
            --color-text-light: #666666;
        }
    `;
}

// CTA tracking script (appears in Level 2 & 3)
function buildCtaTrackingScript(pitchId) {
    return `
    <script>
    window.trackCTA = function(el) {
        if (navigator.sendBeacon) {
            navigator.sendBeacon(
                'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',
                new Blob([JSON.stringify({
                    pitchId: '${pitchId || ''}',
                    event: 'cta_click',
                    data: {
                        ctaType: el.dataset.ctaType || null,
                        ctaUrl: el.href || null,
                        pitchLevel: parseInt(el.dataset.pitchLevel) || 0,
                        segment: el.dataset.segment || null
                    }
                })], { type: 'application/json' })
            );
        }
    };
    </script>`;
}

// Stats box component (appears in Level 2 & 3)
function buildStatBox(value, label) {
    return `
        <div class="stat-box">
            <div class="value">${value}</div>
            <div class="label">${label}</div>
        </div>
    `;
}

// Branding footer (appears in all levels)
function buildBrandingFooter(hideBranding, companyName, customFooterText) {
    let html = '';
    if (customFooterText) {
        html += `
        <div style="margin-top: 24px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>`;
    }
    if (!hideBranding) {
        html += `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">PathSynch</a>
        </div>`;
    }
    return html;
}
```

**Exports:**
```javascript
module.exports = {
    adjustColor,
    truncateText,
    CONTENT_LIMITS,
    buildCssVariables,
    buildCtaTrackingScript,
    buildStatBox,
    buildBrandingFooter
};
```

**Dependencies:**
- None (pure utility functions)

**Why separate:** These are reusable HTML building blocks. Extracting them reduces duplication across level generators and makes styling changes easier.

---

### 2.4 `level1Generator.js` - Outreach Sequences

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `generateLevel1(inputs, reviewData, roiData, options, marketData, pitchId)` | 359-673 | Generate Level 1 HTML |

**Exports:**
```javascript
module.exports = {
    generateLevel1
};
```

**Dependencies:**
```javascript
const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const { adjustColor, buildBrandingFooter } = require('./htmlBuilder');
```

**Internal structure (no extraction needed):**
- Email sequence templates (3 emails)
- LinkedIn sequence templates (3 messages)
- Sales intelligence section
- Personalization notes section

---

### 2.5 `level2Generator.js` - One-Pager

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `generateLevel2(inputs, reviewData, roiData, options, marketData, pitchId)` | 676-1265 | Generate Level 2 HTML |

**Exports:**
```javascript
module.exports = {
    generateLevel2
};
```

**Dependencies:**
```javascript
const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const {
    adjustColor,
    truncateText,
    CONTENT_LIMITS,
    buildCssVariables,
    buildCtaTrackingScript,
    buildBrandingFooter
} = require('./htmlBuilder');
```

**Internal structure:**
- Top bar with logo/CTAs
- Header with business info
- Trigger event card (conditional)
- Stats row
- Opportunity + Customer analysis cards
- Industry pain points section
- Products grid
- Solutions grid
- CTA section

---

### 2.6 `level3Generator.js` - Enterprise Deck

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `generateLevel3(inputs, reviewData, roiData, options, marketData, pitchId)` | 1269-2437 | Generate Level 3 HTML |

**Exports:**
```javascript
module.exports = {
    generateLevel3
};
```

**Dependencies:**
```javascript
const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const {
    adjustColor,
    truncateText,
    CONTENT_LIMITS,
    buildCssVariables,
    buildCtaTrackingScript
} = require('./htmlBuilder');
```

**Internal structure (12 slides):**
1. Title slide
2. Challenge slide (with yellow line fix)
3. Review health/sentiment analysis
4. Market intelligence (conditional)
5. Solutions overview
6. Product showcase
7. 90-day rollout
8. Package pricing
9. ROI projection
10. Why choose us
11. Next steps
12. Thank you/CTA

**Note:** This is the largest module. Future refactoring could split slides into individual functions, but that's out of scope for this phase.

---

### 2.7 `index.js` - API Handlers (Entry Point)

**Functions to move:**
| Function | Current Lines | Purpose |
|----------|---------------|---------|
| `generatePitch(req, res)` | 2446-2780 | POST /generate-pitch handler |
| `getPitch(req, res)` | 2785-2824 | GET /pitch/:pitchId handler |
| `getSharedPitch(req, res)` | 2829-2871 | GET /pitch/share/:shareId handler |
| `generatePitchDirect(data, userId)` | 2878-3054 | Direct generation (bulk upload) |
| `getDb()` | 29-31 | Firestore reference helper |
| `generateId()` | 34-36 | Unique ID generator |

**Exports:**
```javascript
module.exports = {
    generatePitch,
    generatePitchDirect,
    getPitch,
    getSharedPitch,
    // Re-export for backwards compatibility
    generateLevel1,
    generateLevel2,
    generateLevel3,
    calculateROI
};
```

**Dependencies:**
```javascript
const admin = require('firebase-admin');
const reviewAnalytics = require('../../services/reviewAnalytics');
const { calculatePitchROI, formatCurrency, safeNumber } = require('../../utils/roiCalculator');
const naics = require('../../config/naics');

const { checkPitchLimit, incrementPitchCount } = require('./validators');
const { buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData } = require('./dataEnricher');
const { generateLevel1 } = require('./level1Generator');
const { generateLevel2 } = require('./level2Generator');
const { generateLevel3 } = require('./level3Generator');
```

---

## 3. Shared State & Globals

### 3.1 Identified Globals

| Item | Current Location | Migration Strategy |
|------|------------------|-------------------|
| `admin` (firebase-admin) | Line 21 | Import in each module that needs Firestore |
| `getDb()` helper | Lines 29-31 | Move to `index.js`, pass db reference to functions needing it |
| `PITCH_LIMITS` | Lines 45-51 | Move to `validators.js` |
| `CONTENT_LIMITS` | Lines 349-356 | Move to `htmlBuilder.js` |
| `calculateROI` alias | Line 39 | Keep in `index.js`, import directly elsewhere |

### 3.2 Migration Notes

1. **Firestore Access:** Functions that need Firestore (`checkPitchLimit`, `incrementPitchCount`, `getPrecallFormEnhancement`) will import `firebase-admin` directly. The `getDb()` helper will be duplicated (3 lines) rather than creating a shared utils file.

2. **No Circular Dependencies:** The dependency graph flows one direction:
   ```
   index.js
     ├── validators.js (no dependencies on pitch modules)
     ├── dataEnricher.js (no dependencies on pitch modules)
     └── level[1-3]Generator.js
           └── htmlBuilder.js (no dependencies on pitch modules)
   ```

3. **External Service Dependencies:** These remain unchanged:
   - `reviewAnalytics` - used only in `index.js`
   - `roiCalculator` - used in `index.js` and level generators
   - `industryIntelligence` - used in level generators
   - `naics` - used only in `index.js`
   - `precallFormService` - used only in `dataEnricher.js`

---

## 4. Migration Strategy (7 Steps)

Each step produces a deployable state. Test locally and deploy after each step.

### Step 1: Create Directory & Backwards-Compatible Entry Point

**Goal:** Set up the new directory structure without changing behavior.

**Actions:**
1. Create `functions/api/pitch/` directory
2. Create `functions/api/pitch/index.js` that re-exports everything from `../pitchGenerator.js`

```javascript
// functions/api/pitch/index.js (temporary)
module.exports = require('../pitchGenerator');
```

3. Update `functions/api/index.js` to support both paths:
```javascript
// Support both old and new paths
const pitchGenerator = require('./pitchGenerator');
// Future: const pitchGenerator = require('./pitch');
```

**Deploy & Test:**
- All existing functionality works
- No API changes

**Effort:** Low (1 hour)

---

### Step 2: Extract `validators.js`

**Goal:** Move validation functions to their own module.

**Actions:**
1. Create `functions/api/pitch/validators.js` with:
   - `PITCH_LIMITS` constant
   - `checkPitchLimit(userId)`
   - `incrementPitchCount(userId)`
   - Local `getDb()` helper

2. In `pitchGenerator.js`:
   - Remove the moved functions
   - Add import: `const { PITCH_LIMITS, checkPitchLimit, incrementPitchCount } = require('./pitch/validators');`

**Deploy & Test:**
- Create pitch with free/starter/growth accounts
- Verify limit enforcement works
- Check pitch count increments

**Effort:** Low (1-2 hours)

---

### Step 3: Extract `dataEnricher.js`

**Goal:** Move data transformation functions to their own module.

**Actions:**
1. Create `functions/api/pitch/dataEnricher.js` with:
   - `buildSellerContext(sellerProfile, icpId)`
   - `getPrecallFormEnhancement(precallFormId, userId)`
   - `enhanceInputsWithPrecallData(inputs, precallData)`
   - Local `getDb()` helper

2. In `pitchGenerator.js`:
   - Remove the moved functions
   - Add import: `const { buildSellerContext, getPrecallFormEnhancement, enhanceInputsWithPrecallData } = require('./pitch/dataEnricher');`

**Deploy & Test:**
- Create pitch with custom seller profile
- Create pitch with pre-call form data
- Verify multi-ICP selection works

**Effort:** Low-Medium (2-3 hours)

---

### Step 4: Extract `htmlBuilder.js`

**Goal:** Move shared HTML utilities and create new reusable components.

**Actions:**
1. Create `functions/api/pitch/htmlBuilder.js` with:
   - `adjustColor(hex, percent)`
   - `truncateText(text, maxLength, suffix)`
   - `CONTENT_LIMITS` constant
   - NEW: `buildCssVariables(options)`
   - NEW: `buildCtaTrackingScript(pitchId)`
   - NEW: `buildStatBox(value, label)`
   - NEW: `buildBrandingFooter(hideBranding, companyName, customFooterText)`

2. In `pitchGenerator.js`:
   - Remove the moved functions/constants
   - Add import for what's needed
   - **Note:** Don't refactor level generators to use new functions yet - that comes in Steps 5-6

**Deploy & Test:**
- Generate all 3 pitch levels
- Verify colors, truncation, and CSS work correctly

**Effort:** Medium (2-3 hours)

---

### Step 5: Extract Level 1 Generator

**Goal:** Move `generateLevel1` to its own module.

**Actions:**
1. Create `functions/api/pitch/level1Generator.js`:
   - Move `generateLevel1()` function
   - Import dependencies from `htmlBuilder.js` and external modules
   - Optionally refactor to use `buildBrandingFooter()`

2. In `pitchGenerator.js`:
   - Remove `generateLevel1` function
   - Add import: `const { generateLevel1 } = require('./pitch/level1Generator');`

**Deploy & Test:**
- Generate Level 1 pitch - verify email/LinkedIn sequences
- Test with different seller profiles
- Test with trigger events
- Run full test suite

**Effort:** Low-Medium (1-2 hours)

---

### Step 6: Extract Level 2 Generator

**Goal:** Move `generateLevel2` to its own module.

**Actions:**
1. Create `functions/api/pitch/level2Generator.js`:
   - Move `generateLevel2()` function
   - Import dependencies from `htmlBuilder.js` and external modules
   - Optionally refactor to use shared components

2. In `pitchGenerator.js`:
   - Remove `generateLevel2` function
   - Add import: `const { generateLevel2 } = require('./pitch/level2Generator');`

**Deploy & Test:**
- Generate Level 2 pitch - verify one-pager layout
- Test with seller profiles
- Test with trigger events (green card injection)
- Test with booking URLs
- Run full test suite

**Effort:** Low-Medium (2-3 hours)

---

### Step 7: Extract Level 3 Generator & Finalize

**Goal:** Complete the refactoring by moving Level 3 and reorganizing the entry point.

**Actions:**
1. Create `functions/api/pitch/level3Generator.js`:
   - Move `generateLevel3()` function (~1,170 lines)
   - Import dependencies
   - Optionally refactor to use shared components

2. Move remaining code to `functions/api/pitch/index.js`:
   - `generatePitch(req, res)`
   - `getPitch(req, res)`
   - `getSharedPitch(req, res)`
   - `generatePitchDirect(data, userId)`
   - `getDb()` and `generateId()` helpers

3. Update `functions/api/index.js`:
   - Change import from `./pitchGenerator` to `./pitch`

4. **Keep** the old `pitchGenerator.js` as a re-export for backwards compatibility:
```javascript
// functions/api/pitchGenerator.js (deprecated, for backwards compatibility)
console.warn('pitchGenerator.js is deprecated. Use ./pitch instead.');
module.exports = require('./pitch');
```

5. Update any other files that import from `pitchGenerator.js`

**Deploy & Test:**
- Generate all 3 pitch levels
- Test bulk upload (uses `generatePitchDirect`)
- Test shared pitch retrieval
- Full regression test

**Effort:** Medium-High (4-6 hours)

---

## 5. Testing Checklist

Run these tests after each deployment step:

### Functional Tests
- [ ] Create Level 1 pitch (manual)
- [ ] Create Level 2 pitch (manual)
- [ ] Create Level 3 pitch (manual)
- [ ] Create pitch from market report
- [ ] Create pitch with trigger event
- [ ] Create pitch with pre-call form data
- [ ] Create pitch with custom seller profile
- [ ] Create pitch with custom branding colors
- [ ] Bulk upload pitches (CSV)
- [ ] View pitch by pitchId
- [ ] View shared pitch by shareId
- [ ] Hit pitch limit (free tier)
- [ ] Upgrade and verify new limit

### Visual Tests
- [ ] Level 1: Email sequences readable
- [ ] Level 1: LinkedIn sequences readable
- [ ] Level 2: One-pager prints to single page
- [ ] Level 2: CTA button works (booking URL)
- [ ] Level 3: All 10-12 slides render
- [ ] Level 3: Donut chart displays correctly
- [ ] Level 3: Print colors preserved
- [ ] All levels: Custom branding colors applied
- [ ] All levels: White-label mode hides PathSynch branding

### API Tests
- [ ] POST /generate-pitch returns pitchId
- [ ] GET /pitch/:pitchId returns pitch data
- [ ] GET /pitch/share/:shareId returns shared pitch
- [ ] 403 returned when limit reached
- [ ] 404 returned for invalid pitchId

---

## 6. Rollback Plan

If any step causes production issues:

1. **Immediate:** Revert the latest commit and redeploy
   ```bash
   git revert HEAD
   firebase deploy --only functions
   ```

2. **If multiple commits:** Reset to known working state
   ```bash
   git log --oneline  # Find last working commit
   git reset --hard <commit-hash>
   firebase deploy --only functions
   ```

3. **Keep old file:** Until Step 6 is complete, `pitchGenerator.js` remains the source of truth. The new modules only become canonical after Step 6.

---

## 7. Effort Summary

| Step | Description | Effort | Risk | Status |
|------|-------------|--------|------|--------|
| 1 | Create directory & entry point | 1 hr | Very Low | ✅ COMPLETE |
| 2 | Extract validators.js | 1-2 hrs | Low | ✅ COMPLETE |
| 3 | Extract dataEnricher.js | 2-3 hrs | Low | ✅ COMPLETE |
| 4 | Extract htmlBuilder.js | 2-3 hrs | Low | ✅ COMPLETE |
| 5 | Extract Level 1 generator | 1-2 hrs | Low | ✅ COMPLETE |
| 6 | Extract Level 2 generator | 2-3 hrs | Low-Medium | ✅ COMPLETE |
| 7 | Extract Level 3 & finalize | 4-6 hrs | Medium | ✅ COMPLETE |
| **Total** | | **13-20 hrs** | | ✅ ALL COMPLETE |

**Recommended Pace:** 1-2 steps per day, with testing between each.

---

## 8. Future Improvements (Out of Scope)

These are deferred to future refactoring phases:

1. **Split Level 3 slides into functions:** Each of the 12 slides could be a separate function for easier maintenance.

2. **TypeScript migration:** Add type definitions for inputs, options, and return values.

3. **Unit tests:** Add Jest tests for validators, data enrichers, and HTML builders.

4. **CSS extraction:** Move inline styles to separate CSS files or a design system.

5. **Template engine:** Consider Handlebars or similar for HTML generation.

6. **Caching:** Cache generated HTML for identical inputs.

---

## Appendix: Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                     functions/api/index.js                   │
│                    (Express router setup)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   functions/api/pitch/index.js               │
│   - generatePitch(req, res)                                  │
│   - generatePitchDirect(data, userId)                        │
│   - getPitch(req, res)                                       │
│   - getSharedPitch(req, res)                                 │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ validators.js │    │ dataEnricher.js  │    │ level[1-3]Gen.js│
│               │    │                  │    │                 │
│ checkPitchLim │    │ buildSellerCtx   │    │ generateLevel1  │
│ incrementCnt  │    │ getPrecallForm   │    │ generateLevel2  │
│ PITCH_LIMITS  │    │ enhanceInputs    │    │ generateLevel3  │
└──────────────┘    └──────────────────┘    └─────────────────┘
                                                     │
                                                     ▼
                                            ┌───────────────┐
                                            │ htmlBuilder.js │
                                            │                │
                                            │ adjustColor    │
                                            │ truncateText   │
                                            │ buildCssVars   │
                                            │ buildCta       │
                                            └───────────────┘
```

---

**Author:** Claude
**Reviewed by:** [Pending]
**Approved by:** [Pending]
