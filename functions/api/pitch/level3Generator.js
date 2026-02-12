/**
 * Level 3 Generator Module - Enterprise Deck
 *
 * Generates Level 3 Enterprise Deck HTML with 10-12 slides.
 * This module contains the extracted generateLevel3 function from pitchGenerator.js.
 */

const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const { truncateText, CONTENT_LIMITS } = require('./htmlBuilder');

// Generate Level 3: Enterprise Deck (UPDATED with booking integration)
function generateLevel3(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || '';
    const statedProblem = inputs.statedProblem || 'increasing customer engagement';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Booking & branding options - use sellerContext first
    const bookingUrl = options.bookingUrl || inputs.bookingUrl || null;
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const customLogo = options.sellerContext?.logoUrl || options.logoUrl || inputs.logoUrl || null;
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || inputs.contactEmail || 'hello@pathsynch.com';
    const customFooterText = options.footerText || inputs.footerText || '';

    // CTA URL - booking or email fallback
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;
    const ctaText = bookingUrl ? 'Book a Demo' : 'Schedule Demo';

    // Review analysis data
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality products', 'Excellent service', 'Great atmosphere'];
    const staffMentions = reviewData?.staffMentions || [];
    const differentiators = reviewData?.differentiators || ['Unique offerings', 'Personal touch'];

    // Enhanced review analytics (from reviewAnalytics service)
    const hasReviewAnalytics = reviewData?.analytics && reviewData?.pitchMetrics;
    const reviewHealthScore = reviewData?.pitchMetrics?.headline?.score || null;
    const reviewHealthLabel = reviewData?.pitchMetrics?.headline?.label || null;
    const reviewKeyMetrics = reviewData?.pitchMetrics?.keyMetrics || [];
    const reviewCriticalIssues = reviewData?.pitchMetrics?.criticalIssues || [];
    const reviewOpportunities = reviewData?.pitchMetrics?.opportunities || [];
    const reviewStrengths = reviewData?.pitchMetrics?.strengths || [];
    const reviewRecommendation = reviewData?.pitchMetrics?.recommendation || null;
    const volumeData = reviewData?.analytics?.volume || null;
    const qualityData = reviewData?.analytics?.quality || null;
    const responseData = reviewData?.analytics?.response || null;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);

    // Market intelligence data
    const hasMarketData = marketData && marketData.opportunityScore !== undefined;
    const opportunityScore = marketData?.opportunityScore || null;
    const opportunityLevel = marketData?.opportunityLevel || null;
    const saturation = marketData?.saturation || null;
    const competitorCount = marketData?.competitorCount || null;
    const marketSize = marketData?.marketSize || null;
    const growthRate = marketData?.growthRate || null;
    const demographics = marketData?.demographics || null;
    const marketRecommendations = marketData?.recommendations || null;
    const seasonality = marketData?.seasonality || null;
    const companySizeInfo = marketData?.companySize || null;

    // Calculate donut chart segments
    const positiveAngle = (sentiment.positive / 100) * 360;
    const neutralAngle = (sentiment.neutral / 100) * 360;
    const negativeAngle = (sentiment.negative / 100) * 360;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - ${companyName} Enterprise Pitch</title>
    <style>
        :root {
            --color-primary: ${customPrimaryColor};
            --color-primary-dark: ${customPrimaryColor}dd;
            --color-secondary: #6B4423;
            --color-accent: ${customAccentColor};
            --color-positive: #22c55e;
            --color-neutral: #f59e0b;
            --color-negative: #ef4444;
            --slide-width: 960px;
            --slide-height: 540px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #333;
            line-height: 1.5;
        }
        .slide {
            width: var(--slide-width);
            min-height: var(--slide-height);
            margin: 40px auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: visible;
            position: relative;
            padding: 40px 48px;
        }
        .content-slide {
            padding: 36px 48px;
        }
        .slide-number {
            position: absolute;
            bottom: 16px;
            right: 24px;
            font-size: 12px;
            color: #999;
        }

        /* Title Slide */
        .title-slide {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
        }
        .title-slide h1 {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .title-slide .subtitle {
            font-size: 24px;
            opacity: 0.9;
            margin-bottom: 32px;
        }
        .title-slide .meta {
            display: flex;
            gap: 32px;
            font-size: 16px;
            opacity: 0.85;
        }
        .title-slide .logo {
            position: absolute;
            bottom: 32px;
            font-size: 20px;
            font-weight: 600;
        }

        /* Content Slide */
        .content-slide h2 {
            font-size: 32px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .content-slide .slide-intro {
            font-size: 16px;
            color: #666;
            margin-bottom: 32px;
        }

        /* SLIDE 2 FIX: Yellow line stretches across */
        .content-slide .yellow-line {
            width: 100%;
            height: 4px;
            background: var(--color-accent);
            margin: 8px 0 24px 0;
        }

        /* Two Column Layout */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
        }

        /* Three Column Layout */
        .three-col {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
        }

        /* Cards - FIXED: Compact to prevent cutoff */
        .card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 18px;
        }
        .card h3 {
            font-size: 15px;
            color: var(--color-primary);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .card ul {
            list-style: none;
        }
        .card li {
            padding: 5px 0;
            font-size: 13px;
            border-bottom: 1px solid #eee;
        }
        .card li:last-child { border: none; }

        /* Solution Cards */
        .solution-card {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 24px;
            color: white;
        }
        .solution-card .icon-badge {
            font-size: 32px;
            margin-bottom: 12px;
        }
        .solution-card h3 {
            font-size: 16px;
            margin-bottom: 12px;
            color: white;
        }
        .solution-card ul {
            list-style: none;
            font-size: 13px;
        }
        .solution-card li {
            padding: 4px 0;
            opacity: 0.9;
        }

        /* Donut Chart - FIXED: Smaller to prevent cutoff */
        .donut-container {
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .donut-chart {
            width: 160px;
            height: 160px;
            border-radius: 50%;
            background: conic-gradient(
                var(--color-positive) 0deg ${positiveAngle}deg,
                var(--color-neutral) ${positiveAngle}deg ${positiveAngle + neutralAngle}deg,
                var(--color-negative) ${positiveAngle + neutralAngle}deg 360deg
            );
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .donut-chart::after {
            content: '';
            width: 90px;
            height: 90px;
            background: white;
            border-radius: 50%;
            position: absolute;
        }
        .donut-center {
            position: absolute;
            z-index: 1;
            text-align: center;
        }
        .donut-center .percent {
            font-size: 28px;
            font-weight: 700;
            color: var(--color-positive);
        }
        .donut-center .label {
            font-size: 11px;
            color: #666;
        }
        .sentiment-legend {
            display: flex;
            gap: 16px;
            margin-top: 16px;
            font-size: 12px;
        }
        .sentiment-legend span {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .legend-positive { background: var(--color-positive); }
        .legend-neutral { background: var(--color-neutral); }
        .legend-negative { background: var(--color-negative); }

        /* Timeline */
        .timeline {
            display: flex;
            gap: 16px;
        }
        .timeline-item {
            flex: 1;
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            position: relative;
        }
        .timeline-item::before {
            content: '';
            position: absolute;
            top: 50%;
            right: -16px;
            width: 16px;
            height: 2px;
            background: var(--color-accent);
        }
        .timeline-item:last-child::before { display: none; }
        .phase-badge {
            display: inline-block;
            background: var(--color-primary);
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .timeline-item h4 {
            font-size: 14px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .timeline-item ul {
            list-style: none;
            font-size: 12px;
        }
        .timeline-item li {
            padding: 3px 0;
            color: #555;
        }

        /* SLIDE 8 FIX: Brand color pricing box */
        .pricing-section {
            display: grid;
            grid-template-columns: 1fr 1.5fr;
            gap: 24px;
            height: calc(100% - 80px);
        }
        .pricing-summary {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 28px;
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .pricing-summary h3 {
            font-size: 16px;
            opacity: 0.9;
            margin-bottom: 8px;
        }
        .pricing-summary .price {
            font-size: 48px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .pricing-summary .period {
            font-size: 14px;
            opacity: 0.8;
            margin-bottom: 24px;
        }
        .pricing-summary .includes {
            font-size: 13px;
            opacity: 0.9;
        }
        .pricing-summary .includes li {
            padding: 4px 0;
            list-style: none;
        }
        .pricing-products {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 24px;
        }
        .pricing-products h3 {
            font-size: 16px;
            color: var(--color-primary);
            margin-bottom: 16px;
        }
        .product-list {
            list-style: none;
        }
        .product-list li {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e8e8e8;
            font-size: 14px;
        }
        .product-list li:last-child { border: none; }
        .product-list .name { font-weight: 500; }
        .product-list .price { color: var(--color-primary); font-weight: 600; }

        /* SLIDE 9 FIX: Previous version layout */
        .next-steps-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
            height: calc(100% - 100px);
        }
        .next-steps-column h3 {
            font-size: 18px;
            color: var(--color-primary);
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 3px solid var(--color-accent);
        }
        .step-box {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 12px;
            border-left: 4px solid var(--color-primary);
        }
        .step-box h4 {
            font-size: 14px;
            color: #333;
            margin-bottom: 6px;
        }
        .step-box p {
            font-size: 13px;
            color: #666;
        }
        .next-steps-goal {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
            border-radius: 12px;
            padding: 20px;
            margin-top: 16px;
            text-align: center;
        }
        .next-steps-goal p {
            font-size: 14px;
        }

        /* Closing Slide */
        .closing-slide {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
        }
        .closing-slide h2 {
            font-size: 36px;
            margin-bottom: 16px;
            color: white;
        }
        .closing-slide p {
            font-size: 18px;
            opacity: 0.9;
            max-width: 600px;
            margin-bottom: 32px;
        }
        .closing-slide .contact {
            font-size: 16px;
            opacity: 0.85;
        }

        /* ROI Highlight */
        .roi-highlight {
            background: var(--color-primary);
            color: white;
            border-radius: 12px;
            padding: 24px;
            text-align: center;
        }
        .roi-highlight .value {
            font-size: 36px;
            font-weight: 700;
        }
        .roi-highlight .label {
            font-size: 13px;
            opacity: 0.9;
            margin-top: 4px;
        }

        /* Print Styles - FIXED: Preserve colors, hide analytics */
        @media print {
            body { background: white !important; }
            html, body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            .slide {
                margin: 0;
                box-shadow: none;
                page-break-after: always;
                border-radius: 0;
            }
            .slide:last-child { page-break-after: avoid; }
            /* Preserve gradient backgrounds */
            .title-slide,
            .closing-slide,
            .solution-card,
            .pricing-summary {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%) !important;
            }
            .solution-card {
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%) !important;
            }
            /* Hide analytics panel in print */
            #analyticsPanel { display: none !important; }
        }
    </style>
</head>
<body>

<!-- SLIDE 1: TITLE -->
<section class="slide title-slide">
    <h1>${businessName}</h1>
    <p class="subtitle">${inputs.triggerEvent ? 'Timely Opportunity Brief' : 'Customer Engagement & Growth Strategy'}</p>
    <div class="meta">
        <span>⭐ ${googleRating} Google Rating</span>
        <span>📝 ${numReviews} Reviews</span>
        <span>🏢 ${industry}</span>
    </div>
    <div class="logo">${options.sellerContext?.logoUrl ? `<img src="${options.sellerContext.logoUrl}" alt="${companyName}" style="height: 24px;">` : ''} ${companyName}</div>
    <div class="slide-number">1 / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${inputs.triggerEvent ? `
<!-- TRIGGER EVENT SLIDE: WHY NOW -->
<section class="slide content-slide" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);">
    <h2 style="color: var(--color-primary);">📰 Why We're Reaching Out Now</h2>
    <div class="yellow-line"></div>

    <div class="card" style="background: white; padding: 32px; margin-top: 24px; border-left: 4px solid var(--color-primary);">
        <h3 style="font-size: 24px; margin-bottom: 16px; color: #166534;">${inputs.triggerEvent.headline || 'Recent News'}</h3>
        <p style="font-size: 18px; color: #333; line-height: 1.6; margin-bottom: 20px;">
            ${inputs.triggerEvent.summary || ''}
        </p>
        ${inputs.triggerEvent.keyPoints && inputs.triggerEvent.keyPoints.length > 0 ? `
        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin-top: 16px;">
            <p style="font-weight: 600; color: #15803d; margin-bottom: 12px;">This creates an opportunity to:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${inputs.triggerEvent.keyPoints.map(point => `
                    <li style="font-size: 16px; color: #166534; margin-bottom: 8px;">${point}</li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
    </div>

    ${inputs.triggerEvent.source ? `
    <p style="position: absolute; bottom: 60px; font-size: 12px; color: #6b7280;">Source: ${inputs.triggerEvent.source}</p>
    ` : ''}
    <div class="slide-number">2 / ${hasReviewAnalytics ? (hasMarketData ? '13' : '12') : (hasMarketData ? '12' : '11')}</div>
</section>
` : ''}

<!-- SLIDE 2: WHAT MAKES THEM SPECIAL - FIXED yellow line -->
<section class="slide content-slide">
    <h2>What Makes ${businessName} Special</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Customer sentiment analysis from ${numReviews} Google reviews</p>

    <div class="two-col">
        <div class="donut-container">
            <div class="donut-chart">
                <div class="donut-center">
                    <div class="percent">${sentiment.positive}%</div>
                    <div class="label">Positive</div>
                </div>
            </div>
            <div class="sentiment-legend">
                <span><div class="legend-dot legend-positive"></div> Positive ${sentiment.positive}%</span>
                <span><div class="legend-dot legend-neutral"></div> Neutral ${sentiment.neutral}%</span>
                <span><div class="legend-dot legend-negative"></div> Negative ${sentiment.negative}%</span>
            </div>
        </div>

        <div>
            <div class="card" style="margin-bottom: 16px;">
                <h3>💬 What Customers Say</h3>
                <ul>
                    ${topThemes.slice(0, 4).map(theme => `<li>✓ ${theme}</li>`).join('')}
                </ul>
            </div>
            ${staffMentions.length > 0 ? `
            <div class="card">
                <h3>⭐ Staff Highlights</h3>
                <ul>
                    ${staffMentions.slice(0, 3).map(staff => `<li>${staff}</li>`).join('')}
                </ul>
            </div>
            ` : `
            <div class="card">
                <h3>🏆 Key Differentiators</h3>
                <ul>
                    ${differentiators.slice(0, 3).map(d => `<li>✓ ${d}</li>`).join('')}
                </ul>
            </div>
            `}
        </div>
    </div>
    <div class="slide-number">2 / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${hasReviewAnalytics ? `
<!-- SLIDE 2.5: REVIEW HEALTH (conditional) -->
<section class="slide content-slide">
    <h2>Review Health Analysis</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Data-driven insights from ${volumeData?.totalReviews || numReviews} customer reviews</p>

    <div class="two-col">
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px; background: linear-gradient(135deg, ${reviewHealthScore >= 70 ? '#22c55e' : reviewHealthScore >= 50 ? '#f59e0b' : '#ef4444'} 0%, ${reviewHealthScore >= 70 ? '#16a34a' : reviewHealthScore >= 50 ? '#d97706' : '#dc2626'} 100%);">
                <div class="value">${reviewHealthScore || '-'}</div>
                <div class="label">Review Health Score</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${reviewHealthLabel || 'N/A'}</div>
            </div>
            <div class="card">
                <h3>📊 Key Metrics</h3>
                <ul style="list-style: none;">
                    ${reviewKeyMetrics.map(m => `
                    <li style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                        <span style="color: #666;">${m.label}</span>
                        <span style="font-weight: 600; color: var(--color-primary);">${m.value}${m.trend ? (m.trendValue > 0 ? ' ↑' : m.trendValue < 0 ? ' ↓' : '') : ''}</span>
                    </li>
                    `).join('')}
                </ul>
            </div>
        </div>
        <div>
            ${reviewCriticalIssues.length > 0 ? `
            <div class="card" style="margin-bottom: 12px; border-left: 4px solid #ef4444; background: #fef2f2;">
                <h3 style="color: #ef4444;">🚨 Critical Issues</h3>
                <ul style="list-style: none;">
                    ${reviewCriticalIssues.map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #991b1b;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}
            ${reviewOpportunities.length > 0 ? `
            <div class="card" style="margin-bottom: 12px; border-left: 4px solid #f59e0b; background: #fffbeb;">
                <h3 style="color: #d97706;">⚠️ Improvement Areas</h3>
                <ul style="list-style: none;">
                    ${reviewOpportunities.slice(0, 2).map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #92400e;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}
            ${reviewStrengths.length > 0 ? `
            <div class="card" style="border-left: 4px solid #22c55e; background: #f0fdf4;">
                <h3 style="color: #16a34a;">✅ Strengths</h3>
                <ul style="list-style: none;">
                    ${reviewStrengths.slice(0, 2).map(i => `
                    <li style="padding: 6px 0; font-size: 13px; color: #166534;">
                        <strong>${i.title}:</strong> ${i.message}
                    </li>
                    `).join('')}
                </ul>
            </div>
            ` : `
            <div class="card" style="border-left: 4px solid var(--color-primary);">
                <h3>📈 Review Velocity</h3>
                <ul style="list-style: none;">
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Last 7 days:</strong> ${volumeData?.last7Days || 0} reviews</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Last 30 days:</strong> ${volumeData?.last30Days || 0} reviews</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Monthly average:</strong> ${volumeData?.reviewsPerMonth || 'N/A'}/month</li>
                    <li style="padding: 6px 0; font-size: 13px;"><strong>Trend:</strong> ${volumeData?.velocityTrend === 'accelerating' ? '📈 Accelerating' : volumeData?.velocityTrend === 'slowing' ? '📉 Slowing' : '➡️ Stable'}</li>
                </ul>
            </div>
            `}
        </div>
    </div>

    ${reviewRecommendation ? `
    <div style="margin-top: 16px; padding: 16px 20px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); border-radius: 12px; color: white;">
        <p style="font-size: 14px; margin: 0;"><strong>💡 ${companyName} Recommendation:</strong> ${reviewRecommendation}</p>
    </div>
    ` : ''}
    <div class="slide-number">3 / ${hasMarketData ? '12' : '11'}</div>
</section>
` : ''}

<!-- SLIDE 3: GROWTH CHALLENGES -->
<section class="slide content-slide">
    <h2>Growth Challenges</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Common barriers facing ${industry} businesses today</p>

    <div class="three-col" style="margin-top: 32px;">
        <div class="card">
            <h3>🔍 Discovery</h3>
            <ul>
                <li>Limited online visibility</li>
                <li>Competitors outranking in search</li>
                <li>Inconsistent review velocity</li>
                <li>Incomplete Google profile</li>
            </ul>
        </div>
        <div class="card">
            <h3>🎯 Industry Pain Points</h3>
            <ul>
                ${salesIntel.painPoints.slice(0, 4).map(point => `<li>${point}</li>`).join('')}
            </ul>
        </div>
        <div class="card">
            <h3>📊 Key KPIs to Track</h3>
            <ul>
                ${salesIntel.primaryKPIs.slice(0, 4).map(kpi => `<li>${kpi}</li>`).join('')}
            </ul>
        </div>
    </div>

    <div style="margin-top: 32px; padding: 20px; background: #fff3cd; border-radius: 12px; border-left: 4px solid var(--color-accent);">
        <p style="font-size: 15px; color: #856404;"><strong>The Core Issue:</strong> ${statedProblem || `Great businesses often struggle with visibility—not quality. ${companyName} bridges that gap.`}</p>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '4' : '3'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 4: SOLUTION -->
<section class="slide content-slide">
    <h2>${companyName}: The Solution${options.sellerContext?.isDefault ? ' Ecosystem' : ''}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${truncateText(options.sellerContext?.differentiator, CONTENT_LIMITS.differentiator) || (options.sellerContext?.isDefault ? 'Integrated platform to deepen local customer engagement and drive repeat revenue' : `How ${companyName} helps businesses like yours succeed`)}</p>

    <div class="three-col">
        <div class="solution-card">
            <div class="icon-badge">🎯</div>
            <h3>${options.sellerContext?.isDefault ? 'What It Does' : 'Unique Value'}</h3>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>Captures reviews & feedback in real time</li>
                <li>Builds Google Business Profile authority</li>
                <li>Creates loyalty programs with rewards</li>
                <li>Generates QR/NFC campaigns with attribution</li>
                <li>Unified analytics dashboard</li>
                ` : (options.sellerContext?.uniqueSellingPoints || []).slice(0, 5).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || `
                <li>Tailored solutions for your needs</li>
                <li>Expert implementation support</li>
                <li>Proven results</li>
                `}
            </ul>
        </div>
        <div class="solution-card">
            <div class="icon-badge">🏆</div>
            <h3>${options.sellerContext?.isDefault ? 'Key Modules' : 'What You Get'}</h3>
            <ul>
                ${(options.sellerContext?.products || []).slice(0, 4).map(p => `<li><strong>${truncateText(p.name, CONTENT_LIMITS.productName)}:</strong> ${truncateText(p.desc, CONTENT_LIMITS.productDesc)}</li>`).join('')}
            </ul>
        </div>
        <div class="solution-card">
            <div class="icon-badge">💰</div>
            <h3>${options.sellerContext?.isDefault ? 'Proven Impact' : 'Key Benefits'}</h3>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>+44% conversion per +1 star rating</li>
                <li>+2.8% conversion per 10 reviews</li>
                <li>Complete GBP: ~7x more visibility</li>
                <li>Loyalty programs: +20% AOV typically</li>
                <li>NFC review capture: 3x response rate</li>
                ` : (options.sellerContext?.keyBenefits || []).slice(0, 5).map(b => `<li>${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || `
                <li>Increased efficiency</li>
                <li>Better customer outcomes</li>
                <li>Measurable ROI</li>
                `}
            </ul>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '5' : '4'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 5: PROJECTED ROI -->
<section class="slide content-slide">
    <h2>${businessName}: Projected ROI</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Conservative 6-month scenario with ${companyName} integration</p>

    <div class="two-col">
        <div class="card">
            <h3>📊 Conservative Assumptions</h3>
            <p style="margin-bottom: 16px;"><strong>Current baseline:</strong></p>
            <ul>
                <li>~${roiData.monthlyVisits} monthly customers</li>
                <li>~$${roiData.avgTicket} average transaction</li>
                <li>${numReviews} existing Google reviews</li>
            </ul>
            <p style="margin: 20px 0 16px;"><strong>With ${companyName}:</strong></p>
            <ul>
                <li>+${roiData.newCustomers} new customers/month (+${roiData.growthRate}%)</li>
                <li>${roiData.repeatRate}% of new customers return</li>
            </ul>
            <p style="font-size: 11px; color: #888; margin-top: 12px; font-style: italic;">*Only counts revenue from new customers. Does not assume changes in existing customer behavior.</p>
        </div>
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px;">
                <div class="value">+$${formatCurrency(roiData.monthlyIncrementalRevenue)}</div>
                <div class="label">Monthly Revenue from New Customers</div>
            </div>
            <div class="card">
                <p><strong>6-Month Revenue:</strong> ~$${formatCurrency(roiData.sixMonthRevenue)}</p>
                <p><strong>${companyName} Cost (6mo):</strong> ~$${formatCurrency(roiData.sixMonthCost)}</p>
                <p><strong>Net Profit:</strong> ~$${formatCurrency(roiData.sixMonthRevenue - roiData.sixMonthCost)}</p>
                <p style="color: var(--color-primary); font-weight: 600; margin-top: 12px; font-size: 18px;">ROI: ${roiData.roi}% in first 6 months</p>
            </div>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? '6' : '5'} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

${hasMarketData ? `
<!-- SLIDE 5.5: MARKET INTELLIGENCE (conditional) -->
<section class="slide content-slide">
    <h2>Market Intelligence: ${inputs.address || 'Local Market'}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Data-driven insights for strategic positioning</p>

    <div class="two-col">
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div class="value">${opportunityScore || '-'}</div>
                <div class="label">Opportunity Score</div>
            </div>
            <div class="card">
                <h3>📊 Market Snapshot</h3>
                <ul>
                    <li><strong>Competition:</strong> ${saturation ? saturation.charAt(0).toUpperCase() + saturation.slice(1) : 'Medium'} (${competitorCount || 'Unknown'} competitors)</li>
                    <li><strong>Market Size:</strong> $${marketSize ? (marketSize >= 1000000 ? (marketSize/1000000).toFixed(1) + 'M' : (marketSize/1000).toFixed(0) + 'K') : 'Unknown'}</li>
                    <li><strong>Growth Rate:</strong> ${growthRate ? growthRate + '%' : 'Stable'} annually</li>
                    ${demographics?.medianIncome ? `<li><strong>Median Income:</strong> $${(demographics.medianIncome/1000).toFixed(0)}K</li>` : ''}
                </ul>
            </div>
        </div>
        <div>
            <div class="card" style="margin-bottom: 16px; border-left: 4px solid #667eea;">
                <h3>🎯 Market Position</h3>
                <p style="font-size: 14px; color: #333; margin-bottom: 12px;">
                    ${opportunityLevel === 'high' ? 'High opportunity market with room for growth' :
                      opportunityLevel === 'medium' ? 'Moderate opportunity with competitive dynamics' :
                      'Challenging market requiring differentiation'}
                </p>
                ${marketRecommendations?.targetCustomer ? `
                <p style="font-size: 13px; color: #666;">
                    <strong>Target:</strong> ${marketRecommendations.targetCustomer}
                </p>
                ` : ''}
            </div>
            ${seasonality ? `
            <div class="card" style="border-left: 4px solid #f59e0b;">
                <h3>📅 Seasonality</h3>
                <p style="font-size: 13px; color: #666;">
                    ${seasonality.isInPeakSeason ? '🔥 Currently in peak season - maximize marketing now' :
                      `Pattern: ${seasonality.pattern || 'Stable'}`}
                </p>
                ${companySizeInfo?.planningHorizon ? `
                <p style="font-size: 12px; color: #888; margin-top: 8px;">
                    Planning horizon: ${companySizeInfo.planningHorizon}
                </p>
                ` : ''}
            </div>
            ` : ''}
        </div>
    </div>

    ${salesIntel?.prospecting || salesIntel?.calendar ? `
    <div class="two-col" style="margin-top: 16px;">
        ${salesIntel.prospecting ? `
        <div class="card" style="border-left: 4px solid #10b981;">
            <h3>🕐 Best Time to Prospect</h3>
            <p style="font-size: 14px; color: #333; font-weight: 600; margin-bottom: 8px;">
                ${salesIntel.prospecting.bestMonthsLabel || 'Contact for timing'}
            </p>
            <p style="font-size: 13px; color: #666; margin-bottom: 8px;">
                ${salesIntel.prospecting.reasoning || ''}
            </p>
            <p style="font-size: 12px; color: #888; margin-bottom: 4px;">
                <strong>Buyer mindset:</strong> ${salesIntel.prospecting.buyerMindset || ''}
            </p>
            <p style="font-size: 12px; color: var(--color-primary); font-weight: 500;">
                💡 ${salesIntel.prospecting.approachTip || ''}
            </p>
        </div>
        ` : ''}
        ${salesIntel.calendar ? `
        <div class="card" style="border-left: 4px solid #8b5cf6;">
            <h3>📆 Industry Calendar</h3>
            <ul style="font-size: 13px; color: #666;">
                <li><strong>Buying Cycle:</strong> ${salesIntel.calendar.buyingCycle || 'Annual'}</li>
                <li><strong>Decision Timeline:</strong> ${salesIntel.calendar.decisionTimeline || 'Varies'}</li>
                ${salesIntel.calendar.contractRenewal ? `<li><strong>Contract Renewal:</strong> ${salesIntel.calendar.contractRenewal}</li>` : ''}
            </ul>
            ${salesIntel.calendar.keyEvents && salesIntel.calendar.keyEvents.length > 0 ? `
            <p style="font-size: 12px; color: #888; margin-top: 8px; margin-bottom: 4px;"><strong>Key Events:</strong></p>
            <ul style="font-size: 12px; color: #888; margin-top: 0;">
                ${salesIntel.calendar.keyEvents.slice(0, 3).map(e => `<li>${e.name} (${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][e.month - 1] || ''})</li>`).join('')}
            </ul>
            ` : ''}
        </div>
        ` : ''}
    </div>
    ` : ''}

    <div class="slide-number">${hasReviewAnalytics ? '7' : '6'} / ${hasReviewAnalytics ? '12' : '11'}</div>
</section>
` : ''}

<!-- SLIDE 6: PRODUCT STRATEGY -->
<section class="slide content-slide">
    <h2>${options.sellerContext?.isDefault ? 'Product Strategy: Integrated Approach' : `${companyName} Implementation Strategy`}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${options.sellerContext?.isDefault ? 'Three-pillar system to drive discovery, engagement, and retention' : `How ${companyName} delivers results for ${industry} businesses`}</p>

    <div class="three-col">
        ${options.sellerContext?.isDefault ? `
        <div class="card" style="border-top: 4px solid var(--color-primary);">
            <h3>⭐ Pillar 1: Discovery</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>PathConnect + LocalSynch</strong></p>
            <ul>
                <li>NFC cards for instant reviews</li>
                <li>Google Business optimization</li>
                <li>Review velocity tracking</li>
                <li>Reputation monitoring</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-accent);">
            <h3>🔗 Pillar 2: Engagement</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>QRSynch + Forms + SynchMate</strong></p>
            <ul>
                <li>QR campaign attribution</li>
                <li>Customer feedback surveys</li>
                <li>AI-powered chat support</li>
                <li>Short-link tracking</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-secondary);">
            <h3>🔄 Pillar 3: Retention</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>PathManager + Analytics</strong></p>
            <ul>
                <li>Unified dashboard</li>
                <li>Customer insights</li>
                <li>Performance tracking</li>
                <li>ROI measurement</li>
            </ul>
        </div>
        ` : `
        <div class="card" style="border-top: 4px solid var(--color-primary);">
            <h3>⭐ ${truncateText((options.sellerContext?.products || [])[0]?.name, CONTENT_LIMITS.productName) || 'Core Solution'}</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText((options.sellerContext?.products || [])[0]?.desc, CONTENT_LIMITS.productDesc) || 'Primary offering'}</strong></p>
            <ul>
                ${(options.sellerContext?.uniqueSellingPoints || []).slice(0, 2).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || '<li>Expert implementation</li>'}
                <li>Dedicated onboarding</li>
                ${(options.sellerContext?.products || [])[0]?.pricing ? `<li>${(options.sellerContext?.products || [])[0]?.pricing}</li>` : ''}
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-accent);">
            <h3>🔗 ${truncateText((options.sellerContext?.products || [])[1]?.name, CONTENT_LIMITS.productName) || 'Growth Tools'}</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText((options.sellerContext?.products || [])[1]?.desc, CONTENT_LIMITS.productDesc) || 'Expansion capabilities'}</strong></p>
            <ul>
                ${(options.sellerContext?.uniqueSellingPoints || []).slice(2, 4).map(usp => `<li>${truncateText(usp, CONTENT_LIMITS.uspItem)}</li>`).join('') || '<li>Feature expansion</li>'}
                <li>Process optimization</li>
                <li>Performance tracking</li>
            </ul>
        </div>
        <div class="card" style="border-top: 4px solid var(--color-secondary);">
            <h3>🔄 Results & ROI</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;"><strong>${truncateText(options.sellerContext?.differentiator, 50) || 'Measurable outcomes'}</strong></p>
            <ul>
                ${(options.sellerContext?.keyBenefits || []).slice(0, 3).map(b => `<li>${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || '<li>Measurable improvements</li><li>ROI tracking</li>'}
                <li>Ongoing optimization</li>
            </ul>
        </div>
        `}
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '8' : '7') : (hasMarketData ? '7' : '6')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 7: 90-DAY ROLLOUT - FIXED: Added "Recommended" -->
<section class="slide content-slide">
    <h2>Recommended 90-Day Rollout</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Phased implementation for maximum impact with minimal disruption</p>

    <div class="timeline" style="margin-top: 32px;">
        <div class="timeline-item">
            <div class="phase-badge">Phase 1: Days 1-30</div>
            <h4>Foundation</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>PathConnect setup & NFC cards</li>
                <li>Google Business Profile audit</li>
                ` : `
                <li>${truncateText((options.sellerContext?.products || [])[0]?.name, CONTENT_LIMITS.productName) || 'Primary solution'} setup</li>
                <li>${truncateText((options.sellerContext?.products || [])[0]?.desc, 50) || 'Initial implementation'}</li>
                `}
                <li>Staff training ${options.sellerContext?.isDefault ? 'on review requests' : '& onboarding'}</li>
                <li>Baseline metrics established</li>
            </ul>
        </div>
        <div class="timeline-item">
            <div class="phase-badge">Phase 2: Days 31-60</div>
            <h4>Expansion</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>QRSynch campaigns launched</li>
                <li>Forms for customer feedback</li>
                <li>LocalSynch optimization</li>
                ` : `
                ${(options.sellerContext?.products || []).slice(1, 3).map(p => `<li>${truncateText(p.name, 20)}: ${truncateText(p.desc, 40)}</li>`).join('') || '<li>Additional features enabled</li>'}
                <li>Process optimization & refinement</li>
                `}
                <li>First performance review</li>
            </ul>
        </div>
        <div class="timeline-item">
            <div class="phase-badge">Phase 3: Days 61-90</div>
            <h4>Optimization</h4>
            <ul>
                ${options.sellerContext?.isDefault ? `
                <li>Full PathManager analytics</li>
                <li>SynchMate chatbot (optional)</li>
                ` : `
                <li>Full ${companyName} solution deployment</li>
                ${(options.sellerContext?.products || []).length > 3 ? (options.sellerContext?.products || []).slice(3, 5).map(p => `<li>${truncateText(p.name, 25)} activated</li>`).join('') : '<li>Advanced features & integrations</li>'}
                `}
                <li>Campaign refinement</li>
                <li>ROI assessment & planning</li>
            </ul>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '9' : '8') : (hasMarketData ? '8' : '7')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 8: INVESTMENT - FIXED: Renamed, brand colors, yellow line -->
<section class="slide content-slide">
    <h2>${companyName} Package for ${businessName}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro"><strong>Recommended ${options.sellerContext?.isDefault ? 'Curated bundle' : 'solution'}</strong> to ${statedProblem || 'drive customer engagement and growth'}</p>

    <div class="pricing-section">
        <div class="pricing-summary" style="text-align: center;">
            <h3 style="text-align: center;">Your Investment</h3>
            <div class="price">${options.sellerContext?.pricing || '$168'}</div>
            <div class="period">${options.sellerContext?.pricingPeriod || 'per month'}</div>
            <ul class="includes" style="text-align: left; display: inline-block;">
                ${options.sellerContext?.isDefault ? `
                <li>✓ All core modules included</li>
                <li>✓ Dedicated onboarding</li>
                <li>✓ Priority support</li>
                <li>✓ Monthly strategy calls</li>
                <li>✓ No long-term contract</li>
                ` : (options.sellerContext?.keyBenefits || []).slice(0, 5).map(b => `<li>✓ ${truncateText(b, CONTENT_LIMITS.benefitItem)}</li>`).join('') || `
                <li>✓ Full solution access</li>
                <li>✓ Implementation support</li>
                <li>✓ Ongoing assistance</li>
                `}
            </ul>
        </div>
        <div class="pricing-products">
            <h3>${options.sellerContext?.isDefault ? 'Recommended Products' : 'What You Get'}</h3>
            <ul class="product-list">
                ${(options.sellerContext?.products || []).slice(0, 6).map(p => `
                <li><span class="name">${p.icon || '📦'} ${truncateText(p.name, CONTENT_LIMITS.productName)}</span><span class="price">${p.price || 'Included'}</span></li>
                `).join('')}
            </ul>
            <div style="margin-top: 16px; padding: 12px; background: #e8f5e9; border-radius: 8px; text-align: center;">
                <span style="font-size: 13px; color: var(--color-primary);"><strong>${options.sellerContext?.isDefault ? 'Complete Platform Bundle' : 'Complete Package'}</strong> - ${options.sellerContext?.isDefault ? 'All tools included' : 'Everything you need'}</span>
            </div>
        </div>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '10' : '9') : (hasMarketData ? '9' : '8')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 9: NEXT STEPS - FIXED: Previous version layout, yellow line -->
<section class="slide content-slide">
    <h2>Recommended Next Steps</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Clear, actionable roadmap to move from discussion to implementation</p>

    <div class="next-steps-grid">
        <div class="next-steps-column">
            <h3>Immediate (This Week)</h3>
            <div class="step-box">
                <h4>1. Schedule ${companyName} demo</h4>
                <p>${options.sellerContext?.isDefault ? 'See PathConnect, LocalSynch, QRSynch in action' : `See ${(options.sellerContext?.products || []).slice(0, 2).map(p => truncateText(p.name, 20)).join(', ')} in action`}</p>
            </div>
            <div class="step-box">
                <h4>2. Review pricing options</h4>
                <p>Explore custom ${options.sellerContext?.isDefault ? 'bundle' : 'solution'} for ${industry}</p>
            </div>
            <div class="step-box">
                <h4>3. Connect with decision maker</h4>
                <p>Typical: ${options.sellerContext?.decisionMakers?.[0] || salesIntel.decisionMakers[0] || 'Owner'} or ${options.sellerContext?.decisionMakers?.[1] || salesIntel.decisionMakers[1] || 'Manager'}</p>
            </div>
        </div>

        <div class="next-steps-column">
            <h3>Short-Term (Next 2-4 Weeks)</h3>
            <div class="step-box">
                <h4>4. Pilot period</h4>
                <p>${options.sellerContext?.isDefault ? 'Start with PathConnect only (30 days)' : 'Start with initial implementation (30 days)'}</p>
            </div>
            <div class="step-box">
                <h4>5. Staff training</h4>
                <p>${options.sellerContext?.isDefault ? 'NFC card placement, review request script' : 'Onboarding and best practices'}</p>
            </div>
            <div class="step-box">
                <h4>6. Top channels to leverage</h4>
                <p>${salesIntel.topChannels.slice(0, 2).join(', ')}</p>
            </div>
        </div>
    </div>

    <div class="next-steps-goal">
        <p><strong>Goal:</strong> By Day 30, you'll have data showing review velocity, foot traffic patterns, and early engagement interest. Then expand to full stack.</p>
    </div>
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '11' : '10') : (hasMarketData ? '10' : '9')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<!-- SLIDE 10: CLOSING CTA -->
<section class="slide closing-slide">
    <h2>Let's Unlock ${businessName}'s Potential</h2>
    <p>Your product is great. Your customers love you. Now let's make sure everyone knows.</p>

    <a href="${ctaUrl}" class="cta-button" style="display: inline-block; margin-top: 24px; padding: 16px 48px; background: var(--color-accent); color: #1a1a1a; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: 600;"
       data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
       data-pitch-level="3"
       data-segment="${industry}"
       onclick="window.trackCTA && trackCTA(this)">
        ${ctaText}
    </a>

    ${hideBranding ? '' : `<p style="font-size: 18px; margin-top: 32px;">
        <strong>${companyName}</strong><br>
        <span style="font-size: 14px; opacity: 0.9;">${contactEmail}</span>
    </p>`}
    ${customFooterText ? `<p style="font-size: 14px; margin-top: 24px; opacity: 0.8;">${customFooterText}</p>` : ''}
    <div class="slide-number">${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')} / ${hasReviewAnalytics ? (hasMarketData ? '12' : '11') : (hasMarketData ? '11' : '10')}</div>
</section>

<script>
window.trackCTA = function(el) {
    if (navigator.sendBeacon) {
        navigator.sendBeacon(
            'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',
            new Blob([JSON.stringify({
                pitchId: '${pitchId || ''}',
                event: 'cta_click',
                data: {
                    ctaType: el.dataset.ctaType || null,
                    ctaUrl: el.href || null,
                    pitchLevel: parseInt(el.dataset.pitchLevel) || 3,
                    segment: el.dataset.segment || null
                }
            })], { type: 'application/json' })
        );
    }
};
</script>
</body>
</html>`;
}

module.exports = { generateLevel3 };
