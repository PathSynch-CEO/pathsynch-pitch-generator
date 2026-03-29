/**
 * Cloud Export Service
 *
 * Generates export files (PDF/PPTX), uploads to Firebase Storage,
 * and returns short-lived signed URLs for download.
 */

const admin = require('firebase-admin');
const pdfGenerator = require('./pdfGenerator');

/**
 * Generate a file, upload to GCS, and return a 1-hour signed URL
 * @param {Object} options
 * @param {string} options.userId - Owner's UID
 * @param {string} options.pitchId - Pitch document ID
 * @param {Object} options.pitchData - Firestore pitch document data
 * @param {'pdf'|'pptx'} options.format - Desired export format
 * @returns {Promise<{signedUrl: string, filename: string, contentType: string}>}
 */
async function prepareExport({ userId, pitchId, pitchData, format }) {
    // Generate file buffer
    let buffer;
    let contentType;
    let ext;

    if (format === 'pptx') {
        const { buildPptxBuffer } = require('../api/export');
        buffer = await buildPptxBuffer(pitchData);
        contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        ext = 'pptx';
    } else {
        // Default to PDF
        const htmlContent = pitchData.htmlContent || pitchData.content;
        if (!htmlContent) {
            throw new Error('Pitch has no exportable HTML content');
        }
        buffer = await pdfGenerator.generatePdfFromHtml(htmlContent, { landscape: true });
        contentType = 'application/pdf';
        ext = 'pdf';
    }

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const safeName = (pitchData.businessName || 'pitch').replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeName}_pitch.${ext}`;
    const storagePath = `exports/${userId}/${pitchId}/${timestamp}.${ext}`;

    const file = bucket.file(storagePath);
    await file.save(buffer, {
        metadata: { contentType },
        resumable: false
    });

    // Generate signed URL (1 hour)
    const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    return { signedUrl, filename, contentType };
}

module.exports = { prepareExport };
