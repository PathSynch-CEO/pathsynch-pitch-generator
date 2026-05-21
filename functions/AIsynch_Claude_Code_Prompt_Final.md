# AIsynch Build — Prompt 1 of 6: Phase 0 Pre-Work

## STOP CONDITIONS — READ FIRST

Execute **PHASE 0 ONLY**.

- Do NOT start Phase 1A.  
- Do NOT deploy to Firebase.  
- Do NOT push to main.  
- Do NOT modify frontend repos.  
- Do NOT touch Stripe or billing.  
- Do NOT touch PathManager EC2.

**Goal:** Create a clean Phase 0 changeset that:

1. Updates `aiVisibilityProvider.js` (items 0A–0E)  
2. Updates `firestore.indexes.json` (item 0C)  
3. Passes `node --check`  
4. Passes `npx jest --no-coverage`  
5. Shows diffs  
6. **STOPS for human review**

After all Phase 0 gates pass, summarize:

- Files changed (with line counts)  
- Tests run and results  
- Risks or assumptions  
- Exact deploy commands I should run manually

Then **STOP**. Do not proceed further.

---

## PHASE \-1 — PREFLIGHT (Do not modify any files)

Before touching any code, verify the workspace is clean and safe. Run each check and report the result. If anything is unsafe, STOP and report the issue.

```
cd C:\Users\tdh35\pathsynch-pitch-generator

PREFLIGHT 1: git branch
  Report current branch name.

PREFLIGHT 2: git status
  PASS: working tree clean, no uncommitted changes
  WARN: uncommitted changes exist — list them and ask for approval before proceeding

PREFLIGHT 3: Confirm directories exist
  Test-Path functions\services\providers\aiVisibilityProvider.js
  Test-Path firestore.indexes.json
  Test-Path functions\CLAUDE.md
  Test-Path functions\SYSTEM_BIBLE.md
  Test-Path functions\AIsynch_Technical_Architecture_v2.md
  PASS: all exist
  FAIL: report missing files, STOP

PREFLIGHT 4: Node and npm versions
  node --version
  npm --version
  PASS: Node 18+ and npm 9+
  WARN: older versions may cause issues

PREFLIGHT 5: Firebase CLI
  firebase --version
  PASS: firebase-tools installed
  FAIL: report, STOP

PREFLIGHT 6: Firebase project alias
  firebase use --project pathsynch-pitch-creation
  PASS: project set correctly
  FAIL: report, STOP

PREFLIGHT 7: Read context files
  cd functions
  Read CLAUDE.md — note the latest session date and any warnings
  Read SYSTEM_BIBLE.md — confirm Gemini model hierarchy matches hard rules above
  Read AIsynch_Technical_Architecture_v2.md — Phase 0 section only
  Report: "Context files read. Latest session: [date]. No conflicts found." or report conflicts.

PREFLIGHT 8: Validate existing firestore.indexes.json
  cd C:\Users\tdh35\pathsynch-pitch-generator
  node -e "const f = require('fs').readFileSync('firestore.indexes.json', 'utf8'); const j = JSON.parse(f); console.log('Valid JSON — ' + j.indexes.length + ' existing indexes')"
  PASS: valid JSON with index count
  FAIL: existing file is broken — STOP, do not edit a broken file

PREFLIGHT 9: Baseline test count
  cd functions
  npx jest --no-coverage
  Record total test count and pass/fail. Expected: 661+ passing, 0 failing.
  FAIL: existing tests are failing — STOP, do not add changes on top of a failing baseline
```

Report all preflight results. If all pass, proceed to Phase 0\. If any FAIL, STOP.

---

## WORKING DIRECTORY

All Phase 0 commands run from:

```
cd C:\Users\tdh35\pathsynch-pitch-generator\functions
```

Set this as your working directory before doing anything. Every file path below is relative to this directory. Do not use repo-root-relative paths.

---

## HARD RULES

