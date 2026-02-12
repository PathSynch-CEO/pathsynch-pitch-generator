/**
 * Level 3 Slide Builders
 *
 * Individual slide builder functions for the Level 3 Enterprise Deck.
 * Each function receives a context object with all necessary data.
 *
 * @module pitch/level3/slides
 */

/**
 * Calculate total slide count based on conditional slides
 * @param {Object} ctx - Context object
 * @returns {number} Total slide count
 */
function getTotalSlides(ctx) {
    let count = 10; // Base slides
    if (ctx.hasReviewAnalytics) count++;
    if (ctx.hasMarketData) count++;
    if (ctx.inputs.triggerEvent) count++;
    return count;
}

/**
 * Get the current slide number for a given slide position
 * Accounts for conditional slides that may or may not be present
 * @param {Object} ctx - Context object
 * @param {string} slideId - The slide identifier
 * @returns {number} The current slide number
 */
function getSlideNumber(ctx, slideId) {
    const positions = {
        'title': 1,
        'trigger': 2,
        'whatMakesSpecial': ctx.inputs.triggerEvent ? 3 : 2,
        'reviewHealth': ctx.inputs.triggerEvent ? 4 : 3,
        'growthChallenges': (ctx.inputs.triggerEvent ? 4 : 3) + (ctx.hasReviewAnalytics ? 1 : 0),
        'solution': (ctx.inputs.triggerEvent ? 5 : 4) + (ctx.hasReviewAnalytics ? 1 : 0),
        'projectedRoi': (ctx.inputs.triggerEvent ? 6 : 5) + (ctx.hasReviewAnalytics ? 1 : 0),
        'marketIntel': (ctx.inputs.triggerEvent ? 7 : 6) + (ctx.hasReviewAnalytics ? 1 : 0),
        'productStrategy': (ctx.inputs.triggerEvent ? 7 : 6) + (ctx.hasReviewAnalytics ? 1 : 0) + (ctx.hasMarketData ? 1 : 0),
        'rollout': (ctx.inputs.triggerEvent ? 8 : 7) + (ctx.hasReviewAnalytics ? 1 : 0) + (ctx.hasMarketData ? 1 : 0),
        'investment': (ctx.inputs.triggerEvent ? 9 : 8) + (ctx.hasReviewAnalytics ? 1 : 0) + (ctx.hasMarketData ? 1 : 0),
        'nextSteps': (ctx.inputs.triggerEvent ? 10 : 9) + (ctx.hasReviewAnalytics ? 1 : 0) + (ctx.hasMarketData ? 1 : 0),
        'closing': (ctx.inputs.triggerEvent ? 11 : 10) + (ctx.hasReviewAnalytics ? 1 : 0) + (ctx.hasMarketData ? 1 : 0)
    };
    return positions[slideId] || 1;
}

/**
 * Build Slide 1: Title Slide
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the title slide
 */
