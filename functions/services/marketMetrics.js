/**
 * Market Metrics Service
 *
 * Calculates market intelligence metrics including saturation,
 * market size, growth rate, and opportunity scores
 */

const naics = require('../config/naics');

/**
 * Industry benchmarks for saturation scoring
 * Values are competitors per 10,000 population
 */
const INDUSTRY_BENCHMARKS = {
    '722511': { low: 2.0, medium: 5.0, high: 8.0 },   // Full-service restaurants
    '722513': { low: 3.0, medium: 8.0, high: 15.0 },  // Limited-service restaurants
    '722515': { low: 1.5, medium: 4.0, high: 8.0 },   // Cafes/coffee shops
    '722410': { low: 1.0, medium: 3.0, high: 6.0 },   // Bars
    '811111': { low: 1.0, medium: 3.0, high: 6.0 },   // Auto repair
    '811121': { low: 0.5, medium: 1.5, high: 3.0 },   // Body shops
    '441110': { low: 0.3, medium: 0.8, high: 1.5 },   // Car dealers
    '713940': { low: 0.5, medium: 1.5, high: 3.0 },   // Gyms
    '621111': { low: 2.0, medium: 5.0, high: 10.0 },  // Medical practices
    '621210': { low: 1.0, medium: 2.5, high: 5.0 },   // Dental practices
    '621310': { low: 0.3, medium: 0.8, high: 1.5 },   // Chiropractors
    '812199': { low: 0.5, medium: 1.5, high: 3.0 },   // Spa/massage
    '238220': { low: 1.0, medium: 3.0, high: 6.0 },   // Plumbing/HVAC
    '238210': { low: 0.8, medium: 2.0, high: 4.0 },   // Electrical
    '238160': { low: 0.5, medium: 1.5, high: 3.0 },   // Roofing
    '561730': { low: 1.0, medium: 3.0, high: 6.0 },   // Landscaping
    '541110': { low: 1.0, medium: 3.0, high: 7.0 },   // Lawyers
    '541211': { low: 0.8, medium: 2.0, high: 4.0 },   // Accountants
    '531210': { low: 1.5, medium: 4.0, high: 8.0 },   // Real estate
    '524210': { low: 1.0, medium: 2.5, high: 5.0 },   // Insurance
    '812111': { low: 2.0, medium: 5.0, high: 10.0 },  // Hair salons
    '812112': { low: 1.5, medium: 4.0, high: 8.0 },   // Beauty salons
    '812113': { low: 1.0, medium: 3.0, high: 6.0 },   // Nail salons
    '452319': { low: 1.0, medium: 3.0, high: 6.0 },   // General merchandise
    '448140': { low: 0.8, medium: 2.0, high: 4.0 },   // Clothing stores
    '443142': { low: 0.3, medium: 0.8, high: 1.5 },   // Electronics stores
    'default': { low: 1.5, medium: 4.0, high: 8.0 }
};

/**
 * Industry base growth rates (annual %)
 */
const INDUSTRY_BASE_GROWTH = {
    '722511': 3.5,   // Restaurants
    '722513': 2.5,   // Fast food
    '722515': 4.0,   // Cafes
    '722410': 2.0,   // Bars
    '811111': 2.0,   // Auto repair
    '811121': 1.5,   // Body shops
    '441110': 2.0,   // Car dealers
    '713940': 5.0,   // Gyms
    '621111': 3.0,   // Medical
    '621210': 2.5,   // Dental
    '621310': 3.5,   // Chiropractic
    '812199': 4.0,   // Spa
    '238220': 4.0,   // Plumbing/HVAC
    '238210': 3.5,   // Electrical
    '238160': 3.0,   // Roofing
    '561730': 4.5,   // Landscaping
    '541110': 1.5,   // Legal
    '541211': 2.0,   // Accounting
    '531210': 2.5,   // Real estate
    '524210': 2.0,   // Insurance
    '812111': 2.5,   // Hair salons
    '812112': 3.0,   // Beauty salons
    '812113': 3.5,   // Nail salons
    '452319': 2.5,   // General merchandise
    '448140': 1.5,   // Clothing
    '443142': 2.0,   // Electronics
    'default': 2.5
};

