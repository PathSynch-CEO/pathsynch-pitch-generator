# Changelog — April 19, 2026

## Visitor Intel — Sprints 1–6

### New Files

#### Services & Routes
| File | Sprint | Purpose |
|------|--------|---------|
| `functions/services/visitorConfidence.js` | 1 | Provenance schema helpers + ConflictEngine (4-rule resolution) |
| `functions/api/backfillConfidenceFields.js` | 1 | One-time backfill Cloud Function for pre-schema visitor docs |
| `functions/services/urlHeuristics.js` | 2 | URL-to-intent-score mapping using merchantConfig heuristics |
| `functions/routes/merchantConfigRoutes.js` | 2 | Merchant scoring config CRUD (5 endpoints) |
| `functions/services/calibrationService.js` | 2 | Merchant calibration — baseline scoring, p75/p90, sets learningModeActive:false |
| `functions/services/visitorSignalService.js` | 2 | Core scoring + identity resolution; status ladder: learning→monitoring→warming→hot→outreach_now |
| `functions/api/generateMerchantConfig.js` | 3 | Generates public/config/{merchantId}.json from Firestore merchantConfig doc |
| `functions/routes/visitorSignalRoutes.js` | 3 | Full ingest pipeline: POST /visitor-signal/ingest, GET /visitor-accounts, GET+POST /account360/:key, POST /account360/:key/outbound, GET /account360/:key/history |
| `functions/services/alertService.js` | 4 | Threshold alert creation with deduplication; types: HOT_ACCOUNT, CONTACT_IDENTIFIED, OUTREACH_NOW |
| `functions/routes/alertRoutes.js` | 4 | Alert CRUD: GET /alerts, POST /alerts/:id/read, /action, /dismiss |
| `functions/services/entity360Bridge.js` | 5 | ONE-WAY fire-and-forget bridge to Entity360 REST API; never blocks visitor tracking |
| `functions/services/merchantBehaviorSync.js` | 5 | Weekly aggregate behavioral stats → Entity360 BEHAVIORAL_SUMMARY event |
| `functions/routes/attioRoutes.js` | 6 | POST /attio/push-account — reads Account360, pushes to Attio CRM, writes CRM_PUSH signalHistory |

#### Firebase Hosting — ps-core.js Snippet
| File | Purpose |
|------|---------|
| `public/ps-core.js` | Unified client-side tracking script (CDN-served, no cold-start) |
| `public/modules/identityResolver.js` | IPinfo.io lookup + fingerprint generation |
| `public/modules/sessionTracker.js` | Session state, bounce/depth detection |
| `public/modules/intentScorer.js` | URL-to-score mapping |
| `public/modules/eventEmitter.js` | Event batching + send to ingest endpoint |
| `public/modules/configLoader.js` | Per-merchant config JSON fetch + cache |

---

### Modified Files

#### Backend (`pathsynch-pitch-generator`)
| File | Change |
|------|--------|
| `functions/routes/visitorRoutes.js` | Plan gate fix (user.plan before user.tier); index-resilient queries (no composite orderBy) |
| `functions/api/pitchGenerator.js` | accountKey support — reads Account360 outbound_view, injects ACCOUNT INTELLIGENCE block into AI prompt |
| `functions/routes/precallBriefRoutes.js` | accountKey support — reads outbound_view, injects richer WEBSITE ACTIVITY section into brief prompt |
| `functions/index.js` | Registered: alertRoutes, attioRoutes dispatch blocks; processThresholdAlerts (6h schedule), merchantBehaviorSync (weekly), backfillConfidenceFields (callable) |
| `functions/routes/index.js` | Added all Visitor Intel endpoints to AVAILABLE_ENDPOINTS; imported + exported attioRoutes |
| `functions/routes/instantlyRoutes.js` | Added GET /instantly/vi-campaigns (global INSTANTLY_API_KEY); POST /instantly/trigger-sequence (visitor intel custom vars via direct fetch) |
| `functions/services/entity360Bridge.js` | Exported `fireEvent` (was defined but not exported) |
| `firestore.rules` | Added rules for: merchantConfig, websiteVisitors, visitorIntelSummary, Account360, notifications, pubSubThresholdLog, intentSignalsCache, categoryVelocitySnapshots, ke_credit_log, userActivityLog |
| `functions/.env` | Added: HUMBLYTICS_SITE_TOKEN, POSTHOG_API_KEY, POSTHOG_PROJECT_ID |

