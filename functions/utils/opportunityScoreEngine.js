/**
 * Executive Opportunity Score Engine
 *
 * Synthesizes Market Intel enrichment data into:
 * 1. Composite opportunity score (0-100) with 5 sub-scores
 * 2. Ranked outreach triggers (up to 5)
 * 3. Product fit analysis
 *
 * No external API calls. Pure synchronous functions.
 * Called at end of enrichment pipeline before Firestore save.
 */

'use strict';

// ─── Sub-Score Functions ───────────────────────────────────────────────────

/**
 * Demand Score (0-100) — Is the local market big enough?
 * Default 50 when demographic data is missing.
 */
function scoreDemand(data) {
    const demo = data.demographics || {};
    const signals = [];
    const gaps = [];

    if (!demo.population && !demo.medianIncome) {
        return { score: 50, signals: ['Demographic data unavailable — defaulting to neutral'], gaps: [] };
    }

    let score = 20;

    const pop = parseInt(demo.population) || 0;
    if (pop >= 200000) { score += 35; signals.push(`Large metro market (pop. ${pop.toLocaleString()})`); }
    else if (pop >= 100000) { score += 28; signals.push(`Mid-size market (pop. ${pop.toLocaleString()})`); }
    else if (pop >= 50000) { score += 20; signals.push(`Suburban market (pop. ${pop.toLocaleString()})`); }
    else if (pop >= 25000) { score += 12; signals.push(`Small city market (pop. ${pop.toLocaleString()})`); }
    else if (pop >= 10000) { score += 6; signals.push(`Small town market (pop. ${pop.toLocaleString()})`); }
    else if (pop > 0) { signals.push(`Small market (pop. ${pop.toLocaleString()})`); gaps.push('Small population may limit addressable demand'); }

    const income = parseInt(demo.medianIncome) || 0;
    if (income >= 100000) { score += 30; signals.push(`High-income area (median $${income.toLocaleString()})`); }
    else if (income >= 75000) { score += 22; signals.push(`Above-average income (median $${income.toLocaleString()})`); }
    else if (income >= 55000) { score += 15; signals.push(`Average income area (median $${income.toLocaleString()})`); }
    else if (income >= 40000) { score += 8; signals.push(`Below-average income (median $${income.toLocaleString()})`); }
    else if (income > 0) { signals.push(`Lower income area (median $${income.toLocaleString()})`); gaps.push('Lower median income may limit premium service adoption'); }

    const growthSignals = demo.growthSignals || [];
    if (growthSignals.length >= 3) { score += 15; signals.push('Multiple growth signals detected in market area'); }
    else if (growthSignals.length >= 1) { score += 7; signals.push('Some market growth signals present'); }

    return { score: Math.min(100, Math.max(0, score)), signals, gaps };
}

/**
 * Visibility Gap Score (0-100) — Is the business underperforming online?
 * INVERSE: worse presence = higher score = more opportunity.
 * Default 50 when GBP data is missing.
 */
function scoreVisibilityGap(data) {
    const gbp = data.gbpSignals || {};
    const prospect = data.prospect || {};
    const signals = [];
    const gaps = [];

    const hasAnyGBP = gbp.photoCount !== undefined || gbp.hasHours !== undefined || gbp.hasPhotos !== undefined;
    if (!hasAnyGBP && !prospect.rating) {
        return { score: 50, signals: ['GBP data unavailable — defaulting to neutral'], gaps: [] };
    }

    let score = 10;

    if (!gbp.hasHours) { score += 15; gaps.push('No business hours on GBP'); signals.push('Missing business hours — basic GBP gap'); }
    else { signals.push('Business hours listed'); }

    const photoCount = parseInt(gbp.photoCount) || 0;
    if (photoCount === 0) { score += 15; gaps.push('No photos on GBP'); signals.push('Zero photos uploaded to GBP'); }
    else if (photoCount < 5) { score += 10; gaps.push(`Only ${photoCount} photos (10+ recommended)`); signals.push(`Only ${photoCount} GBP photos`); }
    else if (photoCount < 10) { score += 5; signals.push(`${photoCount} GBP photos (below recommended 10+)`); }

    if (!gbp.hasPosts) { score += 10; gaps.push('No recent GBP posts'); signals.push('No recent GBP posts detected'); }

    const desc = gbp.description || '';
    if (!gbp.hasDescription || desc.length < 50) { score += 10; gaps.push('Thin or missing GBP description'); signals.push('GBP description missing or too brief'); }

    if (!prospect.website) { score += 20; gaps.push('No website linked'); signals.push('No website — entirely dependent on GBP for discovery'); }

    const rating = parseFloat(prospect.rating) || 0;
    if (rating > 0 && rating < 4.0) { score += 10; gaps.push(`Below 4.0★ rating (${rating.toFixed(1)}★)`); signals.push(`Rating ${rating.toFixed(1)}★ — below acceptable threshold`); }
    else if (rating >= 4.0 && rating < 4.3) { score += 5; signals.push(`Rating ${rating.toFixed(1)}★ — approaching acceptable but not strong`); }

    return { score: Math.min(100, Math.max(0, score)), signals, gaps };
}

