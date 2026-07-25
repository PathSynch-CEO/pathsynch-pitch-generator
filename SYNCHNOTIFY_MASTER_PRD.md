# SYNCHNOTIFY MASTER PRD -- Unified Notification & Integration Platform

| Field | Value |
|-------|-------|
| **Document** | PRD-2026-014 |
| **Product** | SynchNotify (platform service) |
| **Author** | Charles Berry Jr. |
| **Status** | Draft |
| **Created** | June 18, 2026 |
| **Related** | PRD-SYNCHNOTIFY-PHASE1.md (execution spec), PRD-REVIEW-AUTOREPLY-EXPANSION.md (separate product PRD) |

---

## 1. Problem Statement

PathSynch's notification and integration infrastructure is fragmented:

- **PathManager** (EC2/Express): Notifications tab with email, SMS, push, bare Slack Webhook URL input, Quiet Hours, Review Auto-Reply. Integrations tab has GA4, GBP, Stripe, GSC cards but no outbound communication integrations.
- **SynchIntro** (Firebase Functions): Minimal Instantly.ai integration card. No notification routing infrastructure.

This creates three problems:

1. **No real-time sales velocity loop.** Outbound campaign replies sit in an inbox. The 15-minute conversion window closes before anyone sees the lead.
2. **No operational safety net.** Domain health degradation and bounce rate spikes are discovered after damage is done.
3. **No integration bus.** Merchants needing PathSynch events in their own tools must use Zapier or manual workflows.

## 2. Solution Overview

**SynchNotify** -- a standalone Cloud Run microservice that serves as PathSynch's unified event router, notification engine, and integration bus.

Every PathSynch product emits structured events. SynchNotify receives them, reads merchant notification preferences, applies tier gating, formats messages for configured providers, and delivers. One service handles all inbound event processing, outbound notification delivery, and bidirectional integrations.

### What This Replaces
- The bare Slack Webhook URL text input on PathManager's Notifications tab
- Future per-product notification code that would otherwise be duplicated

### What This Preserves
- Existing PathManager Notifications tab UX (email, SMS, push toggles, Quiet Hours, Review Auto-Reply)
- Existing PathManager Integrations tab card pattern
- Existing SynchIntro Instantly.ai integration

---

## 3. Architecture

### 3.1 Tenant Identity (Dual Identity Spaces)

PathSynch products use two different auth systems with different identity types:

```
SynchIntro (Firebase):
  tenantId = Firebase UID (e.g., "dehiyRBCXcUUM72O211S27lfXbl1")
  Source: request.auth.uid / req.user.uid
  Plan stored at: Firestore users/{uid}.plan

PathManager (MongoDB):
  tenantId = MongoDB ObjectId from col_users (e.g., "5352a6e6...")
  Source: req.user.sub
  Plan stored at: merchant document in col_users
  merchantCode = mcnt_code (display/reference field only)
```

These are NOT the same identifier. A cross-reference mapping between Firebase UIDs and PathManager MongoDB ObjectIds is a Phase 3 concern when PathManager events start flowing in. For Phase 1-2 (SynchIntro only), tenantId is always a Firebase UID.

### 3.2 Event Envelope

```json
{
  "tenantId": "dehiyRBCXcUUM72O211S27lfXbl1",
  "identitySpace": "firebase | pathmanager",
  "merchantCode": "56B8DE",
  "source": "synchintro | pathconnect | localsynch | referralsynch | pathmanager",
  "eventType": "positive_reply | new_review | competitor_alert | bounce_spike | domain_health | ...",
  "priority": "critical | high | normal | low",
  "payload": {},
  "timestamp": "ISO-8601",
  "idempotencyKey": "uuid-v4",
  "version": "1.0"
}
```

`identitySpace` tells SynchNotify how to resolve the tenant. Phase 1-2: always `"firebase"`. Phase 3+: PathManager events use `"pathmanager"` and SynchNotify resolves via cross-reference.

