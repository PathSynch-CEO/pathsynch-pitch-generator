# S0 — Architecture Audit Report

| Field | Value |
|-------|-------|
| **Sprint** | S0 (Read-Only Architecture Audit) |
| **Date** | June 18, 2026 |
| **Author** | Claude Code (Opus 4.6) |
| **Parent PRD** | PRD-SYNCHNOTIFY-PHASE1.md |
| **Status** | Complete — no code changes made |

---

## 1. SynchIntro Codebase (`functions/`)

### 1.1 Directory Structure

```
functions/
├── api/                    # ~25 API modules (billing.js, market.js, prospectIntel.js, stripe.js, etc.)
├── routes/                 # ~25 route files (instantlyRoutes.js, merchantConfigRoutes.js, etc.)
├── services/               # ~100+ service files (instantlyService.js, instantlyClient.js, alertService.js, etc.)
├── middleware/             # adminAuth.js, errorHandler.js, planGate.js, rateLimiter.js, validation.js
├── lib/                    # shared.js (verifyAuth, normalizePath)
├── config/                 # stripe config, etc.
├── formatters/             # Pitch formatters
├── templates/              # Rendering templates
├── utils/                  # Utility functions (router.js, generateMerchantConfig.js, etc.)
├── intelligence/           # Intel pipeline
├── scheduled/              # Scheduled functions
├── agents/                 # Build OS agents
├── data/                   # Static data
├── __tests__/              # Test suites
├── __mocks__/              # Jest mocks
├── tests/                  # Additional test suites
├── scripts/                # Utility scripts
├── index.js                # Main entry point — single Firebase 2nd Gen onRequest function
├── package.json            # Dependencies
├── jest.config.js          # Test config
├── CLAUDE.md               # Session history
└── SYSTEM_BIBLE.md         # Architecture bible
```

**Key finding**: Both `functions/api/` AND `functions/routes/` exist. Route handlers live in `routes/`, while `api/` contains business logic modules. The PRD's uncertainty about `api/ vs routes/` is resolved: **routes are in `functions/routes/`**.

### 1.2 Existing Service Patterns

Services follow a module pattern exporting functions (not classes). Examples:
- `instantlyService.js` / `instantlyClient.js` — API client + business logic separation
- `alertService.js` — alert processing
- `attioClient.js` — CRM integration

### 1.3 Route Architecture

**Single Firebase 2nd Gen `onRequest` function** (`exports.api`) in `index.js`:
- Memory: `1GiB`, Timeout: `300s` (note: some routes have `540s` override)
- Secrets: `['IMAGEN_API_ENDPOINT', 'THEORG_API_KEY', 'SPYFU_API_KEY']`
- CORS whitelist: `pathsynch-pitch-creation.web.app`, `app.synchintro.ai`, `synchintro.ai`

**Route dispatch**: Path-prefix matching in `index.js` (lines 274–390+). Each route file provides a `handle(req, res)` method. Routes are dispatched sequentially by path prefix (not Express `app.use()`).

**Route registration pattern** (from `instantlyRoutes.js`):
```javascript
const { createRouter } = require('../utils/router');
const router = createRouter();
// ... define routes on router ...
module.exports = router;
```

### 1.4 Auth on Existing Routes

**Auth function**: `verifyAuth(req)` in `functions/lib/shared.js:54-67`
```javascript
async function verifyAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
}
```

**Identity binding** in `index.js:220-254`:
```javascript
const decodedToken = await verifyAuth(req);
req.userId = decodedToken?.uid || 'anonymous';
req.userEmail = decodedToken?.email;
req.user = { uid: req.userId !== 'anonymous' ? req.userId : null, email: req.userEmail, plan: userPlan };
```

All routes use `req.userId` for ownership checks. The `adminAuth.js` middleware provides an additional admin gate layer.

### 1.5 Existing Instantly Integration Files

- `functions/routes/instantlyRoutes.js` — REST endpoints (connect, disconnect, status, push-lead, campaigns)
- `functions/services/instantlyClient.js` — HTTP client for Instantly API
- `functions/services/instantlyService.js` — Business logic

