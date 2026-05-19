# Changelog — May 19, 2026

## Deploy-only session (no new commits). Changes deployed to Firebase functions + hosting.

---

## Bug Fixes

### Fix 1 — Date Extraction Overcounting (`templateOnePager.js`)

**Root cause:** `dateLabelPattern` regex in Step 3f included `|New`, matching Google's "New" UI badge as a date timestamp. Diagnostic confirmed 1258 lines in pasted text, 203 matched date labels — actual review timestamps ~90.

**Fix:** Removed `|New` from `dateLabelPattern`.

```
Before: /^(...|yesterday|New)$/i
After:  /^(...|yesterday)$/i
```

**Impact:** 90-day review velocity targets corrected (~2× inflation eliminated). CTA line ("your next N reviews") now reflects accurate count.

**File:** `functions/api/pitch/templateOnePager.js`

---

### Fix 2 — Response Rate Missing "%" (`executiveBriefRenderer.js`)

**Root cause:** Smith's Olde Bar pitches route through `l2Style: 'executive_brief'` → `executiveBriefRenderer.js`, bypassing `renderStatCards()` in `templateOnePager.js` where the "%" fix previously landed.

**Fix:** Added guard in `renderStatStrip()`:
```javascript
if (/RESPONSE RATE/i.test(s.label) && /^\d+$/.test(String(s.num))) {
    displayNum = s.num + '%';
}
```

**Impact:** Response rate stat card displays "49%" instead of "49".

**File:** `functions/services/executiveBriefRenderer.js`

---

### Fix 3 — Methodology Footnote Missing from Executive Brief (`executiveBriefRenderer.js`)

**Root cause:** Same renderer bypass as Fix 2. Methodology footnote existed in `renderOnePagerHtml` but not in `executiveBriefRenderer.js`.

**Fix:** Added footnote in `renderSolution()` below product pills:
> "Methodology: Review targets based on trailing 90-day velocity from pasted Google review timestamps. Response rate calculated from owner reply patterns detected in review text."

Styled `7.5px / rgba(255,255,255,0.55)` for legibility on teal background.

**File:** `functions/services/executiveBriefRenderer.js`

---

## Feature Deploys

### Growth Snapshot — Frontend Card Live

`growth_snapshot` Smart mode card pushed live via hosting deploy. Card was already committed in `de9b08e` — needed hosting push.

- id: `growth_snapshot`
- Title: Generate Customer Growth Snapshot
- Credits: 145
- Sends: `l2Style: 'growth_snapshot'`
- Saves to Library

### Growth Snapshot — Backend Renderer (PR #14)

`growthSnapshotRenderer.js` backend renderer merged and deployed earlier in this session.

---

## Cleanup

- 3 temporary diagnostic `console.log` lines removed from `templateOnePager.js` before deploy:
  - `[TemplateOnePager] DIAGNOSTIC — total lines in pasted text:...`
  - `[TemplateOnePager] DIAGNOSTIC — first 20 matched labels:...`
  - `[TemplateOnePager] RENDERER — l2Style:...`

---

## Verification Checklist Applied

| Check | Result |
|-------|--------|
| `git diff --name-only` — only 2 expected files | PASS |
| `grep` — no DIAGNOSTIC/RENDERER logs remaining | PASS (grep exit 1 = no matches) |
| `node --check templateOnePager.js` | PASS |
| `node --check executiveBriefRenderer.js` | PASS |
| `grep dateLabelPattern` — `New` absent | PASS |
| `grep "RESPONSE RATE"` — guard present | PASS |

---

## feat: Visibility Intelligence — Enhancements 1–3

**Deploy-only session (no new commits). Functions + hosting deployed May 19, 2026.**

### Enhancement 1 — Visibility Tab Snapshot Card

**File:** `synchintro-app/js/pages/market.js`

New `renderVisibilityTabSnapshotCard(mpi, asi, wcs, avi)` renders a 4-row summary card at the TOP of the Visibility tab (before Map Pack section).

