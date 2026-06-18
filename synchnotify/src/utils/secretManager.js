/**
 * Secret Manager Utility
 *
 * Loads secrets from GCP Secret Manager with in-memory caching.
 * Falls back to environment variables for local development.
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// In-memory cache for loaded secrets
const _cache = {};

// Lazy-init client
let _client = null;

function getClient() {
    if (!_client) {
        try {
            _client = new SecretManagerServiceClient();
        } catch (error) {
            console.warn('[secretManager] Client init failed:', error.message);
        }
    }
    return _client;
}

/**
 * Load a secret from Secret Manager, with in-memory caching.
 * Falls back to environment variable if Secret Manager is unavailable.
 *
 * @param {string} secretName - Secret name in Secret Manager
 * @param {Object} options
 * @param {string} options.projectId - GCP project ID (default: pathconnect-442522)
 * @param {string} options.envFallback - Environment variable name to fall back to
 * @returns {Promise<string|null>} The secret value, or null if not found
 */
async function loadSecret(secretName, options = {}) {
    // Return cached value if available
    if (_cache[secretName]) {
        return _cache[secretName];
    }

    const projectId = options.projectId || process.env.GCP_SECRET_PROJECT_ID || 'pathconnect-442522';
    const envFallback = options.envFallback || secretName;

    // Try Secret Manager first
    const client = getClient();
    if (client) {
        try {
            const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
            const [version] = await client.accessSecretVersion({ name });
            const value = version.payload.data.toString('utf8');
            _cache[secretName] = value;
            return value;
        } catch (error) {
            // Not found or permission error — fall through to env
            if (error.code !== 5) { // 5 = NOT_FOUND
                console.warn(`[secretManager] Failed to load ${secretName}:`, error.message);
            }
        }
    }

    // Fall back to environment variable
    const envValue = process.env[envFallback];
    if (envValue) {
        _cache[secretName] = envValue;
        return envValue;
    }

    return null;
}

/**
 * Clear the in-memory cache. Used for testing.
 */
function clearCache() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
}

/**
 * Override the client for testing.
 */
function setClient(client) {
    _client = client;
}

module.exports = { loadSecret, clearCache, setClient };
