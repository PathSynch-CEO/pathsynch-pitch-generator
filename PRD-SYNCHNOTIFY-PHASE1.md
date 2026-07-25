# PRD: SynchNotify Phase 1 -- Execution Spec

| Field | Value |
|-------|-------|
| **Document** | PRD-SYNCHNOTIFY-PHASE1 |
| **Parent** | SYNCHNOTIFY_MASTER_PRD.md |
| **Target** | July 6, 2026 (outbound go-live) |
| **Build OS** | Yes -- AGENT.md with REVIEWER.md adversarial checks |
| **Sprint structure** | S0 through S5, one PR per sprint |

---

## 1. Goal

Ship the minimum path: Instantly campaign reply webhook fires -> SynchNotify processes -> styled Slack alert lands in #feed-positive-replies with Account360 deep link. Settings UI lets merchants connect Slack.

Nothing else ships in Phase 1.

---

## 2. Non-Goals for Phase 1

These are explicitly out of scope. Claude Code must not touch any of these:

- Bounce rate auto-kill logic
- Domain health alerting
- Escalation chains
- Lead claiming / Slack interactivity handling
- Daily digest
- Response Latency Tracker widget
- Review Auto-Reply (any star rating) -- no Gemini prompt changes
- PathManager Notifications tab rewrite (link-out only)
- Places API caching
- Token budget management / col_synchiqUsage
- Semantic caching / Redis
- Microsoft Teams
- Custom outbound webhooks
- Smart channel routing
- Any modification to billing logic, Stripe integration, or plan tier pricing

If Claude encounters any of these during implementation, it must stop and note "out of scope for Phase 1" without making changes.

---

## 3. Definition of Done

A sprint is done when:

- All code passes Build OS REVIEWER.md adversarial checklist
- Tests cover happy path, error paths, and auth rejection
- No hardcoded secrets anywhere in codebase
- No new Firestore read/write without corresponding security rule
- PR description includes: what changed, what was tested, what was intentionally not changed
- Rollback path documented (Cloud Run: traffic split to previous revision; Firestore: no destructive schema changes in Phase 1)

---

## 4. PR Breakdown (S0-S5)

### S0 -- Read-Only Architecture Audit

**No code changes. Report only.**

Inspect and document:
1. SynchIntro codebase (`functions/`):
   - `ls functions/services/` -- existing service patterns
   - `ls functions/routes/` -- existing routes, find instantlyRoutes.js
   - `cat functions/package.json` -- existing dependencies
   - How routes are mounted (Express app structure, middleware, auth)
   - How auth works on existing routes (Firebase auth? API keys?)
   - Check for existing Slack-related code or env vars
2. SynchIntro frontend (`synchintro-app/`):
   - Find Settings page component and Integrations section
   - Document the Instantly.ai card pattern (component structure, state management, styling)
   - Check existing charting library in package.json
3. PathManager codebase (EC2):
   - `cat` the Notifications tab component -- find the bare Slack Webhook URL input
   - `cat` the Integrations tab component -- document the card pattern
   - Check existing notification-related routes and services
4. Firestore:
   - `cat firestore.rules` -- current rules. Note: PR #18 (F-004/F-005 tightening) may still be open. Document its status.
   - Check if `merchantConfig` collection exists. If not, document what collections store per-merchant configuration. SynchIntro may use a different pattern.
   - Document existing collections relevant to notification config
5. GCP:
   - Verify Cloud Run is available in pathconnect-442522 (Entity360 already deployed here)
   - Verify Cloud Tasks API is enabled
   - Verify Secret Manager API is enabled. Note: F-003 (Stripe key -> Secret Manager) was "NOT STARTED" as of June 8. Secret Manager may need initial setup.
   - Check if any secrets already exist in pathconnect-442522
6. Identity and Auth:
   - Verify SynchIntro auth identity: what is `req.user` in Firebase Functions? Is it `request.auth.uid` (Firebase UID)? Document the exact identity field used for ownership checks across the codebase.
   - Confirm that the tenant identity in SynchIntro is a Firebase UID (e.g., `dehiyRBCXcUUM72O211S27lfXbl1`), NOT a MongoDB ObjectId.