The Instantly routes are mounted in `index.js` and use AES-256-CBC encryption for API key storage (via `INSTANTLY_ENCRYPTION_KEY` env var). This is relevant because SynchNotify's Instantly webhook receiver (S3) will need to interact with the same merchant config where Instantly API keys are stored.

### 1.6 Slack-Related Code or Env Vars

**None.** Zero references to "Slack", "slack", or "SLACK" anywhere in `functions/`. No Slack SDK in `package.json`. No Slack env vars in `.env.example`. This is a completely greenfield integration.

### 1.7 Dependencies (Relevant to SynchNotify)

| Package | Version | Relevance |
|---------|---------|-----------|
| `express` | ^4.18.2 | SynchNotify will use Express too |
| `firebase-admin` | ^13.0.0 | Firestore access |
| `firebase-functions` | ^7.0.6 | Cloud Functions runtime |
| `axios` | ^1.14.0 | HTTP client (could use for Slack API or install `@slack/web-api`) |
| `stripe` | ^22.1.1 | Billing integration |
| `@sendgrid/mail` | ^8.1.6 | Only existing notification channel (email) |

**Not installed**: `@slack/web-api`, `@slack/bolt`, `@slack/webhook`, `@google-cloud/tasks`, `@google-cloud/secret-manager`

---

## 2. SynchIntro Frontend (`synchintro-app/`)

### 2.1 Framework

**Vanilla JavaScript** — no React, Vue, or component framework. Single-page app with page objects (e.g., `const SettingsPage = { ... }`). State management via direct DOM manipulation (`document.getElementById().innerHTML`).

Path: `C:\Users\tdh35\synchintro-app`

### 2.2 Settings Page and Integrations Section

**File**: `synchintro-app/js/pages/settings.js` (~4500+ lines)

The Integrations section is rendered by `renderIntegrationsSection(subscription)` at line 2880. It is **plan-gated**: only renders for Growth+ users (`API.isGrowthOrAbove(plan)`).

### 2.3 Instantly.ai Card Pattern

**HTML structure**:
```html
<div class="card integrations-card">
  <div class="card-header"><h3 class="card-title">Integrations</h3></div>
  <div class="integrations-list">
    <div class="integration-item" id="instantly-integration">
      <div class="integration-info">
        <div class="integration-icon">
          <svg ...><rect fill="#5046e5"/><path stroke="white" .../></svg>
        </div>
        <div class="integration-details">
          <strong>Instantly.ai</strong>
          <p class="text-muted">Push leads directly to your Instantly campaigns</p>
        </div>
      </div>
      <div class="integration-status" id="instantly-status">
        <span class="status-loading">Checking...</span>
      </div>
    </div>
  </div>
</div>
```

**State flow**:
1. Card renders with "Checking..." placeholder
2. `loadInstantlyStatus()` calls `GET /instantly/status`
3. DOM updated with connected/disconnected badge:
   - Connected: green `status-connected` badge + masked key + "Disconnect" button
   - Disconnected: gray `status-disconnected` badge + "Connect" button

**Styling**: CSS custom properties (`--spacing-*`, `--radius-*`, `--font-size-*`). Injected via `<style id="settings-styles">` tag (idempotent). Key classes:
- `.status-connected`: `background: #dcfce7; color: #166534;` (green)
- `.status-disconnected`: `background: var(--gray-100); color: var(--gray-600);` (gray)

**Modals**: Created dynamically via `document.createElement('div')`, appended to `document.body`. No modal framework.

### 2.4 Charting Library

**None installed.** `package.json` has only `@floating-ui/react` (tooltip positioning), `@playwright/test`, `firebase-tools`, and `serve`. No Chart.js, D3, Recharts, or Highcharts.

### 2.5 Slack-Related Code

**None.** Zero references anywhere in `synchintro-app/`.

---

## 3. PathManager Codebase

### 3.1 Local Directories

