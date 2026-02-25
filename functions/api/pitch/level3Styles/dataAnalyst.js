/**
 * Data Analyst Style - L3 Slide Deck
 *
 * Dense, information-rich. Charts, tables, metrics grids.
 * Dark blue/gray color scheme. Every slide has data.
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

    // Build slides
    const slides = [];

    // Slide 1: Title
    slides.push(slideWrapper(
        titleSlide(businessName, 'Investment Analysis', {
            config: CONFIG,
            prepared: `${companyName} | Data-Driven Insights | ${new Date().toLocaleDateString()}`
        }),
        { config: CONFIG, showNumber: false }
    ));

    // Slide 2: Executive Summary Metrics
    slides.push(slideWrapper(
        metricsSlide('Key Metrics Summary', [
            { value: formatCurrency(annualImpact), label: 'Annual Impact' },
            { value: `${costReduction}%`, label: 'Cost Reduction' },
            { value: `${paybackMonths}mo`, label: 'Payback Period' },
            { value: `${roiMultiple}x`, label: 'ROI Multiple' }
        ], { config: CONFIG }),
        { config: CONFIG, slideNumber: 2 }
    ));

    // Slide 3: Market Position Analysis
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 24px; color: ${CONFIG.colors.text};">
            Market Position Analysis
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
            <div>
                <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Current Performance</h4>
                <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Google Rating</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.primary};">${googleRating} / 5.0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Total Reviews</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.primary};">${numReviews}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        <span>Positive Sentiment</span>
                        <span style="font-weight: 700; color: ${CONFIG.colors.accent};">${sentiment.positive}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                        <span>Industry</span>
                        <span style="font-weight: 600;">${industry}</span>
                    </div>
                </div>
            </div>
            <div>
                <h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${CONFIG.colors.textLight}; margin-bottom: 16px;">Sentiment Distribution</h4>
                <div style="background: ${CONFIG.colors.tableStripe}; padding: 20px; border-radius: 8px;">
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-size: 13px;">Positive</span>
                            <span style="font-size: 13px; font-weight: 600; color: #10b981;">${sentiment.positive}%</span>
                        </div>
                        <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.positive}%; background: #10b981;"></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-size: 13px;">Neutral</span>
                            <span style="font-size: 13px; font-weight: 600; color: #f59e0b;">${sentiment.neutral}%</span>
                        </div>
                        <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.neutral}%; background: #f59e0b;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-size: 13px;">Negative</span>
                            <span style="font-size: 13px; font-weight: 600; color: #ef4444;">${sentiment.negative}%</span>
                        </div>
                        <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.negative}%; background: #ef4444;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `,
        { config: CONFIG, slideNumber: 3 }
    ));

    // Slide 4: Financial Model
    const year1Investment = Math.round(annualImpact * 0.3);
    const year1Return = Math.round(annualImpact * 0.7);
    const year2Return = annualImpact;
    const year3Return = Math.round(annualImpact * 1.15);

    slides.push(slideWrapper(
        tableSlide('Financial Model',
            ['Period', 'Investment', 'Return', 'Net Impact', 'Cumulative'],
            [
                ['Year 1', formatCurrency(year1Investment), formatCurrency(year1Return), formatCurrency(year1Return - year1Investment), formatCurrency(year1Return - year1Investment)],
                ['Year 2', formatCurrency(Math.round(year1Investment * 0.3)), formatCurrency(year2Return), formatCurrency(year2Return - Math.round(year1Investment * 0.3)), formatCurrency((year1Return - year1Investment) + (year2Return - Math.round(year1Investment * 0.3)))],
                ['Year 3', formatCurrency(Math.round(year1Investment * 0.3)), formatCurrency(year3Return), formatCurrency(year3Return - Math.round(year1Investment * 0.3)), formatCurrency((year1Return - year1Investment) + (year2Return - Math.round(year1Investment * 0.3)) + (year3Return - Math.round(year1Investment * 0.3)))]
            ],
            { config: CONFIG }
        ),
        { config: CONFIG, slideNumber: 4 }
    ));

    // Slide 5: Value Drivers Breakdown
    const valueDrivers = [
        { driver: 'Operational Efficiency', impact: Math.round(annualImpact * 0.35), pct: '35%' },
        { driver: 'Cost Reduction', impact: Math.round(annualImpact * 0.30), pct: '30%' },
        { driver: 'Revenue Growth', impact: Math.round(annualImpact * 0.25), pct: '25%' },
        { driver: 'Risk Mitigation', impact: Math.round(annualImpact * 0.10), pct: '10%' }
    ];

    slides.push(slideWrapper(
        tableSlide('Value Drivers Analysis',
            ['Value Driver', 'Annual Impact', 'Contribution'],
            valueDrivers.map(v => [v.driver, formatCurrency(v.impact), v.pct]),
            { config: CONFIG }
        ),
        { config: CONFIG, slideNumber: 5 }
    ));

    // Slide 6: Comparable Analysis
    slides.push(slideWrapper(
        tableSlide('Comparable Client Results',
            ['Metric', 'Industry Avg', 'Our Clients', 'Delta'],
            [
                ['Cost Reduction', '15-20%', '35-45%', '+20pp'],
                ['Payback Period', '12-18mo', '4-8mo', '-8mo'],
                ['Customer Satisfaction', '72%', '94%', '+22pp'],
                ['Operational Efficiency', '+15%', '+42%', '+27pp']
            ],
            { config: CONFIG }
        ),
        { config: CONFIG, slideNumber: 6 }
    ));

    // Slide 7: Implementation Timeline
    slides.push(slideWrapper(
        `
        <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: ${CONFIG.fonts.headingSize}px; font-weight: 700; margin-bottom: 32px; color: ${CONFIG.colors.text};">
            Implementation Timeline
        </h2>
        <div style="display: flex; gap: 16px;">
            ${[
                { phase: 'Discovery', weeks: '1-2', tasks: 'Requirements, baseline metrics, integration planning' },
                { phase: 'Implementation', weeks: '3-6', tasks: 'System setup, data migration, training' },
                { phase: 'Optimization', weeks: '7-10', tasks: 'Performance tuning, workflow refinement' },
                { phase: 'Steady State', weeks: '11+', tasks: 'Ongoing support, continuous improvement' }
            ].map((p, i) => `
                <div style="flex: 1; background: ${i === 0 ? CONFIG.colors.primary : CONFIG.colors.tableStripe}; color: ${i === 0 ? 'white' : CONFIG.colors.text}; padding: 20px; border-radius: 8px;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-bottom: 8px;">Week ${p.weeks}</div>
                    <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${p.phase}</div>
                    <div style="font-size: 12px; opacity: 0.85; line-height: 1.4;">${p.tasks}</div>
                </div>
            `).join('')}
        </div>
        `,
        { config: CONFIG, slideNumber: 7 }
    ));

    // Slide 8: Risk Assessment
    slides.push(slideWrapper(
        tableSlide('Risk Assessment Matrix',
            ['Risk Factor', 'Likelihood', 'Impact', 'Mitigation'],
            [
                ['Integration delays', 'Low', 'Medium', 'Phased rollout approach'],
                ['User adoption', 'Medium', 'High', 'Comprehensive training program'],
                ['Data migration', 'Low', 'Medium', 'Validated migration scripts'],
                ['Scope creep', 'Medium', 'Medium', 'Fixed scope with change control']
            ],
            { config: CONFIG }
        ),
        { config: CONFIG, slideNumber: 8 }
    ));

    // Slide 9: Investment Summary
    slides.push(slideWrapper(
        metricsSlide('Investment Summary', [
            { value: formatCurrency(year1Investment), label: 'Total Investment' },
            { value: formatCurrency(annualImpact * 3), label: '3-Year Value' },
            { value: `${Math.round((annualImpact * 3) / year1Investment * 100)}%`, label: '3-Year ROI' }
        ], { config: CONFIG, columns: 3 }),
        { config: CONFIG, slideNumber: 9 }
    ));

    // Slide 10: Next Steps
    slides.push(slideWrapper(
        ctaSlide(
            'Recommended Next Steps',
            'Schedule a deep-dive session to review methodology and customize projections.',
            `${companyName} | ${contactEmail}`,
            { config: CONFIG, buttonText: 'Schedule Analysis Review', buttonUrl: ctaUrl }
        ),
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
    <title>${businessName} - Data Analysis | ${companyName}</title>
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
