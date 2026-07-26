# PRD: Review Auto-Reply Expansion (1-3 Star)

| Field | Value |
|-------|-------|
| **Document** | PRD-2026-016 |
| **Product** | PathConnect (PathManager) |
| **Author** | Charles Berry Jr. |
| **Status** | Draft |
| **Target** | Phase 3 (August 2026) |
| **Dependency** | SynchNotify Phase 1 live; Knowledge Base fields populated for target merchants |
| **Build OS** | Yes -- AGENT.md with REVIEWER.md adversarial checks |
| **PR structure** | PR #1 through PR #8, sequential |

---

## 1. Problem Statement

PathManager auto-replies to 5-star and 4-star Google reviews only. Reviews rated 1-3 stars are flagged for manual review with no AI assistance. Merchants have requested coverage for all star ratings.

The existing auto-reply implementation is minimal. The endpoint `POST /reviews/ai-response` likely does not inject Knowledge Base context (`business_summary`, `brand_voice`, `faqs`, `key_products_services`). The advanced injection was designed but may not be wired in production.

## 2. Non-Goals

Claude Code must not touch any of these:

- Do not rebuild the entire Reviews tab
- Do not change Google review fetching logic unless Phase 0 proves it is required
- Do not change GBP OAuth or location connection logic
- Do not alter existing 4-5 star auto-reply behavior until Knowledge Base injection is tested and verified
- Do not auto-post 1-2 star replies for Starter, Growth, or Scale tiers
- Do not modify SynchNotify routing logic beyond emitting the two defined events (review_draft_pending, review_auto_reply_posted)
- Do not introduce Gemini models outside the approved SIMPLE / PRIMARY hierarchy
- Do not change billing plans or entitlement logic outside tier-gating checks
- Do not modify Stripe integration, plan pricing, or PathManager billing logic

If Claude encounters any of these during implementation, it must stop and note "out of scope" without making changes.

---

## 3. PR Breakdown

Do not build 1-3 star expansion until the existing 4-5 star pipeline is upgraded with Knowledge Base context.

### PR #1 -- Phase 0: Read-Only Inspection Report

No code changes. Inspect the live auto-reply system on EC2:

1. Find the route handler for `POST /reviews/ai-response` in `/home/ec2-user/pathConnect_backend`
2. Document exactly which merchant fields are injected into the Gemini prompt
3. Check if `business_summary`, `brand_voice`, `faqs`, `key_products_services`, `target_audience`, `products_pain_points` are queried and injected
4. Find the auto-reply scheduler/cron: how are 4-5 star reviews queued? What triggers the 4-hour delay?
5. Find the GBP reply posting endpoint (`POST /reviews/gmb/reviews:reply`)
6. Document the review data model: which fields are on the review object?
7. Document how star rating filtering currently works (the toggle logic)

Deliverable: inspection report with findings and recommended approach.

### PR #2 -- Knowledge Base Injection for Existing 4-5 Star Auto-Replies

Wire the following fields from the merchant's MongoDB document into the auto-reply Gemini prompt:

- `business_summary`
- `brand_voice`
- `key_products_services`
- `faqs`
- `target_audience`
- `products_pain_points`

Handle missing fields safely -- if a field is null or empty, omit from prompt. Do not fail.

Test that existing 4-5 star auto-replies still work correctly with the new context. Verify quality improvement before proceeding.

Do not add new star ratings. Do not change the existing toggle behavior.

### PR #3 -- PendingReplies Data Model + Backend Draft Lifecycle

Create the `pendingReplies` collection, API endpoints, settings schema, and draft lifecycle logic.

Do not wire to the UI yet. Do not add new star ratings yet. Backend only.

### PR #4 -- 3-Star Reply Mode

Add 3-star auto-reply toggle (auto-reply or draft-for-approval mode). Wire to the pendingReplies backend. Apply tier gating.

### PR #5 -- 1-2 Star Draft-for-Approval Mode