| Row | Icon | Conditional |
|-----|------|-------------|
| Map Pack | 🗺 | Always shown |
| Google Ads | 💰 | LSA badge shown when `paidSignals.localServicesAds` true |
| Website Performance | 🌐 | Only when `wcs` data present |
| AI Visibility | 🤖 | Always shown |

New CSS classes: `vis-tab-snap-card`, `vis-tab-snap-rows`, `vis-tab-snap-row`, `vis-tab-snap-icon`, `vis-tab-snap-body`, `vis-tab-snap-lbl`, `vis-tab-snap-text`, `vis-tab-snap-copy`, `vis-tab-snap-badge`, `vis-tab-snap-lsa`

`renderVisibilityTab()` updated — calls `renderVisibilityTabSnapshotCard()` as first item.

**Naming distinction:** `vis-tab-snap-*` = Visibility tab card; `vis-snapshot-*` = Overview tab card (`renderVisibilitySnapshot()`). Do not conflate.

### Enhancement 2 — PDF Export for Visibility

**File:** `synchintro-app/js/pages/market.js`

Old minimal visibility stub removed from `downloadReport()`. New "Visibility Intelligence" section added AFTER SEO Landscape section.

**PDF sections:**
- Snapshot summary bar (inline status pills)
- Map Pack table: Query | Top 3 | Known Competitors
- Google Ads table: Competitor | Status
- Website Performance table: capped at 10 rows, conditional
- AI Visibility table
- Paid Local Opportunity callout (when low ad saturation)
- Mandatory disclaimer: _"Results are directional only — AI responses vary by model, time, and query."_

### Enhancement 3 — LSA and Maps Ads Detection with Badges

**Backend files:** `functions/services/providers/adSpendProvider.js`, `functions/services/providers/mapPackProvider.js`
**Frontend file:** `synchintro-app/js/pages/market.js`

#### adSpendProvider.js

- `extractPaidItems()` — classifies `type:'local_services'` → `local_services_ad`; all defensive paid fields added
- `buildAdSpendIntelligence()` — adds `evidence[]`, `paidSignals: { searchAds, localServicesAds, mapsAds, evidence[] }`, `adSaturationPct` (numeric), `competitorAdStatus[].adSignalTypes[]`
  - `paidSignals.mapsAds` is always `false` — Maps Ads signal lives on `mapPackIntelligence.mapsAds`
- `generateAdSpendImplication()` — "detected" language throughout; accepts `paidSignals` param for LSA-aware copy

#### mapPackProvider.js

- `extractMapResults()` — now returns `{ results, mapsAdEvidence }`; detects `maps_paid_item` type + organic paid indicators
- `buildMapPackIntelligence()` — adds `mapsAds: { detected, count, evidence[] }`

#### Frontend (market.js — renderAdSpendSection)

- Per-competitor badges via `c.adSignalTypes[]`:
  - `vis-ads-badge vis-ads-search` — green (Search Ads)
  - `vis-ads-lsa` — blue (Local Services Ads)
  - `vis-ads-maps` — orange (Maps Ads)
- LSA market-level notice when `paidSignals.localServicesAds` is true
- "No paid ads were detected..." message when no signals (never claims "no one is advertising")
- New CSS: `vis-ads-badge`, `vis-ads-search`, `vis-ads-lsa`, `vis-ads-maps`, `vis-ads-none`, `vis-ads-no-paid-note` — all with `[data-theme="dark"]` variants

#### Backward Compatibility

Old cached enrichments without `adSignalTypes`/`mapsAdEvidence` handled via `|| []` fallbacks. 72h TTL expires stale records naturally.

### Data Contract Notes

| Field | Location | Type | Notes |
|-------|----------|------|-------|
| `paidSignals` | `adSpendIntelligence` | object | `mapsAds` always false here |
| `mapsAds` | `mapPackIntelligence` | object | `{ detected, count, evidence[] }` |
| `adSaturationPct` | `adSpendIntelligence` | number | Numeric form of `adSaturation` string |
| `adSignalTypes[]` | `competitorAdStatus[]` | string[] | Per-competitor signal types |

---

## Citation Source Intelligence — Phase 1 (May 19, 2026)

