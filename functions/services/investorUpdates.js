/**
 * Investor Updates Service
 *
 * Enterprise-tier feature for generating investor update reports
 * with metrics from connected integrations (Stripe, Shopify, QuickBooks, GA4)
 */

const admin = require('firebase-admin');

// Get Firestore reference
function getDb() {
    return admin.firestore();
}

// Generate unique IDs
function generateId(prefix = 'inv') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Integration Providers
 */
const PROVIDERS = {
    STRIPE: 'stripe',
    SHOPIFY: 'shopify',
    QUICKBOOKS: 'quickbooks',
    GA4: 'ga4'
};

/**
 * Provider Configuration
 */
const PROVIDER_CONFIG = {
    [PROVIDERS.STRIPE]: {
        name: 'Stripe',
        description: 'Revenue, MRR, subscriptions, and churn metrics',
        icon: '💳',
        authType: 'api_key', // Stripe uses API key, not OAuth
        metrics: ['mrr', 'arr', 'revenue', 'subscribers', 'churn', 'arpu']
    },
    [PROVIDERS.SHOPIFY]: {
        name: 'Shopify',
        description: 'Sales, orders, average order value, and inventory',
        icon: '🛒',
        authType: 'oauth',
        scopes: ['read_orders', 'read_products', 'read_inventory', 'read_analytics'],
        metrics: ['sales', 'orders', 'aov', 'units_sold', 'returning_customers']
    },
    [PROVIDERS.QUICKBOOKS]: {
        name: 'QuickBooks',
        description: 'Profit & loss, cash flow, expenses, and runway',
        icon: '📊',
        authType: 'oauth',
        scopes: ['com.intuit.quickbooks.accounting'],
        metrics: ['revenue', 'expenses', 'profit', 'cash_balance', 'runway_months']
    },
    [PROVIDERS.GA4]: {
        name: 'Google Analytics 4',
        description: 'Website traffic, conversions, and user engagement',
        icon: '📈',
        authType: 'oauth',
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
        metrics: ['sessions', 'users', 'pageviews', 'conversions', 'bounce_rate']
    }
};

/**
 * Report Templates
 */
const REPORT_TEMPLATES = {
    MONTHLY_UPDATE: {
        id: 'monthly_update',
        name: 'Monthly Investor Update',
        description: 'Concise monthly update with key metrics and highlights',
        sections: ['highlights', 'metrics', 'progress', 'challenges', 'asks']
    },
    QUARTERLY_REPORT: {
        id: 'quarterly_report',
        name: 'Quarterly Report',
        description: 'Comprehensive quarterly analysis with trends and projections',
        sections: ['executive_summary', 'financials', 'product', 'team', 'roadmap', 'risks']
    },
    BOARD_DECK: {
        id: 'board_deck',
        name: 'Board Deck',
        description: 'Presentation-ready slides for board meetings',
        sections: ['title', 'kpis', 'revenue', 'product', 'team', 'financials', 'asks', 'appendix']
    }
};

// ============================================================
// INTEGRATION CONNECTIONS
// ============================================================

/**
 * Create or update an integration connection
 * @param {string} userId - User ID
 * @param {string} provider - Provider name (stripe, shopify, etc.)
 * @param {Object} connectionData - Connection data (tokens, config)
 */
async function saveConnection(userId, provider, connectionData) {
    const db = getDb();
    const connectionId = `${userId}_${provider}`;

    const connection = {
        connectionId,
        userId,
        provider,
        status: 'connected',
        ...connectionData,
        connectedAt: connectionData.connectedAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('integrationConnections').doc(connectionId).set(connection, { merge: true });

    return connection;
}

/**
 * Get a user's connection for a provider
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 */
async function getConnection(userId, provider) {
    const db = getDb();
    const connectionId = `${userId}_${provider}`;
    const doc = await db.collection('integrationConnections').doc(connectionId).get();

    if (!doc.exists) {
        return null;
    }

    return doc.data();
}

/**
 * Get all connections for a user
 * @param {string} userId - User ID
 */
async function getUserConnections(userId) {
    const db = getDb();
    const snapshot = await db.collection('integrationConnections')
        .where('userId', '==', userId)
        .get();

    const connections = {};
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        connections[data.provider] = data;
    });

    // Add unconfigured providers
    Object.keys(PROVIDER_CONFIG).forEach(provider => {
        if (!connections[provider]) {
            connections[provider] = {
                provider,
                status: 'not_connected',
                ...PROVIDER_CONFIG[provider]
            };
        } else {
            connections[provider] = {
                ...connections[provider],
                ...PROVIDER_CONFIG[provider]
            };
        }
    });

    return connections;
}

