# CHANGELOG — April 28, 2026

**Firebase project:** `pathsynch-pitch-creation`
**Deployments:** Functions (3×), Hosting (2×), Cloud Run (1×)
**Tests:** 38/38 passing (geminiLeadEnricher)

---

## New Files

| File | Purpose |
|------|---------|
| `functions/geminiLeadEnricher.js` | Gemini 2.5 Flash batch lead enricher — sync + async handlers, Zod validation, Firestore auth, Insurance taxonomy |
| `functions/enrichmentJobProcessor.js` | Firestore-triggered async job processor — 50-lead chunks, 540s/1GiB |
| `functions/tests/geminiLeadEnricher.test.js` | 38 unit tests — validateSubindustry, normalizeHeadcount, inferHiringSignal, parseGeminiResponse, escapeCSVField, schema, taxonomy, async schema |
| `functions/scripts/setup-enrichment-auth.js` | One-time setup — created `config/enrichmentAuth` Firestore doc (already run, keep as reference) |
| `functions/scripts/refund-prospect-intel-credits.js` | One-time refund script — 4,950 credits to Charles (already run) |
| `synchintro-app/js/admin/pages/adminUserTeams.js` | Customer Teams admin page — health scores, member roster, lazy-loaded activity feed |

---

## Modified Files

| File | Changes |
|------|---------|
| `functions/geminiLeadEnricher.js` | Added async handlers (`asyncEnrichLeadsHandler`, `getJobStatusHandler`, `downloadJobCSVHandler`), `batchEnrichLeads()`, `resultsToInstantlyCSV()`, `AsyncEnrichRequestSchema`, constants (MAX_ASYNC_LEADS, concurrency/delay settings), updated module.exports |
| `functions/index.js` | 5 new route blocks (2 sync + 3 async enricher), `onEnrichmentJobCreated` Firestore trigger, updated enricher import to include async handlers + `processEnrichmentJob` |
| `functions/routes/teamRoutes.js` | `sendTeamInviteEmail()` call added to `POST /team/invite` (was missing — empty TODO); Firestore Timestamp serialization fixed in `GET /team` (`createdAt`/`expiresAt` → ISO strings); new `POST /team/revoke-invite` endpoint |
| `functions/routes/adminRoutes.js` | 7 new endpoints: credits topup/consumption/alerts, user-teams + activity, operational alerts, impersonate |
| `functions/routes/prospectIntelRoutes.js` | Credit deduction moved from batch creation to per-prospect success; page cap 200 → 500; `_serializeProspect()` has `nemoClawSentAt`/`nemoClawBatchId` |
| `functions/services/prospectIntelService.js` | Per-prospect credit deduction (15 credits) after `processOneProspect()` succeeds; idempotency key `prospect_enrich:{prospectId}` |
| `functions/services/verticalConfigs.js` | `insurance` added as 7th vertical in `VERTICAL_CONFIGS`; removed from `KEYWORD_MAP` Professional Services redirect; 22 insurance keywords added |
| `functions/services/opportunityBriefService.js` | v2 additions: `INDUSTRY_BRAND_PALETTES`, `extractBrandColorsFromWebsite()`, `fetchCompetitorsFromGooglePlaces()`, `haversineDistanceMi()`, `estimateVelocityLabel()`, `prospectWebsite` persisted |
| `functions/package.json` | `"zod": "^4.3.6"` added |
| `functions/CLAUDE.md` | Session entries updated for all April 28 work |
| `synchintro-app/js/pages/prospectIntel.js` | 3 new columns (Sub-Industry, Decision Maker, Headcount), 3 new expanded row sections, CSV 18 → 28 columns, Firestore fallback mapping expanded, `_inferIndustryFromName()` Insurance rule added, `limit: 500` |
| `synchintro-app/js/pages/settings.js` | Team section rewritten (real API calls vs `user.teamMembers`), role dropdown values lowercased, revoke invite button |
| `synchintro-app/js/admin/pages/adminDashboard.js` | 4 async panels: Operational Alerts, Credits & Consumption, Revenue Intelligence, Feature Adoption Matrix |
| `synchintro-app/js/admin/adminApi.js` | 7 new methods: getCreditConsumption, getCreditAlerts, topupCredits, getUserTeams, getUserTeamActivity, getOperationalAlerts, impersonateUser |
| `synchintro-app/js/admin/adminRouter.js` | `user-teams` route added |
| `synchintro-app/admin.html` | "Customer Teams" nav item + page div + script tag |
| `synchintro-app/CLAUDE.md` | Lead Enrichment API reference + evening session entries |
| `PathSynch_Agents/prospect-research/main.py` | `insurance_agency` → `Insurance` in PLACES_TYPE_TO_INDUSTRY; Insurance rule added before Financial Services in `_INDUSTRY_NAME_RULES` |
| `PathSynch_Agents/prospect-research/agent.py` | Insurance added to Step 5 allowed categories; keyword guidance added |
| `SYSTEM_BIBLE.md` | Cloud Functions manifest added; Gemini Lead Enricher section replaced "Not Yet Deployed" with full deployed architecture + async flow |
| `SynchIntro_Master_Implementation_Prompt.md` | April 28 session appended |

