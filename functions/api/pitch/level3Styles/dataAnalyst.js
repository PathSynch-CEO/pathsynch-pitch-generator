/**
 * Data Analyst Style - L3 Slide Deck
 *
 * Dense, information-rich. Charts, tables, metrics grids.
 * Dark blue/gray color scheme. Every slide has data WITH context.
 * Think Goldman Sachs research report as slides.
 *
 * @module pitch/level3Styles/dataAnalyst
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

const CONFIG = getConfig('data_analyst');

/**
 * Generate Data Analyst style L3 slide deck
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
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
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality Service', 'Professional Staff', 'Good Value'];

    // Build slides
    const slides = [];

    // Slide 1: Title
    slides.push(slideWrapper(
        `
        <div style="text-align: center;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: ${CONFIG.colors.accent}; margin-bottom: 20px;">
                Data-Driven Analysis
            </div>
            <h1 style="font-family: ${CONFIG.fonts.heading}; font-size: 38px; font-weight: 700; color: ${CONFIG.colors.text}; margin-bottom: 12px;">
                Investment Analysis Report
            </h1>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 22px; color: ${CONFIG.colors.primary}; margin-bottom: 32px;">
                ${businessName}
            </p>
            <div style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight};">
                <p style="margin-bottom: 4px;">Prepared by ${companyName}</p>
                <p>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
        </div>
        `,
        { config: CONFIG, showNumber: false }
    ));

    // Slide 2: Executive Summary with Key Metrics
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 16px; color: ${CONFIG.colors.text};">
            Executive Summary
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 14px; color: ${CONFIG.colors.textLight}; margin-bottom: 28px; line-height: 1.6; max-width: 800px;">
            This analysis quantifies the strategic opportunity for ${businessName} to enhance operational performance and reduce costs.
            Based on industry benchmarks and comparable client results, we project significant value creation with rapid payback.
        </p>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 28px;">
            ${[
                { value: formatCurrency(annualImpact), label: 'Annual Impact', context: 'Projected yearly value' },
                { value: `${costReduction}%`, label: 'Cost Reduction', context: 'Operational savings' },
                { value: `${paybackMonths}mo`, label: 'Payback Period', context: 'Time to full ROI' },
                { value: `${roiMultiple}x`, label: 'ROI Multiple', context: '3-year return' }
            ].map(m => `
                <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px; border-left: 3px solid ${CONFIG.colors.primary};">
                    <div style="font-size: 28px; font-weight: 700; color: ${CONFIG.colors.primary}; line-height: 1;">${m.value}</div>
                    <div style="font-size: 12px; font-weight: 600; color: ${CONFIG.colors.text}; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${m.label}</div>
                    <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; margin-top: 4px;">${m.context}</div>
                </div>
            `).join('')}
        </div>
        <div style="background: linear-gradient(135deg, ${CONFIG.colors.primary} 0%, ${CONFIG.colors.secondary} 100%); padding: 16px 20px; border-radius: 8px; color: white;">
            <p style="font-size: 13px; margin: 0;"><strong>Key Finding:</strong> ${businessName} can achieve ${formatCurrency(annualImpact)} in annual value with full ROI in ${paybackMonths} months, representing a ${roiMultiple}x return on investment over three years.</p>
        </div>
        `,
        { config: CONFIG, slideNumber: 2 }
    ));

    // Slide 3: Market Position Analysis with Context
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Current Market Position
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 24px; line-height: 1.5;">
            Analysis of ${businessName}'s market presence based on ${numReviews} customer reviews and industry positioning within the ${industry} sector.
        </p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px;">
            <div>
                <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 14px;">Performance Metrics</h4>
                <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                        <span style="font-size: 13px;">Google Rating</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.primary}; font-size: 13px;">${googleRating} / 5.0 ⭐</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                        <span style="font-size: 13px;">Total Reviews Analyzed</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.primary}; font-size: 13px;">${numReviews}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                        <span style="font-size: 13px;">Positive Sentiment Rate</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.accent}; font-size: 13px;">${sentiment.positive}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 10px 0;">
                        <span style="font-size: 13px;">Industry Sector</span>
                        <span style="font-weight: 600; font-size: 13px;">${industry}</span>
                    </div>
                </div>
                <p style="font-size: 11px; color: ${CONFIG.colors.textLight}; margin-top: 10px; font-style: italic;">
                    Rating of ${googleRating} is ${googleRating >= 4.5 ? 'excellent' : googleRating >= 4.0 ? 'above average' : 'competitive'} for the ${industry} sector.
                </p>
            </div>
            <div>
                <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 14px;">Customer Sentiment Breakdown</h4>
                <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px;">
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px;">Positive Feedback</span>
                            <span style="font-size: 12px; font-weight: 600; color: #10b981;">${sentiment.positive}%</span>
                        </div>
                        <div style="height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.positive}%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px;">Neutral</span>
                            <span style="font-size: 12px; font-weight: 600; color: #f59e0b;">${sentiment.neutral}%</span>
                        </div>
                        <div style="height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.neutral}%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px;">Areas for Improvement</span>
                            <span style="font-size: 12px; font-weight: 600; color: #ef4444;">${sentiment.negative}%</span>
                        </div>
                        <div style="height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.negative}%; background: linear-gradient(90deg, #ef4444, #f87171);"></div>
                        </div>
                    </div>
                </div>
                <p style="font-size: 11px; color: ${CONFIG.colors.textLight}; margin-top: 10px; font-style: italic;">
                    ${sentiment.positive}% positive rate indicates ${sentiment.positive >= 70 ? 'strong customer satisfaction' : 'room for improvement'}.
                </p>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 3 }
    ));

    // Slide 4: Financial Model with Narrative
    const year1Investment = Math.round(annualImpact * 0.3);
    const year1Return = Math.round(annualImpact * 0.7);
    const year2Return = annualImpact;
    const year3Return = Math.round(annualImpact * 1.15);
    const threeYearTotal = (year1Return - year1Investment) + year2Return + year3Return;

    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Three-Year Financial Model
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px; line-height: 1.5;">
            Projected investment returns based on comparable client outcomes and industry benchmarks. Year-over-year improvements reflect compound efficiency gains.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 13px; margin-bottom: 20px;">
            <thead>
                <tr style="background: ${CONFIG.colors.tableHeader}; color: white;">
                    <th style="padding: 12px 14px; text-align: left; font-weight: 600;">Period</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Investment</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Gross Return</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Net Impact</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Cumulative</th>
                </tr>
            </thead>
            <tbody>
                <tr style="background: white;">
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 1</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">(${formatCurrency(year1Investment)})</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year1Return)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year1Return - year1Investment)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">${formatCurrency(year1Return - year1Investment)}</td>
                </tr>
                <tr style="background: ${CONFIG.colors.tableStripe};">
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 2</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Maintenance</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year2Return)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year2Return)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">${formatCurrency((year1Return - year1Investment) + year2Return)}</td>
                </tr>
                <tr style="background: white;">
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Year 3</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${CONFIG.colors.textLight};">Maintenance</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(year3Return)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(year3Return)}</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">${formatCurrency(threeYearTotal)}</td>
                </tr>
            </tbody>
            <tfoot>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <td style="padding: 12px 14px; font-weight: 700;" colspan="3">Three-Year Total Value</td>
                    <td style="padding: 12px 14px; text-align: right;"></td>
                    <td style="padding: 12px 14px; text-align: right; font-weight: 700; font-size: 15px;">${formatCurrency(threeYearTotal)}</td>
                </tr>
            </tfoot>
        </table>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
            <div style="background: ${CONFIG.colors.tableStripe}; padding: 14px; border-radius: 6px; text-align: center;">
                <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 0.5px;">Breakeven Point</div>
                <div style="font-size: 18px; font-weight: 700; color: ${CONFIG.colors.primary}; margin-top: 4px;">${paybackMonths} Months</div>
            </div>
            <div style="background: ${CONFIG.colors.tableStripe}; padding: 14px; border-radius: 6px; text-align: center;">
                <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 0.5px;">3-Year ROI</div>
                <div style="font-size: 18px; font-weight: 700; color: ${CONFIG.colors.accent}; margin-top: 4px;">${Math.round(threeYearTotal / year1Investment * 100)}%</div>
            </div>
            <div style="background: ${CONFIG.colors.tableStripe}; padding: 14px; border-radius: 6px; text-align: center;">
                <div style="font-size: 11px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 0.5px;">Return Multiple</div>
                <div style="font-size: 18px; font-weight: 700; color: ${CONFIG.colors.primary}; margin-top: 4px;">${roiMultiple}x</div>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 4 }
    ));

    // Slide 5: Value Drivers Analysis with Context
    const valueDrivers = [
        { driver: 'Operational Efficiency', impact: Math.round(annualImpact * 0.35), pct: '35%', description: 'Streamlined workflows reduce manual effort and errors' },
        { driver: 'Cost Reduction', impact: Math.round(annualImpact * 0.30), pct: '30%', description: 'Lower overhead through automation and optimization' },
        { driver: 'Revenue Growth', impact: Math.round(annualImpact * 0.25), pct: '25%', description: 'Improved capacity enables additional revenue capture' },
        { driver: 'Risk Mitigation', impact: Math.round(annualImpact * 0.10), pct: '10%', description: 'Reduced compliance and operational risk exposure' }
    ];

    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Value Drivers Analysis
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 24px; line-height: 1.5;">
            Breakdown of how the projected ${formatCurrency(annualImpact)} annual impact is generated across four key value categories.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 13px; margin-bottom: 20px;">
            <thead>
                <tr style="background: ${CONFIG.colors.tableHeader}; color: white;">
                    <th style="padding: 12px 14px; text-align: left; font-weight: 600;">Value Driver</th>
                    <th style="padding: 12px 14px; text-align: left; font-weight: 600;">How It's Achieved</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Annual Impact</th>
                    <th style="padding: 12px 14px; text-align: right; font-weight: 600;">Share</th>
                </tr>
            </thead>
            <tbody>
                ${valueDrivers.map((v, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : CONFIG.colors.tableStripe};">
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${v.driver}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; color: ${CONFIG.colors.textLight}; font-size: 12px;">${v.description}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: ${CONFIG.colors.accent};">${formatCurrency(v.impact)}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: right;">${v.pct}</td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr style="background: ${CONFIG.colors.primary}; color: white;">
                    <td style="padding: 12px 14px; font-weight: 700;" colspan="2">Total Annual Value</td>
                    <td style="padding: 12px 14px; text-align: right; font-weight: 700;">${formatCurrency(annualImpact)}</td>
                    <td style="padding: 12px 14px; text-align: right; font-weight: 700;">100%</td>
                </tr>
            </tfoot>
        </table>
        <div style="background: ${CONFIG.colors.tableStripe}; padding: 14px 18px; border-radius: 6px; border-left: 3px solid ${CONFIG.colors.accent};">
            <p style="font-size: 12px; color: ${CONFIG.colors.text}; margin: 0; line-height: 1.5;">
                <strong>Analysis Note:</strong> Operational efficiency and cost reduction account for 65% of total value,
                representing the most predictable returns. Revenue growth and risk mitigation provide additional upside potential.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 5 }
    ));

    // Slide 6: Comparable Analysis with Context
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Comparable Client Results
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 24px; line-height: 1.5;">
            Performance comparison between industry averages and ${companyName} client outcomes across key metrics.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 13px; margin-bottom: 20px;">
            <thead>
                <tr style="background: ${CONFIG.colors.tableHeader}; color: white;">
                    <th style="padding: 12px 14px; text-align: left; font-weight: 600;">Performance Metric</th>
                    <th style="padding: 12px 14px; text-align: center; font-weight: 600;">Industry Average</th>
                    <th style="padding: 12px 14px; text-align: center; font-weight: 600;">${companyName} Clients</th>
                    <th style="padding: 12px 14px; text-align: center; font-weight: 600;">Improvement</th>
                </tr>
            </thead>
            <tbody>
                ${[
                    { metric: 'Cost Reduction Achieved', avg: '15-20%', clients: '35-45%', delta: '+20pp', positive: true },
                    { metric: 'Time to Full ROI', avg: '12-18 months', clients: '4-8 months', delta: '-8 months', positive: true },
                    { metric: 'Customer Satisfaction', avg: '72%', clients: '94%', delta: '+22pp', positive: true },
                    { metric: 'Operational Efficiency Gain', avg: '+15%', clients: '+42%', delta: '+27pp', positive: true }
                ].map((row, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : CONFIG.colors.tableStripe};">
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${row.metric}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: center; color: ${CONFIG.colors.textLight};">${row.avg}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: center; font-weight: 600; color: ${CONFIG.colors.primary};">${row.clients}</td>
                        <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: center; font-weight: 700; color: ${row.positive ? '#059669' : '#dc2626'};">${row.delta}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="background: linear-gradient(135deg, ${CONFIG.colors.primary} 0%, ${CONFIG.colors.secondary} 100%); padding: 16px 20px; border-radius: 8px; color: white;">
            <p style="font-size: 13px; margin: 0; line-height: 1.5;">
                <strong>Key Insight:</strong> ${companyName} clients consistently outperform industry averages across all measured dimensions,
                with particularly strong results in cost reduction (+20pp) and time to ROI (-8 months faster).
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 6 }
    ));

    // Slide 7: Implementation Timeline with Milestones
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Implementation Timeline
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 24px; line-height: 1.5;">
            Phased implementation approach designed to minimize disruption while accelerating time to value for ${businessName}.
        </p>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
            ${[
                { phase: 'Discovery', weeks: '1-2', tasks: ['Requirements analysis', 'Baseline metrics', 'Integration planning'], milestone: 'Project charter signed' },
                { phase: 'Implementation', weeks: '3-6', tasks: ['System deployment', 'Data migration', 'Team training'], milestone: 'Go-live readiness' },
                { phase: 'Optimization', weeks: '7-10', tasks: ['Performance tuning', 'Process refinement', 'Advanced features'], milestone: 'Target KPIs achieved' },
                { phase: 'Steady State', weeks: '11+', tasks: ['Ongoing support', 'Quarterly reviews', 'Continuous improvement'], milestone: 'Full value realization' }
            ].map((p, i) => `
                <div style="background: ${i === 0 ? CONFIG.colors.primary : CONFIG.colors.tableStripe}; color: ${i === 0 ? 'white' : CONFIG.colors.text}; padding: 18px; border-radius: 8px; ${i > 0 ? `border-top: 3px solid ${CONFIG.colors.primary};` : ''}">
                    <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: ${i === 0 ? '0.9' : '0.7'}; margin-bottom: 6px;">Week ${p.weeks}</div>
                    <div style="font-size: 15px; font-weight: 700; margin-bottom: 10px;">${p.phase}</div>
                    <ul style="font-size: 11px; opacity: 0.9; line-height: 1.5; padding-left: 14px; margin: 0 0 12px 0;">
                        ${p.tasks.map(t => `<li style="margin-bottom: 3px;">${t}</li>`).join('')}
                    </ul>
                    <div style="font-size: 10px; padding-top: 10px; border-top: 1px solid ${i === 0 ? 'rgba(255,255,255,0.3)' : '#e5e7eb'};">
                        <strong>Milestone:</strong> ${p.milestone}
                    </div>
                </div>
            `).join('')}
        </div>
        <div style="background: ${CONFIG.colors.tableStripe}; padding: 14px 18px; border-radius: 6px;">
            <p style="font-size: 12px; color: ${CONFIG.colors.text}; margin: 0;">
                <strong>Expected Outcome:</strong> First measurable results within 4-6 weeks, full value realization by month ${paybackMonths}.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 7 }
    ));

    // Slide 8: Risk Assessment with Mitigations
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text};">
            Risk Assessment & Mitigation
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 20px; line-height: 1.5;">
            Comprehensive risk analysis with proven mitigation strategies based on 500+ comparable implementations.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-family: ${CONFIG.fonts.body}; font-size: 12px;">
            <thead>
                <tr style="background: ${CONFIG.colors.tableHeader}; color: white;">
                    <th style="padding: 10px 12px; text-align: left; font-weight: 600;">Risk Factor</th>
                    <th style="padding: 10px 12px; text-align: center; font-weight: 600; width: 80px;">Likelihood</th>
                    <th style="padding: 10px 12px; text-align: center; font-weight: 600; width: 80px;">Impact</th>
                    <th style="padding: 10px 12px; text-align: left; font-weight: 600;">Mitigation Strategy</th>
                </tr>
            </thead>
            <tbody>
                ${[
                    { risk: 'Timeline delays', likelihood: 'Low', impact: 'Medium', mitigation: 'Phased rollout with built-in contingency; parallel workstreams reduce critical path risk' },
                    { risk: 'User adoption challenges', likelihood: 'Medium', impact: 'High', mitigation: 'Comprehensive training program; executive sponsorship; change management support' },
                    { risk: 'Data migration issues', likelihood: 'Low', impact: 'Medium', mitigation: 'Pre-validated migration scripts; parallel run period; rollback procedures' },
                    { risk: 'Scope expansion', likelihood: 'Medium', impact: 'Medium', mitigation: 'Fixed scope agreement with formal change control process' }
                ].map((row, i) => `
                    <tr style="background: ${i % 2 === 0 ? 'white' : CONFIG.colors.tableStripe};">
                        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${row.risk}</td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            <span style="background: ${row.likelihood === 'Low' ? '#dcfce7' : '#fef3c7'}; color: ${row.likelihood === 'Low' ? '#166534' : '#92400e'}; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${row.likelihood}</span>
                        </td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            <span style="background: ${row.impact === 'Low' ? '#dcfce7' : row.impact === 'Medium' ? '#fef3c7' : '#fee2e2'}; color: ${row.impact === 'Low' ? '#166534' : row.impact === 'Medium' ? '#92400e' : '#991b1b'}; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${row.impact}</span>
                        </td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: ${CONFIG.colors.textLight}; font-size: 11px;">${row.mitigation}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="margin-top: 16px; background: #dcfce7; padding: 12px 16px; border-radius: 6px; border-left: 3px solid #166534;">
            <p style="font-size: 12px; color: #166534; margin: 0;">
                <strong>Overall Risk Rating: LOW</strong> — All identified risks have proven mitigation strategies with high success rates in comparable engagements.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 8 }
    ));

    // Slide 9: Investment Summary
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 8px; color: ${CONFIG.colors.text}; text-align: center;">
            Investment Summary
        </h2>
        <p style="font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight}; margin-bottom: 32px; line-height: 1.5; text-align: center; max-width: 700px; margin-left: auto; margin-right: auto;">
            Consolidated view of the investment opportunity for ${businessName}, demonstrating compelling returns with manageable risk.
        </p>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 32px;">
            <div style="background: linear-gradient(135deg, ${CONFIG.colors.primary} 0%, ${CONFIG.colors.secondary} 100%); padding: 28px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; margin-bottom: 8px;">Initial Investment</div>
                <div style="font-size: 36px; font-weight: 700; line-height: 1;">${formatCurrency(year1Investment)}</div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">One-time implementation</div>
            </div>
            <div style="background: linear-gradient(135deg, ${CONFIG.colors.accent} 0%, #0d9488 100%); padding: 28px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; margin-bottom: 8px;">3-Year Value</div>
                <div style="font-size: 36px; font-weight: 700; line-height: 1;">${formatCurrency(threeYearTotal)}</div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">Total projected return</div>
            </div>
            <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 28px; border-radius: 12px; text-align: center; color: white;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; margin-bottom: 8px;">3-Year ROI</div>
                <div style="font-size: 36px; font-weight: 700; line-height: 1;">${Math.round(threeYearTotal / year1Investment * 100)}%</div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">Return on investment</div>
            </div>
        </div>
        <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px;">
            <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 12px;">Recommendation</h4>
            <p style="font-size: 14px; color: ${CONFIG.colors.text}; line-height: 1.6; margin: 0;">
                Based on quantitative analysis, ${businessName} should proceed with this investment. The ${formatCurrency(year1Investment)} initial investment
                generates ${formatCurrency(threeYearTotal)} in value over three years—a ${roiMultiple}x return with payback achieved in just ${paybackMonths} months.
            </p>
        </div>
        `,
        { config: CONFIG, slideNumber: 9 }
    ));

    // Slide 10: Next Steps
    slides.push(slideWrapper(
        `
        <div style="text-align: center; max-width: 700px; margin: 0 auto;">
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 16px; color: ${CONFIG.colors.text};">
                Recommended Next Steps
            </h2>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 15px; color: ${CONFIG.colors.textLight}; margin-bottom: 32px; line-height: 1.6;">
                Schedule a detailed analysis session to validate assumptions, customize projections for ${businessName}'s specific situation, and finalize the engagement scope.
            </p>
            <div style="display: flex; flex-direction: column; gap: 12px; text-align: left; margin-bottom: 32px;">
                ${[
                    'Review and validate key assumptions in this analysis',
                    'Conduct detailed discovery session with stakeholders',
                    'Finalize scope, timeline, and commercial terms',
                    'Initiate Phase 1 Discovery activities'
                ].map((step, i) => `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: ${CONFIG.colors.tableStripe}; border-radius: 6px;">
                        <span style="width: 28px; height: 28px; background: ${CONFIG.colors.primary}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0;">${i + 1}</span>
                        <span style="font-size: 14px; color: ${CONFIG.colors.text};">${step}</span>
                    </div>
                `).join('')}
            </div>
            <a href="${ctaUrl}" style="
                display: inline-block;
                background: ${CONFIG.colors.primary};
                color: white;
                padding: 16px 40px;
                border-radius: 8px;
                font-family: ${CONFIG.fonts.body};
                font-size: 15px;
                font-weight: 600;
                text-decoration: none;
            ">Schedule Analysis Review</a>
            <div style="margin-top: 32px; font-family: ${CONFIG.fonts.body}; font-size: 13px; color: ${CONFIG.colors.textLight};">
                ${companyName} | ${contactEmail}
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 10 }
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
    <title>${businessName} - Investment Analysis | ${companyName}</title>
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
