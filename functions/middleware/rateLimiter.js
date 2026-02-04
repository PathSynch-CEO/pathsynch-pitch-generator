/**
 * Rate Limiting Middleware
 *
 * Implements distributed rate limiting using Firestore for tracking.
 * Supports per-user (by UID) and per-IP rate limiting with plan-based limits.
 */

const admin = require('firebase-admin');
const {
    getEndpointLimit,
    getGlobalLimit,
    getIPLimit,
    isEndpointBlocked,
    ENDPOINT_MAPPING,
    ENDPOINT_PATTERNS
} = require('../config/rateLimits');

// Firestore collection for rate limit tracking
const RATE_LIMIT_COLLECTION = 'rateLimits';

/**
 * Get the rate limit key for a request
 * @param {string} identifier - User ID or IP address
 * @param {string} type - 'global' or endpoint key
 * @returns {string} Firestore document ID
 */
function getRateLimitKey(identifier, type) {
    // Sanitize identifier for Firestore document ID
    const safeIdentifier = identifier.replace(/[\/\.]/g, '_');
    return `${safeIdentifier}_${type}`;
}

/**
 * Get current window start timestamp
 * @param {number} windowSeconds - Window size in seconds
 * @returns {number} Window start timestamp
 */
function getWindowStart(windowSeconds) {
    const now = Math.floor(Date.now() / 1000);
    return Math.floor(now / windowSeconds) * windowSeconds;
}

/**
 * Check and increment rate limit counter
 * @param {string} identifier - User ID or IP address
 * @param {string} type - Rate limit type (global or endpoint key)
 * @param {object} limit - { requests, window } limit config
 * @returns {Promise<object>} { allowed: boolean, remaining: number, resetAt: number }
 */
async function checkRateLimit(identifier, type, limit) {
    const db = admin.firestore();
    const key = getRateLimitKey(identifier, type);
    const windowStart = getWindowStart(limit.window);
    const resetAt = windowStart + limit.window;

    const docRef = db.collection(RATE_LIMIT_COLLECTION).doc(key);

    try {
        const result = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            const data = doc.data();

            // Check if we're in the same window
            if (data && data.windowStart === windowStart) {
                const currentCount = data.count || 0;

                if (currentCount >= limit.requests) {
                    // Rate limit exceeded
                    return {
                        allowed: false,
                        remaining: 0,
                        resetAt,
                        count: currentCount
                    };
                }

                // Increment counter
                transaction.update(docRef, {
                    count: admin.firestore.FieldValue.increment(1),
                    lastRequest: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    allowed: true,
                    remaining: limit.requests - currentCount - 1,
                    resetAt,
                    count: currentCount + 1
                };
            } else {
                // New window, reset counter
                transaction.set(docRef, {
                    identifier,
                    type,
                    windowStart,
                    count: 1,
                    lastRequest: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    allowed: true,
                    remaining: limit.requests - 1,
                    resetAt,
                    count: 1
                };
            }
        });

        return result;
    } catch (error) {
        console.error('Rate limit check error:', error);
        // On error, allow the request but log it
        return {
            allowed: true,
            remaining: -1,
            resetAt,
            error: true
        };
    }
}

/**
 * Get endpoint key from request path
 * @param {string} path - Request path
 * @returns {string|null} Endpoint key or null
 */
function getEndpointKey(path) {
    // Check exact match first
    if (ENDPOINT_MAPPING[path]) {
        return ENDPOINT_MAPPING[path];
    }

    // Check patterns
    for (const { pattern, key } of ENDPOINT_PATTERNS) {
        if (pattern.test(path)) {
            return key;
        }
    }

    return null;
}

/**
 * Extract client IP from request
 * @param {object} req - Request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
    // Firebase Functions provides the IP in x-forwarded-for
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // Take the first IP if multiple are present
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Set rate limit headers on response
 * @param {object} res - Response object
 * @param {object} result - Rate limit check result
 * @param {number} limit - Request limit
 */
function setRateLimitHeaders(res, result, limit) {
    // Don't set headers if response already sent
    if (res.headersSent) return;
    try {
        res.set('X-RateLimit-Limit', limit.toString());
        res.set('X-RateLimit-Remaining', Math.max(0, result.remaining).toString());
        res.set('X-RateLimit-Reset', result.resetAt.toString());
    } catch (e) {
        // Ignore header errors
    }
}

/**
 * Send rate limit exceeded response
 * @param {object} res - Response object
 * @param {object} result - Rate limit check result
 * @param {string} type - 'global' or endpoint name
 */
function sendRateLimitResponse(res, result, type) {
    const retryAfter = result.resetAt - Math.floor(Date.now() / 1000);

    res.set('Retry-After', Math.max(1, retryAfter).toString());
    res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: {
            type,
            retryAfter: Math.max(1, retryAfter),
            resetAt: new Date(result.resetAt * 1000).toISOString()
        }
    });
}

/**
 * Rate limiting middleware factory
 * @param {object} options - Middleware options
 * @param {boolean} options.requireAuth - Whether to require authentication (default: false)
 * @returns {function} Express middleware function
 */
