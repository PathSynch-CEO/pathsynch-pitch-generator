/**
 * Sales Intelligence Routes
 *
 * API endpoints for the Trifecta:
 * - Intent Hunter: Track and analyze buying signals
 * - ICP Refiner: Learn from deals and refine ICP
 * - LinkedIn Scorer: Score prospects against ICP
 */

const { createRouter } = require('../utils/router');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');
const salesIntelligence = require('../services/salesIntelligence');

const router = createRouter();

// ============================================
// DASHBOARD & ANALYSIS
// ============================================

/**
 * GET /sales-intelligence/dashboard
 * Get combined sales intelligence dashboard
 */
router.get('/sales-intelligence/dashboard', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const dashboard = await salesIntelligence.getDashboard(req.userId);

        return res.status(200).json({
            success: true,
            data: dashboard,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/dashboard');
    }
});

/**
 * POST /sales-intelligence/analyze
 * Analyze a prospect using all three intelligence sources
 */
router.post('/sales-intelligence/analyze', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const prospect = req.body;

        if (!prospect.company && !prospect.email) {
            throw new ApiError('Company or email is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const analysis = await salesIntelligence.analyzeProspect(req.userId, prospect);

        return res.status(200).json({
            success: true,
            data: analysis,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/analyze');
    }
});

// ============================================
// INTENT HUNTER
// ============================================

/**
 * POST /sales-intelligence/intent/signal
 * Record an intent signal for a prospect
 */
router.post('/sales-intelligence/intent/signal', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const signal = req.body;

        if (!signal.signalType) {
            throw new ApiError('signalType is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const result = await salesIntelligence.intentHunter.recordSignal(req.userId, signal);

        return res.status(201).json({
            success: true,
            data: result,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/intent/signal');
    }
});

/**
 * POST /sales-intelligence/intent/signals/bulk
 * Bulk import intent signals (e.g., from website analytics)
 */
router.post('/sales-intelligence/intent/signals/bulk', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { signals } = req.body;

        if (!signals || !Array.isArray(signals)) {
            throw new ApiError('signals array is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const result = await salesIntelligence.intentHunter.bulkImportSignals(req.userId, signals);

        return res.status(200).json({
            success: true,
            data: result,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/intent/signals/bulk');
    }
});

/**
 * GET /sales-intelligence/intent/hot-prospects
 * Get prospects with high intent scores
 */
router.get('/sales-intelligence/intent/hot-prospects', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const limit = parseInt(req.query.limit) || 20;
        const minScore = parseInt(req.query.minScore) || undefined;

        const prospects = await salesIntelligence.intentHunter.getHotProspects(req.userId, {
            limit,
            minScore,
        });

        return res.status(200).json({
            success: true,
            data: prospects,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/intent/hot-prospects');
    }
});

/**
 * GET /sales-intelligence/intent/prospect/:prospectId/timeline
 * Get intent timeline for a specific prospect
 */
router.get('/sales-intelligence/intent/prospect/:prospectId/timeline', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { prospectId } = req.params;
        const limit = parseInt(req.query.limit) || 50;

        const timeline = await salesIntelligence.intentHunter.getProspectTimeline(
            req.userId,
            prospectId,
            { limit }
        );

        if (!timeline) {
            throw new ApiError('Prospect not found', 404, ErrorCodes.NOT_FOUND);
        }

        return res.status(200).json({
            success: true,
            data: timeline,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/intent/prospect/:prospectId/timeline');
    }
});

// ============================================
// ICP REFINER
// ============================================

/**
 * POST /sales-intelligence/icp/deal
 * Record a deal outcome for ICP learning
 */
router.post('/sales-intelligence/icp/deal', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const deal = req.body;

        if (!deal.outcome || !deal.prospectData) {
            throw new ApiError('outcome and prospectData are required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const result = await salesIntelligence.icpRefiner.recordDealOutcome(req.userId, deal);

        return res.status(201).json({
            success: true,
            data: result,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/icp/deal');
    }
});

/**
 * GET /sales-intelligence/icp/insights
 * Get ICP insights and recommendations
 */
router.get('/sales-intelligence/icp/insights', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const insights = await salesIntelligence.icpRefiner.getIcpInsights(req.userId);

        return res.status(200).json({
            success: true,
            data: insights,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/icp/insights');
    }
});

/**
 * POST /sales-intelligence/icp/score
 * Score a prospect against the ICP
 */
router.post('/sales-intelligence/icp/score', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const prospectData = req.body;

        const score = await salesIntelligence.icpRefiner.scoreProspect(req.userId, prospectData);

        return res.status(200).json({
            success: true,
            data: score,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/icp/score');
    }
});

/**
 * GET /sales-intelligence/icp/definition
 * Get user's ICP definition
 */
router.get('/sales-intelligence/icp/definition', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const definition = await salesIntelligence.icpRefiner.getIcpDefinition(req.userId);

        return res.status(200).json({
            success: true,
            data: definition,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/icp/definition');
    }
});

/**
 * PUT /sales-intelligence/icp/definition
 * Save/update ICP definition
 */
router.put('/sales-intelligence/icp/definition', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const icpDefinition = req.body;

        const result = await salesIntelligence.icpRefiner.saveIcpDefinition(req.userId, icpDefinition);

        if (!result.success) {
            throw new ApiError(result.error || 'Failed to save ICP definition', 500);
        }

        return res.status(200).json({
            success: true,
            message: 'ICP definition saved',
        });

    } catch (error) {
        return handleError(error, res, 'PUT /sales-intelligence/icp/definition');
    }
});

// ============================================
// LINKEDIN SCORER
// ============================================

/**
 * POST /sales-intelligence/linkedin/score
 * Score a LinkedIn profile against ICP
 */
router.post('/sales-intelligence/linkedin/score', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const linkedinProfile = req.body;

        if (!linkedinProfile.title && !linkedinProfile.headline) {
            throw new ApiError('title or headline is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const score = await salesIntelligence.linkedinScorer.scoreLinkedInProfile(
            req.userId,
            linkedinProfile
        );

        return res.status(200).json({
            success: true,
            data: score,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/linkedin/score');
    }
});

/**
 * POST /sales-intelligence/linkedin/score/batch
 * Score multiple LinkedIn profiles
 */
router.post('/sales-intelligence/linkedin/score/batch', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const { profiles } = req.body;

        if (!profiles || !Array.isArray(profiles)) {
            throw new ApiError('profiles array is required', 400, ErrorCodes.VALIDATION_ERROR);
        }

        if (profiles.length > 50) {
            throw new ApiError('Maximum 50 profiles per batch', 400, ErrorCodes.VALIDATION_ERROR);
        }

        const scores = await salesIntelligence.linkedinScorer.batchScoreProfiles(
            req.userId,
            profiles
        );

        return res.status(200).json({
            success: true,
            data: scores,
        });

    } catch (error) {
        return handleError(error, res, 'POST /sales-intelligence/linkedin/score/batch');
    }
});

/**
 * GET /sales-intelligence/linkedin/stats
 * Get LinkedIn scoring statistics
 */
router.get('/sales-intelligence/linkedin/stats', async (req, res) => {
    try {
        if (!req.userId || req.userId === 'anonymous') {
            throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
        }

        const stats = await salesIntelligence.linkedinScorer.getScoringStats(req.userId);

        return res.status(200).json({
            success: true,
            data: stats,
        });

    } catch (error) {
        return handleError(error, res, 'GET /sales-intelligence/linkedin/stats');
    }
});

module.exports = router;

// For documentation
module.exports.SALES_INTELLIGENCE_ENDPOINTS = [
    // Dashboard & Analysis
    'GET    /api/v1/sales-intelligence/dashboard           - Combined intelligence dashboard',
    'POST   /api/v1/sales-intelligence/analyze             - Analyze prospect with all sources',

    // Intent Hunter
    'POST   /api/v1/sales-intelligence/intent/signal       - Record intent signal',
    'POST   /api/v1/sales-intelligence/intent/signals/bulk - Bulk import signals',
    'GET    /api/v1/sales-intelligence/intent/hot-prospects - Get high-intent prospects',
    'GET    /api/v1/sales-intelligence/intent/prospect/:id/timeline - Prospect timeline',

    // ICP Refiner
    'POST   /api/v1/sales-intelligence/icp/deal            - Record deal outcome',
    'GET    /api/v1/sales-intelligence/icp/insights        - Get ICP insights',
    'POST   /api/v1/sales-intelligence/icp/score           - Score prospect against ICP',
    'GET    /api/v1/sales-intelligence/icp/definition      - Get ICP definition',
    'PUT    /api/v1/sales-intelligence/icp/definition      - Save ICP definition',

    // LinkedIn Scorer
    'POST   /api/v1/sales-intelligence/linkedin/score      - Score LinkedIn profile',
    'POST   /api/v1/sales-intelligence/linkedin/score/batch - Batch score profiles',
    'GET    /api/v1/sales-intelligence/linkedin/stats      - Get scoring stats',
];
