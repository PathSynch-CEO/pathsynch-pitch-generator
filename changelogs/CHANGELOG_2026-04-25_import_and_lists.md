# Changelog — April 25, 2026: Import Prospects + Recent Lists Fix

## FIX 1 — "Untitled list" in Recent Lists sidebar

### Problem
Every batch in the Recent Lists section displayed "Untitled list" regardless of what CSV file
the user had uploaded. Users could not distinguish between batches.

### Root Cause
The renderer (`_buildRecentListsHTML`) read `batch.sourceLabel` to display the list name.
However, `sourceLabel` was never written to the Firestore batch document — it was never sent
from the frontend to the backend, and the backend never stored it.

Additionally, the renderer used `batch.id` for the Reopen button `onclick`, but the in-memory
recentBatches entry pushed after batch creation used `batchId` (not `id`) as the key, causing
"Reopen" to silently fail on freshly created batches.

### Fix

**Backend — `functions/routes/prospectIntelRoutes.js`**
- Destructure `sourceFileName` from `req.body`
- Write `sourceLabel: sourceFileName || null` on the batch Firestore document

**Frontend — `js/pages/prospectIntel.js`**

1. `_confirmMapping()` — POST body now includes `sourceFileName: this._csvSourceFile || null`
   (the filename is already stored in `this._csvSourceFile` by `_processFile()`)

2. `_confirmMapping()` — Local `recentBatches` push now includes `sourceLabel`, `id` (in addition to
   `batchId`), and `status: 'processing'` so the pill renders correctly without a Firestore roundtrip

3. `_buildRecentListsHTML()` — Full rewrite:
   - Date parsing extended to handle Firestore Timestamp, `{_seconds}` JSON shape, and ISO string
   - Status pill now treats `'completed'` and `'complete'` as the same; also matches `'in_progress'`
   - Reopen `onclick` uses `batch.id || batch.batchId` to handle both key conventions
   - **Fallback chain:** `batch.sourceLabel` → `"List from [date]"` → `"List (N prospects)"`
   - "Untitled list" never shown

### Before / After
| Before | After |
|--------|-------|
| "Untitled list" for every batch | CSV filename shown (e.g. `dental-atlanta.csv`) |
| Reopen button broken on freshly created batches | Reopen works immediately |
| Old batches with no sourceLabel showed "Untitled list" | Old batches show "List from Apr 24" |

---

## FIX 2 — "Import Prospects" button on Market Intel cards

### Problem
The "Import Prospects" button on Market Intel cards was non-functional. Clicking it showed a
toast: "Batch import coming in Session 2." No batch was created.

### Root Cause
`importFromReport()` was a stub (3 lines) with a hardcoded TODO comment. The data
transformation logic and API call were never implemented.

### Fix

**Frontend — `js/pages/prospectIntel.js` — `importFromReport()` rewritten**

Full implementation replacing the stub:

1. Collects leads and competitors from `report.data.leads` + `report.data.competitors`
2. Extracts city/state from `report.location` (handles both object `{city, state}` and string forms
   via the existing `_locationStr()` helper)
3. Extracts industry display string via the existing `_industryStr()` helper
4. Transforms each Market Intel item into a prospect row:
   - `companyName` ← `item.name`
   - `contactFirstName/LastName` ← split from `item.decisionMaker.name`
   - `contactTitle` ← `item.decisionMaker.title`
   - `contactEmail` ← `item.decisionMaker.email`
   - `companyDomain` ← `item.website`
   - `city`, `state` ← from report location
5. Builds an identity `mappings` object (`{ companyName: 'companyName', ... }`) since rows are
   already structured with the correct field names
6. POSTs to `/prospect-intel/batch` reusing the same endpoint as the CSV upload path
7. Sets `sourceFileName` to `"Market Intel — [industry] in [location]"` so the batch appears
   correctly in Recent Lists
8. Handles `INSUFFICIENT_CREDITS` (402) with the same toast as CSV upload
9. On success: sets `currentBatchId`, pushes to `recentBatches`, transitions to table view,
   starts Firestore listener — identical UX to CSV upload

### Credit Gate
The existing backend credit pre-check (deployed April 24) applies automatically — if the user
lacks credits for the number of Market Intel prospects, the 402 response is caught and a
descriptive toast is shown.

### Before / After
| Before | After |
|--------|-------|
| Toast: "Batch import coming in Session 2" | Batch created, table view opens, enrichment starts |
| No prospects imported | All leads + competitors from the report enriched |
| No entry in Recent Lists | Appears as "Market Intel — [industry] in [location]" |

---

## Files Changed

| File | Changes |
|------|---------|
| `functions/routes/prospectIntelRoutes.js` | Destructure + write `sourceLabel` from `sourceFileName` body field |
| `js/pages/prospectIntel.js` | `_confirmMapping()` body + local push; `_buildRecentListsHTML()` fallback chain + date/status fixes; `importFromReport()` full implementation |

## Not Changed
- `prospectIntelService.js` — no changes needed
- Backend batch creation logic — no changes needed
- Any other file — not touched
