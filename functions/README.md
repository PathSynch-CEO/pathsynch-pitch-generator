# PathSynch Cloud Functions

Firebase Cloud Functions backend for the PathSynch Pitch Generator platform.

## Architecture Overview

```
functions/
├── index.js                 # Main API handler & Cloud Function export
├── api/                     # API endpoint handlers
│   ├── pitchGenerator.js   # Template-based pitch generation
│   ├── narratives.js       # AI narrative generation
│   ├── formatterApi.js     # Format conversion handlers
│   ├── stripe.js           # Payment & subscription
│   ├── market.js           # Market intelligence
│   ├── bulk.js             # CSV bulk processing
│   ├── export.js           # PPT export
│   ├── leads.js            # Lead capture
│   └── admin.js            # Admin dashboard
├── routes/                  # Modular route definitions
│   ├── index.js            # Route registry
│   ├── pitchRoutes.js      # Pitch endpoints
│   ├── userRoutes.js       # User endpoints
│   ├── teamRoutes.js       # Team management
│   └── analyticsRoutes.js  # Analytics tracking
├── services/                # Business logic services
│   ├── claudeClient.js     # Claude AI integration
│   ├── narrativeReasoner.js # AI reasoning logic
│   ├── narrativeValidator.js # Validation
│   ├── narrativeCache.js   # Caching layer
│   ├── email.js            # SendGrid integration
│   ├── census.js           # Census data
│   ├── geography.js        # Geographic processing
│   ├── googlePlaces.js     # Google Places API
│   └── googleTrends.js     # Google Trends
├── middleware/              # Request middleware
│   ├── adminAuth.js        # Admin whitelist
│   ├── planGate.js         # Usage limits
│   ├── validation.js       # Joi schema validation
│   └── errorHandler.js     # Error handling
├── formatters/              # Output format generators
│   ├── baseFormatter.js    # Base class
│   ├── salesPitchFormatter.js
│   ├── onePagerFormatter.js
│   ├── emailSequenceFormatter.js
│   ├── linkedInFormatter.js
│   ├── executiveSummaryFormatter.js
│   ├── proposalFormatter.js
│   ├── deckFormatter.js
│   └── formatterRegistry.js
├── utils/                   # Shared utilities
│   ├── roiCalculator.js    # ROI calculations
│   └── router.js           # Express-like routing
├── config/                  # Configuration
│   ├── stripe.js           # Plan definitions
│   ├── claude.js           # Claude API config
│   └── naics.js            # Industry classification
├── __tests__/               # Jest test suites
│   ├── setup.js
│   ├── utils/
│   ├── middleware/
│   └── routes/
└── __mocks__/               # Test mocks
    ├── firebase-admin.js
    └── stripe.js
```

## Setup

### Prerequisites

- Node.js 20+
- Firebase CLI
- Firebase project with Firestore enabled

### Installation

```bash
# Install dependencies
npm install

# Login to Firebase
firebase login

# Select project
firebase use <project-id>
```

### Environment Variables

Create a `.env` file (this file is gitignored):

```env
# Required
ADMIN_EMAILS=admin@yourcompany.com,support@yourcompany.com
ALLOWED_ORIGINS=https://your-app.web.app,http://localhost:5173
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SENDGRID_API_KEY=SG.xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Optional
GOOGLE_PLACES_API_KEY=xxx
CENSUS_API_KEY=xxx
NODE_ENV=production
```

For Firebase Functions, set these via the CLI:

```bash
firebase functions:config:set \
  admin.emails="admin@example.com,support@example.com" \
  stripe.secret_key="sk_live_xxx" \
  stripe.webhook_secret="whsec_xxx" \
  sendgrid.api_key="SG.xxx" \
  anthropic.api_key="sk-ant-xxx"
```

## Development

### Local Development with Emulators

```bash
# Start Firebase emulators
npm run serve

# Or start all emulators
firebase emulators:start
```

The emulator UI is available at `http://localhost:4000`.

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# CI mode (for pipelines)
npm run test:ci
```

### Linting

```bash
npm run lint
```

## Deployment

### Deploy All Functions

```bash
npm run deploy
# or
firebase deploy --only functions
```

### Deploy Specific Function

```bash
firebase deploy --only functions:api
```

### View Logs

```bash
npm run logs
# or
firebase functions:log
```

## API Structure

### Request Flow

```
Request → CORS → Auth Verification → Route Matching → Validation → Handler → Response
```

### Adding a New Endpoint

1. **Create route handler** in `routes/` or `api/`:

```javascript
// routes/myRoutes.js
const { createRouter } = require('../utils/router');
const router = createRouter();

router.get('/my-endpoint', async (req, res) => {
    // Handler logic
    res.json({ success: true, data: {} });
});

module.exports = router;
```

2. **Add validation schema** in `middleware/validation.js`:

```javascript
const schemas = {
    myEndpoint: Joi.object({
        field: Joi.string().required()
    })
};
```

3. **Register route** in `routes/index.js`:

```javascript
const myRoutes = require('./myRoutes');

