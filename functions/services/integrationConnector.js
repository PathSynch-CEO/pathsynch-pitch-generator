/**
 * Integration Connector Service
 *
 * Handles OAuth flows and API connections for external integrations:
 * - Stripe (API key-based)
 * - Shopify (OAuth)
 * - QuickBooks (OAuth)
 * - Google Analytics 4 (OAuth)
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const investorUpdates = require('./investorUpdates');

// Get Firestore reference
function getDb() {
    return admin.firestore();
}

// ============================================================
// OAUTH CONFIGURATION
// ============================================================

const OAUTH_CONFIG = {
    shopify: {
        authUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
        tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
        scopes: 'read_orders,read_products,read_inventory,read_analytics',
        clientId: process.env.SHOPIFY_CLIENT_ID,
        clientSecret: process.env.SHOPIFY_CLIENT_SECRET
    },
    quickbooks: {
        authUrl: 'https://appcenter.intuit.com/connect/oauth2',
        tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        scopes: 'com.intuit.quickbooks.accounting',
        clientId: process.env.QUICKBOOKS_CLIENT_ID,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
        environment: process.env.QUICKBOOKS_ENV || 'sandbox' // 'sandbox' or 'production'
    },
    ga4: {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: 'https://www.googleapis.com/auth/analytics.readonly',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
};

// Base URL for OAuth callbacks
const CALLBACK_BASE_URL = process.env.API_BASE_URL || 'https://api-265mgh37hq-uc.a.run.app';

// ============================================================
// STATE MANAGEMENT (for OAuth CSRF protection)
// ============================================================

/**
 * Generate OAuth state token
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 */
async function generateOAuthState(userId, provider) {
    const db = getDb();
    const state = crypto.randomBytes(32).toString('hex');

    // Store state temporarily (expires in 10 minutes)
    await db.collection('oauthStates').doc(state).set({
        userId,
        provider,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    return state;
}

/**
 * Validate and consume OAuth state
 * @param {string} state - State token
 */
async function validateOAuthState(state) {
    const db = getDb();
    const doc = await db.collection('oauthStates').doc(state).get();

    if (!doc.exists) {
        throw new Error('Invalid OAuth state');
    }

    const data = doc.data();
    const now = new Date();

    if (data.expiresAt.toDate() < now) {
        await doc.ref.delete();
        throw new Error('OAuth state expired');
    }

    // Delete state (single use)
    await doc.ref.delete();

    return {
        userId: data.userId,
        provider: data.provider
    };
}

// ============================================================
// STRIPE CONNECTION (API Key based)
// ============================================================

/**
 * Connect Stripe account with API key
 * @param {string} userId - User ID
 * @param {string} secretKey - Stripe secret key
 */
async function connectStripe(userId, secretKey) {
    // Validate the key format
    if (!secretKey.startsWith('sk_')) {
        throw new Error('Invalid Stripe secret key format');
    }

    // Test the key by making a simple API call
    const Stripe = require('stripe');
    const stripe = new Stripe(secretKey);

    try {
        const account = await stripe.account.retrieve();

        // Store connection (encrypt the key)
        const encryptedKey = encryptToken(secretKey);

        await investorUpdates.saveConnection(userId, 'stripe', {
            encryptedApiKey: encryptedKey,
            accountId: account.id,
            accountName: account.business_profile?.name || account.email,
            accountType: account.type,
            livemode: secretKey.includes('_live_')
        });

        return {
            success: true,
            accountId: account.id,
            accountName: account.business_profile?.name || account.email,
            livemode: secretKey.includes('_live_')
        };
    } catch (error) {
        throw new Error(`Stripe connection failed: ${error.message}`);
    }
}

/**
 * Get Stripe client for a user
 * @param {string} userId - User ID
 */
async function getStripeClient(userId) {
    const connection = await investorUpdates.getConnection(userId, 'stripe');

    if (!connection || connection.status !== 'connected') {
        return null;
    }

    const Stripe = require('stripe');
    const secretKey = decryptToken(connection.encryptedApiKey);
    return new Stripe(secretKey);
}

// ============================================================
// SHOPIFY OAUTH
// ============================================================

/**
 * Get Shopify OAuth authorization URL
 * @param {string} userId - User ID
 * @param {string} shop - Shopify shop domain (e.g., 'mystore.myshopify.com')
 */
async function getShopifyAuthUrl(userId, shop) {
    const config = OAUTH_CONFIG.shopify;
    const state = await generateOAuthState(userId, 'shopify');

    // Store shop domain with state for callback
    const db = getDb();
    await db.collection('oauthStates').doc(state).update({ shop });

    const params = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
        redirect_uri: `${CALLBACK_BASE_URL}/integrations/callback/shopify`,
        state: state
    });

    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Handle Shopify OAuth callback
 * @param {string} code - Authorization code
 * @param {string} state - State token
 * @param {string} shop - Shop domain
 */
async function handleShopifyCallback(code, state, shop) {
    const { userId } = await validateOAuthState(state);
    const config = OAUTH_CONFIG.shopify;

    // Exchange code for access token
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: code
        })
    });

    if (!response.ok) {
        throw new Error('Failed to exchange Shopify authorization code');
    }

    const tokens = await response.json();

    // Store connection
    await investorUpdates.saveConnection(userId, 'shopify', {
        encryptedAccessToken: encryptToken(tokens.access_token),
        shop: shop,
        scope: tokens.scope
    });

    return { success: true, userId };
}

