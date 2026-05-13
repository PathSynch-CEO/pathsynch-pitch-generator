# Changelog — April 25, 2026: Column Mapping + Delete Batch Fixes

## Overview

Four bug fixes to `synchintro-app/js/pages/prospectIntel.js`.
No backend changes required — all fixes are frontend-only.

---

## FIX #1 — "Exclude rows with no email" Checkbox Default

### Problem
The "Exclude rows with no email address" checkbox was hardcoded to `checked`. Since email is
not required for enrichment (the agent works with just businessName + city + state), defaulting
to checked unnecessarily dropped rows from the enrichment queue without user intent.

### Changes — `synchintro-app/js/pages/prospectIntel.js`

**Checkbox default (`_renderColumnMappingScreen`):**
- Removed `checked` attribute from `#pi-exclude-no-email` — now unchecked by default

**Pre-computed row count:**
- Removed the email-filtered `filteredRows` pre-computation (which assumed checkbox was checked)
- `filteredRows` now equals `totalRows` — matches the unchecked default state

**Start Enrichment button:**
- Added `id="pi-start-enrichment-btn"` for programmatic enable/disable

**`_updateRowCount()` — updated logic:**
- When unchecked (default): shows `"N rows will be enriched"` — no change in behavior
- When checked AND email column is mapped AND some rows lack email:
  - Shows `"N rows will be enriched (X excluded — no email)"` with amber warning
- When checked AND email column is mapped AND count drops to 0:
  - Disables the Start Enrichment button with tooltip: `"No rows will be enriched — uncheck the filter or map the Email column"`
  - Re-enables when count > 0

---

## FIX #2 — Instantly Headerless: Explicit No-Map for Last Name + State

### Problem
The `instantly_headerless` FORMAT_SIGNATURES entry did not explicitly declare
`contactLastName` and `state` as unmapped. If anything changed the fallback behavior in
`_buildInitialMappings`, `col_1` could potentially auto-map to both First Name AND Last Name,
and `col_4` could map to both City AND State.

### Changes — `FORMAT_SIGNATURES.instantly_headerless.headerMap`

Added explicit empty arrays:
```javascript
contactLastName:  [],   // never auto-map — dedup logic handles name parsing
state:            [],   // never auto-map — location parser extracts from city field
```

The location parsing in `_confirmMapping()` already handles state extraction from combined
"City, State, Country" strings by creating a synthetic `__pi_state` key when `state` is unmapped.
These explicit entries make the no-map intent unambiguous.

---

## FIX #3 — Sample Values Not Showing in Column Mapping

### Problem
The SAMPLE VALUE column in the column mapping table showed `—` for all fields after initial
render, even for auto-detected columns. The sample value HTML in `_renderColumnMappingScreen`
was static and only reflected the initial template render. The `_onMappingChange()` method
correctly reads live dropdown values and updates samples, but was only wired to `change` events
— it was never called during initial render.

### Fix

Added a call to `this._onMappingChange()` immediately after attaching change event listeners,
so the initial auto-mapped columns display their sample values on first render without requiring
the user to manually trigger a dropdown change:

```javascript
document.querySelectorAll('.pi-mapping-select').forEach(sel => {
    sel.addEventListener('change', () => this._onMappingChange());
});
this._onMappingChange(); // populate sample values for initial auto-mapped columns
```

---

## FIX #4 — Delete Batch Button Does Nothing When Clicked

### Root Cause
The delete button onclick attribute used `JSON.stringify(this._escHtml(displayName))`:

```javascript
// BROKEN — JSON.stringify wraps the string in double quotes:
// onclick="...ProspectIntelPage._confirmDeleteBatch('abc123', "My List Name", 42)"
//                                                             ^^          ^^  — breaks the HTML attribute
onclick="event.stopPropagation(); ProspectIntelPage._confirmDeleteBatch('${batchId}', ${JSON.stringify(this._escHtml(displayName))}, ${total})"
```

`JSON.stringify` wraps the string in double-quote characters (`"`). When placed inside an
`onclick="..."` attribute (which itself uses double quotes), the inner double quotes terminate
the attribute early, making the entire `onclick` syntactically invalid. The browser silently
discards the broken handler — clicking the trash icon had no effect.

### Fix

Replaced `JSON.stringify(...)` with a single-quoted JS string literal. Single quotes
inside the value are escaped as `&#39;` (HTML entity, safe in both HTML and JS):

```javascript
onclick="event.stopPropagation(); ProspectIntelPage._confirmDeleteBatch('${batchId}', '${this._escHtml(displayName).replace(/'/g, '&#39;')}', ${total})"
```

`_escHtml()` already escapes `&`, `<`, `>`, `"` — the additional `.replace(/'/g, '&#39;')`
handles single quotes that could otherwise break the single-quoted JS argument.

---

## Files Changed

| File | Changes |
|------|---------|
| `synchintro-app/js/pages/prospectIntel.js` | FIX #1: checkbox default unchecked + `_updateRowCount()` warning/disable; FIX #2: `instantly_headerless` explicit no-map for Last Name + State; FIX #3: `_onMappingChange()` called after listener attach; FIX #4: delete button onclick escaping fix |

## Files NOT Changed

- `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js` — no changes needed
- `pathsynch-pitch-generator/functions/services/prospectIntelService.js` — no changes needed
- Any other file — not touched

## Deploy Note

- **Frontend only**: `cd synchintro-app && firebase deploy --only hosting`
- No backend deploy required