/**
 * Reputation Gap Score (0-100) — Are reviews weak, stale, or unanswered?
 * INVERSE: worse reputation management = higher score = more opportunity.
 * Default 50 when review data is missing.
 */
function scoreReputationGap(data) {
    const reviews = data.reviews || {};
    const prospect = data.prospect || {};
    const benchmarks = data.benchmarks || {};
    const signals = [];
    const gaps = [];

    const reviewCount = parseInt(prospect.reviewCount) || 0;
    const avgReviews = parseInt(benchmarks.avgReviews) || 100;
    const responseRate = reviews.responseRate;
    const daysSinceLast = reviews.daysSinceLastReview;
    const monthlyVelocity = reviews.monthlyVelocity;

    if (!reviewCount && responseRate == null && daysSinceLast == null) {
        return { score: 50, signals: ['Review data unavailable — defaulting to neutral'], gaps: [] };
    }

    let score = 10;

    if (reviewCount === 0) {
        score += 30; gaps.push('No reviews found'); signals.push('No reviews on record — invisible to local buyers');
    } else if (reviewCount < avgReviews * 0.25) {
        score += 28; gaps.push(`Only ${reviewCount} reviews (market avg: ${avgReviews})`);
        signals.push(`Review count (${reviewCount}) is ${Math.round((1 - reviewCount / avgReviews) * 100)}% below market average (${avgReviews})`);
    } else if (reviewCount < avgReviews * 0.5) {
        score += 20; gaps.push(`Review count ${reviewCount} is below market average (${avgReviews})`);
        signals.push(`${reviewCount} reviews vs ${avgReviews} market average — ${Math.round((1 - reviewCount / avgReviews) * 100)}% gap`);
    } else if (reviewCount < avgReviews) {
        score += 10; signals.push(`${reviewCount} reviews below market average of ${avgReviews}`);
    } else {
        signals.push(`${reviewCount} reviews at or above market average`);
    }

    if (monthlyVelocity !== null && monthlyVelocity !== undefined) {
        if (monthlyVelocity < 1) {
            score += 20; gaps.push('Review engine has stalled (< 1 review/month)');
            signals.push(`Monthly review velocity: ${typeof monthlyVelocity === 'number' ? monthlyVelocity.toFixed(1) : monthlyVelocity}/mo — essentially stalled`);
        } else if (monthlyVelocity < 3) {
            score += 12; gaps.push(`Low review velocity (${typeof monthlyVelocity === 'number' ? monthlyVelocity.toFixed(1) : monthlyVelocity}/month)`);
            signals.push(`Monthly velocity: ${typeof monthlyVelocity === 'number' ? monthlyVelocity.toFixed(1) : monthlyVelocity}/mo — below active threshold`);
        } else if (monthlyVelocity < 5) {
            score += 5; signals.push(`Review velocity: ${typeof monthlyVelocity === 'number' ? monthlyVelocity.toFixed(1) : monthlyVelocity}/mo — moderate`);
        }
    } else if (daysSinceLast !== null && daysSinceLast !== undefined) {
        if (daysSinceLast > 90) {
            score += 20; gaps.push(`Last review ${daysSinceLast} days ago — dormant`);
            signals.push(`Last review ${daysSinceLast} days ago — review engine dormant`);
        } else if (daysSinceLast > 60) {
            score += 12; gaps.push(`Last review ${daysSinceLast} days ago`);
            signals.push(`Last review ${daysSinceLast} days ago — low momentum`);
        } else if (daysSinceLast > 30) {
            score += 5; signals.push(`Last review ${daysSinceLast} days ago — slowing`);
        }
    }

    if (responseRate !== null && responseRate !== undefined) {
        if (responseRate < 10) {
            score += 20; gaps.push(`Response rate only ${responseRate}%`);
            signals.push(`Review response rate: ${responseRate}% — owner is not engaging with customers`);
        } else if (responseRate < 30) {
            score += 14; gaps.push(`Low response rate (${responseRate}%)`);
            signals.push(`Response rate: ${responseRate}% — low engagement gap`);
        } else if (responseRate < 60) {
            score += 7; signals.push(`Response rate: ${responseRate}% — moderate engagement gap`);
        } else {
            signals.push(`Response rate: ${responseRate}% — adequate engagement`);
        }
    }

    const negatives = reviews.recentNegative || [];
    if (negatives.length >= 3) {
        score += 15; gaps.push(`${negatives.length} recent negative reviews`);
        signals.push(`${negatives.length} recent negative reviews with unresolved complaint themes`);
    } else if (negatives.length >= 1) {
        score += 8; gaps.push(`${negatives.length} recent negative review(s)`);
        signals.push('Recent negative review detected — complaint resolution opportunity');
    }

    return { score: Math.min(100, Math.max(0, score)), signals, gaps };
}

