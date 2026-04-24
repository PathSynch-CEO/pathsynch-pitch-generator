# Changelog — April 22, 2026 (Evening Session)

**Repos:** `pathsynch-pitch-generator` + `synchintro-app`
**Deployed:** Hosting + Functions (both)

---

## Product Catalog & Pricing — Complete Overhaul

### CSV & Firestore

- Built 23-product catalog CSV (`synchintro-products-FINAL-FIXED.csv`) with all pricing fields correctly populated
- Fixed `isPrimary` for `included_in_plan` products — was text strings, now clean `FALSE`
- PathManager Integrations: changed from "first 4 free" to "first 3 free" (GBP typically counts as one), `perUnitLabel` changed to "per additional integration"
- Added Replace All vs Merge confirm dialog to `importProductsFromCSV()` in `settings.js` — prevents duplicate accumulation from repeated CSV uploads
- Clean Firestore upload completed: 23 products, 18 selectable, 5 hidden as `included_in_plan`

### Frontend — `synchintro-app/js/pages/create.js`

- `_formatProductPrice()` custom block fixed: now shows `perUnitPrice` as recurring monthly alongside `setupFee`/`oneTimeFee` as setup cost
  - LocalSynch Local Growth → `$299 setup + $199/mo` ✓
  - LocalSynch Local Authority → `$599 setup + $329/mo` ✓
  - SynchMate → `$999 setup + $500/mo` ✓
- Added `locationCount` input (Number of Locations):
  - `formData.locationCount: 1` default
  - `<input type="number" id="location-count">` in product selector section
  - `updateLocationCount(value)` handler
  - Sent in request body as `locationCount`
- Added `integrationCount` input (Additional Integrations):
  - `formData.integrationCount: 0` default
  - `<input type="number" id="integration-count">` — grayed out (`opacity:0.4; pointer-events:none`) until a product with "integration" in the name is checked
  - `updateIntegrationCount(value)` handler — clamps 0–50
  - `toggleProductSelection()` extended to enable/disable wrapper + reset count when deselected
  - Sent in request body as `integrationCount`

### Backend — `functions/api/pitchGenerator.js`

- `per_unit` case: detects integration products by name (`name.toLowerCase().includes('integration')`), skips adding `perUnitPrice` to `totalMonthly` (prevents double-counting), emits descriptive line item instead
- **Integrations post-loop block (new):**
  ```
  integrationCount × perUnitPrice (default $19) → totalMonthly
  Line item: "N additional integrations — $X/mo"
  ```
  Runs BEFORE location multiplier so multi-location scales integrations correctly
- Location multiplier unchanged in logic; runs after integrations block
- Pricing order of operations: per-product loop → integrations → location multiply → output
- Verified: PathConnect Starter + LocalSynch Local Growth + NFC Card 1-Pack = **$348/mo + $338 setup** ✓

### Template — `functions/services/templateSectionResolver.js`

`product_line_items` resolution priority:
1. `resolvePath(dataContext, field.source)` — template-defined source path
2. `dataContext.pitch.selectedProducts` — actual user-selected products **(new)**
3. `aiResults.solutionPackage.products` — AI fallback (last resort)

Prevents hallucinated product names (e.g., "PathConnect Growth" appearing when only "PathConnect Starter" selected).

---

## Modal CSS Fix

**`synchintro-app/css/app.css`**

- Added `.modal-container` to existing `.modal-content` CSS rule
- Bulk Upload modal and other `modal-container` elements now render with correct background, border-radius, and shadow

---

## Landing Page — Complaint Themes Fix

**`functions/routes/landingPageRoutes.js`**

- `buildLandingPagePrompt()`: changed `pitchData.content` → `pitchData.html || pitchData.content` — was always "No content available" because pitches store HTML in `pitchData.html`
- Post-AI override: if `pitchData.reviewPitchMetrics.complaintPatterns` exists, replaces AI pain points with real complaint themes
- Diagnostic logging: pitch top-level keys, complaint theme count + values, override status

---

## PDF Export — Temp Iframe Capture

**`synchintro-app/js/pitchViewer.js`** — `downloadPDF()`

Replaced multiple failed approaches (3KB blank PDFs) with same-origin iframe capture:

| Approach | Problem |
|----------|---------|
| `visibility:hidden` div | html2canvas skips invisible elements |
| `left:-9999px` div | Blank output in many browsers |
| On-screen div | Visible flash of raw HTML |
| **Same-origin iframe** | ✓ Full CSS context, real render, no flash |

