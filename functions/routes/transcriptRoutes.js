/**
 * Transcript Routes
 *
 * Handles transcript parsing and meeting data extraction for Leave-Behind one-pagers
 */

const admin = require('firebase-admin');
const { createRouter } = require('../utils/router');
const transcriptParser = require('../services/transcriptParser');
const { handleError, ApiError, ErrorCodes } = require('../middleware/errorHandler');

const router = createRouter();
const db = admin.firestore();

// ============================================
// ROUTES
// ============================================

/**
 * POST /transcript/parse
 * Parse a transcript and detect its format
 * Returns parsed entries without AI analysis (quick operation)
 */
router.post('/transcript/parse', async (req, res) => {
    try {
        const { content, format } = req.body;

        if (!content || typeof content !== 'string') {
            throw new ApiError(
                'Transcript content is required',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        if (content.length > 500000) {
            throw new ApiError(
                'Transcript too large. Maximum size is 500KB.',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        const result = transcriptParser.parseTranscript(content, format);

        return res.status(200).json({
            success: true,
            data: {
                format: result.format,
                speakerCount: result.speakerCount,
                entryCount: result.entryCount,
                preview: result.plainText.substring(0, 500) + (result.plainText.length > 500 ? '...' : '')
            }
        });
    } catch (error) {
        return handleError(error, res, 'POST /transcript/parse');
    }
});

/**
 * POST /transcript/summary
 * Get a quick summary of the transcript (fast AI call)
 */
router.post('/transcript/summary', async (req, res) => {
    try {
        const { content } = req.body;

        if (!content || typeof content !== 'string') {
            throw new ApiError(
                'Transcript content is required',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        if (content.length > 500000) {
            throw new ApiError(
                'Transcript too large. Maximum size is 500KB.',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        const result = await transcriptParser.getQuickSummary(content);

        if (!result.success) {
            throw new ApiError(
                result.error || 'Failed to generate summary',
                500,
                ErrorCodes.EXTERNAL_API_ERROR
            );
        }

        return res.status(200).json({
            success: true,
            data: result.summary,
            format: result.format
        });
    } catch (error) {
        return handleError(error, res, 'POST /transcript/summary');
    }
});

/**
 * POST /transcript/extract
 * Extract full meeting data from transcript using AI
 * This is the main extraction endpoint for Leave-Behind generation
 */
router.post('/transcript/extract', async (req, res) => {
    try {
        const userId = req.userId;

        if (!userId) {
            throw new ApiError(
                'Authentication required',
                401,
                ErrorCodes.UNAUTHORIZED
            );
        }

        const { content, context } = req.body;

        if (!content || typeof content !== 'string') {
            throw new ApiError(
                'Transcript content is required',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        if (content.length > 500000) {
            throw new ApiError(
                'Transcript too large. Maximum size is 500KB.',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        // Check user tier - transcript extraction requires Growth+
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const tier = userData.tier || 'starter';

        if (tier === 'starter') {
            throw new ApiError(
                'Transcript extraction requires Growth plan or higher',
                403,
                ErrorCodes.FORBIDDEN
            );
        }

        // Extract meeting data using AI
        const result = await transcriptParser.extractMeetingData(content, {
            sellerName: context?.sellerName,
            prospectCompany: context?.prospectCompany,
            meetingDate: context?.meetingDate
        });

        if (!result.success) {
            throw new ApiError(
                result.error || 'Failed to extract meeting data',
                500,
                ErrorCodes.EXTERNAL_API_ERROR
            );
        }

        // Log extraction for analytics
        await db.collection('transcriptExtractions').add({
            userId,
            format: result.metadata.format,
            speakerCount: result.metadata.speakerCount,
            entryCount: result.metadata.entryCount,
            tokensUsed: result.metadata.tokensUsed,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.error('Failed to log extraction:', err.message));

        return res.status(200).json({
            success: true,
            data: result.data,
            metadata: result.metadata
        });
    } catch (error) {
        return handleError(error, res, 'POST /transcript/extract');
    }
});

/**
 * POST /transcript/leave-behind
 * Generate leave-behind content from extracted meeting data
 */
router.post('/transcript/leave-behind', async (req, res) => {
    try {
        const userId = req.userId;

        if (!userId) {
            throw new ApiError(
                'Authentication required',
                401,
                ErrorCodes.UNAUTHORIZED
            );
        }

        const { meetingData } = req.body;

        if (!meetingData || typeof meetingData !== 'object') {
            throw new ApiError(
                'Meeting data is required',
                400,
                ErrorCodes.VALIDATION_ERROR
            );
        }

        // Check user tier
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const tier = userData.tier || 'starter';

        if (tier === 'starter') {
            throw new ApiError(
                'Leave-behind generation requires Growth plan or higher',
                403,
                ErrorCodes.FORBIDDEN
            );
        }

        // Get seller profile for context
        const sellerProfile = userData.sellerProfile || {};

        // Generate leave-behind content
        const result = await transcriptParser.generateLeaveBeindContent(meetingData, sellerProfile);

        if (!result.success) {
            throw new ApiError(
                result.error || 'Failed to generate leave-behind content',
                500,
                ErrorCodes.EXTERNAL_API_ERROR
            );
        }

        return res.status(200).json({
            success: true,
            data: result.content,
            tokensUsed: result.tokensUsed
        });
    } catch (error) {
        return handleError(error, res, 'POST /transcript/leave-behind');
    }
});

/**
 * GET /transcript/formats
 * Get list of supported transcript formats
 */
router.get('/transcript/formats', async (req, res) => {
    try {
        const formats = Object.entries(transcriptParser.TRANSCRIPT_FORMATS).map(([key, format]) => ({
            id: key,
            extension: format.extension,
            platforms: format.platforms
        }));

        return res.status(200).json({
            success: true,
            data: formats
        });
    } catch (error) {
        return handleError(error, res, 'GET /transcript/formats');
    }
});

module.exports = router;