/**
 * Competitive Pressure Score (0-100) — Are competitors outperforming them?
 * Default 50 when competitor data is missing.
 */
function scoreCompetitivePressure(data) {
    const prospect = data.prospect || {};
    const competitors = data.competitors || [];
    const signals = [];
    const gaps = [];

    if (competitors.length === 0) {
        return { score: 50, signals: ['Competitor data unavailable — defaulting to neutral'], gaps: [] };
    }

    let score = 10;

    const prospectReviews = parseInt(prospect.reviewCount) || 0;
    const prospectRating = parseFloat(prospect.rating) || 0;

    const topCompetitor = competitors.reduce((best, c) => {
        const r = parseInt(c.reviewCount || c.reviews) || 0;
        const rt = parseFloat(c.rating) || 0;
        const bestR = parseInt(best.reviewCount || best.reviews) || 0;
        const bestRt = parseFloat(best.rating) || 0;
        return (r * 0.6 + rt * 0.4) > (bestR * 0.6 + bestRt * 0.4) ? c : best;
    }, competitors[0]);

    const topCompReviews = parseInt(topCompetitor.reviewCount || topCompetitor.reviews) || 0;
    const topCompRating = parseFloat(topCompetitor.rating) || 0;

    if (prospectReviews > 0 && topCompReviews > 0) {
        const ratio = topCompReviews / prospectReviews;
        if (ratio >= 8) {
            score += 35; gaps.push(`Top competitor has ${ratio.toFixed(0)}x more reviews`);
            signals.push(`Review dominance gap: top competitor has ${topCompReviews} reviews vs. prospect's ${prospectReviews} (${ratio.toFixed(0)}x more)`);
        } else if (ratio >= 5) {
            score += 28; gaps.push(`Significant review gap (${ratio.toFixed(0)}x)`);
            signals.push(`Top competitor has ${topCompReviews} vs. ${prospectReviews} reviews (${ratio.toFixed(1)}x higher)`);
        } else if (ratio >= 2) {
            score += 20; gaps.push(`Competitor has ${ratio.toFixed(1)}x more reviews`);
            signals.push(`Competitor outpacing on review volume: ${topCompReviews} vs. ${prospectReviews}`);
        } else if (ratio >= 1.3) {
            score += 10; signals.push(`Competitor slightly ahead: ${topCompReviews} vs. ${prospectReviews} reviews`);
        } else {
            signals.push(`Review count competitive with top competitor (${prospectReviews} vs. ${topCompReviews})`);
        }
    } else if (topCompReviews > 0 && prospectReviews === 0) {
        score += 35; gaps.push('Prospect has no reviews vs. active competitors');
        signals.push(`Top competitor has ${topCompReviews} reviews while prospect has none`);
    }

    if (prospectRating > 0 && topCompRating > 0) {
        const ratingGap = topCompRating - prospectRating;
        if (ratingGap >= 0.7) {
            score += 20; gaps.push(`Rating gap: competitor ${topCompRating.toFixed(1)}★ vs. ${prospectRating.toFixed(1)}★`);
            signals.push(`Rating gap: top competitor ${topCompRating.toFixed(1)}★ vs. prospect ${prospectRating.toFixed(1)}★`);
        } else if (ratingGap >= 0.3) {
            score += 12; signals.push(`Competitor rated slightly higher: ${topCompRating.toFixed(1)}★ vs. ${prospectRating.toFixed(1)}★`);
        } else if (ratingGap < 0) {
            signals.push(`Prospect rated higher than top competitor (${prospectRating.toFixed(1)}★ vs. ${topCompRating.toFixed(1)}★)`);
        }
    }

    const compCount = competitors.length;
    if (compCount >= 15) { score += 20; signals.push(`Highly competitive market with ${compCount}+ active competitors`); }
    else if (compCount >= 10) { score += 14; signals.push(`${compCount} competitors in the market`); }
    else if (compCount >= 5) { score += 8; signals.push(`${compCount} competitors identified`); }
    else { signals.push(`${compCount} competitor(s) found — less saturated market`); }

    const sov = data.shareOfVoice || {};
    const sovLeaderShare = sov.leaderShare || 0;
    const totalReviews = sov.totalMarketReviews || 0;
    if (totalReviews > 0 && prospectReviews >= 0) {
        const prospectSoV = (prospectReviews / totalReviews) * 100;
        if (sovLeaderShare > 0 && prospectSoV < 5) {
            score += 15; gaps.push(`Only ${prospectSoV.toFixed(1)}% market share of voice`);
            signals.push(`Share of voice: ${prospectSoV.toFixed(1)}% vs. market leader's ${sovLeaderShare.toFixed(1)}%`);
        } else if (prospectSoV < 10) {
            score += 8; signals.push(`Low share of voice: ${prospectSoV.toFixed(1)}%`);
        }
    }

    // Boost score when competitive landscape confirms multiple HIGH threats
    const cl = data.competitiveLandscape;
    if (cl && cl.status === 'active' && cl.prospectPosition) {
        const { highThreats, ratingPercentile, reviewPercentile } = cl.prospectPosition;
        if (highThreats >= 3) {
            score += 10; signals.push(`${highThreats} HIGH-threat competitors identified in market`);
        } else if (highThreats >= 1) {
            score += 5; signals.push(`${highThreats} HIGH-threat competitor(s) in landscape`);
        }
        if (ratingPercentile !== undefined && ratingPercentile < 30) {
            gaps.push(`Rating ranks in bottom ${100 - ratingPercentile}% of market`);
        }
        if (reviewPercentile !== undefined && reviewPercentile < 30) {
            gaps.push(`Review volume ranks in bottom ${100 - reviewPercentile}% of market`);
        }
    }

    return { score: Math.min(100, Math.max(0, score)), signals, gaps };
}

