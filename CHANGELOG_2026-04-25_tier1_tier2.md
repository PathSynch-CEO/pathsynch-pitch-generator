# Changelog — April 25, 2026: Tier 1 + Tier 2 UX Fixes

## FIX #1 — Contact Name Deduplication

### Problem
Some CSV exports (particularly Instantly headerless format) put the full name in both
`contactFirstName` and `contactLastName`, resulting in "Archie Lappin Archie Lappin" in
the table row and expanded panel.

### Fix — `synchintro-app/js/pages/prospectIntel.js` — `_buildProspectRowHTML()`

Replaced the naive `[firstName, lastName].filter(Boolean).join(' ')` with a deduplication guard:

```
1. Both empty → ''
2. Only one populated → use that one
3. fn === ln (case-insensitive) → use fn (show once)
4. ln contains fn AND fn is a single word → ln is the full name, use ln
5. fn contains ln AND ln is a single word → fn is the full name, use fn
6. Otherwise → "${fn} ${ln}"
```

Rules 4 and 5 handle the common pattern where one field contains a single-word partial name
(e.g., `firstName: "Archie"`, `lastName: "Archie Lappin"`).

### Before / After
| Before | After |
|--------|-------|
| "Archie Lappin Archie Lappin" | "Archie Lappin" |
| "John John Smith" | "John Smith" |

---

## FIX #2 — Bulk "Approve All Strong Fit" Button

### Problem
There was no way to approve all high-fit prospects at once without selecting each row manually.
The floating action bar's "Approve All" only worked on selected rows.

### Fix — `synchintro-app/js/pages/prospectIntel.js`

**Button added to `_buildTableViewHTML()` toolbar:**
- Appears in `pi-table-controls` next to the search box — only shown when `strongFit > 0`
- Shows a green pill with the current count of unapproved Strong Fit prospects
- CSS: `pi-approve-strong-btn` + `pi-approve-strong-count` badge

**`_confirmApproveStrongFit()` — confirmation modal:**
- Shows prospect count at the selected threshold
- Dropdown: 50 / 60 / 70 (default) / 80 / 90 minimum Fit Score options
- Count updates live as the user changes the threshold
- Backdrop-click and Cancel both dismiss the modal

**`approveAllStrongFit(threshold)` — batch approve:**
- Filters for `!disqualified && fitScore >= threshold && status !== approved && status !== sent`
- Iterates with `await _updateProspectStatus()` (existing Firestore write)
- Toast shows count approved

**Modal CSS added:** `pi-modal-overlay`, `pi-modal-box`, `pi-modal-title`, `pi-modal-body`,
`pi-modal-count`, `pi-modal-warning`, `pi-modal-actions` — reused by FIX #7 delete modal.

### Before / After
| Before | After |
|--------|-------|
| No bulk approve — had to check rows first | "Approve Strong Fit (N)" button in toolbar |
| No threshold control | Dropdown: 50 / 60 / 70 / 80 / 90 Fit Score minimum |

---

## FIX #3 — Export CSV Improvements

### Problem
Export filenames were generic (`ProspectIntel_full_2026-04-25.csv`). The 'full' format
had columns in an arbitrary order without address, and signals were joined with `|`.

### Fix — `synchintro-app/js/pages/prospectIntel.js` — `exportCSV()`

**Filename:** `"${sourceLabel} - Full Export|Enriched|Contact List - ${date}.csv"`
- `sourceLabel` read from `this._batchMeta?.sourceLabel` (same value displayed in Recent Lists)
- Non-filename-safe characters stripped from label
- Format label mapped: `full` → "Full Export", `enriched` → "Enriched", `contact` → "Contact List"

