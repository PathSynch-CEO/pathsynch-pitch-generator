/**
 * PDF Generator Service
 *
 * Server-side PDF generation using Puppeteer for consistent formatting
 * across all devices and browsers.
 *
 * Benefits:
 * - Consistent output regardless of client browser
 * - High-quality print-ready PDFs
 * - Full control over layout and styling
 * - Works on all devices including mobile
 */

const puppeteer = require('puppeteer');

// Puppeteer launch options optimized for Cloud Functions
const PUPPETEER_OPTIONS = {
    headless: 'new',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process'
    ]
};

// PDF generation options
const PDF_OPTIONS = {
    format: 'A4',
    landscape: true, // Slides are 16:9 landscape
    printBackground: true,
    margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
    },
    preferCSSPageSize: true
};

/**
 * Prepare HTML for PDF rendering
 * Adds print-specific styles for consistent output
 *
 * @param {string} htmlContent - The pitch HTML content
 * @returns {string} Modified HTML optimized for PDF
 */
function preparePdfHtml(htmlContent) {
    // Insert PDF-specific print styles
    const printStyles = `
        <style id="pdf-print-styles">
            @page {
                size: 960px 540px;
                margin: 0;
            }
            @media print {
                body {
                    background: white !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                .slide {
                    page-break-after: always;
                    page-break-inside: avoid;
                    margin: 0 !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                    width: 960px !important;
                    height: 540px !important;
                    min-height: 540px !important;
                    max-height: 540px !important;
                }
                .slide:last-child {
                    page-break-after: auto;
                }
                /* Hide navigation elements if any */
                .navigation,
                .nav-buttons,
                .slide-nav,
                .download-btn,
                .share-btn {
                    display: none !important;
                }
                /* Ensure backgrounds print */
                .title-slide,
                .cta-slide,
                [style*="background"] {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                /* Fix gradient backgrounds */
                .title-slide,
                .cta-slide {
                    background: var(--color-primary) !important;
                }
            }
        </style>
    `;

    // Insert before closing </head> tag
    if (htmlContent.includes('</head>')) {
        return htmlContent.replace('</head>', printStyles + '</head>');
    }

    // Fallback: prepend styles
    return printStyles + htmlContent;
}

/**
 * Generate PDF from pitch HTML content
 *
 * @param {string} htmlContent - The complete HTML of the pitch
 * @param {Object} options - Generation options
 * @param {string} options.format - PDF format (default: 'A4')
 * @param {boolean} options.landscape - Landscape orientation (default: true)
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generatePdfFromHtml(htmlContent, options = {}) {
    let browser = null;

    try {
        // Prepare HTML with print styles
        const pdfHtml = preparePdfHtml(htmlContent);

        // Launch browser
        browser = await puppeteer.launch(PUPPETEER_OPTIONS);
        const page = await browser.newPage();

        // Set viewport to match slide dimensions
        await page.setViewport({
            width: 960,
            height: 540,
            deviceScaleFactor: 2 // Higher quality
        });

        // Load HTML content
        await page.setContent(pdfHtml, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        // Wait for any custom fonts to load
        await page.evaluateHandle('document.fonts.ready');

        // Small delay for rendering
        await new Promise(resolve => setTimeout(resolve, 500));

        // Generate PDF
        const pdfOptions = {
            ...PDF_OPTIONS,
            format: options.format || PDF_OPTIONS.format,
            landscape: options.landscape !== undefined ? options.landscape : PDF_OPTIONS.landscape
        };

        const pdfBuffer = await page.pdf(pdfOptions);

        return pdfBuffer;

    } catch (error) {
        console.error('PDF generation error:', error);
        throw new Error(`PDF generation failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Generate PDF from a pitch document stored in Firestore
 *
 * @param {Object} pitchData - The pitch document data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generatePdfFromPitch(pitchData) {
    const htmlContent = pitchData.htmlContent || pitchData.content;

    if (!htmlContent) {
        throw new Error('Pitch does not contain HTML content');
    }

    return generatePdfFromHtml(htmlContent, {
        landscape: true
    });
}

/**
 * Generate a simple styled PDF from content
 * Used for market reports and other documents
 *
 * @param {Object} content - Content object
 * @param {string} content.title - Document title
 * @param {string} content.body - HTML body content
 * @param {Object} options - Styling options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateStyledPdf(content, options = {}) {
    const primaryColor = options.primaryColor || '#3A6746';
    const accentColor = options.accentColor || '#D4A847';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${content.title || 'Document'}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #333;
            line-height: 1.6;
            padding: 40px;
        }
        h1 {
            color: ${primaryColor};
            font-size: 28px;
            margin-bottom: 24px;
            padding-bottom: 12px;
            border-bottom: 3px solid ${accentColor};
        }
        h2 {
            color: ${primaryColor};
            font-size: 20px;
            margin: 24px 0 12px;
        }
        h3 {
            color: #555;
            font-size: 16px;
            margin: 16px 0 8px;
        }
        p { margin-bottom: 12px; }
        ul, ol {
            margin: 12px 0 12px 24px;
        }
        li { margin-bottom: 6px; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
        }
        th, td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
        }
        th {
            background: ${primaryColor};
            color: white;
        }
        .highlight {
            background: ${accentColor}20;
            padding: 16px;
            border-left: 4px solid ${accentColor};
            margin: 16px 0;
        }
        @page {
            margin: 20mm;
        }
        @media print {
            body { padding: 0; }
        }
    </style>
</head>
<body>
    <h1>${content.title || 'Document'}</h1>
    ${content.body || ''}
</body>
</html>`;

    return generatePdfFromHtml(html, {
        format: 'A4',
        landscape: false
    });
}

module.exports = {
    generatePdfFromHtml,
    generatePdfFromPitch,
    generateStyledPdf,
    preparePdfHtml
};
