/**
 * Bold Creative Style - L3 Slide Deck
 *
 * High-energy, startup pitch deck vibes. Dark backgrounds with bright gradients,
 * large bold typography, dynamic layouts. Think Y Combinator Demo Day.
 *
 * @module pitch/level3Styles/boldCreative
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');
const {
    getConfig,
    slideWrapper
} = require('./sharedSlides');

const CONFIG = getConfig('bold_creative');

/**
 * Create gradient text style
 */
function gradientText(text, size = 48) {
    return `
        <span style="
            font-family: ${CONFIG.fonts.heading};
            font-size: ${size}px;
            font-weight: 900;
            background: linear-gradient(135deg, ${CONFIG.colors.primary} 0%, ${CONFIG.colors.secondary} 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        ">${text}</span>
    `;
}

/**
 * Generate Bold Creative style L3 slide deck
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

    // Slide 1: Hero Title (Gradient Background)
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
            color: white;
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; opacity: 0.9; margin-bottom: 24px;">
                ${companyName} presents
            </div>
            <h1 style="font-family: ${CONFIG.fonts.heading}; font-size: 64px; font-weight: 900; line-height: 1.1; margin-bottom: 24px; text-transform: uppercase;">
                ${businessName}
            </h1>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 24px; opacity: 0.9; max-width: 600px;">
                The future of ${industry}
            </p>
            <div style="position: absolute; bottom: 40px; font-size: 14px; opacity: 0.7;">
                ${new Date().toLocaleDateString()}
            </div>
        </div>
    `);

    // Slide 2: The Problem (Big Statement)
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.secondary}; margin-bottom: 32px;">
                The Problem
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 52px; font-weight: 900; line-height: 1.2; max-width: 800px;">
                ${inputs.statedProblem || `The ${industry} industry is ripe for disruption.`}
            </h2>
            <div style="margin-top: 48px; display: flex; gap: 48px;">
                ${[
                    { icon: '⚡', text: 'Slow processes' },
                    { icon: '💸', text: 'High costs' },
                    { icon: '😤', text: 'Poor experience' }
                ].map(item => `
                    <div style="text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 8px;">${item.icon}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight};">${item.text}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">2 / 10</div>
        </div>
    `);

    // Slide 3: The Solution (Gradient accent)
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.primary}; margin-bottom: 32px;">
                Our Solution
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 48px; font-weight: 900; line-height: 1.2; margin-bottom: 40px;">
                ${gradientText(companyName, 56)} delivers results.
            </h2>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; max-width: 900px;">
                ${[
                    { title: 'Fast', desc: 'Automated workflows that run 10x faster than manual processes', icon: '🚀' },
                    { title: 'Smart', desc: 'AI-powered insights that drive better business decisions', icon: '🧠' },
                    { title: 'Simple', desc: 'Intuitive interface that anyone can use from day one', icon: '✨' }
                ].map(card => `
                    <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: left;">
                        <div style="font-size: 40px; margin-bottom: 16px;">${card.icon}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 24px; font-weight: 700; margin-bottom: 12px;">${card.title}</div>
                        <div style="font-size: 15px; color: ${CONFIG.colors.textLight}; line-height: 1.5;">${card.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">3 / 10</div>
        </div>
    `);

    // Slide 4: Big Number Impact
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
            color: white;
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; opacity: 0.9; margin-bottom: 24px;">
                The Opportunity
            </div>
            <div style="font-family: ${CONFIG.fonts.heading}; font-size: 120px; font-weight: 900; line-height: 1;">
                ${formatCurrency(annualImpact)}
            </div>
            <div style="font-size: 28px; margin-top: 16px; opacity: 0.9;">
                annual impact for ${businessName}
            </div>
            <div style="margin-top: 48px; display: flex; gap: 64px;">
                <div>
                    <div style="font-size: 48px; font-weight: 900;">${costReduction}%</div>
                    <div style="font-size: 14px; opacity: 0.8;">cost reduction</div>
                </div>
                <div>
                    <div style="font-size: 48px; font-weight: 900;">${paybackMonths}mo</div>
                    <div style="font-size: 14px; opacity: 0.8;">to full ROI</div>
                </div>
                <div>
                    <div style="font-size: 48px; font-weight: 900;">${roiMultiple}x</div>
                    <div style="font-size: 14px; opacity: 0.8;">return multiple</div>
                </div>
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; opacity: 0.7;">4 / 10</div>
        </div>
    `);

    // Slide 5: How It Works
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            padding: 60px 80px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.accent}; margin-bottom: 24px;">
                How It Works
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; margin-bottom: 48px;">
                Three simple steps to transform ${businessName}
            </h2>
            <div style="display: flex; gap: 32px;">
                ${[
                    { num: '01', title: 'Connect', desc: 'Seamlessly integrate with your existing tools and data sources in minutes' },
                    { num: '02', title: 'Analyze', desc: 'Our AI processes your data to identify opportunities and optimize operations' },
                    { num: '03', title: 'Grow', desc: 'Watch your efficiency soar and costs drop while you focus on what matters' }
                ].map((step, i) => `
                    <div style="flex: 1; position: relative;">
                        <div style="
                            font-family: ${CONFIG.fonts.heading};
                            font-size: 80px;
                            font-weight: 900;
                            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            line-height: 1;
                            margin-bottom: 16px;
                        ">${step.num}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 24px; font-weight: 700; margin-bottom: 12px;">${step.title}</div>
                        <div style="font-size: 15px; color: ${CONFIG.colors.textLight}; line-height: 1.6;">${step.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">5 / 10</div>
        </div>
    `);

    // Slide 6: Market Position
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            padding: 60px 80px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.secondary}; margin-bottom: 24px;">
                Your Position
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; margin-bottom: 48px;">
                ${businessName} is already winning
            </h2>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px;">
                <div style="background: rgba(255,255,255,0.05); border-radius: 20px; padding: 40px;">
                    <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">Customer Rating</div>
                    <div style="display: flex; align-items: baseline; gap: 16px;">
                        <span style="font-family: ${CONFIG.fonts.heading}; font-size: 72px; font-weight: 900; color: ${CONFIG.colors.accent};">${googleRating}</span>
                        <span style="font-size: 24px; color: ${CONFIG.colors.textLight};">/ 5.0</span>
                    </div>
                    <div style="font-size: 16px; color: ${CONFIG.colors.textLight}; margin-top: 8px;">Based on ${numReviews} reviews</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); border-radius: 20px; padding: 40px;">
                    <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">Sentiment Analysis</div>
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Positive</span>
                            <span style="color: #10b981; font-weight: 700;">${sentiment.positive}%</span>
                        </div>
                        <div style="height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.positive}%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 6px;"></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Neutral</span>
                            <span style="color: ${CONFIG.colors.accent}; font-weight: 700;">${sentiment.neutral}%</span>
                        </div>
                        <div style="height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.neutral}%; background: linear-gradient(90deg, #f59e0b, #fbbf24); border-radius: 6px;"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">6 / 10</div>
        </div>
    `);

    // Slide 7: Value Stack
    const valueDrivers = [
        { name: 'Operational Efficiency', value: Math.round(annualImpact * 0.35), pct: 35 },
        { name: 'Cost Reduction', value: Math.round(annualImpact * 0.30), pct: 30 },
        { name: 'Revenue Growth', value: Math.round(annualImpact * 0.25), pct: 25 },
        { name: 'Risk Mitigation', value: Math.round(annualImpact * 0.10), pct: 10 }
    ];

    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            padding: 60px 80px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.primary}; margin-bottom: 24px;">
                Value Breakdown
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; margin-bottom: 48px;">
                Where the ${formatCurrency(annualImpact)} comes from
            </h2>
            <div style="display: flex; flex-direction: column; gap: 24px;">
                ${valueDrivers.map((driver, i) => `
                    <div style="display: flex; align-items: center; gap: 24px;">
                        <div style="width: 200px; font-size: 18px; font-weight: 600;">${driver.name}</div>
                        <div style="flex: 1; height: 40px; background: rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; position: relative;">
                            <div style="
                                height: 100%;
                                width: ${driver.pct}%;
                                background: linear-gradient(90deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                                border-radius: 8px;
                                display: flex;
                                align-items: center;
                                padding-left: 16px;
                            ">
                                <span style="font-weight: 700; font-size: 14px;">${driver.pct}%</span>
                            </div>
                        </div>
                        <div style="width: 100px; text-align: right; font-family: ${CONFIG.fonts.heading}; font-size: 20px; font-weight: 700; color: ${CONFIG.colors.accent};">
                            ${formatCurrency(driver.value)}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">7 / 10</div>
        </div>
    `);

    // Slide 8: Social Proof / Results
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.secondary}; margin-bottom: 24px;">
                Proven Results
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; margin-bottom: 48px;">
                Clients love what we deliver
            </h2>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; max-width: 900px;">
                ${[
                    { value: '98%', label: 'Client Satisfaction' },
                    { value: '47%', label: 'Avg Cost Reduction' },
                    { value: '4.2mo', label: 'Avg Payback' },
                    { value: '500+', label: 'Clients Served' }
                ].map(stat => `
                    <div style="background: rgba(255,255,255,0.05); border-radius: 16px; padding: 32px 20px;">
                        <div style="
                            font-family: ${CONFIG.fonts.heading};
                            font-size: 40px;
                            font-weight: 900;
                            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            margin-bottom: 8px;
                        ">${stat.value}</div>
                        <div style="font-size: 13px; color: ${CONFIG.colors.textLight};">${stat.label}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">8 / 10</div>
        </div>
    `);

    // Slide 9: Timeline
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
            padding: 60px 80px;
            position: relative;
        ">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: ${CONFIG.colors.accent}; margin-bottom: 24px;">
                Getting Started
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; margin-bottom: 48px;">
                From kickoff to results in weeks
            </h2>
            <div style="display: flex; gap: 24px;">
                ${[
                    { week: 'Week 1-2', title: 'Discovery', desc: 'Deep dive into your operations and define success metrics', color: CONFIG.colors.primary },
                    { week: 'Week 3-6', title: 'Implementation', desc: 'Deploy solution, integrate systems, train your team', color: CONFIG.colors.secondary },
                    { week: 'Week 7-10', title: 'Optimization', desc: 'Fine-tune performance and maximize ROI', color: CONFIG.colors.accent },
                    { week: 'Week 11+', title: 'Scale', desc: 'Continuous improvement and expanded capabilities', color: '#10b981' }
                ].map((phase, i) => `
                    <div style="flex: 1; background: linear-gradient(180deg, ${phase.color}22 0%, transparent 100%); border-radius: 16px; padding: 28px; border-top: 4px solid ${phase.color};">
                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${phase.color}; margin-bottom: 12px;">${phase.week}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; font-weight: 700; margin-bottom: 12px;">${phase.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.5;">${phase.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">9 / 10</div>
        </div>
    `);

    // Slide 10: CTA (Full Gradient)
    slides.push(`
        <div class="slide" style="
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
            color: white;
            text-align: center;
            padding: 60px;
            position: relative;
        ">
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 56px; font-weight: 900; line-height: 1.1; margin-bottom: 24px; text-transform: uppercase;">
                Let's Build<br/>Something Amazing
            </h2>
            <p style="font-size: 20px; opacity: 0.9; margin-bottom: 40px; max-width: 500px;">
                Ready to transform ${businessName} and unlock ${formatCurrency(annualImpact)} in annual value?
            </p>
            <a href="${ctaUrl}" style="
                display: inline-block;
                background: ${CONFIG.colors.accent};
                color: ${CONFIG.colors.background};
                padding: 18px 48px;
                border-radius: 12px;
                font-family: ${CONFIG.fonts.heading};
                font-size: 18px;
                font-weight: 700;
                text-decoration: none;
                text-transform: uppercase;
                letter-spacing: 1px;
            ">${bookingUrl ? 'Book Your Demo' : 'Get Started Now'}</a>
            <div style="margin-top: 48px; opacity: 0.8;">
                <p style="font-size: 16px;">${companyName}</p>
                <p style="font-size: 14px; margin-top: 4px;">${contactEmail}</p>
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; opacity: 0.7;">10 / 10</div>
        </div>
    `);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Bold Creative | ${companyName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ${CONFIG.fonts.body};
            background: ${CONFIG.colors.background};
            color: ${CONFIG.colors.text};
        }
        @media print {
            .slide { page-break-after: always; height: 100vh; }
        }
    </style>
</head>
<body>
    ${slides.join('')}
</body>
</html>`;
}

module.exports = { generate };
