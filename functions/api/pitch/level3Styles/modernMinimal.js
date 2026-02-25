/**
 * Modern Minimal Style - L3 Slide Deck
 *
 * Lots of whitespace. One idea per slide. Large bold headlines, small supporting text.
 * Muted color palette (whites, light grays, one accent color). Think Apple keynote.
 *
 * @module pitch/level3Styles/modernMinimal
 */

const { getIndustryIntelligence } = require('../../../config/industryIntelligence');
const { formatCurrency } = require('../../../utils/roiCalculator');

/**
 * Color palette for Modern Minimal style
 */
const CONFIG = {
    colors: {
        primary: '#111827',      // Near black
        secondary: '#6b7280',    // Gray
        accent: '#3b82f6',       // Blue
        background: '#ffffff',
        slideBackground: '#fafafa',
        text: '#111827',
        textLight: '#9ca3af'
    },
    fonts: {
        heading: "'Helvetica Neue', Arial, sans-serif",
        body: "'Helvetica Neue', Arial, sans-serif"
    }
};

/**
 * Build a minimal slide
 */
function buildSlide(content, slideNumber, totalSlides) {
    return `
        <div class="slide">
            <div class="slide-content">
                ${content}
            </div>
            <div class="slide-footer">
                <span class="slide-number">${slideNumber} / ${totalSlides}</span>
            </div>
        </div>
    `;
}

/**
 * Generate Modern Minimal style L3 slide deck
 */