- Sequential PowerShell commands only. NEVER use `&&` chaining.  
- Plain JavaScript CommonJS. No TypeScript. No ES modules.  
- `STRIPE_SECRETE_KEY` is an intentional typo — do NOT correct it.  
- Gemini model hierarchy: PRIMARY `gemini-3-flash-preview`, SIMPLE `gemini-2.5-flash`. NEVER USE `gemini-1.5-x`, `gemini-2.0-x`, `gemini-3-pro-preview`.  
- Firebase project: `pathsynch-pitch-creation`. GCP project: `pathconnect-442522`.  
- Line numbers in this prompt are hints only. Search by function name or code pattern first. If line numbers differ from what you find, do not stop — locate the equivalent code by symbol/search.

---

## BEFORE YOU START

1. `cd C:\Users\tdh35\pathsynch-pitch-generator\functions`  
2. Read `CLAUDE.md` — contains codebase conventions, recent session history, known bugs  
3. Read `SYSTEM_BIBLE.md` — contains architecture constants, env vars, model hierarchy  
4. Read `AIsynch_Technical_Architecture_v2.md` — Phase 0 section (Build Phases → Phase 0\)  
5. Run `npx jest --no-coverage` and record the baseline test count (expected: 661+)

---

## PHASE 0 — Pre-Work

Five targeted changes to `services/providers/aiVisibilityProvider.js` plus Firestore index additions.

### 0A — Export lower-level functions

Search for `module.exports = { enrichAiVisibility };` at the bottom of `services/providers/aiVisibilityProvider.js`.

Change to:

```javascript
module.exports = {
  enrichAiVisibility,
  queryGeminiGrounded,
  queryPerplexity,
  _buildCitationCollector,
  _buildCitationIntelligence,
  _buildGapAnalysis,
  _classifyDomain,
  _classifyUrlType
};
```

**Why:** The AIsynch monitoring cron (Phase 1B) needs to call `queryGeminiGrounded` and `queryPerplexity` independently (parallel queries, not fallback) and reuse the citation analysis functions. Exporting underscore-prefixed helpers is acceptable for now — they'll be wrapped behind a cleaner public interface in a later session if needed.

### 0B — Fix citation grounding domain bug

Search for `_CORPORATE_TERMS` array in `services/providers/aiVisibilityProvider.js`. Add this new array immediately after it:

```javascript
const _INTERNAL_GROUNDING_DOMAINS = [
  'vertexaisearch.cloud.google.com',
  'vertexai.google.com',
  'generativelanguage.googleapis.com'
];
```

Then search for the function `_buildCitationCollector`. Inside the URL processing loop, find the line:

```javascript
var domain = _normalizeCitationDomain(urlItem.uri);
```

Add this exclusion check immediately after that line (and before the `if (!domain)` check or the `if (!citationCollector[domain])` block):

```javascript
var isInternal = false;
for (var gi = 0; gi < _INTERNAL_GROUNDING_DOMAINS.length; gi++) {
  if (domain === _INTERNAL_GROUNDING_DOMAINS[gi] || domain.endsWith('.' + _INTERNAL_GROUNDING_DOMAINS[gi])) {
    isInternal = true; break;
  }
}
if (isInternal) continue;
```

**Why:** Gemini grounding chunks include internal Google infrastructure URLs (vertexaisearch.cloud.google.com) that get classified as "UGC" and inflate retrieval counts. The Charlotte NC report showed 1033% retrieved for this domain. This filter prevents that.

### 0C — Add Firestore indexes

The file `firestore.indexes.json` is at the repo root: `C:\Users\tdh35\pathsynch-pitch-generator\firestore.indexes.json` (NOT inside `functions/`).

Search for the closing `]` of the `indexes` array. Append these entries before it (add a comma after the last existing entry):