function rateLimiter(options = {}) {
    return async (req, res, next) => {
        try {
            const path = req.path;
            const userId = req.user?.uid;
            const userPlan = req.user?.plan || 'anonymous';
            const clientIP = getClientIP(req);

            // Determine identifier (prefer user ID over IP)
            const identifier = userId || clientIP;
            const isAuthenticated = !!userId;

            // Check if endpoint is blocked for this plan
            if (isEndpointBlocked(userPlan, path)) {
                return res.status(403).json({
                    success: false,
                    error: 'This feature is not available on your current plan',
                    details: {
                        plan: userPlan,
                        upgrade: true
                    }
                });
            }

            // For unauthenticated requests, apply stricter IP-based limits
            if (!isAuthenticated) {
                // Check IP burst limit
                const burstLimit = getIPLimit('burst');
                const burstResult = await checkRateLimit(clientIP, 'ip_burst', burstLimit);

                if (!burstResult.allowed) {
                    setRateLimitHeaders(res, burstResult, burstLimit.requests);
                    return sendRateLimitResponse(res, burstResult, 'burst');
                }

                // Check IP global limit
                const ipGlobalLimit = getIPLimit('global');
                const ipResult = await checkRateLimit(clientIP, 'ip_global', ipGlobalLimit);

                if (!ipResult.allowed) {
                    setRateLimitHeaders(res, ipResult, ipGlobalLimit.requests);
                    return sendRateLimitResponse(res, ipResult, 'ip_global');
                }
            }

            // Check global rate limit for the plan
            const globalLimit = getGlobalLimit(userPlan);
            const globalResult = await checkRateLimit(identifier, 'global', globalLimit);

            if (!globalResult.allowed) {
                setRateLimitHeaders(res, globalResult, globalLimit.requests);
                return sendRateLimitResponse(res, globalResult, 'global');
            }

            // Check endpoint-specific rate limit
            const endpointKey = getEndpointKey(path);
            if (endpointKey) {
                const endpointLimit = getEndpointLimit(userPlan, path);

                if (endpointLimit && endpointLimit.requests > 0) {
                    const endpointResult = await checkRateLimit(
                        identifier,
                        `endpoint_${endpointKey}`,
                        endpointLimit
                    );

                    if (!endpointResult.allowed) {
                        setRateLimitHeaders(res, endpointResult, endpointLimit.requests);
                        return sendRateLimitResponse(res, endpointResult, endpointKey);
                    }

                    // Set headers for endpoint limit
                    setRateLimitHeaders(res, endpointResult, endpointLimit.requests);
                } else if (endpointLimit && endpointLimit.requests === 0) {
                    // Endpoint not allowed for this plan
                    return res.status(403).json({
                        success: false,
                        error: 'This feature is not available on your current plan',
                        details: {
                            plan: userPlan,
                            endpoint: endpointKey,
                            upgrade: true
                        }
                    });
                }
            } else {
                // Set headers for global limit
                setRateLimitHeaders(res, globalResult, globalLimit.requests);
            }

            // Attach rate limit info to request for logging
            req.rateLimit = {
                identifier,
                plan: userPlan,
                globalRemaining: globalResult.remaining
            };

            next();
        } catch (error) {
            console.error('Rate limiter error:', error);
            // On error, allow the request but log it
            next();
        }
    };
}

/**
 * Cleanup old rate limit documents (run periodically)
 * @param {number} maxAgeSeconds - Delete documents older than this
 * @returns {Promise<number>} Number of deleted documents
 */
async function cleanupRateLimits(maxAgeSeconds = 86400) {
    const db = admin.firestore();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;

    const snapshot = await db.collection(RATE_LIMIT_COLLECTION)
        .where('windowStart', '<', cutoff)
        .limit(500) // Batch delete
        .get();

    if (snapshot.empty) {
        return 0;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    return snapshot.size;
}

/**
 * Get rate limit status for a user
 * @param {string} userId - User ID
 * @param {string} plan - User's subscription plan
 * @returns {Promise<object>} Current rate limit status
 */
async function getRateLimitStatus(userId, plan = 'starter') {
    const db = admin.firestore();
    const globalLimit = getGlobalLimit(plan);
    const windowStart = getWindowStart(globalLimit.window);

    const globalKey = getRateLimitKey(userId, 'global');
    const doc = await db.collection(RATE_LIMIT_COLLECTION).doc(globalKey).get();

    if (!doc.exists || doc.data().windowStart !== windowStart) {
        return {
            plan,
            global: {
                limit: globalLimit.requests,
                used: 0,
                remaining: globalLimit.requests,
                resetsAt: new Date((windowStart + globalLimit.window) * 1000).toISOString()
            }
        };
    }

    const data = doc.data();
    return {
        plan,
        global: {
            limit: globalLimit.requests,
            used: data.count,
            remaining: Math.max(0, globalLimit.requests - data.count),
            resetsAt: new Date((windowStart + globalLimit.window) * 1000).toISOString()
        }
    };
}

module.exports = {
    rateLimiter,
    checkRateLimit,
    cleanupRateLimits,
    getRateLimitStatus,
    getClientIP,
    getRateLimitKey,
    getEndpointKey
};