// ─── Trigger Detection ─────────────────────────────────────────────────────

const TRIGGER_DEFINITIONS = [
    {
        id: 'low_review_velocity',
        priority: 1,
        category: 'reputation',
        label: 'Low review velocity',
        detect: (data) => {
            const velocity = data.reviews?.monthlyVelocity;
            const daysSince = data.reviews?.daysSinceLastReview;
            if (velocity !== null && velocity !== undefined && velocity < 3) {
                return { match: true, detail: `Only ${typeof velocity === 'number' ? velocity.toFixed(1) : velocity} new reviews per month`, dataPoint: velocity };
            }
            if (velocity == null && daysSince != null && daysSince > 60) {
                return { match: true, detail: `Last review ${daysSince} days ago — velocity stalled`, dataPoint: daysSince };
            }
            return { match: false };
        }
    },
    {
        id: 'competitor_passed',
        priority: 2,
        category: 'competitive',
        label: 'Competitor overtaking them',
        detect: (data) => {
            const prospect = parseInt(data.prospect?.reviewCount) || 0;
            const comps = data.competitors || [];
            if (comps.length === 0) return { match: false };
            const topComp = comps.reduce((best, c) => {
                const cr = parseInt(c.reviewCount || c.reviews) || 0;
                const br = parseInt(best.reviewCount || best.reviews) || 0;
                return cr > br ? c : best;
            }, comps[0]);
            const topCompReviews = parseInt(topComp.reviewCount || topComp.reviews) || 0;
            if (topCompReviews > prospect * 2 && topCompReviews > 0) {
                return { match: true, detail: `Top competitor has ${topCompReviews} reviews vs. their ${prospect}`, dataPoint: `${topCompReviews} vs ${prospect}` };
            }
            return { match: false };
        }
    },
    {
        id: 'gbp_missing_services',
        priority: 3,
        category: 'visibility',
        label: 'GBP missing key fields',
        detect: (data) => {
            const gbp = data.gbpSignals || {};
            const missing = [];
            if (!gbp.hasServices) missing.push('services');
            if (!gbp.hasDescription || ((gbp.description || '').length < 50)) missing.push('description');
            if (!gbp.hasPhotos || (parseInt(gbp.photoCount) || 0) < 5) missing.push('photos');
            if (!gbp.hasHours) missing.push('hours');
            if (!gbp.hasPosts) missing.push('recent posts');
            if (missing.length >= 2) {
                return { match: true, detail: `Missing: ${missing.join(', ')}`, dataPoint: missing.length };
            }
            return { match: false };
        }
    },
    {
        id: 'new_negative_review',
        priority: 4,
        category: 'reputation',
        label: 'Recent negative review',
        detect: (data) => {
            const negatives = data.reviews?.recentNegative || [];
            if (negatives.length > 0) {
                const theme = negatives[0].theme || negatives[0].snippet || 'negative feedback';
                const snippet = theme.length > 80 ? theme.substring(0, 80) + '…' : theme;
                return { match: true, detail: `Recent complaint: "${snippet}"`, dataPoint: negatives.length };
            }
            return { match: false };
        }
    },
    {
        id: 'no_website',
        priority: 5,
        category: 'visibility',
        label: 'No website or weak web presence',
        detect: (data) => {
            if (!data.prospect?.website) {
                return { match: true, detail: 'No website found on Google Business Profile', dataPoint: 'none' };
            }
            return { match: false };
        }
    },
    {
        id: 'seasonal_demand',
        priority: 6,
        category: 'timing',
        label: 'Seasonal demand approaching',
        detect: (data) => {
            const month = new Date().getMonth();
            const category = (data.prospect?.category || '').toLowerCase();
            const seasonalMap = {
                'restaurant': [4, 5, 10, 11],
                'hvac': [4, 5, 8, 9],
                'landscaping': [2, 3, 4],
                'tax': [0, 1, 2],
                'fitness': [0, 11],
                'retail': [9, 10, 11]
            };
            for (const [key, months] of Object.entries(seasonalMap)) {
                if (category.includes(key) && months.includes(month)) {
                    return { match: true, detail: `Peak season approaching for ${key}`, dataPoint: `Month ${month + 1}` };
                }
            }
            return { match: false };
        }
    },
    {
        id: 'new_competitor',
        priority: 7,
        category: 'competitive',
        label: 'New competitor nearby',
        detect: (data) => {
            const newComps = (data.competitors || []).filter(c => {
                const rc = parseInt(c.reviewCount || c.reviews) || 0;
                const rt = parseFloat(c.rating) || 0;
                return rc < 20 && rt >= 4.0;
            });
            if (newComps.length > 0) {
                return { match: true, detail: `${newComps.length} new competitor(s) with strong early ratings`, dataPoint: newComps.length };
            }
            return { match: false };
        }
    },
    {
        id: 'unanswered_reviews',
        priority: 8,
        category: 'reputation',
        label: 'Unanswered reviews',
        detect: (data) => {
            const responseRate = data.reviews?.responseRate;
            if (responseRate !== undefined && responseRate !== null && responseRate < 30) {
                return { match: true, detail: `Only ${responseRate}% of reviews have owner responses`, dataPoint: `${responseRate}%` };
            }
            return { match: false };
        }
    },
    {
        id: 'rating_decline',
        priority: 9,
        category: 'reputation',
        label: 'Rating appears to be declining',
        detect: (data) => {
            const recentSentiment = data.reviews?.recentSentimentScore;
            const overallRating = parseFloat(data.prospect?.rating) || 0;
            if (recentSentiment && overallRating && recentSentiment < overallRating - 0.5) {
                return { match: true, detail: `Recent sentiment (${recentSentiment.toFixed(1)}) trending below overall rating (${overallRating})`, dataPoint: `${recentSentiment.toFixed(1)} vs ${overallRating}` };
            }
            return { match: false };
        }
    },
    {
        id: 'competitors_advertising',
        priority: 10,
        category: 'competitive',
        label: 'Competitors investing in visibility',
        detect: (data) => {
            const comps = data.competitors || [];
            if (comps.length === 0) return { match: false };
            const compAvgPhotos = comps.reduce((sum, c) => sum + (parseInt(c.photoCount) || 0), 0) / comps.length;
            const prospectPhotos = parseInt(data.gbpSignals?.photoCount) || 0;
            if (compAvgPhotos > prospectPhotos * 2 && compAvgPhotos > 10) {
                return { match: true, detail: `Competitors average ${Math.round(compAvgPhotos)} GBP photos vs. prospect's ${prospectPhotos}`, dataPoint: `${Math.round(compAvgPhotos)} vs ${prospectPhotos}` };
            }
            return { match: false };
        }
    }
];

