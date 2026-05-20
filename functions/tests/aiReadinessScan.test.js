'use strict';

/**
 * Unit tests for api/aiReadinessScan.js
 *
 * Tests cover:
 * - HTTP method guard (405)
 * - Input validation (400)
 * - Abuse protection: Turnstile (403), daily cap (503), IP limit (429), fingerprint (429)
 * - hashFingerprint helper
 * - checkRateLimit helper
 * - checkFingerprint helper
 * - getDailyScanCount helper
 * - Successful scan response shape (totalScore, confidenceLevel, pillars, actions)
 * - confidenceLevel: 'low' for lead_magnet mode
 * - confidenceLabel: 'Estimated from public data'
 * - Outbound lead created when email provided
 */

// ── Mock hoisting — all jest.mock() calls must appear before require() ─────────

// firebase-functions/v2/https: strip onRequest wrapper so exports.handler is testable directly
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn(function(opts, fn) { return fn; })
}));

// firebase-admin: uses __mocks__/firebase-admin.js automatically
jest.mock('firebase-admin');

// @googlemaps/google-maps-services-js: expose mock functions via "mock" prefix so Jest hoists them
const mockTextSearch   = jest.fn();
const mockPlaceDetails = jest.fn();
jest.mock('@googlemaps/google-maps-services-js', () => ({
  Client: jest.fn().mockImplementation(function() {
    return { textSearch: mockTextSearch, placeDetails: mockPlaceDetails };
  })
}));

// serperClient: mock serperSearch
jest.mock('../services/serperClient', () => ({
  serperSearch: jest.fn()
}));