### 3.3 Processing Pipeline

```
POST /api/v1/events receives and validates
  -> writes event to eventLog (Firestore)
  -> enqueues Cloud Task for async delivery
  -> returns 202 Accepted

Cloud Task worker:
  -> deduplicates via idempotencyKey
  -> reads merchant notification prefs (merchantConfig/{tenantId}/notificationPrefs)
  -> applies tier gating
  -> checks Quiet Hours (non-critical suppressed during quiet window)
  -> resolves destination channels
  -> formats message per provider (Slack Block Kit, future: Teams, email, SMS)
  -> delivers to each configured provider
  -> logs delivery result (notificationLog)
  -> if escalation configured: schedules escalation check Cloud Task
  -> on failure: retries (3 attempts, exponential backoff)
  -> after max attempts: writes to dead letter collection, alerts admin
```

### 3.4 Auth Model

**Internal (product to SynchNotify):**
- HMAC signature per event (SHA-256, per-service signing key)
- Timestamp + 5-minute replay window validation
- idempotencyKey required on every event

**External (Instantly, Attio webhooks):**
- Per-merchant signing secret
- HMAC validation
- Replay protection
- Event allowlist by provider

**Slack:**
- Full Slack App with OAuth (not bare Incoming Webhooks)
- Bot token stored in GCP Secret Manager
- Interactivity URL configured from day one (used in Phase 2)

### 3.5 Deployment

- **Runtime**: Cloud Run (GCP project pathconnect-442522)
- **Config store**: Firestore (project pathsynch-pitch-creation)
- **Async delivery**: Cloud Tasks
- **Secrets**: GCP Secret Manager (Slack bot token, signing keys)
- **Escalation scheduler**: Cloud Tasks (delayed tasks)
- **Fallback channel**: Email (existing infrastructure)

---

## 4. Tier Gating Matrix

### SynchIntro Tiers

| Feature | Starter ($199) | Growth ($399) | Scale ($599) | Enterprise ($999) | Managed/DFY ($1,499+) |
|---------|----------------|---------------|--------------|--------------------|-----------------------|
| Slack integration | Yes | Yes | Yes | Yes | Yes |
| Channels | 1 | 2 | 3 | Unlimited | Unlimited |
| Positive reply alerts | Yes | Yes | Yes | Yes | Yes |
| Infrastructure alerts | No | No | Yes | Yes | Yes |
| Bounce rate auto-kill | No | Yes (fixed 2%) | Yes (configurable 1-5%) | Yes (configurable) | Yes (configurable) |
| Custom alert rules | No | No | No | Yes | Yes |
| @mention recipients | 0 | 2 | 5 | Unlimited | Unlimited |
| Escalation chains | No | No | 1 step | Multi-step | Multi-step |
| Lead claiming from Slack | No | Yes | Yes | Yes | Yes |
| Smart channel routing | No | No | No | Yes | Yes |
| Daily digest | No | No | Yes | Yes | Yes |
| Response latency tracker | No | Last 7 events | Full history | Full + CSV export | Full + CSV export |
| Quiet Hours | No | Yes | Yes | Yes | Yes |
| Microsoft Teams | No | No | No | Yes | Yes |
| Custom outbound webhooks | No | No | No | Yes | Yes |

### PathManager Tiers

| Feature | Starter ($149) | Growth ($249) | Scale ($499) | Agency (custom) |
|---------|----------------|---------------|--------------|-----------------|
| Slack integration | 1 channel | 2 channels | 3 channels | Unlimited |
| New review alerts | Yes | Yes | Yes | Yes |
| Competitor alerts | No | Yes | Yes | Yes |
| Form submission alerts | No | Yes | Yes | Yes |
| GBP ranking change alerts | No | No | Yes | Yes |
| Quiet Hours | Yes | Yes | Yes | Yes |
| Multi-location routing | No | No | Yes | Yes |

### Managed Tier