/**
 * Income sweet spots by industry
 */
const INDUSTRY_INCOME_SWEET_SPOTS = {
    '722511': { min: 50000, ideal: 80000, max: 150000 },  // Full-service restaurants
    '722513': { min: 30000, ideal: 50000, max: 80000 },   // Fast food
    '722515': { min: 45000, ideal: 70000, max: 120000 },  // Cafes
    '713940': { min: 45000, ideal: 75000, max: 120000 },  // Gyms
    '541110': { min: 70000, ideal: 120000, max: 200000 }, // Legal
    '541211': { min: 60000, ideal: 100000, max: 180000 }, // Accounting
    '531210': { min: 55000, ideal: 90000, max: 160000 },  // Real estate
    '812111': { min: 35000, ideal: 55000, max: 90000 },   // Hair salons
    '812112': { min: 40000, ideal: 65000, max: 110000 },  // Beauty salons
    '238220': { min: 45000, ideal: 75000, max: 130000 },  // Plumbing/HVAC
    '561730': { min: 60000, ideal: 95000, max: 180000 },  // Landscaping
    'default': { min: 40000, ideal: 65000, max: 120000 }
};

/**
 * Calculate market size estimate
 *
 * @param {Object} demographics - Demographics data
 * @param {string} naicsCode - NAICS code
 * @param {Object[]} competitors - List of competitors
 * @returns {Object} Market size estimate
 */
function calculateMarketSize(demographics, naicsCode, competitors = []) {
    const households = demographics.households || demographics.totalHousingUnits ||
                      Math.round((demographics.population || 100000) / 2.5);
    const medianIncome = demographics.medianIncome || 55000;

    // Get industry spending rate
    const spendRate = naics.getIndustrySpendRate(naicsCode);

    // Local adjustment factors
    const incomeAdjustment = medianIncome > 75000 ? 1.15 :
                            medianIncome < 45000 ? 0.85 : 1.0;

    // Urban adjustment (if available)
    const urbanAdjustment = demographics.urbanRuralCode === 'U' ? 1.10 :
                           demographics.urbanRuralCode === 'R' ? 0.90 : 1.0;

    // Calculate total addressable market
    const totalMarket = Math.round(
        households * medianIncome * spendRate * incomeAdjustment * urbanAdjustment
    );

    // Market per establishment
    const competitorCount = competitors.length || 1;
    const marketPerBusiness = Math.round(totalMarket / (competitorCount + 1));

    // Calculate confidence
    let confidence = 100;
    if (!demographics.population) confidence -= 20;
    if (!demographics.medianIncome) confidence -= 15;
    if (medianIncome < 30000 || medianIncome > 150000) confidence -= 10;

    return {
        totalAddressableMarket: totalMarket,
        marketPerBusiness: marketPerBusiness,
        methodology: 'Consumer Expenditure Model',
        inputs: {
            households,
            medianIncome,
            spendRate: Math.round(spendRate * 1000) / 10, // As percentage
            incomeAdjustment,
            urbanAdjustment
        },
        confidence: Math.max(50, confidence)
    };
}

/**
 * Calculate market saturation score
 *
 * Supports two scoring paths:
 * - Consumer path (has ratings): density 50%, quality 30%, activity 20%
 * - B2B path (no ratings): density 60%, firmographic maturity 40%
 *
 * @param {Object[]} competitors - List of competitors
 * @param {Object} demographics - Demographics data
 * @param {string} naicsCode - NAICS code
 * @param {number} radius - Search radius in meters
 * @returns {Object} Saturation score and components
 */
