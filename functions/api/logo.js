/**
 * Logo Extraction API
 *
 * Endpoints for extracting and managing business logos
 *
 * @version 1.0.0
 */

const admin = require('firebase-admin');
const logoExtractor = require('../services/logoExtractor');

const db = admin.firestore();

/**
 * Extract logo from website
 * POST /api/logo/extract
 */
async function extractLogo(req, res) {
    try {
        const { websiteUrl, companyName, saveToProfile } = req.body;
        const userId = req.userId;

        if (!websiteUrl) {
            return res.status(400).json({
                success: false,
                error: 'Website URL is required'
            });
        }

        console.log('Logo extraction request:', { websiteUrl, companyName, userId });

        // Extract logo using tiered approach
        const result = await logoExtractor.extractLogo(websiteUrl, companyName);

        // Optionally save to user's seller profile
        if (saveToProfile && userId && result.success) {
            try {
                await db.collection('users').doc(userId).set({
                    'sellerProfile.branding.logo': result.logoUrl,
                    'sellerProfile.branding.logoSource': result.source,
                    'sellerProfile.branding.logoConfidence': result.confidence,
                    'sellerProfile.branding.logoNeedsReview': result.needsReview,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                result.savedToProfile = true;
            } catch (saveError) {
                console.error('Failed to save logo to profile:', saveError);
                result.savedToProfile = false;
            }
        }

        return res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Logo extraction error:', error);
        return res.status(500).json({
            success: false,
            error: 'Logo extraction failed',
            details: error.message
        });
    }
}

/**
 * Batch extract logos
 * POST /api/logo/batch
 */
async function batchExtract(req, res) {
    try {
        const { websites } = req.body;

        if (!websites || !Array.isArray(websites) || websites.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'websites array is required'
            });
        }

        if (websites.length > 20) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 20 websites per batch'
            });
        }

        console.log('Batch logo extraction:', websites.length, 'websites');

        const results = await logoExtractor.batchExtractLogos(websites);

        const summary = {
            total: results.length,
            successful: results.filter(r => r.success).length,
            needsReview: results.filter(r => r.needsReview).length,
            failed: results.filter(r => !r.success).length
        };

        return res.json({
            success: true,
            summary,
            results
        });

    } catch (error) {
        console.error('Batch extraction error:', error);
        return res.status(500).json({
            success: false,
            error: 'Batch extraction failed',
            details: error.message
        });
    }
}

/**
 * Validate a logo URL
 * GET /api/logo/validate?url=...
 */
async function validateLogo(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'url parameter is required'
            });
        }

        const isValid = await logoExtractor.validateLogoUrl(url);

        return res.json({
            success: true,
            url,
            isValid
        });

    } catch (error) {
        console.error('Logo validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Validation failed',
            details: error.message
        });
    }
}

/**
 * Flag logo for human review
 * POST /api/logo/review
 */
async function flagForReview(req, res) {
    try {
        const { logoUrl, websiteUrl, companyName, reason } = req.body;
        const userId = req.userId;

        if (!logoUrl || !websiteUrl) {
            return res.status(400).json({
                success: false,
                error: 'logoUrl and websiteUrl are required'
            });
        }

        // Store in review queue
        const reviewDoc = {
            logoUrl,
            websiteUrl,
            companyName: companyName || '',
            reason: reason || 'Low confidence',
            flaggedBy: userId,
            flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            reviewedBy: null,
            reviewedAt: null
        };

        await db.collection('logoReviewQueue').add(reviewDoc);

        return res.json({
            success: true,
            message: 'Logo flagged for review'
        });

    } catch (error) {
        console.error('Flag for review error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to flag for review',
            details: error.message
        });
    }
}

module.exports = {
    extractLogo,
    batchExtract,
    validateLogo,
    flagForReview
};
