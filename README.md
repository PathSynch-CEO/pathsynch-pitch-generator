# PathSynch Pitch Generator

A comprehensive SaaS platform for B2B sales pitch generation with AI-powered narratives, market intelligence, and subscription billing.

## Features

- **Template-Based Pitch Generation** - 3 levels of complexity (outreach sequences, enhanced pitches, full presentations)
- **AI-Powered Narratives** - Claude AI generates custom business narratives
- **Multi-Format Export** - Sales pitches, LinkedIn posts, email sequences, executive summaries, proposals, PowerPoint decks
- **Market Intelligence** - Geographic and demographic analysis using Census, Google Places, and Google Trends data
- **Bulk CSV Upload** - Process multiple business records at once
- **Team Management** - Multi-user teams with role-based access (Owner/Admin/Manager/Member)
- **Subscription Billing** - Stripe integration with Starter/Growth/Scale tiers
- **Analytics** - Track pitch views, CTA clicks, shares, and downloads

## Tech Stack

### Frontend
- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS
- Firebase SDK

### Backend (Cloud Functions)
- Node.js 20
- Firebase Cloud Functions
- Firestore (NoSQL database)
- Firebase Authentication
- Stripe (payments)
- SendGrid (email)
- Anthropic Claude API (AI)

## Project Structure

```
pathsynch-pitch-generator/
├── src/                    # React frontend source
├── public/                 # Static HTML pages & assets
├── functions/              # Firebase Cloud Functions
│   ├── api/               # API endpoint handlers
│   ├── routes/            # Modular route definitions
│   ├── services/          # Business logic services
│   ├── middleware/        # Auth, validation, error handling
│   ├── formatters/        # Output format generators
│   ├── utils/             # Shared utilities
│   ├── config/            # Configuration files
│   └── __tests__/         # Jest test suites
├── docs/                   # Documentation
├── firebase.json          # Firebase configuration
├── firestore.rules        # Security rules
└── package.json           # Frontend dependencies
```

## Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project with Firestore, Auth, and Cloud Functions enabled

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd pathsynch-pitch-generator
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install Cloud Functions dependencies**
   ```bash
   cd functions
   npm install
   cd ..
   ```

4. **Configure Firebase**
   ```bash
   firebase login
   firebase use --add  # Select your project
   ```

5. **Set up environment variables**

   Create `functions/.env` with:
   ```env
   # Admin Access (comma-separated emails)
   ADMIN_EMAILS=admin@yourcompany.com

   # CORS (comma-separated allowed origins)
   ALLOWED_ORIGINS=https://your-app.web.app,http://localhost:5173

   # Stripe
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx

   # SendGrid
   SENDGRID_API_KEY=SG.xxx

   # Claude AI
   ANTHROPIC_API_KEY=sk-ant-xxx

   # Google APIs
   GOOGLE_PLACES_API_KEY=xxx
   CENSUS_API_KEY=xxx
   ```

### Development

**Start frontend dev server:**
```bash
npm run dev
```

**Start Firebase emulators:**
```bash
cd functions
npm run serve
```

**Run tests:**
```bash
cd functions
npm test
```

### Deployment

**Deploy everything:**
```bash
firebase deploy
```

**Deploy only functions:**
```bash
firebase deploy --only functions
```

**Deploy only hosting:**
```bash
npm run build
firebase deploy --only hosting
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_EMAILS` | Yes | Comma-separated admin email addresses |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS allowed origins |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `SENDGRID_API_KEY` | Yes | SendGrid API key for emails |
| `ANTHROPIC_API_KEY` | Yes | Claude AI API key |
| `GOOGLE_PLACES_API_KEY` | No | Google Places API key (for market intel) |
| `CENSUS_API_KEY` | No | Census.gov API key (for demographics) |
| `NODE_ENV` | No | Set to `production` for production mode |

## API Documentation

See [docs/API.md](docs/API.md) for complete API documentation.

### Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/generate-pitch` | POST | Generate a pitch |
| `/api/v1/pitches` | GET | List user's pitches |
| `/api/v1/pitch/:id` | GET | Get pitch by ID |
| `/api/v1/narratives/generate` | POST | Generate AI narrative |
| `/api/v1/narratives/:id/format/:type` | POST | Format narrative to output |
| `/api/v1/team` | GET | Get team info |
| `/api/v1/team/invite` | POST | Invite team member |
| `/api/v1/market/report` | POST | Generate market report |
| `/api/v1/stripe/create-checkout-session` | POST | Start subscription |

## Testing

```bash
cd functions

# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run for CI
npm run test:ci
```

### Test Structure

```
functions/__tests__/
├── setup.js                 # Test configuration
├── utils/
│   ├── roiCalculator.test.js
│   └── router.test.js
├── middleware/
│   ├── validation.test.js
│   ├── errorHandler.test.js
│   └── adminAuth.test.js
└── routes/
    ├── userRoutes.test.js
    ├── teamRoutes.test.js
    └── analyticsRoutes.test.js
```

## Subscription Plans

| Feature | Starter (Free) | Growth ($49/mo) | Scale ($149/mo) |
|---------|---------------|-----------------|-----------------|
| Pitches/month | 10 | 100 | Unlimited |
| AI Narratives/month | 5 | 25 | Unlimited |
| Team Members | 1 | 3 | 5 |
| Market Reports | - | Yes | Yes |
| White-label | - | Yes | Yes |
| All Formatters | - | - | Yes |

## Security

- Firebase Authentication for user management
- Firestore security rules for data access control
- Environment-based admin whitelist
- Input validation with Joi schemas
- Sanitized error responses in production
- CORS origin whitelisting
- Stripe webhook signature verification

## Contributing

1. Create a feature branch
2. Make changes with tests
3. Run `npm test` to ensure all tests pass
4. Submit a pull request

## License

Proprietary - All rights reserved.
