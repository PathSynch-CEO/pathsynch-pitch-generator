/**
 * Level 2 Generator Module - One-Pager
 *
 * Generates a single-page opportunity brief with stats, customer analysis,
 * pain points, products/solutions, and CTA sections.
 * Includes booking integration and white-label support.
 * Extracted from pitchGenerator.js as part of the modular refactoring effort.
 *
 * @module pitch/level2Generator
 */

const { getIndustryIntelligence } = require('../../config/industryIntelligence');
const { formatCurrency } = require('../../utils/roiCalculator');
const { truncateText, CONTENT_LIMITS } = require('./htmlBuilder');

// Style router for non-standard styles
const { generateStyledL2 } = require('./level2Styles');

/**
 * Generate Level 2: One-Pager
 * Creates a single-page opportunity brief with business stats and solutions.
 *
 * @param {Object} inputs - Business and contact information
 * @param {Object} reviewData - Review analysis data
 * @param {Object} roiData - ROI calculation data
 * @param {Object} options - Branding and customization options
 * @param {Object|null} marketData - Market intelligence data (unused in Level 2)
 * @param {string} pitchId - Pitch ID for tracking
 * @returns {string} HTML content for the one-pager
 */
function generateLevel2(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    // Style routing: if a non-standard style is requested, route to style-specific generator
    const style = options.style || 'standard';
    if (style !== 'standard') {
        return generateStyledL2(style, inputs, reviewData, roiData, options, marketData, pitchId);
    }

    // Card-specific rendering: Smart Mode cards get unique layouts
    const cardType = options.cardType || 'standard';
    if (cardType !== 'standard' && options.libraryEnhancedContent) {
        return generateCardLayout(cardType, inputs, reviewData, roiData, options, pitchId);
    }

    // Standard style continues with existing generation logic
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const subIndustry = inputs.subIndustry || null;
    const statedProblem = inputs.statedProblem || 'increasing customer engagement and visibility';
    const numReviews = parseInt(inputs.numReviews) || 0;
    const googleRating = parseFloat(inputs.googleRating) || 4.0;

    // Sales Intelligence - industry-specific insights
    const salesIntel = getIndustryIntelligence(industry, subIndustry);

    // Booking & branding options - use sellerContext first
    const bookingUrl = options.bookingUrl || inputs.bookingUrl || null;
    const rb = options.resolvedBrand || {};
    const hideBranding = options.hideBranding || inputs.hideBranding || rb.showPoweredByPathSynch === false || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || rb.accentColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || rb.secondaryColor || '#D4A847';
    const customLogo = options.sellerContext?.logoUrl || options.logoUrl || inputs.logoUrl || (rb.canUseCustomLogo ? rb.logoUrl : null) || null;
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || rb.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || inputs.contactEmail || rb.contactEmail || 'hello@pathsynch.com';
    const customFooterText = options.footerText || inputs.footerText || '';

    // Custom Sales Library AI-enhanced content (if available)
    const libraryContent = options.libraryEnhancedContent || null;
    const useCustomLibrary = options.useCustomLibrary && libraryContent;
    const libraryCompanyName = options.salesLibraryContext?.companyName || companyName;

    // L4: Sales Library powered one-pager — uses seller-sourced content prominently
    const isL4 = options.pitchLevel === 4 && useCustomLibrary;

    // Review analysis data
    const sentiment = reviewData?.sentiment || { positive: 65, neutral: 25, negative: 10 };
    const topThemes = reviewData?.topThemes || ['Quality service', 'Friendly staff', 'Great atmosphere'];
    const staffMentions = reviewData?.staffMentions || [];

    // CTA URL - booking or email fallback
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;
    const ctaText = bookingUrl ? 'Book a Demo' : 'Schedule Your Demo';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - ${companyName} Opportunity Brief</title>
    <style>
        :root {
            --color-primary: ${customPrimaryColor};
            --color-primary-dark: ${customPrimaryColor}dd;
            --color-secondary: #6B4423;
            --color-accent: ${customAccentColor};
            --color-bg: #ffffff;
            --color-bg-light: #f8f9fa;
            --color-text: #333333;
            --color-text-light: #666666;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--color-bg);
            color: var(--color-text);
            line-height: 1.5;
            /* FIXED: Full viewport height for proper display */
            min-height: 100vh;
        }

        /* TOP BAR - with optional branding - FIXED: Better text/image visibility */
        .top-bar {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            color: white;
            padding: 14px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .top-bar .logo {
            font-weight: 700;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .top-bar .logo img {
            height: 32px;
            max-width: 120px;
            object-fit: contain;
            filter: brightness(1.1);
        }
        .top-bar .actions {
            display: flex;
            gap: 12px;
        }
        .top-bar .btn {
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
        }
        .top-bar .btn-outline {
            background: rgba(255,255,255,0.15);
            border: 2px solid rgba(255,255,255,0.7);
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .top-bar .btn-outline:hover {
            background: rgba(255,255,255,0.25);
            border-color: white;
        }
        .top-bar .btn-primary {
            background: var(--color-accent);
            border: 2px solid var(--color-accent);
            color: #1a1a1a;
            font-weight: 700;
        }
        .top-bar .btn-primary:hover {
            background: #e5b958;
            border-color: #e5b958;
        }

        /* FIXED: Container now properly sized for screen display */
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 32px;
            min-height: calc(100vh - 60px);
        }

        /* Header Section */
        .header {
            text-align: center;
            margin-bottom: 32px;
            padding-bottom: 24px;
            border-bottom: 3px solid var(--color-primary);
        }
        .header h1 {
            font-size: 32px;
            color: var(--color-primary);
            margin-bottom: 8px;
        }
        .header .subtitle {
            font-size: 18px;
            color: var(--color-text-light);
        }
        .header .meta {
            display: flex;
            justify-content: center;
            gap: 24px;
            margin-top: 16px;
        }
        .header .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            color: var(--color-text-light);
        }

        /* Stats Row */
        .stats-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        .stat-box {
            background: var(--color-bg-light);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid #e8e8e8;
        }
        .stat-box .value {
            font-size: 28px;
            font-weight: 700;
            color: var(--color-primary);
        }
        .stat-box .label {
            font-size: 12px;
            color: var(--color-text-light);
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Two Column Layout */
        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 32px;
        }

        /* Card Styles */
        .card {
            background: var(--color-bg-light);
            border-radius: 12px;
            padding: 24px;
            border: 1px solid #e8e8e8;
        }
        .card h3 {
            font-size: 16px;
            color: var(--color-primary);
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 2px solid var(--color-accent);
        }
        .card ul {
            list-style: none;
        }
        .card li {
            padding: 8px 0;
            font-size: 14px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        .card li:last-child { border: none; }
        .card li::before {
            content: "✓";
            color: var(--color-primary);
            font-weight: bold;
            flex-shrink: 0;
        }

        /* NEW SECTION: PathSynch Products */
        .products-section {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 32px;
            color: white;
        }
        .products-section h3 {
            font-size: 18px;
            margin-bottom: 16px;
            text-align: center;
        }
        .products-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }
        .product-item {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
        }
        .product-item .icon {
            font-size: 24px;
            margin-bottom: 6px;
        }
        .product-item .name {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 4px;
        }
        .product-item .desc {
            font-size: 11px;
            opacity: 0.85;
        }

        /* Solutions Grid */
        .solutions-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        .solution-item {
            background: var(--color-bg-light);
            border-radius: 10px;
            padding: 16px;
            border-left: 4px solid var(--color-primary);
        }
        .solution-item h4 {
            font-size: 14px;
            color: var(--color-primary);
            margin-bottom: 6px;
        }
        .solution-item p {
            font-size: 13px;
            color: var(--color-text-light);
        }

        /* CTA Section */
        .cta-section {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            border-radius: 12px;
            padding: 28px;
            text-align: center;
            color: white;
        }
        .cta-section h3 {
            font-size: 20px;
            margin-bottom: 8px;
        }
        .cta-section p {
            opacity: 0.9;
            margin-bottom: 16px;
            font-size: 14px;
        }
        .cta-section .cta-button {
            display: inline-block;
            background: var(--color-accent);
            color: #333;
            padding: 12px 32px;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            font-size: 14px;
        }
        .cta-section .contact {
            margin-top: 16px;
            font-size: 13px;
            opacity: 0.85;
        }

        /* Print Styles - FIXED: One-pager with colors */
        @media print {
            .top-bar { display: none; }
            html, body {
                background: white !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            .container {
                max-width: 100%;
                padding: 0.3in;
                min-height: auto;
            }
            /* Compact everything for one page */
            .header { margin-bottom: 16px; padding-bottom: 12px; }
            .header h1 { font-size: 24px; }
            .header .subtitle { font-size: 14px; }
            .stats-row { margin-bottom: 16px; gap: 8px; }
            .stat-box { padding: 12px; }
            .stat-box .value { font-size: 20px; }
            .stat-box .label { font-size: 10px; }
            .two-col { gap: 12px; margin-bottom: 16px; }
            .card { padding: 12px; }
            .card h3 { font-size: 13px; margin-bottom: 8px; }
            .card li { padding: 4px 0; font-size: 11px; }
            .products-section {
                padding: 12px;
                margin-bottom: 16px;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .products-section h3 { font-size: 14px; margin-bottom: 8px; }
            .product-item { padding: 8px; }
            .product-item .icon { font-size: 18px; }
            .product-item .name { font-size: 11px; }
            .product-item .desc { font-size: 9px; }
            .solutions-grid { gap: 8px; margin-bottom: 16px; }
            .solution-item { padding: 10px; }
            .solution-item h4 { font-size: 12px; }
            .solution-item p { font-size: 10px; }
            .cta-section {
                padding: 16px;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .cta-section h3 { font-size: 16px; }
            .cta-section p { font-size: 12px; margin-bottom: 8px; }
            .cta-section .cta-button { padding: 8px 20px; font-size: 12px; }
        }

        /* Responsive */
        @media (max-width: 768px) {
            .stats-row { grid-template-columns: repeat(2, 1fr); }
            .two-col { grid-template-columns: 1fr; }
            .products-grid { grid-template-columns: repeat(2, 1fr); }
            .solutions-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <!-- TOP BAR - with booking integration -->
    <div class="top-bar">
        <div class="logo">
            ${customLogo ? `<img src="${customLogo}" alt="${companyName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span style="display:none;">${companyName}</span>` : `<span style="font-size:24px;">📍</span> <span>${companyName}</span>`}
        </div>
        <div class="actions">
            <a href="#" class="btn btn-outline" onclick="window.print(); return false;">Download PDF</a>
            <a href="${ctaUrl}" class="btn btn-primary" target="${bookingUrl ? '_blank' : '_self'}"
               data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
               data-pitch-level="2"
               data-segment="${industry}"
               onclick="window.trackCTA && trackCTA(this)">${ctaText}</a>
        </div>
    </div>

    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>${isL4 && libraryContent.sellerProductName
                ? `${libraryContent.sellerProductName} for ${businessName}`
                : (useCustomLibrary && libraryContent.headline ? libraryContent.headline : businessName)}</h1>
            <p class="subtitle">${isL4 && libraryContent.headline
                ? libraryContent.headline
                : (useCustomLibrary && libraryContent.subheadline ? libraryContent.subheadline : (hideBranding ? 'Opportunity Brief' : companyName + ' Opportunity Brief'))}</p>
            ${isL4 ? `
            <div class="meta">
                <span class="meta-item">📚 Sales Library Powered</span>
                <span class="meta-item">🏢 Prepared for ${businessName}</span>
                <span class="meta-item">🎯 ${industry}</span>
            </div>
            ` : `
            <div class="meta">
                <span class="meta-item">⭐ ${googleRating} Google Rating</span>
                <span class="meta-item">📝 ${numReviews} Reviews</span>
                <span class="meta-item">🏢 ${industry}</span>
            </div>
            `}
            ${options.prospectEnrichment?.sources?.length > 0 ? `
            <div class="data-sources" style="margin-top: 12px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;">
                ${options.prospectEnrichment.sources.includes('google_places') ? '<span class="source-badge" style="background: #4285F4; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;">📍 Google Places</span>' : ''}
                ${options.prospectEnrichment.sources.includes('website') ? '<span class="source-badge" style="background: #34A853; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;">🌐 Website</span>' : ''}
                ${options.prospectEnrichment.sources.includes('census') ? '<span class="source-badge" style="background: #9E9E9E; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;">📊 Census</span>' : ''}
                ${options.prospectEnrichment.sources.includes('coresignal') ? '<span class="source-badge" style="background: #673AB7; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;">🏢 CoreSignal</span>' : ''}
            </div>
            ` : ''}
        </div>

        ${useCustomLibrary ? `
        <!-- Custom Library Banner -->
        <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border: 1px solid #4caf50; border-radius: 12px; padding: 16px 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 24px;">📚</span>
            <div>
                <strong style="color: #2e7d32;">Custom Sales Library Active</strong>
                <p style="font-size: 13px; color: #558b2f; margin: 4px 0 0 0;">This one-pager was generated using ${libraryCompanyName}'s proprietary sales materials for ${businessName}.</p>
            </div>
        </div>
        ` : ''}

        ${inputs.triggerEvent ? `
        <!-- Trigger Event - Personalized Opening -->
        <div class="card trigger-event-card" style="margin-bottom: 24px; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 1px solid #86efac; border-left: 4px solid ${customPrimaryColor};">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 24px;">📰</span>
                <div>
                    <p style="font-size: 14px; color: #166534; font-weight: 600; margin-bottom: 4px;">Why We're Reaching Out</p>
                    <p style="font-size: 15px; color: #333; line-height: 1.5; margin-bottom: 8px;">
                        ${inputs.triggerEvent.headline ? `<strong>Congratulations on "${inputs.triggerEvent.headline}"!</strong> ` : ''}${inputs.triggerEvent.summary || ''}
                    </p>
                    ${inputs.triggerEvent.keyPoints && inputs.triggerEvent.keyPoints.length > 0 ? `
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #bbf7d0;">
                        <p style="font-size: 12px; color: #15803d; font-weight: 600; margin-bottom: 4px;">This presents an opportunity to:</p>
                        <ul style="margin: 0; padding-left: 16px; font-size: 13px; color: #166534;">
                            ${inputs.triggerEvent.keyPoints.slice(0, 2).map(point => `<li>${point}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                    ${inputs.triggerEvent.source ? `<p style="font-size: 11px; color: #6b7280; margin-top: 8px;">Source: ${inputs.triggerEvent.source}</p>` : ''}
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Stats Row -->
        ${isL4 && libraryContent.proofPoints && libraryContent.proofPoints.length > 0 ? `
        <div class="stats-row" style="grid-template-columns: repeat(${Math.min(libraryContent.proofPoints.length, 4)}, 1fr);">
            ${libraryContent.proofPoints.slice(0, 4).map(point => `
            <div class="stat-box" style="border-left: 3px solid var(--color-accent);">
                <div class="value" style="font-size: 18px; line-height: 1.3;">📊</div>
                <div class="label" style="font-size: 13px; text-transform: none; letter-spacing: 0; color: #333; margin-top: 8px;">${point}</div>
            </div>
            `).join('')}
        </div>
        ` : `
        <div class="stats-row">
            <div class="stat-box">
                <div class="value">${googleRating}★</div>
                <div class="label">Google Rating</div>
            </div>
            <div class="stat-box">
                <div class="value">+${roiData.newCustomers}</div>
                <div class="label">New Customers/Mo</div>
            </div>
            <div class="stat-box">
                <div class="value">$${formatCurrency(roiData.monthlyIncrementalRevenue)}</div>
                <div class="label">Monthly Revenue</div>
            </div>
            <div class="stat-box">
                <div class="value">${roiData.roi}%</div>
                <div class="label">Projected ROI</div>
            </div>
        </div>
        `}

        <!-- Two Column: Opportunity + Customer Analysis -->
        ${isL4 ? `
        <div class="two-col">
            <div class="card" style="border-left: 3px solid var(--color-primary);">
                <h3>🎯 How We Solve It</h3>
                ${libraryContent.sellerMethodology ? `
                <p style="font-size: 14px; color: #333; line-height: 1.6; margin-bottom: 12px;">${libraryContent.sellerMethodology}</p>
                ` : ''}
                ${libraryContent.solutionOverview ? `
                <p style="font-size: 14px; color: #555; line-height: 1.6;">${libraryContent.solutionOverview}</p>
                ` : ''}
            </div>
            <div class="card" style="border-left: 3px solid var(--color-accent);">
                <h3>✨ What Sets Us Apart</h3>
                <ul>
                    ${(libraryContent.sellerDifferentiators || []).slice(0, 4).map(d => `<li>${d}</li>`).join('')}
                </ul>
            </div>
        </div>
        ` : `
        <div class="two-col">
            <div class="card">
                <h3>📈 The Opportunity</h3>
                <ul>
                    <li>${googleRating >= 4.0 ? `Your ${googleRating}-star rating shows customers love you` : googleRating >= 3.0 ? `Your ${googleRating}-star rating has room for improvement - we can help` : `Your ${googleRating}-star rating presents a major growth opportunity`}</li>
                    <li>${sentiment.positive >= 60 ? `${sentiment.positive}% positive sentiment shows strong customer satisfaction` : `${sentiment.positive}% positive sentiment - opportunity to improve customer experience`}</li>
                    <li>Potential to add ${roiData.newCustomers}+ new customers/month</li>
                    <li>Estimated $${formatCurrency(roiData.monthlyIncrementalRevenue)}/month from new customers</li>
                </ul>
            </div>
            <div class="card">
                <h3>💬 ${googleRating >= 3.5 ? 'What Customers Love' : 'Customer Feedback Themes'}</h3>
                <ul>
                    ${topThemes.slice(0, 4).map(theme => `<li>${theme}</li>`).join('')}
                    ${staffMentions.length > 0 ? `<li>Staff highlights: ${staffMentions.slice(0, 2).join(', ')}</li>` : ''}
                </ul>
            </div>
        </div>
        `}

        <!-- Industry Pain Points / Problem Statement -->
        <div class="card" style="margin-bottom: 24px; border-left: 4px solid ${customAccentColor};">
            ${useCustomLibrary && libraryContent.problemStatement ? `
            <h3>🎯 The Challenge for ${businessName}</h3>
            <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 12px 0;">${libraryContent.problemStatement}</p>
            ${libraryContent.keyBenefits ? `
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 16px;">
                ${libraryContent.keyBenefits.slice(0, 4).map(benefit => `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <span style="color: ${customAccentColor}; font-weight: bold;">✓</span>
                        <span style="font-size: 14px; color: #555;">${benefit}</span>
                    </div>
                `).join('')}
            </div>
            ` : ''}
            ` : `
            <h3>🎯 Common ${industry} Challenges We Solve</h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px;">
                ${salesIntel.painPoints.slice(0, 4).map(pp => `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <span style="color: ${customAccentColor}; font-weight: bold;">✓</span>
                        <span style="font-size: 14px; color: #555;">${pp}</span>
                    </div>
                `).join('')}
            </div>
            <p style="margin-top: 16px; font-size: 13px; color: #888;">
                <strong>Key metrics we help improve:</strong> ${salesIntel.primaryKPIs.slice(0, 3).join(' • ')}
            </p>
            `}
        </div>

        ${isL4 && libraryContent.caseStudyName ? `
        <!-- L4: Featured Case Study from Sales Library -->
        <div class="card" style="margin-bottom: 24px; background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 1px solid ${customAccentColor}; border-left: 4px solid ${customAccentColor};">
            <h3 style="color: ${customPrimaryColor};">📋 Case Study: ${libraryContent.caseStudyName}</h3>
            ${libraryContent.caseStudyResult ? `
            <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 12px 0;">${libraryContent.caseStudyResult}</p>
            ` : ''}
            <p style="font-size: 12px; color: #888; margin-top: 8px; font-style: italic;">From ${libraryCompanyName || companyName}'s Sales Library</p>
        </div>
        ` : ''}

        <!-- Products Section -->
        ${isL4 && libraryContent.keyBenefits && libraryContent.keyBenefits.length > 0 ? `
        <div class="products-section">
            <h3>🚀 Key Benefits for ${businessName}</h3>
            <div class="products-grid" style="grid-template-columns: repeat(${Math.min(libraryContent.keyBenefits.length, 3)}, 1fr);">
                ${libraryContent.keyBenefits.slice(0, 6).map((benefit, i) => `
                <div class="product-item">
                    <div class="icon">${['✅', '📈', '🎯', '💡', '🔒', '⚡'][i] || '✅'}</div>
                    <div class="name" style="font-size: 12px;">${benefit}</div>
                </div>
                `).join('')}
            </div>
        </div>
        ` : `
        <div class="products-section">
            <h3>🚀 ${options.sellerContext?.isDefault ? 'The PathSynch Platform' : `What ${companyName} Offers`}</h3>
            <div class="products-grid">
                ${(options.sellerContext?.products || []).slice(0, 6).map(p => `
                <div class="product-item">
                    <div class="icon">${p.icon || '📦'}</div>
                    <div class="name">${p.name}</div>
                    <div class="desc">${p.desc}</div>
                </div>
                `).join('')}
            </div>
        </div>
        `}

        <!-- Solutions for Their Problem -->
        <div class="solutions-grid">
            ${(() => {
                // Use seller's USPs and benefits, or fall back to products
                const usps = options.sellerContext?.uniqueSellingPoints || [];
                const benefits = options.sellerContext?.keyBenefits || [];
                const products = options.sellerContext?.products || [];

                // Combine USPs and benefits for solutions
                let solutions = [];

                if (usps.length > 0 || benefits.length > 0) {
                    // Use USPs first, then benefits
                    const combined = [...usps.slice(0, 2), ...benefits.slice(0, 2)].slice(0, 4);
                    const icons = ['🎯', '📍', '🔄', '📊'];
                    solutions = combined.map((item, i) => ({
                        icon: icons[i] || '✨',
                        title: truncateText(item.split(' ').slice(0, 4).join(' '), 25),
                        desc: truncateText(item, 80)
                    }));
                } else if (products.length > 0) {
                    // Fall back to products
                    solutions = products.slice(0, 4).map((p, i) => ({
                        icon: p.icon || ['🎯', '📍', '🔄', '📊'][i] || '📦',
                        title: truncateText(p.name, CONTENT_LIMITS.productName),
                        desc: truncateText(p.desc, CONTENT_LIMITS.productDesc)
                    }));
                } else {
                    // PathSynch defaults
                    solutions = [
                        { icon: '🎯', title: 'Review Capture', desc: 'NFC cards + QR codes make leaving reviews effortless' },
                        { icon: '📍', title: 'Local Visibility', desc: 'Optimize your Google Business Profile for discovery' },
                        { icon: '🔄', title: 'Customer Retention', desc: 'Loyalty programs that bring customers back' },
                        { icon: '📊', title: 'Analytics', desc: 'Track what works with unified dashboards' }
                    ];
                }

                return solutions.map(s => `
            <div class="solution-item">
                <h4>${s.icon} ${s.title}</h4>
                <p>${s.desc}</p>
            </div>`).join('');
            })()}
        </div>

        <!-- CTA with booking integration -->
        <div class="cta-section">
            <h3>${isL4 && libraryContent.callToAction ? libraryContent.callToAction : `Ready to Grow ${businessName}?`}</h3>
            <p>See how ${hideBranding ? 'we' : companyName} can help you ${statedProblem}</p>
            <a href="${ctaUrl}" class="cta-button" target="${bookingUrl ? '_blank' : '_self'}"
               data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
               data-pitch-level="${isL4 ? '4' : '2'}"
               data-segment="${industry}"
               onclick="window.trackCTA && trackCTA(this)">${ctaText}</a>
            ${bookingUrl ? `<div class="contact" style="margin-top:12px;font-size:12px;opacity:0.8;">Or email: ${contactEmail}</div>` : `<div class="contact">${contactEmail}</div>`}
        </div>
        ${customFooterText ? `
        <div style="margin-top: 24px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>
        ` : ''}
        ${isL4 ? `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            📚 Powered by ${libraryCompanyName || companyName}'s Sales Library · <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">PathSynch</a>
        </div>
        ` : (!hideBranding ? `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">PathSynch</a>
        </div>
        ` : '')}
    </div>
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
                        pitchLevel: parseInt(el.dataset.pitchLevel) || 2,
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

// ============================================
// SMART MODE CARD LAYOUTS
// ============================================

function generateCardLayout(cardType, inputs, reviewData, roiData, options, pitchId) {
    const renderers = {
        card1: renderCard1_CompetitorLandscape,
        card2: renderCard2_ReputationHealth,
        card3: renderCard3_MarketOpportunity,
        card4: renderCard4_PreCallBrief,
        card5: renderCard5_ReferralPotential,
        card6: renderCard6_GBPAudit
    };
    const renderer = renderers[cardType];
    if (!renderer) {
        // Unknown card type — fall back to standard L2
        return generateLevel2(inputs, reviewData, roiData, { ...options, cardType: 'standard' }, null, pitchId);
    }
    return renderer(inputs, options, pitchId);
}

/**
 * Shared HTML shell for card layouts
 */
function cardShell(title, primaryColor, accentColor, bodyContent, pitchId, options = {}) {
    const companyName = options.companyName || 'PathSynch';
    const customLogo = options.logoUrl || null;
    const hideBranding = options.hideBranding || false;
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const ctaUrl = bookingUrl || `mailto:${contactEmail}`;
    const ctaText = bookingUrl ? 'Book a Demo' : 'Schedule Your Demo';
    const cardLabel = options.cardLabel || 'Smart Analysis';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root {
    --cp: ${primaryColor};
    --ca: ${accentColor};
    --cpd: ${primaryColor}dd;
}
* { margin:0; padding:0; box-sizing:border-box; }
html, body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#fff; color:#333; line-height:1.5; min-height:100vh; }

.top-bar { background:linear-gradient(135deg, var(--cp) 0%, var(--cpd) 100%); color:#fff; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:100; }
.top-bar .logo { font-weight:700; font-size:20px; display:flex; align-items:center; gap:10px; text-shadow:0 1px 2px rgba(0,0,0,.2); }
.top-bar .logo img { height:32px; max-width:120px; object-fit:contain; filter:brightness(1.1); }
.top-bar .actions { display:flex; gap:12px; }
.top-bar .btn { padding:10px 18px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; transition:all .2s; }
.top-bar .btn-outline { background:rgba(255,255,255,.15); border:2px solid rgba(255,255,255,.7); color:#fff; }
.top-bar .btn-outline:hover { background:rgba(255,255,255,.25); border-color:#fff; }
.top-bar .btn-primary { background:var(--ca); border:2px solid var(--ca); color:#1a1a1a; font-weight:700; }
.top-bar .btn-primary:hover { filter:brightness(1.1); }

.container { max-width:900px; margin:0 auto; padding:32px; min-height:calc(100vh - 60px); }
.card-badge { display:inline-block; background:var(--cp); color:#fff; padding:4px 14px; border-radius:20px; font-size:12px; font-weight:600; letter-spacing:.5px; margin-bottom:16px; }

/* Shared card styles */
.section { background:#f8f9fa; border-radius:12px; padding:24px; border:1px solid #e8e8e8; margin-bottom:24px; }
.section h3 { font-size:16px; color:var(--cp); margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid var(--ca); }
.section-accent { border-left:4px solid var(--ca); }

/* Stat boxes */
.stats-row { display:grid; gap:16px; margin-bottom:24px; }
.stat-box { background:#f8f9fa; border-radius:12px; padding:20px; text-align:center; border:1px solid #e8e8e8; }
.stat-box .value { font-size:28px; font-weight:700; color:var(--cp); }
.stat-box .label { font-size:12px; color:#666; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }

/* Progress bars */
.progress-track { background:#e8e8e8; border-radius:8px; height:10px; overflow:hidden; }
.progress-fill { height:100%; border-radius:8px; transition:width .5s; }

/* Two column */
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px; }

/* CTA */
.cta-section { background:linear-gradient(135deg, var(--cp) 0%, ${primaryColor}cc 100%); border-radius:12px; padding:28px; text-align:center; color:#fff; margin-bottom:24px; }
.cta-section h3 { font-size:20px; margin-bottom:8px; }
.cta-section p { opacity:.9; margin-bottom:16px; font-size:14px; }
.cta-button { display:inline-block; background:var(--ca); color:#333; padding:12px 32px; border-radius:8px; font-weight:600; text-decoration:none; font-size:14px; }

/* Indicator colors */
.ind-green { color:#16a34a; } .bg-green { background:#dcfce7; }
.ind-yellow { color:#ca8a04; } .bg-yellow { background:#fef9c3; }
.ind-red { color:#dc2626; } .bg-red { background:#fee2e2; }

/* Grid helpers */
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
.grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }

@media print {
    .top-bar { display:none; }
    html, body { -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
    .container { max-width:100%; padding:.3in; min-height:auto; }
}
@media (max-width:768px) {
    .grid-2, .grid-3, .grid-4, .two-col, .stats-row { grid-template-columns:1fr; }
}
</style>
</head>
<body>
<div class="top-bar">
    <div class="logo">
        ${customLogo ? `<img src="${customLogo}" alt="${companyName}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none">${companyName}</span>` : `<span style="font-size:24px">📍</span> <span>${companyName}</span>`}
    </div>
    <div class="actions">
        <a href="#" class="btn btn-outline" onclick="window.print();return false">Download PDF</a>
        <a href="${ctaUrl}" class="btn btn-primary" target="${bookingUrl ? '_blank' : '_self'}" data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}" data-pitch-level="2" onclick="window.trackCTA&&trackCTA(this)">${ctaText}</a>
    </div>
</div>
<div class="container">
    <span class="card-badge">${cardLabel}</span>
    ${bodyContent}
    ${!hideBranding ? `<div style="text-align:center;padding:16px;color:#999;font-size:12px">Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500">PathSynch</a></div>` : ''}
</div>
<script>
window.trackCTA=function(el){if(navigator.sendBeacon){navigator.sendBeacon('https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1/analytics/track',new Blob([JSON.stringify({pitchId:'${pitchId||''}',event:'cta_click',data:{ctaType:el.dataset.ctaType||null,ctaUrl:el.href||null,pitchLevel:2,segment:el.dataset.segment||null}})],{type:'application/json'}))}};
</script>
</body>
</html>`;
}

function getCardOptions(inputs, options) {
    return {
        companyName: options.sellerContext?.companyName || options.companyName || 'PathSynch',
        logoUrl: options.sellerContext?.logoUrl || options.logoUrl || null,
        hideBranding: options.hideBranding || false,
        contactEmail: options.contactEmail || 'hello@pathsynch.com',
        bookingUrl: options.bookingUrl || null,
        primaryColor: options.sellerContext?.primaryColor || options.primaryColor || '#3A6746',
        accentColor: options.sellerContext?.accentColor || options.accentColor || '#D4A847'
    };
}

// ─── CARD 1: Competitor Landscape ────────────────────────────
function renderCard1_CompetitorLandscape(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const competitors = Array.isArray(d.competitors) ? d.competitors : [];
    const pitchHooks = Array.isArray(d.pitchHooks) ? d.pitchHooks : [];
    const rg = d.ratingGap || {};

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `Competitive Landscape: ${biz}`}</h1>
    <p style="font-size:16px;color:#666;margin-bottom:24px">${d.subheadline || 'How you stack up against local competitors'}</p>

    <!-- Rating Gap Summary -->
    <div class="stats-row grid-3">
        <div class="stat-box">
            <div class="value">${rg.prospectRating || inputs.googleRating || '—'}★</div>
            <div class="label">Your Rating</div>
        </div>
        <div class="stat-box">
            <div class="value">${rg.areaAverage || '—'}★</div>
            <div class="label">Area Average</div>
        </div>
        <div class="stat-box" style="border:2px solid ${o.accentColor}">
            <div class="value" style="color:${parseFloat(rg.prospectRating) >= parseFloat(rg.areaAverage) ? '#16a34a' : '#dc2626'}">${rg.prospectRating && rg.areaAverage ? (parseFloat(rg.prospectRating) - parseFloat(rg.areaAverage) > 0 ? '+' : '') + (parseFloat(rg.prospectRating) - parseFloat(rg.areaAverage)).toFixed(1) : '—'}</div>
            <div class="label">Rating Gap</div>
        </div>
    </div>

    ${rg.gapAnalysis ? `<div class="section section-accent" style="margin-bottom:24px"><p style="font-size:14px;line-height:1.6">${rg.gapAnalysis}</p></div>` : ''}

    <!-- Competitor Grid -->
    <div class="section">
        <h3>🏆 Competitor Comparison</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
                <tr style="border-bottom:2px solid ${o.primaryColor}">
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor}">Competitor</th>
                    <th style="text-align:center;padding:10px 8px;color:${o.primaryColor}">Rating</th>
                    <th style="text-align:center;padding:10px 8px;color:${o.primaryColor}">Reviews</th>
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor}">Strength</th>
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor}">Vulnerability</th>
                </tr>
            </thead>
            <tbody>
                <tr style="background:#f0fdf4;border-bottom:1px solid #e8e8e8;font-weight:600">
                    <td style="padding:10px 8px">📍 ${biz}</td>
                    <td style="text-align:center;padding:10px 8px">${inputs.googleRating || '—'}★</td>
                    <td style="text-align:center;padding:10px 8px">${inputs.numReviews || '—'}</td>
                    <td style="padding:10px 8px;font-size:13px" colspan="2">Your business</td>
                </tr>
                ${competitors.slice(0, 5).map((c, i) => `
                <tr style="border-bottom:1px solid #eee${i % 2 === 0 ? '' : ';background:#fafafa'}">
                    <td style="padding:10px 8px">${c.name || `Competitor ${i + 1}`}</td>
                    <td style="text-align:center;padding:10px 8px">${c.rating || '—'}★</td>
                    <td style="text-align:center;padding:10px 8px">${c.reviews || '—'}</td>
                    <td style="padding:10px 8px;font-size:13px;color:#666">${c.strength || '—'}</td>
                    <td style="padding:10px 8px;font-size:13px;color:#dc2626">${c.weakness || '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>

    <!-- Value Gap -->
    ${d.valueGap ? `
    <div class="section section-accent">
        <h3>🎯 Your Competitive Edge</h3>
        <p style="font-size:15px;line-height:1.6">${d.valueGap}</p>
    </div>` : ''}

    <!-- Positioning Insight -->
    ${d.positioningInsight ? `
    <div class="section" style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #86efac">
        <h3 style="border-bottom-color:#16a34a">📊 Positioning Insight</h3>
        <p style="font-size:14px;line-height:1.6">${d.positioningInsight}</p>
    </div>` : ''}

    <!-- Pitch Hooks -->
    ${pitchHooks.length > 0 ? `
    <div class="section">
        <h3>🪝 Data-Backed Pitch Hooks</h3>
        ${pitchHooks.map((h, i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${i < pitchHooks.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="background:${o.primaryColor};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${i + 1}</span>
            <p style="font-size:14px;line-height:1.5">${h}</p>
        </div>`).join('')}
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Ready to outpace the competition, ${biz}?`}</h3>
        <p>Turn competitive intelligence into closed deals</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - Competitor Landscape`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'Competitor Landscape' });
}

// ─── CARD 2: Reputation Health ───────────────────────────────
function renderCard2_ReputationHealth(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const complaints = Array.isArray(d.complaintPatterns) ? d.complaintPatterns : [];
    const actions = Array.isArray(d.actionPlan) ? d.actionPlan : [];
    const sb = d.sentimentBreakdown || {};
    const rating = d.currentRating || inputs.googleRating || 4.0;
    const ratingPct = (parseFloat(rating) / 5 * 100).toFixed(0);

    function healthColor(val, good, warn) {
        if (!val) return '#666';
        const n = parseFloat(val);
        if (n >= good) return '#16a34a';
        if (n >= warn) return '#ca8a04';
        return '#dc2626';
    }

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `Reputation Health: ${biz}`}</h1>
    <p style="font-size:16px;color:#666;margin-bottom:24px">${d.subheadline || 'Your online reputation at a glance'}</p>

    <!-- Health Scorecard -->
    <div class="stats-row grid-4">
        <div class="stat-box">
            <div class="value" style="color:${healthColor(rating, 4.3, 3.5)}">${rating}★</div>
            <div class="label">Current Rating</div>
        </div>
        <div class="stat-box">
            <div class="value">${d.reviewCount || inputs.numReviews || '—'}</div>
            <div class="label">Total Reviews</div>
        </div>
        <div class="stat-box">
            <div class="value">${d.reviewVelocity || '—'}</div>
            <div class="label">Reviews/Month</div>
        </div>
        <div class="stat-box" style="border:2px solid ${healthColor(null, 0, 0)}">
            <div class="value" style="font-size:16px;color:${o.primaryColor}">${d.responseRateGap || '—'}</div>
            <div class="label">Response Rate Gap</div>
        </div>
    </div>

    <!-- Rating Bar -->
    <div class="section" style="margin-bottom:24px">
        <h3>⭐ Rating Health</h3>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
            <span style="font-size:36px;font-weight:700;color:${o.primaryColor}">${rating}</span>
            <div style="flex:1">
                <div class="progress-track" style="height:16px;margin-bottom:4px">
                    <div class="progress-fill" style="width:${ratingPct}%;background:linear-gradient(90deg,${healthColor(rating, 4.3, 3.5)},${o.primaryColor})"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#999">
                    <span>0</span><span>Industry Best: 4.5+</span><span>5.0</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Sentiment Breakdown -->
    <div class="two-col">
        <div class="section" style="background:#f0fdf4;border:1px solid #bbf7d0">
            <h3 style="color:#16a34a;border-bottom-color:#16a34a">👍 What's Working</h3>
            <p style="font-size:14px;line-height:1.6">${sb.positive || 'Positive themes not yet analyzed'}</p>
        </div>
        <div class="section" style="background:#fef2f2;border:1px solid #fecaca">
            <h3 style="color:#dc2626;border-bottom-color:#dc2626">👎 Areas of Concern</h3>
            <p style="font-size:14px;line-height:1.6">${sb.negative || 'Negative themes not yet analyzed'}</p>
        </div>
    </div>

    <!-- Complaint Patterns -->
    ${complaints.length > 0 ? `
    <div class="section section-accent">
        <h3>⚠️ Top Complaint Patterns</h3>
        ${complaints.map((c, i) => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;${i < complaints.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="background:#fee2e2;color:#dc2626;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${i + 1}</span>
            <span style="font-size:14px">${c}</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- Revenue Impact -->
    ${d.revenueImpact ? `
    <div class="section" style="background:linear-gradient(135deg,#fefce8,#fef9c3);border:1px solid ${o.accentColor}">
        <h3 style="color:#92400e;border-bottom-color:${o.accentColor}">💰 Revenue Impact</h3>
        <p style="font-size:15px;line-height:1.6;font-weight:500">${d.revenueImpact}</p>
    </div>` : ''}

    <!-- Action Plan -->
    ${actions.length > 0 ? `
    <div class="section">
        <h3>✅ Recommended Action Plan</h3>
        ${actions.map((a, i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${i < actions.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="background:${o.primaryColor};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${i + 1}</span>
            <p style="font-size:14px;line-height:1.5">${a}</p>
        </div>`).join('')}
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Protect and grow ${biz}'s reputation`}</h3>
        <p>Turn reviews into your strongest sales tool</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - Reputation Health`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'Reputation Health' });
}

// ─── CARD 3: Market Opportunity ──────────────────────────────
function renderCard3_MarketOpportunity(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const captureStrategy = Array.isArray(d.captureStrategy) ? d.captureStrategy : [];
    const oppScore = parseInt(d.opportunityScore) || 0;
    const oppColor = oppScore >= 70 ? '#16a34a' : oppScore >= 40 ? '#ca8a04' : '#dc2626';

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `Market Opportunity: ${biz}`}</h1>
    <p style="font-size:16px;color:#666;margin-bottom:24px">${d.subheadline || 'Local market intelligence at a glance'}</p>

    <!-- Big Numbers Dashboard -->
    <div class="stats-row grid-4">
        <div class="stat-box" style="border-top:4px solid ${oppColor}">
            <div class="value" style="font-size:36px;color:${oppColor}">${oppScore}</div>
            <div class="label">Opportunity Score</div>
        </div>
        <div class="stat-box">
            <div class="value" style="font-size:20px">${d.tamEstimate || '—'}</div>
            <div class="label">Market Size (TAM)</div>
        </div>
        <div class="stat-box">
            <div class="value">${d.competitorCount || '—'}</div>
            <div class="label">Competitors</div>
        </div>
        <div class="stat-box">
            <div class="value" style="font-size:18px">${d.growthRate || '—'}</div>
            <div class="label">Growth Trend</div>
        </div>
    </div>

    <!-- Opportunity Meter -->
    <div class="section" style="margin-bottom:24px">
        <h3>📊 Opportunity Score</h3>
        <div style="position:relative;margin:8px 0 16px">
            <div class="progress-track" style="height:24px;border-radius:12px">
                <div class="progress-fill" style="width:${oppScore}%;background:linear-gradient(90deg,#dc2626 0%,#ca8a04 40%,#16a34a 70%);border-radius:12px"></div>
            </div>
            <div style="position:absolute;top:28px;left:${Math.min(oppScore, 95)}%;transform:translateX(-50%);font-size:12px;font-weight:700;color:${oppColor}">${oppScore}/100</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-top:20px">
            <span>Low Opportunity</span><span>Moderate</span><span>High Opportunity</span>
        </div>
    </div>

    <!-- Market Factors -->
    <div class="two-col">
        <div class="section">
            <h3>🏪 Market Saturation</h3>
            <p style="font-size:15px;font-weight:600;color:${o.primaryColor};margin-bottom:8px">${d.marketSaturation || '—'}</p>
            <p style="font-size:13px;color:#666">${d.competitorCount ? `${d.competitorCount} competitors in your local area` : ''}</p>
        </div>
        <div class="section">
            <h3>👥 Demographic Fit</h3>
            <p style="font-size:14px;line-height:1.6">${d.demographicFit || 'Demographic analysis not available'}</p>
        </div>
    </div>

    <!-- Revenue Upside -->
    ${d.revenueUpside ? `
    <div class="section" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #16a34a">
        <h3 style="color:#16a34a;border-bottom-color:#16a34a">💰 Revenue Upside</h3>
        <p style="font-size:15px;line-height:1.6;font-weight:500">${d.revenueUpside}</p>
    </div>` : ''}

    <!-- Capture Strategy -->
    ${captureStrategy.length > 0 ? `
    <div class="section">
        <h3>🚀 Capture Strategy</h3>
        ${captureStrategy.map((s, i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${i < captureStrategy.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="background:${o.primaryColor};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${i + 1}</span>
            <p style="font-size:14px;line-height:1.5">${s}</p>
        </div>`).join('')}
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Capture the opportunity for ${biz}`}</h3>
        <p>Turn market intelligence into market share</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - Market Opportunity`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'Market Opportunity' });
}

// ─── CARD 4: Pre-Call Brief ──────────────────────────────────
function renderCard4_PreCallBrief(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const talkingPoints = Array.isArray(d.talkingPoints) ? d.talkingPoints : [];
    const questions = Array.isArray(d.discoveryQuestions) ? d.discoveryQuestions : [];
    const objections = Array.isArray(d.objections) ? d.objections : [];
    const competitorWatch = Array.isArray(d.competitorWatch) ? d.competitorWatch : [];

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `Pre-Call Brief: ${biz}`}</h1>
    <p style="font-size:14px;color:#666;margin-bottom:24px;font-style:italic">Internal document — not for prospect distribution</p>

    <!-- Company Snapshot -->
    ${d.companySnapshot ? `
    <div class="section" style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #86efac;border-left:4px solid ${o.primaryColor}">
        <h3>🏢 Company Snapshot</h3>
        <p style="font-size:15px;line-height:1.6">${d.companySnapshot}</p>
    </div>` : ''}

    <!-- Meeting Trigger + Opener -->
    <div class="two-col">
        ${d.meetingTrigger ? `
        <div class="section" style="border-left:4px solid #16a34a">
            <h3 style="color:#16a34a;border-bottom-color:#16a34a">🎯 Why They'll Take the Meeting</h3>
            <p style="font-size:14px;line-height:1.6">${d.meetingTrigger}</p>
        </div>` : '<div></div>'}
        ${d.suggestedOpener ? `
        <div class="section" style="border-left:4px solid ${o.accentColor}">
            <h3 style="color:#92400e;border-bottom-color:${o.accentColor}">💬 Suggested Opener</h3>
            <p style="font-size:15px;line-height:1.6;font-style:italic;color:#333">"${d.suggestedOpener}"</p>
        </div>` : '<div></div>'}
    </div>

    <!-- Talking Points -->
    ${talkingPoints.length > 0 ? `
    <div class="section">
        <h3>📋 Talking Points</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
                <tr style="border-bottom:2px solid ${o.primaryColor}">
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor};width:35%">Point</th>
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor};width:30%">Product</th>
                    <th style="text-align:left;padding:10px 8px;color:${o.primaryColor};width:35%">Data Backup</th>
                </tr>
            </thead>
            <tbody>
                ${talkingPoints.slice(0, 5).map((tp, i) => `
                <tr style="border-bottom:1px solid #eee${i % 2 === 0 ? '' : ';background:#fafafa'}">
                    <td style="padding:10px 8px">${tp.point || tp}</td>
                    <td style="padding:10px 8px"><span style="background:${o.primaryColor}22;color:${o.primaryColor};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${tp.product || '—'}</span></td>
                    <td style="padding:10px 8px;font-size:13px;color:#666">${tp.dataBackup || '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>` : ''}

    <!-- Discovery Questions -->
    ${questions.length > 0 ? `
    <div class="section section-accent">
        <h3>❓ Discovery Questions</h3>
        ${questions.map((q, i) => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;${i < questions.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="color:${o.primaryColor};font-weight:700;flex-shrink:0">Q${i + 1}.</span>
            <p style="font-size:14px;line-height:1.5">${q}</p>
        </div>`).join('')}
    </div>` : ''}

    <!-- Objection Handling -->
    ${objections.length > 0 ? `
    <div class="section">
        <h3>🛡️ Objection Handling</h3>
        ${objections.map((obj, i) => `
        <div style="margin-bottom:${i < objections.length - 1 ? '16px' : '0'};padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #dc2626">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600">OBJECTION</span>
                <span style="font-size:14px;font-weight:600">${obj.objection || obj}</span>
            </div>
            ${obj.response ? `
            <div style="display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px dashed #ddd">
                <span style="background:#dcfce7;color:#16a34a;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600">RESPONSE</span>
                <span style="font-size:14px;color:#333">${obj.response}</span>
            </div>` : ''}
        </div>`).join('')}
    </div>` : ''}

    <!-- Competitor Watch -->
    ${competitorWatch.length > 0 ? `
    <div class="section" style="background:#fefce8;border:1px solid #fde68a">
        <h3 style="color:#92400e;border-bottom-color:#f59e0b">👀 Competitor Watch</h3>
        <ul style="list-style:none">
            ${competitorWatch.map(c => `
            <li style="padding:8px 0;font-size:14px;border-bottom:1px solid #fde68a;display:flex;align-items:flex-start;gap:8px">
                <span style="color:#f59e0b;font-weight:bold;flex-shrink:0">⚔️</span>${c}
            </li>`).join('')}
        </ul>
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Close the deal with ${biz}`}</h3>
        <p>You're armed with the intel — now make the call</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - Pre-Call Brief`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'Pre-Call Brief' });
}

// ─── CARD 5: Referral Potential ──────────────────────────────
function renderCard5_ReferralPotential(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const programDesign = Array.isArray(d.programDesign) ? d.programDesign : [];
    const reward = d.rewardStructure || {};

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `Referral Revenue Potential: ${biz}`}</h1>
    <p style="font-size:16px;color:#666;margin-bottom:24px">${d.subheadline || 'Unlock hidden revenue through customer referrals'}</p>

    <!-- Before / After Comparison -->
    <div class="two-col" style="margin-bottom:24px">
        <div class="section" style="background:#fef2f2;border:2px solid #fecaca;text-align:center">
            <h3 style="color:#dc2626;border-bottom-color:#dc2626">📉 Without Referral Program</h3>
            <div style="font-size:42px;font-weight:700;color:#dc2626;margin:16px 0">${d.currentMonthlyReferrals || '—'}</div>
            <div style="font-size:14px;color:#666;text-transform:uppercase;letter-spacing:.5px">Monthly Referrals</div>
        </div>
        <div class="section" style="background:#f0fdf4;border:2px solid #86efac;text-align:center">
            <h3 style="color:#16a34a;border-bottom-color:#16a34a">📈 With ReferralSynch</h3>
            <div style="font-size:42px;font-weight:700;color:#16a34a;margin:16px 0">${d.potentialMonthlyReferrals || '—'}</div>
            <div style="font-size:14px;color:#666;text-transform:uppercase;letter-spacing:.5px">Monthly Referrals</div>
        </div>
    </div>

    <!-- Revenue Projection -->
    <div class="stats-row grid-3">
        <div class="stat-box" style="border-top:4px solid #16a34a">
            <div class="value" style="color:#16a34a;font-size:24px">${d.annualRevenueUnlocked || '—'}</div>
            <div class="label">Annual Revenue Unlocked</div>
        </div>
        <div class="stat-box" style="border-top:4px solid ${o.accentColor}">
            <div class="value" style="font-size:20px">${reward.amount || '—'}</div>
            <div class="label">${reward.type || 'Reward'} Per Referral</div>
        </div>
        <div class="stat-box" style="border-top:4px solid ${o.primaryColor}">
            <div class="value" style="font-size:20px">${d.paybackPeriod || '—'}</div>
            <div class="label">Payback Period</div>
        </div>
    </div>

    <!-- Reward Structure -->
    ${reward.rationale ? `
    <div class="section section-accent">
        <h3>🎁 Recommended Reward Structure</h3>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
            <div style="background:${o.primaryColor};color:#fff;padding:12px 24px;border-radius:8px;font-size:20px;font-weight:700">${reward.amount || '—'}</div>
            <div>
                <div style="font-size:15px;font-weight:600">${reward.type || 'Reward'}</div>
                <div style="font-size:13px;color:#666">${reward.rationale}</div>
            </div>
        </div>
    </div>` : ''}

    <!-- Program Design -->
    ${programDesign.length > 0 ? `
    <div class="section">
        <h3>📋 Program Design Recommendations</h3>
        ${programDesign.map((p, i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${i < programDesign.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <span style="background:${o.primaryColor};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${i + 1}</span>
            <p style="font-size:14px;line-height:1.5">${p}</p>
        </div>`).join('')}
    </div>` : ''}

    <!-- Social Proof -->
    ${d.socialProof ? `
    <div class="section" style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #86efac">
        <h3 style="color:#16a34a;border-bottom-color:#16a34a">📊 Industry Benchmark</h3>
        <p style="font-size:14px;line-height:1.6">${d.socialProof}</p>
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Start turning ${biz}'s customers into a growth engine`}</h3>
        <p>Launch your referral program in under a week</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - Referral Potential`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'Referral Potential' });
}

// ─── CARD 6: GBP Audit ──────────────────────────────────────
function renderCard6_GBPAudit(inputs, options, pitchId) {
    const d = options.libraryEnhancedContent;
    const biz = inputs.businessName || 'Your Business';
    const o = getCardOptions(inputs, options);
    const dimensions = Array.isArray(d.dimensions) ? d.dimensions : [];
    const quickWins = Array.isArray(d.quickWins) ? d.quickWins : [];
    const plan = Array.isArray(d.fullOptimizationPlan) ? d.fullOptimizationPlan : [];
    const gap = d.highestImpactGap || {};
    const score = parseInt(d.gbpScore) || 0;
    const scoreColor = score >= 80 ? '#16a34a' : score >= 50 ? '#ca8a04' : '#dc2626';

    function dimColor(score) {
        if (score === 'complete') return { bg: '#dcfce7', text: '#16a34a', pct: 100 };
        if (score === 'partial') return { bg: '#fef9c3', text: '#ca8a04', pct: 50 };
        return { bg: '#fee2e2', text: '#dc2626', pct: 10 };
    }

    const body = `
    <h1 style="font-size:28px;color:${o.primaryColor};margin-bottom:8px">${d.headline || `GBP Audit: ${biz}`}</h1>
    <p style="font-size:16px;color:#666;margin-bottom:24px">${d.subheadline || 'Google Business Profile completeness analysis'}</p>

    <!-- GBP Score -->
    <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;position:relative;width:160px;height:160px">
            <svg viewBox="0 0 160 160" style="transform:rotate(-90deg)">
                <circle cx="80" cy="80" r="70" fill="none" stroke="#e8e8e8" stroke-width="12"/>
                <circle cx="80" cy="80" r="70" fill="none" stroke="${scoreColor}" stroke-width="12" stroke-dasharray="${score * 4.4} 440" stroke-linecap="round"/>
            </svg>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
                <div style="font-size:36px;font-weight:700;color:${scoreColor}">${score}</div>
                <div style="font-size:12px;color:#666">/ 100</div>
            </div>
        </div>
        <div style="margin-top:8px;font-size:14px;font-weight:600;color:${scoreColor}">${score >= 80 ? 'Strong Profile' : score >= 50 ? 'Needs Improvement' : 'Critical Gaps'}</div>
    </div>

    <!-- Dimension Breakdown -->
    ${dimensions.length > 0 ? `
    <div class="section" style="margin-bottom:24px">
        <h3>📊 Dimension Breakdown</h3>
        ${dimensions.map(dim => {
            const dc = dimColor(dim.score);
            return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #eee">
            <div style="width:140px;font-size:14px;font-weight:500">${dim.name || '—'}</div>
            <div style="flex:1">
                <div class="progress-track">
                    <div class="progress-fill" style="width:${dc.pct}%;background:${dc.text}"></div>
                </div>
            </div>
            <span style="background:${dc.bg};color:${dc.text};padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;width:80px;text-align:center;text-transform:capitalize">${dim.score || '—'}</span>
            <span style="font-size:11px;color:#999;width:50px;text-align:center">${dim.impact || '—'} impact</span>
        </div>`;
        }).join('')}
    </div>` : ''}

    <!-- Highest Impact Gap -->
    ${gap.dimension ? `
    <div class="section" style="background:linear-gradient(135deg,#fef2f2,#fff1f2);border:2px solid #fecaca;border-left:4px solid #dc2626">
        <h3 style="color:#dc2626;border-bottom-color:#dc2626">🚨 Highest-Impact Gap: ${gap.dimension}</h3>
        ${gap.currentState ? `<p style="font-size:13px;color:#666;margin-bottom:8px"><strong>Current:</strong> ${gap.currentState}</p>` : ''}
        ${gap.fixDescription ? `<p style="font-size:14px;line-height:1.6;margin-bottom:8px"><strong>Fix:</strong> ${gap.fixDescription}</p>` : ''}
        ${gap.estimatedLift ? `<p style="font-size:14px;font-weight:600;color:#16a34a">📈 Expected lift: ${gap.estimatedLift}</p>` : ''}
    </div>` : ''}

    <!-- Quick Wins -->
    ${quickWins.length > 0 ? `
    <div class="section" style="background:#f0fdf4;border:1px solid #86efac">
        <h3 style="color:#16a34a;border-bottom-color:#16a34a">⚡ Quick Wins (Fix Today)</h3>
        ${quickWins.map(w => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0">
            <input type="checkbox" disabled style="margin-top:3px;accent-color:${o.primaryColor}">
            <span style="font-size:14px">${w}</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- Full Optimization Plan -->
    ${plan.length > 0 ? `
    <div class="section">
        <h3>📅 Optimization Roadmap</h3>
        ${plan.map((step, i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;${i < plan.length - 1 ? 'border-bottom:1px solid #eee' : ''}">
            <div style="background:${o.primaryColor};color:#fff;min-width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${i + 1}</div>
            <p style="font-size:14px;line-height:1.5">${step}</p>
        </div>`).join('')}
    </div>` : ''}

    <div class="cta-section">
        <h3>${d.cta || `Optimize ${biz}'s Google presence`}</h3>
        <p>Get found by more local customers — starting today</p>
        <a href="${o.bookingUrl || `mailto:${o.contactEmail}`}" class="cta-button" target="${o.bookingUrl ? '_blank' : '_self'}">${o.bookingUrl ? 'Book a Demo' : 'Schedule Your Demo'}</a>
    </div>`;

    return cardShell(`${biz} - GBP Audit`, o.primaryColor, o.accentColor, body, pitchId, { ...o, cardLabel: 'GBP Audit' });
}

module.exports = {
    generateLevel2
};