Add 1-star and 2-star toggles. Growth/Scale: draft-for-approval only. Agency: full auto available after acknowledgment. Enforce contact path prerequisite. Apply prompt safety constraints.

### PR #6 -- Reviews Tab Approval Queue UI

"Pending Replies" filter on Reviews tab. Card UI for each pending draft. Edit, post, dismiss, flag actions.

### PR #7 -- SynchNotify Event Emission

Emit `review_draft_pending` and `review_auto_reply_posted` events to SynchNotify. SynchNotify failure must not block Google reply posting.

### PR #8 -- Agency Risk Acknowledgment + Full-Auto Negative Review Mode

Agency-tier explicit acknowledgment flow. `emergencyDraftOnlyMode` toggle. System-level and merchant-level feature flags for rollout control.

---

## 4. Tier Gating

| Star Rating | Starter ($149) | Growth ($249) | Scale ($499) | Agency |
|-------------|----------------|---------------|--------------|--------|
| 5-star auto-reply | Yes | Yes | Yes | Yes |
| 4-star auto-reply | Yes | Yes | Yes | Yes |
| 3-star auto-reply | No | Auto-reply or Draft | Auto-reply or Draft | Auto-reply or Draft |
| 2-star auto-reply | No | Draft only | Draft only | Auto-reply or Draft |
| 1-star auto-reply | No | Draft only | Draft only | Auto-reply or Draft |

Growth and Scale: 1-2 star locked to draft-for-approval. The human gate is mandatory.
Agency: full auto available after explicit risk acknowledgment + contact path configured.

---

## 5. Contact Path Prerequisite

1-2 star auto-reply (any mode) requires the merchant to have a configured contact path in their Knowledge Box. Before enabling the toggles, check for at least one of:

- Manager email address
- Manager phone number
- "Contact us" URL

If none exist, the 1-2 star toggles are locked with the message: "Add a contact path in your Knowledge Box to enable negative review replies."

This prevents the AI from either hallucinating contact info or omitting it entirely from responses that need a resolution path.

---

## 6. Schemas

### 6.1 PendingReplies Schema

**Persistence layer: TBD in Phase 0.** Default recommendation: keep lifecycle source-of-truth in PathManager backend/MongoDB unless Phase 0 confirms Firestore is already used for review real-time state. SynchNotify remains event-only -- it receives `review_draft_pending` and `review_auto_reply_posted` events but does not own the pending reply data.

Rationale: PathManager's review system (fetch, store, reply to Google) lives on EC2/MongoDB. Splitting the review lifecycle across MongoDB and Firestore creates join complexity and consistency risk with no clear benefit. If Phase 0 reveals the Reviews tab already uses Firestore for real-time state, revisit this decision.

```json
{
  "tenantId": "merchant._id / req.user.sub",
  "merchantCode": "56B8DE",
  "locationId": "google location id",
  "reviewId": "google review id",
  "reviewerName": "Jane D.",
  "starRating": 2,
  "reviewText": "...",
  "reviewCreatedAt": "Timestamp",
  "mode": "draft_for_approval | auto_reply",
  "status": "pending | posted | dismissed | expired | failed",
  "generatedReply": "...",
  "editedReply": null,
  "finalReply": null,
  "model": "gemini-3-flash-preview",
  "modelTier": "PRIMARY",
  "promptTemplateVersion": "review-reply-v1",
  "knowledgeBaseContextVersion": "kb_2026_08_01",
  "confidenceScore": 0.82,
  "riskLevel": "low | medium | high",
  "requiresHumanReview": false,
  "usedKnowledgeBaseFields": ["brand_voice", "faqs"],
  "missingContext": ["manager_contact"],
  "expiresAt": "Timestamp (72 hours from generation)",
  "generatedAt": "Timestamp",
  "postedAt": null,
  "dismissedAt": null,
  "createdBy": "system",
  "approvedBy": null,
  "synchNotifyEventId": null
}
```

**Idempotency rule**: One Google review can only have one active pending reply at a time. Before generating, check `tenantId + locationId + reviewId` where status is "pending". If exists, do not create a duplicate.

