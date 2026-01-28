/**
 * Narrative Cache Service
 *
 * Caching logic for narratives to reduce API costs
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/**
 * Generate a cache key from business data
 * @param {Object} inputs - Business inputs
 * @returns {string} Cache key hash
 */
function generateCacheKey(inputs) {
    // Create a deterministic string from relevant inputs
    const keyData = {
        businessName: inputs.businessName?.toLowerCase().trim(),
        industry: inputs.industry?.toLowerCase().trim(),
        googleRating: inputs.googleRating,
        numReviews: inputs.numReviews,
        monthlyVisits: inputs.monthlyVisits,
        avgTransaction: inputs.avgTransaction,
        repeatRate: inputs.repeatRate
    };

    const keyString = JSON.stringify(keyData);
    return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 32);
}

/**
 * Get a cached narrative if available and fresh
 * @param {string} cacheKey - Cache key
 * @param {number} maxAgeMs - Maximum age in milliseconds (default 24 hours)
 * @returns {Promise<Object|null>} Cached narrative or null
 */
async function getCached(cacheKey, maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
        const cacheDoc = await db.collection('narrativeCache').doc(cacheKey).get();

        if (!cacheDoc.exists) {
            return null;
        }

        const cached = cacheDoc.data();
        const cachedAt = cached.cachedAt?.toDate?.() || new Date(cached.cachedAt);
        const age = Date.now() - cachedAt.getTime();

        // Check if cache is fresh
        if (age > maxAgeMs) {
            return null;
        }

        return {
            narrative: cached.narrative,
            validation: cached.validation,
            cachedAt: cachedAt,
            hitCount: cached.hitCount || 1
        };
    } catch (error) {
        console.error('Cache read error:', error);
        return null;
    }
}

/**
 * Store a narrative in cache
 * @param {string} cacheKey - Cache key
 * @param {Object} narrative - Narrative to cache
 * @param {Object} validation - Validation result
 * @param {Object} inputs - Original inputs (for debugging)
 * @returns {Promise<void>}
 */
async function setCache(cacheKey, narrative, validation, inputs) {
    try {
        await db.collection('narrativeCache').doc(cacheKey).set({
            narrative,
            validation,
            inputsSummary: {
                businessName: inputs.businessName,
                industry: inputs.industry
            },
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
            hitCount: 0
        });
    } catch (error) {
        console.error('Cache write error:', error);
        // Don't throw - caching failure shouldn't break the flow
    }
}

/**
 * Increment cache hit count
 * @param {string} cacheKey - Cache key
 * @returns {Promise<void>}
 */
async function incrementHitCount(cacheKey) {
    try {
        await db.collection('narrativeCache').doc(cacheKey).update({
            hitCount: admin.firestore.FieldValue.increment(1),
            lastHitAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Cache hit count update error:', error);
    }
}

/**
 * Invalidate a specific cache entry
 * @param {string} cacheKey - Cache key
 * @returns {Promise<void>}
 */
async function invalidateCache(cacheKey) {
    try {
        await db.collection('narrativeCache').doc(cacheKey).delete();
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
}

/**
 * Clean up old cache entries
 * @param {number} maxAgeMs - Maximum age to keep (default 7 days)
 * @returns {Promise<number>} Number of entries deleted
 */
async function cleanupOldCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    try {
        const cutoff = new Date(Date.now() - maxAgeMs);
        const oldEntries = await db.collection('narrativeCache')
            .where('cachedAt', '<', cutoff)
            .limit(100) // Process in batches
            .get();

        if (oldEntries.empty) {
            return 0;
        }

        const batch = db.batch();
        oldEntries.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        return oldEntries.size;
    } catch (error) {
        console.error('Cache cleanup error:', error);
        return 0;
    }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache statistics
 */
async function getCacheStats() {
    try {
        const snapshot = await db.collection('narrativeCache')
            .orderBy('cachedAt', 'desc')
            .limit(1000)
            .get();

        if (snapshot.empty) {
            return {
                totalEntries: 0,
                totalHits: 0,
                avgHitsPerEntry: 0,
                oldestEntry: null,
                newestEntry: null
            };
        }

        let totalHits = 0;
        let oldestDate = null;
        let newestDate = null;

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            totalHits += data.hitCount || 0;

            const cachedAt = data.cachedAt?.toDate?.();
            if (cachedAt) {
                if (!oldestDate || cachedAt < oldestDate) oldestDate = cachedAt;
                if (!newestDate || cachedAt > newestDate) newestDate = cachedAt;
            }
        });

        return {
            totalEntries: snapshot.size,
            totalHits,
            avgHitsPerEntry: totalHits / snapshot.size,
            oldestEntry: oldestDate?.toISOString(),
            newestEntry: newestDate?.toISOString()
        };
    } catch (error) {
        console.error('Cache stats error:', error);
        return null;
    }
}

module.exports = {
    generateCacheKey,
    getCached,
    setCache,
    incrementHitCount,
    invalidateCache,
    cleanupOldCache,
    getCacheStats
};