module.exports = {
    // ...existing routes
    myRoutes
};
```

4. **Add to main handler** in `index.js`:

```javascript
const { myRoutes } = require('./routes');

// In the handler:
if (await myRoutes.handle(req, res)) return;
```

5. **Write tests** in `__tests__/routes/myRoutes.test.js`.

## Middleware

### Authentication (`verifyAuth`)

Extracts and verifies Firebase ID token from Authorization header.

```javascript
const decodedToken = await verifyAuth(req);
// Returns { uid, email } or null
```

### Validation (`validateBody`)

Validates request body against Joi schemas.

```javascript
const { validateBody } = require('./middleware/validation');

const result = validateBody(req.body, 'schemaName');
if (!result.valid) {
    return res.status(400).json({ error: result.errors });
}
req.body = result.value; // Sanitized data
```

### Admin Auth (`requireAdmin`)

Restricts access to admin users.

```javascript
const { requireAdmin } = require('./middleware/adminAuth');

// As middleware
router.get('/admin/stats', requireAdmin, handler);
```

### Error Handling

```javascript
const { handleError, ApiError, ErrorCodes } = require('./middleware/errorHandler');

// Throw operational errors
throw new ApiError(ErrorCodes.NOT_FOUND, 'Resource not found');

// Handle errors in catch blocks
try {
    // ...
} catch (error) {
    return handleError(error, res, 'MyEndpoint');
}
```

## Router Utility

Custom Express-like router for Firebase Functions:

```javascript
const { createRouter } = require('./utils/router');

const router = createRouter();

// Register routes
router.get('/users', handler);
router.get('/users/:id', handler);
router.post('/users', middleware, handler);

// Handle request
const handled = await router.handle(req, res);
if (!handled) {
    // Route not found
}
```

## Testing

### Test Utilities

```javascript
// Available in all tests via global.testUtils

const req = global.testUtils.mockRequest({
    method: 'POST',
    path: '/api/v1/endpoint',
    body: { data: 'value' },
    userId: 'user_123'
});

const res = global.testUtils.mockResponse();

// Custom matchers
expect(res).toBeSuccessResponse();
expect(res).toBeErrorResponse(401);
```

### Firebase Mocks

The `__mocks__/firebase-admin.js` provides:

```javascript
// Set mock data
admin._setMockCollection('users', {
    'user_123': { email: 'test@example.com' }
});

admin._setMockUser('user_123', {
    uid: 'user_123',
    email: 'test@example.com'
});

// Reset between tests
admin._resetMockData();
```

## Configuration

### Subscription Plans (`config/stripe.js`)

```javascript
const PLANS = {
    starter: {
        name: 'Starter',
        price: 0,
        limits: { pitches: 10, narratives: 5, teamMembers: 1 }
    },
    growth: {
        name: 'Growth',
        price: 4900, // cents
        limits: { pitches: 100, narratives: 25, teamMembers: 3 }
    },
    scale: {
        name: 'Scale',
        price: 14900,
        limits: { pitches: -1, narratives: -1, teamMembers: 5 } // -1 = unlimited
    }
};
```

### Claude AI (`config/claude.js`)

```javascript
const CLAUDE_CONFIG = {
    model: 'claude-3-sonnet-20240229',
    maxTokens: 4096,
    temperature: 0.7,
    fallbackToTemplates: true
};
```

## Firestore Collections

| Collection | Description |
|------------|-------------|
| `users` | User profiles and settings |
| `pitches` | Generated pitches |
| `narratives` | AI-generated narratives |
| `formattedAssets` | Formatted output documents |
| `usage` | Monthly usage tracking |
| `teams` | Team definitions |
| `teamMembers` | Team membership |
| `teamInvites` | Pending invitations |
| `pitchAnalytics` | Pitch view/click tracking |
| `marketReports` | Market intelligence reports |
| `savedSearches` | Saved market searches |
| `leads` | Lead capture data |

## Troubleshooting

### Common Issues

**Function timeout:**
- Default timeout is 120 seconds
- Increase in `setGlobalOptions({ timeoutSeconds: 300 })`

**Memory errors:**
- Default memory is 512MiB
- Increase in function options: `memory: '1GiB'`

**CORS errors:**
- Check `ALLOWED_ORIGINS` environment variable
- Ensure origin includes protocol (`https://`)

**Auth errors:**
- Verify Firebase project configuration
- Check ID token format in Authorization header

### Debug Logging

Enable verbose logging:

```javascript
console.log('Debug:', JSON.stringify(data, null, 2));
```

View logs:

```bash
firebase functions:log --only api
```

## Performance Tips

1. **Cold starts**: Keep functions warm with scheduled pings
2. **Firestore**: Use compound indexes for complex queries
3. **Caching**: Use `narrativeCache` for expensive AI calls
4. **Batch writes**: Use Firestore batches for multiple writes

## Security Checklist

- [ ] Admin emails in environment variables (not hardcoded)
- [ ] CORS origins restricted to known domains
- [ ] Input validation on all endpoints
- [ ] Error messages don't expose internals in production
- [ ] Firestore rules restrict data access
- [ ] Stripe webhooks verify signatures
- [ ] Rate limiting enforced per plan