// ============================================================
// QUICKBOOKS OAUTH
// ============================================================

/**
 * Get QuickBooks OAuth authorization URL
 * @param {string} userId - User ID
 */
async function getQuickBooksAuthUrl(userId) {
    const config = OAUTH_CONFIG.quickbooks;
    const state = await generateOAuthState(userId, 'quickbooks');

    const params = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
        redirect_uri: `${CALLBACK_BASE_URL}/integrations/callback/quickbooks`,
        response_type: 'code',
        state: state
    });

    return `${config.authUrl}?${params.toString()}`;
}

/**
 * Handle QuickBooks OAuth callback
 * @param {string} code - Authorization code
 * @param {string} state - State token
 * @param {string} realmId - QuickBooks company ID
 */
async function handleQuickBooksCallback(code, state, realmId) {
    const { userId } = await validateOAuthState(state);
    const config = OAUTH_CONFIG.quickbooks;

    // Exchange code for tokens
    const authHeader = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: `${CALLBACK_BASE_URL}/integrations/callback/quickbooks`
        })
    });

    if (!response.ok) {
        throw new Error('Failed to exchange QuickBooks authorization code');
    }

    const tokens = await response.json();

    // Store connection
    await investorUpdates.saveConnection(userId, 'quickbooks', {
        encryptedAccessToken: encryptToken(tokens.access_token),
        encryptedRefreshToken: encryptToken(tokens.refresh_token),
        realmId: realmId,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000)
    });

    return { success: true, userId };
}

/**
 * Refresh QuickBooks access token
 * @param {string} userId - User ID
 */
async function refreshQuickBooksToken(userId) {
    const connection = await investorUpdates.getConnection(userId, 'quickbooks');

    if (!connection || !connection.encryptedRefreshToken) {
        throw new Error('No QuickBooks connection found');
    }

    const config = OAUTH_CONFIG.quickbooks;
    const refreshToken = decryptToken(connection.encryptedRefreshToken);
    const authHeader = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        throw new Error('Failed to refresh QuickBooks token');
    }

    const tokens = await response.json();

    // Update stored tokens
    await investorUpdates.updateTokens(userId, 'quickbooks', {
        encryptedAccessToken: encryptToken(tokens.access_token),
        encryptedRefreshToken: encryptToken(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000)
    });

    return tokens.access_token;
}

// ============================================================
// GOOGLE ANALYTICS 4 OAUTH
// ============================================================

/**
 * Get GA4 OAuth authorization URL
 * @param {string} userId - User ID
 */
async function getGA4AuthUrl(userId) {
    const config = OAUTH_CONFIG.ga4;
    const state = await generateOAuthState(userId, 'ga4');

    const params = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
        redirect_uri: `${CALLBACK_BASE_URL}/integrations/callback/ga4`,
        response_type: 'code',
        state: state,
        access_type: 'offline',
        prompt: 'consent'
    });

    return `${config.authUrl}?${params.toString()}`;
}

/**
 * Handle GA4 OAuth callback
 * @param {string} code - Authorization code
 * @param {string} state - State token
 */
async function handleGA4Callback(code, state) {
    const { userId } = await validateOAuthState(state);
    const config = OAUTH_CONFIG.ga4;

    // Exchange code for tokens
    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: `${CALLBACK_BASE_URL}/integrations/callback/ga4`
        })
    });

    if (!response.ok) {
        throw new Error('Failed to exchange GA4 authorization code');
    }

    const tokens = await response.json();

    // Get user's GA4 properties
    const properties = await fetchGA4Properties(tokens.access_token);

    // Store connection
    await investorUpdates.saveConnection(userId, 'ga4', {
        encryptedAccessToken: encryptToken(tokens.access_token),
        encryptedRefreshToken: encryptToken(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        properties: properties
    });

    return { success: true, userId, properties };
}

