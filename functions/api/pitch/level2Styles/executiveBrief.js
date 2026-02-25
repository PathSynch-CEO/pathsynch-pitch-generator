/**
 * Executive Brief Style - L2 One-Pager
 *
 * Minimal, high-contrast, no decorative elements. Black text on white,
 * serif or elegant sans-serif typography, generous whitespace.
 * Think McKinsey one-pager. Content is densely informative but visually restrained.
 *
 * @module pitch/level2Styles/executiveBrief
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const { getPalette } = require('./sharedComponents');

const PALETTE = getPalette('executive_brief');

/**
 * Generate Executive Brief style L2 one-pager
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const contactName = inputs.contactName || 'Decision Maker';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const sellerName = options.sellerContext?.name || 'Your Account Executive';

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;

    // Get industry intelligence
    const salesIntel = getIndustryIntelligence(industry, inputs.subIndustry);

    // Format date
    const formattedDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Executive Summary - ${businessName} | ${companyName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        @page {
            margin: 1in;
        }

        body {
            font-family: Georgia, 'Times New Roman', serif;
            background: ${PALETTE.bg};
            color: ${PALETTE.text};
            line-height: 1.7;
            font-size: 14px;
        }

        .container {
            max-width: 720px;
            margin: 0 auto;
            padding: 48px;
            background: white;
            min-height: 100vh;
        }

        /* Header */
        .header {
            border-bottom: 1px solid ${PALETTE.border};
            padding-bottom: 32px;
            margin-bottom: 32px;
        }

        .confidential {
            font-family: Arial, sans-serif;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: ${PALETTE.textLight};
            margin-bottom: 24px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 400;
            color: ${PALETTE.text};
            margin-bottom: 20px;
            letter-spacing: -0.5px;
        }

        .header-meta {
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: ${PALETTE.textLight};
        }

        .header-meta p {
            margin-bottom: 4px;
        }

        .header-meta strong {
            color: ${PALETTE.text};
        }

        /* Sections */
        .section {
            margin-bottom: 28px;
        }

        .section-title {
            font-family: Arial, sans-serif;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: ${PALETTE.textLight};
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid ${PALETTE.border};
        }

        .section p {
            margin-bottom: 12px;
            text-align: justify;
        }

        .section p:last-child {
            margin-bottom: 0;
        }

        /* Impact Section */
        .impact-section {
            background: #f9fafb;
            padding: 24px;
            margin: 28px 0;
            border-left: 3px solid ${PALETTE.text};
        }

        .impact-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .impact-item {
            text-align: center;
        }

        .impact-label {
            font-family: Arial, sans-serif;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: ${PALETTE.textLight};
            margin-bottom: 6px;
        }

        .impact-value {
            font-family: Arial, sans-serif;
            font-size: 24px;
            font-weight: 700;
            color: ${PALETTE.text};
        }

        /* List */
        .exec-list {
            list-style: none;
            padding: 0;
        }

        .exec-list li {
            padding: 8px 0;
            padding-left: 20px;
            position: relative;
        }

        .exec-list li:before {
            content: "•";
            position: absolute;
            left: 0;
            color: ${PALETTE.text};
        }

        /* Next Steps */
        .next-steps {
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid ${PALETTE.border};
        }

        .next-steps ol {
            padding-left: 20px;
        }

        .next-steps li {
            margin-bottom: 8px;
        }

        .next-steps .timeline {
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: ${PALETTE.textLight};
            font-style: italic;
        }

        /* Footer / Contact */
        .footer {
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid ${PALETTE.border};
        }

        .contact-info {
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: ${PALETTE.text};
        }

        .contact-info p {
            margin-bottom: 4px;
        }

        .contact-info a {
            color: ${PALETTE.text};
            text-decoration: none;
        }

        .contact-info a:hover {
            text-decoration: underline;
        }

        /* Print styles */
        @media print {
            body { background: white; }
            .container {
                max-width: 100%;
                padding: 0;
                box-shadow: none;
            }
        }

        @media (max-width: 768px) {
            .container { padding: 32px 24px; }
            .impact-grid { grid-template-columns: 1fr; gap: 16px; }
            .header h1 { font-size: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <p class="confidential">Confidential</p>
            <h1>Executive Summary</h1>
            <div class="header-meta">
                <p>Prepared for <strong>${contactName}</strong></p>
                <p><strong>${businessName}</strong></p>
                <p>${formattedDate}</p>
            </div>
        </div>

        <!-- Situation -->
        <div class="section">
            <div class="section-title">Situation</div>
            <p>${businessName} operates in the ${industry} sector, facing increasing competitive pressure and evolving customer expectations. ${inputs.statedProblem ? `The organization has identified a specific need: ${inputs.statedProblem}.` : 'Current operational challenges present an opportunity for meaningful improvement.'}</p>
            <p>Market dynamics require a strategic response to maintain competitive positioning and drive sustainable growth.</p>
        </div>

        <!-- Recommendation -->
        <div class="section">
            <div class="section-title">Recommendation</div>
            <p>${companyName} proposes a strategic engagement to address the identified challenges through proven methodologies and technology-enabled solutions. Our approach has delivered measurable results for comparable organizations in the ${industry} sector.</p>
            <p>The recommended solution encompasses operational optimization, technology integration, and capability building to achieve sustainable competitive advantage.</p>
        </div>

        <!-- Expected Impact -->
        <div class="impact-section">
            <div class="section-title" style="border: none; padding: 0; margin-bottom: 16px;">Expected Impact</div>
            <div class="impact-grid">
                <div class="impact-item">
                    <div class="impact-label">Financial</div>
                    <div class="impact-value">${formatCurrency(annualImpact)}</div>
                    <div class="impact-label" style="margin-top: 4px; font-weight: 400;">annually</div>
                </div>
                <div class="impact-item">
                    <div class="impact-label">Operational</div>
                    <div class="impact-value">${costReduction}%</div>
                    <div class="impact-label" style="margin-top: 4px; font-weight: 400;">efficiency gain</div>
                </div>
                <div class="impact-item">
                    <div class="impact-label">Timeline</div>
                    <div class="impact-value">${paybackMonths}mo</div>
                    <div class="impact-label" style="margin-top: 4px; font-weight: 400;">to full ROI</div>
                </div>
            </div>
        </div>

        <!-- Strategic Benefits -->
        <div class="section">
            <div class="section-title">Strategic Benefits</div>
            <ul class="exec-list">
                <li><strong>Market Position:</strong> Enhanced competitive differentiation through operational excellence</li>
                <li><strong>Cost Structure:</strong> Sustainable reduction in operational overhead and inefficiencies</li>
                <li><strong>Scalability:</strong> Infrastructure for growth without proportional cost increases</li>
                <li><strong>Risk Mitigation:</strong> Reduced exposure to operational and compliance risks</li>
            </ul>
        </div>

        <!-- Next Steps -->
        <div class="next-steps">
            <div class="section-title">Proposed Next Steps</div>
            <ol>
                <li>
                    Discovery session to validate requirements and scope
                    <span class="timeline">— Week 1</span>
                </li>
                <li>
                    Detailed proposal and implementation roadmap presentation
                    <span class="timeline">— Week 2</span>
                </li>
                <li>
                    Executive alignment and decision
                    <span class="timeline">— Week 3</span>
                </li>
            </ol>
        </div>

        <!-- Footer / Contact -->
        <div class="footer">
            <div class="contact-info">
                <p><strong>${companyName}</strong></p>
                <p>${sellerName}</p>
                <p><a href="mailto:${contactEmail}">${contactEmail}</a></p>
                ${bookingUrl ? `<p><a href="${bookingUrl}">Schedule a Discussion</a></p>` : ''}
            </div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = { generate };
