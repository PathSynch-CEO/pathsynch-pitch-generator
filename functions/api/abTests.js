/**
 * A/B Test Admin API Handlers
 *
 * Admin endpoints for managing A/B tests
 */

const abTestingService = require('../services/abTestingService');
const feedbackService = require('../services/feedbackService');
const { isFeatureEnabled } = require('../config/gemini');

/**
 * POST /api/v1/admin/ab-tests
 * Create a new A/B test
 */
async function createTest(req, res) {
    try {
        // Check if A/B testing is enabled
        if (!isFeatureEnabled('enableAbTesting')) {
            return res.status(503).json({
                success: false,
                error: 'A/B testing is currently disabled',
                message: 'Enable the ENABLE_AB_TESTING feature flag to use this endpoint'
            });
        }

        const {
            name,
            description,
            testType,
            operation,
            variants,
            targetAudience,
            metrics
        } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: name'
            });
        }

        if (!operation) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: operation',
                message: 'Valid operations: narrativeGeneration, narrativeValidation, premiumFormatting, basicFormatting, onboarding'
            });
        }

        if (!variants || !Array.isArray(variants) || variants.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Invalid variants',
                message: 'Must provide at least 2 variants'
            });
        }

        const test = await abTestingService.createTest({
            name,
            description,
            testType,
            operation,
            variants,
            targetAudience,
            metrics
        });

        return res.status(201).json({
            success: true,
            message: 'A/B test created successfully',
            data: test
        });

    } catch (error) {
        console.error('Error creating A/B test:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create A/B test',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests
 * List all A/B tests
 */
async function listTests(req, res) {
    try {
        const status = req.query.status;
        const operation = req.query.operation;
        const limit = parseInt(req.query.limit, 10) || 50;

        const tests = await abTestingService.listTests({
            status,
            operation,
            limit
        });

        return res.status(200).json({
            success: true,
            data: tests,
            count: tests.length
        });

    } catch (error) {
        console.error('Error listing A/B tests:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list A/B tests',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/:id
 * Get a specific A/B test
 */
async function getTest(req, res) {
    const testId = req.params.id;

    try {
        const test = await abTestingService.getTest(testId);

        if (!test) {
            return res.status(404).json({
                success: false,
                error: 'A/B test not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: test
        });

    } catch (error) {
        console.error('Error getting A/B test:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get A/B test',
            message: error.message
        });
    }
}

/**
 * POST /api/v1/admin/ab-tests/:id/start
 * Start an A/B test
 */
async function startTest(req, res) {
    const testId = req.params.id;

    try {
        const test = await abTestingService.startTest(testId);

        return res.status(200).json({
            success: true,
            message: 'A/B test started successfully',
            data: test
        });

    } catch (error) {
        console.error('Error starting A/B test:', error);

        if (error.message === 'Test not found') {
            return res.status(404).json({
                success: false,
                error: 'A/B test not found'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to start A/B test',
            message: error.message
        });
    }
}

/**
 * POST /api/v1/admin/ab-tests/:id/pause
 * Pause a running A/B test
 */
async function pauseTest(req, res) {
    const testId = req.params.id;

    try {
        const test = await abTestingService.pauseTest(testId);

        return res.status(200).json({
            success: true,
            message: 'A/B test paused successfully',
            data: test
        });

    } catch (error) {
        console.error('Error pausing A/B test:', error);

        if (error.message === 'Test not found') {
            return res.status(404).json({
                success: false,
                error: 'A/B test not found'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to pause A/B test',
            message: error.message
        });
    }
}

/**
 * POST /api/v1/admin/ab-tests/:id/stop
 * Stop and complete an A/B test
 */
async function stopTest(req, res) {
    const testId = req.params.id;

    try {
        const test = await abTestingService.stopTest(testId);

        return res.status(200).json({
            success: true,
            message: 'A/B test stopped and analysis completed',
            data: test
        });

    } catch (error) {
        console.error('Error stopping A/B test:', error);

        if (error.message === 'Test not found') {
            return res.status(404).json({
                success: false,
                error: 'A/B test not found'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to stop A/B test',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/:id/results
 * Get detailed results and analysis for an A/B test
 */
async function getTestResults(req, res) {
    const testId = req.params.id;

    try {
        const results = await abTestingService.getTestResults(testId);

        return res.status(200).json({
            success: true,
            data: results
        });

    } catch (error) {
        console.error('Error getting A/B test results:', error);

        if (error.message === 'Test not found') {
            return res.status(404).json({
                success: false,
                error: 'A/B test not found'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to get A/B test results',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/feedback-health
 * Get overall feedback health metrics (for rollback decisions)
 */
async function getFeedbackHealth(req, res) {
    try {
        const health = await feedbackService.checkFeedbackHealth();

        return res.status(200).json({
            success: true,
            data: health
        });

    } catch (error) {
        console.error('Error checking feedback health:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check feedback health',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/model-comparison
 * Compare feedback between two models
 */
async function compareModels(req, res) {
    try {
        const { modelA, modelB, period } = req.query;

        if (!modelA || !modelB) {
            return res.status(400).json({
                success: false,
                error: 'Missing required query parameters',
                message: 'Both modelA and modelB are required'
            });
        }

        const comparison = await feedbackService.compareModels(modelA, modelB, period);

        return res.status(200).json({
            success: true,
            data: comparison
        });

    } catch (error) {
        console.error('Error comparing models:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to compare models',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/feedback-aggregates
 * Get aggregated feedback statistics
 */
async function getFeedbackAggregates(req, res) {
    try {
        const period = req.query.period;
        const aggregates = await feedbackService.getAggregates(period);

        return res.status(200).json({
            success: true,
            data: aggregates
        });

    } catch (error) {
        console.error('Error getting feedback aggregates:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get feedback aggregates',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/admin/ab-tests/trending-issues
 * Get trending feedback issues
 */
async function getTrendingIssues(req, res) {
    try {
        const limit = parseInt(req.query.limit, 10) || 10;
        const issues = await feedbackService.getTrendingIssues(limit);

        return res.status(200).json({
            success: true,
            data: issues
        });

    } catch (error) {
        console.error('Error getting trending issues:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get trending issues',
            message: error.message
        });
    }
}

module.exports = {
    createTest,
    listTests,
    getTest,
    startTest,
    pauseTest,
    stopTest,
    getTestResults,
    getFeedbackHealth,
    compareModels,
    getFeedbackAggregates,
    getTrendingIssues
};
