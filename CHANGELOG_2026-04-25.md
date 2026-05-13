# Changelog — April 25, 2026: Prospect Intel Bug Sweep + NemoClaw Integration

## Overview

Full-day session covering:
1. **4 column-mapping + delete fixes** (FIX #1-4) — `prospectIntel.js` frontend only
2. **7 Tier 1 + Tier 2 UX fixes + features** (FIX #5-11) — `prospectIntel.js` frontend + new `DELETE /batch/:batchId` backend endpoint
3. **M2-1 NemoClaw outbound integration** — frontend + backend new endpoint + new service function

---

## Part 1 — Column Mapping + Delete Button Fixes

### FIX #1 — "Exclude rows with no email" Checkbox Default

**Problem:** Checkbox hardcoded to `checked`. Email is not required for enrichment (agent works with businessName + city + state), so the default unnecessarily dropped rows.

**Changes (`js/pages/prospectIntel.js`):**
- Removed `checked` attribute from `#pi-exclude-no-email` — unchecked by default
- Removed email-filtered `filteredRows` pre-computation; `filteredRows` now equals `totalRows`
- Added `id="pi-start-enrichment-btn"` to Start Enrichment button
- `_updateRowCount()` updated logic:
  - Unchecked (default): `"N rows will be enriched"` — no change
  - Checked + email mapped + some rows lack email: `"N rows will be enriched (X excluded — no email)"` in amber
  - Checked + count reaches 0: disables Start Enrichment button with tooltip `"No rows will be enriched — uncheck the filter or map the Email column"`

---

### FIX #2 — Instantly Headerless: Explicit No-Map for Last Name + State

**Problem:** `instantly_headerless` FORMAT_SIGNATURES did not declare `contactLastName` and `state` as unmapped, risking `col_1` mapping to both First Name AND Last Name, and `col_4` to both City AND State.

**Change (`js/pages/prospectIntel.js` — `FORMAT_SIGNATURES.instantly_headerless.headerMap`):**
```javascript
contactLastName:  [],   // never auto-map — dedup logic handles name parsing
state:            [],   // never auto-map — location parser extracts from city field
```

---

### FIX #3 — Sample Values Not Showing in Column Mapping

**Problem:** SAMPLE VALUE column showed `—` for all fields after initial render, even for auto-detected columns. `_onMappingChange()` correctly reads live dropdowns but was only wired to `change` events — never called during initial render.

**Fix (`js/pages/prospectIntel.js`):**
```javascript
document.querySelectorAll('.pi-mapping-select').forEach(sel => {
    sel.addEventListener('change', () => this._onMappingChange());
});
this._onMappingChange(); // populate sample values for initial auto-mapped columns
```

---

### FIX #4 — Delete Batch Button Does Nothing

**Root cause:** `JSON.stringify(this._escHtml(displayName))` wraps the string in double-quote characters. Inside an `onclick="..."` attribute (which also uses double quotes), the inner double-quotes terminate the attribute early — the browser silently drops the malformed handler.

**Fix (`js/pages/prospectIntel.js`):**
```javascript
// BEFORE (broken):
onclick="...ProspectIntelPage._confirmDeleteBatch('${batchId}', ${JSON.stringify(this._escHtml(displayName))}, ${total})"

// AFTER (fixed):
onclick="...ProspectIntelPage._confirmDeleteBatch('${batchId}', '${this._escHtml(displayName).replace(/'/g, '&#39;')}', ${total})"
```

---

## Part 2 — Tier 1 + Tier 2 UX Fixes

### FIX #5 — Contact Name Deduplication

**Problem:** Instantly headerless exports put full name in both `contactFirstName` and `contactLastName`, resulting in "Archie Lappin Archie Lappin".

**Fix (`js/pages/prospectIntel.js` — `_buildProspectRowHTML()`):**
```
1. Both empty → ''
2. Only one populated → use that one
3. fn === ln (case-insensitive) → use fn
4. ln contains fn AND fn is single word → ln is the full name, use ln
5. fn contains ln AND ln is single word → fn is the full name, use fn
6. Otherwise → "${fn} ${ln}"
```

---

### FIX #6 — Bulk "Approve All Strong Fit" Button

**Problem:** No way to bulk-approve high-fit prospects without manually selecting rows first.

**Changes (`js/pages/prospectIntel.js`):**
- Green pill button `pi-approve-strong-btn` in `_buildTableViewHTML()` toolbar — only shown when `strongFit > 0`
- `_confirmApproveStrongFit()` — confirmation modal with threshold dropdown (50/60/70/80/90, default 70); count updates live as threshold changes
- `approveAllStrongFit(threshold)` — iterates unapproved prospects meeting threshold, calls `_updateProspectStatus()`

---

### FIX #7 — Export CSV Improvements

**Problem:** Generic filenames, arbitrary column order, signals joined with `|`.

**Changes (`js/pages/prospectIntel.js` — `exportCSV()`):**
- Filename: `"${sourceLabel} - Full Export|Enriched|Contact List - ${date}.csv"` (non-safe chars stripped)
- Full-format columns: Company Name, Contact Name (deduplicated), Email, Job Title, Phone, Website, Address, City, State, Industry, Rating, Review Count, Fit Score, Product Recommendation, Status, Top Services (`;`-joined), Buying Signals (labels, `;`-joined), LinkedIn URL

---

### FIX #8 — Industry Classification Fallback

**Problem:** Industry column showed "—" when research agent didn't return an industry.

**New method `_inferIndustryFromName(bizName, services)` (`js/pages/prospectIntel.js`):**
- 16 keyword regex rules mapping business name + top services to industry categories
- Returns `null` if no rule matches (preserves "—" for truly unknown)
- Applied as fallback in `_buildProspectRowHTML()` and `_buildExpandedRowHTML()`

**Sample coverage:**
| Pattern | Maps to |
|---------|---------|
| hvac, heating, cooling, plumb, electrical, roofing | Home Services |
| dentist, dental, orthodont | Dental |
| salon, barbershop, nail, spa | Beauty/Salon |
| restaurant, pizza, cafe, bakery | Restaurant/Food Service |

---

### FIX #9 — Enriching Badge CSS Clipping

**Problem:** "Enriching (12/48)" badge truncated to "Enrichi..." at narrower viewport widths.

**Fix (CSS in `addStyles()`):**
- `.pi-table-title-block`: `flex-wrap: nowrap; overflow: visible`
- `#pi-batch-badge`: `flex-shrink: 0; white-space: nowrap; overflow: visible`

---

### FIX #10 — Failed Prospect Visibility

**Problem:** Failed prospects didn't appear in Needs Fix tab; no visual indicator; Retry only in kebab menu; error message hidden.

**Changes (`js/pages/prospectIntel.js`):**
- Needs Fix tab filter: `ws === 'needs_fix' || p.enrichmentStatus === 'failed'`
- Tab count loop increments `counts.needs_fix` for failed prospects
- Failed rows: `pi-row-failed` class → `background: rgba(239,68,68,0.04)` + `border-left: 3px solid #ef4444`
- Expanded Actions panel for failed: red `pi-exp-failed-banner` with error message (max 120 chars); prominent red "↻ Retry Enrichment" button using existing `retryProspect()`

---

### FIX #11 — Delete Batch from Recent Lists

**Problem:** No way to delete accumulated test batches.

**Frontend (`js/pages/prospectIntel.js`):**
- Trash icon button on each `pi-recent-row` in `_buildRecentListsHTML()` — `event.stopPropagation()` prevents row click
- `_confirmDeleteBatch(batchId, displayName, total)` — confirmation modal with yellow warning: "Prospects approved or sent to campaigns will also be removed."
- `_deleteBatch(batchId)` — calls `DELETE /prospect-intel/batch/:batchId`; on success removes batch from `recentBatches[]`, clears `currentBatchId` if matched, calls `this.render()`; on 409 shows error toast (sent prospects block delete)

**Backend (`pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js`):**
- `DELETE /prospect-intel/batch/:batchId` endpoint
- Ownership check (403), sent-prospect block (409), soft-delete immediate, background hard-delete (async IIFE, 499-doc chunks, never throws to caller)
- Returns `{ success: true, batchId }` after soft-delete

---

## Part 3 — M2-1 NemoClaw Outbound Integration

### Frontend — `sendToNemoClaw()` Full Implementation

**File: `js/pages/prospectIntel.js`**

Replaced `API.showToast('coming in M1-4')` stub with full implementation.

**`sendToNemoClaw()`** — validation + entry point:
1. No selection → warning toast
2. Any selected prospect is NOT approved → blocking toast: `"Only approved prospects can be sent to NemoClaw. X of Y selected prospects are not yet approved."`
3. All approved → calls `_confirmSendToNemoClaw(pids)`

**`_confirmSendToNemoClaw(pids)`** — confirmation modal:
- Header: "Send to NemoClaw Outbound Engine"
- Body: explains 3 parallel variants (PAS, AIDA, StoryBrand); notes all drafts go to Campaign Drafts for review
- Company name list: first 5 shown inline; overflow as "+ N more…" with scroll
- Count badge: "N prospects selected"
- Actions: Cancel (dismisses) / "Generate Sequences" → `_executeNemoClawSend()`; backdrop click dismisses

**`_executeNemoClawSend(pids)`** — API call + local state:
1. Disables "Generate Sequences" button, sets label to "Sending…"
2. POSTs to `POST /prospect-intel/send-to-nemoclaw` via Firebase auth token
3. On success: updates local `_tableProspects`: `workflowStatus = 'sent_to_nemoclaw'`, `nemoClawSentAt`, `nemoClawBatchId`; clears selection + hides floating action bar; re-renders table body; toast: "Sent X prospects to NemoClaw. View in Campaign Drafts →"
4. On error: re-enables button, shows error toast

### Frontend — `sent_to_nemoclaw` Status Support

**`_buildWorkflowBadge()` — new entry:**
```javascript
sent_to_nemoclaw: ['pi-ws-sent-nemoclaw', 'Sent to NemoClaw'],
```

**Sent tab filter:**
```javascript
if (this._tableFilter === 'sent') return ws === 'sent' || ws === 'sent_to_nemoclaw';
```

**Tab count:**
```javascript
if (ws === 'sent_to_nemoclaw') counts.sent++;
```

**Row checkbox disabled:** `${ws === 'sent_to_nemoclaw' ? 'disabled title="Already sent to NemoClaw"' : ''}`

**Expanded row Actions for `sent_to_nemoclaw`:** Sent timestamp, `nemoClawBatchId` (monospace), "View in Campaign Drafts →" button. Approve/Disqualify/Retry UI hidden.

### Backend — `sendProspectsToNemoClaw()`

**File: `pathsynch-pitch-generator/functions/services/prospectIntelService.js`**

New export. Called by the route handler.

1. Reads batch doc from `prospectIntel/{batchId}` → gets `sourceLabel`
2. Reads all prospect docs by ID via `Promise.all`
3. Builds `nemoProspects[]` array — each item: `prospectId`, `companyName`, `contactName` (dedup guard for same first/last), `contactEmail`, `contactTitle`, `contactLinkedIn`, `city`, `state` + enriched via `getVal()`: `website`, `industry`, `googleRating`, `totalReviews`, `tagline`, `topProducts` + `buyingSignals` from `signalHits[]` + `fitScore`, `fitLabel`, `recommendedProduct`
4. Builds payload: `{ batchLabel: "${sourceLabel} — ${count} prospect(s)", campaignObjective: null, userId, prospects[], sourceType: "prospect_intel", batchId }`
5. POSTs to `https://pathsynch.com/api/v1/campaigns/generate` with `X-Service-Key: ${NEMOCLAW_SERVICE_KEY}` using native `fetch` (Node 20+)
6. On non-200: throws with status + truncated body (surfaces as 502 to caller)
7. Extracts `nemoClawBatchId` from response (`result.batchId || result.id`)
8. Updates all prospect docs in 499-doc Firestore batches: `workflowStatus: 'sent_to_nemoclaw'`, `nemoClawSentAt: serverTimestamp()`, `nemoClawBatchId`, `workflowUpdatedAt: serverTimestamp()`
9. Returns `{ success, sentCount, nemoClawBatchId }`

### Backend — Route + Serializer Updates

**File: `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js`**

**New route:** `POST /prospect-intel/send-to-nemoclaw`
- Auth: `requireAuth`
- Body: `{ batchId, prospectIds: string[], campaignObjective?: string }`
- Validation: `batchId` required, `prospectIds` non-empty array, max 100 prospects per call
- Ownership check: batch `userId` must match `req.userId` → 403
- Calls `sendProspectsToNemoClaw()` → returns result on success
- NemoClaw API errors → 502 (not 500)

**`_serializeProspect()` — new fields:**
```javascript
nemoClawSentAt:  d.nemoClawSentAt?.toDate?.()?.toISOString() || null,
nemoClawBatchId: d.nemoClawBatchId || null,
```

### CSS Added

```css
.pi-ws-sent-nemoclaw   { background: #fff7ed; color: #c2410c; }
[data-theme="dark"] .pi-ws-sent-nemoclaw { background: rgba(234,88,12,0.18); color: #fdba74; }
.pi-nc-company-list  { margin: 14px 0 4px; }
.pi-nc-list-scroll   { max-height:120px; overflow-y:auto; ... }
.pi-nc-list-item     { font-size:13px; ... }
.pi-nc-list-more     { color: var(--color-text-muted); font-style: italic; }
.pi-exp-nemoclaw-sent { padding: 6px 0; }
.pi-exp-mono          { font-size: 11px; font-family: monospace; }
```

---

## New Env Var Required

| Var | Location | Purpose |
|-----|----------|---------|
| `NEMOCLAW_SERVICE_KEY` | `functions/.env` | Service-to-service auth (`X-Service-Key` header) for PathManager NemoClaw endpoint |

Add to `functions/.env`:
```
NEMOCLAW_SERVICE_KEY=<key from PathManager>
```

---

## Files Changed

| File | Changes |
|------|---------|
| `synchintro-app/js/pages/prospectIntel.js` | FIX #1-4 (mapping/delete); FIX #5-11 (Tier 1+2 UX); M2-1 NemoClaw frontend |
| `pathsynch-pitch-generator/functions/services/prospectIntelService.js` | M2-1: `sendProspectsToNemoClaw()` function + export |
| `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js` | FIX #11: `DELETE /batch/:batchId`; M2-1: `POST /send-to-nemoclaw` route + import; `_serializeProspect()` new fields |

## Files NOT Changed

- `pathsynch-pitch-generator/functions/index.js` — routing unchanged (router handles new paths)
- `PathSynch_Agents/prospect-research/agent.py` — no changes needed
- PathManager backend — NOT modified (SynchIntro calls PathManager's existing endpoint)
- Any other file — not touched

---

## Deploy Notes

- **Frontend**: `cd synchintro-app && firebase deploy --only hosting`
- **Backend functions**: `cd pathsynch-pitch-generator && firebase deploy --only functions`
  (required for DELETE endpoint + POST /send-to-nemoclaw + serializer fields)
- **Add env var** before functions deploy: `NEMOCLAW_SERVICE_KEY` in `functions/.env`
