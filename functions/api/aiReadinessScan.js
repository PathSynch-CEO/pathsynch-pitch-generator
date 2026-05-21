'use strict';

/**
 * aiReadinessScan.js
 * Free scan Cloud Function — AIsynch Phase 1A-2
 *
 * Public endpoint: POST /aiReadinessScan
 * Accepts { businessName, city, state, email?, turnstileToken }
 * Returns AI Readiness score in lead_magnet mode.
 *
 * Abuse protection (layered):
 *   1. Cloudflare Turnstile token verification
 *   2. Daily global cap (500/day)
 *   3. IP rate limit (10/hour)
 *   4. Request fingerprint limit (20/day per device)
 *
 * CORS restricted to: pathsynch.com, www.pathsynch.com, localhost:3000
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Client } = require('@googlemaps/google-maps-services-js');
const { scoreAiReadiness } = require('../services/aiReadinessScorer');
const { serperSearch } = require('../services/serperClient');

// ── Constants ──────────────────────────────────────────────────────────────────

const CORS_ORIGINS = [
  'https://pathsynch.com',
  'https://www.pathsynch.com',
  'http://localhost:3000'
];

const DIRECTORY_DOMAINS = [
  'yelp.com', 'yellowpages.com', 'bbb.org', 'angi.com',
  'thumbtack.com', 'houzz.com', 'homeadvisor.com', 'manta.com',
  'angieslist.com', 'citysearch.com'
];

const DAILY_CAP = 500;
const IP_RATE_LIMIT = 10;
const IP_WINDOW_SECONDS = 3600;
const FINGERPRINT_DAILY_LIMIT = 20;

// Module-level Places client (instantiated once)
const placesClient = new Client({});

// ── Abuse protection helpers ───────────────────────────────────────────────────

/**
 * SHA-256 hash of IP + User-Agent + Accept-Language, truncated to 16 hex chars.
 * Consistent for same inputs, differs for different inputs.
 */
function hashFingerprint(ip, userAgent, acceptLanguage) {
  return crypto.createHash('sha256')
    .update((ip || '') + '|' + (userAgent || '') + '|' + (acceptLanguage || ''))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Verify Cloudflare Turnstile token server-side.
 * Returns true only when Cloudflare confirms success.
 */
async function verifyTurnstile(token, ip) {
  var secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  try {
    var response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secret, response: token, remoteip: ip || '' })
    });
    var data = await response.json();
    return data.success === true;
  } catch (e) {
    console.error('[AIReadinessScan] Turnstile verify error:', e.message);
    return false;
  }
}

/**
 * Returns the current daily scan count from Firestore.
 * Document key: aiReadinessRateLimits/daily_{YYYY-MM-DD}
 */
async function getDailyScanCount() {
  var db = admin.firestore();
  var today = new Date().toISOString().split('T')[0];
  var doc = await db.collection('aiReadinessRateLimits').doc('daily_' + today).get();
  return doc.exists ? (doc.data().count || 0) : 0;
}

/**
 * Atomically increments the daily global scan counter.
 */
async function incrementDailyScanCount() {
  var db = admin.firestore();
  var today = new Date().toISOString().split('T')[0];
  await db.collection('aiReadinessRateLimits').doc('daily_' + today).set(
    { count: admin.firestore.FieldValue.increment(1), date: today },
    { merge: true }
  );
}

/**
 * IP-based rate limit check.
 * Window key = floor(epochSeconds / windowSeconds) — resets each window.
 * Returns false if the IP has already made maxCount requests in the current window.
 * Returns true and increments the counter otherwise.
 *
 * @param {string} ip
 * @param {number} maxCount  max requests allowed per window (e.g. 10)
 * @param {number} windowSeconds  window size in seconds (e.g. 3600 for 1 hour)
 * @returns {Promise<boolean>}
 */
async function checkRateLimit(ip, maxCount, windowSeconds) {
  var db = admin.firestore();
  var windowKey = Math.floor(Date.now() / 1000 / windowSeconds);
  var key = 'ip_' + (ip || 'unknown') + '_' + windowKey;
  var docRef = db.collection('aiReadinessRateLimits').doc(key);
  var doc = await docRef.get();
  var count = doc.exists ? (doc.data().count || 0) : 0;
  if (count >= maxCount) return false;
  await docRef.set(
    { count: admin.firestore.FieldValue.increment(1), ip: ip, windowKey: windowKey },
    { merge: true }
  );
  return true;
}

/**
 * Request fingerprint check (device-level, daily limit).
 * Fingerprint = hash of IP + User-Agent + Accept-Language.
 * Returns false if fingerprint has exceeded maxCount requests today.
 *
 * @param {string} fingerprint  16-char hex hash from hashFingerprint()
 * @param {number} maxCount  daily limit per fingerprint (e.g. 20)
 * @returns {Promise<boolean>}
 */