**Backend commit in session. Frontend commit in session. Functions + Hosting deployed.**

### Overview

New enrichment layer that extracts and classifies citation URLs returned by Gemini (grounding metadata) and Perplexity (citations array). Answers: "Which websites does AI cite most often in this market?" and "Where are this business's citation gaps?"

### Files Modified

#### `functions/services/providers/aiVisibilityProvider.js` — Full rewrite

**New domain/URL classification constants:**
- `_UGC_DOMAINS` — yelp.com, google.com, tripadvisor.com, etc.
- `_REFERENCE_DOMAINS` — yellowpages.com, angi.com, thumbtack.com, etc.
- `_EDITORIAL_DOMAINS` — healthline.com, webmd.com, nytimes.com, etc.
- `_CORPORATE_TERMS` — 'insurance', 'financial', 'bank', etc.

**Domain types (6):** `Institutional` | `UGC` | `Reference` | `Editorial` | `Corporate` | `Other`

**URL types (7):** `Homepage` | `Profile` | `Category Page` | `Article` | `Discussion` | `Comparison` | `Other`

**New helper functions:**
- `_normalizeCitationDomain(url)` — strips protocol/www/path
- `_classifyDomain(domain, leadDomains)` — returns domain type
- `_classifyUrlType(url)` — returns URL type from path patterns
- `_checkMentionsLead(url, title, leadName)` — 3-strategy match; skips names <4 chars
- `_buildCitationCollector(allQueryResults, lead)` — aggregates all citation URLs across queries
- `_buildGapAnalysis(domainMap, totalQueries)` — gap scoring: `gapScore = Math.round(retrievals × typeWeight × 10)`; only UGC/Reference/Editorial surface as gaps; weights: UGC=1.5, Reference=1.3, Editorial=1.2
- `_buildCitationIntelligence(collector, totalQueries)` — builds final `citationIntelligence` object

**`queryGeminiGrounded()`:** Now extracts `citationUrls[]` from `groundingMetadata.groundingChunks` with multi-path defensive check + try/catch fallback.

**`queryPerplexity()`:** Now extracts `citationUrls[]` from `data.citations` (array of URL strings) or `data.choices[0].message.citations`; handles both string and object formats.

**`enrichAiVisibility()`:** After all queries complete, calls `_buildCitationCollector()` then attaches `avi.citationIntelligence`.

**`citationIntelligence` object shape:**
```json
{
  "totalDomainsFound": 12,
  "totalUrlsFound": 34,
  "totalQueries": 4,
  "topDomains": [{ "domain": "yelp.com", "type": "UGC", "retrievals": 3, "citationRatePct": 75, "citationRate": 0.75 }],
  "topUrls": [{ "url": "...", "title": "...", "type": "Profile", "domain": "...", "domainType": "UGC", "mentionsLead": false, "retrievalCount": 2 }],
  "typeBreakdown": { "UGC": 5, "Reference": 3, "Editorial": 2, "Institutional": 1, "Corporate": 0, "Other": 1 },
  "gapAnalysis": [{ "domain": "yelp.com", "type": "UGC", "retrievalRate": 0.75, "gapScore": 11, "suggestedAction": "Claim and optimize your Yelp Business Page" }],
  "enrichedAt": "2026-05-19T..."
}
```

**Payload caps enforced before Firestore:** 25 domains, 50 URLs, 15 gaps.

**`DEBUG_CITATIONS` env var:** When set, logs top-level keys + citation count only — never full responses.

#### `functions/utils/reportFieldResolver.js`

Added `getCitationIntelligence(report)` resolver:
```javascript
function getCitationIntelligence(report) {
    var avi = getAiVisibilityIntelligence(report);
    return (avi && avi.citationIntelligence) || null;
}
```
Exported in `module.exports`.

#### `synchintro-app/js/pages/market.js`

**`renderVisibilityTab()`:** Added `${avi && avi.citationIntelligence ? this.renderCitationIntelligenceSection(avi) : ''}` after `renderAiVisibilitySection`.

