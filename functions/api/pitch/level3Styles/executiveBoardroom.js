/**
 * Executive Boardroom Style - L3 Slide Deck
 *
 * Conservative, traditional. Navy and white. Structured and predictable.
 * Professional serif typography, header bar accent, minimal decorative elements.
 * Think traditional Fortune 500 boardroom presentation.
 *
 * @module pitch/level3Styles/executiveBoardroom
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const {
    getConfig,
    slideWrapper,
    titleSlide,
    metricsSlide,
    bulletSlide,
    tableSlide,
    ctaSlide
} = require('./sharedSlides');

const CONFIG = getConfig('executive_boardroom');

/**
 * Generate Executive Boardroom style L3 slide deck
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const contactName = inputs.contactName || 'Leadership Team';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const ctaUrl = bookingUrl || `mailto:${contactEmail}`;

    // Get industry intelligence
    const salesIntel = getIndustryIntelligence(industry, inputs.subIndustry);

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;
    const roiMultiple = roiData?.roiMultiple || 3.2;

    // Review data
    const googleRating = inputs.googleRating || 4.2;
    const numReviews = inputs.numReviews || 150;

    // Build slides
    const slides = [];

    // Slide 1: Title
    slides.push(slideWrapper(
        `
        <div style="text-align: center;">
            <div style="font-family: Arial, sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: ${CONFIG.colors.accent}; margin-bottom: 24px;">
                Confidential
            </div>
            <h1 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 400; color: ${CONFIG.colors.text}; margin-bottom: 16px; letter-spacing: -0.5px;">
                Strategic Partnership Proposal
            </h1>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 20px; color: ${CONFIG.colors.textLight}; margin-bottom: 32px;">
                ${businessName}
            </p>
            <div style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight};">
                <p style="margin-bottom: 4px;">Prepared by ${companyName}</p>
                <p>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
        </div>
        `,
        { config: CONFIG, showNumber: false, headerBar: true }
    ));

    // Slide 2: Agenda
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 40px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Agenda
        </h2>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 18px; color: ${CONFIG.colors.text};">
            ${[
                'Executive Summary',
                'Current State Assessment',
                'Proposed Solution',
                'Financial Analysis',
                'Implementation Approach',
                'Recommendation'
            ].map((item, i) => `
                <div style="display: flex; align-items: baseline; padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="font-family: ${CONFIG.fonts.heading}; font-size: 24px; color: ${CONFIG.colors.accent}; width: 50px;">${i + 1}.</span>
                    <span>${item}</span>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 2, headerBar: true, headerTitle: 'Agenda' }
    ));

    // Slide 3: Executive Summary
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Executive Summary
        </h2>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 16px; line-height: 1.8; color: ${CONFIG.colors.text};">
            <p style="margin-bottom: 20px;">
                ${businessName} operates in an increasingly competitive ${industry} market. This proposal outlines a strategic initiative to enhance operational efficiency, reduce costs, and position the organization for sustainable growth.
            </p>
            <p style="margin-bottom: 20px;">
                ${inputs.statedProblem ? `The organization has identified a key priority: ${inputs.statedProblem}.` : 'Current market conditions require a proactive approach to operational excellence.'}
            </p>
            <div style="background: #f8fafc; border-left: 4px solid ${CONFIG.colors.accent}; padding: 20px; margin-top: 24px;">
                <p style="font-weight: 600; margin-bottom: 8px;">Key Recommendation:</p>
                <p style="color: ${CONFIG.colors.textLight};">Engage ${companyName} to implement a comprehensive solution delivering ${formatCurrency(annualImpact)} in annual value with full ROI within ${paybackMonths} months.</p>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 3, headerBar: true, headerTitle: 'Executive Summary' }
    ));

    // Slide 4: Current State Assessment
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Current State Assessment
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
            <div>
                <h4 style="font-family: ${CONFIG.fonts.body}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px;">Market Position</h4>
                <div style="font-family: ${CONFIG.fonts.body}; font-size: 15px; color: ${CONFIG.colors.text};">
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Industry Sector</span>
                        <span style="font-weight: 600;">${industry}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Customer Rating</span>
                        <span style="font-weight: 600;">${googleRating} / 5.0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Reviews Analyzed</span>
                        <span style="font-weight: 600;">${numReviews}</span>
                    </div>
                </div>
            </div>
            <div>
                <h4 style="font-family: ${CONFIG.fonts.body}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px;">Identified Opportunities</h4>
                <ul style="font-family: ${CONFIG.fonts.body}; font-size: 15px; color: ${CONFIG.colors.text}; list-style: none; padding: 0;">
                    <li style="padding: 10px 0; padding-left: 20px; border-bottom: 1px solid #e5e7eb; position: relative;">
                        <span style="position: absolute; left: 0; color: ${CONFIG.colors.accent};">■</span>
                        Operational efficiency improvements
                    </li>
                    <li style="padding: 10px 0; padding-left: 20px; border-bottom: 1px solid #e5e7eb; position: relative;">
                        <span style="position: absolute; left: 0; color: ${CONFIG.colors.accent};">■</span>
                        Cost structure optimization
                    </li>
                    <li style="padding: 10px 0; padding-left: 20px; border-bottom: 1px solid #e5e7eb; position: relative;">
                        <span style="position: absolute; left: 0; color: ${CONFIG.colors.accent};">■</span>
                        Technology modernization
                    </li>
                    <li style="padding: 10px 0; padding-left: 20px; position: relative;">
                        <span style="position: absolute; left: 0; color: ${CONFIG.colors.accent};">■</span>
                        Competitive differentiation
                    </li>
                </ul>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 4, headerBar: true, headerTitle: 'Assessment' }
    ));

    // Slide 5: Proposed Solution
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Proposed Solution
        </h2>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 16px; color: ${CONFIG.colors.text};">
            <p style="margin-bottom: 28px; line-height: 1.7;">
                ${companyName} proposes a comprehensive engagement to address the identified opportunities through proven methodologies and technology-enabled solutions.
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;">
                ${[
                    { title: 'Process Optimization', desc: 'Streamline workflows to eliminate inefficiencies and reduce operational overhead' },
                    { title: 'Technology Integration', desc: 'Deploy modern tools that enhance productivity and enable data-driven decisions' },
                    { title: 'Capability Building', desc: 'Develop internal expertise for sustainable long-term performance improvement' }
                ].map(item => `
                    <div style="background: #f8fafc; padding: 24px; border-top: 3px solid ${CONFIG.colors.primary};">
                        <h4 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: ${CONFIG.colors.primary};">${item.title}</h4>
                        <p style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.5;">${item.desc}</p>
                    </div>
                `).join('')}
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 5, headerBar: true, headerTitle: 'Solution' }
    ));

    // Slide 6: Financial Analysis
    const year1Investment = Math.round(annualImpact * 0.3);
    const year1Return = Math.round(annualImpact * 0.7);
    const year2Return = annualImpact;
    const year3Return = Math.round(annualImpact * 1.15);
    const threeYearTotal = (year1Return - year1Investment) + year2Return + year3Return;

    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Financial Analysis
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 14px;">
            <thead>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <th style="padding: 14px 16px; text-align: left;">Period</th>
                    <th style="padding: 14px 16px; text-align: right;">Investment</th>
                    <th style="padding: 14px 16px; text-align: right;">Return</th>
                    <th style="padding: 14px 16px; text-align: right;">Net Value</th>
                </tr>
            </thead>
            <tbody>
                <tr style="background: white;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 1</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">(${formatCurrency(year1Investment)})</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year1Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year1Return - year1Investment)}</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 2</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Ongoing</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year2Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year2Return)}</td>
                </tr>
                <tr style="background: white;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 3</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Ongoing</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year3Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year3Return)}</td>
                </tr>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <td style="padding: 14px 16px; font-weight: 700;" colspan="3">Three-Year Total Value</td>
                    <td style="padding: 14px 16px; text-align: right; font-weight: 700; font-size: 16px;">${formatCurrency(threeYearTotal)}</td>
                </tr>
            </tbody>
        </table>
        <div style="margin-top: 24px; font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; font-style: italic;">
            * Financial projections based on comparable client engagements and industry benchmarks.
        </div>
        `,
        { config: CONFIG, slideNumber: 6, headerBar: true, headerTitle: 'Financial Analysis' }
    ));

    // Slide 7: Key Metrics
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 40px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px; text-align: center;">
            Key Performance Indicators
        </h2>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px;">
            ${[
                { value: formatCurrency(annualImpact), label: 'Annual Impact' },
                { value: `${costReduction}%`, label: 'Cost Reduction' },
                { value: `${paybackMonths}mo`, label: 'Payback Period' },
                { value: `${roiMultiple}x`, label: 'ROI Multiple' }
            ].map(metric => `
                <div style="text-align: center; padding: 32px 16px; background: white; border: 1px solid #e5e7eb; border-top: 4px solid ${CONFIG.colors.primary};">
                    <div style="font-family: ${CONFIG.fonts.body}; font-size: 36px; font-weight: 700; color: ${CONFIG.colors.primary}; line-height: 1;">${metric.value}</div>
                    <div style="font-family: ${CONFIG.fonts.body}; font-size: 12px; color: ${CONFIG.colors.textLight}; margin-top: 12px; text-transform: uppercase; letter-spacing: 0.5px;">${metric.label}</div>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 7, headerBar: true, headerTitle: 'Key Metrics' }
    ));

    // Slide 8: Implementation Approach
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Implementation Approach
        </h2>
        <div style="font-family: ${CONFIG.fonts.body};">
            ${[
                { phase: 'Phase 1', title: 'Discovery & Planning', duration: 'Weeks 1-2', activities: 'Requirements gathering, stakeholder alignment, baseline metrics establishment' },
                { phase: 'Phase 2', title: 'Implementation', duration: 'Weeks 3-8', activities: 'Solution deployment, integration, data migration, user configuration' },
                { phase: 'Phase 3', title: 'Optimization', duration: 'Weeks 9-12', activities: 'Performance tuning, process refinement, training completion' },
                { phase: 'Phase 4', title: 'Steady State', duration: 'Ongoing', activities: 'Continuous support, quarterly reviews, enhancement releases' }
            ].map((phase, i) => `
                <div style="display: flex; border-bottom: 1px solid #e5e7eb; padding: 16px 0;">
                    <div style="width: 100px; flex-shrink: 0;">
                        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.accent};">${phase.phase}</div>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight}; margin-top: 4px;">${phase.duration}</div>
                    </div>
                    <div style="flex: 1; padding-left: 24px;">
                        <div style="font-size: 16px; font-weight: 600; color: ${CONFIG.colors.text}; margin-bottom: 4px;">${phase.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight};">${phase.activities}</div>
                    </div>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 8, headerBar: true, headerTitle: 'Implementation' }
    ));

    // Slide 9: Risk Considerations
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Risk Considerations & Mitigation
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 14px;">
            <thead>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <th style="padding: 12px 16px; text-align: left; width: 25%;">Risk Factor</th>
                    <th style="padding: 12px 16px; text-align: center; width: 15%;">Probability</th>
                    <th style="padding: 12px 16px; text-align: center; width: 15%;">Impact</th>
                    <th style="padding: 12px 16px; text-align: left; width: 45%;">Mitigation Strategy</th>
                </tr>
            </thead>
            <tbody>
                ${[
                    { risk: 'Timeline delays', prob: 'Low', impact: 'Medium', mitigation: 'Phased approach with built-in contingency; parallel workstreams' },
                    { risk: 'Change resistance', prob: 'Medium', impact: 'Medium', mitigation: 'Executive sponsorship; comprehensive change management program' },
                    { risk: 'Technical integration', prob: 'Low', impact: 'High', mitigation: 'Pre-implementation technical assessment; proven integration patterns' },
                    { risk: 'Resource availability', prob: 'Low', impact: 'Low', mitigation: 'Dedicated project team; minimal client resource requirements' }
                ].map((row, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : '#f8fafc'};">
                        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${row.risk}</td>
                        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.prob}</td>
                        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center;">${row.impact}</td>
                        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; color: ${CONFIG.colors.textLight};">${row.mitigation}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `,
        { config: CONFIG, slideNumber: 9, headerBar: true, headerTitle: 'Risk Analysis' }
    ));

    // Slide 10: Recommendation & Next Steps
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 32px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Recommendation
        </h2>
        <div style="font-family: ${CONFIG.fonts.body};">
            <div style="background: #f8fafc; border-left: 4px solid ${CONFIG.colors.primary}; padding: 24px; margin-bottom: 32px;">
                <p style="font-size: 18px; color: ${CONFIG.colors.text}; line-height: 1.6;">
                    Based on this analysis, we recommend ${businessName} proceed with the proposed engagement to realize <strong>${formatCurrency(annualImpact)}</strong> in annual value and strengthen competitive positioning in the ${industry} market.
                </p>
            </div>
            <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Proposed Next Steps</h4>
            <ol style="font-size: 15px; color: ${CONFIG.colors.text}; padding-left: 24px;">
                <li style="padding: 8px 0;">Schedule executive alignment session to confirm scope and priorities</li>
                <li style="padding: 8px 0;">Complete detailed requirements documentation</li>
                <li style="padding: 8px 0;">Finalize commercial terms and project timeline</li>
                <li style="padding: 8px 0;">Initiate Phase 1 Discovery activities</li>
            </ol>
        </div>
        `,
        { config: CONFIG, slideNumber: 10, headerBar: true, headerTitle: 'Recommendation' }
    ));

    // Slide 11: Contact
    slides.push(slideWrapper(
        `
        <div style="text-align: center; padding: 40px 0;">
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 32px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text};">
                Thank You
            </h2>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 18px; color: ${CONFIG.colors.textLight}; margin-bottom: 40px;">
                We look forward to partnering with ${businessName}.
            </p>
            <div style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 32px 0; max-width: 400px; margin: 0 auto;">
                <p style="font-family: ${CONFIG.fonts.body}; font-size: 16px; font-weight: 600; color: ${CONFIG.colors.text}; margin-bottom: 8px;">${companyName}</p>
                <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">${contactEmail}</p>
                ${bookingUrl ? `
                    <a href="${ctaUrl}" style="display: inline-block; background: ${CONFIG.colors.primary}; color: white; padding: 14px 32px; font-family: ${CONFIG.fonts.body}; font-size: 14px; font-weight: 600; text-decoration: none; margin-top: 8px;">
                        Schedule Discussion
                    </a>
                ` : `
                    <a href="${ctaUrl}" style="display: inline-block; background: ${CONFIG.colors.primary}; color: white; padding: 14px 32px; font-family: ${CONFIG.fonts.body}; font-size: 14px; font-weight: 600; text-decoration: none; margin-top: 8px;">
                        Contact Us
                    </a>
                `}
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 11, headerBar: true }
    ));

    const totalSlides = slides.length;

    // Update slide numbers
    const numberedSlides = slides.map((slide, i) =>
        slide.replace(/\d+ \/ \d+/, `${i + 1} / ${totalSlides}`)
    );

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Executive Proposal | ${companyName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ${CONFIG.fonts.body};
            background: ${CONFIG.colors.slideBackground};
            color: ${CONFIG.colors.text};
        }
        @media print {
            .slide { page-break-after: always; height: 100vh; }
        }
    </style>
</head>
<body>
    ${numberedSlides.join('')}
</body>
</html>`;
}

module.exports = { generate };
