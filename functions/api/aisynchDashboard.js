'use strict';

/**
 * aisynchDashboard.js
 * AIsynch Dashboard API Bridge — Cloud Function (onRequest)
 * Phase 1A-4
 *
 * Provides 8 authenticated endpoints for the PathManager dashboard.
 * PathManager EC2 backend proxies requests here; this function reads
 * Firestore and returns tier-gated AIsynch data.
 *
 * Auth: PathManager JWT validated via PATHMANAGER_JWT_SECRET env var.
 * Merchant ID extracted from the JWT `sub` claim.
 *
 * Endpoints (routed by path after the function base):
 *   GET  /score        — AI Readiness score + pillars + actions
 *   GET  /trend        — Time-series mention rate (Starter+)
 *   GET  /heatmap      — Multi-model mention rates (Growth+)
 *   GET  /citations    — Citation sources + gap analysis (Growth+)
 *   GET  /actions      — Prioritized action items
 *   GET  /competitors  — Competitor AI Readiness scores (Starter+)
 *   GET  /subscription — AIsynch tier + status + entitlements
 *   POST /report       — Trigger report generation (Growth+)
 *
 * CORS: app.pathmanager.com, pathmanager.com, localhost:3000
 */

var onRequest = require('firebase-functions/v2/https').onRequest;
var admin = require('firebase-admin');
var crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────────────

var CORS_ORIGINS = [
  'https://app.pathmanager.com',
  'https://pathmanager.com',
  'https://pathmanager.pathsynch.com',
  'http://localhost:3000'
];

var TIER_RANK = { lite: 0, starter: 1, growth: 2, scale: 3 };

// ── Auth helper ────────────────────────────────────────────────────────────────

/**
 * Validate a PathManager JWT and return the merchant ID (sub claim).
 * Uses HMAC-SHA256 signature verification with PATHMANAGER_JWT_SECRET.
 * Returns null if invalid or missing.
 *
 * @param {import('express').Request} req
 * @returns {string|null}  merchantId or null
 */
function validatePathManagerToken(req) {
  var authHeader = req.headers && req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  var token = authHeader.slice(7);
  var secret = process.env.PATHMANAGER_JWT_SECRET;
  if (!secret) {
    console.error('[AIsynchDashboard] PATHMANAGER_JWT_SECRET not configured');
    return null;
  }

  try {
    var parts = token.split('.');
    if (parts.length !== 3) return null;

    var header  = parts[0];
    var payload = parts[1];
    var sig     = parts[2];

    // Verify HMAC-SHA256 signature
    var expected = crypto
      .createHmac('sha256', secret)
      .update(header + '.' + payload)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }

    var decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return decoded.sub || null;
  } catch (e) {
    return null;
  }
}

// ── Subscription helper ────────────────────────────────────────────────────────

/**
 * Read subscription tier and entitlements from Firestore.
 * Returns { tier: 'lite', status: 'inactive', entitlements: {} } as default.
 */
async function getSubscriptionTier(merchantId) {
  var db = admin.firestore();
  var doc = await db.collection('aisynchSubscriptions').doc(merchantId).get();
  if (!doc.exists) {
    return { tier: 'lite', status: 'inactive', entitlements: {} };
  }
  var data = doc.data();
  return {
    tier:         data.tier || 'lite',
    status:       data.status || 'inactive',
    entitlements: data.entitlements || {}
  };
}

function hasAccess(subTier, requiredTier) {
  return (TIER_RANK[subTier] || 0) >= (TIER_RANK[requiredTier] || 0);
}

function extractModelRates(models) {
  if (!models) return {};
  var result = {};
  Object.keys(models).forEach(function(model) {
    result[model] = models[model].mentionRate || 0;
  });
  return result;
}

// ── Endpoint handlers ──────────────────────────────────────────────────────────

/**
 * GET /score
 * Returns AI Readiness score, pillar breakdown, confidence, and delta.
 */
