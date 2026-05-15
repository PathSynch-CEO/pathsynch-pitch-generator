# Changelog — April 25, 2026: M2-1 NemoClaw Integration

## Overview

Wires the "Send to NemoClaw" button in Prospect Intel to the NemoClaw Outbound Engine
(PathManager backend). Approved prospects can now be sent in bulk to generate 3 parallel
sequence variants (PAS, AIDA, StoryBrand) in Campaign Drafts — nothing auto-publishes.

---

## Part 1 — Frontend: `sendToNemoClaw()` Full Implementation

**File: `synchintro-app/js/pages/prospectIntel.js`**

Replaced the stub (`API.showToast('coming in M1-4')`) with full implementation.

### `sendToNemoClaw()` — validation + entry point

1. No selection → warning toast
2. Any selected prospect is NOT approved → blocking toast:
   `"Only approved prospects can be sent to NemoClaw. X of Y selected prospects are not yet approved."`
3. All approved → calls `_confirmSendToNemoClaw(pids)`

### `_confirmSendToNemoClaw(pids)` — confirmation modal

- Header: "Send to NemoClaw Outbound Engine"
- Body: explains 3 parallel variants (PAS, AIDA, StoryBrand); notes all drafts go to
  Campaign Drafts for review before anything is sent
- Company name list: first 5 shown inline; overflow shown as "+ N more…" with scroll
- Count badge: `"N prospects selected"`
- Actions: "Cancel" (dismisses modal) / "Generate Sequences" (calls `_executeNemoClawSend`)
- Backdrop click dismisses modal

### `_executeNemoClawSend(pids)` — API call + local state update

1. Disables "Generate Sequences" button, sets label to "Sending…"
2. POSTs to `POST /prospect-intel/send-to-nemoclaw` via Firebase auth token
3. On success:
   - Updates local `_tableProspects` objects: `workflowStatus = 'sent_to_nemoclaw'`,
     `nemoClawSentAt`, `nemoClawBatchId`
   - Clears selection + hides floating action bar
   - Re-renders table body
   - Toast: "Sent X prospects to NemoClaw. View in Campaign Drafts →" (link to Campaign Drafts)
4. On error: re-enables button, shows error toast

---

## Part 2 — Backend: `POST /prospect-intel/send-to-nemoclaw`

### Service function — `sendProspectsToNemoClaw()` in `prospectIntelService.js`

**New export.** Called by the route handler.

1. Reads batch doc from `prospectIntel/{batchId}` → gets `sourceLabel`
2. Reads all prospect docs by ID via `Promise.all`
3. Builds `nemoProspects[]` array — each item:
   - `prospectId`, `companyName`, `contactName` (deduplicated same-value first/last pattern),
     `contactEmail`, `contactTitle`, `contactLinkedIn`, `city`, `state`
   - Enriched fields via `getVal()` helper: `website`, `industry`, `googleRating`, `totalReviews`,
     `tagline`, `topProducts`
   - `buyingSignals` from `signalHits[]`
   - `fitScore`, `fitLabel`, `recommendedProduct`
4. Builds payload:
   ```json
   {
     "batchLabel": "dental-atlanta — 12 prospects",
     "campaignObjective": null,
     "userId": "...",
     "prospects": [...],
     "sourceType": "prospect_intel",
     "batchId": "..."
   }
   ```
5. POSTs to `https://pathsynch.com/api/v1/campaigns/generate` with `X-Service-Key` header
   (`NEMOCLAW_SERVICE_KEY` env var)
6. On non-200: throws with status + truncated body
7. Extracts `nemoClawBatchId` from response (`result.batchId || result.id`)
8. Updates all prospect docs in 499-doc Firestore batches:
   - `workflowStatus: 'sent_to_nemoclaw'`
   - `nemoClawSentAt: serverTimestamp()`
   - `nemoClawBatchId`
   - `workflowUpdatedAt: serverTimestamp()`
9. Returns `{ success, sentCount, nemoClawBatchId }`

**Uses native `fetch` (Node 20+, consistent with `attioClient.js` / `instantlyClient.js`).**

### Route — `POST /prospect-intel/send-to-nemoclaw` in `prospectIntelRoutes.js`

- Auth: `requireAuth` (same as all other prospect-intel routes)
- Body: `{ batchId, prospectIds: string[], campaignObjective?: string }`
- Validation: `batchId` required, `prospectIds` non-empty array, max 100 prospects per call
- Ownership check: batch doc must belong to `req.userId` → 403 if not
- Calls `sendProspectsToNemoClaw()` → returns result as-is on success
- On error: 502 with `error` message (NemoClaw API errors surface as 502 not 500)

### `_serializeProspect()` updated