async function checkFingerprint(fingerprint, maxCount) {
  var db = admin.firestore();
  var today = new Date().toISOString().split('T')[0];
  var key = 'fp_' + fingerprint + '_' + today;
  var docRef = db.collection('aiReadinessRateLimits').doc(key);
  var doc = await docRef.get();
  var count = doc.exists ? (doc.data().count || 0) : 0;
  if (count >= maxCount) return false;
  await docRef.set(
    { count: admin.firestore.FieldValue.increment(1), fingerprint: fingerprint, date: today },
    { merge: true }
  );
  return true;
}

// ── Data collection helpers ────────────────────────────────────────────────────

/**
 * Find a business via Google Places textSearch + placeDetails.
 * Returns merged place object (textSearch fields + detail fields) or null.
 */
async function findPlace(businessName, city, state) {
  var apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not configured');

  var query = [businessName, city, state].filter(Boolean).join(' ');
  var searchRes = await placesClient.textSearch({ params: { query: query, key: apiKey } });
  var results = (searchRes.data && searchRes.data.results) || [];
  if (!results.length) return null;

  var place = results[0];
  var placeId = place.place_id;

  try {
    var detailsRes = await placesClient.placeDetails({
      params: {
        place_id: placeId,
        fields: [
          'name', 'formatted_address', 'formatted_phone_number',
          'international_phone_number', 'website', 'rating',
          'user_ratings_total', 'types', 'photos', 'editorial_summary'
        ],
        key: apiKey
      }
    });
    var detail = (detailsRes.data && detailsRes.data.result) || {};
    return Object.assign({}, place, detail, { place_id: placeId });
  } catch (e) {
    // Fall back to textSearch-only data if details call fails
    return place;
  }
}

/**
 * Fetch Google PageSpeed Insights score for a website (mobile strategy).
 * Returns { score, mobileScore } or null on failure / missing website.
 */
async function getPageSpeedScore(website) {
  if (!website) return null;
  try {
    var apiKey = process.env.GOOGLE_PSI_API_KEY || '';
    var psiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' +
      encodeURIComponent(website) + '&strategy=mobile' +
      (apiKey ? '&key=' + apiKey : '');
    var res = await fetch(psiUrl);
    if (!res.ok) return null;
    var data = await res.json();
    var cats = data.lighthouseResult && data.lighthouseResult.categories;
    if (!cats || !cats.performance) return null;
    var perfScore = Math.round(cats.performance.score * 100);
    return { score: perfScore, mobileScore: perfScore };
  } catch (e) {
    return null;
  }
}

/**
 * Search Serper for directory presence (Yelp, YP, BBB, Angi, etc.).
 * Returns { directoryCount, napConsistency, localAuthoritySiteCount, backlinkCount } or null.
 */
async function searchDirectoryPresence(businessName, city, state) {
  try {
    var query = '"' + businessName + '" "' + city + '" "' + (state || '') + '"';
    var results = await serperSearch(query);
    var organic = (results && results.organic) || [];
    var hits = organic.filter(function(r) {
      var link = (r.link || '').toLowerCase();
      return DIRECTORY_DOMAINS.some(function(d) { return link.includes(d); });
    });
    return {
      directoryCount: hits.length,
      napConsistency: null,
      localAuthoritySiteCount: 0,
      backlinkCount: 0
    };
  } catch (e) {
    return null;
  }
}

/**
 * Returns the pillar name with the lowest score-to-max ratio.
 */
function findWeakestPillar(pillars) {
  var weakest = null;
  var lowestRatio = Infinity;
  Object.keys(pillars).forEach(function(pk) {
    var p = pillars[pk];
    var ratio = p.max > 0 ? p.score / p.max : 0;
    if (ratio < lowestRatio) { lowestRatio = ratio; weakest = pk; }
  });
  return weakest;
}

/**
 * Write an outbound lead record to Firestore (non-blocking; errors logged only).
 */
async function createOutboundLead(data) {
  var db = admin.firestore();
  try {
    await db.collection('outboundLeads').add(Object.assign({}, data, {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'new',
      source: 'ai_readiness_scan'
    }));
  } catch (e) {
    console.error('[AIReadinessScan] createOutboundLead error:', e.message);
  }
}

// ── Main request handler ───────────────────────────────────────────────────────