function buildTitleSlide(ctx) {
    const {
        businessName,
        googleRating,
        numReviews,
        industry,
        inputs,
        options,
        companyName
    } = ctx;

    const totalSlides = getTotalSlides(ctx);

    return `
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
    <div class="slide-number">1 / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 2: Trigger Event (conditional)
 * Only renders if inputs.triggerEvent exists
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the trigger event slide, or empty string if no trigger
 */
function buildTriggerEventSlide(ctx) {
    const { inputs } = ctx;

    if (!inputs.triggerEvent) {
        return '';
    }

    const totalSlides = getTotalSlides(ctx);
    const { headline, summary, keyPoints, source } = inputs.triggerEvent;

    return `
<!-- TRIGGER EVENT SLIDE: WHY NOW -->
<section class="slide content-slide" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);">
    <h2 style="color: var(--color-primary);">📰 Why We're Reaching Out Now</h2>
    <div class="yellow-line"></div>

    <div class="card" style="background: white; padding: 32px; margin-top: 24px; border-left: 4px solid var(--color-primary);">
        <h3 style="font-size: 24px; margin-bottom: 16px; color: #166534;">${headline || 'Recent News'}</h3>
        <p style="font-size: 18px; color: #333; line-height: 1.6; margin-bottom: 20px;">
            ${summary || ''}
        </p>
        ${keyPoints && keyPoints.length > 0 ? `
        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin-top: 16px;">
            <p style="font-weight: 600; color: #15803d; margin-bottom: 12px;">This creates an opportunity to:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${keyPoints.map(point => `
                    <li style="font-size: 16px; color: #166534; margin-bottom: 8px;">${point}</li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
    </div>

    ${source ? `
    <p style="position: absolute; bottom: 60px; font-size: 12px; color: #6b7280;">Source: ${source}</p>
    ` : ''}
    <div class="slide-number">2 / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 3: What Makes Them Special
 * Sentiment analysis and customer highlights
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the what makes them special slide
 */
function buildWhatMakesThemSpecialSlide(ctx) {
    const {
        businessName,
        numReviews,
        sentiment,
        topThemes,
        staffMentions,
        differentiators
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'whatMakesSpecial');
    const totalSlides = getTotalSlides(ctx);

    return `
<!-- SLIDE: WHAT MAKES THEM SPECIAL -->
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 4: Review Health (conditional)
 * Only renders if hasReviewAnalytics is true
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the review health slide, or empty string
 */
function buildReviewHealthSlide(ctx) {
    if (!ctx.hasReviewAnalytics) {
        return '';
    }

    const {
        numReviews,
        companyName,
        volumeData,
        reviewHealthScore,
        reviewHealthLabel,
        reviewKeyMetrics,
        reviewCriticalIssues,
        reviewOpportunities,
        reviewStrengths,
        reviewRecommendation
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'reviewHealth');
    const totalSlides = getTotalSlides(ctx);

    // Determine health score colors
    const healthGradientStart = reviewHealthScore >= 70 ? '#22c55e' : reviewHealthScore >= 50 ? '#f59e0b' : '#ef4444';
    const healthGradientEnd = reviewHealthScore >= 70 ? '#16a34a' : reviewHealthScore >= 50 ? '#d97706' : '#dc2626';

    return `
<!-- SLIDE: REVIEW HEALTH (conditional) -->
<section class="slide content-slide">
    <h2>Review Health Analysis</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Data-driven insights from ${volumeData?.totalReviews || numReviews} customer reviews</p>

    <div class="two-col">
        <div>
            <div class="roi-highlight" style="margin-bottom: 16px; background: linear-gradient(135deg, ${healthGradientStart} 0%, ${healthGradientEnd} 100%);">
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 5: Growth Challenges
 * Industry pain points and barriers
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the growth challenges slide
 */
function buildGrowthChallengesSlide(ctx) {
    const {
        industry,
        statedProblem,
        companyName,
        salesIntel
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'growthChallenges');
    const totalSlides = getTotalSlides(ctx);

    return `
<!-- SLIDE: GROWTH CHALLENGES -->
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 6: Solution
 * Company solution overview with products and benefits
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the solution slide
 */
function buildSolutionSlide(ctx) {
    const {
        companyName,
        options,
        truncateText,
        CONTENT_LIMITS
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'solution');
    const totalSlides = getTotalSlides(ctx);
    const isDefault = options.sellerContext?.isDefault;

    return `
<!-- SLIDE: SOLUTION -->
<section class="slide content-slide">
    <h2>${companyName}: The Solution${isDefault ? ' Ecosystem' : ''}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${truncateText(options.sellerContext?.differentiator, CONTENT_LIMITS.differentiator) || (isDefault ? 'Integrated platform to deepen local customer engagement and drive repeat revenue' : `How ${companyName} helps businesses like yours succeed`)}</p>

    <div class="three-col">
        <div class="solution-card">
            <div class="icon-badge">🎯</div>
            <h3>${isDefault ? 'What It Does' : 'Unique Value'}</h3>
            <ul>
                ${isDefault ? `
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
            <h3>${isDefault ? 'Key Modules' : 'What You Get'}</h3>
            <ul>
                ${(options.sellerContext?.products || []).slice(0, 4).map(p => `<li><strong>${truncateText(p.name, CONTENT_LIMITS.productName)}:</strong> ${truncateText(p.desc, CONTENT_LIMITS.productDesc)}</li>`).join('')}
            </ul>
        </div>
        <div class="solution-card">
            <div class="icon-badge">💰</div>
            <h3>${isDefault ? 'Proven Impact' : 'Key Benefits'}</h3>
            <ul>
                ${isDefault ? `
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 7: Projected ROI
 * ROI projections and financial impact
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the projected ROI slide
 */
function buildProjectedRoiSlide(ctx) {
    const {
        businessName,
        numReviews,
        companyName,
        roiData,
        formatCurrency
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'projectedRoi');
    const totalSlides = getTotalSlides(ctx);

    return `
<!-- SLIDE: PROJECTED ROI -->
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 8: Market Intelligence (conditional)
 * Only renders if hasMarketData is true
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the market intelligence slide, or empty string
 */
function buildMarketIntelligenceSlide(ctx) {
    if (!ctx.hasMarketData) {
        return '';
    }

    const {
        inputs,
        salesIntel,
        opportunityScore,
        saturation,
        competitorCount,
        marketSize,
        growthRate,
        demographics,
        opportunityLevel,
        marketRecommendations,
        seasonality,
        companySizeInfo
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'marketIntel');
    const totalSlides = getTotalSlides(ctx);

    return `
<!-- SLIDE: MARKET INTELLIGENCE (conditional) -->
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

    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 9: Product Strategy
 * Implementation pillars and approach
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the product strategy slide
 */
function buildProductStrategySlide(ctx) {
    const {
        industry,
        companyName,
        options,
        truncateText,
        CONTENT_LIMITS
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'productStrategy');
    const totalSlides = getTotalSlides(ctx);
    const isDefault = options.sellerContext?.isDefault;

    return `
<!-- SLIDE: PRODUCT STRATEGY -->
<section class="slide content-slide">
    <h2>${isDefault ? 'Product Strategy: Integrated Approach' : `${companyName} Implementation Strategy`}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">${isDefault ? 'Three-pillar system to drive discovery, engagement, and retention' : `How ${companyName} delivers results for ${industry} businesses`}</p>

    <div class="three-col">
        ${isDefault ? `
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 10: 90-Day Rollout
 * Phased implementation timeline
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the rollout slide
 */
function buildRolloutSlide(ctx) {
    const {
        companyName,
        options,
        truncateText,
        CONTENT_LIMITS
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'rollout');
    const totalSlides = getTotalSlides(ctx);
    const isDefault = options.sellerContext?.isDefault;

    return `
<!-- SLIDE: 90-DAY ROLLOUT -->
<section class="slide content-slide">
    <h2>Recommended 90-Day Rollout</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Phased implementation for maximum impact with minimal disruption</p>

    <div class="timeline" style="margin-top: 32px;">
        <div class="timeline-item">
            <div class="phase-badge">Phase 1: Days 1-30</div>
            <h4>Foundation</h4>
            <ul>
                ${isDefault ? `
                <li>PathConnect setup & NFC cards</li>
                <li>Google Business Profile audit</li>
                ` : `
                <li>${truncateText((options.sellerContext?.products || [])[0]?.name, CONTENT_LIMITS.productName) || 'Primary solution'} setup</li>
                <li>${truncateText((options.sellerContext?.products || [])[0]?.desc, 50) || 'Initial implementation'}</li>
                `}
                <li>Staff training ${isDefault ? 'on review requests' : '& onboarding'}</li>
                <li>Baseline metrics established</li>
            </ul>
        </div>
        <div class="timeline-item">
            <div class="phase-badge">Phase 2: Days 31-60</div>
            <h4>Expansion</h4>
            <ul>
                ${isDefault ? `
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
                ${isDefault ? `
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 11: Investment/Pricing
 * Package and pricing details
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the investment slide
 */
function buildInvestmentSlide(ctx) {
    const {
        businessName,
        industry,
        statedProblem,
        companyName,
        options,
        truncateText,
        CONTENT_LIMITS
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'investment');
    const totalSlides = getTotalSlides(ctx);
    const isDefault = options.sellerContext?.isDefault;

    return `
<!-- SLIDE: INVESTMENT -->
<section class="slide content-slide">
    <h2>${companyName} Package for ${businessName}</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro"><strong>Recommended ${isDefault ? 'Curated bundle' : 'solution'}</strong> to ${statedProblem || 'drive customer engagement and growth'}</p>

    <div class="pricing-section">
        <div class="pricing-summary" style="text-align: center;">
            <h3 style="text-align: center;">Your Investment</h3>
            <div class="price">${options.sellerContext?.pricing || '$168'}</div>
            <div class="period">${options.sellerContext?.pricingPeriod || 'per month'}</div>
            <ul class="includes" style="text-align: left; display: inline-block;">
                ${isDefault ? `
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
            <h3>${isDefault ? 'Recommended Products' : 'What You Get'}</h3>
            <ul class="product-list">
                ${(options.sellerContext?.products || []).slice(0, 6).map(p => `
                <li><span class="name">${p.icon || '📦'} ${truncateText(p.name, CONTENT_LIMITS.productName)}</span><span class="price">${p.price || 'Included'}</span></li>
                `).join('')}
            </ul>
            <div style="margin-top: 16px; padding: 12px; background: #e8f5e9; border-radius: 8px; text-align: center;">
                <span style="font-size: 13px; color: var(--color-primary);"><strong>${isDefault ? 'Complete Platform Bundle' : 'Complete Package'}</strong> - ${isDefault ? 'All tools included' : 'Everything you need'}</span>
            </div>
        </div>
    </div>
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 12: Next Steps
 * Actionable roadmap for implementation
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the next steps slide
 */
function buildNextStepsSlide(ctx) {
    const {
        industry,
        companyName,
        options,
        salesIntel,
        truncateText
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'nextSteps');
    const totalSlides = getTotalSlides(ctx);
    const isDefault = options.sellerContext?.isDefault;

    return `
<!-- SLIDE: NEXT STEPS -->
<section class="slide content-slide">
    <h2>Recommended Next Steps</h2>
    <div class="yellow-line"></div>
    <p class="slide-intro">Clear, actionable roadmap to move from discussion to implementation</p>

    <div class="next-steps-grid">
        <div class="next-steps-column">
            <h3>Immediate (This Week)</h3>
            <div class="step-box">
                <h4>1. Schedule ${companyName} demo</h4>
                <p>${isDefault ? 'See PathConnect, LocalSynch, QRSynch in action' : `See ${(options.sellerContext?.products || []).slice(0, 2).map(p => truncateText(p.name, 20)).join(', ')} in action`}</p>
            </div>
            <div class="step-box">
                <h4>2. Review pricing options</h4>
                <p>Explore custom ${isDefault ? 'bundle' : 'solution'} for ${industry}</p>
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
                <p>${isDefault ? 'Start with PathConnect only (30 days)' : 'Start with initial implementation (30 days)'}</p>
            </div>
            <div class="step-box">
                <h4>5. Staff training</h4>
                <p>${isDefault ? 'NFC card placement, review request script' : 'Onboarding and best practices'}</p>
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

/**
 * Build Slide 13: Closing CTA
 * Final call-to-action and contact info
 * @param {Object} ctx - Context object with all template data
 * @returns {string} HTML for the closing slide
 */
function buildClosingCtaSlide(ctx) {
    const {
        businessName,
        industry,
        companyName,
        hideBranding,
        contactEmail,
        customFooterText,
        bookingUrl,
        ctaUrl,
        ctaText,
        pitchId
    } = ctx;

    const slideNum = getSlideNumber(ctx, 'closing');
    const totalSlides = getTotalSlides(ctx);

    return `
<!-- SLIDE: CLOSING CTA -->
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
    <div class="slide-number">${slideNum} / ${totalSlides}</div>
</section>`;
}

module.exports = {
    getTotalSlides,
    getSlideNumber,
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
};
