'use strict';

const crypto = require('node:crypto');
const { checkRateLimit } = require('../../middleware/rateLimiter');

const LIMITS = Object.freeze({
    inventory: Object.freeze({ requests: 30, window: 5 * 60 }),
    inspect: Object.freeze({ requests: 60, window: 5 * 60 }),
    receipt: Object.freeze({ requests: 60, window: 5 * 60 }),
    dry_run: Object.freeze({ requests: 30, window: 5 * 60 }),
    execute: Object.freeze({ requests: 10, window: 60 * 60 })
});

function digestIdentifier(operatorUid, scope) {
    return crypto.createHash('sha256')
        .update(`synchintro-recovery:${String(operatorUid || '')}:${scope}`)
        .digest('hex');
}

function routeScope(req) {
    const path = String(req.normalizedPath || req.path || '');
    if (req.method === 'POST' && path.endsWith('/execute')) return 'execute';
    if (req.method === 'POST' && path.endsWith('/dry-run')) return 'dry_run';
    if (req.method === 'GET' && path.includes('/receipts/')) return 'receipt';
    if (req.method === 'GET' && path === '/admin/synchintro/synthetic-recovery') return 'inventory';
    return 'inspect';
}

function createBookingRecoveryRateLimiter(options = {}) {
    const check = options.checkRateLimit || checkRateLimit;
    const now = options.now || (() => new Date());
    return async function requireRecoveryRateLimit(req, res, next) {
        const uid = req.recoveryActor?.uid;
        const scope = routeScope(req);
        const limit = LIMITS[scope];
        if (!uid || !limit) {
            return res.status(503).json({ success: false, error: 'Recovery rate limit unavailable' });
        }
        try {
            const result = await check(
                digestIdentifier(uid, scope),
                `synchintro_synthetic_recovery_${scope}`,
                limit
            );
            if (!result || result.error) {
                return res.status(503).json({ success: false, error: 'Recovery rate limit unavailable' });
            }
            if (!result.allowed) {
                const nowSeconds = Math.floor(now().getTime() / 1000);
                const retryAfter = Math.max(1, Number(result.resetAt || nowSeconds + limit.window) - nowSeconds);
                if (typeof res.set === 'function') res.set('Retry-After', String(retryAfter));
                return res.status(429).json({
                    success: false,
                    error: 'Rate limit exceeded',
                    details: { scope, retry_after_seconds: retryAfter }
                });
            }
            return next();
        } catch (_) {
            return res.status(503).json({ success: false, error: 'Recovery rate limit unavailable' });
        }
    };
}

const requireRecoveryRateLimit = createBookingRecoveryRateLimiter();

module.exports = {
    LIMITS,
    digestIdentifier,
    routeScope,
    createBookingRecoveryRateLimiter,
    requireRecoveryRateLimit
};