async function handleGetScore(merchantId, req, res) {
  var db = admin.firestore();
  var doc = await db.collection('aiReadinessScores').doc(merchantId).get();
  if (!doc.exists) {
    return res.json({ status: 'no_score', merchantId: merchantId });
  }

  var data = doc.data();
  var sub = await getSubscriptionTier(merchantId);

  return res.json({
    totalScore:       data.totalScore,
    previousScore:    data.previousScore || null,
    scoreChange:      data.scoreChange || 0,
    confidenceLevel:  data.confidenceLevel,
    confidenceLabel:  data.confidenceLabel,
    dataCompleteness: data.dataCompleteness,
    pillars:          data.pillars,
    actions:          sub.tier === 'lite'
                        ? (data.actions || []).slice(0, 3)
                        : (data.actions || []),
    scoredAt:         data.scoredAt,
    aisynchTier:      sub.tier,
    aisynchStatus:    sub.status
  });
}

/**
 * GET /trend?days=30
 * Returns time-series visibility data. Tier-gated: Starter+ only.
 */
async function handleGetTrend(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  if (!hasAccess(sub.tier, 'starter')) {
    return res.json({ gated: true, requiredTier: 'starter' });
  }

  var db = admin.firestore();
  var days = Math.min(parseInt(req.query && req.query.days) || 30, 90);
  var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  var snapshots = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .where('snapshotDate', '>=', since)
    .orderBy('snapshotDate', 'asc')
    .get();

  var trendData = [];
  snapshots.forEach(function(doc) {
    var d = doc.data();
    trendData.push({
      date:         d.snapshotDate,
      mentionRate:  d.aggregated && d.aggregated.overallMentionRate || 0,
      modelsChecked: d.aggregated && d.aggregated.modelsChecked || 0,
      modelBreakdown: hasAccess(sub.tier, 'growth')
                        ? extractModelRates(d.models) : null
    });
  });

  return res.json({ trendData: trendData, days: days, tier: sub.tier });
}

/**
 * GET /heatmap
 * Returns multi-model mention rates per business. Tier-gated: Growth+ only.
 */
async function handleGetHeatmap(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  if (!hasAccess(sub.tier, 'growth')) {
    return res.json({ gated: true, requiredTier: 'growth' });
  }

  var db = admin.firestore();
  var latest = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  if (latest.empty) return res.json({ status: 'no_data' });

  var data = latest.docs[0].data();
  return res.json({
    models:       data.models,
    competitors:  data.competitors,
    snapshotDate: data.snapshotDate
  });
}

/**
 * GET /citations
 * Returns citation sources + gap analysis. Tier-gated: Growth+ only.
 */
async function handleGetCitations(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  if (!hasAccess(sub.tier, 'growth')) {
    return res.json({ gated: true, requiredTier: 'growth' });
  }

  var db = admin.firestore();
  var latest = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  if (latest.empty) return res.json({ status: 'no_data' });

  var data = latest.docs[0].data();
  return res.json({
    citations:    data.citations,
    snapshotDate: data.snapshotDate
  });
}

/**
 * GET /actions
 * Returns all prioritized action items. Available to all tiers.
 */
async function handleGetActions(merchantId, req, res) {
  var db = admin.firestore();
  var doc = await db.collection('aiReadinessScores').doc(merchantId).get();
  if (!doc.exists) return res.json({ actions: [], status: 'no_score' });

  var sub = await getSubscriptionTier(merchantId);
  var actions = doc.data().actions || [];

  return res.json({
    actions: sub.tier === 'lite' ? actions.slice(0, 3) : actions,
    tier: sub.tier
  });
}

/**
 * GET /competitors
 * Returns competitor AI Readiness scores. Tier-gated: Starter+ only.
 */
