/**
 * Export API Handlers
 *
 * Handles PPT/PPTX and PDF export for pitches
 * - PPT: Scale tier only (Level 3)
 * - PDF: All tiers (server-side generation for consistency)
 */

const admin = require('firebase-admin');
const { getUserPlan } = require('../middleware/planGate');
const { hasFeature } = require('../config/stripe');
const pdfGenerator = require('../services/pdfGenerator');

const db = admin.firestore();

/**
 * Generate PPT file for a Level 3 pitch
 */
async function generatePPT(req, res) {
    const userId = req.userId;
    const pitchId = req.params.pitchId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        // Check if user has PPT export feature
        const plan = await getUserPlan(userId);

        if (!hasFeature(plan, 'pptExport')) {
            return res.status(403).json({
                success: false,
                error: 'Feature not available',
                message: 'PowerPoint export is available on the Scale plan. Please upgrade to download presentations.',
                currentPlan: plan
            });
        }

        // Get pitch data
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Pitch not found'
            });
        }

        const pitchData = pitchDoc.data();

        // Verify ownership
        if (pitchData.userId !== userId && pitchData.userId !== 'anonymous') {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to export this pitch.'
            });
        }

        // Check pitch level - only Level 3 supports PPT
        const pitchLevel = pitchData.pitchLevel || 3;
        if (pitchLevel !== 3) {
            return res.status(400).json({
                success: false,
                error: 'Not supported',
                message: 'PowerPoint export is only available for Level 3 (Enterprise Deck) pitches.'
            });
        }

        // Import pptxgenjs
        const PptxGenJS = require('pptxgenjs');
        const pptTemplate = require('../templates/pptTemplate');

        // Create presentation
        const pptx = new PptxGenJS();

        // Set presentation properties
        pptx.author = 'PathSynch';
        pptx.title = `${pitchData.businessName} - Growth Strategy`;
        pptx.subject = 'Customer Engagement & Growth Strategy';
        pptx.company = pitchData.companyName || 'PathSynch';

        // Define slide size (16:9)
        pptx.defineLayout({ name: 'LAYOUT_16x9', width: 10, height: 5.625 });
        pptx.layout = 'LAYOUT_16x9';

        // Get color scheme
        const colors = pptTemplate.getColorScheme({
            primaryColor: pitchData.formData?.primaryColor || '#3A6746',
            accentColor: pitchData.formData?.accentColor || '#D4A847'
        });

        // Prepare data for slides
        const slideData = {
            businessName: pitchData.businessName || 'Business',
            industry: pitchData.industry || 'Local Business',
            googleRating: pitchData.googleRating || 4.0,
            numReviews: pitchData.numReviews || 0,
            statedProblem: pitchData.formData?.statedProblem || 'increasing customer engagement and visibility',
            roiData: pitchData.roiData || {},
            reviewAnalysis: pitchData.reviewAnalysis || {},
            hideBranding: pitchData.formData?.hideBranding || false,
            companyName: pitchData.formData?.companyName || 'PathSynch',
            contactEmail: pitchData.formData?.contactEmail || 'hello@pathsynch.com',
            bookingUrl: pitchData.formData?.bookingUrl || null
        };

        // Generate all 10 slides
        pptTemplate.createTitleSlide(pptx, slideData, colors);
        pptTemplate.createSentimentSlide(pptx, slideData, colors);
        pptTemplate.createChallengesSlide(pptx, slideData, colors);
        pptTemplate.createSolutionSlide(pptx, slideData, colors);
        pptTemplate.createROISlide(pptx, slideData, colors);
        pptTemplate.createStrategySlide(pptx, slideData, colors);
        pptTemplate.createRolloutSlide(pptx, slideData, colors);
        pptTemplate.createPricingSlide(pptx, slideData, colors);
        pptTemplate.createNextStepsSlide(pptx, slideData, colors);
        pptTemplate.createClosingSlide(pptx, slideData, colors);

        // Generate buffer
        const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

        // Set response headers
        const filename = `${(pitchData.businessName || 'pitch').replace(/[^a-z0-9]/gi, '_')}_pitch.pptx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pptxBuffer.length);

        // Track export event
        try {
            const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
            await analyticsRef.set({
                downloads: admin.firestore.FieldValue.increment(1),
                lastDownloadAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.log('Could not track export:', e.message);
        }

        // Send file
        return res.status(200).send(pptxBuffer);

    } catch (error) {
        console.error('Error generating PPT:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate PowerPoint',
            message: error.message
        });
    }
}

/**
 * Generate PDF file for any pitch (server-side rendering)
 * Available for all plans - consistent output across devices
 */
async function generatePDF(req, res) {
    const pitchId = req.params.pitchId;
    const userId = req.userId || 'anonymous';

    try {
        // Get pitch data
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();

        if (!pitchDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Pitch not found'
            });
        }

        const pitchData = pitchDoc.data();

        // Check access - allow shared pitches or owner access
        const isOwner = pitchData.userId === userId;
        const isShared = pitchData.shared === true;
        const isAnonymous = pitchData.userId === 'anonymous';

        if (!isOwner && !isShared && !isAnonymous) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to export this pitch.'
            });
        }

        // Check if pitch has HTML content
        const htmlContent = pitchData.htmlContent || pitchData.content;
        if (!htmlContent) {
            return res.status(400).json({
                success: false,
                error: 'No content',
                message: 'This pitch does not have exportable content.'
            });
        }

        // Generate PDF
        console.log(`Generating PDF for pitch ${pitchId}`);
        const startTime = Date.now();

        const pdfBuffer = await pdfGenerator.generatePdfFromHtml(htmlContent, {
            landscape: true
        });

        console.log(`PDF generated in ${Date.now() - startTime}ms, size: ${pdfBuffer.length} bytes`);

        // Set response headers
        const businessName = (pitchData.businessName || 'pitch').replace(/[^a-z0-9]/gi, '_');
        const filename = `${businessName}_pitch.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Track export event
        try {
            const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
            await analyticsRef.set({
                pdfDownloads: admin.firestore.FieldValue.increment(1),
                lastPdfDownloadAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.log('Could not track PDF export:', e.message);
        }

        // Send file
        return res.status(200).send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate PDF',
            message: error.message
        });
    }
}

/**
 * Check if PPT export is available for user
 */
async function checkExportAvailable(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const plan = await getUserPlan(userId);
        const available = hasFeature(plan, 'pptExport');

        return res.status(200).json({
            success: true,
            available: available,
            currentPlan: plan,
            message: available
                ? 'PowerPoint export is available for your plan.'
                : 'PowerPoint export requires the Scale plan.'
        });

    } catch (error) {
        console.error('Error checking export availability:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check export availability'
        });
    }
}

module.exports = {
    generatePPT,
    generatePDF,
    checkExportAvailable
};