function calculateSaturationScore(competitors, demographics, naicsCode, radius = 5000) {
    const population = demographics.population || 100000;
    const competitorCount = competitors.length;

    // Get industry benchmarks - fall through to naics config if not in local map
    const benchmark = INDUSTRY_BENCHMARKS[naicsCode] ||
        naics.getIndustryBenchmarks(naicsCode) ||
        INDUSTRY_BENCHMARKS.default;

    // 1. DENSITY SCORE (0-100)
    const competitorsPer10K = (competitorCount / population) * 10000;
    let densityScore;

    if (competitorsPer10K <= benchmark.low) {
        densityScore = 20; // Low density = low saturation
    } else if (competitorsPer10K <= benchmark.medium) {
        densityScore = 20 + ((competitorsPer10K - benchmark.low) / (benchmark.medium - benchmark.low)) * 30;
    } else if (competitorsPer10K <= benchmark.high) {
        densityScore = 50 + ((competitorsPer10K - benchmark.medium) / (benchmark.high - benchmark.medium)) * 30;
    } else {
        densityScore = Math.min(100, 80 + (competitorsPer10K - benchmark.high) * 2);
    }

    // Detect B2B vs consumer: B2B competitors have rating: null
    const ratings = competitors.filter(c => c.rating != null && c.rating !== undefined).map(c => c.rating);
    const isB2B = ratings.length === 0 && competitorCount > 0;

    if (isB2B) {
        // B2B scoring path: density 60%, firmographic maturity 40%
        const firmographicScore = calculateFirmographicScore(competitors);

        const saturationScore = Math.round(
            (densityScore * 0.60) +
            (firmographicScore.score * 0.40)
        );

        let level, description;
        if (saturationScore < 35) {
            level = 'low';
            description = 'Underserved B2B market with room for growth';
        } else if (saturationScore < 65) {
            level = 'medium';
            description = 'Moderately competitive B2B market';
        } else {
            level = 'high';
            description = 'Established B2B market with mature competitors';
        }

        return {
            score: saturationScore,
            level,
            description,
            scoringPath: 'b2b',
            components: {
                density: {
                    score: Math.round(densityScore),
                    competitorsPer10K: Math.round(competitorsPer10K * 10) / 10,
                    benchmark
                },
                firmographic: firmographicScore
            }
        };
    }

    // Consumer scoring path (existing logic)
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const highRatedCount = ratings.filter(r => r >= 4.0).length;
    const highRatedPct = competitorCount > 0 ? (highRatedCount / competitorCount) * 100 : 0;

    const qualityScore = (avgRating / 5 * 50) + (highRatedPct / 100 * 50);

    // 3. ACTIVITY SCORE (0-100, weighted 20%)
    const totalReviews = competitors.reduce((sum, c) => sum + (c.reviewCount || c.reviews || 0), 0);
    const avgReviews = competitorCount > 0 ? totalReviews / competitorCount : 0;

    let activityScore;
    if (totalReviews < 100) activityScore = 10;
    else if (totalReviews < 500) activityScore = 30;
    else if (totalReviews < 2000) activityScore = 50;
    else if (totalReviews < 5000) activityScore = 70;
    else activityScore = 90;

    // Weighted combination
    const saturationScore = Math.round(
        (densityScore * 0.50) +
        (qualityScore * 0.30) +
        (activityScore * 0.20)
    );

    // Determine level
    let level, description;
    if (saturationScore < 35) {
        level = 'low';
        description = 'Underserved market with room for growth';
    } else if (saturationScore < 65) {
        level = 'medium';
        description = 'Moderately competitive market';
    } else {
        level = 'high';
        description = 'Highly competitive market with established players';
    }

    return {
        score: saturationScore,
        level,
        description,
        scoringPath: 'consumer',
        components: {
            density: {
                score: Math.round(densityScore),
                competitorsPer10K: Math.round(competitorsPer10K * 10) / 10,
                benchmark
            },
            quality: {
                score: Math.round(qualityScore),
                avgRating: Math.round(avgRating * 10) / 10,
                highRatedPct: Math.round(highRatedPct)
            },
            activity: {
                score: Math.round(activityScore),
                totalReviews,
                avgReviews: Math.round(avgReviews)
            }
        }
    };
}

