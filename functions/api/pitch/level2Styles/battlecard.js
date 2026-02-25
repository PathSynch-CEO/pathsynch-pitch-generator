/**
 * Competitive Battlecard Style - L2 One-Pager
 *
 * Side-by-side comparison grid layout.
 * Left column = prospect's current approach/competitors
 * Right column = seller's offering
 * Row-by-row comparison across key dimensions.
 *
 * @module pitch/level2Styles/battlecard
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const { getPalette, icon, ctaBlock, card } = require('./sharedComponents');

const PALETTE = getPalette('battlecard');

/**
 * Build a comparison row
 */
function buildComparisonRow(category, theirValue, ourValue, options = {}) {
    const { highlight = false, advantage = 'neutral' } = options;
    const bgColor = highlight ? '#f0fdf4' : 'transparent';
    const ourColor = advantage === 'high' ? PALETTE.ourColor : PALETTE.text;

    return `
        <tr style="background: ${bgColor};">
            <td style="padding: 16px 20px; font-weight: 600; border-bottom: 1px solid #e5e7eb; width: 30%;">${category}</td>
            <td style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; color: ${PALETTE.theirColor}; width: 35%;">${theirValue}</td>
            <td style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; color: ${ourColor}; font-weight: ${advantage === 'high' ? '600' : '400'}; width: 35%;">
                ${advantage === 'high' ? `<span style="color: ${PALETTE.ourColor};">✓</span> ` : ''}${ourValue}
            </td>
        </tr>
    `;
}

/**
 * Generate comparison rows based on industry
 */
function generateComparisonRows(inputs, salesIntel, roiData) {
    const rows = [];

    // Speed/Efficiency
    rows.push({
        category: 'Speed',
        theirValue: 'Manual processes, days to complete',
        ourValue: 'Automated, real-time results',
        advantage: 'high'
    });

    // Accuracy
    rows.push({
        category: 'Accuracy',
        theirValue: '85-92% with human error',
        ourValue: '98%+ AI-verified accuracy',
        advantage: 'high'
    });

    // Cost
    const costSavings = roiData?.costReduction || 30;
    rows.push({
        category: 'Cost',
        theirValue: 'High labor costs, inefficiencies',
        ourValue: `${costSavings}% cost reduction`,
        advantage: 'high'
    });

    // Scalability
    rows.push({
        category: 'Scalability',
        theirValue: 'Limited by headcount',
        ourValue: 'Unlimited scale, same cost',
        advantage: 'high'
    });

    // Support
    rows.push({
        category: 'Support',
        theirValue: 'Business hours only',
        ourValue: '24/7 dedicated support',
        advantage: 'high'
    });

    // Integration
    rows.push({
        category: 'Integration',
        theirValue: 'Standalone, manual data entry',
        ourValue: 'Seamless API integrations',
        advantage: 'high'
    });

    return rows;
}

