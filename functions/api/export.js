/**
 * Export API Handlers
 *
 * Handles PPT/PPTX and PDF export for pitches
 * - PPT: Scale tier only (Level 3)
 * - PDF: All tiers (server-side generation for consistency)
 */

const admin = require('firebase-admin');
const { getUserPlanForRequest } = require('../middleware/planGate');
const { hasFeature } = require('../config/stripe');
const pdfGenerator = require('../services/pdfGenerator');
const { canAccessResource } = require('../middleware/workspaceRoleGuard');

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
        const plan = await getUserPlanForRequest(req);

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

        // Verify ownership / workspace access
        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    message: 'Pitch does not belong to your workspace.'
                });
            }
            if (!canAccessResource(req, pitchData.createdByUid)) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    message: 'Contributors can only export their own pitches.'
                });
            }
        } else if (pitchData.userId !== userId && pitchData.userId !== 'anonymous') {
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

        let pptxBuffer;

        // Data Analyst style: use market-intel-powered renderer
        if (pitchData.style === 'data_analyst') {
            const { renderDataAnalystDeck } = require('../services/dataAnalystDeckRenderer');

            // Build pitch object from stored pitch data
            const pitch = {
                inputs: {
                    businessName:  pitchData.businessName,
                    googleRating:  pitchData.googleRating,
                    numReviews:    pitchData.numReviews,
                    industry:      pitchData.industry,
                    city:          pitchData.formData?.city || pitchData.city || '',
                    state:         pitchData.formData?.state || pitchData.state || ''
                },
                analysis:        pitchData.reviewAnalysis || {},
                solutionPackage: pitchData.roiData || null,
                marketContext:   pitchData.marketData || null,
                prospect:        { opportunityScore: pitchData.marketData?.opportunityScore || 0 }
            };

            const sellerProfile = {
                name:  pitchData.formData?.sellerName  || pitchData.formData?.companyName || 'PathSynch',
                email: pitchData.formData?.contactEmail || 'hello@pathsynch.com',
                title: pitchData.formData?.sellerTitle  || 'CEO & Founder, PathSynch Labs'
            };

            // Fetch market report if available
            let marketReport = null;
            if (pitchData.marketReportId) {
                try {
                    const mrSnap = await db.collection('marketReports').doc(pitchData.marketReportId).get();
                    if (mrSnap.exists) marketReport = mrSnap.data()?.data || null;
                } catch (e) {
                    console.warn('[DataAnalystPPTX] Could not fetch market report:', e.message);
                }
            }

            // Backfill opportunityScore from market report leads (not stored on pitch doc)
            if (marketReport) {
                const mrLead = marketReport.leads?.find(l => l.name === pitchData.businessName);
                if (mrLead?.opportunityScore) {
                    pitch.prospect.opportunityScore = mrLead.opportunityScore;
                }
            }

            const result = await renderDataAnalystDeck(pitch, sellerProfile, marketReport);
            pptxBuffer = result.buffer;
        } else {
            // Standard style: use generic pptTemplate
            const PptxGenJS = require('pptxgenjs');
            const pptTemplate = require('../templates/pptTemplate');

            const pptx = new PptxGenJS();
            pptx.author = 'PathSynch';
            pptx.title = `${pitchData.businessName} - Growth Strategy`;
            pptx.subject = 'Customer Engagement & Growth Strategy';
            pptx.company = pitchData.companyName || 'PathSynch';
            pptx.defineLayout({ name: 'LAYOUT_16x9', width: 10, height: 5.625 });
            pptx.layout = 'LAYOUT_16x9';

            const colors = pptTemplate.getColorScheme({
                primaryColor: pitchData.formData?.primaryColor || '#3A6746',
                accentColor:  pitchData.formData?.accentColor  || '#D4A847'
            });
            const slideData = {
                businessName:  pitchData.businessName || 'Business',
                industry:      pitchData.industry     || 'Local Business',
                googleRating:  pitchData.googleRating || 4.0,
                numReviews:    pitchData.numReviews   || 0,
                statedProblem: pitchData.formData?.statedProblem || 'increasing customer engagement and visibility',
                roiData:       pitchData.roiData       || {},
                reviewAnalysis:pitchData.reviewAnalysis || {},
                hideBranding:  pitchData.formData?.hideBranding  || false,
                companyName:   pitchData.formData?.companyName   || 'PathSynch',
                contactEmail:  pitchData.formData?.contactEmail  || 'hello@pathsynch.com',
                bookingUrl:    pitchData.formData?.bookingUrl    || null
            };
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
            pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
        }

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
        const htmlContent = pitchData.html || pitchData.htmlContent || pitchData.content;
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
        const plan = await getUserPlanForRequest(req);
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

/**
 * Check all export format availability for user's plan
 * GET /export/check-all
 */
async function checkAllExports(req, res) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const plan = await getUserPlanForRequest(req);
        const pptxAvailable = hasFeature(plan, 'pptExport');

        return res.status(200).json({
            success: true,
            availability: {
                pdf: true,
                pptx: pptxAvailable,
                googleSlides: pptxAvailable,
                googleDrive: true,
                oneDrive: true
            },
            currentPlan: plan
        });
    } catch (error) {
        console.error('Error checking all export availability:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check export availability'
        });
    }
}