/**
 * Fetch GA4 properties for user
 * @param {string} accessToken - Access token
 */
async function fetchGA4Properties(accessToken) {
    try {
        const response = await fetch(
            'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        if (!response.ok) {
            console.error('Failed to fetch GA4 properties');
            return [];
        }

        const data = await response.json();
        const properties = [];

        (data.accountSummaries || []).forEach(account => {
            (account.propertySummaries || []).forEach(prop => {
                properties.push({
                    propertyId: prop.property,
                    displayName: prop.displayName,
                    accountName: account.displayName
                });
            });
        });

        return properties;
    } catch (error) {
        console.error('Error fetching GA4 properties:', error);
        return [];
    }
}

/**
 * Refresh GA4 access token
 * @param {string} userId - User ID
 */
async function refreshGA4Token(userId) {
    const connection = await investorUpdates.getConnection(userId, 'ga4');

    if (!connection || !connection.encryptedRefreshToken) {
        throw new Error('No GA4 connection found');
    }

    const config = OAUTH_CONFIG.ga4;
    const refreshToken = decryptToken(connection.encryptedRefreshToken);

    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        throw new Error('Failed to refresh GA4 token');
    }

    const tokens = await response.json();

    // Update stored tokens
    await investorUpdates.updateTokens(userId, 'ga4', {
        encryptedAccessToken: encryptToken(tokens.access_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000)
    });

    return tokens.access_token;
}

// ============================================================
// TOKEN ENCRYPTION/DECRYPTION
// ============================================================

// Encryption key from environment (should be 32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

/**
 * Encrypt a token for storage
 * @param {string} token - Token to encrypt
 */
function encryptToken(token) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a stored token
 * @param {string} encryptedToken - Encrypted token
 */
function decryptToken(encryptedToken) {
    const [ivHex, encrypted] = encryptedToken.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

// ============================================================
// CONNECTION STATUS
// ============================================================

/**
 * Get connection status for all providers
 * @param {string} userId - User ID
 */
async function getConnectionStatus(userId) {
    const connections = await investorUpdates.getUserConnections(userId);

    const status = {};

    for (const [provider, connection] of Object.entries(connections)) {
        status[provider] = {
            name: investorUpdates.PROVIDER_CONFIG[provider]?.name || provider,
            icon: investorUpdates.PROVIDER_CONFIG[provider]?.icon || '🔗',
            status: connection.status || 'not_connected',
            connectedAt: connection.connectedAt || null,
            // Provider-specific info
            ...(provider === 'stripe' && connection.accountName && { accountName: connection.accountName }),
            ...(provider === 'shopify' && connection.shop && { shop: connection.shop }),
            ...(provider === 'quickbooks' && connection.realmId && { realmId: connection.realmId }),
            ...(provider === 'ga4' && connection.properties && { properties: connection.properties })
        };
    }

    return status;
}

/**
 * Get valid access token for a provider (handles refresh if needed)
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 */
async function getValidAccessToken(userId, provider) {
    const connection = await investorUpdates.getConnection(userId, provider);

    if (!connection || connection.status !== 'connected') {
        throw new Error(`${provider} not connected`);
    }

    // Check if token needs refresh
    if (connection.tokenExpiresAt) {
        const expiresAt = connection.tokenExpiresAt.toDate ? connection.tokenExpiresAt.toDate() : new Date(connection.tokenExpiresAt);
        const now = new Date();

        // Refresh if expires within 5 minutes
        if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
            switch (provider) {
                case 'quickbooks':
                    return await refreshQuickBooksToken(userId);
                case 'ga4':
                    return await refreshGA4Token(userId);
            }
        }
    }

    // Return decrypted token
    if (connection.encryptedAccessToken) {
        return decryptToken(connection.encryptedAccessToken);
    }

    throw new Error(`No access token found for ${provider}`);
}

module.exports = {
    // OAuth URLs
    getShopifyAuthUrl,
    getQuickBooksAuthUrl,
    getGA4AuthUrl,

    // OAuth Callbacks
    handleShopifyCallback,
    handleQuickBooksCallback,
    handleGA4Callback,

    // Stripe (API key)
    connectStripe,
    getStripeClient,

    // Token refresh
    refreshQuickBooksToken,
    refreshGA4Token,

    // Status and utilities
    getConnectionStatus,
    getValidAccessToken,

    // Encryption utilities (exported for testing)
    encryptToken,
    decryptToken
};