```json
,
{
  "collectionGroup": "aiReadinessScores",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "scoredAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiVisibilitySnapshots",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "snapshotDate", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aisynchSubscriptions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "activatedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiReadinessScans",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "createdAt", "order": "ASCENDING" },
    { "fieldPath": "email", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "scheduledReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "nextGeneration", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "generatedReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "agencyMerchantId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "generatedReports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "clientMerchantId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiVisibilityTriggers",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "merchantId", "order": "ASCENDING" },
    { "fieldPath": "triggeredAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "aiReadinessRateLimits",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "date", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "competitorValidationLogs",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "industry", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

### 0D — Add model override parameter to queryGeminiGrounded

Search for `async function queryGeminiGrounded(query, businessNames)` in `services/providers/aiVisibilityProvider.js`.

Change the signature to:

```javascript
async function queryGeminiGrounded(query, businessNames, modelOverride) {
```

Then search for `model: 'gemini-2.5-flash'` inside the same function (in the `getGenerativeModel` call).

Change to:

```javascript
model: modelOverride || 'gemini-2.5-flash',
```

**Why:** Per-report enrichment keeps using `gemini-2.5-flash` (SIMPLE tier, no override passed). The monitoring cron will pass `'gemini-3-flash-preview'` (PRIMARY tier) for better quality on daily monitoring.

### 0E — Cap citation retrieved percentage at 100%

Search for `citationRatePct` inside the function `_buildCitationIntelligence` in `services/providers/aiVisibilityProvider.js`.

You will find two lines close together:

```javascript
citationRatePct: totalQueries > 0 ? Math.round((e.retrievals / totalQueries) * 100) : 0,
citationRate:    totalQueries > 0 ? Math.round((e.retrievals / totalQueries) * 100) + '%' : '0%'
```

Change both to:

```javascript
citationRatePct: totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) : 0,
citationRate:    totalQueries > 0 ? Math.min(100, Math.round((e.retrievals / totalQueries) * 100)) + '%' : '0%'
```

**Why:** A domain with multiple URLs cited in a single query's grounding chunks produces retrieval counts exceeding the query count, giving percentages over 100%. The Charlotte report showed 1033% for vertexaisearch.cloud.google.com.

---

## PHASE 0 EVAL GATES

Run ALL of these from `C:\Users\tdh35\pathsynch-pitch-generator\functions`. Every gate must PASS. If any gate FAILS, fix the issue and re-run ALL gates from Gate 0.1.

```
GATE 0.1 — Syntax check
  Command: node --check services/providers/aiVisibilityProvider.js
  PASS: no output (clean exit)
  FAIL: fix syntax error, re-run all gates

GATE 0.2 — All existing tests still pass
  Command: npx jest --no-coverage
  PASS: all tests pass (661+ expected, zero failures)
  FAIL: fix regression, re-run all gates

GATE 0.3 — Verify exports include all 8 functions
  Command: node -e "const m = require('./services/providers/aiVisibilityProvider'); console.log(Object.keys(m).sort().join(', '))"
  PASS: output includes _buildCitationCollector, _buildCitationIntelligence, _buildGapAnalysis, _classifyDomain, _classifyUrlType, enrichAiVisibility, queryGeminiGrounded, queryPerplexity
  FAIL: fix module.exports, re-run all gates

GATE 0.4 — Verify modelOverride parameter added
  Command: node -e "const m = require('./services/providers/aiVisibilityProvider'); console.log('queryGeminiGrounded params:', m.queryGeminiGrounded.length)"
  PASS: output shows 3
  FAIL: fix function signature, re-run all gates

GATE 0.5 — Verify citationRatePct cap
  Command: Select-String -Path services/providers/aiVisibilityProvider.js -Pattern "Math\.min\(100"
  PASS: two matches found (citationRatePct line and citationRate line)
  FAIL: add Math.min(100, ...) wrapper, re-run all gates

GATE 0.6 — Verify internal grounding domain exclusion exists
  Command: Select-String -Path services/providers/aiVisibilityProvider.js -Pattern "_INTERNAL_GROUNDING_DOMAINS"
  PASS: at least two matches (array declaration and loop reference)
  FAIL: add exclusion array and filter, re-run all gates