7. Plan Tier Gating:
   - `cat functions/middleware/planGate.js` -- document the `TIER_RANK` hierarchy. Confirm it uses `{ starter:0, growth:1, scale:2, enterprise:3 }`.
   - Note: `managed` tier must be added here, NOT in PathManager's `planTierUtils.ts` (that is a Phase 3 concern).
   - Document where plan tier is read from: expected to be `users/{uid}.plan` (top-level Firestore field).
8. Directory Structure:
   - `ls functions/` -- document the actual directory structure. The PRD assumes `functions/routes/` but CLAUDE.md suggests the pattern may be `functions/api/`. Find where HTTP endpoints are defined.
   - Check if `instantlyRoutes.js` or any Instantly-related file exists. Document the actual endpoint registration pattern.
9. Merge Dependencies:
   - Check status of PR #18 (Firestore rules F-004/F-005). If still open, flag as merge-order dependency -- must merge before any S1/S2 rules changes.
   - Check for any other open PRs that touch `firestore.rules` or `functions/`
10. Claude Code Permissions:
    - Review `.claude/settings.local.json` -- verify `gcloud run deploy` and `gcloud secrets` commands are permitted. If not, document what needs to be added for S1.

**Deliverable**: Architecture audit report covering all findings. This report is the input for S1.

---

### S1 -- SynchNotify Service Skeleton

**New Cloud Run service. No Slack, no UI. Just the bones.**

Create the SynchNotify project:
```
synchnotify/
  src/
    index.js                  -- Express app, route mounting
    routes/
      eventRoutes.js          -- POST /api/v1/events
      healthRoutes.js         -- GET /health, GET /ready
    middleware/
      hmacAuth.js             -- HMAC signature validation
      replayProtection.js     -- timestamp + 5-min window
      idempotency.js          -- idempotencyKey dedup via Firestore
    services/
      eventProcessor.js       -- validates envelope, enqueues Cloud Task
      deliveryWorker.js       -- Cloud Task handler, routes to providers
    providers/
      slack/
        slackProvider.js      -- format + deliver (placeholder, implemented in S2)
    utils/
      tenantResolver.js       -- resolves tenantId -> merchantConfig
      tierGating.js           -- checks merchant plan tier against feature entitlements
    config/
      constants.js            -- event types, tier definitions, thresholds
  tests/
  Dockerfile
  cloudbuild.yaml
  package.json
```

#### Event endpoint:
```
POST /api/v1/events
Authorization: HMAC-SHA256 {signature}
X-Timestamp: {ISO-8601}

Body: Event Envelope (see Master PRD Section 3.2)
Response: { received: true, eventId: "uuid", queued: true }
Status: 202 Accepted
```

#### Tenant Identity Rules:

Phase 1-2 operates entirely in the SynchIntro/Firebase identity space.

```javascript
// CORRECT -- tenantId is a Firebase UID in Phase 1-2
const tenantId = event.tenantId;  // = Firebase UID (e.g., "dehiyRBCXcUUM72O211S27lfXbl1")
const config = await db.collection('merchantConfig').doc(tenantId).get();
// Plan tier: read from Firestore users/{tenantId}.plan (authoritative field)
// Fallback: userDoc.plan -> userDoc.tier -> userDoc.subscription.plan

// WRONG -- never use merchantCode as a lookup key
const config = await db.collection('merchantConfig').doc(event.merchantCode).get();

// WRONG -- do not assume MongoDB ObjectId format in Phase 1
// MongoDB ObjectIds are PathManager's identity space (Phase 3+)
```

**Phase 3 concern**: When PathManager events start flowing in, tenantId will be a MongoDB ObjectId. The event envelope includes `identitySpace: "firebase" | "pathmanager"` so SynchNotify knows which resolver to use. A cross-reference map between Firebase UIDs and MongoDB ObjectIds will be needed at that point.

#### HMAC Auth:
```javascript
// Each PathSynch product has its own signing key
// Keys stored in Secret Manager, loaded at service startup
// Signature = HMAC-SHA256(signingKey, timestamp + "." + JSON.stringify(body))
// Reject if:
//   - signature missing or invalid
//   - timestamp older than 5 minutes (replay protection)
//   - idempotencyKey already processed (dedup)
```

#### Idempotency:
- Write `{ idempotencyKey, receivedAt, status }` to Firestore `eventLog` collection on receipt
- Before processing: check if idempotencyKey exists. If yes, return 202 with original eventId. Do not re-process.

