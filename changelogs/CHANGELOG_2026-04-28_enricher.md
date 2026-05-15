# Gemini Lead Enricher v2 — Deployment Changelog
**Date:** April 28, 2026
**Branch:** fix/opportunity-brief-v2-polish
**Prompts:** 2 of 2 complete

---

## Summary

Full deployment of `geminiLeadEnricher.js` — hardened batch lead enrichment via Gemini 2.5 Flash
with Google Search grounding. Supports sync (≤100 leads) and async (≤1,000 leads) modes.

---

## Prompt 1 — Core Enricher + Sync Routes

### New File: `functions/geminiLeadEnricher.js`

Batch lead enricher. Modifications from spec:
- **Modification 1:** Insurance as standalone top-level taxonomy category. Removed from Professional Services. "State Farm Insurance Agent" → `Insurance > Captive Insurance Agents`.
- **Modification 2:** Firestore-based authorization via `config/enrichmentAuth.authorizedUids`. No hardcoded UIDs. Add/remove users via Firebase Console without redeploy.

Key functions exported:
- `enrichLeadsHandler` — `POST /api/v1/enrich-leads` (max 100)
- `enrichLeadsCSVHandler` — `POST /api/v1/enrich-leads/export-csv` (max 100)
- `validateSubindustry`, `normalizeHeadcount`, `inferHiringSignal`, `parseGeminiResponse`, `escapeCSVField` (unit-tested)
- `EnrichRequestSchema`, `GeminiResponseSchema`, `PATHSYNCH_INDUSTRY_TAXONOMY`

### New File: `functions/tests/geminiLeadEnricher.test.js`
34 unit tests covering all helper functions and schema validation.

### New File: `functions/scripts/setup-enrichment-auth.js`
One-time setup — created `config/enrichmentAuth` Firestore doc. Already run.

### Modified: `functions/index.js`
- Added import for `enrichLeadsHandler`, `enrichLeadsCSVHandler`
- Added 2 route blocks in if/else chain

### Modified: `functions/package.json`
- Added `"zod": "^4.3.6"`

### Modified: `functions/CLAUDE.md`
- Added Gemini Lead Enricher section

---

## Prompt 2 — Async Job Processing

### Modified: `functions/geminiLeadEnricher.js`
Added to existing file (no existing code modified):
- Constants: `MAX_ASYNC_LEADS=1000`, `MAX_CONCURRENCY=10`, `DEFAULT_CONCURRENCY=5`, `DEFAULT_DELAY_BETWEEN_BATCHES=1000ms`, `MAX_DELAY_BETWEEN_BATCHES=5000ms`
- `AsyncEnrichRequestSchema` — Zod schema, max 1,000 leads
- `batchEnrichLeads(leads, concurrency, delayMs)` — concurrency-controlled batch enricher used by processor
- `resultsToInstantlyCSV(results)` — RFC 4180 CSV builder shared by sync and async paths
- `asyncEnrichLeadsHandler` — `POST /api/v1/enrich-leads/async`
- `getJobStatusHandler` — `GET /api/v1/enrich-leads/jobs/:jobId`
- `downloadJobCSVHandler` — `GET /api/v1/enrich-leads/jobs/:jobId/csv`

### New File: `functions/enrichmentJobProcessor.js`
Firestore-triggered job processor. Called by `onEnrichmentJobCreated`.
- Reads job doc, marks `processing`, processes leads in 50-lead chunks via `batchEnrichLeads()`
- Updates Firestore progress counters after each chunk
- Writes completed results back to job doc
- Marks `failed` with error message if any uncaught exception

### Modified: `functions/index.js`
- Updated import to include 3 async handlers + `processEnrichmentJob`
- Added 3 route blocks: async POST, jobs GET (status), jobs/csv GET
- Added `onEnrichmentJobCreated` Firestore trigger: `enrichmentJobs/{jobId}` onCreate, 1GiB memory, 540s timeout

### Modified: `functions/tests/geminiLeadEnricher.test.js`
Added 4 async schema tests (38/38 passing).

### Modified: `functions/CLAUDE.md`
Replaced core-only entry with full v2+async entry.

### Modified: `synchintro-app/CLAUDE.md`
Added Lead Enrichment API reference table.

---

## Bug Fixes Applied During This Session

### Bug 1: Gemini classifying to "Other" (prompt missing taxonomy)
- **Symptom:** Majestic Grill → `Other > Diners`, KEM Health → `Other > Medical Centers & Clinics`
- **Cause:** Prompt didn't include valid taxonomy — Gemini guessed
- **Fix:** Injected full `PATHSYNCH_INDUSTRY_TAXONOMY` into `buildEnrichmentPrompt()` with examples

### Bug 2: State Farm returning no JSON (thinking tokens)
- **Symptom:** `enrichment_status: 'failed'`, error: `"No JSON object found in response"`
- **Cause:** Gemini 2.5 Flash outputs thinking tokens by default when no `thinkingBudget` set
- **Fix:** Added `generationConfig: { thinkingConfig: { thinkingBudget: 0 } }`

**Post-fix test results: 7/7 assertions passed** (all 3 leads enriched, strict parse mode, correct taxonomy)

---

## Deployed Cloud Functions (as of April 28, 2026)

| Function | Type | Notes |
|----------|------|-------|
| `api` | HTTP (2nd Gen) | Includes all 5 enricher HTTP routes |
| `onEnrichmentJobCreated` | Firestore trigger (2nd Gen) | NEW — `enrichmentJobs/{jobId}` onCreate, 1GiB, 540s |
| `onProspectBatchCreated` | Firestore trigger (2nd Gen) | Existing |
| `processProspectTask` | HTTP (2nd Gen) | Existing |
| `processThresholdAlerts` | Scheduled (2nd Gen) | Existing |
| `merchantBehaviorSync` | Scheduled (2nd Gen) | Existing |
| `calibrateMerchant` | Callable (2nd Gen) | Existing |
| `backfillConfidenceFields` | Callable (2nd Gen) | Existing |
| `weeklyDigest` | Scheduled (2nd Gen) | Existing |
| `dailyDigest` | Scheduled (2nd Gen) | Existing |
| `activityCleanup` | Scheduled (2nd Gen) | Existing |
| `onUserCreated` | Auth trigger (1st Gen) | Existing |

---

## New Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `enrichmentJobs/{jobId}` | Async job tracking — status, progress, leads[], results[] |
| `config/enrichmentAuth` | Authorization — `{ authorizedUids: string[] }` (already existed) |

---

## API Endpoints (All 5 Live)

| Method | Path | Auth | Max | Response |
|--------|------|------|-----|----------|
| POST | `/api/v1/enrich-leads` | enrichmentAuth | 100 | JSON results |
| POST | `/api/v1/enrich-leads/export-csv` | enrichmentAuth | 100 | CSV download |
| POST | `/api/v1/enrich-leads/async` | enrichmentAuth | 1,000 | `{ jobId, status: 'queued' }` |
| GET | `/api/v1/enrich-leads/jobs/:jobId` | enrichmentAuth | — | Job status + results |
| GET | `/api/v1/enrich-leads/jobs/:jobId/csv` | enrichmentAuth | — | CSV download |
