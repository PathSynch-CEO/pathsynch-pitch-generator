/**
 * generateMerchantConfig.js
 *
 * Reads merchantConfig/{merchantId} from Firestore and writes a config JSON
 * file to Firebase Hosting at /config/{merchantId}.json via the Admin SDK.
 *
 * Schema version: 1.1
 *
 * Called when:
 *  - Merchant plan changes
 *  - Snippet is regenerated
 *  - urlMappings are updated in merchantConfig
 *  - POST /merchant-config/regenerate-snippet endpoint is called
 */

const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');

const SCHEMA_VERSION = '1.1';
const INGEST_ENDPOINT =
  'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/api/v1/visitor-signal/ingest';

// Plan tiers that qualify as Growth+
const GROWTH_PLUS = ['growth', 'scale', 'enterprise'];

/**
 * Determine if a plan tier is Growth+.
 * @param {string} tier
 * @returns {boolean}
 */
function isGrowthPlus(tier) {
  return GROWTH_PLUS.includes((tier || '').toLowerCase());
}

/**
 * Write the merchant config JSON to Firebase Hosting storage bucket.
 * Path in bucket: public/config/{merchantId}.json
 * (Firebase Hosting serves files from the bucket's public root)
 *
 * @param {string} merchantId
 * @returns {Promise<Object>} The config object that was written
 */
async function writeMerchantConfig(merchantId) {
  if (!merchantId) throw new Error('merchantId is required');

  const db = admin.firestore();

  // Read merchantConfig document
  const configDoc = await db.collection('merchantConfig').doc(merchantId).get();
  const config = configDoc.exists ? configDoc.data() : {};

  // Read user/merchant document for plan + feature flags
  const userDoc = await db.collection('users').doc(merchantId).get();
  const user = userDoc.exists ? userDoc.data() : {};

  const planTier = (
    user?.subscription?.plan ||
    user?.subscription?.tier ||
    user?.plan ||
    user?.tier ||
    config?.planTier ||
    'free'
  ).toLowerCase();

  const hasPathmanagerFeature = !!(user?.features?.pathmanager || config?.modules?.reviewWidget);
  const hasSnippetKey = !!(config?.snippetKey || user?.snippetKey);
  // Humblytics: enabled only for synchintro.ai test merchant (features.humblytics flag).
  // TODO — replace with Humblytics Agent API provisioning when Business plan active
  const humblyticsEnabled = !!(user?.features?.humblytics);
  const hasQrReferral = !!(user?.features?.qrsynch || user?.features?.referralsynch ||
                           config?.modules?.qrReferral);

  const postHogOptIn = !!(user?.integrations?.postHog?.optIn ||
                          config?.postHogOptIn);

  // Build modules flags
  const modules = {
    reviewWidget:    hasPathmanagerFeature,
    visitorTracking: hasSnippetKey,
    humblytics:      humblyticsEnabled,
    postHog:         isGrowthPlus(planTier) && postHogOptIn,
    qrReferral:      hasQrReferral
  };

  const configJson = {
    merchantId,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    modules,
    // Humblytics token from env — only populated for merchants with features.humblytics enabled.
    // TODO — replace with Humblytics Agent API provisioning when Business plan active
    humblyticsSiteToken:   humblyticsEnabled ? (process.env.HUMBLYTICS_SITE_TOKEN || null) : null,
    // PostHog project key from env — only populated for Growth+ merchants with postHogOptIn.
    postHogProjectKey:     modules.postHog ? (process.env.POSTHOG_API_KEY || null) : null,
    synchIntroSnippetKey:  config?.snippetKey || user?.snippetKey || null,
    visitorIntel: {
      learningMode:                config?.learningModeActive ?? true,
      trafficProfile:              config?.trafficProfile || 'mixed',
      companyIdEnabled:            isGrowthPlus(planTier) ? (config?.companyIdEnabled ?? true) : false,
      urlMappings:                 config?.urlMappings || [],
      thresholds:                  config?.thresholds || { warming: 75, hot: 150, outreachNow: 200 },
      duplicateSuppressionHours:   config?.duplicateSuppressionHours || 4
    },
    session: {
      cookieName:       '_ps_sid',
      cookieExpiryDays: 30,
      fingerprintField: '_ps_vid'
    },
    ingestEndpoint: INGEST_ENDPOINT
  };

  // Write to Firebase Hosting bucket
  // Firebase Hosting serves from the default bucket under the project
  const bucket = getStorage().bucket();
  const filePath = `config/${merchantId}.json`;
  const file = bucket.file(filePath);

  await file.save(JSON.stringify(configJson, null, 2), {
    metadata: {
      contentType: 'application/json',
      cacheControl: 'public, max-age=60'
    }
  });

  // Make publicly readable
  await file.makePublic();

  return configJson;
}

module.exports = { writeMerchantConfig };