async function handleGetCompetitors(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  if (!hasAccess(sub.tier, 'starter')) {
    return res.json({ gated: true, requiredTier: 'starter' });
  }

  var db = admin.firestore();
  var latest = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  var competitors = [];
  if (!latest.empty) {
    competitors = latest.docs[0].data().competitors || [];
  }

  // Apply tier-based competitor count limit
  var maxCompetitors = sub.entitlements && sub.entitlements.maxCompetitors || 3;
  return res.json({
    competitors: competitors.slice(0, maxCompetitors),
    tier: sub.tier
  });
}

/**
 * GET /subscription
 * Returns AIsynch tier, status, and entitlements. Available to all tiers.
 */
async function handleGetSubscription(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  return res.json({
    merchantId:   merchantId,
    tier:         sub.tier,
    status:       sub.status,
    entitlements: sub.entitlements
  });
}

/**
 * POST /report
 * Triggers report generation. Tier-gated: Growth+ for on-demand.
 * Note: Full report generation (PDF/hosted) deferred to Phase 3.
 * This endpoint returns a job ID for async polling.
 */
async function handleGenerateReport(merchantId, req, res) {
  var sub = await getSubscriptionTier(merchantId);
  if (!hasAccess(sub.tier, 'growth')) {
    return res.status(403).json({ gated: true, requiredTier: 'growth' });
  }

  var body = req.body || {};
  var reportType = body.reportType || 'ai_visibility';
  var dateRangeType = body.dateRangeType || 'last_30_days';
  var outputFormat = body.outputFormat || 'pdf';

  // Phase 3 will implement full PDF/hosted generation.
  // Phase 1A returns a stub response indicating the request was accepted.
  var db = admin.firestore();
  var jobRef = await db.collection('generatedReports').add({
    agencyMerchantId: merchantId,
    clientMerchantId: merchantId,
    reportType: reportType,
    dateRangeType: dateRangeType,
    outputFormat: outputFormat,
    deliveryStatus: 'queued',
    generatedBy: 'manual',
    aisynchTier: sub.tier,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.json({
    reportId: jobRef.id,
    status: 'queued',
    message: 'Report generation queued. Full PDF export ships in Phase 3.'
  });
}

// ── Main request handler ───────────────────────────────────────────────────────

async function handler(req, res) {
  var merchantId = validatePathManagerToken(req);
  if (!merchantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Route by path — strip leading slashes
  var path = (req.path || '').replace(/^\/+/, '');

  try {
    switch (path) {
      case 'score':        return await handleGetScore(merchantId, req, res);
      case 'trend':        return await handleGetTrend(merchantId, req, res);
      case 'heatmap':      return await handleGetHeatmap(merchantId, req, res);
      case 'citations':    return await handleGetCitations(merchantId, req, res);
      case 'actions':      return await handleGetActions(merchantId, req, res);
      case 'competitors':  return await handleGetCompetitors(merchantId, req, res);
      case 'subscription': return await handleGetSubscription(merchantId, req, res);
      case 'report':       return await handleGenerateReport(merchantId, req, res);
      default:             return res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    console.error('[AIsynchDashboard] Error on /' + path + ':', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// ── Cloud Function registration ────────────────────────────────────────────────

var aisynchDashboard = onRequest({
  cors: CORS_ORIGINS,
  maxInstances: 20,
  timeoutSeconds: 15,
  region: 'us-central1'
}, handler);

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  aisynchDashboard:      aisynchDashboard,
  handler:               handler,
  validatePathManagerToken: validatePathManagerToken,
  getSubscriptionTier:   getSubscriptionTier,
  handleGetScore:        handleGetScore,
  handleGetTrend:        handleGetTrend,
  handleGetHeatmap:      handleGetHeatmap,
  handleGetCitations:    handleGetCitations,
  handleGetActions:      handleGetActions,
  handleGetCompetitors:  handleGetCompetitors,
  handleGetSubscription: handleGetSubscription,
  handleGenerateReport:  handleGenerateReport
};