### 6.2 Auto-Reply Settings

```json
{
  "tenantId": "...",
  "enabled": true,
  "starSettings": {
    "5": { "mode": "auto_reply", "delayHours": 4 },
    "4": { "mode": "auto_reply", "delayHours": 4 },
    "3": { "mode": "draft_for_approval", "delayHours": 4 },
    "2": { "mode": "draft_for_approval", "delayHours": 8 },
    "1": { "mode": "draft_for_approval", "delayHours": 12 }
  },
  "negativeReviewAutoReplyAcknowledged": false,
  "emergencyDraftOnlyMode": false,
  "updatedAt": "Timestamp"
}
```

`emergencyDraftOnlyMode`: One-click safety switch. When enabled, ALL star ratings are forced to draft-for-approval regardless of individual star settings. Use when a merchant gets review-bombed or an AI reply goes wrong.

---

## 7. API Endpoints

### Pending Replies
```
GET    /api/v1/reviews/pending-replies                 -- List pending drafts (filterable by status, star rating)
GET    /api/v1/reviews/pending-replies/:id             -- Get single draft with full context
POST   /api/v1/reviews/pending-replies/:id/post        -- Approve and post to Google
PUT    /api/v1/reviews/pending-replies/:id/edit         -- Update editedReply text
POST   /api/v1/reviews/pending-replies/:id/dismiss      -- Dismiss (do not post)
POST   /api/v1/reviews/pending-replies/:id/flag         -- Flag for later
```

### Auto-Reply Settings
```
GET    /api/v1/reviews/auto-reply-settings             -- Get current settings
PUT    /api/v1/reviews/auto-reply-settings             -- Update settings (tier-gated)
```

All endpoints require Firebase auth. `req.user.sub` = tenantId.

---

## 8. Gemini Prompt Output Contract

Require Gemini to return structured JSON, not just prose:

```json
{
  "reply": "Thank you for sharing your experience, Jane...",
  "riskLevel": "low | medium | high",
  "requiresHumanReview": false,
  "reason": "Standard positive response, no sensitive content",
  "usedKnowledgeBaseFields": ["brand_voice", "faqs"],
  "missingContext": []
}
```

**Enforcement rules:**

- If `riskLevel` = "high" -> force `draft_for_approval`, even for Agency tier. No override.
- If `requiresHumanReview` = true -> do not auto-post. Route to approval queue.
- If `reply` is empty or response is invalid JSON -> fail safe into draft mode. Log the failure. Never auto-post malformed output.
- Parse using `indexOf('{')` JSON extraction pattern (existing Gemini 3.x constant).

### Model Tier Assignment

- 4-5 star replies: SIMPLE (`gemini-2.5-flash`)
- 3 star replies: PRIMARY (`gemini-3-flash-preview`)
- 1-2 star replies: PRIMARY (`gemini-3-flash-preview`)

---

## 9. Star-Specific Template Directives

Finalize after PR #1 Phase 0 inspection. Directives (not full prompts):

- **5-star**: Warm, grateful, specific. Reference review details. Encourage return.
- **4-star**: Appreciative, growth-minded. Acknowledge positives, invite feedback.
- **3-star**: Balanced, empathetic. Acknowledge mixed experience, commit to improvement.
- **2-star**: Empathetic, accountable. Take ownership, offer concrete resolution, provide direct contact.
- **1-star**: Sincere, direct. No hedging. Address specific complaint. Provide manager contact from Knowledge Base.

### Safety Constraints (Injected Into All Templates)

The following rules are hard constraints in the Gemini system prompt for all star ratings:

- Never accuse the reviewer of lying or misrepresenting their experience
- Never reference private customer records, transaction history, or internal notes
- Never include discounts, refunds, or compensation offers unless explicitly present in the merchant's Knowledge Base
- Never admit legal liability or use language that could be construed as admission of fault in a legal proceeding
- Never promise outcomes the business cannot guarantee
- Never include health, legal, or financial advice
- Never respond aggressively, defensively, or sarcastically
- Never fabricate contact information -- if no approved manager contact exists in Knowledge Base, use a generic path already stored for the business ("please contact our team directly") or omit the contact invitation

