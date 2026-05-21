'use strict';

/**
 * lib/shared.js
 *
 * Shared utilities used across index.js and route modules.
 * Requires firebase-admin to already be initialised by index.js
 * before this module is first require()'d.
 */

const admin = require('firebase-admin');

// Lazily resolved so callers that require this before initializeApp()
// can still import the symbol; db is evaluated on first property access.
let _db;
function getDb() {
    if (!_db) {
        _db = admin.firestore();
    }
    return _db;
}

// Convenience export — same instance used throughout index.js
const db = new Proxy({}, {
    get(_target, prop) {
        return getDb()[prop];
    },
    apply(_target, _thisArg, args) {
        return getDb()(...args);
    }
});

/**
 * Strip /api/v1 or /v1 prefix for internal route matching.
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
    if (path.startsWith('/api/v1/')) {
        return path.replace('/api/v1', '');
    }
    if (path.startsWith('/v1/')) {
        return path.replace('/v1', '');
    }
    return path;
}

/**
 * Verify Firebase Auth Bearer token.
 * Returns the decoded token or null on failure / missing header.
 * @param {import('express').Request} req
 * @returns {Promise<object|null>}
 */
async function verifyAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        console.error('Auth verification failed:', error.message);
        return null;
    }
}

/**
 * Returns the current billing period string "YYYY-MM".
 * @returns {string}
 */
function getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
    db,
    getDb,
    normalizePath,
    verifyAuth,
    getCurrentPeriod
};
