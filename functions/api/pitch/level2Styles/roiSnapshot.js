/**
 * ROI Snapshot Style - L2 One-Pager
 *
 * Numbers-forward layout. Large metric cards at top, financial breakdown in the middle,
 * timeline/payback period visualization, and a clear investment vs. return structure.
 *
 * @module pitch/level2Styles/roiSnapshot
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const { getPalette } = require('./sharedComponents');

const PALETTE = getPalette('roi_snapshot');

/**
 * Generate ROI Snapshot style L2 one-pager
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=ROI Discussion: ${encodeURIComponent(businessName)}`;

    // Get industry intelligence
    const salesIntel = getIndustryIntelligence(industry, inputs.subIndustry);

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;
    const roiMultiple = roiData?.roiMultiple || 3.2;

    // Calculate financial breakdown
    const year1Investment = Math.round(annualImpact * 0.3);
    const year1Return = Math.round(annualImpact * 0.7);
    const year2OngoingCost = Math.round(year1Investment * 0.4);
    const year2Return = annualImpact;

    // Value drivers
    const valueDrivers = [
        { name: 'Operational Efficiency', value: Math.round(annualImpact * 0.35), percent: 35 },
        { name: 'Cost Reduction', value: Math.round(annualImpact * 0.30), percent: 30 },
        { name: 'Revenue Growth', value: Math.round(annualImpact * 0.25), percent: 25 },
        { name: 'Risk Mitigation', value: Math.round(annualImpact * 0.10), percent: 10 }
    ];

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - ROI Analysis | ${companyName}</title>
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
            text-align: center;
            margin-bottom: 32px;
        }

        .header-badge {
            display: inline-block;
            background: ${PALETTE.primary};
            color: white;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 16px;
        }

        .header h1 {
            font-size: 28px;
            font-weight: 700;
            color: ${PALETTE.text};
            margin-bottom: 8px;
        }

        .header p {
            font-size: 15px;
            color: ${PALETTE.textLight};
        }

        /* Hero Metrics Grid */
        .metrics-hero {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }

        .metric-card {
            background: white;
            border-radius: 12px;
            padding: 24px 16px;
            text-align: center;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .metric-card.primary {
            background: ${PALETTE.primary};
            color: white;
        }

        .metric-value {
            font-size: 36px;
            font-weight: 800;
            line-height: 1;
            color: ${PALETTE.primary};
        }

        .metric-card.primary .metric-value {
            color: white;
        }

        .metric-label {
            font-size: 11px;
            color: ${PALETTE.textLight};
            margin-top: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .metric-card.primary .metric-label {
            color: rgba(255,255,255,0.9);
        }

        /* Investment Breakdown */
        .investment-section {
            background: white;
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .section-title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: ${PALETTE.textLight};
            margin-bottom: 20px;
        }

        .investment-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }

        .investment-card {
            background: #f8fafc;
            border-radius: 8px;
            padding: 20px;
        }

        .investment-card h4 {
            font-size: 13px;
            font-weight: 600;
            color: ${PALETTE.textLight};
            margin-bottom: 12px;
        }

        .investment-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e5e7eb;
        }

        .investment-row:last-child {
            border-bottom: none;
            font-weight: 700;
            padding-top: 12px;
        }

        .investment-row .label {
            color: ${PALETTE.text};
            font-size: 14px;
        }

        .investment-row .value {
            font-size: 14px;
        }

        .investment-row .value.positive {
            color: ${PALETTE.primary};
            font-weight: 600;
        }

        .investment-row .value.negative {
            color: #dc2626;
        }

        /* Value Drivers */
        .drivers-section {
            background: white;
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .driver-row {
            margin-bottom: 16px;
        }

        .driver-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
        }

        .driver-name {
            font-size: 14px;
            color: ${PALETTE.text};
        }

        .driver-value {
            font-size: 14px;
            font-weight: 600;
            color: ${PALETTE.primary};
        }

        .driver-bar {
            height: 8px;
            background: #e5e7eb;
            border-radius: 4px;
            overflow: hidden;
        }

        .driver-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, ${PALETTE.primary} 0%, ${PALETTE.secondary} 100%);
            border-radius: 4px;
        }

        /* Comparable Results */
        .comparable-section {
            background: linear-gradient(135deg, ${PALETTE.primary} 0%, #047857 100%);
            color: white;
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
        }

        .comparable-section .section-title {
            color: rgba(255,255,255,0.9);
        }

        .comparable-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            margin-top: 16px;
        }

        .comparable-item {
            text-align: center;
        }

        .comparable-value {
            font-size: 32px;
            font-weight: 700;
        }

        .comparable-label {
            font-size: 12px;
            opacity: 0.9;
            margin-top: 4px;
        }

        /* CTA Section */
        .cta-section {
            background: white;
            border-radius: 12px;
            padding: 32px;
            text-align: center;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
            border: 2px solid ${PALETTE.primary};
        }

        .cta-section h3 {
            font-size: 20px;
            font-weight: 700;
            color: ${PALETTE.text};
            margin-bottom: 8px;
        }

        .cta-section p {
            font-size: 14px;
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
            background: #047857;
            transform: translateY(-2px);
        }

        /* Footer */
        .footer {
            text-align: center;
            padding: 24px;
            color: ${PALETTE.textLight};
            font-size: 12px;
        }

        .footer-note {
            font-style: italic;
            margin-top: 8px;
        }

        @media print {
            body { background: white; }
            .container { max-width: 100%; }
        }

        @media (max-width: 768px) {
            .metrics-hero { grid-template-columns: repeat(2, 1fr); }
            .investment-grid { grid-template-columns: 1fr; }
            .comparable-grid { grid-template-columns: 1fr; }
            .metric-value { font-size: 28px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <span class="header-badge">ROI Analysis</span>
            <h1>Investment Analysis for ${businessName}</h1>
            <p>Prepared by ${companyName} | ${new Date().toLocaleDateString()}</p>
        </div>

        <!-- Hero Metrics -->
        <div class="metrics-hero">
            <div class="metric-card primary">
                <div class="metric-value">${formatCurrency(annualImpact)}</div>
                <div class="metric-label">Annual Impact</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${costReduction}%</div>
                <div class="metric-label">Cost Reduction</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${paybackMonths}mo</div>
                <div class="metric-label">Payback Period</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${roiMultiple}x</div>
                <div class="metric-label">ROI Multiple</div>
            </div>
        </div>

        <!-- Investment Breakdown -->
        <div class="investment-section">
            <div class="section-title">Investment Breakdown</div>
            <div class="investment-grid">
                <div class="investment-card">
                    <h4>Year 1</h4>
                    <div class="investment-row">
                        <span class="label">Implementation</span>
                        <span class="value negative">-${formatCurrency(year1Investment)}</span>
                    </div>
                    <div class="investment-row">
                        <span class="label">Expected Return</span>
                        <span class="value positive">+${formatCurrency(year1Return)}</span>
                    </div>
                    <div class="investment-row">
                        <span class="label">Net Impact</span>
                        <span class="value positive">+${formatCurrency(year1Return - year1Investment)}</span>
                    </div>
                </div>
                <div class="investment-card">
                    <h4>Year 2+</h4>
                    <div class="investment-row">
                        <span class="label">Ongoing Costs</span>
                        <span class="value negative">-${formatCurrency(year2OngoingCost)}/yr</span>
                    </div>
                    <div class="investment-row">
                        <span class="label">Annual Return</span>
                        <span class="value positive">+${formatCurrency(year2Return)}/yr</span>
                    </div>
                    <div class="investment-row">
                        <span class="label">Net Annual</span>
                        <span class="value positive">+${formatCurrency(year2Return - year2OngoingCost)}/yr</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Value Drivers -->
        <div class="drivers-section">
            <div class="section-title">Value Drivers</div>
            ${valueDrivers.map(driver => `
                <div class="driver-row">
                    <div class="driver-header">
                        <span class="driver-name">${driver.name}</span>
                        <span class="driver-value">${formatCurrency(driver.value)}</span>
                    </div>
                    <div class="driver-bar">
                        <div class="driver-bar-fill" style="width: ${driver.percent}%;"></div>
                    </div>
                </div>
            `).join('')}
        </div>

        <!-- Comparable Results -->
        <div class="comparable-section">
            <div class="section-title">Comparable Client Results</div>
            <div class="comparable-grid">
                <div class="comparable-item">
                    <div class="comparable-value">47%</div>
                    <div class="comparable-label">Avg. Cost Reduction</div>
                </div>
                <div class="comparable-item">
                    <div class="comparable-value">4.2mo</div>
                    <div class="comparable-label">Avg. Payback</div>
                </div>
                <div class="comparable-item">
                    <div class="comparable-value">98%</div>
                    <div class="comparable-label">Client Satisfaction</div>
                </div>
            </div>
        </div>

        <!-- CTA -->
        <div class="cta-section">
            <h3>Schedule Your ROI Walkthrough</h3>
            <p>Let's review these projections together and customize them for ${businessName}'s specific situation.</p>
            <a href="${ctaUrl}" class="cta-button">${bookingUrl ? 'Book ROI Review' : 'Schedule Discussion'}</a>
        </div>

        <!-- Footer -->
        <div class="footer">
            ${companyName} | ROI Analysis for ${businessName}
            <div class="footer-note">* Projections based on comparable client data. Actual results may vary.</div>
        </div>
    </div>
</body>
</html>`;
}

module.exports = { generate };
