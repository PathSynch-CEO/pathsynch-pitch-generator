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
    // Based on recency of last review — tries all recentReviews for a valid date,
    // then falls back to the pre-computed daysSinceLastReview field from DataForSEO enrichment.
    let C = 10; // default if no velocity data
    let bestDaysSince = null;

    // Path 1: scan all recentReviews entries for the most recent valid date
    if (lead.dataForSEO?.recentReviews?.length > 0) {
        for (const review of lead.dataForSEO.recentReviews) {
            if (!review.date) continue;
            const parsed = new Date(review.date);
            if (isNaN(parsed.getTime())) continue;
            const days = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
            if (days >= 0 && (bestDaysSince === null || days < bestDaysSince)) {
                bestDaysSince = days;
            }
        }
    }

    // Path 2: fall back to pre-computed field set by market.js enrichment
    if (bestDaysSince === null && lead.dataForSEO?.daysSinceLastReview != null) {
        bestDaysSince = lead.dataForSEO.daysSinceLastReview;
    }

    if (bestDaysSince !== null) {
        if (bestDaysSince < 7) C = 20;
        else if (bestDaysSince < 30) C = 15;
        else if (bestDaysSince < 90) C = 8;
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

    // Recent hire bonus — new leadership triggers vendor evaluation
    if (lead.decisionMaker?.recentHire || lead.orgChart?.recentHires?.length > 0) {
        E = Math.min(10, E + 8);
    }

    // Velocity trend bonus — declining/stalling businesses are higher opportunity
    if (lead.velocityTrend?.scoreBonus) {
        E = Math.min(10, E + lead.velocityTrend.scoreBonus);
    }

    // Response rate bonus — critical review engagement gap signals opportunity
    if (lead.dataForSEO?.responseRate != null && lead.dataForSEO.responseRate < 20) {
        E = Math.min(10, E + 5);
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

    // LINE 5: Recent hire signal (from theorg.com enrichment)
    if (lead.decisionMaker?.recentHire || lead.orgChart?.recentHires?.length > 0) {
        const hire = lead.decisionMaker?.recentHire
            ? lead.decisionMaker
            : lead.orgChart?.recentHires?.[0];
        if (hire && hire.name) {
            lines.push(`New hire signal: ${hire.name} joined as ${hire.title || 'decision maker'}. New leadership typically triggers vendor evaluation within 90 days.`);
        }
    }

    // LINE 6: Review response rate (from DataForSEO ownerResponse analysis)
    if (lead.dataForSEO?.responseRate != null) {
        const rate = lead.dataForSEO.responseRate;
        if (rate < 20) {
            lines.push(`Response rate: ${rate}% \u2014 critical review engagement gap.`);
        } else if (rate <= 50) {
            lines.push(`Response rate: ${rate}% \u2014 moderate engagement gap detected.`);
        }
        // rate > 50%: not a gap worth flagging
    }

    // LINE 7a: Review recency / velocity alert (dormant = last review > 90 days ago)
    if (lead.dataForSEO?.daysSinceLastReview != null) {
        const daysAgo = lead.dataForSEO.daysSinceLastReview;
        if (daysAgo > 90) {
            lines.push(`Velocity alert: last review ${daysAgo} days ago \u2014 review engine has stalled.`);
        }
    } else if (lead.dataForSEO?.recentReviews?.[0]?.date) {
        // Fallback: compute on the fly if daysSinceLastReview not stored
        const lastDate = new Date(lead.dataForSEO.recentReviews[0].date);
        if (!isNaN(lastDate.getTime())) {
            const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysAgo > 90) {
                lines.push(`Velocity alert: last review ${daysAgo} days ago \u2014 review engine has stalled.`);
            }
        }
    }

    // LINE 7: Share of voice
    if (lead.shareOfVoice !== undefined && lead.shareOfVoice < 1) {
        lines.push(`Share of voice: ${lead.shareOfVoice.toFixed(2)}% of market social proof \u2014 effectively invisible online.`);
    } else if (lead.shareOfVoice !== undefined && lead.shareOfVoice < 5) {
        lines.push(`Share of voice: ${lead.shareOfVoice.toFixed(1)}% of market \u2014 below average visibility.`);
    }

    // LINE 8: GBP Completeness gaps
    if (lead.gbpCompleteness) {
        const gbp = lead.gbpCompleteness;
        if (gbp.tier === 'weak') {
            lines.push(`GBP completeness: ${gbp.score}/100 (weak) \u2014 ${gbp.missing.slice(0, 2).join(', ')}.`);
        } else if (gbp.tier === 'partial' && gbp.missing.length > 0) {
            lines.push(`GBP gaps: ${gbp.missing.slice(0, 2).join(', ')}.`);
        }
    }

    // LINE 9: Review sentiment summary
    if (lead.sentiment) {
        const praise = (lead.sentiment.praiseThemes || []).slice(0, 2).join(', ');
        const complaints = (lead.sentiment.complaintThemes || []).slice(0, 2).join(', ');
        if (complaints) {
            lines.push(`Customers say: ${praise || 'positive'}. Pain points: ${complaints}.`);
        } else if (praise) {
            lines.push(`Customers say: ${praise}.`);
        }
    }

    // LINE 10: Time in business + review velocity
    if (lead.timeInBusiness && lead.reviewVelocity) {
        const tib = lead.timeInBusiness;
        const vel = lead.reviewVelocity;
        if (vel.label === 'Stalled' || vel.label === 'Low velocity') {
            lines.push(`Est. ${tib.foundedYear} (${tib.years}yr) \u2014 ${vel.signal}`);
        } else if (vel.label === 'High velocity') {
            lines.push(`Est. ${tib.foundedYear} (${tib.years}yr) \u2014 ${vel.signal}`);
        }
    } else if (lead.timeInBusiness) {
        lines.push(`Est. ${lead.timeInBusiness.foundedYear} (${lead.timeInBusiness.years} years in business).`);
    }

    // LINE 11: Velocity trend (cross-report comparison)
    if (lead.velocityTrend) {
        const vt = lead.velocityTrend;
        if (vt.classification === 'declining') {
            lines.push(`Velocity trend: ${vt.arrow} Declining \u2014 lost ${Math.abs(vt.reviewsAdded)} reviews in ${vt.daysBetween} days. Possible churn signal.`);
        } else if (vt.classification === 'stalling') {
            lines.push(`Velocity trend: ${vt.arrow} Stalling \u2014 +${vt.reviewsAdded} reviews in ${vt.daysBetween} days (${vt.monthlyVelocity}/mo). Below market pace.`);
        }
    }

    // LINE 12: Website traffic tier
    if (lead.trafficTier?.signal) {
        if (lead.trafficTier.tier === 'no_website') {
            lines.push('Web presence: No website \u2014 entirely GBP-dependent for discovery.');
        } else if (lead.trafficTier.tier === 'ghost') {
            lines.push('Web presence: GBP-only \u2014 no meaningful indexed web presence detected.');
        } else if (lead.trafficTier.tier === 'minimal') {
            lines.push(`Web presence: Minimal \u2014 ${lead.trafficTier.indexedPages} indexed pages, heavily GBP-dependent.`);
        }
    }

    // LINE 12: DataForSEO recent review snippet if available
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

/**
 * Calculate GBP Completeness score from DataForSEO business info
 * @param {Object} gbpInfo - From getBusinessInfo()
 * @returns {Object} { score: 0-100, missing: string[], tier: 'complete'|'partial'|'weak' }
 */
function calculateGBPCompleteness(gbpInfo) {
    if (!gbpInfo) return { score: 0, missing: ['No GBP data available'], tier: 'weak' };

    let score = 0;
    const missing = [];

    // Photos (30 pts) — 10+ = full, 5-9 = partial, <5 = low
    const photos = gbpInfo.totalPhotos || 0;
    if (photos >= 10) score += 30;
    else if (photos >= 5) score += 20;
    else if (photos >= 1) score += 10;
    else missing.push('No photos uploaded');
    if (photos > 0 && photos < 10) missing.push(`Only ${photos} photos (10+ recommended)`);

    // Hours (20 pts)
    if (gbpInfo.hasHours) score += 20;
    else missing.push('No business hours listed');

    // Claimed (20 pts)
    if (gbpInfo.isClaimed) score += 20;
    else missing.push('GBP not claimed');

    // Website (15 pts)
    if (gbpInfo.website) score += 15;
    else missing.push('No website linked');

    // Phone (15 pts)
    if (gbpInfo.phone) score += 15;
    else missing.push('No phone number listed');

    const tier = score >= 80 ? 'complete' : score >= 50 ? 'partial' : 'weak';
    return { score, missing, tier };
}

/**
 * Adjust SEO score based on photo count (proxy for GBP optimization)
 * @param {number} currentSEOScore - Current calculated SEO score
 * @param {number} photoCount - Total photos from GBP
 * @returns {number} Adjusted SEO score (0-100)
 */
function adjustSEOScoreForPhotos(currentSEOScore, photoCount) {
    if (!photoCount || photoCount <= 0) return Math.max(0, currentSEOScore - 5);
    if (photoCount >= 10) return Math.min(100, currentSEOScore + 5);
    return currentSEOScore;
}

/**
 * Identify the true market leader using composite score: 40% rating + 60% review volume
 * Prevents a 5.0★/2-review business from outranking a 4.8★/1200-review business.
 * @param {Array} competitors - Array of competitor objects
 * @returns {Object} The market leader competitor object
 */
function identifyMarketLeader(competitors) {
    if (!competitors || competitors.length === 0) return {};
    const ratings = competitors.map(c => parseFloat(c.rating) || 0);
    const reviews = competitors.map(c => parseInt(c.reviewCount || c.reviews) || 0);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const ratingRange = maxRating - minRating || 1;
    const maxReviews = Math.max(...reviews) || 1;

    let bestScore = -1;
    let leader = competitors[0];
    for (const c of competitors) {
        const r = parseFloat(c.rating) || 0;
        const rv = parseInt(c.reviewCount || c.reviews) || 0;
        const composite = ((r - minRating) / ratingRange) * 0.4 + (rv / maxReviews) * 0.6;
        if (composite > bestScore) {
            bestScore = composite;
            leader = c;
        }
    }
    return leader;
}

/**
 * Get appropriate dominance language based on leader's review volume vs market average
 * @param {Object} leader - Market leader object
 * @param {number} marketAvgReviews - Market average review count
 * @returns {string} "dominates" | "leads" | "edges out"
 */
function getDominanceLanguage(leader, marketAvgReviews) {
    const leaderReviews = parseInt(leader.reviewCount || leader.reviews) || 0;
    const ratio = marketAvgReviews > 0 ? leaderReviews / marketAvgReviews : 1;
    if (ratio >= 3) return 'dominates';
    if (ratio >= 1.5) return 'leads';
    return 'edges out the field in';
}

/**
 * Calculate velocity trend by comparing current leads to a previous report's leads.
 * Matches leads by normalized business name. Classifies review growth rate.
 * @param {Array} currentLeads - Current report leads with reviewCount
 * @param {Array} previousLeads - Previous report leads with reviewCount
 * @param {number} daysBetween - Days between the two reports
 * @returns {Map} Map of normalized lead name → { classification, reviewsAdded, monthlyVelocity, scoreBonus, label, color, arrow }
 */
function calculateVelocityTrend(currentLeads, previousLeads, daysBetween) {
    if (!currentLeads?.length || !previousLeads?.length || daysBetween < 14) return new Map();

    const normalize = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const prevMap = new Map();
    for (const lead of previousLeads) {
        const key = normalize(lead.name);
        if (key) prevMap.set(key, parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0);
    }

    const results = new Map();
    const monthsFactor = daysBetween / 30;

    for (const lead of currentLeads) {
        const key = normalize(lead.name);
        if (!prevMap.has(key)) continue;

        const prevCount = prevMap.get(key);
        const currCount = parseInt(lead.reviewCount) || parseInt(lead.reviews) || 0;
        const reviewsAdded = currCount - prevCount;
        const monthlyVelocity = monthsFactor > 0 ? reviewsAdded / monthsFactor : 0;

        let classification, scoreBonus, label, color, arrow;
        if (reviewsAdded < 0) {
            classification = 'declining'; scoreBonus = 10; label = 'Declining'; color = '#dc2626'; arrow = '\u2193';
        } else if (monthlyVelocity < 1) {
            classification = 'stalling'; scoreBonus = 7; label = 'Stalling'; color = '#d97706'; arrow = '\u2192';
        } else if (monthlyVelocity < 3) {
            classification = 'below_pace'; scoreBonus = 4; label = 'Below pace'; color = '#6b7280'; arrow = '\u2192';
        } else {
            classification = 'on_pace'; scoreBonus = 0; label = 'On pace'; color = '#6b7280'; arrow = '\u2191';
        }

        results.set(key, {
            classification, reviewsAdded, monthlyVelocity: Math.round(monthlyVelocity * 10) / 10,
            scoreBonus, label, color, arrow, daysBetween, prevCount, currCount
        });
    }

    return results;
}

module.exports = { calculateOpportunityScore, scoreLeads, generateIntelSignal, calculateGBPCompleteness, adjustSEOScoreForPhotos, identifyMarketLeader, getDominanceLanguage, calculateVelocityTrend };
