'use strict';

const admin = require('firebase-admin');

// ── TTL Configuration ────────────────────────────────────────────────────────

const CACHE_CONFIG = {
    techDetection: {
        collection: 'techDetectionCache',
        successTTLDays: 30,
        failureTTLDays: 3,
    },
    reviewHealth: {
        collection: 'reviewHealthCache',
        successTTLDays: 14,
        failureTTLDays: 3,
    },
    placesLookup: {
        collection: 'placesLookupCache',
        successTTLDays: 30,
        failureTTLDays: 3,
    },
};

// ── Key Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a hostname for use as a cache key.
 * Lowercase, strip www., strip trailing slash, strip protocol.
 */
function normalizeHostname(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let h = raw.trim().toLowerCase();

    // Strip protocol
    h = h.replace(/^https?:\/\//, '');

    // Strip www.
    h = h.replace(/^www\./, '');

    // Strip path, query, fragment
    h = h.split('/')[0].split('?')[0].split('#')[0];

    // Strip trailing dots
    h = h.replace(/\.+$/, '');

    return h || null;
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function _getDb() {
    return admin.firestore();
}

function _isExpired(doc) {
    if (!doc || !doc.exists) return true;
    const data = doc.data();
    if (!data || !data.expiresAt) return true;
    const expiresAt = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    return expiresAt <= new Date();
}

function _buildExpiresAt(success, config) {
    const ttlDays = success ? config.successTTLDays : config.failureTTLDays;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);
    return expiresAt;
}

// ── Tech Detection Cache ─────────────────────────────────────────────────────

/**
 * Get cached tech detection result for a hostname.
 * Returns the cached data object or null if missing/expired.
 */
async function getTechDetection(hostname) {
    const key = normalizeHostname(hostname);
    if (!key) return null;

    try {
        const doc = await _getDb()
            .collection(CACHE_CONFIG.techDetection.collection)
            .doc(key)
            .get();

        if (_isExpired(doc)) return null;
        return doc.data().result || null;
    } catch (err) {
        console.warn('[EnrichmentCache] techDetection read error:', err.message);
        return null;
    }
}

/**
 * Write tech detection result to cache.
 * @param {string} hostname
 * @param {object} data — the detection result
 * @param {boolean} success — true for success TTL, false for failure TTL
 */
async function setTechDetection(hostname, data, success = true) {
    const key = normalizeHostname(hostname);
    if (!key) return;

    try {
        await _getDb()
            .collection(CACHE_CONFIG.techDetection.collection)
            .doc(key)
            .set({
                result: data,
                success,
                hostname: key,
                cachedAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: _buildExpiresAt(success, CACHE_CONFIG.techDetection),
            });
    } catch (err) {
        console.warn('[EnrichmentCache] techDetection write error:', err.message);
    }
}

// ── Review Health Cache (stub — PR #20) ──────────────────────────────────────

async function getReviewHealth(hostname) {
    const key = normalizeHostname(hostname);
    if (!key) return null;

    try {
        const doc = await _getDb()
            .collection(CACHE_CONFIG.reviewHealth.collection)
            .doc(key)
            .get();

        if (_isExpired(doc)) return null;
        return doc.data().result || null;
    } catch (err) {
        console.warn('[EnrichmentCache] reviewHealth read error:', err.message);
        return null;
    }
}

async function setReviewHealth(hostname, data, success = true) {
    const key = normalizeHostname(hostname);
    if (!key) return;

    try {
        await _getDb()
            .collection(CACHE_CONFIG.reviewHealth.collection)
            .doc(key)
            .set({
                result: data,
                success,
                hostname: key,
                cachedAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: _buildExpiresAt(success, CACHE_CONFIG.reviewHealth),
            });
    } catch (err) {
        console.warn('[EnrichmentCache] reviewHealth write error:', err.message);
    }
}

// ── Places Lookup Cache (stub — PR #21) ──────────────────────────────────────

async function getPlacesLookup(hostname) {
    const key = normalizeHostname(hostname);
    if (!key) return null;

    try {
        const doc = await _getDb()
            .collection(CACHE_CONFIG.placesLookup.collection)
            .doc(key)
            .get();

        if (_isExpired(doc)) return null;
        return doc.data().result || null;
    } catch (err) {
        console.warn('[EnrichmentCache] placesLookup read error:', err.message);
        return null;
    }
}

async function setPlacesLookup(hostname, data, success = true) {
    const key = normalizeHostname(hostname);
    if (!key) return;

    try {
        await _getDb()
            .collection(CACHE_CONFIG.placesLookup.collection)
            .doc(key)
            .set({
                result: data,
                success,
                hostname: key,
                cachedAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: _buildExpiresAt(success, CACHE_CONFIG.placesLookup),
            });
    } catch (err) {
        console.warn('[EnrichmentCache] placesLookup write error:', err.message);
    }
}

module.exports = {
    normalizeHostname,
    getTechDetection,
    setTechDetection,
    getReviewHealth,
    setReviewHealth,
    getPlacesLookup,
    setPlacesLookup,
    CACHE_CONFIG,
};