function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const industry = inputs.industry || 'local business';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';
    const contactEmail = options.contactEmail || 'hello@pathsynch.com';
    const bookingUrl = options.bookingUrl || null;
    const ctaUrl = bookingUrl || `mailto:${contactEmail}?subject=Demo Request: ${encodeURIComponent(businessName)}`;

    // Get industry intelligence
    const salesIntel = getIndustryIntelligence(industry, inputs.subIndustry);

    // ROI metrics
    const annualImpact = roiData?.annualValue || roiData?.projectedAnnualValue || 50000;
    const costReduction = roiData?.costReduction || 30;
    const paybackMonths = roiData?.paybackPeriod || 6;

    // Build slides
    const slides = [];

    // Slide 1: Title
    slides.push(`
        <div class="title-content">
            <h1>${businessName}</h1>
            <p class="subtitle">Growth Opportunity</p>
            <p class="prepared">Prepared by ${companyName}</p>
        </div>
    `);

    // Slide 2: The Opportunity (hero metric)
    slides.push(`
        <div class="hero-slide">
            <p class="label">Potential Annual Impact</p>
            <h1 class="hero-number">${formatCurrency(annualImpact)}</h1>
        </div>
    `);

    // Slide 3: The Challenge
    slides.push(`
        <h2>The Challenge</h2>
        <p class="big-text">${inputs.statedProblem || 'Growing in today\'s competitive market requires new strategies.'}</p>
    `);

    // Slide 4: Key Pain Points
    const painPoints = salesIntel.painPoints?.slice(0, 3) || ['Increasing costs', 'Changing customer expectations', 'Manual processes'];
    slides.push(`
        <h2>What We're Hearing</h2>
        <ul class="minimal-list">
            ${painPoints.map(p => `<li>${p}</li>`).join('')}
        </ul>
    `);

    // Slide 5: The Solution
    slides.push(`
        <h2>The Solution</h2>
        <p class="big-text">${companyName} helps businesses like ${businessName} achieve measurable growth through proven strategies.</p>
    `);

    // Slide 6: Key Benefits
    slides.push(`
        <h2>What You Get</h2>
        <div class="three-stats">
            <div class="stat">
                <span class="stat-value">${costReduction}%</span>
                <span class="stat-label">Cost Reduction</span>
            </div>
            <div class="stat">
                <span class="stat-value">${paybackMonths}mo</span>
                <span class="stat-label">ROI Timeline</span>
            </div>
            <div class="stat">
                <span class="stat-value">24/7</span>
                <span class="stat-label">Support</span>
            </div>
        </div>
    `);

    // Slide 7: Social Proof
    slides.push(`
        <h2>Trusted Results</h2>
        <p class="big-text">"${salesIntel.testimonials?.[0] || 'They transformed our business. The results speak for themselves.'}"</p>
        <p class="attribution">— Similar ${industry} Business</p>
    `);

    // Slide 8: Next Steps
    slides.push(`
        <h2>Let's Talk</h2>
        <p class="big-text">Schedule a brief conversation to explore how we can help ${businessName}.</p>
        <a href="${ctaUrl}" class="cta-link">${bookingUrl ? 'Book a Demo →' : 'Get in Touch →'}</a>
    `);

    // Slide 9: Contact
    slides.push(`
        <div class="contact-slide">
            <h2>${companyName}</h2>
            <p>${contactEmail}</p>
            ${bookingUrl ? `<p><a href="${bookingUrl}">${bookingUrl.replace('https://', '')}</a></p>` : ''}
        </div>
    `);

    const totalSlides = slides.length;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Deck | ${companyName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: ${CONFIG.fonts.body};
            background: ${CONFIG.colors.slideBackground};
            color: ${CONFIG.colors.text};
        }

        .slide {
            width: 100%;
            min-height: 100vh;
            padding: 80px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: ${CONFIG.colors.background};
            border-bottom: 1px solid #e5e7eb;
            position: relative;
        }

        .slide-content {
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
        }

        .slide-footer {
            position: absolute;
            bottom: 40px;
            left: 0;
            right: 0;
            text-align: center;
        }

        .slide-number {
            font-size: 14px;
            color: ${CONFIG.colors.textLight};
        }

        /* Title Slide */
        .title-content {
            text-align: center;
        }

        .title-content h1 {
            font-size: 56px;
            font-weight: 700;
            letter-spacing: -1px;
            margin-bottom: 24px;
        }

        .title-content .subtitle {
            font-size: 24px;
            color: ${CONFIG.colors.accent};
            margin-bottom: 48px;
        }

        .title-content .prepared {
            font-size: 16px;
            color: ${CONFIG.colors.textLight};
        }

        /* Hero Slide */
        .hero-slide {
            text-align: center;
        }

        .hero-slide .label {
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: ${CONFIG.colors.textLight};
            margin-bottom: 24px;
        }

        .hero-number {
            font-size: 96px;
            font-weight: 700;
            color: ${CONFIG.colors.accent};
            letter-spacing: -2px;
        }

        /* Standard Slides */
        h2 {
            font-size: 40px;
            font-weight: 700;
            margin-bottom: 40px;
            letter-spacing: -0.5px;
        }

        .big-text {
            font-size: 28px;
            line-height: 1.5;
            color: ${CONFIG.colors.secondary};
        }

        .minimal-list {
            list-style: none;
            font-size: 24px;
        }

        .minimal-list li {
            padding: 20px 0;
            border-bottom: 1px solid #e5e7eb;
        }

        .minimal-list li:before {
            content: "→";
            margin-right: 16px;
            color: ${CONFIG.colors.accent};
        }

        /* Stats */
        .three-stats {
            display: flex;
            justify-content: space-between;
            margin-top: 40px;
        }

        .stat {
            text-align: center;
        }

        .stat-value {
            display: block;
            font-size: 64px;
            font-weight: 700;
            color: ${CONFIG.colors.accent};
        }

        .stat-label {
            font-size: 16px;
            color: ${CONFIG.colors.textLight};
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* Attribution */
        .attribution {
            margin-top: 32px;
            font-size: 16px;
            color: ${CONFIG.colors.textLight};
        }

        /* CTA */
        .cta-link {
            display: inline-block;
            margin-top: 40px;
            font-size: 20px;
            color: ${CONFIG.colors.accent};
            text-decoration: none;
            font-weight: 600;
        }

        .cta-link:hover {
            text-decoration: underline;
        }

        /* Contact Slide */
        .contact-slide {
            text-align: center;
        }

        .contact-slide h2 {
            font-size: 48px;
            margin-bottom: 24px;
        }

        .contact-slide p {
            font-size: 20px;
            color: ${CONFIG.colors.secondary};
            margin-bottom: 8px;
        }

        .contact-slide a {
            color: ${CONFIG.colors.accent};
            text-decoration: none;
        }

        @media print {
            .slide {
                page-break-after: always;
                height: 100vh;
            }
        }

        @media (max-width: 768px) {
            .slide { padding: 40px; }
            .title-content h1 { font-size: 36px; }
            .hero-number { font-size: 56px; }
            h2 { font-size: 28px; }
            .big-text { font-size: 20px; }
            .stat-value { font-size: 40px; }
            .three-stats { flex-direction: column; gap: 32px; }
        }
    </style>
</head>
<body>
    ${slides.map((content, i) => buildSlide(content, i + 1, totalSlides)).join('')}
</body>
</html>`;
}

module.exports = { generate };
