/**
 * Rate Limiting Configuration
 *
 * Defines rate limits per subscription plan and endpoint type.
 * Limits are specified as requests per time window.
 */

// Time windows in seconds
const WINDOWS = {
    SECOND: 1,
    MINUTE: 60,
    HOUR: 3600,
    DAY: 86400
};

/**
 * Rate limits by plan tier
 *
 * Each plan has:
 * - global: Overall API requests per hour
 * - endpoints: Specific limits for expensive operations
 */
const PLAN_LIMITS = {
    anonymous: {
        global: {
            requests: 20,
            window: WINDOWS.HOUR
        },
        endpoints: {
            generatePitch: { requests: 3, window: WINDOWS.HOUR },
            generateNarrative: { requests: 0, window: WINDOWS.HOUR }, // Not allowed
            marketReport: { requests: 0, window: WINDOWS.HOUR },
            bulkUpload: { requests: 0, window: WINDOWS.HOUR }
        }
    },

    starter: {
        global: {
            requests: 100,
            window: WINDOWS.HOUR
        },
        endpoints: {
            generatePitch: { requests: 10, window: WINDOWS.HOUR },
            generateNarrative: { requests: 5, window: WINDOWS.HOUR },
            formatNarrative: { requests: 20, window: WINDOWS.HOUR },
            marketReport: { requests: 0, window: WINDOWS.HOUR }, // Not included in plan
            bulkUpload: { requests: 0, window: WINDOWS.HOUR }
        }
    },

    growth: {
        global: {
            requests: 500,
            window: WINDOWS.HOUR
        },
        endpoints: {
            generatePitch: { requests: 50, window: WINDOWS.HOUR },
            generateNarrative: { requests: 25, window: WINDOWS.HOUR },
            formatNarrative: { requests: 100, window: WINDOWS.HOUR },
            marketReport: { requests: 10, window: WINDOWS.HOUR },
            bulkUpload: { requests: 5, window: WINDOWS.HOUR }
        }
    },

    scale: {
        global: {
            requests: 2000,
            window: WINDOWS.HOUR
        },
        endpoints: {
            generatePitch: { requests: 200, window: WINDOWS.HOUR },
            generateNarrative: { requests: 100, window: WINDOWS.HOUR },
            formatNarrative: { requests: 500, window: WINDOWS.HOUR },
            marketReport: { requests: 50, window: WINDOWS.HOUR },
            bulkUpload: { requests: 20, window: WINDOWS.HOUR }
        }
    }
};

/**
 * IP-based limits for unauthenticated requests
 * More restrictive to prevent abuse
 */
const IP_LIMITS = {
    global: {
        requests: 30,
        window: WINDOWS.HOUR
    },
    burst: {
        requests: 10,
        window: WINDOWS.MINUTE
    }
};

/**
 * Endpoint to rate limit key mapping
 * Maps API paths to rate limit endpoint names
 */
const ENDPOINT_MAPPING = {
    '/generate-pitch': 'generatePitch',
    '/narratives/generate': 'generateNarrative',
    '/narratives/regenerate': 'generateNarrative',
    '/market/report': 'marketReport',
    '/bulk/upload': 'bulkUpload'
};

// Match patterns for dynamic paths
const ENDPOINT_PATTERNS = [
    { pattern: /^\/narratives\/[^/]+\/format/, key: 'formatNarrative' },
    { pattern: /^\/narratives\/[^/]+\/regenerate/, key: 'generateNarrative' }
];

/**
 * Get rate limit for a specific endpoint
 * @param {string} plan - User's subscription plan
 * @param {string} path - API endpoint path
 * @returns {object|null} Rate limit config or null if no specific limit
 */
function getEndpointLimit(plan, path) {
    // Check exact match first
    const endpointKey = ENDPOINT_MAPPING[path];
    if (endpointKey) {
        return PLAN_LIMITS[plan]?.endpoints?.[endpointKey] || null;
    }

    // Check patterns
    for (const { pattern, key } of ENDPOINT_PATTERNS) {
        if (pattern.test(path)) {
            return PLAN_LIMITS[plan]?.endpoints?.[key] || null;
        }
    }

    return null;
}

/**
 * Get global rate limit for a plan
 * @param {string} plan - User's subscription plan
 * @returns {object} Rate limit config
 */
function getGlobalLimit(plan) {
    return PLAN_LIMITS[plan]?.global || PLAN_LIMITS.anonymous.global;
}

/**
 * Get IP-based rate limit
 * @param {string} type - 'global' or 'burst'
 * @returns {object} Rate limit config
 */
function getIPLimit(type = 'global') {
    return IP_LIMITS[type] || IP_LIMITS.global;
}

/**
 * Check if an endpoint is rate-limited (requests: 0)
 * @param {string} plan - User's subscription plan
 * @param {string} path - API endpoint path
 * @returns {boolean} True if endpoint is blocked for this plan
 */
function isEndpointBlocked(plan, path) {
    const limit = getEndpointLimit(plan, path);
    return limit && limit.requests === 0;
}

module.exports = {
    WINDOWS,
    PLAN_LIMITS,
    IP_LIMITS,
    ENDPOINT_MAPPING,
    ENDPOINT_PATTERNS,
    getEndpointLimit,
    getGlobalLimit,
    getIPLimit,
    isEndpointBlocked
};