---

## 10. Cancellation Rules

Cancel scheduled generation or posting if any of the following are true:

1. Google review already has an owner reply (check GBP API before posting)
2. Merchant manually replied via PathManager Reviews tab
3. Review was deleted from Google
4. Merchant disabled auto-reply for that star rating
5. Merchant changed mode from `auto_reply` to `draft_for_approval` for that star rating
6. `emergencyDraftOnlyMode` is enabled
7. Subscription/tier no longer allows the configured mode (e.g., downgraded from Agency to Scale)

Before posting any reply to Google, re-validate that none of these conditions are true. This is a just-before-post safety check, not a stale-config assumption.

---

## 11. SynchNotify Integration

Two events emitted. SynchNotify handles routing. Auto-reply engine does not know or care about notification channels.

```json
{
  "eventType": "review_draft_pending",
  "priority": "high",
  "payload": {
    "reviewerName": "...",
    "starRating": 2,
    "reviewSnippet": "...",
    "replySnippet": "...",
    "riskLevel": "medium",
    "approvalUrl": "https://pathmanager.pathsynch.com/reviews?filter=pending&id=..."
  }
}
```

```json
{
  "eventType": "review_auto_reply_posted",
  "priority": "normal",
  "payload": {
    "reviewerName": "...",
    "starRating": 4,
    "replySnippet": "..."
  }
}
```

**Critical rule**: SynchNotify delivery failure must NOT block Google reply posting. The reply posts regardless. SynchNotify event emission is fire-and-forget with logging.

---

## 12. Feature Flags

### System-Level Flags
```
REVIEW_AUTOREPLY_KB_INJECTION_ENABLED          -- PR #2
REVIEW_AUTOREPLY_3STAR_ENABLED                  -- PR #4
REVIEW_AUTOREPLY_NEGATIVE_DRAFTS_ENABLED        -- PR #5
REVIEW_AUTOREPLY_NEGATIVE_AUTOPOST_ENABLED      -- PR #8
REVIEW_PENDING_REPLIES_UI_ENABLED               -- PR #6
REVIEW_AUTOREPLY_SYNCHNOTIFY_EVENTS_ENABLED     -- PR #7
```

### Merchant-Level Piloting
```json
{
  "autoReplyBetaMerchants": [
    "pathsynch_internal_tenant_id",
    "david_hailey_countifi_tenant_id"
  ]
}
```

Pilot with PathSynch internal account and David Hailey before broader rollout. When a system-level flag is enabled, check if merchant is in `autoReplyBetaMerchants` array. If yes, feature is active for that merchant. If empty array, feature is active for all merchants at eligible tiers.

---

## 13. Definition of Done