#### Cloud Task enqueueing:
- On valid event: enqueue Cloud Task to `/internal/deliver` with event payload
- Cloud Task handler calls `deliveryWorker.processEvent(event)`
- Retry policy: 3 attempts, exponential backoff (10s, 30s, 90s)
- After max attempts: write to `deadLetterEvents` Firestore collection

#### Health endpoints:
```
GET /health   -> { status: "ok" }
GET /ready    -> { status: "ready", firestore: true, secretManager: true }
```

**Tests:**
- HMAC signature validation (valid, invalid, missing, expired timestamp)
- Idempotency (duplicate event returns 202, not re-processed)
- Event envelope validation (missing fields rejected with 400)
- Tenant identity resolution
- Cloud Task enqueueing (mock)

---

### S2 -- Slack Provider + Secure Config + Test Delivery

**Slack App integration. Config CRUD. First real message sent.**

#### Slack App Setup (Manual, not code):
- Create Slack App at api.slack.com (name: "SynchNotify")
- Enable OAuth & Permissions
- Add bot scopes: `chat:write`, `channels:read`
- Set Interactivity Request URL (placeholder for Phase 2)
- Install to PathSynch workspace
- Store bot token in GCP Secret Manager

#### Slack Provider (slackProvider.js):

Implements the provider interface from Master PRD Section 7.

**formatMessage(eventType, payload, merchantPrefs):**

For `positive_reply` eventType, produces Block Kit layout:
- Header: ":fire: Positive Reply -- {companyName}"
- Section: Contact name, email, industry
- Section: Buying signals as bullet list
- Context: Fit Score badge (green circle 80+, yellow 60-79, red <60)
- Section: Reply snippet in quote block (first 200 chars)
- Section: Campaign name + timestamp
- Actions: "View Account360" button linking to account360Url

**deliver(channel, formattedMessage, botToken):**
- Uses Slack `chat.postMessage` API (not Incoming Webhooks)
- Bot token loaded from Secret Manager at startup, cached in memory
- Returns `{ sent: true, channel, ts, timestamp }` on success
- On failure: returns `{ sent: false, reason, statusCode }` -- does NOT throw

#### Slack Config CRUD:

Create routes in SynchNotify:
```
POST   /api/v1/config/slack/connect       -- Save channel config
GET    /api/v1/config/slack/status         -- Connection status (never returns bot token)
PUT    /api/v1/config/slack/toggle         -- Enable/disable
DELETE /api/v1/config/slack/disconnect     -- Remove config
POST   /api/v1/config/slack/test           -- Send test message
```

All endpoints require Firebase auth (`req.user.sub` = tenantId).

**Firestore schema for notification prefs:**
```
merchantConfig/{tenantId}/notificationPrefs: {
  providers: {
    slack: {
      connected: true,
      enabled: true,
      connectedAt: Timestamp,
      channels: {
        "ch_1": {
          channelId: "C07XXXXXX",
          channelName: "#feed-positive-replies",
          events: ["positive_reply"],
          active: true,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastDeliveryAt: Timestamp
        }
      }
    }
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "America/New_York",
    overrideForCritical: true
  },
  thresholds: {
    bounceRateThreshold: 2.0,
    domainHealthThreshold: 80
  },
  updatedAt: Timestamp
}
```

Note: No raw webhook URLs stored. Slack Bot token is in Secret Manager. Channel selection uses `channelId` from the Slack API `channels:read` scope -- the bot discovers available channels, not the user pasting webhook URLs.

#### Test endpoint:
```
POST /api/v1/config/slack/test
```
Sends test message to each configured channel:
":white_check_mark: SynchNotify connected successfully! This channel will receive [event type] alerts."
Returns per-channel success/failure.

**Tests:**
- Block Kit message formatting for positive_reply (valid JSON, all fields present)
- Fit score color coding thresholds
- Slack API delivery (mock)
- Config CRUD (connect, status returns no secrets, toggle, disconnect)
- Test endpoint sends to correct channels
- Tier gating: channel count enforcement per plan tier

---

### S3 -- Instantly Positive Reply Webhook -> Slack Alert

**The critical path: Instantly reply comes in, Slack alert fires.**

#### Instantly Webhook Receiver:

Add to SynchNotify:
```
POST /api/v1/webhooks/instantly
```

**Security:**
- Per-merchant signing secret stored in merchantConfig
- HMAC validation on incoming webhook
- Replay protection