/**
 * Calculate firmographic maturity score for B2B competitors
 *
 * Used in place of quality/activity scores when competitors lack ratings.
 *
 * @param {Object[]} competitors - List of competitors with firmographics
 * @returns {Object} { score, employeeSizeScore, fundingPresenceScore, details }
 */
function calculateFirmographicScore(competitors) {
    if (!competitors || competitors.length === 0) {
        return { score: 50, employeeSizeScore: 50, fundingPresenceScore: 50, details: {} };
    }

    // Employee size signal (60% weight)
    // Higher average employee count = more mature/established market = higher saturation
    const employeeCounts = competitors
        .map(c => c.firmographics?.employeeCount)
        .filter(count => count != null && count > 0);

    let employeeSizeScore = 50; // Default if no data
    if (employeeCounts.length > 0) {
        const avgEmployees = employeeCounts.reduce((a, b) => a + b, 0) / employeeCounts.length;
        // Scale: 1-10 = 20, 11-50 = 35, 51-200 = 50, 201-500 = 65, 501-1000 = 75, 1001+ = 90
        if (avgEmployees <= 10) employeeSizeScore = 20;
        else if (avgEmployees <= 50) employeeSizeScore = 35;
        else if (avgEmployees <= 200) employeeSizeScore = 50;
        else if (avgEmployees <= 500) employeeSizeScore = 65;
        else if (avgEmployees <= 1000) employeeSizeScore = 75;
        else employeeSizeScore = 90;
    }

    // Funding presence signal (40% weight)
    // Higher % of funded competitors = more mature market
    const fundedCount = competitors.filter(
        c => c.firmographics?.funding != null && c.firmographics.funding > 0
    ).length;
    const fundedPct = competitors.length > 0 ? fundedCount / competitors.length : 0;
    const fundingPresenceScore = Math.round(fundedPct * 100);

    const score = Math.round(
        (employeeSizeScore * 0.60) +
        (fundingPresenceScore * 0.40)
    );

    return {
        score,
        employeeSizeScore: Math.round(employeeSizeScore),
        fundingPresenceScore: Math.round(fundingPresenceScore),
        details: {
            avgEmployeeCount: employeeCounts.length > 0
                ? Math.round(employeeCounts.reduce((a, b) => a + b, 0) / employeeCounts.length)
                : null,
            companiesWithEmployeeData: employeeCounts.length,
            fundedCompanies: fundedCount,
            totalCompanies: competitors.length
        }
    };
}

/**
 * Calculate market growth rate
 *
 * @param {Object} businessDensity - CBP establishment data
 * @param {Object} demandSignals - Google Trends data (optional)
 * @param {Object} demographics - Demographics data
 * @param {string} naicsCode - NAICS code
 * @returns {Object} Growth rate projection
 */
