# Changelog — April 26, 2026

> **Version:** 3.2 | **Branch:** `feature/opportunity-brief` → `main`
> **Firebase project:** `pathsynch-pitch-creation`

---

## Feature: Opportunity Brief

New 7th smart card on Create Pitch — a standalone multi-section business case report for a merchant prospect. Fully separate pipeline from `pitchGenerator.js`.

---

## New Files

### Backend

| File | Purpose |
|------|---------|
| `functions/services/opportunityBriefService.js` | Core service — dual-model Gemini pipeline, intel collection, Firestore persistence, share token, analytics |
| `functions/routes/opportunityBriefRoutes.js` | 5 route handlers for Opportunity Brief endpoints |

### Frontend

| File | Purpose |
|------|---------|
| `synchintro-app/js/pages/opportunityBriefViewer.js` | Full-screen brand-colored modal viewer, PDF export, share link, IntersectionObserver analytics |
| `synchintro-app/p/brief/index.html` | Public shareable page at `/p/brief/{shareToken}` |

---

## Modified Files

### Backend

| File | Change |
|------|--------|
| `functions/routes/index.js` | Added `opportunityBriefRoutes` require + export + 5 AVAILABLE_ENDPOINTS entries |
| `functions/index.js` | Added `path.startsWith('/opportunity-brief')` dispatch block after `/prospect-intel` |
| `firestore.rules` | Added `opportunityBriefs/{briefId}` collection rules (owner-scoped write, isAuthenticated read) |

### Frontend

| File | Change |
|------|--------|
| `synchintro-app/js/pages/create.js` | 7th card in `sampleCards`; `submitSmartMode()` intercepts `opportunity_brief`; `_executeOpportunityBrief()` method |
| `synchintro-app/js/api.js` | 4 new methods: `generateOpportunityBrief`, `getOpportunityBrief`, `refreshOpportunityBrief`, `trackBriefEvent` |
| `synchintro-app/index.html` | Added `<script src="js/pages/opportunityBriefViewer.js?v=1.0.0">` before `app.js` |

### Documentation

| File | Change |
|------|--------|
| `functions/CLAUDE.md` | Prepended April 26, 2026 session entry |
| `synchintro-app/CLAUDE.md` | Prepended April 26, 2026 session entry |
| `SYSTEM_BIBLE.md` | Updated to v3.2; added Opportunity Brief section in Deployed Features; added v3.2 changelog entry |
| `SynchIntro_Master_Implementation_Prompt.md` | Appended April 26, 2026 session log |
| `CHANGELOG_2026-04-26.md` | Created (this file) |

---

## New API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/opportunity-brief/generate` | Required | Generate brief — deducts 145 credits |
| GET | `/opportunity-brief/:briefId` | Required | Fetch brief by ID (owner only) |
| GET | `/opportunity-brief/public/:shareToken` | None | Public read via share token |
| POST | `/opportunity-brief/:briefId/refresh` | Required | Regenerate brief (145 credits) |
| POST | `/opportunity-brief/:briefId/track` | Optional | Analytics event — always returns 200 |

**Note:** `/public/:shareToken` is registered BEFORE `/:briefId` to prevent "public" being matched as a briefId param.

---

## New Firestore Collection

### `opportunityBriefs/{briefId}`

| Field | Type | Notes |
|-------|------|-------|
| `userId` | string | Owner UID |
| `businessName` | string | Prospect company name |
| `industry` | string | Detected vertical |
| `location` | string | City/state |
| `sections` | map | 9 sections: executive_summary, competitive_landscape, customer_sentiment, gbp_assessment, revenue_impact_model, cost_of_inaction, bottom_line, ninety_day_plan, evidence_table |
| `brandColors` | map | `{ primary, secondary, accent }` — applied as CSS custom props in viewer |
| `shareToken` | string | UUID for public URL `/p/brief/{shareToken}` |
| `shared` | boolean | Whether share link is active |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |
| `refreshedAt` | timestamp | Set on refresh |
| `analytics` | map | `{ views, ctaClicks, lastViewedAt, returnVisits }` |

**Firestore rules:**
```
match /opportunityBriefs/{briefId} {
  allow read:   if isAuthenticated();
  allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
  allow update: if isAuthenticated() && resource.data.userId == request.auth.uid;
  allow delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
}
```

---

## Architecture Notes

### Card ID Convention
`card7` was already in use by `enterpriseCards` in `create.js` for "Research technology stack and IT spend". The Opportunity Brief uses `opportunity_brief` as its card ID throughout — `sampleCards`, `cardTexts`, `submitSmartMode()` intercept, API params.

### Credit Separation
Standard smart mode cards deduct 85 credits via `pitchGenerator.js`. The Opportunity Brief deducts 145 credits in `opportunityBriefService.js`. The `submitSmartMode()` intercept fires BEFORE the pitch pipeline, so `pitchGenerator.js` is never called for this card.

### Dual-Model Gemini Pattern
- **Structured sections** (`gemini-2.5-flash`): `thinkingBudget: 0` + `responseMimeType: 'application/json'` + `responseSchema` — clean JSON output, no extraction needed
- **Narrative sections** (`gemini-3-flash-preview`): thinking enabled (NO `thinkingBudget: 0`) — thinking tokens prefix output, so `indexOf('{')` / `lastIndexOf('}')` extraction is required

### Analytics Events
Tracked via `POST /opportunity-brief/:briefId/track` (always 200):
- `report_viewed` — on open (both authenticated viewer and public page)
- `return_visit_detected` — public page, localStorage `ob_rv_{shareToken}` already set
- `revenue_impact_viewed` — IntersectionObserver on revenue section
- `competitor_section_viewed` — IntersectionObserver on competitor section
- `section_viewed` — generic IntersectionObserver on any section
- `cta_clicked` — Calendly CTA click

---

## Deployment

| Target | Commit | Command |
|--------|--------|---------|
| Functions | `0960228` | `firebase deploy --only functions --project pathsynch-pitch-creation` |
| Hosting | `f5e6f6f` | `firebase deploy --only hosting --project pathsynch-pitch-creation` |
| Firestore rules | — | `firebase deploy --only firestore:rules --project pathsynch-pitch-creation` |
