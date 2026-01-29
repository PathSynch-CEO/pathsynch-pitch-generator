# PathSynch API Documentation

Base URL: `https://us-central1-<project-id>.cloudfunctions.net/api`

API Version: `v1`

All endpoints support both versioned (`/api/v1/...`) and legacy (`/...`) paths.

## Authentication

Most endpoints require Firebase Authentication. Include the ID token in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

## Response Format

All responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE",
  "details": [{ "field": "fieldName", "message": "Field error" }]
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `AUTHENTICATION_ERROR` | 401 | Authentication required |
| `AUTHORIZATION_ERROR` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMIT` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `EXTERNAL_SERVICE_ERROR` | 503 | External service unavailable |

---

## Pitch Endpoints

### Generate Pitch

Create a new pitch from business data.

```
POST /api/v1/generate-pitch
```

**Request Body:**

```json
{
  "businessName": "Acme Restaurant",
  "contactName": "John Smith",
  "industry": "Restaurant",
  "statedProblem": "Low customer retention",
  "pitchLevel": 2,
  "monthlyVisits": 500,
  "avgTransaction": 45,
  "repeatRate": 0.3,
  "bookingUrl": "https://calendly.com/acme",
  "branding": {
    "primaryColor": "#3A6746",
    "accentColor": "#D4A847",
    "logoUrl": "https://...",
    "companyName": "Your Company",
    "hidePoweredBy": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `businessName` | string | Yes | Name of the business |
| `contactName` | string | No | Contact person's name |
| `industry` | string | No | Business industry |
| `statedProblem` | string | No | Problem to solve |
| `pitchLevel` | number | No | 1, 2, or 3 (default: 1) |
| `monthlyVisits` | number | No | Monthly customer visits |
| `avgTransaction` | number | No | Average transaction value |
| `repeatRate` | number | No | Repeat customer rate (0-1) |
| `bookingUrl` | string | No | Calendly/booking URL |
| `branding` | object | No | Custom branding options |

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "pitch_abc123",
    "shareId": "share_xyz789",
    "html": "<html>...</html>",
    "shareUrl": "https://app.pathsynch.com/p/share_xyz789"
  }
}
```

---

### List Pitches

Get all pitches for the authenticated user.

```
GET /api/v1/pitches
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max results (1-100) |
| `offset` | number | 0 | Skip results |
| `sortBy` | string | createdAt | Sort field |
| `sortOrder` | string | desc | asc or desc |
| `industry` | string | - | Filter by industry |
| `level` | number | - | Filter by pitch level |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "pitch_abc123",
      "businessName": "Acme Restaurant",
      "industry": "Restaurant",
      "pitchLevel": 2,
      "createdAt": "2026-01-15T10:30:00Z",
      "shareId": "share_xyz789",
      "shared": true,
      "analytics": { "views": 42 }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Get Pitch

Get a specific pitch by ID.

```
GET /api/v1/pitch/:pitchId
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "pitch_abc123",
    "businessName": "Acme Restaurant",
    "html": "<html>...</html>",
    "createdAt": "2026-01-15T10:30:00Z"
  }
}
```

---

### Get Shared Pitch

Get a pitch by share ID (public, no auth required).

```
GET /api/v1/pitch/share/:shareId
```

---

### Update Pitch

Update pitch metadata.

```
PUT /api/v1/pitch/:pitchId
```

**Request Body:**

```json
{
  "businessName": "Updated Name",
  "shared": true
}
```

---

### Delete Pitch

Delete a pitch.

```
DELETE /api/v1/pitch/:pitchId
```

---

## Narrative Endpoints

### Generate Narrative

Generate an AI-powered narrative from business data.

```
POST /api/v1/narratives/generate
```

**Request Body:**