Added two new fields so they're returned when prospects are loaded:
```javascript
nemoClawSentAt:  d.nemoClawSentAt?.toDate?.()?.toISOString() || null,
nemoClawBatchId: d.nemoClawBatchId || null,
```

---

## Part 3 — Frontend: `sent_to_nemoclaw` Status Support

**File: `synchintro-app/js/pages/prospectIntel.js`**

### `_buildWorkflowBadge()` — new status entry

```javascript
sent_to_nemoclaw: ['pi-ws-sent-nemoclaw', 'Sent to NemoClaw'],
```

### Sent tab filter

```javascript
// Before:
if (this._tableFilter === 'sent') return ws === 'sent';
// After:
if (this._tableFilter === 'sent') return ws === 'sent' || ws === 'sent_to_nemoclaw';
```

### Sent tab count

In the tab count loop:
```javascript
if (ws === 'sent_to_nemoclaw') counts.sent++;
```

### Checkbox disabled for sent_to_nemoclaw prospects

Row checkbox: `${ws === 'sent_to_nemoclaw' ? 'disabled title="Already sent to NemoClaw"' : ''}`
Prevents selecting a prospect that has already been sent.

### Expanded row Actions — NemoClaw sent state

When `ws === 'sent_to_nemoclaw'`, the Actions section shows:
- **Sent:** timestamp (formatted with `toLocaleString()`)
- **Campaign:** first 20 chars of `nemoClawBatchId` (monospace, if present)
- **"View in Campaign Drafts →"** button linking to Campaign Drafts

When NOT `sent_to_nemoclaw`, the existing Approve / Disqualify / Retry UI is unchanged.

---

## Part 4 — `batchLabel` in NemoClaw Payload

The `batchLabel` field is computed in `sendProspectsToNemoClaw()` as:
```
"${sourceLabel} — ${count} prospect(s)"
```
e.g. `"dental-atlanta — 12 prospects"`

`sourceLabel` is read directly from the Firestore batch document (always available since it's
written at batch creation time from the CSV filename / Market Intel label).

---

## CSS Added

```css
/* Workflow badge */
.pi-ws-sent-nemoclaw   { background: #fff7ed; color: #c2410c; }          /* orange */
[data-theme="dark"] .pi-ws-sent-nemoclaw { background: rgba(234,88,12,0.18); color: #fdba74; }

/* NemoClaw confirmation modal */
.pi-nc-company-list  { margin: 14px 0 4px; }
.pi-nc-list-scroll   { max-height:120px; overflow-y:auto; border…; padding: 6px 8px; }
.pi-nc-list-item     { font-size:13px; color: var(--color-text-secondary); padding: 2px 0; }
.pi-nc-list-more     { color: var(--color-text-muted); font-style: italic; }

/* NemoClaw sent state in expanded panel */
.pi-exp-nemoclaw-sent { padding: 6px 0; }
.pi-exp-mono          { font-size: 11px; font-family: monospace; color: var(--color-text-muted); }
```

---

## New Env Var Required

| Var | Location | Purpose |
|-----|----------|---------|
| `NEMOCLAW_SERVICE_KEY` | `functions/.env` | Service-to-service auth for `X-Service-Key` header |

Add to `functions/.env`:
```
NEMOCLAW_SERVICE_KEY=<key from PathManager>
```

---

## Files Changed

| File | Changes |
|------|---------|
| `synchintro-app/js/pages/prospectIntel.js` | Part 1: `sendToNemoClaw()` + `_confirmSendToNemoClaw()` + `_executeNemoClawSend()`; Part 3: sent filter, sent count, `_buildWorkflowBadge()` entry, checkbox disabled, expanded Actions NemoClaw state, CSS |
| `pathsynch-pitch-generator/functions/services/prospectIntelService.js` | Part 2: `sendProspectsToNemoClaw()` function + export |
| `pathsynch-pitch-generator/functions/routes/prospectIntelRoutes.js` | Part 2: import, `POST /prospect-intel/send-to-nemoclaw` route, `_serializeProspect()` new fields |

## Files NOT Changed

- `pathsynch-pitch-generator/functions/index.js` — routing unchanged (router handles the new path)
- `PathSynch_Agents/prospect-research/agent.py` — no changes needed
- PathManager backend — NOT modified (SynchIntro calls PathManager's existing endpoint)

## Deploy Note

- **Frontend**: `cd synchintro-app && firebase deploy --only hosting`
- **Backend functions**: `cd pathsynch-pitch-generator && firebase deploy --only functions`
  (required — new route `POST /prospect-intel/send-to-nemoclaw`)
- **Add env var**: `NEMOCLAW_SERVICE_KEY` to `functions/.env` before deploying functions
