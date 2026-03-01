/**
 * Pre-Call Brief PDF Generator
 *
 * Generates a professional one-page PDF from a pre-call brief.
 * Designed to be printed or viewed on tablets before meetings.
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// Puppeteer launch options for Cloud Functions (serverless)
async function getPuppeteerOptions() {
    return {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    };
}

/**
 * Format a date for display
 */
function formatDate(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Get meeting context label
 */
function getMeetingContextLabel(context) {
    const labels = {
        discovery: 'Discovery Call',
        demo: 'Product Demo',
        follow_up: 'Follow-Up',
        proposal: 'Proposal Review',
        negotiation: 'Negotiation',
    };
    return labels[context] || context || 'Meeting';
}

/**
 * Generate HTML for the one-page brief
 */
function generateBriefHtml(briefData) {
    const {
        prospectCompany,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        meetingDate,
        meetingContext,
        briefContent,
    } = briefData;

    // Extract brief content fields
    const {
        companySnapshot = '',
        contactSnapshot = '',
        whyTheyTookMeeting = '',
        suggestedOpener = '',
        talkingPoints = [],
        discoveryQuestions = [],
        objectionPrep = [],
        competitorWatch = [],
        recommendedNextSteps = '',
        doNotMention = [],
        rapportHooks = [],
        industryBridge = {},
        productFocus = {},
    } = briefContent || {};

    // Format objections for display
    const objectionsHtml = objectionPrep.slice(0, 3).map(obj => {
        if (typeof obj === 'string') {
            return `<div class="objection-item"><strong>"${obj}"</strong></div>`;
        }
        return `
            <div class="objection-item">
                <strong>"${obj.objection || obj.concern || ''}"</strong>
                <span class="response">${obj.response || obj.proactiveStrategy || ''}</span>
            </div>
        `;
    }).join('');

    // Format rapport hooks if available
    const rapportHtml = rapportHooks.length > 0 ? `
        <div class="section rapport-section">
            <div class="section-title">Rapport Hooks</div>
            <ul class="compact-list">
                ${rapportHooks.slice(0, 3).map(hook => `<li>${typeof hook === 'string' ? hook : hook.hook || hook.message || ''}</li>`).join('')}
            </ul>
        </div>
    ` : '';

    // Format product focus if available
    const productHtml = productFocus.product ? `
        <div class="product-focus">
            <span class="label">Focus:</span> ${productFocus.product}
            ${productFocus.valueProposition ? `<br><span class="value-prop">${productFocus.valueProposition}</span>` : ''}
        </div>
    ` : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Pre-Call Brief - ${prospectCompany}</title>
    <style>
        @page {
            size: A4;
            margin: 12mm;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 9pt;
            line-height: 1.35;
            color: #1a1a1a;
            background: white;
        }

        .container {
            max-width: 100%;
            padding: 0;
        }

        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 8px;
            border-bottom: 2px solid #3A6746;
            margin-bottom: 10px;
        }

        .company-info h1 {
            font-size: 18pt;
            color: #3A6746;
            margin-bottom: 2px;
        }

        .company-meta {
            font-size: 8pt;
            color: #666;
        }

        .meeting-info {
            text-align: right;
            font-size: 8pt;
        }

        .meeting-type {
            background: #3A6746;
            color: white;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 8pt;
            font-weight: 600;
            display: inline-block;
            margin-bottom: 4px;
        }

        .contact-name {
            font-weight: 600;
            color: #333;
        }

        .contact-title {
            color: #666;
            font-size: 7.5pt;
        }

        /* Main Grid */
        .main-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        .full-width {
            grid-column: 1 / -1;
        }

        /* Sections */
        .section {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 8px 10px;
            margin-bottom: 0;
        }

        .section-title {
            font-size: 8pt;
            font-weight: 700;
            color: #3A6746;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
            padding-bottom: 3px;
            border-bottom: 1px solid #ddd;
        }

        .section-content {
            font-size: 8.5pt;
        }

        /* Opener highlight */
        .opener-section {
            background: linear-gradient(135deg, #3A6746 0%, #4a7856 100%);
            color: white;
        }

        .opener-section .section-title {
            color: #D4A847;
            border-bottom-color: rgba(255,255,255,0.2);
        }

        .opener-text {
            font-size: 10pt;
            font-style: italic;
            line-height: 1.4;
        }

        /* Lists */
        .compact-list {
            list-style: none;
            padding-left: 0;
        }

        .compact-list li {
            padding: 2px 0;
            padding-left: 12px;
            position: relative;
            font-size: 8pt;
        }

        .compact-list li::before {
            content: "\\2022";
            color: #3A6746;
            font-weight: bold;
            position: absolute;
            left: 0;
        }

        .numbered-list {
            list-style: none;
            padding-left: 0;
            counter-reset: item;
        }

        .numbered-list li {
            padding: 2px 0;
            padding-left: 16px;
            position: relative;
            font-size: 8pt;
            counter-increment: item;
        }

        .numbered-list li::before {
            content: counter(item) ".";
            color: #3A6746;
            font-weight: 600;
            position: absolute;
            left: 0;
        }

        /* Objections */
        .objection-item {
            padding: 4px 0;
            border-bottom: 1px dashed #ddd;
            font-size: 8pt;
        }

        .objection-item:last-child {
            border-bottom: none;
        }

        .objection-item .response {
            display: block;
            color: #666;
            font-size: 7.5pt;
            margin-top: 1px;
            padding-left: 8px;
        }

        /* Competitors */
        .competitor-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .competitor-tag {
            background: #fff;
            border: 1px solid #ddd;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 7.5pt;
        }

        /* Do Not Mention */
        .warning-section {
            background: #fff5f5;
            border-left: 3px solid #dc3545;
        }

        .warning-section .section-title {
            color: #dc3545;
        }

        /* Rapport Section */
        .rapport-section {
            background: #f0f7f1;
            border-left: 3px solid #D4A847;
        }

        .rapport-section .section-title {
            color: #D4A847;
        }

        /* Product Focus */
        .product-focus {
            background: #e8f4ea;
            padding: 6px 10px;
            border-radius: 4px;
            margin-top: 6px;
            font-size: 8pt;
        }

        .product-focus .label {
            font-weight: 600;
            color: #3A6746;
        }

        .product-focus .value-prop {
            font-style: italic;
            color: #555;
            font-size: 7.5pt;
        }

        /* Footer */
        .footer {
            margin-top: 10px;
            padding-top: 6px;
            border-top: 1px solid #ddd;
            font-size: 7pt;
            color: #999;
            text-align: center;
        }

        /* Two-column layout for questions and talking points */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        /* Why They Took Meeting */
        .why-meeting {
            font-size: 8.5pt;
            color: #555;
            font-style: italic;
            padding: 4px 8px;
            background: #fffbeb;
            border-left: 3px solid #D4A847;
            margin-bottom: 8px;
        }

        @media print {
            body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="company-info">
                <h1>${prospectCompany}</h1>
                <div class="company-meta">
                    ${prospectIndustry ? `${prospectIndustry}` : ''}
                    ${prospectLocation ? ` &bull; ${prospectLocation}` : ''}
                </div>
            </div>
            <div class="meeting-info">
                <div class="meeting-type">${getMeetingContextLabel(meetingContext)}</div>
                ${contactName ? `<div class="contact-name">${contactName}</div>` : ''}
                ${contactTitle ? `<div class="contact-title">${contactTitle}</div>` : ''}
                ${meetingDate ? `<div style="margin-top:4px;color:#666;">${formatDate(meetingDate)}</div>` : ''}
            </div>
        </div>

        <!-- Why They Took Meeting -->
        ${whyTheyTookMeeting ? `<div class="why-meeting"><strong>Why they're meeting:</strong> ${whyTheyTookMeeting}</div>` : ''}

        <div class="main-grid">
            <!-- Opener (Full Width) -->
            <div class="section opener-section full-width">
                <div class="section-title">Suggested Opener</div>
                <div class="opener-text">"${suggestedOpener}"</div>
                ${productHtml}
            </div>

            <!-- Company Snapshot -->
            <div class="section">
                <div class="section-title">Company Snapshot</div>
                <div class="section-content">${companySnapshot}</div>
            </div>

            <!-- Contact Snapshot -->
            <div class="section">
                <div class="section-title">Contact Snapshot</div>
                <div class="section-content">${contactSnapshot}</div>
            </div>

            <!-- Talking Points -->
            <div class="section">
                <div class="section-title">Talking Points</div>
                <ul class="compact-list">
                    ${talkingPoints.slice(0, 5).map(point => `<li>${point}</li>`).join('')}
                </ul>
            </div>

            <!-- Discovery Questions -->
            <div class="section">
                <div class="section-title">Discovery Questions</div>
                <ol class="numbered-list">
                    ${discoveryQuestions.slice(0, 5).map(q => `<li>${q}</li>`).join('')}
                </ol>
            </div>

            <!-- Rapport Hooks (if available) -->
            ${rapportHtml}

            <!-- Objection Prep -->
            <div class="section ${rapportHtml ? '' : 'full-width'}">
                <div class="section-title">Objection Prep</div>
                ${objectionsHtml || '<div class="section-content">No common objections identified</div>'}
            </div>

            <!-- Competitors & Next Steps Row -->
            <div class="section">
                <div class="section-title">Competitor Watch</div>
                <div class="competitor-tags">
                    ${competitorWatch.slice(0, 4).map(c => `<span class="competitor-tag">${c}</span>`).join('') || '<span style="color:#999;font-size:8pt;">None identified</span>'}
                </div>
            </div>

            <div class="section">
                <div class="section-title">Recommended Next Step</div>
                <div class="section-content">${recommendedNextSteps || 'Schedule follow-up'}</div>
            </div>

            <!-- Do Not Mention (if any) -->
            ${doNotMention.length > 0 ? `
            <div class="section warning-section full-width">
                <div class="section-title">Do Not Mention</div>
                <ul class="compact-list">
                    ${doNotMention.map(item => `<li>${item}</li>`).join('')}
                </ul>
            </div>
            ` : ''}
        </div>

        <div class="footer">
            Generated by PathSynch &bull; ${new Date().toLocaleDateString()}
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Generate PDF from a pre-call brief
 *
 * @param {Object} briefData - The brief document data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateBriefPdf(briefData) {
    let browser = null;

    try {
        const html = generateBriefHtml(briefData);

        const puppeteerOptions = await getPuppeteerOptions();
        browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();

        // Set viewport for A4
        await page.setViewport({
            width: 794, // A4 width at 96 DPI
            height: 1123, // A4 height at 96 DPI
            deviceScaleFactor: 2
        });

        await page.setContent(html, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        // Wait for fonts
        await page.evaluateHandle('document.fonts.ready');
        await new Promise(resolve => setTimeout(resolve, 300));

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0mm',
                right: '0mm',
                bottom: '0mm',
                left: '0mm'
            },
            preferCSSPageSize: true
        });

        return pdfBuffer;

    } catch (error) {
        console.error('[BriefPdfGenerator] Error:', error);
        throw new Error(`PDF generation failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    generateBriefPdf,
    generateBriefHtml,
};