**New `renderCitationIntelligenceSection(avi)` method:** 3 sub-sections:
1. **Citation Sources** — two-column (60% domain table + 40% type breakdown)
2. **Cited Pages** — URL table (title/type/domain/lead mention/count); "Show all" toggle for >15 URLs
3. **Citation Gaps** — gap score table or empty state; "Show all" toggle for >10 domains

Badge colors: Institutional=green, UGC=teal, Reference=purple, Editorial=blue, Corporate=orange, Other=gray

**PDF section in `downloadReport()`:** Placed after AI Visibility `sampleNote`, before Paid Local Opportunity block. 1-line summary + top 5 domains mini-table + type breakdown + top 3 gaps table. Guarded by `_ci && (_ci.topDomains||[]).length > 0`.

**New CSS in `addStyles()`:** `vis-cit-card`, `vis-cit-two-col`, `vis-cit-domains-col`, `vis-cit-type-col`, `vis-cit-section-lbl`, `vis-cit-type-badge`, `vis-cit-type-chip`, `vis-cit-type-breakdown`, `vis-cit-legend`, `vis-cit-legend-row`, `vis-cit-empty`, `vis-cit-show-more`, `vis-cit-toggle-btn`. All with dark mode variants and `@media (max-width: 640px)` responsive override.

---

## Citation Source Intelligence — Phase 2 (May 19, 2026)

**Pitch context + documentation update. Functions deployed (no hosting changes).**

### Files Modified

#### `functions/services/marketIntelPitchContext.js`

New block 11 (citation intelligence), added after nonprofit block before `return context`:
```javascript
var _avi = report.aiVisibilityIntelligence;
if (_avi && _avi.citationIntelligence) {
    var ci = _avi.citationIntelligence;
    // ... distills into context.citationInsight
}
```

**`context.citationInsight` shape:** `{ totalDomains, totalUrls, topCitedDomain, topCitedDomainType, topCitedDomainRate, dominantSourceType, gapCount, topGapDomain, topGapDomainType, topGapAction, topGapScore }`

Access pattern: `report.aiVisibilityIntelligence.citationIntelligence` (NOT `report.data.aiVisibilityIntelligence` — AI visibility fields are top-level on the report document).

#### `functions/services/pitchCompanionMd.js`

New "AI Citation Sources" conditional Markdown section after nonprofit section:
- Renders most-cited domain + type
- Renders gap count + top gap domain + recommended action
- Or: "This business is well-represented across AI-cited sources in this market."
- Guard: `if (mic.citationInsight)`

### Carry-Forward Rules

1. `citationIntelligence` is nested INSIDE `aiVisibilityIntelligence` (not a sibling). Access via `getCitationIntelligence(report)` resolver.
2. `report.aiVisibilityIntelligence` is top-level on the Firestore document — NOT under `report.data`
3. `_buildCitationCollector()` deduplicates URLs by stripping query string, fragment, and trailing slash before checking within each domain's `urlEntries[]`
4. Short business names (<4 chars) are skipped in `_checkMentionsLead()` to prevent false positive common-word matches
5. Gap analysis only surfaces UGC, Reference, and Editorial domains — Corporate/Institutional/Other are not actionable citation gaps
6. `DEBUG_CITATIONS` env var is ONLY a logging guard — never gates functionality

---

## Visibility Enrichment — All 4 Phases Activated (May 19, 2026)

All phases were already built (May 14); this session confirmed activation and smoke-tested end-to-end.

| Phase | Feature | Timeout | Flag |
|-------|---------|---------|------|
| 1A | Map Pack Rankings | 30s | `ENABLE_MAP_PACK_ENRICHMENT=true` |
| 1B | Google Ads Competition | 30s | `ENABLE_AD_SPEND_ENRICHMENT=true` |
| 2 | Website Performance (parallel PSI) | 35s | `ENABLE_WEBSITE_SIGNALS_ENRICHMENT=true` |
| 3 | AI Visibility (Gemini + Perplexity) | 25s | `ENABLE_AI_VISIBILITY_ENRICHMENT=true` |

**Serper credit exhaustion:** First smoke-test returned 0 leads — traced to Serper API at 0 credits. Topped up to 49,925 credits. Each Market Intel report consumes ~33 Serper credits.