function detectTriggers(enrichmentData) {
    const triggers = [];
    for (const def of TRIGGER_DEFINITIONS) {
        try {
            const result = def.detect(enrichmentData);
            if (result.match) {
                triggers.push({
                    id: def.id,
                    priority: def.priority,
                    category: def.category,
                    label: def.label,
                    detail: result.detail,
                    dataPoint: result.dataPoint
                });
            }
        } catch (err) {
            console.warn(`[OpportunityScore] Trigger detection failed for ${def.id}:`, err.message);
        }
    }
    triggers.sort((a, b) => a.priority - b.priority);
    return {
        triggers: triggers.slice(0, 5),
        bestTrigger: triggers[0] || null,
        triggerCount: triggers.length,
        categories: {
            reputation: triggers.filter(t => t.category === 'reputation').length,
            competitive: triggers.filter(t => t.category === 'competitive').length,
            visibility: triggers.filter(t => t.category === 'visibility').length,
            timing: triggers.filter(t => t.category === 'timing').length
        }
    };
}

// ─── Product Fit ───────────────────────────────────────────────────────────

const PRODUCT_CATALOG = [
    {
        product: 'LocalSynch',
        description: 'Google Business Profile optimization',
        monthlyPrice: 149,
        triggers: ['gbp_missing_services', 'no_website', 'competitors_advertising'],
        scoreFields: ['visibilityGap'],
        fitThreshold: 60
    },
    {
        product: 'PathConnect',
        description: 'NFC review capture cards and QR campaigns',
        monthlyPrice: 99,
        triggers: ['low_review_velocity', 'unanswered_reviews', 'rating_decline', 'competitor_passed'],
        scoreFields: ['reputationGap'],
        fitThreshold: 60
    },
    {
        product: 'ReferralSynch',
        description: 'Referral marketing automation',
        monthlyPrice: 149,
        triggers: ['low_review_velocity', 'seasonal_demand'],
        scoreFields: ['reputationGap', 'demand'],
        fitThreshold: 50
    },
    {
        product: 'PathManager',
        description: 'Reputation management dashboard and analytics',
        monthlyPrice: 199,
        triggers: ['unanswered_reviews', 'new_negative_review', 'rating_decline'],
        scoreFields: ['reputationGap', 'competitivePressure'],
        fitThreshold: 50
    },
    {
        product: 'SynchIntro Managed Outbound',
        description: 'AI-powered outbound campaign engine',
        monthlyPrice: 499,
        triggers: ['competitor_passed', 'new_competitor', 'seasonal_demand'],
        scoreFields: ['competitivePressure'],
        fitThreshold: 60
    },
    {
        product: 'PathSynch Neighbors',
        description: 'Shared EDDM postcard campaigns',
        monthlyPrice: 249,
        triggers: ['seasonal_demand', 'new_competitor'],
        scoreFields: ['demand'],
        fitThreshold: 50
    }
];

