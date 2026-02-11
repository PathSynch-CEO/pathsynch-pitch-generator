/**
 * Metrics Aggregator Service
 *
 * Fetches and aggregates metrics from connected integrations:
 * - Stripe: MRR, revenue, churn, subscribers
 * - Shopify: sales, orders, AOV
 * - QuickBooks: P&L, cash flow
 * - GA4: sessions, conversions
 */

const integrationConnector = require('./integrationConnector');
const investorUpdates = require('./investorUpdates');

// ============================================================
// STRIPE METRICS
// ============================================================

/**
 * Fetch Stripe metrics for a period
 * @param {string} userId - User ID
 * @param {Date} startDate - Period start
 * @param {Date} endDate - Period end
 */
async function fetchStripeMetrics(userId, startDate, endDate) {
    const stripe = await integrationConnector.getStripeClient(userId);

    if (!stripe) {
        return null;
    }

    try {
        const startTimestamp = Math.floor(startDate.getTime() / 1000);
        const endTimestamp = Math.floor(endDate.getTime() / 1000);

        // Fetch charges for revenue
        const charges = await stripe.charges.list({
            created: { gte: startTimestamp, lte: endTimestamp },
            limit: 100
        });

        // Fetch subscriptions for MRR
        const subscriptions = await stripe.subscriptions.list({
            status: 'active',
            limit: 100
        });

        // Fetch customers
        const customers = await stripe.customers.list({
            created: { gte: startTimestamp, lte: endTimestamp },
            limit: 100
        });

        // Calculate metrics
        const totalRevenue = charges.data
            .filter(c => c.status === 'succeeded')
            .reduce((sum, c) => sum + c.amount, 0);

        const mrr = subscriptions.data
            .reduce((sum, sub) => {
                const item = sub.items.data[0];
                if (!item) return sum;
                const amount = item.price.unit_amount || 0;
                const interval = item.price.recurring?.interval || 'month';
                // Normalize to monthly
                if (interval === 'year') return sum + (amount / 12);
                if (interval === 'week') return sum + (amount * 4);
                return sum + amount;
            }, 0);

        // Count churned subscriptions
        const canceledSubs = await stripe.subscriptions.list({
            status: 'canceled',
            created: { gte: startTimestamp, lte: endTimestamp },
            limit: 100
        });

        const metrics = {
            revenue: totalRevenue, // in cents
            mrr: Math.round(mrr), // in cents
            arr: Math.round(mrr * 12), // in cents
            activeSubscribers: subscriptions.data.length,
            newCustomers: customers.data.length,
            chargeCount: charges.data.filter(c => c.status === 'succeeded').length,
            churnedSubscriptions: canceledSubs.data.length,
            churnRate: subscriptions.data.length > 0
                ? (canceledSubs.data.length / (subscriptions.data.length + canceledSubs.data.length) * 100).toFixed(1)
                : 0,
            arpu: subscriptions.data.length > 0
                ? Math.round(mrr / subscriptions.data.length)
                : 0
        };

        return metrics;
    } catch (error) {
        console.error('Error fetching Stripe metrics:', error);
        throw error;
    }
}

// ============================================================
// SHOPIFY METRICS
// ============================================================

/**
 * Fetch Shopify metrics for a period
 * @param {string} userId - User ID
 * @param {Date} startDate - Period start
 * @param {Date} endDate - Period end
 */
async function fetchShopifyMetrics(userId, startDate, endDate) {
    const connection = await investorUpdates.getConnection(userId, 'shopify');

    if (!connection || connection.status !== 'connected') {
        return null;
    }

    try {
        const accessToken = await integrationConnector.getValidAccessToken(userId, 'shopify');
        const shop = connection.shop;

        // Fetch orders
        const ordersResponse = await fetch(
            `https://${shop}/admin/api/2024-01/orders.json?` +
            `created_at_min=${startDate.toISOString()}&` +
            `created_at_max=${endDate.toISOString()}&` +
            `status=any&limit=250`,
            {
                headers: { 'X-Shopify-Access-Token': accessToken }
            }
        );

        if (!ordersResponse.ok) {
            throw new Error('Failed to fetch Shopify orders');
        }

        const ordersData = await ordersResponse.json();
        const orders = ordersData.orders || [];

        // Calculate metrics
        const completedOrders = orders.filter(o => o.financial_status === 'paid');
        const totalSales = completedOrders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
        const totalUnits = completedOrders.reduce((sum, o) =>
            sum + o.line_items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);

        // Get unique customers
        const uniqueCustomers = new Set(completedOrders.map(o => o.customer?.id).filter(Boolean));
        const returningCustomers = orders.filter(o =>
            o.customer && o.customer.orders_count > 1
        ).length;

        const metrics = {
            totalSales: Math.round(totalSales * 100), // in cents
            orderCount: completedOrders.length,
            unitsSold: totalUnits,
            averageOrderValue: completedOrders.length > 0
                ? Math.round((totalSales / completedOrders.length) * 100) // in cents
                : 0,
            uniqueCustomers: uniqueCustomers.size,
            returningCustomers: returningCustomers,
            returningCustomerRate: completedOrders.length > 0
                ? ((returningCustomers / completedOrders.length) * 100).toFixed(1)
                : 0,
            canceledOrders: orders.filter(o => o.cancelled_at).length,
            refundedOrders: orders.filter(o => o.financial_status === 'refunded').length
        };

        return metrics;
    } catch (error) {
        console.error('Error fetching Shopify metrics:', error);
        throw error;
    }
}