Auto-provisioned when a DFY engagement is created. Maps to Enterprise-level entitlements. Applies to DFY Outbound Engine ($1,999-$2,999/mo), Dead List Reactivation ($1,499/mo), Managed SynchMate Concierge ($999 setup + $500/mo).

Implementation: Add "managed" to BOTH tier systems:
- SynchIntro: `functions/middleware/planGate.js` -- add to `TIER_RANK` (currently `{ starter:0, growth:1, scale:2, enterprise:3 }`). Map `managed` at the same rank as `enterprise` (3).
- PathManager: `planTierUtils.ts` -- add so `meetsMinTier('managed')` resolves as equivalent to `agency`.

**Important tier naming difference**: SynchIntro uses `enterprise` as top tier. PathManager maps `enterprise` to `agency`. SYSTEM_BIBLE Law 6 is canonical. SynchNotify must normalize across both naming conventions.

---

## 5. Feature Roadmap

### Phase 1: Foundation (Target: July 6, 2026)
Instantly positive reply -> SynchNotify -> Slack alert. Settings UI. See **PRD-SYNCHNOTIFY-PHASE1.md** for full execution spec (S0-S5).

### Phase 1.5: Cost Optimization (Target: June 24, 2026)
Piggybacks on Williams's VertexAI migration. Prompt caching, model tier audit, col_synchiqUsage logging, Places API caching audit. Scoped separately -- referenced here, executed through Williams's migration sprint.

### Phase 2: Engagement Loop (Target: July 20, 2026)
- Lead claiming from Slack (interactive buttons + Attio writeback)
- Escalation chains (Cloud Tasks scheduler + unclaimed lead checks)
- Attio webhook receiver (deal stage changes close the latency measurement loop)
- Response Latency Tracker frontend widget (SynchIntro Analytics panel)
- Slack interactivity endpoint

### Phase 3: Multi-Product Events + Review Auto-Reply (Target: August 2026)
- PathConnect: new review alerts routed through SynchNotify
- Review Auto-Reply expansion: 1-3 star support. See **PRD-REVIEW-AUTOREPLY-EXPANSION.md**
- LocalSynch: competitor ranking changes, GBP issues
- ReferralSynch: new referral + conversion alerts
- PathManager: form submissions, billing events
- Notifications tab restructure: product-scoped sections
- Daily digest builder

### Phase 4: Platform Expansion + Semantic Caching (Target: September 2026)
- Microsoft Teams provider
- Custom outbound webhooks (Enterprise)
- Webhook health monitoring + auto-degradation + email fallback
- Smart channel routing
- Operations Command Center dashboard template
- Notification Center sidebar feed
- Redis-backed semantic caching (30-50% Gemini call interception target)

---

## 6. Event Type Registry

| Event Type | Source | Priority | Phase |
|------------|--------|----------|-------|
| positive_reply | SynchIntro | high | 1 |
| bounce_spike | SynchIntro | critical | 2 |
| domain_health | SynchIntro | warning/critical | 2 |
| warmup_stall | SynchIntro | warning | 2 |
| new_review | PathConnect | normal | 3 |
| review_draft_pending | PathConnect | high | 3 |
| review_auto_reply_posted | PathConnect | normal | 3 |
| competitor_rank_change | LocalSynch | normal | 3 |
| gbp_issue | LocalSynch | high | 3 |
| ai_visibility_drop | LocalSynch | normal | 3 |
| referral_received | ReferralSynch | normal | 3 |
| referral_converted | ReferralSynch | normal | 3 |
| form_submission | PathManager | normal | 3 |
| payment_failed | PathManager | critical | 3 |
| plan_changed | PathManager | normal | 3 |
| daily_digest | SynchNotify | low | 3 |

---

## 7. Provider Abstraction Layer

