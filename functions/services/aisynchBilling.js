'use strict';

/**
 * aisynchBilling.js
 * AIsynch Add-On Subscription Logic + Entitlements
 *
 * AIsynch is a line item on the merchant's existing Stripe subscription —
 * one invoice, one charge. This module handles:
 *   - Adding AIsynch to an existing subscription (subscriptionItems.create)
 *   - Creating a new checkout session if no subscription exists
 *   - Activating bundled free tiers (LocalSynch Local Growth+ bundles)
 *   - Firestore entitlement record management
 *   - Webhook status sync when Stripe events arrive
 *   - Tier/entitlement lookup for API gating
 */

var admin = require('firebase-admin');
var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── Constants ──────────────────────────────────────────────────────────────────

var AISYNCH_PRICE_IDS = {
  starter: process.env.AISYNCH_STARTER_PRICE_ID || '',
  growth:  process.env.AISYNCH_GROWTH_PRICE_ID  || '',
  scale:   process.env.AISYNCH_SCALE_PRICE_ID   || ''
};

var AISYNCH_AMOUNTS = {
  lite:    0,
  starter: 4900,
  growth:  9900,
  scale:   19900
};

var AISYNCH_ENTITLEMENTS = {
  lite: {
    monitoringFrequency: 'monthly',
    aiModels: ['gemini', 'perplexity'],
    maxCompetitors: 0,
    citationDepth: false,
    gapAnalysis: false,
    multiModelSplit: false,
    heatmapReports: false,
    ga4Integration: false,
    apiAccess: false,
    whiteLabel: false,
    lookerConnector: false,
    customPrompts: false,
    maxCustomPrompts: 0,
    llmsTxtGeneration: false,
    reviewRequestTrigger: false
  },
  starter: {
    monitoringFrequency: 'weekly',
    aiModels: ['gemini', 'perplexity'],
    maxCompetitors: 3,
    citationDepth: false,
    gapAnalysis: false,
    multiModelSplit: false,
    heatmapReports: false,
    ga4Integration: false,
    apiAccess: false,
    whiteLabel: false,
    lookerConnector: false,
    customPrompts: false,
    maxCustomPrompts: 0,
    llmsTxtGeneration: true,
    reviewRequestTrigger: false
  },
  growth: {
    monitoringFrequency: 'daily',
    aiModels: ['gemini', 'perplexity', 'claude'],
    maxCompetitors: 5,
    citationDepth: true,
    gapAnalysis: true,
    multiModelSplit: true,
    heatmapReports: true,
    ga4Integration: true,
    apiAccess: true,
    whiteLabel: false,
    lookerConnector: false,
    customPrompts: true,
    maxCustomPrompts: 10,
    llmsTxtGeneration: true,
    reviewRequestTrigger: true
  },
  scale: {
    monitoringFrequency: 'daily',
    aiModels: ['gemini', 'perplexity', 'claude'],
    maxCompetitors: 10,
    citationDepth: true,
    gapAnalysis: true,
    multiModelSplit: true,
    heatmapReports: true,
    ga4Integration: true,
    apiAccess: true,
    whiteLabel: true,
    lookerConnector: true,
    customPrompts: true,
    maxCustomPrompts: 25,
    llmsTxtGeneration: true,
    reviewRequestTrigger: true
  }
};

// LocalSynch tier → bundled AIsynch tier
var LOCALSYNCH_BUNDLE_MAP = {
  'local_growth':    'lite',
  'local_authority': 'starter'
};

var PATHMANAGER_URL = process.env.FRONTEND_URL || 'https://pathmanager.pathsynch.com';

// ── Helpers ────────────────────────────────────────────────────────────────────

function db() {
  return admin.firestore();
}

function mapStripeStatus(stripeStatus) {
  var map = {
    'active':            'active',
    'trialing':          'trialing',
    'past_due':          'past_due',
    'canceled':          'cancelled',
    'cancelled':         'cancelled',
    'incomplete':        'past_due',
    'incomplete_expired':'cancelled',
    'unpaid':            'past_due',
    'paused':            'cancelled'
  };
  return map[stripeStatus] || 'cancelled';
}

// ── Exported functions ─────────────────────────────────────────────────────────

/**
 * Read the AIsynch subscription tier and entitlements for a merchant.
 * Returns { tier, status, entitlements } — defaults to lite/inactive if no record.
 *
 * @param {string} merchantId
 * @returns {Promise<{ tier: string, status: string, entitlements: object }>}
 */
async function getSubscriptionTier(merchantId) {
  var doc = await db().collection('aisynchSubscriptions').doc(merchantId).get();
  if (!doc.exists) {
    return { tier: 'lite', status: 'inactive', entitlements: AISYNCH_ENTITLEMENTS.lite };
  }
  var data = doc.data();
  var tier = data.tier || 'lite';
  var entitlements = data.entitlements || AISYNCH_ENTITLEMENTS[tier] || AISYNCH_ENTITLEMENTS.lite;
  return { tier: tier, status: data.status || 'inactive', entitlements: entitlements };
}

/**
 * Add AIsynch as a line item to an existing Stripe subscription,
 * or create a checkout session if the merchant has no active subscription.
 *
 * @param {string} merchantId
 * @param {'starter'|'growth'|'scale'} aisynchTier
 * @param {{ stripeCustomerId?: string, stripeSubscriptionId?: string, subscribedProducts?: string[] }} merchantInfo
 * @returns {Promise<{ success?: boolean, tier?: string, checkoutUrl?: string }>}
 */