function calculateGrowthRate(businessDensity, demandSignals, demographics, naicsCode) {
    // Get industry base growth rate
    const industryBase = INDUSTRY_BASE_GROWTH[naicsCode] || INDUSTRY_BASE_GROWTH.default;

    // 1. ESTABLISHMENT GROWTH (from CBP data)
    const estabGrowthRate = businessDensity?.data?.yoyGrowthRate || 0;
    const estabGrowthScore = Math.max(-20, Math.min(20, estabGrowthRate));

    // 2. DEMAND GROWTH (from Google Trends)
    const demandYoY = demandSignals?.yoyChange || 0;
    const demandGrowthScore = Math.max(-20, Math.min(20, demandYoY / 5));

    // 3. DEMOGRAPHIC GROWTH
    const popGrowthRate = demographics?.populationGrowthRate || 1.0;
    const incomeGrowthRate = demographics?.incomeGrowthRate || 2.0;
    const demoGrowthScore = (popGrowthRate * 0.6 + incomeGrowthRate * 0.4);

    // Combine components
    const compositeGrowth = industryBase +
        (estabGrowthScore * 0.40) +
        (demandGrowthScore * 0.35) +
        (demoGrowthScore * 0.25);

    // Cap at reasonable bounds
    const finalGrowthRate = Math.max(-10, Math.min(15, Math.round(compositeGrowth * 10) / 10));

    // Trend direction
    let trendDirection;
    if (finalGrowthRate > 4) trendDirection = 'strong_growth';
    else if (finalGrowthRate > 1) trendDirection = 'moderate_growth';
    else if (finalGrowthRate > -1) trendDirection = 'stable';
    else if (finalGrowthRate > -4) trendDirection = 'slight_decline';
    else trendDirection = 'declining';

    // Five year projection
    const fiveYearProjection = Math.round((Math.pow(1 + finalGrowthRate / 100, 5) - 1) * 100);

    return {
        annualGrowthRate: finalGrowthRate,
        trendDirection,
        fiveYearProjection,
        components: {
            industryBase,
            establishmentTrend: Math.round(estabGrowthScore * 10) / 10,
            demandTrend: Math.round(demandGrowthScore * 10) / 10,
            demographicTrend: Math.round(demoGrowthScore * 10) / 10
        },
        confidence: calculateGrowthConfidence(businessDensity, demandSignals)
    };
}

/**
 * Calculate confidence in growth projection
 */
function calculateGrowthConfidence(businessDensity, demandSignals) {
    let confidence = 70;

    if (businessDensity?.data?.yearlyData?.length >= 3) confidence += 15;
    else if (businessDensity?.data?.yearlyData?.length >= 2) confidence += 10;

    if (demandSignals?.currentInterest) confidence += 10;

    if (businessDensity?.data?.isEstimate) confidence -= 15;

    return Math.max(40, Math.min(95, confidence));
}

/**
 * Calculate opportunity score
 *
 * @param {Object} saturation - Saturation score result
 * @param {Object} growth - Growth rate result
 * @param {Object} demographics - Demographics data
 * @param {Object} demandSignals - Google Trends data (optional)
 * @param {Object[]} competitors - List of competitors
 * @param {string} naicsCode - NAICS code
 * @returns {Object} Opportunity score and factors
 */