---

## New API Endpoints

| Method | Path | Auth | Max | Notes |
|--------|------|------|-----|-------|
| POST | `/api/v1/enrich-leads` | enrichmentAuth | 100 leads | Sync — returns JSON results |
| POST | `/api/v1/enrich-leads/export-csv` | enrichmentAuth | 100 leads | Sync — returns CSV download |
| POST | `/api/v1/enrich-leads/async` | enrichmentAuth | 1,000 leads | Async — returns `{ jobId }` immediately |
| GET | `/api/v1/enrich-leads/jobs/:jobId` | enrichmentAuth | — | Job status + results when complete |
| GET | `/api/v1/enrich-leads/jobs/:jobId/csv` | enrichmentAuth | — | CSV download (completed jobs only) |
| POST | `/api/v1/admin/credits/topup` | manager+ | — | Increment user credits + creditLedger |
| GET | `/api/v1/admin/credits/consumption` | billing+ | — | Daily consumption time series |
| GET | `/api/v1/admin/credits/alerts` | billing+ | — | Low balance + anomaly detection |
| GET | `/api/v1/admin/user-teams` | manager+ | — | Team overview with health scores |
| GET | `/api/v1/admin/user-teams/:ownerUid/activity` | manager+ | — | Last 50 activity entries |
| GET | `/api/v1/admin/alerts` | billing+ | — | Aggregate operational alerts (4 categories) |
| POST | `/api/v1/admin/impersonate` | super_admin | — | Firebase custom token for impersonation |
| POST | `/api/v1/team/revoke-invite` | owner | — | Revoke pending invitation |

---

## New Firestore Collections / Documents

| Path | Purpose | Key Fields |
|------|---------|-----------|
| `enrichmentJobs/{jobId}` | Async enrichment job tracking | `userId`, `status` (queued→processing→completed→failed), `totalLeads`, `processedCount`, `enrichedCount`, `failedCount`, `leads[]`, `results[]`, `concurrency`, `delayBetweenBatches`, `createdAt`, `startedAt`, `completedAt`, `error` |
| `config/enrichmentAuth` | Enrichment API authorization | `authorizedUids: string[]`, `updatedAt: Timestamp`, `notes: string` — already created with Charles's UID |

---

## Bug Fixes

| Issue | Fix | File(s) |
|-------|-----|---------|
| 330 insurance contacts enriched as "Professional Services" | Added `insurance` as dedicated 7th vertical; removed insurance→professional_services KEYWORD_MAP redirect; 22 insurance keywords added | `functions/services/verticalConfigs.js` |
| 4,950 credits charged upfront for failed enrichment batch | Credit deduction moved to per-prospect success path with idempotency key | `functions/routes/prospectIntelRoutes.js`, `functions/services/prospectIntelService.js` |
| Batch rows silently capped at 200 | Backend + frontend cap raised to 500 | `functions/routes/prospectIntelRoutes.js`, `synchintro-app/js/pages/prospectIntel.js` |
| "Invited Invalid Date" in team member list | Firestore Timestamps serialized to ISO strings in `GET /team` response | `functions/routes/teamRoutes.js` |
| Team invite email never sent | `sendTeamInviteEmail()` call added (function existed in email.js, was never invoked) | `functions/routes/teamRoutes.js` |
| Team Members section reads nonexistent `user.teamMembers` | Rewritten to call `API.getTeam()` + `API.getTeamInvitations()` | `synchintro-app/js/pages/settings.js` |
| Role dropdown sends `"Member"` (capitalized) — backend rejected | `value="Member"` → `value="contributor"` and all values lowercased | `synchintro-app/js/pages/settings.js` |
| Cloud Run agent classifies insurance as "Financial Services" | Three-layer fix: PLACES_TYPE_TO_INDUSTRY, _INDUSTRY_NAME_RULES, agent.py Step 5 | `PathSynch_Agents/prospect-research/main.py`, `agent.py` |
| Gemini enricher classifies Majestic Grill as "Other > Diners" | Full `PATHSYNCH_INDUSTRY_TAXONOMY` injected into Gemini prompt with examples | `functions/geminiLeadEnricher.js` |
| State Farm returns no JSON (thinking tokens leak) | `thinkingConfig: { thinkingBudget: 0 }` added to `generationConfig` | `functions/geminiLeadEnricher.js` |

