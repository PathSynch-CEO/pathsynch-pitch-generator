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
    const hideBranding = options.hideBranding || inputs.hideBranding || false;
    const customPrimaryColor = options.sellerContext?.primaryColor || options.primaryColor || inputs.primaryColor || '#3A6746';
    const customAccentColor = options.sellerContext?.accentColor || options.accentColor || inputs.accentColor || '#D4A847';
    const customLogo = options.sellerContext?.logoUrl || options.logoUrl || inputs.logoUrl || null;
    const companyName = options.sellerContext?.companyName || options.companyName || inputs.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || inputs.contactEmail || 'hello@pathsynch.com';
    const customFooterText = options.footerText || inputs.footerText || '';

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
            ${customLogo ? `<img src="${customLogo}" alt="${companyName}">` : `<span style="font-size:24px;">📍</span> <span>${companyName}</span>`}
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
            <h1>${businessName}</h1>
            <p class="subtitle">${hideBranding ? 'Opportunity Brief' : companyName + ' Opportunity Brief'}</p>
            <div class="meta">
                <span class="meta-item">⭐ ${googleRating} Google Rating</span>
                <span class="meta-item">📝 ${numReviews} Reviews</span>
                <span class="meta-item">🏢 ${industry}</span>
            </div>
        </div>

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

        <!-- Two Column: Opportunity + Customer Analysis -->
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

        <!-- Industry Pain Points -->
        <div class="card" style="margin-bottom: 24px; border-left: 4px solid ${customAccentColor};">
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
        </div>

        <!-- Products Section -->
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
            <h3>Ready to Grow ${businessName}?</h3>
            <p>See how ${hideBranding ? 'we' : companyName} can help you ${statedProblem}</p>
            <a href="${ctaUrl}" class="cta-button" target="${bookingUrl ? '_blank' : '_self'}"
               data-cta-type="${bookingUrl ? 'book_demo' : 'contact'}"
               data-pitch-level="2"
               data-segment="${industry}"
               onclick="window.trackCTA && trackCTA(this)">${ctaText}</a>
            ${bookingUrl ? `<div class="contact" style="margin-top:12px;font-size:12px;opacity:0.8;">Or email: ${contactEmail}</div>` : `<div class="contact">${contactEmail}</div>`}
        </div>
        ${customFooterText ? `
        <div style="margin-top: 24px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0;">${customFooterText}</p>
        </div>
        ` : ''}
        ${!hideBranding ? `
        <div style="text-align:center;padding:16px;color:#999;font-size:12px;">
            Powered by <a href="https://pathsynch.com" target="_blank" style="color:#3A6746;text-decoration:none;font-weight:500;">PathSynch</a>
        </div>
        ` : ''}
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

module.exports = {
    generateLevel2
};