```json
{
  "businessName": "Acme Corp",
  "industry": "Technology",
  "targetAudience": "Small business owners",
  "uniqueValue": "AI-powered automation",
  "painPoints": ["Manual processes", "High costs"],
  "goals": ["Increase efficiency", "Reduce overhead"],
  "tone": "professional",
  "additionalContext": "B2B focus"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `businessName` | string | Yes | Business name |
| `industry` | string | No | Industry sector |
| `targetAudience` | string | No | Target audience description |
| `uniqueValue` | string | No | Unique value proposition |
| `painPoints` | array | No | Customer pain points |
| `goals` | array | No | Business goals |
| `tone` | string | No | professional, consultative, friendly, urgent |
| `additionalContext` | string | No | Extra context |

**Response:**

```json
{
  "success": true,
  "data": {
    "narrativeId": "narr_abc123",
    "narrative": {
      "headline": "...",
      "introduction": "...",
      "problemStatement": "...",
      "solution": "...",
      "benefits": ["..."],
      "callToAction": "..."
    },
    "validation": {
      "isValid": true,
      "score": 95
    },
    "tokensUsed": { "inputTokens": 500, "outputTokens": 1200 },
    "estimatedCost": "$0.0234"
  }
}
```

---

### List Narratives

```
GET /api/v1/narratives
```

**Query Parameters:** `limit`, `offset`

---

### Get Narrative

```
GET /api/v1/narratives/:id
```

---

### Regenerate Narrative Sections

```
POST /api/v1/narratives/:id/regenerate
```

**Request Body:**

```json
{
  "sections": ["headline", "callToAction"],
  "modifications": {
    "tone": "urgent"
  }
}
```

---

### Delete Narrative

```
DELETE /api/v1/narratives/:id
```

---

## Formatter Endpoints

### List Available Formatters

```
GET /api/v1/formatters
```

**Response:**

```json
{
  "success": true,
  "data": [
    { "type": "sales_pitch", "name": "Sales Pitch", "description": "..." },
    { "type": "one_pager", "name": "One-Pager", "description": "..." },
    { "type": "email_sequence", "name": "Email Sequence", "description": "..." },
    { "type": "linkedin", "name": "LinkedIn Posts", "description": "..." },
    { "type": "executive_summary", "name": "Executive Summary", "description": "..." },
    { "type": "proposal", "name": "Business Proposal", "description": "..." },
    { "type": "deck", "name": "Presentation Deck", "description": "..." }
  ]
}
```

---

### Format Narrative

Convert a narrative to a specific output format.

```
POST /api/v1/narratives/:id/format/:type
```

**URL Parameters:**

- `:id` - Narrative ID
- `:type` - Format type (sales_pitch, one_pager, email_sequence, linkedin, executive_summary, proposal, deck)

**Request Body:**

```json
{
  "options": {
    "tone": "professional",
    "length": "medium",
    "includeStats": true,
    "includeCta": true
  }
}
```

---

### Batch Format

Generate multiple formats at once.

```
POST /api/v1/narratives/:id/format-batch
```

**Request Body:**

```json
{
  "types": ["sales_pitch", "linkedin", "email_sequence"],
  "options": {}
}
```

---

### List Formatted Assets

```
GET /api/v1/narratives/:id/assets
```

---

### Get Asset

```
GET /api/v1/assets/:assetId
```

---

### Delete Asset

```
DELETE /api/v1/assets/:assetId
```

---

## User Endpoints

### Get Current User

```
GET /api/v1/user
```

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "user_abc123",
    "email": "user@example.com",
    "plan": "growth",
    "profile": {
      "displayName": "John Smith",
      "company": "Acme Corp"
    },
    "settings": {
      "defaultTone": "professional"
    }
  }
}
```

---

### Update User Settings

```
PUT /api/v1/user/settings
```

**Request Body:**

```json
{
  "profile": {
    "displayName": "Jane Smith"
  },
  "settings": {
    "defaultTone": "friendly",
    "defaultGoal": "book_demo"
  },
  "branding": {
    "logoUrl": "https://...",
    "primaryColor": "#FF5500"
  }
}
```

---

### Get Usage

```
GET /api/v1/usage
```

**Response:**

```json
{
  "success": true,
  "data": {
    "period": "2026-01",
    "pitchesGenerated": 45,
    "narrativesGenerated": 12,
    "limits": {
      "pitches": 100,
      "narratives": 25
    }
  }
}
```

---

## Team Endpoints

### Get Team

```
GET /api/v1/team
```

**Response (with team):**

```json
{
  "success": true,
  "data": {
    "hasTeam": true,
    "teamId": "team_abc123",
    "teamName": "Acme Sales Team",
    "ownerId": "user_xyz",
    "plan": "growth",
    "maxMembers": 5,
    "members": [
      {
        "id": "member_1",
        "userId": "user_xyz",
        "email": "owner@acme.com",
        "role": "owner",
        "joinedAt": "2026-01-01T00:00:00Z"
      }
    ],
    "pendingInvites": [],
    "userRole": "owner"
  }
}
```

---

### Create Team

```
POST /api/v1/team
```

**Request Body:**

```json
{
  "name": "My Sales Team"
}
```

---

### Invite Team Member

```
POST /api/v1/team/invite
```

**Request Body:**

```json
{
  "email": "newmember@example.com",
  "role": "member"
}
```

| Role | Permissions |
|------|-------------|
| `owner` | Full access, billing, delete team |
| `admin` | Manage members, all features |
| `manager` | Create/edit content |
| `member` | View and use features |

**Response:**

```json
{
  "success": true,
  "data": {
    "inviteId": "invite_abc",
    "inviteCode": "abc123xyz",
    "inviteUrl": "https://app.pathsynch.com/join-team.html?code=abc123xyz"
  }
}
```

---

### Get Invite Details (Public)

```
GET /api/v1/team/invite-details?code=abc123xyz
```

---

### Accept Invite

```
POST /api/v1/team/accept-invite
```

**Request Body:**

```json
{
  "inviteCode": "abc123xyz"
}
```

---

### Update Member Role

```
PUT /api/v1/team/members/:memberId/role
```

**Request Body:**

```json
{
  "role": "admin"
}
```

---

### Remove Team Member

```
DELETE /api/v1/team/members/:memberId
```

---

### Cancel Invite

```
DELETE /api/v1/team/invites/:inviteId
```

---

## Analytics Endpoints

### Track Event

Track pitch analytics (works without auth for anonymous tracking).