---

## Infrastructure

### Cloud Functions (12 total as of April 28, 2026)

| Function | Type | Notes |
|----------|------|-------|
| `api` | HTTP (2nd Gen), 512MiB/120s | All REST endpoints including 5 enricher routes |
| `onEnrichmentJobCreated` | Firestore trigger (2nd Gen), 1GiB/540s | **NEW** — `enrichmentJobs/{jobId}` onCreate |
| `onProspectBatchCreated` | Firestore trigger (2nd Gen), 256MiB | `prospectIntel/{batchId}` onCreate → Cloud Tasks fan-out |
| `processProspectTask` | HTTP (2nd Gen), 512MiB/120s | Cloud Tasks target |
| `processThresholdAlerts` | Scheduled every 6h | Visitor intel alert sweep |
| `merchantBehaviorSync` | Scheduled Mon 09:00 UTC | Merchant behavior aggregation |
| `calibrateMerchant` | Callable | Visitor intel calibration |
| `backfillConfidenceFields` | Callable | One-time provenance backfill |
| `weeklyDigest` | Scheduled weekly | |
| `dailyDigest` | Scheduled daily | |
| `activityCleanup` | Scheduled daily | |
| `onUserCreated` | Auth trigger (1st Gen) | Welcome email via SendGrid |

### Cloud Run (separate project: pathconnect-442522)

- `prospect-research` — current revision `prospect-research-00007-ttt` (Insurance fix deployed)

### Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | `^4.3.6` | Request + response schema validation for lead enricher |

---

## Pending / Not Deployed (Carry Forward)

| Item | Status | Notes |
|------|--------|-------|
| Cloud Run agent v2 — Google Places integration | Not deployed | `main.py` changes written locally, rolled back to rev 00004. v2 source in local repo only. |
| NemoClaw service auth | Not deployed | Code written in PathManager backend. Needs `NEMOCLAW_SERVICE_KEY` added to both `functions/.env` (SynchIntro) and PathManager EC2 `.env`. |
| Team invite — re-invite Mariadeth | Pending | Stale invites deleted (fIuamHrsJHArNWNBSwih + yPrviqRZnI72J2jMud8p). Email fix deployed. Re-invite from Settings UI. |
| `enrichmentJobs/{jobId}` Firestore security rules | Not written | Collection currently has no client-side rules — only accessed via Admin SDK from Cloud Functions. Add if client-side reads are needed. |

---

## Deployed

| Target | Command | Timestamp |
|--------|---------|-----------|
| Functions (Prospect Intel + Admin) | `npx firebase deploy --only functions` | April 28, 2026 (morning) |
| Hosting (Admin panel) | `firebase deploy --only hosting` | April 28, 2026 (morning) |
| Hosting (Prospect Intel UI + Settings) | `firebase deploy --only hosting` | April 28, 2026 (evening) |
| Cloud Run agent (Insurance fix) | `gcloud run deploy prospect-research --source ...` | April 28, 2026 |
| Functions (Gemini Lead Enricher v2 sync) | `npx firebase deploy --only functions` | April 28, 2026 |
| Functions (Gemini Lead Enricher v2 async) | `npx firebase deploy --only functions` | April 28, 2026 |
| Credit refund script | `node functions/scripts/refund-prospect-intel-credits.js` | April 28, 2026 |
| Enrichment auth setup script | `node functions/scripts/setup-enrichment-auth.js` | April 28, 2026 |