**Processing:**
1. Validate incoming webhook payload
2. Extract: `email`, `reply_text`, `campaign_name`, `timestamp`
3. Classify reply sentiment (lightweight, no Gemini):
   - Positive indicators: "interested", "tell me more", "pricing", "schedule", "demo", "call", "yes", "love to", "sounds good"
   - Negative indicators: "unsubscribe", "remove", "stop", "not interested", "no thanks"
   - If negative or ambiguous: log to eventLog, do NOT fire Slack alert
4. If positive: enrich lead data
   - Query Firestore/MongoDB for existing prospect data (fitScore, industry, buyingSignals)
   - Build Account360 URL: `https://app.pathsynch.com/account360/{accountId}`
5. Construct Event Envelope:
   ```json
   {
     "tenantId": "{Firebase UID resolved from merchantConfig}",
     "identitySpace": "firebase",
     "merchantCode": "{resolved}",
     "source": "synchintro",
     "eventType": "positive_reply",
     "priority": "high",
     "payload": {
       "companyName": "...",
       "contactName": "...",
       "contactEmail": "...",
       "industry": "...",
       "buyingSignals": [],
       "fitScore": 87,
       "replySnippet": "...",
       "campaignName": "...",
       "account360Url": "...",
       "receivedAt": "ISO-8601"
     },
     "timestamp": "ISO-8601",
     "idempotencyKey": "uuid-v4"
   }
   ```
6. POST to internal `/api/v1/events` (same HMAC auth)
7. Write to `replyEvents` collection (for Phase 2 latency tracking):
   ```json
   {
     "tenantId": "...",
     "leadEmail": "...",
     "campaignName": "...",
     "replyClassification": "positive",
     "webhookReceivedAt": Timestamp,
     "slackNotificationSentAt": null,
     "attioUpdatedAt": null,
     "claimedBy": null,
     "claimedAt": null,
     "responseLatencyMs": null,
     "account360Url": "..."
   }
   ```
8. Return 200 to Instantly immediately (webhook endpoints must respond fast)

**Delivery worker update:**
- When deliveryWorker processes a `positive_reply` event, after successful Slack delivery, update `replyEvents` with `slackNotificationSentAt`

**Tests:**
- Positive reply classification accuracy (test against indicator lists)
- Negative/ambiguous replies logged but NOT sent to Slack
- Lead enrichment lookup (mock Firestore/MongoDB)
- Event envelope construction validates against schema
- replyEvents Firestore write confirmed
- Webhook secret validation (reject invalid, accept valid)
- End-to-end: Instantly webhook in -> Slack message out (integration test with mocks)

---

### S4 -- SynchIntro Settings UI: Slack Integration Card

**Frontend only. SynchIntro Settings page.**

#### Slack Integration Card Component

Location: `synchintro-app/src/components/settings/SlackIntegrationCard.jsx` (or .tsx)

Renders inside the existing Integrations section on Settings page, next to Instantly.ai card. Must match the Instantly.ai card pattern exactly (inspect in S0).

**Disconnected state:**
- Slack icon + "Slack" title
- Description: "Stream positive replies and system alerts to your Slack workspace in real-time."
- Status badge: gray "NOT CONNECTED" (match Instantly.ai badge style)
- Green "Connect" button (match Instantly.ai button style)
- Toggle: disabled

**Connected state:**
- Status badge: green "CONNECTED"
- Toggle: active, controls enable/disable (calls PUT /api/v1/config/slack/toggle)
- Channel names displayed (from GET /api/v1/config/slack/status)
- "Disconnect" button with confirmation prompt

**Connect flow:**
When "Connect" is clicked, show modal (or match whatever pattern the project uses):
1. "Connect your Slack workspace" heading
2. Instructions: "Click below to add SynchNotify to your Slack workspace"
3. "Add to Slack" button (initiates OAuth flow)
4. After OAuth: channel selector dropdown (populated from Slack API via bot token)
5. Map event types to channels (Phase 1: only positive_reply available)
6. "Test Connection" button -> calls POST /api/v1/config/slack/test
7. "Save & Connect" -> calls POST /api/v1/config/slack/connect

**Plan tier gating:**
- Use `normalizePlanTier()` and `meetsMinTier()` from `planTierUtils.ts`
- Enforce channel limit per tier (Starter: 1, Growth: 2, Scale: 3, Enterprise: unlimited)
- If at channel limit, show upgrade prompt instead of "Add Channel"

