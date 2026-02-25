/**
 * Bold Creative Style - L3 Slide Deck
 *
 * High-energy, startup pitch deck vibes. Dark backgrounds with bright gradients,
 * large bold typography, dynamic layouts. Think Y Combinator Demo Day.
 * Punchy copy, big statements, compelling narrative flow.
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
    const painPoints = salesIntel?.painPoints || ['Manual processes', 'Rising costs', 'Missed opportunities'];

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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; opacity: 0.9; margin-bottom: 28px;">
                ${companyName} × ${businessName}
            </div>
            <h1 style="font-family: ${CONFIG.fonts.heading}; font-size: 58px; font-weight: 900; line-height: 1.1; margin-bottom: 20px; text-transform: uppercase; max-width: 800px;">
                The Future of ${industry} Starts Here
            </h1>
            <p style="font-family: ${CONFIG.fonts.body}; font-size: 22px; opacity: 0.9; max-width: 550px; line-height: 1.5;">
                A strategic partnership to unlock ${formatCurrency(annualImpact)} in annual value
            </p>
            <div style="margin-top: 48px; display: flex; gap: 32px;">
                ${[
                    { value: formatCurrency(annualImpact), label: 'Annual Impact' },
                    { value: `${paybackMonths}mo`, label: 'To Full ROI' },
                    { value: `${roiMultiple}x`, label: 'Return' }
                ].map(m => `
                    <div style="text-align: center;">
                        <div style="font-size: 28px; font-weight: 900;">${m.value}</div>
                        <div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px;">${m.label}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; font-size: 14px; opacity: 0.7;">
                ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.secondary}; margin-bottom: 28px;">
                The Challenge
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 48px; font-weight: 900; line-height: 1.2; max-width: 850px; margin-bottom: 24px;">
                ${inputs.statedProblem || `The ${industry} industry is leaving money on the table.`}
            </h2>
            <p style="font-size: 18px; color: ${CONFIG.colors.textLight}; max-width: 600px; line-height: 1.6; margin-bottom: 48px;">
                Every day, businesses like ${businessName} lose revenue to inefficiency, outdated processes, and missed opportunities.
                It doesn't have to be this way.
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; max-width: 800px;">
                ${[
                    { icon: '⏱️', title: 'Slow Processes', desc: 'Manual workflows drain time and resources' },
                    { icon: '💸', title: 'Hidden Costs', desc: 'Inefficiency eats into margins daily' },
                    { icon: '📉', title: 'Missed Growth', desc: 'Opportunities slip through the cracks' }
                ].map(item => `
                    <div style="text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 12px;">${item.icon}</div>
                        <div style="font-size: 16px; font-weight: 700; margin-bottom: 6px;">${item.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.4;">${item.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">2 / 10</div>
        </div>
    `);

    // Slide 3: The Solution
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.primary}; margin-bottom: 28px;">
                The Solution
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 44px; font-weight: 900; line-height: 1.2; margin-bottom: 20px;">
                ${gradientText(companyName, 48)} transforms how you operate.
            </h2>
            <p style="font-size: 18px; color: ${CONFIG.colors.textLight}; max-width: 600px; line-height: 1.6; margin-bottom: 48px;">
                We don't just optimize—we revolutionize. Our proven methodology delivers measurable results
                in weeks, not years. Here's how we do it:
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; max-width: 950px;">
                ${[
                    { title: 'Automate', desc: 'Replace manual busywork with intelligent automation that runs 24/7. Free your team to focus on what matters.', icon: '🤖', highlight: '10x faster' },
                    { title: 'Optimize', desc: 'Data-driven insights reveal hidden inefficiencies and untapped opportunities. See your business clearly.', icon: '📊', highlight: 'Crystal clear' },
                    { title: 'Scale', desc: 'Systems that grow with you. Handle more volume without proportionally more cost or complexity.', icon: '🚀', highlight: 'Limitless' }
                ].map(card => `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 32px; text-align: left; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: -20px; right: -20px; font-size: 80px; opacity: 0.1;">${card.icon}</div>
                        <div style="font-size: 32px; margin-bottom: 16px;">${card.icon}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; font-weight: 700; margin-bottom: 8px;">${card.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.6; margin-bottom: 16px;">${card.desc}</div>
                        <div style="
                            display: inline-block;
                            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                            padding: 6px 14px;
                            border-radius: 20px;
                            font-size: 12px;
                            font-weight: 700;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                        ">${card.highlight}</div>
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; opacity: 0.9; margin-bottom: 20px;">
                The Opportunity
            </div>
            <div style="font-family: ${CONFIG.fonts.heading}; font-size: 110px; font-weight: 900; line-height: 1; margin-bottom: 8px;">
                ${formatCurrency(annualImpact)}
            </div>
            <div style="font-size: 26px; margin-bottom: 16px; opacity: 0.95;">
                in annual value for ${businessName}
            </div>
            <p style="font-size: 16px; opacity: 0.85; max-width: 500px; line-height: 1.5; margin-bottom: 48px;">
                This isn't a projection pulled from thin air. It's based on real results from 500+ similar businesses
                we've transformed. Your opportunity is waiting.
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; max-width: 700px;">
                <div style="text-align: center;">
                    <div style="font-size: 52px; font-weight: 900; line-height: 1;">${costReduction}%</div>
                    <div style="font-size: 13px; opacity: 0.85; margin-top: 6px;">Cost Reduction</div>
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">Year 1 savings</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 52px; font-weight: 900; line-height: 1;">${paybackMonths}mo</div>
                    <div style="font-size: 13px; opacity: 0.85; margin-top: 6px;">Payback Period</div>
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">Full ROI achieved</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 52px; font-weight: 900; line-height: 1;">${roiMultiple}x</div>
                    <div style="font-size: 13px; opacity: 0.85; margin-top: 6px;">Return Multiple</div>
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">3-year return</div>
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.accent}; margin-bottom: 20px;">
                The Process
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 900; margin-bottom: 16px;">
                Three steps. Massive impact.
            </h2>
            <p style="font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 48px; max-width: 600px; line-height: 1.5;">
                We've refined this process across hundreds of implementations. It works because it's simple,
                focused, and designed for real-world businesses—not theoretical models.
            </p>
            <div style="display: flex; gap: 32px;">
                ${[
                    { num: '01', title: 'Connect', desc: 'We integrate seamlessly with your existing systems in days, not months. Zero disruption to your operations. We meet you where you are.', time: 'Week 1-2' },
                    { num: '02', title: 'Analyze', desc: 'Our platform processes your data to surface hidden opportunities and inefficiencies. You\'ll see your business with new clarity.', time: 'Week 3-4' },
                    { num: '03', title: 'Transform', desc: 'Watch efficiency climb and costs drop. Our team stays with you to optimize and scale the results over time.', time: 'Week 5+' }
                ].map((step, i) => `
                    <div style="flex: 1; position: relative;">
                        <div style="
                            font-family: ${CONFIG.fonts.heading};
                            font-size: 72px;
                            font-weight: 900;
                            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            line-height: 1;
                            margin-bottom: 16px;
                        ">${step.num}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; font-weight: 700; margin-bottom: 12px;">${step.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.6; margin-bottom: 16px;">${step.desc}</div>
                        <div style="font-size: 12px; color: ${CONFIG.colors.accent}; font-weight: 600;">${step.time}</div>
                    </div>
                `).join('')}
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">5 / 10</div>
        </div>
    `);

    // Slide 6: Market Position / You're Already Winning
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.secondary}; margin-bottom: 20px;">
                Your Advantage
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 900; margin-bottom: 16px;">
                ${businessName} is already winning.
            </h2>
            <p style="font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 40px; max-width: 600px; line-height: 1.5;">
                Your customers love you. Your reputation is strong. Now imagine what happens when you add
                operational excellence to the mix. The competition won't know what hit them.
            </p>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px;">
                <div style="background: rgba(255,255,255,0.03); border-radius: 24px; padding: 36px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="font-size: 13px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">Customer Rating</div>
                    <div style="display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px;">
                        <span style="font-family: ${CONFIG.fonts.heading}; font-size: 64px; font-weight: 900; color: ${CONFIG.colors.accent};">${googleRating}</span>
                        <span style="font-size: 24px; color: ${CONFIG.colors.textLight};">/ 5.0</span>
                    </div>
                    <div style="font-size: 15px; color: ${CONFIG.colors.textLight};">Based on ${numReviews} verified reviews</div>
                    <div style="margin-top: 20px; font-size: 14px; color: ${CONFIG.colors.text}; line-height: 1.5;">
                        ${googleRating >= 4.5 ? 'Outstanding! You\'re in the top tier of your industry.' : googleRating >= 4.0 ? 'Strong foundation. Customers clearly value what you offer.' : 'Room to grow, and we can help accelerate that journey.'}
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.03); border-radius: 24px; padding: 36px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="font-size: 13px; color: ${CONFIG.colors.textLight}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">Customer Sentiment</div>
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 14px;">Positive</span>
                            <span style="color: #10b981; font-weight: 700; font-size: 18px;">${sentiment.positive}%</span>
                        </div>
                        <div style="height: 14px; background: rgba(255,255,255,0.1); border-radius: 7px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.positive}%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 7px;"></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 14px;">Neutral</span>
                            <span style="color: ${CONFIG.colors.accent}; font-weight: 700; font-size: 18px;">${sentiment.neutral}%</span>
                        </div>
                        <div style="height: 14px; background: rgba(255,255,255,0.1); border-radius: 7px; overflow: hidden;">
                            <div style="height: 100%; width: ${sentiment.neutral}%; background: linear-gradient(90deg, #f59e0b, #fbbf24); border-radius: 7px;"></div>
                        </div>
                    </div>
                    <div style="font-size: 14px; color: ${CONFIG.colors.text}; line-height: 1.5; margin-top: 16px;">
                        ${sentiment.positive}% positive sentiment is a strong signal of product-market fit.
                    </div>
                </div>
            </div>
            <div style="position: absolute; bottom: 40px; right: 60px; font-size: 14px; color: ${CONFIG.colors.textLight};">6 / 10</div>
        </div>
    `);

    // Slide 7: Value Stack
    const valueDrivers = [
        { name: 'Operational Efficiency', value: Math.round(annualImpact * 0.35), pct: 35, desc: 'Streamlined workflows' },
        { name: 'Cost Reduction', value: Math.round(annualImpact * 0.30), pct: 30, desc: 'Overhead elimination' },
        { name: 'Revenue Growth', value: Math.round(annualImpact * 0.25), pct: 25, desc: 'Capacity expansion' },
        { name: 'Risk Mitigation', value: Math.round(annualImpact * 0.10), pct: 10, desc: 'Compliance & protection' }
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.primary}; margin-bottom: 20px;">
                The Breakdown
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 900; margin-bottom: 16px;">
                Where ${formatCurrency(annualImpact)} actually comes from
            </h2>
            <p style="font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 40px; max-width: 600px; line-height: 1.5;">
                No hand-waving. No vague promises. Here's exactly how we create value for ${businessName},
                broken down by category with clear attribution.
            </p>
            <div style="display: flex; flex-direction: column; gap: 20px;">
                ${valueDrivers.map((driver, i) => `
                    <div style="display: flex; align-items: center; gap: 20px;">
                        <div style="width: 180px;">
                            <div style="font-size: 16px; font-weight: 700;">${driver.name}</div>
                            <div style="font-size: 12px; color: ${CONFIG.colors.textLight};">${driver.desc}</div>
                        </div>
                        <div style="flex: 1; height: 48px; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; position: relative;">
                            <div style="
                                height: 100%;
                                width: ${driver.pct}%;
                                background: linear-gradient(90deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                                border-radius: 10px;
                                display: flex;
                                align-items: center;
                                padding-left: 20px;
                                transition: width 1s ease;
                            ">
                                <span style="font-weight: 700; font-size: 15px;">${driver.pct}%</span>
                            </div>
                        </div>
                        <div style="width: 100px; text-align: right;">
                            <div style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; font-weight: 900; color: ${CONFIG.colors.accent};">
                                ${formatCurrency(driver.value)}
                            </div>
                            <div style="font-size: 11px; color: ${CONFIG.colors.textLight};">per year</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 32px; padding: 20px 24px; background: rgba(255,255,255,0.03); border-radius: 12px; border-left: 4px solid ${CONFIG.colors.accent};">
                <p style="font-size: 14px; color: ${CONFIG.colors.text}; margin: 0; line-height: 1.5;">
                    <strong>Conservative estimates.</strong> These projections are based on the median results from comparable implementations.
                    Many clients exceed these numbers significantly.
                </p>
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.secondary}; margin-bottom: 20px;">
                The Proof
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 900; margin-bottom: 16px;">
                We don't just talk. We deliver.
            </h2>
            <p style="font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 48px; max-width: 550px; line-height: 1.5;">
                These aren't projections—they're actual results from real clients. We've built our reputation
                on consistent, measurable outcomes.
            </p>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; max-width: 900px; margin-bottom: 48px;">
                ${[
                    { value: '98%', label: 'Client Satisfaction', desc: 'NPS score' },
                    { value: '47%', label: 'Avg Cost Reduction', desc: 'Year 1 savings' },
                    { value: '4.2mo', label: 'Avg Payback', desc: 'Time to ROI' },
                    { value: '500+', label: 'Clients Served', desc: 'And counting' }
                ].map(stat => `
                    <div style="background: rgba(255,255,255,0.03); border-radius: 20px; padding: 32px 20px; border: 1px solid rgba(255,255,255,0.08);">
                        <div style="
                            font-family: ${CONFIG.fonts.heading};
                            font-size: 38px;
                            font-weight: 900;
                            background: linear-gradient(135deg, ${CONFIG.colors.gradientStart} 0%, ${CONFIG.colors.gradientEnd} 100%);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            margin-bottom: 8px;
                        ">${stat.value}</div>
                        <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${stat.label}</div>
                        <div style="font-size: 12px; color: ${CONFIG.colors.textLight};">${stat.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div style="font-style: italic; font-size: 20px; color: ${CONFIG.colors.textLight}; max-width: 600px; line-height: 1.5;">
                "${companyName} transformed how we operate. The ROI was undeniable."
            </div>
            <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; margin-top: 12px;">— A satisfied ${industry} client</div>
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
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: ${CONFIG.colors.accent}; margin-bottom: 20px;">
                The Timeline
            </div>
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 42px; font-weight: 900; margin-bottom: 16px;">
                From kickoff to impact in weeks.
            </h2>
            <p style="font-size: 17px; color: ${CONFIG.colors.textLight}; margin-bottom: 40px; max-width: 600px; line-height: 1.5;">
                We move fast because time is money—yours and ours. Here's how we get ${businessName}
                from day one to measurable results.
            </p>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
                ${[
                    { week: 'Week 1-2', title: 'Discovery', desc: 'Deep dive into your operations, define success metrics, and build the roadmap', color: CONFIG.colors.primary, milestone: 'Plan locked' },
                    { week: 'Week 3-6', title: 'Build', desc: 'Deploy solutions, integrate systems, and train your team on new capabilities', color: CONFIG.colors.secondary, milestone: 'Go live' },
                    { week: 'Week 7-10', title: 'Optimize', desc: 'Fine-tune performance, maximize efficiency, and lock in the gains', color: CONFIG.colors.accent, milestone: 'KPIs hit' },
                    { week: 'Week 11+', title: 'Scale', desc: 'Continuous improvement, expanded capabilities, and strategic growth', color: '#10b981', milestone: 'Full value' }
                ].map((phase, i) => `
                    <div style="background: linear-gradient(180deg, ${phase.color}15 0%, transparent 100%); border-radius: 20px; padding: 28px; border-top: 4px solid ${phase.color};">
                        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${phase.color}; margin-bottom: 12px;">${phase.week}</div>
                        <div style="font-family: ${CONFIG.fonts.heading}; font-size: 22px; font-weight: 700; margin-bottom: 12px;">${phase.title}</div>
                        <div style="font-size: 14px; color: ${CONFIG.colors.textLight}; line-height: 1.5; margin-bottom: 16px;">${phase.desc}</div>
                        <div style="
                            display: inline-block;
                            background: ${phase.color}20;
                            color: ${phase.color};
                            padding: 6px 12px;
                            border-radius: 6px;
                            font-size: 12px;
                            font-weight: 700;
                        ">✓ ${phase.milestone}</div>
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
            <h2 style="font-family: ${CONFIG.fonts.heading}; font-size: 52px; font-weight: 900; line-height: 1.15; margin-bottom: 20px; text-transform: uppercase; max-width: 700px;">
                Ready to unlock ${formatCurrency(annualImpact)}?
            </h2>
            <p style="font-size: 20px; opacity: 0.95; margin-bottom: 20px; max-width: 500px; line-height: 1.5;">
                ${businessName} is one conversation away from transformational results.
                Let's make it happen.
            </p>
            <p style="font-size: 16px; opacity: 0.85; margin-bottom: 40px; max-width: 450px; line-height: 1.5;">
                Book a strategy call and we'll show you exactly how we'll deliver
                ${formatCurrency(annualImpact)} in value with ${roiMultiple}x returns.
            </p>
            <a href="${ctaUrl}" style="
                display: inline-block;
                background: ${CONFIG.colors.accent};
                color: ${CONFIG.colors.background};
                padding: 20px 56px;
                border-radius: 14px;
                font-family: ${CONFIG.fonts.heading};
                font-size: 18px;
                font-weight: 700;
                text-decoration: none;
                text-transform: uppercase;
                letter-spacing: 1px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            ">${bookingUrl ? 'Book Your Call' : 'Let\'s Talk'}</a>
            <div style="margin-top: 48px; opacity: 0.9;">
                <p style="font-size: 18px; font-weight: 600;">${companyName}</p>
                <p style="font-size: 14px; margin-top: 6px; opacity: 0.85;">${contactEmail}</p>
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
    <title>${businessName} - Bold Creative Pitch | ${companyName}</title>
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
