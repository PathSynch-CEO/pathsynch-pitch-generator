# Changelog — April 25, 2026: CSV Auto-Mapping, Location Parsing, Enrichment Progress

## FIX #1 — Headerless Instantly CSV Auto-Mapping

### Problem
When Instantly exports contacts without a header row (common in some export configurations),
the file's first data row was treated as headers. No columns matched any known format signature,
so `_detectFormat()` returned `'generic'` and all mappings were blank. Users had to manually
map every column.

### Root Cause
`_processFile()` always passed row 0 to `_detectFormat()` as the "headers". Headerless CSVs
have their actual data in row 0, so the header-based detection always failed. Additionally
no heuristic existed to detect the headerless Instantly format.

### Fix — `js/pages/prospectIntel.js`

**Added `instantly_headerless` to `FORMAT_SIGNATURES`:**
- `required: []` — not detected by header matching; bypasses `_detectFormat()` entirely
- `headerMap` uses positional synthetic names `col_0` through `col_5`:
  - `col_0` → `companyName`
  - `col_1` → `contactFirstName`
  - `col_2` → `contactTitle`
  - `col_3` → `contactEmail`
  - `col_4` → `city`
  - `col_5` → `contactLinkedIn`

**Added `_detectHeaderlessInstantly(cells)` helper:**
- Inspects the first row's cell values (not header names)
- Returns `true` when BOTH conditions are met:
  - Any cell matches `/linkedin\.com\/in\//i` (LinkedIn profile URL)
  - Any cell matches `/^[^,]+,\s*[^,]+,\s*(United States|US|USA|Canada|UK|Australia)/i`
    (combined "City, State, Country" location string)
- Both signals together are highly distinctive of Instantly's headerless export format

**Modified `_processFile()`:**
- Before calling `_detectFormat()`, calls `_detectHeaderlessInstantly(headers)`
- If detected: generates synthetic headers `col_0`, `col_1`, ..., `col_N`; re-includes
  the first row as data by building a `{ col_0: value, ... }` object; pushes to front of
  `_csvRawRows`; sets `_detectedFormat = 'instantly_headerless'`
- Otherwise: proceeds as before with `_detectFormat(headers)`

**Modified `_detectFormat()`:**
- Skips `instantly_headerless` key (alongside `generic`) since it's not header-matched

### Before / After
| Before | After |
|--------|-------|
| All columns unmapped for headerless Instantly CSVs | 6 columns auto-mapped (Company, Name, Title, Email, Location, LinkedIn) |
| Format label: "Generic CSV" | Format label: "Instantly (headerless)" |
| First row (real data) lost as "headers" | First row included as first prospect row |

---

## FIX #2 — Combined Location Field Parsing

### Problem
Instantly exports combine city, state, and country into a single field:
`"Winter Park, Florida, United States"`. This value was stored verbatim in the `city`
field sent to the backend, causing two issues:
1. The research agent received "Winter Park, Florida, United States" as the city — causing
   wrong search queries and city validation mismatches
2. The `state` field was left blank (no separate mapping existed)

### Root Cause
`_confirmMapping()` sent rows to the backend as-is. Combined location strings were never
split into their city/state components.

### Fix — `js/pages/prospectIntel.js` — `_confirmMapping()`

After the email-filter step and before the API call, a location-parsing pass runs on every row:

1. Checks if a `city` column is mapped
2. For each row, checks if the city column value contains commas
3. If yes, splits on commas: `parts = rawLoc.split(',').map(p => p.trim())`
4. Replaces `row[cityCol]` with `parts[0]` (the actual city name)
5. If no `state` column is mapped:
   - Writes `parts[1]` (the state name) to a synthetic field `__pi_state`
   - Adds `mappings.state = '__pi_state'` so the backend reads it correctly
6. If a `state` column IS already mapped, the existing state value is left unchanged