/**
 * Prepare a pitch file for cloud export (signed URL)
 * POST /export/prepare/:pitchId  body: { format: 'pptx' | 'pdf' }
 */
async function prepareCloudExport(req, res) {
    const userId = req.userId;
    const pitchId = req.params.pitchId;
    const format = req.body?.format || 'pdf';

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        const pitchDoc = await db.collection('pitches').doc(pitchId).get();
        if (!pitchDoc.exists) {
            return res.status(404).json({ success: false, error: 'Pitch not found' });
        }

        const pitchData = pitchDoc.data();

        if (req.workspaceId) {
            if (pitchData.workspaceId !== req.workspaceId) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
            if (!canAccessResource(req, pitchData.createdByUid)) {
                return res.status(403).json({ success: false, error: 'Contributors can only export their own pitches' });
            }
        } else if (pitchData.userId !== userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const bucket = admin.storage().bucket();
        const safeName = (pitchData.businessName || 'pitch').replace(/[^a-zA-Z0-9\-_ ]/g, '').substring(0, 50);
        const filename = `${safeName}-${pitchId}.${format}`;
        const storagePath = `exports/${userId}/${filename}`;
        const file = bucket.file(storagePath);
        let buffer;

        if (format === 'pptx') {
            const plan = await getUserPlanForRequest(req);
            if (!hasFeature(plan, 'pptExport')) {
                return res.status(403).json({ success: false, error: 'PPTX export requires Scale plan' });
            }

            if (pitchData.style === 'data_analyst') {
                const { renderDataAnalystDeck } = require('../services/dataAnalystDeckRenderer');
                const pitch = {
                    inputs: { businessName: pitchData.businessName, googleRating: pitchData.googleRating, numReviews: pitchData.numReviews, industry: pitchData.industry, city: pitchData.formData?.city || '', state: pitchData.formData?.state || '' },
                    analysis: pitchData.reviewAnalysis || {},
                    solutionPackage: pitchData.roiData || null,
                    marketContext: pitchData.marketData || null,
                    prospect: { opportunityScore: pitchData.marketData?.opportunityScore || 0 }
                };
                const sellerProfile = { name: pitchData.formData?.sellerName || 'PathSynch', email: pitchData.formData?.contactEmail || 'hello@pathsynch.com', title: pitchData.formData?.sellerTitle || 'CEO & Founder, PathSynch Labs' };
                let marketReport = null;
                if (pitchData.marketReportId) {
                    try { const mrSnap = await db.collection('marketReports').doc(pitchData.marketReportId).get(); if (mrSnap.exists) marketReport = mrSnap.data()?.data || null; } catch (e) { /* non-blocking */ }
                }
                // Backfill opportunityScore from market report leads
                if (marketReport) {
                    const mrLead = marketReport.leads?.find(l => l.name === pitchData.businessName);
                    if (mrLead?.opportunityScore) pitch.prospect.opportunityScore = mrLead.opportunityScore;
                }
                const result = await renderDataAnalystDeck(pitch, sellerProfile, marketReport);
                buffer = result.buffer;
            } else {
            const PptxGenJS = require('pptxgenjs');
            const pptTemplate = require('../templates/pptTemplate');
            const pptx = new PptxGenJS();
            pptx.author = 'PathSynch';
            pptx.title = `${pitchData.businessName} - Growth Strategy`;
            pptx.defineLayout({ name: 'LAYOUT_16x9', width: 10, height: 5.625 });
            pptx.layout = 'LAYOUT_16x9';
            const colors = pptTemplate.getColorScheme({
                primaryColor: pitchData.formData?.primaryColor || '#3A6746',
                accentColor: pitchData.formData?.accentColor || '#D4A847'
            });
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
            buffer = await pptx.write({ outputType: 'nodebuffer' });
            }
            await file.save(buffer, { metadata: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } });
        } else {
            const htmlContent = pitchData.html || pitchData.htmlContent || pitchData.content;
            if (!htmlContent) {
                return res.status(400).json({ success: false, error: 'Pitch has no exportable content' });
            }
            buffer = await pdfGenerator.generatePdfFromHtml(htmlContent, { landscape: true });
            await file.save(buffer, { metadata: { contentType: 'application/pdf' } });
        }

        const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000
        });

        return res.status(200).json({
            success: true,
            signedUrl,
            filename
        });
    } catch (error) {
        console.error('Error preparing cloud export:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to prepare export: ' + error.message
        });
    }
}

module.exports = {
    generatePPT,
    generatePDF,
    checkExportAvailable,
    checkAllExports,
    prepareCloudExport
};