GATE 0.7 — Verify firestore.indexes.json is valid JSON
  Command: node -e "const f = require('fs').readFileSync('../firestore.indexes.json', 'utf8'); JSON.parse(f); console.log('Valid JSON — ' + JSON.parse(f).indexes.length + ' indexes')"
  PASS: outputs "Valid JSON" with index count (should be 33+ including new AIsynch indexes)
  FAIL: fix JSON syntax in firestore.indexes.json, re-run all gates
```

---

## AFTER ALL GATES PASS

**Do NOT deploy. Do NOT push.**

Show me:

1. `git diff --stat` — list of changed files with line counts  
2. `git diff services/providers/aiVisibilityProvider.js` — full diff of the provider file  
3. `git diff ../firestore.indexes.json` — full diff of the indexes file  
4. Total test count and pass/fail summary  
5. Any risks, assumptions, or edge cases you noticed  
6. The exact deploy commands I should run manually:

```
cd C:\Users\tdh35\pathsynch-pitch-generator
firebase deploy --only firestore:indexes --project pathsynch-pitch-creation
# Wait 2-5 minutes for indexes to build
firebase deploy --only functions --project pathsynch-pitch-creation
```

**Then STOP. Do not proceed to Phase 1A. Wait for my explicit approval.**

---

---

---

# AIsynch Build — Prompt 2 of 6: Phase 1A-1 Scoring Engine

## STOP CONDITIONS — READ FIRST

Execute **Phase 1A-1 ONLY** (AI Readiness Scoring Engine).

- Do NOT start Phase 1A-2 (free scan endpoint).  
- Do NOT deploy to Firebase.  
- Do NOT push to main.  
- Do NOT modify `aiVisibilityProvider.js` (that was Phase 0).

**Goal:** Create `aiReadinessScorer.js` with 30+ passing tests, then STOP for review.

---

## WORKING DIRECTORY

```
cd C:\Users\tdh35\pathsynch-pitch-generator\functions
```

---

## BEFORE YOU START

1. Read `AIsynch_Technical_Architecture_v2.md` — Section 2 (AI Readiness Scoring Engine)  
2. Read Section 1.1 (aiReadinessScores Firestore schema) for the exact output structure  
3. Confirm Phase 0 changes are committed: `git log --oneline -3`

---

## WHAT TO BUILD

Create two files:

```
services/aiReadinessScorer.js        — Scoring engine
tests/aiReadinessScorer.test.js      — Unit tests (30+ tests)
```

The scorer must:

1. Export a single function: `scoreAiReadiness(merchantData, mode, options)`  
2. Accept `mode` as `'lead_magnet'`, `'merchant_lite'`, or `'merchant_full'`  
3. `merchantData` contains: `placeData`, `gbpAuditData` (null for lead\_magnet), `reviewData` (null for lead\_magnet), `pageSpeedData`, `serperResults`, `widgetSignals` (null for lead\_magnet), `aiVisibilityData` (null for lead\_magnet), `competitorData` (null for lead\_magnet), `marketBenchmarks` (null for lead\_magnet — use defaults)  
4. Score six pillars: reviewAuthority (0-25), gbpCompleteness (0-20), webPresence (0-20), citationPresence (0-15), aiVisibility (0-10), competitivePosition (0-10)  
5. Each sub-item tracks `{ score, max, detail, dataSource: 'real' | 'default' }`  
6. Calculate per-pillar confidence: ≥75% real items → 'high', 40-75% → 'medium', \<40% → 'low'  
7. Calculate overall confidence from pillar confidences  
8. Generate prioritized actions sorted by impact then pointsAvailable, with product mapping (PathConnect, LocalSynch, AIsynch, PathManager), max 3 for lead\_magnet, max 5 for paid  
9. llms.txt contributes max 1 point (out of 3\) to the aiCrawlReadiness sub-item  
10. Return structure must match the `aiReadinessScores` Firestore schema exactly (Section 1.1)

---

## EVAL GATES

```
GATE 1.1 — Syntax check
  Command: node --check services/aiReadinessScorer.js
  PASS: clean exit