#### Frontend (`synchintro-app`)
| File | Change |
|------|--------|
| `js/pages/visitors.js` | Full rewrite — confidence badges, scoring layer, Why Now cards, learning mode banner, status tabs, notification bell, slide-out alerts panel, Account Workspace with Attio push + sequence trigger + push history |
| `js/api.js` | Added 10 methods: getAlerts, markAlertRead, dismissAlert, actionAlert, getAccount360, updateOutboundState, getAccountHistory, pushAccountToAttio, getInstantlyCampaigns, triggerInstantlySequence |
| `js/pages/create.js` | accountKey URL param → passed to pitch generation request body for Account360 enrichment |
| `index.html` | Humblytics snippet + PostHog snippet added before </head> |

---

### Bug Fixes

| File | Bug | Fix |
|------|-----|-----|
| `functions/api/pitch/templateOnePager.js` | Logo fallback text hardcoded as `'PathSynch Labs'` in `renderHeader()` | Changed to `${escHtml(sellerProfile?.companyName \|\| sellerProfile?.sellerContext?.companyName \|\| 'Your Company')}` |
| `functions/middleware/planGate.js` | `planHierarchy` missing `'enterprise'` — enterprise users failed all `requirePlan()` checks | Added `'enterprise'` to hierarchy array |

---

### Infrastructure

- Firebase Hosting configured to serve `public/ps-core.js` and `public/modules/` — static CDN delivery for snippet (no Cloud Function cold-start)
- `processThresholdAlerts` scheduled function sweeps `visitorIntelSummary` every 6 hours for missed threshold crossings
- `merchantBehaviorSync` runs Monday 09:00 UTC — writes BEHAVIORAL_SUMMARY + TRAFFIC_PROFILE_UPDATE events to Entity360

---

### New Environment Variables

| Variable | Added In | Purpose |
|----------|----------|---------|
| `HUMBLYTICS_SITE_TOKEN` | Sprint 4 | Humblytics analytics (frontend snippet) |
| `POSTHOG_API_KEY` | Sprint 4 | PostHog analytics (frontend snippet) |
| `POSTHOG_PROJECT_ID` | Sprint 4 | PostHog project ID |
| `ATTIO_API_KEY` | March 30 | Attio CRM V2 API (already present) |
| `INSTANTLY_API_KEY` | March 30 | Instantly global key for VI sequence trigger (already present) |
| `ENTITY360_SERVICE_URL` | April 17 | Entity360 Cloud Run URL (already present) |
| `ENTITY360_INTERNAL_API_KEY` | April 17 | Service-to-service auth key (already present) |

---

### Commits

| Commit | Repo | Description |
|--------|------|-------------|
| a45d4fd | pathsynch-pitch-generator | Visitor Intel Sprints 1–4 |
| 5566645 | synchintro-app | Visitor Intel Sprints 1–4 frontend |
| 6abc862 | pathsynch-pitch-generator | Visitor Intel Sprints 5–6 |
| 3fbdcbf | synchintro-app | Visitor Intel Sprints 5–6 frontend |
| 6c19f6e | pathsynch-pitch-generator | Bug fixes: templateOnePager logo fallback + enterprise plan hierarchy |

---

### Pending — Fayzan

- Migrate `synchintro.ai` DNS from current Amplify deployment to Firebase Hosting
- Identify server at `159.198.67.220` (possibly old Amplify origin or legacy hosting)
- SSL certificate renewal due **May 20, 2026** — confirm Firebase Hosting auto-manages cert after DNS migration
