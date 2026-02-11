/**
 * Investor Updates API Routes
 *
 * Enterprise-tier endpoints for investor update reports and integrations.
 * Features: Connect business metrics sources, generate investor updates.
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const investorUpdates = require('../services/investorUpdates');
const integrationConnector = require('../services/integrationConnector');
const metricsAggregator = require('../services/metricsAggregator');
const investorReportGenerator = require('../services/investorReportGenerator');
const { hasFeature, hasIntegration } = require('../config/stripe');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if user has Enterprise tier with investor updates access
 */
async function requireEnterprise(userId) {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const tier = (userData.tier || userData.plan || 'starter').toLowerCase();

    if (!hasFeature(tier, 'investorUpdates')) {
        throw new ApiError(
            'Investor Updates require Enterprise plan',
            403,
            ErrorCodes.FORBIDDEN
        );
    }

    return { userData, tier };
}

/**
 * Check if user has access to specific integration
 */
function checkIntegration(tier, provider) {
    if (!hasIntegration(tier, provider)) {
        throw new ApiError(
            `${provider} integration not available on your plan`,
            403,
            ErrorCodes.FORBIDDEN
        );
    }
}

// ============================================================
// INTEGRATION ROUTES
// ============================================================

/**
 * GET /investor/integrations/status
 * Get connection status for all integrations
 */
router.get('/investor/integrations/status', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const status = await integrationConnector.getConnectionStatus(userId);

        return res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/integrations/status');
    }
});

/**
 * POST /investor/integrations/connect/stripe
 * Connect Stripe with API key
 */
router.post('/investor/integrations/connect/stripe', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { tier } = await requireEnterprise(userId);
        checkIntegration(tier, 'stripe');

        const { secretKey } = req.body;
        if (!secretKey) {
            throw new ApiError('Stripe secret key is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const result = await integrationConnector.connectStripe(userId, secretKey);

        return res.status(200).json({
            success: true,
            message: 'Stripe connected successfully',
            data: result
        });
    } catch (error) {
        return handleError(error, res, 'POST /investor/integrations/connect/stripe');
    }
});

/**
 * GET /investor/integrations/connect/shopify
 * Get Shopify OAuth authorization URL
 */
router.get('/investor/integrations/connect/shopify', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { tier } = await requireEnterprise(userId);
        checkIntegration(tier, 'shopify');

        const { shop } = req.query;
        if (!shop) {
            throw new ApiError('Shopify shop domain is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const authUrl = await integrationConnector.getShopifyAuthUrl(userId, shop);

        return res.status(200).json({
            success: true,
            data: { authUrl }
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/integrations/connect/shopify');
    }
});

/**
 * GET /investor/integrations/connect/quickbooks
 * Get QuickBooks OAuth authorization URL
 */
router.get('/investor/integrations/connect/quickbooks', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { tier } = await requireEnterprise(userId);
        checkIntegration(tier, 'quickbooks');

        const authUrl = await integrationConnector.getQuickBooksAuthUrl(userId);

        return res.status(200).json({
            success: true,
            data: { authUrl }
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/integrations/connect/quickbooks');
    }
});

/**
 * GET /investor/integrations/connect/ga4
 * Get Google Analytics 4 OAuth authorization URL
 */
router.get('/investor/integrations/connect/ga4', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { tier } = await requireEnterprise(userId);
        checkIntegration(tier, 'ga4');

        const authUrl = await integrationConnector.getGA4AuthUrl(userId);

        return res.status(200).json({
            success: true,
            data: { authUrl }
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/integrations/connect/ga4');
    }
});

/**
 * GET /investor/integrations/callback/shopify
 * Handle Shopify OAuth callback
 */
router.get('/investor/integrations/callback/shopify', async (req, res) => {
    try {
        const { code, state, shop } = req.query;

        if (!code || !state || !shop) {
            return res.redirect('/investor-updates?error=missing_params');
        }

        await integrationConnector.handleShopifyCallback(code, state, shop);

        return res.redirect('/investor-updates?connected=shopify');
    } catch (error) {
        console.error('Shopify callback error:', error);
        return res.redirect(`/investor-updates?error=${encodeURIComponent(error.message)}`);
    }
});

/**
 * GET /investor/integrations/callback/quickbooks
 * Handle QuickBooks OAuth callback
 */
router.get('/investor/integrations/callback/quickbooks', async (req, res) => {
    try {
        const { code, state, realmId } = req.query;

        if (!code || !state) {
            return res.redirect('/investor-updates?error=missing_params');
        }

        await integrationConnector.handleQuickBooksCallback(code, state, realmId);

        return res.redirect('/investor-updates?connected=quickbooks');
    } catch (error) {
        console.error('QuickBooks callback error:', error);
        return res.redirect(`/investor-updates?error=${encodeURIComponent(error.message)}`);
    }
});

/**
 * GET /investor/integrations/callback/ga4
 * Handle GA4 OAuth callback
 */
router.get('/investor/integrations/callback/ga4', async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.redirect('/investor-updates?error=missing_params');
        }

        await integrationConnector.handleGA4Callback(code, state);

        return res.redirect('/investor-updates?connected=ga4');
    } catch (error) {
        console.error('GA4 callback error:', error);
        return res.redirect(`/investor-updates?error=${encodeURIComponent(error.message)}`);
    }
});

/**
 * DELETE /investor/integrations/:provider
 * Disconnect an integration
 */
