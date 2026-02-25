/**
 * Visual Summary Style - L2 One-Pager
 *
 * Infographic-style layout with colored section blocks, icon-paired descriptions,
 * metric cards with large numbers, and a visual flow from problem → solution → proof → action.
 *
 * @module pitch/level2Styles/visualSummary
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');

/**
 * Color palette for Visual Summary style
 */
const PALETTE = {
    primary: '#2563eb',      // Blue
    secondary: '#7c3aed',    // Purple
    accent: '#06b6d4',       // Cyan
    bg: '#f8fafc',           // Light gray
    text: '#1e293b',         // Dark slate
    textLight: '#64748b',    // Slate
    success: '#10b981',      // Green
    white: '#ffffff'
};

/**
 * Generate Visual Summary style L2 one-pager
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;

    // Get industry intelligence
    const salesIntel = getIndustryIntelligence(industry, inputs.subIndustry);

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;

    // Review data
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality Service', 'Friendly Staff', 'Great Value'];

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Visual Summary | ${companyName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: ${PALETTE.bg};
            color: ${PALETTE.text};
            line-height: 1.6;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 24px;
        }

        /* Header */
        .header {
            background: linear-gradient(135deg, ${PALETTE.primary} 0%, ${PALETTE.secondary} 100%);
            color: white;
            padding: 32px;
            border-radius: 16px;
            margin-bottom: 24px;
            text-align: center;
        }

        .header-badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 16px;
        }

        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .header p {
            font-size: 16px;
            opacity: 0.9;
        }

        /* Hero Metric */
        .hero-metric {
            background: ${PALETTE.white};
            border-radius: 16px;
            padding: 32px;
            text-align: center;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .hero-metric-value {
            font-size: 48px;
            font-weight: 800;
            color: ${PALETTE.primary};
            line-height: 1;
        }

        .hero-metric-label {
            font-size: 16px;
            color: ${PALETTE.textLight};
            margin-top: 8px;
        }

        /* Two Column Grid */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
        }

        .card {
            background: ${PALETTE.white};
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .card-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            margin-bottom: 16px;
        }

        .card-icon.challenge { background: #fef2f2; }
        .card-icon.solution { background: #ecfdf5; }

        .card h3 {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: ${PALETTE.textLight};
        }

        .card p {
            font-size: 15px;
            color: ${PALETTE.text};
        }

        .card ul {
            list-style: none;
            margin-top: 12px;
        }

        .card ul li {
            padding: 8px 0;
            border-bottom: 1px solid #f1f5f9;
            font-size: 14px;
        }

        .card ul li:last-child {
            border-bottom: none;
        }

        /* Metrics Row */
        .metrics-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 24px;
        }

        .metric-card {
            background: ${PALETTE.white};
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .metric-value {
            font-size: 28px;
            font-weight: 700;
            color: ${PALETTE.primary};
        }

        .metric-label {
            font-size: 12px;
            color: ${PALETTE.textLight};
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        /* Why Now Section */
        .why-now {
            background: linear-gradient(135deg, ${PALETTE.accent} 0%, ${PALETTE.primary} 100%);
            color: white;
            border-radius: 12px;
            padding: 24px 32px;
            margin-bottom: 24px;
        }

        .why-now h3 {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            opacity: 0.9;
        }

        .why-now p {
            font-size: 16px;
            line-height: 1.6;
        }

        /* CTA Section */
        .cta-section {
            background: ${PALETTE.white};
            border-radius: 16px;
            padding: 32px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .cta-section h3 {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 12px;
        }

        .cta-section p {
            color: ${PALETTE.textLight};
            margin-bottom: 20px;
        }

        .cta-button {
            display: inline-block;
            background: ${PALETTE.primary};
            color: white;
            padding: 14px 32px;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
        }

        .cta-button:hover {
            background: #1d4ed8;
            transform: translateY(-2px);
        }

        /* Footer */
        .footer {
            text-align: center;
            padding: 24px;
            color: ${PALETTE.textLight};
            font-size: 13px;
        }

        @media print {
            body { background: white; }
            .container { max-width: 100%; }
        }

        @media (max-width: 768px) {
            .two-col { grid-template-columns: 1fr; }
            .metrics-row { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <span class="header-badge">Opportunity Brief</span>
            <h1>${businessName}</h1>
            <p>Prepared by ${companyName}</p>
        </div>

        <!-- Hero Metric -->
        <div class="hero-metric">
            <div class="hero-metric-value">${formatCurrency(annualImpact)}</div>
            <div class="hero-metric-label">Estimated Annual Impact</div>
        </div>

        <!-- Challenge & Solution -->
        <div class="two-col">
            <div class="card">
                <div class="card-icon challenge">⚠️</div>
                <h3>The Challenge</h3>
                <p>${inputs.statedProblem || 'Businesses like yours face increasing competition and changing customer expectations.'}</p>
                <ul>
                    ${salesIntel.painPoints?.slice(0, 3).map(p => `<li>• ${p}</li>`).join('') || '<li>• Increasing customer acquisition costs</li><li>• Difficulty standing out</li><li>• Time-consuming manual processes</li>'}
                </ul>
            </div>
            <div class="card">
                <div class="card-icon solution">✓</div>
                <h3>The Solution</h3>
                <p>${companyName} provides the tools and strategies you need to overcome these challenges.</p>
                <ul>
                    ${salesIntel.products?.slice(0, 3).map(p => `<li>• ${p.name}</li>`).join('') || '<li>• Automated customer engagement</li><li>• Data-driven insights</li><li>• Streamlined operations</li>'}
                </ul>
            </div>
        </div>

        <!-- Metrics Row -->
        <div class="metrics-row">
            <div class="metric-card">
                <div class="metric-value">${costReduction}%</div>
                <div class="metric-label">Cost Reduction</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${paybackMonths}mo</div>
                <div class="metric-label">Payback Period</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${sentiment.positive}%</div>
                <div class="metric-label">Positive Reviews</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${inputs.googleRating || '4.5'}</div>
                <div class="metric-label">Google Rating</div>
            </div>
        </div>

        <!-- Why Now -->
        <div class="why-now">
            <h3>Why Now?</h3>
            <p>${inputs.triggerEvent?.summary || `The ${industry} market is evolving rapidly. Early adopters are seeing significant competitive advantages. Don't let your competitors get ahead.`}</p>
        </div>

        <!-- CTA Section -->
        <div class="cta-section">
            <h3>Ready to Transform Your Business?</h3>
            <p>Let's discuss how we can help ${businessName} achieve these results.</p>
            <a href="${ctaUrl}" class="cta-button">${bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
        </div>

        <!-- Footer -->
        <div class="footer">
            Prepared by ${companyName} | ${new Date().toLocaleDateString()}
        </div>
    </div>
</body>
</html>`;
}

module.exports = { generate };