/**
 * Generate Battlecard style L2 one-pager
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

    // Generate comparison data
    const comparisonRows = generateComparisonRows(inputs, salesIntel, roiData);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Competitive Battlecard | ${companyName}</title>
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
            padding: 32px;
        }

        /* Header */
        .header {
            background: ${PALETTE.primary};
            color: white;
            padding: 32px;
            border-radius: 12px 12px 0 0;
        }

        .header-badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .header p {
            font-size: 14px;
            opacity: 0.9;
        }

        /* Comparison Table */
        .comparison-section {
            background: white;
            border-radius: 0 0 12px 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            margin-bottom: 24px;
        }

        .comparison-table {
            width: 100%;
            border-collapse: collapse;
        }

        .comparison-table thead {
            background: #f8fafc;
        }

        .comparison-table th {
            padding: 16px 20px;
            text-align: left;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #e5e7eb;
        }

        .comparison-table th.their-col {
            color: ${PALETTE.theirColor};
        }

        .comparison-table th.our-col {
            color: ${PALETTE.ourColor};
        }

        /* Bottom Line */
        .bottom-line {
            background: linear-gradient(135deg, ${PALETTE.ourColor} 0%, #059669 100%);
            color: white;
            padding: 28px 32px;
            border-radius: 12px;
            margin-bottom: 24px;
        }

        .bottom-line h3 {
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.9;
            margin-bottom: 8px;
        }

        .bottom-line .headline {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .bottom-line p {
            font-size: 15px;
            opacity: 0.9;
        }

        /* Proof Section */
        .proof-section {
            background: white;
            padding: 24px 32px;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
            margin-bottom: 24px;
        }

        .proof-section h4 {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: ${PALETTE.textLight};
            margin-bottom: 16px;
        }

        .proof-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
        }

        .proof-item {
            text-align: center;
        }

        .proof-value {
            font-size: 32px;
            font-weight: 700;
            color: ${PALETTE.primary};
        }

        .proof-label {
            font-size: 12px;
            color: ${PALETTE.textLight};
            margin-top: 4px;
        }

        /* CTA Section */
        .cta-section {
            background: ${PALETTE.primary};
            color: white;
            padding: 32px;
            border-radius: 12px;
            text-align: center;
        }

        .cta-section h3 {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .cta-section p {
            font-size: 14px;
            opacity: 0.9;
            margin-bottom: 20px;
        }

        .cta-button {
            display: inline-block;
            background: white;
            color: ${PALETTE.primary};
            padding: 12px 28px;
            border-radius: 6px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
        }

        .cta-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        /* Footer */
        .footer {
            text-align: center;
            padding: 24px;
            color: ${PALETTE.textLight};
            font-size: 12px;
        }

        @media print {
            body { background: white; }
            .container { max-width: 100%; padding: 20px; }
            .comparison-section, .proof-section { box-shadow: none; border: 1px solid #e5e7eb; }
        }

        @media (max-width: 768px) {
            .container { padding: 16px; }
            .header, .bottom-line, .cta-section { padding: 24px; }
            .proof-grid { grid-template-columns: 1fr; }
            .comparison-table th, .comparison-table td { padding: 12px; font-size: 13px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <span class="header-badge">Competitive Analysis</span>
            <h1>${companyName} vs. Current State</h1>
            <p>Prepared for ${businessName}</p>
        </div>

        <!-- Comparison Table -->
        <div class="comparison-section">
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Dimension</th>
                        <th class="their-col">Current Approach</th>
                        <th class="our-col">${companyName}</th>
                    </tr>
                </thead>
                <tbody>
                    ${comparisonRows.map((row, i) => buildComparisonRow(
                        row.category,
                        row.theirValue,
                        row.ourValue,
                        { highlight: i % 2 === 0, advantage: row.advantage }
                    )).join('')}
                </tbody>
            </table>
        </div>

        <!-- Bottom Line ROI -->
        <div class="bottom-line">
            <h3>The Bottom Line</h3>
            <div class="headline">${formatCurrency(annualImpact)} Annual Impact</div>
            <p>Based on ${costReduction}% cost reduction and operational efficiency gains. ROI typically achieved within ${paybackMonths} months.</p>
        </div>

        <!-- Proof Points -->
        <div class="proof-section">
            <h4>Proven Results</h4>
            <div class="proof-grid">
                <div class="proof-item">
                    <div class="proof-value">98%</div>
                    <div class="proof-label">Customer Satisfaction</div>
                </div>
                <div class="proof-item">
                    <div class="proof-value">${paybackMonths}mo</div>
                    <div class="proof-label">Avg. Payback Period</div>
                </div>
                <div class="proof-item">
                    <div class="proof-value">24/7</div>
                    <div class="proof-label">Support Coverage</div>
                </div>
            </div>
        </div>

        <!-- CTA -->
        <div class="cta-section">
            <h3>Ready to Make the Switch?</h3>
            <p>See how ${companyName} can transform ${businessName}'s operations.</p>
            <a href="${ctaUrl}" class="cta-button">${bookingUrl ? 'Book a Demo' : 'Get Started'}</a>
        </div>

        <!-- Footer -->
        <div class="footer">
            ${companyName} | Competitive Analysis for ${businessName} | ${new Date().toLocaleDateString()}
        </div>
    </div>
</body>
</html>`;
}

module.exports = { generate };
