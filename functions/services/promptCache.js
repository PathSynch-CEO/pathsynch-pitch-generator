/**
 * Prompt Cache Service
 *
 * In-memory caching for Gemini context and system prompts
 * with TTL management and memory limits.
 */

const { GEMINI_CONFIG } = require('../config/gemini');

// In-memory cache storage
const cache = new Map();

// Cache statistics
const stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalTokensCached: 0
};

/**
 * Cache entry structure
 */
class CacheEntry {
    constructor(key, value, ttl, estimatedTokens = 0) {
        this.key = key;
        this.value = value;
        this.createdAt = Date.now();
        this.expiresAt = Date.now() + ttl;
        this.estimatedTokens = estimatedTokens;
        this.hits = 0;
    }

    isExpired() {
        return Date.now() > this.expiresAt;
    }

    touch() {
        this.hits++;
    }
}

/**
 * Estimate tokens in a value
 */
function estimateTokens(value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return Math.ceil(str.length / 4);
}

/**
 * Clean up expired entries
 */
function cleanup() {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of cache.entries()) {
        if (entry.isExpired()) {
            stats.totalTokensCached -= entry.estimatedTokens;
            cache.delete(key);
            evicted++;
        }
    }

    if (evicted > 0) {
        stats.evictions += evicted;
        console.log(`Prompt cache: Evicted ${evicted} expired entries`);
    }
}

/**
 * Evict entries if over token limit
 */
function enforceTokenLimit() {
    const maxTokens = GEMINI_CONFIG.caching.maxCachedTokens;

    if (stats.totalTokensCached <= maxTokens) {
        return;
    }

    // Sort entries by least recently created (oldest first)
    const entries = Array.from(cache.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);

    for (const [key, entry] of entries) {
        if (stats.totalTokensCached <= maxTokens) {
            break;
        }

        stats.totalTokensCached -= entry.estimatedTokens;
        cache.delete(key);
        stats.evictions++;
    }
}

/**
 * Get a value from cache
 * @param {string} key - Cache key
 * @returns {*} Cached value or null if not found/expired
 */
async function get(key) {
    // Periodic cleanup
    if (Math.random() < 0.1) {
        cleanup();
    }

    const entry = cache.get(key);

    if (!entry) {
        stats.misses++;
        return null;
    }

    if (entry.isExpired()) {
        stats.totalTokensCached -= entry.estimatedTokens;
        cache.delete(key);
        stats.misses++;
        stats.evictions++;
        return null;
    }

    entry.touch();
    stats.hits++;
    return entry.value;
}

/**
 * Set a value in cache
 * @param {string} key - Cache key
 * @param {*} value - Value to cache
 * @param {number} [ttl] - Time to live in ms (default: context TTL)
 */
async function set(key, value, ttl = GEMINI_CONFIG.caching.contextTtl) {
    const tokens = estimateTokens(value);

    // Check if caching is enabled
    if (!GEMINI_CONFIG.caching.enabled) {
        return;
    }

    // Don't cache if single entry exceeds limit
    if (tokens > GEMINI_CONFIG.caching.maxCachedTokens) {
        console.warn(`Prompt cache: Value too large to cache (${tokens} tokens)`);
        return;
    }

    // Remove existing entry if present
    if (cache.has(key)) {
        const existing = cache.get(key);
        stats.totalTokensCached -= existing.estimatedTokens;
    }

    // Add new entry
    const entry = new CacheEntry(key, value, ttl, tokens);
    cache.set(key, entry);
    stats.totalTokensCached += tokens;

    // Enforce token limit
    enforceTokenLimit();
}

/**
 * Delete a specific cache entry
 * @param {string} key - Cache key
 */
async function del(key) {
    const entry = cache.get(key);
    if (entry) {
        stats.totalTokensCached -= entry.estimatedTokens;
        cache.delete(key);
    }
}

/**
 * Clear all cache entries
 */
async function clear() {
    cache.clear();
    stats.totalTokensCached = 0;
}

/**
 * Get cache statistics
 */
function getStats() {
    return {
        ...stats,
        entries: cache.size,
        hitRate: stats.hits + stats.misses > 0
            ? (stats.hits / (stats.hits + stats.misses) * 100).toFixed(2) + '%'
            : '0%'
    };
}

/**
 * Generate a cache key for system prompts
 * @param {string} promptType - Type of prompt (e.g., 'narrativeReasoner')
 * @param {string} [version] - Optional version string
 */
function systemPromptKey(promptType, version = 'v1') {
    return `system:${promptType}:${version}`;
}

/**
 * Generate a cache key for context
 * @param {string} operation - Operation type
 * @param {Object} data - Data to hash
 */
function contextKey(operation, data) {
    const hash = simpleHash(JSON.stringify(data));
    return `context:${operation}:${hash}`;
}

/**
 * Simple string hash function
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

/**
 * Cache a system prompt with longer TTL
 * @param {string} promptType - Type of prompt
 * @param {string} prompt - The system prompt content
 */
async function cacheSystemPrompt(promptType, prompt) {
    const key = systemPromptKey(promptType);
    await set(key, prompt, GEMINI_CONFIG.caching.systemPromptTtl);
}

/**
 * Get a cached system prompt
 * @param {string} promptType - Type of prompt
 */
async function getSystemPrompt(promptType) {
    const key = systemPromptKey(promptType);
    return get(key);
}

/**
 * Cache a context response
 * @param {string} operation - Operation type
 * @param {Object} data - Request data
 * @param {*} response - Response to cache
 */
async function cacheContext(operation, data, response) {
    const key = contextKey(operation, data);
    await set(key, response, GEMINI_CONFIG.caching.contextTtl);
}

/**
 * Get a cached context response
 * @param {string} operation - Operation type
 * @param {Object} data - Request data
 */
async function getContext(operation, data) {
    const key = contextKey(operation, data);
    return get(key);
}

// Run cleanup periodically (every 5 minutes)
setInterval(cleanup, 5 * 60 * 1000);

module.exports = {
    get,
    set,
    del,
    clear,
    getStats,
    systemPromptKey,
    contextKey,
    cacheSystemPrompt,
    getSystemPrompt,
    cacheContext,
    getContext
};