router.delete('/investor/integrations/:provider', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { provider } = req.params;
        const validProviders = ['stripe', 'shopify', 'quickbooks', 'ga4'];

        if (!validProviders.includes(provider)) {
            throw new ApiError(`Invalid provider. Valid: ${validProviders.join(', ')}`, 400, ErrorCodes.VALIDATION_ERROR);
        }

        await investorUpdates.disconnectProvider(userId, provider);

        return res.status(200).json({
            success: true,
            message: `${provider} disconnected successfully`
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /investor/integrations/:provider');
    }
});

// ============================================================
// METRICS ROUTES
// ============================================================

/**
 * GET /investor/metrics
 * Fetch current metrics from all connected integrations
 */
router.get('/investor/metrics', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const period = req.query.period || investorUpdates.getCurrentPeriod();
        const metrics = await metricsAggregator.fetchAllMetrics(userId, period);

        return res.status(200).json({
            success: true,
            data: metrics
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/metrics');
    }
});

/**
 * GET /investor/metrics/comparison
 * Get metrics comparison between periods
 */
router.get('/investor/metrics/comparison', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const currentPeriod = req.query.period || investorUpdates.getCurrentPeriod();
        const previousPeriod = req.query.previous || metricsAggregator.getPreviousPeriod(currentPeriod);

        const comparison = await metricsAggregator.getMetricsComparison(userId, currentPeriod, previousPeriod);

        return res.status(200).json({
            success: true,
            data: comparison
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/metrics/comparison');
    }
});

/**
 * GET /investor/metrics/history
 * Get historical metrics snapshots
 */
router.get('/investor/metrics/history', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { provider, limit = 12 } = req.query;

        const snapshots = await investorUpdates.getMetricsSnapshots(userId, {
            provider,
            limit: parseInt(limit)
        });

        return res.status(200).json({
            success: true,
            data: snapshots
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/metrics/history');
    }
});

// ============================================================
// INVESTOR UPDATE ROUTES
// ============================================================

/**
 * POST /investor/updates
 * Generate a new investor update
 */
router.post('/investor/updates', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const {
            template = 'monthly_update',
            period,
            highlights = [],
            challenges = [],
            asks = [],
            companyName,
            founderName
        } = req.body;

        const report = await investorReportGenerator.generateReport(userId, {
            template,
            period,
            customHighlights: highlights,
            customChallenges: challenges,
            customAsks: asks,
            companyName,
            founderName
        });

        return res.status(201).json({
            success: true,
            message: 'Investor update generated successfully',
            data: report
        });
    } catch (error) {
        return handleError(error, res, 'POST /investor/updates');
    }
});

/**
 * GET /investor/updates
 * List investor updates
 */
router.get('/investor/updates', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { status, limit = 20 } = req.query;

        const updates = await investorUpdates.listInvestorUpdates(userId, {
            status,
            limit: parseInt(limit)
        });

        return res.status(200).json({
            success: true,
            data: updates
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/updates');
    }
});

/**
 * GET /investor/updates/:id
 * Get a specific investor update
 */
router.get('/investor/updates/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { id } = req.params;
        const format = req.query.format || 'json';

        const update = await investorUpdates.getInvestorUpdate(id, userId);

        if (!update) {
            throw new ApiError('Update not found', 404, ErrorCodes.NOT_FOUND);
        }

        // Return specific format if requested
        if (format === 'html') {
            res.setHeader('Content-Type', 'text/html');
            return res.send(update.generatedHtml);
        }

        if (format === 'markdown') {
            res.setHeader('Content-Type', 'text/markdown');
            return res.send(update.generatedMarkdown);
        }

        return res.status(200).json({
            success: true,
            data: update
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/updates/:id');
    }
});

/**
 * PUT /investor/updates/:id
 * Update an investor update
 */
router.put('/investor/updates/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { id } = req.params;
        const changes = req.body;

        await investorUpdates.updateInvestorUpdate(id, userId, changes);

        return res.status(200).json({
            success: true,
            message: 'Update modified successfully'
        });
    } catch (error) {
        return handleError(error, res, 'PUT /investor/updates/:id');
    }
});

/**
 * POST /investor/updates/:id/regenerate
 * Regenerate an investor update with new inputs
 */
router.post('/investor/updates/:id/regenerate', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { id } = req.params;
        const options = req.body;

        const report = await investorReportGenerator.regenerateReport(userId, id, options);

        return res.status(200).json({
            success: true,
            message: 'Update regenerated successfully',
            data: report
        });
    } catch (error) {
        return handleError(error, res, 'POST /investor/updates/:id/regenerate');
    }
});

/**
 * POST /investor/updates/:id/publish
 * Publish an investor update
 */
router.post('/investor/updates/:id/publish', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { id } = req.params;

        await investorUpdates.publishInvestorUpdate(id, userId);

        return res.status(200).json({
            success: true,
            message: 'Update published successfully'
        });
    } catch (error) {
        return handleError(error, res, 'POST /investor/updates/:id/publish');
    }
});

/**
 * DELETE /investor/updates/:id
 * Delete an investor update
 */
router.delete('/investor/updates/:id', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        const { id } = req.params;

        await investorUpdates.deleteInvestorUpdate(id, userId);

        return res.status(200).json({
            success: true,
            message: 'Update deleted successfully'
        });
    } catch (error) {
        return handleError(error, res, 'DELETE /investor/updates/:id');
    }
});

/**
 * GET /investor/templates
 * Get available report templates
 */
router.get('/investor/templates', async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        await requireEnterprise(userId);

        return res.status(200).json({
            success: true,
            data: Object.values(investorUpdates.REPORT_TEMPLATES)
        });
    } catch (error) {
        return handleError(error, res, 'GET /investor/templates');
    }
});

module.exports = router;
