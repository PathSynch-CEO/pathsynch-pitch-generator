# Changelog — May 14, 2026

## Commits: `9bfe3e8` + prior commit (same session)

---

## Bug Fixes

### [P1] NAICS code shows 621 (parent) instead of 621210 for Dental Practice

**Files:** `functions/config/industryTaxonomy.json`, `functions/api/market.js`

- Added `naicsCode: "621210"` and `naicsLabel: "Offices of Dentists"` to the `dental_practice` sub-industry in `industryTaxonomy.json`
- Updated NAICS priority chain in `market.js` so sub-industry NAICS takes precedence over industry-level NAICS: `subIndustryConfig?.naicsCode || industryConfig?.naicsCode`
- Synced frontend copy: `synchintro-app/config/industryTaxonomy.json`

**Root cause:** `dental_practice` sub-industry lacked `naicsCode`/`naicsLabel` fields → fell back to parent Health & Wellness industry code (`621`). Additionally, `market.js` consulted `industryConfig?.naicsCode` before `subIndustryConfig?.naicsCode` — even with the fix in the JSON, the priority chain would have overridden it.

---

### [P1] Only 1 qualified lead in 20-competitor Nashville dental market

**Files:** `functions/services/verticalConfigs.js`

- Added new `dental_medical` vertical with `reviewCountCeiling: 500`
- Remapped dental/medical keywords in `KEYWORD_MAP` from `health_beauty` → `dental_medical`
- Added multi-word keyword entries (`"dental practice"`, `"dental office"`, `"medical practice"`, etc.) to ensure priority over `"wellness"` in `detectVertical()` length-sorted matching

**Root cause:** Two compounding issues:
1. Dental keywords (`dental`, `dentist`, etc.) were mapped to `health_beauty` vertical (ceiling 250). Nashville dental practices commonly have 300–600 reviews → nearly all filtered out.
2. `detectVertical()` sorts KEYWORD_MAP keys by length descending. For search string `"dental practice health & wellness"`, `"wellness"` (8 chars) was longer than `"dental"` (6 chars) → `health_beauty` won even after remapping. Fixed by adding multi-word entries like `"dental practice"` (15 chars).

---

### [P1] Safety ZIP resolver grabs wrong-state ZIP

**File:** `functions/api/market.js`

- Added state validation to ZIP extraction loop: only accepts a ZIP from an address if the address contains `, STATE` or ` STATE ` (using the target state abbreviation)
- Prevents cross-state ZIP mismatches (e.g., PA address providing ZIP 15576 for a Nashville TN report)

**Root cause:** ZIP resolver iterated all competitor/lead addresses without validating state. The first address with a parseable ZIP was used, regardless of state — a competitor with a Pennsylvania address yielded a PA ZIP → Zyla API 404.

---

## New Vertical: `dental_medical`

Added to `functions/services/verticalConfigs.js`:

| Property | Value |
|----------|-------|
| Key | `dental_medical` |
| Industry Name | Dental & Medical |
| Review Count Ceiling | 500 |
| Avg Ticket | $200 – $2,000 (mid: $500) |
| Customer LTV | $2,000 – $25,000 (mid: $8,000) |
| Pitch Angle | Healthcare is the highest-stakes review vertical — patients read more reviews, take longer to decide, and are most loyal once they commit. |
| Seasonal Triggers | Back-to-school checkups (Aug–Sep), Year-end insurance rush (Oct–Dec), New Year resolutions (Jan), Spring new-patient season (Mar–Apr) |
| ICP Signals | 4.0+ rating with <100 reviews; no response to negative reviews; competitor has 3x+ reviews; no online scheduling |
| Keywords | dental practice, dental office, medical practice, urgent care, orthodontist, chiropractor, dermatologist, podiatrist, pediatric, dental, dentist, chiropract, optom, optician, physician, doctor |

---

## No Frontend Changes

All fixes are backend-only. Frontend automatically benefits from the corrected report data on next generation.