async function handler(req, res) {
  // Method guard
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  var body = req.body || {};
  var businessName  = body.businessName;
  var city          = body.city;
  var state         = body.state;
  var email         = body.email || null;
  var turnstileToken = body.turnstileToken;

  // Input validation
  if (!businessName || !city || !state) {
    return res.status(400).json({ error: 'businessName, city, and state are required' });
  }
  if (!turnstileToken) {
    return res.status(400).json({ error: 'Verification token required' });
  }

  // --- Abuse protection ---

  // 1. Turnstile
  var turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) {
    return res.status(403).json({ error: 'Verification failed. Please try again.' });
  }

  // 2. Daily global cap
  var dailyCount = await getDailyScanCount();
  if (dailyCount >= DAILY_CAP) {
    return res.status(503).json({ error: 'High demand \u2014 please try again tomorrow.' });
  }

  // 3. IP rate limit (10 per hour)
  var rateLimitOk = await checkRateLimit(req.ip, IP_RATE_LIMIT, IP_WINDOW_SECONDS);
  if (!rateLimitOk) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in 1 hour.' });
  }

  // 4. Fingerprint check (20 per day per device)
  var fingerprint = hashFingerprint(
    req.ip,
    req.headers['user-agent'],
    req.headers['accept-language']
  );
  var fingerprintOk = await checkFingerprint(fingerprint, FINGERPRINT_DAILY_LIMIT);
  if (!fingerprintOk) {
    return res.status(429).json({ error: 'Too many requests from this device.' });
  }

  try {
    // Step 1: Google Places lookup
    var placeData = await findPlace(businessName, city, state);
    if (!placeData) {
      return res.status(404).json({ error: 'Business not found. Check the name and city.' });
    }

    // Step 2: PageSpeed + Serper in parallel (allSettled — one failure doesn't block the other)
    var parallelResults = await Promise.allSettled([
      getPageSpeedScore(placeData.website),
      searchDirectoryPresence(businessName, city, state)
    ]);
    var pageSpeedData  = parallelResults[0].status === 'fulfilled' ? parallelResults[0].value : null;
    var serperResults  = parallelResults[1].status === 'fulfilled' ? parallelResults[1].value : null;

    // Step 3: Score in lead_magnet mode (public data only)
    var score = await scoreAiReadiness({
      placeData:       placeData,
      gbpAuditData:    null,
      reviewData:      null,
      pageSpeedData:   pageSpeedData,
      serperResults:   serperResults,
      widgetSignals:   null,
      aiVisibilityData: null,
      competitorData:  null,
      marketBenchmarks: null
    }, 'lead_magnet');

    // Step 4: Store scan result in Firestore
    var db = admin.firestore();
    var scanRef = await db.collection('aiReadinessScans').add({
      businessName:   businessName,
      city:           city,
      state:          state,
      email:          email,
      placeId:        placeData.place_id,
      placeData: {
        name:        placeData.name || null,
        rating:      placeData.rating || null,
        reviewCount: placeData.user_ratings_total || null,
        address:     placeData.formatted_address || null,
        website:     placeData.website || null,
        types:       placeData.types || []
      },
      score:          score.totalScore,
      confidenceLevel: score.confidenceLevel,
      confidenceLabel: score.confidenceLabel,
      pillars:        score.pillars,
      actions:        score.actions,
      ip:             req.ip,
      turnstileVerified: true,
      userAgent:      req.headers['user-agent'] || null,
      source:         'pathsynch_website',
      createdAt:      admin.firestore.FieldValue.serverTimestamp()
    });

    // Step 5: Increment daily counter
    await incrementDailyScanCount();

    // Step 6: Create outbound lead if email provided
    if (email) {
      await createOutboundLead({
        email:           email,
        businessName:    businessName,
        city:            city,
        state:           state,
        placeId:         placeData.place_id,
        aiReadinessScore: score.totalScore,
        weakestPillar:   findWeakestPillar(score.pillars),
        source:          'ai_readiness_scan'
      });
    }

    return res.json({
      scanId:          scanRef.id,
      businessName:    placeData.name,
      address:         placeData.formatted_address,
      totalScore:      score.totalScore,
      confidenceLevel: score.confidenceLevel,
      confidenceLabel: score.confidenceLabel,
      pillars:         score.pillars,
      actions:         score.actions,
      placeId:         placeData.place_id
    });

  } catch (err) {
    console.error('[AIReadinessScan] Error:', err.message);
    return res.status(500).json({ error: 'Scan failed. Try again.' });
  }
}

// ── Cloud Function registration ────────────────────────────────────────────────

var aiReadinessScan = onRequest({
  cors: CORS_ORIGINS,
  maxInstances: 10,
  timeoutSeconds: 30,
  region: 'us-central1'
}, handler);

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  aiReadinessScan:        aiReadinessScan,
  handler:                handler,
  hashFingerprint:        hashFingerprint,
  checkRateLimit:         checkRateLimit,
  checkFingerprint:       checkFingerprint,
  getDailyScanCount:      getDailyScanCount,
  incrementDailyScanCount: incrementDailyScanCount,
  verifyTurnstile:        verifyTurnstile,
  findWeakestPillar:      findWeakestPillar
};