**Tests:**
- Disconnected state renders correctly
- Connected state shows channel names
- Toggle calls correct API endpoint
- Connect button opens modal
- Channel limit enforcement per tier
- Test Connection triggers test endpoint
- Disconnect shows confirmation

---

### S5 -- PathManager Notifications Tab: Slack Link-Out

**Minimal PathManager change. Replace the bare input, link to SynchIntro for full config.**

This is intentionally small. PathManager's full Notifications tab restructure is Phase 3.

1. Find the bare "Slack Webhook URL" text input on the Notifications tab
2. Replace it with a card that says:
   - "Slack Integration"
   - "Configure real-time Slack notifications for reviews, leads, and alerts."
   - If Slack is connected (check via SynchNotify status endpoint): show green "Connected" badge + channel names
   - If not connected: show "Set Up Slack" button
   - Both states link to the SynchIntro Settings Integrations section or a future PathManager-native config page
3. Do NOT rebuild the entire Notifications tab
4. Do NOT modify email, SMS, push, Quiet Hours, or Review Auto-Reply sections
5. Do NOT add new notification types

**Tests:**
- Card renders in both connected and disconnected states
- Link navigates correctly
- Existing notification functionality unaffected (regression test)

---

## 5. Secrets & Environment Variables Matrix

| Secret | Storage | Used By | Sprint |
|--------|---------|---------|--------|
| SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO | Secret Manager | SynchNotify (validates SynchIntro events) | S1 |
| SYNCHNOTIFY_HMAC_KEY_PATHMANAGER | Secret Manager | SynchNotify (validates PathManager events) | S1 |
| SLACK_BOT_TOKEN | Secret Manager | SynchNotify (Slack API calls) | S2 |
| SLACK_SIGNING_SECRET | Secret Manager | SynchNotify (validates Slack interactivity, Phase 2) | S2 |
| INSTANTLY_WEBHOOK_SECRET | merchantConfig/{tenantId} | SynchNotify (validates Instantly webhooks) | S3 |
| SYNCHNOTIFY_SERVICE_URL | .env (SynchIntro) | SynchIntro frontend (config API calls) | S4 |
| SYNCHNOTIFY_SERVICE_URL | .env (PathManager) | PathManager frontend (status check) | S5 |

**Rules:**
- No secret in any .env file that is committed to git
- No secret hardcoded in any source file
- Slack bot token ONLY in Secret Manager, loaded at service startup, cached in memory
- HMAC signing keys ONLY in Secret Manager
- Per-merchant Instantly webhook secrets in Firestore merchantConfig (encrypted at rest by Firestore default)

---

## 6. Firestore Indexes

| Collection | Fields | Order | Sprint |
|------------|--------|-------|--------|
| eventLog | tenantId, timestamp | tenantId ASC, timestamp DESC | S1 |
| eventLog | idempotencyKey | idempotencyKey ASC | S1 |
| deadLetterEvents | tenantId, createdAt | tenantId ASC, createdAt DESC | S1 |
| notificationLog | tenantId, eventType, timestamp | tenantId ASC, eventType ASC, timestamp DESC | S2 |
| replyEvents | tenantId, webhookReceivedAt | tenantId ASC, webhookReceivedAt DESC | S3 |
| replyEvents | tenantId, replyClassification | tenantId ASC, replyClassification ASC | S3 |

---

## 7. Cloud Run Service Account Permissions

Service account: `synchnotify-sa@pathconnect-442522.iam.gserviceaccount.com`

| Permission | Resource | Why |
|------------|----------|-----|
| roles/datastore.user | Firestore (pathsynch-pitch-creation) | Read/write merchantConfig, eventLog, notificationLog, replyEvents |
| roles/secretmanager.secretAccessor | Secret Manager (pathconnect-442522) | Read Slack bot token, HMAC keys |
| roles/cloudtasks.enqueuer | Cloud Tasks queue | Enqueue delivery tasks |
| roles/cloudtasks.taskRunner | Cloud Tasks queue | Process delivery tasks (invoked by Cloud Tasks) |

No other permissions. Principle of least privilege.

---

## 8. Rollback Plan