/**
 * Disconnect an integration
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 */
async function disconnectProvider(userId, provider) {
    const db = getDb();
    const connectionId = `${userId}_${provider}`;

    await db.collection('integrationConnections').doc(connectionId).update({
        status: 'disconnected',
        disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Clear sensitive data
        accessToken: admin.firestore.FieldValue.delete(),
        refreshToken: admin.firestore.FieldValue.delete()
    });

    return { success: true };
}

/**
 * Update connection tokens (for refresh)
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 * @param {Object} tokens - New tokens
 */
async function updateTokens(userId, provider, tokens) {
    const db = getDb();
    const connectionId = `${userId}_${provider}`;

    await db.collection('integrationConnections').doc(connectionId).update({
        ...tokens,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// ============================================================
// METRICS SNAPSHOTS
// ============================================================

/**
 * Save a metrics snapshot
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 * @param {Object} metrics - Metrics data
 * @param {string} period - Period identifier (e.g., '2026-02', '2026-Q1')
 */
async function saveMetricsSnapshot(userId, provider, metrics, period) {
    const db = getDb();
    const snapshotId = generateId('snap');

    const snapshot = {
        snapshotId,
        userId,
        provider,
        period,
        metrics,
        capturedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('metricsSnapshots').doc(snapshotId).set(snapshot);

    return snapshot;
}

/**
 * Get metrics snapshots for a user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 */
async function getMetricsSnapshots(userId, options = {}) {
    const db = getDb();
    let query = db.collection('metricsSnapshots')
        .where('userId', '==', userId)
        .orderBy('capturedAt', 'desc');

    if (options.provider) {
        query = query.where('provider', '==', options.provider);
    }

    if (options.period) {
        query = query.where('period', '==', options.period);
    }

    if (options.limit) {
        query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data());
}

/**
 * Get aggregated metrics across all providers for a period
 * @param {string} userId - User ID
 * @param {string} period - Period (e.g., '2026-02')
 */
async function getAggregatedMetrics(userId, period) {
    const snapshots = await getMetricsSnapshots(userId, { period });

    const aggregated = {
        period,
        capturedAt: new Date().toISOString(),
        providers: {},
        summary: {
            revenue: 0,
            mrr: 0,
            customers: 0,
            sessions: 0
        }
    };

    snapshots.forEach(snapshot => {
        aggregated.providers[snapshot.provider] = snapshot.metrics;

        // Sum up key metrics
        if (snapshot.metrics.revenue) aggregated.summary.revenue += snapshot.metrics.revenue;
        if (snapshot.metrics.mrr) aggregated.summary.mrr += snapshot.metrics.mrr;
        if (snapshot.metrics.subscribers) aggregated.summary.customers += snapshot.metrics.subscribers;
        if (snapshot.metrics.sessions) aggregated.summary.sessions += snapshot.metrics.sessions;
    });

    return aggregated;
}

// ============================================================
// INVESTOR UPDATES
// ============================================================

/**
 * Create an investor update
 * @param {string} userId - User ID
 * @param {Object} updateData - Update data
 */
async function createInvestorUpdate(userId, updateData) {
    const db = getDb();
    const updateId = generateId('update');

    const update = {
        updateId,
        userId,
        template: updateData.template || 'monthly_update',
        period: updateData.period,
        title: updateData.title,
        status: 'draft',
        metrics: updateData.metrics || {},
        content: updateData.content || {},
        highlights: updateData.highlights || [],
        challenges: updateData.challenges || [],
        asks: updateData.asks || [],
        customSections: updateData.customSections || {},
        generatedHtml: updateData.generatedHtml || null,
        generatedMarkdown: updateData.generatedMarkdown || null,
        tokensUsed: updateData.tokensUsed || 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('investorUpdates').doc(updateId).set(update);

    return update;
}

/**
 * Update an investor update
 * @param {string} updateId - Update ID
 * @param {string} userId - User ID (for verification)
 * @param {Object} changes - Changes to apply
 */
async function updateInvestorUpdate(updateId, userId, changes) {
    const db = getDb();
    const docRef = db.collection('investorUpdates').doc(updateId);
    const doc = await docRef.get();

    if (!doc.exists) {
        throw new Error('Investor update not found');
    }

    if (doc.data().userId !== userId) {
        throw new Error('Access denied');
    }

    await docRef.update({
        ...changes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
}

/**
 * Get an investor update by ID
 * @param {string} updateId - Update ID
 * @param {string} userId - User ID (for verification)
 */
async function getInvestorUpdate(updateId, userId) {
    const db = getDb();
    const doc = await db.collection('investorUpdates').doc(updateId).get();

    if (!doc.exists) {
        return null;
    }

    const data = doc.data();
    if (data.userId !== userId) {
        throw new Error('Access denied');
    }

    return data;
}

/**
 * List investor updates for a user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 */
async function listInvestorUpdates(userId, options = {}) {
    const db = getDb();
    let query = db.collection('investorUpdates')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

    if (options.status) {
        query = query.where('status', '==', options.status);
    }

    if (options.limit) {
        query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        // Return summary without full content
        return {
            updateId: data.updateId,
            title: data.title,
            template: data.template,
            period: data.period,
            status: data.status,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
        };
    });
}

/**
 * Delete an investor update
 * @param {string} updateId - Update ID
 * @param {string} userId - User ID (for verification)
 */
async function deleteInvestorUpdate(updateId, userId) {
    const db = getDb();
    const docRef = db.collection('investorUpdates').doc(updateId);
    const doc = await docRef.get();

    if (!doc.exists) {
        throw new Error('Investor update not found');
    }

    if (doc.data().userId !== userId) {
        throw new Error('Access denied');
    }

    await docRef.delete();
    return { success: true };
}

/**
 * Publish an investor update (change status to published)
 * @param {string} updateId - Update ID
 * @param {string} userId - User ID
 */
async function publishInvestorUpdate(updateId, userId) {
    return updateInvestorUpdate(updateId, userId, {
        status: 'published',
        publishedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get current period string (e.g., '2026-02')
 */
function getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get current quarter string (e.g., '2026-Q1')
 */
function getCurrentQuarter() {
    const now = new Date();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    return `${now.getFullYear()}-Q${quarter}`;
}

/**
 * Calculate period-over-period change
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 */
function calculateChange(current, previous) {
    if (!previous || previous === 0) {
        return { absolute: current, percentage: null, direction: 'up' };
    }

    const absolute = current - previous;
    const percentage = ((current - previous) / previous) * 100;
    const direction = absolute >= 0 ? 'up' : 'down';

    return {
        absolute,
        percentage: Math.round(percentage * 10) / 10,
        direction
    };
}

/**
 * Format currency for display
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code
 */
function formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount / 100);
}

/**
 * Format large numbers with abbreviations
 * @param {number} num - Number to format
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

module.exports = {
    // Constants
    PROVIDERS,
    PROVIDER_CONFIG,
    REPORT_TEMPLATES,

    // Connection management
    saveConnection,
    getConnection,
    getUserConnections,
    disconnectProvider,
    updateTokens,

    // Metrics snapshots
    saveMetricsSnapshot,
    getMetricsSnapshots,
    getAggregatedMetrics,

    // Investor updates
    createInvestorUpdate,
    updateInvestorUpdate,
    getInvestorUpdate,
    listInvestorUpdates,
    deleteInvestorUpdate,
    publishInvestorUpdate,

    // Helpers
    getCurrentPeriod,
    getCurrentQuarter,
    calculateChange,
    formatCurrency,
    formatNumber,
    generateId
};