// aiReadinessScorer: mock scoreAiReadiness so tests don't run real scoring
jest.mock('../services/aiReadinessScorer', () => ({
  scoreAiReadiness: jest.fn()
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const {
  handler,
  hashFingerprint,
  checkRateLimit,
  checkFingerprint,
  getDailyScanCount
} = require('../api/aiReadinessScan');

const { scoreAiReadiness } = require('../services/aiReadinessScorer');
const { serperSearch } = require('../services/serperClient');

// ── Shared fixtures ────────────────────────────────────────────────────────────

// Minimal valid POST body (all required fields present)
const VALID_BODY = {
  businessName:   'Bright Smiles Dental',
  city:           'Atlanta',
  state:          'GA',
  turnstileToken: 'valid-token-123'
};

// Mock score returned by scoreAiReadiness in lead_magnet mode
const MOCK_SCORE = {
  totalScore:      42,
  schemaVersion:   '1.0',
  mode:            'lead_magnet',
  aisynchTier:     'lead_magnet',
  confidenceLevel: 'low',
  confidenceLabel: 'Estimated from public data',
  dataCompleteness: {
    totalSubItems: 23, realDataItems: 4, defaultedItems: 19,
    completenessPercent: 17, missingDataSources: []
  },
  pillars: {
    reviewAuthority:    { score: 8, max: 25, confidence: 'low', breakdown: {} },
    gbpCompleteness:    { score: 5, max: 20, confidence: 'low', breakdown: {} },
    webPresence:        { score: 6, max: 20, confidence: 'low', breakdown: {} },
    citationPresence:   { score: 3, max: 15, confidence: 'low', breakdown: {} },
    aiVisibility:       { score: 2, max: 10, confidence: 'low', breakdown: {} },
    competitivePosition:{ score: 5, max: 10, confidence: 'low', breakdown: {} }
  },
  actions: [
    { pillar: 'reviewAuthority', category: 'review_growth', title: 'Generate more reviews',
      whyItMatters: 'More reviews = more AI visibility', impact: 'high', difficulty: 'medium',
      pointsAvailable: 8, linkedProduct: 'PathConnect', ctaTarget: '/pathconnect/review-requests',
      status: 'open' }
  ],
  dataSources: { placesApiUsed: true, gbpAuditUsed: false, pageSpeedUsed: false,
                 serperUsed: false, aiVisibilityUsed: false, widgetSignalsUsed: false },
  scoredAt: new Date().toISOString()
};

// Mock Places API data (what findPlace returns after textSearch + placeDetails)
const MOCK_PLACE = {
  place_id:          'ChIJtest123',
  name:              'Bright Smiles Dental',
  formatted_address: '123 Peachtree St NE, Atlanta, GA 30303',
  website:           'https://brightsmilesdental.com',
  rating:            4.5,
  user_ratings_total: 87,
  types:             ['dentist', 'health', 'point_of_interest'],
  formatted_phone_number: '(404) 555-1234'
};

// ── Helper: create a mock req/res pair ────────────────────────────────────────

function mockReq(overrides) {
  return Object.assign({
    method:  'POST',
    body:    Object.assign({}, VALID_BODY),
    headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en-US' },
    ip:      '127.0.0.1'
  }, overrides);
}

function mockRes() {
  var res = { statusCode: 200, body: null };
  res.status = jest.fn(function(code) { res.statusCode = code; return res; });
  res.json   = jest.fn(function(data) { res.body = data; return res; });
  return res;
}

// ── Helper: configure mocks for a passing scan ────────────────────────────────

function setupPassingScan() {
  // Firestore state: no prior requests (empty aiReadinessRateLimits)
  admin._resetMockData();
  // Places API key must be set so findPlace() doesn't short-circuit
  process.env.GOOGLE_PLACES_API_KEY = 'test-places-key';

  // Turnstile + PSI both succeed via global fetch
  global.fetch = jest.fn().mockResolvedValue({
    ok:   true,
    json: jest.fn().mockResolvedValue({ success: true })
  });

  // Places textSearch returns one result
  mockTextSearch.mockResolvedValue({
    data: { results: [MOCK_PLACE] }
  });
  // Places placeDetails returns full detail
  mockPlaceDetails.mockResolvedValue({
    data: { result: MOCK_PLACE }
  });

  // Serper returns 3 directory hits
  serperSearch.mockResolvedValue({
    organic: [
      { link: 'https://www.yelp.com/biz/bright-smiles' },
      { link: 'https://www.yellowpages.com/atlanta/bright-smiles' },
      { link: 'https://www.bbb.org/us/ga/atlanta/profile/bright-smiles' }
    ]
  });

  // Scorer returns mock score
  scoreAiReadiness.mockResolvedValue(MOCK_SCORE);
}

// ── beforeEach: reset state between tests ─────────────────────────────────────

beforeEach(function() {
  jest.clearAllMocks();
  admin._resetMockData();
  // Turnstile secret must be set so verifyTurnstile calls fetch (not short-circuit to false)
  process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
  // Default: Turnstile succeeds
  global.fetch = jest.fn().mockResolvedValue({
    ok:   true,
    json: jest.fn().mockResolvedValue({ success: true })
  });
});

afterEach(function() {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: hashFingerprint helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('hashFingerprint', function() {
  test('returns consistent 16-char hex string for same inputs', function() {
    var h1 = hashFingerprint('1.2.3.4', 'Mozilla/5.0', 'en-US');
    var h2 = hashFingerprint('1.2.3.4', 'Mozilla/5.0', 'en-US');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
  });

  test('returns different hash for different IP', function() {
    var h1 = hashFingerprint('1.2.3.4', 'Mozilla/5.0', 'en-US');
    var h2 = hashFingerprint('9.9.9.9', 'Mozilla/5.0', 'en-US');
    expect(h1).not.toBe(h2);
  });

  test('returns different hash for different user-agent', function() {
    var h1 = hashFingerprint('1.2.3.4', 'Chrome/120', 'en-US');
    var h2 = hashFingerprint('1.2.3.4', 'Firefox/115', 'en-US');
    expect(h1).not.toBe(h2);
  });

  test('handles undefined/null inputs without throwing', function() {
    var h = hashFingerprint(undefined, undefined, undefined);
    expect(typeof h).toBe('string');
    expect(h.length).toBe(16);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: getDailyScanCount helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDailyScanCount', function() {
  test('returns 0 when no document exists for today', async function() {
    // Empty Firestore (no aiReadinessRateLimits docs)
    var count = await getDailyScanCount();
    expect(count).toBe(0);
  });

  test('returns the count from the daily document', async function() {
    var today = new Date().toISOString().split('T')[0];
    admin._setMockCollection('aiReadinessRateLimits', {
      ['daily_' + today]: { count: 317, date: today }
    });
    var count = await getDailyScanCount();
    expect(count).toBe(317);
  });

  test('daily cap logic: returns false when count >= 500', async function() {
    var today = new Date().toISOString().split('T')[0];
    admin._setMockCollection('aiReadinessRateLimits', {
      ['daily_' + today]: { count: 500, date: today }
    });
    var count = await getDailyScanCount();
    expect(count).toBeGreaterThanOrEqual(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: checkRateLimit helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkRateLimit', function() {
  test('returns true when IP has no prior requests this window', async function() {
    var ok = await checkRateLimit('10.0.0.1', 10, 3600);
    expect(ok).toBe(true);
  });

  test('returns false when IP count is already at the limit', async function() {
    var windowKey = Math.floor(Date.now() / 1000 / 3600);
    var key = 'ip_1.2.3.4_' + windowKey;
    admin._setMockCollection('aiReadinessRateLimits', {
      [key]: { count: 10, ip: '1.2.3.4', windowKey: windowKey }
    });
    var ok = await checkRateLimit('1.2.3.4', 10, 3600);
    expect(ok).toBe(false);
  });

  test('returns false (not true) when count is exactly 10 for same IP', async function() {
    // Pre-seed with count = 10
    var windowKey = Math.floor(Date.now() / 1000 / 3600);
    var ip = '5.5.5.5';
    var key = 'ip_' + ip + '_' + windowKey;
    admin._setMockCollection('aiReadinessRateLimits', {
      [key]: { count: 10, ip: ip, windowKey: windowKey }
    });
    // 11th request (count=10 ≥ maxCount=10) → false
    var ok = await checkRateLimit(ip, 10, 3600);
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: checkFingerprint helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkFingerprint', function() {
  test('returns true when fingerprint has no prior requests today', async function() {
    var ok = await checkFingerprint('abc123def456ab78', 20);
    expect(ok).toBe(true);
  });

  test('returns false when fingerprint count has reached daily limit', async function() {
    var today = new Date().toISOString().split('T')[0];
    var fp = 'deadbeefcafe1234';
    var key = 'fp_' + fp + '_' + today;
    admin._setMockCollection('aiReadinessRateLimits', {
      [key]: { count: 20, fingerprint: fp, date: today }
    });
    var ok = await checkFingerprint(fp, 20);
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: Handler — HTTP method guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('handler — method guard', function() {
  test('returns 405 for GET requests', async function() {
    var req = mockReq({ method: 'GET' });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/POST only/i);
  });

  test('returns 405 for PUT requests', async function() {
    var req = mockReq({ method: 'PUT' });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('returns 405 for DELETE requests', async function() {
    var req = mockReq({ method: 'DELETE' });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: Handler — input validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('handler — input validation', function() {
  test('returns 400 if businessName is missing', async function() {
    var req = mockReq({ body: { city: 'Atlanta', state: 'GA', turnstileToken: 'tok' } });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/businessName/i);
  });

  test('returns 400 if city is missing', async function() {
    var req = mockReq({ body: { businessName: 'Acme', state: 'GA', turnstileToken: 'tok' } });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 if state is missing', async function() {
    var req = mockReq({ body: { businessName: 'Acme', city: 'Atlanta', turnstileToken: 'tok' } });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 if turnstileToken is missing', async function() {
    var req = mockReq({ body: { businessName: 'Acme', city: 'Atlanta', state: 'GA' } });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: Handler — abuse protection
// ═══════════════════════════════════════════════════════════════════════════════

describe('handler — abuse protection', function() {
  test('returns 403 when Turnstile verification fails', async function() {
    // Turnstile secret is set by beforeEach; override fetch to return failure
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ success: false })
    });
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/verification failed/i);
  });

  test('returns 503 when daily global cap (500) is reached', async function() {
    // Turnstile passes
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ success: true })
    });
    // Daily counter is at 500
    var today = new Date().toISOString().split('T')[0];
    admin._setMockCollection('aiReadinessRateLimits', {
      ['daily_' + today]: { count: 500, date: today }
    });
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/high demand/i);
  });

  test('returns 429 when IP rate limit is exceeded', async function() {
    // Turnstile passes
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ success: true })
    });
    // IP has already made 10 requests this hour
    var windowKey = Math.floor(Date.now() / 1000 / 3600);
    var ip = '127.0.0.1';
    var key = 'ip_' + ip + '_' + windowKey;
    admin._setMockCollection('aiReadinessRateLimits', {
      [key]: { count: 10, ip: ip, windowKey: windowKey }
    });
    var req = mockReq({ ip: ip });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  test('returns 429 when device fingerprint limit is exceeded', async function() {
    // Turnstile passes, daily count = 0, IP limit not hit
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ success: true })
    });
    var today = new Date().toISOString().split('T')[0];
    // Pre-seed fingerprint doc at limit
    var fp = require('crypto').createHash('sha256')
      .update('127.0.0.1|Mozilla/5.0|en-US')
      .digest('hex')
      .substring(0, 16);
    var key = 'fp_' + fp + '_' + today;
    admin._setMockCollection('aiReadinessRateLimits', {
      [key]: { count: 20, fingerprint: fp, date: today }
    });
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/too many requests/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: Handler — successful scan response
// ═══════════════════════════════════════════════════════════════════════════════

describe('handler — successful scan', function() {
  beforeEach(function() {
    setupPassingScan();
  });

  test('returns 200 with scanId when scan succeeds', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.scanId).toBe('string');
  });

  test('response includes totalScore as a number', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(typeof res.body.totalScore).toBe('number');
  });

  test('response includes confidenceLevel field', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.body.confidenceLevel).toBeDefined();
  });

  test('confidenceLevel is "low" for lead_magnet mode (public data only)', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.body.confidenceLevel).toBe('low');
  });

  test('confidenceLabel is "Estimated from public data"', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.body.confidenceLabel).toBe('Estimated from public data');
  });

  test('response includes pillars object', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.body.pillars).toBeDefined();
    expect(typeof res.body.pillars).toBe('object');
  });

  test('response includes actions array', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(Array.isArray(res.body.actions)).toBe(true);
  });

  test('response includes placeId and businessName', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(typeof res.body.placeId).toBe('string');
    expect(typeof res.body.businessName).toBe('string');
  });

  test('scoreAiReadiness is called with lead_magnet mode', async function() {
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(scoreAiReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        gbpAuditData:     null,
        reviewData:       null,
        widgetSignals:    null,
        aiVisibilityData: null,
        competitorData:   null,
        marketBenchmarks: null
      }),
      'lead_magnet'
    );
  });

  test('creates outbound lead record when email is provided', async function() {
    var req = mockReq({
      body: Object.assign({}, VALID_BODY, { email: 'owner@example.com' })
    });
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    // Verify outbound lead was written to Firestore
    var db = admin.firestore();
    var leadsSnap = await db.collection('outboundLeads').get();
    expect(leadsSnap.docs.length).toBeGreaterThan(0);
    var lead = leadsSnap.docs[0].data();
    expect(lead.email).toBe('owner@example.com');
    expect(lead.businessName).toBe('Bright Smiles Dental');
  });

  test('returns 404 when Google Places finds no matching business', async function() {
    mockTextSearch.mockResolvedValue({ data: { results: [] } });
    var req = mockReq();
    var res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/business not found/i);
  });
});