// ============================================================
// QUICKBOOKS METRICS
// ============================================================

/**
 * Fetch QuickBooks metrics for a period
 * @param {string} userId - User ID
 * @param {Date} startDate - Period start
 * @param {Date} endDate - Period end
 */
async function fetchQuickBooksMetrics(userId, startDate, endDate) {
    const connection = await investorUpdates.getConnection(userId, 'quickbooks');

    if (!connection || connection.status !== 'connected') {
        return null;
    }

    try {
        const accessToken = await integrationConnector.getValidAccessToken(userId, 'quickbooks');
        const realmId = connection.realmId;
        const baseUrl = process.env.QUICKBOOKS_ENV === 'production'
            ? 'https://quickbooks.api.intuit.com'
            : 'https://sandbox-quickbooks.api.intuit.com';

        // Format dates for QuickBooks API
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Fetch Profit and Loss report
        const plResponse = await fetch(
            `${baseUrl}/v3/company/${realmId}/reports/ProfitAndLoss?` +
            `start_date=${startDateStr}&end_date=${endDateStr}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!plResponse.ok) {
            throw new Error('Failed to fetch QuickBooks P&L report');
        }

        const plData = await plResponse.json();

        // Fetch Balance Sheet for cash position
        const bsResponse = await fetch(
            `${baseUrl}/v3/company/${realmId}/reports/BalanceSheet?` +
            `as_of_date=${endDateStr}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            }
        );

        let cashBalance = 0;
        if (bsResponse.ok) {
            const bsData = await bsResponse.json();
            cashBalance = extractCashBalance(bsData);
        }

        // Parse P&L data
        const { revenue, expenses, netIncome } = parseProfitAndLoss(plData);

        // Calculate runway (months of cash at current burn rate)
        const monthlyBurn = expenses / getMonthsBetween(startDate, endDate);
        const runwayMonths = monthlyBurn > 0 ? Math.floor(cashBalance / monthlyBurn) : null;

        const metrics = {
            revenue: Math.round(revenue * 100), // in cents
            expenses: Math.round(expenses * 100), // in cents
            netIncome: Math.round(netIncome * 100), // in cents
            profitMargin: revenue > 0 ? ((netIncome / revenue) * 100).toFixed(1) : 0,
            cashBalance: Math.round(cashBalance * 100), // in cents
            monthlyBurn: Math.round(monthlyBurn * 100), // in cents
            runwayMonths: runwayMonths
        };

        return metrics;
    } catch (error) {
        console.error('Error fetching QuickBooks metrics:', error);
        throw error;
    }
}

/**
 * Parse Profit and Loss report data
 */
function parseProfitAndLoss(plData) {
    let revenue = 0;
    let expenses = 0;
    let netIncome = 0;

    try {
        const rows = plData.Rows?.Row || [];

        rows.forEach(row => {
            if (row.group === 'Income') {
                revenue = parseFloat(row.Summary?.ColData?.[1]?.value || 0);
            } else if (row.group === 'Expenses') {
                expenses = parseFloat(row.Summary?.ColData?.[1]?.value || 0);
            } else if (row.type === 'Section' && row.group === 'NetIncome') {
                netIncome = parseFloat(row.Summary?.ColData?.[1]?.value || 0);
            }
        });
    } catch (e) {
        console.error('Error parsing P&L:', e);
    }

    return { revenue, expenses, netIncome };
}

/**
 * Extract cash balance from Balance Sheet
 */
