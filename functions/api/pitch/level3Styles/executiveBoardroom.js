/**
 * Executive Boardroom Style - L3 Slide Deck
 *
 * Conservative, traditional. Navy and white. Structured and predictable.
 * Professional serif typography, header bar accent, minimal decorative elements.
 * Rich narrative copy for executive audiences. Think Fortune 500 boardroom presentation.
 *
 * @module pitch/level3Styles/executiveBoardroom
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const {
    getConfig,
    slideWrapper
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
    const painPoints = salesIntel?.painPoints || ['Operational inefficiency', 'Rising costs', 'Competitive pressure'];

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;
    const roiMultiple = roiData?.roiMultiple || 3.2;

    // Review data
    const googleRating = inputs.googleRating || 4.2;
    const numReviews = inputs.numReviews || 150;
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };

    // Financial calculations
    const year1Investment = Math.round(annualImpact * 0.3);
    const year1Return = Math.round(annualImpact * 0.7);
    const year2Return = annualImpact;
    const year3Return = Math.round(annualImpact * 1.15);
    const threeYearTotal = (year1Return - year1Investment) + year2Return + year3Return;

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
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Agenda
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 15px; color: ${CONFIG.colors.textLight}; margin-bottom: 32px; line-height: 1.6;">
            This presentation outlines a strategic opportunity for ${businessName} to enhance operational performance,
            reduce costs, and strengthen competitive positioning in the ${industry} market.
        </p>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 17px; color: ${CONFIG.colors.text};">
            ${[
                { title: 'Executive Summary', desc: 'Key findings and recommendations' },
                { title: 'Situation Analysis', desc: 'Current state assessment and market position' },
                { title: 'Proposed Solution', desc: 'Strategic approach and methodology' },
                { title: 'Financial Analysis', desc: 'Investment, returns, and ROI projections' },
                { title: 'Implementation Plan', desc: 'Timeline, milestones, and risk mitigation' },
                { title: 'Recommendation', desc: 'Next steps and call to action' }
            ].map((item, i) => `
                <div style="display: flex; padding: 14px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; color: ${CONFIG.colors.accent}; width: 45px; flex-shrink: 0;">${i + 1}.</span>
                    <div style="flex: 1;">
                        <span style="font-weight: 600;">${item.title}</span>
                        <span style="color: ${CONFIG.colors.textLight}; font-size: 14px; margin-left: 12px;">— ${item.desc}</span>
                    </div>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 2, headerBar: true, headerTitle: 'Agenda' }
    ));

    // Slide 3: Executive Summary
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Executive Summary
        </h2>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 15px; line-height: 1.8; color: ${CONFIG.colors.text};">
            <p style="margin-bottom: 18px;">
                <strong>Situation:</strong> ${businessName} operates in an increasingly competitive ${industry} market where operational efficiency
                and customer experience have become critical differentiators. ${inputs.statedProblem ? `The organization has identified a key challenge: ${inputs.statedProblem}.` : 'Current market conditions demand a proactive approach to operational excellence and cost optimization.'}
            </p>
            <p style="margin-bottom: 18px;">
                <strong>Opportunity:</strong> Our analysis indicates significant potential for improvement across operational workflows,
                cost structures, and customer engagement—areas where comparable organizations have achieved substantial gains.
                ${businessName}'s strong market position (${googleRating}/5.0 rating from ${numReviews} reviews) provides an excellent foundation for accelerated growth.
            </p>
            <p style="margin-bottom: 24px;">
                <strong>Recommendation:</strong> Engage ${companyName} to implement a comprehensive transformation initiative
                projected to deliver ${formatCurrency(annualImpact)} in annual value with full return on investment within ${paybackMonths} months.
            </p>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
                ${[
                    { value: formatCurrency(annualImpact), label: 'Annual Value' },
                    { value: `${costReduction}%`, label: 'Cost Reduction' },
                    { value: `${paybackMonths} mo`, label: 'Payback Period' },
                    { value: `${roiMultiple}x`, label: 'ROI Multiple' }
                ].map(m => `
                    <div style="background: #f8fafc; padding: 18px; border-top: 3px solid ${CONFIG.colors.primary}; text-align: center;">
                        <div style="font-size: 24px; font-weight: 700; color: ${CONFIG.colors.primary};">${m.value}</div>
                        <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${m.label}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 3, headerBar: true, headerTitle: 'Executive Summary' }
    ));

    // Slide 4: Situation Analysis
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Situation Analysis
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
            <div>
                <h4 style="font-family: ${CONFIG.fonts.body}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Current Performance Indicators</h4>
                <p style="font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px; line-height: 1.5;">
                    ${businessName} maintains a solid market position with strong customer satisfaction metrics, indicating a foundation well-suited for operational optimization.
                </p>
                <div style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.text};">
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Customer Rating</span>
                        <span style="font-weight: 600;">${googleRating} / 5.0 ★</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Reviews Analyzed</span>
                        <span style="font-weight: 600;">${numReviews}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Positive Sentiment</span>
                        <span style="font-weight: 600; color: #059669;">${sentiment.positive}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                        <span>Industry Sector</span>
                        <span style="font-weight: 600;">${industry}</span>
                    </div>
                </div>
            </div>
            <div>
                <h4 style="font-family: ${CONFIG.fonts.body}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Identified Improvement Opportunities</h4>
                <p style="font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px; line-height: 1.5;">
                    Analysis of operational patterns and industry benchmarks reveals several areas where ${businessName} can achieve meaningful gains:
                </p>
                <ul style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.text}; list-style: none; padding: 0;">
                    ${[
                        { title: 'Operational Efficiency', desc: 'Workflow optimization and automation' },
                        { title: 'Cost Structure', desc: 'Overhead reduction and resource allocation' },
                        { title: 'Technology Modernization', desc: 'Systems integration and data utilization' },
                        { title: 'Competitive Positioning', desc: 'Market differentiation and customer experience' }
                    ].map(item => `
                        <li style="padding: 10px 0; padding-left: 20px; border-bottom: 1px solid #e5e7eb; position: relative;">
                            <span style="position: absolute; left: 0; color: ${CONFIG.colors.accent}; font-size: 10px;">■</span>
                            <strong>${item.title}:</strong> <span style="color: ${CONFIG.colors.textLight};">${item.desc}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 4, headerBar: true, headerTitle: 'Situation Analysis' }
    ));

    // Slide 5: Proposed Solution
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Proposed Solution
        </h2>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 15px; color: ${CONFIG.colors.text};">
            <p style="margin-bottom: 24px; line-height: 1.7;">
                ${companyName} proposes a comprehensive strategic engagement designed to address the identified opportunities through
                proven methodologies and technology-enabled solutions. Our approach has been refined through 500+ successful implementations
                across the ${industry} sector and related industries.
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 24px;">
                ${[
                    { title: 'Process Optimization', icon: '⚙️', desc: 'Systematic analysis and redesign of core workflows to eliminate inefficiencies, reduce manual effort, and improve throughput. Expected to drive 35% of total value creation.' },
                    { title: 'Technology Integration', icon: '💡', desc: 'Deployment of modern tools that enhance productivity, enable data-driven decision making, and provide actionable insights. Accelerates operational improvements.' },
                    { title: 'Capability Building', icon: '📈', desc: 'Development of internal expertise and best practices to ensure sustainable, long-term performance improvement. Reduces dependency on external support.' }
                ].map(item => `
                    <div style="background: #f8fafc; padding: 24px; border-top: 3px solid ${CONFIG.colors.primary};">
                        <div style="font-size: 24px; margin-bottom: 12px;">${item.icon}</div>
                        <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 10px; color: ${CONFIG.colors.primary};">${item.title}</h4>
                        <p style="font-size: 13px; color: ${CONFIG.colors.textLight}; line-height: 1.5; margin: 0;">${item.desc}</p>
                    </div>
                `).join('')}
            </div>
            <div style="background: ${CONFIG.colors.primary}; color: white; padding: 16px 20px; border-radius: 4px;">
                <p style="font-size: 14px; margin: 0; line-height: 1.5;">
                    <strong>Differentiation:</strong> Unlike generic consulting approaches, ${companyName}'s methodology is specifically tailored for the ${industry} sector,
                    incorporating industry-specific benchmarks, compliance requirements, and proven optimization patterns.
                </p>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 5, headerBar: true, headerTitle: 'Solution' }
    ));

    // Slide 6: Financial Analysis
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 16px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Financial Analysis
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px; line-height: 1.5;">
            Three-year financial projection based on comparable client results and ${industry} industry benchmarks.
            Projections reflect conservative estimates with demonstrated achievement rates exceeding 90% in similar engagements.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 14px; margin-bottom: 20px;">
            <thead>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <th style="padding: 14px 16px; text-align: left;">Period</th>
                    <th style="padding: 14px 16px; text-align: right;">Investment</th>
                    <th style="padding: 14px 16px; text-align: right;">Gross Return</th>
                    <th style="padding: 14px 16px; text-align: right;">Net Value</th>
                </tr>
            </thead>
            <tbody>
                <tr style="background: white;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
                        <strong>Year 1</strong>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight};">Implementation & initial returns</div>
                    </td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">(${formatCurrency(year1Investment)})</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year1Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year1Return - year1Investment)}</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
                        <strong>Year 2</strong>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight};">Full operational efficiency</div>
                    </td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Ongoing support</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year2Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year2Return)}</td>
                </tr>
                <tr style="background: white;">
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
                        <strong>Year 3</strong>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight};">Compound improvements</div>
                    </td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Ongoing support</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year3Return)}</td>
                    <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year3Return)}</td>
                </tr>
            </tbody>
            <tfoot>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <td style="padding: 14px 16px; font-weight: 700;" colspan="3">Three-Year Total Value Creation</td>
                    <td style="padding: 14px 16px; text-align: right; font-weight: 700; font-size: 16px;">${formatCurrency(threeYearTotal)}</td>
                </tr>
            </tfoot>
        </table>
        <div style="font-family: ${CONFIG.fonts.body}; font-size: 12px; color: ${CONFIG.colors.textLight}; font-style: italic;">
            * Financial projections based on comparable client engagements and industry benchmarks. Actual results may vary based on specific circumstances.
        </div>
        `,
        { config: CONFIG, slideNumber: 6, headerBar: true, headerTitle: 'Financial Analysis' }
    ));

    // Slide 7: Key Performance Indicators
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 16px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px; text-align: center;">
            Key Performance Indicators
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 32px; text-align: center; line-height: 1.5; max-width: 700px; margin-left: auto; margin-right: auto;">
            The following metrics will serve as primary indicators of success for this engagement.
            All targets are based on demonstrated achievements in comparable ${industry} implementations.
        </p>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 32px;">
            ${[
                { value: formatCurrency(annualImpact), label: 'Annual Value', context: 'Recurring yearly benefit' },
                { value: `${costReduction}%`, label: 'Cost Reduction', context: 'Operational savings' },
                { value: `${paybackMonths} mo`, label: 'Payback Period', context: 'Time to full ROI' },
                { value: `${roiMultiple}x`, label: 'ROI Multiple', context: 'Return on investment' }
            ].map(metric => `
                <div style="text-align: center; padding: 28px 16px; background: white; border: 1px solid #e5e7eb; border-top: 4px solid ${CONFIG.colors.primary};">
                    <div style="font-family: ${CONFIG.fonts.body}; font-size: 32px; font-weight: 700; color: ${CONFIG.colors.primary}; line-height: 1;">${metric.value}</div>
                    <div style="font-family: ${CONFIG.fonts.body}; font-size: 12px; font-weight: 600; color: ${CONFIG.colors.text}; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.5px;">${metric.label}</div>
                    <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; margin-top: 4px;">${metric.context}</div>
                </div>
            `).join('')}
        </div>
        <div style="background: #f8fafc; padding: 18px 24px; border-left: 4px solid ${CONFIG.colors.primary};">
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.text}; margin: 0; line-height: 1.6;">
                <strong>Performance Guarantee:</strong> ${companyName} commits to achieving these targets through our engagement.
                Quarterly reviews will track progress against each KPI with transparent reporting and course correction as needed.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 7, headerBar: true, headerTitle: 'KPIs' }
    ));

    // Slide 8: Implementation Approach
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 16px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Implementation Approach
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 24px; line-height: 1.5;">
            Our phased implementation methodology minimizes business disruption while accelerating time to value.
            Each phase builds upon the previous, with clear milestones and decision points.
        </p>
        <div style="font-family: ${CONFIG.fonts.body};">
            ${[
                { phase: 'Phase 1', title: 'Discovery & Planning', duration: 'Weeks 1-2', activities: 'Stakeholder interviews, requirements documentation, baseline metrics establishment, integration assessment, and detailed project planning.', milestone: 'Project charter and plan approved' },
                { phase: 'Phase 2', title: 'Implementation', duration: 'Weeks 3-8', activities: 'Solution configuration, system integration, data migration, user access setup, and comprehensive team training across all functions.', milestone: 'Go-live readiness confirmed' },
                { phase: 'Phase 3', title: 'Optimization', duration: 'Weeks 9-12', activities: 'Performance monitoring, workflow refinement, advanced feature deployment, and knowledge transfer to internal teams.', milestone: 'Target KPIs achieved' },
                { phase: 'Phase 4', title: 'Steady State', duration: 'Ongoing', activities: 'Continuous support, quarterly business reviews, enhancement releases, and strategic planning for future initiatives.', milestone: 'Sustained value delivery' }
            ].map((phase, i) => `
                <div style="display: flex; border-bottom: 1px solid #e5e7eb; padding: 16px 0;">
                    <div style="width: 110px; flex-shrink: 0;">
                        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.accent};">${phase.phase}</div>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight}; margin-top: 4px;">${phase.duration}</div>
                    </div>
                    <div style="flex: 1; padding-left: 24px;">
                        <div style="font-size: 15px; font-weight: 600; color: ${CONFIG.colors.text}; margin-bottom: 6px;">${phase.title}</div>
                        <div style="font-size: 13px; color: ${CONFIG.colors.textLight}; line-height: 1.5; margin-bottom: 8px;">${phase.activities}</div>
                        <div style="font-size: 12px; color: ${CONFIG.colors.primary}; font-weight: 600;">✓ Milestone: ${phase.milestone}</div>
                    </div>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 8, headerBar: true, headerTitle: 'Implementation' }
    ));

    // Slide 9: Risk Management
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 16px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Risk Management
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px; line-height: 1.5;">
            Comprehensive risk assessment with proven mitigation strategies. All identified risks have been successfully
            managed in comparable engagements with high success rates.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 13px;">
            <thead>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <th style="padding: 12px 14px; text-align: left; width: 22%;">Risk Factor</th>
                    <th style="padding: 12px 14px; text-align: center; width: 12%;">Likelihood</th>
                    <th style="padding: 12px 14px; text-align: center; width: 12%;">Impact</th>
                    <th style="padding: 12px 14px; text-align: left; width: 54%;">Mitigation Strategy</th>
                </tr>
            </thead>
            <tbody>
                ${[
                    { risk: 'Timeline delays', prob: 'Low', impact: 'Medium', mitigation: 'Phased approach with built-in contingency buffers; parallel workstreams reduce critical path dependencies' },
                    { risk: 'Change resistance', prob: 'Medium', impact: 'Medium', mitigation: 'Executive sponsorship secured upfront; comprehensive change management and communication program' },
                    { risk: 'Technical integration', prob: 'Low', impact: 'High', mitigation: 'Pre-implementation technical assessment; proven integration patterns; dedicated technical resources' },
                    { risk: 'Resource constraints', prob: 'Low', impact: 'Low', mitigation: 'Dedicated ${companyName} project team; minimal client resource requirements clearly defined' }
                ].map((row, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : '#f8fafc'};">
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${row.risk}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            <span style="background: ${row.prob === 'Low' ? '#dcfce7' : '#fef3c7'}; color: ${row.prob === 'Low' ? '#166534' : '#92400e'}; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;">${row.prob}</span>
                        </td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            <span style="background: ${row.impact === 'Low' ? '#dcfce7' : row.impact === 'Medium' ? '#fef3c7' : '#fee2e2'}; color: ${row.impact === 'Low' ? '#166534' : row.impact === 'Medium' ? '#92400e' : '#991b1b'}; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;">${row.impact}</span>
                        </td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; color: ${CONFIG.colors.textLight}; font-size: 12px; line-height: 1.4;">${row.mitigation}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="margin-top: 16px; background: #dcfce7; padding: 14px 18px; border-radius: 4px;">
            <p style="font-size: 13px; color: #166534; margin: 0; font-weight: 500;">
                Overall Risk Assessment: LOW — All risks are manageable with proven mitigation strategies and experienced delivery team.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 9, headerBar: true, headerTitle: 'Risk Management' }
    ));

    // Slide 10: Recommendation & Next Steps
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 400; margin-bottom: 24px; color: ${CONFIG.colors.text}; border-bottom: 2px solid ${CONFIG.colors.accent}; padding-bottom: 16px;">
            Recommendation
        </h2>
        <div style="font-family: ${CONFIG.fonts.body};">
            <div style="background: #f8fafc; border-left: 4px solid ${CONFIG.colors.primary}; padding: 24px; margin-bottom: 28px;">
                <p style="font-size: 17px; color: ${CONFIG.colors.text}; line-height: 1.7; margin: 0;">
                    Based on this analysis, we recommend ${businessName} proceed with the proposed engagement to realize
                    <strong>${formatCurrency(annualImpact)}</strong> in annual value and strengthen competitive positioning in the ${industry} market.
                    The investment of <strong>${formatCurrency(year1Investment)}</strong> will generate <strong>${formatCurrency(threeYearTotal)}</strong> in value
                    over three years—a <strong>${roiMultiple}x return</strong> with payback in just <strong>${paybackMonths} months</strong>.
                </p>
            </div>
            <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Proposed Next Steps</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                ${[
                    { num: '1', title: 'Executive Alignment', desc: 'Schedule session to confirm scope, priorities, and success criteria' },
                    { num: '2', title: 'Requirements Review', desc: 'Complete detailed requirements documentation with key stakeholders' },
                    { num: '3', title: 'Commercial Terms', desc: 'Finalize agreement structure, timeline, and investment terms' },
                    { num: '4', title: 'Project Kickoff', desc: 'Initiate Phase 1 Discovery activities with dedicated team' }
                ].map(step => `
                    <div style="display: flex; gap: 14px; padding: 16px; background: white; border: 1px solid #e5e7eb;">
                        <div style="width: 32px; height: 32px; background: ${CONFIG.colors.primary}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0;">${step.num}</div>
                        <div>
                            <div style="font-weight: 600; color: ${CONFIG.colors.text}; margin-bottom: 4px;">${step.title}</div>
                            <div style="font-size: 13px; color: ${CONFIG.colors.textLight};">${step.desc}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 10, headerBar: true, headerTitle: 'Recommendation' }
    ));

    // Slide 11: Contact
    slides.push(slideWrapper(
        `
        <div style="text-align: center; padding: 32px 0;">
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 34px; font-weight: 400; margin-bottom: 20px; color: ${CONFIG.colors.text};">
                Thank You
            </h2>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 40px; line-height: 1.6; max-width: 500px; margin-left: auto; margin-right: auto;">
                We look forward to the opportunity to partner with ${businessName} and deliver meaningful, measurable results.
            </p>
            <div style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 32px 0; max-width: 400px; margin: 0 auto;">
                <p style="font-family: ${CONFIG.fonts.body}; font-size: 18px; font-weight: 600; color: ${CONFIG.colors.text}; margin-bottom: 8px;">${companyName}</p>
                <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px;">${contactEmail}</p>
                <a href="${ctaUrl}" style="display: inline-block; background: ${CONFIG.colors.primary}; color: white; padding: 14px 36px; font-family: ${CONFIG.fonts.body}; font-size: 14px; font-weight: 600; text-decoration: none;">
                    ${bookingUrl ? 'Schedule Discussion' : 'Contact Us'}
                </a>
            </div>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 12px; color: ${CONFIG.colors.textLight}; margin-top: 32px;">
                This document is confidential and intended solely for the use of ${businessName}.
            </p>
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
    <title>${businessName} - Strategic Partnership Proposal | ${companyName}</title>
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
