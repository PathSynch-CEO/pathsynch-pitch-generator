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

---

## fix: No-GBP Outcome Cards Override

**Backend commit `0861e39`**

### Problem

When `gbpStatus === 'not_found'`, the standard outcome cards (e.g. "INCREASE REVENUE 23%") were still rendering — irrelevant when the prospect has no GBP presence at all.

### Solution

Step 3c added to `templateOnePager.js` — runs **before** `resolveAllSections()` — overrides `projectedOutcomes` with GBP-acquisition-specific targets when `enrichedData.enrichmentMeta?.gbpStatus === 'not_found'` (explicit string check, not boolean):

| Card | Value |
|------|-------|
| GBP CLAIMED & OPTIMIZED | Presence established |
| 4.8+ RATING TARGET | Starting from zero |
| 100% REVIEW RESPONSE RATE | Full engagement |
| 18+ NEW REVIEWS IN 90 DAYS | Momentum built |

---

## fix: Test Suite — 574 passing, 0 failing

**Commit `0861e39`**

### Changes

**`teamRoutes.test.js`** — rewritten for Schema B (`teams/{ownerUid}` document with `members[]` / `memberUids[]` arrays):
- firebase-admin mock extended: `Timestamp.fromDate`, `Timestamp.now`, `arrayUnion`, `arrayRemove` handlers
- Auto-create on update (mock returns null on first get, then creates the doc)

**`validation.js`** — `pitchLevel` field gets `.default(1)` — prevents validation failures when level is omitted

**`geminiLeadEnricher.test.js`** — wrapped in `Jest test()` block with `expect(failed).toBe(0)`

**Result:** 574 passed, 0 failed (was 561 passed, 19 failed)

---

## chore: DEBUG Log Cleanup

**Commit `0861e39`**

Removed two debug log blocks that were left from development:
- `[L2 STAT DEBUG]` block removed from `functions/services/templateSectionResolver.js`
- `[TemplateOnePager DEBUG]` statCards block removed from `functions/api/pitch/templateOnePager.js`

No behavior changes — output only.

---

## fix: Security — synchintro-app npm audit + CORS hardening

**Commits `853c4a2` (synchintro-app) + `0861e39` (functions)**

### synchintro-app
- `npm audit fix` resolved all 16 vulnerabilities including 1 critical (protobufjs ≤7.5.5, CVSS 9.8 — arbitrary code execution)
- Removed 6 packages, changed 23 packages → **0 vulnerabilities remain**
- `package-lock.json` changes committed

### functions/.env (CORS hardening)
- `NODE_ENV=production` confirmed added — without this the CORS middleware falls back to permissive wildcard origins
- `INSTANTLY_ENCRYPTION_KEY` confirmed present (AES-256 key for future Instantly API key encryption)

---

## fix: Market Intel — Crime/Safety ZIP, Velocity Scoring, Signal Bonus

**Backend commit `f610035`**

### Fix 1 — Crime/Safety ZIP Geocoding Fallback

`getSafetyContext()` was always skipping because `req.body.zipCode` is never provided when users generate by city+state. The competitor address loop (added May 14) extracts ZIPs from `address/formatted_address/vicinity` fields but these fields often omit ZIP codes.

**Added:** geocoding fallback using `GOOGLE_PLACES_API_KEY` (already in .env):
- If `resolvedZip` is still empty after the address loop AND `city` + `state` are set
- Calls Google Geocoding API: `https://maps.googleapis.com/maps/api/geocode/json?address={city,state}&key=...`
- Extracts `postal_code` component from result
- Non-blocking — wrapped in try/catch; failure logs a warning and continues

**Log lines:**
- `[MarketIntel] ZIP resolved via geocoding: 30301` — fallback succeeded
- `[MarketIntel] Geocoding ZIP fallback failed: <error>` — API error (non-fatal)

### Fix 2 — Velocity Scoring (Component C)

Component C was returning `10` (default) for all leads because:
- Only `recentReviews[0].date` was checked (not all reviews)
- `null` dates parsed by `new Date(null)` → epoch (Jan 1 1970) → `daysSinceLastReview ≈ 20,500` → C=0 (overriding the default)
- Relative strings like "2 months ago" → `NaN` → all comparisons fail → C stays 10

**Fix:** Scan all `recentReviews` entries for the most recent valid date (skip null / NaN); fall back to `lead.dataForSEO.daysSinceLastReview` (pre-computed by market.js enrichment block) if no valid dates found.

Scoring thresholds (unchanged):
- < 7 days → 20 pts
- 7–29 days → 15 pts
- 30–89 days → 8 pts
- ≥ 90 days → 0 pts
- No data → 10 pts (default)

### Fix 3 — Signal Bonus (Component E)

Two root causes:

**Root Cause A — Missing industry keywords:** `getIndustryKeywords('food & beverage')` returned `[]` because none of the 12 existing keys matched. Added 13 new entries:
`food`, `beverage`, `bar`, `nightclub`, `brewery`, `coffee`, `medical`, `insurance`, `pet`, `home service`, `landscap`, `marketing`, `tech`

**Root Cause B — Stopword false positives:** Single-word business name matches allowed common words like `park`, `social`, `house`, `bar`, `grill` to match unrelated news articles.

**Fix:** `SIGNAL_STOPWORDS` set (40+ words) + strengthened `matchSignalToLead()` logic:
- Filter name words through stopword list → `meaningfulWords`
- **Strong match:** ≥1 meaningful word OR ≥2 total word overlap → `bonus: 10` (business name match)
- **Industry match:** keyword from `getIndustryKeywords()` found in signal text → `bonus: 3`
- **No match:** `bonus: 0`

---

## Known Issues — Discovered May 18 (Assigned to Williams)

| Issue | Status |
|-------|--------|
| DataForSEO returning 404 on `/business_data/google/reviews/live/advanced` — all review enrichment blocked | Assigned to Williams |
| Census API returning `missing_key.html` instead of JSON — `CENSUS_API_KEY` needs verification | Assigned to Williams |
| Missing Firestore composite index for `marketReports`: `location.city + userId + createdAt` | Link sent to Williams |
| Safety geocoding fallback deployed but not verified firing — `city`/`state` variables may be empty at call site | Needs log verification |

**Personnel change:** Williams (`dev1@pathsynch.com`) has replaced Fayzan as solutions architect. Williams reviews `pathsynch-pitch-generator` PRs.
