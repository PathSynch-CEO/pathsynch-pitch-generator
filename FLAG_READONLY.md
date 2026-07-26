# Zombie-Batch Investigation — Read-Only Flag

**Session:** b0f92051 · **Date:** 2026-07-10 · **Status:** READ-ONLY. No Firestore data modified this turn.
**Collection:** top-level `prospectIntel/{batchId}` · **Owner:** `dehiyRBCXcUUM72O211S27lfXbl1` (Charles Berry)

---

## 1. Live-state detail that doesn't match the brief

The brief describes **7 batches, all `status:'processing'`**, and expects the active count to drop **7→6** when
`4UynprL9UNQqtIbf8x5T` is cleared. Live Firestore (re-read this session) says:

- **`4UynprL9UNQqtIbf8x5T` → `status: failed`** (not `processing`). Marked terminal in an earlier approved turn of this
  same investigation. Full: `exists:true, status:failed, completedCount:0, failedCount:0, totalProspects:162`.
- **Active count is already `6`, not `7`.** The `status IN ['queued','processing']` query returns only the other six.
- **The batch list itself has NOT changed** since the prior read — same 7 IDs, same owner, same `completed:0/failed:0`,
  same Apr 24 2026 timestamps. The only drift is doc 1's status, from my earlier write — not anything the system did.
- **Consequence:** re-clearing `4UynprL9UNQqtIbf8x5T` first shows **no count change** (stays 6). To observe a live drop,
  the "one doc first" test should target a still-`processing` doc (e.g. `KDp2TfX098sa7JFPrcSp` → 6→5).

### The six still holding active slots (all `status:processing`, `completed:0`)

| batchId | status | totalProspects |
|---|---|---|
| `KDp2TfX098sa7JFPrcSp` | processing | 162 |
| `Qrvc2Fwn7gOFIvZxmnAW` | processing | 325 |
| `XW3TJFNu5o3VVJYOUuGu` | processing | 162 |
| `c50qkvxRHhzOI0LLQ2i8` | processing | 162 |
| `ocQnIJifARvd4BqdN2xn` | processing | 162 |
| `xga1GkC7mnStaIpPjvkF` | processing | 162 |

---

## 2. Two repo details that affect how the scripts must be written

- **A — Module system / location.** Repo **root** `package.json` is `"type": "module"` (ESM), but all ops scripts live in
  **`functions/scripts/`**, `functions/package.json` is **`commonjs`**, and `firebase-admin` is installed **only** in
  `functions/node_modules`. The clear script must be **CommonJS** (`require('firebase-admin')`), placed at
  **`functions/scripts/clear-stuck-batches.js`**, and run **from `functions/`** — matching
  `functions/scripts/backup-before-bootstrap.js` (`applicationDefault()` + `GOOGLE_APPLICATION_CREDENTIALS`,
  `projectId:'pathsynch-pitch-creation'`). A root-relative ESM `scripts/clear-stuck-batches.js` would fail to resolve
  `firebase-admin`.
- **B — Windows filename constraint.** A raw ISO 8601 timestamp contains colons (`2026-07-10T19:24:08.771Z`), which are
  **illegal in Windows filenames**. It must be sanitized (`:` and `.` → `-`). The backup already followed this.

---

## 3. Doc 1 anomaly — exact field-level comparison

**Yes — `4UynprL9UNQqtIbf8x5T` is in a different state than the other 6**, in both `status` value and terminal-field schema.

**Doc 1 (`4UynprL9UNQqtIbf8x5T`)** — 15 fields:
`completedCount, createdAt, currentProspect, failedCount, icpProfileId, icpProfileSnapshot, processingStartedAt,`
`productFocus, prospectIds, status, terminatedAt, terminationNote, totalProspects, updatedAt, userId`

- `status = "failed"`
- `terminatedAt = 2026-07-10T19:02:34Z`  ← my earlier write
- `terminationNote = "Manually marked failed 2026-07-10: stalled Apr 24 batch, 0 completed, freeing active-batch slot (no delete route). Read/analysis: session b0f92051."`
- `failureReason` = **absent (undefined)**
- `clearedAt` = **absent (undefined)**
- `clearedBy` = **absent (undefined)**

**A processing doc (`KDp2TfX098sa7JFPrcSp`, representative of all 6)** — 13 fields:
`completedCount, createdAt, currentProspect, failedCount, icpProfileId, icpProfileSnapshot, processingStartedAt,`
`productFocus, prospectIds, status, totalProspects, updatedAt, userId`

- `status = "processing"`
- no `terminatedAt`, no `terminationNote`, no `failureReason` / `clearedAt` / `clearedBy`

**Divergence is twofold:**
1. **Status** — doc 1 is already `failed`; the other 6 are still `processing`.
2. **Terminal-field schema** — doc 1 carries `terminatedAt` + `terminationNote` (ad-hoc audit fields). The canonical
   Step-2 schema is `failureReason` + `clearedAt` + `clearedBy`. Clearing only the 6 processing docs leaves **two
   different terminal schemas** in the collection.

**"Normalize doc 1"** = make it match the other 6's final schema (add `failureReason:'orphaned_worker_never_started_apr2026'`,
`clearedAt`, `clearedBy`; optionally remove the two orphan fields via `FieldValue.delete()`). That is a **write** — NOT done
here, only described. Equally valid alternative: leave doc 1 as-is (already terminal, slot already freed) and clear only the 6;
the schema mismatch is cosmetic.

---

## 4. Credit-charge confirmation (for the record)

Balance is decremented at `functions/services/prospectIntelService.js:709`
(`credits: FieldValue.increment(-CREDITS_PER_PROSPECT)`), inside `chargeProspectEnrichmentCreditOnce()` — **per completed
prospect**, coupled to the `completedCount` increment. **Not** at batch creation (POST handler only does a read-only
`checkCredits`, `prospectIntelRoutes.js:118`). All 7 batches have `completedCount:0` → line 709 never ran →
**0 of 1,297 prospects charged. Nothing to refund.**

---

## 5. Backup file

- **Path:** `functions/backups/stuck-batches-2026-07-10T19-24-08-771Z.json`
- **Non-empty:** yes — **51,571 bytes**, **7/7** docs captured with full data (Firestore Timestamps serialized to ISO).
- **Script:** `functions/scripts/backup-stuck-batches.js` — read-only, hardcoded 7 IDs (never a query).

---

## 6. Constraints held

- No DELETE route added (Williams' two-gate product PR — out of scope tonight).
- No reaper implemented (separate Williams task).
- No PR opened or merged.
- No credit/balance field writes.
- No prospects subcollection touched.

## 7. Open decisions before any write (Step 2/3)

1. **Which doc to clear first for the observable test** — recommend a still-`processing` doc (e.g. `KDp2TfX098sa7JFPrcSp`,
   6→5) rather than `4UynprL9UNQqtIbf8x5T` (no visible change).
2. **Normalize doc 1?** — re-write it onto `failureReason`/`clearedAt`/`clearedBy` for schema consistency, or leave as-is.