- Existing 4-5 star auto-replies still work (regression verified)
- Knowledge Base context is injected and tested (PR #2 complete before any 1-3 star work)
- 1-3 star modes obey tier gating
- 1-2 star replies default to draft-for-approval for Growth/Scale
- Pending Replies queue works (create, edit, post, dismiss, expire)
- One review = one active pending reply (idempotency enforced)
- Google posting endpoint is reused safely with pre-post validation
- Manual replies cancel pending drafts
- All seven cancellation rules are enforced
- Gemini returns structured JSON with riskLevel
- High-risk outputs forced to draft regardless of tier
- Invalid JSON fails safe into draft mode
- Safety constraints injected into all prompts
- Contact path prerequisite enforced before 1-2 star enablement
- SynchNotify receives both events; SynchNotify failure does not block posting
- All AI replies logged with prompt/model/context versions (auditability)
- Feature flags control rollout
- emergencyDraftOnlyMode works as one-click safety switch
- Rollback can disable new behavior without deleting data

---

## 14. Rollback Plan

- Disable system-level feature flags (per-feature granularity)
- Keep existing 4-5 star auto-reply behavior intact
- Stop pending reply scheduler
- Existing pending drafts remain visible but cannot auto-post
- Do not delete pendingReplies collection during rollback
- SynchNotify events can be disabled independently without affecting reply posting
- emergencyDraftOnlyMode is the merchant-facing equivalent of rollback

---

## 15. Testing Matrix

### Phase 0 (PR #1)
- Finds current /reviews/ai-response route
- Documents current prompt fields
- Documents scheduler/cron behavior
- Documents GBP reply endpoint

### Knowledge Base (PR #2)
- Injects business_summary into prompt
- Injects brand_voice into prompt
- Injects faqs into prompt
- Handles missing KB fields safely (null/empty omitted, not errored)
- Does not expose internal/private merchant fields in prompt

### Tier Gating (PRs #4, #5)
- Starter blocked from 1-3 star modes
- Growth 3-star auto-reply or draft allowed
- Growth 1-2 star forced draft only
- Scale 1-2 star forced draft only
- Agency can enable full auto after acknowledgment
- Contact path prerequisite enforced before 1-2 star enablement

### Draft Lifecycle (PR #3)
- Pending draft created correctly
- Draft expires after 72 hours (status = expired)
- Edit & Post posts edited reply to Google
- Dismiss sets status = dismissed, prevents posting
- Manual merchant reply cancels pending draft
- One review = one active pending reply (duplicate rejected)
- All seven cancellation rules enforced

### Prompt Safety (PRs #4, #5)
- Gemini returns structured JSON with riskLevel
- High-risk output forced to draft regardless of tier
- Invalid JSON fails safe into draft mode
- Missing manager contact uses generic fallback, not hallucination
- Safety constraints present in system prompt

### SynchNotify (PR #7)
- review_draft_pending emitted on draft creation
- review_auto_reply_posted emitted on Google posting
- SynchNotify failure does not block Google reply posting
- Event payload matches contract

### Emergency Controls (PR #8)
- emergencyDraftOnlyMode forces all ratings to draft
- Feature flags control per-feature rollout
- Agency acknowledgment required before full auto 1-star

---

## 16. Open Questions

1. Should expired drafts (72-hour) be permanently discarded or archived?
2. Google Business Profile API rate limits on reply posting: verify current quotas.
3. If Phase 0 reveals Knowledge Base injection was never wired, how much refactoring is needed in the existing pipeline?
4. Should PathSynch require merchants to configure an approved contact path before enabling 1-2 star auto-replies? (Recommendation: yes -- implemented as prerequisite gate)
5. Should the Gemini `confidenceScore` threshold for auto-posting be configurable per merchant, or fixed? (Recommendation: fixed at 0.7 for launch, configurable later)

---

## 17. Implementation Constants

- PathManager backend: systemd only, NOT PM2
- Merchant collection: `col_users` in `dbPathsynch`
- `req.user.sub` = merchant `_id` = tenantId (MongoDB ObjectId in PathManager)
- When emitting SynchNotify events: use `identitySpace: "pathmanager"` in the event envelope
- Plan tier gating (PathManager): `planTierUtils.ts` with `normalizePlanTier()` / `meetsMinTier()`. Canonical hierarchy: `free < starter < growth < scale < agency`. Note: `enterprise` maps to `agency`.
- `managed` tier: add to PathManager `planTierUtils.ts` at same rank as `agency`
- Gemini: SIMPLE `gemini-2.5-flash`, PRIMARY `gemini-3-flash-preview`
- All Gemini 3.x calls: `thinkingBudget: 0` + `indexOf('{')` JSON extraction
- `buisnessName` / `buisnessAddress` -- intentional DB typos, preserve
- Phase 0 pause-and-report: inspect live code before any changes
- Williams merges product PRs; Charles self-merges infra/Build OS
- PowerShell: sequential commands only, no `&&` chaining
- PR #18 (Firestore rules F-004/F-005): verify merged before any rules changes in this PRD
