# Changelog — May 18, 2026

## fix: No-GBP Detection + LocalSynch Upsell on One-Pagers

**Backend commit `d63cb1f` | Frontend commit `86dbe96`**

### Problem

When a prospect had no Google Business Profile, the enrichment pipeline returned hardcoded fake review data (`topComplaintPattern: 'service consistency'`, `complaintFrequency: 2`). Gemini then hallucinated review quotes and complaint patterns that never existed, producing a one-pager that fabricated the prospect's reputation.

### Solution: Tri-State GBP Model

Introduced an explicit `gbpStatus: 'found' | 'not_found' | 'unknown'` model (+ `reviewDataStatus`, `hasReviewData`) that flows through the entire pipeline:

| State | Meaning | Banner? |
|-------|---------|---------|
| `found` | DataForSEO returned rating/reviewCount | No — normal flow |
| `not_found` | DataForSEO ran but returned nothing | Yes — amber banner |
| `unknown` | Source not run (timeout, credit-gate) | No — silent strip only |

The `'unknown'` state never triggers the banner — a timeout or credit-gated user must never see a false "No GBP" message.

### Files Changed

**`functions/services/templateEnrichment.js`**
- `buildDefaultAnalysis()` — replaced hardcoded fake defaults with honest nulls (`topComplaintPattern: null`, `complaintFrequency: 0`, `reviewVolumeAssessment: 'none'`, `hasReviewData: false`)
- `runTemplateEnrichment()` — tri-state computation block inserted before stat card debug log; `gbpStatus`, `reviewDataStatus`, `hasReviewData` added to both `analysis` and `enrichmentMeta` return objects
- Credit-gate early-return — spreads `buildDefaultAnalysis` with `gbpStatus: 'unknown'` override

**`functions/services/templateSectionResolver.js`**
- `resolveSection()` — hard-skips `complaintPatterns` and `customerLove` sections when no review evidence (`reviewCount === 0` AND no `reviewSnippets` AND `hasReviewData !== true`)

**`functions/services/templatePromptBuilder.js`**
- `buildAndExecuteTemplatePrompt()` — `hasReviewEvidence` const; `systemInstruction` conditionally appended with `CRITICAL — NO REVIEW DATA AVAILABLE` block; `complaintPatterns`/`lovePoints` user prompt instructions replaced with conditional `RETURN AN EMPTY ARRAY []` when the respective review arrays are empty
- `buildBatchPrompt()` — three no-review guard lines added to critical rules section

**`functions/api/pitch/templateOnePager.js`**
- `renderNoGBPBanner(sectionData)` — new function; renders amber warning + two LocalSynch plan cards
- `renderSection()` — added `case 'noGBPBanner'`
- Step 5b — reads `gbpStatus` from enrichedData; on `'not_found'` filters complaint/love sections and splices `noGBPBanner` after `statCards`; on `'unknown'` strips complaint/love silently only when `hasReviewData` is false

**`functions/services/templates/brewhouseResponseSchema.js`**
- `complaintPatterns` description — added `CRITICAL: If NO negative reviews were provided, return an EMPTY array []. Do NOT fabricate complaints.`
- `lovePoints` description — same guard; removed "Minimum 4 items." requirement

**`synchintro-app/js/l2OnePagerRenderer.js`**
- `_noGBPBanner(section)` — renders amber banner with icon, body copy, two plan cards (Local Growth + Local Authority), and CTA line; reads `d.localGrowth`/`d.localAuthority` with hardcoded defaults
- `renderHtml()` — `map.noGBPBanner ? _noGBPBanner(...) : complaint + love pair`
- `_css()` — 20 `.op-no-gbp-*` CSS rules (amber `#F59E0B` border/bg, plan grid, price typography)

### LocalSynch Upsell Defaults (when seller products not found)

| Plan | Price | Setup |
|------|-------|-------|
| LocalSynch — Local Growth | $199/mo | $299 one-time |
| LocalSynch — Local Authority | $329/mo | $599 one-time |

Seller products override defaults when a product name contains "local growth" or "local authority" (case-insensitive).