| Component | Rollback Method |
|-----------|----------------|
| SynchNotify Cloud Run | Traffic split: route 100% to previous revision. Zero downtime. |
| Firestore schemas | No destructive changes in Phase 1. New collections only. Old data untouched. |
| SynchIntro frontend | Revert PR. Slack card disappears, no functionality broken. |
| PathManager frontend | Revert PR. Bare Slack Webhook URL input returns. No functionality broken. |
| Slack App | Revoke bot token in Slack App settings. Messages stop. No data loss. |

Phase 1 is fully additive. Rolling back removes new functionality but breaks nothing that exists today.

---

## 9. Testing Matrix

| Area | Test Type | Sprint | Count |
|------|-----------|--------|-------|
| HMAC auth validation | Unit | S1 | 4 (valid, invalid, missing, expired) |
| Replay protection | Unit | S1 | 3 (fresh, replay, boundary) |
| Idempotency dedup | Unit | S1 | 3 (new, duplicate, concurrent) |
| Event envelope validation | Unit | S1 | 5 (valid, missing fields, bad types, unknown eventType, bad tenantId) |
| Tenant resolution | Unit | S1 | 3 (found, not found, inactive) |
| Cloud Task enqueueing | Unit (mock) | S1 | 2 (success, queue failure) |
| Dead letter write | Unit | S1 | 2 (max retries, task failure) |
| Block Kit formatting | Unit | S2 | 4 (positive_reply, fit score thresholds, missing fields, long text truncation) |
| Slack API delivery | Unit (mock) | S2 | 3 (success, API error + retry, non-200) |
| Config CRUD | Integration | S2 | 6 (connect, status no secrets, toggle on/off, disconnect, test) |
| Tier gating channels | Unit | S2 | 4 (starter 1, growth 2, scale 3, enterprise unlimited) |
| Reply sentiment classification | Unit | S3 | 6 (positive, negative, ambiguous, edge cases) |
| Instantly webhook auth | Unit | S3 | 3 (valid HMAC, invalid, missing) |
| Lead enrichment | Unit (mock) | S3 | 3 (found with data, found without, not found) |
| replyEvents write | Integration | S3 | 2 (write, verify fields) |
| End-to-end flow | Integration (mocks) | S3 | 2 (positive reply -> Slack, negative reply -> no Slack) |
| Settings UI card states | Component | S4 | 4 (disconnected, connected, toggle, disconnect confirm) |
| Channel limit enforcement | Component | S4 | 3 (under limit, at limit, upgrade prompt) |
| PathManager link-out | Component | S5 | 2 (connected state, disconnected state) |
| Regression | E2E | S5 | 1 (existing notifications unaffected) |

**Total: ~60 tests across Phase 1**

---

## 10. Implementation Constants

- `buisnessName` / `buisnessAddress` -- intentional DB typos, NEVER correct
- `STRIPE_SECRETE_KEY` -- intentional env var typo
- PathManager backend: systemd only, NOT PM2
- Merchant collection (PathManager): `col_users` in `dbPathsynch`. `req.user.sub` = merchant `_id` (MongoDB ObjectId)
- Tenant identity (SynchIntro): Firebase UID from `request.auth.uid`. NOT the same as PathManager's MongoDB ObjectId.
- Authoritative plan field (SynchIntro): `users/{uid}.plan` (top-level Firestore field)
- Plan tier gating (SynchIntro): `functions/middleware/planGate.js` with `TIER_RANK`. NOT `planTierUtils.ts` (that is PathManager frontend).
- SynchIntro tier hierarchy: `starter(0) < growth(1) < scale(2) < enterprise(3)`. Note: `enterprise` in SynchIntro = `agency` in PathManager (SYSTEM_BIBLE Law 6).
- SynchIntro endpoint pattern: may be `functions/api/` not `functions/routes/`. S0 audit will confirm.
- Gemini: not used in Phase 1 (no AI calls in notification pipeline)
- Williams merges product PRs; Charles self-merges infra/Build OS
- PowerShell: sequential commands only, no `&&` chaining
- Phase 0 pause-and-report: every sprint starts with read-only inspection

## 11. Merge-Order Dependencies

- **PR #18** (Firestore rules F-004/F-005) must merge before any S1/S2 changes to `firestore.rules`. Check status during S0.
- **Claude Code permissions**: `.claude/settings.local.json` may need `gcloud run deploy` and `gcloud secrets` added before S1. S0 should flag if missing.