GATE 1.2 — Scorer tests pass
  Command: npx jest tests/aiReadinessScorer.test.js --no-coverage
  PASS: 30+ tests, zero failures
  Required coverage:
  - scoreAiReadiness returns correct structure for lead_magnet mode
  - scoreAiReadiness returns correct structure for merchant_full mode
  - Each pillar returns score between 0 and its max
  - All-null inputs produce dataSource: 'default' on every sub-item
  - Real data inputs produce dataSource: 'real'
  - Confidence: >75% real → 'high', 40-75% → 'medium', <40% → 'low'
  - Actions sorted by impact (high > medium > low) then pointsAvailable descending
  - Actions capped at 3 for lead_magnet
  - Actions capped at 5 for merchant modes
  - Each action has linkedProduct from PRODUCT_MAP (or null)
  - Each action has whyItMatters (non-empty string)
  - Each action has category (one of: review_growth, gbp_optimization, website_structure, citation_gap, content_gap, ai_crawl_readiness, competitor_gap)
  - Total score = sum of all pillar scores
  - Total score always 0-100
  - llms.txt sub-item max is 1 (not 3 or 4)
  - Default market benchmarks used when marketBenchmarks is null
  - Output includes schemaVersion: '1.0'

GATE 1.3 — Test fixture: strong merchant scores above 70
  Create a test with realistic mock data for a well-optimized business:
  - 150+ reviews, 4.7 rating, recent reviews, 80%+ response rate
  - Complete GBP (description, photos, Q&A, posts, services)
  - Website with schema markup, mobile-optimized, fast PageSpeed
  - Listed on 5+ directories, consistent NAP
  - AI visibility: 60%+ mention rate
  PASS: totalScore > 70

GATE 1.4 — Test fixture: weak merchant scores below 45
  Create a test with realistic mock data for a struggling business:
  - 3 reviews, 3.2 rating, no recent reviews, no responses
  - Incomplete GBP (no description, no photos, no posts)
  - No website
  - Not listed on directories
  - AI visibility: 0% mention rate
  PASS: totalScore < 45

GATE 1.5 — Test fixture: mixed merchant scores 45-70
  Create a test with realistic mock data for a decent but unoptimized business:
  - 50 reviews, 4.3 rating, some recent, low response rate
  - Partial GBP (has description, few photos, no posts)
  - Website exists but slow, no schema
  - Listed on 2 directories
  - AI visibility: 20% mention rate
  PASS: totalScore >= 45 AND totalScore <= 70

GATE 1.6 — All tests pass (existing + new)
  Command: npx jest --no-coverage
  PASS: all tests pass (691+ expected)
```

**After gates pass:** Show diffs, test summary, and STOP. Do not proceed to Phase 1A-2.

---

---

---

# AIsynch Build — Prompt 3 of 6: Phase 1A-2 Free Scan Endpoint

## STOP CONDITIONS

Execute **Phase 1A-2 ONLY** (Free scan endpoint). Do NOT deploy. STOP after gates pass.

---

## WORKING DIRECTORY

```
cd C:\Users\tdh35\pathsynch-pitch-generator\functions
```

---

## BEFORE YOU START

1. Read `AIsynch_Technical_Architecture_v2.md` — Section 3 (Free Scan API Endpoint) and Section 3.4 (Load Testing & Failure Scenarios)  
2. Confirm scoring engine exists: `node --check services/aiReadinessScorer.js`

---

## WHAT TO BUILD

```
api/aiReadinessScan.js               — Cloud Function (onRequest)
tests/aiReadinessScan.test.js        — Unit tests (15+ tests)
```

The endpoint must:

1. Accept POST with `{ businessName, city, state, email?, turnstileToken }`  
2. Verify Turnstile token via Cloudflare API  
3. Check IP rate limit (10/hour) via Firestore `aiReadinessRateLimits`  
4. Check fingerprint limit (20/day) via hashed IP \+ User-Agent \+ Accept-Language  
5. Check daily global cap (500/day) via Firestore counter  
6. Look up business via Google Places API  
7. Run PageSpeed \+ Serper in parallel via `Promise.allSettled`  
8. Call `scoreAiReadiness()` in `lead_magnet` mode  
9. Store result in Firestore `aiReadinessScans` collection  
10. Return score with `confidenceLevel: 'low'` and `confidenceLabel: 'Estimated from public data'`  
11. CORS restricted to `pathsynch.com`, `www.pathsynch.com`, `localhost:3000`  
12. If email provided, create outbound lead record

---

## EVAL GATES

```
GATE 2.1 — Syntax check
  Command: node --check api/aiReadinessScan.js