```
POST /api/v1/analytics/track
```

**Request Body:**

```json
{
  "pitchId": "pitch_abc123",
  "event": "view",
  "data": {
    "source": "email",
    "campaign": "q1-outreach"
  }
}
```

| Event | Description |
|-------|-------------|
| `view` | Pitch was viewed |
| `cta_click` | CTA button clicked |
| `share` | Pitch was shared |
| `download` | Pitch was downloaded |

---

### Get Pitch Analytics

```
GET /api/v1/analytics/pitch/:pitchId
```

**Response:**

```json
{
  "success": true,
  "data": {
    "pitchId": "pitch_abc123",
    "views": 150,
    "ctaClicks": 25,
    "shares": 10,
    "downloads": 5,
    "viewsByDay": {
      "2026-01-15": 45,
      "2026-01-16": 62
    }
  }
}
```

---

## Market Intelligence Endpoints

### Generate Market Report

```
POST /api/v1/market/report
```

**Request Body:**

```json
{
  "city": "San Francisco",
  "state": "CA",
  "zipCode": "94102",
  "industry": "Restaurant",
  "subIndustry": "Fast Casual",
  "companySize": "medium",
  "radius": 10000
}
```

---

### List Market Reports

```
GET /api/v1/market/reports
```

---

### Get Market Report

```
GET /api/v1/market/reports/:reportId
```

---

### Get Industries

```
GET /api/v1/market/industries
```

---

### Save Search

```
POST /api/v1/market/saved-searches
```

---

### List Saved Searches

```
GET /api/v1/market/saved-searches
```

---

### Run Saved Search

```
POST /api/v1/market/saved-searches/:searchId/run
```

---

### Delete Saved Search

```
DELETE /api/v1/market/saved-searches/:searchId
```

---

## Billing Endpoints

### Get Pricing Plans

```
GET /api/v1/pricing-plans
```

---

### Get Subscription

```
GET /api/v1/subscription
```

---

### Create Checkout Session

```
POST /api/v1/stripe/create-checkout-session
```

**Request Body:**

```json
{
  "priceId": "price_xxx",
  "successUrl": "https://app.example.com/success",
  "cancelUrl": "https://app.example.com/cancel"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "cs_xxx",
    "url": "https://checkout.stripe.com/..."
  }
}
```

---

### Create Billing Portal Session

```
POST /api/v1/stripe/create-portal-session
```

---

## Bulk Upload Endpoints

### Download CSV Template

```
GET /api/v1/bulk/template
```

---

### Upload CSV

```
POST /api/v1/bulk/upload
```

Content-Type: `multipart/form-data`

---

### List Bulk Jobs

```
GET /api/v1/bulk/jobs
```

---

### Get Bulk Job

```
GET /api/v1/bulk/jobs/:jobId
```

---

### Download Bulk Results

```
GET /api/v1/bulk/jobs/:jobId/download
```

---

## Export Endpoints

### Export to PowerPoint

```
POST /api/v1/export/ppt/:pitchId
```

---

### Check Export Status

```
GET /api/v1/export/check
```

---

## Email Endpoints

### Email Pitch

```
POST /api/v1/pitch/:pitchId/email
```

**Request Body:**

```json
{
  "email": "recipient@example.com",
  "pdfBase64": "...",
  "filename": "pitch.pdf"
}
```

---

### Email Market Report

```
POST /api/v1/market/reports/:reportId/email
```

---

## Admin Endpoints

All admin endpoints require the user's email to be in the `ADMIN_EMAILS` whitelist.

### Get Admin Stats

```
GET /api/v1/admin/stats
```

---

### List Users

```
GET /api/v1/admin/users
```

---

### Get User

```
GET /api/v1/admin/users/:userId
```

---

### Update User

```
PATCH /api/v1/admin/users/:userId
```

---

### Get Revenue Stats

```
GET /api/v1/admin/revenue
```

---

### List All Pitches

```
GET /api/v1/admin/pitches
```

---

### Get Usage Stats

```
GET /api/v1/admin/usage
```

---

## Lead Capture Endpoints

### Generate Mini Report (Lead Magnet)

```
POST /api/v1/leads/mini-report
```

**Request Body:**

```json
{
  "email": "lead@example.com",
  "businessName": "Acme Corp",
  "city": "San Francisco",
  "state": "CA",
  "industry": "Restaurant"
}
```

---

### Get Lead Stats (Admin)

```
GET /api/v1/leads/stats
```

---

### Export Leads (Admin)

```
GET /api/v1/leads/export
```

---

## Health Check

```
GET /api/v1/health
```

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-01-15T10:30:00Z",
  "version": "v1"
}
```

---

## Rate Limits

Rate limits are enforced per user based on subscription plan:

| Plan | Pitches/month | Narratives/month | API calls/hour |
|------|---------------|------------------|----------------|
| Starter | 10 | 5 | 100 |
| Growth | 100 | 25 | 1000 |
| Scale | Unlimited | Unlimited | 5000 |

When rate limited, the API returns HTTP 429 with:

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT",
  "usage": {
    "used": 10,
    "limit": 10
  }
}
```
