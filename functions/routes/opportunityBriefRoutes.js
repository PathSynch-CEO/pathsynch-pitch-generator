/**
 * Opportunity Brief Routes
 *
 * Endpoints for the SynchIntro Opportunity Brief feature —
 * a multi-section business case report with dual-model Gemini pipeline,
 * evidence layer, analytics tracking, and shareable links.
 *
 * Endpoints:
 *   POST /opportunity-brief/generate          — Generate (145 credits)
 *   GET  /opportunity-brief/:briefId          — Read (owner-scoped)
 *   POST /opportunity-brief/:briefId/refresh  — Regenerate (145 credits)
 *   POST /opportunity-brief/:briefId/track    — Track analytics event
 *   GET  /opportunity-brief/public/:shareToken — Public read (no auth)
 */

'use strict';

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const { handleError, ApiError } = require('../middleware/errorHandler');
const {
    generateOpportunityBrief,
    refreshOpportunityBrief,
    getOpportunityBrief,
    getOpportunityBriefByToken,
    trackBriefEvent,
} = require('../services/opportunityBriefService');
const { checkAndDeductCredits, refundCredits } = require('../api/billing');

const router = createRouter();
const db = admin.firestore();

const CREDIT_COST = 145;

/**
 * Auth middleware — verifies req.userId is set
 */
function requireAuth(req, res, next) {
    if (!req.userId || req.userId === 'anonymous') {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    next();
}

/**
 * POST /opportunity-brief/generate
 * Body: { prospectName, prospectAddress?, industry, vertical?, market?, state?, reportId?, brandColors? }
 * Auth: required
 * Credits: 145
 */
router.post('/opportunity-brief/generate', requireAuth, async (req, res) => {
    try {
        const { prospectName, prospectAddress, prospectWebsite, industry, vertical, market, state, reportId, brandColors } = req.body;

        if (!prospectName) {
            return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'prospectName is required' } });
        }
        if (!industry) {
            return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'industry is required' } });
        }

        // Atomic credit check + deduct
        const creditResult = await checkAndDeductCredits(
            req.userId, CREDIT_COST, 'opportunity_brief', { service: 'opportunity_brief' }
        );
        if (!creditResult.allowed) {
            if (creditResult.error === 'BILLING_TRANSACTION_FAILED') {
                return res.status(503).json({
                    success: false,
                    error: { code: 'BILLING_UNAVAILABLE', message: 'Billing system temporarily unavailable. Please try again.' },
                });
            }
            return res.status(402).json({
                success: false,
                error: { code: 'INSUFFICIENT_CREDITS', message: `Need ${CREDIT_COST} credits. You have ${creditResult.available}.` },
            });
        }

        let result;
        try {
            result = await generateOpportunityBrief({
                merchantId: req.userId,
                userId: req.userId,
                prospectName,
                prospectAddress: prospectAddress || '',
                prospectWebsite: prospectWebsite || null,
                industry,
                vertical: vertical || null,
                market: market || null,
                state: state || null,
                reportId: reportId || null,
                brandColors: brandColors || null,
            });
        } catch (genErr) {
            // Refund on generation failure — user should not pay for a failed report
            if (creditResult.deducted > 0) {
                await refundCredits(req.userId, CREDIT_COST, 'opportunity_brief:generation_failed', {
                    service: 'opportunity_brief'
                });
            }
            throw genErr;
        }

        return res.status(201).json({ success: true, briefId: result.id, data: result });
    } catch (err) {
        console.error('[OpportunityBrief] Generation failed:', err);
        return res.status(500).json({ success: false, error: { code: 'GENERATION_FAILED', message: err.message } });
    }
});

/**
 * GET /opportunity-brief/public/:shareToken
 * Public endpoint — no auth required
 * Must be registered BEFORE /:briefId to avoid param collision
 */
router.get('/opportunity-brief/public/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const brief = await getOpportunityBriefByToken(shareToken);
        if (!brief) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }

        // Strip sensitive fields for public view
        const { userId: _uid, ...publicBrief } = brief;
        return res.json({ success: true, data: publicBrief });
    } catch (err) {
        console.error('[OpportunityBrief] Public fetch failed:', err);
        return res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
    }
});

/**
 * GET /opportunity-brief/:briefId
 * Auth: required — owner-scoped
 */
router.get('/opportunity-brief/:briefId', requireAuth, async (req, res) => {
    try {
        const brief = await getOpportunityBrief(req.params.briefId, req.userId);
        if (!brief) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
        }
        return res.json({ success: true, data: brief });
    } catch (err) {
        if (err.message === 'Not authorized') {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
        }
        console.error('[OpportunityBrief] Fetch failed:', err);
        return res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
    }
});

/**
 * POST /opportunity-brief/:briefId/refresh
 * Force-regenerate (deducts 145 credits again)
 * Auth: required — owner-scoped
 */
router.post('/opportunity-brief/:briefId/refresh', requireAuth, async (req, res) => {
    try {
        // Atomic credit check + deduct
        const creditResult = await checkAndDeductCredits(
            req.userId, CREDIT_COST, 'opportunity_brief:refresh', { service: 'opportunity_brief' }
        );
        if (!creditResult.allowed) {
            if (creditResult.error === 'BILLING_TRANSACTION_FAILED') {
                return res.status(503).json({
                    success: false,
                    error: { code: 'BILLING_UNAVAILABLE', message: 'Billing system temporarily unavailable. Please try again.' },
                });
            }
            return res.status(402).json({
                success: false,
                error: { code: 'INSUFFICIENT_CREDITS', message: `Need ${CREDIT_COST} credits` },
            });
        }

        let result;
        try {
            result = await refreshOpportunityBrief(req.params.briefId, req.userId);
        } catch (genErr) {
            if (creditResult.deducted > 0) {
                await refundCredits(req.userId, CREDIT_COST, 'opportunity_brief:refresh_failed', {
                    service: 'opportunity_brief'
                });
            }
            throw genErr;
        }

        return res.json({ success: true, briefId: result.id, data: result });
    } catch (err) {
        if (err.message === 'Not authorized') {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
        }
        console.error('[OpportunityBrief] Refresh failed:', err);
        return res.status(500).json({ success: false, error: { code: 'REFRESH_FAILED', message: err.message } });
    }
});

/**
 * POST /opportunity-brief/:briefId/track
 * Analytics event tracking — works for authenticated and anonymous viewers
 * Body: { event, isAnonymous? }
 */
router.post('/opportunity-brief/:briefId/track', async (req, res) => {
    try {
        const { event, isAnonymous } = req.body;
        if (!event) {
            return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'event is required' } });
        }

        await trackBriefEvent(req.params.briefId, event, isAnonymous === true);
        return res.json({ success: true });
    } catch (err) {
        console.error('[OpportunityBrief] Track failed:', err);
        // Non-blocking — return 200 even on failure to avoid breaking viewer
        return res.json({ success: false, error: { code: 'TRACK_FAILED' } });
    }
});

module.exports = router;