GATE 2.2 — Scan endpoint tests pass
  Command: npx jest tests/aiReadinessScan.test.js --no-coverage
  PASS: 15+ tests, zero failures
  Required coverage:
  - Returns 400 if businessName missing
  - Returns 400 if turnstileToken missing
  - Returns 405 for non-POST
  - Rate limit returns false after 10 calls same IP
  - Daily cap returns false after count = 500
  - Fingerprint hash consistent for same inputs
  - Fingerprint hash differs for different inputs
  - Response includes totalScore, confidenceLevel, pillars, actions
  - confidenceLevel is 'low' for lead_magnet
  - confidenceLabel is 'Estimated from public data'

GATE 2.3 — All tests pass
  Command: npx jest --no-coverage
  PASS: 706+ tests, zero failures
```

**After gates pass:** Show diffs and STOP. Do not proceed.

---

---

---

# AIsynch Build — Prompt 4 of 6: Phase 1A-3 Billing \+ Phase 1A-4 Dashboard

## STOP CONDITIONS

Execute **Phase 1A-3 (Stripe billing) and Phase 1A-4 (PathManager dashboard)**.

Phase 1A-3 creates billing infrastructure in the functions repo. Phase 1A-4 creates the Cloud Function API bridge AND the PathManager components (requires EC2 access).

Do NOT deploy. STOP after gates pass.

---

## WORKING DIRECTORY

Phase 1A-3: `cd C:\Users\tdh35\pathsynch-pitch-generator\functions` Phase 1A-4 Cloud Function: same directory Phase 1A-4 PathManager: SSH to `3.88.108.6` for backend, `18.209.25.81` for frontend

---

## BEFORE YOU START

1. Read `AIsynch_Technical_Architecture_v2.md` — Section 4 (Stripe Billing) and Section 9 (PathManager Dashboard Integration)  
2. Confirm scorer \+ scan exist and tests pass: `npx jest --no-coverage`

---

## WHAT TO BUILD — Phase 1A-3

```
scripts/setupAisynchStripeProducts.js  — One-time Stripe product/price setup
services/aisynchBilling.js             — Add-on subscription logic + entitlements
tests/aisynchBilling.test.js           — Unit tests (10+)
```

## WHAT TO BUILD — Phase 1A-4

**Functions repo:**

```
api/aisynchDashboard.js                — Cloud Function API bridge (8 endpoints)
```

**PathManager EC2 backend (`3.88.108.6`):**

```
routes/aisynch.js                      — Proxy routes to Cloud Function
```

Mount in server file: `app.use('/api/aisynch', require('./routes/aisynch'));`

**PathManager EC2 frontend (`18.209.25.81`):**

```
src/components/AIsynch/AIsynchCard.jsx
src/components/AIsynch/AIsynchScoreRing.jsx
src/components/AIsynch/AIsynchPillarBars.jsx
src/components/AIsynch/AIsynchActions.jsx
src/components/AIsynch/AIsynchDetailView.jsx
src/components/AIsynch/AIsynchUpgradePrompt.jsx
src/components/AIsynch/aisynchApi.js
```

Read Section 9.2 through 9.7 for complete component code, API endpoint handlers, proxy pattern, data flow, latency budget, and caching strategy.

---

## EVAL GATES

```
GATE 3.1 — Billing syntax + tests
  node --check services/aisynchBilling.js
  npx jest tests/aisynchBilling.test.js --no-coverage
  PASS: 10+ tests, zero failures

GATE 3.2 — Dashboard API syntax
  node --check api/aisynchDashboard.js

