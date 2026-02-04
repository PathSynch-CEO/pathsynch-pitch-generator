/**
 * Feedback API Handlers
 *
 * Endpoints for user feedback collection and retrieval
 */

const feedbackService = require('../services/feedbackService');
const { isFeatureEnabled } = require('../config/gemini');

/**
 * POST /api/v1/feedback
 * Submit feedback for a pitch/narrative
 */
async function submitFeedback(req, res) {
    const userId = req.userId;

    // Check if feedback is enabled
    if (!isFeatureEnabled('enableFeedback')) {
        return res.status(503).json({
            success: false,
            error: 'Feedback collection is currently disabled',
            message: 'Please try again later'
        });
    }

    try {
        const {
            pitchId,
            narrativeId,
            assetType,
            rating,
            feedbackType,
            category,
            comment,
            issues,
            modelUsed,
            abTestVariant
        } = req.body;

        // Validate required fields
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Invalid rating',
                message: 'Rating must be a number between 1 and 5'
            });
        }

        if (!pitchId && !narrativeId) {
            return res.status(400).json({
                success: false,
                error: 'Missing identifier',
                message: 'Either pitchId or narrativeId is required'
            });
        }

        const feedback = await feedbackService.submitFeedback({
            userId,
            pitchId,
            narrativeId,
            assetType,
            rating,
            feedbackType,
            category,
            comment,
            issues,
            modelUsed,
            abTestVariant
        });

        return res.status(201).json({
            success: true,
            message: 'Feedback submitted successfully',
            data: {
                feedbackId: feedback.feedbackId
            }
        });

    } catch (error) {
        console.error('Error submitting feedback:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to submit feedback',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/feedback/my
 * Get current user's feedback history
 */
async function getMyFeedback(req, res) {
    const userId = req.userId;

    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const offset = parseInt(req.query.offset, 10) || 0;
        const feedbackType = req.query.type;

        const result = await feedbackService.getUserFeedback(userId, {
            limit,
            offset,
            feedbackType
        });

        return res.status(200).json({
            success: true,
            data: result.feedback,
            pagination: {
                limit,
                offset,
                hasMore: result.hasMore
            }
        });

    } catch (error) {
        console.error('Error getting user feedback:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get feedback',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/feedback/:id
 * Get a specific feedback entry
 */
async function getFeedback(req, res) {
    const userId = req.userId;
    const feedbackId = req.params.id;

    try {
        const feedback = await feedbackService.getFeedback(feedbackId);

        if (!feedback) {
            return res.status(404).json({
                success: false,
                error: 'Feedback not found'
            });
        }

        // Check ownership
        if (feedback.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        return res.status(200).json({
            success: true,
            data: feedback
        });

    } catch (error) {
        console.error('Error getting feedback:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get feedback',
            message: error.message
        });
    }
}

/**
 * GET /api/v1/feedback/pitch/:pitchId
 * Get all feedback for a specific pitch (owner only)
 */
async function getPitchFeedback(req, res) {
    const userId = req.userId;
    const pitchId = req.params.pitchId;

    try {
        // Note: Should verify pitch ownership here
        const feedback = await feedbackService.getPitchFeedback(pitchId);

        // Filter to only show user's own feedback unless admin
        const filteredFeedback = feedback.filter(f => f.userId === userId);

        return res.status(200).json({
            success: true,
            data: filteredFeedback
        });

    } catch (error) {
        console.error('Error getting pitch feedback:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get pitch feedback',
            message: error.message
        });
    }
}

/**
 * Feedback type and category enums for client reference
 */
function getFeedbackOptions(req, res) {
    return res.status(200).json({
        success: true,
        data: {
            feedbackTypes: Object.values(feedbackService.FeedbackType),
            categories: Object.values(feedbackService.FeedbackCategory),
            issueTypes: Object.values(feedbackService.IssueType)
        }
    });
}

module.exports = {
    submitFeedback,
    getMyFeedback,
    getFeedback,
    getPitchFeedback,
    getFeedbackOptions
};