- `C:\Users\tdh35\PathManager_frontend\` — React/TypeScript frontend
- `C:\Users\tdh35\PathManager_backend\` — Express backend

### 3.2 Notifications Tab

**File**: `PathManager_frontend/src/components/Notifications/NotificationsSettings.tsx`

Fully implemented with:
- **Email Notifications**: star filter, delivery cadence (instant/daily/weekly), digest time settings
- **SMS Notifications**: same controls
- **Push Notifications**: browser push, star filter only
- **Slack Webhook URL** (lines 316-329): **bare `<input type="url">` field**
  ```tsx
  <label>Slack Webhook URL</label>
  <input type="url" placeholder="https://hooks.slack.com/services/..." value={state.slackWebhookUrl} ... />
  ```
  This is the exact input that SynchNotify Phase 1 S5 will replace.
- **Auto-Reply**: 5-star and 4-star toggles. 1-3 star flagged for manual review only.
- **Quiet Hours**: enabled boolean + start/end time

**Storage**: `localStorage` key `pm_notifications_v1`. The webhook URL is **not persisted server-side** — only in `localStorage`.

**Types** (`types.ts`):
```typescript
export type NotificationsState = {
  channels: Record<Channel, ChannelConfig>;
  slackWebhookUrl: string;
  quietHours: QuietHours;
  autoRespond5Star: boolean;
  autoRespond4Star: boolean;
};
```

### 3.3 Integrations Tab

**File**: `PathManager_frontend/src/components/IntegrationsPage/integrations.tsx`

**Card component**: `IntegrationCard.tsx` with interface:
```typescript
interface IntegrationCardView {
  id: string;
  name: string;
  description: string;
  logo: React.ReactNode;
  status: "connected" | "not_connected" | "requires_reauth";
  connectedDate: string | null;
}
```

Card layout: `cardHeader` (logo + name + description) + `cardFooter` (status dot + status text + action button).

**29 integrations** across 8 categories (Analytics, Business Tools, Developer Tools, Social Media, Advertising, Email Marketing, SMS & Communication, CRM). Connection via OAuth or Fivetran auto-connect.

**No "Communication & Alerts" category** yet — that is a Phase 4 addition per the Master PRD.

---

## 4. Firestore

### 4.1 Current Rules

**File**: `firestore.rules` (714 lines, 53 match blocks covering 47+ collection paths)

Key collections relevant to SynchNotify:

| Collection | Client Access | Notes |
|------------|--------------|-------|
| `users/{userId}` | Owner/admin/team-member read; owner write | Plan field stored here |
| `merchantConfig/{merchantId}` | Owner read; write=false (Admin SDK only) | **EXISTS.** Currently stores urlMappings, thresholds, calibration, entity360 bridge. SynchNotify's `notificationPrefs` subcollection will go here. |
| `teams/{ownerUid}` | Owner/member read; write=false | Workspace membership |

### 4.2 `merchantConfig` Collection

**Confirmed to exist** with active usage:
- Firestore rule: `firestore.rules` line 401
- Dedicated routes: `functions/routes/merchantConfigRoutes.js` (5 endpoints)
- Referenced by: `instantlyRoutes.js`, `attioRoutes.js`, `visitorSignalRoutes.js`, `calibrationService.js`, `entity360Bridge.js`
- Current schema (per SYSTEM_BIBLE): `urlMappings[], thresholds{}, learningModeActive, entity360MerchantId, calibration{}`

**PRD assumption validated**: The PRD proposes `merchantConfig/{tenantId}/notificationPrefs` as a subcollection. The parent collection exists and is keyed by merchantId (which in SynchIntro = Firebase UID = `req.userId`). This is compatible.

**Gap**: No Firestore rules exist for the `notificationPrefs` subcollection yet. Must be added in S1/S2.

### 4.3 Collections NOT Yet in Firestore

The following collections proposed by SynchNotify Phase 1 do not yet exist:
- `eventLog` — event deduplication and audit trail
- `deadLetterEvents` — failed delivery dead letter
- `notificationLog` — delivery audit
- `replyEvents` — reply tracking for latency measurement

All are new additions (purely additive, no schema conflicts).

### 4.4 PR #18 Status

**MERGED.** Title: `fix(firestore-rules): tighten pitchAnalytics and icpProfiles ownership (F-004, F-005)`.
- F-004: `pitchAnalytics` create/update now requires ownership via parent `/pitches/{pitchId}` doc
- F-005: Removed `isDefault==true` client-create bypass on `icpProfiles`

**This is no longer a merge-order dependency.** S1/S2 can proceed with Firestore rules changes without conflict.

---

## 5. GCP

### 5.1 CLI Access

**gcloud CLI is NOT usable** on this machine. Python is not installed (Windows Store stub only). All `gcloud` commands fail with: `Python was not found; run without arguments to install from the Microsoft Store`.

**Impact**: Cannot verify Cloud Run services, Cloud Tasks API, or Secret Manager from this machine. These must be verified manually in the GCP Console or from a machine with gcloud configured.

### 5.2 Known GCP State (from Documentation)

- **Cloud Run**: Entity360 is already deployed in `pathconnect-442522` (per Master PRD Section 3.5)
- **Firestore**: Project `pathsynch-pitch-creation` (active, well-established)
- **Secret Manager**: F-003 (Stripe key → Secret Manager) was "NOT STARTED" as of June 8, 2026. **Secret Manager may require initial setup** (API enablement, first secret creation).
- **Cloud Tasks**: No documentation confirms whether the API is enabled in `pathconnect-442522`

### 5.3 S1 Pre-Requisites (Manual GCP Steps)

Before S1 can proceed, the following must be verified/completed in GCP Console:
1. ✅ Cloud Run API enabled (Entity360 proves this)
2. ❓ Cloud Tasks API enabled — needs verification
3. ❓ Secret Manager API enabled — needs verification and likely initial setup
4. ❓ Service account `synchnotify-sa@pathconnect-442522.iam.gserviceaccount.com` — needs creation
5. ❓ IAM roles assigned per PRD Section 7

---

## 6. Identity and Auth

### 6.1 SynchIntro Auth Identity

**Confirmed**: `req.userId` = `decodedToken.uid` = **Firebase UID**

Set in `functions/index.js:221`:
```javascript
req.userId = decodedToken?.uid || 'anonymous';
```

Where `decodedToken` comes from `admin.auth().verifyIdToken(token)` in `functions/lib/shared.js:61`.

### 6.2 Ownership Check Pattern

Consistent across all routes: Firestore documents store a `userId` field, ownership verified by:
```javascript
if (doc.data().userId !== req.userId) {
    return res.status(403).json({ success: false, error: 'Access denied' });
}
```

Examples:
- `functions/routes/pitchOutcomeRoutes.js:46`
- `functions/routes/prospectIntelRoutes.js:219`
- `functions/routes/govcaptureRoutes.js:117`

### 6.3 Tenant Identity Confirmation

| System | Identity Type | Format | Example |
|--------|--------------|--------|---------|
| SynchIntro | Firebase UID | 28-char alphanumeric | `dehiyRBCXcUUM72O211S27lfXbl1` |
| PathManager | MongoDB ObjectId | 24-char hex | `5352a6e6...` |

These are NOT the same identifier. Phase 1-2 operates entirely in the Firebase identity space. Cross-reference mapping is a Phase 3 concern.

### 6.4 PRD Alignment

The PRD says `req.user.sub` for PathManager tenant identity. This is confirmed in SYSTEM_BIBLE/Master PRD. SynchIntro uses `req.userId` (= `decodedToken.uid`). SynchNotify's Firebase auth for config endpoints should use the same pattern.

---

## 7. Plan Tier Gating

### 7.1 `planGate.js` — TIER_RANK

**File**: `functions/middleware/planGate.js`

The `requirePlan()` middleware uses:
```javascript
const planHierarchy = ['starter', 'growth', 'scale', 'enterprise'];
```

**Note**: This is defined as a local array, NOT a module-level `TIER_RANK` constant. The PRD references `TIER_RANK` but the actual implementation uses a local variable named `planHierarchy`.

The SYSTEM_BIBLE's `effectiveTier` logic in brand resolution uses `TIER_RANK = { starter:0, growth:1, scale:2, enterprise:3 }` as an object. These are two different implementations of the same concept.

### 7.2 `getUserPlan()` — Single Source of Truth

```javascript
async function getUserPlan(userId) {
    const userData = userDoc.data();
    const plan = userData?.subscription?.plan ||
                 userData?.subscription?.tier ||
                 userData?.plan ||
                 userData?.tier;
    return plan ? plan.toLowerCase() : 'starter';
}
```

Priority chain: `subscription.plan` → `subscription.tier` → `plan` → `tier` → default `'starter'`.

**Important**: The PRD says the authoritative field is `users/{uid}.plan` (top-level). But `getUserPlan()` actually checks `subscription.plan` FIRST. This is correct behavior (Stripe webhook writes to `subscription.plan`), but the fallback chain matters: a stale `tier` field set at account creation could win if `subscription.plan` is missing.

### 7.3 `managed` Tier

**Not yet added** to `planHierarchy` in `planGate.js`. The Master PRD says to add `managed` at rank 3 (same as `enterprise`). This is a Phase 1 or later concern — not blocking for S1.

### 7.4 SYSTEM_BIBLE Law 6

Canonical hierarchy: `free (0) < starter (1) < growth (2) < scale (3) < agency (4)`.

**Naming mismatch**: SYSTEM_BIBLE Law 6 uses `agency` as the top tier. SynchIntro's `planGate.js` uses `enterprise`. Law 6 maps `enterprise` → `agency` for PathManager. SynchNotify will need to normalize across both systems in Phase 3, but for Phase 1-2 (SynchIntro-only), using `enterprise` is correct.

---

## 8. Directory Structure — Confirmed

The PRD assumed uncertainty between `functions/api/` and `functions/routes/`. Finding:

- **`functions/routes/`** — HTTP endpoint handlers (25 files). This is where new route files go.
- **`functions/api/`** — Business logic modules (billing.js, market.js, etc.). Not route handlers.
- **`functions/services/`** — Service layer (~100+ files)
- **`functions/middleware/`** — Auth, plan gating, error handling, rate limiting, validation

**Endpoint registration pattern** (from `instantlyRoutes.js`):
```javascript
const { createRouter } = require('../utils/router');
const router = createRouter();
// define routes...
module.exports = router;
```

Routes are mounted in `index.js` via path-prefix matching:
```javascript
if (normalizedPath.startsWith('/instantly')) {
    return instantlyRoutes.handle(req, res);
}
```

**`instantlyRoutes.js` exists** at `functions/routes/instantlyRoutes.js`. It provides: `GET /instantly/status`, `POST /instantly/connect`, `DELETE /instantly/disconnect`, `GET /instantly/campaigns`, `POST /instantly/push-lead`, `POST /instantly/import-lead`.

---

## 9. Merge Dependencies

### 9.1 PR #18 — MERGED ✅

No longer a blocker. Firestore rules changes in S1/S2 can proceed.

### 9.2 Other Open PRs

Only one open PR: **PR #12** — `fix(deps): resolve axios critical vulnerability (F-001)` (opened May 9, 2026).
- Touches: `functions/package-lock.json` (+116/-65), `functions/package.json` (+3/-2)
- Does NOT touch `firestore.rules`
- **Low conflict risk** for S1 (dependency changes only). Recommend merging before S1 to avoid lockfile conflicts.

---

## 10. Claude Code Permissions

### 10.1 Current `.claude/settings.local.json`

Allowed commands include:
- `Bash(firebase deploy:*)` — Firebase deploys ✅
- `Bash(npx firebase:*)` — Firebase CLI ✅
- `Bash(gcloud auth:*)` — gcloud auth ✅
- `Bash(node:*)` — Node execution ✅
- `Bash(npx jest:*)` — Tests ✅
- `Bash(gh pr:*)` — GitHub PRs ✅
- `Bash(git:*)` — Git operations ✅

### 10.2 Missing Permissions for S1

The following are **NOT in the allow list** and will need to be added:

| Command Pattern | Needed For |
|----------------|------------|
| `Bash(gcloud run deploy:*)` | Deploy SynchNotify Cloud Run service |
| `Bash(gcloud secrets:*)` | Create/access secrets in Secret Manager |
| `Bash(gcloud services:*)` | Enable Cloud Tasks, Secret Manager APIs |
| `Bash(gcloud tasks:*)` | Cloud Tasks queue management |
| `Bash(gcloud iam:*)` | Service account creation and IAM binding |
| `Bash(docker:*)` | Build SynchNotify container image (if using Dockerfile) |
| `Bash(gcloud builds:*)` | Cloud Build submission (if using cloudbuild.yaml) |

**Note**: gcloud CLI itself is non-functional on this machine (Python not installed). GCP operations may need to be performed from a different environment or via the GCP Console.

---

## Summary of Risks and Surprises

### Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **gcloud CLI non-functional** — Python not installed on Windows dev machine | High | Install Python, or perform GCP operations from Cloud Shell / different machine |
| R2 | **Secret Manager may not be set up** — F-003 was "NOT STARTED" as of June 8 | Medium | Verify in GCP Console; enable API and create first secret before S1 |
| R3 | **Cloud Tasks API status unknown** | Medium | Verify in GCP Console before S1 |
| R4 | **SynchNotify is a separate Cloud Run service** (not a Firebase Function) — different deployment pattern from everything else in this repo | Medium | S1 will create a new `synchnotify/` directory as a sibling to `functions/`, with its own `Dockerfile` and `package.json` |
| R5 | **PR #12 still open** (axios dep fix) — will cause lockfile merge conflicts if S1 modifies `functions/package.json` | Low | Merge PR #12 before S1 starts |
| R6 | **`planHierarchy` is a local array, not `TIER_RANK` object** — PRD references `TIER_RANK` but implementation differs | Low | SynchNotify can reference either. Document the mismatch. |
| R7 | **Slack webhook URL in PathManager is localStorage-only** — no backend persistence. S5 replacement card may need to handle migration gracefully (or just ignore, since the URL was never saved server-side). | Low | S5 card simply replaces the input; no data migration needed |

### Surprises

1. **`merchantConfig` collection already exists** — well-established with 5 REST endpoints and used by multiple services. The PRD's subcollection approach (`merchantConfig/{tenantId}/notificationPrefs`) integrates cleanly.

2. **No Slack code anywhere in either codebase** — truly greenfield. No legacy code to work around.

3. **SynchIntro frontend is vanilla JS, not React** — the Slack Integration Card (S4) must use the same DOM-manipulation pattern as the Instantly card, NOT React components.

4. **PathManager's Slack webhook URL is localStorage-only** — it was never persisted to the backend. The "bare input" the PRD describes is even more bare than expected.

5. **The `getUserPlan()` priority chain checks `subscription.plan` FIRST**, not `users/{uid}.plan`. The PRD says `users/{uid}.plan` is authoritative, but in practice Stripe webhook data in `subscription.plan` takes priority. This is actually the correct behavior but should be documented clearly for SynchNotify's tier resolution.

6. **SYSTEM_BIBLE Law 6 uses a 5-level hierarchy** (`free < starter < growth < scale < agency`) while `planGate.js` uses a 4-level hierarchy (`starter < growth < scale < enterprise`). The `free` tier and `agency` naming don't exist in `planGate.js`. SynchNotify must decide which hierarchy to follow.

---

## Recommended Adjustments to S1-S5

### S1 Adjustments

1. **Pre-S1 checklist** (manual, GCP Console):
   - Install Python on dev machine OR plan to use Cloud Shell for gcloud
   - Enable Cloud Tasks API in `pathconnect-442522`
   - Enable Secret Manager API in `pathconnect-442522`
   - Create service account `synchnotify-sa@pathconnect-442522.iam.gserviceaccount.com`
   - Assign IAM roles per PRD Section 7
   - Merge PR #12 (axios fix) to avoid lockfile conflicts

2. **Add gcloud permissions** to `.claude/settings.local.json` before starting S1

3. **Tier resolution**: SynchNotify's `tierGating.js` should import and reuse `getUserPlan()` from `functions/middleware/planGate.js` rather than reimplementing. Since SynchNotify is a separate Cloud Run service, it will need its own Firestore access — but the plan resolution logic should mirror `planGate.js` exactly. Consider extracting `getUserPlan()` into a shared library.

### S2 Adjustments

1. **Firestore rules for `notificationPrefs` subcollection**: Must add rules for `merchantConfig/{merchantId}/notificationPrefs`. Since the parent `merchantConfig` is write=false for clients, the subcollection should probably also be write=false (all writes via SynchNotify Admin SDK). But config endpoints in SynchNotify will use Admin SDK anyway, so client rules should be read-only for the owner.

### S3 Adjustments

1. **Instantly webhook integration**: `instantlyRoutes.js` already exists in SynchIntro. The webhook receiver (`POST /api/v1/webhooks/instantly`) lives in SynchNotify, NOT in the existing `instantlyRoutes.js`. Make sure the Instantly webhook URL configured in Instantly.ai points to the SynchNotify Cloud Run service, not the Firebase Function.

### S4 Adjustments

1. **Vanilla JS, not React**: The Slack Integration Card must follow the exact same pattern as the Instantly card in `synchintro-app/js/pages/settings.js`. This means:
   - HTML string returned from a render method
   - DOM manipulation for state updates
   - Dynamic modal creation via `document.createElement`
   - Inline CSS injected via `<style>` tag
   - No JSX, no React hooks, no state management library

2. **Integrations section is Growth+ gated**: The Slack card will only be visible to Growth+ plan users (same gate as Instantly card).

### S5 Adjustments

1. **PathManager is React/TypeScript**: Unlike SynchIntro, PathManager uses React components. The replacement card in `NotificationsSettings.tsx` will be a proper React component.

2. **No data migration needed**: The existing Slack webhook URL is localStorage-only. Replacing the input with a link-out card requires no backend migration.

---

## Confirmation Summary

| Item | Status | Details |
|------|--------|---------|
| Tenant identity: Firebase UID in SynchIntro | ✅ Confirmed | `req.userId = decodedToken.uid` (28-char alphanumeric, e.g., `dehiyRBCXcUUM72O211S27lfXbl1`) |
| Tenant identity: MongoDB ObjectId in PathManager | ✅ Confirmed | `req.user.sub` = `merchant._id` (24-char hex) |
| Plan tier gating: `planGate.js` | ✅ Confirmed | `planHierarchy = ['starter', 'growth', 'scale', 'enterprise']` (local array, NOT named `TIER_RANK`) |
| PR #18 status | ✅ Merged | No longer a merge dependency |
| Open PRs touching firestore.rules or functions/ | ⚠️ PR #12 | Touches `functions/package.json` only (axios fix). Low conflict risk. |
| `merchantConfig` collection exists | ✅ Confirmed | Active collection with 5 REST endpoints, Firestore rules, and multi-service usage |
| Secret Manager setup in pathconnect-442522 | ❓ Unknown | gcloud CLI non-functional. F-003 was "NOT STARTED" as of June 8. Likely needs initial setup. |
| Directory structure: api/ vs routes/ | ✅ Clarified | Routes in `functions/routes/`, business logic in `functions/api/`. Both exist. |
| PRD assumptions vs codebase reality | ⚠️ 6 mismatches found | See "Conflicts" section below |

---

## Conflicts Between PRD Assumptions and Codebase Reality

| # | PRD Assumption | Codebase Reality | Impact |
|---|----------------|------------------|--------|
| C1 | `TIER_RANK = { starter:0, growth:1, scale:2, enterprise:3 }` as a named constant | `planHierarchy` is a local array in `requirePlan()`, not an exported object | Low — conceptually equivalent. SynchNotify should use its own constant. |
| C2 | Plan read from `users/{uid}.plan` (top-level field) | `getUserPlan()` checks `subscription.plan` FIRST, then falls through to `plan`, then `tier` | Low — the PRD's fallback chain matches the code. The "authoritative" framing is slightly misleading but functionally correct. |
| C3 | SynchIntro frontend uses component-based architecture | Vanilla JS with DOM manipulation, no framework | Medium — S4 Slack card must use vanilla JS pattern, not JSX/React components |
| C4 | `ls functions/routes/` to find route files | Routes confirmed in `functions/routes/` but dispatch is via path-prefix matching in `index.js`, not Express middleware | Low — SynchNotify is a separate service, uses its own Express app |
| C5 | SYSTEM_BIBLE Law 6 hierarchy: `free < starter < growth < scale < agency` | `planGate.js` hierarchy: `starter < growth < scale < enterprise` (no `free`, uses `enterprise` not `agency`) | Medium — SynchNotify must decide which naming to follow for Phase 1. Recommend `planGate.js` naming for Phase 1 (SynchIntro-only), normalize in Phase 3. |
| C6 | `gcloud run deploy` and `gcloud secrets` commands available | gcloud CLI non-functional (Python not installed) | High — must resolve before S1 |

---

*End of S0 Architecture Audit Report. This report is the input for S1.*