GATE 3.3 — All functions tests pass
  npx jest --no-coverage
  PASS: 716+ tests

GATE 3.4 — PathManager proxy route syntax
  On EC2: node --check routes/aisynch.js

GATE 3.5 — React components have no JSX syntax errors
  On EC2: verify each .jsx file loads without error in the build
```

**After gates pass:** Show all diffs (functions repo \+ PathManager backend \+ PathManager frontend) and STOP.

---

---

---

# AIsynch Build — Prompt 5 of 6: Phase 1B-1 Monitoring Cron

## STOP CONDITIONS

Execute **Phase 1B-1 ONLY** (monitoring cron \+ prompt generation). Do NOT deploy. STOP after gates pass.

---

## WORKING DIRECTORY

```
cd C:\Users\tdh35\pathsynch-pitch-generator\functions
```

---

## BEFORE YOU START

1. Read `AIsynch_Technical_Architecture_v2.md` — Section 5 (Persistent Monitoring Cron) and Section 1.3 (aiVisibilityPrompts with merchant name aliases)  
2. Confirm all Phase 1A code exists and tests pass: `npx jest --no-coverage`

---

## WHAT TO BUILD

```
scheduled/aiVisibilityMonitor.js       — Firebase scheduled function (3 AM ET daily)
services/aisynchPromptGenerator.js     — Auto-generate 10-15 prompts per merchant
tests/aiVisibilityMonitor.test.js      — Cron tests (10+)
tests/aisynchPromptGenerator.test.js   — Prompt gen tests (10+)
```

Key requirements:

- Prompt generator uses GBP category \+ city \+ services to create prompts across the eight-bucket taxonomy (best-in-city, near-me, service-intent, comparison, trust-intent, price-value, situation-problem, competitor-comparison). Each prompt gets a `type` label (category/service/comparison/recommendation) AND an `intentBucket` label.  
- Each prompt tracks `lastRunAt`, `lastMentionedAt`, and `historicalMentionRate` — updated automatically by the cron after each run  
- Merchant name aliases auto-generated from business name (lowercase, no suffix, no punctuation, common abbreviation)  
- Monitoring cron queries Gemini (with `modelOverride: 'gemini-3-flash-preview'`) and Perplexity in PARALLEL (not fallback)  
- Per-model results stored separately in `aiVisibilitySnapshots.models` (never merged)  
- `mentionedInText` boolean computed on each citation URL  
- **sourceEvents array** stored inside each snapshot document — captures every source URL with `wasRetrieved`, `wasExplicitlyCited`, `merchantMentioned`, `competitorsMentioned`, `promptId`, `model`. This starts accumulating source history from Phase 1B even though the source UI doesn't ship until Phase 2\.  
- PII scrubbing (email, phone, SSN regex) on all snippet text before storage  
- Snippets capped at 300 characters  
- Batch-of-5 processing with 2s pause between batches  
- Feature flag: `ENABLE_AISYNCH_MONITORING=true` required to run  
- **Daily cost cap**: at the start of each cron run, check `aisynchRunLogs/cost_{date}` document. If `totalEstimatedCost >= AISYNCH_DAILY_COST_CAP` (default $25), skip processing and log `cost_capped` status. After each merchant run, increment the daily cost document with the estimated API cost for that run.  
- **Per-merchant caps**: `AISYNCH_MAX_PROMPTS_PER_MERCHANT` (default 15), `AISYNCH_MAX_COMPETITORS_PER_MERCHANT` (default 10), `AISYNCH_MAX_MODELS_PER_RUN` (default 3). Slice prompts/competitors/models to these caps before processing.  
- Each snapshot includes `schemaVersion: '1.0'`, `errorCount`, `fallbackUsed`  
- `processOneMonitoringRun` is self-contained for future Pub/Sub migration  
- Include Pub/Sub migration comment block in the cron function

---

## EVAL GATES

```
GATE 4.1 — Syntax
  node --check scheduled/aiVisibilityMonitor.js
  node --check services/aisynchPromptGenerator.js