**Perplexity API key:** Created May 19 under name `PathSynch_AI_Visibility`. Add to `functions/.env` as `PERPLEXITY_API_KEY`.

**DataForSEO creds:** `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — shared by Phase 1A (Maps SERP) and Phase 1B (Organic SERP).

---

## Peec AI — Competitive Intelligence (May 19, 2026)

Brian Hampton (King Digital Services) shared his Peec AI account during this session. Key observations:

- **Business tracked:** Brilliant Smiles, Grovetown GA — only 1 prompt configured out of 25 available
- **Metrics:** 16.7% visibility, 88 sentiment, position #3.5 on ChatGPT; 0% on Perplexity
- **Top cited domain:** grovetowndental.com (88.9% retrieved, Institutional)
- **Type breakdown:** 37% Institutional, 21% Corporate, 16% Reference, 15% Editorial, 10% UGC
- **Gap analysis:** Empty — insufficient prompt/brand config
- **Onboarding:** "Get set up: 0/5" — barely onboarded after paying for the tool
- **Brian's ask:** Stop Peec, switch to SynchIntro
- **Brian's company:** kingseoservice.com | 3 projects: Brilliant Smiles, Smile Academy Kids, kingseoservice.com

**Strategic takeaway:** SynchIntro now matches Peec's citation intelligence while adding ~16 capabilities Peec cannot offer. Daily persistence tracking (cron → PathManager merchant dashboard) is the remaining gap that matters most to the competitive narrative.

---

## Roadmap Items Discussed (May 19, 2026 — Not Built)

| Item | Description | Priority |
|------|-------------|---------|
| Daily AI visibility tracking cron | Persist daily snapshots → PathManager merchant dashboard | Next priority |
| Multi-model split | Stop merging Gemini + Perplexity results; attribute each separately | Half-day build |
| Source retrieval trend lines | Requires daily tracking cron to be built first | Depends on above |
| Custom prompt library | Agency tier feature (Q3/Q4) — auto-generated taxonomy is correct UX for local SMBs | Low |
| Claude via AWS Bedrock | Third AI visibility model using free AWS credits | Medium |
| PathManager merchant-facing AI Visibility card | Show merchants their AI citation standing in dashboard | Next priority |

---

## Carry-Forward Rules — Full List (May 19, 2026)

1. **"Detected" language:** Never say "no competitors are running ads." Always say "no paid ads were detected in the tracked queries."
2. **Domain classifier is deterministic** — extend the `_UGC_DOMAINS`, `_REFERENCE_DOMAINS`, `_EDITORIAL_DOMAINS`, `_CORPORATE_TERMS` lists in `aiVisibilityProvider.js` as needed. No AI calls for classification.
3. **`citationIntelligence` is nested inside `aiVisibilityIntelligence`** — never a sibling. Access via `getCitationIntelligence(report)` resolver.
4. **`report.aiVisibilityIntelligence` is top-level on the Firestore document** — NOT under `report.data`. Same as `mapPackIntelligence`, `adSpendIntelligence`, `websiteConversionSignals`.
5. **Gap analysis scope:** Only UGC, Reference, and Editorial domains surface as actionable gaps. Corporate/Institutional/Other excluded.
6. **Short names (<4 chars) skipped** in `_checkMentionsLead()` — prevents false positive common-word matches.
7. **`DEBUG_CITATIONS` is logging-only** — never gates functionality.
8. **Perplexity API key name:** `PathSynch_AI_Visibility` (created May 19, 2026). Env var: `PERPLEXITY_API_KEY`.
9. **DataForSEO creds shared** by Map Pack (Phase 1A) and Ad Spend (Phase 1B).
10. **Citation Rate column:** Hide in UI if all values are null.
11. **Gemini grounding chunks:** Multi-path defensive check (`groundingMetadata`/`grounding_metadata`, `groundingChunks`/`grounding_chunks`/`retrievalResults`). Always wrap in try/catch.
12. **Perplexity citations:** Check `data.citations` first, then `data.choices[0].message.citations`. Items may be strings or `{url, title}` objects.
