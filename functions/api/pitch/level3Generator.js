/**
 * Level 3 Generator Module - Enterprise Deck
 *
 * Generates Level 3 Enterprise Deck HTML with 10-12 slides.
 * This module contains the extracted generateLevel3 function from pitchGenerator.js.
 *
 * Slide builders are being extracted to ./level3/slides.js
 */

const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const { truncateText, CONTENT_LIMITS } = require('./htmlBuilder');

// Extracted slide builders
const {
    buildTitleSlide,
    buildTriggerEventSlide,
    buildWhatMakesThemSpecialSlide,
    buildReviewHealthSlide,
    buildGrowthChallengesSlide,
    buildSolutionSlide,
    buildProjectedRoiSlide,
    buildMarketIntelligenceSlide,
    buildProductStrategySlide,
    buildRolloutSlide,
    buildInvestmentSlide,
    buildNextStepsSlide,
    buildClosingCtaSlide
} = require('./level3/slides');

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

    // Context object for slide builders
    const ctx = {
        // Core business data
        businessName,
        industry,
        subIndustry,
        statedProblem,
        numReviews,
        googleRating,
        inputs,
        options,

        // Branding
        companyName,
        customPrimaryColor,
        customAccentColor,
        customLogo,
        contactEmail,
        hideBranding,
        customFooterText,
        bookingUrl,
        ctaUrl,
        ctaText,

        // Review data
        sentiment,
        topThemes,
        staffMentions,
        differentiators,
        positiveAngle,
        neutralAngle,
        negativeAngle,

        // Review analytics
        hasReviewAnalytics,
        reviewHealthScore,
        reviewHealthLabel,
        reviewKeyMetrics,
        reviewCriticalIssues,
        reviewOpportunities,
        reviewStrengths,
        reviewRecommendation,
        volumeData,
        qualityData,
        responseData,

        // Sales intelligence
        salesIntel,

        // Market data
        hasMarketData,
        opportunityScore,
        opportunityLevel,
        saturation,
        competitorCount,
        marketSize,
        growthRate,
        demographics,
        marketRecommendations,
        seasonality,
        companySizeInfo,

        // ROI data
        roiData,

        // Utilities
        formatCurrency,
        truncateText,
        CONTENT_LIMITS,

        // Pitch tracking
        pitchId
    };

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

${buildTitleSlide(ctx)}

${buildTriggerEventSlide(ctx)}

${buildWhatMakesThemSpecialSlide(ctx)}

${buildReviewHealthSlide(ctx)}

${buildGrowthChallengesSlide(ctx)}

${buildSolutionSlide(ctx)}

${buildProjectedRoiSlide(ctx)}

${buildMarketIntelligenceSlide(ctx)}

${buildProductStrategySlide(ctx)}

${buildRolloutSlide(ctx)}

${buildInvestmentSlide(ctx)}

${buildNextStepsSlide(ctx)}

${buildClosingCtaSlide(ctx)}

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