GATE 4.2 — Tests pass
  npx jest tests/aiVisibilityMonitor.test.js tests/aisynchPromptGenerator.test.js --no-coverage
  PASS: 25+ tests, zero failures
  Required coverage:
  - Prompt generator creates 10-15 prompts from category + city
  - Each prompt has intentBucket from the eight-bucket taxonomy
  - Each prompt has type (category/service/comparison/recommendation)
  - Aliases: lowercase, no-suffix, no-punctuation variants generated
  - PII scrub removes email pattern
  - PII scrub removes phone pattern
  - PII scrub removes SSN pattern
  - Snippet capped at 300 chars
  - mentionedInText true when domain appears in response text
  - mentionedInText false when domain does not appear
  - sourceEvents array populated with wasRetrieved, wasExplicitlyCited, merchantMentioned fields
  - sourceEvents includes promptId and model for each entry
  - Prompt lastRunAt updated after monitoring run
  - Prompt historicalMentionRate recalculated after monitoring run
  - processOneMonitoringRun accepts subscription object
  - Feature flag false skips processing
  - Batch size is 5
  - Daily cost cap stops processing when exceeded
  - Per-merchant prompt cap enforced (slices to AISYNCH_MAX_PROMPTS_PER_MERCHANT)
  - Snapshot includes schemaVersion: '1.0'
  - Snapshot includes errorCount and fallbackUsed fields

GATE 4.3 — All tests pass
  npx jest --no-coverage
  PASS: 741+ tests
```

**After gates pass:** Show diffs and STOP.

---

---

---

# AIsynch Build — Prompt 6 of 6: Phase 1B-2 Trend Chart

## STOP CONDITIONS

Execute **Phase 1B-2 ONLY** (trend chart component \+ /trend endpoint). Do NOT deploy. STOP after gates pass.

---

## BEFORE YOU START

1. Read `AIsynch_Technical_Architecture_v2.md` — Section 9.4 (AIsynchTrendChart.jsx component code)  
2. Confirm monitoring cron exists: `node --check scheduled/aiVisibilityMonitor.js`  
3. Seed test data: create 5 aiVisibilitySnapshots documents in Firestore with different dates for a test merchant, OR force-run the monitoring cron 5 times

---

## WHAT TO BUILD

**Functions repo** (if not already built in Prompt 4):

- Ensure `/trend` endpoint exists in `api/aisynchDashboard.js`

**PathManager frontend (`18.209.25.81`):**

```
src/components/AIsynch/AIsynchTrendChart.jsx    — Chart.js line chart
src/components/AIsynch/AIsynchHeatmap.jsx       — Multi-model grid (Growth+ only)
src/components/AIsynch/AIsynchCitations.jsx     — Citation sources + gaps (Growth+ only)
src/components/AIsynch/AIsynchReportModal.jsx   — Report generation modal (Scale only)
```

---

## EVAL GATES

```
GATE 5.1 — /trend endpoint returns data
  curl with test JWT: GET /api/aisynch/trend?days=30
  PASS: returns { trendData: [...], days: 30 }

GATE 5.2 — Chart component renders
  Load PathManager in browser, check AIsynch detail view
  PASS: line chart visible with data points

GATE 5.3 — Tier gating works
  Request /heatmap for Starter merchant
  PASS: returns { gated: true, requiredTier: 'growth' }

GATE 5.4 — All tests pass
  npx jest --no-coverage (from functions dir)
  PASS: 736+ tests
```

**After gates pass:** Show diffs and STOP.

---

## AFTER ALL 6 PROMPTS COMPLETE

Run the Update Agent manually:

- Update `functions/CLAUDE.md`  
- Update `synchintro-app/CLAUDE.md`  
- Update `SYSTEM_BIBLE.md`  
- Append to `SynchIntro_Master_Implementation_Prompt.md`  
- Create `CHANGELOG_2026-05-XX.md`

Final commit: `docs: AIsynch Phase 0 + 1A + 1B session documentation` Push to main.  