### Before / After
| Before | After |
|--------|-------|
| `city = "Winter Park, Florida, United States"` | `city = "Winter Park"`, `state = "Florida"` |
| Agent searched for business in "Winter Park, Florida, United States" | Agent searches for business in "Winter Park, Florida" |
| `state` always blank for Instantly exports | `state` auto-extracted from combined field |

---

## FIX #3 — Enrichment Progress Indicator

### Problem
While enrichment was running (batch status: `processing`), the UI showed no progress:
- The batch badge showed a static "Enriching" pill with no count
- The Enriched stat card showed 0 and didn't update until completion
- All rows (pending and enriched) looked identical — no visual distinction

### Fix — `js/pages/prospectIntel.js`

**`_buildBatchStatusBadge(status, done, total)` — signature extended:**
- New optional params `done` and `total`
- When `status === 'processing'` and both are provided, label becomes `"Enriching (N/M)"`
- Fallback to plain `"Enriching"` when counts are unavailable

**`_buildTableViewHTML()` — IDs added for DOM patching:**
- Badge wrapped in `<span id="pi-batch-badge">` — allows in-place badge updates
- Enriched stat card gets `id="pi-stat-enriched-card"` and value gets `id="pi-stat-enriched"`
- When status is `processing`: card gets `pi-stat-pulsing` class and label shows `"Enriched…"`

**`_listenToBatch()` — DOM updates on every Firestore snapshot:**
- On each snapshot (not just completion): patches badge HTML, enriched count, and pulsing class
  directly in the DOM — no full re-render, no scroll position loss
- Badge: `document.getElementById('pi-batch-badge').innerHTML = _buildBatchStatusBadge(status, done, total)`
- Enriched value: `document.getElementById('pi-stat-enriched').textContent = done`
- Pulsing class toggled on/off based on `d.status === 'processing'`
- Completion behavior unchanged: `this.render()` still fires on completion

**`_buildProspectRowHTML()` — skeleton cells for pending rows:**
- New `isPending` flag: `p.enrichmentStatus === 'pending' || p.enrichmentStatus === 'in_progress'`
- When pending, four cells show animated shimmer skeletons instead of data:
  - Industry column: `72×14px` skeleton bar
  - Rating column: `64×14px` skeleton bar
  - Fit Score column: `68×22px` skeleton pill (rounded)
  - Product column: `80×20px` skeleton pill (rounded)
- Company, Location, and Workflow Status columns show real data (already known from CSV)

**CSS additions in `addStyles()`:**
```css
.pi-skeleton — shimmer animation (200% wide gradient sweeping left-to-right)
@keyframes pi-shimmer — background-position sweep
.pi-stat-pulsing — opacity pulse (1 → 0.55 → 1 over 2s)
@keyframes pi-stat-pulse
```

### Before / After
| Before | After |
|--------|-------|
| Badge always shows "Enriching" (static) | Badge shows "Enriching (12/48)" and updates live |
| Enriched count stays 0 until completion | Enriched count increments as each prospect completes |
| Pending rows identical to enriched rows | Pending rows show shimmer animation on enrichment columns |
| No visual feedback during enrichment | Enriched stat card pulses with "Enriched…" label |

---

## Files Changed

| File | Changes |
|------|---------|
| `synchintro-app/js/pages/prospectIntel.js` | FIX #1: `FORMAT_SIGNATURES.instantly_headerless`, `_detectHeaderlessInstantly()`, `_processFile()` headerless branch, `_detectFormat()` skip; FIX #2: location-parsing pass in `_confirmMapping()`; FIX #3: `_buildBatchStatusBadge()` count params, `_buildTableViewHTML()` IDs + pulsing, `_listenToBatch()` DOM patching, `_buildProspectRowHTML()` skeletons, CSS shimmer + pulse |

## Files NOT Changed
- `functions/routes/prospectIntelRoutes.js` — no changes needed
- `functions/services/prospectIntelService.js` — no changes needed
- `PathSynch_Agents/prospect-research/agent.py` — changed in separate session (agent quality)

## Deploy Note
- Frontend only: `cd synchintro-app && firebase deploy --only hosting`
- No backend deploy required for these changes
