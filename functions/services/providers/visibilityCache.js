'use strict';

/**
 * visibilityCache.js
 * Shared Firestore cache utility for all four visibility enrichment providers.
 * Do NOT duplicate cache logic in individual provider files.
 */

const admin = require('firebase-admin');
const db = admin.firestore();

const COLLECTION = 'visibilityEnrichmentCache';

/**
 * Read from visibility enrichment cache.
 * @param {string} cacheKey
 * @returns {Object|null} cached data, or null if expired/missing
 */
async function readVisibilityCache(cacheKey) {
  try {
    const doc = await db.collection(COLLECTION).doc(cacheKey).get();
    if (!doc.exists) return null;

    const data = doc.data();
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      db.collection(COLLECTION).doc(cacheKey).delete().catch(() => {});
      return null;
    }

    return data.data || null;
  } catch (err) {
    console.error('[VisibilityCache] Read error:', err.message);
    return null;
  }
}

/**
 * Write to visibility enrichment cache.
 * @param {string} cacheKey
 * @param {Object} data - the data to cache
 * @param {number} ttlHours - time-to-live in hours
 * @param {string} dataType - "map_pack" | "ad_spend" | "website_signals" | "ai_visibility"
 */
async function writeVisibilityCache(cacheKey, data, ttlHours, dataType) {
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await db.collection(COLLECTION).doc(cacheKey).set({
      dataType,
      data,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
    });
  } catch (err) {
    console.error('[VisibilityCache] Write error:', err.message);
  }
}

/**
 * Normalize a string into a safe Firestore document key.
 */
function normalizeCacheKey(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 100);
}

module.exports = { readVisibilityCache, writeVisibilityCache, normalizeCacheKey };
