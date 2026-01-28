/**
 * PPT Slide Templates
 *
 * Template definitions for PowerPoint export (Level 3 pitches)
 */

// Color scheme mapping
function getColorScheme(options = {}) {
    return {
        primary: options.primaryColor || '#3A6746',
        secondary: options.secondaryColor || '#6B4423',
        accent: options.accentColor || '#D4A847',
        positive: '#22c55e',
        neutral: '#f59e0b',
        negative: '#ef4444',
        white: '#FFFFFF',
        black: '#333333',
        gray: '#666666',
        lightGray: '#f8f9fa'
    };
}

// Slide 1: Title slide
function createTitleSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    // Background gradient (approximated with solid color)
    slide.background = { color: colors.primary };

    // Business name
    slide.addText(data.businessName || 'Business Name', {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 1,
        fontSize: 44,
        bold: true,
        color: colors.white,
        align: 'center'
    });

    // Subtitle
    slide.addText('Customer Engagement & Growth Strategy', {
        x: 0.5,
        y: 2.6,
        w: 9,
        h: 0.5,
        fontSize: 24,
        color: colors.white,
        align: 'center'
    });

    // Meta info
    const metaText = `⭐ ${data.googleRating || 4.0} Google Rating  |  📝 ${data.numReviews || 0} Reviews  |  🏢 ${data.industry || 'Business'}`;
    slide.addText(metaText, {
        x: 0.5,
        y: 3.5,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.white,
        align: 'center'
    });

    // PathSynch logo/branding
    if (!data.hideBranding) {
        slide.addText('📍 PathSynch', {
            x: 0.5,
            y: 4.8,
            w: 9,
            h: 0.4,
            fontSize: 18,
            bold: true,
            color: colors.white,
            align: 'center'
        });
    }

    // Slide number
    slide.addText('1 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.white,
        align: 'right'
    });

    return slide;
}