```javascript
class SlackProvider {
  async formatMessage(eventType, payload, merchantPrefs) { /* Block Kit JSON */ }
  async deliver(channel, formattedMessage, botToken) { /* Slack API */ }
  async handleInteraction(interactionPayload) { /* button clicks */ }
  getHealthStatus(channelConfig) { /* healthy/degraded/failed */ }
}

class TeamsProvider { /* same interface, Adaptive Cards */ }
class EmailProvider { /* same interface, templates */ }
```

Adding a new provider = new class + new Integrations card. No pipeline changes.

---

## 8. Integrations Tab Restructure (Phase 4)

### New Category: Communication & Alerts
Position: After Analytics Dashboards, before Dashboard Templates.

Cards:
1. **Slack** -- "Stream real-time alerts to your Slack workspace." Connect/Disconnect.
2. **Microsoft Teams** -- "Get alerts in your Teams channels." (Enterprise only)
3. **Custom Webhooks** -- "Send PathSynch events to your own endpoints." (Enterprise only)

### New Dashboard Template: Operations Command Center
Unlocks when Slack + at least one data source connected. Response latency, domain health, campaign performance, review velocity in one view.

---

## 9. Implementation Constants

- `buisnessName` / `buisnessAddress` -- intentional DB typos, NEVER correct
- `STRIPE_SECRETE_KEY` -- intentional env var typo, use dual-read utility
- PathManager backend: systemd only, NOT PM2. Restart: `sudo systemctl restart pathmanager.service`
- Merchant collection: `col_users` in `dbPathsynch` (MongoDB Atlas cluster PathConnect1)
- `req.user.sub` = merchant `_id` = tenantId
- Gemini hierarchy: SIMPLE `gemini-2.5-flash`, PRIMARY `gemini-3-flash-preview`, ADVANCED `gemini-3.1-pro-preview`
- All Gemini 3.x calls: `thinkingBudget: 0` + `indexOf('{')` JSON extraction
- Williams merges product PRs; Charles self-merges infra/display/Build OS
- PathManager backend EC2: 3.88.108.6; frontend EC2: 18.209.25.81
- SynchIntro Firebase: `pathsynch-pitch-creation`; GCP: `pathconnect-442522`
- PowerShell: sequential commands only, no `&&` chaining
- Plan tier gating: `planTierUtils.ts` with `normalizePlanTier()` / `meetsMinTier()` (PathManager), `planGate.js` with `TIER_RANK` (SynchIntro). Both must be updated for `managed` tier.
- SynchIntro plan hierarchy: `starter(0) < growth(1) < scale(2) < enterprise(3)` in `planGate.js`. Note: `enterprise` in SynchIntro = `agency` in PathManager (SYSTEM_BIBLE Law 6).
- Authoritative plan field (SynchIntro): `users/{uid}.plan` (top-level Firestore field). Fallback: `userDoc.plan` -> `userDoc.tier` -> `userDoc.subscription.plan`.
- Product colors: PathConnect #3A6746, SynchIntro #BA7517, LocalSynch #226572, ReferralSynch #F06A97, AIsynch #DA6520

### Merge-Order Dependencies

- **PR #18** (Firestore rules F-004/F-005 tightening) must merge before any S1/S2 Firestore rules changes. Currently pending Williams review. If S1 adds new collections to `firestore.rules`, the changes will conflict if PR #18 is still open.

---

## 10. Open Questions

1. **Multi-location merchants**: Should notification routing be configurable per location? Scale+ feature if yes.
2. **DFY white-label branding**: Should Slack messages show PathSynch branding or the agency's brand (via brandResolver) for DFY clients?
3. **Attio API capabilities**: Verify Attio supports outbound webhooks for deal stage changes and programmatic deal assignment for lead claiming.
4. **Slack rate limiting**: 1 message/second/webhook. High-volume campaigns may need Cloud Tasks rate limiting. Verify at scale.
5. **1-star auto-reply liability**: Should Settings UI include explicit risk acknowledgment for Agency-tier fully automatic 1-star replies?
6. **Draft expiration policy**: 72-hour expiry -- discard permanently or archive?