**Implementation:**
1. `<div overlay>` covers viewport with `rgba(255,255,255,0.95)` — user sees "Generating PDF..."
2. `<iframe>` at `position:fixed; width:960px; z-index:99999` — renders pitch HTML with full browser pipeline
3. `iframeDoc.write(htmlContent)` — triggers full CSS resolution (fonts, variables, `@import`)
4. Wait 1500ms + `img.onload` events
5. `html2pdf().from(iframeDoc.body)` — captures real rendered pixels
6. PDF format: `[960, max(bodyHeight, 1400)]`
7. Cleanup: remove both iframe and overlay; error handler uses z-index `querySelectorAll` as safety net

Removed: `onclone` callback (no longer needed), `left:-9999px` approach, `visibility:hidden` approach.

---

## Shareable Pitch Link — Responsive Overrides

**`synchintro-app/p/index.html`**

### CSS injection (scrollFixCSS block)
- `[style*="max-width"] { max-width: 100% !important }` — overrides inline max-width on any element
- Desktop (≥1024px): `body { max-width: 1100px; padding: 24px 40px; margin: 0 auto }`
- Tablet (768–1023px): full width, `padding: 20px 24px`
- Mobile (≤767px): `padding: 12px 8px`, `* { max-width: 100vw }`, tables/images constrained

### JS DOM manipulation (applyResponsiveOverrides)
Runs after `iframeDoc.close()` at 200ms and 800ms:
- Sets `iBody.style.maxWidth = '100%'`, `width = '100%'`, `margin = '0 auto'`
- Window-width-aware padding: 32/48px desktop, 20/24px tablet, 12/8px mobile
- First-child loop: only overrides children whose `maxWidth` is not already `'100%'` or `'none'`
- Then reads `scrollHeight` and expands iframe

### Iframe CSS
`height: calc(100vh - 60px)` → `min-height: calc(100vh - 60px); height: auto`

---

## Staff Hire

- **Mariadeth Olvida** — Part-time CSM/Outbound Support
- 20 hrs/week, $8/hr, start date April 27, 2026
- Week 1 focus: PathManager, Instantly AI, Attio onboarding
- Path: merchant onboarding ownership + outbound campaign support → full-time as company grows

---

## Known Issues — Status at End of Session

| Issue | Status |
|-------|--------|
| PDF blank pages | Fixed (iframe capture). Awaiting user test. |
| Shareable link responsive | JS DOM override deployed. Awaiting visual confirmation. |
| Solution product list hallucination | `templateSectionResolver.js` fix deployed. Needs test. |
| Landing page complaint themes | `pitchData.html` fix + override deployed. Needs test. |
| Monthly Complaints / Response Rate stat cards | Show AI-estimated values when no Market Intel attached. No fix yet. |
| Pre-call brief PDF | `briefPdfGenerator.js` — likely Puppeteer unavailability in Cloud Functions 2nd Gen. Not addressed. |
| `Sentry.setUser is not a function` | Console error on every page load. Non-blocking. Not addressed. |
| Google Drive save | Untested. May require OAuth setup. |

---

## Files Modified

### Frontend (`synchintro-app`)

| File | Change |
|------|--------|
| `js/pages/create.js` | `_formatProductPrice()` custom fix; `locationCount` + `integrationCount` state, UI, handlers, request body; `toggleProductSelection()` integration enable/disable |
| `js/pages/settings.js` | Replace All vs Merge confirm dialog in `importProductsFromCSV()` |
| `js/pitchViewer.js` | `downloadPDF()` — same-origin iframe capture, overlay, image wait, cleanup |
| `css/app.css` | `.modal-container` added to `.modal-content` rule |
| `p/index.html` | `scrollFixCSS` rewrite; `applyResponsiveOverrides()` window-width-aware; iframe CSS `height→min-height`; resize timing 200ms + 800ms |

### Backend (`pathsynch-pitch-generator/functions`)

| File | Change |
|------|--------|
| `api/pitchGenerator.js` | `per_unit` integrations exception; integrations post-loop block; location multiplier (existing, now runs after integrations) |
| `services/templateSectionResolver.js` | `product_line_items` prefers `selectedProducts` before AI fallback |
| `routes/landingPageRoutes.js` | `pitchData.html` field fix; complaint themes post-AI override |

### Data

| File | Change |
|------|--------|
| `synchintro-products-FINAL-FIXED.csv` | 23 products, clean pricing fields, correct `isPrimary` values, "first 3 free" integrations language |