function calculateOpportunityScore(saturation, growth, demographics, demandSignals, competitors, naicsCode) {
    // 1. SATURATION INVERSE (30%)
    const saturationInverse = 100 - saturation.score;

    // 2. GROWTH SCORE (25%) - Normalize growth rate to 0-100
    const growthRate = growth.annualGrowthRate;
    const growthScore = Math.max(0, Math.min(100, 50 + (growthRate * 10)));

    // 3. INCOME FIT SCORE (20%)
    const medianIncome = demographics.medianIncome || 55000;
    const sweetSpot = INDUSTRY_INCOME_SWEET_SPOTS[naicsCode] || INDUSTRY_INCOME_SWEET_SPOTS.default;

    let incomeFitScore;
    if (medianIncome >= sweetSpot.min && medianIncome <= sweetSpot.max) {
        const distanceFromIdeal = Math.abs(medianIncome - sweetSpot.ideal);
        const maxDistance = Math.max(sweetSpot.ideal - sweetSpot.min, sweetSpot.max - sweetSpot.ideal);
        incomeFitScore = 100 - ((distanceFromIdeal / maxDistance) * 40);
    } else {
        const distanceOutside = medianIncome < sweetSpot.min
            ? sweetSpot.min - medianIncome
            : medianIncome - sweetSpot.max;
        incomeFitScore = Math.max(20, 60 - (distanceOutside / 10000) * 10);
    }

    // 4. DEMAND MOMENTUM (15%)
    const momentumScore = demandSignals?.momentumScore || 50;

    // 5. QUALITY GAP SCORE (10%)
    const ratings = competitors.filter(c => c.rating != null && c.rating !== undefined).map(c => c.rating);
    let qualityGapScore;

    if (ratings.length > 0) {
        // Consumer path: use ratings-based quality gap
        const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        const lowRatedCount = ratings.filter(r => r < 3.5).length;
        const lowRatedPct = competitors.length > 0 ? lowRatedCount / competitors.length : 0;
        qualityGapScore = ((5 - avgRating) / 2 * 50) + (lowRatedPct * 50);
    } else if (competitors.length > 0) {
        // B2B path: use "market maturity gap" based on small-company percentage
        const smallCompanyCount = competitors.filter(c => {
            const emp = c.firmographics?.employeeCount;
            return emp != null && emp <= 50;
        }).length;
        const smallPct = smallCompanyCount / competitors.length;
        // More small companies = more room for a well-resourced entrant = higher gap score
        qualityGapScore = Math.round(smallPct * 80);
    } else {
        qualityGapScore = 50; // No competitors = neutral
    }

    // COMPOSITE SCORE
    const opportunityScore = Math.round(
        (saturationInverse * 0.30) +
        (growthScore * 0.25) +
        (incomeFitScore * 0.20) +
        (momentumScore * 0.15) +
        (qualityGapScore * 0.10)
    );

    // Determine level and label
    let opportunityLevel, opportunityLabel;
    if (opportunityScore >= 70) {
        opportunityLevel = 'high';
        opportunityLabel = 'High Opportunity';
    } else if (opportunityScore >= 50) {
        opportunityLevel = 'medium';
        opportunityLabel = 'Moderate Opportunity';
    } else if (opportunityScore >= 35) {
        opportunityLevel = 'low';
        opportunityLabel = 'Limited Opportunity';
    } else {
        opportunityLevel = 'challenging';
        opportunityLabel = 'Challenging Market';
    }

    // Identify contributing factors
    const factors = [
        { name: 'Low Competition', score: saturationInverse, weight: 0.30, contribution: saturationInverse * 0.30 },
        { name: 'Market Growth', score: growthScore, weight: 0.25, contribution: growthScore * 0.25 },
        { name: 'Income Match', score: incomeFitScore, weight: 0.20, contribution: incomeFitScore * 0.20 },
        { name: 'Rising Demand', score: momentumScore, weight: 0.15, contribution: momentumScore * 0.15 },
        { name: 'Quality Gap', score: qualityGapScore, weight: 0.10, contribution: qualityGapScore * 0.10 }
    ].sort((a, b) => b.contribution - a.contribution);

    return {
        score: opportunityScore,
        level: opportunityLevel,
        label: opportunityLabel,
        factors: factors.map(f => ({
            name: f.name,
            score: Math.round(f.score),
            contribution: Math.round(f.contribution)
        })),
        topFactors: factors.slice(0, 3).map(f => f.name),
        rationale: generateOpportunityRationale(factors, opportunityLevel)
    };
}

/**
 * Generate opportunity rationale text
 */
function generateOpportunityRationale(factors, level) {
    const topFactor = factors[0];
    const secondFactor = factors[1];
    const weakestFactor = factors[factors.length - 1];

    if (level === 'high') {
        return `Strong opportunity driven by ${topFactor.name.toLowerCase()} and ${secondFactor.name.toLowerCase()}.`;
    } else if (level === 'medium') {
        return `Moderate opportunity. ${topFactor.name} is favorable, but consider ${weakestFactor.name.toLowerCase()}.`;
    } else if (level === 'low') {
        return `Limited opportunity. Focus on differentiation through quality and specialization.`;
    } else {
        return `Challenging market due to ${weakestFactor.name.toLowerCase()}. Success requires significant competitive advantage.`;
    }
}

/**
 * Generate market recommendations
 *
 * @param {Object} marketData - Full market analysis data
 * @returns {Object} Recommendations
 */
