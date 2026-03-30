/**
 * Opportunity Score Calculator v2
 * 5-component formula: A (Rating Quality) + B (Presence Gap) + C (Review Velocity) + D (SEO Gap) + E (Signal Bonus)
 *
 * Extracted from market.js and upgraded from single-factor to multi-factor scoring.
 */

/**
 * Calculate opportunity score for a lead using 5-component formula
 * @param {Object} lead - Lead object with rating, reviewCount, dataForSEO, newsSignal, seoScore
 * @param {Object} marketAvg - Market averages (avgRating, avgSEOScore)
 * @param {number} reviewCeiling - Max review count for ICP (default 500)
 * @returns {Object} { total, components: {A,B,C,D,E}, interpretation }
 */
function calculateOpportunityScore(lead, marketAvg, reviewCeiling = 500) {
    // Component A — Rating Quality Gap (0-30 points)
    // How far above 4.0 stars
    const rating = parseFloat(lead.rating) || 0;
    const A = Math.min(30, Math.max(0, ((rating - 4.0) / 1.0) * 30));

    // Component B — Presence Gap (0-30 points)
    // How far BELOW the review ceiling — INVERTED
    // Low review count = HIGH score (these businesses need PathSynch most)
    const reviewCount = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
    const B = Math.min(30, Math.max(0, ((reviewCeiling - reviewCount) / reviewCeiling) * 30));

    // Component C — Review Velocity Gap (0-20 points)
    // Based on recency of last review
    let C = 10; // default if no velocity data
    if (lead.dataForSEO && lead.dataForSEO.recentReviews && lead.dataForSEO.recentReviews.length > 0) {
        const lastReviewDate = new Date(lead.dataForSEO.recentReviews[0].date);
        const daysSinceLastReview = (Date.now() - lastReviewDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLastReview < 7) C = 20;
        else if (daysSinceLastReview < 30) C = 15;
        else if (daysSinceLastReview < 90) C = 8;
        else C = 0;
    }

    // Component D — SEO Tier Gap (0-10 points)
    // Below market average SEO = more opportunity
    const seoScore = lead.seoScore || 50;
    const marketAvgSEO = marketAvg?.avgSEOScore || 65;
    let D = 0;
    if (seoScore < marketAvgSEO - 10) D = 10;
    else if (seoScore <= marketAvgSEO + 10) D = 5;
    else D = 0;

    // Component E — Signal Bonus (0-10 points)
    // Industry trend matches cap at 3; full bonus requires business name match
    let E = 0;
    if (lead.newsSignal) {
        const isNameMatch = lead.newsSignal.matchType === 'business_name';
        if (isNameMatch) {
            if (lead.newsSignal.type === 'award') E = 10;
            else if (lead.newsSignal.type === 'new_opening' || lead.newsSignal.type === 'expansion') E = 8;
            else if (lead.newsSignal.type === 'hiring') E = 5;
            else E = 3;
        } else {
            // Industry trend match — capped at 3
            E = 3;
        }
    }

    const total = Math.round(A + B + C + D + E);

    return {
        total,
        components: { A: Math.round(A), B: Math.round(B), C: Math.round(C), D: Math.round(D), E },
        interpretation: total >= 80 ? 'Priority' : total >= 60 ? 'Strong' : total >= 40 ? 'Moderate' : 'Monitor'
    };
}

/**
 * Score all leads with the v2 formula and sort by opportunity
 * @param {Array} leads - Array of lead objects
 * @param {Object} marketAvg - Market averages from seoLandscape or benchmarks
 * @param {number} reviewCeiling - ICP review ceiling
 * @returns {Array} Leads with opportunityScore, opportunityComponents, opportunityLabel attached
 */
function scoreLeads(leads, marketAvg, reviewCeiling = 500) {
    return leads.map(lead => {
        const score = calculateOpportunityScore(lead, marketAvg, reviewCeiling);
        return {
            ...lead,
            opportunityScore: score.total,
            opportunityComponents: score.components,
            opportunityLabel: score.interpretation
        };
    }).sort((a, b) => b.opportunityScore - a.opportunityScore);
}

/**
 * Generate a multi-line Intel Signal for a lead — data-driven gap observation for the sales rep
 * @param {Object} lead - Lead with opportunityScore, opportunityComponents, opportunityLabel, dataForSEO, newsSignal
 * @param {Object} benchmarks - Market benchmarks { avgRating, avgReviews }
 * @returns {string} Multi-line intel signal text
 */