async function addAisynchToSubscription(merchantId, aisynchTier, merchantInfo) {
  // Read price IDs at call time so test env vars set in beforeEach are visible
  var runtimePriceIds = {
    starter: process.env.AISYNCH_STARTER_PRICE_ID || AISYNCH_PRICE_IDS.starter,
    growth:  process.env.AISYNCH_GROWTH_PRICE_ID  || AISYNCH_PRICE_IDS.growth,
    scale:   process.env.AISYNCH_SCALE_PRICE_ID   || AISYNCH_PRICE_IDS.scale
  };
  var priceId = runtimePriceIds[aisynchTier];
  if (!priceId) {
    throw new Error('Unknown AIsynch tier or price ID not configured: ' + aisynchTier);
  }

  var subscriptionId = merchantInfo && merchantInfo.stripeSubscriptionId;
  var customerId = merchantInfo && merchantInfo.stripeCustomerId;

  if (!subscriptionId) {
    // No existing subscription — create checkout session
    var session = await stripe.checkout.sessions.create({
      customer: customerId || undefined,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        merchantId: merchantId,
        product: 'aisynch',
        tier: aisynchTier
      },
      success_url: PATHMANAGER_URL + '/settings?aisynch=activated',
      cancel_url:  PATHMANAGER_URL + '/settings?aisynch=cancelled'
    });
    return { checkoutUrl: session.url };
  }

  // Existing subscription — add AIsynch as a line item (prorated)
  var subscriptionItem = await stripe.subscriptionItems.create({
    subscription: subscriptionId,
    price: priceId,
    quantity: 1,
    proration_behavior: 'create_prorations',
    metadata: { product: 'aisynch', tier: aisynchTier }
  });

  // Write Firestore entitlement record
  await db().collection('aisynchSubscriptions').doc(merchantId).set({
    merchantId: merchantId,
    tier: aisynchTier,
    status: 'active',
    stripeSubscriptionItemId: subscriptionItem.id,
    stripePriceId: priceId,
    monthlyAmount: AISYNCH_AMOUNTS[aisynchTier],
    entitlements: AISYNCH_ENTITLEMENTS[aisynchTier],
    parentProduct: (merchantInfo && merchantInfo.subscribedProducts && merchantInfo.subscribedProducts[0]) || 'standalone',
    parentSubscriptionId: subscriptionId,
    bundledFree: false,
    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, tier: aisynchTier };
}

/**
 * Activate a bundled free AIsynch tier for a LocalSynch subscriber.
 * LocalSynch Local Growth+ → AIsynch Lite (free)
 * LocalSynch Local Authority → AIsynch Starter (free)
 *
 * @param {string} merchantId
 * @param {'local_growth'|'local_authority'} localSynchTier
 * @returns {Promise<void>}
 */
async function activateBundledAisynch(merchantId, localSynchTier) {
  var bundledTier = LOCALSYNCH_BUNDLE_MAP[localSynchTier];
  if (!bundledTier) {
    // Local Launch and other tiers get a one-time score only — no persistent subscription
    return;
  }

  await db().collection('aisynchSubscriptions').doc(merchantId).set({
    merchantId: merchantId,
    tier: bundledTier,
    status: 'active',
    stripeSubscriptionItemId: null,
    stripePriceId: null,
    monthlyAmount: 0,
    entitlements: AISYNCH_ENTITLEMENTS[bundledTier],
    parentProduct: 'localsynch',
    parentSubscriptionId: null,
    bundledFree: true,
    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle a Stripe subscription change event.
 * Called from the PathManager Stripe webhook handler when items include
 * an AIsynch price (metadata.product === 'aisynch').
 *
 * @param {object} subscription  Stripe subscription object
 * @returns {Promise<void>}
 */
async function handleSubscriptionChange(subscription) {
  var merchantId = subscription.metadata && subscription.metadata.merchantId;
  if (!merchantId) return;

  for (var i = 0; i < subscription.items.data.length; i++) {
    var item = subscription.items.data[i];
    var product = item.price && item.price.metadata && item.price.metadata.product;
    var tier = item.price && item.price.metadata && item.price.metadata.tier;

    if (product === 'aisynch' && tier) {
      await db().collection('aisynchSubscriptions').doc(merchantId).set({
        status: mapStripeStatus(subscription.status),
        tier: tier,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }
}

/**
 * Cancel an AIsynch subscription add-on, removing the line item from Stripe
 * and marking the Firestore record as cancelled.
 *
 * @param {string} merchantId
 * @returns {Promise<void>}
 */
async function cancelAisynchSubscription(merchantId) {
  var doc = await db().collection('aisynchSubscriptions').doc(merchantId).get();
  if (!doc.exists) return;

  var data = doc.data();

  // Remove from Stripe if it was a paid subscription (not bundled)
  if (data.stripeSubscriptionItemId && !data.bundledFree) {
    await stripe.subscriptionItems.del(data.stripeSubscriptionItemId, {
      proration_behavior: 'create_prorations'
    });
  }

  await doc.ref.set({
    status: 'cancelled',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/**
 * Return the entitlements object for a given tier (for validation / gating).
 *
 * @param {'lite'|'starter'|'growth'|'scale'} tier
 * @returns {object}
 */
function getEntitlements(tier) {
  return AISYNCH_ENTITLEMENTS[tier] || AISYNCH_ENTITLEMENTS.lite;
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  getSubscriptionTier:       getSubscriptionTier,
  addAisynchToSubscription:  addAisynchToSubscription,
  activateBundledAisynch:    activateBundledAisynch,
  handleSubscriptionChange:  handleSubscriptionChange,
  cancelAisynchSubscription: cancelAisynchSubscription,
  getEntitlements:           getEntitlements,
  AISYNCH_ENTITLEMENTS:      AISYNCH_ENTITLEMENTS,
  AISYNCH_AMOUNTS:           AISYNCH_AMOUNTS,
  AISYNCH_PRICE_IDS:         AISYNCH_PRICE_IDS
};