**'full' format columns (updated):**
```
Company Name | Contact Name | Email | Job Title | Phone | Website | Address | City | State |
Industry | Rating | Review Count | Fit Score | Product Recommendation | Status |
Top Services | Buying Signals | LinkedIn URL
```
- `Contact Name` is the deduplicated single field (FIX #1 logic applied)
- `Address` extracted from `p.address` provenance object via `_formatAddress()`
- `Top Services` semicolon-joined (was `|`-joined under old column name "Signals")
- `Buying Signals` are signal labels (not raw keys) semicolon-joined

### Before / After
| Before | After |
|--------|-------|
| `ProspectIntel_full_2026-04-25.csv` | `dental-atlanta - Full Export - 2026-04-25.csv` |
| Signals column: `low_rating\|low_reviews` | Top Services + Buying Signals as separate columns |
| No Address column | Full address from enrichment |

---

## FIX #4 — Industry Classification Fallback

### Problem
When the research agent doesn't return an industry (low confidence enrichments, fast fails),
the Industry column and expanded panel showed "—".

### Fix — `synchintro-app/js/pages/prospectIntel.js`

**New `_inferIndustryFromName(bizName, services)` method:**
- 16 keyword regex rules map business name + top services text to industry categories
- Categories match the agent's allowed list (Dental, Medical/Health, Home Services, etc.)
- Returns `null` if no rule matches (preserves "—" for truly unknown)

**Applied as fallback in two places:**
1. `_buildProspectRowHTML()`: `_ev(p.industry) || _inferIndustryFromName(companyName, topProducts) || '—'`
2. `_buildExpandedRowHTML()`: same pattern for the Business Details section

### Sample keyword coverage
| Pattern | Maps to |
|---------|---------|
| hvac, heating, cooling, plumb, electrical, roofing | Home Services |
| dentist, dental, orthodont | Dental |
| doctor, clinic, chiropractic, physical therapy | Medical/Health |
| auto, oil change, tire, mechanic | Automotive |
| salon, barbershop, nail, spa, wax | Beauty/Salon |
| restaurant, pizza, cafe, bakery | Restaurant/Food Service |

---

## FIX #5 — Enriching Badge CSS Clipping

### Problem
The "Enriching (12/48)" badge was truncated to "Enrichi..." in the table header at
narrower viewport widths due to the flex container clipping overflow.

### Fix — `synchintro-app/js/pages/prospectIntel.js` — `addStyles()`

Added to `.pi-table-title-block`:
```css
flex-wrap: nowrap;
overflow: visible;
```

Added `#pi-batch-badge` rule:
```css
flex-shrink: 0;
white-space: nowrap;
overflow: visible;
```

`.pi-status-pill` already had `white-space: nowrap` — this fix ensures the parent
container never clips it.

---

## FIX #6 — Failed Prospect Visibility

### Problem
1. Failed prospects (enrichmentStatus === 'failed') did not appear in the Needs Fix tab
2. Failed rows looked identical to enriched rows — no visual indicator
3. The only Retry button was buried in the kebab dropdown menu
4. There was no way to see the error message without opening the kebab

### Fix — `synchintro-app/js/pages/prospectIntel.js`

**A — Needs Fix tab filter:**
```javascript
// Before:
return ws === 'needs_fix';
// After:
return ws === 'needs_fix' || p.enrichmentStatus === 'failed';
```
Also increments `counts.needs_fix` for failed prospects during tab count calculation.

**B — `pi-row-failed` row class:**
- Added `isFailed = p.enrichmentStatus === 'failed'` flag in `_buildProspectRowHTML()`
- Applied `pi-row-failed` class to `<tr>` when true
- CSS: `background: rgba(239,68,68,0.04)` + `border-left: 3px solid #ef4444` (red left border)

**C — Retry button in expanded Actions section:**
- When `ws === 'failed' || p.enrichmentStatus === 'failed'`:
  - Shows red `pi-exp-failed-banner` with the error message (up to 120 chars)
  - Shows a prominent red "↻ Retry Enrichment" button above the Approve/Disqualify buttons
- Uses existing `retryProspect(pid)` method (no new backend work)

**D — Note:** The `pi-exp-error` div at the bottom of Actions was kept for non-failed
enrichment errors (edge case). The failed banner supersedes it for `enrichmentStatus === 'failed'`.

### CSS added:
```css
.pi-row-failed { background: rgba(239,68,68,0.04); border-left: 3px solid #ef4444; }
.pi-exp-failed-banner { flex layout; red background/border; font-size 12px; color #991b1b }
.pi-retry-btn { background: #ef4444; color: #fff; }
```

### Before / After
| Before | After |
|--------|-------|
| Failed prospects invisible in Needs Fix tab | Failed prospects appear in Needs Fix tab with correct count |
| Failed rows look normal | Red left border + light red background |
| Retry only in kebab menu | Prominent Retry button in expanded Actions panel |
| Error message hidden | Error message in red banner inside expanded row |

---

## FIX #7 — Delete Batch

### Problem
There was no way to delete a batch from the Recent Lists. Users could accumulate unlimited
test batches with no cleanup mechanism.

### Fix

**Backend — `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js`:**

New endpoint: `DELETE /prospect-intel/batch/:batchId`

1. Verifies ownership (`batchDoc.data().userId !== userId` → 403)
2. Blocks delete if any prospect has `workflowStatus === 'sent'` → 409
3. Soft-deletes: sets `status: 'deleted'` + `deletedAt: serverTimestamp()` immediately
4. Background hard-delete: async IIFE deletes prospect subcollection in 499-doc chunks,
   then deletes the batch document. Errors logged but never returned to caller.
5. Returns `{ success: true, batchId }` after soft-delete (caller doesn't wait for hard-delete)

**Frontend — `synchintro-app/js/pages/prospectIntel.js`:**

Trash icon button added to each `pi-recent-row` in `_buildRecentListsHTML()`:
- Small icon-only button with hover: red background + red icon
- `event.stopPropagation()` prevents row click
- Calls `_confirmDeleteBatch(batchId, displayName, total)`

`_confirmDeleteBatch(batchId, displayName, total)` — confirmation modal:
- Shows batch name and prospect count
- Yellow warning banner: "Prospects approved or sent to campaigns will also be removed."
- Cancel / Delete Batch buttons

`_deleteBatch(batchId)`:
- Checks locally if any prospect has `workflowStatus === 'sent'` (for the currently-open batch)
- Calls `DELETE /prospect-intel/batch/:batchId` via `API.request()`
- On success: removes batch from `recentBatches` array in memory, clears `currentBatchId`
  if it matches, calls `this.render()` to refresh the UI
- On backend 409: shows error toast (sent prospects block delete)

### CSS added:
```css
.pi-recent-delete-btn — 28×28 icon button, color: text-muted → red on hover
```

### Before / After
| Before | After |
|--------|-------|
| No delete — batches accumulate forever | Trash icon on each Recent List row |
| — | Confirmation modal with warning about sent prospects |
| — | Soft-delete immediate; hard-delete in background |

---

## Files Changed

| File | Changes |
|------|---------|
| `synchintro-app/js/pages/prospectIntel.js` | FIX #1: contact name dedup; FIX #2: approve strong fit button + modal + method; FIX #3: exportCSV filename + full-format columns; FIX #4: `_inferIndustryFromName()` + fallback usage; FIX #5: badge CSS fix; FIX #6: needs_fix filter + row class + retry button in expanded panel + CSS; FIX #7: delete button in recent list + `_confirmDeleteBatch()` + `_deleteBatch()` + CSS |
| `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js` | FIX #7: `DELETE /prospect-intel/batch/:batchId` endpoint |

## Files NOT Changed
- `functions/services/prospectIntelService.js` — no changes needed
- `functions/routes/prospectIntelRoutes.js` — only DELETE endpoint added
- `PathSynch_Agents/prospect-research/agent.py` — no changes needed
- Any other file — not touched

## Deploy Note
- **Frontend**: `cd synchintro-app && firebase deploy --only hosting`
- **Backend functions**: `cd pathsynch-pitch-generator && firebase deploy --only functions`
  (required for FIX #7 DELETE endpoint)
- No Cloud Run deploy needed