function generateIntelSignal(lead, benchmarks) {
    const lines = [];
    const reviewCount = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
    const rating = parseFloat(lead.rating) || 0;
    const avgReviews = parseInt(benchmarks?.avgReviews) || 100;
    const avgRating = parseFloat(benchmarks?.avgRating) || 4.5;

    // LINE 1: Review presence vs market average
    const gapPct = Math.round(((avgReviews - reviewCount) / avgReviews) * 100);
    if (gapPct > 0) {
        lines.push(`${reviewCount} reviews vs. ${avgReviews} market avg \u2014 ${gapPct}% below presence threshold.`);
    } else if (gapPct === 0) {
        lines.push(`${reviewCount} reviews \u2014 at market average of ${avgReviews}.`);
    } else {
        lines.push(`${reviewCount} reviews vs. ${avgReviews} market avg \u2014 ${Math.abs(gapPct)}% above average.`);
    }

    // LINE 2: Rating vs market average + SEO tier
    const ratingPosition = rating > avgRating ? 'above' : rating < avgRating ? 'below' : 'at';
    const seoScore = lead.seoScore || 50;
    const seoTier = seoScore >= 70 ? 'strong' : seoScore >= 40 ? 'moderate' : 'weak';
    const seoDetail = reviewCount < avgReviews ? 'low review volume' : 'active presence';
    lines.push(`Rating: ${rating.toFixed(1)}\u2605 \u2014 ${ratingPosition} market avg of ${parseFloat(avgRating).toFixed(2)}\u2605. SEO tier: ${seoTier} \u2014 ${seoDetail}.`);

    // LINE 3: Opportunity score breakdown
    if (lead.opportunityComponents) {
        const c = lead.opportunityComponents;
        const label = lead.opportunityLabel || '';
        lines.push(`Opportunity: ${lead.opportunityScore}/100 (${label}) \u2014 Rating ${c.A}/30, Presence ${c.B}/30, Velocity ${c.C}/20, SEO ${c.D}/10, Signal ${c.E}/10.`);
    }

    // LINE 4: News/event signal if available
    if (lead.newsSignal) {
        const s = lead.newsSignal;
        const sType = (s.type || 'signal').charAt(0).toUpperCase() + (s.type || 'signal').slice(1);
        const desc = (s.title || s.description || '').substring(0, 80);
        const suffix = (s.title || s.description || '').length > 80 ? '...' : '';
        const ago = s.daysAgo ? ` \u2014 ${s.daysAgo} days ago` : '';
        lines.push(`${sType} detected: ${desc}${suffix}${ago}.`);
    }

    // LINE 5: Review response rate (from DataForSEO ownerResponse analysis)
    if (lead.dataForSEO?.responseRate != null) {
        const rate = lead.dataForSEO.responseRate;
        if (rate < 30) {
            lines.push(`Response rate: ${rate}% \u2014 review engagement gap detected.`);
        }
        // If rate >= 30%, omit — not a gap worth flagging
    }

    // LINE 6: Review recency / velocity alert
    if (lead.dataForSEO?.recentReviews?.[0]?.date) {
        const lastDate = new Date(lead.dataForSEO.recentReviews[0].date);
        const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAgo > 60) {
            lines.push(`Review velocity alert: last review ${daysAgo} days ago \u2014 dormant engagement.`);
        }
    }

    // LINE 7: Share of voice
    if (lead.shareOfVoice !== undefined && lead.shareOfVoice < 1) {
        lines.push(`Share of voice: ${lead.shareOfVoice.toFixed(2)}% of market social proof \u2014 effectively invisible online.`);
    } else if (lead.shareOfVoice !== undefined && lead.shareOfVoice < 5) {
        lines.push(`Share of voice: ${lead.shareOfVoice.toFixed(1)}% of market \u2014 below average visibility.`);
    }

    // LINE 8: DataForSEO recent review snippet if available
    if (lead.dataForSEO?.recentReviews?.length > 0) {
        const topReview = lead.dataForSEO.recentReviews[0];
        if (topReview.text) {
            const snippet = topReview.text.substring(0, 80);
            const ellipsis = topReview.text.length > 80 ? '...' : '';
            lines.push(`Recent review: \u201c${snippet}${ellipsis}\u201d`);
        }
    }

    return lines.join('\n');
}

module.exports = { calculateOpportunityScore, scoreLeads, generateIntelSignal };
