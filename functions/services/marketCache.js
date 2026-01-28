/**
 * Market Cache Service
 *
 * Caching logic for market data to reduce API costs
 * Follows patterns from narrativeCache.js
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/**
 * Cache TTL settings in milliseconds
 */
const CACHE_TTL = {
    competitors: 24 * 60 * 60 * 1000,        // 24 hours - Google Places data
    demographics: 7 * 24 * 60 * 60 * 1000,   // 7 days - Census data (rarely changes)
    establishments: 7 * 24 * 60 * 60 * 1000, // 7 days - CBP data
    trends: 24 * 60 * 60 * 1000,             // 24 hours - Google Trends
    metrics: 24 * 60 * 60 * 1000             // 24 hours - Calculated metrics
};

/**
 * Generate a cache key from data type and parameters
 *
 * @param {string} dataType - Type of data (competitors, demographics, establishments, trends, metrics)
 * @param {Object} params - Parameters that uniquely identify the data
 * @returns {string} Cache key hash
 */
function generateCacheKey(dataType, params) {
    const keyData = {
        dataType,
        ...params
    };

    // Normalize and sort for consistent hashing
    const sortedData = JSON.stringify(keyData, Object.keys(keyData).sort());
    return crypto.createHash('sha256').update(sortedData).digest('hex').substring(0, 32);
}

/**
 * Get cached data if available and fresh
 *
 * @param {string} dataType - Type of data
 * @param {Object} params - Parameters that uniquely identify the data
 * @returns {Promise<Object|null>} Cached data or null
 */
async function getCached(dataType, params) {
    try {
        const cacheKey = generateCacheKey(dataType, params);
        const cacheDoc = await db.collection('marketCache').doc(cacheKey).get();

        if (!cacheDoc.exists) {
            return null;
        }

        const cached = cacheDoc.data();
        const cachedAt = cached.cachedAt?.toDate?.() || new Date(cached.cachedAt);
        const age = Date.now() - cachedAt.getTime();

        // Get TTL for this data type
        const maxAge = CACHE_TTL[dataType] || CACHE_TTL.metrics;

        // Check if cache is fresh
        if (age > maxAge) {
            return null;
        }

        // Increment hit count asynchronously
        incrementHitCount(cacheKey).catch(err =>
            console.warn('Failed to increment cache hit count:', err.message)
        );

        return {
            data: cached.data,
            cachedAt: cachedAt,
            hitCount: cached.hitCount || 1,
            fromCache: true
        };
    } catch (error) {
        console.error('Market cache read error:', error);
        return null;
    }
}

/**
 * Store data in cache
 *
 * @param {string} dataType - Type of data
 * @param {Object} params - Parameters that uniquely identify the data
 * @param {Object} data - Data to cache
 * @returns {Promise<void>}
 */
async function setCache(dataType, params, data) {
    try {
        const cacheKey = generateCacheKey(dataType, params);

        await db.collection('marketCache').doc(cacheKey).set({
            dataType,
            params: summarizeParams(params),
            data,
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
            hitCount: 0,
            ttlMs: CACHE_TTL[dataType] || CACHE_TTL.metrics
        });
    } catch (error) {
        console.error('Market cache write error:', error);
        // Don't throw - caching failure shouldn't break the flow
    }
}

/**
 * Increment cache hit count
 *
 * @param {string} cacheKey - Cache key
 * @returns {Promise<void>}
 */
async function incrementHitCount(cacheKey) {
    try {
        await db.collection('marketCache').doc(cacheKey).update({
            hitCount: admin.firestore.FieldValue.increment(1),
            lastHitAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        // Silently fail - hit counting is not critical
    }
}

/**
 * Invalidate cache for specific data type and location
 *
 * @param {string} dataType - Type of data to invalidate
 * @param {Object} params - Parameters to match for invalidation
 * @returns {Promise<void>}
 */
async function invalidateCache(dataType, params) {
    try {
        const cacheKey = generateCacheKey(dataType, params);
        await db.collection('marketCache').doc(cacheKey).delete();
    } catch (error) {
        console.error('Market cache invalidation error:', error);
    }
}

/**
 * Clean up old cache entries
 *
 * @returns {Promise<number>} Number of entries deleted
 */
async function cleanupOldCache() {
    try {
        const now = Date.now();
        const batch = db.batch();
        let deleteCount = 0;

        // Query each data type separately to check its TTL
        for (const [dataType, ttl] of Object.entries(CACHE_TTL)) {
            const cutoff = new Date(now - ttl);

            const oldEntries = await db.collection('marketCache')
                .where('dataType', '==', dataType)
                .where('cachedAt', '<', cutoff)
                .limit(50)
                .get();

            oldEntries.docs.forEach(doc => {
                batch.delete(doc.ref);
                deleteCount++;
            });
        }

        if (deleteCount > 0) {
            await batch.commit();
        }

        return deleteCount;
    } catch (error) {
        console.error('Market cache cleanup error:', error);
        return 0;
    }
}

/**
 * Get cache statistics
 *
 * @returns {Promise<Object>} Cache statistics
 */
async function getCacheStats() {
    try {
        const snapshot = await db.collection('marketCache')
            .orderBy('cachedAt', 'desc')
            .limit(1000)
            .get();

        if (snapshot.empty) {
            return {
                totalEntries: 0,
                byType: {},
                totalHits: 0,
                avgHitsPerEntry: 0,
                oldestEntry: null,
                newestEntry: null
            };
        }

        const byType = {};
        let totalHits = 0;
        let oldestDate = null;
        let newestDate = null;

        snapshot.docs.forEach(doc => {
            const data = doc.data();

            // Count by type
            const type = data.dataType || 'unknown';
            byType[type] = (byType[type] || 0) + 1;

            // Sum hits
            totalHits += data.hitCount || 0;

            // Track dates
            const cachedAt = data.cachedAt?.toDate?.();
            if (cachedAt) {
                if (!oldestDate || cachedAt < oldestDate) oldestDate = cachedAt;
                if (!newestDate || cachedAt > newestDate) newestDate = cachedAt;
            }
        });

        return {
            totalEntries: snapshot.size,
            byType,
            totalHits,
            avgHitsPerEntry: Math.round((totalHits / snapshot.size) * 10) / 10,
            oldestEntry: oldestDate?.toISOString(),
            newestEntry: newestDate?.toISOString()
        };
    } catch (error) {
        console.error('Market cache stats error:', error);
        return null;
    }
}

/**
 * Summarize params for storage (avoid storing full data)
 */
function summarizeParams(params) {
    const summary = {};

    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value.length > 100) {
            summary[key] = value.substring(0, 100) + '...';
        } else if (Array.isArray(value)) {
            summary[key] = `[${value.length} items]`;
        } else {
            summary[key] = value;
        }
    }

    return summary;
}

/**
 * Wrapper to get cached data or fetch from source
 *
 * @param {string} dataType - Type of data
 * @param {Object} params - Parameters for cache key
 * @param {Function} fetchFn - Async function to fetch data if not cached
 * @returns {Promise<Object>} Data (from cache or freshly fetched)
 */
async function getOrFetch(dataType, params, fetchFn) {
    // Try cache first
    const cached = await getCached(dataType, params);
    if (cached) {
        return cached;
    }

    // Fetch fresh data
    const freshData = await fetchFn();

    // Store in cache
    if (freshData) {
        await setCache(dataType, params, freshData);
    }

    return { data: freshData, fromCache: false };
}

module.exports = {
    CACHE_TTL,
    generateCacheKey,
    getCached,
    setCache,
    invalidateCache,
    cleanupOldCache,
    getCacheStats,
    getOrFetch
};