function analyzeProductFit(scoreResult, triggerResult) {
    const activeTriggerIds = triggerResult.triggers.map(t => t.id);
    const fits = [];

    for (const product of PRODUCT_CATALOG) {
        const triggerMatches = product.triggers.filter(t => activeTriggerIds.includes(t));
        const scoreMatches = product.scoreFields.filter(field => {
            const subScore = scoreResult.subScores[field];
            return subScore && subScore.score >= product.fitThreshold;
        });

        let fitLevel = 'Low';
        let reason = '';

        if (triggerMatches.length >= 2 && scoreMatches.length >= 1) {
            fitLevel = 'High';
            reason = `Multiple triggers detected (${triggerMatches.join(', ')}) with strong score alignment`;
        } else if (triggerMatches.length >= 1 || scoreMatches.length >= 1) {
            fitLevel = 'Medium';
            reason = triggerMatches.length > 0
                ? `Trigger match: ${triggerMatches[0]}`
                : `Score alignment in ${scoreMatches[0]}`;
        } else {
            reason = 'No strong signal detected for this product';
        }

        fits.push({
            product: product.product,
            description: product.description,
            fitLevel,
            reason,
            monthlyPrice: product.monthlyPrice,
            triggerMatches,
            scoreMatches
        });
    }

    const fitOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
    fits.sort((a, b) => fitOrder[a.fitLevel] - fitOrder[b.fitLevel]);

    const highFits = fits.filter(f => f.fitLevel === 'High');
    const medFits = fits.filter(f => f.fitLevel === 'Medium');

    return {
        products: fits,
        highFitCount: highFits.length,
        recommendedProducts: highFits.length > 0 ? highFits : medFits.slice(0, 2),
        recommendedOffer: null
    };
}