// Slide 2: What Makes Them Special (Sentiment Analysis)
function createSentimentSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    // Title
    slide.addText(`What Makes ${data.businessName} Special`, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    // Yellow accent line
    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    // Subtitle
    slide.addText(`Customer sentiment analysis from ${data.numReviews || 0} Google reviews`, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    const sentiment = data.reviewAnalysis?.sentiment || { positive: 65, neutral: 25, negative: 10 };

    // Donut chart (simplified as a pie chart)
    slide.addChart(pptx.ChartType.doughnut, [
        {
            name: 'Sentiment',
            labels: ['Positive', 'Neutral', 'Negative'],
            values: [sentiment.positive, sentiment.neutral, sentiment.negative]
        }
    ], {
        x: 0.5,
        y: 1.5,
        w: 4,
        h: 3,
        chartColors: [colors.positive, colors.neutral, colors.negative],
        showLegend: true,
        legendPos: 'b',
        holeSize: 50
    });

    // What Customers Say
    const themes = data.reviewAnalysis?.topThemes || ['Quality products', 'Excellent service', 'Great atmosphere'];
    slide.addText('💬 What Customers Say', {
        x: 5,
        y: 1.5,
        w: 4.5,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: colors.primary
    });

    themes.slice(0, 4).forEach((theme, i) => {
        slide.addText(`✓ ${theme}`, {
            x: 5,
            y: 2.0 + (i * 0.4),
            w: 4.5,
            h: 0.35,
            fontSize: 13,
            color: colors.black
        });
    });

    // Slide number
    slide.addText('2 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 3: Growth Challenges
function createChallengesSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText('Growth Challenges', {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText(`Common barriers facing ${data.industry || 'local'} businesses today`, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    // Three columns of challenges
    const challenges = [
        { title: '🔍 Discovery', items: ['Limited online visibility', 'Competitors outranking in search', 'Inconsistent review velocity', 'Incomplete Google profile'] },
        { title: '🔄 Retention', items: ['No systematic follow-up', 'Limited customer data', 'No loyalty program', 'Missed repeat opportunities'] },
        { title: '📊 Insights', items: ['Fragmented analytics', 'No attribution tracking', 'Manual reporting', 'Reactive vs. proactive'] }
    ];

    challenges.forEach((col, colIndex) => {
        const x = 0.5 + (colIndex * 3.2);

        slide.addShape(pptx.ShapeType.roundRect, {
            x: x,
            y: 1.5,
            w: 3,
            h: 2.8,
            fill: { color: colors.lightGray }
        });

        slide.addText(col.title, {
            x: x + 0.15,
            y: 1.6,
            w: 2.7,
            h: 0.4,
            fontSize: 14,
            bold: true,
            color: colors.primary
        });

        col.items.forEach((item, i) => {
            slide.addText(`• ${item}`, {
                x: x + 0.15,
                y: 2.1 + (i * 0.45),
                w: 2.7,
                h: 0.4,
                fontSize: 11,
                color: colors.black
            });
        });
    });

    // Core issue callout
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5,
        y: 4.5,
        w: 9,
        h: 0.6,
        fill: { color: '#fff3cd' }
    });

    slide.addText(`The Core Issue: ${data.statedProblem || 'Great businesses often struggle with visibility—not quality. PathSynch bridges that gap.'}`, {
        x: 0.6,
        y: 4.55,
        w: 8.8,
        h: 0.5,
        fontSize: 12,
        color: '#856404'
    });

    slide.addText('3 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 4: PathSynch Solution
function createSolutionSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText('PathSynch: The Solution Ecosystem', {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText('Integrated platform to deepen local customer engagement and drive repeat revenue', {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    const solutions = [
        {
            icon: '🎯',
            title: 'What It Does',
            items: ['Captures reviews & feedback', 'Builds Google Business Profile', 'Creates loyalty programs', 'Generates QR/NFC campaigns', 'Unified analytics dashboard']
        },
        {
            icon: '🏆',
            title: 'Key Modules',
            items: ['PathConnect: Review capture', 'LocalSynch: Google optimization', 'Forms: Surveys & NPS', 'QRSynch: Dynamic campaigns', 'SynchMate: AI chatbot']
        },
        {
            icon: '💰',
            title: 'Proven Impact',
            items: ['+44% conversion per +1 star', '+2.8% conversion per 10 reviews', 'Complete GBP: ~7x visibility', 'Loyalty: +20% AOV typically', 'NFC: 3x response rate']
        }
    ];

    solutions.forEach((sol, i) => {
        const x = 0.5 + (i * 3.2);

        slide.addShape(pptx.ShapeType.roundRect, {
            x: x,
            y: 1.5,
            w: 3,
            h: 3.4,
            fill: { color: colors.primary }
        });

        slide.addText(sol.icon, {
            x: x,
            y: 1.6,
            w: 3,
            h: 0.5,
            fontSize: 28,
            align: 'center',
            color: colors.white
        });

        slide.addText(sol.title, {
            x: x + 0.15,
            y: 2.1,
            w: 2.7,
            h: 0.4,
            fontSize: 14,
            bold: true,
            color: colors.white
        });

        sol.items.forEach((item, j) => {
            slide.addText(`• ${item}`, {
                x: x + 0.15,
                y: 2.55 + (j * 0.4),
                w: 2.7,
                h: 0.35,
                fontSize: 10,
                color: colors.white
            });
        });
    });

    slide.addText('4 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 5: Projected ROI
function createROISlide(pptx, data, colors) {
    const slide = pptx.addSlide();
    const roi = data.roiData || { monthlyVisits: 500, avgTicket: 25, repeatRate: 40, sixMonthRevenue: 5000, sixMonthCost: 1008, roi: 396 };

    slide.addText(`${data.businessName}: Projected ROI`, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText('Conservative 6-month scenario with PathSynch integration', {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    // Assumptions box
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5,
        y: 1.5,
        w: 4.5,
        h: 3.4,
        fill: { color: colors.lightGray }
    });

    slide.addText('📊 Assumptions', {
        x: 0.65,
        y: 1.6,
        w: 4.2,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: colors.primary
    });

    slide.addText('Current baseline:', {
        x: 0.65,
        y: 2.05,
        w: 4.2,
        h: 0.3,
        fontSize: 12,
        bold: true,
        color: colors.black
    });

    const assumptions = [
        `~${roi.monthlyVisits} monthly customer visits`,
        `~${roi.repeatRate}% conversion to repeat`,
        `~$${roi.avgTicket} average transaction`,
        `${data.numReviews || 0} existing Google reviews`
    ];

    assumptions.forEach((item, i) => {
        slide.addText(`• ${item}`, {
            x: 0.65,
            y: 2.35 + (i * 0.35),
            w: 4.2,
            h: 0.3,
            fontSize: 11,
            color: colors.black
        });
    });

    slide.addText('With PathSynch:', {
        x: 0.65,
        y: 3.85,
        w: 4.2,
        h: 0.3,
        fontSize: 12,
        bold: true,
        color: colors.black
    });

    slide.addText('• +30% foot traffic (improved discovery)', {
        x: 0.65,
        y: 4.15,
        w: 4.2,
        h: 0.3,
        fontSize: 11,
        color: colors.black
    });

    slide.addText('• +25% repeat rate (loyalty program)', {
        x: 0.65,
        y: 4.45,
        w: 4.2,
        h: 0.3,
        fontSize: 11,
        color: colors.black
    });

    // ROI highlight box
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 5.2,
        y: 1.5,
        w: 4.3,
        h: 1.5,
        fill: { color: colors.primary }
    });

    slide.addText(`+$${(roi.sixMonthRevenue || 5000).toLocaleString()}`, {
        x: 5.2,
        y: 1.7,
        w: 4.3,
        h: 0.7,
        fontSize: 36,
        bold: true,
        color: colors.white,
        align: 'center'
    });

    slide.addText('6-Month Incremental Revenue', {
        x: 5.2,
        y: 2.4,
        w: 4.3,
        h: 0.4,
        fontSize: 12,
        color: colors.white,
        align: 'center'
    });

    // Cost breakdown
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 5.2,
        y: 3.2,
        w: 4.3,
        h: 1.7,
        fill: { color: colors.lightGray }
    });

    slide.addText(`PathSynch Cost (6mo): ~$${(roi.sixMonthCost || 1008).toLocaleString()}`, {
        x: 5.35,
        y: 3.35,
        w: 4,
        h: 0.35,
        fontSize: 12,
        color: colors.black
    });

    slide.addText(`Net Profit: ~$${((roi.sixMonthRevenue || 5000) - (roi.sixMonthCost || 1008)).toLocaleString()}`, {
        x: 5.35,
        y: 3.75,
        w: 4,
        h: 0.35,
        fontSize: 12,
        color: colors.black
    });

    slide.addText(`ROI: ${roi.roi || 396}% in first 6 months`, {
        x: 5.35,
        y: 4.2,
        w: 4,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: colors.primary
    });

    slide.addText('5 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 6: Product Strategy
function createStrategySlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText('Product Strategy: Integrated Approach', {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText('Three-pillar system to drive discovery, engagement, and retention', {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    const pillars = [
        { title: '⭐ Pillar 1: Discovery', subtitle: 'PathConnect + LocalSynch', items: ['NFC cards for instant reviews', 'Google Business optimization', 'Review velocity tracking', 'Reputation monitoring'], color: colors.primary },
        { title: '🔗 Pillar 2: Engagement', subtitle: 'QRSynch + Forms + SynchMate', items: ['QR campaign attribution', 'Customer feedback surveys', 'AI-powered chat support', 'Short-link tracking'], color: colors.accent },
        { title: '🔄 Pillar 3: Retention', subtitle: 'PathManager + Analytics', items: ['Unified dashboard', 'Customer insights', 'Performance tracking', 'ROI measurement'], color: colors.secondary }
    ];

    pillars.forEach((pillar, i) => {
        const x = 0.5 + (i * 3.2);

        slide.addShape(pptx.ShapeType.rect, {
            x: x,
            y: 1.5,
            w: 3,
            h: 0.08,
            fill: { color: pillar.color }
        });

        slide.addShape(pptx.ShapeType.roundRect, {
            x: x,
            y: 1.6,
            w: 3,
            h: 3.2,
            fill: { color: colors.lightGray }
        });

        slide.addText(pillar.title, {
            x: x + 0.15,
            y: 1.7,
            w: 2.7,
            h: 0.4,
            fontSize: 13,
            bold: true,
            color: colors.primary
        });

        slide.addText(pillar.subtitle, {
            x: x + 0.15,
            y: 2.1,
            w: 2.7,
            h: 0.3,
            fontSize: 10,
            color: colors.gray
        });

        pillar.items.forEach((item, j) => {
            slide.addText(`• ${item}`, {
                x: x + 0.15,
                y: 2.5 + (j * 0.45),
                w: 2.7,
                h: 0.4,
                fontSize: 11,
                color: colors.black
            });
        });
    });

    slide.addText('6 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 7: 90-Day Rollout
function createRolloutSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText('Recommended 90-Day Rollout', {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText('Phased implementation for maximum impact with minimal disruption', {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    const phases = [
        { badge: 'Phase 1: Days 1-30', title: 'Foundation', items: ['PathConnect setup & NFC cards', 'Google Business Profile audit', 'Staff training on review requests', 'Baseline metrics established'] },
        { badge: 'Phase 2: Days 31-60', title: 'Expansion', items: ['QRSynch campaigns launched', 'Forms for customer feedback', 'LocalSynch optimization', 'First performance review'] },
        { badge: 'Phase 3: Days 61-90', title: 'Optimization', items: ['Full PathManager analytics', 'SynchMate chatbot (optional)', 'Campaign refinement', 'ROI assessment & planning'] }
    ];

    phases.forEach((phase, i) => {
        const x = 0.5 + (i * 3.2);

        slide.addShape(pptx.ShapeType.roundRect, {
            x: x,
            y: 1.5,
            w: 3,
            h: 3.4,
            fill: { color: colors.lightGray }
        });

        // Phase badge
        slide.addShape(pptx.ShapeType.roundRect, {
            x: x + 0.15,
            y: 1.6,
            w: 2.7,
            h: 0.35,
            fill: { color: colors.primary }
        });

        slide.addText(phase.badge, {
            x: x + 0.15,
            y: 1.6,
            w: 2.7,
            h: 0.35,
            fontSize: 10,
            bold: true,
            color: colors.white,
            align: 'center'
        });

        slide.addText(phase.title, {
            x: x + 0.15,
            y: 2.1,
            w: 2.7,
            h: 0.35,
            fontSize: 13,
            bold: true,
            color: colors.primary
        });

        phase.items.forEach((item, j) => {
            slide.addText(`• ${item}`, {
                x: x + 0.15,
                y: 2.55 + (j * 0.45),
                w: 2.7,
                h: 0.4,
                fontSize: 11,
                color: colors.black
            });
        });

        // Arrow connector (except last)
        if (i < 2) {
            slide.addShape(pptx.ShapeType.rightArrow, {
                x: x + 3,
                y: 2.9,
                w: 0.2,
                h: 0.3,
                fill: { color: colors.accent }
            });
        }
    });

    slide.addText('7 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 8: Investment/Pricing
function createPricingSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText(`PathSynch Package for ${data.businessName}`, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText(`Recommended curated bundle to ${data.statedProblem || 'drive customer engagement and growth'}`, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    // Pricing box
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5,
        y: 1.5,
        w: 3.5,
        h: 3.4,
        fill: { color: colors.primary }
    });

    slide.addText('Your Investment', {
        x: 0.5,
        y: 1.7,
        w: 3.5,
        h: 0.35,
        fontSize: 14,
        color: colors.white,
        align: 'center'
    });

    slide.addText('$168', {
        x: 0.5,
        y: 2.1,
        w: 3.5,
        h: 0.8,
        fontSize: 44,
        bold: true,
        color: colors.white,
        align: 'center'
    });

    slide.addText('per month', {
        x: 0.5,
        y: 2.85,
        w: 3.5,
        h: 0.3,
        fontSize: 12,
        color: colors.white,
        align: 'center'
    });

    const includes = ['All core modules included', 'Dedicated onboarding', 'Priority support', 'Monthly strategy calls', 'No long-term contract'];
    includes.forEach((item, i) => {
        slide.addText(`✓ ${item}`, {
            x: 0.7,
            y: 3.3 + (i * 0.35),
            w: 3.1,
            h: 0.3,
            fontSize: 10,
            color: colors.white
        });
    });

    // Products list
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 4.2,
        y: 1.5,
        w: 5.3,
        h: 3.4,
        fill: { color: colors.lightGray }
    });

    slide.addText('Recommended Products', {
        x: 4.35,
        y: 1.6,
        w: 5,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: colors.primary
    });

    const products = [
        { name: '⭐ PathConnect', price: 'Included' },
        { name: '📍 LocalSynch', price: 'Included' },
        { name: '📝 Forms', price: 'Included' },
        { name: '🔗 QRSynch', price: 'Included' },
        { name: '🤖 SynchMate', price: 'Included' },
        { name: '📊 PathManager', price: 'Included' }
    ];

    products.forEach((product, i) => {
        slide.addText(product.name, {
            x: 4.35,
            y: 2.1 + (i * 0.4),
            w: 3,
            h: 0.35,
            fontSize: 12,
            color: colors.black
        });
        slide.addText(product.price, {
            x: 7.35,
            y: 2.1 + (i * 0.4),
            w: 2,
            h: 0.35,
            fontSize: 12,
            bold: true,
            color: colors.primary,
            align: 'right'
        });
    });

    // Bundle note
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 4.35,
        y: 4.5,
        w: 5,
        h: 0.35,
        fill: { color: '#e8f5e9' }
    });

    slide.addText('Complete Platform Bundle - All tools included', {
        x: 4.35,
        y: 4.5,
        w: 5,
        h: 0.35,
        fontSize: 11,
        bold: true,
        color: colors.primary,
        align: 'center'
    });

    slide.addText('8 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 9: Next Steps
function createNextStepsSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.addText('Recommended Next Steps', {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 0.05,
        fill: { color: colors.accent }
    });

    slide.addText('Clear, actionable roadmap to move from discussion to implementation', {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: colors.gray
    });

    // Immediate column
    slide.addText('Immediate (This Week)', {
        x: 0.5,
        y: 1.5,
        w: 4.5,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 1.9,
        w: 4.5,
        h: 0.05,
        fill: { color: colors.accent }
    });

    const immediateSteps = [
        { title: '1. Schedule PathSynch demo', desc: 'See PathConnect, LocalSynch, QRSynch in action' },
        { title: '2. Review pricing options', desc: `Explore custom bundle for ${data.industry}` },
        { title: '3. Ask for case studies', desc: `Other ${data.industry} businesses using PathSynch` }
    ];

    immediateSteps.forEach((step, i) => {
        slide.addShape(pptx.ShapeType.roundRect, {
            x: 0.5,
            y: 2.0 + (i * 0.75),
            w: 4.5,
            h: 0.65,
            fill: { color: colors.lightGray }
        });

        slide.addText(step.title, {
            x: 0.65,
            y: 2.05 + (i * 0.75),
            w: 4.2,
            h: 0.3,
            fontSize: 12,
            bold: true,
            color: colors.black
        });

        slide.addText(step.desc, {
            x: 0.65,
            y: 2.35 + (i * 0.75),
            w: 4.2,
            h: 0.25,
            fontSize: 10,
            color: colors.gray
        });
    });

    // Short-term column
    slide.addText('Short-Term (Next 2-4 Weeks)', {
        x: 5.2,
        y: 1.5,
        w: 4.3,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: colors.primary
    });

    slide.addShape(pptx.ShapeType.rect, {
        x: 5.2,
        y: 1.9,
        w: 4.3,
        h: 0.05,
        fill: { color: colors.accent }
    });

    const shortTermSteps = [
        { title: '4. Pilot period', desc: 'Start with PathConnect only (30 days)' },
        { title: '5. Staff training', desc: 'NFC card placement, review request script' },
        { title: '6. Measure baseline', desc: 'Current traffic, reviews/month, repeat rate' }
    ];

    shortTermSteps.forEach((step, i) => {
        slide.addShape(pptx.ShapeType.roundRect, {
            x: 5.2,
            y: 2.0 + (i * 0.75),
            w: 4.3,
            h: 0.65,
            fill: { color: colors.lightGray }
        });

        slide.addText(step.title, {
            x: 5.35,
            y: 2.05 + (i * 0.75),
            w: 4,
            h: 0.3,
            fontSize: 12,
            bold: true,
            color: colors.black
        });

        slide.addText(step.desc, {
            x: 5.35,
            y: 2.35 + (i * 0.75),
            w: 4,
            h: 0.25,
            fontSize: 10,
            color: colors.gray
        });
    });

    // Goal callout
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5,
        y: 4.35,
        w: 9,
        h: 0.7,
        fill: { color: colors.primary }
    });

    slide.addText("Goal: By Day 30, you'll have data showing review velocity, foot traffic patterns, and early engagement interest. Then expand to full stack.", {
        x: 0.65,
        y: 4.45,
        w: 8.7,
        h: 0.5,
        fontSize: 11,
        color: colors.white,
        align: 'center'
    });

    slide.addText('9 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.gray,
        align: 'right'
    });

    return slide;
}

// Slide 10: Closing CTA
function createClosingSlide(pptx, data, colors) {
    const slide = pptx.addSlide();

    slide.background = { color: colors.primary };

    slide.addText(`Let's Unlock ${data.businessName}'s Potential`, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 0.8,
        fontSize: 36,
        bold: true,
        color: colors.white,
        align: 'center'
    });

    slide.addText('Your product is great. Your customers love you. Now let\'s make sure everyone knows.', {
        x: 1,
        y: 2.4,
        w: 8,
        h: 0.6,
        fontSize: 16,
        color: colors.white,
        align: 'center'
    });

    // CTA button
    slide.addShape(pptx.ShapeType.roundRect, {
        x: 3.25,
        y: 3.2,
        w: 3.5,
        h: 0.7,
        fill: { color: colors.accent }
    });

    slide.addText(data.bookingUrl ? 'Book a Demo' : 'Schedule Demo', {
        x: 3.25,
        y: 3.2,
        w: 3.5,
        h: 0.7,
        fontSize: 18,
        bold: true,
        color: colors.black,
        align: 'center'
    });

    // Contact info
    if (!data.hideBranding) {
        slide.addText(data.companyName || 'PathSynch', {
            x: 0.5,
            y: 4.2,
            w: 9,
            h: 0.4,
            fontSize: 18,
            bold: true,
            color: colors.white,
            align: 'center'
        });

        slide.addText(data.contactEmail || 'hello@pathsynch.com', {
            x: 0.5,
            y: 4.6,
            w: 9,
            h: 0.3,
            fontSize: 14,
            color: colors.white,
            align: 'center'
        });
    }

    slide.addText('10 / 10', {
        x: 8.5,
        y: 5.2,
        w: 1,
        h: 0.3,
        fontSize: 10,
        color: colors.white,
        align: 'right'
    });

    return slide;
}

module.exports = {
    getColorScheme,
    createTitleSlide,
    createSentimentSlide,
    createChallengesSlide,
    createSolutionSlide,
    createROISlide,
    createStrategySlide,
    createRolloutSlide,
    createPricingSlide,
    createNextStepsSlide,
    createClosingSlide
};
