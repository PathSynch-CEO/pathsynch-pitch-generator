/**
 * Level 1 Generator Module - Outreach Sequences
 *
 * Generates multi-channel outreach sequences (Email + LinkedIn) for sales prospecting.
 * Includes trigger-based personalization and sales intelligence integration.
 * Extracted from pitchGenerator.js as part of the modular refactoring effort.
 *
 * @module pitch/level1Generator
 */

const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const { adjustColor } = require('./htmlBuilder');

/**
 * Generate Level 1: Outreach Sequences
 * Creates a multi-channel outreach plan with email and LinkedIn sequences.
 *
 * @param {Object} inputs - Business and contact information
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculation data
 * @param {Object} options - Branding and customization options
 * @param {Object|null} marketData - Market intelligence data (unused in Level 1)
 * @param {string} pitchId - Pitch ID for tracking
 * @returns {string} HTML content for the outreach sequence
 */
function generateLevel1(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const contactName = inputs.contactName || 'there';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || null;
    const statedProblem = inputs.statedProblem || 'increasing customer engagement';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);
    const primaryDecisionMaker = salesIntel.decisionMakers[0] || 'Owner';
    const keyPainPoint = salesIntel.painPoints[0] || 'growing customer base';
    const topKPI = salesIntel.primaryKPIs[0] || 'customer growth';
    const topChannel = salesIntel.topChannels[0] || 'Google Business Profile';

    // Branding options (white-label support) - use sellerContext first
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const customFooterText = options.footerText || inputs.footerText || '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Outreach Sequence: ${businessName}</title>
    <style>
        :root {
            --primary-color: ${customPrimaryColor};
            --accent-color: ${customAccentColor};
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 32px;
        }
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, ${adjustColor(customPrimaryColor, -20)} 100%);
            color: white;
            padding: 32px;
            border-radius: 12px;
            margin-bottom: 32px;
        }
        .header h1 { font-size: 28px; margin-bottom: 8px; }
        .header p { opacity: 0.9; font-size: 16px; }
        .meta-row {
            display: flex;
            gap: 24px;
            margin-top: 16px;
            font-size: 14px;
        }
        .meta-row span {
            background: rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 20px;
        }
        .channel-section {
            background: white;
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .channel-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #f0f0f0;
        }
        .channel-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .email-icon { background: #e3f2fd; }
        .linkedin-icon { background: #e8f4f8; }
        .channel-header h2 { font-size: 20px; color: #333; }
        .sequence-item {
            border: 1px solid #e8e8e8;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 16px;
            position: relative;
        }
        .sequence-item:last-child { margin-bottom: 0; }
        .timing-badge {
            position: absolute;
            top: -10px;
            left: 20px;
            background: var(--primary-color);
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .sequence-item h4 {
            font-size: 15px;
            color: var(--primary-color);
            margin-bottom: 12px;
            margin-top: 8px;
        }
        .sequence-item .content {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 8px;
            font-size: 14px;
            white-space: pre-wrap;
        }
        .personalization-section {
            background: #fffbf0;
            border: 1px solid #ffe0a0;
            border-radius: 12px;
            padding: 24px;
            margin-top: 24px;
        }
        .personalization-section h3 {
            color: #b8860b;
            margin-bottom: 16px;
        }
        .personalization-section ul {
            list-style: none;
        }
        .personalization-section li {
            padding: 8px 0;
            border-bottom: 1px dashed #ffe0a0;
            font-size: 14px;
        }
        .personalization-section li:last-child { border: none; }
        @media print {
            body { background: white; }
            .container { max-width: 100%; padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Outreach Sequence: ${businessName}</h1>
            <p>Multi-channel approach for ${contactName}</p>
            <div class="meta-row">
                <span>⭐ ${googleRating} rating</span>
                <span>📝 ${numReviews} reviews</span>
                <span>🏢 ${industry}</span>
            </div>
        </div>

        <!-- Email Sequence -->
        <div class="channel-section">
            <div class="channel-header">
                <div class="channel-icon email-icon">📧</div>
                <div>
                    <h2>Email Sequence</h2>
                    <p style="color: #888; font-size: 14px;">3 emails over 8 days</p>
                </div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 1</div>
                <h4>Initial Outreach${inputs.triggerEvent ? ' (Trigger-Based)' : ''}</h4>
                <div class="content">Subject: ${inputs.triggerEvent ? `Congrats on ${inputs.triggerEvent.headline ? inputs.triggerEvent.headline.substring(0, 40) + '...' : 'the news'} - quick idea` : `Quick idea for ${businessName}'s ${topKPI}`}

Hi ${contactName},

${inputs.triggerEvent ? `I saw the news about "${inputs.triggerEvent.headline || 'your recent announcement'}" - congratulations! ${inputs.triggerEvent.summary ? inputs.triggerEvent.summary.substring(0, 150) : ''}

Given this exciting development, I wanted to reach out because` : `I came across ${businessName} and was impressed by your ${googleRating}-star rating. With ${numReviews} reviews, you've clearly built something customers love.`}

I work with ${industry} businesses who are dealing with ${keyPainPoint.toLowerCase()}. We help turn customer loyalty into measurable growth:
• +${roiData.growthRate}% more foot traffic from improved ${topChannel} visibility
• +25% increase in repeat customers
• ${roiData.roi}%+ ROI in the first 6 months

Would you be open to a 15-minute call this week to see if there's a fit?

Best,
[Your Name]
${companyName}</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 4</div>
                <h4>Value-Add Follow-up</h4>
                <div class="content">Subject: Re: Quick idea for ${businessName}'s ${topKPI}

Hi ${contactName},

Following up on my note about improving ${businessName}'s ${topKPI.toLowerCase()}.

I put together a quick analysis based on your Google profile:
• Your current rating (${googleRating}★) puts you ahead of many competitors
• Improving your ${topChannel} presence could add ~${roiData.newCustomers} new customers/month
• That translates to roughly $${formatCurrency(roiData.monthlyIncrementalRevenue)}/month in additional revenue

Many ${industry} ${primaryDecisionMaker.toLowerCase()}s I work with were surprised by the impact.

Worth a conversation?

Best,
[Your Name]</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 8</div>
                <h4>Final Touch</h4>
                <div class="content">Subject: One more thought on ${businessName}

Hi ${contactName},

Last note from me - I know you're busy running ${businessName}.

If now isn't the right time, no worries. But if ${statedProblem} is on your radar, I'd love to share how other ${industry} businesses are tackling it.

Either way, keep up the great work!

Best,
[Your Name]</div>
            </div>
        </div>

        <!-- LinkedIn Sequence -->
        <div class="channel-section">
            <div class="channel-header">
                <div class="channel-icon linkedin-icon">💼</div>
                <div>
                    <h2>LinkedIn Sequence</h2>
                    <p style="color: #888; font-size: 14px;">Connection + 2 follow-ups</p>
                </div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 2</div>
                <h4>Connection Request</h4>
                <div class="content">Hi ${contactName}! I noticed ${businessName}'s great reputation in the ${industry} space. I help similar businesses grow their local presence - would love to connect and share some ideas.</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 5</div>
                <h4>Post-Connection Message</h4>
                <div class="content">Thanks for connecting, ${contactName}!

I've been researching ${businessName} - your ${googleRating}-star rating is impressive. I work with ${industry} owners on turning that goodwill into consistent growth.

Quick question: Is building online visibility a priority for you this quarter?</div>
            </div>

            <div class="sequence-item">
                <div class="timing-badge">Day 9</div>
                <h4>Insight Share</h4>
                <div class="content">Hi ${contactName},

Just worked with a ${industry} client who increased their reviews by 200% in 60 days. Their secret? Making it frictionless for happy customers to share their experience.

If you're curious how they did it, happy to share. No pitch - just thought it might be useful for ${businessName}.</div>
            </div>
        </div>

        <!-- Sales Intelligence -->
        <div class="personalization-section" style="background: #f0fdf4; border-color: #86efac;">
            <h3 style="color: #166534;">🎯 Sales Intelligence: ${industry}${subIndustry ? ' - ' + subIndustry : ''}</h3>
            <ul>
                <li><strong>Decision Makers:</strong> ${salesIntel.decisionMakers.join(', ')}</li>
                <li><strong>Key Pain Points:</strong>
                    <ul style="margin-top: 8px; margin-left: 20px;">
                        ${salesIntel.painPoints.slice(0, 3).map(pp => `<li style="border: none; padding: 4px 0;">${pp}</li>`).join('')}
                    </ul>
                </li>
                <li><strong>KPIs They Track:</strong> ${salesIntel.primaryKPIs.slice(0, 4).join(', ')}</li>
                <li><strong>Top Channels:</strong> ${salesIntel.topChannels.slice(0, 4).join(', ')}</li>
            </ul>
        </div>

        <!-- Personalization Notes -->
        <div class="personalization-section">
            <h3>📝 Personalization Notes</h3>
            <ul>
                <li><strong>Review highlights:</strong> ${reviewData?.topThemes?.length ? reviewData.topThemes.join(', ') : 'Mention specific positive feedback from their reviews'}</li>
                <li><strong>Stated problem:</strong> ${statedProblem || 'Focus on visibility and customer retention'}</li>
                <li><strong>ROI hook:</strong> ~$${formatCurrency(roiData.sixMonthRevenue)} potential in 6 months</li>
                ${reviewData?.staffMentions?.length ? `<li><strong>Staff mentions:</strong> ${reviewData.staffMentions.join(', ')}</li>` : ''}
            </ul>
        </div>

        ${customFooterText ? `
        <div style="margin-top: 32px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>
        ` : ''}

        ${!hideBranding ? `
        <div style="margin-top: 24px; text-align: center; padding: 16px;">
            <p style="color: #999; font-size: 12px;">Powered by ${companyName}</p>
        </div>
        ` : ''}
    </div>
</body>
</html>`;
}

module.exports = {
    generateLevel1
};