function generateRecommendations(marketData) {
    const {
        demographics,
        saturation,
        opportunity,
        competitors,
        ageDistribution,
        educationProfile,
        commutePatterns,
        naicsCode
    } = marketData;

    // Determine target customer
    let targetCustomer = 'General consumers';
    if (ageDistribution?.data?.youngProfessionalsPct > 15) {
        targetCustomer = 'Young professionals (25-34)';
    } else if (ageDistribution?.data?.ageGroups?.age35to44?.percentage > 14) {
        targetCustomer = 'Families with children (35-44)';
    } else if (ageDistribution?.data?.ageGroups?.age65plus?.percentage > 18) {
        targetCustomer = 'Retirees and seniors';
    }

    if (demographics?.medianIncome > 100000) {
        targetCustomer += ' with high disposable income';
    } else if (demographics?.medianIncome < 50000) {
        targetCustomer += ' seeking value';
    }

    // Identify differentiators based on gaps
    const differentiators = [];

    // Quality gap
    const avgRating = competitors.length > 0
        ? competitors.reduce((sum, c) => sum + (c.rating || 0), 0) / competitors.length
        : 0;

    if (avgRating < 4.0) {
        differentiators.push({
            type: 'quality',
            title: 'Superior Service Quality',
            description: `Avg competitor rating is ${avgRating.toFixed(1)}. Aim for 4.5+ to stand out.`
        });
    }

    // Education-based differentiation
    if (educationProfile?.data?.bachelorsPlusPct > 45) {
        differentiators.push({
            type: 'sophistication',
            title: 'Professional-Grade Offerings',
            description: 'Highly educated population expects expertise and premium options.'
        });
    }

    // Commute-based differentiation
    if (commutePatterns?.data?.wfhRate > 15) {
        differentiators.push({
            type: 'convenience',
            title: 'Work-from-Home Friendly',
            description: `${commutePatterns.data.wfhRate}% work from home. Consider flexible hours and delivery.`
        });
    }

    // Saturation-based positioning
    if (saturation?.score > 60) {
        differentiators.push({
            type: 'niche',
            title: 'Niche Specialization',
            description: 'Crowded market requires focused positioning on underserved segment.'
        });
    } else if (saturation?.score < 35) {
        differentiators.push({
            type: 'pioneer',
            title: 'First-Mover Advantage',
            description: 'Underserved market allows broader positioning as the go-to provider.'
        });
    }

    // Identify risks
    const risks = [];

    if (saturation?.score > 70) {
        risks.push({
            level: 'high',
            title: 'High Competition',
            description: 'Market is saturated with established players. Customer acquisition will be challenging.'
        });
    }

    if (demographics?.medianIncome < 40000) {
        risks.push({
            level: 'medium',
            title: 'Lower Spending Power',
            description: 'Below-average income levels may limit pricing power.'
        });
    }

    if (opportunity?.score < 40) {
        risks.push({
            level: 'high',
            title: 'Limited Growth Potential',
            description: 'Market conditions suggest challenging environment for new entrants.'
        });
    }

    // If low risks identified, add generic considerations
    if (risks.length === 0) {
        risks.push({
            level: 'low',
            title: 'Standard Business Risks',
            description: 'Normal market entry considerations apply. Focus on execution and customer acquisition.'
        });
    }

    return {
        targetCustomer,
        differentiators: differentiators.slice(0, 4),
        risks: risks.slice(0, 3),
        summary: opportunity?.score >= 60
            ? 'Market conditions are favorable for entry with proper positioning.'
            : opportunity?.score >= 40
            ? 'Viable market with moderate competition. Differentiation is key.'
            : 'Consider alternative locations or significant competitive advantages before proceeding.'
    };
}

module.exports = {
    calculateMarketSize,
    calculateSaturationScore,
    calculateFirmographicScore,
    calculateGrowthRate,
    calculateOpportunityScore,
    generateRecommendations,
    INDUSTRY_BENCHMARKS,
    INDUSTRY_BASE_GROWTH,
    INDUSTRY_INCOME_SWEET_SPOTS
};