function calculateFitScore(productFit) {
    const highFits = productFit.products.filter(p => p.fitLevel === 'High').length;
    const medFits = productFit.products.filter(p => p.fitLevel === 'Medium').length;

    let score = 30;
    score += highFits * 15;
    score += medFits * 8;
    score = Math.min(100, score);

    const signals = [];
    if (highFits > 0) signals.push(`${highFits} product(s) with HIGH fit`);
    if (medFits > 0) signals.push(`${medFits} product(s) with MEDIUM fit`);

    return {
        score,
        signals,
        gaps: highFits === 0 ? ['No strong product fit detected — consider whether this prospect is a good target'] : []
    };
}

// ─── Main Orchestrator ─────────────────────────────────────────────────────

/**
 * Calculate the full executive opportunity score from enrichment data.
 * @param {Object} enrichmentData - Normalized data from market intelligence pipeline
 * @returns {Object} Complete scoring + triggers + product fit
 */
function calculateOpportunityScore(enrichmentData) {
    const demandScore = scoreDemand(enrichmentData);
    const visibilityGapScore = scoreVisibilityGap(enrichmentData);
    const reputationGapScore = scoreReputationGap(enrichmentData);
    const competitivePressureScore = scoreCompetitivePressure(enrichmentData);

    const triggerResult = detectTriggers(enrichmentData);

    const subScoresPartial = {
        demand: demandScore,
        visibilityGap: visibilityGapScore,
        reputationGap: reputationGapScore,
        competitivePressure: competitivePressureScore
    };

    const productFit = analyzeProductFit({ subScores: subScoresPartial }, triggerResult);
    const fitScore = calculateFitScore(productFit);

    const subScores = {
        ...subScoresPartial,
        pathSynchFit: fitScore
    };

    const overallScore = Math.round(
        (demandScore.score * 0.15) +
        (visibilityGapScore.score * 0.25) +
        (reputationGapScore.score * 0.25) +
        (competitivePressureScore.score * 0.15) +
        (fitScore.score * 0.20)
    );

    let urgency = 'MONITOR';
    if (overallScore >= 80) urgency = 'HIGH';
    else if (overallScore >= 60) urgency = 'MEDIUM';
    else if (overallScore >= 40) urgency = 'LOW';

    return {
        overallScore,
        urgency,
        subScores,
        triggers: triggerResult,
        productFit,
        primaryPain: null,
        bestProductFit: null,
        recommendedFirstMessage: null,
        executiveSummary: null,
        bestReachOutReason: null,
        recommendedOffer: null,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Build normalized enrichmentData from a market intel lead + report context.
 * Adapter mapping market.js data structures to the score engine's expected shape.
 */
function buildEnrichmentData(lead, reportData, benchmarks, city, state, industry, displayIndustryName) {
    const data = reportData.data || {};
    const demographicsEnriched = data.demographicsEnriched || {};
    const cityDemographics = demographicsEnriched.cityDemographics || {};
    const demographics = data.demographics || {};
    const gbpInfo = lead.gbpInfo || {};
    const gbpCompleteness = lead.gbpCompleteness || {};
    const dataForSEO = lead.dataForSEO || {};

    // Monthly velocity from reviewVelocity (reviews/year / 12) or DataForSEO recency
    let monthlyVelocity = null;
    if (lead.reviewVelocity?.value != null) {
        monthlyVelocity = lead.reviewVelocity.value / 12;
    } else if (dataForSEO.recentReviews?.length > 0) {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentCount = dataForSEO.recentReviews.filter(r => {
            const d = new Date(r.date);
            return !isNaN(d.getTime()) && d.getTime() > thirtyDaysAgo;
        }).length;
        monthlyVelocity = recentCount;
    }

    // Recent sentiment score from recent review ratings
    let recentSentimentScore = null;
    if (dataForSEO.recentReviews?.length >= 3) {
        const withRatings = dataForSEO.recentReviews.filter(r => r.rating > 0);
        if (withRatings.length > 0) {
            recentSentimentScore = withRatings.reduce((sum, r) => sum + r.rating, 0) / withRatings.length;
        }
    }

    // Recent negative reviews (rating <= 3)
    const recentNegative = (dataForSEO.recentReviews || [])
        .filter(r => r.rating > 0 && r.rating <= 3)
        .map(r => ({ theme: r.text?.substring(0, 100) || '', snippet: r.text?.substring(0, 80) || '', rating: r.rating }));

    const missing = gbpCompleteness.missing || [];
    const photoCount = gbpInfo.totalPhotos || gbpCompleteness.photoCount || 0;

    return {
        prospect: {
            businessName: lead.name || '',
            category: lead.category || displayIndustryName || (industry && industry.display) || '',
            city: city || '',
            state: state || '',
            rating: parseFloat(lead.rating) || 0,
            reviewCount: parseInt(lead.reviewCount || lead.reviews) || 0,
            website: lead.website || null
        },
        demographics: {
            // ZIP-level profile takes precedence over city-level (more granular)
            population: (data.zipDemographics?.profile?.population) || cityDemographics.population || demographics.population || null,
            medianIncome: (data.zipDemographics?.profile?.medianHouseholdIncome) || cityDemographics.medianIncome || demographics.medianIncome || null,
            medianHomeValue: cityDemographics.medianHomeValue || null,
            growthSignals: demographicsEnriched.growthSignals || [],
            // Additional ZIP-level fields used for richer demand scoring
            homeownershipRate: data.zipDemographics?.profile?.homeownershipRate || null,
            medianAge: data.zipDemographics?.profile?.medianAge || null,
            collegeDegreeRate: data.zipDemographics?.profile?.collegeDegreeRate || null
        },
        competitors: (data.competitors || []).slice(0, 20).map(c => ({
            name: c.name,
            rating: parseFloat(c.rating) || 0,
            reviewCount: parseInt(c.reviews || c.reviewCount) || 0,
            photoCount: 0,
            website: c.website || null
        })),
        competitiveLandscape: data.competitiveLandscape || null,
        gbpSignals: {
            hasServices: !missing.some(m => (m || '').toLowerCase().includes('service')),
            hasDescription: gbpInfo.description
                ? gbpInfo.description.length > 50
                : !missing.some(m => (m || '').toLowerCase().includes('description')),
            description: gbpInfo.description || '',
            hasPhotos: photoCount > 0,
            photoCount,
            hasHours: gbpInfo.hasHours !== undefined
                ? gbpInfo.hasHours
                : !missing.some(m => (m || '').toLowerCase().includes('hours')),
            hasPosts: false
        },
        reviews: {
            monthlyVelocity,
            recentNegative,
            responseRate: dataForSEO.responseRate != null ? dataForSEO.responseRate : null,
            recentSentimentScore,
            daysSinceLastReview: dataForSEO.daysSinceLastReview != null ? dataForSEO.daysSinceLastReview : null
        },
        shareOfVoice: data.shareOfVoice || null,
        benchmarks: benchmarks || {}
    };
}

module.exports = {
    calculateOpportunityScore,
    buildEnrichmentData,
    detectTriggers,
    analyzeProductFit,
    scoreDemand,
    scoreVisibilityGap,
    scoreReputationGap,
    scoreCompetitivePressure
};