function extractCashBalance(bsData) {
    try {
        const rows = bsData.Rows?.Row || [];

        for (const row of rows) {
            if (row.group === 'Asset') {
                const subRows = row.Rows?.Row || [];
                for (const subRow of subRows) {
                    if (subRow.group === 'BankAccounts' || subRow.Header?.ColData?.[0]?.value === 'Bank Accounts') {
                        return parseFloat(subRow.Summary?.ColData?.[1]?.value || 0);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error extracting cash balance:', e);
    }

    return 0;
}

// ============================================================
// GOOGLE ANALYTICS 4 METRICS
// ============================================================

/**
 * Fetch GA4 metrics for a period
 * @param {string} userId - User ID
 * @param {Date} startDate - Period start
 * @param {Date} endDate - Period end
 * @param {string} propertyId - GA4 property ID (optional, uses first if not specified)
 */
async function fetchGA4Metrics(userId, startDate, endDate, propertyId = null) {
    const connection = await investorUpdates.getConnection(userId, 'ga4');

    if (!connection || connection.status !== 'connected') {
        return null;
    }

    try {
        const accessToken = await integrationConnector.getValidAccessToken(userId, 'ga4');

        // Use specified property or first available
        const property = propertyId || connection.properties?.[0]?.propertyId;

        if (!property) {
            throw new Error('No GA4 property configured');
        }

        // Format dates for GA4 API
        const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
        const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

        // Fetch core metrics
        const response = await fetch(
            `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    dateRanges: [{
                        startDate: startDateStr,
                        endDate: endDateStr
                    }],
                    metrics: [
                        { name: 'sessions' },
                        { name: 'totalUsers' },
                        { name: 'newUsers' },
                        { name: 'screenPageViews' },
                        { name: 'engagementRate' },
                        { name: 'bounceRate' },
                        { name: 'averageSessionDuration' },
                        { name: 'conversions' }
                    ]
                })
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch GA4 metrics');
        }

        const data = await response.json();
        const values = data.rows?.[0]?.metricValues || [];

        const metrics = {
            sessions: parseInt(values[0]?.value || 0),
            totalUsers: parseInt(values[1]?.value || 0),
            newUsers: parseInt(values[2]?.value || 0),
            pageviews: parseInt(values[3]?.value || 0),
            engagementRate: (parseFloat(values[4]?.value || 0) * 100).toFixed(1),
            bounceRate: (parseFloat(values[5]?.value || 0) * 100).toFixed(1),
            avgSessionDuration: Math.round(parseFloat(values[6]?.value || 0)),
            conversions: parseInt(values[7]?.value || 0),
            conversionRate: parseInt(values[0]?.value || 0) > 0
                ? ((parseInt(values[7]?.value || 0) / parseInt(values[0]?.value || 0)) * 100).toFixed(2)
                : 0
        };

        return metrics;
    } catch (error) {
        console.error('Error fetching GA4 metrics:', error);
        throw error;
    }
}

// ============================================================
// AGGREGATION
// ============================================================

/**
 * Fetch all available metrics for a user
 * @param {string} userId - User ID
 * @param {string} period - Period string (e.g., '2026-02')
 */
async function fetchAllMetrics(userId, period) {
    // Parse period to date range
    const { startDate, endDate } = parsePeriodToDateRange(period);

    // Fetch metrics from all connected providers in parallel
    const [stripeMetrics, shopifyMetrics, quickbooksMetrics, ga4Metrics] = await Promise.all([
        fetchStripeMetrics(userId, startDate, endDate).catch(e => {
            console.error('Stripe metrics error:', e.message);
            return null;
        }),
        fetchShopifyMetrics(userId, startDate, endDate).catch(e => {
            console.error('Shopify metrics error:', e.message);
            return null;
        }),
        fetchQuickBooksMetrics(userId, startDate, endDate).catch(e => {
            console.error('QuickBooks metrics error:', e.message);
            return null;
        }),
        fetchGA4Metrics(userId, startDate, endDate).catch(e => {
            console.error('GA4 metrics error:', e.message);
            return null;
        })
    ]);

    const aggregated = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        fetchedAt: new Date().toISOString(),
        providers: {}
    };

    // Add provider metrics
    if (stripeMetrics) {
        aggregated.providers.stripe = stripeMetrics;

        // Save snapshot
        await investorUpdates.saveMetricsSnapshot(userId, 'stripe', stripeMetrics, period);
    }

    if (shopifyMetrics) {
        aggregated.providers.shopify = shopifyMetrics;
        await investorUpdates.saveMetricsSnapshot(userId, 'shopify', shopifyMetrics, period);
    }

    if (quickbooksMetrics) {
        aggregated.providers.quickbooks = quickbooksMetrics;
        await investorUpdates.saveMetricsSnapshot(userId, 'quickbooks', quickbooksMetrics, period);
    }

    if (ga4Metrics) {
        aggregated.providers.ga4 = ga4Metrics;
        await investorUpdates.saveMetricsSnapshot(userId, 'ga4', ga4Metrics, period);
    }

    // Calculate summary metrics
    aggregated.summary = calculateSummaryMetrics(aggregated.providers);

    return aggregated;
}

/**
 * Calculate summary metrics across all providers
 */
function calculateSummaryMetrics(providers) {
    const summary = {
        totalRevenue: 0,
        mrr: 0,
        customers: 0,
        sessions: 0,
        conversions: 0
    };

    // Add Stripe revenue
    if (providers.stripe) {
        summary.totalRevenue += providers.stripe.revenue || 0;
        summary.mrr = providers.stripe.mrr || 0;
        summary.customers += providers.stripe.activeSubscribers || 0;
    }

    // Add Shopify revenue
    if (providers.shopify) {
        summary.totalRevenue += providers.shopify.totalSales || 0;
        summary.customers += providers.shopify.uniqueCustomers || 0;
    }

    // Add QuickBooks revenue (if different from Stripe/Shopify)
    // Note: Be careful not to double-count if using multiple revenue sources

    // Add GA4 traffic metrics
    if (providers.ga4) {
        summary.sessions = providers.ga4.sessions || 0;
        summary.conversions = providers.ga4.conversions || 0;
    }

    return summary;
}

// ============================================================
// PERIOD COMPARISON
// ============================================================

/**
 * Get metrics comparison between two periods
 * @param {string} userId - User ID
 * @param {string} currentPeriod - Current period (e.g., '2026-02')
 * @param {string} previousPeriod - Previous period (e.g., '2026-01')
 */
async function getMetricsComparison(userId, currentPeriod, previousPeriod) {
    const current = await investorUpdates.getAggregatedMetrics(userId, currentPeriod);
    const previous = await investorUpdates.getAggregatedMetrics(userId, previousPeriod);

    const comparison = {
        currentPeriod,
        previousPeriod,
        providers: {}
    };

    // Compare each provider
    for (const provider of Object.keys(current.providers || {})) {
        const currentMetrics = current.providers[provider];
        const previousMetrics = previous.providers?.[provider] || {};

        comparison.providers[provider] = {};

        for (const [metric, value] of Object.entries(currentMetrics)) {
            const prevValue = previousMetrics[metric];
            comparison.providers[provider][metric] = {
                current: value,
                previous: prevValue || 0,
                ...investorUpdates.calculateChange(value, prevValue)
            };
        }
    }

    return comparison;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Parse period string to date range
 * @param {string} period - Period string (e.g., '2026-02' or '2026-Q1')
 */
function parsePeriodToDateRange(period) {
    const now = new Date();

    if (period.includes('Q')) {
        // Quarterly period (e.g., '2026-Q1')
        const [year, quarter] = period.split('-Q');
        const quarterNum = parseInt(quarter);
        const startMonth = (quarterNum - 1) * 3;

        const startDate = new Date(parseInt(year), startMonth, 1);
        const endDate = new Date(parseInt(year), startMonth + 3, 0, 23, 59, 59);

        return { startDate, endDate };
    } else {
        // Monthly period (e.g., '2026-02')
        const [year, month] = period.split('-');

        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

        return { startDate, endDate };
    }
}

/**
 * Get number of months between two dates
 */
function getMonthsBetween(startDate, endDate) {
    const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth()) + 1;
    return Math.max(1, months);
}

/**
 * Get previous period string
 * @param {string} period - Current period
 */
function getPreviousPeriod(period) {
    if (period.includes('Q')) {
        const [year, quarter] = period.split('-Q');
        const quarterNum = parseInt(quarter);

        if (quarterNum === 1) {
            return `${parseInt(year) - 1}-Q4`;
        }
        return `${year}-Q${quarterNum - 1}`;
    } else {
        const [year, month] = period.split('-');
        const monthNum = parseInt(month);

        if (monthNum === 1) {
            return `${parseInt(year) - 1}-12`;
        }
        return `${year}-${String(monthNum - 1).padStart(2, '0')}`;
    }
}

module.exports = {
    // Individual provider fetchers
    fetchStripeMetrics,
    fetchShopifyMetrics,
    fetchQuickBooksMetrics,
    fetchGA4Metrics,

    // Aggregation
    fetchAllMetrics,
    calculateSummaryMetrics,

    // Comparison
    getMetricsComparison,

    // Utilities
    parsePeriodToDateRange,
    getPreviousPeriod,
    getMonthsBetween
};
